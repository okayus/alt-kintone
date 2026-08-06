import {
  boolean,
  datetime,
  enumOf,
  integer,
  reference,
  registry,
  table,
  text,
  uuid,
  yearMonth,
  type Pred,
} from '@alt/dsl'
import { describe, expect, it } from 'vitest'
import { compilePred, type ContextValues } from './compile.js'
import { postgres } from './dialect.js'

// docs/domain-model.md §5 のテーブルを一部抜き出したもの
const employee = table(
  'employee',
  { id: uuid('ID').primaryKey(), name: text('氏名').required() },
  { label: '従業員', global: true },
)
const company = table(
  'company',
  { id: uuid('ID').primaryKey(), name: text('名称').required() },
  { label: '顧客企業' },
)
const contact = table(
  'contact',
  {
    id: uuid('ID').primaryKey(),
    companyId: reference('company', '顧客企業').required(),
    isDecisionMaker: boolean('決裁権').required(),
  },
  { label: '先方担当者' },
)
const deal = table(
  'deal',
  {
    id: uuid('ID').primaryKey(),
    companyId: reference('company', '顧客企業').required(),
    initialBilling: integer('一時金・請求額').required(),
    monthlyBilling: integer('月額・請求額').required(),
    expectedCloseMonth: yearMonth('見込み受注月'),
    status: enumOf('状態', [
      { key: 'open', label: '進行中' },
      { key: 'suspended', label: '保留' },
      { key: 'won', label: '受注' },
      { key: 'lost', label: '失注' },
      { key: 'abandoned', label: '消滅' },
    ]).required(),
    ownerEmployeeId: reference('employee', '担当').required(),
  },
  { label: '案件' },
)
const activity = table(
  'activity',
  {
    id: uuid('ID').primaryKey(),
    dealId: reference('deal', '案件'),
    contactId: reference('contact', '先方担当者'),
    completedAt: datetime('実施日時'),
    scheduledAt: datetime('予定日時'),
  },
  { label: '活動' },
)

const reg = registry(employee, company, contact, deal, activity)

const values: ContextValues = {
  'currentUser.id': 'emp-1',
  today: '2026-08-05',
  now: '2026-08-05T09:00:00Z',
}

const compile = (pred: Pred, opts: Partial<Parameters<typeof compilePred>[1]> = {}) =>
  compilePred(pred, { registry: reg, rootTable: 'deal', rootAlias: 'd', values, ...opts })

const field = (path: string[], source = 'root') => ({ type: 'field', source, path }) as const
const lit = (value: string | number | boolean | null) => ({ type: 'literal', value }) as const

describe('リテラルと比較', () => {
  it('値は埋め込まずバインドする', () => {
    const r = compile({ type: 'compare', op: 'gt', left: field(['initialBilling']), right: lit(0) })
    expect(r.sql).toBe('"d"."initial_billing" > ?')
    expect(r.params).toEqual([0])
  })

  it('camelCase を snake_case の列名にする', () => {
    const r = compile({ type: 'isNotNull', operand: field(['expectedCloseMonth']) })
    expect(r.sql).toBe('"d"."expected_close_month" IS NOT NULL')
  })

  it('演算子を SQL に対応させる', () => {
    const ops = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const
    for (const [astOp, sqlOp] of Object.entries(ops)) {
      const r = compile({
        type: 'compare',
        op: astOp as keyof typeof ops,
        left: field(['initialBilling']),
        right: lit(1),
      })
      expect(r.sql).toBe(`"d"."initial_billing" ${sqlOp} ?`)
    }
  })

  it('文字列も引用せずバインドする（インジェクションの余地を作らない）', () => {
    const r = compile({
      type: 'compare',
      op: 'eq',
      left: field(['status']),
      right: lit("' OR 1=1--"),
    })
    expect(r.sql).toBe('"d"."status" = ?')
    expect(r.params).toEqual(["' OR 1=1--"])
  })
})

describe('論理演算', () => {
  // docs/domain-model.md §6-1「予算感を確認した」
  it('or', () => {
    const r = compile({
      type: 'or',
      operands: [
        { type: 'compare', op: 'gt', left: field(['initialBilling']), right: lit(0) },
        { type: 'compare', op: 'gt', left: field(['monthlyBilling']), right: lit(0) },
      ],
    })
    expect(r.sql).toBe('("d"."initial_billing" > ? OR "d"."monthly_billing" > ?)')
    expect(r.params).toEqual([0, 0])
  })

  it('not', () => {
    const r = compile({ type: 'not', operand: { type: 'isNull', operand: field(['status']) } })
    expect(r.sql).toBe('NOT ("d"."status" IS NULL)')
  })

  it('in', () => {
    const r = compile({ type: 'in', left: field(['status']), values: ['won', 'lost'] })
    expect(r.sql).toBe('"d"."status" IN (?, ?)')
    expect(r.params).toEqual(['won', 'lost'])
  })
})

describe('コンテキスト変数', () => {
  // docs/product-concept.md §4-1 行レベル認可
  it('currentUser.id をバインドする（SQL 関数にしない）', () => {
    const r = compile({
      type: 'compare',
      op: 'eq',
      left: field(['ownerEmployeeId']),
      right: { type: 'context', name: 'currentUser.id' },
    })
    expect(r.sql).toBe('"d"."owner_employee_id" = ?')
    expect(r.params).toEqual(['emp-1'])
  })

  it('today をバインドする', () => {
    const r = compile({
      type: 'compare',
      op: 'lt',
      left: field(['expectedCloseMonth']),
      right: { type: 'context', name: 'today' },
    })
    expect(r.params).toEqual(['2026-08-05'])
  })
})

describe('exists', () => {
  // docs/domain-model.md §6-1「アポイントの予定がある」
  it('サブクエリにして時点条件を付ける', () => {
    const r = compile({
      type: 'exists',
      table: 'activity',
      alias: 'a',
      where: {
        type: 'and',
        operands: [
          { type: 'compare', op: 'eq', left: field(['dealId'], 'a'), right: field(['id']) },
          { type: 'isNotNull', operand: field(['scheduledAt'], 'a') },
          { type: 'isNull', operand: field(['completedAt'], 'a') },
        ],
      },
    })
    expect(r.sql).toBe(
      'EXISTS (SELECT 1 FROM "activity" "a" WHERE ' +
        '("a"."deal_id" = "d"."id" AND "a"."scheduled_at" IS NOT NULL AND "a"."completed_at" IS NULL)' +
        ' AND "a"."valid_to" IS NULL)',
    )
  })
})

describe('リレーションを辿る field', () => {
  // docs/domain-model.md §6-1「決裁者に会えている」
  it('1段辿るとスカラーサブクエリになる', () => {
    const r = compile({
      type: 'exists',
      table: 'activity',
      alias: 'a',
      where: {
        type: 'compare',
        op: 'eq',
        left: field(['contactId', 'isDecisionMaker'], 'a'),
        right: lit(true),
      },
    })
    expect(r.sql).toContain(
      '(SELECT "_j0"."is_decision_maker" FROM "contact" "_j0"' +
        ' WHERE "_j0"."id" = "a"."contact_id" AND "_j0"."valid_to" IS NULL)',
    )
    // SQLite に真偽型は無いので 0/1 になる（下の「方言」を参照）
    expect(r.params).toEqual([1])
  })

  it('2段辿ると JOIN でつなぐ', () => {
    const r = compile({
      type: 'compare',
      op: 'eq',
      left: field(['companyId', 'name']),
      right: lit('山田食堂'),
    })
    expect(r.sql).toBe(
      '(SELECT "_j0"."name" FROM "company" "_j0"' +
        ' WHERE "_j0"."id" = "d"."company_id" AND "_j0"."valid_to" IS NULL) = ?',
    )
  })

  it('解決できない参照は例外にする', () => {
    expect(() => compile({ type: 'isNull', operand: field(['grossProfit']) })).toThrow(
      /解決できない参照/,
    )
  })

  it('未知のエイリアスは例外にする', () => {
    expect(() => compile({ type: 'isNull', operand: field(['id'], 'zzz') })).toThrow(
      /未知の source/,
    )
  })
})

describe('aggregate', () => {
  // docs/condition-ast.md §3「3回以上接触している」
  it('count は相関サブクエリになる', () => {
    const r = compile({
      type: 'compare',
      op: 'gte',
      left: {
        type: 'aggregate',
        fn: 'count',
        table: 'activity',
        alias: 'a',
        where: { type: 'compare', op: 'eq', left: field(['dealId'], 'a'), right: field(['id']) },
      },
      right: lit(3),
    })
    expect(r.sql).toBe(
      '(SELECT COUNT(*) FROM "activity" "a" WHERE "a"."deal_id" = "d"."id"' +
        ' AND "a"."valid_to" IS NULL) >= ?',
    )
    expect(r.params).toEqual([3])
  })

  it('count 以外は対象列を取る', () => {
    const r = compile({
      type: 'compare',
      op: 'gt',
      left: {
        type: 'aggregate',
        fn: 'sum',
        table: 'activity',
        alias: 'a',
        field: ['dealId'],
      },
      right: lit(0),
    })
    expect(r.sql).toContain('SELECT SUM("a"."deal_id")')
  })
})

describe('有効期間型（as_of）', () => {
  it('既定は現在時点（valid_to IS NULL）', () => {
    const r = compile({
      type: 'exists',
      table: 'activity',
      alias: 'a',
      where: { type: 'isNotNull', operand: field(['completedAt'], 'a') },
    })
    expect(r.sql).toContain('"a"."valid_to" IS NULL')
    expect(r.params).toEqual([])
  })

  // docs/product-concept.md §4-1「先月末時点のパイプライン」
  it('as_of を指定すると期間条件になり、値がバインドされる', () => {
    const r = compile(
      {
        type: 'exists',
        table: 'activity',
        alias: 'a',
        where: { type: 'isNotNull', operand: field(['completedAt'], 'a') },
      },
      { asOf: '2026-07-31' },
    )
    expect(r.sql).toContain(
      '("a"."valid_from" <= ? AND ("a"."valid_to" > ? OR "a"."valid_to" IS NULL))',
    )
    expect(r.params).toEqual(['2026-07-31', '2026-07-31'])
  })
})

describe('方言', () => {
  it('PostgreSQL は位置パラメータになる', () => {
    const r = compile(
      {
        type: 'or',
        operands: [
          { type: 'compare', op: 'gt', left: field(['initialBilling']), right: lit(0) },
          { type: 'compare', op: 'gt', left: field(['monthlyBilling']), right: lit(1) },
        ],
      },
      { dialect: postgres },
    )
    expect(r.sql).toBe('("d"."initial_billing" > $1 OR "d"."monthly_billing" > $2)')
    expect(r.params).toEqual([0, 1])
  })

  // 値そのものの表現も方言差。SQLite には真偽型が無い
  const isDecisionMaker: Pred = {
    type: 'compare',
    op: 'eq',
    left: field(['isDecisionMaker']),
    right: lit(true),
  }

  it('SQLite は boolean を 0/1 にする', () => {
    const r = compile(isDecisionMaker, { rootTable: 'contact', rootAlias: 'c' })
    expect(r.params).toEqual([1])
  })

  it('PostgreSQL は boolean のまま渡す', () => {
    const r = compile(isDecisionMaker, {
      rootTable: 'contact',
      rootAlias: 'c',
      dialect: postgres,
    })
    expect(r.params).toEqual([true])
  })
})

describe('パラメータの順序', () => {
  it('SQL に現れる順とバインド配列の順が一致する', () => {
    const r = compile(
      {
        type: 'and',
        operands: [
          { type: 'compare', op: 'eq', left: field(['status']), right: lit('open') },
          {
            type: 'exists',
            table: 'activity',
            alias: 'a',
            where: {
              type: 'compare',
              op: 'eq',
              left: field(['dealId'], 'a'),
              right: field(['id']),
            },
          },
          { type: 'compare', op: 'gt', left: field(['initialBilling']), right: lit(100) },
        ],
      },
      { asOf: '2026-07-31' },
    )
    // status → exists 内の時点条件2つ → initialBilling
    expect(r.params).toEqual(['open', '2026-07-31', '2026-07-31', 100])
  })
})
