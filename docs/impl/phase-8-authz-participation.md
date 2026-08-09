# フェーズ8: ロールと参加の認可 — §8-2 論点12 を解く

ハブ: [../implementation.md](../implementation.md)

**ステータス: 実装済み（2026-08-09）。完了条件9件はすべて検証した（§5）。**

**目的**: 「操作しないが見る」立場と「同じ段階を複数のロールが担当する」業務を、
**認可を業務フロー定義から導出したまま**表現できるようにする。

---

## 0. 何を解くのか

### 0-1. 表の顔 — マネージャーが案件を1件も読めない

`roles.ts` は営業マネージャーを「全案件の閲覧・編集、目標設定」と宣言しているのに、
**営業フローのどのステップも担当していない**ので、フロー参加の導出（下記）で弾かれる。
フェーズ4で開発用ユーザーを鈴木（`sales_manager`）に切り替えると、**案件一覧が丸ごと 403** になる。

§8-2 論点12 として「優先度・高」で積んであったもの。認可を定義から導出すると決めた
（§4-1）ことの副作用で、**導出の根拠が「どれかのステップの担当であること」しか無い**のが原因。

### 0-2. 実は2つの要求が畳まれている（フェーズ9の論点Jで判明）

[phase-9-change-requests.md](phase-9-change-requests.md) の論点J で `authz.ts` を読んだとき、
論点12 が**性質の違う2つの要求を1つの番号にまとめている**ことが分かった。

| | 要求 | 実例 | 何が塞いでいるか |
|---|---|---|---|
| **(a)** | **操作しないが見る** | 営業マネージャーがヨミ会で全案件を見る | `participates` が「どれかのステップの role」しか見ない |
| **(b)** | **同じ段階を複数のロールが操作する** | 全社員が改善要望を起票する（フェーズ9） | `StepDef.role` が**単一のロールしか持てない** |

⚠ **(b) は (a) の解では解けない。** フローに「読める人」を足しても、
`advance`（ステップを進める）は現在ステップの role と一致することを要求するので、
起票者が自分の要望を次へ進められない。**別々の機構が要る**、というのがこのフェーズの前提。

**(a) はいま困っている。(b) はフェーズ9で必ず困る。** 同じ2つの関数と同じ DSL フィールドを
触るので、分けて2回やるより一度に片付けるほうが安い（`StepDef` の変更は
`@alt/definitions` の全ステップに波及するので、2回やると移行も2回になる）。

### 0-3. このフェーズで落とすもの

| 落とすもの | 理由 |
|---|---|
| **ロール階層**（`sales_manager` が `sales_rep` を包含する） | 階層は業務の実態と一致しないことが多い（マネージャーは営業を包含するが制作は包含しない）。1つの機構で (a) と (b) の両方を解こうとすると必ず歪む。論点A・B で個別に評価する |
| 列レベル認可 | §8-1 で v1 では持たないと確定済み |
| §8-2 論点13（`ADMIN_ROLE` / `PRINCIPAL_TABLE` のハードコード） | 論点F で評価するが、**触らない**のが推奨。認証を入れる時点で一緒に決める |
| ロールの動的な追加（データとしてのロール） | ロールは定義で宣言する（§4-1 確定） |

---

## 1. 現状 — コードが何をしているか

`packages/server/src/authz.ts` の4層。**この表が変更の対象そのもの。**

| 層 | 関数 | いまの判定 | 管理者 |
|---|---|---|---|
| 1. フロー参加 | `participates` | `flow.steps.some(s => s.role === principal.role)` | バイパス |
| 2. テーブル | `requireTableWrite` | `writable(usage.access)`（reads/writes から導出） | **バイパスしない** |
| 3. ステップ操作 | `requireStepRole` | `principal.role === step.role` | バイパス |
| 4. 行レベル | `rowFilterOf` / `permissionsOf` | `rowFilter.write` の SQL 評価 | バイパス |

`permissionsOf` が返すもの（FEに認可を複製しないための出力）:

```ts
update  = writable(usage.access) && rowWritable && !historical
advance = update && (isAdmin || principal.role === step.role)   // step があるときだけ
```

⚠ **層2 だけは管理者もバイパスしない**、という設計判断が既にある
（`authz.ts` のコメント: 「access は**そのフローがそのテーブルをどう使うか**であって
人の偉さではない。読むだけのテーブルに書ける管理者を作ると、バインディングが
業務の記録として信用できなくなる」）。**この線は論点Dで効く。**

関連する定義側の現状:

- `StepDef.role: string`（`packages/dsl/src/flow.ts`）— 単一
- `FlowDef` に参加者を書く場所は無い（`key` / `name` / `goal` / `target` / `initial` / `steps` / `bindings`）
- `RoleDef` は `{ key, name, description }` だけ。**権限は書かない**（確定事項）
- 営業フローの全ステップが `role: 'sales_rep'`。`sales_manager` / `production` /
  `meo_operator` はどのステップの担当でもない
- `deal` / `activity` の `rowFilter` は `ownedByCurrentUser`

---

## 2. 前提の解説

### 2-1. 「参加」と「操作」は別の判定なのに、いま同じ根拠から出ている

いまは `step.role` という1つの事実から、性質の違う2つを導いている:

- **参加**（このフローの画面を開いてよいか）＝ フロー単位・粗い・読みの話
- **操作**（このステップを進めてよいか）＝ ステップ単位・細かい・書きの話

`step.role` は本来**後者**のための情報で、前者は「後者の集合として副次的に決まっていた」。
うまくいっていたのは、**営業フローが「担当者だけが関わる業務」だったから**にすぎない。
マネージャー（見るだけ）と要望フロー（全員が操作する）は、どちらもこの偶然の外にある。

→ **参加を独立して書けるようにする**のがこのフェーズの本質。
ただし「権限設定を別に書かない」（§4-1 確定）は守る — 書く場所は**フロー定義の中**であって、
別の権限画面や `RoleDef` ではない。

### 2-2. viewer を足すと `POST` に穴が開く（他は偶然ふさがっている）

素朴に「`participates` に viewer を足す」だけで何が起きるか、書き込み経路を実際に追った
（`app.ts`、2026-08-08）。

| 経路 | いまの検査 | viewer を素通しにすると |
|---|---|---|
| `PATCH /api/{table}/{id}` | `requireTableWrite` + `requireRowWritable`（**`permissionsOf` の `update` を読む**） | `permissionsOf` が viewer を落とせば**自動的にふさがる** |
| `POST /api/{table}/{id}/advance` | `requireTableWrite` → `flow-state.ts` の `requireStepRole` | viewer のロールは `step.roles` に無いので**ふさがる** |
| `PUT .../checks/{key}` | 同上 | 同上 |
| **`POST /api/{table}`（新規作成）** | **`requireTableWrite` だけ**（`app.ts:78-80`） | ⚠ **通ってしまう** |

`POST` に行レベルの検査が無いのは正しい（**まだ行が存在しないので `rowFilter` を評価できない**）。
そして `usage.access` は**フロー単位**の導出値なので、viewer も `writable(access)` を通る。
つまり **viewer が案件を新規作成できる。**

⚠ **他の3経路がふさがるのは偶然で、設計ではない。** 「rowFilter を持つテーブルだから」
「そのステップの担当ロールでないから」という別々の理由でたまたま止まっているだけで、
`rowFilter` を持たないテーブルや、条件の違うフローでは同じ保証が無い。
**明示的に「viewer は書けない」を1箇所で言う**必要がある。→ 論点D。

### 2-3. 「全ロール」を DSL の特殊値にしなくてよい

(b) で「このステップは全員が操作する」と書きたくなるが、
`roles: ['sales_rep', 'sales_manager', 'production', 'meo_operator']` と列挙すると、
**ロールを足したときに書き足し忘れる**（この系が構造的に避けてきた種類のミス）。

`*` のような特殊値を DSL に入れる案もあるが、その必要はない。
定義パッケージは**ロール宣言を値として持っている**ので:

```ts
// packages/definitions/src/roles.ts
export const ROLE_KEYS = roles.map((r) => r.key)

// フロー定義側
step({ key: 'filed', roles: ROLE_KEYS, ... })
```

と書けば導出になり、ロールを足せば自動で伸びる。
**`ROLE_VALUES`（`employee.role` の enum 候補）が既に同じやり方**で、前例がある。
→ DSL には `roles: string[]` だけあればよい。

---

## 3. 論点と推奨

### 論点A: (a)「操作しないが見る」をどう表現するか

| 案 | 形 | 評価 |
|---|---|---|
| **A1. フローに `viewers` を足す**（推奨） | `flow({ viewers: ['sales_manager'] })` | 参加の根拠が定義の中に**明示的に**書かれ、フロー参照画面にも出せる（「この業務を見られる人」）。§8-2 が最初に挙げていた案。読み取り専用であることが型と名前で伝わる |
| A2. マネージャー担当のステップを作る | 「承認」ステップを足す | **業務に無いステップを作ることになる**。§3-5 が狙った「雑なステップ定義を構造的に防ぐ」に真っ向から反し、遷移グラフにも嘘のノードが出る |
| A3. ロール階層 | `sales_manager ⊃ sales_rep` | マネージャーは営業を包含するが**制作は包含しない**。階層は業務の実態と一致しない。しかも「包含すると書きまで継承する」ので (a) の要求（見るだけ）を超える |
| A4. `RoleDef` に権限を書く | `role(..., { canView: ['sales'] })` | **「権限設定を別に書かない」という確定事項（§4-1）を破る**。kintone の失敗構造そのもの |

**推奨: A1。** `FlowDef.viewers?: string[]`。

### 論点B: (b)「複数のロールが同じ段階を操作する」をどう表現するか

| 案 | 形 | 評価 |
|---|---|---|
| **B1. `step.role` を `roles` にする**（推奨） | `step({ roles: ['sales_rep'] })` | 最小。判定は `includes` に変わるだけ。「全員」は §2-3 のとおり `ROLE_KEYS` で導出でき、特殊値が要らない |
| B2. `role` を残して `extraRoles` を足す | `step({ role: 'x', extraRoles: [...] })` | 同じことを2箇所に書く形になり、「主担当」という**存在しない概念**が生まれる。判定も2箇所を見ることになる |
| B3. `role: '*'` の特殊値 | `step({ role: '*' })` | 文字列に意味を持たせると validate とエラーメッセージが特殊化する。§2-3 のとおり不要 |

**推奨: B1。** `StepDef.roles: string[]`（**必須・空不可**）。

⚠ **`role` を残して後方互換にはしない。** 定義は客先1社ぶんしか無く（7ステップ）、
`alt validate` が漏れを全部拾う。二重表現を残すほうが高くつく
（フェーズ5で enum を `Record` から配列に変えたときと同じ判断）。

### 論点C: viewer は本当に「読み取り専用」でよいか（**決着: C1 = 読み取り専用**）

**2026-08-09 決着 — 「一旦読み取り専用でよい」。** 以下は判断の根拠として残す。

**定義とコードが食い違っている**ので、どちらかを直す必要がある。

- `roles.ts`: `role('sales_manager', '営業マネージャー', '**全案件の閲覧・編集**、目標設定')`
- §8-1 確定事項: 「行レベル: **読みは全員、書きは担当者＋管理者**」

マネージャーは担当者でも管理者でもないので、**確定事項に従うなら編集できない**。

| 案 | 評価 |
|---|---|
| **C1. viewer は読み取り専用。`roles.ts` の説明文を直す**（推奨） | 確定事項に合わせる。マネージャーが他人の案件を直接編集する業務上の必然は薄い（ヨミ会は**見る**場で、直すのは担当者）。**説明文を直すのは必須** — 定義とコードの食い違いを残すと、次に読む人が同じところで転ぶ |
| C2. マネージャーも書けるようにする | `rowFilter` に「担当者 **or** マネージャー」を書けるようにする必要がある。条件式で `currentUser.role` を参照できれば定義で書ける（`context` ノードの拡張）。ただし**確定事項の変更**になり、影響が広い |

**推奨: C1。** そして **C2 は後から入れられる**ことを確認しておく —
`rowFilter.write` は `Pred` なので、`context` が `currentUser.role` を取れるようになれば
`or(eq(owner, context('currentUser.id')), eq(context('currentUser.role'), 'sales_manager'))`
と書ける。**いま入れないのは、必要性が確認されていないから**（客先ヒアリングで
「マネージャーが代理入力する」運用が出てきたら、そのとき入れる）。

C2 の実費は調べてある（2026-08-08）。`context` は**任意文字列ではなく閉じた enum**で、
`CONTEXT_NAMES = ['currentUser.id', 'today', 'now']`（`packages/dsl/src/ast.ts:64`）を
zod が実行時にも検証している。足すなら **`CONTEXT_NAMES` に追加 → `AST_VERSION` を
2→3 に上げる → `ContextValues` の供給点3箇所**（`server/src/records.ts` の
`contextValues` / `cli/src/validate.ts` の `EMPTY_CONTEXT` / `sql/src/conformance.test.ts`）
**＋ Go 側**。定型だが安くはない。**C1 なら AST に触らない**、というのも推奨の理由。

### 論点D: viewer の書き込みをどこで止めるか

§2-2 のとおり、`participates` に viewer を足すだけでは穴が開く。

| 案 | 形 | 評価 |
|---|---|---|
| **D1. 参加の種類を判定結果として持つ**（推奨） | `participation(principal, flow): 'admin' \| 'operator' \| 'viewer' \| 'none'` を導入し、`permissionsOf` と書き込み系の入口に渡す | 「参加しているか」と「どう参加しているか」が1つの関数から出る。層1 の責務のまま。403 のメッセージも種類で出し分けられる |
| D2. viewer のとき `usage.access` を `read` に落とす | registry 側で人によって access を変える | 動くが、**`authz.ts` が明示している設計思想に反する** — 「access はそのフローがそのテーブルをどう使うかであって人の偉さではない」（層2 が管理者もバイパスしない理由）。ここを崩すとバインディングが業務の記録として信用できなくなる |
| D3. 各エンドポイントで個別に viewer を弾く | `app.ts` に条件を散らす | 書き込み系を1つ足すたびに**忘れうる**。認可の判定は `authz.ts` に集約する（Go 移植の単位でもある） |

**推奨: D1。** 具体的には:

```ts
export type Participation = 'admin' | 'operator' | 'viewer' | 'none'

export function participation(principal: Principal, flow: FlowDef): Participation {
  if (isAdmin(principal)) return 'admin'
  if (flow.steps.some((s) => s.roles.includes(principal.role))) return 'operator'
  if (flow.viewers?.includes(principal.role) === true) return 'viewer'
  return 'none'
}
```

- `requireParticipation`: `'none'` なら 403（メッセージに**担当ロールと閲覧ロールの両方**を出す）
- `permissionsOf`: `viewer` なら `update: false` / `advance: false`
- **書き込み系（POST / PATCH / advance / 手動チェック）は `viewer` を 403 で弾く**
  — `requireOperator(participation)` を1本足し、既存の `requireTableWrite` と並べる

⚠ **POST の穴（§2-2）はこのフェーズで塞ぐ。** rowFilter が効かない経路なので、
viewer を弾く判定が無いと新規作成が通る。**完了条件に入れる。**

### 論点E: `alt validate` に足すルール

3層のうち**参照整合**と**業務ルール**に足す（定義のルールの置き場は validate 1箇所、が確定事項）。

ルールは**通し番号ではなく kebab-case の名前**で識別する（既存の流儀。`validate.ts` に19本ある）。

| ルール名 | 層 | 内容 | 備考 |
|---|---|---|---|
| `unknown-step-role` | 参照整合 | `step.roles` の各要素がロール宣言に実在する | **既存ルールの配列化**（`validate.ts:263`）。⚠ いまは `where` に**どのロールが不正か**を載せていない。配列になると必須なので、このとき載せる |
| `unknown-flow-viewer` | 参照整合 | `flow.viewers` の各要素が実在する | 新規。上と同じ形 |
| `step-without-role` | 業務ルール | **`step.roles` が空でない** | 新規。空だと**誰も操作できないステップ**になる（管理者しか進められない）。既存の `step-without-exit` と同じ名前の作り |
| `viewer-also-operates` | 業務ルール | **`viewers` と `step.roles` が重複していない** | 新規。「そのロールは既にステップ X を担当しているので viewers から外す」と出す |

⚠ `viewer-also-operates` を**警告でなくエラー**にするのは、`participation()` の判定順
（operator が先）が定義の見た目から読めないため。**曖昧な定義を書けなくする**ほうが、
判定順をドキュメントで補足するより確実。

（既存のロール関連ルールは `duplicate-role-key`（構文層）と `unknown-step-role`（参照整合層）の
2本だけで、`viewers` に対応するものは無い。）

### 論点F: §8-2 論点13（ハードコードされた `ADMIN_ROLE` / `PRINCIPAL_TABLE`）に触れるか

**推奨: 触らない。**

- 論点13 は「プラットフォームが客先定義の名前を直に知っている」問題で、
  **§10-1（基盤として作るか客先アプリの内部構造として作るか）が未決着**なので、
  宣言の仕組みを先に作って決めてしまわない、というのが現在の判断
- 認証を入れる時点で `employee` に IdP の subject 列が要るので、**そのときに一緒に決める**
- ⚠ ただし関係が1つある: 論点C の C2（`rowFilter` で `currentUser.role` を見る）を採ると、
  「管理者」も定義で書ける道が開き、`ADMIN_ROLE` のバイパスを減らせる。
  **C1 を採るので今回は開かない**が、論点13 を解くときの候補として §8-2 に書き足す

解くときのために、いまの広がり具合だけ測っておく（2026-08-08）:
**`ADMIN_ROLE` の使用は1箇所**（`authz.ts:52` の `isAdmin` だけ）、
**`PRINCIPAL_TABLE` は3箇所**（`resolvePrincipal` の SELECT、401 のメッセージ、
`list-query.ts:238` の `me` 糖衣＝ `field.references === PRINCIPAL_TABLE` の判定）。
`authz.ts` のコメントが言うとおり**差し替え点はこの2定数だけ**で、いまも広がっていない。
**急いで解く理由が無い**ことの根拠としてここに残す。

---

## 4. 実装計画

### 4-0. 決めたこと（着手時の判断）

| # | 決定 | 理由 |
|---|---|---|
| A | **`StepDef.role` → `roles: string[]`（必須・空不可）**。後方互換は持たない | 論点B。二重表現を残すほうが高くつく。定義は7ステップしかなく、validate が漏れを全部拾う |
| B | **`FlowDef.viewers?: string[]`（任意）** | 論点A。「見るだけの参加者」は多くのフローで不在なので任意。省略時は空配列と同じ |
| C | **`participation()` で参加の種類を返す**（`admin` / `operator` / `viewer` / `none`） | 論点D。`access` を人によって変えない（層2 の設計思想を守る）。判定を `authz.ts` に集約したまま Go へ移せる |
| D | **viewer は読み取り専用。`roles.ts` の説明文を実態に合わせて直す** | 論点C。確定事項「書きは担当者＋管理者」に従う。定義とコードの食い違いを残さない |
| E | **`viewers` と `step.roles` の重複はエラー** | 論点E ルール4。判定順が定義の見た目から読めないため |
| F | **「全ロール」は `ROLE_KEYS` の導出で書く**。DSL に特殊値を入れない | §2-3。`ROLE_VALUES` に前例がある。ロール追加時の書き足し忘れが構造的に起きない |

### 4-1. DSL の形

```ts
// packages/dsl/src/flow.ts
export interface StepDef {
  key: string
  name: string
  intent: string
  /** 担当ロール（`RoleDef.key`）。**空不可**。複数のロールが同じ段階を操作しうる。 */
  roles: string[]          // ← role: string から変更
  reads: string[]
  writes: string[]
  exit: ExitCondition[]
  next: string[]
}

export interface FlowDef {
  key: string
  name: string
  goal: string
  target: string
  initial: string
  steps: StepDef[]
  bindings: BindingDef[]
  /**
   * 操作しないが読む立場（管理職・監査役）。**読み取り専用でフローに参加する。**
   * ステップの担当ロールと重複して書かない（`alt validate` が弾く）。
   */
  viewers?: string[]       // ← 新規
}
```

zod スキーマも合わせて更新する（`stepDefSchema` の `role` → `roles: z.array(key).min(1)`、
`flowDefSchema` に `viewers: z.array(key).optional()`）。

⚠ **`data/definitions.json` の形が変わる**ので、`alt export --out` を流し直す
（フェーズ5 と同じ手順。サーバのロジック側は下記 T4 で追随する）。

### 4-2. authz の形

```ts
export type Participation = 'admin' | 'operator' | 'viewer' | 'none'

export function participation(principal: Principal, flow: FlowDef): Participation
export function requireParticipation(principal, flow): Participation   // none で 403、種類を返す
export function requireOperator(p: Participation, operation: string): void   // viewer を 403（新規）
export function requireStepRole(principal, step, operation): void      // roles.includes に
export function permissionsOf(input: PermissionInput): Record<string, boolean>  // participation を受け取る
```

`permissionsOf` の判定:

```ts
const update  = participation !== 'viewer' && writable(access) && rowWritable && !historical
const advance = update && (participation === 'admin' || step.roles.includes(principal.role))
```

**配線は既存の形にそのまま乗る**（呼び出し箇所を調べた結果。2026-08-08）:

| 層 | 呼ばれる場所 | 変更 |
|---|---|---|
| 1 | `context.ts:73`（`resolveContext`。**全リクエストの入口で1回**） | `requireParticipation` の戻り値を **`RequestContext` に持たせる**。これで下の層は再計算しない |
| 2 | `app.ts:79 / 91 / 104 / 113`（POST / PATCH / advance / checks） | `requireTableWrite` の**隣に `requireOperator` を並べる**。書き込み経路が既にこの4箇所に集約されているので、**§2-2 の POST の穴もここで閉じる** |
| 3 | `flow-state.ts:88 / 152` | `requireStepRole` が `step.roles.includes` に変わるだけ |
| 4 | `records.ts:140`（`rowFilterOf`）/ `records.ts:209`（`permissionsOf`、**唯一の呼び出し元**） | `permissionsOf` に `ctx.participation` を渡す |

⚠ **判定は `authz.ts` に集約したままにする**（Go 移植の単位でもある）。
`app.ts` に条件を散らさない、という既存の形を崩さない。

### 4-3. タスク（依存順）

| # | 何を | どこ | 完了の目印 |
|---|---|---|---|
| T1 | `StepDef.roles` / `FlowDef.viewers`（型・zod・ビルダー） | `dsl/src/flow.ts`（`StepDef:133` / `StepSpec:150` / `step():162` / `stepDefSchema:309` / `FlowDef:170-201` / `flowDefSchema:315-334`） | 型エラーが波及先に出る（＝漏れが機械で分かる） |
| T2 | 定義の移行 | `definitions/src/flows/sales.ts`（全7ステップ + `outcome()` ヘルパ `:186`）/ `roles.ts` | `roles: ['sales_rep']` ×7、`viewers: ['sales_manager']`、説明文修正（決定D）、`ROLE_KEYS` を export（決定F） |
| T3 | validate ルール4件 | `cli/src/validate.ts:263`（既存の配列化）＋新規3本 | 論点E の表。**エラーは論理キー＋直し方つき**。`where` に不正なロール名を載せる |
| T4 | `participation()` と4層 | `server/src/authz.ts:96-107, 125-131, 161-170` | 論点D の形 |
| T5 | 配線 | `server/src/context.ts:73` / `app.ts:79,91,104,113` / `records.ts:209` | §4-2 の表。**viewer の POST が 403** |
| T6 | FE: 担当ロールの複数表示 | `apps/main/src/flows/FlowReference.tsx:135` | 「担当」が配列に。フローに「**この業務を見られる人**」の行を足す |
| T7 | FE: 開発用ユーザーの説明文 | `apps/main/src/shell/auth/dev-user.ts:26-29` | 鈴木の `note` が「**403 になる**（どのステップも担当していない…）」のまま。**実態と食い違うので直す** |
| T8 | FE: 編集不可の理由に viewer を足す | `apps/main/src/flows/sales/` の編集不可表示 | フェーズ7 決定S（**入れない理由を言葉で出す**）に「閲覧のみの立場だから」を追加 |
| T9 | 動作確認 | — | 鈴木（`sales_manager`）で §5 を通す |

⚠ **T1 を先にやると、型エラーが波及先を全部教えてくれる。** 手で探さない。
（`packages/*/src/*.d.ts` は `.gitignore` 済みの生成物で、**既に内容が古い**。手で直す対象ではない。）

小掃除（ついでに済ませる）: `apps/main/src/flows/sales/labels.ts:26` の `roleLabel` は
**呼び出し元が無く**、`FlowReference.tsx:97` の `roleName` と実装が重複している。
T6 で片方に寄せる（フェーズ5 で手書きラベルを消した線の残り）。

### 4-4. 壊れるテスト（意図的に固定されている挙動）

| 場所 | いま固定していること | どうなるか |
|---|---|---|
| `server/src/authz.test.ts:120-137` | **`MANAGER` の `GET /api/deal?flow=sales` が 403** | **期待値ごと反転する**。テスト内に「§8-2 論点12。仕様が決まったらこのテストごと変える」と書いてある — その時が来た |
| `server/src/flow-state.test.ts:77-81` | 「担当ロールでなければ 403（ステップ操作の層）」を `MANAGER` の advance で見ている | ⚠ **ステータスは 403 のままだが、止まる層が変わる**（層3 → 層2 の `requireOperator`）。このままだと**層3 のテストが層3 を通らなくなる** |

⚠ 上の2つ目は**カバレッジの静かな劣化**なので、置き換えを明示的にやる。
層3（ステップ操作）を正しく突くには「**フローには参加しているが、そのステップの担当ではない**」
利用者が要る。営業フローは全ステップが `sales_rep` なのでそういう人が作れない。
→ **テスト用フィクスチャに複数ロールのステップを持つフローを1本足す**。
これは完了条件5（複数ロールのどれでも advance できる）と**同じ材料**なので、まとめて作る。

---

## 5. 完了条件（確定）と検証結果

すべて満たした（2026-08-09）。

| # | 条件 | 結果 |
|---|---|---|
| 1 | 鈴木（`sales_manager`）で**案件一覧が見える**（403 でない） | **済**。`GET /api/deal?flow=sales` が 200、`total: 5` |
| 2 | 鈴木には**編集の手段が無い**。入れない理由が「閲覧のみの立場」と言葉で出る（フェーズ7 決定S を退行させない） | **済**。`_permissions` が `{update:false, advance:false}`（山田は `{true,true}`）。FE は決定S の説明を viewer 用に出し分ける |
| 3 | 鈴木は API を直接叩いても 403（`PATCH` / `advance` / 手動チェック） | **済**。3経路とも 403。`authz.test.ts` に固定 |
| 4 | **鈴木が `POST` で案件を新規作成できない**（§2-2 の穴が塞がっている） | **済**。403。同じ body で佐藤（担当ロール）は 201 になることも同じテストで示す |
| 5 | `roles` が複数のステップで、**そのどのロールでも `advance` できる** | **済**。`authz.test.ts`「複数の担当ロール（純関数）」。フェーズ9 の前提がここで保証される |
| 6 | `alt validate` が4件のルールで落ちる（すべて直し方つき） | **済**。`unknown-step-role`（どのロールが不正かを `where` に載せる）/ `unknown-flow-viewer` / `step-without-role` / `viewer-also-operates`。`validate.test.ts` 4件 |
| 7 | フロー参照画面に**複数の担当ロール**と「この業務を見られる人」が出る | **済**。`step.roles.map(roleName).join(' / ')` と、フロー見出しの `viewers` 行 |
| 8 | 山田（`sales_rep`）の既存の挙動が**何も変わっていない** | **済**。既存テストは1件も期待値を変えていない（変えたのは §4-4 の2件だけで、どちらも論点12 を固定していたもの） |
| 9 | `docker compose exec dev pnpm verify` が通る | **済**。**361 テスト**（フェーズ7 時点は 347）|

### 5-1. 実装中に決めたこと

| # | 決定 | 理由 |
|---|---|---|
| G | **「403 になる人」の役を鈴木から森（`production`）に移した**。`support.ts` のフィクスチャと `alt seed` の従業員、開発用ユーザー切替に足した | 「フローに参加していない」を確かめられる人が**居なくなった**（鈴木が viewers になったので）。参加していない場合の 403 は残すべき挙動なので、確かめられる状態も残す |
| H | **層3（ステップ操作）は純関数のユニットテストで固定する** | 層3 を HTTP で突くには「フローの担当だが、そのステップの担当ではない」人が要るが、営業フローは全ステップが `sales_rep` 単独なので作れない。フィクスチャ用のフローを1本でっち上げるより、`requireStepRole` / `participation` / `permissionsOf` が純関数であることを使うほうが安く、複数ロールの検証（条件5）と同じ材料で済む |
| I | **FE の「編集に入れない理由」は、定義の `viewers` と従業員の `role` から出し分ける** | 可否を決めるのは `_permissions`（サーバ）のままで、**説明の文面だけ**を分ける。viewer に「この案件の担当は X」と出すと嘘になる（自分が担当の案件でも編集できないため）。定義を値として読むのはフェーズ4 決定B の線の内側 |

⚠ **`flow-state.test.ts` の「担当ロールでなければ 403」は、止まる層が変わった**（層3 → `requireOperator`）。
403 のままなので**テストは黙って通り続ける**が、意味は変わっている。名前とコメントを
書き換え、層3 の担保が上の決定H に移ったことを本文に書いた。**静かなカバレッジ劣化を
残さない**ための処置。

動作確認の手順:

```sh
docker compose exec dev pnpm alt validate
docker compose exec dev pnpm alt apply --recreate
docker compose exec dev pnpm alt export --out data/definitions.json   # ← 形が変わるので必須
docker compose exec dev pnpm alt seed --reset --deals 10000
docker compose exec -d dev pnpm serve
docker compose exec -d dev pnpm dev
```

---

## 6. このフェーズで作らないもの

| | 理由 |
|---|---|
| ロール階層 | 論点A・B。業務の実態と一致しない |
| マネージャーが他人の案件を編集できるようにする | 論点C（決定D）。確定事項「書きは担当者＋管理者」に従う。必要になったら `context('currentUser.role')` で後から入る |
| §8-2 論点13（`ADMIN_ROLE` / `PRINCIPAL_TABLE` の宣言化） | 論点F。認証を入れる時点で一緒に決める |
| ロールごとの画面出し分け（メニューの制御） | `_permissions` が既にレコード単位で答えている。ナビの制御が要るなら、それが分かってから |
| `viewers` のテーブル単位指定 | フロー単位で足りる。バインディング単位にすると kintone の権限設定に近づく |
| 目標（quota）テーブル | `roles.ts` がマネージャーの職掌に挙げているが、このフェーズは認可だけ |

---

## 7. ここまで来たら

- **§8-2 論点12 は解決**する。§8-2 から落とし、§8-1 に「フェーズ8で決めたもの」として記録する
- **フェーズ9（改善要望の受付）の前提が揃う** — 全ロールが起票する業務が定義で書ける
- 論点13 の解き方に候補が1つ増える（論点F の注記）。§8-2 に書き足す
