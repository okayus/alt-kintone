/**
 * dev エントリ。
 *
 * ここが**組み立ての場所**。認証の実装を注入するのはここだけで、`shell/api.ts` より
 * 内側は `X-Dev-User` を知らない。サーバ側の `packages/server/src/main.ts` と同じ形。
 *
 * ⚠ このファイルは `shell/auth/dev-user.ts`（ユーザー詐称）を import している。
 *    本番エントリを作るときは**別ファイル**にして、ここを持ち込まないこと
 *    （docs/implementation.md 決定8「本番ビルドにコードごと含めない」）。
 */
import { NuqsAdapter } from 'nuqs/adapters/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './shell/App'
import { createClient } from './shell/api'
import { DEV_USERS, currentDevUser, devUserHeaders, setDevUser } from './shell/auth/dev-user'
import './shell/app.css'

const container = document.getElementById('root')
if (container === null) throw new Error('#root が index.html に無い')

createRoot(container).render(
  <StrictMode>
    {/*
      URL のクエリに状態を置くためのアダプタ（docs/impl/phase-6-list-grid.md 論点D 案A）。
      **ルータはハッシュのまま**で、nuqs が触るのは `location.search` だけ
      （`new URL(location.href)` の `.search` を差し替える実装なので hash は保たれる）。
      結果として一覧 → 詳細 → 戻る の往復でフィルタが残る。
    */}
    <NuqsAdapter>
      {/*
        **業務フローごとに1本ずつ作る**（フェーズ9）。`flow` は認可の範囲と `changed_flow` を
        決める値なので、呼び出しごとに渡す形にすると指定漏れが認可の取り違えになる。
      */}
      <App
        clients={{
          sales: createClient(devUserHeaders, 'sales'),
          request: createClient(devUserHeaders, 'request'),
        }}
        devUsers={{ users: DEV_USERS, current: currentDevUser(), onChange: setDevUser }}
      />
    </NuqsAdapter>
  </StrictMode>,
)
