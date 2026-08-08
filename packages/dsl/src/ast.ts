/**
 * 条件式 AST。仕様は docs/condition-ast.md。
 *
 * この AST は **TypeScript と Go の契約**であり、出口条件の自動判定と
 * 行レベル認可の rowFilter の両方で使う。どちらも最終的に SQL の述語になる。
 *
 * 設計上の制約（docs/condition-ast.md §1）:
 *  1. SQL に変換できる範囲に限る（一覧で数百件を一括評価するため）
 *  2. AST は完全に明示的。暗黙結合などの糖衣は TS のビルダー側で展開する
 *  3. 式（値）と述語（真偽）を型で分ける
 *
 * 型を手書きし zod スキーマに注釈を付けているのは、Expr と Pred が
 * 相互再帰していて z.infer では表現しきれないため。
 */
import { z } from 'zod'

/**
 * AST のスキーマバージョン。
 *
 * TS 側と Go 側の契約が食い違うと静かに壊れるため、ノードの追加・変更時に
 * この値を上げ、受け取った定義のバージョンを検証できるようにする。
 */
export const AST_VERSION = 2

// ---------------------------------------------------------------------------
// Expr — 値を返す
// ---------------------------------------------------------------------------

/**
 * リテラル値。
 *
 * `null` を含むのは意図的。SQL の三値論理を素直に扱うため、値の不在は
 * 専用ノードではなくリテラルとして表現する。
 */
export interface Literal {
  type: 'literal'
  value: string | number | boolean | null
}

/**
 * フィールド参照。
 *
 * `source` は `'root'`（評価対象のレコード）かサブクエリのエイリアス。
 * `path` は長さ1なら自テーブルの列、2以上ならリレーションを辿る。
 *
 * path に書くのは**外部キーのフィールド名そのもの**（`['contactId', 'isDecisionMaker']`）。
 * DSL では `a.contact.isDecisionMaker` と書けるが、ビルダーが `contactId` に
 * 展開してから AST にする。リレーション名を AST に持たせると `Id` を落として
 * 読む暗黙ルールを Go 側にも実装させることになり、方針2 に反する。
 */
export interface Field {
  type: 'field'
  source: string
  path: string[]
}

/** 評価対象のレコードを指す `source`。 */
export const ROOT_SOURCE = 'root'

/**
 * 実行時に決まる値。SQL 関数に変換せず**パラメータとしてバインドする**
 * （docs/condition-ast.md §5-2）。方言差が消え、テストも決定的になる。
 */
export const CONTEXT_NAMES = ['currentUser.id', 'today', 'now'] as const
export type ContextName = (typeof CONTEXT_NAMES)[number]

export interface Context {
  type: 'context'
  name: ContextName
}

export const AGGREGATE_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const
export type AggregateFn = (typeof AGGREGATE_FNS)[number]

/**
 * 集計（表現力レベル3）。SQL では相関サブクエリになる。
 *
 * `field` は `count` 以外で必須。`count` は行数を数えるだけなので列を取らない。
 */
export interface Aggregate {
  type: 'aggregate'
  fn: AggregateFn
  table: string
  alias: string
  field?: string[]
  where?: Pred
}

export type Expr = Literal | Field | Context | Aggregate

// ---------------------------------------------------------------------------
// Pred — 真偽を返す
// ---------------------------------------------------------------------------

export const COMPARE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const
export type CompareOp = (typeof COMPARE_OPS)[number]

export interface Compare {
  type: 'compare'
  op: CompareOp
  left: Expr
  right: Expr
}

export interface In {
  type: 'in'
  left: Expr
  values: (string | number | boolean)[]
}

/**
 * 部分一致（AST_VERSION 2 で追加。docs/impl/phase-6-list-grid.md 決定B）。
 *
 * **`like` ではなく `contains`。** `value` は探す文字列そのものであって
 * パターンではない — `%` や `_` を書いてもワイルドカードにならない。パターン言語を
 * TS と Go の契約に持ち込むと、エスケープ規則と方言差を両方の実装に配ることになる。
 * SQL の `LIKE` パターンへの変換とエスケープは**コンパイラの責務**。
 *
 * ⚠ **大文字小文字の扱いは方言差**（SQLite は ASCII だけ大小同一視、PostgreSQL は区別）。
 * 日本語では差が出ないので v1 は揃えない（docs/condition-ast.md §5-5）。
 */
export interface Contains {
  type: 'contains'
  operand: Expr
  value: string
}

export interface IsNull {
  type: 'isNull'
  operand: Expr
}

export interface IsNotNull {
  type: 'isNotNull'
  operand: Expr
}

export interface And {
  type: 'and'
  operands: Pred[]
}

export interface Or {
  type: 'or'
  operands: Pred[]
}

export interface Not {
  type: 'not'
  operand: Pred
}

/**
 * 存在チェック。`count(...) > 0` でも表現できるが、SQL では EXISTS のほうが
 * 効率的なので独立ノードにしている。
 *
 * `where` にはルートとの結合条件も**明示的に**含まれる。ビルダーが暗黙結合を
 * 展開してから AST を組み立てるため、Go 側は結合ルールを知らなくてよい。
 */
export interface Exists {
  type: 'exists'
  table: string
  alias: string
  where: Pred
}

export type Pred = Compare | In | Contains | IsNull | IsNotNull | And | Or | Not | Exists

// ---------------------------------------------------------------------------
// 参照フィールドの抽出（表示用）
// ---------------------------------------------------------------------------

/** 述語が参照しているフィールド1つ。 */
export interface FieldRef {
  /**
   * どのテーブルのフィールドか。`exists` / `aggregate` の中のフィールドは
   * エイリアスではなく**テーブル名**に解決して返す（エイリアスは表示に使えない）。
   * `ROOT_SOURCE` だけはこの関数では解決できないので、呼び手がフローの target に読み替える。
   */
  source: string
  path: readonly string[]
}

/**
 * 述語が参照しているフィールドを、出現順・重複なしで列挙する。
 *
 * **表示のためだけの道具。** 「この条件が見ているデータ」をフロー参照画面に併記し、
 * 手書きの `howTo` が条件式とズレたときに目視で分かるようにする
 * （docs/impl/phase-5-flow-reference.md 決定D）。
 *
 * TS と Go の契約は AST そのもの（docs/condition-ast.md）であって、この関数は
 * 契約に含まれない — **Go 版に移植する必要は無い**。
 */
export function referencedFields(pred: Pred): FieldRef[] {
  const seen = new Set<string>()
  const found: FieldRef[] = []

  // エイリアス → テーブル名。exists / aggregate の入れ子で内側が外側を隠す（shadowing）
  // のもオブジェクトのスプレッドがそのまま表現する
  const emit = (node: Field, scope: Record<string, string>): void => {
    const source = node.source === ROOT_SOURCE ? ROOT_SOURCE : (scope[node.source] ?? node.source)
    const key = JSON.stringify([source, ...node.path])
    if (seen.has(key)) return
    seen.add(key)
    found.push({ source, path: node.path })
  }

  const walkExpr = (node: Expr, scope: Record<string, string>): void => {
    switch (node.type) {
      case 'literal':
      case 'context':
        return
      case 'field':
        emit(node, scope)
        return
      case 'aggregate': {
        const inner = { ...scope, [node.alias]: node.table }
        if (node.field !== undefined) {
          emit({ type: 'field', source: node.alias, path: node.field }, inner)
        }
        if (node.where !== undefined) walk(node.where, inner)
        return
      }
    }
  }

  const walk = (node: Pred, scope: Record<string, string>): void => {
    switch (node.type) {
      case 'compare':
        walkExpr(node.left, scope)
        walkExpr(node.right, scope)
        return
      case 'in':
        walkExpr(node.left, scope)
        return
      case 'contains':
      case 'isNull':
      case 'isNotNull':
        walkExpr(node.operand, scope)
        return
      case 'and':
      case 'or':
        for (const operand of node.operands) walk(operand, scope)
        return
      case 'not':
        walk(node.operand, scope)
        return
      case 'exists':
        walk(node.where, { ...scope, [node.alias]: node.table })
        return
    }
  }

  walk(pred, {})
  return found
}

// ---------------------------------------------------------------------------
// zod スキーマ
// ---------------------------------------------------------------------------

const identifier = z.string().min(1)
const fieldPath = z.array(identifier).min(1)
const scalar = z.union([z.string(), z.number(), z.boolean()])

export const literalSchema: z.ZodType<Literal> = z.object({
  type: z.literal('literal'),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
})

export const fieldSchema: z.ZodType<Field> = z.object({
  type: z.literal('field'),
  source: identifier,
  path: fieldPath,
})

export const contextSchema: z.ZodType<Context> = z.object({
  type: z.literal('context'),
  name: z.enum(CONTEXT_NAMES),
})

export const aggregateSchema: z.ZodType<Aggregate> = z.lazy(() =>
  z
    .object({
      type: z.literal('aggregate'),
      fn: z.enum(AGGREGATE_FNS),
      table: identifier,
      alias: identifier,
      field: fieldPath.optional(),
      where: predSchema.optional(),
    })
    .refine((node) => node.fn === 'count' || node.field !== undefined, {
      message: 'count 以外の集計には field が必要',
      path: ['field'],
    }),
)

export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([literalSchema, fieldSchema, contextSchema, aggregateSchema]),
)

export const compareSchema: z.ZodType<Compare> = z.lazy(() =>
  z.object({
    type: z.literal('compare'),
    op: z.enum(COMPARE_OPS),
    left: exprSchema,
    right: exprSchema,
  }),
)

export const inSchema: z.ZodType<In> = z.lazy(() =>
  z.object({
    type: z.literal('in'),
    left: exprSchema,
    values: z.array(scalar).min(1),
  }),
)

export const containsSchema: z.ZodType<Contains> = z.lazy(() =>
  // 空文字は「全件一致」になり条件として意味が無いので構文層で弾く
  z.object({ type: z.literal('contains'), operand: exprSchema, value: z.string().min(1) }),
)

export const isNullSchema: z.ZodType<IsNull> = z.lazy(() =>
  z.object({ type: z.literal('isNull'), operand: exprSchema }),
)

export const isNotNullSchema: z.ZodType<IsNotNull> = z.lazy(() =>
  z.object({ type: z.literal('isNotNull'), operand: exprSchema }),
)

export const andSchema: z.ZodType<And> = z.lazy(() =>
  z.object({ type: z.literal('and'), operands: z.array(predSchema).min(1) }),
)

export const orSchema: z.ZodType<Or> = z.lazy(() =>
  z.object({ type: z.literal('or'), operands: z.array(predSchema).min(1) }),
)

export const notSchema: z.ZodType<Not> = z.lazy(() =>
  z.object({ type: z.literal('not'), operand: predSchema }),
)

export const existsSchema: z.ZodType<Exists> = z.lazy(() =>
  z.object({
    type: z.literal('exists'),
    table: identifier,
    alias: identifier,
    where: predSchema,
  }),
)

export const predSchema: z.ZodType<Pred> = z.lazy(() =>
  z.union([
    compareSchema,
    inSchema,
    containsSchema,
    isNullSchema,
    isNotNullSchema,
    andSchema,
    orSchema,
    notSchema,
    existsSchema,
  ]),
)
