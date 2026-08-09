/**
 * 合併グラフの不変条件。
 *
 * **いちばん大事なのは「残るノードが動かない」こと**（§2-2）。前後2枚を並べる案が
 * 失敗するのは、ノードを1つ足すと関係ないノードまで動いてしまうからで、
 * それを避けるためにこのモジュールがある。ここが崩れたら合併グラフを描く意味が消える。
 */
import { mergeFlowGraph } from './merge-graph.js'
import { flow, layoutFlow, step, table, text, uuid, type FlowDef, type StepDef } from '@alt/dsl'
import { describe, expect, it } from 'vitest'

const target = table(
  'thing',
  { id: uuid('ID').primaryKey(), title: text('名前') },
  { label: 'もの' },
)

const s = (key: string, name: string, next: string[]): StepDef =>
  step({ key, name, intent: `${name}の意図`, roles: ['r'], exit: [], next })

const make = (steps: StepDef[], initial = 'a'): FlowDef =>
  flow({ key: 'f', name: '検証フロー', goal: 'g', target, initial, steps, bindings: [] })

/** a → b → c → d、a → c（スキップ）、c → b（差し戻し） */
const base = make([
  s('a', 'A', ['b', 'c']),
  s('b', 'B', ['c']),
  s('c', 'C', ['d', 'b']),
  s('d', 'D', []),
])

const nodeOf = (graph: ReturnType<typeof mergeFlowGraph>, key: string) =>
  graph?.nodes.find((node) => node.key === key)
const edgeOf = (graph: ReturnType<typeof mergeFlowGraph>, from: string, to: string) =>
  graph?.edges.find((edge) => edge.from === from && edge.to === to)

describe('残るノードが動かない（このモジュールの存在理由）', () => {
  it('ステップを1つ足しても、既存ノードの rank と row が変わらない', () => {
    const after = make([
      s('a', 'A', ['b', 'c']),
      s('b', 'B', ['c']),
      s('c', 'C', ['x', 'b']),
      s('x', 'X', ['d']),
      s('d', 'D', []),
    ])
    const merged = mergeFlowGraph(base, after)
    const alone = layoutFlow(after)

    for (const node of alone.nodes) {
      expect(nodeOf(merged, node.key)?.rank).toBe(node.rank)
      expect(nodeOf(merged, node.key)?.row).toBe(node.row)
    }
    expect(nodeOf(merged, 'x')?.change).toBe('added')
  })

  it('ステップを1つ消しても、残るノードの rank と row が変わらない', () => {
    const after = make([s('a', 'A', ['c']), s('c', 'C', ['d']), s('d', 'D', [])])
    const merged = mergeFlowGraph(base, after)
    const alone = layoutFlow(after)

    for (const node of alone.nodes) {
      expect(nodeOf(merged, node.key)?.rank).toBe(node.rank)
      expect(nodeOf(merged, node.key)?.row).toBe(node.row)
    }
  })
})

describe('消えたノードの置き場', () => {
  const after = make([s('a', 'A', ['c']), s('c', 'C', ['d']), s('d', 'D', [])])
  const merged = mergeFlowGraph(base, after)

  it('消えたノードも描かれ、removed が立つ', () => {
    expect(nodeOf(merged, 'b')?.change).toBe('removed')
    expect(nodeOf(merged, 'b')?.name).toBe('B')
  })

  it('前任者（a: rank 0）の右隣に置かれる', () => {
    expect(nodeOf(merged, 'b')?.rank).toBe(1)
  })

  it('同じ層の既存ノードと row がぶつからない', () => {
    const rank = nodeOf(merged, 'b')?.rank
    const rows = merged?.nodes.filter((node) => node.rank === rank).map((node) => node.row) ?? []
    expect(new Set(rows).size).toBe(rows.length)
  })
})

describe('辺の印', () => {
  const after = make([
    s('a', 'A', ['b']), // a → c（スキップ）が消えた
    s('b', 'B', ['c']),
    s('c', 'C', ['d', 'b']),
    s('d', 'D', []),
  ])
  const merged = mergeFlowGraph(base, after)

  it('残った辺は unchanged', () => {
    expect(edgeOf(merged, 'a', 'b')?.change).toBe('unchanged')
    expect(edgeOf(merged, 'c', 'd')?.change).toBe('unchanged')
  })

  it('消えた辺も描かれ、removed が立つ', () => {
    expect(edgeOf(merged, 'a', 'c')?.change).toBe('removed')
  })

  it('増えた辺は added', () => {
    const grown = mergeFlowGraph(
      base,
      make([...base.steps.filter((x) => x.key !== 'b'), s('b', 'B', ['c', 'd'])]),
    )
    expect(edgeOf(grown, 'b', 'd')?.change).toBe('added')
  })

  it('差し戻し（後退辺）は back のまま', () => {
    expect(edgeOf(merged, 'c', 'b')?.kind).toBe('back')
  })
})

describe('ノードの変更', () => {
  it('意図や名前が変わると changed が立つ', () => {
    const after = make([
      s('a', 'A', ['b', 'c']),
      step({ key: 'b', name: 'B改', intent: 'Bの意図', roles: ['r'], exit: [], next: ['c'] }),
      s('c', 'C', ['d', 'b']),
      s('d', 'D', []),
    ])
    expect(nodeOf(mergeFlowGraph(base, after), 'b')?.change).toBe('changed')
  })

  it('遷移だけが変わってもノードには印を付けない（辺として描かれるから）', () => {
    const after = make([
      s('a', 'A', ['b']),
      s('b', 'B', ['c']),
      s('c', 'C', ['d', 'b']),
      s('d', 'D', []),
    ])
    expect(nodeOf(mergeFlowGraph(base, after), 'a')?.change).toBe('unchanged')
  })
})

describe('片側しか無いとき', () => {
  it('フローが増えたときは全ノードが added', () => {
    const merged = mergeFlowGraph(undefined, base)
    expect(merged?.nodes.every((node) => node.change === 'added')).toBe(true)
    expect(merged?.edges.every((edge) => edge.change === 'added')).toBe(true)
  })

  it('フローが無くなったときは全ノードが removed', () => {
    const merged = mergeFlowGraph(base, undefined)
    expect(merged?.nodes.every((node) => node.change === 'removed')).toBe(true)
  })

  it('両方無ければ undefined', () => {
    expect(mergeFlowGraph(undefined, undefined)).toBeUndefined()
  })
})
