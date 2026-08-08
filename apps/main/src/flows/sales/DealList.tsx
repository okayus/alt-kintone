/**
 * 案件一覧（グリッド）。docs/impl/phase-6-list-grid.md 論点E・G
 *
 * **共通の一覧コンポーネントに寄せない**（docs/product-concept.md §4-3）。
 * 汎用の一覧部品を作ると、その部品の表現力が上限になる。ここは営業の案件一覧として書く。
 * 入れてよいのは **UI を持たない道具**（`@tanstack/react-virtual` は headless）で、
 * 避けるのは UI を持つ共通部品（フル機能グリッド）——という線を論点E で引いた。
 *
 * 現在ステップと未確認件数の列が残っているのが要点（論点G）。**これは「フローに乗った
 * レコードの一覧」であって、案件テーブルのビューアではない。**
 *
 * `<table>` ではなく div + CSS グリッドなのは、仮想化した行を絶対配置するため。
 * `role="grid"` は最小限だけ付ける（PC中心・社内利用の決定に従う）。
 */
import { deal as dealDef } from '@alt/definitions'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { DealFilters } from './DealFilters'
import { nextSort, parseSort, STEP_SORT_KEY, useDealQuery, type Sort } from './dealQuery'
import { useDealPage, type DealPage } from './useDealPage'
import { fieldLabel, label } from './labels'
import type { ScreenProps } from '../../shell/App'
import { orDash, yen } from '../../shell/format'
import { href } from '../../shell/router'
import type { Deal } from '../../shell/types'

/** 行の高さ（px）。仮想化は固定高で計算する。 */
const ROW_HEIGHT = 37

/**
 * 見出しの高さ（px）。**`app.css` の `.grid-head` と同じ値にすること。**
 *
 * 見出しをスクロール枠の**中**に sticky で置いてある（外に出すと、縦スクロールバーの幅だけ
 * 列がずれる／横スクロール時に見出しだけ動かない）。その代わり仮想化の基準位置が
 * 見出しのぶんずれるので、`scrollMargin` で引く。
 */
const HEAD_HEIGHT = 37

interface Column {
  key: string
  label: string
  /** 幅（CSS grid の track）。 */
  width: string
  /** 右寄せ（金額）。 */
  numeric?: boolean
  /**
   * サーバに投げるソートキー。無いものは並べ替えできない
   * （自社収益＝2フィールドの合成、顧客企業＝FK先の名前。論点B・G）。
   */
  sort?: string
  render(deal: Deal, screen: ScreenProps): ReactNode
}

const COLUMNS: Column[] = [
  {
    key: 'title',
    label: fieldLabel(dealDef, 'title'),
    width: 'minmax(180px, 2fr)',
    sort: 'title',
    render: (deal) => <a href={href.deal(deal.id)}>{deal.title}</a>,
  },
  {
    key: 'companyId',
    label: fieldLabel(dealDef, 'companyId'),
    width: 'minmax(120px, 1fr)',
    render: (deal, { masters }) => orDash(masters.companies.get(deal.companyId)?.name),
  },
  {
    key: 'productType',
    label: fieldLabel(dealDef, 'productType'),
    width: '84px',
    sort: 'productType',
    render: (deal) => label(dealDef.fields.productType, deal.productType),
  },
  {
    key: 'dealType',
    label: fieldLabel(dealDef, 'dealType'),
    width: '64px',
    sort: 'dealType',
    render: (deal) => label(dealDef.fields.dealType, deal.dealType),
  },
  {
    // 単一フィールドではないので定義からラベルを取れない（金額2つの合成）
    key: 'profit',
    label: '自社収益',
    width: '130px',
    numeric: true,
    render: (deal) => <Profit deal={deal} />,
  },
  {
    key: 'expectedCloseMonth',
    label: fieldLabel(dealDef, 'expectedCloseMonth'),
    width: '104px',
    sort: 'expectedCloseMonth',
    render: (deal) => orDash(deal.expectedCloseMonth),
  },
  {
    key: 'confidence',
    label: fieldLabel(dealDef, 'confidence'),
    width: '68px',
    sort: 'confidence',
    render: (deal) => orDash(label(dealDef.fields.confidence, deal.confidence)),
  },
  {
    key: 'status',
    label: fieldLabel(dealDef, 'status'),
    width: '72px',
    sort: 'status',
    render: (deal) => label(dealDef.fields.status, deal.status),
  },
  {
    // フロー由来の列。定義のフィールドではなく _flow_state から来る（論点G）
    key: 'step',
    label: '現在ステップ',
    width: '185px',
    sort: STEP_SORT_KEY,
    render: (deal) => <StepCell deal={deal} />,
  },
  {
    key: 'ownerEmployeeId',
    label: fieldLabel(dealDef, 'ownerEmployeeId'),
    width: '96px',
    sort: 'ownerEmployeeId',
    render: (deal, { masters }) => orDash(masters.employees.get(deal.ownerEmployeeId)?.name),
  },
]

const TEMPLATE = COLUMNS.map((column) => column.width).join(' ')

export function DealList(screen: ScreenProps) {
  const query = useDealQuery()
  const sort = useMemo(() => parseSort(query.sort), [query.sort])
  const page = useDealPage({
    client: screen.client,
    filters: query.filters,
    sort: query.sort,
    asOf: screen.asOf,
    user: screen.user,
    onError: screen.onError,
  })

  return (
    <>
      <DealFilters query={query} masters={screen.masters} total={page.total} />
      <Grid
        page={page}
        sort={sort}
        onSort={(key) => void query.set({ sort: nextSort(sort, key) })}
        screen={screen}
      />
    </>
  )
}

function Grid({
  page,
  sort,
  onSort,
  screen,
}: {
  page: DealPage
  sort: Sort | undefined
  onSort: (key: string) => void
  screen: ScreenProps
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: page.total ?? 0,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    // 前後に少し余分を描いておくと、速いスクロールでも空白が見えにくい
    overscan: 10,
    // 行が始まるのは見出しの下から。これが無いと窓の判定が見出しのぶんずれる
    scrollMargin: HEAD_HEIGHT,
  })

  // 世代が変わったら先頭へ戻す。絞り込みを変えたのに 5,000 行目を見ている、
  // という絵にならないようにする（総件数が減るとスクロール位置が末尾に張り付く）
  const resetKey = page.resetKey
  useEffect(() => {
    if (scroller.current !== null) scroller.current.scrollTop = 0
  }, [resetKey])

  const items = virtualizer.getVirtualItems()
  const first = items[0]?.index
  const last = items[items.length - 1]?.index

  // 見えている範囲（+ overscan）を取得の窓に伝える。
  // インデックスに依存させているので、同じ範囲を見ている間は再取得を投げない
  useEffect(() => {
    if (first === undefined || last === undefined) return
    page.ensureRange(first, last)
  }, [first, last, page])

  if (page.total === undefined) return <p className="loading">読み込み中…</p>
  if (page.total === 0) return <p className="empty">条件に合う案件がない。</p>

  return (
    <div className="grid" role="grid" aria-rowcount={page.total}>
      <div className="grid-scroller" ref={scroller}>
        {/* 見出しはスクロール枠の中。縦には貼り付き、横は本体と一緒に動く */}
        <div
          className="grid-head"
          role="row"
          style={{ gridTemplateColumns: TEMPLATE, height: HEAD_HEIGHT }}
        >
          {COLUMNS.map((column) => (
            <HeadCell key={column.key} column={column} sort={sort} onSort={onSort} />
          ))}
        </div>

        <div className="grid-canvas" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => (
            <Row
              key={item.key}
              index={item.index}
              top={item.start - HEAD_HEIGHT}
              deal={page.rowAt(item.index)}
              screen={screen}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function HeadCell({
  column,
  sort,
  onSort,
}: {
  column: Column
  sort: Sort | undefined
  onSort: (key: string) => void
}) {
  const key = column.sort
  const active = key !== undefined && sort?.key === key
  const className = `grid-cell grid-th${column.numeric === true ? ' num' : ''}`

  if (key === undefined) return <div className={className}>{column.label}</div>
  return (
    <div
      className={`${className}${active ? ' sorted' : ''}`}
      role="columnheader"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className="grid-sort" onClick={() => onSort(key)}>
        {column.label}
        <span className="grid-sort-mark">
          {active ? (sort.direction === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </div>
  )
}

function Row({
  index,
  top,
  deal,
  screen,
}: {
  index: number
  top: number
  deal: Deal | undefined
  screen: ScreenProps
}) {
  return (
    <div
      className={`grid-row${deal === undefined ? ' loading-row' : ''}`}
      role="row"
      aria-rowindex={index + 1}
      style={{
        transform: `translateY(${top}px)`,
        height: ROW_HEIGHT,
        gridTemplateColumns: TEMPLATE,
      }}
    >
      {COLUMNS.map((column) => (
        <div
          key={column.key}
          className={`grid-cell${column.numeric === true ? ' num' : ''}`}
          role="gridcell"
        >
          {/* 未取得の行は骨だけ出す。総件数が分かっているので高さは正しい */}
          {deal === undefined ? <span className="skeleton" /> : column.render(deal, screen)}
        </div>
      ))}
    </div>
  )
}

/**
 * 金額は**自社収益（粗利）**を出す。顧客請求額（総額）ではない。
 * 代理店ビジネスでは両者が乖離するので、予測・目標・ランキングは粗利ベースで揃える
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
