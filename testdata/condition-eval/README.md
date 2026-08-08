# 条件式の適合テストケース

**TS 版と Go 版が同じケースを流す**ための言語非依存のテストデータ
（`docs/product-concept.md` §4-0、`docs/condition-ast.md` §8）。

TS のユニットテストをそのまま仕様にすると、Go へ移すときに人間（AI）が読み替える
ことになり、そこが移植の穴になる。ここに置いた JSON を両言語のランナーが読み、
同じ結果になることを検証する。

## ファイル

| ファイル | 役割 |
|---|---|
| `schema.json` | テーブル定義（全ケース共通）。`docs/domain-model.md` §5 のサブセット |
| `*.json` | 個々のケース |

## ケースの形式

```jsonc
{
  "case": "人間向けの説明",
  "note": "なぜこのケースが必要か（任意）",
  "root": "deal",                  // 評価対象のテーブル
  "asOf": "2026-07-10",            // 任意。省略すると現在時点
  "context": { ... },              // 任意。currentUser.id / today / now
  "ast": { ... },                  // 条件式AST（docs/condition-ast.md §2）
  "fixtures": {                    // テーブル名 → 行の配列
    "deal": [{ "id": "d1", ... }]
  },
  "expected": { "d1": true, "d2": null }   // ルートの id → 判定結果
}
```

- フィールド名は **camelCase**（定義に書いた名前）。列名への変換はランナーが行う
- `valid_from` / `valid_to` を書かなければ「ずっと有効な現在行」として投入される。
  時点指定のケースだけ明示する
- `expected` の値が **`null`** なのは SQL の三値論理を表す。真でも偽でもない

## 現在のケース

| ファイル | 何を押さえるか |
|---|---|
| `budget-confirmed.json` | or と比較の基本 |
| `decision-maker-met.json` | exists + リレーションを辿る field |
| `null-three-valued-logic.json` | **NULL との比較が NULL になること**。移植で最も事故りやすい |
| `aggregate-count.json` | 集計（レベル3）と、空集合の COUNT が 0 であること |
| `row-level-auth.json` | コンテキスト変数のバインド。出口条件と同じ AST を認可にも使う |
| `as-of-past-version.json` | 有効期間型。過去バージョンを見る |
| `contains-substring.json` | 部分一致（AST_VERSION 2）。**`value` はパターンではない** — `%` が素の文字として扱われること |
