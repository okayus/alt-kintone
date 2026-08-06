# フェーズ2: CLI

ハブ: [../implementation.md](../implementation.md)

**目的**: 定義を検証し、SQLite にスキーマとして適用できるようにする。

---

## 全体像

`packages/cli` を新設し、`alt` コマンドを2つ作る。

```sh
docker compose exec dev pnpm alt validate          # 3層の検証
docker compose exec dev pnpm alt apply --recreate  # SQLite にスキーマを作る
docker compose exec dev pnpm alt export            # 定義を JSON で吐く（フェーズ3の入力）
```

ルート `package.json` に `"alt": "tsx --tsconfig packages/cli/tsconfig.json packages/cli/src/main.ts"`
を足して起動する。`--tsconfig` は必須（**確認済み**: これを付けると tsx が `paths` を解釈して
`packages/*/src` を直接読む。付けないと workspace シンボリックリンク経由で `dist/` の
古い成果物を読み、prebuild 忘れに気づけない — ルート `vite.config.ts` の alias と同じ罠）。

コマンド解析は Node 24 の `util.parseArgs`。CLI フレームワークは入れない。

### validate の中核はエラーメッセージ

`alt validate` の価値は「AIが読んで直せるか」で決まる（[product-concept.md §5-4](../product-concept.md)）。
検出できることより、**検出したあと何を直せばいいかが分かること**を優先する。

> ⚠ **仕様との差分**: §5-4 は「どのファイルの何行目が」と書いているが、定義は TypeScript なので
> 実行時に行番号は取れない。位置は**論理的なキー**（`flow=sales step=proposed check=timing_confirmed`）で示す。
> 実装時に §5-4 へ注記を入れる。

---

## パッケージ構成

`packages/cli`（`@alt/cli`）。依存は `@alt/dsl` / `@alt/sql` / `@alt/definitions` と
`better-sqlite3`、`zod`（zod の issue を自前のエラー形式に変換するため）。

**パッケージ追加時の3箇所**（ハブ「すでに動いているもの」参照）を忘れない:
`docker-compose.yml` の匿名ボリューム / 自身の `tsconfig.json` の `paths` / ルート `vite.config.ts` の `resolve.alias`。

| ファイル | 中身 |
|---|---|
| `src/main.ts` | エントリ。3行（`process.exitCode = run(...)`） |
| `src/cli.ts` | `parseArgs`、サブコマンド分岐、出力整形、終了コード。出力先は `Io` で受ける（テストのため） |
| `src/bundle.ts` | `@alt/definitions` を束ねる**唯一の場所**。ここ以外は客先定義を知らない |
| `src/validate.ts` | 3層の検証。**純関数**（バンドルを受け取りエラー配列を返す） |
| `src/apply.ts` | SQLite への適用 |
| `src/*.test.ts` | テスト |

エントリと `run()` を分けているのは、entry を import した瞬間にコマンドが走るとテストが書けないため。

**なぜ CLI が客先定義を静的 import するか**: 任意パスの定義を実行時ロードする仕組みは、
「基盤として作るか客先アプリとして作るか」（[product-concept.md §10-1](../product-concept.md)、未判断）を
先に決めることになる。`bundle.ts` 1ファイルに閉じておけば、汎用化するときの差し替え点がそこだけで済む。
検証ロジックは純関数なので、壊れた定義のテストは実行時ロードなしで書ける。

---

## 2-0. 定義バンドル（`@alt/dsl` に追加）

`@alt/dsl` に `bundle.ts` を足す。フェーズ3のバックエンドと `alt export` の受け渡し形でもある。

```ts
export interface DefinitionBundle {
  tables: Registry      // Record<string, TableDef>
  flows: FlowDef[]
  roles: RoleDef[]
}
export const definitionBundleSchema: z.ZodType<DefinitionBundle>
```

これで validate の構文層は `definitionBundleSchema.safeParse(bundle)` 一発になる。

---

## 2-1. `alt validate`

### ルール一覧

`rule` は kebab-case の英語識別子（enum の値と同じ理由で、表示文言と分ける）。メッセージは日本語。

**層1: 構文** — `definitionBundleSchema` に合致するか。zod の issue を1件ずつエラーに変換する。

| rule | 内容 |
|---|---|
| `schema` | zod スキーマに合致しない。`path` を `flows[0].steps[2].exit[1].condition` → `flow=sales step=proposed check=...` に読み替えて出す |
| `registry-key-mismatch` | `tables` のキーと `TableDef.name` が食い違う |
| `duplicate-flow-key` / `duplicate-role-key` | キーの重複 |

ステップキーの重複と `initial` の実在は `flowDefSchema` が既に見ている（`schema` でカバーされる）。

**層2: 参照整合** — registry と突き合わせないと分からないもの。

| rule | 内容 |
|---|---|
| `unknown-reference-table` | `reference('xxx')` の参照先テーブルが無い |
| `unknown-flow-target` | `flow.target` のテーブルが無い |
| `unknown-step-table` | `step.reads` / `step.writes` のテーブルが無い |
| `unknown-binding-table` | `binding.table` のテーブルが無い |
| `unknown-step-role` | `step.role` が宣言済みロールに無い |
| `unknown-next-step` | `step.next` のキーがフロー内に無い |
| `unresolved-condition` | 出口条件の条件式が SQL に変換できない（`compilePred` が投げる） |

`unresolved-condition` は自前で AST を歩かず `compilePred` を呼ぶ。変換できたなら全 field が
registry で解決できている、という強い検査になる（`definitions.test.ts` が既に採っている手）。
`compilePred` のメッセージ（`解決できない参照: deal.foo`）にフロー・ステップ・チェックキーを添える。

**層3: 業務ルール** — ここが効く（§5-4）。定義の質をレビューではなくツールが担保する部分。

| rule | 内容 |
|---|---|
| `target-not-primary` | `flow.target` が primary バインドされていない（「primary が2つ」ではない。§8-1 フェーズ1） |
| `step-without-exit` | `next` が空でないステップに出口条件が無い（→ 下の「決める設計判断」） |
| `unreachable-step` | `initial` から到達できないステップ |
| `undeclared-table` | 使っているのに `bindings` に無く `global` でもない |
| `unused-binding` | `bindings` にあるがどのステップでも使っていない |
| `duplicate-exit-key` | ステップ内で出口条件のキーが重複 |
| `orphan-table` | どのフローからも使われていないテーブル（`global` は除外）。§3-2「バインドされていないテーブルは使えない」の機械検知 |

### エラーの形

```ts
interface ValidationError {
  layer: 'syntax' | 'reference' | 'rule'
  rule: string
  /** 論理的な位置。例 { flow: 'sales', step: 'proposed', check: 'timing_confirmed' } */
  where: Record<string, string>
  message: string
  /** どう直すか。候補の列挙を含む */
  hint?: string
}
```

人間向け出力:

```
✖ 2 件

[rule/step-without-exit] flow=sales step=suspended
  出口条件が1つも無いが、next に遷移先がある（qualified）。
  → 進行中のステップには出口条件が要る。自動判定できないなら manualCheck('key', 'ラベル') を足す。
     出る先が無い決着ステップなら next を空にする。

[reference/unknown-next-step] flow=sales step=proposed
  next の "wonn" に対応するステップが無い。
  → 候補: contacted, qualified, proposed, won, lost, abandoned, suspended
```

`--json` は `{ ok, errorCount, errors }`。終了コードは 0=正常 / 1=検証エラー / 2=使い方の誤り。

---

## 2-2. `alt apply`

```
alt apply [--db <path>] [--recreate] [--json]
```

1. まず validate。エラーがあれば**何も触らずに終了**する
2. 適用先を決める: `--db` > 環境変数 `DATABASE_URL`（`file:` は剥がす）> `data/alt.db`
3. 管理対象テーブル（定義のテーブル + `_flow_state` / `_manual_check`）が既にあれば、
   `--recreate` が無い限り失敗する
4. 1トランザクションで DROP →`platformTablesSql()` → 各テーブルの `createTableSql` + `currentRowIndexSql`

差分適用（`alt plan`・マイグレーション）は作らない。プロトタイプなのでデータを守る必要はない。
ただし**黙って消しはしない**（`--recreate` を要求する）。§5-4 の破壊的変更の原則を、
差分エンジン抜きで満たせる最小の形。

`packages/sql/src/ddl.ts` が既にあるので、ここは実質「DDL を並べて流す」だけになる。

---

## 2-3. `alt export`

定義バンドルを JSON で標準出力に吐くだけ（実質10行）。

決定1「定義は apply 時に JSON へ変換してバックエンドに渡す」を守るために入れる。
これが無いとフェーズ3のバックエンドが `@alt/definitions` を直接 import することになり、
Go 版で成立しない構造のまま進んでしまう。

---

## 2-4. `definitions.test.ts` の整理

`packages/definitions/src/definitions.test.ts` は「`alt validate` が3層でやることの先取り」として
書かれている（ファイル冒頭のコメント）。validate ができたら重複するので整理する。

- **validate に移す**: 構文・参照整合・業務ルールの汎用チェック（上のルール一覧に対応するもの）
- **残す**: この定義集合に固有の期待値 —「暗黙結合の前提」（`activity → deal` の外部キーが1つ、
  `deal → contact` が無い）と、`usedTables` の導出結果の具体値
- **足す**: 「`@alt/definitions` が `alt validate` を通る」1件。ただし置き場は **CLI 側**
  （定義パッケージから `@alt/cli` を参照すると循環依存になる）

結果、`definitions.test.ts` は 17件 → 4件になり、「定義のルール」の置き場が validate 1箇所になった。
`@alt/sql` への devDependency（条件式の SQL 変換テストのためだけにあった）も外れ、
「定義そのものは SQL 層に依存しない」が依存関係でも表現された。

---

## この機会に決めた設計判断

**論点10（終端ステップの出口条件）を決着させた** → [§8-1「フェーズ2（CLI）で決めたもの」](../product-concept.md)。

`next` が空なら免除、空でなければ出口条件を必須。保留ステップは定義側に
`manualCheck('resumable', '再開できる状況になった')` を足して解消した。
実際に `alt validate` が保留ステップを検出したので、ルールが機能していることは確認済み。

そのほかフェーズ2で決めたこと（CLI と客先定義の関係、受け渡し形、apply の破壊的変更の扱い、
エラー位置の示し方）も同じ表にまとめてある。

※ 論点7（マスタを誰も更新できない）・論点9（決着ステップと `deal.status` の二重管理）は
フェーズ2では触らない。validate のルールとしても検出しない。
※ 新しく §8-2 に足したもの: 論点11（条件式 AST の構文エラーの出し方）。

---

## 作らないもの

| | 理由 |
|---|---|
| `alt plan` | 差分適用を作らないので出すものが無い |
| `alt bindings` / `alt table` / `alt flow` | 参照系。フェーズ3・4に要らない |
| `alt generate frontend` / `alt diff` | FEは手で書く（ハブ「作らないもの」） |
| 任意パスの定義の実行時ロード | §10-1 が未判断。`bundle.ts` に閉じておく |
| 警告レベル（error 以外） | エラーだけで足りる。段階を増やすと無視される |

---

## 完了条件

- `pnpm alt validate` が `@alt/definitions` に対して通る（終了コード 0）
- 上のルール一覧の各項目について、壊れた定義を入力すると検出することがテストで示せている
- `pnpm alt apply --recreate` でローカルの SQLite にスキーマができ、
  テーブル（業務5本 + プラットフォーム2本）とインデックス（現在行のユニーク索引）が揃う
- `pnpm alt export` が JSON を吐き、`definitionBundleSchema` で読み戻せる
- `docker compose exec dev pnpm verify` が通る

---

## 次

フェーズ3（バックエンド）→ [phase-3-backend.md](phase-3-backend.md)
