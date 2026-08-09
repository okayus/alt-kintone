/**
 * 「どこから起票したか」→「何についての要望か」。
 *
 * ここが弱いと、宣言的なフォームは**項目の多いフォーム**に退化する
 * （docs/impl/phase-9-change-requests.md §2-1）。人が払うコストをゼロに保つ部分なので、
 * 「何も操作しなくても対象が埋まる」ことを固定する。
 */
import { contextFromRoute } from './requestContext'
import { href } from '../../shell/router'
import { describe, expect, it } from 'vitest'

describe('contextFromRoute', () => {
  it('案件詳細から起票すると、フロー・データ・レコードが入る', () => {
    expect(contextFromRoute('#/deals/d-aoi-meo')).toEqual({
      screenRoute: '#/deals/d-aoi-meo',
      targetTable: 'deal',
      targetRecordId: 'd-aoi-meo',
      targetFlow: 'sales',
    })
  })

  it('案件一覧から起票すると、レコードだけ空になる', () => {
    expect(contextFromRoute('#/')).toEqual({
      screenRoute: '#/',
      targetTable: 'deal',
      targetFlow: 'sales',
    })
  })

  it('フロー参照画面から起票すると、見ていたステップを指す', () => {
    expect(contextFromRoute('#/flows/sales?step=qualified')).toEqual({
      screenRoute: '#/flows/sales?step=qualified',
      targetFlow: 'sales',
      targetStep: 'sales.qualified',
    })
    // ステップを選んでいなければフローまで
    expect(contextFromRoute('#/flows/sales')).toEqual({
      screenRoute: '#/flows/sales',
      targetFlow: 'sales',
    })
  })

  it('要望の画面から起票すると、要望フローを指す（自己適用が破綻しない）', () => {
    expect(contextFromRoute(href.request('cr-1'))).toEqual({
      screenRoute: '#/requests/cr-1',
      targetTable: 'change_request',
      targetRecordId: 'cr-1',
      targetFlow: 'request',
    })
  })

  it('ナビから直接来たら何も埋めない（嘘の対象を入れない）', () => {
    expect(contextFromRoute(undefined)).toEqual({})
    expect(contextFromRoute('')).toEqual({})
  })

  it('フローとデータの対応は定義から引く（FE に対応表を持たない）', () => {
    // `targetFlow` が 'sales' なのは、営業フローの target が deal だから。
    // 定義で target を変えればここも変わる（画面側の手書き表では追随しない）
    expect(contextFromRoute('#/deals/x').targetFlow).toBe('sales')
  })
})
