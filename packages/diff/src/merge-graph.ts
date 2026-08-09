/**
 * 合併グラフ。docs/impl/phase-10-definition-diff.md §2-2（phase-9 論点F）
 *
 * ⚠ **前後の2枚を並べて描くと失敗する。** ノードを1つ足しただけで rank が変わり、
 * 関係ないノードまで全部動く。人間は「動いたもの」を「変わったもの」と読むので、
 * 何が変わったのか分からなくなる。
 *
 * だから1枚に重ねる。**位置は新しい定義で決め**（`layoutFlow(after)` をそのまま使う）、
 * 消えたノードだけを後から挿し込む。こうすると**残るノードの rank・row は動かない**
 * — これがこのモジュールの不変条件で、テストが直接それを見ている。
 */
import { layoutFlow, type FlowDef, type GraphEdge, type GraphNode, type StepDef } from '@alt/dsl'
import { sameValue } from './equal.js'
import type { GraphChange, MergedGraph } from './types.js'

const edgeId = (from: string, to: string): string => `${from} ${to}`

/**
 * 前後のフロー定義を1枚のグラフに重ねる。
 *
 * `before` が無ければ全部追加、`after` が無ければ全部削除。
 */
export function mergeFlowGraph(
  before: FlowDef | undefined,
  after: FlowDef | undefined,
): MergedGraph | undefined {
  if (before === undefined && after === undefined) return undefined

  // 片側しか無いときは、そのままレイアウトして全ノードに印を付ける
  if (after === undefined) return single(before as FlowDef, 'removed')
  if (before === undefined) return single(after, 'added')

  const base = layoutFlow(after)
  const beforeSteps = new Map(before.steps.map((step) => [step.key, step]))
  const afterSteps = new Map(after.steps.map((step) => [step.key, step]))

  const nodes: MergedGraph['nodes'] = base.nodes.map((node) => {
    const old = beforeSteps.get(node.key)
    if (old === undefined) return { ...node, change: 'added' }
    return { ...node, change: stepChanged(old, afterSteps.get(node.key) as StepDef) }
  })

  // 消えたノードを挿し込む。位置は「**旧レイアウトで自分より左にいて、いまも残っている**
  // ノードの右隣」を借りる（§2-2）ので、残るノードの位置には触らない
  const rankOf = new Map(nodes.map((node) => [node.key, node.rank]))
  const beforeRanks = new Map(layoutFlow(before).nodes.map((node) => [node.key, node.rank]))
  const rowsUsed = new Map<number, number>()
  for (const node of nodes)
    rowsUsed.set(node.rank, Math.max(rowsUsed.get(node.rank) ?? 0, node.row))

  for (const step of before.steps) {
    if (afterSteps.has(step.key)) continue
    const rank = borrowedRank(step.key, beforeRanks, rankOf)
    const row = (rowsUsed.get(rank) ?? -1) + 1
    rowsUsed.set(rank, row)
    rankOf.set(step.key, rank)
    nodes.push({
      key: step.key,
      name: step.name,
      rank,
      row,
      terminal: step.next.length === 0,
      change: 'removed',
    })
  }

  // 辺は和集合。新側にある辺は `layoutFlow` が決めた種類をそのまま使い、
  // 消えた辺だけ合併後の rank から種類を決め直す
  const drawn = new Map<string, GraphEdge & { change: GraphChange }>()
  for (const edge of base.edges) {
    const kept = beforeSteps.get(edge.from)?.next.includes(edge.to) === true
    drawn.set(edgeId(edge.from, edge.to), { ...edge, change: kept ? 'unchanged' : 'added' })
  }
  for (const step of before.steps) {
    for (const to of step.next) {
      const id = edgeId(step.key, to)
      if (drawn.has(id)) continue
      // 相手が定義から消えていて、こちらの新側にも無い辺（＝両端とも消えた）も描く。
      // ただし片方でも合併グラフに居ないなら線が引けないので落とす
      if (!rankOf.has(step.key) || !rankOf.has(to)) continue
      drawn.set(id, { from: step.key, to, kind: kindOf(rankOf, step.key, to), change: 'removed' })
    }
  }

  return { flowKey: after.key, flowName: after.name, nodes, edges: [...drawn.values()] }
}

// ---------------------------------------------------------------------------

function single(def: FlowDef, change: GraphChange): MergedGraph {
  const graph = layoutFlow(def)
  return {
    flowKey: def.key,
    flowName: def.name,
    nodes: graph.nodes.map((node: GraphNode) => ({ ...node, change })),
    edges: graph.edges.map((edge: GraphEdge) => ({ ...edge, change })),
  }
}

/**
 * ステップの中身が変わったか。**遷移（`next`）は見ない** — 遷移の変化は辺として
 * 描かれるので、ノードにも印を付けると同じことを二重に言うことになる。
 */
function stepChanged(before: StepDef, after: StepDef): GraphChange {
  const same =
    before.name === after.name &&
    before.intent === after.intent &&
    sameValue(before.roles, after.roles) &&
    sameValue(before.exit, after.exit)
  return same ? 'unchanged' : 'changed'
}

/**
 * 消えたノードを置く層。
 *
 * **旧レイアウトでの並びを基準にする** — 自分より左にいて、いまも残っているノードの
 * うちいちばん右の、さらに右隣。`next` の前任者を使わないのは、差し戻し（後退辺）で
 * 入ってくる相手が「前任者」に混ざり、消えたノードが右へ飛ぶため。
 *
 * 左に誰も残っていなければ右隣の残存ノードの左、それも無ければ起点の層。
 */
function borrowedRank(
  key: string,
  beforeRanks: Map<string, number>,
  afterRanks: Map<string, number>,
): number {
  const own = beforeRanks.get(key) ?? 0
  const survivors = [...beforeRanks].filter(([other]) => afterRanks.has(other))

  const left = survivors
    .filter(([, rank]) => rank < own)
    .map(([other]) => afterRanks.get(other) as number)
  if (left.length > 0) return Math.max(...left) + 1

  const right = survivors
    .filter(([, rank]) => rank > own)
    .map(([other]) => afterRanks.get(other) as number)
  if (right.length > 0) return Math.max(0, Math.min(...right) - 1)

  return 0
}

/** 消えた辺の種類。合併後の rank で決める（`layoutFlow` の規則と同じ形）。 */
function kindOf(rankOf: Map<string, number>, from: string, to: string): GraphEdge['kind'] {
  const distance = (rankOf.get(to) ?? 0) - (rankOf.get(from) ?? 0)
  if (distance <= 0) return 'back'
  return distance >= 2 ? 'skip' : 'forward'
}
