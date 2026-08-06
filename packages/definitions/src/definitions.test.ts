/**
 * 定義そのものの検証。
 *
 * `alt validate`（フェーズ2）が3層でやることの先取りだが、コマンドは作らない。
 * ここで確かめたいのは「いま書いた定義が、後続フェーズの入力として成立しているか」。
 *
 * 参照解決の検査に `compilePred` を使っているのは、条件式の参照整合を自前で
 * 書き直すより、実際に SQL へ変換してみるほうが強いため（変換できたなら
 * すべての field が registry で解決できている）。
 */
import {
  flowDefSchema,
  foreignKeysTo,
  roleDefSchema,
  tableDefSchema,
  usedTables,
  type ExitCondition,
} from '@alt/dsl'
import { compilePred, type ContextValues } from '@alt/sql'
import { describe, expect, it } from 'vitest'
import { flows, ROLE_KEYS, roles, sales, tables } from './index.js'

const EMPTY_CONTEXT: ContextValues = { 'currentUser.id': null, today: null, now: null }

function autoChecks(): Array<{ step: string; check: Extract<ExitCondition, { kind: 'auto' }> }> {
  return sales.steps.flatMap((s) =>
    s.exit.filter((e) => e.kind === 'auto').map((check) => ({ step: s.key, check })),
  )
}

describe('構文', () => {
  it('テーブル定義が zod 検証を通る', () => {
    for (const [name, def] of Object.entries(tables)) {
      const result = tableDefSchema.safeParse(def)
      expect(result.success, `${name}: ${JSON.stringify(result.error?.issues)}`).toBe(true)
    }
  })

  it('ロール定義が zod 検証を通る', () => {
    for (const role of roles) expect(roleDefSchema.safeParse(role).success).toBe(true)
  })

  it('フロー定義が zod 検証を通る', () => {
    const result = flowDefSchema.safeParse(sales)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it('JSON にしても壊れない（apply でバックエンドに渡る形）', () => {
    const roundTripped = JSON.parse(JSON.stringify({ tables, flows }))
    expect(roundTripped).toEqual({ tables, flows })
  })
})

describe('参照整合', () => {
  it('target が実在するテーブルを指す', () => {
    expect(tables[sales.target]).toBeDefined()
  })

  it('reads / writes / bindings のテーブルがすべて実在する', () => {
    const referenced = new Set([
      ...sales.steps.flatMap((s) => [...s.reads, ...s.writes]),
      ...sales.bindings.map((b) => b.table),
    ])
    expect([...referenced].filter((t) => tables[t] === undefined)).toEqual([])
  })

  it('遷移先のステップがすべて実在する', () => {
    const keys = new Set(sales.steps.map((s) => s.key))
    for (const s of sales.steps) {
      expect(
        s.next.filter((n) => !keys.has(n)),
        `${s.key} の next`,
      ).toEqual([])
    }
  })

  it('担当ロールが宣言済みのロールを指す', () => {
    for (const s of sales.steps) expect(ROLE_KEYS).toContain(s.role)
  })

  it('出口条件の条件式がすべて SQL に変換できる', () => {
    for (const { step, check } of autoChecks()) {
      expect(
        () =>
          compilePred(check.condition, {
            registry: tables,
            rootTable: sales.target,
            rootAlias: 'r',
            values: EMPTY_CONTEXT,
          }),
        `${step}/${check.key}`,
      ).not.toThrow()
    }
  })

  it('全ステップが initial から到達できる', () => {
    const byKey = new Map(sales.steps.map((s) => [s.key, s]))
    const seen = new Set([sales.initial])
    const queue = [sales.initial]
    while (queue.length > 0) {
      for (const next of byKey.get(queue.pop() as string)?.next ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    expect(sales.steps.filter((s) => !seen.has(s.key)).map((s) => s.key)).toEqual([])
  })
})

describe('業務ルール', () => {
  it('出口条件のキーがステップ内で一意', () => {
    for (const s of sales.steps) {
      const keys = s.exit.map((e) => e.key)
      expect(new Set(keys).size, `${s.key}`).toBe(keys.length)
    }
  })

  it('進行中のステップには出口条件がある（決着ステップは除く）', () => {
    const ongoing = sales.steps.filter((s) => s.next.length > 0 && s.key !== 'suspended')
    expect(ongoing.filter((s) => s.exit.length === 0)).toEqual([])
  })

  it('target が primary バインドされている', () => {
    const primary = sales.bindings.filter((b) => b.role === 'primary').map((b) => b.table)
    expect(primary).toContain(sales.target)
  })

  it('使っているテーブルは宣言されているか global である', () => {
    const declared = new Set(sales.bindings.map((b) => b.table))
    const undeclared = Object.keys(usedTables(sales)).filter(
      (t) => !declared.has(t) && tables[t]?.global !== true,
    )
    expect(undeclared).toEqual([])
  })

  it('宣言されているテーブルはどこかのステップで使われている', () => {
    const used = usedTables(sales)
    expect(sales.bindings.filter((b) => used[b.table] === undefined)).toEqual([])
  })

  it('横断マスタは宣言なしで使え、実参照は導出で記録される（§3-4 の案C）', () => {
    expect(tables['employee']?.global).toBe(true)
    expect(sales.bindings.map((b) => b.table)).not.toContain('employee')
    expect(usedTables(sales)['employee']).toEqual({
      access: 'read',
      steps: ['contacted', 'qualified', 'proposed'],
    })
  })

  it('access が reads / writes から導出される', () => {
    const usage = usedTables(sales)
    expect(usage['deal']?.access).toBe('write')
    expect(usage['activity']?.access).toBe('write')
    expect(usage['company']?.access).toBe('read')
    expect(usage['contact']?.access).toBe('read')
  })
})

describe('暗黙結合の前提', () => {
  // ここが崩れると exists の結合条件の書き方が変わる（docs/condition-ast.md §4）
  it('activity → deal の外部キーはちょうど1つ', () => {
    expect(foreignKeysTo(tables['activity'] as never, 'deal')).toEqual(['dealId'])
  })

  it('deal → contact の直接の外部キーは無い（だから決裁者の判定は明示結合）', () => {
    expect(foreignKeysTo(tables['deal'] as never, 'contact')).toEqual([])
  })
})
