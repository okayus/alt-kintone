/**
 * 定義の検証。docs/product-concept.md §5-4、docs/impl/phase-2-cli.md
 *
 * **AIの自己修正ループ（書く → validate → 直す）が閉じるかは、ここの質で決まる。**
 * 検出できることより、検出したあと何を直せばいいかが分かることを優先する。
 * 各エラーは「どこが」（`where`）「何が駄目で」（`message`）「どう直すか」（`hint`）を持つ。
 *
 * 定義は TypeScript なので実行時に行番号は取れない。位置は論理的なキー
 * （`flow=sales step=proposed check=timing_confirmed`）で示す。
 *
 * この関数は**純関数**。ファイルも DB も触らない。壊れた定義のテストが
 * 実行時ロードの仕組みなしで書けるのはそのため。
 */
import {
  definitionBundleSchema,
  usedTables,
  type DefinitionBundle,
  type FlowDef,
  type StepDef,
} from '@alt/dsl'
import { compilePred, type ContextValues } from '@alt/sql'
import type { z } from 'zod'

export const LAYERS = ['syntax', 'reference', 'rule'] as const
export type Layer = (typeof LAYERS)[number]

export interface ValidationError {
  layer: Layer
  /** kebab-case の識別子。表示文言と分ける（enum の値と同じ理由）。 */
  rule: string
  /** 論理的な位置。例: `{ flow: 'sales', step: 'proposed', check: 'timing_confirmed' }` */
  where: Record<string, string>
  message: string
  /** どう直すか。候補の列挙を含む。 */
  hint?: string
}

/** 条件式が SQL に変換できるかだけを見るので、コンテキストの実値は要らない。 */
const EMPTY_CONTEXT: ContextValues = { 'currentUser.id': null, today: null, now: null }

export function validate(bundle: DefinitionBundle): ValidationError[] {
  const syntax = validateSyntax(bundle)
  // 構文が壊れていると以降の層は前提（キーがある・配列である）が崩れるので走らせない。
  // コンパイラが構文エラーの段階で型検査に進まないのと同じ。
  if (syntax.length > 0) return syntax
  return [...validateReferences(bundle), ...validateRules(bundle)]
}

// ---------------------------------------------------------------------------
// 層1: 構文
// ---------------------------------------------------------------------------

function validateSyntax(bundle: DefinitionBundle): ValidationError[] {
  const parsed = definitionBundleSchema.safeParse(bundle)
  if (!parsed.success) {
    return flattenIssues(parsed.error.issues).map((issue) => ({
      layer: 'syntax' as const,
      rule: 'schema',
      where: describePath(bundle, issue.path),
      message: issue.message,
    }))
  }

  // ここから先はスキーマに合致している前提で読める
  const errors: ValidationError[] = []

  for (const [key, table] of Object.entries(bundle.tables)) {
    if (table.name === key) continue
    errors.push({
      layer: 'syntax',
      rule: 'registry-key-mismatch',
      where: { table: key },
      message: `registry のキー "${key}" とテーブル名 "${table.name}" が食い違う`,
      hint: 'registry() は TableDef.name をキーにする。手で組み立てているなら table() の第1引数に揃える',
    })
  }

  for (const key of duplicates(bundle.flows.map((f) => f.key))) {
    errors.push({
      layer: 'syntax',
      rule: 'duplicate-flow-key',
      where: { flow: key },
      message: `フローキー "${key}" が重複している`,
      hint: 'フローキーは _flow_state.flow に入る識別子。どちらか一方を別のキーに変える',
    })
  }

  for (const key of duplicates(bundle.roles.map((r) => r.key))) {
    errors.push({
      layer: 'syntax',
      rule: 'duplicate-role-key',
      where: { role: key },
      message: `ロールキー "${key}" が重複している`,
      hint: 'ロールキーは employee.role に入る識別子。どちらか一方を別のキーに変える',
    })
  }

  return errors
}

type Issue = z.core.$ZodIssue

/**
 * union の issue を1つに畳む。
 *
 * zod は union が外れると**候補ごとの内訳を全部**返す。条件式 AST（`Pred`）は
 * 8ノードの union なので、1箇所の誤りが8件のエラーになって「どれを直せばいいか」が
 * 消える。`Pred` は判別可能 union にできない（`type` の値でノードが決まるが、
 * zod の discriminatedUnion は再帰スキーマと併用しにくい）ので、**最も深くまで
 * 一致した候補**を書き手の意図とみなす。同じ深さなら誤りが少ないほうを採る。
 *
 * 例: `{ type: 'compare', op: 'equals', ... }` なら compare 候補だけが `op` で落ち、
 * ほかの候補は `type` で落ちる → compare の「op が不正」だけが残る。
 */
function flattenIssues(issues: readonly Issue[]): Issue[] {
  return issues.flatMap((issue) => {
    if (issue.code !== 'invalid_union') return [issue]
    let best: readonly Issue[] | undefined
    for (const candidate of issue.errors) {
      if (candidate.length > 0 && (best === undefined || closer(candidate, best))) best = candidate
    }
    if (best === undefined) return [issue]
    return flattenIssues(best.map((sub) => rebase(sub, issue.path)))
  })
}

/** より「意図した候補らしい」か。深く進めたほう、同じなら誤りが少ないほう。 */
function closer(a: readonly Issue[], b: readonly Issue[]): boolean {
  return depth(a) === depth(b) ? a.length < b.length : depth(a) > depth(b)
}

function depth(issues: readonly Issue[]): number {
  return issues.reduce((max, issue) => Math.max(max, issue.path.length), 0)
}

/**
 * union の内訳の path が union 自身の位置からの相対か絶対かは zod の実装依存なので、
 * 既に接頭辞が付いているときだけ素通しする。
 */
function rebase(issue: Issue, prefix: readonly PropertyKey[]): Issue {
  const alreadyAbsolute = prefix.every((segment, i) => issue.path[i] === segment)
  return alreadyAbsolute ? issue : { ...issue, path: [...prefix, ...issue.path] }
}

/**
 * zod の path（`flows.0.steps.2.exit.1.condition.left`）を論理的な位置に読み替える。
 * 添字のままだと定義ファイルのどこを直せばいいか分からない。
 */
function describePath(
  bundle: DefinitionBundle,
  path: readonly PropertyKey[],
): Record<string, string> {
  const where: Record<string, string> = {}
  const [head, ...tail] = path

  if (head === 'tables') {
    if (tail.length > 0) where['table'] = String(tail[0])
    if (tail.length > 1) where['at'] = tail.slice(1).join('.')
    return where
  }

  if (head === 'roles') {
    const role = bundle.roles?.[Number(tail[0])]
    if (role !== undefined) where['role'] = role.key
    if (tail.length > 1) where['at'] = tail.slice(1).join('.')
    return where
  }

  if (head === 'flows') {
    const flow = bundle.flows?.[Number(tail[0])]
    if (flow !== undefined) where['flow'] = flow.key
    let rest = tail.slice(1)

    if (flow !== undefined && rest[0] === 'steps') {
      const step = flow.steps[Number(rest[1])]
      if (step !== undefined) where['step'] = step.key
      rest = rest.slice(2)

      if (step !== undefined && rest[0] === 'exit') {
        const exit = step.exit[Number(rest[1])]
        if (exit !== undefined) where['check'] = exit.key
        rest = rest.slice(2)
      }
    }

    if (rest.length > 0) where['at'] = rest.join('.')
    return where
  }

  if (path.length > 0) where['at'] = path.join('.')
  return where
}

// ---------------------------------------------------------------------------
// 層2: 参照整合
// ---------------------------------------------------------------------------

function validateReferences(bundle: DefinitionBundle): ValidationError[] {
  const errors: ValidationError[] = []
  const tableNames = Object.keys(bundle.tables)
  const roleKeys = bundle.roles.map((r) => r.key)

  for (const [name, table] of Object.entries(bundle.tables)) {
    for (const [fieldName, field] of Object.entries(table.fields)) {
      if (field.references === undefined || bundle.tables[field.references] !== undefined) continue
      errors.push({
        layer: 'reference',
        rule: 'unknown-reference-table',
        where: { table: name, field: fieldName },
        message: `reference("${field.references}") の参照先テーブルが定義されていない`,
        hint: `registry() に並んでいるテーブル: ${candidates(tableNames)}`,
      })
    }
  }

  for (const flow of bundle.flows) {
    const stepKeys = flow.steps.map((s) => s.key)

    if (bundle.tables[flow.target] === undefined) {
      errors.push({
        layer: 'reference',
        rule: 'unknown-flow-target',
        where: { flow: flow.key },
        message: `target "${flow.target}" のテーブルが定義されていない`,
        hint: `target はステップを進む主体のテーブル。候補: ${candidates(tableNames)}`,
      })
    }

    for (const binding of flow.bindings) {
      if (bundle.tables[binding.table] !== undefined) continue
      errors.push({
        layer: 'reference',
        rule: 'unknown-binding-table',
        where: { flow: flow.key, binding: binding.table },
        message: `bind() したテーブル "${binding.table}" が定義されていない`,
        hint: `候補: ${candidates(tableNames)}`,
      })
    }

    for (const step of flow.steps) {
      const at = { flow: flow.key, step: step.key }

      for (const [kind, list] of [
        ['reads', step.reads],
        ['writes', step.writes],
      ] as const) {
        for (const table of list) {
          if (bundle.tables[table] !== undefined) continue
          errors.push({
            layer: 'reference',
            rule: 'unknown-step-table',
            where: { ...at, [kind]: table },
            message: `${kind} のテーブル "${table}" が定義されていない`,
            hint: `候補: ${candidates(tableNames)}`,
          })
        }
      }

      if (!roleKeys.includes(step.role)) {
        errors.push({
          layer: 'reference',
          rule: 'unknown-step-role',
          where: at,
          message: `担当ロール "${step.role}" が宣言されていない`,
          hint: `roles.ts に role() で宣言する。宣言済み: ${candidates(roleKeys)}`,
        })
      }

      for (const next of step.next) {
        if (stepKeys.includes(next)) continue
        errors.push({
          layer: 'reference',
          rule: 'unknown-next-step',
          where: at,
          message: `next の "${next}" に対応するステップが無い`,
          hint: `このフローのステップ: ${candidates(stepKeys)}`,
        })
      }

      errors.push(...validateConditions(bundle, flow, step))
    }
  }

  return errors
}

/**
 * 出口条件の条件式の参照整合。
 *
 * 自前で AST を歩かず `compilePred` を呼ぶ。**SQL に変換できたなら、すべての field が
 * registry で解決できている**という、書き直しより強い検査になる。
 */
function validateConditions(
  bundle: DefinitionBundle,
  flow: FlowDef,
  step: StepDef,
): ValidationError[] {
  // target が解決できないと全条件式が同じ理由で落ちるだけなので、報告を重複させない
  if (bundle.tables[flow.target] === undefined) return []

  const errors: ValidationError[] = []
  for (const exit of step.exit) {
    if (exit.kind !== 'auto') continue
    try {
      compilePred(exit.condition, {
        registry: bundle.tables,
        rootTable: flow.target,
        rootAlias: 'r',
        values: EMPTY_CONTEXT,
      })
    } catch (error) {
      errors.push({
        layer: 'reference',
        rule: 'unresolved-condition',
        where: { flow: flow.key, step: step.key, check: exit.key },
        message: `条件式を SQL に変換できない: ${error instanceof Error ? error.message : String(error)}`,
        hint:
          `source: "root" は target（${flow.target}）を指す。リレーションを辿る path には` +
          '外部キーのフィールド名そのものを書く（例: ["contactId", "isDecisionMaker"]）',
      })
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// 層3: 業務ルール
//
// ここが効く（§5-4）。定義の質をレビューではなくツールが担保する部分。
// ---------------------------------------------------------------------------

function validateRules(bundle: DefinitionBundle): ValidationError[] {
  const errors: ValidationError[] = []
  const used = new Set<string>()

  for (const flow of bundle.flows) {
    const usage = usedTables(flow)
    for (const table of Object.keys(usage)) used.add(table)

    const primary = flow.bindings.filter((b) => b.role === 'primary').map((b) => b.table)
    if (!primary.includes(flow.target)) {
      errors.push({
        layer: 'rule',
        rule: 'target-not-primary',
        where: { flow: flow.key },
        message: `target "${flow.target}" が primary バインドされていない`,
        hint:
          'target はこのフローが状態機械として進めるレコード。所有者が別フローなら、' +
          `そちらを target にする。いまの primary: ${candidates(primary)}`,
      })
    }

    for (const step of flow.steps) {
      const at = { flow: flow.key, step: step.key }

      // 論点10 の決着（§8-1 フェーズ2）: next が空なら免除、空でなければ出口条件が要る
      if (step.next.length > 0 && step.exit.length === 0) {
        errors.push({
          layer: 'rule',
          rule: 'step-without-exit',
          where: at,
          message: `出口条件が1つも無いが、next に遷移先がある（${step.next.join(', ')}）`,
          hint:
            '進行中のステップには出口条件が要る。自動判定できないなら manualCheck() を足す。' +
            '出る先が無い決着ステップなら next を空にする',
        })
      }

      for (const key of duplicates(step.exit.map((e) => e.key))) {
        errors.push({
          layer: 'rule',
          rule: 'duplicate-exit-key',
          where: { ...at, check: key },
          message: `出口条件のキー "${key}" がステップ内で重複している`,
          hint: 'キーは _manual_check の識別子で、チェック状態の同一性を担う。別のキーにする',
        })
      }
    }

    for (const key of unreachableSteps(flow)) {
      errors.push({
        layer: 'rule',
        rule: 'unreachable-step',
        where: { flow: flow.key, step: key },
        message: `initial（${flow.initial}）からどの経路でも到達できない`,
        hint: 'どこかのステップの next に足すか、使わないなら削る',
      })
    }

    const declared = flow.bindings.map((b) => b.table)
    for (const table of Object.keys(usage)) {
      if (declared.includes(table) || bundle.tables[table]?.global === true) continue
      errors.push({
        layer: 'rule',
        rule: 'undeclared-table',
        where: { flow: flow.key, table },
        message: 'ステップで使っているが bindings に宣言が無い',
        hint:
          `bindings に bind(${table}, role, purpose) を足す。` +
          '複数業務が共通で参照する基盤データなら table() に global: true を付ける',
      })
    }

    for (const binding of flow.bindings) {
      if (usage[binding.table] !== undefined) continue
      errors.push({
        layer: 'rule',
        rule: 'unused-binding',
        where: { flow: flow.key, table: binding.table },
        message: 'bindings に宣言があるが、どのステップの reads / writes にも出てこない',
        hint: '使うステップの reads / writes に足すか、バインドを削る（access は導出される）',
      })
    }
  }

  for (const [name, table] of Object.entries(bundle.tables)) {
    if (used.has(name) || table.global) continue
    errors.push({
      layer: 'rule',
      rule: 'orphan-table',
      where: { table: name },
      message: 'どの業務フローからも使われていない',
      hint:
        'バインドされていないテーブルは API が生えず、使えない（§3-2）。' +
        'どこかのフローの reads / writes に足すか、定義から削る',
    })
  }

  return errors
}

/** `initial` から `next` を辿って到達できないステップのキー。 */
function unreachableSteps(flow: FlowDef): string[] {
  const byKey = new Map(flow.steps.map((s) => [s.key, s]))
  const seen = new Set<string>()
  const queue = [flow.initial]

  while (queue.length > 0) {
    const key = queue.pop()
    if (key === undefined || seen.has(key)) continue
    seen.add(key)
    for (const next of byKey.get(key)?.next ?? []) queue.push(next)
  }

  return flow.steps.filter((s) => !seen.has(s.key)).map((s) => s.key)
}

// ---------------------------------------------------------------------------

function duplicates(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) dup.add(key)
    seen.add(key)
  }
  return [...dup]
}

function candidates(names: readonly string[]): string {
  return names.length === 0 ? '（無し）' : names.join(', ')
}
