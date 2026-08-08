/**
 * URL に置く並びの語彙。docs/impl/phase-6-list-grid.md 論点C・D
 *
 * フィルタ本体（`useDealQuery`）は nuqs のフックなのでここでは触らない。
 * **純粋な部分＝並びの解釈と一周のしかた**だけ固定する。
 */
import { describe, expect, it } from 'vitest'
import { dealQueryParsers, nextSort, parseSort, STEP_SORT_KEY } from './dealQuery'

describe('parseSort', () => {
  it('`<キー>:asc|desc` を読む。向きの省略は昇順', () => {
    expect(parseSort('expectedCloseMonth:desc')).toEqual({
      key: 'expectedCloseMonth',
      direction: 'desc',
    })
    expect(parseSort('title')).toEqual({ key: 'title', direction: 'asc' })
    expect(parseSort(STEP_SORT_KEY)).toEqual({ key: STEP_SORT_KEY, direction: 'asc' })
  })

  it('空なら未指定（既定＝更新が新しい順）', () => {
    expect(parseSort(undefined)).toBeUndefined()
    expect(parseSort('')).toBeUndefined()
    expect(parseSort(':desc')).toBeUndefined()
  })
})

describe('nextSort', () => {
  /**
   * 「既定に戻れる」が要る。既定は valid_from の降順で、どのフィールドでも表現できない
   * 並びなので、解除できないと元に戻す手段が無くなる。
   */
  it('昇順 → 降順 → 解除 で一周する', () => {
    const key = 'expectedCloseMonth'
    expect(nextSort(undefined, key)).toBe(`${key}:asc`)
    expect(nextSort({ key, direction: 'asc' }, key)).toBe(`${key}:desc`)
    expect(nextSort({ key, direction: 'desc' }, key)).toBeNull()
  })

  it('別の列を押したら、その列の昇順から始まる', () => {
    expect(nextSort({ key: 'title', direction: 'desc' }, 'status')).toBe('status:asc')
  })
})

describe('URL の語彙', () => {
  /**
   * **キーは API のパラメータ名そのもの**（論点C-1）。変換表を作らないので、
   * 共有された URL を読めば何で絞られているかが分かる。
   */
  it('サーバの語彙（IN / レンジ / 部分一致）に一致している', () => {
    const keys = Object.keys(dealQueryParsers)
    expect(keys).toContain('step')
    expect(keys).toContain('status')
    expect(keys).toContain('expectedCloseMonth_gte')
    expect(keys).toContain('expectedCloseMonth_lte')
    expect(keys).toContain('title_like')
    // フィルタではないが同じ場所に置く
    expect(keys).toContain('sort')
  })
})
