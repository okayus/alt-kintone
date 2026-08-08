/**
 * テーブル定義 → CREATE TABLE。
 *
 * 有効期間型（SCD Type 2）の列は定義に書かず、ここで全テーブルに自動付与する
 * （docs/product-concept.md §4-1）。定義側が意識しなくてよいのがこの方式の要点。
 */
import type { DefinitionBundle, FieldDef, FieldType, TableDef } from '@alt/dsl'
import { toColumnName } from '@alt/dsl'
import { type Dialect, sqlite } from './dialect.js'

/**
 * ⚠ 列の型はまだ SQLite 固定。`dialect` を渡しても識別子のクォートしか切り替わらない。
 * PostgreSQL を実際に対象にするときに Dialect へ型マップを移す
 * （docs/product-concept.md §8-2 論点1。プロトタイプはローカル + SQLite）。
 */
const SQLITE_TYPES: Record<FieldType, string> = {
  uuid: 'TEXT',
  text: 'TEXT',
  integer: 'INTEGER',
  // SQLite に真偽型は無い。0/1 で持つ
  boolean: 'INTEGER',
  // 日付・日時は ISO 8601 文字列（docs/domain-model.md §9-5）
  date: 'TEXT',
  datetime: 'TEXT',
  yearMonth: 'TEXT',
  enum: 'TEXT',
  json: 'TEXT',
}

/**
 * 全テーブルに自動付与される列。
 *
 * `changed_*` は「変更の文脈」（docs/product-concept.md §4-1）。
 * どの業務フローのどのステップで変わったかを残す。業務フローが第一級だから
 * 取れる情報で、kintone では原理的に記録できない部分。
 */
export const TEMPORAL_COLUMNS = [
  'valid_from',
  'valid_to',
  'changed_by',
  'changed_flow',
  'changed_step',
] as const

/**
 * 有効期間型の列の型。`valid_from` だけが必須（現在行は `valid_to IS NULL`）。
 *
 * 業務テーブルとプラットフォームテーブル（`_flow_state`）で同じものを使う。
 * 定義を分けると、片方だけ列が増えたときに履歴の形が食い違う。
 */
const TEMPORAL_COLUMN_TYPES: Record<(typeof TEMPORAL_COLUMNS)[number], string> = {
  valid_from: 'TEXT NOT NULL',
  valid_to: 'TEXT',
  changed_by: 'TEXT',
  changed_flow: 'TEXT',
  changed_step: 'TEXT',
}

type Quote = (identifier: string) => string

function temporalColumns(q: Quote): string[] {
  return TEMPORAL_COLUMNS.map((name) => `${q(name)} ${TEMPORAL_COLUMN_TYPES[name]}`)
}

export function createTableSql(table: TableDef, dialect: Dialect = sqlite): string {
  const q = (id: string) => dialect.quote(id)

  const columns = Object.entries(table.fields).map(([name, def]) => column(q, name, def))
  columns.push(...temporalColumns(q))

  // 同じ id の行が複数バージョン並ぶので、id 単体は主キーにできない。
  // 「1つの id につき現在行はたかだか1つ」は部分ユニーク索引で担保する（下記）。
  return `CREATE TABLE ${q(table.name)} (\n  ${columns.join(',\n  ')}\n)`
}

/**
 * 現在行の一意性を担保する部分索引。
 *
 * 有効期間型では id が重複するため、`valid_to IS NULL` の行だけを対象に
 * ユニーク制約をかける。これが無いと「現在行が2つある」状態を防げない。
 */
export function currentRowIndexSql(table: TableDef, dialect: Dialect = sqlite): string {
  const q = (id: string) => dialect.quote(id)
  return currentUniqueIndexSql(q, `${table.name}_current`, table.name, ['id'])
}

/**
 * 外部キーの索引（docs/impl/phase-6-list-grid.md 決定G）。
 *
 * **定義には書かせない。** 有効期間型の列と同じで、`reference()` から機械的に決まるものは
 * DDL が付ける。索引の設計を定義者（＝AI）の判断に委ねると、書き忘れが性能として現れて
 * 原因が分からなくなる。
 *
 * これが要るのは出口条件のためでもある。自動判定は相関サブクエリで参照先を引くので
 * （`decision_maker_met` は activity → contact）、外部キーに索引が無いと一覧のたびに
 * 全表走査が走る。実測（案件10,005件・活動15,092件）で **145ms → 9.5ms**
 * （`docs/impl/phase-6-list-grid.md` §7-4）。
 *
 * 部分索引（`WHERE valid_to IS NULL`）にはしない。`as_of` の読みが索引を使えなくなる。
 */
export function foreignKeyIndexSql(table: TableDef, dialect: Dialect = sqlite): string[] {
  const q = (id: string) => dialect.quote(id)
  return Object.entries(table.fields)
    .filter(([, def]) => def.references !== undefined)
    .map(([name]) => {
      const column = toColumnName(name)
      return `CREATE INDEX ${q(`${table.name}_${column}`)} ON ${q(table.name)} (${q(column)})`
    })
}

/** `valid_to IS NULL` の行だけを対象にしたユニーク索引。 */
function currentUniqueIndexSql(q: Quote, name: string, table: string, columns: string[]): string {
  return (
    `CREATE UNIQUE INDEX ${q(name)} ON ${q(table)} (${columns.map(q).join(', ')})` +
    ` WHERE ${q('valid_to')} IS NULL`
  )
}

function column(q: Quote, name: string, def: FieldDef): string {
  const parts = [q(toColumnName(name)), SQLITE_TYPES[def.type]]
  if (def.required) parts.push('NOT NULL')
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// プラットフォームテーブル
// ---------------------------------------------------------------------------

/**
 * レコードが業務フローのどこにいるか（docs/implementation.md 決定5）。
 *
 * ステップを業務テーブルの列にすると kintone と同じ構造（アプリが状態を抱える）に
 * なるので、**レコード × フローの関係**として別テーブルに持つ。1レコードが複数の
 * フローに乗ることも、フローが対象を変えることも、テーブル定義を変えずに扱える。
 */
export const FLOW_STATE_TABLE = '_flow_state'

/**
 * 手動チェックの出口条件（docs/implementation.md 決定6）。
 *
 * `check_key` は定義側の**明示キー**。ラベルをキーにすると文言修正で
 * チェックが外れる（docs/product-concept.md §3-5）。
 */
export const MANUAL_CHECK_TABLE = '_manual_check'

/**
 * プラットフォームが常に持つテーブルの DDL。
 *
 * 業務テーブルと違い、定義ファイルからは生成されない。`alt apply` は
 * これを先に流してから、定義由来のテーブルを作る。
 */
export function platformTablesSql(dialect: Dialect = sqlite): string[] {
  const q = (id: string) => dialect.quote(id)

  // _flow_state は有効期間型。ステップ遷移の履歴がここに残り、
  // ステージ転換率（docs/sales-domain.md §14）がこれだけで出せる。
  //
  // unmet_checks は「未充足でも進めるが記録に残す」（docs/product-concept.md §4-3）の
  // 保存先。**後から再評価しても遷移した時点の充足状況は復元できない**ので、
  // 遷移時に確定させるしかない。直前ステップ（= 同じ行の changed_step）の
  // 未充足キーを JSON 配列で持つ。これで「出口条件を満たさず進めた案件の受注率」が出せる。
  const flowState = [
    `${q('table_name')} TEXT NOT NULL`,
    `${q('record_id')} TEXT NOT NULL`,
    `${q('flow')} TEXT NOT NULL`,
    `${q('step')} TEXT NOT NULL`,
    `${q('unmet_checks')} TEXT`,
    ...temporalColumns(q),
  ]

  // _manual_check は有効期間型にしない。チェックの付け外し履歴は分析に使わない。
  const manualCheck = [
    `${q('table_name')} TEXT NOT NULL`,
    `${q('record_id')} TEXT NOT NULL`,
    `${q('flow')} TEXT NOT NULL`,
    `${q('step')} TEXT NOT NULL`,
    `${q('check_key')} TEXT NOT NULL`,
    `${q('checked')} INTEGER NOT NULL`,
    `${q('checked_by')} TEXT`,
    `${q('checked_at')} TEXT`,
  ]

  return [
    `CREATE TABLE ${q(FLOW_STATE_TABLE)} (\n  ${flowState.join(',\n  ')}\n)`,
    // 「1レコードは1フローにつきちょうど1ステップ」（docs/product-concept.md §3-5）を
    // コメントではなく構造で表現する。並列ステップを持たないと決めたのはこの不変条件のため。
    currentUniqueIndexSql(q, `${FLOW_STATE_TABLE}_current`, FLOW_STATE_TABLE, [
      'table_name',
      'record_id',
      'flow',
    ]),
    `CREATE TABLE ${q(MANUAL_CHECK_TABLE)} (\n  ${manualCheck.join(',\n  ')}\n)`,
    `CREATE UNIQUE INDEX ${q(`${MANUAL_CHECK_TABLE}_key`)} ON ${q(MANUAL_CHECK_TABLE)}` +
      ` (${['table_name', 'record_id', 'flow', 'step', 'check_key'].map(q).join(', ')})`,
  ]
}

/**
 * 定義バンドル全体のスキーマ。適用の順に並べる。
 *
 * プラットフォームテーブルが先。業務テーブルは定義ごとに CREATE TABLE と、
 * 現在行のユニーク索引（有効期間型では id が重複するため）と、外部キーの索引。
 *
 * 純関数（DB を触らない）。`alt apply` とバックエンドのテストの両方が使う。
 */
export function schemaStatements(bundle: DefinitionBundle, dialect: Dialect = sqlite): string[] {
  return [
    ...platformTablesSql(dialect),
    ...Object.values(bundle.tables).flatMap((table) => [
      createTableSql(table, dialect),
      currentRowIndexSql(table, dialect),
      ...foreignKeyIndexSql(table, dialect),
    ]),
  ]
}
