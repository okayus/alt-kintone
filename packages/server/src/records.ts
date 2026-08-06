/**
 * レコードの読み書き。docs/impl/phase-3-backend.md 3-2 / 3-3
 *
 * 更新は UPDATE ではなく「**前の行を閉じて INSERT**」（docs/product-concept.md §4-1）。
 * 有効期間型（SCD Type 2）を全テーブルに既定適用すると決めた帰結で、避けて通れない部分。
 * これがあるので「先月末時点のパイプライン」が同じクエリで出せる。
 */
import { badRequest, conflict, notFound } from './api.js'
import { isAdmin, permissionsOf, rowFilterOf } from './authz.js'
import type { Deps, RequestContext } from './context.js'
import {
  autoCheckSlots,
  exitViews,
  manualCheckKey,
  ROW_WRITABLE_COLUMN,
  unmetKeys,
  type CheckSlot,
  type ManualCheckIndex,
} from './exit-checks.js'
import { validateInput } from './record-input.js'
import { toColumnName, type StepDef, type TableDef } from '@alt/dsl'
import {
  closeCurrentRow,
  decodeValue,
  insertRecord,
  insertFlowState,
  selectManualChecks,
  selectRecords,
  STEP_COLUMN,
  STEP_SINCE_COLUMN,
  TEMPORAL_COLUMNS,
  UNMET_COLUMN,
  type ContextValues,
  type SelectExpression,
  type SqlFragment,
} from '@alt/sql'
import { randomUUID } from 'node:crypto'

/** レスポンスに出るレコード1件。定義のフィールド + `_` 始まりのメタ。 */
export type RecordView = Record<string, unknown>

type Row = Record<string, unknown>

// ---------------------------------------------------------------------------
// 読み
// ---------------------------------------------------------------------------

export function listRecords(deps: Deps, ctx: RequestContext, id?: string): RecordView[] {
  const isTarget = ctx.flow.target === ctx.table.name
  const slots = isTarget ? autoCheckSlots(ctx.flow) : []
  const rowFilter = rowFilterOf(ctx.principal, ctx.usage)

  const expressions: SelectExpression[] = [...slots]
  if (rowFilter !== undefined) {
    expressions.push({ alias: ROW_WRITABLE_COLUMN, pred: rowFilter })
  }

  const rows = all(
    deps,
    selectRecords({
      registry: deps.registry.tables,
      table: ctx.table,
      ...(isTarget ? { flow: ctx.flow.key } : {}),
      expressions,
      values: contextValues(ctx),
      ...(ctx.asOf === undefined ? {} : { asOf: ctx.asOf }),
      ...(id === undefined ? {} : { id }),
      ...(ctx.limit === undefined ? {} : { limit: ctx.limit }),
    }),
  )

  const manual = isTarget ? loadManualChecks(deps, ctx, rows) : new Map()
  return rows.map((row) => toView(ctx, row, slots, manual, rowFilter !== undefined))
}

export function getRecord(deps: Deps, ctx: RequestContext, id: string): RecordView {
  const [record] = listRecords(deps, ctx, id)
  if (record === undefined) {
    throw notFound(
      `${ctx.table.name} の "${id}" が見つからない`,
      ctx.asOf === undefined ? undefined : `${ctx.asOf} 時点には存在しなかった可能性がある`,
    )
  }
  return record
}

/**
 * 一覧ぶんの手動チェックを**1クエリで**引く。レコードごとに引くと N+1 になる。
 */
function loadManualChecks(deps: Deps, ctx: RequestContext, rows: readonly Row[]): ManualCheckIndex {
  const index: ManualCheckIndex = new Map()
  const ids = rows.map((row) => String(row['id']))
  if (ids.length === 0) return index

  const found = all(
    deps,
    selectManualChecks({ table: ctx.table.name, recordIds: ids, flow: ctx.flow.key }),
  )
  for (const row of found) {
    index.set(
      manualCheckKey(String(row['record_id']), String(row['step']), String(row['check_key'])),
      {
        checked: row['checked'] === 1,
        checkedBy: (row['checked_by'] as string | null) ?? null,
        checkedAt: (row['checked_at'] as string | null) ?? null,
      },
    )
  }
  return index
}

/**
 * 行 → レスポンスのレコード。
 *
 * **キーは定義のフィールド名（camelCase）**。列名（snake_case）は外に出さない。
 * FE が定義を `import type` して型を合わせられるのが前提なので、ここでズレると
 * 「定義とFEの乖離が型で落ちる」（§5-6）が崩れる。
 */
function toView(
  ctx: RequestContext,
  row: Row,
  slots: readonly CheckSlot[],
  manual: ManualCheckIndex,
  hasRowFilter: boolean,
): RecordView {
  const view: RecordView = {}
  for (const [name, field] of Object.entries(ctx.table.fields)) {
    view[name] = decodeValue(field, row[toColumnName(name)])
  }

  view['_version'] = {
    validFrom: row['valid_from'] ?? null,
    validTo: row['valid_to'] ?? null,
    changedBy: row['changed_by'] ?? null,
    changedFlow: row['changed_flow'] ?? null,
    changedStep: row['changed_step'] ?? null,
  }

  const step = flowStep(ctx, row)
  if (ctx.flow.target === ctx.table.name) {
    view['_flow'] = step === undefined ? null : flowView(ctx, row, step, slots, manual)
  }

  view['_permissions'] = permissionsOf({
    principal: ctx.principal,
    usage: ctx.usage,
    // rowFilter が無いバインディング（マスタ類）は行レベルの制限なし
    rowWritable: !hasRowFilter || isAdmin(ctx.principal) || row[ROW_WRITABLE_COLUMN] === 1,
    historical: ctx.asOf !== undefined,
    step,
  })
  return view
}

function flowStep(ctx: RequestContext, row: Row): StepDef | undefined {
  const key = row[STEP_COLUMN]
  if (typeof key !== 'string') return undefined
  return ctx.flow.steps.find((s) => s.key === key)
}

/**
 * 業務フロー定義が FE に現れる形（§4-3）。
 * 「現在地の表示 + 出口条件のチェックリスト + 遷移の制御」がこの1ブロックで揃う。
 */
function flowView(
  ctx: RequestContext,
  row: Row,
  step: StepDef,
  slots: readonly CheckSlot[],
  manual: ManualCheckIndex,
): unknown {
  const exit = exitViews(step, row, slots, manual, String(row['id']))
  const unmetRaw = row[UNMET_COLUMN]
  return {
    flow: ctx.flow.key,
    step: step.key,
    stepName: step.name,
    enteredAt: row[STEP_SINCE_COLUMN] ?? null,
    exit,
    unsatisfied: unmetKeys(exit).length,
    // このステップに入ったときに未充足だった直前ステップの出口条件（§4-3）
    enteredUnmet: typeof unmetRaw === 'string' ? (JSON.parse(unmetRaw) as string[]) : [],
    next: step.next.map((key) => ({
      key,
      name: ctx.flow.steps.find((s) => s.key === key)?.name ?? key,
    })),
  }
}

// ---------------------------------------------------------------------------
// 書き
// ---------------------------------------------------------------------------

/**
 * 作成。target テーブルなら**同じトランザクションで `_flow_state` の初期行も作る**。
 * 「案件は常にちょうど1つのステップにいる」（§3-5）を、作った瞬間から成立させる。
 */
export function createRecord(deps: Deps, ctx: RequestContext, body: unknown): RecordView {
  const values = validateInput(ctx.table, body, { partial: false })
  const id = randomUUID()
  const isTarget = ctx.flow.target === ctx.table.name

  deps.db.transaction(() => {
    run(
      deps,
      insertRecord({
        table: ctx.table,
        values: { ...values, id },
        now: ctx.now,
        context: {
          changedBy: ctx.principal.id,
          changedFlow: ctx.flow.key,
          // 作成時点ではまだステップに乗っていない
          changedStep: null,
        },
      }),
    )
    if (isTarget) {
      run(
        deps,
        insertFlowState({
          table: ctx.table.name,
          recordId: id,
          flow: ctx.flow.key,
          step: ctx.flow.initial,
          unmetChecks: null,
          now: ctx.now,
          context: { changedBy: ctx.principal.id, changedFlow: ctx.flow.key, changedStep: null },
        }),
      )
    }
  })()

  return getRecord(deps, ctx, id)
}

/**
 * 更新。**前の行を閉じて、新しい値で INSERT する**（§4-1）。
 *
 * `changed_step` はクライアントに言わせず `_flow_state` から引く。「どのステップで
 * 変わったか」は分析に使う情報なので、呼び出し側の申告を信じる形にはしない。
 */
export function updateRecord(
  deps: Deps,
  ctx: RequestContext,
  id: string,
  body: unknown,
  opts: { changedStep: string | null },
): RecordView {
  const patch = validateInput(ctx.table, body, { partial: true })
  if (Object.keys(patch).length === 0) {
    throw badRequest(
      '更新するフィールドが無い',
      `${Object.keys(ctx.table.fields).join(', ')} のどれかを渡す`,
    )
  }

  deps.db.transaction(() => {
    const current = currentRow(deps, ctx.table, id)
    if (current === undefined) throw notFound(`${ctx.table.name} の "${id}" が見つからない`)

    // 現在行を閉じられなかった＝他のリクエストが先に閉じた
    if (changes(deps, closeCurrentRow({ table: ctx.table.name, id, now: ctx.now })) !== 1) {
      throw conflict(
        '更新が競合した（現在行が既に閉じられている）',
        '最新のレコードを読み直してから、もう一度更新する',
      )
    }

    run(
      deps,
      insertRecord({
        table: ctx.table,
        // 現在行の値に差分を重ねる。書かれなかったフィールドは引き継ぐ
        values: { ...decodeRow(ctx.table, current), ...patch, id },
        now: ctx.now,
        context: {
          changedBy: ctx.principal.id,
          changedFlow: ctx.flow.key,
          changedStep: opts.changedStep,
        },
      }),
    )
  })()

  return getRecord(deps, ctx, id)
}

/** 現在行（生の列名のまま）。更新前の値を引き継ぐために読む。 */
function currentRow(deps: Deps, table: TableDef, id: string): Row | undefined {
  return deps.db
    .prepare(`SELECT * FROM "${table.name}" WHERE "id" = ? AND "valid_to" IS NULL`)
    .get(id) as Row | undefined
}

function decodeRow(table: TableDef, row: Row): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [name, field] of Object.entries(table.fields)) {
    values[name] = decodeValue(field, row[toColumnName(name)])
  }
  return values
}

// ---------------------------------------------------------------------------

/**
 * 条件式のコンテキスト変数（docs/condition-ast.md §5-2）。
 * SQL 関数に変換せず**パラメータとしてバインドする**ので、方言差が消えてテストも決定的になる。
 */
export function contextValues(ctx: RequestContext): ContextValues {
  return {
    'currentUser.id': ctx.principal.id,
    today: ctx.now.slice(0, 10),
    now: ctx.now,
  }
}

export function all(deps: Deps, fragment: SqlFragment): Row[] {
  return deps.db.prepare(fragment.sql).all(...fragment.params) as Row[]
}

export function run(deps: Deps, fragment: SqlFragment): void {
  deps.db.prepare(fragment.sql).run(...fragment.params)
}

/** 影響行数。有効期間型の「閉じる」が競合していないかの判定に使う。 */
export function changes(deps: Deps, fragment: SqlFragment): number {
  return deps.db.prepare(fragment.sql).run(...fragment.params).changes
}

/** 有効期間型の列は書き込み入力として受け付けない（サーバが埋める）。 */
export const RESERVED_INPUT_KEYS: readonly string[] = ['id', ...TEMPORAL_COLUMNS]
