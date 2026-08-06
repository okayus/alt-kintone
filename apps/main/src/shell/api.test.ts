/**
 * API クライアントの組み立てと、サーバのエラー本文の解釈。
 *
 * `flow` が全リクエストに付くこと（サーバは省略時に「複数フローで使われている」と
 * 落とすことがある）と、**`hint` を捨てないこと**を固定する。
 */
import { ApiError, buildQuery, toApiError } from './api'
import { describe, expect, it } from 'vitest'

describe('buildQuery', () => {
  it('flow を必ず付ける', () => {
    expect(buildQuery('sales')).toBe('?flow=sales')
  })

  it('as_of を付ける', () => {
    expect(buildQuery('sales', { asOf: '2026-07-05T12:00:00.000Z' })).toBe(
      '?flow=sales&as_of=2026-07-05T12%3A00%3A00.000Z',
    )
  })

  it('空の as_of は付けない（現在を見る）', () => {
    expect(buildQuery('sales', { asOf: '' })).toBe('?flow=sales')
    expect(buildQuery('sales', { asOf: undefined })).toBe('?flow=sales')
  })
})

describe('toApiError', () => {
  it('サーバの code / message / hint を保つ', () => {
    const error = toApiError(403, {
      error: {
        code: 'forbidden',
        message: '自分が担当のレコードではない',
        hint: '担当者に依頼する',
      },
    })
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(403)
    expect(error.code).toBe('forbidden')
    expect(error.message).toBe('自分が担当のレコードではない')
    expect(error.hint).toBe('担当者に依頼する')
  })

  it('本文が読めなくてもステータスだけで作る', () => {
    const error = toApiError(500, undefined)
    expect(error.code).toBe('unknown')
    expect(error.message).toContain('500')
    expect(error.hint).toBeUndefined()
  })
})
