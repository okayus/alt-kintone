import { describe, expect, it } from 'vitest'
import { AST_VERSION, literal, literalSchema } from './index.js'

describe('literal', () => {
  it('ノードを組み立てる', () => {
    expect(literal(0)).toEqual({ type: 'literal', value: 0 })
  })

  it('null を受け付ける（SQL の三値論理で使う）', () => {
    expect(literalSchema.parse({ type: 'literal', value: null })).toEqual({
      type: 'literal',
      value: null,
    })
  })

  it('対応していない値の型は弾く', () => {
    expect(literalSchema.safeParse({ type: 'literal', value: [] }).success).toBe(false)
    expect(literalSchema.safeParse({ type: 'literal', value: { a: 1 } }).success).toBe(false)
  })

  it('スキーマバージョンを持つ', () => {
    expect(AST_VERSION).toBe(1)
  })
})
