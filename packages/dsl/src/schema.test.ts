import { describe, expect, it } from 'vitest'
import { AST_VERSION } from './ast.js'
import { predJsonSchema } from './schema.js'

describe('predJsonSchema', () => {
  it('契約のバージョンを $id に埋める', () => {
    expect(predJsonSchema().$id).toContain(`v${AST_VERSION}`)
  })

  it('JSON にシリアライズできる（Go に渡せる形）', () => {
    expect(() => JSON.stringify(predJsonSchema())).not.toThrow()
  })

  it('相互再帰が $ref として表現される', () => {
    expect(JSON.stringify(predJsonSchema())).toContain('$ref')
  })

  it('述語の選択肢を列挙している', () => {
    const json = JSON.stringify(predJsonSchema())
    for (const type of ['compare', 'exists', 'aggregate', 'isNull']) {
      expect(json).toContain(type)
    }
  })
})
