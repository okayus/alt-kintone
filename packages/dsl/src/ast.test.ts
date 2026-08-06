import { describe, expect, it } from 'vitest'
import {
  AST_VERSION,
  aggregateSchema,
  exprSchema,
  literalSchema,
  predSchema,
  referencedFields,
  ROOT_SOURCE,
  type Pred,
} from './ast.js'

// AST は純粋なデータ形式なので、テストではノードを直接書く。
// 書き味を整えるビルダーは TS 固有の層として別に用意する。
const field = (path: string[], source = ROOT_SOURCE) => ({ type: 'field', source, path }) as const
const lit = (value: string | number | boolean | null) => ({ type: 'literal', value }) as const

describe('AST_VERSION', () => {
  it('契約のバージョンを持つ', () => {
    expect(AST_VERSION).toBe(1)
  })
})

describe('literal', () => {
  it('スカラーと null を受け付ける', () => {
    for (const value of ['a', 1, true, null]) {
      expect(literalSchema.safeParse({ type: 'literal', value }).success).toBe(true)
    }
  })

  it('配列やオブジェクトは弾く', () => {
    expect(literalSchema.safeParse({ type: 'literal', value: [] }).success).toBe(false)
    expect(literalSchema.safeParse({ type: 'literal', value: { a: 1 } }).success).toBe(false)
  })
})

describe('field', () => {
  it('自テーブルの列を指す', () => {
    expect(exprSchema.safeParse(field(['expectedCloseMonth'])).success).toBe(true)
  })

  it('パスが2要素以上ならリレーションを辿る（外部キーのフィールド名を書く）', () => {
    expect(exprSchema.safeParse(field(['contactId', 'isDecisionMaker'], 'a')).success).toBe(true)
  })

  it('空のパスは弾く', () => {
    expect(exprSchema.safeParse({ type: 'field', source: ROOT_SOURCE, path: [] }).success).toBe(
      false,
    )
  })
})

describe('context', () => {
  it('既知の名前だけ受け付ける', () => {
    expect(exprSchema.safeParse({ type: 'context', name: 'today' }).success).toBe(true)
    expect(exprSchema.safeParse({ type: 'context', name: 'tomorrow' }).success).toBe(false)
  })
})

describe('aggregate', () => {
  it('count は field を取らなくてよい', () => {
    expect(
      aggregateSchema.safeParse({
        type: 'aggregate',
        fn: 'count',
        table: 'activity',
        alias: 'a',
      }).success,
    ).toBe(true)
  })

  it('count 以外は field が必須', () => {
    const base = { type: 'aggregate', fn: 'sum', table: 'quote', alias: 'q' }
    expect(aggregateSchema.safeParse(base).success).toBe(false)
    expect(aggregateSchema.safeParse({ ...base, field: ['amount'] }).success).toBe(true)
  })
})

describe('述語', () => {
  it('compare', () => {
    const pred: Pred = {
      type: 'compare',
      op: 'gt',
      left: field(['initialBilling']),
      right: lit(0),
    }
    expect(predSchema.safeParse(pred).success).toBe(true)
  })

  it('未知の演算子は弾く', () => {
    expect(
      predSchema.safeParse({
        type: 'compare',
        op: 'like',
        left: field(['title']),
        right: lit('%食堂%'),
      }).success,
    ).toBe(false)
  })

  it('in は空の候補を弾く', () => {
    expect(predSchema.safeParse({ type: 'in', left: field(['status']), values: [] }).success).toBe(
      false,
    )
    expect(
      predSchema.safeParse({ type: 'in', left: field(['status']), values: ['won', 'lost'] })
        .success,
    ).toBe(true)
  })

  it('and / or は空のオペランドを弾く', () => {
    expect(predSchema.safeParse({ type: 'and', operands: [] }).success).toBe(false)
    expect(predSchema.safeParse({ type: 'or', operands: [] }).success).toBe(false)
  })

  it('isNull / isNotNull', () => {
    expect(predSchema.safeParse({ type: 'isNull', operand: field(['closedAt']) }).success).toBe(
      true,
    )
    expect(predSchema.safeParse({ type: 'isNotNull', operand: field(['closedAt']) }).success).toBe(
      true,
    )
  })
})

describe('相互再帰', () => {
  // docs/domain-model.md §6-1「決裁者に会えている」
  // exists の where にリレーションを辿る field が入る形。
  it('exists の中に条件を入れ子にできる', () => {
    const pred: Pred = {
      type: 'exists',
      table: 'activity',
      alias: 'a',
      where: {
        type: 'and',
        operands: [
          // ビルダーが展開する暗黙結合。AST には明示的に現れる
          {
            type: 'compare',
            op: 'eq',
            left: field(['dealId'], 'a'),
            right: field(['id']),
          },
          { type: 'isNotNull', operand: field(['completedAt'], 'a') },
          {
            type: 'compare',
            op: 'eq',
            left: field(['contactId', 'isDecisionMaker'], 'a'),
            right: lit(true),
          },
        ],
      },
    }
    expect(predSchema.safeParse(pred).success).toBe(true)
  })

  // docs/condition-ast.md §3「3回以上接触している」
  it('aggregate を compare の左辺に置ける', () => {
    const pred: Pred = {
      type: 'compare',
      op: 'gte',
      left: {
        type: 'aggregate',
        fn: 'count',
        table: 'activity',
        alias: 'a',
        where: { type: 'isNotNull', operand: field(['completedAt'], 'a') },
      },
      right: lit(3),
    }
    expect(predSchema.safeParse(pred).success).toBe(true)
  })

  it('aggregate の where に exists を入れられる（Expr と Pred の相互再帰）', () => {
    const pred: Pred = {
      type: 'compare',
      op: 'gt',
      left: {
        type: 'aggregate',
        fn: 'count',
        table: 'contract',
        alias: 'c',
        where: {
          type: 'exists',
          table: 'contractChange',
          alias: 'cc',
          where: {
            type: 'compare',
            op: 'eq',
            left: field(['changeType'], 'cc'),
            right: lit('cancelled'),
          },
        },
      },
      right: lit(0),
    }
    expect(predSchema.safeParse(pred).success).toBe(true)
  })

  it('入れ子の奥にある不正なノードも弾く', () => {
    const pred = {
      type: 'exists',
      table: 'activity',
      alias: 'a',
      where: { type: 'isNotNull', operand: { type: 'field', source: 'a', path: [] } },
    }
    expect(predSchema.safeParse(pred).success).toBe(false)
  })
})

describe('referencedFields（表示用。TS/Go の契約ではない）', () => {
  // docs/impl/phase-5-flow-reference.md 決定D:
  // 「この条件が見ているデータ」を機械抽出して howTo のズレを目視できるようにする

  it('compare の両辺から field を拾う', () => {
    const pred: Pred = {
      type: 'compare',
      op: 'gt',
      left: field(['initialBilling']),
      right: lit(0),
    }
    expect(referencedFields(pred)).toEqual([{ source: ROOT_SOURCE, path: ['initialBilling'] }])
  })

  it('or の中を出現順に、重複なく拾う', () => {
    // 営業フローの「金額欄が埋まっている」と同じ形
    const pred: Pred = {
      type: 'or',
      operands: [
        { type: 'compare', op: 'gt', left: field(['initialBilling']), right: lit(0) },
        { type: 'compare', op: 'gt', left: field(['monthlyBilling']), right: lit(0) },
        // 同じフィールドがもう一度出ても増えない
        { type: 'isNotNull', operand: field(['initialBilling']) },
      ],
    }
    expect(referencedFields(pred)).toEqual([
      { source: ROOT_SOURCE, path: ['initialBilling'] },
      { source: ROOT_SOURCE, path: ['monthlyBilling'] },
    ])
  })

  it('exists の中はエイリアスではなくテーブル名で返す', () => {
    // 営業フローの「決裁者に会えている」と同じ形
    const pred: Pred = {
      type: 'exists',
      table: 'activity',
      alias: 'a',
      where: {
        type: 'and',
        operands: [
          { type: 'compare', op: 'eq', left: field(['dealId'], 'a'), right: field(['id']) },
          { type: 'isNotNull', operand: field(['completedAt'], 'a') },
          {
            type: 'compare',
            op: 'eq',
            left: field(['contactId', 'isDecisionMaker'], 'a'),
            right: lit(true),
          },
        ],
      },
    }
    expect(referencedFields(pred)).toEqual([
      { source: 'activity', path: ['dealId'] },
      { source: ROOT_SOURCE, path: ['id'] },
      { source: 'activity', path: ['completedAt'] },
      { source: 'activity', path: ['contactId', 'isDecisionMaker'] },
    ])
  })

  it('aggregate の集計対象フィールドと where も辿る', () => {
    const pred: Pred = {
      type: 'compare',
      op: 'gte',
      left: {
        type: 'aggregate',
        fn: 'sum',
        table: 'contract',
        alias: 'c',
        field: ['monthlyProfit'],
        where: { type: 'compare', op: 'eq', left: field(['status'], 'c'), right: lit('active') },
      },
      right: lit(100000),
    }
    expect(referencedFields(pred)).toEqual([
      { source: 'contract', path: ['monthlyProfit'] },
      { source: 'contract', path: ['status'] },
    ])
  })

  it('入れ子の exists で内側のエイリアスが外側を隠す', () => {
    const pred: Pred = {
      type: 'exists',
      table: 'contract',
      alias: 'x',
      where: {
        type: 'exists',
        table: 'contractChange',
        // 外側と同じエイリアス。内側の field は contractChange のもの
        alias: 'x',
        where: { type: 'isNotNull', operand: field(['changedAt'], 'x') },
      },
    }
    expect(referencedFields(pred)).toEqual([{ source: 'contractChange', path: ['changedAt'] }])
  })

  it('not と in も辿る', () => {
    const pred: Pred = {
      type: 'not',
      operand: { type: 'in', left: field(['status']), values: ['lost', 'abandoned'] },
    }
    expect(referencedFields(pred)).toEqual([{ source: ROOT_SOURCE, path: ['status'] }])
  })
})
