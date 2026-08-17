import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `packages/*` が共有する vitest 設定。各パッケージの test スクリプトが
// `vitest run --config ../../vitest.shared.ts` で読む。
//
// 設定ファイルは1つだが、走るのはパッケージごとに別プロセス（`pnpm -r run test`）。
// `root` を明示しているのはそのため — 既定は「設定ファイルの場所」ではなく
// 呼び出し元の cwd だが、暗黙に頼ると設定を動かしたときに全パッケージのテストを
// 1つのパッケージが拾う形で静かに壊れる。
//
// 自前の設定を持つ `apps/*` はこれを読まない（`apps/main/vite.config.ts`）。
const source = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  root: process.cwd(),
  // パッケージ間参照はソースを直接指す。tsconfig の paths（typecheck 用）と同じ解決を
  // 実行時にも与えるためのもの。これが無いと vitest は workspace シンボリックリンク経由で
  // パッケージの main を探しに行き、`@alt/*` は main を持たない（= dist を作らない）ので
  // その場で ERR_MODULE_NOT_FOUND になる。
  resolve: {
    alias: {
      '@alt/dsl': source('dsl'),
      '@alt/sql': source('sql'),
      '@alt/definitions': source('definitions'),
      '@alt/diff': source('diff'),
      '@alt/server': source('server'),
      '@alt/cli': source('cli'),
    },
  },
})
