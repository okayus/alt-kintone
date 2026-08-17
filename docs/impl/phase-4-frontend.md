# フェーズ4: FE + 動作確認

ハブ: [../implementation.md](../implementation.md)

**目的**: ブラウザで営業フローを操作できるようにする。ここまで来れば構想の検証ができる。

---

## 0. 全体像

フェーズ3で API は動いている。足りないのは画面だけ。

```
apps/main（新設）                        packages/server（済）
┌───────────────────────────┐          ┌──────────────────┐
│ shell/  ナビ・レイアウト   │          │ /api/deal        │
│         APIクライアント    │─ proxy ─▶│ /api/deal/{id}   │
│         開発用ユーザー切替 │  /api    │   …/advance      │
│                           │          │   …/checks/{key} │
│ flows/sales/              │          │ /api/company     │
│         案件一覧          │          │ /api/contact     │
│         案件詳細          │          │ /api/activity    │
│           現在地表示      │          │ /api/employee    │
│           出口条件リスト  │          └──────────────────┘
│           遷移ボタン      │                    ▲
│           編集フォーム    │                    │ definitions.json
└───────────────────────────┘          packages/definitions（済）
        │                                        ▲
        └────── import { sales } ─────────────────┘
                （ステップ名・順序を定義から取る）
```

**このフェーズで新しく作るのは `apps/main` だけ。** 既存パッケージへの変更は 4-0 の配線まわりに限る。

`_flow`（現在ステップ・出口条件・遷移先）も `_permissions`（編集可否）も
API がレコードごとに返しているので、FE は**判定をせず表示するだけ**でよい。

---

## 決めたこと（詳細化で決めた設計判断）

| # | 決定 | 理由 |
|---|---|---|
| A | **React + Vite**（`vite`）。ルータ・状態管理・CSS フレームワークは入れない | ルータは2画面ぶんなので30行のハッシュルータで足りる。`node:http` / `parseArgs` を選んだのと同じ判断（依存を増やさない）。ただし**React 自体は入れる** — FE は Go 版が来ても捨てないので、バックエンドの「TS版は仕様だから素朴に書く」は当てはまらない |
| B | **ステップ名と順序は `@alt/definitions` から値として import する**（型だけでなく値） | ステップ列（`●──●──○──○`）を描くにはフローの全ステップが要るが、API の `_flow` は現在ステップと next しか返さない。定義を直接読めば乖離しようがない。§4-4 は「定義はFEに対しては初期生成の入力」と言うが、**現在地表示については定義が正のままにできる** |
| C | **enum の表示ラベルは FE に手書きする**（`flows/sales/labels.ts`） | ラベルは定義に無い（`domain-model.md` §5-0 の表にしかない）。B とは逆に、ここは定義と FE が二重管理になる。**構造的な穴**なので §8-2 に論点として追加した |
| D | **API レスポンスの型は FE に手書きする**（`shell/types.ts`） | `table()` は `FieldDef` を型消去するので、`typeof deal` から `{ title: string, … }` を導けない。§5-6 の「FEが定義の型を import すれば乖離もコンパイルエラーで落ちる」が**現状の DSL では成立していない**。§8-2 に追加した |
| E | **現在地の描画は「進行（`next` 非空）」と「決着（`next` 空）」の2レーン。順序は定義の宣言順** | 表示順やレーンの情報は定義に無い。恣意的な推測（最長経路など）を入れず、機械的に決まる規則だけ使う。営業フローでは `接触 → ヒアリング → 提案 → 保留` ／ 決着 `受注 / 失注 / 消滅` になる |
| F | **開発用ユーザー切替は `shell/auth/dev-user.ts` に閉じ、`main.tsx`（devエントリ）だけが import する** | サーバ側の `X-Dev-User` と同じ形（決定8「本番ビルドにコードごと含めない」）。API クライアントは認証を注入で受ける |
| G | **`window.confirm` を使わない**（未充足のまま進めるときの確認はインライン表示） | ブラウザのモーダルは自動操作を止める。動作確認をブラウザ自動化でやる可能性を潰さない |
| H | **`as_of`（時点指定）を一覧・詳細に付ける** | 完了条件には無いが、有効期間型が効いていることが画面で見える。入力欄1つで済む。過去を見ると `_permissions.update` が false になるので、認可と履歴が同時に確認できる |
| I | **編集フォームは定義から生成せず、案件のフォームとして手で書く** | §4-3「一覧やフォームを共通部品に寄せない」。汎用のフィールドレンダラを書くと、それが表現力の上限になる（kintone の失敗構造） |

---

## 4-0. 先に済ませる、既存への変更

### `scripts/check-wiring.mjs` — `apps/*` に対応させる

いまの規則「ルート `vite.config.ts` に**全 workspace パッケージ**の alias」は
`apps/*` に当てはまらない。アプリは誰からも import されないので自分の alias は要らず、
代わりに**自分の `vite.config.ts`** で依存を解決する必要がある（dev サーバーも vitest も
最寄りの設定を読むため）。

規則をこう分ける:

| 対象 | 要るもの |
|---|---|
| 匿名ボリューム / tsconfig の `paths` | 全 workspace パッケージ（`apps/*` 含む）※ 現状のコードで自動的に効く |
| ルート `vite.config.ts` の alias | **`packages/*` のみ**（`apps/*` は対象外にする） |
| **（新規）** 自前の `vite.config.ts` を持つパッケージ | その中に**自分の workspace 依存**の alias |

新規ぶんが無いと、`apps/main` のテストと dev サーバーが `dist/` の古い成果物を読む
——このスクリプトが塞いでいるのとまったく同じ壊れ方をする。

### `docker-compose.yml`

- 匿名ボリュームに `/app/apps/main/node_modules`（`check:wiring` が落とすので忘れても止まる）
- `command` のコメントを更新（API と FE を別々に `exec -d` で上げる旨）

### ルート `package.json`

```jsonc
"dev": "pnpm --filter @alt/main dev"
```

### ポートの確認

`5273:5173` は compose に入っているが、ホスト側が空いているかを着手時に確認する。

```sh
ss -ltn | grep -E ':(3100|5273)'
docker ps --format '{{.Names}}\t{{.Ports}}'
```

### ⚠ 最初に潰しておくリスク

`@alt/definitions` のソースは NodeNext なので相対 import に `.js` が付いている
（`./flows/sales.js` → 実体は `.ts`）。**Vite がこれを解決できるかを、画面を書く前に確認する。**
できなければ決定B が崩れ、ステップ名を FE に手書きすることになる（決定C と同じ穴が増える）。

確認は「`main.tsx` で `import { sales } from '@alt/definitions'` して
`console.log(sales.steps.length)` が出るか」で足りる。

---

## 4-1. 共通シェル（`apps/main/src/shell/`）

**共通化するのはシェルだけ**（§4-3）。一覧・フォームは業務画面側に書く。

```
apps/main/
  index.html
  package.json
  tsconfig.json
  vite.config.ts          ← alias（@alt/dsl, @alt/definitions）+ /api の proxy + host: true
  src/
    main.tsx              ← dev エントリ。dev-user を import するのはここだけ
    shell/
      App.tsx             ← レイアウト（ヘッダ / ナビ / main）+ ルート分岐
      router.ts           ← ハッシュルータ（#/ と #/deals/:id の2本）
      api.ts              ← APIクライアント。認証は注入で受ける
      auth/dev-user.ts    ← 開発用ユーザー詐称（本番エントリからは import しない）
      types.ts            ← API レスポンスの形（決定D により手書き）
      format.ts           ← 金額・日時の整形（ドメイン非依存のものだけ）
      app.css
    flows/
      sales/              ← 業務フロー単位のディレクトリ規約（§4-4 #2）
        …（4-2）
```

### `api.ts`

```ts
export interface AuthHeaders { (): Record<string, string> }

export function createClient(auth: AuthHeaders) {
  // すべて ?flow=sales を付ける。flow は全エンドポイント共通のクエリパラメータ
  list<T>(table, opts?: { asOf?: string }): Promise<T[]>
  get<T>(table, id, opts?): Promise<T>
  patch<T>(table, id, body): Promise<T>
  advance(table, id, to): Promise<{ record: Deal; unmet: string[] }>
  setCheck(table, id, key, checked): Promise<Deal>
}
```

- エラーは `{ error: { code, message, hint } }` を `ApiError` にして throw する。
  **`hint` を画面に出す** — サーバは「どう直すか」を返す設計になっているので、
  それを捨てるとフェーズ3の投資が無駄になる
- `flow=sales` は固定でよい（フローが1本しかない。増えたら引数にする）

### `router.ts`

`hashchange` を購読して `#/` / `#/deals/:id` を返すだけ。ライブラリは使わない。

### レイアウト

```
┌────────────────────────────────────────────────────────────┐
│ alt-kintone   営業（新規開拓）        [👤 山田 太郎 ▾] 開発用 │
├────────────────────────────────────────────────────────────┤
│ 案件                                                        │
├────────────────────────────────────────────────────────────┤
│ （ここに画面）                                              │
└────────────────────────────────────────────────────────────┘
```

- ナビは「案件」1つだけ。増えたら足す
- エラーはヘッダ直下に帯で出す（`code` / `message` / `hint`）

---

## 4-2. 業務フローの画面（`apps/main/src/flows/sales/`）

```
DealList.tsx        案件一覧
DealDetail.tsx      案件詳細（下の4つを組む）
  StepTrack.tsx       現在地表示
  ExitChecklist.tsx   出口条件チェックリスト
  AdvanceButtons.tsx  遷移ボタン
  DealForm.tsx        編集フォーム
steps.ts            進行/決着の分類（純関数・テスト対象）
labels.ts           enum の表示ラベル（決定C。定義に無いので手書き）
```

### 案件一覧（`#/`）

| 列 | 中身 |
|---|---|
| 案件名 | `title`（詳細へのリンク） |
| 顧客 | `companyId` → company 一覧から名前を引く |
| 商材 | `productType`（ラベル） |
| 自社収益 | `initialProfit` / `monthlyProfit`（月額は「/月」） |
| 現在ステップ | `_flow.stepName` をバッジで |
| 未確認 | `_flow.unsatisfied` 件（0なら出さない） |
| 担当 | `ownerEmployeeId` → employee 一覧から名前を引く |

- 上に**時点指定**（`as_of`）の入力を1つ置く（決定H）
- 名前の解決のため、company / employee を起動時に1回ずつ引いて Map にする。
  API に JOIN 展開は無い（作らないもの）ので FE で引き当てる

### 案件詳細（`#/deals/:id`）

```
【案件】ヘアサロン葵 MEO運用            ヘアサロン葵 / MEO / 新規

進行   ●━━━━━●━━━━━◉━━━━━○        決着   ○ 受注   ○ 失注   ○ 消滅
       接触   ヒアリング 提案   保留
                     ↑いまここ（2026-07-01 から）

次に進むための確認
  ☑ 金額を提示した              自動
  ☑ 決裁者に会えている          自動
  ☐ 導入時期を確認した          自動 ← 未充足

  [受注へ進める] [ヒアリングへ戻す] [失注へ進める] [消滅へ進める]   ※未確認 1件あり

──────────────────────────────────────────
案件の内容                                        [編集]
  …（DealForm）

活動  （読むだけ）
  2026-07-05  オンライン商談  MEO提案  → 前進

最終更新  2026-07-01 09:00  山田 太郎（提案 で変更）
```

**`StepTrack`**（決定E）
- 進行レーン = `sales.steps.filter(s => s.next.length > 0)`、決着レーン = 残り。順序は宣言順
- 現在ステップは `_flow.step` と突き合わせる。通過済みかどうかは**判定しない**
  （非線形なので「左は通過済み」は嘘になる。現在地だけを塗る）
- `_flow.enteredAt` を「〜から」で添える

**`ExitChecklist`**
- `_flow.exit` をそのまま並べる。`kind` で「自動」バッジを出す
- 自動判定は**操作できない**（表示のみ）。手動チェックは押せる。
  `_permissions.advance` が false なら disabled
- `_flow.enteredUnmet` が空でなければ「未確認 N 件のまま このステップに進んだ」を出す
  ——「未充足でも進めるが記録に残る」が画面で見える場所（完了条件5）

**`AdvanceButtons`**
- `_flow.next` ぶんのボタン。`_permissions.advance` が false なら出さない
- 未充足があるときは押した直後に**インラインで確認**を出す（決定G。`confirm()` を使わない）

**`DealForm`**
- `_permissions.update` が true のときだけ「編集」を出す
- 対象フィールド: `title` / `productType` / `dealType` / `initialBilling` / `initialProfit` /
  `monthlyBilling` / `monthlyProfit` / `contractMonths` / `expectedCloseMonth` / `confidence` /
  `status` / `closedAt` / `outcomeReasonCategory` / `outcomeReasonDetail` / `competitor` / `note`
- **`companyId` / `ownerEmployeeId` は編集しない**（参照の付け替えは完了条件に効かない）
- 空欄は `null` で送る。`required` のものは空にできない（クライアント側でも止める）
- **変更のあったフィールドだけ PATCH する**

**活動**は読むだけ。`GET /api/activity` を全件引いて `dealId` で絞る
（一覧の絞り込みは API に無い。件数が少ないので FE で足りる）。

---

## 4-3. 開発用ユーザー切り替え

ヘッダのプルダウンで `X-Dev-User` を切り替える（決定F）。選択は `localStorage` に持つ。

候補は `alt seed` が入れる4人を**べた書き**する。employee を API から引こうとすると
「ユーザーを決めるためにユーザーが要る」になるため。`alt seed` の固定 ID と同じ、
**開発用の裏口**であることをコードに明記する。

| email | 役 | 画面で確認できること |
|---|---|---|
| `yamada@example.com` | 営業担当 | 自分の案件は編集でき、佐藤の案件は編集ボタンが出ない（完了条件6） |
| `sato@example.com` | 営業担当 | 逆側 |
| `suzuki@example.com` | 営業マネージャー | **403 になる**（§8-2 論点12。「操作しないが見る」立場が導出で表現できていない）。エラー帯で見える形にする |
| `admin@example.com` | 管理者 | 全案件を編集でき、`next` に無い遷移もできる |

---

## 4-4. 起動と動作確認

```sh
docker compose exec dev pnpm alt apply --recreate
docker compose exec dev pnpm alt export --out data/definitions.json
docker compose exec dev pnpm alt seed --reset
docker compose exec -d dev pnpm serve        # API   → localhost:3100
docker compose exec -d dev pnpm dev          # FE    → localhost:5273
```

Vite は `host: true` で待ち受ける（既定の localhost だとホストからポートマッピング越しに届かない）。
`/api` は同じコンテナ内の `http://localhost:3000` に proxy する（CORS は作らない）。

### 完了条件3の手順（自動判定がデータで変わる）

1. `yamada@example.com` で「ヘアサロン葵 MEO運用」（提案）を開く
2. 出口条件が3件とも ☑ になっている
3. 編集で**見込み受注月を空にして保存** → 「導入時期を確認した」が ☐ に変わる
4. 戻すと ☑ に戻る

営業が何もチェックしていないのに条件が充足/未充足に変わる、が構想の中核。

---

## テスト

vitest は純関数だけを対象にする。**レンダリングのテストは書かない**
（`@testing-library/react` + jsdom を入れる価値が、ブラウザで見る完了条件に対して薄い）。

| 対象 | 見るもの |
|---|---|
| `flows/sales/steps.ts` | 進行/決着の分類が営業フロー定義に対して期待どおり |
| `shell/router.ts` | ハッシュ → ルートの変換 |
| `shell/api.ts` | URL 組み立て（`flow` / `as_of` が付く）とエラー本文の解釈 |
| `shell/format.ts` | 金額・日時の整形 |

---

## 作らないもの（このフェーズで手を広げない）

| | 理由 |
|---|---|
| 案件の新規作成 | 完了条件に無い。POST は API 側でテスト済み |
| 活動の作成・編集 | 同上。読めれば出口条件の根拠は追える |
| マスタ（company / contact / employee）の編集画面 | そもそも API が生えていない（§8-2 論点7） |
| 一覧の検索・絞り込み・ソート・ページング | API に無い（フェーズ3の「作らないもの」） |
| 管理画面FE、横断ダッシュボード | 最小スコープの外 |
| `.alt-generated.json`（生成時点の記録） | 手で書くので基準点にする定義バージョンが無い |
| 汎用のフィールドレンダラ / フォームビルダー | 決定I |
| レスポンシブ（スマホ向けの作り込み） | PC中心（§4-3）。画面が壊れない程度に留める |

---

## 完了条件

ブラウザで以下ができる。

1. 案件一覧が見える（現在ステップつき）
2. 案件詳細で、現在地と出口条件のチェックリストが見える
3. 自動判定の出口条件が、データを直すと勝手に充足に変わる
4. 手動チェックを付け外しできる
5. ステップを進められる。未充足でも進めるが記録が残る
6. 担当者でない案件は編集ボタンが出ない

3 が確認できれば、**「営業の入力負担を減らす」という構想の中核が実際に働いている**ことになる。

あわせて `docker compose exec dev pnpm verify` が通ること。

---

## 実装して分かったこと

| | |
|---|---|
| **定義を値として import するのは通った** | `@alt/definitions` のソースは NodeNext（相対 import に `.js`）だが、Vite は importer が TS なら `.js` → `.ts` を解決する。4-0 で潰しておいたリスクは空振りで、決定B はそのまま成立した |
| **`vite.config.ts` は「最寄りが読まれる」** | `apps/main` が自前の設定を持つと、ルートの `resolve.alias` は効かない。`check:wiring` の規則3を「そのパッケージのテスト／dev サーバーが読む vite.config に依存の alias」に読み替えて拡張した（**「4箇所」は増やしていない**）。壊れ方は既存と同じ「`dist/` の古い成果物を読む」 |
| **定義が持つものと持たないものの差が画面に出た** | ステップ名・ロール名・enum の**候補**は定義から取れるが、enum の**ラベル**は取れない。同じ画面の中に「定義から来る文字列」と「FEに手書きした文字列」が並ぶ。§8-2 論点14 はこの形で見える |
| **論点12（マネージャーがフローに参加できない）は画面だと目立つ** | ロールを鈴木に切り替えると一覧が丸ごと 403 になる。API のテストでは1件の assert だったものが、画面では「マネージャーは何も見えない」という業務上あり得ない絵になる。優先度を上げる材料 |
| **論点9（決着ステップと `deal.status`）も画面で見えた** | ステップを `won` に進めても `status` は `open` のままで、ヘッダに「状態 進行中」と出る。**フォームで手で直すしかない**のが分かる形になった。画面を見てから決めるとしていた判断の材料が揃った |
| `_permissions` を返す設計は効いた | FE 側に認可の分岐が1つも無い。編集ボタンも遷移ボタンも `update` / `advance` を見るだけで、`asOf` を入れると同じ経路で読み取り専用になる |

---

## ここまで来たら

Go 版（`condition-ast.md` §9-5）の計画に進む。
`testdata/condition-eval/` の同じケースを Go で流すのが最初の一歩。
