/**
 * 認可。docs/product-concept.md §4-1、docs/impl/phase-3-backend.md 3-6
 *
 * **権限設定を別に書かない。** 誰が何をできるかは業務フロー定義から導出する。
 * kintone では権限設定が別画面にあって業務と乖離するが、定義が源泉なら乖離しようがない。
 *
 * 4つの層で判定する:
 *   1. フロー参加   … ロールがそのフローのどれかのステップの担当である
 *   2. テーブル      … 導出された access（reads/writes から）が操作を許す
 *   3. ステップ操作 … advance と手動チェックは現在ステップの role と一致
 *   4. 行レベル      … 読みは全員、書きは rowFilter.write を満たす行のみ
 *
 * 認証（リクエスト → ユーザーIDの解決）はここに無い。境界を切ってあるので、
 * OIDC を入れるときに置き換わるのは `Authenticate` の実装だけ。
 */
import { forbidden, unauthorized } from './api.js'
import { writable, type TableUsage } from './registry.js'
import type { FlowDef, StepDef } from '@alt/dsl'
import type Database from 'better-sqlite3'

/**
 * リクエスト → ユーザーの識別子（認証の責務はここまで）。
 *
 * プロトタイプでは `X-Dev-User` の値をそのまま返す実装を注入する
 * （`auth/dev-user.ts`）。本番は OIDC のトークンから subject を取り出す実装になる。
 */
export type Authenticate = (headers: Record<string, string>) => string | undefined

/**
 * 認証済みの利用者。
 *
 * ⚠ **プラットフォームが客先定義の名前を直に知っている**箇所が2つある
 * （下の `PRINCIPAL_TABLE` と `ADMIN_ROLE`）。「どのテーブルが利用者か」「どのロールが
 * 管理者か」を定義で宣言する仕組みは、いまは持たない。基盤として作るか客先アプリの
 * 内部構造として作るか（docs/product-concept.md §10-1）が未決着なので、
 * 先に宣言の仕組みを作って決めてしまわない。差し替え点はこの2つの定数だけ。
 */
export interface Principal {
  id: string
  name: string
  email: string
  role: string
}

/** 利用者を持つテーブル。認証を入れるときは IdP の subject 列をここに足す。 */
export const PRINCIPAL_TABLE = 'employee'

/** 特別ロール。行レベルの制限も遷移の制限もバイパスする（§4-1）。 */
export const ADMIN_ROLE = 'admin'

export function isAdmin(principal: Principal): boolean {
  return principal.role === ADMIN_ROLE
}

/**
 * 識別子から利用者を引く。プロトタイプでは email で引く
 * （`employee` に IdP の subject がまだ無いため）。
 */
export function resolvePrincipal(db: Database.Database, subject: string): Principal | undefined {
  const row = db
    .prepare(
      `SELECT "id", "name", "email", "role" FROM "${PRINCIPAL_TABLE}"` +
        ' WHERE "email" = ? AND "valid_to" IS NULL',
    )
    .get(subject) as Principal | undefined
  return row
}

export function authenticate(
  db: Database.Database,
  headers: Record<string, string>,
  authenticator: Authenticate,
): Principal {
  const subject = authenticator(headers)
  if (subject === undefined || subject === '') {
    throw unauthorized(
      'ユーザーを特定できない',
      'プロトタイプは認証を実装していない。X-Dev-User に employee.email を入れて呼ぶ',
    )
  }
  const principal = resolvePrincipal(db, subject)
  if (principal === undefined) {
    throw unauthorized(
      `"${subject}" に一致する ${PRINCIPAL_TABLE} が居ない`,
      'alt seed が入れた従業員の email を使う',
    )
  }
  return principal
}

// ---------------------------------------------------------------------------
// 層1〜3
// ---------------------------------------------------------------------------

/**
 * フローへの参加の種類。**「参加しているか」と「どう参加しているか」を1つの値で返す**
 * （docs/impl/phase-8-authz-participation.md 決定C）。
 *
 *  - admin    … 特別ロール。行レベルも遷移も制限をバイパスする
 *  - operator … どれかのステップの担当。読み書きする
 *  - viewer   … `flow.viewers` に居る。**読むだけ**（管理職・監査役）
 *  - none     … 参加していない。403
 *
 * viewer を `access` に落として表現しない（＝ viewer のとき usage.access を read に
 * 書き換える、はやらない）。access は**そのフローがそのテーブルをどう使うか**であって
 * 人の偉さではない、という層2 の設計をここで崩さないため。
 */
export type Participation = 'admin' | 'operator' | 'viewer' | 'none'

export function participation(principal: Principal, flow: FlowDef): Participation {
  if (isAdmin(principal)) return 'admin'
  if (flow.steps.some((step) => step.roles.includes(principal.role))) return 'operator'
  if (flow.viewers?.includes(principal.role) === true) return 'viewer'
  return 'none'
}

/** 参加していなければ 403。参加していれば**種類を返す**ので、呼び出し側が持ち回れる。 */
export function requireParticipation(principal: Principal, flow: FlowDef): Participation {
  const kind = participation(principal, flow)
  if (kind !== 'none') return kind
  const operators = [...new Set(flow.steps.flatMap((s) => s.roles))].join(', ')
  const viewers = flow.viewers ?? []
  throw forbidden(
    `ロール "${principal.role}" は業務フロー "${flow.key}" に参加していない`,
    `このフローを担当するロール: ${operators}` +
      (viewers.length > 0 ? ` / 閲覧できるロール: ${viewers.join(', ')}` : ''),
  )
}

/**
 * 書き込みの入口（層2 と並べて置く）。**viewer をここで止める**。
 *
 * ⚠ これが無いと `POST /api/{table}`（新規作成）が通る。まだ行が無いので
 * 行レベル認可を評価できず、`usage.access` はフロー単位の導出値なので viewer も
 * `writable()` を通ってしまう。他の書き込み経路（PATCH / advance / checks）は
 * 別の理由でたまたま止まるが、**偶然を頼りにしない**
 * （docs/impl/phase-8-authz-participation.md §2-2）。
 */
export function requireOperator(kind: Participation, operation: string): void {
  if (kind !== 'viewer') return
  throw forbidden(
    `${operation} は閲覧のみの立場ではできない`,
    'このロールはフロー定義の viewers に居る（読み取り専用）。書けるのは担当ロールと管理者',
  )
}

/**
 * テーブルへの書き込みが access で許されているか（層2）。読みは usage があれば通る。
 *
 * ⚠ 管理者もバイパスしない。access は「そのフローがそのテーブルをどう使うか」であって
 * 人の偉さではない。読むだけのテーブルに書ける管理者を作ると、バインディングが
 * 業務の記録として信用できなくなる。マスタ更新の置き場は §8-2 論点7 のまま。
 */
export function requireTableWrite(usage: TableUsage): void {
  if (writable(usage.access)) return
  throw forbidden(
    `業務フロー "${usage.flow.key}" は "${usage.table}" を読むだけ（access: ${usage.access}）`,
    'access はステップの reads / writes から導出される。書けるようにするなら、' +
      'どこかのステップの writes に足す（定義の変更）',
  )
}

/** ステップ操作（層3）。advance と手動チェックが対象。 */
export function requireStepRole(principal: Principal, step: StepDef, operation: string): void {
  if (isAdmin(principal) || step.roles.includes(principal.role)) return
  throw forbidden(
    `${operation} はステップ "${step.key}" の担当ロール（${step.roles.join(', ')}）の操作`,
    `いまのロールは ${principal.role}。担当者か管理者が行う`,
  )
}

// ---------------------------------------------------------------------------
// 層4 と _permissions
// ---------------------------------------------------------------------------

/**
 * 行レベル認可の述語。`bind()` の rowFilter（`@alt/dsl`）をそのまま使う。
 * 管理者はバイパスするので述語を評価しない。
 */
export function rowFilterOf(principal: Principal, usage: TableUsage) {
  if (isAdmin(principal)) return undefined
  return usage.binding?.rowFilter?.write
}

export interface PermissionInput {
  principal: Principal
  usage: TableUsage
  /** フローへの参加の種類。viewer は書けない。 */
  participation: Participation
  /** SQL が返した rowFilter の評価結果。rowFilter が無ければ true 相当。 */
  rowWritable: boolean
  /** 過去のバージョンを見ているか。 */
  historical: boolean
  /** target テーブルのときの現在ステップ。 */
  step: StepDef | undefined
}

/**
 * レコードごとの操作可否。**FEに認可ロジックを複製しない**ための出力（§4-1）。
 * 「編集ボタンを出すか」をFE側で再判定させると、認可が2箇所に分かれて必ず乖離する。
 */
export function permissionsOf(input: PermissionInput): Record<string, boolean> {
  // 過去のバージョンには書けない（as_of は読み取り専用）。viewer も書けない
  const update =
    input.participation !== 'viewer' &&
    writable(input.usage.access) &&
    input.rowWritable &&
    !input.historical
  const permissions: Record<string, boolean> = { update }
  if (input.step !== undefined) {
    permissions['advance'] =
      update && (input.participation === 'admin' || input.step.roles.includes(input.principal.role))
  }
  return permissions
}

/** 行レベル（層4）。403 のメッセージを操作ごとに分けたいので個別に呼ぶ。 */
export function requireRowWrite(rowWritable: boolean): void {
  if (rowWritable) return
  throw forbidden(
    '自分が担当のレコードではない',
    '行レベル認可は「読みは全員、書きは担当者＋管理者」。担当者に変更を依頼するか、管理者が行う',
  )
}
