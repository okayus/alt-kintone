/**
 * 定義バンドルの差分。docs/impl/phase-10-definition-diff.md §3 論点B
 *
 * **汎用の JSON diff にはしない。** `fields.competitor.required: false → true` のような
 * 出力は起票者にも開発者にも読めない。ここが出すのは「項目が必須になります」という
 * 業務の単位で、そのために定義が持っているラベル・意図・充足のしかたを使い切る。
 *
 * 比較の向きは `before`（適用済み）→ `after`（作業ツリー）。**適用したら空になる**
 * のが正しい振る舞いで、それがそのまま「変更なし」の判定になる。
 */
import {
  referencedFields,
  type AutoCheck,
  type BindingDef,
  type DefinitionBundle,
  type ExitCondition,
  type FieldDef,
  type FlowDef,
  type Registry,
  type StepDef,
  type TableDef,
} from '@alt/dsl'
import { sameValue } from './equal.js'
import { mergeFlowGraph } from './merge-graph.js'
import type { BundleDiff, DiffEntry, MergedGraph } from './types.js'
import {
  beforeAfter,
  bindingRoleLabel,
  describeFieldRef,
  fieldKindLabel,
  fieldTypeLabel,
  plusMinus,
} from './words.js'

export function diffBundles(before: DefinitionBundle, after: DefinitionBundle): BundleDiff {
  const entries: DiffEntry[] = []
  const add = (entry: DiffEntry): void => void entries.push(entry)

  diffTables(before, after, add)
  diffRoles(before, after, add)
  const graphs = diffFlows(before, after, add)

  return { entries, graphs, impacts: [], notCounted: [], empty: entries.length === 0 }
}

type Add = (entry: DiffEntry) => void

const whereTable = (table: TableDef): string => `データ「${table.label}」`
const whereFlow = (flow: FlowDef): string => `業務フロー「${flow.name}」`
const whereStep = (step: StepDef): string => `ステップ「${step.name}」`

/** 両側のキーを、後 → 前の順で重複なく並べる（新しい定義の宣言順を優先する）。 */
function keysOf(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(after), ...Object.keys(before)])]
}

// ---------------------------------------------------------------------------
// テーブルと項目
// ---------------------------------------------------------------------------

function diffTables(before: DefinitionBundle, after: DefinitionBundle, add: Add): void {
  for (const name of keysOf(before.tables, after.tables)) {
    const was = before.tables[name]
    const now = after.tables[name]

    if (was === undefined && now !== undefined) {
      add({
        kind: 'table.added',
        change: 'added',
        where: [],
        summary: `データ「${now.label}」が増えます`,
        detail: `項目 ${Object.keys(now.fields).length} 件`,
        ref: name,
      })
      // 増えたテーブルの項目は1件ずつ出さない（全項目が並ぶだけで読めない）
      continue
    }
    if (now === undefined && was !== undefined) {
      add({
        kind: 'table.removed',
        change: 'removed',
        where: [],
        summary: `データ「${was.label}」が無くなります`,
        ref: name,
      })
      continue
    }
    if (was === undefined || now === undefined) continue

    if (was.label !== now.label) {
      add({
        kind: 'table.label',
        change: 'changed',
        where: [],
        summary: `データの名前が変わります: ${beforeAfter(was.label, now.label)}`,
        ref: name,
      })
    }
    diffFields(was, now, after.tables, add)
  }
}

function diffFields(before: TableDef, after: TableDef, tables: Registry, add: Add): void {
  const where = [whereTable(after)]

  for (const name of keysOf(before.fields, after.fields)) {
    const was = before.fields[name]
    const now = after.fields[name]
    const ref = `${after.name}.${name}`

    if (was === undefined && now !== undefined) {
      add({
        kind: 'field.added',
        change: 'added',
        where,
        summary: `項目が増えます: 「${now.label}」（${fieldKindLabel(now, tables)}）`,
        ref,
      })
      continue
    }
    if (now === undefined && was !== undefined) {
      add({
        kind: 'field.removed',
        change: 'removed',
        where,
        summary: `項目が無くなります: 「${was.label}」`,
        ref,
      })
      continue
    }
    if (was === undefined || now === undefined || sameValue(was, now)) continue

    let told = false
    const tell = (kind: string, summary: string, detail?: string): void => {
      told = true
      add({
        kind,
        change: 'changed',
        where,
        summary,
        ...(detail === undefined ? {} : { detail }),
        ref,
      })
    }

    if (was.label !== now.label) {
      tell('field.label', `項目の名前が変わります: ${beforeAfter(was.label, now.label)}`)
    }
    if (was.type !== now.type || was.references !== now.references) {
      tell(
        'field.type',
        `項目「${now.label}」の入力の種類が変わります` +
          `（${fieldTypeLabel(was)} → ${fieldTypeLabel(now)}）`,
      )
    }
    if (was.required !== now.required) {
      tell(
        'field.required',
        now.required
          ? `項目「${now.label}」が必須になります`
          : `項目「${now.label}」が任意になります`,
      )
    }
    if (!sameValue(was.values, now.values)) {
      tell('field.values', `項目「${now.label}」の選択肢が変わります`, enumDetail(was, now))
    }
    if (!told) {
      // 上のどれでもない差（`definitionRef` の種類・`fill` など）。**黙って落とさない**
      tell('field.other', `項目「${now.label}」の設定が変わります`)
    }
  }
}

function enumDetail(before: FieldDef, after: FieldDef): string {
  const was = new Map((before.values ?? []).map((value) => [value.key, value.label]))
  const now = new Map((after.values ?? []).map((value) => [value.key, value.label]))

  const added = [...now].filter(([key]) => !was.has(key)).map(([, label]) => `「${label}」`)
  const removed = [...was].filter(([key]) => !now.has(key)).map(([, label]) => `「${label}」`)
  const renamed = [...now]
    .filter(([key, label]) => was.has(key) && was.get(key) !== label)
    .map(([key, label]) => beforeAfter(was.get(key) as string, label))

  const parts = [plusMinus(added, removed), ...renamed].filter((part) => part !== '')
  return parts.length === 0 ? '並び順が変わります' : parts.join(' ／ ')
}

// ---------------------------------------------------------------------------
// ロール
// ---------------------------------------------------------------------------

function diffRoles(before: DefinitionBundle, after: DefinitionBundle, add: Add): void {
  const was = new Map(before.roles.map((role) => [role.key, role]))
  const now = new Map(after.roles.map((role) => [role.key, role]))
  const where = ['担当（ロール）']

  for (const key of [...new Set([...now.keys(), ...was.keys()])]) {
    const old = was.get(key)
    const next = now.get(key)

    if (old === undefined && next !== undefined) {
      add({
        kind: 'role.added',
        change: 'added',
        where,
        summary: `担当が増えます: 「${next.name}」`,
        detail: next.description,
        ref: key,
      })
      continue
    }
    if (next === undefined && old !== undefined) {
      add({
        kind: 'role.removed',
        change: 'removed',
        where,
        summary: `担当が無くなります: 「${old.name}」`,
        ref: key,
      })
      continue
    }
    if (old === undefined || next === undefined) continue

    if (old.name !== next.name) {
      add({
        kind: 'role.name',
        change: 'changed',
        where,
        summary: `担当の名前が変わります: ${beforeAfter(old.name, next.name)}`,
        ref: key,
      })
    }
    if (old.description !== next.description) {
      add({
        kind: 'role.description',
        change: 'changed',
        where,
        summary: `担当「${next.name}」の説明が変わります`,
        detail: beforeAfter(old.description, next.description),
        ref: key,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// 業務フロー
// ---------------------------------------------------------------------------

function diffFlows(before: DefinitionBundle, after: DefinitionBundle, add: Add): MergedGraph[] {
  const was = new Map(before.flows.map((flow) => [flow.key, flow]))
  const now = new Map(after.flows.map((flow) => [flow.key, flow]))
  const roleName = (key: string): string =>
    (after.roles.find((role) => role.key === key) ?? before.roles.find((role) => role.key === key))
      ?.name ?? key

  const graphs: MergedGraph[] = []

  for (const key of [...new Set([...now.keys(), ...was.keys()])]) {
    const old = was.get(key)
    const next = now.get(key)
    // このフローに1件でも差分が出たら、合併グラフを添える
    let touched = 0
    const count: Add = (entry) => {
      touched += 1
      add(entry)
    }

    if (old === undefined && next !== undefined) {
      count({
        kind: 'flow.added',
        change: 'added',
        where: [],
        summary: `業務フロー「${next.name}」が増えます`,
        detail: `ゴール: ${next.goal}／段階 ${next.steps.length} 件`,
        ref: key,
      })
    } else if (next === undefined && old !== undefined) {
      count({
        kind: 'flow.removed',
        change: 'removed',
        where: [],
        summary: `業務フロー「${old.name}」が無くなります`,
        ref: key,
      })
    } else if (old !== undefined && next !== undefined) {
      diffFlowHead(old, next, roleName, count)
      diffSteps(old, next, after.tables, roleName, count)
      diffBindings(old, next, after.tables, count)
    }

    if (touched > 0) {
      const graph = mergeFlowGraph(old, next)
      if (graph !== undefined) graphs.push(graph)
    }
  }
  return graphs
}

function diffFlowHead(
  before: FlowDef,
  after: FlowDef,
  roleName: (key: string) => string,
  add: Add,
): void {
  const where = [whereFlow(after)]

  if (before.name !== after.name) {
    add({
      kind: 'flow.name',
      change: 'changed',
      where: [],
      summary: `業務フローの名前が変わります: ${beforeAfter(before.name, after.name)}`,
      ref: after.key,
    })
  }
  if (before.goal !== after.goal) {
    add({
      kind: 'flow.goal',
      change: 'changed',
      where,
      summary: 'この業務のゴールが変わります',
      detail: beforeAfter(before.goal, after.goal),
      ref: after.key,
    })
  }
  if (!sameValue(before.viewers ?? [], after.viewers ?? [])) {
    const was = new Set(before.viewers ?? [])
    const now = new Set(after.viewers ?? [])
    add({
      kind: 'flow.viewers',
      change: 'changed',
      where,
      summary: '見るだけの人が変わります',
      detail: plusMinus(
        [...now].filter((key) => !was.has(key)).map(roleName),
        [...was].filter((key) => !now.has(key)).map(roleName),
      ),
      ref: after.key,
    })
  }
  if (before.initial !== after.initial) {
    const name = after.steps.find((step) => step.key === after.initial)?.name ?? after.initial
    add({
      kind: 'flow.initial',
      change: 'changed',
      where,
      summary: `最初の段階が変わります: 「${name}」から始まります`,
      ref: after.key,
    })
  }
}

function diffSteps(
  before: FlowDef,
  after: FlowDef,
  tables: Registry,
  roleName: (key: string) => string,
  add: Add,
): void {
  const was = new Map(before.steps.map((step) => [step.key, step]))
  const now = new Map(after.steps.map((step) => [step.key, step]))
  const flowWhere = [whereFlow(after)]
  const keys = [...new Set([...now.keys(), ...was.keys()])]

  // 段階そのものの増減を先に出す。**読む順が「まず何が増えたか」になる** ようにするため
  // （中の変更から先に出すと、増えた段階の話が下に埋もれる）
  for (const key of keys) {
    const old = was.get(key)
    const next = now.get(key)
    const ref = `${after.key}.${key}`

    if (old === undefined && next !== undefined) {
      add({
        kind: 'step.added',
        change: 'added',
        where: flowWhere,
        summary: `段階が増えます: 「${next.name}」`,
        detail: next.intent,
        ref,
      })
      for (const exit of next.exit) {
        add(exitEntry('exit.added', 'added', [...flowWhere, whereStep(next)], exit, ref))
      }
    } else if (next === undefined && old !== undefined) {
      add({
        kind: 'step.removed',
        change: 'removed',
        where: flowWhere,
        summary: `段階が無くなります: 「${old.name}」`,
        ref,
      })
    }
  }

  for (const key of keys) {
    const old = was.get(key)
    const next = now.get(key)
    const ref = `${after.key}.${key}`
    if (old === undefined || next === undefined) continue

    const where = [...flowWhere, whereStep(next)]

    if (old.name !== next.name) {
      add({
        kind: 'step.name',
        change: 'changed',
        where: flowWhere,
        summary: `段階の名前が変わります: ${beforeAfter(old.name, next.name)}`,
        ref,
      })
    }
    if (old.intent !== next.intent) {
      add({
        kind: 'step.intent',
        change: 'changed',
        where,
        summary: 'この段階で目指すことが変わります',
        detail: beforeAfter(old.intent, next.intent),
        ref,
      })
    }
    if (!sameValue([...old.roles].sort(), [...next.roles].sort())) {
      const oldRoles = new Set(old.roles)
      const newRoles = new Set(next.roles)
      add({
        kind: 'step.roles',
        change: 'changed',
        where,
        summary: 'この段階を進める担当が変わります',
        detail: plusMinus(
          [...newRoles].filter((role) => !oldRoles.has(role)).map(roleName),
          [...oldRoles].filter((role) => !newRoles.has(role)).map(roleName),
        ),
        ref,
      })
    }
    if (!sameValue(old.next, next.next)) {
      const oldNext = new Set(old.next)
      const newNext = new Set(next.next)
      const name = (stepKey: string): string =>
        `「${now.get(stepKey)?.name ?? was.get(stepKey)?.name ?? stepKey}」`
      add({
        kind: 'step.next',
        change: 'changed',
        where,
        summary: 'ここから進める先が変わります',
        detail: plusMinus(
          [...newNext].filter((to) => !oldNext.has(to)).map(name),
          [...oldNext].filter((to) => !newNext.has(to)).map(name),
        ),
        ref,
      })
    }
    diffExits(after, old, next, tables, where, ref, add)
  }
}

function exitEntry(
  kind: string,
  change: DiffEntry['change'],
  where: string[],
  exit: ExitCondition,
  stepRef: string,
): DiffEntry {
  const how = exit.kind === 'auto' ? '自動判定' : '手動で確認'
  return {
    kind,
    change,
    where,
    summary:
      change === 'added'
        ? `出る条件が増えます: 「${exit.label}」（${how}）`
        : `出る条件が無くなります: 「${exit.label}」`,
    ...(change === 'added' ? { detail: exit.howTo } : {}),
    ref: `${stepRef}.${exit.key}`,
  }
}

function diffExits(
  flow: FlowDef,
  before: StepDef,
  after: StepDef,
  tables: Registry,
  where: string[],
  stepRef: string,
  add: Add,
): void {
  const was = new Map(before.exit.map((exit) => [exit.key, exit]))
  const now = new Map(after.exit.map((exit) => [exit.key, exit]))

  for (const key of [...new Set([...now.keys(), ...was.keys()])]) {
    const old = was.get(key)
    const next = now.get(key)
    const ref = `${stepRef}.${key}`

    if (old === undefined && next !== undefined) {
      add(exitEntry('exit.added', 'added', where, next, stepRef))
      continue
    }
    if (next === undefined && old !== undefined) {
      add(exitEntry('exit.removed', 'removed', where, old, stepRef))
      continue
    }
    if (old === undefined || next === undefined || sameValue(old, next)) continue

    if (old.kind !== next.kind) {
      add({
        kind: 'exit.kind',
        change: 'changed',
        where,
        summary:
          next.kind === 'auto'
            ? `出る条件「${next.label}」が自動判定に変わります（手で確認しなくてよくなります）`
            : `出る条件「${next.label}」が手動の確認に変わります`,
        ref,
      })
    }
    if (old.label !== next.label) {
      add({
        kind: 'exit.label',
        change: 'changed',
        where,
        summary: `出る条件の名前が変わります: ${beforeAfter(old.label, next.label)}`,
        ref,
      })
    }
    if (old.howTo !== next.howTo) {
      add({
        kind: 'exit.howTo',
        change: 'changed',
        where,
        summary: `出る条件「${next.label}」の充足のしかたが変わります`,
        detail: beforeAfter(old.howTo, next.howTo),
        ref,
      })
    }
    if (old.kind === 'auto' && next.kind === 'auto' && !sameValue(old.condition, next.condition)) {
      add({
        kind: 'exit.condition',
        change: 'changed',
        where,
        summary: `出る条件「${next.label}」の判定が変わります`,
        detail: conditionDetail(flow, tables, old, next),
        ref,
      })
    }
  }
}

/**
 * 条件式の中身の差は出さない（AST を人に見せても読めない）。代わりに
 * **「見ているデータ」がどう変わったか**を出す。フェーズ5 決定D の機械抽出を再利用する。
 */
function conditionDetail(
  flow: FlowDef,
  tables: Registry,
  before: AutoCheck,
  after: AutoCheck,
): string {
  const describe = (pred: AutoCheck['condition']): string[] =>
    referencedFields(pred).map((ref) => describeFieldRef(tables, flow.target, ref))
  const was = new Set(describe(before.condition))
  const now = new Set(describe(after.condition))

  const changes = plusMinus(
    [...now].filter((value) => !was.has(value)),
    [...was].filter((value) => !now.has(value)),
  )
  return changes === ''
    ? `見ているデータは同じ（${[...now].join(' ／ ')}）で、判定のしかたが変わります`
    : `見ているデータ: ${changes}`
}

// ---------------------------------------------------------------------------
// バインディング（この業務で使うデータ）
// ---------------------------------------------------------------------------

function diffBindings(before: FlowDef, after: FlowDef, tables: Registry, add: Add): void {
  const was = new Map(before.bindings.map((binding) => [binding.table, binding]))
  const now = new Map(after.bindings.map((binding) => [binding.table, binding]))
  const where = [whereFlow(after)]
  const label = (binding: BindingDef): string => tables[binding.table]?.label ?? binding.table

  for (const key of [...new Set([...now.keys(), ...was.keys()])]) {
    const old = was.get(key)
    const next = now.get(key)
    const ref = `${after.key}:${key}`

    if (old === undefined && next !== undefined) {
      add({
        kind: 'binding.added',
        change: 'added',
        where,
        summary: `この業務で使うデータが増えます: 「${label(next)}」（${bindingRoleLabel(next.role)}）`,
        detail: next.purpose,
        ref,
      })
      continue
    }
    if (next === undefined && old !== undefined) {
      add({
        kind: 'binding.removed',
        change: 'removed',
        where,
        summary: `この業務で使うデータが無くなります: 「${label(old)}」`,
        ref,
      })
      continue
    }
    if (old === undefined || next === undefined || sameValue(old, next)) continue

    if (old.role !== next.role) {
      add({
        kind: 'binding.role',
        change: 'changed',
        where,
        summary:
          `「${label(next)}」の位置づけが変わります` +
          `（${bindingRoleLabel(old.role)} → ${bindingRoleLabel(next.role)}）`,
        ref,
      })
    }
    if (old.purpose !== next.purpose) {
      add({
        kind: 'binding.purpose',
        change: 'changed',
        where,
        summary: `「${label(next)}」を何のために使うかの説明が変わります`,
        detail: beforeAfter(old.purpose, next.purpose),
        ref,
      })
    }
    if (!sameValue(old.rowFilter, next.rowFilter)) {
      add({
        kind: 'binding.rowFilter',
        change: 'changed',
        where,
        summary: `「${label(next)}」を直せる人の条件が変わります`,
        ref,
      })
    }
  }
}
