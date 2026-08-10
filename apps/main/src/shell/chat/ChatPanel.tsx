/**
 * やりとりの表示部品。docs/impl/phase-11-chat.md 論点D 案D1
 *
 * **シェルが持つのは「形の決まった機構」まで**（実装ハブ 決定13）。フェーズ9 では
 * その境界を「`_flow` を描くか、業務データを描くか」と書いたが、ここで
 * 「**形が固定の機構を描くか、業務ごとの形（一覧・フォーム）を描くか**」に広がった。
 * この部品が受け取るのは「誰が・いつ・本文・自分か」だけで、**テーブル名も
 * フィールド名も fetch も知らない**。kintone の失敗構造（一覧とフォームが共通部品の
 * 表現力に縛られる）はメッセージ列の描画には当たらない。
 *
 * 取得・投稿・投稿後の読み直しは各業務フロー側に残す（`replied` のような出口条件が
 * 動くかどうかはフローの事情だから）。**ここに fetch を持ち込まない**
 * — §8-2 論点20（取得ライブラリを入れる）の移行コストを増やさないための規律でもある。
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { dateTime } from '../format'
import { isImeKey } from '../keys'

/** 1件。**業務テーブルの形ではなく、チャットとして必要なものだけ**。 */
export interface ChatMessage {
  id: string
  authorEmployeeId: string
  body: string
  postedAt: string
  authorKind: 'human' | 'ai'
}

export interface ChatPanelProps {
  title: string
  /** `undefined` は「まだ読めていない」。空配列は「やりとりがまだ無い」。 */
  messages: readonly ChatMessage[] | undefined
  /**
   * いま操作している人の従業員ID。**左右の振り分けはこれだけで決める**（論点B）。
   * 起票者／対応者のような役割ベースにすると、3人目が現れた瞬間に破綻する。
   */
  meId: string
  nameOf: (employeeId: string | null | undefined) => string
  /**
   * 投稿。**失敗したら reject する**こと — 下書きを消してよいかの判断がこれで決まる
   * （握りつぶして解決すると、送れていないのに入力欄が空になる）。
   * エラーの表示は呼び出し側（`onError`）の仕事。
   */
  onPost: (body: string) => Promise<void>
  /** 書ける状態か。過去表示中は false（論点J）。 */
  canPost: boolean
  /** 書けない理由。**その場に言葉で出す**（フェーズ7 決定S の系譜）。 */
  cannotPostReason?: string
}

/** 「最下部にいる」とみなす余裕（px）。行の端数や慣性スクロールのぶん。 */
const BOTTOM_SLACK = 24

export function ChatPanel({
  title,
  messages,
  meId,
  nameOf,
  onPost,
  canPost,
  cannotPostReason,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLOListElement | null>(null)
  /**
   * 最下部に貼り付いているか。**state にしない** — 描画のたびに追随判定をやり直す
   * のではなく、「いまスクロールがどこにあるか」という事実として持つ。
   */
  const stick = useRef(true)
  /** 追随しなかったぶんの新着。0 なら合図を出さない。 */
  const [unseen, setUnseen] = useState(0)
  const seen = useRef(0)
  const count = messages?.length ?? 0

  /**
   * 新着への追随（論点A）。**上を読んでいる最中は飛ばさない。**
   * 8秒ポーリングと一番噛み合わせが悪いところで、飛ぶと「読んでいた場所を失う」。
   */
  useEffect(() => {
    const log = logRef.current
    if (log === null || count === seen.current) return
    if (stick.current) {
      log.scrollTop = log.scrollHeight
      seen.current = count
      setUnseen(0)
      return
    }
    setUnseen(count - seen.current)
  }, [count])

  const onScroll = (): void => {
    const log = logRef.current
    if (log === null) return
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight <= BOTTOM_SLACK
    stick.current = atBottom
    // 自分で下まで戻ったなら、合図は役目を終えている
    if (atBottom && unseen > 0) {
      seen.current = count
      setUnseen(0)
    }
  }

  const jumpToLatest = (): void => {
    const log = logRef.current
    if (log === null) return
    log.scrollTop = log.scrollHeight
    stick.current = true
    seen.current = count
    setUnseen(0)
  }

  const submit = (): void => {
    const body = draft.trim()
    if (body === '' || busy || !canPost) return
    setBusy(true)
    // 自分が書いたものは必ず見えてほしいので、投稿の時点で追随に戻す
    stick.current = true
    onPost(body)
      .then(() => setDraft(''))
      // 失敗したら下書きを残す。赤帯は呼び出し側が出す（ここで握りつぶすのは表示だけ）
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  /** Enter で送信・Shift+Enter で改行・**変換確定の Enter では送らない**（論点A）。 */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (isImeKey(event.nativeEvent)) return
    event.preventDefault()
    submit()
  }

  return (
    <section className="chat-panel">
      <h3>{title}</h3>

      {messages === undefined ? (
        <p className="loading">読み込み中…</p>
      ) : (
        <div className="chat-log-wrap">
          <ol className="chat-log" ref={logRef} onScroll={onScroll}>
            {messages.map((message) => (
              <li
                key={message.id}
                className={message.authorEmployeeId === meId ? 'chat-message mine' : 'chat-message'}
              >
                <p className="chat-message-head">
                  <strong>{nameOf(message.authorEmployeeId)}</strong>
                  {message.authorKind === 'ai' && <span className="badge badge-auto">AI</span>}
                  <span className="muted">{dateTime(message.postedAt)}</span>
                </p>
                <p className="chat-message-body">{message.body}</p>
              </li>
            ))}
          </ol>
          {messages.length === 0 && <p className="muted">まだやりとりがない。</p>}
          {unseen > 0 && (
            <button type="button" className="chat-jump" onClick={jumpToLatest}>
              新着 {unseen} 件 ↓
            </button>
          )}
        </div>
      )}

      {canPost ? (
        <form
          className="chat-form"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <textarea
            rows={2}
            value={draft}
            placeholder="本文（Enter で送信 / Shift+Enter で改行）"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="primary" disabled={busy || draft.trim() === ''}>
            書く
          </button>
        </form>
      ) : (
        <p className="muted">{cannotPostReason ?? 'いまは書き込めない。'}</p>
      )}
    </section>
  )
}
