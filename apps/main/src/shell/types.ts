/**
 * API レスポンスの形。docs/impl/phase-4-frontend.md 決定D
 *
 * ⚠ **手書きである。** 定義（`@alt/definitions`）から導出したいところだが、`table()` は
 *    `FieldDef` を型消去するので `typeof deal` から `{ title: string, … }` を取り出せない。
 *    docs/product-concept.md §5-6 の「FEが定義の型を import すれば乖離もコンパイルエラーで
 *    落ちる」は、**現状の DSL では成立していない**（§8-2 論点15）。
 *
 *    つまりここは定義とFEの二重管理になっている。テーブルにフィールドを足しても
 *    このファイルは自動では増えない。DSL が型を保持するようになったら、
 *    `RecordOf<typeof deal>` に置き換わって消える。
 *
 * サーバ側の対応は `packages/server/src/records.ts` の `toView`。
 * キーは定義のフィールド名（camelCase）で、列名（snake_case）は外に出てこない。
 */

/** 有効期間型のメタ。「誰が・いつ・どのフローのどのステップで」変えたか。 */
export interface VersionMeta {
  validFrom: string | null
  validTo: string | null
  changedBy: string | null
  changedFlow: string | null
  changedStep: string | null
}

/** 出口条件1件。自動判定はSQLで一括評価された結果、手動は `_manual_check` の状態。 */
export interface ExitView {
  key: string
  label: string
  kind: 'auto' | 'manual'
  satisfied: boolean
  checkedBy?: string | null
  checkedAt?: string | null
}

/** 業務フロー定義がレコードに現れる形。現在地・チェックリスト・遷移先がここに揃う。 */
export interface FlowView {
  flow: string
  step: string
  stepName: string
  enteredAt: string | null
  exit: ExitView[]
  unsatisfied: number
  /** このステップに入ったときに未充足だった、直前ステップの出口条件。 */
  enteredUnmet: string[]
  next: Array<{ key: string; name: string }>
}

/**
 * レコードごとの操作可否。**FEはここを見るだけで、認可を再判定しない**
 * （docs/product-concept.md §4-1）。
 */
export interface Permissions {
  update: boolean
  /** target テーブル（案件）のときだけ返る。 */
  advance?: boolean
}

interface Meta {
  _version: VersionMeta
  _permissions: Permissions
}

export type ProductType = 'job_ad' | 'meo' | 'other'
export type DealType = 'new' | 'renewal' | 'repeat' | 'expansion'
export type DealStatus = 'open' | 'suspended' | 'won' | 'lost' | 'abandoned'
export type OutcomeReason = 'competitor' | 'own_reason' | 'buyer_reason' | 'no_decision'
export type Confidence = 'A' | 'B' | 'C'

export interface Deal extends Meta {
  id: string
  companyId: string
  title: string
  productType: ProductType
  dealType: DealType
  initialBilling: number | null
  initialProfit: number | null
  monthlyBilling: number | null
  monthlyProfit: number | null
  contractMonths: number | null
  expectedCloseMonth: string | null
  confidence: Confidence | null
  status: DealStatus
  outcomeReasonCategory: OutcomeReason | null
  outcomeReasonDetail: string | null
  competitor: string | null
  ownerEmployeeId: string
  closedAt: string | null
  note: string | null
  /** 営業フローの target なので必ず付く（`_flow_state` に行が無ければ null）。 */
  _flow: FlowView | null
}

export interface Company extends Meta {
  id: string
  name: string
  nameKana: string | null
  industry: string | null
  prefecture: string | null
  city: string | null
  address: string | null
  phone: string | null
  website: string | null
  leadSource: string | null
  ownerEmployeeId: string | null
  status: string
  note: string | null
}

export interface Contact extends Meta {
  id: string
  companyId: string
  name: string
  title: string | null
  phone: string | null
  email: string | null
  isDecisionMaker: boolean
  note: string | null
}

export interface Employee extends Meta {
  id: string
  name: string
  email: string
  role: string
  team: string | null
  status: string
}

export interface Activity extends Meta {
  id: string
  companyId: string
  dealId: string | null
  contactId: string | null
  type: string
  subject: string
  scheduledAt: string | null
  completedAt: string | null
  ownerEmployeeId: string
  result: string | null
  note: string | null
}

/** 案件の編集で送れるフィールド（`companyId` / `ownerEmployeeId` は対象外）。 */
export type DealPatch = Partial<
  Pick<
    Deal,
    | 'title'
    | 'productType'
    | 'dealType'
    | 'initialBilling'
    | 'initialProfit'
    | 'monthlyBilling'
    | 'monthlyProfit'
    | 'contractMonths'
    | 'expectedCloseMonth'
    | 'confidence'
    | 'status'
    | 'outcomeReasonCategory'
    | 'outcomeReasonDetail'
    | 'competitor'
    | 'closedAt'
    | 'note'
  >
>
