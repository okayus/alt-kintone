/**
 * 出口条件のチェックリスト。docs/product-concept.md §4-3
 *
 * 「次に進むための確認」。**この画面が構想の中核が届くかどうかの分かれ目**
 * （docs/impl/phase-4-frontend.md 4-2）。
 *
 * - 自動判定は**操作できない**。データから決まるので、営業は何もしなくても勝手に埋まる。
 *   ここが「営業の入力負担を減らす」の実体で、手で立てられるようにすると意味が消える
 * - 手動チェックだけ押せる。可否は API の `_permissions.advance` を見るだけで、
 *   FEで認可を再判定しない（docs/product-concept.md §4-1）
 * - **未充足の条件には「充足のしかた」（定義の `howTo`）を出す**（フェーズ5）。
 *   「なぜ ☐ なのか」「どの欄に何を入れればよいか」が画面で分かる。
 *   充足済みは畳む — 日常の使用でノイズにしないため
 * - 直前のステップを未充足のまま進んだ記録（`enteredUnmet`）もここに出す。
 *   「未充足でも進めるが記録に残す」が見える場所
 *
 * **どの業務フローのレコードでも同じように描く**（フェーズ9 決定H）。定義は
 * `_flow.flow`（フローのキー）から引く。
 */
import { exitConditionOf, exitLabelOf } from './definitions'
import { dateTime } from '../format'
import type { ExitView, FlowView, Permissions } from '../types'

export interface ExitChecklistProps {
  flow: FlowView
  permissions: Permissions
  busy: boolean
  onToggle: (key: string, checked: boolean) => void
  /** 従業員ID → 表示名。誰が確認したかを出すため。 */
  nameOf: (employeeId: string | null | undefined) => string
}

export function ExitChecklist({ flow, permissions, busy, onToggle, nameOf }: ExitChecklistProps) {
  if (flow.exit.length === 0) {
    return (
      <p className="muted">このステップに出口条件はない（出る先が無いので、出る条件も無い）。</p>
    )
  }

  return (
    <div className="exit-checklist">
      <h3>次に進むための確認</h3>
      <ul>
        {flow.exit.map((exit) => {
          // howTo は API ではなく定義から。定義を値として import しているので
          // 表示のためにサーバを太らせない（docs/impl/phase-4-frontend.md 決定B）
          const howTo = exitConditionOf(flow.flow, exit.key)?.howTo
          return (
            <li key={exit.key} className={exit.satisfied ? 'satisfied' : 'unsatisfied'}>
              <div className="exit-row">
                <ExitRow
                  exit={exit}
                  canEdit={permissions.advance === true && !busy}
                  onToggle={onToggle}
                  nameOf={nameOf}
                />
              </div>
              {!exit.satisfied && howTo !== undefined && <p className="exit-howto">→ {howTo}</p>}
            </li>
          )
        })}
      </ul>

      {flow.enteredUnmet.length > 0 && <EnteredUnmet flow={flow} />}
    </div>
  )
}

function ExitRow({
  exit,
  canEdit,
  onToggle,
  nameOf,
}: {
  exit: ExitView
  canEdit: boolean
  onToggle: (key: string, checked: boolean) => void
  nameOf: (employeeId: string | null | undefined) => string
}) {
  const checked = exit.satisfied

  if (exit.kind === 'auto') {
    return (
      <>
        {/* 自動判定は表示のみ。押せる見た目にしない */}
        <span className="check" aria-hidden="true">
          {checked ? '☑' : '☐'}
        </span>
        <span className="exit-label">{exit.label}</span>
        <span className="badge badge-auto">自動判定</span>
      </>
    )
  }

  return (
    <>
      <label className="exit-manual">
        <input
          type="checkbox"
          checked={checked}
          disabled={!canEdit}
          onChange={(event) => onToggle(exit.key, event.target.checked)}
        />
        <span className="exit-label">{exit.label}</span>
      </label>
      <span className="badge badge-manual">手動</span>
      {checked && exit.checkedBy !== undefined && exit.checkedBy !== null && (
        <span className="muted">
          {nameOf(exit.checkedBy)} が {dateTime(exit.checkedAt)} に確認
        </span>
      )}
    </>
  )
}

/**
 * このステップに入ったときに未充足だった、**直前のステップ**の出口条件。
 * これが残るから「出口条件を満たさず進めた案件の受注率」が後から出せる。
 */
function EnteredUnmet({ flow }: { flow: FlowView }) {
  return (
    <p className="entered-unmet">
      ⚠ 未確認 {flow.enteredUnmet.length} 件のまま、このステップに進んでいる:{' '}
      {flow.enteredUnmet.map((key) => exitLabelOf(flow.flow, key)).join(' / ')}
    </p>
  )
}
