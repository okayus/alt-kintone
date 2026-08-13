/**
 * サイドパネルの状態。docs/impl/phase-13-chat-side-panel.md 決定B
 *
 * 覚えるのは2つだけ — **開閉は画面種別ごと**、**幅は共通で1つ**。
 * URL には載せない（共有リンクに閲覧の好みを混ぜない）。前例は `shell/auth/dev-user.ts`。
 *
 * ⚠ **保存値と実効値を分けてある。** 保存するのは利用者の好みで、画面に効かせるのは
 *   それをウィンドウに収めた値（`clampWidth`）。同じにすると、狭いウィンドウで一度
 *   開いただけで広いモニタ用の好みが失われる。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampWidth,
  DEFAULT_WIDTH,
  openStorageKey,
  parseOpen,
  parseWidth,
  WIDTH_STORAGE_KEY,
  type PanelKind,
} from './panel'

export interface SidePanelState {
  open: boolean
  setOpen: (open: boolean) => void
  /** 実効の幅（ウィンドウに収めた後）。 */
  width: number
  /** ドラッグ中の更新。**保存しない**（離した時点で確定させる）。 */
  resizeTo: (px: number) => void
  /** ドラッグを終えたら呼ぶ。いまの幅を好みとして残す。 */
  saveWidth: () => void
  /** 既定幅に戻して保存する（ハンドルのダブルクリック。決定F）。 */
  resetWidth: () => void
}

export function useSidePanel(kind: PanelKind): SidePanelState {
  const [open, setOpenState] = useState(() => parseOpen(read(openStorageKey(kind))))
  const [preferred, setPreferred] = useState(() => parseWidth(read(WIDTH_STORAGE_KEY)))
  const [viewport, setViewport] = useState(() => window.innerWidth)

  // ウィンドウが変わったら実効幅を計り直す（保存値には触らない）
  useEffect(() => {
    const onResize = (): void => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const width = clampWidth(preferred, viewport)

  // 保存は「離したとき」なので、その時点の値を state と別に持っておく
  const latest = useRef(width)
  latest.current = width

  const setOpen = useCallback(
    (next: boolean): void => {
      setOpenState(next)
      write(openStorageKey(kind), String(next))
    },
    [kind],
  )

  const resizeTo = useCallback((px: number): void => {
    setPreferred(clampWidth(px, window.innerWidth))
  }, [])

  const saveWidth = useCallback((): void => {
    write(WIDTH_STORAGE_KEY, String(latest.current))
  }, [])

  const resetWidth = useCallback((): void => {
    setPreferred(DEFAULT_WIDTH)
    write(WIDTH_STORAGE_KEY, String(DEFAULT_WIDTH))
  }, [])

  return { open, setOpen, width, resizeTo, saveWidth, resetWidth }
}

function read(key: string): string | null {
  return window.localStorage.getItem(key)
}

function write(key: string, value: string): void {
  window.localStorage.setItem(key, value)
}
