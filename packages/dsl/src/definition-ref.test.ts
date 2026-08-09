import { describe, expect, it } from 'vitest'
import {
  definitionRefLabel,
  definitionRefOptions,
  resolveDefinitionRef,
  type DefinitionScope,
} from './definition-ref.js'
import { bind, check, flow, manualCheck, step } from './flow.js'
import { integer, reference, registry, table, text, uuid, yearMonth } from './table.js'
import type { Pred } from './ast.js'

const employee = table(
  'employee',
  { id: uuid('ID').primaryKey(), name: text('氏名').required() },
  { label: '従業員', global: true },
)
const deal = table(
  'deal',
  {
    id: uuid('ID').primaryKey(),
    title: text('案件名').required(),
    initialBilling: integer('一時金・請求額'),
    expectedCloseMonth: yearMonth('見込み受注月'),
    ownerEmployeeId: reference('employee', '担当').required(),
  },
  { label: '案件' },
)

const closeMonthEntered: Pred = {
  type: 'isNotNull',
  operand: { type: 'field', source: 'root', path: ['expectedCloseMonth'] },
}

const sales = flow({
  key: 'sales',
  name: '営業（新規開拓）',
  goal: '受注',
  target: deal,
  initial: 'contacted',
  steps: [
    step({
      key: 'contacted',
      name: '接触',
      intent: '話を聞く気にさせる',
      roles: ['sales_rep'],
      writes: [deal],
      exit: [manualCheck('reached', '接触できた', '先方と話せたら ✓')],
      next: ['proposed'],
    }),
    step({
      key: 'proposed',
      name: '提案',
      intent: '自社案を前提に検討させる',
      roles: ['sales_rep'],
      writes: [deal],
      exit: [
        check(
          'timing_confirmed',
          '導入時期を確認した',
          '案件の「見込み受注月」を入れると充足する',
          closeMonthEntered,
        ),
      ],
      next: ['won'],
    }),
    step({
      key: 'won',
      name: '受注',
      intent: '発注が決まった',
      roles: ['sales_rep'],
      writes: [deal],
      exit: [],
      next: [],
    }),
  ],
  bindings: [bind(deal, 'primary', '営業の主対象')],
})

const defs: DefinitionScope = { tables: registry(deal, employee), flows: [sales] }

describe('definitionRefOptions', () => {
  it('flow は業務フローそのもの', () => {
    expect(definitionRefOptions(defs, 'flow')).toEqual([
      { value: 'sales', labels: ['営業（新規開拓）'] },
    ])
  })

  it('step は フロー.ステップ の合成キー（値1つで解ける）', () => {
    expect(definitionRefOptions(defs, 'step').map((o) => o.value)).toEqual([
      'sales.contacted',
      'sales.proposed',
      'sales.won',
    ])
  })

  it('check は自動判定も手動チェックも並ぶ', () => {
    expect(definitionRefOptions(defs, 'check')).toEqual([
      { value: 'sales.contacted.reached', labels: ['営業（新規開拓）', '接触', '接触できた'] },
      {
        value: 'sales.proposed.timing_confirmed',
        labels: ['営業（新規開拓）', '提案', '導入時期を確認した'],
      },
    ])
  })

  it('field は テーブル.フィールド で、横断マスタも含む', () => {
    const values = definitionRefOptions(defs, 'field').map((o) => o.value)
    expect(values).toContain('deal.expectedCloseMonth')
    expect(values).toContain('employee.name')
  })

  it('宣言順を保つ（Record の反復順に依存しない並びを画面が使うため）', () => {
    expect(definitionRefOptions(defs, 'table').map((o) => o.value)).toEqual(['deal', 'employee'])
    expect(definitionRefOptions(defs, 'field')[0]?.value).toBe('deal.id')
  })
})

describe('resolveDefinitionRef', () => {
  it('業務の言葉に戻す（起票者が読むのはこれ）', () => {
    const target = resolveDefinitionRef(defs, 'check', 'sales.proposed.timing_confirmed')
    expect(target?.kind).toBe('check')
    expect(definitionRefLabel(target!)).toBe('営業（新規開拓） ＞ 提案 ＞ 導入時期を確認した')
  })

  it('データ項目もラベルで読める', () => {
    const target = resolveDefinitionRef(defs, 'field', 'deal.expectedCloseMonth')
    expect(definitionRefLabel(target!)).toBe('案件 ＞ 見込み受注月')
  })

  it('綴りが違えば解決できない（サーバはここで弾く）', () => {
    expect(resolveDefinitionRef(defs, 'step', 'sales.propose')).toBeUndefined()
    expect(resolveDefinitionRef(defs, 'flow', 'Sales')).toBeUndefined()
  })

  it('kind が違えば解決できない（ステップの値を flow として渡す等）', () => {
    expect(resolveDefinitionRef(defs, 'flow', 'sales.proposed')).toBeUndefined()
    expect(resolveDefinitionRef(defs, 'step', 'sales')).toBeUndefined()
  })

  it('候補と解決が一致する（画面に出た選択肢が弾かれることがない）', () => {
    for (const kind of ['table', 'flow', 'step', 'field', 'check'] as const) {
      for (const option of definitionRefOptions(defs, kind)) {
        expect(resolveDefinitionRef(defs, kind, option.value)).toEqual({ kind, ...option })
      }
    }
  })
})
