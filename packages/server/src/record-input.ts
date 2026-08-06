/**
 * 書き込み値の検証。docs/impl/phase-3-backend.md 3-2
 *
 * 定義（`TableDef`）そのものが入力仕様なので、専用のスキーマを別に書かない。
 * 定義に無いフィールドを弾くのが要点 — 黙って捨てると「保存したのに消えている」
 * という一番デバッグしにくい壊れ方をする。
 *
 * ※ 外部キーの実在は検査しない（決定K）。どの時点の行と突き合わせるかを決める必要があり、
 *    有効期間型の設計判断が要る。プロトタイプの検証には不要。
 */
import { badRequest } from './api.js'
import { RESERVED_INPUT_KEYS } from './records.js'
import type { FieldDef, TableDef } from '@alt/dsl'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const YEAR_MONTH = /^\d{4}-\d{2}$/

export function validateInput(
  table: TableDef,
  body: unknown,
  opts: { partial: boolean },
): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('body が JSON オブジェクトではない')
  }

  const input = body as Record<string, unknown>
  const values: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_INPUT_KEYS.includes(key)) {
      throw badRequest(
        `"${key}" は書き込めない（サーバが埋める）`,
        'id はサーバが採番し、有効期間型の列（valid_from / changed_* など）は' +
          '変更の文脈として自動で記録される',
      )
    }
    const field = table.fields[key]
    if (field === undefined) {
      throw badRequest(
        `${table.name} に "${key}" というフィールドは無い`,
        `候補: ${Object.keys(table.fields).join(', ')}`,
      )
    }
    values[key] = checkType(table.name, key, field, value)
  }

  if (!opts.partial) {
    for (const [name, field] of Object.entries(table.fields)) {
      // id はサーバが採番するので required でも入力には要らない
      if (!field.required || field.primaryKey) continue
      if (values[name] === undefined || values[name] === null) {
        throw badRequest(`${table.name}.${name} は必須`, '定義で required になっている')
      }
    }
  }

  return values
}

function checkType(table: string, name: string, field: FieldDef, value: unknown): unknown {
  if (value === null) {
    if (field.required) throw badRequest(`${table}.${name} に null は入れられない（必須）`)
    return null
  }

  const fail = (expected: string): never => {
    throw badRequest(
      `${table}.${name} は ${field.type}（${expected}）だが ${JSON.stringify(value)} が来た`,
    )
  }

  switch (field.type) {
    case 'integer':
      return Number.isInteger(value) ? value : fail('整数')
    case 'boolean':
      return typeof value === 'boolean' ? value : fail('true / false')
    case 'enum': {
      // 入力に来るのは key（DB に入る識別子）。label は表示専用で API には現れない
      const values = field.values ?? []
      if (typeof value !== 'string' || !values.some((v) => v.key === value)) {
        throw badRequest(
          `${table}.${name} に "${String(value)}" は入れられない`,
          `候補: ${values.map((v) => v.key).join(', ')}`,
        )
      }
      return value
    }
    case 'date':
      return typeof value === 'string' && DATE.test(value) ? value : fail('YYYY-MM-DD')
    case 'yearMonth':
      return typeof value === 'string' && YEAR_MONTH.test(value) ? value : fail('YYYY-MM')
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? value
        : fail('ISO 8601 の日時')
    case 'json':
      return value
    case 'uuid':
    case 'text':
      return typeof value === 'string' ? value : fail('文字列')
  }
}
