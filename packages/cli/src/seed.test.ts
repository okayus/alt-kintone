/**
 * シードは「入れたデータが定義どおりか」だけ見る。中身の妥当性（案件の金額など）は
 * デモの都合なのでテストしない。
 */
import { apply } from './apply.js'
import { loadBundle } from './bundle.js'
import { seed } from './seed.js'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const bundle = loadBundle()

const seeded = () => {
  const db = new Database(':memory:')
  apply(db, bundle)
  const result = seed(db, bundle)
  return { db, result }
}

describe('seed', () => {
  it('API から作れないマスタも入る（開発用の裏口）', () => {
    const { db, result } = seeded()
    // company / contact / employee は reference バインドなので書き込み API が生えない
    expect(result.inserted['employee']).toBeGreaterThan(0)
    expect(result.inserted['company']).toBeGreaterThan(0)
    expect(result.inserted['contact']).toBeGreaterThan(0)
    db.close()
  })

  it('案件は _flow_state の行つきで入る（ステップは業務テーブルの列ではない）', () => {
    const { db, result } = seeded()
    const states = db.prepare('SELECT * FROM "_flow_state"').all() as Array<{
      step: string
      valid_to: string | null
    }>
    expect(states).toHaveLength(result.inserted['deal'] ?? 0)
    expect(states.every((s) => s.valid_to === null)).toBe(true)
    expect(states.map((s) => s.step)).toEqual(
      expect.arrayContaining(['contacted', 'qualified', 'proposed', 'won', 'suspended']),
    )
    db.close()
  })

  it('有効期間型の列が埋まる（サーバの書き込みと同じ形）', () => {
    const { db } = seeded()
    const rows = db.prepare('SELECT * FROM "deal"').all() as Array<Record<string, unknown>>
    expect(rows.every((row) => row['valid_from'] !== null && row['valid_to'] === null)).toBe(true)
    expect(rows.every((row) => row['changed_flow'] === 'sales')).toBe(true)
    db.close()
  })

  it('--reset で入れ直せる（2回流しても現在行が重複しない）', () => {
    const { db } = seeded()
    seed(db, bundle, { reset: true })
    const current = db
      .prepare('SELECT count(*) AS n FROM "deal" WHERE "valid_to" IS NULL')
      .get() as { n: number }
    expect(current.n).toBe(5)
    db.close()
  })

  it('--reset なしで二度流すと現在行のユニーク索引に弾かれる', () => {
    const { db } = seeded()
    expect(() => seed(db, bundle)).toThrow()
    db.close()
  })
})
