/**
 * 書き込み値の検証。定義そのものが入力仕様である、が要点。
 *
 * 定義に無いフィールドを黙って捨てないこと（「保存したのに消えている」は
 * 一番デバッグしにくい壊れ方）と、enum の候補をエラーに出すことを見る。
 */
import { ApiError } from './api.js'
import { validateInput } from './record-input.js'
import { bundle } from './support.js'
import { createdAt, definitionRef, table, text, uuid, type TableDef } from '@alt/dsl'
import { describe, expect, it } from 'vitest'

const deal = bundle.tables['deal'] as TableDef
const contact = bundle.tables['contact'] as TableDef

/** `definitionRef` の解決範囲。`DefinitionBundle` はそのまま `DefinitionScope` を満たす。 */
const defs = bundle

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
    expect(validateInput(deal, complete, { partial: false, defs })).toEqual(complete)
  })

  it('定義に無いフィールドは候補つきで弾く', () => {
    const error = failure(() =>
      validateInput(deal, { ...complete, amount: 1 }, { partial: false, defs }),
    )
    expect(error.status).toBe(400)
    expect(error.hint).toContain('initialBilling')
  })

  it('サーバが埋める列は受け付けない', () => {
    for (const key of ['id', 'valid_from', 'changed_by']) {
      expect(
        failure(() => validateInput(deal, { [key]: 'x' }, { partial: true, defs })).status,
      ).toBe(400)
    }
  })

  it('enum は候補を出す', () => {
    const error = failure(() =>
      validateInput(deal, { ...complete, productType: '求人広告' }, { partial: false, defs }),
    )
    expect(error.hint).toContain('job_ad')
  })

  it('型が違えば弾く', () => {
    expect(
      failure(() => validateInput(deal, { initialBilling: '18万' }, { partial: true, defs }))
        .status,
    ).toBe(400)
    expect(
      failure(() => validateInput(deal, { initialBilling: 1.5 }, { partial: true, defs })).status,
    ).toBe(400)
    expect(
      failure(() => validateInput(contact, { isDecisionMaker: 1 }, { partial: true, defs })).status,
    ).toBe(400)
  })

  it('日付の形を見る', () => {
    expect(validateInput(deal, { closedAt: '2026-07-08' }, { partial: true, defs })).toEqual({
      closedAt: '2026-07-08',
    })
    expect(
      failure(() => validateInput(deal, { closedAt: '2026/07/08' }, { partial: true, defs }))
        .status,
    ).toBe(400)
    expect(
      failure(() => validateInput(deal, { expectedCloseMonth: '2026-7' }, { partial: true, defs }))
        .status,
    ).toBe(400)
  })

  it('作成では必須フィールドを要求する（id は除く）', () => {
    const error = failure(() =>
      validateInput(deal, { companyId: 'co-1', title: 'a' }, { partial: false, defs }),
    )
    expect(error.message).toContain('必須')
  })

  it('更新（partial）では必須フィールドを求めない', () => {
    expect(validateInput(deal, { note: 'メモ' }, { partial: true, defs })).toEqual({ note: 'メモ' })
  })

  it('必須フィールドに null は入れられない', () => {
    expect(
      failure(() => validateInput(deal, { title: null }, { partial: true, defs })).status,
    ).toBe(400)
    // 任意のフィールドは null にできる（値を消す操作）
    expect(validateInput(deal, { note: null }, { partial: true, defs })).toEqual({ note: null })
  })

  it('body がオブジェクトでなければ弾く', () => {
    expect(failure(() => validateInput(deal, [1, 2], { partial: true, defs })).status).toBe(400)
    expect(failure(() => validateInput(deal, 'x', { partial: true, defs })).status).toBe(400)
  })
})

/**
 * 定義を指すフィールドと、サーバが埋めるフィールド
 * （docs/impl/phase-9-change-requests.md §7-1）。
 *
 * テーブルはここで組み立てる。検査したいのは「定義バンドル全体を候補にする」ことなので、
 * **突き合わせ先は本物の営業フロー**（`bundle`）にしてある。
 */
describe('validateInput — definitionRef / fill', () => {
  const request = table(
    'req',
    {
      id: uuid('ID').primaryKey(),
      body: text('本文').required(),
      targetStep: definitionRef('step', '対象のステップ'),
      filedAt: createdAt('起票日時'),
    },
    { label: '要望' },
  )

  it('定義に実在する対象は通る', () => {
    expect(
      validateInput(request, { body: 'x', targetStep: 'sales.proposed' }, { partial: true, defs }),
    ).toEqual({ body: 'x', targetStep: 'sales.proposed' })
  })

  it('解決できない対象は候補つきで弾く', () => {
    const error = failure(() =>
      validateInput(request, { targetStep: 'sales.propose' }, { partial: true, defs }),
    )
    expect(error.status).toBe(400)
    expect(error.hint).toContain('sales.proposed')
  })

  it('kind が違う値も弾く（フローキーをステップとして渡す）', () => {
    expect(
      failure(() => validateInput(request, { targetStep: 'sales' }, { partial: true, defs }))
        .status,
    ).toBe(400)
  })

  it('サーバが埋めるフィールドは入力として拒否する（黙って捨てない）', () => {
    const error = failure(() =>
      validateInput(request, { filedAt: '2026-08-09T00:00:00.000Z' }, { partial: true, defs }),
    )
    expect(error.status).toBe(400)
    expect(error.hint).toContain('クライアントの時計は使わない')
  })

  it('required でも fill があれば作成時の入力に要らない', () => {
    expect(validateInput(request, { body: 'x' }, { partial: false, defs })).toEqual({ body: 'x' })
  })
})
