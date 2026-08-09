import { href, parseRoute } from './router'
import { describe, expect, it } from 'vitest'

describe('parseRoute', () => {
  it('空・ルート・不明はいずれも案件一覧', () => {
    expect(parseRoute('')).toEqual({ name: 'deals' })
    expect(parseRoute('#/')).toEqual({ name: 'deals' })
    expect(parseRoute('#/unknown')).toEqual({ name: 'deals' })
  })

  it('案件詳細を拾う', () => {
    expect(parseRoute('#/deals/d-aoi-meo')).toEqual({ name: 'deal', id: 'd-aoi-meo' })
    expect(parseRoute('#/deals/d-aoi-meo/')).toEqual({ name: 'deal', id: 'd-aoi-meo' })
  })

  it('フロー参照画面を拾う', () => {
    expect(parseRoute('#/flows/sales')).toEqual({ name: 'flow', key: 'sales' })
    // 案件詳細から来たときは現在地つき
    expect(parseRoute('#/flows/sales?step=qualified')).toEqual({
      name: 'flow',
      key: 'sales',
      step: 'qualified',
    })
    expect(parseRoute('#/flows/sales?step=')).toEqual({ name: 'flow', key: 'sales' })
  })

  it('要望の一覧・詳細を拾う', () => {
    expect(parseRoute('#/requests')).toEqual({ name: 'requests' })
    expect(parseRoute('#/requests/')).toEqual({ name: 'requests' })
    expect(parseRoute('#/requests/cr-competitor')).toEqual({
      name: 'request',
      id: 'cr-competitor',
    })
  })

  it('起票は ID より先に見る（"new" が ID として解釈されない）', () => {
    expect(parseRoute('#/requests/new')).toEqual({ name: 'requestNew' })
    expect(parseRoute('#/requests/new/')).toEqual({ name: 'requestNew' })
  })

  it('起票は「どこから押したか」を持ち回る（コンテキスト自動添付の入力）', () => {
    expect(parseRoute('#/requests/new?from=%23%2Fdeals%2Fd-1')).toEqual({
      name: 'requestNew',
      from: '#/deals/d-1',
    })
    expect(parseRoute('#/requests/new?from=')).toEqual({ name: 'requestNew' })
  })

  it('href と往復する', () => {
    const id = 'd-山田/1'
    expect(parseRoute(href.deal(id))).toEqual({ name: 'deal', id })
    expect(parseRoute(href.flow('sales'))).toEqual({ name: 'flow', key: 'sales' })
    expect(parseRoute(href.flow('sales', 'proposed'))).toEqual({
      name: 'flow',
      key: 'sales',
      step: 'proposed',
    })
    expect(parseRoute(href.request('cr-1'))).toEqual({ name: 'request', id: 'cr-1' })
    // from には別のハッシュ（`#` と `/` を含む）が入るので、往復できることが要点
    expect(parseRoute(href.requestNew('#/deals/d-1?x=1'))).toEqual({
      name: 'requestNew',
      from: '#/deals/d-1?x=1',
    })
  })
})
