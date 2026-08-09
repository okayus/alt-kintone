/**
 * 現在地の表示。docs/product-concept.md §4-3「業務フロー定義はUIにこう現れる」
 *
 * ステップ名と順序は定義から取る（`definitions.ts`）。現在ステップは API の `_flow.step`。
 *
 * **どの業務フローのレコードでも同じように描く**（フェーズ9 決定H）。入力は `_flow` だけで、
 * 案件も要望も知らない。§4-3 が共通化を許すのはここまでで、一覧とフォームは各フローの手書き。
 *
 * ⚠ **通過済みかどうかを描かない。** 営業の進行は非線形・可逆なので
 *    （docs/sales-domain.md §4-7）、「左は通過済み」は嘘になる。差し戻された案件も、
 *    ヒアリングを飛ばして提案に来た案件も同じ列に並ぶ。塗るのは現在地だけ。
 *    ウィザードにしないと決めたのと同じ理由。
 */
import { stepsInLane } from './definitions'
import { dateTime } from '../format'
import type { FlowView } from '../types'

export function StepTrack({ flow }: { flow: FlowView }) {
  const progress = stepsInLane(flow.flow, 'progress')
  const outcome = stepsInLane(flow.flow, 'outcome')

  return (
    <div className="step-track">
      <section className="lane">
        <h3 className="lane-title">進行</h3>
        <ol className="lane-steps">
          {progress.map((step) => (
            <li key={step.key} className={step.key === flow.step ? 'step current' : 'step'}>
              <span className="dot" aria-hidden="true" />
              <span className="step-name">{step.name}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="lane lane-outcome">
        <h3 className="lane-title">決着</h3>
        <ol className="lane-steps">
          {outcome.map((step) => (
            <li key={step.key} className={step.key === flow.step ? 'step current' : 'step'}>
              <span className="dot" aria-hidden="true" />
              <span className="step-name">{step.name}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="step-here">
        いまここ: <strong>{flow.stepName}</strong>
        {flow.enteredAt !== null && (
          <span className="muted">（{dateTime(flow.enteredAt)} から）</span>
        )}
      </p>
    </div>
  )
}
