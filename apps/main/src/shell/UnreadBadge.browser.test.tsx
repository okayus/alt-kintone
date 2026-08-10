/**
 * 未読バッジが**古い数を残さない**ことを実 Chromium で確認する。
 * docs/impl/phase-9-change-requests.md 決定N
 *
 * この層に置く理由: 数え方そのものは純関数（`unread.test.ts`）で固定してあり、
 * ここで捕まえたいのは**「利用者が入れ替わったのに前の数が表示されたまま」**という、
 * effect の再実行と描画のタイミングの問題。動作確認で実際に起きた
 * （山田 → 森 に切り替えたのに山田の件数が残った）。
 *
 * フェーズ7 と同じ扱い — 実機で見つけた欠陥は回帰テストにする。
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { UnreadBadge } from './UnreadBadge'
import type { Client } from './api'
import { createQueryClient } from './query'
import type { ChangeRequest, ChangeRequestMessage, ChangeRequestRead } from './types'

const meta = {
  _version: {
    validFrom: '2026-08-01T00:00:00.000Z',
    validTo: null,
    changedBy: null,
    changedFlow: null,
    changedStep: null,
  },
  _permissions: { update: true },
}

/** 山田に2件、森に0件の未読ができるデータ。 */
const REQUESTS = [
  { ...meta, id: 'cr-1', reporterEmployeeId: 'e-yamada', assigneeEmployeeId: null },
  { ...meta, id: 'cr-2', reporterEmployeeId: 'e-yamada', assigneeEmployeeId: null },
] as unknown as ChangeRequest[]

const MESSAGES = [
  { ...meta, id: 'm-1', requestId: 'cr-1', authorEmployeeId: 'e-admin', postedAt: '2026-08-02' },
  { ...meta, id: 'm-2', requestId: 'cr-2', authorEmployeeId: 'e-admin', postedAt: '2026-08-02' },
] as unknown as ChangeRequestMessage[]

/** 遅延を入れられるスタブ。切り替え直後の「まだ数え直せていない」状態を作るため。 */
function stubClient(delayMs = 0): Client {
  return {
    flow: 'request',
    async list<T>(table: string): Promise<T[]> {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (table === 'change_request') return REQUESTS as unknown as T[]
      if (table === 'change_request_message') return MESSAGES as unknown as T[]
      return [] as ChangeRequestRead[] as unknown as T[]
    },
  } as Client
}

let root: Root | undefined
let host: HTMLElement | undefined
let queries: QueryClient | undefined

/**
 * ⚠ **QueryClient はテストの中で使い回す。** 利用者の切替ごとに作り直すと
 *   キャッシュごと消えてしまい、「キーが違うから前の数が出ない」という
 *   保証（フェーズ12 論点C）を検証していないことになる。
 */
function render(client: Client, user: string, meId: string): void {
  if (root === undefined) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    queries = createQueryClient(() => undefined)
  }
  root.render(
    <StrictMode>
      <QueryClientProvider client={queries as QueryClient}>
        <UnreadBadge client={client} user={user} meId={meId} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

const badgeText = (): string => host?.textContent ?? ''

/** バッジが `expected` になるまで待つ（ポーリングではなく1回目の取得を待つだけ）。 */
async function waitForBadge(expected: string): Promise<void> {
  await expect.poll(badgeText, { timeout: 2000 }).toBe(expected)
}

afterEach(() => {
  root?.unmount()
  root = undefined
  host?.remove()
  host = undefined
  // ポーリングを次のテストへ持ち越さない
  queries?.clear()
  queries = undefined
})

describe('UnreadBadge', () => {
  it('自分に関わる未読の件数が出る', async () => {
    render(stubClient(), 'yamada@example.com', 'e-yamada')
    await waitForBadge('2')
  })

  it('利用者が変わったら、数え直しを待たずに前の人の件数を消す', async () => {
    render(stubClient(), 'yamada@example.com', 'e-yamada')
    await waitForBadge('2')

    // 取得に 1 秒かかるクライアントに差し替える。**取得の完了を待たずに消える**ことが要点 —
    // 消えるのが取得の後だと、その間ずっと他人の未読件数が自分のバッジに出ていることになる
    render(stubClient(1000), 'mori@example.com', 'e-mori')
    await expect.poll(badgeText, { timeout: 400 }).toBe('')

    // 数え終わっても森には未読が無いので、出ないまま
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(badgeText()).toBe('')
  })

  it('従業員IDが解決していない間は出さない（マスタ読み込み中）', async () => {
    render(stubClient(), 'yamada@example.com', '')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(badgeText()).toBe('')
  })
})
