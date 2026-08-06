/**
 * 案件一覧。docs/impl/phase-4-frontend.md 4-2
 *
 * **共通の一覧コンポーネントに寄せない**（docs/product-concept.md §4-3）。
 * 汎用の一覧部品を作ると、その部品の表現力が上限になる。ここは営業の案件一覧として書く。
 *
 * 現在ステップと未確認件数が並ぶのが要点。フローに乗ったレコードの一覧が
 * 「いまどこにいるか」を持つのは、`_flow_state` を第一級にした帰結。
 */
import { deal as dealDef } from '@alt/definitions'
import { useEffect, useState } from 'react'
import { fieldLabel, label } from './labels'
import type { ScreenProps } from '../../shell/App'
import { orDash, yen } from '../../shell/format'
import { href } from '../../shell/router'
import type { Deal } from '../../shell/types'

export function DealList({ client, masters, asOf, user, onError }: ScreenProps) {
  const [deals, setDeals] = useState<Deal[] | undefined>(undefined)

  useEffect(() => {
    let live = true
    setDeals(undefined)
    client
      .list<Deal>('deal', { asOf })
      .then((records) => {
        if (live) setDeals(records)
      })
      .catch((cause: unknown) => {
        if (!live) return
        setDeals([])
        onError(cause)
      })
    return () => {
      live = false
    }
  }, [client, asOf, user, onError])

  if (deals === undefined) return <p className="loading">読み込み中…</p>
  if (deals.length === 0) return <p className="empty">案件がない。</p>

  return (
    <table className="deal-list">
      <thead>
        <tr>
          {/* 列見出しは定義のフィールドラベル。「自社収益」「現在ステップ」だけは
              単一フィールドでない（金額2つの合成 / _flow_state）ので手書き */}
          <th>{fieldLabel(dealDef, 'title')}</th>
          <th>{fieldLabel(dealDef, 'companyId')}</th>
          <th>{fieldLabel(dealDef, 'productType')}</th>
          <th>{fieldLabel(dealDef, 'dealType')}</th>
          <th className="num">自社収益</th>
          <th>現在ステップ</th>
          <th>{fieldLabel(dealDef, 'ownerEmployeeId')}</th>
        </tr>
      </thead>
      <tbody>
        {deals.map((deal) => (
          <tr key={deal.id}>
            <td>
              <a href={href.deal(deal.id)}>{deal.title}</a>
            </td>
            <td>{orDash(masters.companies.get(deal.companyId)?.name)}</td>
            <td>{label(dealDef.fields.productType, deal.productType)}</td>
            <td>{label(dealDef.fields.dealType, deal.dealType)}</td>
            <td className="num">
              <Profit deal={deal} />
            </td>
            <td>
              <StepCell deal={deal} />
            </td>
            <td>{orDash(masters.employees.get(deal.ownerEmployeeId)?.name)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * 金額は**自社収益（粗利）**を出す。顧客請求額（総額）ではない。
 * 代理店ビジネスでは両者が乖離するので、予測・目標は粗利ベースで揃える
 * （docs/sales-domain.md、`packages/definitions/src/tables/deal.ts`）。
 */
function Profit({ deal }: { deal: Deal }) {
  const parts: string[] = []
  if (deal.initialProfit !== null) parts.push(yen(deal.initialProfit))
  if (deal.monthlyProfit !== null) parts.push(`${yen(deal.monthlyProfit)}/月`)
  return <>{parts.length === 0 ? '—' : parts.join(' + ')}</>
}

function StepCell({ deal }: { deal: Deal }) {
  if (deal._flow === null) return <span className="muted">フロー外</span>
  return (
    <>
      <span className="badge badge-step">{deal._flow.stepName}</span>
      {deal._flow.unsatisfied > 0 && (
        <span className="unmet"> 未確認 {deal._flow.unsatisfied}件</span>
      )}
    </>
  )
}
