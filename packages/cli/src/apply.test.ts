/**
 * apply が実際の SQLite にスキーマを作れることを確かめる。
 *
 * DDL 文字列の中身は `@alt/sql` のテストが見ているので、ここで見るのは
 * 「並べて流した結果、DB がどうなったか」。in-memory の SQLite を使う。
 */
import { apply, managedTables, resolveDbPath, schemaStatements } from './apply.js'
import { loadBundle } from './bundle.js'
import { FLOW_STATE_TABLE, MANUAL_CHECK_TABLE } from '@alt/sql'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const bundle = loadBundle()

const names = (db: Database.Database, type: 'table' | 'index'): string[] =>
  (
    db.prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').all(type) as Array<{
      name: string
    }>
  ).map((row) => row.name)

describe('schemaStatements', () => {
  it('プラットフォームテーブルが業務テーブルより先', () => {
    const statements = schemaStatements(bundle)
    const platform = statements.findIndex((s) => s.includes(FLOW_STATE_TABLE))
    const business = statements.findIndex((s) => s.includes('CREATE TABLE "deal"'))
    expect(platform).toBeLessThan(business)
  })

  it('業務テーブルごとに CREATE TABLE と現在行の索引が出る', () => {
    const statements = schemaStatements(bundle)
    for (const name of Object.keys(bundle.tables)) {
      expect(statements).toContain(statements.find((s) => s.startsWith(`CREATE TABLE "${name}"`)))
      expect(statements.some((s) => s.includes(`CREATE UNIQUE INDEX "${name}_current"`))).toBe(true)
    }
  })
})

describe('apply', () => {
  it('業務テーブルとプラットフォームテーブルが揃う', () => {
    const db = new Database(':memory:')
    const result = apply(db, bundle)

    expect(names(db, 'table').sort()).toEqual(managedTables(bundle).sort())
    expect(names(db, 'table')).toContain('deal')
    expect(names(db, 'table')).toEqual(
      expect.arrayContaining([FLOW_STATE_TABLE, MANUAL_CHECK_TABLE]),
    )
    expect(result.created).toHaveLength(managedTables(bundle).length)
    db.close()
  })

  it('現在行のユニーク索引ができる', () => {
    const db = new Database(':memory:')
    apply(db, bundle)
    expect(names(db, 'index')).toEqual(
      expect.arrayContaining([
        'deal_current',
        `${FLOW_STATE_TABLE}_current`,
        `${MANUAL_CHECK_TABLE}_key`,
      ]),
    )
    db.close()
  })

  it('有効期間型の列が全テーブルに付く（定義には書いていない）', () => {
    const db = new Database(':memory:')
    apply(db, bundle)
    const columns = (db.prepare('PRAGMA table_info("deal")').all() as Array<{ name: string }>).map(
      (row) => row.name,
    )
    expect(columns).toEqual(
      expect.arrayContaining([
        'valid_from',
        'valid_to',
        'changed_by',
        'changed_flow',
        'changed_step',
      ]),
    )
    db.close()
  })

  it('既存テーブルがあると --recreate なしでは失敗する', () => {
    const db = new Database(':memory:')
    apply(db, bundle)
    expect(() => apply(db, bundle)).toThrow(/--recreate/)
    // 失敗しても既存スキーマは壊れていない
    expect(names(db, 'table').sort()).toEqual(managedTables(bundle).sort())
    db.close()
  })

  it('--recreate なら作り直す', () => {
    const db = new Database(':memory:')
    apply(db, bundle)
    db.exec(
      'INSERT INTO "deal"' +
        ' ("id", "company_id", "title", "product_type", "deal_type", "status",' +
        ' "owner_employee_id", "valid_from")' +
        " VALUES ('d1', 'c1', '既存データ', 'job_ad', 'new', 'open', 'e1', '2026-01-01')",
    )

    const result = apply(db, bundle, { recreate: true })

    expect(result.dropped.sort()).toEqual(managedTables(bundle).sort())
    expect(db.prepare('SELECT count(*) AS n FROM "deal"').get()).toEqual({ n: 0 })
    db.close()
  })

  it('管理外のテーブルには触らない', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE "scratch" ("a" TEXT)')
    apply(db, bundle, { recreate: true })
    expect(names(db, 'table')).toContain('scratch')
    db.close()
  })
})

describe('resolveDbPath', () => {
  it('--db > DATABASE_URL > 既定', () => {
    expect(resolveDbPath('a.db', 'file:/app/data/alt.db')).toBe('a.db')
    expect(resolveDbPath(undefined, 'file:/app/data/alt.db')).toBe('/app/data/alt.db')
    expect(resolveDbPath(undefined, undefined)).toBe('data/alt.db')
  })
})
