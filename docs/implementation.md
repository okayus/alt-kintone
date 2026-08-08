# 実装ハブ

**実装セッションはこのファイルから始める。** 各フェーズの詳細は別ファイルにあり、
**いま着手するフェーズのものだけ**読めばよい。完了したフェーズと先のフェーズは読まない。

---

## いま作っているもの

alt-kintone は「業務フローを第一級の概念に置いた、AI前提の業務アプリ基盤」
（構想: [product-concept.md](product-concept.md)）。

**ブラウザで動作確認できる最小スコープは達成した**（2026-08-06、フェーズ4完了）。

> **ゴール**: 営業フロー1本が、案件一覧・詳細・出口条件チェックリスト・ステップ遷移として
> ブラウザで動くこと。 → **達成**

最小スコープなので、以下は**意図的に作っていない**。ここから手を広げるときは、
何のために広げるのかを先に決めること。

| 作らないもの | 理由 |
|---|---|
| 求人広告制作フロー / MEO運用フロー | 営業フロー1本で構想は検証できる |
| 管理画面FE | バインディングのビューは後でよい |
| `alt plan` | `apply` だけで動く |
| FEの自動生成 | 初回は手で書く。生成の検証は後 |
| 条件式ビルダー（`deal.amount.gt(0)` の型安全な書き味） | **AST を直接書けば動く**。書き味は動くものを見てから |
| 認証 | 決定済み（外部IdPに委譲、プロトタイプでは実装しない） |
| 一覧の範囲選択・コピペ・列リサイズ・列並び替え・保存済みビュー | フェーズ6で明示的に落とした（要求に無い）。「スプレッドシートライク」は操作感の要求であって表計算の再実装ではない |
| 一覧の列選択（`fields=`）・FK先の名前でのソート・未確認件数でのソート | 窓が小さいのでペイロードは問題にならない / 解決機構はあるので必要になってから |

---

## 現在地

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | [定義層](impl/phase-1-definitions.md) | **済**（2026-08-06） |
| 2 | [CLI](impl/phase-2-cli.md) | **済**（2026-08-06） |
| 3 | [バックエンド](impl/phase-3-backend.md) | **済**（2026-08-06） |
| 4 | [FE + 動作確認](impl/phase-4-frontend.md) | **済**（2026-08-06） |
| 5 | [業務フローの参照画面](impl/phase-5-flow-reference.md) | **済**（2026-08-06） |
| 6 | [一覧グリッドの読み側](impl/phase-6-list-grid.md)（仮想スクロール・フィルタ・URL状態） | **済**（2026-08-08） |
| 7 | [一覧グリッドの書き側](impl/phase-7-list-grid-edit.md)（Enter セル編集） | 未着手 ← **いまここ** |

フェーズ1〜4（**ブラウザで動作確認できる最小スコープ**）に加えて、フェーズ5で
**業務フローを営業自身が読める**ようになり（`#/flows/sales`）、フェーズ6で
**案件一覧が1万件でも実用になった**。

フェーズ6でできたこと: 仮想スクロールで全件を上下に辿れる（1万件で窓1枚 12ms）、
フィルタ・並びが URL に載って**そのまま共有できる**、時点固定（`snapshot`）で
スクロール中に行がズレない。**§8-2 論点14 は解決済み**（フェーズ5）。

次は**フェーズ7（セル編集）**（`/phase-start 7`）。フェーズ6の決定A（`snapshot` を
`as_of` と分ける）で「一覧の行が編集可のまま」という前提は揃えてある。

フェーズ7と並行または後の候補（着手順は未決定）:

- **§8-2 論点12**（優先度・高）— マネージャーがフローに参加できず、画面で一覧が丸ごと403
- **§8-2 論点9** — ステップを `won` に進めても `deal.status` は `open` のまま
- **§8-2 論点17**（フェーズ6で判明）— 一覧の性能は「条件式が何を読むか」で決まる
- **定義の版と差分**（「何が変わったか」。フェーズ5決定Iで見送った続き。§8-2 論点5 と重なる）
- **Go版バックエンドの計画**（`condition-ast.md` §9-5）

---

## すでに動いているもの

`pnpm verify` が通る状態（328 テスト）。

| パッケージ | 中身 |
|---|---|
| `@alt/dsl` | 条件式AST（型・zodスキーマ・JSON Schema、**表示用の `referencedFields`** — Go契約外。**`AST_VERSION` は 2** = `contains` 追加）、テーブル定義（**表示名 `label` 必須**・enum は `{key, label}` の配列）、**フロー定義**（`flow` / `step` / `check` / `manualCheck` / `bind`、**`intent`・`howTo` 必須**、reads・writes からの access 導出、**行レベル認可の `rowFilter`**）、**ロール定義**、**定義バンドル**（`DefinitionBundle` — バックエンドへの受け渡し形）、外部キー解決（`foreignKeysTo` / `resolveFieldPath`）、`toColumnName` |
| `@alt/sql` | AST → SQL 変換、`CREATE TABLE` 生成＋**外部キーの索引**（自動付与）、**プラットフォームテーブル**（`_flow_state` / `_manual_check`）、**有効期間型の読み書きSQL**（`query.ts` — 一覧・**窓取得（offset / 総件数 / 並び / フィルタ）**・閉じてINSERT・フロー状態・手動チェック）、方言（SQLite / PostgreSQL） |
| `@alt/definitions` | **客先の定義そのもの**。テーブル5本（deal / company / contact / employee / activity）と営業フロー1本。出口条件8件（自動5・手動3）。**表示名・ステップの意図・充足のしかたも定義が持つ**（フェーズ5） |
| `@alt/cli` | **`alt` コマンド**。`validate`（3層19ルール）/ `apply`（SQLite にスキーマ）/ `export --out`（定義をJSONで）/ `seed`（開発用データ。**`--deals N` で1万件規模のダミー**） |
| `@alt/server` | **REST API**。定義レジストリ、ルート自動生成（**未バインドは 404**）、出口条件の一括評価、有効期間型の書き込み、ステップ遷移、認可4層 + `_permissions`、`X-Dev-User` 詐称、**一覧の窓取得**（`offset` / `total` / `now` / `snapshot` / `sort` / フィルタ語彙 → 条件式AST。`list-query.ts`） |
| `@alt/main`（`apps/main`） | **エンドユーザーFE**（React + Vite）。シェル（ナビ・ルータ・APIクライアント・時点指定・開発用ユーザー切替）、**案件一覧のグリッド**（仮想スクロール・フィルタ面・並べ替え・URL 状態＝nuqs）、案件詳細（現在地・出口条件チェックリスト＋**未充足の充足のしかた**・遷移・編集フォーム）、**フロー参照画面**（`#/flows/:key` = 遷移グラフ・ステップカード・使うデータ。**APIを叩かず定義だけで描く**）。**ラベルも含め定義を値として import** |
| `testdata/condition-eval/` | 言語非依存の適合テスト7件。実SQLiteで評価される |

**営業フロー1本がブラウザで動き、フローそのものも読め、一覧が1万件でも実用になった**。
案件の一覧・詳細に現在ステップと出口条件のチェックリストが出て、**データを直すと自動判定が
勝手に充足に変わり**、未充足の条件には「どうすれば充足するか」が出る。未充足でも進めるが
記録に残り、`as_of` で過去が読め、担当者でなければ編集ボタンが出ない。**異動してきた営業は
`#/flows/sales` で、ゴール・段階の意図・遷移・使うデータを定義ファイルなしで把握できる**。

一覧は**1万件を上下スクロールで全件辿れる**（窓1枚 12ms）。ステップ・担当（「自分の案件」）・
商材・確度・状態・見込み月・案件名で絞れ、列見出しで並べ替えられる。**絞り込みは URL に載るので
そのまま共有できる**。取得の合間に誰かが更新しても行はズレない（`snapshot` で時点を固定する）。

開発は Docker 内で行う。

```sh
docker compose up -d
docker compose exec dev pnpm verify              # check:wiring → fmt:check → typecheck → lint → test

docker compose exec dev pnpm alt validate        # 定義の検証（--json あり）
docker compose exec dev pnpm alt apply --recreate            # SQLite にスキーマを作り直す
docker compose exec dev pnpm alt export --out data/definitions.json  # サーバーが読む形で書き出す
docker compose exec dev pnpm alt seed --reset    # デモデータ
docker compose exec dev pnpm alt seed --reset --deals 10000   # 一覧の性能を見るとき（約1秒）
docker compose exec -d dev pnpm serve            # API（ホストからは localhost:3100）
docker compose exec -d dev pnpm dev              # FE （ホストからは localhost:5273）

curl -H 'X-Dev-User: yamada@example.com' 'localhost:3100/api/deal?flow=sales'
```

> ⚠ コンテナを作り直したあとに `ERR_MODULE_NOT_FOUND` が出たら、匿名ボリュームだけ
> 新しくなって pnpm が再リンクしていない。README の対処を見る。

段取り（2026-08-06 /dandori で整備）:

- フェーズの着手は `/phase-start <N>`、完了処理（完了条件の検証・記録更新・コミット）は `/phase-done <N>`
- **パッケージを追加したら4箇所**（compose の匿名ボリューム / `tsconfig.json` の `paths` /
  `vite.config.ts` の `resolve.alias` / `tsx` 起動の `--tsconfig`）。**覚えなくてよい** —
  verify 先頭の `check:wiring`（`scripts/check-wiring.mjs`）が4つとも検知して落とす。
  2〜4 はどれも「`dist/` の古い成果物を読んだまま通る」形で壊れるので、機械で塞いである。
  alias は**最寄りの `vite.config.ts` が読まれる**ので、`apps/*` のように自前の設定を持つ
  パッケージはルートではなくそちらに書く（フェーズ4で判明）
- **`package.json` を編集したら `pnpm install` は hook が自動で流す**（`.claude/hooks/`）
- **コンテナ内で使い捨てスクリプトを走らせるとき**は置き場に注意（CLAUDE.md「開発環境」参照）。
  scratchpad は見えず、`/app` 直下は依存を解決できない

---

## 実装中ずっと効く決定

詳細は [product-concept.md §8-1](product-concept.md)。ここには**実装のたびに参照するもの**だけ置く。

1. **定義は TypeScript DSL**。`alt apply` 時に JSON へ変換してバックエンドに渡す。Go はJSONを読むだけ
2. **API は REST 自動生成**。`/api/{table}`。`_permissions` は各レコードに含める。**グリッドの取得も REST 拡張**（2026-08-08 旧論点16決着。GraphQL 併用は再訪条件つき見送り — §8-1）
   - **時点のパラメータは2つあり、意味が違う**（フェーズ6 決定A）。`as_of` = 過去を見る（**読み取り専用**。`_permissions.update` が落ちる）／ `snapshot` = いまを固定して読む（**読み取り専用にしない**。窓取得の行ズレ対策。GET 専用）。1つにまとめると一覧の全行が編集不可になる
   - 一覧のフィルタは**フィールド毎のパラメータ**（`status=open` / `title_like=看板` / `expectedCloseMonth_gte=2026-08` / `step=proposed`）。**サーバ内部で条件式 AST に変換する**ので、FE は AST を組み立てない
3. **バインドされていないテーブルは API が生えない**。これを技術的に強制するのがバックエンドの役割
4. **全テーブルに有効期間型（SCD Type 2）の列を自動付与**する。定義には書かない。更新は「前の行を閉じて INSERT」。**外部キーの索引も DDL が自動で付ける**（フェーズ6 決定G。定義に書かせない）
5. **現在ステップは `_flow_state` テーブル**（レコード × フローの関係として持つ。有効期間型）。業務テーブルの列にはしない
6. **手動チェックは `_manual_check` テーブル**。出口条件は**明示キー**で識別する（ラベルをキーにしない）
7. **認可は業務フロー定義から導出**する。権限設定を別に書かない。行レベルは「読みは全員、書きは担当者＋管理者」
8. **認証は実装しない**。`X-Dev-User` ヘッダでユーザーを詐称する。**本番ビルドにコードごと含めない**
9. **条件式は SQL に変換できる範囲**に限る（レベル3: 集計・比較まで）。任意コードは書けない
10. **AST は完全に明示的**。暗黙結合などの糖衣は TS 側で展開してから AST にする

---

## ドキュメントマップ

**全部読まないこと。** 必要になったときに、必要なものだけ開く。

| ファイル | いつ読むか |
|---|---|
| [product-concept.md](product-concept.md) | 設計判断の根拠を確認したいとき。§8-1 が確定事項、§8-2 が未確定 |
| [condition-ast.md](condition-ast.md) | 条件式を扱うとき。AST の仕様と SQL 変換規則 |
| [domain-model.md](domain-model.md) | 定義を書くとき。テーブル §5、業務フロー §6、ロール §7 |
| [sales-domain.md](sales-domain.md) | 「なぜこのモデルなのか」を疑ったとき。営業ドメインの一般論 |
| [domain-research.md](domain-research.md) | 客先の業界事情を確認したいとき |
| [cost-simulation.md](cost-simulation.md) | 提案フェーズ用。実装では読まない（※Go前提への書き換えが必要） |
| `testdata/condition-eval/README.md` | 適合テストを足すとき |

---

## 迷ったときの原則

- **TS版バックエンドは仕様であり、Go版完成後に捨てる。** 凝った抽象化をしない
- **未確定の論点は [product-concept.md §8-2](product-concept.md) にある。** 実装中に判断が必要になったらそこを見て、決めたら追記する
- **仕様と実装が食い違ったら、仕様を疑う。** これまで5回、実装して初めて仕様の穴が見つかっている
  （`meo_keyword` の分離、`field.path` がフィールド名を持つこと、boolean のバインド、
  **ステップを担当しないロールがフローに参加できないこと**、
  **プラットフォームが客先定義の名前を直に知っていること** — 後の2つは
  [product-concept.md §8-2](product-concept.md) 論点12・13）
