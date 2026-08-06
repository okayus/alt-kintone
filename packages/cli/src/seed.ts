/**
 * 開発用のシードデータ。docs/impl/phase-3-backend.md 3-7
 *
 * **API からは入れられないデータがある**ので CLI から直接書く。`company` / `contact` /
 * `employee` は営業フローの reference バインド（読むだけ）なので、書き込み API が
 * 生えない — マスタ管理をどの業務フローに属させるかが未決着（§8-2 論点7）だからで、
 * これはその答えではなく**開発用の裏口**。
 *
 * ID は固定文字列にしてある。ランダムだとデモの手順もテストも再現しない。
 */
import type { DefinitionBundle } from '@alt/dsl'
import { insertFlowState, insertRecord, upsertManualCheck } from '@alt/sql'
import type Database from 'better-sqlite3'

type Db = Database.Database

/** シードの基準時刻。有効期間型の `valid_from` に入る。 */
const T0 = '2026-07-01T00:00:00.000Z'
const T1 = '2026-07-10T00:00:00.000Z'

const EMPLOYEES = [
  { id: 'e-yamada', name: '山田 太郎', email: 'yamada@example.com', role: 'sales_rep' },
  { id: 'e-sato', name: '佐藤 花子', email: 'sato@example.com', role: 'sales_rep' },
  { id: 'e-suzuki', name: '鈴木 一郎', email: 'suzuki@example.com', role: 'sales_manager' },
  { id: 'e-admin', name: '管理者', email: 'admin@example.com', role: 'admin' },
].map((e) => ({ ...e, team: '第1営業部', status: 'active' }))

const COMPANIES = [
  { id: 'c-yamada-shokudo', name: '山田食堂', industry: 'restaurant', leadSource: 'cold_call' },
  { id: 'c-hair-aoi', name: 'ヘアサロン葵', industry: 'beauty', leadSource: 'referral' },
  { id: 'c-marumi', name: 'まるみ商店', industry: 'retail', leadSource: 'web_form' },
].map((c) => ({ ...c, prefecture: '東京都', status: 'prospect', ownerEmployeeId: 'e-yamada' }))

const CONTACTS = [
  {
    id: 'ct-yamada-owner',
    companyId: 'c-yamada-shokudo',
    name: '山田 健',
    title: '店主',
    isDecisionMaker: true,
  },
  {
    id: 'ct-yamada-staff',
    companyId: 'c-yamada-shokudo',
    name: '田中 実',
    title: 'ホール責任者',
    isDecisionMaker: false,
  },
  {
    id: 'ct-aoi-owner',
    companyId: 'c-hair-aoi',
    name: '青井 美咲',
    title: 'オーナー',
    isDecisionMaker: true,
  },
  {
    id: 'ct-marumi-staff',
    companyId: 'c-marumi',
    name: '丸見 修',
    title: '店長',
    isDecisionMaker: false,
  },
]

/** ステップは `_flow_state` に入れる。業務テーブルの列ではない（決定5）。 */
const DEALS = [
  {
    id: 'd-yamada-jobad',
    companyId: 'c-yamada-shokudo',
    title: '山田食堂 ホールスタッフ求人',
    productType: 'job_ad',
    dealType: 'new',
    initialBilling: 180000,
    initialProfit: 54000,
    status: 'open',
    ownerEmployeeId: 'e-yamada',
    step: 'qualified',
  },
  {
    id: 'd-aoi-meo',
    companyId: 'c-hair-aoi',
    title: 'ヘアサロン葵 MEO運用',
    productType: 'meo',
    dealType: 'new',
    monthlyBilling: 30000,
    monthlyProfit: 18000,
    contractMonths: 12,
    expectedCloseMonth: '2026-08',
    confidence: 'A',
    status: 'open',
    ownerEmployeeId: 'e-yamada',
    step: 'proposed',
  },
  {
    id: 'd-marumi-jobad',
    companyId: 'c-marumi',
    title: 'まるみ商店 レジスタッフ求人',
    productType: 'job_ad',
    dealType: 'new',
    status: 'open',
    ownerEmployeeId: 'e-sato',
    step: 'contacted',
  },
  {
    id: 'd-yamada-meo',
    companyId: 'c-yamada-shokudo',
    title: '山田食堂 MEO運用',
    productType: 'meo',
    dealType: 'expansion',
    monthlyBilling: 25000,
    monthlyProfit: 15000,
    contractMonths: 6,
    expectedCloseMonth: '2026-07',
    confidence: 'B',
    status: 'won',
    ownerEmployeeId: 'e-sato',
    closedAt: '2026-07-08',
    step: 'won',
  },
  {
    id: 'd-aoi-jobad',
    companyId: 'c-hair-aoi',
    title: 'ヘアサロン葵 スタイリスト求人',
    productType: 'job_ad',
    dealType: 'new',
    status: 'suspended',
    ownerEmployeeId: 'e-yamada',
    step: 'suspended',
  },
]

const ACTIVITIES = [
  {
    id: 'a-1',
    companyId: 'c-yamada-shokudo',
    dealId: 'd-yamada-jobad',
    contactId: 'ct-yamada-owner',
    type: 'call',
    subject: '初回架電',
    completedAt: '2026-07-01T01:00:00.000Z',
    result: 'appointment',
    ownerEmployeeId: 'e-yamada',
  },
  {
    id: 'a-2',
    companyId: 'c-yamada-shokudo',
    dealId: 'd-yamada-jobad',
    contactId: 'ct-yamada-owner',
    type: 'visit',
    subject: '訪問ヒアリング',
    scheduledAt: '2026-07-20T02:00:00.000Z',
    ownerEmployeeId: 'e-yamada',
  },
  {
    id: 'a-3',
    companyId: 'c-hair-aoi',
    dealId: 'd-aoi-meo',
    contactId: 'ct-aoi-owner',
    type: 'online_meeting',
    subject: 'MEO提案',
    completedAt: '2026-07-05T05:00:00.000Z',
    result: 'advanced',
    ownerEmployeeId: 'e-yamada',
  },
  {
    id: 'a-4',
    companyId: 'c-marumi',
    dealId: 'd-marumi-jobad',
    contactId: 'ct-marumi-staff',
    type: 'call',
    subject: 'テレアポ',
    completedAt: '2026-07-06T00:30:00.000Z',
    result: 'connected',
    ownerEmployeeId: 'e-sato',
  },
  {
    id: 'a-5',
    companyId: 'c-marumi',
    dealId: 'd-marumi-jobad',
    type: 'visit',
    subject: '初回訪問',
    scheduledAt: '2026-07-25T04:00:00.000Z',
    ownerEmployeeId: 'e-sato',
  },
  {
    id: 'a-6',
    companyId: 'c-yamada-shokudo',
    dealId: 'd-yamada-meo',
    contactId: 'ct-yamada-owner',
    type: 'visit',
    subject: '受注',
    completedAt: '2026-07-08T06:00:00.000Z',
    result: 'won',
    ownerEmployeeId: 'e-sato',
  },
]

export interface SeedResult {
  /** テーブル名 → 入れた行数。 */
  inserted: Record<string, number>
  cleared: boolean
}

/**
 * 定義に沿ってデモデータを流す。
 *
 * 書き込みは `@alt/sql` の `insertRecord` を通す（有効期間型の列をサーバと同じ形で埋めるため）。
 * `changed_flow` / `changed_step` も埋めるので、シードのデータも「どのフローで作られたか」を持つ。
 */
export function seed(db: Db, bundle: DefinitionBundle, opts: { reset?: boolean } = {}): SeedResult {
  const flow = bundle.flows[0]
  if (flow === undefined) throw new Error('業務フローが定義されていない')

  const table = (name: string) => {
    const def = bundle.tables[name]
    if (def === undefined) throw new Error(`テーブル "${name}" が定義に無い`)
    return def
  }

  const inserted: Record<string, number> = {}
  const insert = (name: string, values: Record<string, unknown>, step: string | null) => {
    const { sql, params } = insertRecord({
      table: table(name),
      values,
      now: T0,
      context: { changedBy: 'e-admin', changedFlow: flow.key, changedStep: step },
    })
    db.prepare(sql).run(...params)
    inserted[name] = (inserted[name] ?? 0) + 1
  }

  const cleared = opts.reset === true
  db.transaction(() => {
    if (cleared) {
      for (const name of [...Object.keys(bundle.tables), '_flow_state', '_manual_check']) {
        db.exec(`DELETE FROM "${name}"`)
      }
    }

    for (const employee of EMPLOYEES) insert('employee', employee, null)
    for (const company of COMPANIES) insert('company', company, null)
    for (const contact of CONTACTS) insert('contact', contact, null)

    for (const { step, ...deal } of DEALS) {
      insert('deal', deal, step)
      const { sql, params } = insertFlowState({
        table: 'deal',
        recordId: deal.id,
        flow: flow.key,
        step,
        unmetChecks: null,
        now: T0,
        context: { changedBy: 'e-admin', changedFlow: flow.key, changedStep: null },
      })
      db.prepare(sql).run(...params)
      inserted['_flow_state'] = (inserted['_flow_state'] ?? 0) + 1
    }

    for (const activity of ACTIVITIES) insert('activity', activity, null)

    // 手動チェックが1件だけ立った状態にしておく（チェックリストの見た目を確認するため）
    const { sql, params } = upsertManualCheck({
      table: 'deal',
      recordId: 'd-yamada-jobad',
      flow: flow.key,
      step: 'qualified',
      checkKey: 'problem_identified',
      checked: true,
      checkedBy: 'e-yamada',
      checkedAt: T1,
    })
    db.prepare(sql).run(...params)
    inserted['_manual_check'] = 1
  })()

  return { inserted, cleared }
}
