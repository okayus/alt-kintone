/**
 * コマンド解析と終了コードの配線。
 *
 * validate / apply の中身はそれぞれのテストが見ているので、ここで見るのは
 * 「終了コードが CI で使える形になっているか」と「--json が構造化されているか」。
 */
import { loadBundle } from './bundle.js'
import { run, type Io } from './cli.js'
import { definitionBundleSchema } from '@alt/dsl'
import { describe, expect, it } from 'vitest'

function capture(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (line) => void out.push(line), err: (line) => void err.push(line) }
  return { code: run(argv, io), out: out.join('\n'), err: err.join('\n') }
}

describe('run', () => {
  it('validate — 正しい定義なら 0', () => {
    const result = capture(['validate'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('エラー 0 件')
  })

  it('validate --json — AI が読める形で出す', () => {
    const result = capture(['validate', '--json'])
    expect(JSON.parse(result.out)).toEqual({ ok: true, errorCount: 0, errors: [] })
  })

  it('export — 定義バンドルの JSON。欠けも化けもなく読み戻せる', () => {
    const result = capture(['export'])
    expect(result.code).toBe(0)

    const parsed: unknown = JSON.parse(result.out)
    expect(definitionBundleSchema.safeParse(parsed).success).toBe(true)
    // 定義がただのデータであること（関数や Date が混ざると JSON で落ちる）
    expect(parsed).toEqual(loadBundle())
  })

  it('未知のコマンドは 2（使い方の誤り）', () => {
    const result = capture(['bogus'])
    expect(result.code).toBe(2)
    expect(result.err).toContain('未知のコマンド: bogus')
  })

  it('未知のオプションも 2', () => {
    expect(capture(['validate', '--verbose']).code).toBe(2)
  })

  it('引数なしは使い方を出して 2', () => {
    const result = capture([])
    expect(result.code).toBe(2)
    expect(result.err).toContain('alt validate')
  })

  it('--help は 0', () => {
    expect(capture(['--help']).code).toBe(0)
  })
})
