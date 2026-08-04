import type { Literal } from '@alt/dsl'
import { describe, expect, it } from 'vitest'
import { literalToSql } from './index.js'

// @alt/dsl は型としてのみ参照する（実行時に import しない）。
// ビルド済みの dist が無くてもこのテストが動くようにするため。
const lit = (value: Literal['value']): Literal => ({ type: 'literal', value })

describe('literalToSql', () => {
  it('値を埋め込まずバインドする', () => {
    expect(literalToSql(lit(0))).toEqual({ sql: '?', params: [0] })
  })

  it('文字列も引用せずバインドする', () => {
    expect(literalToSql(lit("O'Brien"))).toEqual({ sql: '?', params: ["O'Brien"] })
  })

  it('null もそのままバインドする', () => {
    expect(literalToSql(lit(null))).toEqual({ sql: '?', params: [null] })
  })
})
