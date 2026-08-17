import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// ルートの vitest.shared.ts と同じ狙い。パッケージ間参照はソースを直接指す。
// これが無いと dev サーバーも vitest も workspace シンボリックリンク経由で
// パッケージの main を探しに行き、`@alt/*` は main を持たないのでその場で落ちる。
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
      '@alt/diff': source('diff'),
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
  /**
   * テストは2層（docs/impl/phase-7-list-grid-edit.md 決定R の追記）。
   *
   * - unit: 純関数（node）。従来どおり
   * - browser: **実 Chromium** で回すコンポーネントテスト。グリッドのキーボード配線
   *   （フォーカスの正直さ・IME ガード）は DOM フォーカスの所在そのものが本体で、
   *   node / jsdom では原理的に検証できないのでこの層に置く
   *
   * ブラウザは playwright のダウンロード版ではなく**イメージに apt で焼いた Chromium**
   * を使う（Dockerfile。playwright のバージョンと browser バイナリの版結合を避ける）。
   * コンテナは root で動くので sandbox は切る。
   */
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.tsx'],
          browser: {
            enabled: true,
            headless: true,
            // 失敗時のスクリーンショットは撮らない（bind mount されたリポジトリに
            // __screenshots__ が溜まるため。必要なら手で有効化する）
            screenshotFailures: false,
            provider: playwright({
              launchOptions: {
                executablePath: process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium',
                chromiumSandbox: false,
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
