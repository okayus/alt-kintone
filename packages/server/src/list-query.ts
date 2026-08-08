/**
 * 一覧の絞り込みと並び。docs/impl/phase-6-list-grid.md 論点B・C
 *
 * **クエリパラメータ → 条件式 AST** に落とすだけの純関数。SQL は組まない。
 * フィルタの表現力が条件式 AST のサブセットになるので、SQL 変換・方言・適合テストの
 * 資産をそのまま使える（フィルタ専用の SQL 生成を作らない、が論点C の要点）。
 *
 * 条件式 AST を丸ごと URL に載せる案は採らない — 読めないし、共有時に壊しやすいし、
 * 検証面積がフィールドの型の数ではなくノードの数になる。**フィールド毎のパラメータ**にする。
 *
 * 未知のパラメータ・型に合わない値は 400 + 直し方のヒント（`alt validate` と同じ流儀）。
 * URL を手で書くのも AI が組み立てるのも、読んで直せることが前提。
 */
import { badRequest } from './api.js'
import { PRINCIPAL_TABLE } from './authz.js'
import {
  ROOT_SOURCE,
  type FieldDef,
  type Field,
  type FlowDef,
  type Pred,
  type TableDef,
} from '@alt/dsl'
import { STEP_COLUMN, type SortSpec } from '@alt/sql'

/**
 * 一覧以外の意味を持つクエリパラメータ。ここに無いキーはフィルタとして解釈する。
 *
 * ⚠ `context.ts` が読むパラメータと**同じ集合**でなければならない。片方だけ増やすと、
 * 増やしたほうが「未知のパラメータ」として 400 になるか、黙って無視されるかのどちらかになる。
 */
export const RESERVED_QUERY_KEYS: readonly string[] = [
  'flow',
  'as_of',
  'snapshot',
  'limit',
  'offset',
  'sort',
  'step',
]

/** 比較演算子を表す接尾辞。値の区切りに使えない文字（`_`）で始める。 */
const SUFFIXES = {
  _gte: 'gte',
  _lte: 'lte',
} as const

const LIKE_SUFFIX = '_like'

/** レンジ比較ができる型。text / enum / uuid / boolean / json は対象外。 */
const ORDERED_TYPES: readonly FieldDef['type'][] = ['integer', 'date', 'datetime', 'yearMonth']

/** ログインユーザー自身を指す糖衣（決定C）。展開せず context ノードにする。 */
const ME = 'me'

export interface ListSelection {
  /** 並び順。省略時は既定（更新が新しい順）。 */
  sort?: SortSpec
  /** 現在ステップの絞り込み。 */
  steps?: readonly string[]
  /** フィルタ。複数のパラメータは and で束ねる。 */
  where?: Pred
}

export interface ListQueryContext {
  table: TableDef
  flow: FlowDef
  /** このテーブルがフローの target か。false ならステップの絞り込み・並びは使えない。 */
  isTarget: boolean
}

/**
 * クエリパラメータ → 絞り込みと並び。
 *
 * キーは**ソートしてから**処理する。SQL に積むパラメータの順序が
 * リクエストのキー順に依存しないほうが、テストもキャッシュも素直になる。
 */
export function parseListSelection(
  query: Record<string, string>,
  ctx: ListQueryContext,
): ListSelection {
  const selection: ListSelection = {}

  const sort = parseSort(query['sort'], ctx)
  if (sort !== undefined) selection.sort = sort

  const steps = parseSteps(query['step'], ctx)
  if (steps !== undefined) selection.steps = steps

  const operands: Pred[] = []
  for (const key of Object.keys(query).sort()) {
    if (RESERVED_QUERY_KEYS.includes(key)) continue
    const raw = query[key]
    if (raw === undefined || raw === '') continue
    operands.push(parseFilter(key, raw, ctx))
  }

  if (operands.length === 1) selection.where = operands[0] as Pred
  else if (operands.length > 1) selection.where = { type: 'and', operands }

  return selection
}

// ---------------------------------------------------------------------------
// sort
// ---------------------------------------------------------------------------

function parseSort(raw: string | undefined, ctx: ListQueryContext): SortSpec | undefined {
  if (raw === undefined || raw === '') return undefined

  const [key = '', direction = 'asc', ...rest] = raw.split(':')
  if (rest.length > 0 || (direction !== 'asc' && direction !== 'desc')) {
    throw badRequest(
      `sort の形が違う: ${raw}`,
      `"<フィールド>:asc" か "<フィールド>:desc" の形で渡す（例: expectedCloseMonth:desc）`,
    )
  }

  if (key === STEP_COLUMN) {
    if (!ctx.isTarget) {
      throw badRequest(
        `"${ctx.table.name}" は業務フロー "${ctx.flow.key}" の target ではないので ${STEP_COLUMN} で並べられない`,
        `現在ステップを持つのは ${ctx.flow.target} のレコード`,
      )
    }
    return { key, direction }
  }

  const field = ctx.table.fields[key]
  if (field === undefined || field.type === 'json') {
    throw badRequest(
      `sort に使えないフィールド: ${key}`,
      `使えるのは ${sortableKeys(ctx).join(', ')}`,
    )
  }
  return { key, direction }
}

function sortableKeys(ctx: ListQueryContext): string[] {
  const fields = Object.entries(ctx.table.fields)
    .filter(([, field]) => field.type !== 'json')
    .map(([name]) => name)
  return ctx.isTarget ? [...fields, STEP_COLUMN] : fields
}

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

function parseSteps(raw: string | undefined, ctx: ListQueryContext): readonly string[] | undefined {
  if (raw === undefined || raw === '') return undefined
  if (!ctx.isTarget) {
    throw badRequest(
      `"${ctx.table.name}" は業務フロー "${ctx.flow.key}" の target ではないので step で絞れない`,
      `ステップを持つのは ${ctx.flow.target} のレコード`,
    )
  }

  const known = ctx.flow.steps.map((step) => step.key)
  const keys = raw.split(',').map((value) => value.trim())
  for (const key of keys) {
    if (!known.includes(key)) {
      throw badRequest(
        `業務フロー "${ctx.flow.key}" に step "${key}" は無い`,
        `使えるのは ${known.join(', ')}`,
      )
    }
  }
  return keys
}

// ---------------------------------------------------------------------------
// フィルタ
// ---------------------------------------------------------------------------

function parseFilter(key: string, raw: string, ctx: ListQueryContext): Pred {
  const like = key.endsWith(LIKE_SUFFIX)
  const suffix = (Object.keys(SUFFIXES) as Array<keyof typeof SUFFIXES>).find((s) =>
    key.endsWith(s),
  )
  const name = like
    ? key.slice(0, -LIKE_SUFFIX.length)
    : suffix === undefined
      ? key
      : key.slice(0, -suffix.length)

  const field = ctx.table.fields[name]
  if (field === undefined) {
    throw badRequest(
      `フィルタに使えないパラメータ: ${key}`,
      `フィルタは "<フィールド>"（候補をカンマ区切り）/ "<フィールド>_gte" / "<フィールド>_lte" / "<フィールド>_like" の形。` +
        `このテーブルのフィールド: ${Object.keys(ctx.table.fields).join(', ')}`,
    )
  }

  const operand: Field = { type: 'field', source: ROOT_SOURCE, path: [name] }

  if (like) {
    if (field.type !== 'text') {
      throw badRequest(
        `${name} は ${field.type} なので ${LIKE_SUFFIX} で絞れない`,
        `部分一致は text のフィールドだけ。完全一致なら "${name}=" を使う`,
      )
    }
    return { type: 'contains', operand, value: raw }
  }

  if (suffix !== undefined) {
    if (!ORDERED_TYPES.includes(field.type)) {
      throw badRequest(
        `${name} は ${field.type} なので ${suffix} で絞れない`,
        `レンジ指定ができるのは ${ORDERED_TYPES.join(' / ')}。候補で絞るなら "${name}=" を使う`,
      )
    }
    return {
      type: 'compare',
      op: SUFFIXES[suffix],
      left: operand,
      right: { type: 'literal', value: coerce(name, field, raw) },
    }
  }

  return inFilter(name, field, raw, operand)
}

/**
 * 候補の列挙（カンマ区切り）。`me` が混ざっていたら or で束ねる。
 *
 * `me` を `currentUser.id` のリテラルに置換しないのは、**URL を共有したときに
 * 「自分の案件」が読み手にとっての自分になる**ほうが語の意味に合うため（決定C）。
 */
function inFilter(name: string, field: FieldDef, raw: string, operand: Field): Pred {
  if (field.type === 'json') {
    throw badRequest(`${name} は json なので絞り込みに使えない`)
  }

  const parts = raw.split(',').map((value) => value.trim())
  const isMe = (value: string) => value === ME && field.references === PRINCIPAL_TABLE
  const values = parts.filter((value) => !isMe(value)).map((value) => coerce(name, field, value))
  const hasMe = parts.some(isMe)

  const me: Pred = {
    type: 'compare',
    op: 'eq',
    left: operand,
    right: { type: 'context', name: 'currentUser.id' },
  }
  if (values.length === 0) {
    if (!hasMe) throw badRequest(`${name} の値が空`)
    return me
  }

  const inPred: Pred = { type: 'in', left: operand, values }
  return hasMe ? { type: 'or', operands: [inPred, me] } : inPred
}

/** 文字列 → フィールドの型に合った値。合わなければ 400。 */
function coerce(name: string, field: FieldDef, raw: string): string | number | boolean {
  switch (field.type) {
    case 'integer': {
      const value = Number(raw)
      if (!Number.isInteger(value)) throw invalid(name, field, raw, '整数で渡す（例: 50000）')
      return value
    }
    case 'boolean': {
      if (raw === 'true') return true
      if (raw === 'false') return false
      throw invalid(name, field, raw, 'true か false で渡す')
    }
    case 'enum': {
      const keys = (field.values ?? []).map((value) => value.key)
      if (!keys.includes(raw)) throw invalid(name, field, raw, `候補は ${keys.join(', ')}`)
      return raw
    }
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw invalid(name, field, raw, 'YYYY-MM-DD で渡す')
      return raw
    case 'yearMonth':
      if (!/^\d{4}-\d{2}$/.test(raw)) throw invalid(name, field, raw, 'YYYY-MM で渡す')
      return raw
    case 'datetime':
      if (Number.isNaN(Date.parse(raw))) {
        throw invalid(name, field, raw, 'ISO 8601 で渡す（例: 2026-07-31T23:59:59.999Z）')
      }
      return raw
    default:
      return raw
  }
}

function invalid(name: string, field: FieldDef, raw: string, hint: string) {
  return badRequest(`${name}（${field.label}・${field.type}）の値として読めない: ${raw}`, hint)
}
