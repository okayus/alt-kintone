/**
 * セル移動の状態遷移。docs/impl/phase-7-list-grid-edit.md §4
 *
 * 仮想化された一覧では「フォーカスしているセルの DOM が存在しない」ことが普通に
 * あるので、移動は DOM に触らない純関数として固定する。
 */
import { describe, expect, it } from 'vitest'
import { clampPos, keyToMove, moveFocus } from './gridCursor'

/** 10行 × 3列の小さなグリッドで端の挙動を見る。 */
const BOUNDS = { rows: 10, cols: 3 }

describe('moveFocus', () => {
  it('矢印は軸ごとに動き、端でクランプされる', () => {
    expect(moveFocus({ row: 5, col: 1 }, 'up', BOUNDS)).toEqual({ row: 4, col: 1 })
    expect(moveFocus({ row: 5, col: 1 }, 'down', BOUNDS)).toEqual({ row: 6, col: 1 })
    expect(moveFocus({ row: 5, col: 1 }, 'left', BOUNDS)).toEqual({ row: 5, col: 0 })
    expect(moveFocus({ row: 5, col: 1 }, 'right', BOUNDS)).toEqual({ row: 5, col: 2 })

    expect(moveFocus({ row: 0, col: 0 }, 'up', BOUNDS)).toEqual({ row: 0, col: 0 })
    expect(moveFocus({ row: 0, col: 0 }, 'left', BOUNDS)).toEqual({ row: 0, col: 0 })
    expect(moveFocus({ row: 9, col: 2 }, 'down', BOUNDS)).toEqual({ row: 9, col: 2 })
    expect(moveFocus({ row: 9, col: 2 }, 'right', BOUNDS)).toEqual({ row: 9, col: 2 })
  })

  it('Tab（next）は行末で次の行頭へ折り返す。最終セルでは動かない', () => {
    expect(moveFocus({ row: 3, col: 1 }, 'next', BOUNDS)).toEqual({ row: 3, col: 2 })
    expect(moveFocus({ row: 3, col: 2 }, 'next', BOUNDS)).toEqual({ row: 4, col: 0 })
    expect(moveFocus({ row: 9, col: 2 }, 'next', BOUNDS)).toEqual({ row: 9, col: 2 })
  })

  it('Shift+Tab（prev）は行頭で前の行末へ折り返す。先頭セルでは動かない', () => {
    expect(moveFocus({ row: 3, col: 1 }, 'prev', BOUNDS)).toEqual({ row: 3, col: 0 })
    expect(moveFocus({ row: 3, col: 0 }, 'prev', BOUNDS)).toEqual({ row: 2, col: 2 })
    expect(moveFocus({ row: 0, col: 0 }, 'prev', BOUNDS)).toEqual({ row: 0, col: 0 })
  })

  /**
   * ソフト世代（決定K）で総件数が減ると、フォーカス行が範囲外に取り残されることがある。
   * 移動の入口でクランプするので、範囲外からの移動も必ず範囲内に戻る。
   */
  it('範囲外のフォーカスからの移動は、まず範囲に収めてから動く', () => {
    expect(moveFocus({ row: 99, col: 1 }, 'up', BOUNDS)).toEqual({ row: 8, col: 1 })
    expect(moveFocus({ row: 99, col: 1 }, 'down', BOUNDS)).toEqual({ row: 9, col: 1 })
  })
})

describe('clampPos', () => {
  it('範囲に収める。空のグリッドでも負にならない', () => {
    expect(clampPos({ row: 99, col: 99 }, BOUNDS)).toEqual({ row: 9, col: 2 })
    expect(clampPos({ row: -1, col: -1 }, BOUNDS)).toEqual({ row: 0, col: 0 })
    expect(clampPos({ row: 5, col: 1 }, { rows: 0, cols: 0 })).toEqual({ row: 0, col: 0 })
  })
})

describe('keyToMove', () => {
  it('矢印と Tab / Shift+Tab を移動に写す。それ以外は undefined', () => {
    expect(keyToMove('ArrowUp', false)).toBe('up')
    expect(keyToMove('ArrowDown', false)).toBe('down')
    expect(keyToMove('ArrowLeft', false)).toBe('left')
    expect(keyToMove('ArrowRight', false)).toBe('right')
    expect(keyToMove('Tab', false)).toBe('next')
    expect(keyToMove('Tab', true)).toBe('prev')
    expect(keyToMove('Enter', false)).toBeUndefined()
    expect(keyToMove('a', false)).toBeUndefined()
  })
})
