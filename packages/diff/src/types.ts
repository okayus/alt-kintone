/**
 * 定義の差分の形。docs/impl/phase-10-definition-diff.md §4-2
 *
 * ⚠ **これは要望レコード（`change_request.proposal`）に保存される形でもある**（決定D）。
 * したがって次の2つが設計の制約になる:
 *
 *  1. **ラベルは計算時に解決して持つ**（決定B・§2-1）。機械キーだけ保存すると、
 *     そのあと定義が変わったり見送りで消えたりしたときに**何も表示できなくなる**。
 *     要望の対象（`definitionRef`）が機械キー保存・表示時解決なのと**時制が逆**
 *     — あちらは「いまの定義のどこを指すか」、こちらは「そのとき定義がどうだったか」
 *  2. **グラフは rank・row まで計算済みで持つ**（§2-2）。描画側がレイアウトを
 *     やり直さないので、保存した図はあとで開いても同じ形で出る
 */
import type { GraphEdge, GraphNode } from '@alt/dsl'

export type ChangeKind = 'added' | 'removed' | 'changed'

/** グラフの節・辺は「変わっていない」も持つ（差分の中で位置の基準になるため）。 */
export type GraphChange = ChangeKind | 'unchanged'

/** 差分1件。 */
export interface DiffEntry {
  /** 機械が分岐するためのキー。`field.added` / `exit.condition` など。 */
  kind: string
  change: ChangeKind
  /**
   * 業務上の位置。`['業務フロー「営業（新規開拓）」', 'ステップ「提案」']`。
   * 表示側はこれでグループ化して木にする。
   */
  where: string[]
  /** 業務の言葉で1行。「出る条件が1つ増えます: 「見積を提示した」（自動判定）」 */
  summary: string
  /** 補足。充足のしかた・前後の値・見ているデータの増減。 */
  detail?: string
  /**
   * 開発者向けの機械キー。`sales.proposed.timing_confirmed`。
   * **`definitionRef` の合成キーと同じ形**にしてあるので、影響件数や
   * 「この定義を指している要望」と突き合わせられる。起票者の画面には出さない。
   */
  ref?: string
}

export interface MergedGraph {
  flowKey: string
  flowName: string
  nodes: Array<GraphNode & { change: GraphChange }>
  edges: Array<GraphEdge & { change: GraphChange }>
}

/** 適用前に数えた「いまのデータへの影響」。 */
export interface Impact {
  /** 対応する `DiffEntry.ref`。 */
  ref: string
  where: string[]
  /** 「新しい条件が未充足になる案件: 87 件（提案にいる 214 件のうち）」 */
  summary: string
  count: number
  /** 母数。0 なら「そもそも対象がいない」。 */
  total: number
}

/** 数えられなかったもの。**黙って落とさない**（§2-3）。 */
export interface NotCounted {
  ref: string
  where: string[]
  summary: string
  reason: string
}

export interface BundleDiff {
  entries: DiffEntry[]
  /** 何かが変わったフローの合併グラフだけ。 */
  graphs: MergedGraph[]
  /** CLI が DB を見て埋める。数えていなければ空。 */
  impacts: Impact[]
  notCounted: NotCounted[]
  empty: boolean
}
