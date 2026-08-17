/**
 * チャットの操作を**実 Chromium**で検証する。docs/impl/phase-11-chat.md 論点A
 *
 * この層に置く理由はフェーズ7・9 と同じ — ここで固定したいのは
 * 「スクロール位置がいまどこにあるか」「キーが実際にどう届くか」という
 * ブラウザ実物の挙動で、純関数でも jsdom でも原理的に捕まらない。
 *
 * 具体的には3つ:
 *  1. 吹き出しが左右に振り分かる（**CSS が効いていること**まで見る。クラス名だけでは
 *     「class は付いているが見た目は左のまま」を通してしまう）
 *  2. ポーリング新着で**上を読んでいる最中に飛ばない**（8秒ポーリングとの噛み合わせ）
 *  3. Enter で送信 / Shift+Enter で改行 / **IME 変換確定の Enter では送らない**
 *     （OS の IME は機械から駆動できないので、実イベントと同じ印を持つ合成イベントで
 *     代替し、対照として実 Enter が送ることを同じテストで見る。フェーズ7 と同じ手）
 */
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import '../app.css'

const ME = 'e-yamada'

function message(index: number, author = ME): ChatMessage {
  return {
    id: `m-${index}`,
    authorEmployeeId: author,
    body: `本文 ${index}`,
    postedAt: '2026-08-10T00:00:00.000Z',
    authorKind: 'human',
  }
}

const nameOf = (id: string | null | undefined): string => (id === ME ? '山田' : '鈴木')

let root: Root | undefined
let host: HTMLElement | undefined

interface RenderOptions {
  messages?: readonly ChatMessage[] | undefined
  onPost?: (body: string) => Promise<void>
  canPost?: boolean
  cannotPostReason?: string
}

function render(opts: RenderOptions = {}): void {
  if (root === undefined) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  root.render(
    <StrictMode>
      <ChatPanel
        title="やりとり"
        messages={opts.messages ?? []}
        meId={ME}
        nameOf={nameOf}
        onPost={opts.onPost ?? (() => Promise.resolve())}
        canPost={opts.canPost ?? true}
        {...(opts.cannotPostReason === undefined
          ? {}
          : { cannotPostReason: opts.cannotPostReason })}
      />
    </StrictMode>,
  )
}

/**
 * サイドパネルの中に置いた状態で描く（フェーズ13）。**上の `render` は触らない** —
 * フェーズ11 の4群がそのままの経路で通ることを、パネル化の匂い検知に使っている
 * （phase-13 完了条件10）。
 */
function renderInPanel(messages: readonly ChatMessage[], hidden: boolean): void {
  if (root === undefined) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  root.render(
    <StrictMode>
      <div style={{ display: hidden ? 'none' : 'block' }}>
        <ChatPanel
          title="やりとり"
          messages={messages}
          meId={ME}
          nameOf={nameOf}
          onPost={() => Promise.resolve()}
          canPost={true}
          visible={!hidden}
        />
      </div>
    </StrictMode>,
  )
}

afterEach(() => {
  root?.unmount()
  root = undefined
  host?.remove()
  host = undefined
})

const log = (): HTMLElement => {
  const el = document.querySelector('.chat-log')
  if (!(el instanceof HTMLElement)) throw new Error('やりとりの枠が無い')
  return el
}

const textarea = (): HTMLTextAreaElement => {
  const el = document.querySelector('.chat-form textarea')
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('入力欄が無い')
  return el
}

const jumpButton = () => document.querySelector('.chat-jump')

/** 最下部にいるか（部品の判定と同じ余裕で見る）。 */
const atBottom = (): boolean => {
  const el = log()
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 24
}

/** 描画は非同期（`root.render` は同期に DOM を作らない）ので、出るまで待つ。 */
async function shown(selector: string): Promise<void> {
  await expect.poll(() => document.querySelector(selector)).not.toBeNull()
}

/**
 * scroll イベントが部品に届くのを待つ。
 *
 * `scrollTop` の代入は DOM には即座に効くが、**イベントは次のフレームで飛ぶ**。
 * 部品はそこで「最下部にいるか」を更新するので、代入直後に次の描画を起こすと
 * 「上を読んでいる」状態がまだ伝わっていない。実際の利用（人が指でスクロールする）
 * では起きない、テスト側だけの前後関係。
 */
const scrollSettled = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 100)) as Promise<void>

describe('吹き出し（完了条件1）', () => {
  it('自分は右・相手は左に出て、枠の中でスクロールする', async () => {
    render({ messages: [message(1, 'e-suzuki'), message(2)] })
    await expect.poll(() => document.querySelectorAll('.chat-message').length).toBe(2)

    const [other, mine] = [...document.querySelectorAll('.chat-message')] as HTMLElement[]
    if (other === undefined || mine === undefined) throw new Error('吹き出しが無い')
    expect(mine.className).toContain('mine')
    // クラス名だけでなく**実際に右に寄っている**ことを見る（CSS ごと回帰対象にする）
    expect(mine.getBoundingClientRect().left).toBeGreaterThan(other.getBoundingClientRect().left)

    // 高さは固定。件数が増えても画面が伸び続けない
    render({ messages: Array.from({ length: 40 }, (_, i) => message(i)) })
    await expect.poll(() => document.querySelectorAll('.chat-message').length).toBe(40)
    expect(log().scrollHeight).toBeGreaterThan(log().clientHeight)
  })
})

describe('新着への追随（完了条件2）', () => {
  const many = Array.from({ length: 40 }, (_, i) => message(i, 'e-suzuki'))

  it('最下部にいれば追随する', async () => {
    render({ messages: many })
    await expect.poll(atBottom).toBe(true)

    render({ messages: [...many, message(99, 'e-suzuki')] })
    await expect.poll(() => document.querySelectorAll('.chat-message').length).toBe(41)
    expect(atBottom()).toBe(true)
    expect(jumpButton()).toBeNull()
  })

  it('上を読んでいる最中は飛ばず、合図が出る。押すと最新へ行く', async () => {
    render({ messages: many })
    await expect.poll(atBottom).toBe(true)

    // 上まで戻って読んでいる状態にする
    log().scrollTop = 0
    expect(atBottom()).toBe(false)
    await scrollSettled()

    render({ messages: [...many, message(99, 'e-suzuki')] })
    await expect.poll(jumpButton).not.toBeNull()
    // **ここが本題**: 新着が来ても読んでいた位置から動かない
    expect(log().scrollTop).toBe(0)
    expect(jumpButton()?.textContent).toContain('1')

    await userEvent.click(jumpButton() as HTMLElement)
    await expect.poll(atBottom).toBe(true)
    expect(jumpButton()).toBeNull()
  })
})

describe('送信のキー（完了条件3）', () => {
  it('Enter で送る / Shift+Enter は改行 / 変換確定の Enter では送らない', async () => {
    const posted: string[] = []
    render({
      onPost: (body) => {
        posted.push(body)
        return Promise.resolve()
      },
    })
    await shown('.chat-form textarea')

    await userEvent.click(textarea())
    await userEvent.keyboard('相談です')

    // 変換確定の形（Chrome / Firefox: isComposing、Safari の癖: keyCode 229）
    const composing = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    textarea().dispatchEvent(composing)
    const legacy = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(legacy, 'keyCode', { get: () => 229 })
    textarea().dispatchEvent(legacy)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(posted).toEqual([])

    // Shift+Enter は改行（送らない）
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(posted).toEqual([])
    expect(textarea().value).toContain('\n')

    // 対照: 実キーの Enter は送る。下書きは消える
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => posted.length).toBe(1)
    expect(posted[0]).toBe('相談です')
    await expect.poll(() => textarea().value).toBe('')
  })

  it('投稿が失敗したら下書きを残す', async () => {
    render({ onPost: () => Promise.reject(new Error('403')) })
    await shown('.chat-form textarea')
    await userEvent.click(textarea())
    await userEvent.keyboard('消えないで')
    await userEvent.keyboard('{Enter}')

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(textarea().value).toBe('消えないで')
  })
})

describe('隠れている間に届いたぶん（フェーズ13 決定C）', () => {
  const many = Array.from({ length: 40 }, (_, i) => message(i, 'e-suzuki'))

  it('閉じている間に増えても、開いた瞬間に最新が見えている', async () => {
    renderInPanel(many, false)
    await expect.poll(atBottom).toBe(true)

    // 閉じる（外さない — ポーリングは生きたまま）
    renderInPanel(many, true)
    await scrollSettled()
    // ⚠ 隠れている間は scrollHeight が 0 なので、ここでの追随は空振りする
    renderInPanel([...many, message(99, 'e-suzuki')], true)
    await scrollSettled()

    // 開く。**ここで最下部に戻っていること**が本題
    renderInPanel([...many, message(99, 'e-suzuki')], false)
    await expect.poll(atBottom).toBe(true)
    expect(jumpButton()).toBeNull()
  })

  it('上を読んでいる最中に閉じたなら、開いても位置は変わらない', async () => {
    renderInPanel(many, false)
    await expect.poll(atBottom).toBe(true)
    log().scrollTop = 0
    await scrollSettled()

    renderInPanel(many, true)
    await scrollSettled()
    renderInPanel(many, false)
    await scrollSettled()

    expect(log().scrollTop).toBe(0)
  })
})

describe('書けないとき（完了条件11）', () => {
  it('入力欄が畳まれ、理由がその場に出る', async () => {
    render({ canPost: false, cannotPostReason: '過去の時点を見ている間は書けない' })
    await shown('.chat-panel')
    expect(document.querySelector('.chat-form')).toBeNull()
    expect(document.querySelector('.chat-panel')?.textContent).toContain(
      '過去の時点を見ている間は書けない',
    )
  })
})
