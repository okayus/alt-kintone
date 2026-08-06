import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

// パッケージ間参照はソースを直接指す。tsconfig の paths（typecheck 用）と同じ解決を
// 実行時にも与えるためのもので、これが無いと vitest は workspace シンボリックリンク経由で
// `dist/` の**ビルド済み成果物**を読む。prebuild を忘れると古いコードのままテストが通る、
// という一番たちの悪い壊れ方をするので、ここで塞ぐ。
const source = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@alt/dsl': source('dsl'),
      '@alt/sql': source('sql'),
      '@alt/definitions': source('definitions'),
    },
  },
  // fmt は既存コードの流儀（シングルクォート・セミコロン無し）に合わせる。
  // 設定が無いと oxfmt のデフォルト（ダブルクォート・セミコロン有り）で全ファイルが書き換わる。
  fmt: {
    semi: false,
    singleQuote: true,
  },
})
