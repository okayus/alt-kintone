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

/** ロールがそのフローのどれかのステップを担当しているか（フロー参加）。 */
export function participates(principal: Principal, flow: FlowDef): boolean {
  return isAdmin(principal) || flow.steps.some((step) => step.role === principal.role)
}

export function requireParticipation(principal: Principal, flow: FlowDef): void {
  if (participates(principal, flow)) return
  throw forbidden(
    `ロール "${principal.role}" は業務フロー "${flow.key}" に参加していない`,
    `このフローを担当するロール: ${[...new Set(flow.steps.map((s) => s.role))].join(', ')}`,
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
  if (isAdmin(principal) || principal.role === step.role) return
  throw forbidden(
    `${operation} はステップ "${step.key}" の担当ロール（${step.role}）の操作`,
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
  // 過去のバージョンには書けない（as_of は読み取り専用）
  const update = writable(input.usage.access) && input.rowWritable && !input.historical
  const permissions: Record<string, boolean> = { update }
  if (input.step !== undefined) {
    permissions['advance'] =
      update && (isAdmin(input.principal) || input.principal.role === input.step.role)
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
