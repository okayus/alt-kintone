/**
 * サイドパネルの操作を**実 Chromium**で検証する。
 * docs/impl/phase-13-chat-side-panel.md 完了条件7・11
 *
 * この層に置く理由はフェーズ7・11 と同じ — ここで固定したいのは
 * 「ポインタを掴んで引いたら幅が変わるか」「隠しても中身が木に残っているか」という
 * ブラウザ実物の挙動で、純関数（`panel.test.ts`）でも jsdom でも原理的に捕まらない。
 *
 * 幅の**決め方**は純関数側で固定済みなので、ここで見るのは**配線**
 * （ポインタ → `clampWidth` → 幅と保存）だけ。同じ計算を二度書かない。
 */
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SidePanel } from './SidePanel'
import {
  clampWidth,
  DEFAULT_WIDTH,
  openStorageKey,
  WIDTH_STORAGE_KEY,
  type PanelKind,
} from './panel'
import { useSidePanel } from './useSidePanel'
import '../app.css'

function Harness({ kind, count }: { kind: PanelKind; count: number | undefined }) {
  const panel = useSidePanel(kind)
  return (
    <SidePanel panel={panel} title="やりとり" count={count}>
      <p className="probe">中身</p>
    </SidePanel>
  )
}

let root: Root | undefined
let host: HTMLElement | undefined

/**
 * ⚠ `count` に既定値を置かない。**`undefined` は「まだ読めていない」という意味を持つ**
 *   ので（決定C）、省略と混ざると利用者切替のテストが検証にならない。
 */
function render(count: number | undefined, kind: PanelKind = 'deal'): void {
  if (root === undefined) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  root.render(
    <StrictMode>
      <Harness kind={kind} count={count} />
    </StrictMode>,
  )
}

const el = (selector: string): HTMLElement => {
  const found = document.querySelector(selector)
  if (!(found instanceof HTMLElement)) throw new Error(`${selector} が無い`)
  return found
}

const rootEl = (): HTMLElement => el('.side-panel-root')
const isOpen = (): boolean => rootEl().dataset['open'] === 'true'
const panelWidth = (): number => rootEl().getBoundingClientRect().width
const toggle = () => document.querySelector('.side-panel-toggle')
const badgeText = (): string =>
  document.querySelector('.side-panel-toggle .badge')?.textContent ?? ''

/** 描画は非同期（`root.render` は同期に DOM を作らない）ので、出るまで待つ。 */
async function shown(selector: string): Promise<void> {
  await expect.poll(() => document.querySelector(selector)).not.toBeNull()
}

beforeEach(async () => {
  window.localStorage.clear()
  // ⚠ 既定の窓（414px）だと**幅は常に下限に貼り付く**（本文の下限が取れない）。
  //    パネルは PC 前提の機構なので、テストも PC の窓で回す
  await page.viewport(1280, 800)
})

afterEach(() => {
  root?.unmount()
  root = undefined
  host?.remove()
  host = undefined
  window.localStorage.clear()
})

describe('開閉（完了条件1・3）', () => {
  it('既定は開。閉じても中身は木に残り、見た目だけ消える', async () => {
    render(0)
    await shown('.side-panel-root')
    expect(isOpen()).toBe(true)

    await userEvent.click(el('.side-panel-close'))
    await expect.poll(isOpen).toBe(false)

    // ⚠ ここが決定C の本体 — 外すとポーリングが止まって「増えた件数」が数えられない
    expect(document.querySelector('.probe')).not.toBeNull()
    expect(el('.probe').checkVisibility()).toBe(false)
    // 閉じたことは覚えている（次に開いたときも閉じたまま）
    expect(window.localStorage.getItem(openStorageKey('deal'))).toBe('false')

    await userEvent.click(toggle() as HTMLElement)
    await expect.poll(isOpen).toBe(true)
    expect(el('.probe').checkVisibility()).toBe(true)
  })

  it('Esc で閉じる。⚠ 変換取り消しの Esc では閉じない', async () => {
    render(0)
    await shown('.side-panel-root')

    // 変換中の Esc（候補の取り消し）。フェーズ7 と同じ手で合成する
    const composing = new KeyboardEvent('keydown', {
      key: 'Escape',
      isComposing: true,
      bubbles: true,
    })
    window.dispatchEvent(composing)
    const legacy = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    Object.defineProperty(legacy, 'keyCode', { get: () => 229 })
    window.dispatchEvent(legacy)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(isOpen()).toBe(true)

    // 対照: 実キーの Esc は閉じる
    await userEvent.keyboard('{Escape}')
    await expect.poll(isOpen).toBe(false)
  })

  it('開閉は画面種別ごとに覚える（決定B）', async () => {
    render(0, 'deal')
    await shown('.side-panel-root')
    await userEvent.click(el('.side-panel-close'))
    await expect.poll(isOpen).toBe(false)

    // 要望の画面へ移る（＝別の場所でマウントし直される。`kind` はマウント点ごとに固定）
    root?.unmount()
    root = undefined
    host?.remove()
    host = undefined
    render(0, 'request')

    // 案件で閉じても、要望の側は触っていないので開いたまま
    await expect.poll(isOpen).toBe(true)
    expect(window.localStorage.getItem(openStorageKey('deal'))).toBe('false')
  })
})

describe('幅（完了条件2・7）', () => {
  it('ハンドルを引くと幅が変わり、離した時点で保存される', async () => {
    render(0)
    await shown('.side-panel-handle')
    expect(panelWidth()).toBe(DEFAULT_WIDTH)

    // 引く先の目印。パネルは右端にあるので、左へ引くと広がる
    const marker = document.createElement('div')
    marker.style.cssText = `position: fixed; top: 200px; left: ${window.innerWidth - 600}px; width: 4px; height: 4px;`
    document.body.append(marker)

    const handle = el('.side-panel-handle').getBoundingClientRect()
    const target = marker.getBoundingClientRect()
    const expected = clampWidth(
      DEFAULT_WIDTH + (handle.left + handle.width / 2 - (target.left + target.width / 2)),
      window.innerWidth,
    )

    await userEvent.dragAndDrop(el('.side-panel-handle'), marker)
    await expect.poll(panelWidth).toBe(expected)
    expect(window.localStorage.getItem(WIDTH_STORAGE_KEY)).toBe(String(expected))
    marker.remove()
  })

  it('ハンドルのダブルクリックで既定幅に戻る（決定F）', async () => {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, '640')
    render(0)
    await shown('.side-panel-handle')
    expect(panelWidth()).toBe(640)

    await userEvent.dblClick(el('.side-panel-handle'))
    await expect.poll(panelWidth).toBe(DEFAULT_WIDTH)
    expect(window.localStorage.getItem(WIDTH_STORAGE_KEY)).toBe(String(DEFAULT_WIDTH))
  })

  it('保存された幅が窓に対して大きすぎるとき、**適用時に**収める（完了条件7）', async () => {
    // 広いモニタで広げた人が、狭いウィンドウで同じ画面を開いた状況
    window.localStorage.setItem(WIDTH_STORAGE_KEY, '5000')
    render(0)
    await shown('.side-panel-root')

    const fitted = clampWidth(5000, window.innerWidth)
    expect(panelWidth()).toBe(fitted)
    // 本文が消えない ＝ シェルが空ける余白も同じ幅で収まっている
    expect(document.documentElement.style.getPropertyValue('--side-panel-gutter')).toBe(
      `${fitted}px`,
    )
    expect(window.innerWidth - fitted).toBeGreaterThan(0)
    // ⚠ 好みは書き換えない（広いモニタに戻れば元の幅で開く）
    expect(window.localStorage.getItem(WIDTH_STORAGE_KEY)).toBe('5000')
  })
})

describe('閉じてから増えた件数（決定C・完了条件4・11）', () => {
  it('閉じている間に増えたぶんがタブに出て、開くと消える', async () => {
    render(3)
    await shown('.side-panel-root')
    await userEvent.click(el('.side-panel-close'))
    await expect.poll(isOpen).toBe(false)
    expect(badgeText()).toBe('')

    // 閉じている間に2件届いた
    render(5)
    await expect.poll(badgeText).toBe('+2')

    await userEvent.click(toggle() as HTMLElement)
    await expect.poll(isOpen).toBe(true)

    // 開いたまま増えても合図は出ない（見えているので「新着 n 件 ↓」の担当）
    render(6)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(toggle()).toBeNull()
  })

  it('利用者を切り替えても、前の利用者の件数が一瞬も出ない（完了条件11）', async () => {
    render(3)
    await shown('.side-panel-root')
    await userEvent.click(el('.side-panel-close'))
    await expect.poll(isOpen).toBe(false)

    // 切り替えるとキーごと別のクエリになるので、件数はいったん「読めていない」に戻る
    render(undefined)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(badgeText()).toBe('')

    // 新しい利用者のぶんが届く。**3件との差（+8）を出してはいけない**
    render(11)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(badgeText()).toBe('')

    // そこからの増分は出る
    render(12)
    await expect.poll(badgeText).toBe('+1')
  })
})
