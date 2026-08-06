# 実装ハブ

**実装セッションはこのファイルから始める。** 各フェーズの詳細は別ファイルにあり、
**いま着手するフェーズのものだけ**読めばよい。完了したフェーズと先のフェーズは読まない。

---

## いま作っているもの

alt-kintone は「業務フローを第一級の概念に置いた、AI前提の業務アプリ基盤」
（構想: [product-concept.md](product-concept.md)）。

いまは**ブラウザで動作確認できる最小スコープ**を作っている。

> **ゴール**: 営業フロー1本が、案件一覧・詳細・出口条件チェックリスト・ステップ遷移として
> ブラウザで動くこと。

最小スコープなので、以下は**意図的に作らない**。手を広げないこと。

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
| 1 | [定義層](impl/phase-1-definitions.md) | **← いまここ（未着手）** |
| 2 | [CLI](impl/phase-2-cli.md) | 未着手 |
| 3 | [バックエンド](impl/phase-3-backend.md) | 未着手 |
| 4 | [FE + 動作確認](impl/phase-4-frontend.md) | 未着手 |

**次に読むもの → [impl/phase-1-definitions.md](impl/phase-1-definitions.md)**

フェーズ2〜4 は概要と完了条件だけ書いてある。着手時に詳細化する。

---

## すでに動いているもの

`pnpm test` で 71 テスト、`typecheck` / `lint` / `build` が通る状態。

| パッケージ | 中身 |
|---|---|
| `@alt/dsl` | 条件式AST（型・zodスキーマ・JSON Schema）、テーブル定義、外部キー解決（`foreignKeysTo` / `resolveFieldPath`）、`toColumnName` |
| `@alt/sql` | AST → SQL 変換、`CREATE TABLE` 生成、方言（SQLite / PostgreSQL） |
| `testdata/condition-eval/` | 言語非依存の適合テスト6件。実SQLiteで評価される |

開発は Docker 内で行う。

```sh
docker compose up -d
docker compose exec dev pnpm verify    # check:compose → typecheck → lint → test → fmt:check
```

段取り（2026-08-06 /dandori で整備）:

- verify 先頭の `check:compose`（`scripts/check-compose-volumes.mjs`）が、パッケージ新設時の
  docker-compose.yml 匿名ボリューム追記漏れを機械検知する
- フェーズの着手は `/phase-start <N>`、完了処理（完了条件の検証・記録更新・コミット）は `/phase-done <N>`

---

## 実装中ずっと効く決定

詳細は [product-concept.md §8-1](product-concept.md)。ここには**実装のたびに参照するもの**だけ置く。

1. **定義は TypeScript DSL**。`alt apply` 時に JSON へ変換してバックエンドに渡す。Go はJSONを読むだけ
2. **API は REST 自動生成**。`/api/{table}`。`as_of` はクエリパラメータ、`_permissions` は各レコードに含める
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
- **仕様と実装が食い違ったら、仕様を疑う。** これまで3回、実装して初めて仕様の穴が見つかっている
  （`meo_keyword` の分離、`field.path` がフィールド名を持つこと、boolean のバインド）
