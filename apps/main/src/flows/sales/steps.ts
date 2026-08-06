/**
 * ステップの並べ方。docs/impl/phase-4-frontend.md 決定B・決定E
 *
 * **定義を値として import する。** ステップ名と順序は `@alt/definitions` が持っているので、
 * FE に書き写さない。ステップを足す・改名する・並べ替えると、画面が勝手に追随する。
 *
 * ⚠ 定義は「表示順」も「レーン」も持っていない。だから**機械的に決まる規則しか使わない**:
 *
 *   進行レーン = `next` が空でないステップ（まだ出る先がある）
 *   決着レーン = `next` が空のステップ（出る先が無い ＝ 決着）
 *   並び順     = 定義の宣言順
 *
 * 最長経路を推測するような描き方はしない。営業フローは分岐・差し戻し・スキップを
 * 持つ有向グラフで（docs/product-concept.md §3-5）、一本道に見せると嘘になる。
 * 表示順が業務の順序とズレるなら、それは定義に順序の情報が足りないということ。
 */
import { sales } from '@alt/definitions'
import type { StepDef } from '@alt/dsl'

export type Lane = 'progress' | 'outcome'

export function laneOf(step: StepDef): Lane {
  return step.next.length > 0 ? 'progress' : 'outcome'
}

/** まだ出る先があるステップ（接触 → ヒアリング → 提案 → 保留）。 */
export const progressSteps: readonly StepDef[] = sales.steps.filter(
  (step) => laneOf(step) === 'progress',
)

/** 出る先が無いステップ（受注 / 失注 / 消滅）。 */
export const outcomeSteps: readonly StepDef[] = sales.steps.filter(
  (step) => laneOf(step) === 'outcome',
)

/** ステップキー → 表示名。定義に無いキーはキーのまま出す（定義変更の取り残しが見えるように）。 */
export function stepName(key: string): string {
  return sales.steps.find((step) => step.key === key)?.name ?? key
}

/**
 * 出口条件のキー → ラベル。`enteredUnmet`（キーの配列）を人が読める形にするのに使う。
 *
 * ステップを指定せずフロー全体から探す。`enteredUnmet` に入っているのは**直前の**
 * ステップの出口条件キーで、どのステップから来たかを API は返していないため。
 * キーがフロー内で一意なのは `alt validate` が保証している。
 */
export function exitLabel(exitKey: string): string {
  for (const step of sales.steps) {
    const found = step.exit.find((exit) => exit.key === exitKey)
    if (found !== undefined) return found.label
  }
  return exitKey
}
