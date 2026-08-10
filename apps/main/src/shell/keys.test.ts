import { describe, expect, it } from 'vitest'
import { isImeKey } from './keys'

describe('isImeKey', () => {
  /**
   * 変換確定の Enter は「文字列の確定」であって「セル・メッセージの確定」ではない
   * （docs/impl/phase-7-list-grid-edit.md §2-2）。
   * Chrome / Firefox は isComposing、Safari の癖と古い経路は keyCode 229 で拾う。
   */
  it('isComposing か keyCode 229 なら IME のキー', () => {
    expect(isImeKey({ isComposing: true, keyCode: 229 })).toBe(true)
    expect(isImeKey({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(isImeKey({ isComposing: true, keyCode: 13 })).toBe(true)
    expect(isImeKey({ isComposing: false, keyCode: 13 })).toBe(false)
    expect(isImeKey({})).toBe(false)
  })
})
