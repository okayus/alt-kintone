/**
 * 営業フローのステップの並べ方。docs/impl/phase-4-frontend.md 決定B・決定E
 *
 * **定義を値として import する。** ステップ名と順序は `@alt/definitions` が持っているので、
 * FE に書き写さない。ステップを足す・改名する・並べ替えると、画面が勝手に追随する。
 *
 * 引き当ての規則そのものは `shell/flow/definitions.ts` に移した（フェーズ9 決定H）。
 * 2本目のフロー（改善要望）が同じ規則を使うため。**ここに残るのは営業フローへの束縛だけ**で、
 * 案件の画面はフローのキーを毎回書かずに済む。
 */
import { sales } from '@alt/definitions'
import {
  exitConditionOf,
  exitLabelOf,
  laneOf,
  stepNameOf,
  stepsInLane,
  type Lane,
} from '../../shell/flow/definitions'
import type { ExitCondition, StepDef } from '@alt/dsl'

export { laneOf, type Lane }

/** まだ出る先があるステップ（接触 → ヒアリング → 提案 → 保留）。 */
export const progressSteps: readonly StepDef[] = stepsInLane(sales.key, 'progress')

/** 出る先が無いステップ（受注 / 失注 / 消滅）。 */
export const outcomeSteps: readonly StepDef[] = stepsInLane(sales.key, 'outcome')

/** ステップキー → 表示名。定義に無いキーはキーのまま出す（定義変更の取り残しが見えるように）。 */
export function stepName(key: string | null | undefined): string {
  return stepNameOf(sales.key, key)
}

/** 出口条件のキー → 定義。ラベルのほか `howTo`（充足のしかた）を画面に出すのに使う。 */
export function exitCondition(exitKey: string): ExitCondition | undefined {
  return exitConditionOf(sales.key, exitKey)
}

/** 出口条件のキー → ラベル。`enteredUnmet`（キーの配列）を人が読める形にするのに使う。 */
export function exitLabel(exitKey: string): string {
  return exitLabelOf(sales.key, exitKey)
}
