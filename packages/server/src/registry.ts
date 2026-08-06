/**
 * 定義レジストリ。docs/impl/phase-3-backend.md 3-1
 *
 * `alt export` が吐いた JSON（`DefinitionBundle`）を受け取り、リクエスト処理から
 * 引ける形にする。**サーバは `@alt/definitions` を知らない**（決定B）。定義は
 * 実行時に読むデータであって、コンパイル時の依存ではない。Go 版も同じ入口になる。
 *
 * ここで最も重要なのは `routes()`:
 * **どのフローの usage にも出てこないテーブルにはルートを生やさない**。
 * これが「バインドされていないテーブルは使えない」（§3-2）の技術的な強制点で、
 * 構想の中で最も強い制約を実装が担保している場所。
 */
import {
  definitionBundleSchema,
  usedTables,
  type Access,
  type BindingDef,
  type DefinitionBundle,
  type FlowDef,
  type Registry as TableRegistry,
  type StepDef,
  type TableDef,
} from '@alt/dsl'

/** テーブルが1つのフローでどう使われているか。バインディングと導出された access の組。 */
export interface TableUsage {
  table: string
  flow: FlowDef
  access: Access
  /** 横断マスタ（`global: true`）は明示バインドが無いので undefined になる（§3-4 案C）。 */
  binding: BindingDef | undefined
  /** 実際に使っているステップのキー。 */
  steps: string[]
}

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT'
  path: string
}

export interface DefinitionRegistry {
  /** `compilePred` に渡すテーブル集合。 */
  tables: TableRegistry
  table(name: string): TableDef | undefined
  flow(key: string): FlowDef | undefined
  step(flowKey: string, stepKey: string): StepDef | undefined
  /** そのテーブルを使っているフロー（宣言順）。空ならルートが生えない。 */
  usage(table: string): TableUsage[]
  /** そのテーブルを `target` にしているフロー。 */
  targetedBy(table: string): FlowDef[]
  routes(): Route[]
}

/**
 * バンドルを検証してレジストリにする。
 *
 * 検証は構文層（`definitionBundleSchema`）だけ。参照整合と業務ルールは
 * `alt validate` が apply / export の前に見ている（ルールの置き場は1箇所、
 * という §8-1 フェーズ2 の決定）。ここが見るのは「JSON が契約の形か」だけ。
 */
export function loadRegistry(bundle: unknown): DefinitionRegistry {
  const parsed = definitionBundleSchema.safeParse(bundle)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(
      `定義バンドルが読めない: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}\n` +
        'alt export --out で書き直す（alt validate を先に通すこと）',
    )
  }
  return buildRegistry(parsed.data)
}

/** 検証済みのバンドルから組み立てる。テストが直接呼ぶ。 */
export function buildRegistry(bundle: DefinitionBundle): DefinitionRegistry {
  const flows = new Map(bundle.flows.map((f) => [f.key, f]))
  const usage = new Map<string, TableUsage[]>()

  for (const flow of bundle.flows) {
    const bindings = new Map(flow.bindings.map((b) => [b.table, b]))
    for (const [table, used] of Object.entries(usedTables(flow))) {
      const list = usage.get(table) ?? []
      list.push({
        table,
        flow,
        access: used.access,
        binding: bindings.get(table),
        steps: used.steps,
      })
      usage.set(table, list)
    }
  }

  const registry: DefinitionRegistry = {
    tables: bundle.tables,
    table: (name) => bundle.tables[name],
    flow: (key) => flows.get(key),
    step: (flowKey, stepKey) => flows.get(flowKey)?.steps.find((s) => s.key === stepKey),
    usage: (table) => usage.get(table) ?? [],
    targetedBy: (table) => bundle.flows.filter((f) => f.target === table),
    routes: () => routesOf(registry, [...usage.keys()]),
  }
  return registry
}

function routesOf(registry: DefinitionRegistry, tables: readonly string[]): Route[] {
  const routes: Route[] = [{ method: 'GET', path: '/health' }]
  for (const table of [...tables].sort()) {
    routes.push(
      { method: 'GET', path: `/api/${table}` },
      { method: 'GET', path: `/api/${table}/{id}` },
    )
    if (registry.usage(table).some((u) => writable(u.access))) {
      routes.push(
        { method: 'POST', path: `/api/${table}` },
        { method: 'PATCH', path: `/api/${table}/{id}` },
      )
    }
    if (registry.targetedBy(table).length > 0) {
      routes.push(
        { method: 'POST', path: `/api/${table}/{id}/advance` },
        { method: 'PUT', path: `/api/${table}/{id}/checks/{key}` },
      )
    }
  }
  return routes
}

/**
 * その access で書けるか。
 *
 * `write` は「書き込み専用」ではなく**読みも含む**（`flow.ts` の規約）。
 * 読めるかどうかは usage があるかどうかで決まるので、判定はこの1つで足りる。
 */
export function writable(access: Access): boolean {
  return access === 'write' || access === 'readwrite'
}
