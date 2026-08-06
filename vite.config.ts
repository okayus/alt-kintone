import { defineConfig } from 'vite-plus'

// fmt は既存コードの流儀（シングルクォート・セミコロン無し）に合わせる。
// 設定が無いと oxfmt のデフォルト（ダブルクォート・セミコロン有り）で全ファイルが書き換わる。
export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
  },
})
