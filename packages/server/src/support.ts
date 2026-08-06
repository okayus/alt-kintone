/**
 * テスト用の足場（テストからのみ import する。index.ts では公開しない）。
 *
 * 定義は `@alt/definitions` をそのまま使う。**営業フローそのもので検証したい**ため
 * （devDependency。実行時にサーバが定義を知るのは JSON 経由で、コンパイル時の依存ではない）。
 *
 * データは `alt seed` のデモデータではなく、テストが読んで意味が分かる最小の集合を置く。
 */
import { createApp, type App } from './app.js'
import { buildRegistry } from './registry.js'
import type { ApiRequest, ApiResponse } from './api.js'
import { flows, roles, tables } from '@alt/definitions'
import type { DefinitionBundle } from '@alt/dsl'
import { insertFlowState, insertRecord, schemaStatements } from '@alt/sql'
import Database from 'better-sqlite3'

export const bundle: DefinitionBundle = { tables, flows, roles }

/** 固定時刻。有効期間型のテストが実時間に依存しないようにする。 */
export const NOW = '2026-07-15T00:00:00.000Z'
export const SEEDED_AT = '2026-07-01T00:00:00.000Z'

export const YAMADA = 'yamada@example.com'
export const SATO = 'sato@example.com'
export const MANAGER = 'suzuki@example.com'
export const ADMIN = 'admin@example.com'

export interface Fixture {
  app: App
  db: Database.Database
  /** リクエストを1本投げる。既定のユーザーは山田（営業担当）。 */
  request(method: string, path: string, opts?: RequestOptions): ApiResponse
  /** SQL を直接叩いて DB の中身を見る（有効期間型の検証用）。 */
  rows(sql: string, ...params: unknown[]): Array<Record<string, unknown>>
}

export interface RequestOptions {
  user?: string | null
  body?: unknown
  now?: string
}

export function fixture(): Fixture {
  const db = new Database(':memory:')
  for (const sql of schemaStatements(bundle)) db.exec(sql)
  insertFixtureData(db)

  const registry = buildRegistry(bundle)
  let now = NOW
  const app = createApp({
    db,
    registry,
    authenticator: (headers) => headers['x-dev-user'],
    clock: () => now,
  })

  return {
    app,
    db,
    request(method, path, opts = {}) {
      now = opts.now ?? NOW
      const [pathname, search] = path.split('?')
      const request: ApiRequest = {
        method,
        path: pathname ?? '/',
        query: Object.fromEntries(new URLSearchParams(search ?? '')),
        headers: opts.user === null ? {} : { 'x-dev-user': opts.user ?? YAMADA },
        body: opts.body,
      }
      return app.handle(request)
    },
    rows: (sql, ...params) => db.prepare(sql).all(...params) as Array<Record<string, unknown>>,
  }
}

// ---------------------------------------------------------------------------

const EMPLOYEES = [
  { id: 'e-yamada', name: '山田', email: YAMADA, role: 'sales_rep', status: 'active' },
  { id: 'e-sato', name: '佐藤', email: SATO, role: 'sales_rep', status: 'active' },
  { id: 'e-suzuki', name: '鈴木', email: MANAGER, role: 'sales_manager', status: 'active' },
  { id: 'e-admin', name: '管理', email: ADMIN, role: 'admin', status: 'active' },
]

const COMPANIES = [{ id: 'co-1', name: '山田食堂', status: 'prospect' }]

const CONTACTS = [
  { id: 'ct-boss', companyId: 'co-1', name: '山田 健', isDecisionMaker: true },
  { id: 'ct-staff', companyId: 'co-1', name: '田中', isDecisionMaker: false },
]

/**
 * 案件3件。出口条件の充足がそれぞれ違う状態にしてある。
 *  - d-1（qualified・山田）: 金額あり → budget_confirmed 充足、決裁者も居る
 *  - d-2（contacted・山田）: 未完了のアポあり → appointment_scheduled 充足
 *  - d-3（qualified・佐藤）: 金額なし → budget_confirmed 未充足（NULL の伝播も見る）
 */
const DEALS = [
  {
    id: 'd-1',
    companyId: 'co-1',
    title: '求人広告',
    productType: 'job_ad',
    dealType: 'new',
    status: 'open',
    ownerEmployeeId: 'e-yamada',
    initialBilling: 180000,
    step: 'qualified',
  },
  {
    id: 'd-2',
    companyId: 'co-1',
    title: 'MEO',
    productType: 'meo',
    dealType: 'new',
    status: 'open',
    ownerEmployeeId: 'e-yamada',
    step: 'contacted',
  },
  {
    id: 'd-3',
    companyId: 'co-1',
    title: '他人の案件',
    productType: 'other',
    dealType: 'new',
    status: 'open',
    ownerEmployeeId: 'e-sato',
    step: 'qualified',
  },
]

const ACTIVITIES = [
  {
    id: 'a-1',
    companyId: 'co-1',
    dealId: 'd-2',
    contactId: 'ct-boss',
    type: 'visit',
    subject: '訪問予定',
    scheduledAt: '2026-07-20T02:00:00.000Z',
    ownerEmployeeId: 'e-yamada',
  },
]

function insertFixtureData(db: Database.Database): void {
  const insert = (table: string, values: Record<string, unknown>) => {
    const def = bundle.tables[table]
    if (def === undefined) throw new Error(`テーブル "${table}" が定義に無い`)
    const { sql, params } = insertRecord({
      table: def,
      values,
      now: SEEDED_AT,
      context: { changedBy: 'e-admin', changedFlow: 'sales', changedStep: null },
    })
    db.prepare(sql).run(...params)
  }

  for (const employee of EMPLOYEES) insert('employee', employee)
  for (const company of COMPANIES) insert('company', company)
  for (const contact of CONTACTS) insert('contact', contact)
  for (const activity of ACTIVITIES) insert('activity', activity)

  for (const { step, ...deal } of DEALS) {
    insert('deal', deal)
    const { sql, params } = insertFlowState({
      table: 'deal',
      recordId: deal.id,
      flow: 'sales',
      step,
      unmetChecks: null,
      now: SEEDED_AT,
      context: { changedBy: 'e-admin', changedFlow: 'sales', changedStep: null },
    })
    db.prepare(sql).run(...params)
  }
}

/** レスポンスの record / records を型を気にせず読むための小道具。 */
export function record(response: ApiResponse): Record<string, unknown> {
  return (response.body as { record: Record<string, unknown> }).record
}

export function records(response: ApiResponse): Array<Record<string, unknown>> {
  return (response.body as { records: Array<Record<string, unknown>> }).records
}

export function flowOf(view: Record<string, unknown>): Record<string, unknown> {
  return view['_flow'] as Record<string, unknown>
}

export function exitOf(view: Record<string, unknown>): Array<Record<string, unknown>> {
  return flowOf(view)['exit'] as Array<Record<string, unknown>>
}

export function permissionsOf(view: Record<string, unknown>): Record<string, boolean> {
  return view['_permissions'] as Record<string, boolean>
}

export function errorCode(response: ApiResponse): string {
  return (response.body as { error: { code: string } }).error.code
}
