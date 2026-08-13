/**
 * サイドパネル。docs/impl/phase-13-chat-side-panel.md 決定A・C・F・G
 *
 * **children を受けるだけで、中身が何かを知らない**（決定G）。知っているのは
 * 「開いているか・どれだけの幅か・閉じている間に中身が何件増えたか」の3つで、
 * やりとりの語彙（メッセージ・投稿・既読）は1つも入っていない。
 *
 * レイアウトは **push**（決定A）— 本文を覆わずに狭める。チャットは本文を見ながら
 * 書くものなので、overlay にすると動かした意味が消える。viewport に貼り付くので、
 * ページをどこまでスクロールしても見える（最下部の区画から動かした理由がこれ）。
 *
 * ⚠ **貼り付け方は fixed + シェルの余白**（実装で sticky から変えた。§7 の「実測で決める」）。
 *   sticky にすると流れの中の位置から `100vh` 伸びるので、スクロール 0 の時点で
 *   **入力欄が画面の下に切れる** — 開いた瞬間に書けないのでは動かした意味が消える。
 *
 * ⚠ **閉じても children を外さない**（決定C）。外すとポーリングが止まって
 *   「閉じている間に増えた」が数えられなくなる。隠すのは CSS で、React 木には残す。
 */
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { gutterWidth, newSince, nextBaseline } from './panel'
import type { SidePanelState } from './useSidePanel'
import { isImeKey } from '../keys'

export interface SidePanelProps {
  panel: SidePanelState
  /** 閉じたときのタブに出す名前。**開いているときの見出しは children が持つ**。 */
  title: string
  /**
   * 中身がいま何件あるか。`undefined` は「まだ読めていない」。
   * ⚠ **省略可能にしない** — 呼ぶ側に「読めていない状態」を意識させるため（決定C ⚠）。
   */
  count: number | undefined
  children: ReactNode
}

export function SidePanel({ panel, title, count, children }: SidePanelProps) {
  const { open, setOpen, width, resizeTo, saveWidth, resetWidth } = panel
  /** 「閉じてから増えた件数」の基準。開いている間は持たない（決定C）。 */
  const [baseline, setBaseline] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; width: number } | null>(null)

  useEffect(() => {
    setBaseline((current) => nextBaseline(open, count, current))
  }, [open, count])

  /**
   * シェルに空けさせる余白（決定A の push）。**パネルの外に触るのはここだけ。**
   *
   * 幅は viewport の割り当てなので、本文だけを狭めるとヘッダ・ナビ・バナーが
   * パネルの下に潜る。画面を離れたら消す（一覧に戻って余白だけ残るのを防ぐ）。
   */
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--side-panel-gutter', `${gutterWidth(open, width)}px`)
    return () => {
      root.style.removeProperty('--side-panel-gutter')
    }
  }, [open, width])

  /** Esc で閉じる（決定F）。⚠ 変換取り消しの Esc では閉じない。 */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isImeKey(event)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  /** ドラッグ中はページの文字を選ばせない（掴んだまま本文をなぞってしまう）。 */
  useEffect(() => {
    if (!dragging) return
    document.body.classList.add('panel-resizing')
    return () => document.body.classList.remove('panel-resizing')
  }, [dragging])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    // ポインタを掴んでおく（依存なしで、本文の上まで引いても追える。決定F）
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width }
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current
    if (start === null) return
    // パネルは右端にあるので、左へ引くと広がる
    resizeTo(start.width + (start.x - event.clientX))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) return
    drag.current = null
    setDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
    saveWidth()
  }

  const badge = newSince(count, baseline)

  return (
    <div className="side-panel-root" data-open={open} style={open ? { width } : undefined}>
      {!open && (
        <button
          type="button"
          className="side-panel-toggle"
          onClick={() => setOpen(true)}
          title={`${title}を開く`}
        >
          <span className="side-panel-toggle-label">{title}</span>
          {/* 未読ではなく「閉じている間に増えたぶん」（決定C）。開けば消える */}
          {badge > 0 && (
            <span className="badge badge-new" title="閉じてから増えたぶん">
              +{badge}
            </span>
          )}
        </button>
      )}

      <div
        className="side-panel-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetWidth}
        title="ドラッグで幅を変える / ダブルクリックで既定幅"
      />

      <aside className="side-panel" aria-label={title}>
        <div className="side-panel-head">
          <button
            type="button"
            className="side-panel-close"
            onClick={() => setOpen(false)}
            title="閉じる（Esc）"
          >
            ✕ 閉じる
          </button>
        </div>
        <div className="side-panel-content">{children}</div>
      </aside>
    </div>
  )
}
