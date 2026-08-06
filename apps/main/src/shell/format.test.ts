import { asOfParam, dateTime, day, orDash, yen } from './format'
import { describe, expect, it } from 'vitest'

describe('yen', () => {
  it('整数円を区切って出す', () => {
    expect(yen(180000)).toBe('¥180,000')
    expect(yen(0)).toBe('¥0')
  })

  it('null は — にする（0 と区別する）', () => {
    expect(yen(null)).toBe('—')
  })
})

describe('日時', () => {
  it('ISO 文字列を切り出すだけでタイムゾーン変換をしない', () => {
    expect(dateTime('2026-07-01T09:00:00.000Z')).toBe('2026-07-01 09:00')
    expect(day('2026-07-01T09:00:00.000Z')).toBe('2026-07-01')
  })

  it('null は — にする', () => {
    expect(dateTime(null)).toBe('—')
    expect(day(undefined)).toBe('—')
  })
})

describe('asOfParam', () => {
  it('datetime-local の値を UTC の ISO 文字列として扱う', () => {
    expect(asOfParam('2026-07-05T12:00')).toBe('2026-07-05T12:00:00.000Z')
  })

  it('秒まで入っていればそのまま使う', () => {
    expect(asOfParam('2026-07-05T12:00:30')).toBe('2026-07-05T12:00:30.000Z')
  })

  it('空なら指定なし（現在を見る）', () => {
    expect(asOfParam('')).toBeUndefined()
  })
})

describe('orDash', () => {
  it('空文字と null を — に寄せる', () => {
    expect(orDash('')).toBe('—')
    expect(orDash(null)).toBe('—')
    expect(orDash('山田食堂')).toBe('山田食堂')
  })
})
