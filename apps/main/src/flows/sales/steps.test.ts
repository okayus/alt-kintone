/**
 * 現在地表示の並べ方が、営業フロー定義に対して意図どおりになるか。
 *
 * レンダリングのテストは書かない（docs/impl/phase-4-frontend.md「テスト」）。
 * ここで確かめるのは**定義から機械的に決まる部分**だけで、見た目はブラウザで見る。
 */
import { exitLabel, laneOf, outcomeSteps, progressSteps, stepName } from './steps'
import { sales } from '@alt/definitions'
import { describe, expect, it } from 'vitest'

describe('レーンの分類', () => {
  it('すべてのステップがちょうど1つのレーンに入る', () => {
    const total = progressSteps.length + outcomeSteps.length
    expect(total).toBe(sales.steps.length)
    for (const step of progressSteps) expect(outcomeSteps).not.toContain(step)
  })

  it('出る先が無いステップが決着レーンになる', () => {
    for (const step of outcomeSteps) expect(step.next).toEqual([])
    for (const step of progressSteps) expect(step.next.length).toBeGreaterThan(0)
  })

  it('営業フローでは受注・失注・消滅が決着になる', () => {
    expect(outcomeSteps.map((step) => step.key)).toEqual(['won', 'lost', 'abandoned'])
  })

  it('進行レーンは定義の宣言順を保つ', () => {
    const declared = sales.steps.filter((step) => step.next.length > 0).map((step) => step.key)
    expect(progressSteps.map((step) => step.key)).toEqual(declared)
  })

  it('laneOf は next の有無だけで決まる', () => {
    expect(laneOf({ ...sales.steps[0]!, next: ['x'] })).toBe('progress')
    expect(laneOf({ ...sales.steps[0]!, next: [] })).toBe('outcome')
  })
})

describe('定義からのラベル引き', () => {
  it('ステップ名は定義から取る', () => {
    expect(stepName('qualified')).toBe('ヒアリング')
  })

  it('出口条件のラベルはフロー全体から探す（enteredUnmet は直前ステップのキー）', () => {
    expect(exitLabel('budget_confirmed')).toBe('予算感を確認した')
    expect(exitLabel('appointment_scheduled')).toBe('アポイントの予定がある')
  })

  it('定義に無いキーはキーのまま返す（取り残しが画面で見えるように）', () => {
    expect(stepName('removed_step')).toBe('removed_step')
    expect(exitLabel('removed_check')).toBe('removed_check')
  })
})
