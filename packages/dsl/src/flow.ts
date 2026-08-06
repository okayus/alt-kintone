/**
 * 業務フロー定義。docs/product-concept.md §3-5、docs/domain-model.md §6
 *
 * alt-kintone では**業務フローが第一級の概念**で、テーブルは業務フローに
 * バインドされて初めて使える。この構造がそのままバックエンドのAPI生成・認可・
 * FEの現在地表示の入力になる。
 *
 * table.ts と同じく**型パズルは入れない**。持つのは構造だけで、フィールドの
 * 存在検査や参照整合は `alt validate` が registry と突き合わせて行う。
 * 定義は最終的にただの JSON になり、Go 側はそれを読むだけ（§4-0）。
 */
import { predSchema, type Pred } from './ast.js'
import { z } from 'zod'
import type { TableDef } from './table.js'

// ---------------------------------------------------------------------------
// 出口条件
// ---------------------------------------------------------------------------

/**
 * 自動判定の出口条件。条件式は SQL に変換され、一覧で一括評価される
 * （docs/condition-ast.md §5-1）。営業が何もしなくても勝手に埋まる。
 */
export interface AutoCheck {
  kind: 'auto'
  key: string
  label: string
  /**
   * どうすれば充足するか。営業が画面で読む説明文
   * （docs/impl/phase-5-flow-reference.md 決定C）。
   *
   * ⚠ 手書きなので、条件式を変えて直し忘れるとズレる。だから画面では
   * `referencedFields`（AST からの機械抽出）を併記して、ズレを目視できるようにする（決定D）。
   */
  howTo: string
  condition: Pred
}

/** 人が判断するしかない出口条件。状態は `_manual_check` に持つ。 */
export interface ManualCheck {
  kind: 'manual'
  key: string
  label: string
  /** どういう状態なら ✓ にしてよいか。判断基準を書く。 */
  howTo: string
}

export type ExitCondition = AutoCheck | ManualCheck

/**
 * `key` はラベルと独立した**明示キー**。
 *
 * ラベルをキーにすると、文言を直した瞬間に既存のチェック状態・履歴が
 * 別物になる（docs/product-concept.md §3-5）。表示は変わってよいが、
 * 「何を確認したか」の同一性は変わってはいけない。
 */
export function check(key: string, label: string, howTo: string, condition: Pred): AutoCheck {
  return { kind: 'auto', key, label, howTo, condition }
}

export function manualCheck(key: string, label: string, howTo: string): ManualCheck {
  return { kind: 'manual', key, label, howTo }
}

// ---------------------------------------------------------------------------
// バインディング
// ---------------------------------------------------------------------------

/**
 * docs/product-concept.md §3-3。**ライフサイクルの分類**であって、
 * 状態機械の主体（`FlowDef.target`）とは別の軸。
 *
 *  - primary   … このフローが生成・所有する。フロー廃止で一緒に廃止候補
 *  - reference … 他フローが所有するテーブルを読む
 *  - master    … 複数業務が共通で参照する基盤データ
 */
export const BINDING_ROLES = ['primary', 'reference', 'master'] as const
export type BindingRole = (typeof BINDING_ROLES)[number]

/**
 * 行レベル認可（docs/product-concept.md §4-1）。
 *
 * 専用の仕組みを作らず**条件式 DSL をそのまま再利用する**。`source: 'root'` は
 * バインド先のテーブル（`BindingDef.table`）を指し、`currentUser.id` は
 * 認証済みユーザーの ID にバインドされる。
 *
 * 書かなければ制限なし。owner を持たないマスタ類は自然に対象外になる。
 * 読みの制限は持たない（「読みは全員、書きは担当者＋管理者」が確定事項）。
 */
export interface RowFilter {
  /** 書き込みを許す行の条件。 */
  write: Pred
}

export interface BindingDef {
  table: string
  role: BindingRole
  /** 何のために使うか。**必須**。バインディングを業務上の意味の記録にするため（§3-3）。 */
  purpose: string
  rowFilter?: RowFilter
}

/**
 * 使用テーブルと `access` は書かない。ステップの reads / writes から導出する
 * （§3-3）。二重に書かせると書き漏れと矛盾が起きる。
 */
export function bind(
  table: TableDef,
  role: BindingRole,
  purpose: string,
  opts: { rowFilter?: RowFilter } = {},
): BindingDef {
  const binding: BindingDef = { table: table.name, role, purpose }
  // 未指定のときはキーごと持たない（JSON にした形をそのまま契約にするため）
  if (opts.rowFilter !== undefined) binding.rowFilter = opts.rowFilter
  return binding
}

// ---------------------------------------------------------------------------
// ステップ
// ---------------------------------------------------------------------------

export interface StepDef {
  key: string
  name: string
  /**
   * この段階で何を目指すのか。「ステージは**買い手の状態変化**で定義する」
   * （docs/sales-domain.md §4-5）という原則を、定義そのものに残す場所
   * （docs/impl/phase-5-flow-reference.md 決定E）。kintone には原理的に持てない情報。
   */
  intent: string
  /** 担当ロール。`RoleDef.key` を指す。 */
  role: string
  /** 読むテーブル名。 */
  reads: string[]
  /** 書くテーブル名。 */
  writes: string[]
  exit: ExitCondition[]
  /**
   * 次のステップのキー。有向グラフで、分岐・差し戻し・スキップを表現する
   * （§3-5）。並列は持たない。空なら終端。
   */
  next: string[]
}

export interface StepSpec {
  key: string
  name: string
  intent: string
  role: string
  reads?: TableDef[]
  writes?: TableDef[]
  exit: ExitCondition[]
  next: string[]
}

export function step(spec: StepSpec): StepDef {
  return {
    key: spec.key,
    name: spec.name,
    intent: spec.intent,
    role: spec.role,
    reads: (spec.reads ?? []).map((t) => t.name),
    writes: (spec.writes ?? []).map((t) => t.name),
    exit: spec.exit,
    next: spec.next,
  }
}

// ---------------------------------------------------------------------------
// フロー
// ---------------------------------------------------------------------------

export interface FlowDef {
  key: string
  name: string
  /** このフローが達成しようとしていること。 */
  goal: string
  /**
   * ステップを進む主体のテーブル名。
   *
   * `primary` バインドとは**別の概念**。primary は「誰が所有するか」（ライフサイクル）、
   * target は「どのレコードが状態機械に乗るか」。営業フローは `activity` も
   * 生成・所有する（＝primary）が、ステップを進むのは `deal` だけ。
   *
   * この値が、出口条件 AST の `source: 'root'` が指すテーブルであり、
   * `_flow_state.table_name` に入る値でもある。
   */
  target: string
  /** 新しいレコードが最初に置かれるステップのキー。 */
  initial: string
  steps: StepDef[]
  bindings: BindingDef[]
}

export interface FlowSpec {
  key: string
  name: string
  goal: string
  target: TableDef
  initial: string
  steps: StepDef[]
  bindings: BindingDef[]
}

export function flow(spec: FlowSpec): FlowDef {
  return {
    key: spec.key,
    name: spec.name,
    goal: spec.goal,
    target: spec.target.name,
    initial: spec.initial,
    steps: spec.steps,
    bindings: spec.bindings,
  }
}

// ---------------------------------------------------------------------------
// 導出
// ---------------------------------------------------------------------------

/**
 * `write` は書き込み専用という意味ではなく、**読みも含む**（§3-3 の
 * 「reads だけなら read、writes があれば write」）。target のように
 * 書くなら当然読むテーブルを reads に重ねて書かせないための規則。
 * `readwrite` は定義側が両方に明示したときだけ出る。
 */
export const ACCESS_LEVELS = ['read', 'write', 'readwrite'] as const
export type Access = (typeof ACCESS_LEVELS)[number]

export interface TableUsage {
  access: Access
  /** 実際に使っているステップのキー（宣言順）。 */
  steps: string[]
}

/**
 * ステップの reads / writes から「使用テーブルと access」を導出する（§3-3）。
 *
 * これがバインディングの実体で、`alt bindings --flow=X` と管理画面の
 * 双方向ビューが読むもの。横断マスタ（`global: true`）の実参照記録も
 * この導出の副産物であって、専用の仕組みではない（§3-4 の案C）。
 */
export function usedTables(def: FlowDef): Record<string, TableUsage> {
  const reads = new Set<string>()
  const writes = new Set<string>()
  const steps = new Map<string, string[]>()

  const record = (table: string, stepKey: string): void => {
    const list = steps.get(table)
    if (list === undefined) steps.set(table, [stepKey])
    else if (!list.includes(stepKey)) list.push(stepKey)
  }

  for (const s of def.steps) {
    for (const table of s.reads) {
      reads.add(table)
      record(table, s.key)
    }
    for (const table of s.writes) {
      writes.add(table)
      record(table, s.key)
    }
  }

  return Object.fromEntries(
    [...steps].map(([table, stepKeys]) => {
      const r = reads.has(table)
      const w = writes.has(table)
      const access: Access = r && w ? 'readwrite' : w ? 'write' : 'read'
      return [table, { access, steps: stepKeys }]
    }),
  )
}

// ---------------------------------------------------------------------------
// zod スキーマ（定義そのものの検証）
// ---------------------------------------------------------------------------

const key = z.string().min(1)

export const exitConditionSchema: z.ZodType<ExitCondition> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('auto'),
    key,
    label: z.string().min(1),
    howTo: z.string().min(1),
    condition: predSchema,
  }),
  z.object({
    kind: z.literal('manual'),
    key,
    label: z.string().min(1),
    howTo: z.string().min(1),
  }),
])

export const bindingDefSchema: z.ZodType<BindingDef> = z.object({
  table: key,
  role: z.enum(BINDING_ROLES),
  purpose: z.string().min(1),
  rowFilter: z.object({ write: predSchema }).optional(),
})

export const stepDefSchema: z.ZodType<StepDef> = z.object({
  key,
  name: z.string().min(1),
  intent: z.string().min(1),
  role: key,
  reads: z.array(key),
  writes: z.array(key),
  exit: z.array(exitConditionSchema),
  next: z.array(key),
})

export const flowDefSchema: z.ZodType<FlowDef> = z
  .object({
    key,
    name: z.string().min(1),
    goal: z.string().min(1),
    target: key,
    initial: key,
    steps: z.array(stepDefSchema).min(1),
    bindings: z.array(bindingDefSchema),
  })
  // ステップキーの一意性と initial の実在は、参照整合ではなく定義そのものの
  // 内部整合。フロー1本を見れば判定できるので、ここ（構文層）で弾く。
  .refine((f) => new Set(f.steps.map((s) => s.key)).size === f.steps.length, {
    message: 'ステップのキーが重複している',
    path: ['steps'],
  })
  .refine((f) => f.steps.some((s) => s.key === f.initial), {
    message: 'initial に指定されたステップが steps に無い',
    path: ['initial'],
  })
