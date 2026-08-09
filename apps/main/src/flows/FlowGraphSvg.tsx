/**
 * 遷移グラフの描画（SVG）。docs/impl/phase-5-flow-reference.md 5-3
 *
 * レイアウト（rank・row・辺の種類）は `@alt/dsl` の `layoutFlow` が決めていて、
 * ここがやるのは座標に落とすことだけ。**フェーズ10 で参照画面から切り出した** —
 * 合併グラフ（前後を1枚に重ねた差分の図）を同じ絵で描くため（決定C）。
 *
 * 差分の描き分けは `change` を持つノード・辺に class が1つ増えるだけで、
 * **レイアウトのコードは1本のまま**。「変更後のグラフ」と「変更の無いグラフ」が
 * 別の見た目にならないのは、ここを分けなかったからこそ。
 */
import type { GraphChange } from '@alt/diff'
import type { GraphEdge, GraphNode } from '@alt/dsl'

export type DrawableNode = GraphNode & { change?: GraphChange }
export type DrawableEdge = GraphEdge & { change?: GraphChange }

export interface FlowGraphSvgProps {
  nodes: readonly DrawableNode[]
  edges: readonly DrawableEdge[]
  /** 選ばれたノード。関係する辺だけ強調する。 */
  selected?: string | undefined
  /** 案件詳細から来たときの現在地。 */
  currentStep?: string | undefined
  /** 省略するとノードを押せなくなる（差分の図は読むだけ）。 */
  onSelect?: ((key: string) => void) | undefined
  label?: string
}

// レイアウト定数。ノード数が増えたら見直す（それでも苦しければグラフごと捨てる）
const NODE_W = 118
const NODE_H = 36
const COL_GAP = 68
const ROW_GAP = 26
const PAD = 16
const LANE_GAP = 18

export function FlowGraphSvg({
  nodes: nodeList,
  edges,
  selected,
  currentStep,
  onSelect,
  label = 'ステップの遷移図',
}: FlowGraphSvgProps) {
  const nodes = new Map(nodeList.map((node) => [node.key, node]))
  // スキップ辺はノードの上、後退辺は下を回す（5-3）。それぞれ専用レーンを積む
  const skips = edges.filter((edge) => edge.kind === 'skip')
  const backs = edges.filter((edge) => edge.kind === 'back')

  const top = PAD + skips.length * LANE_GAP
  const maxRank = Math.max(...nodeList.map((node) => node.rank))
  const maxRow = Math.max(...nodeList.map((node) => node.row))
  const x = (rank: number): number => PAD + rank * (NODE_W + COL_GAP)
  const y = (row: number): number => top + row * (NODE_H + ROW_GAP)
  const bottom = y(maxRow) + NODE_H
  const width = x(maxRank) + NODE_W + PAD
  const height = bottom + backs.length * LANE_GAP + PAD

  const touches = (edge: DrawableEdge): boolean =>
    selected !== undefined && (edge.from === selected || edge.to === selected)
  const changeClass = (change: GraphChange | undefined): string =>
    change === undefined || change === 'unchanged' ? '' : ` ${change}`
  const edgeClass = (edge: DrawableEdge): string =>
    `edge ${edge.kind}${changeClass(edge.change)}` +
    (selected === undefined ? '' : touches(edge) ? ' hot' : ' dim')
  const nodeClass = (key: string): string => {
    const node = nodes.get(key)
    const terminal = node?.terminal === true ? ' terminal' : ''
    const current = key === currentStep ? ' current' : ''
    const state =
      selected === undefined
        ? ''
        : key === selected
          ? ' selected'
          : edges.some((edge) => touches(edge) && (edge.from === key || edge.to === key))
            ? ''
            : ' dim'
    return `node${terminal}${current}${state}${changeClass(node?.change)}${
      onSelect === undefined ? ' fixed' : ''
    }`
  }

  const path = (edge: DrawableEdge): string => {
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
      aria-label={label}
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
      {edges.map((edge) => (
        <path
          key={`${edge.from}-${edge.to}`}
          className={edgeClass(edge)}
          d={path(edge)}
          markerEnd="url(#flow-arrow)"
        />
      ))}
      {nodeList.map((node) => (
        <g
          key={node.key}
          className={nodeClass(node.key)}
          transform={`translate(${x(node.rank)}, ${y(node.row)})`}
          onClick={onSelect === undefined ? undefined : () => onSelect(node.key)}
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

export function LegendLine({ kind }: { kind: GraphEdge['kind'] | GraphChange }) {
  return (
    <svg className="flow-legend-line" viewBox="0 0 36 8" width="36" height="8" aria-hidden="true">
      <path className={`edge ${kind}`} d="M 1 4 L 35 4" />
    </svg>
  )
}
