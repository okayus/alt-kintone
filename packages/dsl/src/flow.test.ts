import { describe, expect, it } from 'vitest'
import type { Pred } from './ast.js'
import {
  bind,
  check,
  flow,
  flowDefSchema,
  manualCheck,
  step,
  usedTables,
  type FlowDef,
} from './flow.js'
import { boolean, integer, reference, table, text, uuid } from './table.js'

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
const deal = table(
  'deal',
  {
    id: uuid('ID').primaryKey(),
    companyId: reference('company', '顧客企業').required(),
    initialBilling: integer('一時金・請求額'),
  },
  { label: '案件' },
)
const activity = table(
  'activity',
  {
    id: uuid('ID').primaryKey(),
    dealId: reference('deal', '案件'),
    completed: boolean('実施済み'),
  },
  { label: '活動' },
)

const billingEntered: Pred = {
  type: 'compare',
  op: 'gt',
  left: { type: 'field', source: 'root', path: ['initialBilling'] },
  right: { type: 'literal', value: 0 },
}

function sampleFlow(): FlowDef {
  return flow({
    key: 'sales',
    name: '営業',
    goal: '受注',
    target: deal,
    initial: 'contacted',
    steps: [
      step({
        key: 'contacted',
        name: '接触',
        intent: '買い手が話を聞く気になった状態にする',
        role: 'sales_rep',
        reads: [company],
        writes: [activity],
        exit: [manualCheck('reached', '担当者と話せた', '本人と直接話せたら ✓')],
        next: ['qualified'],
      }),
      step({
        key: 'qualified',
        name: 'ヒアリング',
        intent: '買い手が課題と予算を認識している状態にする',
        role: 'sales_rep',
        reads: [company, employee],
        writes: [deal, activity],
        exit: [check('budget', '予算感を確認した', '案件に金額を入れると充足する', billingEntered)],
        next: ['won'],
      }),
      step({
        key: 'won',
        name: '受注',
        intent: '買い手が発注を決めた',
        role: 'sales_rep',
        exit: [],
        next: [],
      }),
    ],
    bindings: [
      bind(deal, 'primary', '営業の主対象'),
      bind(activity, 'primary', '接触記録と次アクション'),
      bind(company, 'reference', '商談相手の情報'),
    ],
  })
}

describe('フロー定義', () => {
  it('TableDef を渡すとテーブル名に落ちる（JSON になる形）', () => {
    const sales = sampleFlow()
    expect(sales.target).toBe('deal')
    expect(sales.steps[1]?.reads).toEqual(['company', 'employee'])
    expect(sales.steps[1]?.writes).toEqual(['deal', 'activity'])
    expect(sales.bindings[0]).toEqual({
      table: 'deal',
      role: 'primary',
      purpose: '営業の主対象',
    })
  })

  it('ステップは意図（intent）を持つ（フェーズ5 決定E）', () => {
    expect(sampleFlow().steps[0]?.intent).toBe('買い手が話を聞く気になった状態にする')
  })

  it('zod 検証を通る', () => {
    expect(flowDefSchema.safeParse(sampleFlow()).success).toBe(true)
  })

  it('JSON を往復しても等価（定義は最終的に JSON になる）', () => {
    const sales = sampleFlow()
    const parsed = flowDefSchema.safeParse(JSON.parse(JSON.stringify(sales)))
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).toEqual(sales)
  })

  it('ステップキーが重複していたら弾く', () => {
    const sales = sampleFlow()
    const broken = { ...sales, steps: [sales.steps[0] as never, sales.steps[0] as never] }
    expect(flowDefSchema.safeParse(broken).success).toBe(false)
  })

  it('initial が存在しないステップを指していたら弾く', () => {
    const broken = { ...sampleFlow(), initial: 'nowhere' }
    expect(flowDefSchema.safeParse(broken).success).toBe(false)
  })

  it('intent や howTo が空だと弾く（書き忘れを構文層で止める）', () => {
    const noIntent = sampleFlow()
    ;(noIntent.steps[0] as { intent: string }).intent = ''
    expect(flowDefSchema.safeParse(noIntent).success).toBe(false)

    const noHowTo = sampleFlow()
    ;(noHowTo.steps[1]!.exit[0] as { howTo: string }).howTo = ''
    expect(flowDefSchema.safeParse(noHowTo).success).toBe(false)
  })

  it('出口条件は明示キーで識別する（ラベルとは独立）', () => {
    const auto = check('budget', '予算感を確認した', '金額を入れると充足する', billingEntered)
    const manual = manualCheck('problem', '課題を確認した', '先方の言葉で聞けたら ✓')
    expect(auto).toEqual({
      kind: 'auto',
      key: 'budget',
      label: '予算感を確認した',
      howTo: '金額を入れると充足する',
      condition: billingEntered,
    })
    expect(manual).toEqual({
      kind: 'manual',
      key: 'problem',
      label: '課題を確認した',
      howTo: '先方の言葉で聞けたら ✓',
    })
  })
})

describe('使用テーブルと access の導出', () => {
  it('reads だけなら read、writes だけなら write、両方あれば readwrite', () => {
    const usage = usedTables(sampleFlow())
    expect(usage['company']?.access).toBe('read')
    expect(usage['employee']?.access).toBe('read')
    expect(usage['activity']?.access).toBe('write')
    expect(usage['deal']?.access).toBe('write')
  })

  it('どのステップで使われているかを記録する（バインディングの実体）', () => {
    const usage = usedTables(sampleFlow())
    expect(usage['company']?.steps).toEqual(['contacted', 'qualified'])
    expect(usage['activity']?.steps).toEqual(['contacted', 'qualified'])
    expect(usage['deal']?.steps).toEqual(['qualified'])
  })

  it('同じステップが読み書き両方していても重複しない', () => {
    const one = flow({
      key: 'f',
      name: 'f',
      goal: 'g',
      target: deal,
      initial: 's',
      steps: [
        step({
          key: 's',
          name: 's',
          intent: 'i',
          role: 'r',
          reads: [deal],
          writes: [deal],
          exit: [],
          next: [],
        }),
      ],
      bindings: [bind(deal, 'primary', 'p')],
    })
    expect(usedTables(one)['deal']).toEqual({ access: 'readwrite', steps: ['s'] })
  })

  it('宣言だけあって使われていないテーブルは導出結果に出ない（validate が警告する材料）', () => {
    const quota = table('quota', { id: uuid('ID').primaryKey() }, { label: '目標' })
    const sales = sampleFlow()
    const usage = usedTables({
      ...sales,
      bindings: [...sales.bindings, bind(quota, 'reference', '目標を参照')],
    })
    // 導出は steps の reads/writes だけを見る。宣言と実使用のズレは validate が拾う
    expect(Object.keys(usage).sort()).toEqual(['activity', 'company', 'deal', 'employee'])
    expect(usage['quota']).toBeUndefined()
  })
})
