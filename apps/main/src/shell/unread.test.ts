/**
 * 未読の数え方。docs/impl/phase-9-change-requests.md 論点H
 *
 * 「返信に気づかないとチャットは死ぬ」ので、数え方が間違っていると
 * この機能の後半（やりとり）が丸ごと機能しない。表示から切り離して固定する。
 */
import { unreadCount, type UnreadInput } from './UnreadBadge'
import type { ChangeRequest, ChangeRequestMessage, ChangeRequestRead } from './types'
import { describe, expect, it } from 'vitest'

const meta = {
  _version: {
    validFrom: '2026-07-01T00:00:00.000Z',
    validTo: null,
    changedBy: null,
    changedFlow: null,
    changedStep: null,
  },
  _permissions: { update: true },
}

const request = (id: string, reporter: string, assignee: string | null = null): ChangeRequest =>
  ({
    ...meta,
    id,
    kind: 'other',
    problem: 'x',
    reporterEmployeeId: reporter,
    assigneeEmployeeId: assignee,
    filedAt: '2026-07-01T00:00:00.000Z',
  }) as unknown as ChangeRequest

const message = (id: string, requestId: string, author: string, at: string) =>
  ({
    ...meta,
    id,
    requestId,
    authorEmployeeId: author,
    body: 'x',
    postedAt: at,
    authorKind: 'human',
  }) as ChangeRequestMessage

const read = (requestId: string, employeeId: string, at: string) =>
  ({ ...meta, id: `r-${requestId}`, requestId, employeeId, readAt: at }) as ChangeRequestRead

const count = (input: Partial<UnreadInput>) =>
  unreadCount({ requests: [], messages: [], reads: [], meId: 'e-yamada', ...input })

describe('unreadCount', () => {
  it('自分が起票した要望への他人の書き込みは未読', () => {
    expect(
      count({
        requests: [request('cr-1', 'e-yamada')],
        messages: [message('m-1', 'cr-1', 'e-admin', '2026-07-10T00:00:00.000Z')],
      }),
    ).toBe(1)
  })

  it('自分が書いたものは数えない', () => {
    expect(
      count({
        requests: [request('cr-1', 'e-yamada')],
        messages: [message('m-1', 'cr-1', 'e-yamada', '2026-07-10T00:00:00.000Z')],
      }),
    ).toBe(0)
  })

  it('関わっていない要望は数えない（全員の要望でバッジが埋まらない）', () => {
    expect(
      count({
        requests: [request('cr-1', 'e-mori')],
        messages: [message('m-1', 'cr-1', 'e-admin', '2026-07-10T00:00:00.000Z')],
      }),
    ).toBe(0)
  })

  it('自分が対応者の要望も数える', () => {
    expect(
      count({
        requests: [request('cr-1', 'e-mori', 'e-yamada')],
        messages: [message('m-1', 'cr-1', 'e-admin', '2026-07-10T00:00:00.000Z')],
      }),
    ).toBe(1)
  })

  it('読んだあとの書き込みだけ未読（開けばバッジが消える）', () => {
    const input = {
      requests: [request('cr-1', 'e-yamada')],
      messages: [
        message('m-1', 'cr-1', 'e-admin', '2026-07-10T00:00:00.000Z'),
        message('m-2', 'cr-1', 'e-admin', '2026-07-20T00:00:00.000Z'),
      ],
    }
    expect(count({ ...input, reads: [read('cr-1', 'e-yamada', '2026-07-15T00:00:00.000Z')] })).toBe(
      1,
    )
    expect(count({ ...input, reads: [read('cr-1', 'e-yamada', '2026-07-21T00:00:00.000Z')] })).toBe(
      0,
    )
  })

  it('一度も開いていない要望の書き込みは未読', () => {
    expect(
      count({
        requests: [request('cr-1', 'e-yamada')],
        messages: [message('m-1', 'cr-1', 'e-admin', '2026-07-10T00:00:00.000Z')],
        reads: [],
      }),
    ).toBe(1)
  })
})
