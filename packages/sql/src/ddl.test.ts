/**
 * DDL の検証。生成した SQL を実際に in-memory SQLite に流す。
 *
 * 文字列比較ではなく実行して確かめるのは、DDL の価値が「文字列が正しいこと」ではなく
 * **不変条件が本当に守られること**にあるため。索引の WHERE 句を1つ落としても
 * 文字列比較のテストは気づけるが、それが実際に2重登録を弾くかは分からない。
 */
import { boolean, table, text, uuid } from '@alt/dsl'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  createTableSql,
  currentRowIndexSql,
  FLOW_STATE_TABLE,
  MANUAL_CHECK_TABLE,
  platformTablesSql,
} from './ddl.js'

/** プラットフォームテーブルだけを作った DB。 */
function platformDb(): Database.Database {
  const db = new Database(':memory:')
  for (const sql of platformTablesSql()) db.exec(sql)
  return db
}

function insertFlowState(
  db: Database.Database,
  row: { recordId: string; flow: string; step: string; validTo?: string | null },
): void {
  db.prepare(
    `INSERT INTO "${FLOW_STATE_TABLE}"` +
      ` ("table_name", "record_id", "flow", "step", "valid_from", "valid_to")` +
      ` VALUES ('deal', ?, ?, ?, '2026-08-06T00:00:00Z', ?)`,
  ).run(row.recordId, row.flow, row.step, row.validTo ?? null)
}

describe('プラットフォームテーブル', () => {
  it('in-memory SQLite に流せる', () => {
    const db = platformDb()
    try {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as Array<{ name: string }>
      expect(tables.map((t) => t.name)).toEqual([FLOW_STATE_TABLE, MANUAL_CHECK_TABLE])
    } finally {
      db.close()
    }
  })

  it('_flow_state: 1レコードは1フローにつき現在ステップがちょうど1つ', () => {
    const db = platformDb()
    try {
      insertFlowState(db, { recordId: 'd1', flow: 'sales', step: 'contacted' })
      // 前の行を閉じずに次のステップを入れようとすると弾かれる
      expect(() =>
        insertFlowState(db, { recordId: 'd1', flow: 'sales', step: 'qualified' }),
      ).toThrow(/UNIQUE/)
    } finally {
      db.close()
    }
  })

  it('_flow_state: 閉じた行は何行あってもよい（遷移の履歴）', () => {
    const db = platformDb()
    try {
      insertFlowState(db, {
        recordId: 'd1',
        flow: 'sales',
        step: 'contacted',
        validTo: '2026-08-01',
      })
      insertFlowState(db, {
        recordId: 'd1',
        flow: 'sales',
        step: 'qualified',
        validTo: '2026-08-03',
      })
      insertFlowState(db, { recordId: 'd1', flow: 'sales', step: 'proposed' })

      const rows = db
        .prepare(`SELECT "step" FROM "${FLOW_STATE_TABLE}" ORDER BY "valid_from", "rowid"`)
        .all() as Array<{ step: string }>
      expect(rows.map((r) => r.step)).toEqual(['contacted', 'qualified', 'proposed'])
    } finally {
      db.close()
    }
  })

  it('_flow_state: 別フロー・別レコードなら同時に現在ステップを持てる', () => {
    const db = platformDb()
    try {
      insertFlowState(db, { recordId: 'd1', flow: 'sales', step: 'proposed' })
      insertFlowState(db, { recordId: 'd1', flow: 'job_ad_production', step: 'draft' })
      insertFlowState(db, { recordId: 'd2', flow: 'sales', step: 'contacted' })

      const count = db.prepare(`SELECT COUNT(*) AS n FROM "${FLOW_STATE_TABLE}"`).get() as {
        n: number
      }
      expect(count.n).toBe(3)
    } finally {
      db.close()
    }
  })

  it('_manual_check: 同じ出口条件のチェックは1件だけ', () => {
    const db = platformDb()
    try {
      const insert = db.prepare(
        `INSERT INTO "${MANUAL_CHECK_TABLE}"` +
          ` ("table_name", "record_id", "flow", "step", "check_key", "checked")` +
          ` VALUES ('deal', 'd1', 'sales', 'qualified', ?, 1)`,
      )
      insert.run('problem_identified')
      // 別のチェックキーなら入る
      insert.run('budget_confirmed')
      // 同じキーの二重登録は弾かれる（付け外しは UPDATE で行う）
      expect(() => insert.run('problem_identified')).toThrow(/UNIQUE/)
    } finally {
      db.close()
    }
  })
})

describe('業務テーブル', () => {
  const deal = table(
    'deal',
    {
      id: uuid('ID').primaryKey(),
      title: text('案件名').required(),
      isKeyAccount: boolean('重点顧客'),
    },
    { label: '案件' },
  )

  it('有効期間型の列が自動で付く', () => {
    const sql = createTableSql(deal)
    for (const column of ['valid_from', 'valid_to', 'changed_by', 'changed_flow', 'changed_step']) {
      expect(sql).toContain(`"${column}"`)
    }
  })

  it('現在行はたかだか1つ', () => {
    const db = new Database(':memory:')
    try {
      db.exec(createTableSql(deal))
      db.exec(currentRowIndexSql(deal))

      const insert = db.prepare(
        `INSERT INTO "deal" ("id", "title", "valid_from", "valid_to") VALUES (?, ?, '2026-08-06', ?)`,
      )
      insert.run('d1', '初版', '2026-08-06')
      insert.run('d1', '改訂', null)
      expect(() => insert.run('d1', '二重', null)).toThrow(/UNIQUE/)
    } finally {
      db.close()
    }
  })
})
