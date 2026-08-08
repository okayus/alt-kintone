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
packages/dsl          @alt/dsl — 条件式AST・テーブル定義・フロー定義・ロール定義（zod）。TS と Go の契約
packages/sql          @alt/sql — AST → SQL 変換と DDL（SQLite方言）。Go に移植する部分
packages/definitions  @alt/definitions — 客先の定義そのもの（テーブル5本・営業フロー1本）
packages/cli          @alt/cli — `alt` コマンド（validate / apply / export / seed）
packages/server       @alt/server — REST API。定義（JSON）からルート・認可・出口条件を生やす
apps/main             @alt/main — エンドユーザーFE（React + Vite）。業務フローが画面に現れる場所
```

**言語構成**（[docs/product-concept.md §4-0](docs/product-concept.md)）:
バックエンドは最終的に **Go**。定義（TS DSL）・CLI・FE は TypeScript。
TS版バックエンドは仕様であり、Go版完成後は実装を捨てて
**言語非依存のテストケースだけを資産として残す**。TS実装に投資しすぎないこと。

今後増える予定: 管理画面FE。

## 開発（Docker）

インフラ（ホスティング・マネージドDB）は決めない方針で、**プロトタイプはローカルで動けばよい**。

```sh
docker compose up -d                   # イメージをビルドし、pnpm install して常駐
docker compose exec dev pnpm verify    # check:wiring → fmt:check → typecheck → lint → test
```

`pnpm install` は compose の `command` が起動時に実行するので、別途叩く必要はない。

リポジトリを bind mount しているので、ホスト側のエディタでの編集がそのまま反映される。
`node_modules` はルートと各パッケージで匿名ボリュームに置き、bind mount に覆い隠されないようにしている
（**パッケージを追加したら `docker-compose.yml` の volumes にも追記すること**。
忘れても `pnpm verify` 先頭の整合チェックが検知して落ちる）。

**ポートはホスト側でずらしてある**（3000 / 5173 は別プロジェクトのコンテナが使っているため）。
API は `localhost:3100`、FE の dev サーバーは `localhost:5273` になる。

> ⚠ **コンテナを作り直したあと（ポート追加など）は `node_modules` が空になることがある。**
> 匿名ボリュームだけが新しくなっても pnpm は「Already up to date」と言って再リンクしないため。
> `ERR_MODULE_NOT_FOUND` が出たら:
>
> ```sh
> docker compose exec dev sh -c 'rm -f node_modules/.pnpm-workspace-state-v1.json node_modules/.package-map.json && pnpm install'
> ```

## 開発（Docker なし）

```sh
pnpm install
pnpm test
pnpm typecheck
```

## コマンド

| command | what |
|---|---|
| **`pnpm verify`** | **check:wiring → fmt:check → typecheck → lint → test をまとめて実行。コミット前はこれ1つでよい**（安い順に並べて、落ちるなら早く落とす） |
| `pnpm check:wiring` | パッケージ追加時の「4箇所」の追記漏れチェック（下記） |
| `pnpm test` | 全パッケージのテスト（vitest / `vp test`） |
| `pnpm typecheck` | 全パッケージの型検査（`tsc --noEmit`） |
| `pnpm build` | 全パッケージのビルド（tsdown / `vp pack`） |
| `pnpm lint` | oxlint（`vp lint`） |
| `pnpm fmt` | oxfmt（`vp fmt`） |
| `pnpm alt <cmd>` | `alt` コマンド（下記） |
| `pnpm serve` | API サーバーを起動（`localhost:3100`。下記） |
| `pnpm dev` | FE の dev サーバーを起動（`localhost:5273`。下記） |

### ブラウザテスト（vitest browser mode）

`apps/main` のテストは2層ある（`apps/main/vite.config.ts` の `test.projects`）:

- **unit** — 純関数（node）。`src/**/*.test.ts`
- **browser** — **実 Chromium** で回すコンポーネントテスト。`src/**/*.browser.test.tsx`。
  グリッドのキーボード配線（フォーカスの正直さ・IME ガード）のように、
  **DOM フォーカスの所在そのものが本体**の挙動はここに置く（node / jsdom では捕まらない）

ブラウザは **イメージに apt で焼いた Chromium** を使う（`Dockerfile`）。playwright には
ダウンロードさせない（`pnpm-workspace.yaml` の `allowBuilds: playwright: false` と
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` が対）。パスは `CHROMIUM_PATH`（既定
`/usr/bin/chromium`）で差し替えられるので、Docker なしで走らせる場合はローカルの
Chrome/Chromium を指すこと。API はスタブ（`Client` を注入）なのでサーバー起動は不要。

### `alt` コマンド

定義を検証し、SQLite に適用する（[docs/product-concept.md §5-3](docs/product-concept.md)）。

```sh
docker compose exec dev pnpm alt validate          # 3層（構文 / 参照整合 / 業務ルール）で検証
docker compose exec dev pnpm alt apply --recreate  # SQLite にスキーマを作る
docker compose exec dev pnpm alt export --out data/definitions.json  # サーバーが読む形で書き出す
docker compose exec dev pnpm alt seed --reset      # 開発用のデモデータを入れる
```

全コマンドに `--json`（AIが構造化して読めるように）。終了コードは 0 成功 / 1 検証エラー・適用失敗 /
2 使い方の誤り。適用先は `--db` > 環境変数 `DATABASE_URL` > `data/alt.db`。

`alt seed` は開発用の裏口。`company` / `contact` / `employee` は営業フローの reference バインド
（読むだけ）なので**書き込み API が生えず**、API 経由では入れられない。

### API サーバー

```sh
docker compose exec dev pnpm alt apply --recreate
docker compose exec dev pnpm alt export --out data/definitions.json
docker compose exec dev pnpm alt seed --reset
docker compose exec -d dev pnpm serve      # localhost:3100

curl -H 'X-Dev-User: yamada@example.com' 'localhost:3100/api/deal?flow=sales'
```

- **ルートは定義から生える。** バインドされていないテーブルは 404、読むだけのテーブルは
  書き込みが 403（[docs/product-concept.md §3-2](docs/product-concept.md)）
- 認証は実装していない。`X-Dev-User` に `employee.email` を入れて詐称する
  （**開発用。本番ビルドにはコードごと含めない**）
- 定義は起動時に `data/definitions.json` を読む（`ALT_DEFINITIONS` で変えられる）。
  定義を変えたら `alt export --out` を流し直して再起動する

差分適用は持たない。既存テーブルがあるときに `--recreate` を求めるのは、黙ってデータを消さないため。

### エンドユーザーFE

```sh
docker compose exec -d dev pnpm serve      # API を先に（localhost:3100）
docker compose exec -d dev pnpm dev        # FE（localhost:5273）
```

API と FE は別々に上げる（落ちたときにどちらが死んだか分かるように）。
FE は `/api` を同じコンテナ内の API に proxy するので、CORS は要らない。

- **ステップ名と順序は `@alt/definitions` から値として import している**。定義を変えると
  画面が追随する（[docs/impl/phase-4-frontend.md](docs/impl/phase-4-frontend.md) 決定B）
- 画面右上のプルダウンで `X-Dev-User` を切り替える（**開発用。本番ビルドには含めない**）。
  `鈴木 一郎（営業マネージャー）` を選ぶと 403 になるが、これは仕様どおりで
  [§8-2 論点12](docs/product-concept.md) がそのまま画面に出ている
- 「時点」に日時を入れると `as_of` で過去のバージョンが読める（読み取り専用になる）
- enum の**表示ラベルは定義に無い**ので `apps/main/src/flows/sales/labels.ts` に手書きしてある
  （[§8-2 論点14](docs/product-concept.md)）

### パッケージを追加したときの「4箇所」

`typecheck` / `test` / `alt` は **prebuild を必要としない**。パッケージ間の参照がソースを直接指すよう、
同じ解決を複数箇所で与えているため。**どれを忘れても即座には壊れず、`dist/` の古い成果物を
読んだまま通ってしまう**（prebuild 忘れに気づけない、という一番たちの悪い壊れ方）。

| # | 対象 | 設定 |
|---|---|---|
| 1 | コンテナ内の依存 | `docker-compose.yml` の匿名ボリューム |
| 2 | typecheck（tsc） | そのパッケージの `tsconfig.json` の `paths` |
| 3 | test（vitest）と dev サーバー | `vite.config.ts` の `resolve.alias`。`packages/*` はルート、**自前の `vite.config.ts` を持つ `apps/*` はそちら**（最寄りの設定が読まれるので、ルートに書いても効かない） |
| 4 | `alt` の実行時 | ルート `package.json` の `tsx` 起動に `--tsconfig`（2 を実行時にも効かせる） |

覚えておく必要はない。**`pnpm check:wiring`（`verify` の先頭）が4つとも検知して落とす。**
消し忘れ（対応するパッケージが無い alias など）は警告として出すが、失敗にはしない。

### 自動で走るもの

`package.json` / `pnpm-workspace.yaml` を編集すると、PostToolUse hook
（`.claude/hooks/pnpm-install-on-manifest-change.sh`）がコンテナ内で `pnpm install` を流す。
compose の `command` は起動時にしか install しないので、依存を足したあとの叩き忘れで
`Cannot find module` / `TS2307` を踏むのを防ぐ。発火の証跡は `.claude/.hook-log`（gitignore 済み）。

vitest 側が要るのは、無いと workspace のシンボリックリンク経由で `dist/` の**ビルド済み成果物**を
読んでしまうため。prebuild を忘れると「古いコードのままテストが通る」という一番たちの悪い壊れ方をする。
パッケージを追加したら**両方**に追記すること。
