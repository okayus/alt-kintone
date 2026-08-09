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
    // `_flow_state` はレコード × フローの関係なので、**フローの数だけ相乗りする**。
    // 案件の話をしているので table_name で絞る（要望も target なので同じ表に入る）
    const states = db
      .prepare(`SELECT * FROM "_flow_state" WHERE "table_name" = 'deal'`)
      .all() as Array<{
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

  /**
   * 改善要望（docs/impl/phase-9-change-requests.md T4）。
   * `--reset` 直後でも一覧が空にならないこと、対象が**定義の語彙**で入っていることを見る。
   */
  it('要望も要望フローの文脈で入る（対象は定義の合成キー）', () => {
    const { db, result } = seeded()
    expect(result.inserted['change_request']).toBe(3)
    expect(result.inserted['change_request_message']).toBe(2)

    const rows = db
      .prepare(`SELECT * FROM "change_request" WHERE "id" = 'cr-competitor'`)
      .all() as Array<Record<string, unknown>>
    expect(rows[0]?.['target_step']).toBe('sales.proposed')
    expect(rows[0]?.['target_field']).toBe('deal.competitor')
    // 「どのフローで書かれたか」は要望フロー（営業フローではない）
    expect(rows[0]?.['changed_flow']).toBe('request')
    // createdAt はサーバが埋める列だが、シードは insertRecord を直に叩くので明示的に入れる
    expect(rows[0]?.['filed_at']).not.toBeNull()

    const [state] = db
      .prepare(`SELECT * FROM "_flow_state" WHERE "table_name" = 'change_request'`)
      .all() as Array<{ flow: string }>
    expect(state?.flow).toBe('request')
    db.close()
  })

  /**
   * 一覧の窓取得・性能を検証する材料（docs/impl/phase-6-list-grid.md T1）。
   * **固定シード**なので、同じ N なら毎回同じデータになる。
   */
  describe('--deals（ダミー案件の追加）', () => {
    const generated = (deals: number) => {
      const db = new Database(':memory:')
      apply(db, bundle)
      const result = seed(db, bundle, { deals })
      return { db, result }
    }

    it('指定した件数だけ増え、_flow_state も同じ数だけ入る', () => {
      const { db, result } = generated(120)
      expect(result.inserted['deal']).toBe(5 + 120)
      const [state] = db
        .prepare(`SELECT count(*) AS n FROM "_flow_state" WHERE "table_name" = 'deal'`)
        .all() as Array<{ n: number }>
      expect(state?.n).toBe(5 + 120)
      db.close()
    })

    it('会社もマスタの1ページ（500件）に収まる範囲で増える（決定F）', () => {
      const { db, result } = generated(10_000)
      expect(result.inserted['company']).toBeLessThanOrEqual(500)
      db.close()
    })

    it('固定シードなので二度流すと同じデータになる', () => {
      const titles = (deals: number) => {
        const { db } = generated(deals)
        const rows = db
          .prepare(`SELECT "title" FROM "deal" WHERE "id" LIKE 'd-gen-%' ORDER BY "id"`)
          .all() as Array<{ title: string }>
        db.close()
        return rows.map((row) => row.title)
      }
      expect(titles(30)).toEqual(titles(30))
    })

    it('valid_from が散る（既定の並びが「更新が新しい順」なので、全件同値だと窓の検証にならない）', () => {
      const { db } = generated(200)
      const [row] = db
        .prepare(`SELECT count(DISTINCT "valid_from") AS n FROM "deal" WHERE "id" LIKE 'd-gen-%'`)
        .all() as Array<{ n: number }>
      expect(row?.n).toBeGreaterThan(50)
      db.close()
    })
  })
})
