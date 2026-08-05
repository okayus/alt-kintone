/**
 * テーブル定義 → CREATE TABLE。
 *
 * 有効期間型（SCD Type 2）の列は定義に書かず、ここで全テーブルに自動付与する
 * （docs/product-concept.md §4-1）。定義側が意識しなくてよいのがこの方式の要点。
 */
import type { FieldDef, FieldType, TableDef } from '@alt/dsl'
import { toColumnName } from '@alt/dsl'
import { type Dialect, sqlite } from './dialect.js'

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

export function createTableSql(table: TableDef, dialect: Dialect = sqlite): string {
  const q = (id: string) => dialect.quote(id)

  const columns = Object.entries(table.fields).map(([name, def]) => column(q, name, def))

  // 有効期間型の列。valid_from は必須、valid_to が NULL なら現在行
  columns.push(
    `${q('valid_from')} TEXT NOT NULL`,
    `${q('valid_to')} TEXT`,
    `${q('changed_by')} TEXT`,
    `${q('changed_flow')} TEXT`,
    `${q('changed_step')} TEXT`,
  )

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
  return (
    `CREATE UNIQUE INDEX ${q(`${table.name}_current`)} ON ${q(table.name)} (${q('id')})` +
    ` WHERE ${q('valid_to')} IS NULL`
  )
}

function column(q: (id: string) => string, name: string, def: FieldDef): string {
  const parts = [q(toColumnName(name)), SQLITE_TYPES[def.type]]
  if (def.required) parts.push('NOT NULL')
  return parts.join(' ')
}
