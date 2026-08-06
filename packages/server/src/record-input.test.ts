/**
 * 書き込み値の検証。定義そのものが入力仕様である、が要点。
 *
 * 定義に無いフィールドを黙って捨てないこと（「保存したのに消えている」は
 * 一番デバッグしにくい壊れ方）と、enum の候補をエラーに出すことを見る。
 */
import { ApiError } from './api.js'
import { validateInput } from './record-input.js'
import { bundle } from './support.js'
import type { TableDef } from '@alt/dsl'
import { describe, expect, it } from 'vitest'

const deal = bundle.tables['deal'] as TableDef
const contact = bundle.tables['contact'] as TableDef

const complete = {
  companyId: 'co-1',
  title: '案件',
  productType: 'job_ad',
  dealType: 'new',
  status: 'open',
  ownerEmployeeId: 'e-yamada',
}

const failure = (fn: () => unknown): ApiError => {
  try {
    fn()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('エラーにならなかった')
}

describe('validateInput', () => {
  it('定義どおりの値は通る', () => {
    expect(validateInput(deal, complete, { partial: false })).toEqual(complete)
  })

  it('定義に無いフィールドは候補つきで弾く', () => {
    const error = failure(() => validateInput(deal, { ...complete, amount: 1 }, { partial: false }))
    expect(error.status).toBe(400)
    expect(error.hint).toContain('initialBilling')
  })

  it('サーバが埋める列は受け付けない', () => {
    for (const key of ['id', 'valid_from', 'changed_by']) {
      expect(failure(() => validateInput(deal, { [key]: 'x' }, { partial: true })).status).toBe(400)
    }
  })

  it('enum は候補を出す', () => {
    const error = failure(() =>
      validateInput(deal, { ...complete, productType: '求人広告' }, { partial: false }),
    )
    expect(error.hint).toContain('job_ad')
  })

  it('型が違えば弾く', () => {
    expect(
      failure(() => validateInput(deal, { initialBilling: '18万' }, { partial: true })).status,
    ).toBe(400)
    expect(
      failure(() => validateInput(deal, { initialBilling: 1.5 }, { partial: true })).status,
    ).toBe(400)
    expect(
      failure(() => validateInput(contact, { isDecisionMaker: 1 }, { partial: true })).status,
    ).toBe(400)
  })

  it('日付の形を見る', () => {
    expect(validateInput(deal, { closedAt: '2026-07-08' }, { partial: true })).toEqual({
      closedAt: '2026-07-08',
    })
    expect(
      failure(() => validateInput(deal, { closedAt: '2026/07/08' }, { partial: true })).status,
    ).toBe(400)
    expect(
      failure(() => validateInput(deal, { expectedCloseMonth: '2026-7' }, { partial: true }))
        .status,
    ).toBe(400)
  })

  it('作成では必須フィールドを要求する（id は除く）', () => {
    const error = failure(() =>
      validateInput(deal, { companyId: 'co-1', title: 'a' }, { partial: false }),
    )
    expect(error.message).toContain('必須')
  })

  it('更新（partial）では必須フィールドを求めない', () => {
    expect(validateInput(deal, { note: 'メモ' }, { partial: true })).toEqual({ note: 'メモ' })
  })

  it('必須フィールドに null は入れられない', () => {
    expect(failure(() => validateInput(deal, { title: null }, { partial: true })).status).toBe(400)
    // 任意のフィールドは null にできる（値を消す操作）
    expect(validateInput(deal, { note: null }, { partial: true })).toEqual({ note: null })
  })

  it('body がオブジェクトでなければ弾く', () => {
    expect(failure(() => validateInput(deal, [1, 2], { partial: true })).status).toBe(400)
    expect(failure(() => validateInput(deal, 'x', { partial: true })).status).toBe(400)
  })
})
