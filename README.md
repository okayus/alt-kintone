# alt-kintone

**業務フローを第一級の概念に置いた、AI前提の業務アプリ基盤**。kintone の再実装ではなく、
kintone が構造的に解けなかった問題を「アプリを作るのは人間ではなくAI」という前提から解く。

構想と設計判断は [`docs/product-concept.md`](docs/product-concept.md) を参照。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/product-concept.md](docs/product-concept.md) | **プロダクト構想**。何を作るか、確定した設計判断、未確定の論点 |
| [docs/condition-ast.md](docs/condition-ast.md) | **条件式AST仕様**。TS と Go の契約 |
| [docs/domain-model.md](docs/domain-model.md) | ドメインモデル v2（テーブル・業務フロー3本・ロール） |
| [docs/sales-domain.md](docs/sales-domain.md) | 営業ドメインの一般論 |
| [docs/domain-research.md](docs/domain-research.md) | ドメイン調査（kintone料金・業界構造・代替SaaS） |
| [docs/cost-simulation.md](docs/cost-simulation.md) | コスト試算 ※Go前提への書き換えが必要 |

## 構成

```
packages/dsl    @alt/dsl — 条件式AST の定義（zod）とビルダー。TS と Go の契約
packages/sql    @alt/sql — AST → SQL 変換（SQLite方言）。Go に移植する部分
```

**言語構成**（[docs/product-concept.md §4-0](docs/product-concept.md)）:
バックエンドは最終的に **Go**。定義（TS DSL）・CLI・FE は TypeScript。
TS版バックエンドは仕様であり、Go版完成後は実装を捨てて
**言語非依存のテストケースだけを資産として残す**。TS実装に投資しすぎないこと。

今後増える予定: `@alt/cli`（`alt` コマンド）、`@alt/definitions`（ドメイン定義）、
バックエンド、エンドユーザーFE、管理画面FE。

## 開発（Docker）

インフラ（ホスティング・マネージドDB）は決めない方針で、**プロトタイプはローカルで動けばよい**。

```sh
docker compose up -d                   # イメージをビルドし、pnpm install して常駐
docker compose exec dev pnpm verify    # check:compose → typecheck → lint → test → fmt:check
```

`pnpm install` は compose の `command` が起動時に実行するので、別途叩く必要はない。

リポジトリを bind mount しているので、ホスト側のエディタでの編集がそのまま反映される。
`node_modules` はルートと各パッケージで匿名ボリュームに置き、bind mount に覆い隠されないようにしている
（**パッケージを追加したら `docker-compose.yml` の volumes にも追記すること**。
忘れても `pnpm verify` 先頭の整合チェックが検知して落ちる）。

**ポートは公開していない。** まだサーバーが無く、ホストの 3000 / 5173 は別プロジェクトの
コンテナが使っているため。API と FE を作るときに空いているポートを選んで
`docker-compose.yml` に追加する。

## 開発（Docker なし）

```sh
pnpm install
pnpm test
pnpm typecheck
```

## コマンド

| command | what |
|---|---|
| **`pnpm verify`** | **check:compose → typecheck → lint → test → fmt:check をまとめて実行。コミット前はこれ1つでよい** |
| `pnpm check:compose` | workspace パッケージと docker-compose.yml の匿名ボリュームの整合チェック |
| `pnpm test` | 全パッケージのテスト（vitest / `vp test`） |
| `pnpm typecheck` | 全パッケージの型検査（`tsc --noEmit`） |
| `pnpm build` | 全パッケージのビルド（tsdown / `vp pack`） |
| `pnpm lint` | oxlint（`vp lint`） |
| `pnpm fmt` | oxfmt（`vp fmt`） |

`typecheck` と `test` は **prebuild を必要としない**。パッケージ間の参照がソースを直接指すよう、
**2箇所**で同じ解決を与えている。

| 対象 | 設定 |
|---|---|
| typecheck（tsc） | 各パッケージの `tsconfig.json` の `paths` |
| test（vitest） | ルート `vite.config.ts` の `resolve.alias` |

vitest 側が要るのは、無いと workspace のシンボリックリンク経由で `dist/` の**ビルド済み成果物**を
読んでしまうため。prebuild を忘れると「古いコードのままテストが通る」という一番たちの悪い壊れ方をする。
パッケージを追加したら**両方**に追記すること。
