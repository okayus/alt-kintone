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

  it('href と往復する', () => {
    const id = 'd-山田/1'
    expect(parseRoute(href.deal(id))).toEqual({ name: 'deal', id })
  })
})
