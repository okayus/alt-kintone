/**
 * 有効期間型の読み書き。**このフェーズで避けて通れない部分**（docs/product-concept.md §4-1）。
 *
 * 見るのは「更新が UPDATE ではなく『閉じて INSERT』になっているか」と
 * 「`as_of` で過去のバージョンが読めるか」。ここが成立していないと、
 * 『先月末時点のパイプライン』という要求（sales-domain.md §14）に永久に答えられない。
 */
import { closeCurrentRow } from '@alt/sql'
import { errorCode, fixture, record, records, SEEDED_AT, YAMADA } from './support.js'
import { describe, expect, it } from 'vitest'

const LATER = '2026-08-01T00:00:00.000Z'

describe('一覧・詳細', () => {
  it('定義のフィールド名（camelCase）で返る。列名は外に出ない', () => {
    const view = record(fixture().request('GET', '/api/deal/d-1?flow=sales'))
    expect(view['initialBilling']).toBe(180000)
    expect(view['companyId']).toBe('co-1')
    expect(view['initial_billing']).toBeUndefined()
  })

  it('boolean は 0/1 ではなく true/false で返る', () => {
    const [boss] = records(fixture().request('GET', '/api/contact?flow=sales')).filter(
      (r) => r['id'] === 'ct-boss',
    )
    expect(boss?.['isDecisionMaker']).toBe(true)
  })

  it('_version に変更の文脈（誰が・どのフローで）が乗る', () => {
    const view = record(fixture().request('GET', '/api/deal/d-1?flow=sales'))
    expect(view['_version']).toEqual({
      validFrom: SEEDED_AT,
      validTo: null,
      changedBy: 'e-admin',
      changedFlow: 'sales',
      changedStep: null,
    })
  })

  it('存在しないレコードは 404', () => {
    const response = fixture().request('GET', '/api/deal/nope?flow=sales')
    expect(response.status).toBe(404)
  })
})

describe('作成', () => {
  it('id はサーバが採番し、_flow_state の初期行も同時に作る', () => {
    const f = fixture()
    const response = f.request('POST', '/api/deal?flow=sales', {
      body: {
        companyId: 'co-1',
        title: '新規案件',
        productType: 'meo',
        dealType: 'new',
        status: 'open',
        ownerEmployeeId: 'e-yamada',
      },
    })

    expect(response.status).toBe(201)
    const view = record(response)
    expect(typeof view['id']).toBe('string')
    // initial に置かれる（「案件は常にちょうど1つのステップにいる」を作った瞬間から成立させる）
    expect((view['_flow'] as Record<string, unknown>)['step']).toBe('contacted')

    const state = f.rows('SELECT * FROM "_flow_state" WHERE "record_id" = ?', view['id'])
    expect(state).toHaveLength(1)
    expect(state[0]?.['valid_to']).toBeNull()
  })

  it('id を渡すと拒否する（サーバが埋める列）', () => {
    const response = fixture().request('POST', '/api/deal?flow=sales', {
      body: { id: 'x', companyId: 'co-1', title: 'a', productType: 'meo', dealType: 'new' },
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('bad-request')
  })

  it('必須フィールドが欠けていれば 400', () => {
    const response = fixture().request('POST', '/api/deal?flow=sales', {
      body: { companyId: 'co-1', title: 'a' },
    })
    expect(response.status).toBe(400)
  })
})

describe('更新（閉じて INSERT）', () => {
  it('前の行が閉じ、新しいバージョンが積まれる', () => {
    const f = fixture()
    f.request('PATCH', '/api/deal/d-1?flow=sales', {
      body: { initialBilling: 240000 },
      now: LATER,
    })

    const versions = f.rows('SELECT * FROM "deal" WHERE "id" = ? ORDER BY "valid_from"', 'd-1')
    expect(versions).toHaveLength(2)
    // 閉じた時刻と開いた時刻が同じ（半開区間なので、どの時点にも行はちょうど1つ）
    expect(versions[0]?.['valid_to']).toBe(LATER)
    expect(versions[1]?.['valid_from']).toBe(LATER)
    expect(versions[1]?.['valid_to']).toBeNull()
    expect(versions[0]?.['initial_billing']).toBe(180000)
    expect(versions[1]?.['initial_billing']).toBe(240000)
  })

  it('書かなかったフィールドは引き継がれる', () => {
    const f = fixture()
    f.request('PATCH', '/api/deal/d-1?flow=sales', { body: { initialBilling: 240000 } })
    const view = record(f.request('GET', '/api/deal/d-1?flow=sales'))
    expect(view['title']).toBe('求人広告')
    expect(view['ownerEmployeeId']).toBe('e-yamada')
  })

  it('changed_step はクライアントではなく _flow_state から決まる', () => {
    const f = fixture()
    const view = record(f.request('PATCH', '/api/deal/d-1?flow=sales', { body: { note: 'メモ' } }))
    expect((view['_version'] as Record<string, unknown>)['changedStep']).toBe('qualified')
    expect((view['_version'] as Record<string, unknown>)['changedBy']).toBe('e-yamada')
  })

  it('as_of で更新前のバージョンが読める', () => {
    const f = fixture()
    f.request('PATCH', '/api/deal/d-1?flow=sales', {
      body: { initialBilling: 240000 },
      now: LATER,
    })

    const now = record(f.request('GET', '/api/deal/d-1?flow=sales'))
    const past = record(f.request('GET', '/api/deal/d-1?flow=sales&as_of=2026-07-10T00:00:00.000Z'))
    expect(now['initialBilling']).toBe(240000)
    expect(past['initialBilling']).toBe(180000)
  })

  it('過去のバージョンには書けない（as_of は読み取り専用）', () => {
    const f = fixture()
    const past = record(f.request('GET', '/api/deal/d-1?flow=sales&as_of=2026-07-10T00:00:00.000Z'))
    expect((past['_permissions'] as Record<string, boolean>)['update']).toBe(false)

    const response = f.request('PATCH', '/api/deal/d-1?flow=sales&as_of=2026-07-10T00:00:00.000Z', {
      body: { note: 'x' },
    })
    expect(response.status).toBe(400)
  })

  /**
   * フェーズ11 の動作確認で見つけた欠陥。**`POST` は `as_of` を弾いていなかった**ので、
   * 行は現在に対して作られたのに、返すための読み直しが `as_of` 時点（＝まだ無い）
   * を見て 404 になっていた ＝ **書けたのに失敗と返る**。
   *
   * フェーズ8 の「POST だけ守りが1枚少ない」と同じ形（既存行を前提にした守りは、
   * 行がまだ無い操作をすり抜ける）なので、回帰テストにする。
   */
  it('as_of を付けた作成は、行を作らずに 400 で断る', () => {
    const f = fixture()
    const before = records(f.request('GET', '/api/deal?flow=sales')).length

    const response = f.request('POST', '/api/deal?flow=sales&as_of=2026-07-10T00:00:00.000Z', {
      body: {
        companyId: 'co-1',
        title: '過去に作る',
        productType: 'meo',
        dealType: 'new',
        status: 'open',
        ownerEmployeeId: 'e-yamada',
      },
    })
    expect(response.status).toBe(400)
    // **入っていないこと**が本題（404 を返しつつ書かれているのが元の壊れ方）
    expect(records(f.request('GET', '/api/deal?flow=sales')).length).toBe(before)
  })

  it('空の body は 400（何も起きない更新を通さない）', () => {
    const response = fixture().request('PATCH', '/api/deal/d-1?flow=sales', { body: {} })
    expect(response.status).toBe(400)
  })

  it('現在行を二度閉じられない（競合検出の土台）', () => {
    const f = fixture()
    const close = closeCurrentRow({ table: 'deal', id: 'd-1', now: LATER })
    const first = f.db.prepare(close.sql).run(...close.params)
    const second = f.db.prepare(close.sql).run(...close.params)
    // 2回目が 0 件 → 他のリクエストが先に閉じた、を検出できる（409 の判定条件）
    expect(first.changes).toBe(1)
    expect(second.changes).toBe(0)
  })

  it('更新のたびに履歴が積み上がる', () => {
    const f = fixture()
    f.request('PATCH', '/api/deal/d-1?flow=sales', { body: { note: '1' }, now: LATER })
    f.request('PATCH', '/api/deal/d-1?flow=sales', {
      body: { note: '2' },
      now: '2026-08-02T00:00:00.000Z',
      user: YAMADA,
    })
    expect(f.rows('SELECT * FROM "deal" WHERE "id" = ?', 'd-1')).toHaveLength(3)
    expect(
      f.rows('SELECT * FROM "deal" WHERE "id" = ? AND "valid_to" IS NULL', 'd-1'),
    ).toHaveLength(1)
  })
})
