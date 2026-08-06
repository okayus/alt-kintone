# フェーズ1: 定義層

ハブ: [../implementation.md](../implementation.md)

**目的**: 営業フローとその関連テーブルを、TypeScript の定義として書けるようにする。

このフェーズが終わると「定義がソースコードとして存在する」状態になる。まだ何も動かない
（DB もAPIも無い）が、次のフェーズがすべてこの定義を入力にする。

---

## タスク

### 1-1. プラットフォームテーブルの DDL

`packages/sql/src/ddl.ts` に追加する。業務テーブルと違い、定義ファイルからは生成されない
**プラットフォームが常に持つテーブル**。

```sql
-- レコードが業務フローのどこにいるか（有効期間型）
_flow_state (
  table_name TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  flow       TEXT NOT NULL,
  step       TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to   TEXT,
  changed_by TEXT, changed_flow TEXT, changed_step TEXT
)

-- 手動チェックの出口条件（有効期間型にしない）
_manual_check (
  table_name TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  flow       TEXT NOT NULL,
  step       TEXT NOT NULL,
  check_key  TEXT NOT NULL,
  checked    INTEGER NOT NULL,
  checked_by TEXT,
  checked_at TEXT
)
```

**押さえる点**

- `_flow_state` は**有効期間型にする**。ステップ遷移の履歴がここに残り、`sales-domain.md` §14 の
  ステージ転換率がこれで出せる
- 「1レコードは1フローにつきちょうど1ステップ」を**部分ユニーク索引で表現する**
  （`(table_name, record_id, flow)` に対し `valid_to IS NULL` のとき）。
  不変条件はコメントではなく構造で表現する
- `_manual_check` は有効期間型にしない。チェックの付け外し履歴は分析に使わない。
  `(table_name, record_id, flow, step, check_key)` がユニーク

**完了条件**: 両テーブルの `CREATE TABLE` と索引が生成でき、in-memory SQLite に流せる。

---

### 1-2. フロー定義DSL

`packages/dsl/src/flow.ts` を新設する。テーブル定義（`table.ts`）と同じ方針で、
**型パズルは入れない**。持つのは構造だけ。

```typescript
export const sales = flow({
  key: 'sales',
  name: '営業（新規開拓）',
  goal: '受注',
  steps: [
    step({
      key: 'qualified',
      name: 'ヒアリング',
      role: 'sales_rep',
      reads: [account, contact],
      writes: [opportunity],
      exit: [
        check('budget', '予算感を確認した', <AST>),
        manualCheck('problem_articulated', '顧客が課題を自分の言葉で語れている'),
      ],
      next: ['proposed', 'lost'],
    }),
  ],
  bindings: [
    bind(deal, 'primary', '営業フローの主対象。ヨミ管理と予測の元データ'),
  ],
})
```

**押さえる点**

- **出口条件の AST は直接書く。** 条件式ビルダー（`deal.amount.gt(0)`）は最小スコープでは作らない。
  読みにくいが動く。書き味の改善は動くものを見てから
- `check()` の第1引数は**明示キー**。ラベルを変えてもチェック状態が失われないため（ハブの決定6）
- **バインディングの `access` と使用テーブルは書かない。** ステップの `reads` / `writes` から導出する
  （`product-concept.md` §3-3）。`bind()` に書くのは `role` と `purpose` だけ
- `next` は有向グラフ。分岐・差し戻し・スキップを表現できる。並列は持たない
- zod スキーマも書く（`table.ts` と同じ形）

**完了条件**: フロー定義が構造として組み立てられ、zod で検証できる。

---

### 1-3. 営業フローとテーブルを書き下ろす

`packages/definitions/` を新設し、`domain-model.md` の営業フロー部分を書く。

```
packages/definitions/
  src/
    tables/     deal / company / contact / employee / activity（最小スコープ）
    flows/      sales.ts
    index.ts
```

**押さえる点**

- 参照するのは [domain-model.md](../domain-model.md) の §5（テーブル）と §6-1（営業フロー）
- **最小スコープなので全テーブルは書かない。** 営業フローが動くのに必要なものだけ。
  `contract` / `contract_change` / `quota` / `meo_*` / `job_ad_*` は後
- 金額は4分割（`initialBilling` / `initialProfit` / `monthlyBilling` / `monthlyProfit`）。
  代理店ビジネスで総額と粗利が乖離するため（`domain-model.md` §5）
- 出口条件は §6-1 の表にある7件。うち5件が自動判定、2件が手動
- `employee` は `global: true`（横断マスタ）
- `packages/definitions` は `@alt/definitions` として workspace に追加し、
  **`docker-compose.yml` の匿名ボリュームにも追記する**（忘れると node_modules が消える）

**完了条件**: `definitions` が型検査を通り、フロー定義が zod 検証を通る。

---

## このフェーズで判断が要りそうなこと

実装中に決めることになったら、決めた内容を [product-concept.md §8-2](../product-concept.md) に追記すること。

- 定義ファイルをどう集約するか（`registry()` に手で並べるか、ディレクトリを走査するか）
- ロールの定義をどこに置くか（`domain-model.md` §7 に一覧はあるが、定義としての置き場が未定）
- 出口条件の AST を書くとき、`root` が何を指すか明示が要るか（フローの primary テーブル？）

---

## 次

フェーズ2（CLI）→ [phase-2-cli.md](phase-2-cli.md)
