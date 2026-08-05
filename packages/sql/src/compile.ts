/**
 * 条件式 AST → SQL。docs/condition-ast.md §5
 *
 * 出口条件は一覧で数百件をまとめて評価するため、述語は SELECT 句や WHERE 句に
 * そのまま埋め込める式として組み立てる（レコードごとにコードを実行しない）。
 *
 * 全テーブルが有効期間型（SCD Type 2）なので、生成するサブクエリすべてに
 * 時点条件を付ける（docs/product-concept.md §4-1）。ルートテーブルへの付与は
 * FROM 句を組み立てる呼び出し側の責務。
 *
 * 参照が解決できない AST は例外にする。`alt validate` の参照整合層で事前に
 * 弾かれている前提であり、ここまで来たら定義かコンパイラのバグ。
 */
import {
  type Aggregate,
  type ContextName,
  type Expr,
  type Field,
  type Pred,
  type Registry,
  resolveFieldPath,
  ROOT_SOURCE,
  toColumnName,
} from '@alt/dsl'
import { type Dialect, sqlite } from './dialect.js'

/** 実行時に決まる値。SQL 関数ではなくパラメータとしてバインドする。 */
export type ContextValues = Record<ContextName, unknown>

export interface CompileOptions {
  registry: Registry
  /** 評価対象のテーブル。`source: 'root'` はここを指す。 */
  rootTable: string
  /** ルートテーブルに付けたエイリアス。 */
  rootAlias: string
  values: ContextValues
  /**
   * 時点指定。省略すると現在（`valid_to IS NULL`）。
   * 指定すると「その時点で有効だった行」を見る。
   */
  asOf?: string
  dialect?: Dialect
}

export interface SqlFragment {
  sql: string
  params: unknown[]
}

/** alias → テーブル名。exists / aggregate に入るたびに広がる。 */
type Scope = Readonly<Record<string, string>>

interface Builder {
  readonly registry: Registry
  readonly values: ContextValues
  readonly asOf: string | undefined
  readonly dialect: Dialect
  readonly params: unknown[]
  /** JOIN 用エイリアスの採番。定義側のエイリアスと衝突しないよう接頭辞を付ける。 */
  joinCount: number
}

const COMPARE_SQL: Record<string, string> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

const AGGREGATE_SQL: Record<string, string> = {
  count: 'COUNT',
  sum: 'SUM',
  avg: 'AVG',
  min: 'MIN',
  max: 'MAX',
}

/** 述語を SQL 式にコンパイルする。 */
export function compilePred(pred: Pred, options: CompileOptions): SqlFragment {
  const builder: Builder = {
    registry: options.registry,
    values: options.values,
    asOf: options.asOf,
    dialect: options.dialect ?? sqlite,
    params: [],
    joinCount: 0,
  }
  const scope: Scope = { [options.rootAlias]: options.rootTable, [ROOT_SOURCE]: options.rootTable }
  const sql = pred_(pred, builder, scope, options.rootAlias)
  return { sql, params: builder.params }
}

// ---------------------------------------------------------------------------

function param(b: Builder, value: unknown): string {
  b.params.push(b.dialect.bindValue(value))
  return b.dialect.placeholder(b.params.length - 1)
}

function q(b: Builder, identifier: string): string {
  return b.dialect.quote(identifier)
}

/** `alias` が指すテーブルの、指定時点で有効な行だけに絞る条件。 */
function temporal(b: Builder, alias: string): string {
  const validFrom = `${q(b, alias)}.${q(b, 'valid_from')}`
  const validTo = `${q(b, alias)}.${q(b, 'valid_to')}`
  if (b.asOf === undefined) return `${validTo} IS NULL`
  return `(${validFrom} <= ${param(b, b.asOf)} AND (${validTo} > ${param(b, b.asOf)} OR ${validTo} IS NULL))`
}

/**
 * `source` は AST 上のエイリアス。ルートは `'root'` で書かれることも、
 * 呼び出し側が付けた実エイリアスで書かれることもある。SQL に出すのは後者。
 */
function sqlAlias(source: string, rootAlias: string): string {
  return source === ROOT_SOURCE ? rootAlias : source
}

function lookupTable(scope: Scope, source: string): string {
  const table = scope[source]
  if (table === undefined) {
    throw new Error(`未知の source: ${source}（exists / aggregate のエイリアスか root のみ有効）`)
  }
  return table
}

// ---------------------------------------------------------------------------
// Expr
// ---------------------------------------------------------------------------

function expr_(node: Expr, b: Builder, scope: Scope, rootAlias: string): string {
  switch (node.type) {
    case 'literal':
      return param(b, node.value)
    case 'context':
      return param(b, b.values[node.name])
    case 'field':
      return field_(node, b, scope, rootAlias)
    case 'aggregate':
      return aggregate_(node, b, scope, rootAlias)
  }
}

function field_(node: Field, b: Builder, scope: Scope, rootAlias: string): string {
  const table = lookupTable(scope, node.source)
  const resolved = resolveFieldPath(b.registry, table, node.path)
  if (resolved === undefined) {
    throw new Error(`解決できない参照: ${table}.${node.path.join('.')}`)
  }

  const alias = sqlAlias(node.source, rootAlias)
  const [first, ...rest] = node.path
  if (first === undefined) throw new Error('field の path が空')

  // 自テーブルの列
  if (rest.length === 0) return `${q(b, alias)}.${q(b, toColumnName(first))}`

  // リレーションを辿る。JOIN リストを外に持たずに済むよう、
  // 経路ぶんの JOIN を1つのスカラーサブクエリに閉じ込める。
  // resolved.tables = [起点テーブル, 1段目, 2段目, ...]
  const hops = resolved.tables.slice(1)
  const joinAliases = hops.map(() => `_j${b.joinCount++}`)

  const froms: string[] = []
  hops.forEach((hopTable, i) => {
    const hopAlias = joinAliases[i] as string
    if (i === 0) {
      froms.push(`${q(b, hopTable)} ${q(b, hopAlias)}`)
    } else {
      const prevAlias = joinAliases[i - 1] as string
      const fk = toColumnName(node.path[i] as string)
      froms.push(
        `JOIN ${q(b, hopTable)} ${q(b, hopAlias)}` +
          ` ON ${q(b, hopAlias)}.${q(b, 'id')} = ${q(b, prevAlias)}.${q(b, fk)}` +
          ` AND ${temporal(b, hopAlias)}`,
      )
    }
  })

  const lastAlias = joinAliases[joinAliases.length - 1] as string
  const firstAlias = joinAliases[0] as string
  const lastColumn = toColumnName(node.path[node.path.length - 1] as string)

  return (
    `(SELECT ${q(b, lastAlias)}.${q(b, lastColumn)} FROM ${froms.join(' ')}` +
    ` WHERE ${q(b, firstAlias)}.${q(b, 'id')} = ${q(b, alias)}.${q(b, toColumnName(first))}` +
    ` AND ${temporal(b, firstAlias)})`
  )
}

function aggregate_(node: Aggregate, b: Builder, scope: Scope, rootAlias: string): string {
  const inner: Scope = { ...scope, [node.alias]: node.table }
  const fn = AGGREGATE_SQL[node.fn]
  if (fn === undefined) throw new Error(`未知の集計関数: ${node.fn}`)

  const target =
    node.fn === 'count'
      ? '*'
      : field_({ type: 'field', source: node.alias, path: node.field ?? [] }, b, inner, rootAlias)

  const conditions = [temporal(b, node.alias)]
  if (node.where !== undefined) conditions.unshift(pred_(node.where, b, inner, rootAlias))

  return (
    `(SELECT ${fn}(${target}) FROM ${q(b, node.table)} ${q(b, node.alias)}` +
    ` WHERE ${conditions.join(' AND ')})`
  )
}

// ---------------------------------------------------------------------------
// Pred
// ---------------------------------------------------------------------------

function pred_(node: Pred, b: Builder, scope: Scope, rootAlias: string): string {
  switch (node.type) {
    case 'compare': {
      const op = COMPARE_SQL[node.op]
      if (op === undefined) throw new Error(`未知の演算子: ${node.op}`)
      return `${expr_(node.left, b, scope, rootAlias)} ${op} ${expr_(node.right, b, scope, rootAlias)}`
    }
    case 'in': {
      const values = node.values.map((v) => param(b, v)).join(', ')
      return `${expr_(node.left, b, scope, rootAlias)} IN (${values})`
    }
    case 'isNull':
      return `${expr_(node.operand, b, scope, rootAlias)} IS NULL`
    case 'isNotNull':
      return `${expr_(node.operand, b, scope, rootAlias)} IS NOT NULL`
    case 'and':
      return `(${node.operands.map((o) => pred_(o, b, scope, rootAlias)).join(' AND ')})`
    case 'or':
      return `(${node.operands.map((o) => pred_(o, b, scope, rootAlias)).join(' OR ')})`
    case 'not':
      return `NOT (${pred_(node.operand, b, scope, rootAlias)})`
    case 'exists': {
      const inner: Scope = { ...scope, [node.alias]: node.table }
      const where = pred_(node.where, b, inner, rootAlias)
      return (
        `EXISTS (SELECT 1 FROM ${q(b, node.table)} ${q(b, node.alias)}` +
        ` WHERE ${where} AND ${temporal(b, node.alias)})`
      )
    }
  }
}
