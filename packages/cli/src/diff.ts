/**
 * 適用済みの定義と作業ツリーの定義を比べる。docs/impl/phase-10-definition-diff.md
 *
 * 比較そのものは `@alt/diff` の純関数。ここがやるのは
 *
 *  1. **適用済みバンドル（`data/definitions.json`）を読む**（決定A。両方を持っているのは CLI だけ）
 *  2. **いまのデータへの影響を数える**（§2-3。DB を持っているのも CLI だけ）
 *  3. 開発者向けのテキストに整形する
 *
 * ⚠ 読むのは「最後に apply した定義」ではなく「**サーバが読んでいる定義**」。
 *   `alt export` を忘れると差分が実態とズレるので、出力に比較元のパスと更新時刻を出す。
 */
import {
  describeFieldRef,
  diffBundles,
  type BundleDiff,
  type DiffEntry,
  type Impact,
  type NotCounted,
} from '@alt/diff'
import {
  definitionBundleSchema,
  referencedFields,
  resolveFieldPath,
  ROOT_SOURCE,
  toColumnName,
  type AutoCheck,
  type DefinitionBundle,
  type FlowDef,
  type Pred,
  type TableDef,
} from '@alt/dsl'
import {
  closeCurrentRow,
  countRecords,
  decodeValue,
  insertRecord,
  selectFlowState,
  selectRecords,
  type ContextValues,
} from '@alt/sql'
import { REQUEST } from './bundle.js'
import type Database from 'better-sqlite3'
import { readFileSync, statSync } from 'node:fs'

type Db = Database.Database

/** 適用済みバンドルの既定の置き場。サーバの既定（`ALT_DEFINITIONS`）と揃えてある。 */
export const DEFAULT_APPLIED_PATH = 'data/definitions.json'

export interface AppliedBundle {
  path: string
  /** ファイルの更新時刻（ISO）。`alt export` を忘れていないかを読む人が判断する材料。 */
  exportedAt: string
  bundle: DefinitionBundle
}

export function loadApplied(path: string = DEFAULT_APPLIED_PATH): AppliedBundle {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(
      `適用済みの定義が読めない: ${path}\n` +
        '→ alt export --out data/definitions.json で書き出す（サーバが読んでいるのもこのファイル）',
    )
  }
  const parsed = definitionBundleSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(`適用済みの定義が定義バンドルの形になっていない: ${path}`)
  }
  return { path, exportedAt: statSync(path).mtime.toISOString(), bundle: parsed.data }
}

// ---------------------------------------------------------------------------
// 影響件数（§2-3・決定E）
// ---------------------------------------------------------------------------

/** 条件式のコンテキスト。出口条件は本来これを使わないが、compile が要求するので埋める。 */
const CONTEXT: ContextValues = { 'currentUser.id': null, today: null, now: null }

/** `countRecords` が返す列は `total`（`count` ではない）。 */
const count = (db: Db, sql: string, params: readonly unknown[]): number =>
  Number((db.prepare(sql).get(...params) as { total?: number } | undefined)?.total ?? 0)

/**
 * 適用前に「いまのデータに何が起きるか」を数える。
 *
 * 数えるのは3種類（決定E）で、どれも `countRecords` を1〜2本叩くだけ。
 * **数えられないものは黙って落とさず `notCounted` に理由を残す**。
 */
export function measureImpact(
  db: Db,
  before: DefinitionBundle,
  after: DefinitionBundle,
  entries: readonly DiffEntry[],
): { impacts: Impact[]; notCounted: NotCounted[] } {
  const impacts: Impact[] = []
  const notCounted: NotCounted[] = []
  const skip = (entry: DiffEntry, reason: string): void => {
    notCounted.push({ ref: entry.ref ?? '', where: entry.where, summary: entry.summary, reason })
  }

  for (const entry of entries) {
    const ref = entry.ref
    if (ref === undefined) continue
    try {
      if (entry.kind === 'exit.added') addedCheck(db, before, after, entry, ref, impacts, skip)
      else if (entry.kind === 'step.removed') removedStep(db, before, entry, ref, impacts, skip)
      else if (entry.kind === 'field.required')
        requiredField(db, before, after, entry, ref, impacts, skip)
    } catch (error) {
      // 数えられないことがコマンド全体を落とす理由にはならない（差分は出せている）
      skip(entry, `数え方が分からなかった: ${error instanceof Error ? error.message : error}`)
    }
  }
  return { impacts, notCounted }
}

type Skip = (entry: DiffEntry, reason: string) => void

/** 追加された自動判定が、いまそのステップにいるレコードのうち何件で未充足になるか。 */
function addedCheck(
  db: Db,
  before: DefinitionBundle,
  after: DefinitionBundle,
  entry: DiffEntry,
  ref: string,
  impacts: Impact[],
  skip: Skip,
): void {
  const [flowKey, stepKey, checkKey] = ref.split('.')
  const flow = after.flows.find((candidate) => candidate.key === flowKey)
  const step = flow?.steps.find((candidate) => candidate.key === stepKey)
  const exit = step?.exit.find((candidate) => candidate.key === checkKey)
  if (flow === undefined || step === undefined || exit === undefined) return
  if (exit.kind !== 'auto') return // 手動チェックは全件が未確認から始まるので数える意味がない

  const target = before.tables[flow.target]
  if (target === undefined) {
    skip(entry, '新しい業務フローの条件なので、いまのデータには対象がいません')
    return
  }
  const missing = unresolvable(before, after, flow, exit)
  if (missing !== undefined) {
    // ⚠ §2-3。新しい項目を見ている条件は、その列がまだ DB に無いので SQL が投げられない
    skip(entry, `新しい項目「${missing}」を見ているので、適用前には数えられません`)
    return
  }

  const base = { registry: before.tables, table: target, values: CONTEXT, flow: flowKey }
  const total = counted(db, { ...base, steps: [step.key] })
  // ⚠ NOT で数えない。SQL の比較は NULL を伝播するので取りこぼす（§2-3）
  const satisfied = counted(db, { ...base, steps: [step.key], where: exit.condition })

  impacts.push({
    ref,
    where: entry.where,
    summary:
      `新しい条件「${exit.label}」が未充足になる${target.label}: ${total - satisfied} 件` +
      `（「${step.name}」にいる ${total} 件のうち）`,
    count: total - satisfied,
    total,
  })
}

/** 消えるステップに滞留しているレコード（行き先が無くなる）。 */
function removedStep(
  db: Db,
  before: DefinitionBundle,
  entry: DiffEntry,
  ref: string,
  impacts: Impact[],
  skip: Skip,
): void {
  const [flowKey, stepKey] = ref.split('.')
  const flow = before.flows.find((candidate) => candidate.key === flowKey)
  const target = flow === undefined ? undefined : before.tables[flow.target]
  const step = flow?.steps.find((candidate) => candidate.key === stepKey)
  if (flow === undefined || target === undefined || step === undefined) {
    skip(entry, '消える段階の対象データが分かりませんでした')
    return
  }

  const base = { registry: before.tables, table: target, values: CONTEXT, flow: flowKey }
  const stuck = counted(db, { ...base, steps: [step.key] })
  const total = counted(db, base)

  impacts.push({
    ref,
    where: entry.where,
    summary: `行き先が無くなる${target.label}: ${stuck} 件（いま「${step.name}」にいるもの）`,
    count: stuck,
    total,
  })
}

/** 必須になる項目が、いま空のままのレコード。 */
function requiredField(
  db: Db,
  before: DefinitionBundle,
  after: DefinitionBundle,
  entry: DiffEntry,
  ref: string,
  impacts: Impact[],
  skip: Skip,
): void {
  const [tableName, fieldName] = ref.split('.')
  if (tableName === undefined || fieldName === undefined) return
  const now = after.tables[tableName]?.fields[fieldName]
  if (now?.required !== true) return // 任意になる側は影響が無い

  const target = before.tables[tableName]
  if (target === undefined || target.fields[fieldName] === undefined) {
    skip(entry, 'まだ DB に無い項目なので、適用前には数えられません')
    return
  }

  const base = { registry: before.tables, table: target, values: CONTEXT }
  const empty = counted(db, {
    ...base,
    where: { type: 'isNull', operand: { type: 'field', source: ROOT_SOURCE, path: [fieldName] } },
  })
  const total = counted(db, base)

  impacts.push({
    ref,
    where: entry.where,
    summary: `空のままになる${target.label}: ${empty} 件（全 ${total} 件のうち）`,
    count: empty,
    total,
  })
}

interface CountArgs {
  registry: DefinitionBundle['tables']
  table: TableDef
  values: ContextValues
  flow?: string
  steps?: readonly string[]
  where?: Pred
}

function counted(db: Db, args: CountArgs): number {
  const { sql, params } = countRecords(args)
  return count(db, sql, params)
}

/**
 * 条件式が**適用済みのスキーマで解決できない**フィールドを見ているか（§2-3 の ⚠）。
 * 見ていれば、その1つ目を**業務の言葉で**返す。
 *
 * ⚠ 名前は**変更後**の定義から引く。解決できない ＝ 新しい項目、ということは
 * 適用済み側にラベルが無いので、機械名（`deal.competitorUnknown`）しか出せなくなる。
 * それでは完了条件2（起票者の画面に列名を出さない）を破る。
 */
function unresolvable(
  before: DefinitionBundle,
  after: DefinitionBundle,
  flow: FlowDef,
  exit: AutoCheck,
): string | undefined {
  for (const ref of referencedFields(exit.condition)) {
    const table = ref.source === ROOT_SOURCE ? flow.target : ref.source
    if (
      before.tables[table] === undefined ||
      resolveFieldPath(before.tables, table, ref.path) === undefined
    ) {
      return describeFieldRef(after.tables, flow.target, ref)
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 整形（開発者向け）
// ---------------------------------------------------------------------------

/**
 * 開発者向けのテキスト。**起票者向けの見せ方は FE が持つ**（決定B により
 * 文言は共通で、違うのは並べ方と機械キーを出すかどうかだけ）。
 */
export function formatDiff(diff: BundleDiff, applied: AppliedBundle): string[] {
  const lines = [`比較元: ${applied.path}（書き出し ${applied.exportedAt}）`, '']
  if (diff.empty) {
    lines.push('変更なし（作業ツリーの定義は適用済みと同じ）')
    return lines
  }

  let group = ' '
  for (const entry of diff.entries) {
    const where = entry.where.join(' ＞ ')
    if (where !== group) {
      group = where
      lines.push(where === '' ? '全体' : where)
    }
    const mark = entry.change === 'added' ? '＋' : entry.change === 'removed' ? '−' : '◆'
    lines.push(`  ${mark} ${entry.summary}${entry.ref === undefined ? '' : `  [${entry.ref}]`}`)
    if (entry.detail !== undefined) lines.push(`      ${entry.detail}`)
  }

  if (diff.impacts.length > 0 || diff.notCounted.length > 0) {
    lines.push('', 'いま入っているデータへの影響')
    for (const impact of diff.impacts) lines.push(`  ・${impact.summary}`)
    for (const missing of diff.notCounted) {
      lines.push(`  ・${missing.summary}: ${missing.reason}`)
    }
  }

  lines.push(
    '',
    `差分 ${diff.entries.length} 件` +
      (diff.graphs.length === 0 ? '' : ` / 遷移が変わった業務フロー ${diff.graphs.length} 本`),
  )
  return lines
}

// ---------------------------------------------------------------------------

/**
 * 差分を要望レコードに「変更案」として書き込む（決定D）。
 *
 * ⚠ **`alt seed` に続く2つめの「API を通らない書き込み」**で、しかも業務データを書く
 * （§8-2 論点7）。それでも CLI に置くのは、**作業ツリーの定義と DB の両方を持っているのが
 * ここだけ**だから（サーバに「適用済みでない定義」を持たせるのは、いちばん壊しやすい
 * 場所を壊す）。書き込みはサーバと同じ経路 — 現在行を閉じて INSERT し、
 * `changedFlow` に要望フローを載せるので、履歴に「どの業務で変わったか」が残る。
 */
export function attachProposal(
  db: Db,
  working: DefinitionBundle,
  requestId: string,
  diff: BundleDiff,
): string {
  const table = working.tables[REQUEST.table]
  if (table === undefined || table.fields[REQUEST.proposalField] === undefined) {
    throw new Error(`定義に ${REQUEST.table}.${REQUEST.proposalField} が無い`)
  }

  const found = selectRecords({
    registry: working.tables,
    table,
    id: requestId,
    values: CONTEXT,
    limit: 1,
  })
  const row = db.prepare(found.sql).get(...found.params) as Record<string, unknown> | undefined
  if (row === undefined) {
    throw new Error(
      `要望が見つからない: ${requestId}\n` +
        '→ 画面の URL（#/requests/<id>）か、alt seed が入れたサンプルの ID を渡す',
    )
  }

  // 有効期間型なので、全項目を読み直してから1つだけ差し替えて版を積む
  const values: Record<string, unknown> = {}
  for (const [name, field] of Object.entries(table.fields)) {
    values[name] = decodeValue(field, row[toColumnName(name)])
  }
  values[REQUEST.proposalField] = diff

  const state = selectFlowState({ table: REQUEST.table, recordId: requestId, flow: REQUEST.flow })
  const step = (db.prepare(state.sql).get(...state.params) as { step?: string } | undefined)?.step

  const now = new Date().toISOString()
  db.transaction(() => {
    const close = closeCurrentRow({ table: table.name, id: requestId, now })
    const changes = db.prepare(close.sql).run(...close.params).changes
    if (changes !== 1) throw new Error('現在行を閉じられなかった（同時に書き込みがあった）')
    const insert = insertRecord({
      table,
      values,
      now,
      context: {
        // 対応者が居ればその人の作業として残す（居なければ「誰か」は付けない）
        changedBy: (values['assigneeEmployeeId'] as string | null) ?? null,
        changedFlow: REQUEST.flow,
        changedStep: step ?? null,
      },
    })
    db.prepare(insert.sql).run(...insert.params)
  })()

  return requestId
}

/** 差分の計算（影響件数の集計まで）。`alt diff` と `alt diff --request` が共有する。 */
export function computeDiff(
  applied: AppliedBundle,
  working: DefinitionBundle,
  db?: Db,
): BundleDiff {
  const diff = diffBundles(applied.bundle, working)
  if (db === undefined || diff.empty) return diff
  const measured = measureImpact(db, applied.bundle, working, diff.entries)
  return { ...diff, impacts: measured.impacts, notCounted: measured.notCounted }
}
