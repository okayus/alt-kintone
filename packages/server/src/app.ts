/**
 * ルーティング。docs/impl/phase-3-backend.md 3-2
 *
 * **ルートは定義から生える。** ここに `/api/deal` は書かれていない。
 * バインドされていないテーブルは 404 になり、読むだけのテーブルには
 * POST / PATCH が通らない（§3-2 を技術的に強制する場所）。
 *
 * HTTP フレームワークは使わない。ルートが定義から決まる以上ルータの出番は小さく、
 * TS 版は Go 版が出来たら捨てる仕様実装なので依存を増やさない（CLI で
 * `parseArgs` を選んだのと同じ理由）。
 */
import { ApiError, badRequest, notFound, type ApiRequest, type ApiResponse } from './api.js'
import { requireTableWrite } from './authz.js'
import { isHistorical, resolveContext, type Deps, type RequestContext } from './context.js'
import { advance, currentStepKey, setManualCheck } from './flow-state.js'
import { parseListSelection } from './list-query.js'
import { createRecord, getRecord, listRecords, updateRecord } from './records.js'
import type { DefinitionRegistry } from './registry.js'

export interface App {
  registry: DefinitionRegistry
  handle(request: ApiRequest): ApiResponse
}

export function createApp(deps: Deps): App {
  return {
    registry: deps.registry,
    handle: (request) => {
      try {
        return route(deps, request)
      } catch (error) {
        if (error instanceof ApiError) return { status: error.status, body: error.toBody() }
        // 想定外。プロトタイプなので原因をそのまま返す（本番ならログに落として隠す）
        const message = error instanceof Error ? error.message : String(error)
        return { status: 500, body: { error: { code: 'internal', message } } }
      }
    },
  }
}

function route(deps: Deps, request: ApiRequest): ApiResponse {
  const segments = request.path.split('/').filter((s) => s !== '')

  if (segments.length === 1 && segments[0] === 'health') {
    return { status: 200, body: { ok: true, routes: deps.registry.routes().length } }
  }

  const [prefix, table, id, action, checkKey] = segments
  if (prefix !== 'api' || table === undefined) {
    throw notFound(`ルートが無い: ${request.method} ${request.path}`, 'API は /api/{table} の形')
  }

  const ctx = resolveContext(deps, request, table)

  // /api/{table}
  if (id === undefined) {
    if (request.method === 'GET') {
      const selection = parseListSelection(request.query, {
        table: ctx.table,
        flow: ctx.flow,
        isTarget: ctx.flow.target === ctx.table.name,
      })
      const page = listRecords(deps, ctx, selection)
      return ok({
        table: ctx.table.name,
        flow: ctx.flow.key,
        asOf: ctx.asOf ?? null,
        snapshot: ctx.snapshot ?? null,
        // **FE はこれを以後の窓取得の snapshot に使う**（クライアント時計を信用しない）。
        // 世代の起点になるので、1枚目のレスポンスにだけあれば足りるものではない
        now: ctx.now,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        records: page.records,
      })
    }
    if (request.method === 'POST') {
      requireTableWrite(ctx.usage)
      return { status: 201, body: { record: createRecord(deps, ctx, request.body) } }
    }
    throw methodNotAllowed(request, ['GET', 'POST'])
  }

  // /api/{table}/{id}
  if (action === undefined) {
    if (request.method === 'GET') {
      return ok({ table: ctx.table.name, flow: ctx.flow.key, record: getRecord(deps, ctx, id) })
    }
    if (request.method === 'PATCH') {
      requireTableWrite(ctx.usage)
      requireRowWritable(deps, ctx, id)
      // 「どのステップで変わったか」はサーバが _flow_state から引く（§4-1 変更の文脈）
      const changedStep = ctx.flow.target === ctx.table.name ? currentStepKey(deps, ctx, id) : null
      return ok({ record: updateRecord(deps, ctx, id, request.body, { changedStep }) })
    }
    throw methodNotAllowed(request, ['GET', 'PATCH'])
  }

  // /api/{table}/{id}/advance
  if (action === 'advance' && checkKey === undefined) {
    if (request.method !== 'POST') throw methodNotAllowed(request, ['POST'])
    requireTarget(ctx)
    requireTableWrite(ctx.usage)
    const result = advance(deps, ctx, id, (request.body as Record<string, unknown> | null)?.['to'])
    return ok({ record: result.record, unmet: result.unmet })
  }

  // /api/{table}/{id}/checks/{key}
  if (action === 'checks' && checkKey !== undefined) {
    if (request.method !== 'PUT') throw methodNotAllowed(request, ['PUT'])
    requireTarget(ctx)
    requireTableWrite(ctx.usage)
    return ok({ record: setManualCheck(deps, ctx, id, checkKey, request.body) })
  }

  throw notFound(`ルートが無い: ${request.method} ${request.path}`)
}

// ---------------------------------------------------------------------------

function ok(body: unknown): ApiResponse {
  return { status: 200, body }
}

function methodNotAllowed(request: ApiRequest, allowed: readonly string[]): ApiError {
  return new ApiError(
    405,
    'method-not-allowed',
    `${request.method} は ${request.path} で使えない`,
    `使えるのは: ${allowed.join(', ')}`,
  )
}

/** ステップ操作は状態機械の主体（`flow({ target })`）にしか無い。 */
function requireTarget(ctx: RequestContext): void {
  if (ctx.flow.target === ctx.table.name) return
  throw badRequest(
    `"${ctx.table.name}" は業務フロー "${ctx.flow.key}" の target ではない`,
    `ステップを進むのは ${ctx.flow.target} のレコード。primary バインド（所有）とは別の軸`,
  )
}

/**
 * 更新前に行レベル認可を見る。
 *
 * `_permissions` を組み立てるのと同じ経路（SELECT に埋めた rowFilter の評価）を通すので、
 * **FE に見せた可否と実際の可否が食い違わない**。
 */
function requireRowWritable(deps: Deps, ctx: RequestContext, id: string): void {
  const record = getRecord(deps, ctx, id)
  const permissions = (record['_permissions'] ?? {}) as Record<string, boolean>
  if (permissions['update'] === true) return
  if (isHistorical(ctx)) {
    throw badRequest('as_of を付けた読み取り専用のリクエストでは更新できない')
  }
  throw new ApiError(
    403,
    'forbidden',
    '自分が担当のレコードではない',
    '行レベル認可は「読みは全員、書きは担当者＋管理者」',
  )
}
