/**
 * dev エントリ。`pnpm serve` が tsx で直接実行する。
 *
 * ここが**組み立ての場所**。定義（JSON）・DB・認証の実装を注入するのはここだけで、
 * app.ts より内側は何も知らない。認証を OIDC にするときも、差し替わるのはこの1行。
 *
 * ⚠ このファイルは `auth/dev-user.ts`（ユーザー詐称）を import している。
 *    本番エントリを作るときは**別ファイル**にして、ここを持ち込まないこと。
 */
import { createApp, loadRegistry, serve } from './index.js'
import { devUserAuth } from './auth/dev-user.js'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'

const DEFAULT_DEFINITIONS = 'data/definitions.json'
const DEFAULT_PORT = 3000

const definitionsPath = process.env['ALT_DEFINITIONS'] ?? DEFAULT_DEFINITIONS
const port = Number(process.env['PORT'] ?? DEFAULT_PORT)

// DATABASE_URL は file: 付きで書かれる（docker-compose.yml）ので剥がす。
// @alt/cli の resolveDbPath と同じ処理だが、サーバは CLI に依存しない
const raw = process.env['DATABASE_URL'] ?? 'data/alt.db'
const dbPath = raw.startsWith('file:') ? raw.slice('file:'.length) : raw

let registry
try {
  registry = loadRegistry(JSON.parse(readFileSync(definitionsPath, 'utf8')))
} catch (error) {
  process.stderr.write(
    `定義を読めない（${definitionsPath}）: ${error instanceof Error ? error.message : String(error)}\n` +
      'pnpm alt export --out data/definitions.json で書き出す\n',
  )
  process.exit(1)
}

const db = new Database(dbPath)
const app = createApp({ db, registry, authenticator: devUserAuth })

serve(app, port)

// 起動ログに生えたルートを出す。**未バインドのテーブルがここに出ない**のが
// 「バインドされていないテーブルは使えない」の目に見える形（§3-2）
process.stdout.write(
  `alt-kintone API: http://localhost:${port}\n` +
    `  定義: ${definitionsPath} / DB: ${dbPath}\n` +
    `  認証: X-Dev-User（開発用のユーザー詐称。本番ビルドには含めない）\n` +
    app.registry
      .routes()
      .map((route) => `  ${route.method.padEnd(6)}${route.path}`)
      .join('\n') +
    '\n',
)
