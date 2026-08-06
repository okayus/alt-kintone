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

  it('href と往復する', () => {
    const id = 'd-山田/1'
    expect(parseRoute(href.deal(id))).toEqual({ name: 'deal', id })
    expect(parseRoute(href.flow('sales'))).toEqual({ name: 'flow', key: 'sales' })
    expect(parseRoute(href.flow('sales', 'proposed'))).toEqual({
      name: 'flow',
      key: 'sales',
      step: 'proposed',
    })
  })
})
