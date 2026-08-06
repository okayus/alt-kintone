# 条件式 AST 仕様

- 作成日: 2026-08-04 / 状態: **v1ドラフト**
- 位置づけ: **TypeScript と Go の契約**。定義（TS DSL）が生成し、バックエンド（Go）が SQL に変換する（`product-concept.md` §4-0）
- 用途は2つ:
  - **出口条件**の自動判定（`product-concept.md` §3-5）
  - **行レベル認可**の `rowFilter`（同 §4-1）

両者は同じ AST を使う。どちらも最終的に SQL の述語になるため。

---

## 1. 設計方針

| # | 原則 | 理由 |
|---|---|---|
| 1 | **SQLに変換できる範囲に限る** | 出口条件は一覧で数百件を一括評価する。レコードごとにコードを実行するとN+1になる |
| 2 | **AST は完全に明示的。糖衣は TS 側で展開する** | 暗黙結合などのルールを Go に持ち込まない。Go は素直に変換するだけ |
| 3 | **式（値）と述語（真偽）を型で分ける** | 両言語で同じ構造にでき、不正な組み合わせを型で弾ける |
| 4 | **コンテキスト変数はSQLパラメータとしてバインド** | `today` や `currentUser.id` を SQL 関数に変換すると方言差が出る |
| 5 | **表現力はレベル3（集計・比較）まで** | `product-concept.md` §5-6 で確定 |

---

## 2. AST 仕様

### 2-1. Expr（値を返す）

```typescript
type Expr =
  | { type: 'literal';  value: string | number | boolean | null }
  | { type: 'field';    source: string; path: string[] }
  | { type: 'context';  name: 'currentUser.id' | 'today' | 'now' }
  | { type: 'aggregate';
      fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
      table: string; alias: string;
      field?: string[];          // count 以外は必須
      where?: Pred }
```

- `source`: `'root'`（評価対象のレコード）またはサブクエリのエイリアス
- `path`: 長さ1なら自テーブルの列。**2以上ならリレーションを辿る**

`path` に書くのは**外部キーのフィールド名そのもの**（`['contactId','isDecisionMaker']`）。
DSL では `a.contact.isDecisionMaker` と書けるが、**ビルダーが `contactId` に展開してから** AST にする。

リレーション名（`contact`）を AST に持たせると、`contactId` から `Id` を落として `contact` と読む
暗黙ルールが必要になり、それを Go 側にも実装させることになる。方針1（AST は完全に明示的）に反するので採らない。

### 2-2. Pred（真偽を返す）

```typescript
type Pred =
  | { type: 'compare';   op: 'eq'|'ne'|'gt'|'gte'|'lt'|'lte'; left: Expr; right: Expr }
  | { type: 'in';        left: Expr; values: (string|number|boolean)[] }
  | { type: 'isNull';    operand: Expr }
  | { type: 'isNotNull'; operand: Expr }
  | { type: 'and';       operands: Pred[] }
  | { type: 'or';        operands: Pred[] }
  | { type: 'not';       operand: Pred }
  | { type: 'exists';    table: string; alias: string; where: Pred }
```

`exists` は `count(...) > 0` で表現できるが、SQL では `EXISTS` のほうが効率的なので独立ノードにする。

### 2-3. JSON の例

「予算感を確認した」（`initialBilling > 0 OR monthlyBilling > 0`）:

```json
{ "type": "or", "operands": [
  { "type": "compare", "op": "gt",
    "left":  { "type": "field", "source": "root", "path": ["initialBilling"] },
    "right": { "type": "literal", "value": 0 } },
  { "type": "compare", "op": "gt",
    "left":  { "type": "field", "source": "root", "path": ["monthlyBilling"] },
    "right": { "type": "literal", "value": 0 } }
]}
```

---

## 3. TS DSL の書き味

> ⚠ **この節はまだ実装していない**（2026-08-06 時点）。最小スコープでは AST を直接書く方針にしたため、
> `packages/definitions/src/flows/sales.ts` はここに書かれたビルダーではなく生の AST オブジェクトで書かれている。
> 暗黙結合（§4）も手で展開してある。書き味の改善はブラウザで動くものを見てから判断する
> （`docs/implementation.md` の「作らないもの」）。以下は将来の目標形。

AST を手で書くことはない。DSL がビルダーを提供する。

```typescript
// 単純な比較
deal.expectedCloseMonth.isNotNull()

// 論理演算
or(deal.initialBilling.gt(0), deal.monthlyBilling.gt(0))

// 存在チェック（暗黙結合。§4）
exists(activity, a => and(a.scheduledAt.isNotNull(), a.completedAt.isNull()))

// リレーションを辿る
exists(activity, a => and(
  a.completedAt.isNotNull(),
  a.contact.isDecisionMaker.eq(true),   // activity → contact
))

// 集計（レベル3）
count(activity, a => a.completedAt.isNotNull()).gte(3)

// コンテキスト変数
deal.ownerEmployeeId.eq(currentUser())
contract.jobAdDetail.publishEndDate.lt(today())
```

型は定義から infer される。存在しないフィールドを参照すればコンパイルエラーになり、`integer` のフィールドに文字列を比較しようとしても弾かれる。ただし**型は書くときの検査であって、Go に渡るのは JSON だけ**（`product-concept.md` §5-6）。

---

## 4. 暗黙結合のルール

`exists(activity, ...)` と書いたとき、「どの案件の活動か」の結合条件を毎回書くのは冗長。**対象テーブルからルートテーブルへの外部キーがちょうど1つのときだけ、暗黙に結合する**。

| ケース | 扱い |
|---|---|
| `activity.dealId` → `deal.id` が唯一 | **暗黙結合**。`exists(activity, a => ...)` と書ける |
| 外部キーが複数ある | **明示必須**。validate でエラーにする |
| 直接の外部キーがない（2段以上） | **明示必須** |

3つ目の例が `contact`。`deal → company → contact` と辿る必要があり、`deal` から `contact` への直接の外部キーはない。

```typescript
// 明示が必要
exists(contact, c => and(
  c.companyId.eq(deal.companyId),
  c.isDecisionMaker.eq(true),
))
```

**暗黙結合は TS 側で展開してから JSON にする**（方針2）。AST には結合条件が明示的に入るので、Go はルールを知らなくてよい。

---

## 5. SQL 変換

### 5-1. 一覧での一括評価

出口条件は一覧で数百件を評価する。**相関サブクエリを SELECT 句に埋め込んで1クエリで済ませる**。

```sql
SELECT d.*,
  (d.initial_billing > 0 OR d.monthly_billing > 0)          AS check_budget,
  EXISTS(SELECT 1 FROM activity a
         WHERE a.deal_id = d.id AND a.completed_at IS NOT NULL) AS check_met_dm
FROM deal d
WHERE d.valid_to IS NULL
```

**実装で確かめた**（2026-08-06、フェーズ3）: バックエンドの一覧APIがこの形になっている
（`packages/sql/src/query.ts` の `selectRecords`）。**フローの全ステップぶんの自動判定を
まとめて SELECT 句に埋める** — レコードごとに現在ステップが違うので、ステップ別に分けると
クエリ本数がステップ数に比例するため。一覧のクエリは件数によらず3本
（認証 / レコード + 現在ステップ + 全自動判定 / 手動チェック）で固定されている。

⚠ **充足の判定は `= 1` で行う。** SQL の比較は NULL を伝播するので、`initial_billing` が
NULL のとき `initial_billing > 0` の結果は 0 ではなく **NULL** になる。「真でない」を
falsy で判定すると言語によっては取りこぼす。Go に移すときも同じ注意が要る。

### 5-2. コンテキスト変数

SQL 関数に変換せず**パラメータとしてバインド**する。方言差が消え、テストも決定的になる。

| context | バインド値 |
|---|---|
| `today` | 実行日（アプリのタイムゾーンで解決した日付） |
| `now` | 実行時刻 |
| `currentUser.id` | 認証済みユーザーのID |

### 5-3. 方言の差し替え

`product-concept.md` §4-0 のとおり、**ローカルは SQLite、本番は PostgreSQL の可能性**がある。SQL 生成層は方言を差し替えられる形にする。AST 自体は方言非依存。

---

## 6. 検証: `domain-model.md` の出口条件をすべて表現できるか

### 6-1. 営業フロー（ルート = `deal`）

| 出口条件 | 表現 |
|---|---|
| アポイントの予定がある | `exists(activity, a => and(a.type.in(['visit','online_meeting']), a.scheduledAt.isNotNull(), a.completedAt.isNull()))` |
| 課題を確認した | — （手動チェック） |
| 予算感を確認した | `or(deal.initialBilling.gt(0), deal.monthlyBilling.gt(0))` |
| 決裁者を特定した | `exists(contact, c => and(c.companyId.eq(deal.companyId), c.isDecisionMaker.eq(true)))` |
| 金額を提示した | 「予算感を確認した」と同じ |
| 決裁者に会えている | `exists(activity, a => and(a.completedAt.isNotNull(), a.contact.isDecisionMaker.eq(true)))` |
| 導入時期を確認した | `deal.expectedCloseMonth.isNotNull()` |

### 6-2. 求人広告 制作・掲載フロー（ルート = `contract`）

| 出口条件 | 表現 |
|---|---|
| 原稿を提出した | — （手動） |
| 先方の承認を得た | — （手動） |
| 掲載開始日が設定されている | `contract.jobAdDetail.publishStartDate.isNotNull()` |
| 掲載終了日を過ぎている | `contract.jobAdDetail.publishEndDate.lt(today())` |
| 応募数を記録した | `contract.jobAdDetail.applicationCount.isNotNull()` |

### 6-3. MEO運用フロー（ルート = `contract`）

| 出口条件 | 表現 |
|---|---|
| GBP権限の所在を確認した | `contract.meoDetail.gbpOwnership.ne('不明')` |
| 対策キーワードを設定した（4件以上） | ⚠ **表現できない**（§7-1） |
| 継続意思を確認した | — （手動） |
| 解約日が確定している | `exists(contractChange, cc => and(cc.changeType.eq('cancelled'), cc.changedAt.isNotNull()))` |

### 6-4. 行レベル認可

| 対象 | 表現 |
|---|---|
| `deal` の書き込み | `deal.ownerEmployeeId.eq(currentUser())` |
| `activity` の書き込み | `activity.ownerEmployeeId.eq(currentUser())` |

**結果: 1件を除きすべて表現できた。** 見つかった1件は AST ではなくモデル側の問題（§7-1）。

**実装で確かめた**（2026-08-06、フェーズ1）: 6-1 の営業フロー分（自動判定5件）は実際に AST として書かれ、
`compilePred` で SQL に変換できることをテストしている（`packages/definitions/src/definitions.test.ts`）。
「アポイントの予定がある」は `type` の絞り込みを足した — `domain-model.md` §6-1 が「訪問/商談予定」と
書いているのに対し、上の表が種別を見ていなかったため。**仕様側（この表）を実装に合わせて直した。**

---

## 7. 非対応と制約

### 7-1. JSON配列の要素数は扱わない → モデル側を直す

`meo_detail.対策キーワード` は JSON 配列で持つ設計だったが、**配列長の判定は方言差が大きく（SQLiteとPostgreSQLでJSON関数が違う）、ASTに入れない**。

これは AST の制約というより**モデルの設計ミス**。対策キーワードは4〜12件あり、`meo_report` で**KW別の順位を記録する**（`domain-model.md` §5）。つまり既に配列では足りていない。

→ **`meo_keyword` テーブルに分離すべき**。そうすれば `count(meoKeyword).gte(4)` で表現でき、KW別順位も自然に紐づく。`domain-model.md` にフィードバック済み。

### 7-2. その他の非対応

| 項目 | 扱い |
|---|---|
| 任意のコード実行 | 不可（方針1）。判定できないものは手動チェックにする |
| 文字列関数（部分一致・連結） | v1では持たない。必要になったら `like` を足す |
| 日付演算（3ヶ月後など） | v1では持たない。必要なら `dateAdd` ノードを足す |
| ウィンドウ関数・サブクエリの入れ子 | 不可 |
| 集計の入れ子（`count` の中で `count`） | 不可 |

---

## 8. テストケースの形式

`product-concept.md` §4-0 のとおり、**TS版とGo版が同じ JSON ケースを流す**。移植の正しさを機械的に検証するため。

```json
// testdata/condition-eval/decision-maker-met.json
{
  "case": "決裁者に会えている",
  "root": "deal",
  "ast": { "type": "exists", "table": "activity", "alias": "a", "where": { ... } },
  "fixtures": {
    "deal":     [{ "id": "d1", "companyId": "c1" }],
    "contact":  [{ "id": "p1", "companyId": "c1", "isDecisionMaker": true }],
    "activity": [{ "id": "a1", "dealId": "d1", "contactId": "p1", "completedAt": "2026-07-01T10:00:00Z" }]
  },
  "context": { "today": "2026-08-04", "currentUser.id": "e1" },
  "expected": { "d1": true }
}
```

最低限そろえるべきケース:

- 各ノード種別の単体（compare の全op、in、isNull、and/or/not、exists、aggregate の全fn）
- **null の扱い**（SQLの三値論理。`NULL > 0` は真でも偽でもない）
- 暗黙結合が展開された形
- リレーションを2段辿るケース
- コンテキスト変数のバインド
- 空集合に対する集計（`count` は0、`sum` は NULL）

**三値論理は移植で最も事故りやすい部分**なので、テストを厚くする。

---

## 9. 実装順序

1. **AST の型定義**（TS）と JSON Schema — これが契約
2. TS DSL のビルダー（暗黙結合の展開を含む）
3. SQL 変換（SQLite方言）
4. テストケースを JSON で整備
5. Go 版の AST 型と SQL 変換 → 同じテストケースを流す
