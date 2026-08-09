/**
 * 要望のやりとり。docs/impl/phase-9-change-requests.md 論点H
 *
 * **役割は「起票後の連絡手段」ではなく「内容の宣言性を詰める場」**（§2-2）。
 * 起票は自由文1つでよく、構造（対象・何をどう変えるか）はここの往復で埋まっていく。
 * だから最初のフォームを軽くできる。
 *
 * データは `activity` と同じ「target にぶら下がる追記」（論点H 案1）で、API も認可も既存のまま。
 * 並びは `postedAt`（サーバが埋める。決定G）— 有効期間型の `validFrom` は更新のたびに
 * 動くので、追記の順序には使えない。
 *
 * ⚠ 更新はポーリング（論点H）。開いている間だけ動かす。
 */
import { changeRequestMessage as messageDef } from '@alt/definitions'
import { useEffect, useState } from 'react'
import { MASTER_LIMIT, type Client } from '../../shell/api'
import { dateTime } from '../../shell/format'
import type { ChangeRequestMessage } from '../../shell/types'

/** 開いている間の更新間隔。社内・要望は日に数件なので、これで十分（論点H）。 */
export const CHAT_POLL_MS = 8_000

export interface RequestChatProps {
  client: Client
  requestId: string
  meId: string
  nameOf: (employeeId: string | null | undefined) => string
  onError: (error: unknown) => void
  /** 投稿したら呼ぶ。出口条件（`replied`）が変わるので、要望本体を読み直させる。 */
  onPosted: () => void
}

export function RequestChat({
  client,
  requestId,
  meId,
  nameOf,
  onError,
  onPosted,
}: RequestChatProps) {
  const [messages, setMessages] = useState<ChangeRequestMessage[] | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    const load = (): void => {
      client
        .list<ChangeRequestMessage>('change_request_message', {
          limit: MASTER_LIMIT,
          filters: { requestId },
          sort: 'postedAt:asc',
        })
        .then((records) => {
          if (live) setMessages(records)
        })
        .catch((cause: unknown) => {
          if (live) onError(cause)
        })
    }
    load()
    const timer = window.setInterval(load, CHAT_POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [client, requestId, onError])

  const post = () => {
    const body = draft.trim()
    if (body === '' || meId === '') return
    setBusy(true)
    client
      .create<ChangeRequestMessage>('change_request_message', {
        requestId,
        authorEmployeeId: meId,
        body,
        // 場所だけ空けてある（論点K）。AI を当事者に入れるのは v1 ではやらない
        authorKind: 'human',
      })
      .then((created) => {
        setMessages((prev) => [...(prev ?? []), created])
        setDraft('')
        onPosted()
      })
      .catch(onError)
      .finally(() => setBusy(false))
  }

  return (
    <section className="request-chat">
      <h3>やりとり</h3>

      {messages === undefined ? (
        <p className="loading">読み込み中…</p>
      ) : messages.length === 0 ? (
        <p className="muted">まだやりとりがない。</p>
      ) : (
        <ol className="chat-messages">
          {messages.map((message) => (
            <li
              key={message.id}
              className={message.authorEmployeeId === meId ? 'message mine' : 'message'}
            >
              <p className="message-head">
                <strong>{nameOf(message.authorEmployeeId)}</strong>
                {message.authorKind === 'ai' && <span className="badge badge-auto">AI</span>}
                <span className="muted">{dateTime(message.postedAt)}</span>
              </p>
              <p className="message-body">{message.body}</p>
            </li>
          ))}
        </ol>
      )}

      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault()
          post()
        }}
      >
        <textarea
          rows={2}
          value={draft}
          placeholder={messageDef.fields.body?.label ?? '本文'}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="primary" disabled={busy || draft.trim() === ''}>
          書く
        </button>
      </form>
    </section>
  )
}
