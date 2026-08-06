/**
 * ルーティングと HTTP の作法。
 *
 * ルート表はどこにも書いていない（定義から生える）ので、ここで見るのは
 * 「生えていないものが生えていないこと」と、エラーが**直せる形**で返ることの2つ。
 */
import { errorCode, fixture } from './support.js'
import { describe, expect, it } from 'vitest'

describe('ルーティング', () => {
  it('/health は認証なしで通る', () => {
    const response = fixture().request('GET', '/health', { user: null })
    expect(response.status).toBe(200)
    expect((response.body as { ok: boolean }).ok).toBe(true)
  })

  it('知らないパスは 404', () => {
    expect(fixture().request('GET', '/nope').status).toBe(404)
    expect(fixture().request('GET', '/api').status).toBe(404)
  })

  it('未対応のメソッドは 405', () => {
    const response = fixture().request('DELETE', '/api/deal/d-1?flow=sales')
    expect(response.status).toBe(405)
    expect(errorCode(response)).toBe('method-not-allowed')
  })

  it('target でないテーブルの advance は 400', () => {
    const response = fixture().request('POST', '/api/activity/a-1/advance?flow=sales', {
      body: { to: 'proposed' },
    })
    expect(response.status).toBe(400)
  })
})

describe('エラーの形', () => {
  it('code / message / hint を持つ（AIが読んで直せる形）', () => {
    const response = fixture().request('POST', '/api/deal?flow=sales', {
      body: { companyId: 'co-1', titel: '誤字', productType: 'meo', dealType: 'new' },
    })
    const error = (response.body as { error: { code: string; message: string; hint?: string } })
      .error
    expect(response.status).toBe(400)
    expect(error.code).toBe('bad-request')
    expect(error.message).toContain('titel')
    // 候補の列挙が hint に出る
    expect(error.hint).toContain('title')
  })

  it('as_of が読めなければ 400', () => {
    expect(fixture().request('GET', '/api/deal?flow=sales&as_of=きのう').status).toBe(400)
  })

  it('limit の上限を超えたら 400', () => {
    expect(fixture().request('GET', '/api/deal?flow=sales&limit=9999').status).toBe(400)
  })
})

describe('一覧のレスポンス', () => {
  it('table / flow / asOf を添える', () => {
    const body = fixture().request('GET', '/api/deal?flow=sales').body as Record<string, unknown>
    expect(body['table']).toBe('deal')
    expect(body['flow']).toBe('sales')
    expect(body['asOf']).toBeNull()
  })

  it('limit で件数を絞れる', () => {
    const body = fixture().request('GET', '/api/deal?flow=sales&limit=1').body as {
      records: unknown[]
    }
    expect(body.records).toHaveLength(1)
  })
})
