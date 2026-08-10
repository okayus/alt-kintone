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
 * **描画は `shell/chat/ChatPanel`**（フェーズ11 論点D 案D1）。ここに残っているのは
 * 取得・投稿・投稿後の読み直しだけ ＝ **このフローの事情**そのもの
 * （書くと出口条件 `replied` が動くので本体を読み直す、という判断は部品には持てない）。
 *
 * ⚠ 更新はポーリング（論点H）。開いている間だけ動かす。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MASTER_LIMIT, type Client } from '../../shell/api'
import { ChatPanel } from '../../shell/chat/ChatPanel'
import { keyOf } from '../../shell/query'
import type { ChangeRequestMessage } from '../../shell/types'

/** 開いている間の更新間隔。社内・要望は日に数件なので、これで十分（論点H）。 */
export const CHAT_POLL_MS = 8_000

export interface RequestChatProps {
  client: Client
  requestId: string
  meId: string
  /** 詐称中のユーザー。取得のキーに入る（フェーズ12 論点C）。 */
  user: string
  nameOf: (employeeId: string | null | undefined) => string
  /** 過去表示中は書けない（フェーズ11 論点J）。 */
  asOf: string | undefined
  onError: (error: unknown) => void
  /** 投稿したら呼ぶ。出口条件（`replied`）が変わるので、要望本体を読み直させる。 */
  onPosted: () => void
}

export function RequestChat({
  client,
  requestId,
  meId,
  user,
  nameOf,
  asOf,
  onError,
  onPosted,
}: RequestChatProps) {
  const queries = useQueryClient()
  const key = keyOf(client, 'change_request_message', { user, asOf }, requestId)

  const messages = useQuery({
    queryKey: key,
    queryFn: () =>
      client.list<ChangeRequestMessage>('change_request_message', {
        limit: MASTER_LIMIT,
        filters: { requestId },
        sort: 'postedAt:asc',
        ...(asOf === undefined ? {} : { asOf }),
      }),
    // 開いている間だけ動く（画面を離れればクエリが非アクティブになって止まる）
    refetchInterval: CHAT_POLL_MS,
  })

  const post = async (body: string): Promise<void> => {
    try {
      const created = await client.create<ChangeRequestMessage>('change_request_message', {
        requestId,
        authorEmployeeId: meId,
        body,
        // 場所だけ空けてある（論点K）。AI を当事者に入れるのは v1 ではやらない
        authorKind: 'human',
      })
      // 次のポーリングを待たずに自分の書き込みを出す（今日の setMessages と同型）
      queries.setQueryData<ChangeRequestMessage[]>(key, (prev) => [...(prev ?? []), created])
      onPosted()
    } catch (cause) {
      onError(cause)
      // 部品に下書きを残させる（送れていないのに入力欄が空になるのを避ける）
      throw cause
    }
  }

  return (
    <ChatPanel
      title="やりとり"
      messages={messages.data}
      meId={meId}
      nameOf={nameOf}
      onPost={post}
      canPost={asOf === undefined && meId !== ''}
      cannotPostReason={
        asOf === undefined ? '利用者が特定できていない。' : '過去の時点を見ている間は書けない。'
      }
    />
  )
}
