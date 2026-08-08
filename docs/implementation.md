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

---

## 現在地

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | [定義層](impl/phase-1-definitions.md) | **済**（2026-08-06） |
| 2 | [CLI](impl/phase-2-cli.md) | **済**（2026-08-06） |
| 3 | [バックエンド](impl/phase-3-backend.md) | **済**（2026-08-06） |
| 4 | [FE + 動作確認](impl/phase-4-frontend.md) | **済**（2026-08-06） |
| 5 | [業務フローの参照画面](impl/phase-5-flow-reference.md) | **済**（2026-08-06） |
| 6 | [一覧グリッドの読み側](impl/phase-6-list-grid.md)（仮想スクロール・フィルタ・URL状態） | 未着手（計画済み 2026-08-08） |
| 7 | [一覧グリッドの書き側](impl/phase-7-list-grid-edit.md)（Enter セル編集） | 未着手（6 の後） |

フェーズ1〜4（**ブラウザで動作確認できる最小スコープ**）に加えて、フェーズ5で
**業務フローを営業自身が読める**ようになった（業務変更時の把握と、異動時のオンボーディング）。
定義が表示名・出口条件の充足のしかた（`howTo`）・ステップの意図（`intent`）を持ち、
`#/flows/sales` の参照画面が定義だけから描かれる（APIを叩かない）。**§8-2 論点14 は解決した**
（enum ラベル・フィールドラベルは定義が持ち、FEの手書き表は消えた）。

**フェーズ6・7（一覧グリッド）を計画済み。6 は着手可能**（`/phase-start 6`）。
API 形態は **REST 拡張で決着済み**（2026-08-08、旧 §8-2 論点16 → §8-1
「一覧グリッド化の着手前に決めたもの」）。現状の一覧は limit 既定100で切れる点に注意。

グリッドと並行または後の候補（着手順は未決定）:

- **§8-2 論点12**（優先度・高）— マネージャーがフローに参加できず、画面で一覧が丸ごと403
- **§8-2 論点9** — ステップを `won` に進めても `deal.status` は `open` のまま
- **定義の版と差分**（「何が変わったか」。フェーズ5決定Iで見送った続き。§8-2 論点5 と重なる）
- **Go版バックエンドの計画**（`condition-ast.md` §9-5）

---

## すでに動いているもの

`pnpm verify` が通る状態（277 テスト）。

| パッケージ | 中身 |
|---|---|
| `@alt/dsl` | 条件式AST（型・zodスキーマ・JSON Schema、**表示用の `referencedFields`** — Go契約外）、テーブル定義（**表示名 `label` 必須**・enum は `{key, label}` の配列）、**フロー定義**（`flow` / `step` / `check` / `manualCheck` / `bind`、**`intent`・`howTo` 必須**、reads・writes からの access 導出、**行レベル認可の `rowFilter`**）、**ロール定義**、**定義バンドル**（`DefinitionBundle` — バックエンドへの受け渡し形）、外部キー解決（`foreignKeysTo` / `resolveFieldPath`）、`toColumnName` |
| `@alt/sql` | AST → SQL 変換、`CREATE TABLE` 生成、**プラットフォームテーブル**（`_flow_state` / `_manual_check`）、**有効期間型の読み書きSQL**（`query.ts` — 一覧・閉じてINSERT・フロー状態・手動チェック）、方言（SQLite / PostgreSQL） |
| `@alt/definitions` | **客先の定義そのもの**。テーブル5本（deal / company / contact / employee / activity）と営業フロー1本。出口条件8件（自動5・手動3）。**表示名・ステップの意図・充足のしかたも定義が持つ**（フェーズ5） |
| `@alt/cli` | **`alt` コマンド**。`validate`（3層19ルール）/ `apply`（SQLite にスキーマ）/ `export --out`（定義をJSONで）/ `seed`（開発用データ） |
| `@alt/server` | **REST API**。定義レジストリ、ルート自動生成（**未バインドは 404**）、出口条件の一括評価、有効期間型の書き込み、ステップ遷移、認可4層 + `_permissions`、`X-Dev-User` 詐称 |
| `@alt/main`（`apps/main`） | **エンドユーザーFE**（React + Vite）。シェル（ナビ・ルータ・APIクライアント・時点指定・開発用ユーザー切替）、営業フローの画面（案件一覧 / 詳細 = 現在地・出口条件チェックリスト＋**未充足の充足のしかた**・遷移・編集フォーム）、**フロー参照画面**（`#/flows/:key` = 遷移グラフ・ステップカード・使うデータ。**APIを叩かず定義だけで描く**。レイアウトは `flows/flowGraph.ts`）。**ラベルも含め定義を値として import** |
| `testdata/condition-eval/` | 言語非依存の適合テスト6件。実SQLiteで評価される |

**営業フロー1本がブラウザで動き、フローそのものも読める**ところまで来た。案件の一覧・詳細に
現在ステップと出口条件のチェックリストが出て、**データを直すと自動判定が勝手に充足に変わり**、
未充足の条件には「どうすれば充足するか」が出る。未充足でも進めるが記録に残り、`as_of` で過去が
読め、担当者でなければ編集ボタンが出ない。**異動してきた営業は `#/flows/sales` で、ゴール・
段階の意図・遷移・使うデータを定義ファイルなしで把握できる**。

開発は Docker 内で行う。

```sh
docker compose up -d
docker compose exec dev pnpm verify              # check:wiring → fmt:check → typecheck → lint → test

docker compose exec dev pnpm alt validate        # 定義の検証（--json あり）
docker compose exec dev pnpm alt apply --recreate            # SQLite にスキーマを作り直す
docker compose exec dev pnpm alt export --out data/definitions.json  # サーバーが読む形で書き出す
docker compose exec dev pnpm alt seed --reset    # デモデータ
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
2. **API は REST 自動生成**。`/api/{table}`。`as_of` はクエリパラメータ、`_permissions` は各レコードに含める。**グリッドの取得も REST 拡張で作る**（2026-08-08 旧論点16決着。GraphQL 併用は再訪条件つき見送り — §8-1）
3. **バインドされていないテーブルは API が生えない**。これを技術的に強制するのがバックエンドの役割
4. **全テーブルに有効期間型（SCD Type 2）の列を自動付与**する。定義には書かない。更新は「前の行を閉じて INSERT」
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
