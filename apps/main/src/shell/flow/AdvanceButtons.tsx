/**
 * ステップ遷移。docs/product-concept.md §4-3
 *
 * **未充足でも進めるが、記録に残す**（確定事項）。ブロックしない。実務は例外だらけで、
 * 強制すると形式的にチェックを埋める運用になる。代わりに「未確認2件で提案へ進んだ」を
 * 履歴に残し、ステージ設計自体の妥当性を後から検証できるようにする。
 *
 * ⚠ 確認に `window.confirm` を使わない（docs/impl/phase-4-frontend.md 決定G）。
 *    ブラウザのモーダルはページのイベントを止めるので、自動操作での動作確認が潰れる。
 *
 * **どの業務フローのレコードでも同じように描く**（フェーズ9 決定H）。もともと `_flow` と
 * `_permissions` しか見ていなかったので、シェルへ移すのに中身の変更は要らなかった。
 */
import { useState } from 'react'
import type { FlowView, Permissions } from '../types'

export interface AdvanceButtonsProps {
  flow: FlowView
  permissions: Permissions
  busy: boolean
  onAdvance: (to: string) => void
}

export function AdvanceButtons({ flow, permissions, busy, onAdvance }: AdvanceButtonsProps) {
  const [pending, setPending] = useState<string | null>(null)

  if (permissions.advance !== true) {
    return <p className="muted">このステップを進める権限がない（担当ロールか管理者が行う）。</p>
  }
  if (flow.next.length === 0) {
    return <p className="muted">ここが決着。進める先はない。</p>
  }

  const unmet = flow.unsatisfied

  if (pending !== null) {
    const target = flow.next.find((next) => next.key === pending)
    return (
      <div className="advance confirm">
        <p>
          未確認 {unmet} 件のまま <strong>{target?.name ?? pending}</strong> へ進める。
          <span className="muted">進めた記録に未確認の内訳が残る。</span>
        </p>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            setPending(null)
            onAdvance(pending)
          }}
        >
          進める
        </button>
        <button type="button" disabled={busy} onClick={() => setPending(null)}>
          やめる
        </button>
      </div>
    )
  }

  return (
    <div className="advance">
      {flow.next.map((next) => (
        <button
          key={next.key}
          type="button"
          disabled={busy}
          onClick={() => (unmet > 0 ? setPending(next.key) : onAdvance(next.key))}
        >
          {next.name}へ進める
        </button>
      ))}
      {unmet > 0 && <span className="unmet">※未確認 {unmet}件あり</span>}
    </div>
  )
}
