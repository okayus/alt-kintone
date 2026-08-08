/**
 * セルの論理フォーカスの移動。docs/impl/phase-7-list-grid-edit.md §2-1・§4
 *
 * 仮想化でセルの DOM はスクロールとともに消えるので、フォーカスは DOM ではなく
 * `{row, col}` の状態で持つ（roving tabindex にしない理由）。ここはその状態遷移だけの
 * 純関数。キーイベントとの対応・スクロール追従は `DealList.tsx` 側。
 */

export interface CellPos {
  row: number
  col: number
}

export interface GridBounds {
  /** 行数（= 絞り込みに一致する総件数）。 */
  rows: number
  cols: number
}

/** 矢印 = 軸ごとのクランプ移動。next / prev = Tab の折り返し移動。 */
export type FocusMove = 'up' | 'down' | 'left' | 'right' | 'next' | 'prev'

/**
 * 範囲に収める。ソフト世代で総件数が減る（編集した行が絞り込みから外れる等）と
 * フォーカスが範囲外に取り残されることがあるので、移動の前に必ず通す。
 */
export function clampPos(pos: CellPos, bounds: GridBounds): CellPos {
  return {
    row: Math.min(Math.max(0, pos.row), Math.max(0, bounds.rows - 1)),
    col: Math.min(Math.max(0, pos.col), Math.max(0, bounds.cols - 1)),
  }
}

export function moveFocus(pos: CellPos, move: FocusMove, bounds: GridBounds): CellPos {
  const from = clampPos(pos, bounds)
  const lastRow = bounds.rows - 1
  const lastCol = bounds.cols - 1

  switch (move) {
    case 'up':
      return { ...from, row: Math.max(0, from.row - 1) }
    case 'down':
      return { ...from, row: Math.min(lastRow, from.row + 1) }
    case 'left':
      return { ...from, col: Math.max(0, from.col - 1) }
    case 'right':
      return { ...from, col: Math.min(lastCol, from.col + 1) }
    case 'next':
      if (from.col < lastCol) return { ...from, col: from.col + 1 }
      // 行末は次の行頭へ折り返す。最終セルなら動かない
      return from.row < lastRow ? { row: from.row + 1, col: 0 } : from
    case 'prev':
      if (from.col > 0) return { ...from, col: from.col - 1 }
      return from.row > 0 ? { row: from.row - 1, col: lastCol } : from
  }
}

/** キー入力 → 移動。対応しないキーは undefined（呼び出し側は default に任せる）。 */
export function keyToMove(key: string, shiftKey: boolean): FocusMove | undefined {
  switch (key) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'Tab':
      return shiftKey ? 'prev' : 'next'
    default:
      return undefined
  }
}
