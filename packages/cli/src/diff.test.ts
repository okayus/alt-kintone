/**
 * 差分の CLI 側 — **いまのデータへの影響を数える部分**（完了条件4）。
 *
 * 差分そのものの中身は `@alt/diff` のテストが見ているので、ここで見るのは
 * 「実 SQLite に対して数えた結果が正しいか」と「**数えられないものを黙って落とさないか**」。
 * 後者が §2-3 の ⚠ で、これを落とすと「影響 0 件」と「数えていない」が
 * 画面上で見分けられなくなる。
 */
import { apply } from './apply.js'
import { loadBundle } from './bundle.js'
import { attachProposal, measureImpact } from './diff.js'
import { seed } from './seed.js'
import { diffBundles } from '@alt/diff'
import type { DefinitionBundle, Pred } from '@alt/dsl'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

const applied = loadBundle()

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  apply(db, applied)
  seed(db, applied, { reset: true })
})

/** 適用済みを壊さずに作業ツリー側を作る。 */
const edited = (change: (draft: DefinitionBundle) => void): DefinitionBundle => {
  const draft = JSON.parse(JSON.stringify(applied)) as DefinitionBundle
  change(draft)
  return draft
}

const measure = (working: DefinitionBundle) => {
  const diff = diffBundles(applied, working)
  return measureImpact(db, applied, working, diff.entries)
}

const notNull = (path: string): Pred => ({
  type: 'isNotNull',
  operand: { type: 'field', source: 'root', path: [path] },
})

const salesStep = (draft: DefinitionBundle, key: string) =>
  draft.flows.find((flow) => flow.key === 'sales')?.steps.find((step) => step.key === key)

describe('追加された自動判定の未充足件数', () => {
  it('そのステップにいる件数と、満たさない件数が出る', () => {
    const { impacts } = measure(
      edited((draft) => {
        salesStep(draft, 'qualified')?.exit.push({
          kind: 'auto',
          key: 'noted',
          label: 'メモが書いてある',
          howTo: '案件のメモを書くと充足する',
          condition: notNull('note'),
        })
      }),
    )
    const impact = impacts.find((i) => i.ref === 'sales.qualified.noted')
    expect(impact).toBeDefined()
    // seed の案件のうちヒアリングにいるもの。母数と未充足が両方出る
    expect(impact?.total).toBeGreaterThan(0)
    expect(impact?.count).toBeLessThanOrEqual(impact?.total ?? 0)
    expect(impact?.summary).toContain('未充足になる案件')
  })

  it('⚠ NULL を未充足として数える（NOT で数えると取りこぼす）', () => {
    // 全案件で NULL の項目を見る条件 → そのステップにいる全件が未充足になるはず
    const { impacts } = measure(
      edited((draft) => {
        const table = draft.tables['deal']
        if (table !== undefined) {
          table.fields['memo2'] = {
            type: 'text',
            label: '予備メモ',
            required: false,
            primaryKey: false,
          }
        }
        salesStep(draft, 'qualified')?.exit.push({
          kind: 'auto',
          key: 'memo2_written',
          label: '予備メモが書いてある',
          howTo: '予備メモを書くと充足する',
          condition: notNull('closedAt'), // seed では常に NULL（決着していない案件）
        })
      }),
    )
    const impact = impacts.find((i) => i.ref === 'sales.qualified.memo2_written')
    expect(impact?.count).toBe(impact?.total)
    expect(impact?.count).toBeGreaterThan(0)
  })

  it('新しい項目を見ている条件は、数えずに理由を残す（§2-3）', () => {
    const { impacts, notCounted } = measure(
      edited((draft) => {
        const table = draft.tables['deal']
        if (table !== undefined) {
          table.fields['renewalNote'] = {
            type: 'text',
            label: '更新メモ',
            required: false,
            primaryKey: false,
          }
        }
        salesStep(draft, 'proposed')?.exit.push({
          kind: 'auto',
          key: 'renewal_noted',
          label: '更新の見込みを書いた',
          howTo: '更新メモを書くと充足する',
          condition: notNull('renewalNote'),
        })
      }),
    )
    expect(impacts.find((i) => i.ref === 'sales.proposed.renewal_noted')).toBeUndefined()
    const missing = notCounted.find((i) => i.ref === 'sales.proposed.renewal_noted')
    expect(missing?.reason).toContain('適用前には数えられません')
    // 理由も業務の言葉で出す（完了条件2）。列名が出ると起票者の画面に漏れる
    expect(missing?.reason).toContain('案件.更新メモ')
    expect(missing?.reason).not.toContain('renewalNote')
  })

  it('手動チェックの追加は数えない（全件が未確認から始まるので意味がない）', () => {
    const { impacts, notCounted } = measure(
      edited((draft) => {
        salesStep(draft, 'qualified')?.exit.push({
          kind: 'manual',
          key: 'talked',
          label: '話した',
          howTo: '話したら ✓',
        })
      }),
    )
    expect(impacts).toEqual([])
    expect(notCounted).toEqual([])
  })
})

describe('消えるステップの滞留件数', () => {
  it('いまそこにいる件数が出る', () => {
    const { impacts } = measure(
      edited((draft) => {
        const flow = draft.flows.find((f) => f.key === 'sales')
        if (flow === undefined) return
        flow.steps = flow.steps.filter((step) => step.key !== 'suspended')
        for (const step of flow.steps) step.next = step.next.filter((to) => to !== 'suspended')
      }),
    )
    const impact = impacts.find((i) => i.ref === 'sales.suspended')
    expect(impact?.summary).toContain('行き先が無くなる案件')
    expect(impact?.count).toBeGreaterThanOrEqual(0)
    expect(impact?.total).toBeGreaterThan(0)
  })
})

describe('必須になる項目', () => {
  it('いま空のままの件数が出る', () => {
    const { impacts } = measure(
      edited((draft) => {
        const field = draft.tables['deal']?.fields['competitor']
        if (field !== undefined) field.required = true
      }),
    )
    const impact = impacts.find((i) => i.ref === 'deal.competitor')
    expect(impact?.summary).toContain('空のままになる案件')
    expect(impact?.count).toBe(impact?.total) // seed は競合先を入れていない
  })

  it('任意になる側は影響として数えない', () => {
    const { impacts } = measure(
      edited((draft) => {
        const field = draft.tables['deal']?.fields['title']
        if (field !== undefined) field.required = false
      }),
    )
    expect(impacts.find((i) => i.ref === 'deal.title')).toBeUndefined()
  })
})

describe('要望に添える（決定D）', () => {
  it('版が1つ積まれ、変更案が読み戻せる。文脈に要望フローが残る', () => {
    const working = edited((draft) => {
      const field = draft.tables['deal']?.fields['competitor']
      if (field !== undefined) field.required = true
    })
    const diff = diffBundles(applied, working)
    attachProposal(db, working, 'cr-competitor', diff)

    const rows = db
      .prepare(
        'SELECT valid_to, changed_flow, changed_step, proposal FROM change_request WHERE id = ?',
      )
      .all('cr-competitor') as Array<{
      valid_to: string | null
      changed_flow: string | null
      changed_step: string | null
      proposal: string | null
    }>
    expect(rows).toHaveLength(2)

    const current = rows.find((row) => row.valid_to === null)
    expect(current?.changed_flow).toBe('request')
    expect(current?.changed_step).toBe('triaged')
    expect(JSON.parse(current?.proposal ?? 'null')).toEqual(diff)
    // 前の版には変更案が入っていない（＝ 上書きではなく版になっている）
    expect(rows.find((row) => row.valid_to !== null)?.proposal).toBeNull()
  })

  it('ほかの項目は引き継がれる（読み直して1つだけ差し替える）', () => {
    const diff = diffBundles(applied, applied)
    attachProposal(db, applied, 'cr-competitor', diff)
    const row = db
      .prepare(
        'SELECT problem, kind, filed_at FROM change_request WHERE id = ? AND valid_to IS NULL',
      )
      .get('cr-competitor') as { problem: string; kind: string; filed_at: string }
    expect(row.problem).not.toBe('')
    expect(row.kind).toBe('cannot_record')
    expect(row.filed_at).not.toBe('')
  })

  it('無い要望を指したら、直し方つきで落ちる', () => {
    expect(() => attachProposal(db, applied, 'cr-nope', diffBundles(applied, applied))).toThrow(
      /要望が見つからない/,
    )
  })
})
