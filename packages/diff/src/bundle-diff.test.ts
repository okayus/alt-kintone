/**
 * 差分が**意味のある単位**で、**業務の言葉**で出るか（完了条件1・2）。
 *
 * 検証の芯は2つ:
 *  - 出るべき変化が漏れないこと（論点B の一覧）
 *  - 出た文に**型名・列名・機械キーが混ざらない**こと（完了条件2）。
 *    ここが崩れると起票者の画面に `integer` や `initialBilling` が漏れる
 */
import { diffBundles } from './bundle-diff.js'
import {
  bind,
  check,
  enumOf,
  flow,
  integer,
  manualCheck,
  registry,
  role,
  step,
  table,
  text,
  uuid,
  type DefinitionBundle,
  type Pred,
} from '@alt/dsl'
import { describe, expect, it } from 'vitest'

const deal = table(
  'deal',
  {
    id: uuid('ID').primaryKey(),
    title: text('案件名').required(),
    initialBilling: integer('一時金・請求額'),
    probability: enumOf('確度', [
      { key: 'high', label: 'A（高）' },
      { key: 'low', label: 'C（低）' },
    ]),
  },
  { label: '案件' },
)

const hasBilling: Pred = {
  type: 'compare',
  op: 'gt',
  left: { type: 'field', source: 'root', path: ['initialBilling'] },
  right: { type: 'literal', value: 0 },
}
const hasTitle: Pred = {
  type: 'isNotNull',
  operand: { type: 'field', source: 'root', path: ['title'] },
}

const sales = flow({
  key: 'sales',
  name: '営業（新規開拓）',
  goal: '受注に至る',
  target: deal,
  initial: 'contacted',
  steps: [
    step({
      key: 'contacted',
      name: '接触',
      intent: '相手が話を聞く気になっている',
      roles: ['rep'],
      reads: [deal],
      writes: [deal],
      exit: [check('named', '案件名が入っている', '案件名を入れると充足する', hasTitle)],
      next: ['proposed'],
    }),
    step({
      key: 'proposed',
      name: '提案',
      intent: '提案が相手の検討に載っている',
      roles: ['rep'],
      reads: [deal],
      writes: [deal],
      exit: [manualCheck('presented', '提案した', '提案書を出したら ✓')],
      next: ['won'],
    }),
    step({
      key: 'won',
      name: '受注',
      intent: '発注が確定している',
      roles: ['rep'],
      reads: [deal],
      exit: [],
      next: [],
    }),
  ],
  bindings: [bind(deal, 'primary', '案件そのもの')],
})

const applied: DefinitionBundle = {
  tables: registry(deal),
  flows: [sales],
  roles: [role('rep', '営業', '案件を進める')],
}

/** 作業ツリー側を作る。`applied` を壊さないよう毎回 JSON で複製する。 */
const edited = (change: (draft: DefinitionBundle) => void): DefinitionBundle => {
  const draft = JSON.parse(JSON.stringify(applied)) as DefinitionBundle
  change(draft)
  return draft
}

const summaries = (after: DefinitionBundle): string[] =>
  diffBundles(applied, after).entries.map((entry) => entry.summary)

const only = (after: DefinitionBundle) => {
  const entries = diffBundles(applied, after).entries
  expect(entries).toHaveLength(1)
  return entries[0]
}

describe('変更が無ければ空', () => {
  it('同じバンドルを比べると empty', () => {
    const diff = diffBundles(applied, applied)
    expect(diff.entries).toEqual([])
    expect(diff.graphs).toEqual([])
    expect(diff.empty).toBe(true)
  })

  it('JSON を通した複製とも差が出ない（キーの順序で誤検知しない）', () => {
    expect(
      diffBundles(
        applied,
        edited(() => undefined),
      ).empty,
    ).toBe(true)
  })
})

describe('項目の変化', () => {
  it('増えた項目は、名前と入力の種類つきで出る', () => {
    const entry = only(
      edited((draft) => {
        const table0 = draft.tables['deal']
        if (table0 !== undefined) {
          table0.fields['competitor'] = {
            type: 'text',
            label: '競合他社',
            required: false,
            primaryKey: false,
          }
        }
      }),
    )
    expect(entry?.summary).toBe('項目が増えます: 「競合他社」（文字・任意）')
    expect(entry?.where).toEqual(['データ「案件」'])
    expect(entry?.ref).toBe('deal.competitor')
  })

  it('必須になったことが1行で出る', () => {
    const entry = only(
      edited((draft) => {
        const field = draft.tables['deal']?.fields['initialBilling']
        if (field !== undefined) field.required = true
      }),
    )
    expect(entry?.summary).toBe('項目「一時金・請求額」が必須になります')
  })

  it('型の変化は前後を人の言葉で出す', () => {
    const entry = only(
      edited((draft) => {
        const field = draft.tables['deal']?.fields['initialBilling']
        if (field !== undefined) field.type = 'text'
      }),
    )
    expect(entry?.summary).toBe('項目「一時金・請求額」の入力の種類が変わります（数値 → 文字）')
  })

  it('選択肢の増減は key ではなくラベルで出る', () => {
    const entry = only(
      edited((draft) => {
        const field = draft.tables['deal']?.fields['probability']
        if (field !== undefined)
          field.values = [...(field.values ?? []), { key: 'mid', label: 'B（中）' }]
      }),
    )
    expect(entry?.summary).toBe('項目「確度」の選択肢が変わります')
    expect(entry?.detail).toBe('＋「B（中）」')
  })

  it('項目が消えたことが出る', () => {
    const entry = only(
      edited((draft) => {
        const fields = draft.tables['deal']?.fields
        if (fields !== undefined) delete fields['competitor2']
        if (fields !== undefined) delete fields['probability']
      }),
    )
    expect(entry?.summary).toBe('項目が無くなります: 「確度」')
  })
})

describe('業務フローの変化', () => {
  it('段階が増えると、意図つきで出る', () => {
    const diff = diffBundles(
      applied,
      edited((draft) => {
        const flow0 = draft.flows[0]
        flow0?.steps.splice(2, 0, {
          key: 'approval',
          name: '稟議',
          intent: '相手の社内で決裁が回っている',
          roles: ['rep'],
          reads: ['deal'],
          writes: [],
          exit: [],
          next: ['won'],
        })
        const proposed = flow0?.steps.find((s) => s.key === 'proposed')
        if (proposed !== undefined) proposed.next = ['approval']
      }),
    )
    expect(diff.entries.map((entry) => entry.summary)).toEqual([
      '段階が増えます: 「稟議」',
      'ここから進める先が変わります',
    ])
    expect(diff.entries[0]?.detail).toBe('相手の社内で決裁が回っている')
    expect(diff.entries[0]?.where).toEqual(['業務フロー「営業（新規開拓）」'])
  })

  it('出る条件が増えると、種類と充足のしかたが出る', () => {
    const entry = only(
      edited((draft) => {
        draft.flows[0]?.steps
          .find((s) => s.key === 'proposed')
          ?.exit.push({
            kind: 'auto',
            key: 'quote_sent',
            label: '見積を提示した',
            howTo: '案件に「一時金・請求額」を入れると充足します',
            condition: hasBilling,
          })
      }),
    )
    expect(entry?.summary).toBe('出る条件が増えます: 「見積を提示した」（自動判定）')
    expect(entry?.detail).toBe('案件に「一時金・請求額」を入れると充足します')
    expect(entry?.where).toEqual(['業務フロー「営業（新規開拓）」', 'ステップ「提案」'])
    // definitionRef の合成キーと同じ形（影響件数・要望の対象と突き合わせるため）
    expect(entry?.ref).toBe('sales.proposed.quote_sent')
  })

  it('判定が変わったときは、AST ではなく「見ているデータ」の増減を出す', () => {
    const entry = only(
      edited((draft) => {
        const exit = draft.flows[0]?.steps[0]?.exit[0]
        if (exit?.kind === 'auto') exit.condition = hasBilling
      }),
    )
    expect(entry?.summary).toBe('出る条件「案件名が入っている」の判定が変わります')
    expect(entry?.detail).toBe('見ているデータ: ＋案件.一時金・請求額 ／ −案件.案件名')
  })

  it('手動が自動に変わると「手で確認しなくてよくなる」と出る', () => {
    const entry = only(
      edited((draft) => {
        const step0 = draft.flows[0]?.steps.find((s) => s.key === 'proposed')
        if (step0 !== undefined) {
          step0.exit = [
            {
              kind: 'auto',
              key: 'presented',
              label: '提案した',
              howTo: '提案書を出したら ✓',
              condition: hasBilling,
            },
          ]
        }
      }),
    )
    expect(entry?.summary).toBe(
      '出る条件「提案した」が自動判定に変わります（手で確認しなくてよくなります）',
    )
  })

  it('担当ロールの変化はロール名で出る', () => {
    const diff = diffBundles(
      applied,
      edited((draft) => {
        draft.roles.push({ key: 'mgr', name: '営業マネージャー', description: '見る' })
        const step0 = draft.flows[0]?.steps.find((s) => s.key === 'won')
        if (step0 !== undefined) step0.roles = ['mgr']
      }),
    )
    const roles = diff.entries.find((entry) => entry.kind === 'step.roles')
    expect(roles?.summary).toBe('この段階を進める担当が変わります')
    expect(roles?.detail).toBe('＋営業マネージャー ／ −営業')
  })
})

describe('合併グラフは、変わったフローにだけ付く', () => {
  it('フローに変化が無ければグラフは付かない', () => {
    const diff = diffBundles(
      applied,
      edited((draft) => {
        const table0 = draft.tables['deal']
        if (table0 !== undefined) table0.label = '商談'
      }),
    )
    expect(diff.entries).toHaveLength(1)
    expect(diff.graphs).toEqual([])
  })

  it('段階が増えたフローには合併グラフが1枚付く', () => {
    const diff = diffBundles(
      applied,
      edited((draft) => {
        draft.flows[0]?.steps
          .find((s) => s.key === 'proposed')
          ?.exit.push(manualCheck('extra', '追加の確認', '確認したら ✓'))
      }),
    )
    expect(diff.graphs).toHaveLength(1)
    expect(diff.graphs[0]?.flowName).toBe('営業（新規開拓）')
    expect(diff.graphs[0]?.nodes.find((node) => node.key === 'proposed')?.change).toBe('changed')
  })
})

describe('起票者の画面に機械の言葉が漏れない（完了条件2）', () => {
  it('summary と detail に列名・型名・キーが出ない', () => {
    const all = [
      ...summaries(
        edited((draft) => {
          const field = draft.tables['deal']?.fields['initialBilling']
          if (field !== undefined) {
            field.required = true
            field.type = 'text'
          }
        }),
      ),
      ...summaries(
        edited((draft) => {
          draft.flows[0]?.steps[0]?.exit.push(
            check('billed', '請求額が入っている', '請求額を入れると充足します', hasBilling),
          )
        }),
      ),
    ]
    const forbidden = ['initialBilling', 'integer', 'text', 'deal', 'sales', 'proposed', 'auto']
    for (const line of all) {
      for (const word of forbidden) expect(line).not.toContain(word)
    }
  })
})
