# フェーズ3: バックエンド

ハブ: [../implementation.md](../implementation.md)

**目的**: 定義から REST API を生やし、業務フローに沿ったデータ操作ができるようにする。
**このフェーズが最も重い。**

> 2026-08-06 に着手時の詳細化を行った（`/phase-start 3`）。以下は実装計画。

---

## 0. 全体像

```
定義(TS) ──alt export──▶ data/definitions.json ──▶ @alt/server ──▶ SQLite
                                                      │
                                          X-Dev-User ─┘（認証モジュールは差し替え可能）
```

**新しいパッケージ `@alt/server`**（`packages/server`）を作る。リクエスト処理の中身は
「`ApiRequest` を受けて `ApiResponse` を返す純関数」にして、`node:http` はその外側の
アダプタ1枚に閉じる。理由は2つ:

- テストがソケットを開かずに書ける（`app.handle({ method, path, ... })` を直接呼ぶ）
- Go に移すとき、移すのはこの純関数側だけになる

```
packages/server/src/
  index.ts          公開エクスポート
  main.ts           dev エントリ。JSON 読込 + SQLite + node:http + 詐称認証の注入
  http.ts           node:http アダプタ（body 読み取り・JSON 変換・listen）
  app.ts            ルーティング（ApiRequest → ApiResponse）
  registry.ts       DefinitionBundle → 引ける形（3-1）
  records.ts        一覧・取得・作成・更新（3-2, 3-3）
  exit-checks.ts    出口条件の一括評価（3-4）
  flow-state.ts     現在ステップ・遷移・手動チェック（3-5）
  authz.ts          2層 + 行レベル + _permissions（3-6）
  record-input.ts   書き込み値の検証（型・enum・必須・未知フィールド）
  auth/dev-user.ts  X-Dev-User。**本番エントリからは import しない**
```

---

## 決めたこと（詳細化で決めた設計判断）

| # | 論点 | 判断 | 理由 |
|---|---|---|---|
| A | HTTP フレームワーク | **使わない**。`node:http` + 自前の小さなルート表 | CLI で `parseArgs` を選んだのと同じ理由。TS版は仕様であって Go 版完成後に捨てるので依存を増やさない。ルートは定義から生成するので、フレームワークのルータの出番がそもそも小さい |
| B | 定義の受け取り方 | **`alt export --out` が書いた JSON をブート時に読む**（`ALT_DEFINITIONS`、既定 `data/definitions.json`）。`@alt/definitions` を実行時に import しない | フェーズ2の決定（受け渡し形は `DefinitionBundle`）の実装。Go 版も同じ入口になる。ブート時に `definitionBundleSchema` で検証し、壊れていれば起動しない |
| C | 行レベル認可の書き方 | **`bind()` に `rowFilter` を足す**（`@alt/dsl` の変更）。`{ write: Pred }` | §4-1 で決まっている形をそのまま実装する。条件式 DSL を再利用するので専用の仕組みが要らない。`rowFilter` の無いテーブル（マスタ類）は自然に制限なしになる |
| D | 「未充足で進めた」の記録先 | **`_flow_state` に `unmet_checks` 列を足す**（JSON 配列）。新しい行に「直前ステップの未充足キー」を書く | 後から再評価しても*その時点の*充足状況は復元できないので、遷移時に確定させる必要がある。`changed_step`（＝出てきたステップ）とセットで読むと意味が閉じる |
| E | 手動チェックの操作 | **`PUT /api/{table}/{id}/checks/{key}` を足す**（概要には無かった） | 手動チェックを付ける手段が無いと出口条件チェックリストが動かない。ステップはサーバが現在ステップから決める（クライアントに言わせない） |
| F | 開発用シードデータ | **`alt seed` を CLI に足す**（概要には無かった） | 完了条件（一覧が取得でき、担当者でないと拒否される）はデータが無いと検証できない。`company` / `contact` / `employee` は reference バインドなので **API からは作れない**（§8-2 論点7）。§8-2 論点7 の答えではなく、開発用の裏口だと明示する |
| G | ユーザーの識別子 | **`X-Dev-User: <employee.email>`** | `employee` に IdP の subject はまだ無い。email が実際の OIDC で subject にマップする列になる |
| H | `deal.status` との二重管理（§8-2 論点9） | **フェーズ3では解かない**。遷移が `status` を自動で書くことはしない | 自動同期を先に入れると、どちらが正かを決めないまま実装が固まる。フェーズ4で画面を見てから決める |
| I | CORS | **持たない**。FE は vite の proxy で `/api` をサーバに流す | プロトタイプに認証もオリジン分離も無いのに CORS のコードだけあるのは筋が悪い |
| J | 一覧の絞り込み・並べ替え | **持たない**。`limit` だけ（既定100・最大500）、`valid_from DESC` 固定 | 数十件のプロトタイプで FE 側の絞り込みで足りる。クエリ言語を生やし始めると際限がない |
| K | 外部キーの実在検査 | **書き込み時に検査しない** | 検査そのものより「どの時点の行と突き合わせるか」（有効期間型）の設計が要る。プロトタイプでは `alt seed` と FE が正しい ID を渡す前提で足りる |

A〜K のうち確定分は、フェーズ完了時に `product-concept.md` §8-1 の「フェーズ3で決めたもの」へ移す。

---

## 3-0. 先に済ませる、既存パッケージへの変更

APIの実装に入る前に、下の層に足りないものを足す。**ここを先にやらないと server 側で辻褄合わせが始まる。**

### `@alt/dsl` — `rowFilter`（決定C）

```typescript
export interface RowFilter {
  /** 書き込みを許す行の条件。`source: 'root'` はバインド先テーブルを指す。 */
  write: Pred
}

export interface BindingDef {
  table: string
  role: BindingRole
  purpose: string
  rowFilter?: RowFilter          // ← 追加
}

export function bind(table, role, purpose, opts: { rowFilter?: RowFilter } = {}): BindingDef
```

`bindingDefSchema` にも足す。`@alt/definitions` 側で `deal` と `activity` に付ける:

```typescript
bind(deal, 'primary', '営業の主対象。ヨミ管理と予測の元データ', {
  rowFilter: {
    write: {
      type: 'compare', op: 'eq',
      left: { type: 'field', source: ROOT_SOURCE, path: ['ownerEmployeeId'] },
      right: { type: 'context', name: 'currentUser.id' },
    },
  },
})
```

`alt validate` の参照整合層に **`rowFilter` も `compilePred` に通す**検査を足す（出口条件と同じ扱い。
ルートは `binding.table` であって `flow.target` ではない点に注意）。

### `@alt/sql` — 3つ

1. **`_flow_state` に `unmet_checks TEXT` を足す**（決定D）
2. **`schemaStatements(bundle)` を `@alt/cli/apply.ts` から移す** — server のテストがスキーマを
   作るのに CLI へ依存するのはおかしい。DDL の組み立ては純粋に SQL 層の仕事
3. **`query.ts` を新設** — 有効期間型の読み書き SQL の組み立て。方言（クォート・
   プレースホルダ・boolean のバインド）に触るものは全部この層に置く

```typescript
// query.ts が持つもの（すべて { sql, params } を返す）
selectRecords(opts)      // 一覧・詳細。出口条件と rowFilter の式を SELECT 句に埋める（3-4）
insertRecord(opts)       // 有効期間型の INSERT（valid_from / changed_* 込み）
closeCurrentRow(opts)    // 現在行を閉じる UPDATE
selectFlowState(opts)    // _flow_state の現在行
insertFlowState(opts)
upsertManualCheck(opts)
selectManualChecks(opts) // record_id IN (...) でまとめて引く
```

### `@alt/cli` — 2つ

1. **`alt export --out <path>`** — server が読むファイルを書く。標準出力へのリダイレクトに
   頼らない（`pnpm run` の出力が混ざる事故を避ける）
2. **`alt seed [--db <path>] [--reset] [--json]`**（決定F）

### 配線（`pnpm check:wiring` が落とすので忘れても止まる）

- `docker-compose.yml`: 匿名ボリューム `/app/packages/server/node_modules`、**ポート公開 `"3100:3000"`**
- `packages/server/tsconfig.json` の `paths`（`@alt/dsl` / `@alt/sql`、テスト用に `@alt/definitions`）
- ルート `vite.config.ts` の `resolve.alias` に `@alt/server`
- ルート `package.json` に `"serve": "tsx --tsconfig packages/server/tsconfig.json packages/server/src/main.ts"`

compose の `command` は `tail -f /dev/null` のままにする。サーバは
`docker compose exec dev pnpm serve` で起動する（常駐させると落ちたことに気づけない）。

---

## 3-1. 定義レジストリ

`DefinitionBundle`（JSON）を受け取り、リクエスト処理から引ける形にする。**名前は
`DefinitionRegistry`**（`@alt/dsl` の `Registry` はテーブルの集合なので衝突する）。

```typescript
export interface DefinitionRegistry {
  /** compilePred に渡すテーブル集合。 */
  tables: Registry
  table(name: string): TableDef | undefined
  flow(key: string): FlowDef | undefined
  step(flowKey: string, stepKey: string): StepDef | undefined
  /** そのテーブルを使っているフローと、導出された access・バインディング。 */
  usage(table: string): TableUsage2[]
  /** そのテーブルを target にしているフロー。 */
  targetedBy(table: string): FlowDef[]
  /** 生えるルートの一覧（デバッグと起動ログ用）。 */
  routes(): Route[]
}

export function loadRegistry(bundle: unknown): DefinitionRegistry  // 検証込み。壊れていれば throw
```

`usage` は `usedTables(flow)`（`@alt/dsl`、reads/writes からの導出）と `flow.bindings` を
突き合わせて作る。**どのフローの usage にも出てこないテーブルはルートを生やさない** —
これが §3-2「バインドされていないテーブルは使えない」の技術的な強制点（決定4）。

---

## 3-2. REST API

| メソッド | パス | 生える条件 |
|---|---|---|
| `GET` | `/api/{table}` | どれかのフローで使われている |
| `GET` | `/api/{table}/{id}` | 同上 |
| `POST` | `/api/{table}` | access が `write` / `readwrite` |
| `PATCH` | `/api/{table}/{id}` | 同上 |
| `POST` | `/api/{table}/{id}/advance` | そのテーブルが target のフローがある |
| `PUT` | `/api/{table}/{id}/checks/{key}` | 同上 |
| `GET` | `/health` | 常時（起動確認用） |

**`flow` は全エンドポイント共通のクエリパラメータ**。省略時、そのテーブルを使うフローが
1本ならそれを使い、複数あれば 400（どれかを明示させる）。書き込みの文脈（`changed_flow`）にもなる。

- 未バインドのテーブル → **404**（ルートが存在しない、が答え）
- バインドはあるが権限が無い → **403**

### レスポンスの形

```jsonc
// GET /api/deal?flow=sales&as_of=2026-07-31T23:59:59.999Z
{
  "table": "deal",
  "flow": "sales",
  "asOf": "2026-07-31T23:59:59.999Z",   // 省略時は null
  "records": [ /* ↓ */ ]
}
```

```jsonc
{
  "id": "…",
  "title": "山田食堂 求人広告",
  "companyId": "…",
  "initialBilling": 180000,
  // 有効期間型のメタ。定義の列と混ざらないよう _ 始まりに寄せる
  "_version": {
    "validFrom": "2026-07-02T04:00:00.000Z", "validTo": null,
    "changedBy": "…", "changedFlow": "sales", "changedStep": "qualified"
  },
  // target テーブルのときだけ付く
  "_flow": {
    "flow": "sales", "step": "qualified", "stepName": "ヒアリング",
    "enteredAt": "2026-07-02T04:00:00.000Z",
    "exit": [
      { "key": "problem_identified", "label": "課題を確認した", "kind": "manual",
        "satisfied": true, "checkedBy": "…", "checkedAt": "…" },
      { "key": "budget_confirmed", "label": "予算感を確認した", "kind": "auto", "satisfied": false }
    ],
    "unsatisfied": 1,
    "next": [{ "key": "proposed", "name": "提案" }, { "key": "suspended", "name": "保留" }]
  },
  "_permissions": { "update": true, "advance": true }
}
```

- 詳細（`GET /api/{table}/{id}`）は `records` の代わりに `record` を1つ返す
- 型の対応: `boolean` は 0/1 ↔ true/false、`json` は TEXT ↔ パース済みの値、
  それ以外（`uuid` / `text` / `date` / `datetime` / `yearMonth` / `enum`）は文字列のまま
- **JSON のキーは定義のフィールド名（camelCase）**。列名（snake_case）は外に出さない。
  FE が `import type` する定義と一致させるため（決定1の帰結）

### エラー

```jsonc
{ "error": { "code": "forbidden", "message": "…", "hint": "…" } }
```

`code` は kebab-case の識別子。CLI の `ValidationError` と同じ方針で、**何を直せばいいかを
`hint` に書く**（FE を書くのも AI なので、読んで直せる形にする）。

| 状況 | HTTP |
|---|---|
| 未知のテーブル・レコード・ルート | 404 |
| `X-Dev-User` が無い・従業員が居ない | 401 |
| フロー参加・ステップ操作・行レベルで拒否 | 403 |
| 入力（未知フィールド・型違い・enum 外・遷移先が不正） | 400 |
| 更新の競合（現在行が既に閉じられていた） | 409 |

---

## 3-3. 有効期間型の書き込み

**避けて通れない部分。** 更新は `UPDATE` ではなく:

```
BEGIN
  1. SELECT … WHERE id = ? AND valid_to IS NULL     → 無ければ 404
  2. UPDATE … SET valid_to = :now WHERE id = ? AND valid_to IS NULL
       changes !== 1 なら 409（他のリクエストが先に閉じた）
  3. INSERT … (1 の値 + 差分, valid_from = :now, changed_by/flow/step)
COMMIT
```

- `:now` は**リクエストにつき1つ**を使い回す（`new Date().toISOString()`）。
  閉じた時刻と開いた時刻が一致し、`valid_from <= t < valid_to` の半開区間で穴も重なりも出ない
- `changed_by` = 認証したユーザーの `employee.id`、`changed_flow` = クエリの `flow`、
  **`changed_step` は `_flow_state` から引いた現在ステップ**（クライアントに言わせない）
- 作成（POST）は id をサーバで採番（`crypto.randomUUID()`）し、`valid_from = :now` で1行 INSERT。
  **target テーブルなら同じトランザクションで `_flow_state` の初期行も作る**
  （`step = flow.initial`、`changed_step = null`、`unmet_checks = null`）
- ⚠ 同一ミリ秒内に2回更新すると長さ0のバージョンができる。現在行のユニーク索引が守るのは
  「現在行が1つ」だけなので、これは通る。プロトタイプでは許容する（実装コメントに残す）

---

## 3-4. 出口条件の評価

**一覧で数百件をまとめて評価する。レコードごとにコードを実行しない**（`condition-ast.md` §5-1）。

`compilePred` が返す式を SELECT 句に埋め、`_flow_state` を LEFT JOIN する。1クエリで
「行の値 + 現在ステップ + 全自動判定の結果 + 書き込み可否」が揃う。

```sql
SELECT r."id", r."title", …, r."valid_from", r."valid_to", r."changed_by", …,
       fs."step" AS "_step", fs."valid_from" AS "_step_since",
       (<rowFilter.write の式>)        AS "_can_write",
       (<check[0] の式>)               AS "_c0",
       EXISTS(<check[1] の式>)         AS "_c1"
FROM "deal" r
LEFT JOIN "_flow_state" fs
  ON fs."table_name" = ? AND fs."record_id" = r."id" AND fs."flow" = ?
 AND fs."valid_to" IS NULL
WHERE r."valid_to" IS NULL
ORDER BY r."valid_from" DESC
LIMIT ?
```

- **フローの全ステップの自動判定をまとめて評価する**。レコードごとに現在ステップが違うので、
  ステップ別にクエリを分けると N 本になる。営業フローは自動判定5件なので1行あたり5式で足りる。
  レスポンスを組むときに現在ステップの分だけ取り出す
- 式の別名は `_c{通し番号}`（キーをそのまま識別子にしない）。番号 → `(step, key)` の対応は
  クエリを組んだ側が持つ
- **`satisfied` は `=== 1` で判定する**。SQLite の比較は NULL を伝播するので
  （`initial_billing` が NULL なら `> 0` は 0 ではなく NULL）、falsy 判定だと取りこぼす
- 手動チェックは `_manual_check` から**別クエリでまとめて引く**
  （`WHERE table_name = ? AND flow = ? AND record_id IN (…)`）。合計2クエリ、N+1 は起きない
- `as_of` を指定したら、ルートの `valid_to IS NULL` と `_flow_state` の結合条件を
  半開区間の条件に置き換え、`compilePred` にも `asOf` を渡す。
  **`_manual_check` は有効期間型ではないので as_of の影響を受けない**（現在の状態が出る）

---

## 3-5. ステップ遷移

```jsonc
// POST /api/deal/{id}/advance?flow=sales
{ "to": "proposed" }
```

処理順:

1. `_flow_state` の現在行を引く（無ければ 409。作成時に必ず作るので通常起きない）
2. **遷移先の検証** — `to` が現在ステップの `next` にあること。**無ければ 400、ただし
   ロールが `admin` なら任意のステップへ通す**（§3-5 の強制遷移）
3. **ステップ操作の認可** — ユーザーのロール == 現在ステップの `role`（admin はバイパス）
4. **行レベルの認可** — `rowFilter.write` を満たすこと（advance は書き込み扱い）
5. **出口条件を評価**して未充足のキーを集める。**未充足でも止めない**（§4-3 確定事項）
6. トランザクションで `_flow_state` の現在行を閉じ、新しい行を INSERT
   （`step = to`、`changed_step = 現在ステップ`、`unmet_checks = JSON.stringify(未充足キー)`）
7. 更新後のレコード（`_flow` 込み）と `"unmet": ["decision_maker_met"]` を返す

**業務テーブルには書かない。** 決着ステップ（`won` / `lost`）へ進めても `deal.status` は
触らない（決定H）。二重管理は §8-2 論点9 として開いたままにする。

### 手動チェック

```jsonc
// PUT /api/deal/{id}/checks/problem_identified?flow=sales
{ "checked": true }
```

- ステップは**サーバが現在ステップから決める**。`_manual_check` のキーは
  `(table, record, flow, step, check_key)` なので、差し戻してもそのステップのチェックは残る
  （§3-5「差し戻し時のチェック状態は保持する」）。誤認で戻した場合は `checked: false` で個別に外せる
- そのステップの `manualCheck` に無いキーなら 400（自動判定のキーを手で立てさせない）
- 認可は更新と同じ（担当者＋管理者）。`checked_by` / `checked_at` を記録する

---

## 3-6. 認可と開発用ユーザー詐称

### 3層

| 層 | 判定 | 拒否 |
|---|---|---|
| **フロー参加** | ユーザーのロールが、そのフローのどれかのステップの `role` である | 403 |
| **テーブルアクセス** | 導出された access（`usedTables`）が操作を許す。**`write` は読みも含む**（`flow.ts` の規約） | 403 |
| **ステップ操作** | advance / 手動チェックは、現在ステップの `role` と一致 | 403 |
| **行レベル** | 読みは全員。書きは `rowFilter.write` を満たす行のみ | 403 |

- `employee.role === 'admin'` は全部バイパスする
- `rowFilter` の無いバインディング（`company` / `contact` / `employee`）は行レベルの制限なし
- **`_permissions` は SQL が返した `_can_write` から組み立てる**。FE に認可ロジックを複製しない（§4-1）
  - `update`: テーブルの access が書き込み可 **かつ** `_can_write` **かつ** `as_of` 指定なし
    （過去のバージョンには書けない）
  - `advance`: `update` かつ 現在ステップの `role` と一致（target テーブルのときだけ出る）

### 認証（詐称）

```
X-Dev-User: yamada@example.com     → employee を email で引く。無ければ 401
```

- `createApp({ registry, db, authenticate })` の `authenticate` を差し替え点にする。
  **`app.ts` は `auth/dev-user.ts` を import しない**（注入するのは `main.ts` だけ）。
  これが OIDC に置き換わる境界（§4-1「認証と認可の境界」）
- 本番エントリを作るときは `auth/dev-user.ts` を import しなければコードごと落ちる
  （バンドラはエントリからの到達可能性で削る。※ 2026-08-17 に `packages/*` のバンドルを
  やめたので、現状この保証を与えているのは「import しない」こと自体だけ）

---

## 3-7. 開発用シードデータ（`alt seed`）

完了条件の検証にデータが要る。`company` / `contact` / `employee` は reference バインドなので
**API からは作れない**（§8-2 論点7 の帰結）。CLI から直接入れる。

- **ID は固定**（`e-yamada` のような読める文字列）。ランダムだとデモもテストも再現しない
- `--reset` で管理テーブルの**データだけ**消してから入れる（スキーマは触らない）
- 中身: employee 4（`sales_rep` 2・`sales_manager` 1・`admin` 1）、company 3、contact 4、
  deal 5（`contacted` / `qualified` / `proposed` / `won` に散らす）、activity 6。
  deal には `_flow_state` の行も作る。手動チェックを1件だけ立てておく
- 書き込みは `@alt/sql` の `insertRecord` を通す（有効期間型の列を server と同じ形で埋める）

---

## テスト

| 対象 | 見るもの |
|---|---|
| `registry.test.ts` | 未バインドのテーブルにルートが生えない。access の導出がバインディングと一致する |
| `record-input.test.ts` | 未知フィールド・型違い・enum 外・必須欠けを弾く。id と有効期間型の列は受け付けない |
| `records.test.ts` | **PATCH で前の行が閉じて新しい行が積まれる**。`as_of` で前のバージョンが読める。競合で 409 |
| `exit-checks.test.ts` | 自動判定が SQL 1本で全件評価される。NULL が false になる。手動チェックが混ざる |
| `flow-state.test.ts` | `next` に無い遷移が 400。admin は通る。未充足でも進めて `unmet_checks` に残る |
| `authz.test.ts` | 担当者でないユーザーの更新が 403。読みは通る。admin は全部通る。`_permissions` が一致する |
| `app.test.ts` | ルーティングと HTTP ステータス。`X-Dev-User` 無しが 401 |

- DB は in-memory SQLite（`new Database(':memory:')` + `schemaStatements`）
- 定義は `@alt/definitions` を **devDependency として**使う（実行時は JSON 経由なので依存しない）。
  営業フローそのもので検証したいのと、汎用性の検査には `registry.test.ts` の小さな手書き定義を使う

---

## 作らないもの（このフェーズで手を広げない）

| | 理由 |
|---|---|
| `DELETE /api/{table}/{id}` | 有効期間型の「削除」（論理削除か valid_to だけ閉じるか）を決める必要があり、プロトタイプの検証には要らない |
| 一覧の絞り込み・ソート・ページング | 決定J |
| 外部キーの実在検査 | 決定K |
| CORS / レート制限 / ログ基盤 | 決定I。プロトタイプに要らない |
| `_permissions` の列レベル | v1 では持たない（§8-1 確定） |
| 監査用のエンドポイント（履歴一覧） | `as_of` で足りる。履歴の一覧表示はフェーズ4で必要になったら |

---

## 完了条件

すべて実装・検証済み（2026-08-06）。テストは `pnpm verify` で 221 件（うちサーバ 84 件）。

- [x] 案件の一覧・詳細が取得でき、各レコードに**現在ステップ・出口条件の充足状況・`_permissions`** が乗る
- [x] 案件を更新すると有効期間型で新しいバージョンが積まれ、**前のバージョンが `as_of` で読める**
- [x] ステップを進められ、`_flow_state` に履歴が残る（未充足で進めた記録も）
- [x] 担当者でないユーザーでは更新が拒否される（403）
- [x] **未バインドのテーブルには API が生えない**（決定4 の技術的強制）

### 実装して分かったこと

| | 内容 |
|---|---|
| **仕様の穴を2件見つけた** | ①ステップを担当しないロール（`sales_manager`）は導出だとフローに参加できず、案件を1件も読めない ②プラットフォームが客先定義の名前（`employee` テーブル・`admin` ロール）を直に知っている。どちらも `product-concept.md` §8-2（論点12・13）に記録し、**挙動は `authz.test.ts` に固定**した |
| 出口条件の NULL | SQLite の比較は NULL を伝播する（`initial_billing` が NULL なら `> 0` は 0 ではなく **NULL**）。充足判定は `=== 1` でないと取りこぼす |
| 認可の順序 | 出口条件の評価は**認可のあと**。先に評価すると、権限の無いユーザーに他人の案件の状況が漏れる |
| クエリ本数 | 一覧は「認証1本 + レコード（現在ステップ・全自動判定・rowFilter 込み）1本 + 手動チェック1本」の**3本で固定**。件数に比例しないことをテストで固定した |
| コンテナ作り直しの罠 | ポート追加で `docker compose up -d` すると匿名ボリュームだけ新しくなり、pnpm が「Already up to date」と言って再リンクしない → `ERR_MODULE_NOT_FOUND`。対処は README に書いた |

検証手順:

```sh
docker compose exec dev pnpm verify
docker compose exec dev pnpm alt apply --recreate
docker compose exec dev pnpm alt export --out data/definitions.json
docker compose exec dev pnpm alt seed --reset
docker compose exec -d dev pnpm serve          # ホストからは localhost:3100

curl -H 'X-Dev-User: yamada@example.com' 'localhost:3100/api/deal?flow=sales'
# 他人の案件は更新できない → 403
curl -X PATCH -H 'X-Dev-User: sato@example.com' -H 'Content-Type: application/json' \
     -d '{"initialBilling":240000}' 'localhost:3100/api/deal/d-yamada-jobad?flow=sales'
# 更新前のバージョンが読める
curl -H 'X-Dev-User: yamada@example.com' \
     'localhost:3100/api/deal/d-yamada-jobad?flow=sales&as_of=2026-07-05T00:00:00.000Z'
# 未充足でも進める（unmet に残る）
curl -X POST -H 'X-Dev-User: sato@example.com' -H 'Content-Type: application/json' \
     -d '{"to":"proposed"}' 'localhost:3100/api/deal/d-marumi-jobad/advance?flow=sales'
```

---

## 次

フェーズ4（FE + 動作確認）→ [phase-4-frontend.md](phase-4-frontend.md)
