/**
 * キーの規約。docs/impl/phase-12-data-fetching.md 論点C
 *
 * ここで固定するのは**取得の同一性**そのもの。キーが同じなら共有され、違えば別の取得
 * になるので、「別フローの認可範囲のキャッシュを読む」「切替後に前の利用者の数が見える」
 * といった壊れ方は、全部この関数の出力の問題に還元される。
 */
import { hashKey } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createClient } from './api'
import { keyOf } from './query'

const noHeaders = () => ({})
const sales = createClient(noHeaders, 'sales')
const request = createClient(noHeaders, 'request')

const now = { user: 'yamada@example.com', asOf: undefined }

describe('keyOf', () => {
  it('先頭はクライアントのフロー（画面が文字列で渡さない）', () => {
    expect(keyOf(sales, 'deal', now)).toEqual(['sales', 'deal', 'yamada@example.com', undefined])
  })

  it('同じテーブルでもフローが違えば別のキー（決定14。認可の範囲が違う）', () => {
    expect(hashKey(keyOf(sales, 'employee', now))).not.toBe(
      hashKey(keyOf(request, 'employee', now)),
    )
  })

  it('利用者が違えば別のキー（決定N をキーの同一性で保証する）', () => {
    expect(hashKey(keyOf(sales, 'deal', now))).not.toBe(
      hashKey(keyOf(sales, 'deal', { user: 'mori@example.com', asOf: undefined })),
    )
  })

  it('時点が違えば別のキー', () => {
    expect(hashKey(keyOf(sales, 'deal', now))).not.toBe(
      hashKey(keyOf(sales, 'deal', { ...now, asOf: '2026-07-01T00:00:00.000Z' })),
    )
  })

  it('画面固有の識別子は後ろに並ぶ', () => {
    expect(keyOf(sales, 'deal_message', now, 'd-1')).toEqual([
      'sales',
      'deal_message',
      'yamada@example.com',
      undefined,
      'd-1',
    ])
  })

  it('絞り込みはオブジェクトのまま置ける（キーの並び順に依存しない）', () => {
    const a = keyOf(sales, 'deal', now, { status: 'open', step: 'proposed' })
    const b = keyOf(sales, 'deal', now, { step: 'proposed', status: 'open' })
    expect(hashKey(a)).toBe(hashKey(b))
  })

  it('絞り込みの中身が違えば別のキー', () => {
    expect(hashKey(keyOf(sales, 'deal', now, { status: 'open' }))).not.toBe(
      hashKey(keyOf(sales, 'deal', now, { status: 'won' })),
    )
  })
})
