/**
 * リクエストの解決。「どのテーブルの、どのフローの文脈で、誰が、いつの時点を見るか」を
 * 1箇所で決めてハンドラに渡す。
 *
 * **`flow` は全エンドポイント共通のクエリパラメータ**（docs/impl/phase-3-backend.md 3-2）。
 * 認可の範囲を決め、書き込みの文脈（`changed_flow`）にもなるので、リクエストごとに
 * ちょうど1本に確定させる。
 */
import { badRequest, notFound, type ApiRequest } from './api.js'
import { authenticate, requireParticipation, type Authenticate, type Principal } from './authz.js'
import type { DefinitionRegistry, TableUsage } from './registry.js'
import { MAX_LIMIT } from '@alt/sql'
import type { FlowDef, TableDef } from '@alt/dsl'
import type Database from 'better-sqlite3'

export interface RequestContext {
  principal: Principal
  table: TableDef
  flow: FlowDef
  usage: TableUsage
  /**
   * ユーザーの時点指定（`as_of`）。**過去を見ている ＝ 読み取り専用**。
   * これが立っていると `_permissions.update` が false になり、書き込みも弾かれる。
   */
  asOf: string | undefined
  /**
   * 窓取得の時点固定（`snapshot`。docs/impl/phase-6-list-grid.md 決定A）。
   *
   * SQL 上は `as_of` と同じ時点条件に落ちるが**意味が違う** — こちらは「いまを固定して
   * 読んでいる」であって過去ではないので、読み取り専用にしない。分けないと、行ズレ対策で
   * 時点を固定した瞬間に一覧の全行が編集不可になる。
   */
  snapshot: string | undefined
  /** SQL に渡す実際の読み取り時点。`asOf ?? snapshot`。省略時は現在。 */
  readAt: string | undefined
  limit: number | undefined
  offset: number | undefined
  /** この書き込みの時刻。**1リクエスト内で使い回す**（有効期間に穴も重なりも作らないため）。 */
  now: string
}

/** 過去を見ているか（＝読み取り専用か）。`snapshot` では立たない。 */
export function isHistorical(ctx: RequestContext): boolean {
  return ctx.asOf !== undefined
}

export interface Deps {
  db: Database.Database
  registry: DefinitionRegistry
  authenticator: Authenticate
  /** 時刻の注入。テストを決定的にするためだけのもの。 */
  clock?: () => string
}

export function resolveContext(deps: Deps, request: ApiRequest, tableName: string): RequestContext {
  const table = deps.registry.table(tableName)
  const usages = deps.registry.usage(tableName)

  // **バインドされていないテーブルはルートが存在しない**（§3-2 の技術的な強制）。
  // 403 ではなく 404 なのは、「権限が無い」ではなく「APIが生えていない」ため。
  if (table === undefined || usages.length === 0) {
    throw notFound(
      `テーブル "${tableName}" の API は生えていない`,
      table === undefined
        ? '定義に無いテーブル'
        : 'どの業務フローのステップでも reads / writes に出てこない。' +
            'バインドされていないテーブルは使えない（product-concept.md §3-2）',
    )
  }

  const usage = resolveUsage(usages, request.query['flow'])
  const principal = authenticate(deps.db, request.headers, deps.authenticator)
  requireParticipation(principal, usage.flow)

  const asOf = parseAsOf(request.query['as_of'], 'as_of')
  const snapshot = parseSnapshot(request)

  return {
    principal,
    table,
    flow: usage.flow,
    usage,
    asOf,
    snapshot,
    // 両方あれば as_of が勝つ。過去のデータは動かないので固定する必要が無い
    readAt: asOf ?? snapshot,
    limit: parseLimit(request.query['limit']),
    offset: parseOffset(request.query['offset']),
    now: (deps.clock ?? (() => new Date().toISOString()))(),
  }
}

/**
 * 窓取得の時点固定は**読み取り専用**。書き込みに付いていたら弾く。
 *
 * 黙って無視すると「固定した時点に書いたつもり」の呼び出しが通ってしまう。
 * 有効期間型の書き込みは常に現在に対して行われる（`insertRecord` の `now`）ので、
 * 固定時点を書き込みに持ち込む意味は無い。
 */
function parseSnapshot(request: ApiRequest): string | undefined {
  const snapshot = parseAsOf(request.query['snapshot'], 'snapshot')
  if (snapshot !== undefined && request.method !== 'GET') {
    throw badRequest(
      `snapshot は読み取り（GET）専用`,
      '書き込みは常に現在に対して行われる。一覧の窓取得で行ズレを防ぐためのパラメータ',
    )
  }
  return snapshot
}

/**
 * どのフローの文脈で読み書きするか。
 *
 * 省略できるのは1本しか無いときだけ。複数あるのに黙って選ぶと、認可の範囲と
 * `changed_flow` が呼び出し側の意図と食い違う。
 */
function resolveUsage(usages: readonly TableUsage[], flowKey: string | undefined): TableUsage {
  if (flowKey === undefined) {
    const [only] = usages
    if (usages.length === 1 && only !== undefined) return only
    throw badRequest(
      'flow を指定していないが、このテーブルは複数の業務フローで使われている',
      `?flow= に指定する: ${usages.map((u) => u.flow.key).join(', ')}`,
    )
  }
  const found = usages.find((u) => u.flow.key === flowKey)
  if (found !== undefined) return found
  throw badRequest(
    `業務フロー "${flowKey}" はこのテーブルを使っていない`,
    `このテーブルを使うフロー: ${usages.map((u) => u.flow.key).join(', ')}`,
  )
}

/** ISO 8601 の文字列だけ受ける。列の値が ISO 文字列なので、比較は文字列比較で成立する。 */
function parseAsOf(raw: string | undefined, name: string): string | undefined {
  if (raw === undefined || raw === '') return undefined
  if (Number.isNaN(Date.parse(raw))) {
    throw badRequest(
      `${name} が日時として読めない: ${raw}`,
      'ISO 8601 で渡す（例: 2026-07-31T23:59:59.999Z）',
    )
  }
  return raw
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest(`limit が正の整数ではない: ${raw}`)
  }
  if (value > MAX_LIMIT) throw badRequest(`limit の上限は ${MAX_LIMIT}`)
  return value
}

function parseOffset(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw badRequest(
      `offset が 0 以上の整数ではない: ${raw}`,
      '窓取得は offset + limit で切る。総件数はレスポンスの total にある',
    )
  }
  return value
}
