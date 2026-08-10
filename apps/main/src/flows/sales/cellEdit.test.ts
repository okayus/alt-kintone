/**
 * セル編集の値の解釈。docs/impl/phase-7-list-grid-edit.md 決定N・P
 *
 * 定義は実物（`@alt/definitions` の deal）を使う。エディタの型・必須・候補が
 * 定義から決まることまで含めて固定するため。
 */
import { deal } from '@alt/definitions'
import { describe, expect, it } from 'vitest'
import { isChanged, parseDraft, toDraft } from './cellEdit'

function field(name: string) {
  const def = deal.fields[name]
  if (def === undefined) throw new Error(`deal に ${name} が無い`)
  return def
}

describe('toDraft', () => {
  it('null / undefined は空文字、それ以外は文字列', () => {
    expect(toDraft(null)).toBe('')
    expect(toDraft(undefined)).toBe('')
    expect(toDraft('看板')).toBe('看板')
    expect(toDraft(300000)).toBe('300000')
  })
})

describe('parseDraft', () => {
  it('text: 空は null。必須（案件名）の空は弾く', () => {
    expect(parseDraft(field('competitor'), '')).toEqual({ ok: true, value: null })
    expect(parseDraft(field('title'), '新看板')).toEqual({ ok: true, value: '新看板' })
    expect(parseDraft(field('title'), '')).toEqual({ ok: false, reason: '案件名は必須' })
  })

  it('integer: 数値に読み、非整数は弾く。空は null', () => {
    expect(parseDraft(field('initialBilling'), '300000')).toEqual({ ok: true, value: 300000 })
    expect(parseDraft(field('initialBilling'), '')).toEqual({ ok: true, value: null })
    expect(parseDraft(field('initialBilling'), '12.5')).toEqual({
      ok: false,
      reason: '整数で入力する',
    })
    expect(parseDraft(field('initialBilling'), 'abc')).toEqual({
      ok: false,
      reason: '整数で入力する',
    })
  })

  it('enum: key をそのまま通す（候補の検証はサーバ）。任意（確度）の空は null', () => {
    expect(parseDraft(field('confidence'), 'A')).toEqual({ ok: true, value: 'A' })
    expect(parseDraft(field('confidence'), '')).toEqual({ ok: true, value: null })
    expect(parseDraft(field('status'), '')).toEqual({ ok: false, reason: '状態は必須' })
  })

  it('yearMonth: ブラウザの month 入力の値をそのまま通す', () => {
    expect(parseDraft(field('expectedCloseMonth'), '2026-09')).toEqual({
      ok: true,
      value: '2026-09',
    })
    expect(parseDraft(field('expectedCloseMonth'), '')).toEqual({ ok: true, value: null })
  })
})

describe('isChanged', () => {
  /** 同値なら PATCH を送らない（Enter 連打で同値の版を積まない。決定N）。 */
  it('null と空の消し込みを同値として扱う', () => {
    expect(isChanged('看板', '看板')).toBe(false)
    expect(isChanged(null, null)).toBe(false)
    expect(isChanged(undefined, null)).toBe(false)
    expect(isChanged(300000, 300000)).toBe(false)
    expect(isChanged('看板', '新看板')).toBe(true)
    expect(isChanged(null, 'A')).toBe(true)
    expect(isChanged(300000, null)).toBe(true)
  })
})

// ⚠ IME ガード（`isImeKey`）のテストは `shell/keys.test.ts` へ移した（フェーズ11 T1）。
