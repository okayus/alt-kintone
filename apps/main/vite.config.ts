import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

// ルートの vite.config.ts と同じ狙い。パッケージ間参照はソースを直接指す。
// これが無いと dev サーバーも vitest も workspace シンボリックリンク経由で
// `dist/` のビルド済み成果物を読み、prebuild を忘れると古い定義のまま画面が動く。
//
// ⚠ このアプリは `@alt/definitions` を**値として** import する（ステップ名と順序）。
//    型だけでなく実行時にも解決されるので、alias は必須。
const source = (pkg: string) =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@alt/dsl': source('dsl'),
      '@alt/definitions': source('definitions'),
    },
  },
  server: {
    // コンテナの外（ホスト）からポートマッピング越しに届かせる。
    // 既定の localhost 待ち受けだと 5273 を叩いても繋がらない。
    host: true,
    port: 5173,
    // CORS は作らない方針（docs/impl/phase-3-backend.md の「作らないもの」）。
    // 同じコンテナ内で動いている API に proxy する。
    proxy: { '/api': 'http://localhost:3000' },
  },
  // fmt は既存コードの流儀に合わせる（ルートの vite.config.ts と同じ）。
  fmt: {
    semi: false,
    singleQuote: true,
  },
})
