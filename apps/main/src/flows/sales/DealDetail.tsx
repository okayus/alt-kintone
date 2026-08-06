/**
 * 案件詳細。docs/impl/phase-4-frontend.md 4-2
 *
 * ここが**業務フロー定義がUIに現れる場所**（docs/product-concept.md §4-3）:
 * 「現在地の表示 + 出口条件のチェックリスト + 遷移の制御」が1画面に揃う。
 *
 * 編集可否・遷移可否は API が返す `_permissions` を見るだけ。**FEで認可を再判定しない**
 * （§4-1）。再判定すると認可が2箇所に分かれて必ず乖離する。
 */
import { useCallback, useEffect, useState } from 'react'
import { AdvanceButtons } from './AdvanceButtons'
import { DealForm } from './DealForm'
import { ExitChecklist } from './ExitChecklist'
import {
  ACTIVITY_RESULT,
  ACTIVITY_TYPE,
  CONFIDENCE,
  DEAL_STATUS,
  DEAL_TYPE,
  PRODUCT_TYPE,
  label,
} from './labels'
import { exitLabel, stepName } from './steps'
import { StepTrack } from './StepTrack'
import type { ScreenProps } from '../../shell/App'
import { dateTime, day, orDash, yen } from '../../shell/format'
import { href } from '../../shell/router'
import type { Activity, Deal, DealPatch } from '../../shell/types'

export function DealDetail({
  client,
  masters,
  asOf,
  user,
  onError,
  id,
}: ScreenProps & { id: string }) {
  const [deal, setDeal] = useState<Deal | undefined>(undefined)
  const [activities, setActivities] = useState<Activity[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setDeal(undefined)
    setEditing(false)
    setNotice(null)
    Promise.all([
      client.get<Deal>('deal', id, { asOf }),
      // 案件で絞るクエリは API に無い（フェーズ3の「作らないもの」）。件数が少ないのでFEで絞る
      client.list<Activity>('activity', { asOf }),
    ])
      .then(([record, all]) => {
        if (!live) return
        setDeal(record)
        setActivities(all.filter((activity) => activity.dealId === id))
      })
      .catch((cause: unknown) => {
        if (live) onError(cause)
      })
    return () => {
      live = false
    }
  }, [client, id, asOf, user, onError])

  const nameOf = useCallback(
    (employeeId: string | null | undefined): string =>
      employeeId === null || employeeId === undefined
        ? '—'
        : (masters.employees.get(employeeId)?.name ?? employeeId),
    [masters],
  )

  /** 書き込みは全部この形。成功したらサーバが返したレコードで置き換える。 */
  const mutate = (run: () => Promise<Deal>, after?: (next: Deal) => void) => {
    setBusy(true)
    setNotice(null)
    run()
      .then((next) => {
        setDeal(next)
        after?.(next)
      })
      .catch(onError)
      .finally(() => setBusy(false))
  }

  if (deal === undefined) return <p className="loading">読み込み中…</p>

  const flow = deal._flow
  const company = masters.companies.get(deal.companyId)

  return (
    <article className="deal-detail">
      <p className="crumb">
        <a href={href.deals()}>← 案件一覧</a>
      </p>

      <header className="deal-head">
        <h2>{deal.title}</h2>
        <p className="muted">
          {orDash(company?.name)} / {label(PRODUCT_TYPE, deal.productType)} /{' '}
          {label(DEAL_TYPE, deal.dealType)} / 状態 {label(DEAL_STATUS, deal.status)}
          {deal.confidence !== null && <> / ヨミ {label(CONFIDENCE, deal.confidence)}</>}
        </p>
      </header>

      {flow === null ? (
        <p className="muted">この案件は業務フローに乗っていない。</p>
      ) : (
        <section className="flow-panel">
          <StepTrack flow={flow} />

          <ExitChecklist
            flow={flow}
            permissions={deal._permissions}
            busy={busy}
            nameOf={nameOf}
            onToggle={(key, checked) =>
              mutate(() => client.setCheck<Deal>('deal', deal.id, key, checked))
            }
          />

          <AdvanceButtons
            flow={flow}
            permissions={deal._permissions}
            busy={busy}
            onAdvance={(to) =>
              mutate(
                async () => {
                  const result = await client.advance<Deal>('deal', deal.id, to)
                  setNotice(advanceNotice(to, result.unmet))
                  return result.record
                },
                // ステップが変わるとフォームの前提（決着理由など）も変わるので閉じる
                () => setEditing(false),
              )
            }
          />

          {notice !== null && <p className="app-banner app-banner-info">{notice}</p>}
        </section>
      )}

      <section className="deal-body">
        <div className="section-head">
          <h3>案件の内容</h3>
          {!editing && deal._permissions.update && (
            <button type="button" onClick={() => setEditing(true)}>
              編集
            </button>
          )}
          {!deal._permissions.update && (
            <span className="muted">
              {asOf === undefined
                ? '自分が担当の案件ではないので編集できない'
                : '過去の時点は読み取り専用'}
            </span>
          )}
        </div>

        {editing ? (
          <DealForm
            deal={deal}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={(patch: DealPatch) =>
              mutate(
                () => client.patch<Deal>('deal', deal.id, patch),
                () => setEditing(false),
              )
            }
          />
        ) : (
          <DealFacts deal={deal} owner={nameOf(deal.ownerEmployeeId)} />
        )}
      </section>

      <section className="deal-body">
        <h3>活動</h3>
        <ActivityList activities={activities} nameOf={nameOf} />
      </section>

      <footer className="deal-version">
        最終更新 {dateTime(deal._version.validFrom)} / {nameOf(deal._version.changedBy)}
        {deal._version.changedStep !== null && (
          <>（{stepName(deal._version.changedStep)} で変更）</>
        )}
        {deal._version.changedFlow !== null && <> / フロー {deal._version.changedFlow}</>}
      </footer>
    </article>
  )
}

// ---------------------------------------------------------------------------

function advanceNotice(to: string, unmet: readonly string[]): string {
  const name = stepName(to)
  if (unmet.length === 0) return `${name} へ進めた。`
  return `${name} へ進めた。未確認だった ${unmet.length} 件（${unmet
    .map(exitLabel)
    .join(' / ')}）を記録に残した。`
}

function DealFacts({ deal, owner }: { deal: Deal; owner: string }) {
  return (
    <dl className="facts">
      <Fact label="一時金・請求額" value={yen(deal.initialBilling)} />
      <Fact label="一時金・自社収益" value={yen(deal.initialProfit)} />
      <Fact label="月額・請求額" value={yen(deal.monthlyBilling)} />
      <Fact label="月額・自社収益" value={yen(deal.monthlyProfit)} />
      <Fact
        label="契約期間"
        value={deal.contractMonths === null ? '—' : `${deal.contractMonths} ヶ月`}
      />
      <Fact label="見込み受注月" value={orDash(deal.expectedCloseMonth)} />
      <Fact label="決着日" value={orDash(deal.closedAt)} />
      <Fact label="競合先" value={orDash(deal.competitor)} />
      <Fact label="担当" value={owner} />
      <Fact label="メモ" value={orDash(deal.note)} wide />
    </dl>
  )
}

function Fact({ label: text, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide === true ? 'fact wide' : 'fact'}>
      <dt>{text}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/**
 * 活動は**読むだけ**（最小スコープ）。未完了で予定日時があるものが「次アクション」で、
 * 出口条件「アポイントの予定がある」はこれを見ている。
 */
function ActivityList({
  activities,
  nameOf,
}: {
  activities: readonly Activity[]
  nameOf: (id: string | null | undefined) => string
}) {
  if (activities.length === 0) return <p className="muted">活動の記録がない。</p>

  return (
    <table className="activity-list">
      <thead>
        <tr>
          <th>日時</th>
          <th>種別</th>
          <th>件名</th>
          <th>結果</th>
          <th>担当</th>
        </tr>
      </thead>
      <tbody>
        {activities.map((activity) => (
          <tr key={activity.id} className={activity.completedAt === null ? 'scheduled' : ''}>
            <td>
              {activity.completedAt !== null
                ? day(activity.completedAt)
                : `${day(activity.scheduledAt)} 予定`}
            </td>
            <td>{label(ACTIVITY_TYPE, activity.type)}</td>
            <td>{activity.subject}</td>
            <td>{label(ACTIVITY_RESULT, activity.result)}</td>
            <td>{nameOf(activity.ownerEmployeeId)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
