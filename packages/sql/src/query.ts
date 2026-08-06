/**
 * 有効期間型テーブルの読み書き SQL。docs/impl/phase-3-backend.md 3-0
 *
 * バックエンドが投げる SQL の組み立ては**全部ここに置く**。方言に触るもの
 * （識別子のクォート・プレースホルダ・値の表現）を1箇所にまとめておかないと、
 * ローカル SQLite → 本番 PostgreSQL の差し替えがサーバ全体に散る
 * （docs/product-concept.md §8-2 論点1）。Go に移すのもこの層。
 *
 * すべて `{ sql, params }` を返す純関数。DB は触らない。
 * **params は SQL に現れる順に積む**（`?` は位置で対応するため、組み立ての順序が意味を持つ）。
 */
import { type FieldDef, type Pred, type Registry, type TableDef, toColumnName } from '@alt/dsl'
import { compilePred, type ContextValues, type SqlFragment } from './compile.js'
import { FLOW_STATE_TABLE, MANUAL_CHECK_TABLE, TEMPORAL_COLUMNS } from './ddl.js'
import { type Dialect, sqlite } from './dialect.js'

/** 一覧の既定件数と上限（docs/impl/phase-3-backend.md 決定J）。 */
export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500

/** 現在ステップを載せる列の別名。業務テーブルの列と衝突しないよう `_` 始まり。 */
export const STEP_COLUMN = '_step'
export const STEP_SINCE_COLUMN = '_step_since'
export const UNMET_COLUMN = '_step_unmet'

// ---------------------------------------------------------------------------
// 組み立ての土台
// ---------------------------------------------------------------------------

interface Acc {
  readonly dialect: Dialect
  readonly params: unknown[]
}

function acc(dialect: Dialect): Acc {
  return { dialect, params: [] }
}

function bind(a: Acc, value: unknown): string {
  a.params.push(a.dialect.bindValue(value))
  return a.dialect.placeholder(a.params.length - 1)
}

function q(a: Acc, identifier: string): string {
  return a.dialect.quote(identifier)
}

function col(a: Acc, alias: string, column: string): string {
  return `${q(a, alias)}.${q(a, column)}`
}

/**
 * 指定時点で有効な行に絞る条件。省略時は現在行（`valid_to IS NULL`）。
 *
 * 半開区間 `[valid_from, valid_to)` で判定するので、更新で「閉じた時刻」と
 * 「開いた時刻」が同じ値でも、どの時点にも行がちょうど1つになる。
 *
 * ※ compile.ts が同じ条件を内部に持っているのは、あちらが AST の再帰の途中で
 *    パラメータを積むため。式が同じなので、片方を直したらもう片方も直すこと。
 */
function temporalCondition(a: Acc, alias: string, asOf: string | undefined): string {
  const validFrom = col(a, alias, 'valid_from')
  const validTo = col(a, alias, 'valid_to')
  if (asOf === undefined) return `${validTo} IS NULL`
  return `(${validFrom} <= ${bind(a, asOf)} AND (${validTo} > ${bind(a, asOf)} OR ${validTo} IS NULL))`
}

// ---------------------------------------------------------------------------
// 値の変換
// ---------------------------------------------------------------------------

/**
 * 定義の値 → DB に入れる値。
 *
 * boolean は SQLite に真偽型が無いので 0/1（方言が吸収する）、json は文字列化。
 * それ以外（uuid / text / date / datetime / yearMonth / enum / integer）は素通し。
 */
export function encodeValue(field: FieldDef, value: unknown, dialect: Dialect = sqlite): unknown {
  if (value === null || value === undefined) return null
  if (field.type === 'json') return JSON.stringify(value)
  return dialect.bindValue(value)
}

/** DB から出た値 → 定義の値。`encodeValue` の逆。 */
export function decodeValue(field: FieldDef, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null
  if (field.type === 'boolean') return raw === 1 || raw === true
  if (field.type === 'json') return typeof raw === 'string' ? JSON.parse(raw) : raw
  return raw
}

// ---------------------------------------------------------------------------
// 一覧・詳細
// ---------------------------------------------------------------------------

/** SELECT 句に埋める述語。出口条件の一括評価と行レベル認可の両方がこれを使う。 */
export interface SelectExpression {
  /** 結果の列名。呼び出し側が値を取り出すときのキー。 */
  alias: string
  pred: Pred
}

export interface SelectRecordsOptions {
  registry: Registry
  table: TableDef
  /** ルートテーブルのエイリアス。条件式の `source: 'root'` はここを指す。 */
  alias?: string
  /** 指定すると `_flow_state` を LEFT JOIN して現在ステップを載せる。 */
  flow?: string
  /** 出口条件・rowFilter など、行ごとに評価する述語。 */
  expressions?: readonly SelectExpression[]
  /** 条件式のコンテキスト（`currentUser.id` など）。 */
  values: ContextValues
  asOf?: string
  /** 1件に絞る。 */
  id?: string
  limit?: number
  dialect?: Dialect
}

/**
 * 一覧・詳細の SELECT（docs/impl/phase-3-backend.md 3-4）。
 *
 * **出口条件は相関サブクエリとして SELECT 句に埋め、1クエリで全件ぶん評価する**
 * （docs/condition-ast.md §5-1）。レコードごとにコードを実行しない、が構想の
 * 「条件式は SQL に変換できる範囲に限る」の実利。
 */
export function selectRecords(options: SelectRecordsOptions): SqlFragment {
  const dialect = options.dialect ?? sqlite
  const a = acc(dialect)
  const alias = options.alias ?? 'r'
  const asOf = options.asOf

  const columns = [
    ...Object.keys(options.table.fields).map((name) => col(a, alias, toColumnName(name))),
    ...TEMPORAL_COLUMNS.map((name) => col(a, alias, name)),
  ]

  // 述語は SELECT 句の中ほど。ここで積むパラメータが JOIN / WHERE より先に来る
  for (const expression of options.expressions ?? []) {
    const compiled = compilePred(expression.pred, {
      registry: options.registry,
      rootTable: options.table.name,
      rootAlias: alias,
      values: options.values,
      asOf,
      dialect,
    })
    a.params.push(...compiled.params)
    columns.push(`(${compiled.sql}) AS ${q(a, expression.alias)}`)
  }

  const from = [`FROM ${q(a, options.table.name)} ${q(a, alias)}`]

  if (options.flow !== undefined) {
    const fs = 'fs'
    columns.push(
      `${col(a, fs, 'step')} AS ${q(a, STEP_COLUMN)}`,
      `${col(a, fs, 'valid_from')} AS ${q(a, STEP_SINCE_COLUMN)}`,
      `${col(a, fs, 'unmet_checks')} AS ${q(a, UNMET_COLUMN)}`,
    )
    // LEFT JOIN なのは、フローに乗っていないレコードも一覧に出すため
    from.push(
      `LEFT JOIN ${q(a, FLOW_STATE_TABLE)} ${q(a, fs)}` +
        ` ON ${col(a, fs, 'table_name')} = ${bind(a, options.table.name)}` +
        ` AND ${col(a, fs, 'record_id')} = ${col(a, alias, 'id')}` +
        ` AND ${col(a, fs, 'flow')} = ${bind(a, options.flow)}` +
        ` AND ${temporalCondition(a, fs, asOf)}`,
    )
  }

  const where = [temporalCondition(a, alias, asOf)]
  if (options.id !== undefined) where.push(`${col(a, alias, 'id')} = ${bind(a, options.id)}`)

  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const sql =
    `SELECT ${columns.join(', ')}` +
    ` ${from.join(' ')}` +
    ` WHERE ${where.join(' AND ')}` +
    ` ORDER BY ${col(a, alias, 'valid_from')} DESC, ${col(a, alias, 'id')}` +
    ` LIMIT ${bind(a, limit)}`

  return { sql, params: a.params }
}

// ---------------------------------------------------------------------------
// 書き込み（有効期間型）
// ---------------------------------------------------------------------------

/** 変更の文脈（docs/product-concept.md §4-1）。業務フローが第一級だから取れる情報。 */
export interface ChangeContext {
  changedBy: string | null
  changedFlow: string | null
  changedStep: string | null
}

export interface InsertRecordOptions {
  table: TableDef
  /** フィールド名（camelCase）→ 値。定義に無いキーは無視する。 */
  values: Record<string, unknown>
  /** この書き込みの時刻。1リクエスト内では同じ値を使い回す。 */
  now: string
  context: ChangeContext
  dialect?: Dialect
}

/** 新しいバージョンを1行積む。作成も更新（閉じたあと）も同じ形。 */
export function insertRecord(options: InsertRecordOptions): SqlFragment {
  const a = acc(options.dialect ?? sqlite)
  const columns: string[] = []
  const placeholders: string[] = []

  for (const [name, field] of Object.entries(options.table.fields)) {
    columns.push(q(a, toColumnName(name)))
    placeholders.push(bind(a, encodeValue(field, options.values[name], a.dialect)))
  }

  const temporal: Record<string, unknown> = {
    valid_from: options.now,
    valid_to: null,
    changed_by: options.context.changedBy,
    changed_flow: options.context.changedFlow,
    changed_step: options.context.changedStep,
  }
  for (const name of TEMPORAL_COLUMNS) {
    columns.push(q(a, name))
    placeholders.push(bind(a, temporal[name] ?? null))
  }

  return {
    sql:
      `INSERT INTO ${q(a, options.table.name)} (${columns.join(', ')})` +
      ` VALUES (${placeholders.join(', ')})`,
    params: a.params,
  }
}

/**
 * 現在行を閉じる。**更新は UPDATE ではなく「閉じて INSERT」**（§4-1）。
 *
 * 影響行数が1でなければ、他のリクエストが先に閉じている（＝競合）。
 * 呼び出し側はそれを見て 409 にする。
 */
export function closeCurrentRow(options: {
  table: string
  id: string
  now: string
  dialect?: Dialect
}): SqlFragment {
  const a = acc(options.dialect ?? sqlite)
  return {
    sql:
      `UPDATE ${q(a, options.table)} SET ${q(a, 'valid_to')} = ${bind(a, options.now)}` +
      ` WHERE ${q(a, 'id')} = ${bind(a, options.id)} AND ${q(a, 'valid_to')} IS NULL`,
    params: a.params,
  }
}

// ---------------------------------------------------------------------------
// _flow_state
// ---------------------------------------------------------------------------

export interface FlowStateKey {
  table: string
  recordId: string
  flow: string
}

/** 現在ステップ（`as_of` を渡せばその時点のステップ）。 */
export function selectFlowState(options: FlowStateKey & { asOf?: string; dialect?: Dialect }) {
  const a = acc(options.dialect ?? sqlite)
  const alias = 'fs'
  return {
    sql:
      `SELECT ${col(a, alias, 'step')}, ${col(a, alias, 'valid_from')},` +
      ` ${col(a, alias, 'unmet_checks')}` +
      ` FROM ${q(a, FLOW_STATE_TABLE)} ${q(a, alias)}` +
      ` WHERE ${col(a, alias, 'table_name')} = ${bind(a, options.table)}` +
      ` AND ${col(a, alias, 'record_id')} = ${bind(a, options.recordId)}` +
      ` AND ${col(a, alias, 'flow')} = ${bind(a, options.flow)}` +
      ` AND ${temporalCondition(a, alias, options.asOf)}`,
    params: a.params,
  }
}

export function closeFlowState(
  options: FlowStateKey & { now: string; dialect?: Dialect },
): SqlFragment {
  const a = acc(options.dialect ?? sqlite)
  return {
    sql:
      `UPDATE ${q(a, FLOW_STATE_TABLE)} SET ${q(a, 'valid_to')} = ${bind(a, options.now)}` +
      ` WHERE ${q(a, 'table_name')} = ${bind(a, options.table)}` +
      ` AND ${q(a, 'record_id')} = ${bind(a, options.recordId)}` +
      ` AND ${q(a, 'flow')} = ${bind(a, options.flow)}` +
      ` AND ${q(a, 'valid_to')} IS NULL`,
    params: a.params,
  }
}

export interface InsertFlowStateOptions extends FlowStateKey {
  step: string
  /** 直前ステップの未充足キー（docs/product-concept.md §4-3）。無ければ null。 */
  unmetChecks: readonly string[] | null
  now: string
  context: ChangeContext
  dialect?: Dialect
}

export function insertFlowState(options: InsertFlowStateOptions): SqlFragment {
  const a = acc(options.dialect ?? sqlite)
  const values: Record<string, unknown> = {
    table_name: options.table,
    record_id: options.recordId,
    flow: options.flow,
    step: options.step,
    unmet_checks:
      options.unmetChecks === null || options.unmetChecks.length === 0
        ? null
        : JSON.stringify(options.unmetChecks),
    valid_from: options.now,
    valid_to: null,
    changed_by: options.context.changedBy,
    changed_flow: options.context.changedFlow,
    changed_step: options.context.changedStep,
  }

  const columns = Object.keys(values)
  return {
    sql:
      `INSERT INTO ${q(a, FLOW_STATE_TABLE)} (${columns.map((c) => q(a, c)).join(', ')})` +
      ` VALUES (${columns.map((c) => bind(a, values[c] ?? null)).join(', ')})`,
    params: a.params,
  }
}

// ---------------------------------------------------------------------------
// _manual_check
// ---------------------------------------------------------------------------

/**
 * 一覧ぶんの手動チェックをまとめて引く。**レコードごとに引かない**（N+1 を作らない）。
 *
 * `_manual_check` は有効期間型ではないので `as_of` の影響を受けない
 * （付け外しの履歴は分析に使わないと決めてある。docs/implementation.md 決定6）。
 */
export function selectManualChecks(options: {
  table: string
  recordIds: readonly string[]
  flow: string
  dialect?: Dialect
}): SqlFragment {
  const a = acc(options.dialect ?? sqlite)
  const ids = options.recordIds.map((id) => bind(a, id)).join(', ')
  return {
    sql:
      `SELECT ${q(a, 'record_id')}, ${q(a, 'step')}, ${q(a, 'check_key')}, ${q(a, 'checked')},` +
      ` ${q(a, 'checked_by')}, ${q(a, 'checked_at')}` +
      ` FROM ${q(a, MANUAL_CHECK_TABLE)}` +
      ` WHERE ${q(a, 'record_id')} IN (${ids})` +
      ` AND ${q(a, 'table_name')} = ${bind(a, options.table)}` +
      ` AND ${q(a, 'flow')} = ${bind(a, options.flow)}`,
    params: a.params,
  }
}

/**
 * 手動チェックの付け外し。`(table, record, flow, step, check_key)` のユニーク索引に
 * 乗せた UPSERT。ステップ込みのキーなので、差し戻してもそのステップのチェックは残る
 * （docs/product-concept.md §3-5）。
 */
export function upsertManualCheck(options: {
  table: string
  recordId: string
  flow: string
  step: string
  checkKey: string
  checked: boolean
  checkedBy: string | null
  checkedAt: string
  dialect?: Dialect
}): SqlFragment {
  const a = acc(options.dialect ?? sqlite)
  const values: Record<string, unknown> = {
    table_name: options.table,
    record_id: options.recordId,
    flow: options.flow,
    step: options.step,
    check_key: options.checkKey,
    checked: options.checked,
    checked_by: options.checkedBy,
    checked_at: options.checkedAt,
  }
  const columns = Object.keys(values)
  const conflict = ['table_name', 'record_id', 'flow', 'step', 'check_key']
  const updated = ['checked', 'checked_by', 'checked_at']

  return {
    sql:
      `INSERT INTO ${q(a, MANUAL_CHECK_TABLE)} (${columns.map((c) => q(a, c)).join(', ')})` +
      ` VALUES (${columns.map((c) => bind(a, values[c] ?? null)).join(', ')})` +
      ` ON CONFLICT (${conflict.map((c) => q(a, c)).join(', ')}) DO UPDATE SET ` +
      updated.map((c) => `${q(a, c)} = excluded.${q(a, c)}`).join(', '),
    params: a.params,
  }
}
