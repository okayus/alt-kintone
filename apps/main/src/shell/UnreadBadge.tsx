/**
 * 未読の件数。docs/impl/phase-9-change-requests.md 論点H
 *
 * **未読はシェルの仕事**。業務画面の中に置くと、要望画面を開いていないと気づけない
 * ＝ 返信に気づかない ＝ やりとりが死ぬ。
 *
 * 数えるのは「**自分が関わっている要望に、自分以外が書いた、前に読んだときより新しい書き込み**」。
 * 関わっている = 自分が起票した or 自分が対応者。
 *
 * ⚠ **集計の API が無いので全件取ってFEで突き合わせる**（`limit` はマスタと同じ 500）。
 *    社内・要望は日に数件、という前提（§4）でしか成立しない。要望が数百件を超えたら、
 *    数え方ごと考え直す（一覧の名前解決と同じ制約。フェーズ6 決定F）。
 *
 * ⚠ 更新はポーリング（論点H）。SSE も WebSocket も、いま入れる理由が無い。
 */
import { useQuery } from '@tanstack/react-query'
import { MASTER_LIMIT, type Client } from './api'
import { keyOf } from './query'
import type { ChangeRequest, ChangeRequestMessage, ChangeRequestRead } from './types'

/** ポーリング間隔。社内・低トラフィックなので、これで十分早い。 */
export const UNREAD_POLL_MS = 10_000

export interface UnreadBadgeProps {
  client: Client
  /** 詐称中のユーザー。切り替えたら数え直すための依存キー。 */
  user: string
  /** ログイン中の従業員ID。マスタが未取得のうちは空。 */
  meId: string
}

export function UnreadBadge({ client, user, meId }: UnreadBadgeProps) {
  const unread = useQuery({
    /**
     * ⚠ **前の数を残さない。** ユーザーを切り替えたときに古い件数が出たままになると、
     *   「他人の未読が自分のバッジに出ている」という、いちばん信用を失う壊れ方をする
     *   （実際にフェーズ9 の動作確認で、山田 → 森 の切替後に山田の件数が残った）。
     *   **利用者がキーに入っている**ので、切り替えた瞬間に別のクエリになり、
     *   数え直しを待たずに `data` が undefined へ戻る（フェーズ12 論点C）。
     *   だから **`placeholderData` を絶対に付けない** — 付けた瞬間に決定N が死ぬ。
     */
    queryKey: keyOf(client, 'unread', { user, asOf: undefined }, meId),
    queryFn: () => countUnread(client, meId),
    // マスタが未取得のうちは自分が誰か分からない。数えない
    enabled: meId !== '',
    refetchInterval: UNREAD_POLL_MS,
    // 数えられないことは業務の失敗ではないので赤帯は出さない。
    // 本体（要望画面）を開けばそちらがちゃんとエラーを出す
    meta: { silent: true },
  })

  // 失敗したら**古い数を残さない** — 検証できない数字を出すくらいなら消す。
  // （ライブラリは失敗しても最後に成功した値を持ち続けるので、ここで明示的に落とす）
  const count = unread.isError ? 0 : (unread.data ?? 0)

  if (count === 0) return null
  return (
    <span className="badge badge-unread" aria-label={`未読 ${count} 件`}>
      {count}
    </span>
  )
}

/**
 * 未読件数。**純粋な数え方をここに閉じる**（表示と分けてテストできるように）。
 */
export async function countUnread(client: Client, meId: string): Promise<number> {
  const [requests, messages, reads] = await Promise.all([
    client.list<ChangeRequest>('change_request', { limit: MASTER_LIMIT }),
    client.list<ChangeRequestMessage>('change_request_message', { limit: MASTER_LIMIT }),
    client.list<ChangeRequestRead>('change_request_read', {
      limit: MASTER_LIMIT,
      // `me` はサーバ側の糖衣（フェーズ6 決定C）。employee への参照なので効く
      filters: { employeeId: 'me' },
    }),
  ])
  return unreadCount({ requests, messages, reads, meId })
}

export interface UnreadInput {
  requests: readonly ChangeRequest[]
  messages: readonly ChangeRequestMessage[]
  reads: readonly ChangeRequestRead[]
  meId: string
}

export function unreadCount({ requests, messages, reads, meId }: UnreadInput): number {
  const mine = new Set(
    requests
      .filter(
        (request) => request.reporterEmployeeId === meId || request.assigneeEmployeeId === meId,
      )
      .map((request) => request.id),
  )
  const readAt = new Map(reads.map((read) => [read.requestId, read.readAt]))

  return messages.filter((message) => {
    if (message.authorEmployeeId === meId) return false
    if (!mine.has(message.requestId)) return false
    const last = readAt.get(message.requestId)
    // 一度も開いていない要望の書き込みは未読
    return last === undefined || message.postedAt > last
  }).length
}
