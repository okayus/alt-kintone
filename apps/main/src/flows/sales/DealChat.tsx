/**
 * 案件のやりとり。docs/impl/phase-11-chat.md 決定B
 *
 * **役割は「案件をめぐる社内のやりとり（相談・指示・引き継ぎ）を案件に紐づけて残す場」**。
 * kintone のレコードコメント欄の代替で、**顧客とのやりとりは載らない**
 * — それは活動（`ActivityList`）の記録（論点F）。画面でも区画を分けてある。
 *
 * 描画は `shell/chat/ChatPanel`（論点D 案D1）。ここに残っているのは取得と投稿だけで、
 * **要望のやりとり（`RequestChat`）と同じ配線を意図的に踏襲している**
 * — 新しい手書きの並行制御を足さない、という §8-2 論点20 への規律（§8 の規律2）。
 *
 * ⚠ `onPosted` が無い。v1 では `deal_message` を読む出口条件を作っていないので、
 *   書いても案件本体の判定は動かない（＝読み直すものが無い）。
 */
import { useEffect, useState } from 'react'
import { MASTER_LIMIT, type Client } from '../../shell/api'
import { ChatPanel } from '../../shell/chat/ChatPanel'
import type { DealMessage } from '../../shell/types'

/** 開いている間の更新間隔。要望のやりとりと同じ（社内・低トラフィック）。 */
export const DEAL_CHAT_POLL_MS = 8_000

export interface DealChatProps {
  client: Client
  dealId: string
  meId: string
  nameOf: (employeeId: string | null | undefined) => string
  /** 過去表示中は書けない（論点J）。サーバも ¬historical で守っている */
  asOf: string | undefined
  onError: (error: unknown) => void
}

export function DealChat({ client, dealId, meId, nameOf, asOf, onError }: DealChatProps) {
  const [messages, setMessages] = useState<DealMessage[] | undefined>(undefined)

  useEffect(() => {
    let live = true
    const load = (): void => {
      client
        .list<DealMessage>('deal_message', {
          limit: MASTER_LIMIT,
          filters: { dealId },
          sort: 'postedAt:asc',
          ...(asOf === undefined ? {} : { asOf }),
        })
        .then((records) => {
          if (live) setMessages(records)
        })
        .catch((cause: unknown) => {
          if (live) onError(cause)
        })
    }
    load()
    const timer = window.setInterval(load, DEAL_CHAT_POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [client, dealId, asOf, onError])

  const post = async (body: string): Promise<void> => {
    try {
      const created = await client.create<DealMessage>('deal_message', {
        dealId,
        authorEmployeeId: meId,
        body,
        authorKind: 'human',
      })
      setMessages((prev) => [...(prev ?? []), created])
    } catch (cause) {
      onError(cause)
      // 部品に下書きを残させる（送れていないのに入力欄が空になるのを避ける）
      throw cause
    }
  }

  return (
    <ChatPanel
      title="やりとり"
      messages={messages}
      meId={meId}
      nameOf={nameOf}
      onPost={post}
      // 画面が開けている＝このフローの参加者で、追記は参加者全員に開いている（決定A）。
      // だから可否を分けるのは時点だけ。レコードごとの可否ではないので `_permissions` に無い
      canPost={asOf === undefined && meId !== ''}
      cannotPostReason={
        asOf === undefined ? '利用者が特定できていない。' : '過去の時点を見ている間は書けない。'
      }
    />
  )
}
