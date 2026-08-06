/**
 * ステップ遷移と手動チェック。docs/impl/phase-3-backend.md 3-5
 *
 * 現在ステップは業務テーブルの列ではなく **`_flow_state`（レコード × フローの関係）**に持つ
 * （docs/implementation.md 決定5）。列にすると kintone と同じ「アプリが状態を抱える」
 * 構造になり、1レコードが複数フローに乗ることも表現できなくなる。
 *
 * このファイルの要点は「**未充足でも進める。ただし記録に残す**」（§4-3）。
 * ブロックしないのは、実務が例外だらけで、強制すると形式的にチェックを埋める運用になるため。
 * 代わりに残した記録で「出口条件を満たさず進めた案件の受注率」が出せる。
 */
import { badRequest, conflict } from './api.js'
import { isAdmin, requireRowWrite, requireStepRole } from './authz.js'
import type { Deps, RequestContext } from './context.js'
import { getRecord, changes, run, type RecordView } from './records.js'
import type { ManualCheck, StepDef } from '@alt/dsl'
import { closeFlowState, insertFlowState, upsertManualCheck } from '@alt/sql'

/** レスポンス用に `_flow` ブロックを取り出す。 */
function flowBlock(record: RecordView): Record<string, unknown> {
  const block = record['_flow']
  if (block === null || block === undefined) {
    throw conflict(
      'このレコードは業務フローに乗っていない',
      '_flow_state に行が無い。alt seed で作ったデータか、定義を変えた直後の可能性がある',
    )
  }
  return block as Record<string, unknown>
}

function currentStep(ctx: RequestContext, record: RecordView): StepDef {
  const key = String(flowBlock(record)['step'])
  const step = ctx.flow.steps.find((s) => s.key === key)
  if (step === undefined) {
    throw conflict(
      `現在ステップ "${key}" が定義に無い`,
      'ステップを消す定義変更のあと、そのステップに居るレコードが残っている',
    )
  }
  return step
}

/** レコードが今どのステップに居るか（更新時の `changed_step` に使う）。 */
export function currentStepKey(deps: Deps, ctx: RequestContext, id: string): string | null {
  const record = getRecord(deps, ctx, id)
  const block = record['_flow']
  if (block === null || block === undefined) return null
  return String((block as Record<string, unknown>)['step'])
}

export interface AdvanceResult {
  record: RecordView
  /** 進んだ時点で満たしていなかった出口条件。空でも進めている。 */
  unmet: string[]
}

/**
 * ステップを進める。
 *
 * 順序に意味がある: **遷移先の妥当性 → ステップ操作の認可 → 行レベル → 出口条件**。
 * 認可より先に出口条件を評価すると、権限の無いユーザーに他人の案件の状況が漏れる。
 */
export function advance(deps: Deps, ctx: RequestContext, id: string, to: unknown): AdvanceResult {
  if (typeof to !== 'string' || to === '') {
    throw badRequest('body の to（遷移先のステップキー）が要る', '例: { "to": "proposed" }')
  }

  const record = getRecord(deps, ctx, id)
  const step = currentStep(ctx, record)
  const target = ctx.flow.steps.find((s) => s.key === to)
  if (target === undefined) {
    throw badRequest(
      `ステップ "${to}" はこのフローに無い`,
      `${ctx.flow.key} のステップ: ${ctx.flow.steps.map((s) => s.key).join(', ')}`,
    )
  }

  // 管理者の強制遷移は許す（§3-5）。next に書かれた遷移だけに制限すると
  // 「間違えて進めた」を戻す手段がなくなる
  if (!step.next.includes(to) && !isAdmin(ctx.principal)) {
    throw badRequest(
      `"${step.key}" から "${to}" への遷移は定義されていない`,
      `進める先: ${step.next.join(', ') || '（無し。決着ステップ）'}。` +
        '差し戻しや飛ばしが業務上あるなら、定義の next に足す',
    )
  }

  requireStepRole(ctx.principal, step, 'ステップを進める操作')
  requireRowWrite(permissions(record)['update'] === true)

  const unmet = unmetOf(record)

  deps.db.transaction(() => {
    const key = { table: ctx.table.name, recordId: id, flow: ctx.flow.key }
    if (changes(deps, closeFlowState({ ...key, now: ctx.now })) !== 1) {
      throw conflict('ステップの更新が競合した', '最新の状態を読み直してから、もう一度進める')
    }
    run(
      deps,
      insertFlowState({
        ...key,
        step: to,
        unmetChecks: unmet,
        now: ctx.now,
        context: {
          changedBy: ctx.principal.id,
          changedFlow: ctx.flow.key,
          // 変更の文脈は「どのステップで起きたか」。遷移は出てきた側で起きる
          changedStep: step.key,
        },
      }),
    )
  })()

  return { record: getRecord(deps, ctx, id), unmet }
}

/**
 * 手動チェックの付け外し。
 *
 * **ステップはサーバが現在ステップから決める**。クライアントに言わせると、
 * 実際には居ないステップのチェックを立てられる。`_manual_check` のキーは
 * ステップ込みなので、差し戻してもそのステップのチェックは残る（§3-5）。
 */
export function setManualCheck(
  deps: Deps,
  ctx: RequestContext,
  id: string,
  checkKey: string,
  body: unknown,
): RecordView {
  const checked = (body as Record<string, unknown> | null)?.['checked']
  if (typeof checked !== 'boolean') {
    throw badRequest('body の checked（true / false）が要る', '例: { "checked": true }')
  }

  const record = getRecord(deps, ctx, id)
  const step = currentStep(ctx, record)
  const manual = step.exit.find(
    (exit): exit is ManualCheck => exit.kind === 'manual' && exit.key === checkKey,
  )
  if (manual === undefined) {
    throw badRequest(
      `"${checkKey}" は現在ステップ（${step.key}）の手動チェックではない`,
      `手動チェック: ${step.exit
        .filter((e) => e.kind === 'manual')
        .map((e) => e.key)
        .join(', ')} ／ 自動判定はデータから決まるので手では立てられない`,
    )
  }

  requireStepRole(ctx.principal, step, '手動チェックの操作')
  requireRowWrite(permissions(record)['update'] === true)

  run(
    deps,
    upsertManualCheck({
      table: ctx.table.name,
      recordId: id,
      flow: ctx.flow.key,
      step: step.key,
      checkKey,
      checked,
      checkedBy: ctx.principal.id,
      checkedAt: ctx.now,
    }),
  )

  return getRecord(deps, ctx, id)
}

// ---------------------------------------------------------------------------

function permissions(record: RecordView): Record<string, boolean> {
  return (record['_permissions'] ?? {}) as Record<string, boolean>
}

function unmetOf(record: RecordView): string[] {
  const exit = flowBlock(record)['exit'] as Array<{ key: string; satisfied: boolean }>
  return exit.filter((view) => !view.satisfied).map((view) => view.key)
}
