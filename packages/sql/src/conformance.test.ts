/**
 * 適合テスト。testdata/condition-eval/*.json を実際に SQLite で評価する。
 *
 * ここが「生成した SQL が本当に正しいか」の答え合わせであり、同じ JSON を
 * Go 版のランナーにも流すことで移植の正しさを機械的に検証する
 * （docs/product-concept.md §4-0、docs/condition-ast.md §8）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { predSchema, toColumnName, type Pred, type Registry, type TableDef } from '@alt/dsl'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { compilePred, type ContextValues } from './compile.js'
import { createTableSql, currentRowIndexSql } from './ddl.js'
import { sqlite } from './dialect.js'

const TESTDATA = join(dirname(fileURLToPath(import.meta.url)), '../../../testdata/condition-eval')

interface ConformanceCase {
  case: string
  note?: string
  root: string
  asOf?: string
  context?: Partial<ContextValues>
  ast: Pred
  fixtures: Record<string, Array<Record<string, unknown>>>
  expected: Record<string, boolean | null>
}

const registry: Registry = JSON.parse(
  readFileSync(join(TESTDATA, 'schema.json'), 'utf8'),
) as Registry

const caseFiles = readdirSync(TESTDATA)
  .filter((f) => f.endsWith('.json') && f !== 'schema.json')
  .sort()

/** fixtures の行を1件投入する。有効期間型の列は省略時に既定値を入れる。 */
function insert(db: Database.Database, table: TableDef, row: Record<string, unknown>): void {
  const values: Record<string, unknown> = {
    valid_from: '1970-01-01',
    valid_to: null,
    changed_by: null,
    changed_flow: null,
    changed_step: null,
  }
  for (const [key, value] of Object.entries(row)) {
    // fixtures はフィールド名（camelCase）で書く。列名への変換はここで行う。
    // 値の変換（SQLite は boolean を扱えない）は方言に委ねる
    values[toColumnName(key)] = sqlite.bindValue(value)
  }

  const columns = Object.keys(values)
  const sql =
    `INSERT INTO ${sqlite.quote(table.name)} (${columns.map((c) => sqlite.quote(c)).join(', ')})` +
    ` VALUES (${columns.map(() => '?').join(', ')})`
  db.prepare(sql).run(...columns.map((c) => values[c] as never))
}

/** SQLite が返す 0/1/null を三値論理のまま受け取る。 */
function toTernary(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  return value === 1 || value === true
}

describe('条件式の適合テスト', () => {
  it('ケースファイルが存在する', () => {
    expect(caseFiles.length).toBeGreaterThan(0)
  })

  for (const file of caseFiles) {
    const testCase = JSON.parse(readFileSync(join(TESTDATA, file), 'utf8')) as ConformanceCase

    it(`${file}: ${testCase.case}`, () => {
      // AST 自体が仕様を満たしていること（ケースファイルの取り違えを防ぐ）
      expect(predSchema.safeParse(testCase.ast).success).toBe(true)

      const db = new Database(':memory:')
      try {
        for (const table of Object.values(registry)) {
          db.exec(createTableSql(table))
          db.exec(currentRowIndexSql(table))
        }
        for (const [tableName, rows] of Object.entries(testCase.fixtures)) {
          const table = registry[tableName]
          expect(table, `schema.json に ${tableName} が無い`).toBeDefined()
          for (const row of rows) insert(db, table as TableDef, row)
        }

        const values: ContextValues = {
          'currentUser.id': null,
          today: null,
          now: null,
          ...testCase.context,
        }
        const rootAlias = 'r'
        const compiled = compilePred(testCase.ast, {
          registry,
          rootTable: testCase.root,
          rootAlias,
          values,
          asOf: testCase.asOf,
        })

        // ルートテーブルの時点条件は FROM 句を組む側の責務（compile.ts 冒頭のコメント）
        const rootTemporal =
          testCase.asOf === undefined
            ? `${sqlite.quote(rootAlias)}."valid_to" IS NULL`
            : `${sqlite.quote(rootAlias)}."valid_from" <= ? AND (${sqlite.quote(rootAlias)}."valid_to" > ?` +
              ` OR ${sqlite.quote(rootAlias)}."valid_to" IS NULL)`
        const rootParams = testCase.asOf === undefined ? [] : [testCase.asOf, testCase.asOf]

        const sql =
          `SELECT ${sqlite.quote(rootAlias)}."id" AS id, (${compiled.sql}) AS result` +
          ` FROM ${sqlite.quote(testCase.root)} ${sqlite.quote(rootAlias)}` +
          ` WHERE ${rootTemporal}`

        const rows = db.prepare(sql).all(...compiled.params, ...rootParams) as Array<{
          id: string
          result: unknown
        }>

        const actual = Object.fromEntries(rows.map((r) => [r.id, toTernary(r.result)]))
        expect(actual).toEqual(testCase.expected)
      } finally {
        db.close()
      }
    })
  }
})
