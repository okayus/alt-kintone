/**
 * 業務フロー定義の引き当て（フロー非依存）。docs/impl/phase-9-change-requests.md 決定H
 *
 * `flows/sales/steps.ts` を**フローに縛られない形に開いたもの**。中身は同じで、
 * `sales` を決め打ちしていたところが引数になっただけ。
 *
 * ⚠ 引くのは `FlowView.flow`（API が返す**そのレコードが乗っているフローのキー**）から。
 *    画面が「自分は営業だ」と申告する形にしない — 申告と実データがズレたときに、
 *    存在しないステップ名を平然と描くことになる。
 *
 * ⚠ ここも「定義を値として import する」（フェーズ4 決定B）の内側。ステップ名も
 *    出口条件の howTo も API から送らせない。
 */
import { flows } from '@alt/definitions'
import type { ExitCondition, FlowDef, StepDef } from '@alt/dsl'

/** キー → フロー定義。無ければ undefined（定義から消えたフローのデータが残っている場合）。 */
export function flowDef(key: string): FlowDef | undefined {
  return flows.find((flow) => flow.key === key)
}

/**
 * レーン。**定義は「表示順」も「レーン」も持っていない**ので、
 * 機械的に決まる規則しか使わない（フェーズ4 決定E）:
 *
 *   進行レーン = `next` が空でないステップ（まだ出る先がある）
 *   決着レーン = `next` が空のステップ（出る先が無い ＝ 決着）
 *   並び順     = 定義の宣言順
 */
export type Lane = 'progress' | 'outcome'

export function laneOf(step: StepDef): Lane {
  return step.next.length > 0 ? 'progress' : 'outcome'
}

export function stepsInLane(flowKey: string, lane: Lane): readonly StepDef[] {
  return (flowDef(flowKey)?.steps ?? []).filter((step) => laneOf(step) === lane)
}

/** ステップキー → 表示名。定義に無いキーはキーのまま出す（定義変更の取り残しが見えるように）。 */
export function stepNameOf(flowKey: string, key: string | null | undefined): string {
  if (key === null || key === undefined || key === '') return '—'
  return flowDef(flowKey)?.steps.find((step) => step.key === key)?.name ?? key
}

/**
 * 出口条件のキー → 定義。ラベルのほか `howTo`（充足のしかた）を画面に出すのに使う。
 *
 * ステップを指定せずフロー全体から探す。`enteredUnmet` に入っているのは**直前の**
 * ステップの出口条件キーで、どのステップから来たかを API は返していないため。
 * キーがフロー内で一意なのは `alt validate` が保証している。
 */
export function exitConditionOf(flowKey: string, exitKey: string): ExitCondition | undefined {
  for (const step of flowDef(flowKey)?.steps ?? []) {
    const found = step.exit.find((exit) => exit.key === exitKey)
    if (found !== undefined) return found
  }
  return undefined
}

export function exitLabelOf(flowKey: string, exitKey: string): string {
  return exitConditionOf(flowKey, exitKey)?.label ?? exitKey
}
