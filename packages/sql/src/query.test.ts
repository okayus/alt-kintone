/**
 * 有効期間型の読み書き SQL。**この層は Go に移す**ので、ここのテストは仕様に近い。
 *
 * 見るのは2つ:
 *  - 半開区間 `[valid_from, valid_to)` が実 SQLite で意図どおり効くか
 *  - パラメータが SQL に現れる順に積まれているか（`?` は位置で対応するので、
 *    順序がずれると値が入れ替わって静かに壊れる）
 */
import {
  closeCurrentRow,
  decodeValue,
  encodeValue,
  insertFlowState,
  insertRecord,
  selectFlowState,
  selectManualChecks,
  selectRecords,
  upsertManualCheck,
} from './query.js'
import { schemaStatements } from './ddl.js'
import { postgres } from './dialect.js'
import { boolean, integer, json, registry, table, text, uuid, type Pred } from '@alt/dsl'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const item = table(
  'item',
  {
    id: uuid('ID').primaryKey(),
    name: text('名称').required(),
    price: integer('価格'),
    active: boolean('有効'),
    meta: json('メタ'),
  },
  { label: '品目' },
)

const bundle = { tables: registry(item), flows: [], roles: [] }
const values = { 'currentUser.id': 'u1', today: '2026-07-15', now: '2026-07-15T00:00:00.000Z' }

const T1 = '2026-07-01T00:00:00.000Z'
const T2 = '2026-07-10T00:00:00.000Z'

function db(): Database.Database {
  const database = new Database(':memory:')
  for (const sql of schemaStatements(bundle)) database.exec(sql)
  return database
}

const write = (database: Database.Database, row: Record<string, unknown>, now: string) => {
  const { sql, params } = insertRecord({
    table: item,
    values: row,
    now,
    context: { changedBy: 'u1', changedFlow: 'f', changedStep: 's' },
  })
  database.prepare(sql).run(...params)
}

const read = (database: Database.Database, asOf?: string) => {
  const { sql, params } = selectRecords({
    registry: bundle.tables,
    table: item,
    values,
    ...(asOf === undefined ? {} : { asOf }),
  })
  return database.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

describe('有効期間型の読み書き', () => {
  it('閉じて INSERT すると、どの時点にも行がちょうど1つになる', () => {
    const database = db()
    write(database, { id: 'i1', name: '初期', price: 100 }, T1)

    const close = closeCurrentRow({ table: 'item', id: 'i1', now: T2 })
    expect(database.prepare(close.sql).run(...close.params).changes).toBe(1)
    write(database, { id: 'i1', name: '改定', price: 200 }, T2)

    // 現在
    expect(read(database).map((r) => r['price'])).toEqual([200])
    // 閉じた瞬間は新しい行（半開区間なので valid_from <= t < valid_to）
    expect(read(database, T2).map((r) => r['price'])).toEqual([200])
    // その手前は古い行
    expect(read(database, '2026-07-09T23:59:59.999Z').map((r) => r['price'])).toEqual([100])
    // 開始前は0件
    expect(read(database, '2026-06-30T00:00:00.000Z')).toEqual([])
  })

  it('現在行を二度閉じられない（競合の検出）', () => {
    const database = db()
    write(database, { id: 'i1', name: 'a' }, T1)
    const close = closeCurrentRow({ table: 'item', id: 'i1', now: T2 })
    expect(database.prepare(close.sql).run(...close.params).changes).toBe(1)
    expect(database.prepare(close.sql).run(...close.params).changes).toBe(0)
  })

  it('変更の文脈（誰が・どのフローのどのステップで）が入る', () => {
    const database = db()
    write(database, { id: 'i1', name: 'a' }, T1)
    const [row] = database.prepare('SELECT * FROM "item"').all() as Array<Record<string, unknown>>
    expect(row?.['changed_by']).toBe('u1')
    expect(row?.['changed_flow']).toBe('f')
    expect(row?.['changed_step']).toBe('s')
    expect(row?.['valid_to']).toBeNull()
  })

  it('未指定のフィールドは NULL で入る（列の並びがずれない）', () => {
    const database = db()
    write(database, { id: 'i1', name: 'a' }, T1)
    const [row] = read(database)
    expect(row?.['price']).toBeNull()
    expect(row?.['name']).toBe('a')
  })
})

describe('SELECT 句に埋める述語', () => {
  const expensive: Pred = {
    type: 'compare',
    op: 'gt',
    left: { type: 'field', source: 'root', path: ['price'] },
    right: { type: 'literal', value: 150 },
  }

  it('行ごとに評価され、NULL は 1 にならない（三値論理）', () => {
    const database = db()
    write(database, { id: 'i1', name: '高い', price: 200 }, T1)
    write(database, { id: 'i2', name: '安い', price: 100 }, T1)
    write(database, { id: 'i3', name: '未設定' }, T1)

    const { sql, params } = selectRecords({
      registry: bundle.tables,
      table: item,
      values,
      expressions: [{ alias: '_c0', pred: expensive }],
    })
    const rows = database.prepare(sql).all(...params) as Array<Record<string, unknown>>
    const byId = Object.fromEntries(rows.map((r) => [r['id'], r['_c0']]))
    expect(byId['i1']).toBe(1)
    expect(byId['i2']).toBe(0)
    // NULL のまま返る。呼び出し側が `=== 1` で見る前提
    expect(byId['i3']).toBeNull()
  })

  it('パラメータは SQL に現れる順に積まれる', () => {
    const { sql, params } = selectRecords({
      registry: bundle.tables,
      table: item,
      flow: 'sales',
      values,
      expressions: [{ alias: '_c0', pred: expensive }],
      asOf: '2026-07-05',
      id: 'i1',
      limit: 10,
    })
    // 述語(150) → JOIN(テーブル名, フロー, asOf×2) → WHERE(asOf×2, id) → LIMIT
    expect(params).toEqual([
      150,
      'item',
      'sales',
      '2026-07-05',
      '2026-07-05',
      '2026-07-05',
      '2026-07-05',
      'i1',
      10,
    ])
    expect(sql.indexOf('LEFT JOIN')).toBeGreaterThan(sql.indexOf('_c0'))
    expect(sql).toContain('LIMIT ?')
  })

  it('上限を超える limit は丸める', () => {
    const { params } = selectRecords({ registry: bundle.tables, table: item, values, limit: 9999 })
    expect(params.at(-1)).toBe(500)
  })
})

describe('プラットフォームテーブル', () => {
  it('_flow_state は閉じて積む。unmet_checks は JSON 配列', () => {
    const database = db()
    const key = { table: 'deal', recordId: 'd1', flow: 'sales' }
    const context = { changedBy: 'u1', changedFlow: 'sales', changedStep: null }

    const first = insertFlowState({
      ...key,
      step: 'contacted',
      unmetChecks: null,
      now: T1,
      context,
    })
    database.prepare(first.sql).run(...first.params)

    const second = insertFlowState({
      ...key,
      step: 'qualified',
      unmetChecks: ['a', 'b'],
      now: T2,
      context: { ...context, changedStep: 'contacted' },
    })
    // 現在行を閉じずに積むとユニーク索引に弾かれる（現在ステップは常に1つ）
    expect(() => database.prepare(second.sql).run(...second.params)).toThrow()

    const close = closeCurrentRow({ table: '_flow_state', id: 'x', now: T2 })
    expect(close.sql).toContain('valid_to')

    const state = selectFlowState({ ...key, asOf: T1 })
    const [row] = database.prepare(state.sql).all(...state.params) as Array<Record<string, unknown>>
    expect(row?.['step']).toBe('contacted')
  })

  it('_manual_check は UPSERT（同じキーなら上書き）', () => {
    const database = db()
    const base = {
      table: 'deal',
      recordId: 'd1',
      flow: 'sales',
      step: 'qualified',
      checkKey: 'k',
      checkedBy: 'u1',
      checkedAt: T1,
    }
    for (const checked of [true, false, true]) {
      const { sql, params } = upsertManualCheck({ ...base, checked })
      database.prepare(sql).run(...params)
    }

    const query = selectManualChecks({ table: 'deal', recordIds: ['d1'], flow: 'sales' })
    const rows = database.prepare(query.sql).all(...query.params) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.['checked']).toBe(1)
  })
})

describe('値の変換', () => {
  const bool = { type: 'boolean', label: '有効', required: false, primaryKey: false } as const
  const blob = { type: 'json', label: 'メタ', required: false, primaryKey: false } as const

  it('boolean は 0/1 に、json は文字列になる（方言が吸収する）', () => {
    expect(encodeValue(bool, true)).toBe(1)
    expect(encodeValue(blob, { a: 1 })).toBe('{"a":1}')
    // PostgreSQL は boolean をそのまま扱える
    expect(encodeValue(bool, true, postgres)).toBe(true)
  })

  it('decode は encode の逆', () => {
    expect(decodeValue(bool, encodeValue(bool, false))).toBe(false)
    expect(decodeValue(blob, encodeValue(blob, { a: 1 }))).toEqual({ a: 1 })
    expect(decodeValue(bool, null)).toBeNull()
  })
})
