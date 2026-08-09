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
  // 営業フローの担当ロールでも viewers でもない ＝ 参加していない。
  // 「フローに参加していないと 403」を画面で確かめられるようにするために居る
  { id: 'e-mori', name: '森 次郎', email: 'mori@example.com', role: 'production' },
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

// ---------------------------------------------------------------------------
// 改善要望（docs/impl/phase-9-change-requests.md T4）
//
// `--reset` は要望も消す（決定D）。守っても `alt apply --recreate` がテーブルごと
// 作り直すので意味がない。代わりに、reset 直後でも一覧が空にならないようサンプルを置く。
//
// **対象は definitionRef の合成キーで書く**。綴りを間違えるとサーバが弾くのと同じ値なので、
// ここが定義と食い違うことは（画面から起票したときと同様に）起きない。
// ---------------------------------------------------------------------------

const CHANGE_REQUESTS = [
  {
    id: 'cr-competitor',
    kind: 'cannot_record',
    problem:
      '失注したとき、どこに負けたかを後から集計できない。競合先の欄はあるが提案の段階では空のままで、失注してから思い出して書いている',
    wish: '提案のときに競合先を入れる場所がほしい',
    targetFlow: 'sales',
    targetStep: 'sales.proposed',
    targetField: 'deal.competitor',
    targetTable: 'deal',
    targetRecordId: 'd-aoi-meo',
    screenRoute: '#/deals/d-aoi-meo',
    situation: { unmetChecks: ['decision_maker_met'] },
    reporterEmployeeId: 'e-yamada',
    assigneeEmployeeId: 'e-admin',
    filedAt: T0,
    step: 'triaged',
  },
  {
    // 森は営業フローの担当ロールでも viewers でもない（＝案件は1件も読めない）。
    // それでも要望は出せる ＝ フェーズ8 の `roles: ROLE_KEYS` が効いていることのデモ
    id: 'cr-proof-flow',
    kind: 'new_business',
    problem:
      '原稿の入稿までの進み具合をどこにも記録できていない。いまは制作チームのスプレッドシートで、営業から「あの案件どうなってる」と毎回聞かれる',
    targetFlow: 'sales',
    targetTable: 'deal',
    screenRoute: '#/flows/sales',
    reporterEmployeeId: 'e-mori',
    filedAt: T1,
    step: 'filed',
  },
  {
    id: 'cr-decision-maker',
    kind: 'exit_mismatch',
    problem:
      '「決裁者を特定した」が、店主が一人でやっている店だと最初から満たされてしまい、確認したことにならない',
    targetFlow: 'sales',
    targetStep: 'sales.qualified',
    targetCheck: 'sales.qualified.decision_maker_identified',
    targetTable: 'deal',
    screenRoute: '#/flows/sales?step=qualified',
    reporterEmployeeId: 'e-suzuki',
    assigneeEmployeeId: 'e-admin',
    filedAt: T1,
    resolution: '充足のしかた（howTo）に「一人店舗でも面談で確認したうえで登録する」を足した',
    step: 'applied',
  },
]

/** やりとり。**起票者以外の書き込みがあると出口条件 `replied` が自動で充足する**。 */
const CHANGE_REQUEST_MESSAGES = [
  {
    id: 'crm-1',
    requestId: 'cr-competitor',
    authorEmployeeId: 'e-admin',
    body: '提案ステップの入力欄に競合先を出す方向で考えています。「まだ分からない」も選べたほうがよいですか？',
    postedAt: T1,
    authorKind: 'human',
  },
  {
    id: 'crm-2',
    requestId: 'cr-decision-maker',
    authorEmployeeId: 'e-admin',
    body: '条件そのものは変えず、充足のしかたの説明を直しました。次のヨミ会で見てみてください',
    postedAt: T1,
    authorKind: 'human',
  },
]

/**
 * 既読。山田は `crm-1` より前に読んだことにしてあるので、**未読が1件ある状態**で始まる
 * （ナビのバッジが最初から絵になる）。
 */
const CHANGE_REQUEST_READS = [
  { id: 'crr-1', requestId: 'cr-competitor', employeeId: 'e-yamada', readAt: T0 },
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

// ---------------------------------------------------------------------------
// 件数指定のダミーデータ（docs/impl/phase-6-list-grid.md T1）
//
// 一覧のグリッド化は「1万件でも重くならない」が要求なので、それを実際に置ける口が要る。
// **乱数は固定シード**。再現しないデータでは性能も表示も検証にならない。
// ---------------------------------------------------------------------------

/** mulberry32。暗号用途ではないが、TS と目視の再現性にはこれで足りる。 */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 生成する会社の上限（docs/impl/phase-6-list-grid.md 決定F）。
 *
 * FE の名前解決はマスタの全件取得に乗っていて、既定 limit は 100・上限は 500。
 * ここを超えると**黙って会社名が「—」になる**ので、生成側で踏まないようにしておく。
 */
const MAX_GENERATED_COMPANIES = 200

/** 案件名の素。部分一致フィルタ（`title_like`）が意味を持つ程度には散らす。 */
const TITLE_PARTS = {
  what: [
    'ホールスタッフ求人',
    'キッチンスタッフ求人',
    'レジスタッフ求人',
    'MEO運用',
    '看板リニューアル',
    'スタイリスト求人',
  ],
  when: ['春季', '夏季', '秋季', '冬季', '通年'],
} as const

const GENERATED_STEPS = [
  // 進行中に寄せる。決着だけの一覧では出口条件チェックリストの絵にならない
  { step: 'contacted', status: 'open', weight: 30 },
  { step: 'qualified', status: 'open', weight: 25 },
  { step: 'proposed', status: 'open', weight: 20 },
  { step: 'won', status: 'won', weight: 12 },
  { step: 'lost', status: 'lost', weight: 8 },
  { step: 'suspended', status: 'suspended', weight: 5 },
] as const

/**
 * 定義に沿ってデモデータを流す。
 *
 * 書き込みは `@alt/sql` の `insertRecord` を通す（有効期間型の列をサーバと同じ形で埋めるため）。
 * `changed_flow` / `changed_step` も埋めるので、シードのデータも「どのフローで作られたか」を持つ。
 */
export function seed(
  db: Db,
  bundle: DefinitionBundle,
  opts: { reset?: boolean; deals?: number } = {},
): SeedResult {
  const flowOf = (key: string) => {
    const def = bundle.flows.find((candidate) => candidate.key === key)
    if (def === undefined) throw new Error(`業務フロー "${key}" が定義に無い`)
    return def
  }
  // **キーで引く**（添字ではなく）。フローが2本になったので、順序に依存すると
  // 定義の並べ替えでシードの changed_flow が黙って入れ替わる
  const flow = flowOf('sales')
  const requestFlow = flowOf('request')

  const table = (name: string) => {
    const def = bundle.tables[name]
    if (def === undefined) throw new Error(`テーブル "${name}" が定義に無い`)
    return def
  }

  const inserted: Record<string, number> = {}
  // 1万件を流すので、同じ SQL を毎回 prepare し直さない
  // （文は列の並びが定義で決まるため、テーブルごとに1本で足りる）
  const statements = new Map<string, Database.Statement>()
  const prepared = (sql: string): Database.Statement => {
    let statement = statements.get(sql)
    if (statement === undefined) {
      statement = db.prepare(sql)
      statements.set(sql, statement)
    }
    return statement
  }

  /** 「どのフローの文脈で書いたか」（`changed_flow`）はフローごとに違うので、束ねて作る。 */
  const inserterFor =
    (flowKey: string) =>
    (name: string, values: Record<string, unknown>, step: string | null, now = T0) => {
      const { sql, params } = insertRecord({
        table: table(name),
        values,
        now,
        context: { changedBy: 'e-admin', changedFlow: flowKey, changedStep: step },
      })
      prepared(sql).run(...params)
      inserted[name] = (inserted[name] ?? 0) + 1
    }

  const insert = inserterFor(flow.key)
  const insertRequestRecord = inserterFor(requestFlow.key)

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

    /** 「レコードがどのフローのどのステップに居るか」。target のテーブルごとに1つ作る。 */
    const entererFor =
      (tableName: string, flowKey: string) =>
      (recordId: string, step: string, now = T0): void => {
        const { sql, params } = insertFlowState({
          table: tableName,
          recordId,
          flow: flowKey,
          step,
          unmetChecks: null,
          now,
          context: { changedBy: 'e-admin', changedFlow: flowKey, changedStep: null },
        })
        prepared(sql).run(...params)
        inserted['_flow_state'] = (inserted['_flow_state'] ?? 0) + 1
      }

    const enterFlow = entererFor('deal', flow.key)
    const enterRequest = entererFor('change_request', requestFlow.key)

    for (const { step, ...deal } of DEALS) {
      insert('deal', deal, step)
      enterFlow(deal.id, step)
    }

    for (const activity of ACTIVITIES) insert('activity', activity, null)

    // 改善要望。`filedAt` / `postedAt` は本来サーバが埋めるが、シードは
    // `insertRecord` を直に叩く開発用の裏口なので明示的に渡す（決定G）
    for (const { step, ...request } of CHANGE_REQUESTS) {
      insertRequestRecord('change_request', request, step, request.filedAt)
      enterRequest(request.id, step, request.filedAt)
    }
    for (const message of CHANGE_REQUEST_MESSAGES) {
      insertRequestRecord('change_request_message', message, null, message.postedAt)
    }
    for (const read of CHANGE_REQUEST_READS) {
      insertRequestRecord('change_request_read', read, null, read.readAt)
    }

    if (opts.deals !== undefined && opts.deals > 0) {
      generate(opts.deals, insert, enterFlow)
    }

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

type Insert = (
  name: string,
  values: Record<string, unknown>,
  step: string | null,
  now?: string,
) => void

/**
 * ダミー案件を n 件（と、必要な会社を）作る。
 *
 * `valid_from` を散らすのが要点。既定の並びは更新が新しい順なので、全件同じ時刻だと
 * 「窓を切っても順序が決まる」（id のタイブレーク）が効いているのか、たまたま並んでいる
 * だけなのかが画面で見分けられない。
 */
function generate(
  n: number,
  insert: Insert,
  enterFlow: (id: string, step: string, now: string) => void,
): void {
  const next = random(20260808)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T

  const companyCount = Math.min(MAX_GENERATED_COMPANIES, Math.max(3, Math.ceil(n / 50)))
  const companyIds: string[] = []
  for (let i = 0; i < companyCount; i += 1) {
    const id = `c-gen-${String(i).padStart(3, '0')}`
    companyIds.push(id)
    insert(
      'company',
      {
        id,
        name: `${pick(['山田', '青井', '丸見', '中村', '小林'])}${pick(['商店', '食堂', '亭', 'サロン', 'ストア'])} ${String(i).padStart(3, '0')}`,
        industry: pick(['restaurant', 'beauty', 'retail']),
        leadSource: pick(['cold_call', 'referral', 'web_form']),
        prefecture: '東京都',
        status: 'prospect',
        ownerEmployeeId: pick(['e-yamada', 'e-sato']),
      },
      null,
    )
  }

  // 重み付き抽選の台。ステップごとの件数が偏っているほうが一覧として現実的
  const stepPool = GENERATED_STEPS.flatMap((entry) =>
    Array.from({ length: entry.weight }, () => entry),
  )

  const day = 24 * 60 * 60 * 1000
  const base = Date.parse(T0)

  for (let i = 0; i < n; i += 1) {
    const id = `d-gen-${String(i).padStart(6, '0')}`
    const { step, status } = pick(stepPool)
    const productType = pick(['job_ad', 'meo', 'other'] as const)
    const stock = productType === 'meo'
    // 直近180日にばらす。同じ日に複数件が入るのは実際の営業データと同じ
    const at = new Date(base - Math.floor(next() * 180) * day).toISOString()

    const companyId = pick(companyIds)
    insert(
      'deal',
      {
        id,
        companyId,
        title: `${pick(TITLE_PARTS.when)}${pick(TITLE_PARTS.what)} ${String(i).padStart(6, '0')}`,
        productType,
        dealType: pick(['new', 'new', 'renewal', 'repeat', 'expansion'] as const),
        ...(stock
          ? {
              monthlyBilling: 20_000 + Math.floor(next() * 8) * 5_000,
              monthlyProfit: 12_000 + Math.floor(next() * 8) * 3_000,
              contractMonths: pick([6, 12, 24]),
            }
          : {
              initialBilling: 100_000 + Math.floor(next() * 20) * 10_000,
              initialProfit: 30_000 + Math.floor(next() * 20) * 3_000,
            }),
        // 3割は未入力にしておく。NULL が末尾に来る並び（決定D）が画面で見える
        ...(next() < 0.7
          ? { expectedCloseMonth: `2026-${String(1 + Math.floor(next() * 12)).padStart(2, '0')}` }
          : {}),
        ...(next() < 0.7 ? { confidence: pick(['A', 'B', 'C'] as const) } : {}),
        status,
        ownerEmployeeId: pick(['e-yamada', 'e-sato']),
        ...(status === 'won' || status === 'lost' ? { closedAt: at.slice(0, 10) } : {}),
      },
      step,
      at,
    )
    enterFlow(id, step, at)

    // 活動も生成する。**出口条件の自動判定は activity / contact を相関サブクエリで読む**ので、
    // ここが数件しか無い DB で測った性能は当てにならない（1万件の案件には数万件の活動が伴う）。
    // ついでに、一覧の「未確認 n件」がステップごとに散って絵として意味を持つようになる
    const activities = Math.floor(next() * 4)
    for (let k = 0; k < activities; k += 1) {
      const done = next() < 0.7
      const atK = new Date(Date.parse(at) + k * day).toISOString()
      insert(
        'activity',
        {
          id: `${id}-a${k}`,
          companyId,
          dealId: id,
          type: pick(['call', 'visit', 'online_meeting', 'email'] as const),
          subject: pick(['初回架電', '訪問ヒアリング', '提案', 'フォロー']),
          ...(done
            ? { completedAt: atK, result: pick(['connected', 'appointment', 'advanced']) }
            : { scheduledAt: atK }),
          ownerEmployeeId: pick(['e-yamada', 'e-sato']),
        },
        null,
        atK,
      )
    }
  }
}
