/**
 * ステップ遷移と手動チェック。docs/product-concept.md §3-5 / §4-3
 *
 * 中核は「**未充足でも進める。ただし記録に残す**」。ブロックしないのが確定事項で、
 * 残した記録から「出口条件を満たさず進めた案件の受注率」が出せる、が構想の主張。
 * ここが動いていないと、業務フローを第一級にした意味の半分が無くなる。
 */
import { ADMIN, errorCode, fixture, flowOf, MANAGER, record, SATO, YAMADA } from './support.js'
import { describe, expect, it } from 'vitest'

const ADVANCE = '/api/deal/d-1/advance?flow=sales'

describe('advance', () => {
  it('next に定義された遷移は通り、_flow_state に履歴が残る', () => {
    const f = fixture()
    const response = f.request('POST', ADVANCE, { body: { to: 'proposed' } })

    expect(response.status).toBe(200)
    expect(flowOf(record(response))['step']).toBe('proposed')

    const history = f.rows(
      'SELECT * FROM "_flow_state" WHERE "record_id" = ? ORDER BY "valid_from"',
      'd-1',
    )
    expect(history).toHaveLength(2)
    expect(history[0]?.['step']).toBe('qualified')
    expect(history[0]?.['valid_to']).not.toBeNull()
    expect(history[1]?.['step']).toBe('proposed')
    expect(history[1]?.['valid_to']).toBeNull()
    // 変更の文脈は「出てきたステップ」。どのステップで遷移が起きたかが残る
    expect(history[1]?.['changed_step']).toBe('qualified')
    expect(history[1]?.['changed_by']).toBe('e-yamada')
  })

  it('未充足でも進めるが、未充足のキーが記録される', () => {
    const f = fixture()
    // d-1 は problem_identified（手動）が未チェック
    const response = f.request('POST', ADVANCE, { body: { to: 'proposed' } })

    expect((response.body as { unmet: string[] }).unmet).toEqual(['problem_identified'])
    const [, entered] = f.rows(
      'SELECT * FROM "_flow_state" WHERE "record_id" = ? ORDER BY "valid_from"',
      'd-1',
    )
    expect(JSON.parse(String(entered?.['unmet_checks']))).toEqual(['problem_identified'])
    // 進んだ先のレコードからも読める（FE が「未確認2件で進んだ」を出せる）
    expect(flowOf(record(response))['enteredUnmet']).toEqual(['problem_identified'])
  })

  it('全部満たしていれば unmet は空', () => {
    const f = fixture()
    f.request('PUT', '/api/deal/d-1/checks/problem_identified?flow=sales', {
      body: { checked: true },
    })
    const response = f.request('POST', ADVANCE, { body: { to: 'proposed' } })
    expect((response.body as { unmet: string[] }).unmet).toEqual([])
  })

  it('next に無い遷移は 400（定義に無い進め方をさせない）', () => {
    const response = fixture().request('POST', ADVANCE, { body: { to: 'won' } })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('bad-request')
  })

  it('管理者は任意のステップへ強制遷移できる', () => {
    const f = fixture()
    const response = f.request('POST', ADVANCE, { body: { to: 'won' }, user: ADMIN })
    expect(response.status).toBe(200)
    expect(flowOf(record(response))['step']).toBe('won')
  })

  it('定義に無いステップは管理者でも 400', () => {
    const response = fixture().request('POST', ADVANCE, { body: { to: 'nope' }, user: ADMIN })
    expect(response.status).toBe(400)
  })

  /**
   * ⚠ フェーズ8 で**止まる層が変わった**。鈴木（sales_manager）は `viewers` として
   * フローに参加するようになったので、以前の「参加していない」ではなく
   * 「閲覧のみだから書けない」（`requireOperator`）で落ちる。
   *
   * つまりこのテストは**ステップ操作の層（層3）を通らない**。層3 を突くには
   * 「フローの担当だが、そのステップの担当ではない」人が要るが、営業フローは
   * 全ステップが `sales_rep` 単独なので作れない。層3 は `authz.test.ts` の
   * 「複数の担当ロール（純関数）」で固定してある。
   */
  it('閲覧のみの立場は advance できない', () => {
    const response = fixture().request('POST', ADVANCE, { body: { to: 'proposed' }, user: MANAGER })
    expect(response.status).toBe(403)
  })

  it('担当者でない営業は 403（行レベルの層）', () => {
    const response = fixture().request('POST', ADVANCE, { body: { to: 'proposed' }, user: SATO })
    expect(response.status).toBe(403)
  })

  it('to が無い body は 400', () => {
    const response = fixture().request('POST', ADVANCE, { body: {} })
    expect(response.status).toBe(400)
  })

  it('差し戻しても、そのステップの手動チェックは残っている', () => {
    const f = fixture()
    f.request('PUT', '/api/deal/d-1/checks/problem_identified?flow=sales', {
      body: { checked: true },
    })
    f.request('POST', ADVANCE, { body: { to: 'proposed' } })
    // proposed → qualified へ差し戻し
    f.request('POST', ADVANCE, { body: { to: 'qualified' } })

    const view = record(f.request('GET', '/api/deal/d-1?flow=sales'))
    const check = (flowOf(view)['exit'] as Array<Record<string, unknown>>).find(
      (e) => e['key'] === 'problem_identified',
    )
    expect(check?.['satisfied']).toBe(true)
  })
})

describe('手動チェック', () => {
  it('外すこともできる（誤認で戻した場合に個別に外す）', () => {
    const f = fixture()
    const path = '/api/deal/d-1/checks/problem_identified?flow=sales'
    f.request('PUT', path, { body: { checked: true } })
    const view = record(f.request('PUT', path, { body: { checked: false } }))
    const check = (flowOf(view)['exit'] as Array<Record<string, unknown>>).find(
      (e) => e['key'] === 'problem_identified',
    )
    expect(check?.['satisfied']).toBe(false)
  })

  it('自動判定のキーは手では立てられない', () => {
    const response = fixture().request('PUT', '/api/deal/d-1/checks/budget_confirmed?flow=sales', {
      body: { checked: true },
    })
    expect(response.status).toBe(400)
  })

  it('現在ステップに無いキーは 400', () => {
    const response = fixture().request('PUT', '/api/deal/d-1/checks/resumable?flow=sales', {
      body: { checked: true },
    })
    expect(response.status).toBe(400)
  })

  it('担当者でなければ 403', () => {
    const response = fixture().request(
      'PUT',
      '/api/deal/d-1/checks/problem_identified?flow=sales',
      { body: { checked: true }, user: SATO },
    )
    expect(response.status).toBe(403)
  })

  it('body が boolean でなければ 400', () => {
    const response = fixture().request(
      'PUT',
      '/api/deal/d-1/checks/problem_identified?flow=sales',
      { body: { checked: 'yes' }, user: YAMADA },
    )
    expect(response.status).toBe(400)
  })
})
