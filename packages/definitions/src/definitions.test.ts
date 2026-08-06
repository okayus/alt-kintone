/**
 * この定義集合に固有の前提。
 *
 * 定義が満たすべき**一般のルール**（構文・参照整合・業務ルール）は `alt validate` が
 * 持っている。この定義がそれを通ることは `packages/cli` のテストが見ているので、
 * ここに書くのは「営業ドメインをこう表現した」という**この定義集合固有の判断**だけ。
 *
 * 両方に書くと、ルールを直すたびに2箇所を追う羽目になる。
 */
import { foreignKeysTo, usedTables } from '@alt/dsl'
import { describe, expect, it } from 'vitest'
import { sales, tables } from './index.js'

describe('暗黙結合の前提', () => {
  // ここが崩れると出口条件の結合条件の書き方が変わる（docs/condition-ast.md §4）
  it('activity → deal の外部キーはちょうど1つ', () => {
    expect(foreignKeysTo(tables['activity'] as never, 'deal')).toEqual(['dealId'])
  })

  it('deal → contact の直接の外部キーは無い（だから決裁者の判定は明示結合）', () => {
    expect(foreignKeysTo(tables['deal'] as never, 'contact')).toEqual([])
  })
})

describe('バインディングの導出', () => {
  it('access が reads / writes から導出される', () => {
    const usage = usedTables(sales)
    expect(usage['deal']?.access).toBe('write')
    expect(usage['activity']?.access).toBe('write')
    expect(usage['company']?.access).toBe('read')
    expect(usage['contact']?.access).toBe('read')
  })

  it('横断マスタは宣言なしで使え、実参照は導出で記録される（§3-4 の案C）', () => {
    expect(tables['employee']?.global).toBe(true)
    expect(sales.bindings.map((b) => b.table)).not.toContain('employee')
    expect(usedTables(sales)['employee']).toEqual({
      access: 'read',
      steps: ['contacted', 'qualified', 'proposed'],
    })
  })
})
