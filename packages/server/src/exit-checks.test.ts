/**
 * 出口条件の一括評価。docs/condition-ast.md §5-1
 *
 * 「条件式は SQL に変換できる範囲に限る」と決めた理由が満たされているかを見る:
 * **一覧の件数が増えてもクエリ本数が増えない**こと。ここが崩れると、
 * 出口条件をUIのチェックリストにする（§4-3）という構想が実運用で破綻する。
 */
import { autoCheckSlots } from './exit-checks.js'
import { bundle, exitOf, fixture, flowOf, record, records } from './support.js'
import type { FlowDef } from '@alt/dsl'
import { describe, expect, it } from 'vitest'

const sales = bundle.flows[0] as FlowDef
const satisfied = (view: Record<string, unknown>, key: string) =>
  exitOf(view).find((e) => e['key'] === key)?.['satisfied']

describe('autoCheckSlots', () => {
  it('フローの自動判定を全ステップぶん列に割り当てる', () => {
    const slots = autoCheckSlots(sales)
    expect(slots.map((s) => `${s.step}/${s.key}`)).toEqual([
      'contacted/appointment_scheduled',
      'qualified/budget_confirmed',
      'qualified/decision_maker_identified',
      'proposed/amount_presented',
      'proposed/decision_maker_met',
      'proposed/timing_confirmed',
    ])
    // 別名はキーではなく通し番号（キーに使える文字と SQL 識別子の制約を結び付けない）
    expect(slots.map((s) => s.alias)).toEqual(['_c0', '_c1', '_c2', '_c3', '_c4', '_c5'])
  })
})

describe('一括評価', () => {
  it('現在ステップの出口条件だけがチェックリストに出る', () => {
    const view = record(fixture().request('GET', '/api/deal/d-1?flow=sales'))
    expect(flowOf(view)['step']).toBe('qualified')
    expect(exitOf(view).map((e) => e['key'])).toEqual([
      'problem_identified',
      'budget_confirmed',
      'decision_maker_identified',
    ])
  })

  it('自動判定はデータから決まる（営業が何もしなくても埋まる）', () => {
    const view = record(fixture().request('GET', '/api/deal/d-1?flow=sales'))
    // initialBilling = 180000 > 0
    expect(satisfied(view, 'budget_confirmed')).toBe(true)
    // isDecisionMaker の contact が同じ会社に居る
    expect(satisfied(view, 'decision_maker_identified')).toBe(true)
  })

  it('NULL は未充足になる（SQL の三値論理を取りこぼさない）', () => {
    // d-3 は金額が入っていない → 比較結果は 0 ではなく NULL
    const view = records(fixture().request('GET', '/api/deal?flow=sales')).find(
      (r) => r['id'] === 'd-3',
    )
    expect(satisfied(view as Record<string, unknown>, 'budget_confirmed')).toBe(false)
  })

  it('手動チェックは _manual_check の状態が出る', () => {
    const f = fixture()
    const before = record(f.request('GET', '/api/deal/d-1?flow=sales'))
    expect(satisfied(before, 'problem_identified')).toBe(false)

    f.request('PUT', '/api/deal/d-1/checks/problem_identified?flow=sales', {
      body: { checked: true },
    })

    const after = record(f.request('GET', '/api/deal/d-1?flow=sales'))
    expect(satisfied(after, 'problem_identified')).toBe(true)
    expect(exitOf(after).find((e) => e['key'] === 'problem_identified')?.['checkedBy']).toBe(
      'e-yamada',
    )
  })

  it('exists の出口条件も評価される（未完了のアポがある）', () => {
    const view = records(fixture().request('GET', '/api/deal?flow=sales')).find(
      (r) => r['id'] === 'd-2',
    ) as Record<string, unknown>
    expect(flowOf(view)['step']).toBe('contacted')
    expect(satisfied(view, 'appointment_scheduled')).toBe(true)
  })

  it('未充足の件数が出る（FE の「※未確認2件あり」）', () => {
    const view = record(fixture().request('GET', '/api/deal/d-1?flow=sales'))
    expect(flowOf(view)['unsatisfied']).toBe(1)
  })

  it('件数が増えてもクエリ本数が変わらない（N+1 を作らない）', () => {
    const f = fixture()
    const original = f.db.prepare.bind(f.db)
    let prepared = 0
    f.db.prepare = ((sql: string) => {
      prepared += 1
      return original(sql)
    }) as typeof f.db.prepare

    // 3件のとき
    prepared = 0
    expect(records(f.request('GET', '/api/deal?flow=sales')).length).toBe(3)
    const forThree = prepared

    // 8件に増やす
    for (let i = 0; i < 5; i += 1) {
      f.request('POST', '/api/deal?flow=sales', {
        body: {
          companyId: 'co-1',
          title: `追加${i}`,
          productType: 'meo',
          dealType: 'new',
          status: 'open',
          ownerEmployeeId: 'e-yamada',
        },
      })
    }

    prepared = 0
    expect(records(f.request('GET', '/api/deal?flow=sales')).length).toBe(8)
    // 認証1本 + 総件数1本 + 窓の id 1本 + レコード（現在ステップ + 全自動判定を含む）1本
    // + 手動チェック1本。フェーズ6（窓取得）で2本増えたが、どれも件数に依存しない
    expect(prepared).toBe(forThree)
    expect(prepared).toBe(5)
  })

  it('決着ステップには出口条件が無い（出る先が無いので出る条件も無い）', () => {
    const f = fixture()
    f.request('POST', '/api/deal/d-1/advance?flow=sales', { body: { to: 'lost' } })
    const view = record(f.request('GET', '/api/deal/d-1?flow=sales'))
    expect(flowOf(view)['step']).toBe('lost')
    expect(exitOf(view)).toEqual([])
    expect(flowOf(view)['next']).toEqual([])
  })
})
