/**
 * 認可。docs/product-concept.md §4-1
 *
 * **権限設定はどこにも書いていない。** ここで通る／落ちる判定はすべて業務フロー定義
 * （ステップの role / reads / writes、バインディングの rowFilter）から導出されている。
 * kintone では権限が別画面にあって業務と乖離する、というのを構造で解いた部分。
 */
import { ADMIN, errorCode, fixture, MANAGER, permissionsOf, records, SATO } from './support.js'
import { describe, expect, it } from 'vitest'

describe('認証（プロトタイプの詐称）', () => {
  it('X-Dev-User が無ければ 401', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', { user: null })
    expect(response.status).toBe(401)
    expect(errorCode(response)).toBe('unauthorized')
  })

  it('従業員マスタに居ない識別子は 401', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', {
      user: 'nobody@example.com',
    })
    expect(response.status).toBe(401)
  })
})

describe('行レベル（読みは全員、書きは担当者＋管理者）', () => {
  it('他人の案件も読める', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', { user: SATO })
    expect(response.status).toBe(200)
    expect(records(response).map((r) => r['id'])).toContain('d-1')
  })

  it('他人の案件は更新できない', () => {
    const response = fixture().request('PATCH', '/api/deal/d-1?flow=sales', {
      body: { note: 'よそから書き換え' },
      user: SATO,
    })
    expect(response.status).toBe(403)
    expect(errorCode(response)).toBe('forbidden')
  })

  it('自分の案件は更新できる', () => {
    const response = fixture().request('PATCH', '/api/deal/d-3?flow=sales', {
      body: { note: '自分の案件' },
      user: SATO,
    })
    expect(response.status).toBe(200)
  })

  it('管理者は行レベルをバイパスする', () => {
    const response = fixture().request('PATCH', '/api/deal/d-1?flow=sales', {
      body: { note: '管理者が修正' },
      user: ADMIN,
    })
    expect(response.status).toBe(200)
  })
})

describe('_permissions（FEに認可ロジックを複製しない）', () => {
  it('レコードごとに、実際の可否と同じ値が返る', () => {
    const f = fixture()
    const mine = records(f.request('GET', '/api/deal?flow=sales')).find((r) => r['id'] === 'd-1')
    const others = records(f.request('GET', '/api/deal?flow=sales', { user: SATO })).find(
      (r) => r['id'] === 'd-1',
    )

    expect(permissionsOf(mine as Record<string, unknown>)).toEqual({
      update: true,
      advance: true,
    })
    expect(permissionsOf(others as Record<string, unknown>)).toEqual({
      update: false,
      advance: false,
    })
  })

  it('担当者でない営業には advance も update も false で返る', () => {
    const view = records(fixture().request('GET', '/api/deal?flow=sales', { user: SATO })).find(
      (r) => r['id'] === 'd-1',
    )
    expect(permissionsOf(view as Record<string, unknown>)).toEqual({
      update: false,
      advance: false,
    })
  })

  it('読むだけのテーブルでは update が false', () => {
    const view = records(fixture().request('GET', '/api/company?flow=sales'))[0]
    expect(permissionsOf(view as Record<string, unknown>)).toEqual({ update: false })
  })

  it('管理者には全部 true で返る', () => {
    const view = records(fixture().request('GET', '/api/deal?flow=sales', { user: ADMIN })).find(
      (r) => r['id'] === 'd-1',
    )
    expect(permissionsOf(view as Record<string, unknown>)).toEqual({ update: true, advance: true })
  })
})

describe('テーブルアクセス（access はステップの reads/writes から導出）', () => {
  it('reference バインドのテーブルには書けない', () => {
    const response = fixture().request('POST', '/api/company?flow=sales', {
      body: { name: '新しい会社', status: 'prospect' },
      user: ADMIN,
    })
    expect(response.status).toBe(403)
    // 管理者でも通らない。access は「フローがそのテーブルをどう使うか」であって偉さではない
    expect(errorCode(response)).toBe('forbidden')
  })

  it('横断マスタも読むだけなら書けない', () => {
    const response = fixture().request('PATCH', '/api/employee/e-yamada?flow=sales', {
      body: { team: 'B' },
      user: ADMIN,
    })
    expect(response.status).toBe(403)
  })
})

describe('フロー参加（ステップの role から導出）', () => {
  /**
   * ⚠ 実装して見つかった穴。営業マネージャー（sales_manager）は営業フローの
   * どのステップも担当していないので、**導出だと何も読めない**。
   * ロール定義は「全案件の閲覧・編集」と言っているのに、定義から導ける参加は
   * 「ステップを担当していること」しかない。docs/product-concept.md §8-2 論点12。
   *
   * ここでは実際の挙動を固定しておく。仕様が決まったらこのテストごと変える。
   */
  it('どのステップも担当しないロールはフローに参加できない', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', { user: MANAGER })
    expect(response.status).toBe(403)
    expect(errorCode(response)).toBe('forbidden')
  })

  it('管理者はステップを担当していなくても参加できる', () => {
    expect(fixture().request('GET', '/api/deal?flow=sales', { user: ADMIN }).status).toBe(200)
  })
})

describe('バインドされていないテーブルは使えない（§3-2）', () => {
  it('定義に無いテーブルは 404', () => {
    const response = fixture().request('GET', '/api/quota?flow=sales')
    expect(response.status).toBe(404)
    expect(errorCode(response)).toBe('not-found')
  })
})

describe('フローの指定', () => {
  it('使っていないフローを指定したら 400', () => {
    const response = fixture().request('GET', '/api/deal?flow=production')
    expect(response.status).toBe(400)
  })

  it('フローが1本なら省略できる', () => {
    const response = fixture().request('GET', '/api/deal')
    expect(response.status).toBe(200)
    expect((response.body as { flow: string }).flow).toBe('sales')
  })
})
