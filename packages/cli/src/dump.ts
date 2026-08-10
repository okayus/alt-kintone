/**
 * スキーマ + テストデータを1本の `.sql` にする。
 *
 * **狙いは「別のマシンで手早くデータを用意する」こと**だけ。`alt apply` + `alt seed` を
 * 走らせれば同じ状態になるので、これは代替であって上位互換ではない
 * （`docs/local-setup.md` に使い分けを書いてある）。
 *
 * ## 定義から毎回作る（ダンプをリポジトリに貼らない）
 *
 * SQL を手で書いて置くと、定義を直したときに**黙って古くなる** — このリポジトリが
 * `check:wiring`（4箇所の追記漏れ）や `alt diff`（適用済みとの差分）で潰してきた
 * 壊れ方そのもの。だからここは**インメモリの SQLite に一度流してから書き出す**:
 *
 * 1. `apply` が定義から DDL を作って流す
 * 2. `seed` が同じ経路（`@alt/sql` の `insertRecord`）でデモデータを入れる
 * 3. その結果を丸ごと読み出して INSERT 文にする
 *
 * つまり **`alt seed` と1文字も違わないデータ**が出る。シードの中身が変われば
 * 出力も変わるので、両者がずれることが原理的に起きない。
 *
 * ⚠ **方言は SQLite 固定**。値のリテラル化（`'` の畳み方・真偽値の持ち方）が方言依存で、
 *   いま要るのがローカルの SQLite だけなので広げていない。PostgreSQL に出したくなったら
 *   `@alt/sql` の `Dialect` に literal を足す形になる（DDL 側は既に方言を取れる）。
 */
import type { DefinitionBundle } from '@alt/dsl'
import { schemaStatements, sqlite } from '@alt/sql'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { apply, managedTables } from './apply.js'
import { seed } from './seed.js'

/**
 * リポジトリに置いてある生成物。**cwd に依存させない** — `pnpm alt`（リポジトリ直下）と
 * vitest（`packages/cli` 直下）の両方から同じファイルを指す必要があるため。
 * 一致しているかは `dump.test.ts` が見張る。
 *
 * ⚠ **これを `--out` で書き直さない。** コンテナは root で動くので、bind mount された
 *   リポジトリに root 所有のファイルができてホストから触れなくなる。作り直すのは
 *   `docker compose exec -T dev pnpm --silent alt dump > sql/testdata.sql`（docs/local-setup.md）。
 */
export const TESTDATA_SQL_PATH = fileURLToPath(
  new URL('../../../sql/testdata.sql', import.meta.url),
)

export interface DumpOptions {
  /** ダミー案件の件数。`alt seed --deals` と同じ意味。 */
  deals?: number | undefined
}

export interface DumpResult {
  sql: string
  /** テーブルごとの行数。 */
  rows: Record<string, number>
  /** 流した DDL の本数。 */
  statements: number
}

export function dump(bundle: DefinitionBundle, opts: DumpOptions = {}): DumpResult {
  // ファイルを作らない。**出力を作るのが目的で、DB を残すのが目的ではない**
  const db = new Database(':memory:')
  try {
    const applied = apply(db, bundle)
    seed(db, bundle, { ...(opts.deals === undefined ? {} : { deals: opts.deals }) })

    const tables = managedTables(bundle)
    const lines: string[] = [...header(bundle, opts), 'BEGIN TRANSACTION;', '']

    // 作り直せる形にする（`alt apply --recreate` + `alt seed --reset` に当たる）
    for (const name of tables) lines.push(`DROP TABLE IF EXISTS ${sqlite.quote(name)};`)
    lines.push('')
    for (const statement of schemaStatements(bundle)) lines.push(`${statement};`)
    lines.push('')

    const rows: Record<string, number> = {}
    for (const name of tables) {
      const records = db.prepare(`SELECT * FROM ${sqlite.quote(name)}`).all() as Array<
        Record<string, unknown>
      >
      if (records.length === 0) continue
      rows[name] = records.length
      lines.push(`-- ${name}: ${records.length} 件`)
      for (const record of records) lines.push(insertSql(name, record))
      lines.push('')
    }

    lines.push('COMMIT;')
    return { sql: `${lines.join('\n')}\n`, rows, statements: applied.statements }
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------

function header(bundle: DefinitionBundle, opts: DumpOptions): string[] {
  const deals = opts.deals === undefined ? '' : ` --deals ${opts.deals}`
  return [
    '-- alt-kintone のテストデータ。**手で編集しない**',
    `-- 作り直し: pnpm alt dump${deals} --out <このファイル>`,
    `-- 中身: テーブル ${Object.keys(bundle.tables).length} 本 + プラットフォーム 2 本、`,
    '--       データは alt seed と同一（同じ定義・同じ固定シードから作っている）',
    '--',
    '-- 流し方 / これが要らない場合については docs/local-setup.md',
    '',
  ]
}

function insertSql(table: string, record: Record<string, unknown>): string {
  const columns = Object.keys(record).map((name) => sqlite.quote(name))
  const values = Object.values(record).map(literal)
  return `INSERT INTO ${sqlite.quote(table)} (${columns.join(', ')}) VALUES (${values.join(', ')});`
}

/**
 * 値を SQLite のリテラルにする。**ここだけが SQL インジェクション相当の壊れ方をしうる**
 * （プレースホルダを使わない唯一の場所）ので、テストから直に叩けるよう export してある。
 *
 * better-sqlite3 が返すのは保存時の型そのもの（TEXT / INTEGER / REAL / NULL）なので、
 * ここで型変換はしない — **読み出した形をそのまま書き戻す**のが正しい。
 */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  // 真偽値は DDL で INTEGER に落ちているので、ここへは来ない想定。来ても壊さない
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
  return `'${String(value).replaceAll("'", "''")}'`
}
