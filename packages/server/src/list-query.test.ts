/**
 * 一覧の窓取得・フィルタ・並び。docs/impl/phase-6-list-grid.md
 *
 * 見るのは3つ:
 *  - **窓をどう切っても全行がちょうど一度ずつ出る**（`snapshot` 固定。決定A）
 *  - フィルタの語彙が条件式 AST を経由して WHERE になり、総件数と一致する
 *  - 未知のパラメータ・型に合わない値が **400 + 直し方のヒント**で返る
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN,
  errorCode,
  fixture,
  permissionsOf,
  records,
  SATO,
  YAMADA,
  type Fixture,
} from './support.js'
import type { ApiResponse } from './api.js'

const T_LATER = '2026-07-16T00:00:00.000Z'

const page = (response: ApiResponse) =>
  response.body as {
    total: number
    offset: number
    limit: number
    now: string
    asOf: string | null
    snapshot: string | null
  }

const ids = (response: ApiResponse) => records(response).map((r) => String(r['id']))

const hint = (response: ApiResponse) =>
  (response.body as { error: { hint?: string } }).error.hint ?? ''

/** 案件を n 件足す。窓取得の検証には fixture の3件では足りない。 */
function addDeals(f: Fixture, n: number, prefix = 'x'): void {
  for (let i = 0; i < n; i += 1) {
    f.request('POST', '/api/deal?flow=sales', {
      body: {
        companyId: 'co-1',
        title: `${prefix}-${String(i).padStart(3, '0')}`,
        productType: i % 2 === 0 ? 'meo' : 'job_ad',
        dealType: 'new',
        status: 'open',
        ownerEmployeeId: 'e-yamada',
        ...(i % 3 === 0 ? { monthlyProfit: 10_000 + i } : {}),
      },
    })
  }
}

describe('窓取得', () => {
  it('total は窓の外も含めた件数', () => {
    const f = fixture()
    addDeals(f, 17)
    const response = f.request('GET', '/api/deal?flow=sales&limit=5')
    expect(page(response).total).toBe(20)
    expect(ids(response)).toHaveLength(5)
    expect(page(response).offset).toBe(0)
  })

  it('offset で切った窓を繋ぐと、全行がちょうど一度ずつ出る', () => {
    const f = fixture()
    addDeals(f, 17)
    const collected: string[] = []
    for (let offset = 0; offset < 20; offset += 5) {
      collected.push(...ids(f.request('GET', `/api/deal?flow=sales&limit=5&offset=${offset}`)))
    }
    expect(collected).toHaveLength(20)
    expect(new Set(collected).size).toBe(20)
  })

  /**
   * 決定A の核心。既定の並びは「更新が新しい順」なので、窓の合間に1件更新すると
   * その行が先頭へ動き、後ろの窓では**同じ行が二度出て別の行が消える**。
   */
  it('窓の合間に別ユーザーが更新しても、行の重複・欠落が起きない（snapshot 固定）', () => {
    const f = fixture()
    addDeals(f, 17)

    const first = f.request('GET', '/api/deal?flow=sales&limit=10')
    const pinned = page(first).now
    const head = ids(first)

    // 別ユーザーが、後ろの窓に入るはずだった行を1件更新する。
    // 既定の並びは更新が新しい順なので、この行は先頭へ動き、以降がすべて1つずれる
    const moved = ids(f.request('GET', '/api/deal?flow=sales&limit=1&offset=15'))[0] as string
    const updated = f.request('PATCH', `/api/deal/${moved}?flow=sales`, {
      user: ADMIN,
      body: { note: '更新した' },
      now: T_LATER,
    })
    expect(updated.status).toBe(200)

    // 固定した時点で続きを引く
    const rest = ids(f.request('GET', `/api/deal?flow=sales&limit=10&offset=10&snapshot=${pinned}`))
    const all = [...head, ...rest]
    expect(all).toHaveLength(20)
    expect(new Set(all).size).toBe(20)

    // 固定しないと壊れることも示す（対策が効いている証拠）
    const unpinned = ids(f.request('GET', '/api/deal?flow=sales&limit=10&offset=10'))
    const broken = [...head, ...unpinned]
    expect(new Set(broken).size).toBeLessThan(20)
  })

  it('snapshot 固定でも _permissions.update は落ちない（as_of と違う。決定A）', () => {
    const f = fixture()
    const now = page(f.request('GET', '/api/deal?flow=sales')).now

    const pinned = records(f.request('GET', `/api/deal?flow=sales&snapshot=${now}`))
    expect(permissionsOf(pinned[0] as Record<string, unknown>)['update']).toBe(true)

    // 過去を見ているときは読み取り専用のまま
    const historical = records(f.request('GET', `/api/deal?flow=sales&as_of=${now}`))
    expect(permissionsOf(historical[0] as Record<string, unknown>)['update']).toBe(false)
  })

  it('snapshot は書き込みに付けられない', () => {
    const f = fixture()
    const response = f.request('PATCH', '/api/deal/d-1?flow=sales&snapshot=2026-07-15T00:00:00Z', {
      body: { note: 'x' },
    })
    expect(response.status).toBe(400)
    expect(hint(response)).toContain('書き込みは常に現在')
  })

  it('offset が負なら 400', () => {
    const f = fixture()
    expect(f.request('GET', '/api/deal?flow=sales&offset=-1').status).toBe(400)
  })
})

describe('並び', () => {
  it('フィールドで並べ替えられる。NULL は末尾', () => {
    const f = fixture()
    // d-1 に金額あり、d-2 / d-3 は NULL
    const asc = ids(f.request('GET', '/api/deal?flow=sales&sort=initialBilling:asc'))
    expect(asc[0]).toBe('d-1')
    expect(asc.slice(1).sort()).toEqual(['d-2', 'd-3'])
  })

  it('現在ステップは定義の宣言順で並ぶ', () => {
    const f = fixture()
    // 宣言順は contacted → qualified → …。d-2 が contacted
    expect(ids(f.request('GET', `/api/deal?flow=sales&sort=_step:asc`))[0]).toBe('d-2')
  })

  it('未知の sort キーは 400 + 使えるキーの一覧', () => {
    const f = fixture()
    const response = f.request('GET', '/api/deal?flow=sales&sort=nosuch:asc')
    expect(response.status).toBe(400)
    expect(hint(response)).toContain('expectedCloseMonth')
    expect(hint(response)).toContain('_step')
  })

  it('sort の形が違えば 400', () => {
    const f = fixture()
    expect(f.request('GET', '/api/deal?flow=sales&sort=title:up').status).toBe(400)
  })

  it('target でないテーブルは _step で並べられない', () => {
    const f = fixture()
    const response = f.request('GET', '/api/company?flow=sales&sort=_step:asc')
    expect(response.status).toBe(400)
    expect(hint(response)).toContain('deal')
  })
})

describe('フィルタ', () => {
  it('enum は候補の列挙（IN）', () => {
    const f = fixture()
    const response = f.request('GET', '/api/deal?flow=sales&productType=meo,other')
    expect(ids(response).sort()).toEqual(['d-2', 'd-3'])
    expect(page(response).total).toBe(2)
  })

  it('text は部分一致（contains → LIKE）', () => {
    const f = fixture()
    expect(ids(f.request('GET', '/api/deal?flow=sales&title_like=求人'))).toEqual(['d-1'])
    // ワイルドカードは効かない（value はパターンではない）
    expect(ids(f.request('GET', '/api/deal?flow=sales&title_like=%'))).toEqual([])
  })

  it('レンジは _gte / _lte', () => {
    const f = fixture()
    expect(ids(f.request('GET', '/api/deal?flow=sales&initialBilling_gte=180000'))).toEqual(['d-1'])
    expect(ids(f.request('GET', '/api/deal?flow=sales&initialBilling_gte=180001'))).toEqual([])
  })

  it('step で絞れる', () => {
    const f = fixture()
    expect(ids(f.request('GET', '/api/deal?flow=sales&step=contacted'))).toEqual(['d-2'])
  })

  it('複数のパラメータは and で束ねる', () => {
    const f = fixture()
    const response = f.request('GET', '/api/deal?flow=sales&status=open&step=qualified')
    expect(ids(response).sort()).toEqual(['d-1', 'd-3'])
  })

  /**
   * `me` を `currentUser.id` に置換せず context ノードにしたので（決定C）、
   * **同じ URL が読み手ごとに違う結果になる**。「自分の案件」という語の意味に合わせた挙動。
   */
  it('me はログインユーザー自身を指す（URL を共有すると読み手にとっての自分になる）', () => {
    const f = fixture()
    const url = '/api/deal?flow=sales&ownerEmployeeId=me'
    expect(ids(f.request('GET', url, { user: YAMADA })).sort()).toEqual(['d-1', 'd-2'])
    expect(ids(f.request('GET', url, { user: SATO }))).toEqual(['d-3'])
  })

  it('me と id を混ぜられる', () => {
    const f = fixture()
    const response = f.request('GET', '/api/deal?flow=sales&ownerEmployeeId=me,e-sato')
    expect(ids(response).sort()).toEqual(['d-1', 'd-2', 'd-3'])
  })

  it('未知のパラメータは 400 + 直し方のヒント', () => {
    const f = fixture()
    const response = f.request('GET', '/api/deal?flow=sales&nosuch=1')
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('bad-request')
    expect(hint(response)).toContain('_like')
    expect(hint(response)).toContain('expectedCloseMonth')
  })

  it('型に合わない値は 400 + 候補や書き方', () => {
    const f = fixture()
    expect(hint(f.request('GET', '/api/deal?flow=sales&status=nosuch'))).toContain('abandoned')
    expect(hint(f.request('GET', '/api/deal?flow=sales&initialBilling_gte=たくさん'))).toContain(
      '整数',
    )
    expect(hint(f.request('GET', '/api/deal?flow=sales&expectedCloseMonth=2026-8'))).toContain(
      'YYYY-MM',
    )
  })

  it('型に合わない演算子は 400', () => {
    const f = fixture()
    // 部分一致は text だけ
    expect(f.request('GET', '/api/deal?flow=sales&status_like=open').status).toBe(400)
    // レンジは順序のある型だけ
    expect(f.request('GET', '/api/deal?flow=sales&title_gte=あ').status).toBe(400)
  })

  it('未知の step は 400 + 使えるステップの一覧', () => {
    const f = fixture()
    const response = f.request('GET', '/api/deal?flow=sales&step=nosuch')
    expect(response.status).toBe(400)
    expect(hint(response)).toContain('contacted')
  })
})
