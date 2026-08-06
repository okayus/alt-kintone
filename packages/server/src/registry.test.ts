/**
 * 定義レジストリ。**バインドされていないテーブルに API が生えない**ことが本題。
 * 構想の中で最も強い制約（docs/product-concept.md §3-2）を実装が担保しているか。
 */
import { buildRegistry, loadRegistry, writable } from './registry.js'
import { bundle } from './support.js'
import { table, text, uuid } from '@alt/dsl'
import { describe, expect, it } from 'vitest'

const registry = buildRegistry(bundle)
const paths = (method: string) =>
  registry
    .routes()
    .filter((r) => r.method === method)
    .map((r) => r.path)

describe('routes', () => {
  it('営業フローが使うテーブルに読み取りが生える', () => {
    expect(paths('GET')).toEqual(
      expect.arrayContaining([
        '/api/deal',
        '/api/deal/{id}',
        '/api/company',
        '/api/contact',
        '/api/activity',
        // 横断マスタ（global: true）も、実際に reads に出ていれば生える（§3-4 案C）
        '/api/employee',
      ]),
    )
  })

  it('writes に出るテーブルだけ書き込みが生える', () => {
    expect(paths('POST')).toEqual(expect.arrayContaining(['/api/deal', '/api/activity']))
    // company / contact / employee は reference（読むだけ）
    expect(paths('POST')).not.toContain('/api/company')
    expect(paths('PATCH')).not.toContain('/api/employee/{id}')
  })

  it('ステップ操作は target のテーブルにだけ生える', () => {
    expect(paths('POST')).toContain('/api/deal/{id}/advance')
    // activity は primary バインド（所有）だが target ではない
    expect(paths('POST')).not.toContain('/api/activity/{id}/advance')
    expect(paths('PUT')).toEqual(['/api/deal/{id}/checks/{key}'])
  })

  it('どのフローも使っていないテーブルにはルートが生えない', () => {
    const orphan = table('memo', { id: uuid().primaryKey(), body: text() })
    const withOrphan = buildRegistry({
      ...bundle,
      tables: { ...bundle.tables, memo: orphan },
    })
    expect(withOrphan.routes().map((r) => r.path)).not.toContain('/api/memo')
    expect(withOrphan.usage('memo')).toEqual([])
  })
})

describe('usage', () => {
  it('access はステップの reads / writes から導出される', () => {
    const [deal] = registry.usage('deal')
    const [company] = registry.usage('company')
    expect(deal?.access).toBe('write')
    expect(writable(deal?.access ?? 'read')).toBe(true)
    expect(company?.access).toBe('read')
    expect(writable(company?.access ?? 'read')).toBe(false)
  })

  it('宣言したバインディング（role / purpose / rowFilter）が引ける', () => {
    const [deal] = registry.usage('deal')
    expect(deal?.binding?.role).toBe('primary')
    expect(deal?.binding?.rowFilter?.write).toBeDefined()
    // 横断マスタは明示バインドが無い。それでも usage には出る
    expect(registry.usage('employee')[0]?.binding).toBeUndefined()
  })

  it('target のフローが引ける', () => {
    expect(registry.targetedBy('deal').map((f) => f.key)).toEqual(['sales'])
    expect(registry.targetedBy('activity')).toEqual([])
  })
})

describe('loadRegistry', () => {
  it('JSON を経由しても同じものが組める（バックエンドの実際の入口）', () => {
    const loaded = loadRegistry(JSON.parse(JSON.stringify(bundle)))
    expect(loaded.routes()).toEqual(registry.routes())
    expect(loaded.flow('sales')?.target).toBe('deal')
  })

  it('契約の形でない JSON は起動時に落とす', () => {
    expect(() => loadRegistry({ tables: {}, flows: [{ key: 'x' }], roles: [] })).toThrow(
      /定義バンドルが読めない/,
    )
  })
})
