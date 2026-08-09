/**
 * 要望の一覧。docs/impl/phase-9-change-requests.md 決定I
 *
 * **仮想スクロールにしない。** 案件は1万件だが要望は日に数件で、フェーズ6 の機構を
 * 持ち込む理由が無い。サーバ側（窓取得・`snapshot`・フィルタ語彙）はそのまま効くので、
 * 必要になったら乗り換えられる。
 *
 * ⚠ **一覧は共通部品にしない**（§4-3）。`DealList` と似た表に見えるが、寄せない —
 *    部品の表現力が画面の上限になるのが kintone の失敗構造。共通化したのは
 *    `shell/flow/`（`_flow` を描く部分）だけ。
 *
 * 絞り込みは URL に載せる（フェーズ6 論点D）。「未対応の障害だけ」をそのまま渡せる。
 */
import { changeRequest as requestDef, request as requestFlow } from '@alt/definitions'
import { parseAsString, useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import type { ScreenProps } from '../../shell/App'
import { dateTime } from '../../shell/format'
import { label } from '../../shell/labels'
import { href } from '../../shell/router'
import type { ChangeRequest } from '../../shell/types'

export function RequestList({ client, masters, asOf, user, meId, onError }: ScreenProps) {
  const [kind, setKind] = useQueryState('kind', parseAsString.withDefault(''))
  const [step, setStep] = useQueryState('step', parseAsString.withDefault(''))
  const [mine, setMine] = useQueryState('mine', parseAsString.withDefault(''))
  const [requests, setRequests] = useState<ChangeRequest[] | undefined>(undefined)

  useEffect(() => {
    let live = true
    setRequests(undefined)
    client
      .list<ChangeRequest>('change_request', {
        asOf,
        // フィルタは**フィールド毎のパラメータ**。FE は条件式 AST を組み立てない（決定2）。
        // `me` はサーバ側の糖衣で、URL を共有すると「読み手にとっての自分」になる
        filters: {
          ...(kind === '' ? {} : { kind }),
          ...(step === '' ? {} : { step }),
          ...(mine === '' ? {} : { reporterEmployeeId: 'me' }),
        },
        sort: 'filedAt:desc',
      })
      .then((records) => {
        if (live) setRequests(records)
      })
      .catch((cause: unknown) => {
        if (live) onError(cause)
      })
    return () => {
      live = false
    }
  }, [client, asOf, user, kind, step, mine, onError])

  const nameOf = (id: string | null): string =>
    id === null ? '—' : (masters.employees.get(id)?.name ?? id)

  return (
    <article className="request-list">
      <header className="section-head">
        <h2>{requestFlow.name}</h2>
        <a className="primary-link" href={href.requestNew()}>
          困りごとを出す
        </a>
      </header>

      <div className="request-filters">
        <label>
          種類
          <select value={kind} onChange={(event) => void setKind(event.target.value || null)}>
            <option value="">すべて</option>
            {(requestDef.fields.kind?.values ?? []).map((value) => (
              <option key={value.key} value={value.key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          状態
          {/* 状態＝ステップ。`status` 列を持たないので、絞るのも `?step=`（決定F） */}
          <select value={step} onChange={(event) => void setStep(event.target.value || null)}>
            <option value="">すべて</option>
            {requestFlow.steps.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={mine !== ''}
            onChange={(event) => void setMine(event.target.checked ? '1' : null)}
          />
          自分が出したものだけ
        </label>
      </div>

      {requests === undefined ? (
        <p className="loading">読み込み中…</p>
      ) : requests.length === 0 ? (
        <p className="empty">この条件に合う要望はない。</p>
      ) : (
        <table className="request-table">
          <thead>
            <tr>
              <th>状態</th>
              <th>種類</th>
              <th>困りごと</th>
              <th>起票者</th>
              <th>対応者</th>
              <th>起票</th>
              <th>未確認</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((record) => (
              <tr key={record.id} className={record.reporterEmployeeId === meId ? 'mine' : ''}>
                <td>
                  <span className="badge badge-step">{record._flow?.stepName ?? '—'}</span>
                </td>
                <td>{label(requestDef.fields.kind, record.kind)}</td>
                <td className="request-problem">
                  {/* 件名を持たないので、困りごとの本文そのものが見出しになる（決定F 補） */}
                  <a href={href.request(record.id)}>{record.problem}</a>
                </td>
                <td>{nameOf(record.reporterEmployeeId)}</td>
                <td>{nameOf(record.assigneeEmployeeId)}</td>
                <td className="muted">{dateTime(record.filedAt)}</td>
                <td className="num">
                  {record._flow === null || record._flow.unsatisfied === 0
                    ? ''
                    : `${record._flow.unsatisfied} 件`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  )
}
