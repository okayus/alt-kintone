/**
 * 「この要望で変わること」。docs/impl/phase-10-definition-diff.md 完了条件5
 *
 * **起票者が、自分の要望がどう解釈されたかを読む場所。** 返事が「直しました」の一文だと
 * 何が変わるのか分からない、という phase-9 の宿題への答えがここに出る。
 *
 * 描画は**保存された `BundleDiff` を読むだけ**で、定義を参照しない。理由は
 * 提案差分が保存物だから（§2-1）— ラベルは書き込み時に解決済みで、そのあと定義が
 * さらに変わっても、見送りで消えても、当時の言葉のまま読める。
 * 「型名や列名を出さない」（完了条件2）も、計算側が守っていればここは何もしなくてよい。
 */
import type { BundleDiff, DiffEntry, MergedGraph } from '@alt/diff'
import { FlowGraphSvg, LegendLine } from '../FlowGraphSvg'

export function RequestProposal({ proposal }: { proposal: BundleDiff }) {
  if (proposal.empty) {
    return (
      <section className="request-proposal">
        <h3>この要望で変わること</h3>
        <p className="muted">変更はありません（対応の内容を読んでください）。</p>
      </section>
    )
  }

  return (
    <section className="request-proposal">
      <h3>この要望で変わること</h3>

      {group(proposal.entries).map(([where, entries]) => (
        <div key={where} className="proposal-group">
          <p className="proposal-where">{where === '' ? '全体' : where}</p>
          <ul className="proposal-entries">
            {entries.map((entry, index) => (
              <li
                key={`${entry.kind}-${entry.ref ?? index}`}
                className={`proposal-${entry.change}`}
              >
                <span className="proposal-mark" aria-hidden="true">
                  {mark(entry.change)}
                </span>
                <span className="proposal-text">
                  {entry.summary}
                  {entry.detail !== undefined && (
                    <span className="proposal-detail">{entry.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {proposal.graphs.map((graph) => (
        <ProposalGraph key={graph.flowKey} graph={graph} />
      ))}

      {(proposal.impacts.length > 0 || proposal.notCounted.length > 0) && (
        <div className="proposal-impact">
          <p className="proposal-where">いま入っているデータへの影響</p>
          <ul>
            {proposal.impacts.map((impact) => (
              <li key={impact.ref}>{impact.summary}</li>
            ))}
            {/*
              数えられなかったものも出す。出さないと「影響 0 件」と「数えていない」が
              画面で見分けられなくなる（§2-3）
            */}
            {proposal.notCounted.map((missing) => (
              <li key={missing.ref} className="muted">
                {missing.summary}: {missing.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * 前後を重ねた1枚（§2-2）。**位置は変更後の定義で決まっている**ので、
 * 残るステップは変更前と同じところに居る。動いて見えるものは本当に変わったものだけ。
 */
function ProposalGraph({ graph }: { graph: MergedGraph }) {
  const changed = graph.nodes.some((node) => node.change !== 'unchanged')
  const edgeChanged = graph.edges.some((edge) => edge.change !== 'unchanged')
  if (!changed && !edgeChanged) return null

  return (
    <div className="proposal-graph">
      <p className="proposal-where">{graph.flowName} の進み方（変更後）</p>
      <FlowGraphSvg
        nodes={graph.nodes}
        edges={graph.edges}
        label={`${graph.flowName}の遷移図（変更前後を重ねたもの）`}
      />
      <p className="flow-legend">
        <LegendLine kind="added" /> 増える
        <LegendLine kind="removed" /> 無くなる
        <span className="muted">枠が濃い段階は中身が変わります</span>
      </p>
    </div>
  )
}

const mark = (change: DiffEntry['change']): string =>
  change === 'added' ? '＋' : change === 'removed' ? '−' : '◆'

/** `where` が同じものを1つのかたまりにする。出現順を保つ（定義の宣言順が生きる）。 */
function group(entries: readonly DiffEntry[]): Array<[string, DiffEntry[]]> {
  const groups = new Map<string, DiffEntry[]>()
  for (const entry of entries) {
    const key = entry.where.join(' ＞ ')
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [entry])
    else list.push(entry)
  }
  return [...groups]
}
