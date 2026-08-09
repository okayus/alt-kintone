/**
 * グラフのレイアウトが、実際の営業フロー定義に対して意図どおりになるか。
 *
 * 人工的なグラフではなく客先定義そのもので検証する（`steps.test.ts` と同じ方針）。
 * ここが崩れると参照画面の遷移図が嘘をつく。
 */
import { layoutFlow } from './flowGraph'
import { deal, sales } from '@alt/definitions'
import { flow, step, type FlowDef } from '@alt/dsl'
import { describe, expect, it } from 'vitest'

const graph = layoutFlow(sales)
const node = (key: string) => graph.nodes.find((n) => n.key === key)
const edge = (from: string, to: string) => graph.edges.find((e) => e.from === from && e.to === to)

describe('後退辺の検出', () => {
  it('差し戻し（提案→ヒアリング）と再開（保留→ヒアリング）が後退辺になる', () => {
    const backs = graph.edges.filter((e) => e.kind === 'back').map((e) => `${e.from}→${e.to}`)
    expect(backs.sort()).toEqual(['proposed→qualified', 'suspended→qualified'])
  })
})

describe('層（rank）の割当 — 最長経路法', () => {
  it('接触0 / ヒアリング1 / 提案2・保留2 / 受注3・失注3・消滅3', () => {
    const ranks = Object.fromEntries(graph.nodes.map((n) => [n.key, n.rank]))
    expect(ranks).toEqual({
      contacted: 0,
      qualified: 1,
      proposed: 2,
      suspended: 2,
      won: 3,
      lost: 3,
      abandoned: 3,
    })
  })

  it('最短経路ではない（即決スキップがあっても提案はヒアリングの右に来る）', () => {
    // contacted → proposed の辺（rank 差2）が最短経路法なら proposed を rank 1 にしてしまう
    expect(node('proposed')?.rank).toBeGreaterThan(node('qualified')?.rank ?? 99)
  })

  it('決着（next が空）が最終層に集まり、terminal が立つ', () => {
    for (const key of ['won', 'lost', 'abandoned']) {
      expect(node(key)?.rank).toBe(3)
      expect(node(key)?.terminal).toBe(true)
    }
    expect(node('suspended')?.terminal).toBe(false)
  })
})

describe('層内の並びと辺の種類', () => {
  it('同じ層では定義の宣言順（提案が保留より上、受注→失注→消滅の順）', () => {
    expect(node('proposed')?.row).toBe(0)
    expect(node('suspended')?.row).toBe(1)
    expect(['won', 'lost', 'abandoned'].map((k) => node(k)?.row)).toEqual([0, 1, 2])
  })

  it('rank +1 は前進、rank +2 以上はスキップ', () => {
    expect(edge('contacted', 'qualified')?.kind).toBe('forward')
    expect(edge('qualified', 'proposed')?.kind).toBe('forward')
    expect(edge('proposed', 'won')?.kind).toBe('forward')
    // 即決（ヒアリングを飛ばす）
    expect(edge('contacted', 'proposed')?.kind).toBe('skip')
    // 決着への長い辺もスキップ描画（層をまたぐ）
    expect(edge('contacted', 'lost')?.kind).toBe('skip')
    expect(edge('qualified', 'lost')?.kind).toBe('skip')
  })

  it('辺は定義の next を過不足なく写す', () => {
    const declared = sales.steps.flatMap((s) => s.next.map((to) => `${s.key}→${to}`))
    const drawn = graph.edges.map((e) => `${e.from}→${e.to}`)
    expect(drawn.sort()).toEqual(declared.sort())
  })
})

describe('壊れた定義でも落ちない（validate が拾う前提の防波堤）', () => {
  it('定義に無いステップへの next は無視する', () => {
    const brokenFlow: FlowDef = flow({
      key: 'x',
      name: 'x',
      goal: 'g',
      target: deal,
      initial: 'a',
      steps: [
        step({ key: 'a', name: 'A', intent: 'i', roles: ['r'], exit: [], next: ['ghost', 'b'] }),
        step({ key: 'b', name: 'B', intent: 'i', roles: ['r'], exit: [], next: [] }),
      ],
      bindings: [],
    })
    const g = layoutFlow(brokenFlow)
    expect(g.edges).toEqual([{ from: 'a', to: 'b', kind: 'forward' }])
  })
})
