/**
 * 定義 → SQLite のスキーマ。docs/impl/phase-2-cli.md 2-2
 *
 * 差分適用（`alt plan`・マイグレーション）は持たない。プロトタイプ段階でデータを
 * 守る必要はないので、作り直しでよい（docs/product-concept.md §8-2 論点3）。
 * ただし**黙っては消さない** — 既存テーブルがあれば `--recreate` を要求する。
 * §5-4 の破壊的変更の原則を、差分エンジン抜きで満たせる最小の形。
 *
 * DDL 生成そのものは `@alt/sql` にある。ここがやるのは並べて流すことだけ。
 */
import type { DefinitionBundle } from '@alt/dsl'
import { FLOW_STATE_TABLE, MANUAL_CHECK_TABLE, schemaStatements, sqlite } from '@alt/sql'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

type Db = Database.Database

/** 適用先の既定。docker-compose.yml の DATABASE_URL と揃えてある。 */
export const DEFAULT_DB_PATH = 'data/alt.db'

/**
 * プラットフォームが管理するテーブル。`--recreate` で作り直す対象でもある。
 * ここに無いテーブル（手で作った実験用など）には触らない。
 */
export function managedTables(bundle: DefinitionBundle): string[] {
  return [FLOW_STATE_TABLE, MANUAL_CHECK_TABLE, ...Object.keys(bundle.tables)]
}

export interface ApplyResult {
  /** 作り直しのために消したテーブル。 */
  dropped: string[]
  /** 作ったテーブル。 */
  created: string[]
  /** 流した DDL の本数（テーブル + 索引）。 */
  statements: number
}

export function apply(
  db: Db,
  bundle: DefinitionBundle,
  opts: { recreate?: boolean } = {},
): ApplyResult {
  const managed = managedTables(bundle)
  const existing = existingTables(db).filter((name) => managed.includes(name))

  if (existing.length > 0 && opts.recreate !== true) {
    throw new Error(
      `適用先に既存のテーブルがある: ${existing.join(', ')}\n` +
        '差分適用は持たないので、作り直すなら --recreate を付ける（既存データは失われる）',
    )
  }

  const statements = schemaStatements(bundle)
  // DDL ごと1トランザクション。途中で失敗しても半端なスキーマが残らない
  db.transaction(() => {
    for (const name of existing) db.exec(`DROP TABLE IF EXISTS ${sqlite.quote(name)}`)
    for (const sql of statements) db.exec(sql)
  })()

  return { dropped: existing, created: managed, statements: statements.length }
}

/**
 * 適用先のパス。`--db` > 環境変数 `DATABASE_URL` > 既定。
 * `DATABASE_URL` は `file:` 付きで書かれる（docker-compose.yml）ので剥がす。
 */
export function resolveDbPath(explicit?: string, env?: string): string {
  const raw = explicit ?? env ?? DEFAULT_DB_PATH
  return raw.startsWith('file:') ? raw.slice('file:'.length) : raw
}

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  return new Database(path)
}

function existingTables(db: Db): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
    name: string
  }>
  return rows.map((row) => row.name)
}
