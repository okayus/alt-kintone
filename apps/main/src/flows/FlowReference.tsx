/**
 * 業務フローの参照画面。docs/impl/phase-5-flow-reference.md 5-3
 *
 * **レコードを経由せずに業務フローそのものを読む。** 異動してきた人が
 * 「この会社の営業はどう進むのか」を、定義ファイルを開かずに画面だけで把握できる
 * 状態にする（フェーズ5の目的）。業務変更時の把握とオンボーディングが用途。
 *
 * **API を1本も叩かない。** 必要な情報（ステップ・意図・出口条件・howTo・
 * バインディング）はすべて定義にあり、FE は定義を値として import している
 * （docs/impl/phase-4-frontend.md 決定B）。データを1件も読まないので、
 * §4-3 の「横断ビューは既存バインディングの再利用に限る」にも触れない（決定H）。
 *
 * 構成は「グラフは骨格、詳細はカード」（決定G）。分岐・差し戻し・スキップがあるので
 * 線は必ず混む。混んでも読めるようにするのは全部を線で見せることではなく、
 * ノードを選ぶと関係する辺だけ強調して、見る範囲を絞れること。
 */
import { flows, roles, tables } from '@alt/definitions'
import {
  referencedFields,
  ROOT_SOURCE,
  usedTables,
  type AutoCheck,
  type BindingRole,
  type FlowDef,
  type StepDef,
} from '@alt/dsl'
import { useMemo, useState } from 'react'
import { layoutFlow, type FlowGraph, type GraphEdge } from './flowGraph'

export interface FlowReferenceProps {
  flowKey: string
  /** 案件詳細から来たときの現在地。グラフとカードで強調する。 */
  currentStep?: string | undefined
}

export function FlowReference({ flowKey, currentStep }: FlowReferenceProps) {
  const flow = flows.find((candidate) => candidate.key === flowKey)
  const [selected, setSelected] = useState<string | undefined>(currentStep)
  const graph = useMemo(() => (flow === undefined ? undefined : layoutFlow(flow)), [flow])

  if (flow === undefined || graph === undefined) {
    return <p className="empty">業務フロー「{flowKey}」は定義に無い。</p>
  }

  const select = (key: string): void => {
    setSelected(key)
    document
      .getElementById(cardId(flow.key, key))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <article className="flow-ref">
      <header className="flow-ref-head">
        <h2>{flow.name}</h2>
        <p className="muted">ゴール: {flow.goal}</p>
        {(flow.viewers ?? []).length > 0 && (
          <p className="muted">
            この業務を見られる人（操作はしない）: {(flow.viewers ?? []).map(roleName).join(' / ')}
          </p>
        )}
      </header>

      <section className="ref-panel">
        <h3>遷移</h3>
        <GraphSvg graph={graph} selected={selected} currentStep={currentStep} onSelect={select} />
        <p className="flow-legend">
          <LegendLine kind="forward" /> 前進
          <LegendLine kind="skip" /> スキップ
          <LegendLine kind="back" /> 差し戻し
          <span className="muted">ステップを選ぶと関係する遷移だけ強調される</span>
        </p>
      </section>

      {flow.steps.map((step, index) => (
        <StepCard
          key={step.key}
          flow={flow}
          graph={graph}
          step={step}
          number={circled(index)}
          selected={selected === step.key}
          current={currentStep === step.key}
          onJump={select}
        />
      ))}

      <section className="ref-panel">
        <h3>この業務で使うデータ</h3>
        <UsedData flow={flow} />
      </section>
    </article>
  )
}

const cardId = (flowKey: string, stepKey: string): string => `ref-${flowKey}-${stepKey}`

/** ①〜⑳。カード同士の相互参照を短く書くための番号（定義の宣言順）。 */
const circled = (index: number): string =>
  index < 20 ? String.fromCodePoint(0x2460 + index) : `${index + 1}.`

const roleName = (key: string): string => roles.find((role) => role.key === key)?.name ?? key

// ---------------------------------------------------------------------------
// ステップのカード
// ---------------------------------------------------------------------------

function StepCard({
  flow,
  graph,
  step,
  number,
  selected,
  current,
  onJump,
}: {
  flow: FlowDef
  graph: FlowGraph
  step: StepDef
  number: string
  selected: boolean
  current: boolean
  onJump: (key: string) => void
}) {
  const numberOf = new Map(flow.steps.map((candidate, index) => [candidate.key, circled(index)]))
  const incoming = graph.edges.filter((edge) => edge.to === step.key)
  const outgoing = graph.edges.filter((edge) => edge.from === step.key)

  return (
    <section
      id={cardId(flow.key, step.key)}
      className={`ref-card${selected ? ' selected' : ''}`}
      aria-current={current ? 'step' : undefined}
    >
      <header className="ref-card-head">
        <h3>
          {number} {step.name}
        </h3>
        {current && <span className="badge badge-step">いまここ</span>}
        <span className="ref-role">担当: {step.roles.map(roleName).join(' / ')}</span>
      </header>

      <h4>この段階で目指すこと</h4>
      <p className="ref-intent">{step.intent}</p>

      {step.exit.length === 0 ? (
        <p className="muted">ここが決着。出る条件はない（出る先が無いので）。</p>
      ) : (
        <>
          <h4>出る条件（{step.exit.length}件）</h4>
          <ul className="ref-exits">
            {step.exit.map((exit) => (
              <li key={exit.key}>
                <div className="exit-row">
                  <span className="exit-label">{exit.label}</span>
                  {exit.kind === 'auto' ? (
                    <span className="badge badge-auto">自動判定</span>
                  ) : (
                    <span className="badge badge-manual">手動</span>
                  )}
                </div>
                <p className="exit-howto">{exit.howTo}</p>
                {exit.kind === 'auto' && <SeenData flow={flow} check={exit} />}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="ref-neighbors">
        <span>
          ここへ来る:{' '}
          {incoming.length === 0 ? (
            <span className="muted">（起点）</span>
          ) : (
            joinJumps(incoming, 'from', numberOf, graph, onJump)
          )}
        </span>
        <span>
          ここから行く:{' '}
          {outgoing.length === 0 ? (
            <span className="muted">（終端）</span>
          ) : (
            joinJumps(outgoing, 'to', numberOf, graph, onJump)
          )}
        </span>
      </p>
    </section>
  )
}

/** 「①接触 ／ ③提案（差し戻し）」の並び。押すと相手のカードへ飛ぶ。 */
function joinJumps(
  edges: readonly GraphEdge[],
  side: 'from' | 'to',
  numberOf: Map<string, string>,
  graph: FlowGraph,
  onJump: (key: string) => void,
) {
  const kindNote = (kind: GraphEdge['kind']): string =>
    kind === 'back' ? '（差し戻し）' : kind === 'skip' ? '（スキップ）' : ''
  return edges.map((edge, index) => {
    const key = edge[side]
    const name = graph.nodes.find((node) => node.key === key)?.name ?? key
    return (
      <span key={`${edge.from}-${edge.to}`}>
        {index > 0 && ' ／ '}
        <button type="button" className="ref-jump" onClick={() => onJump(key)}>
          {numberOf.get(key)}
          {name}
        </button>
        <span className="ref-kind">{kindNote(edge.kind)}</span>
      </span>
    )
  })
}

/**
 * この条件が見ているデータ（決定D）。
 *
 * `howTo` は手書きなので、条件式を変えて直し忘れるとズレる。AST から機械抽出した
 * フィールドの一覧を併記して、ズレを目視で分かるようにする。検査では防げないものを
 * 表示で見えるようにする、という位置づけ。
 */
function SeenData({ flow, check }: { flow: FlowDef; check: AutoCheck }) {
  const refs = referencedFields(check.condition)
  if (refs.length === 0) return null

  const describe = (source: string, path: readonly string[]): string => {
    const parts: string[] = []
    let table = tables[source === ROOT_SOURCE ? flow.target : source]
    parts.push(table?.label ?? source)
    for (const segment of path) {
      const field = table?.fields[segment]
      parts.push(field?.label ?? segment)
      table = field?.references === undefined ? undefined : tables[field.references]
    }
    return parts.join('.')
  }

  return (
    <p className="ref-sees">
      見ているデータ: {refs.map((ref) => describe(ref.source, ref.path)).join(' ／ ')}
    </p>
  )
}

// ---------------------------------------------------------------------------
// 使うデータ（バインディングが営業にも見える形）
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<BindingRole, string> = {
  primary: '主対象',
  reference: '参照',
  master: 'マスタ',
}

function UsedData({ flow }: { flow: FlowDef }) {
  const usage = usedTables(flow)
  const declared = new Map(flow.bindings.map((binding) => [binding.table, binding]))
  // 並びは宣言順 → 宣言の無い横断マスタ（employee など）は導出順で後ろに
  const order = [
    ...flow.bindings.map((binding) => binding.table),
    ...Object.keys(usage).filter((table) => !declared.has(table)),
  ]

  return (
    <table className="ref-data">
      <thead>
        <tr>
          <th>データ</th>
          <th>位置づけ</th>
          <th>読み書き</th>
          <th>何のために</th>
          <th>使うステップ</th>
        </tr>
      </thead>
      <tbody>
        {order.map((tableName) => {
          const binding = declared.get(tableName)
          const used = usage[tableName]
          const steps = (used?.steps ?? [])
            .map((stepKey) => flow.steps.find((step) => step.key === stepKey)?.name ?? stepKey)
            .join('・')
          return (
            <tr key={tableName}>
              <td>{tables[tableName]?.label ?? tableName}</td>
              <td>
                {binding !== undefined ? (
                  ROLE_LABELS[binding.role]
                ) : (
                  <>
                    横断 <span className="muted">（global）</span>
                  </>
                )}
              </td>
              {/* write は書き込み専用ではなく読みも含む（§3-3）ので「読み書き」と出す */}
              <td>{used === undefined ? '—' : used.access === 'read' ? '読む' : '読み書き'}</td>
              <td>
                {binding?.purpose ?? (
                  <span className="muted">横断マスタ。実参照が自動記録される</span>
                )}
              </td>
              <td className="muted">{steps}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// 遷移グラフの描画（SVG）
// ---------------------------------------------------------------------------

// レイアウト定数。ノード数が増えたら見直す（それでも苦しければグラフごと捨てる）
const NODE_W = 118
const NODE_H = 36
const COL_GAP = 68
const ROW_GAP = 26
const PAD = 16
const LANE_GAP = 18

function GraphSvg({
  graph,
  selected,
  currentStep,
  onSelect,
}: {
  graph: FlowGraph
  selected: string | undefined
  currentStep: string | undefined
  onSelect: (key: string) => void
}) {
  const nodes = new Map(graph.nodes.map((node) => [node.key, node]))
  // スキップ辺はノードの上、後退辺は下を回す（5-3）。それぞれ専用レーンを積む
  const skips = graph.edges.filter((edge) => edge.kind === 'skip')
  const backs = graph.edges.filter((edge) => edge.kind === 'back')

  const top = PAD + skips.length * LANE_GAP
  const maxRank = Math.max(...graph.nodes.map((node) => node.rank))
  const maxRow = Math.max(...graph.nodes.map((node) => node.row))
  const x = (rank: number): number => PAD + rank * (NODE_W + COL_GAP)
  const y = (row: number): number => top + row * (NODE_H + ROW_GAP)
  const bottom = y(maxRow) + NODE_H
  const width = x(maxRank) + NODE_W + PAD
  const height = bottom + backs.length * LANE_GAP + PAD

  const touches = (edge: GraphEdge): boolean =>
    selected !== undefined && (edge.from === selected || edge.to === selected)
  const edgeClass = (edge: GraphEdge): string =>
    `edge ${edge.kind}${selected === undefined ? '' : touches(edge) ? ' hot' : ' dim'}`
  const nodeClass = (key: string): string => {
    const terminal = nodes.get(key)?.terminal === true ? ' terminal' : ''
    const current = key === currentStep ? ' current' : ''
    const state =
      selected === undefined
        ? ''
        : key === selected
          ? ' selected'
          : graph.edges.some((edge) => touches(edge) && (edge.from === key || edge.to === key))
            ? ''
            : ' dim'
    return `node${terminal}${current}${state}`
  }

  const path = (edge: GraphEdge): string => {
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (from === undefined || to === undefined) return ''
    if (edge.kind === 'skip') {
      // 上のレーンへ出て横移動し、相手の上辺へ降りる
      const lane = PAD + skips.indexOf(edge) * LANE_GAP
      const fx = x(from.rank) + NODE_W / 2
      const tx = x(to.rank) + NODE_W / 2
      return `M ${fx} ${y(from.row)} L ${fx} ${lane} L ${tx} ${lane} L ${tx} ${y(to.row)}`
    }
    if (edge.kind === 'back') {
      // 下のレーンを回って戻る
      const lane = bottom + LANE_GAP * (backs.indexOf(edge) + 1)
      const fx = x(from.rank) + NODE_W / 2
      const tx = x(to.rank) + NODE_W / 2
      const fy = y(from.row) + NODE_H
      const ty = y(to.row) + NODE_H
      return `M ${fx} ${fy} L ${fx} ${lane} L ${tx} ${lane} L ${tx} ${ty}`
    }
    // 前進は右辺から左辺へ。行が違えばゆるやかな曲線
    const fx = x(from.rank) + NODE_W
    const fy = y(from.row) + NODE_H / 2
    const tx = x(to.rank)
    const ty = y(to.row) + NODE_H / 2
    const mid = (fx + tx) / 2
    return `M ${fx} ${fy} C ${mid} ${fy}, ${mid} ${ty}, ${tx} ${ty}`
  }

  return (
    <svg
      className="flow-graph"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      role="img"
      aria-label="ステップの遷移図"
    >
      <defs>
        <marker
          id="flow-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" className="flow-arrow-head" />
        </marker>
      </defs>
      {graph.edges.map((edge) => (
        <path
          key={`${edge.from}-${edge.to}`}
          className={edgeClass(edge)}
          d={path(edge)}
          markerEnd="url(#flow-arrow)"
        />
      ))}
      {graph.nodes.map((node) => (
        <g
          key={node.key}
          className={nodeClass(node.key)}
          transform={`translate(${x(node.rank)}, ${y(node.row)})`}
          onClick={() => onSelect(node.key)}
        >
          <rect width={NODE_W} height={NODE_H} rx={7} />
          <text x={NODE_W / 2} y={NODE_H / 2 + 1} textAnchor="middle" dominantBaseline="central">
            {node.name}
          </text>
        </g>
      ))}
    </svg>
  )
}

function LegendLine({ kind }: { kind: GraphEdge['kind'] }) {
  return (
    <svg className="flow-legend-line" viewBox="0 0 36 8" width="36" height="8" aria-hidden="true">
      <path className={`edge ${kind}`} d="M 1 4 L 35 4" />
    </svg>
  )
}
