/**
 * サイドパネルの決めごと。docs/impl/phase-13-chat-side-panel.md 完了条件7・11
 *
 * ここに置けるのは「幅の収め方」と「件数の基準」— どちらも DOM を要らないので、
 * ブラウザ層（`SidePanel.browser.test.tsx`）には**それでは捕まらないもの**だけ残す。
 */
import { describe, expect, it } from 'vitest'
import {
  clampWidth,
  DEFAULT_WIDTH,
  MIN_BODY_WIDTH,
  MIN_WIDTH,
  newSince,
  nextBaseline,
  openStorageKey,
  parseOpen,
  parseWidth,
} from './panel'

describe('clampWidth（完了条件7）', () => {
  it('本文に最低限を残す（広いモニタで保存した幅を狭い窓に持ち込んでも本文が消えない）', () => {
    // 1920 なら好みがそのまま通る
    expect(clampWidth(700, 1920)).toBe(700)
    // 1000 の窓では本文の下限に押し返される
    expect(clampWidth(700, 1000)).toBe(1000 - MIN_BODY_WIDTH)
  })

  it('本文の下限すら取れない窓では、パネルの下限を優先する（読めない幅にしない）', () => {
    expect(clampWidth(700, 600)).toBe(MIN_WIDTH)
  })

  it('狭すぎる指定はパネルの下限まで', () => {
    expect(clampWidth(10, 1920)).toBe(MIN_WIDTH)
  })

  it('小数は丸める（ポインタ座標がそのまま来る）', () => {
    expect(clampWidth(420.6, 1920)).toBe(421)
  })

  it('数でない値は既定に倒す', () => {
    expect(clampWidth(Number.NaN, 1920)).toBe(DEFAULT_WIDTH)
  })
})

describe('保存値の読み', () => {
  it('幅は無ければ既定、壊れていても既定', () => {
    expect(parseWidth(null)).toBe(DEFAULT_WIDTH)
    expect(parseWidth('こわれた')).toBe(DEFAULT_WIDTH)
    expect(parseWidth('520')).toBe(520)
  })

  it('**既定は開**（決定B）。閉じたことがある人だけ閉じたまま', () => {
    expect(parseOpen(null)).toBe(true)
    expect(parseOpen('true')).toBe(true)
    expect(parseOpen('false')).toBe(false)
  })

  it('開閉の置き場は画面種別ごとに分かれる（補助と本体で閉じたい度合いが違う）', () => {
    expect(openStorageKey('deal')).not.toBe(openStorageKey('request'))
  })
})

describe('閉じてから増えた件数（決定C）', () => {
  it('開いている間は基準を持たない＝合図を出さない', () => {
    expect(nextBaseline(true, 5, 3)).toBeNull()
    expect(newSince(5, null)).toBe(0)
  })

  it('閉じた瞬間の件数が基準になり、そこからの増分が出る', () => {
    const baseline = nextBaseline(false, 5, null)
    expect(baseline).toBe(5)
    // 増えても基準は動かない
    expect(nextBaseline(false, 7, baseline)).toBe(5)
    expect(newSince(7, baseline)).toBe(2)
  })

  it('まだ読めていない間は基準を持ち直す（利用者を切り替えた直後。完了条件11）', () => {
    const before = nextBaseline(false, 5, null)
    // 別の利用者になるとキーごと変わるので、いったん undefined に戻る
    const cleared = nextBaseline(false, undefined, before)
    expect(cleared).toBeNull()
    // **前の人の件数との差は出さない**
    expect(newSince(undefined, cleared)).toBe(0)
    // 新しい人のぶんが届いたら、そこが新しい基準
    expect(nextBaseline(false, 2, cleared)).toBe(2)
    expect(newSince(2, 2)).toBe(0)
  })

  it('件数が減っても負の合図は出さない', () => {
    expect(newSince(1, 5)).toBe(0)
  })
})
