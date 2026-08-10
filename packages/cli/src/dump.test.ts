/**
 * `alt dump` は「別のマシンで手早くデータを用意する」ための出力なので、
 * 見るのは**流したら同じ状態になるか**の1点。SQL の見た目は固定しない。
 *
 * ⚠ ここに**コミット済みの `sql/testdata.sql` が定義と一致するか**の検査も置く。
 *    生成物をリポジトリに置く以上、定義を直したまま出し直し忘れると黙って古くなる
 *    — このリポジトリが `check:wiring` や `alt diff` で潰してきた壊れ方なので、
 *    ここも機械で塞ぐ。
 */
import { apply } from './apply.js'
import { loadBundle } from './bundle.js'
import { dump, literal, TESTDATA_SQL_PATH } from './dump.js'
import { seed } from './seed.js'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bundle = loadBundle()
const tables = ['_flow_state', '_manual_check', ...Object.keys(bundle.tables)]

/** テーブルの中身を、比較できる形にする。 */
function contents(db: Database.Database): Record<string, unknown[]> {
  const all: Record<string, unknown[]> = {}
  for (const name of tables) all[name] = db.prepare(`SELECT * FROM "${name}"`).all()
  return all
}

describe('dump', () => {
  it('流すと apply + seed と同じ状態になる', () => {
    const direct = new Database(':memory:')
    apply(direct, bundle)
    seed(direct, bundle)

    const fromSql = new Database(':memory:')
    fromSql.exec(dump(bundle).sql)

    expect(contents(fromSql)).toEqual(contents(direct))
    direct.close()
    fromSql.close()
  })

  it('二度流しても同じ状態になる（DROP から書いてある）', () => {
    const db = new Database(':memory:')
    const { sql } = dump(bundle)
    db.exec(sql)
    const once = contents(db)
    db.exec(sql)
    expect(contents(db)).toEqual(once)
    db.close()
  })

  it('--deals のダミー案件も入る', () => {
    const db = new Database(':memory:')
    db.exec(dump(bundle, { deals: 20 }).sql)
    const count = db.prepare('SELECT COUNT(*) AS n FROM "deal"').get() as { n: number }
    // デモの5件 + ダミー20件
    expect(count.n).toBe(25)
    db.close()
  })

  /**
   * リテラル化だけはプレースホルダを通らない（SQL の文字列を組み立てる）。
   * ここが甘いと、`'` を含む会社名1つで**以降の SQL が丸ごと壊れる**。
   */
  it("値のリテラル化が ' を畳み、型を変えない", () => {
    expect(literal("O'Brien 商店")).toBe("'O''Brien 商店'")
    expect(literal(null)).toBe('NULL')
    expect(literal(undefined)).toBe('NULL')
    // 数値を引用符で包まない（包むと TEXT として入り、比較や並べ替えが変わる）
    expect(literal(180000)).toBe('180000')
    expect(literal(0)).toBe('0')
  })

  it("' を含む値が、この経路で書いても元に戻る", () => {
    const db = new Database(':memory:')
    db.exec(dump(bundle).sql)

    // 実際の書き出しと同じ形にするため、既存の行を写して名前だけ差し替える
    const source = db.prepare(`SELECT * FROM "company" LIMIT 1`).get() as Record<string, unknown>
    const name = "O'Brien 商店 -- ; DROP TABLE deal"
    const row = { ...source, id: 'c-x', name }
    const columns = Object.keys(row).map((key) => `"${key}"`)
    const values = Object.values(row).map(literal)
    db.exec(`INSERT INTO "company" (${columns.join(', ')}) VALUES (${values.join(', ')})`)

    const stored = db.prepare(`SELECT "name" FROM "company" WHERE "id" = 'c-x'`).get() as {
      name: string
    }
    expect(stored.name).toBe(name)
    // 壊していないことも見る（コメント記号や ; を含む値でテーブルが消えていない）
    expect(db.prepare('SELECT COUNT(*) AS n FROM "deal"').get()).toEqual({ n: 5 })
    db.close()
  })

  /**
   * リポジトリに置いてある SQL が、いまの定義から出るものと一致するか。
   *
   * **落ちたら `pnpm alt dump --out sql/testdata.sql` を流し直す。**
   * 定義を変えたのに出し直していない、というだけの意味しかない。
   */
  it('コミットしてある sql/testdata.sql が定義と一致している', () => {
    const committed = readFileSync(TESTDATA_SQL_PATH, 'utf8')
    expect(committed).toBe(dump(bundle).sql)
  })
})
