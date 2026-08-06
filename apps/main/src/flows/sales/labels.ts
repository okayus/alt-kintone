/**
 * enum の表示ラベル。docs/domain-model.md §5-0 の対応表
 *
 * ⚠ **定義に無いので手書きしている**（docs/product-concept.md §8-2 論点14）。
 *    `enumOf(['job_ad', 'meo', 'other'])` が持つのは英語キーだけで、日本語ラベルは
 *    ドキュメントにしかない。だからここは定義との二重管理で、enum に値を足しても
 *    このファイルは自動では増えず、**画面には英語キーがそのまま出る**（`label` の
 *    フォールバック）。落ちないのが厄介な点で、それが論点14 の中身。
 *
 * 対して**ステップ名とロール名は定義が持っている**ので、書き写さない
 * （`steps.ts` と下の `roleLabel`）。この差がそのまま「定義に何を持たせるべきか」の
 * 判断材料になる。
 */
import { roles } from '@alt/definitions'

type Labels = Record<string, string>

/** 見つからないキーはそのまま返す。定義に足してラベルを足し忘れると英語キーが出る。 */
export function label(labels: Labels, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return labels[value] ?? value
}

export const PRODUCT_TYPE: Labels = {
  job_ad: '求人広告',
  meo: 'MEO',
  other: 'その他',
}

export const DEAL_TYPE: Labels = {
  new: '新規',
  renewal: '更新',
  repeat: '再掲',
  expansion: '拡大',
}

export const DEAL_STATUS: Labels = {
  open: '進行中',
  suspended: '保留',
  won: '受注',
  lost: '失注',
  abandoned: '消滅',
}

export const OUTCOME_REASON: Labels = {
  competitor: '競合負け',
  own_reason: '自社都合',
  buyer_reason: '買い手都合',
  no_decision: '意思決定なし',
}

export const CONFIDENCE: Labels = { A: 'A', B: 'B', C: 'C' }

export const ACTIVITY_TYPE: Labels = {
  call: '架電',
  visit: '訪問',
  online_meeting: 'オンライン商談',
  email: 'メール',
  other: 'その他',
}

export const ACTIVITY_RESULT: Labels = {
  connected: '接続',
  no_answer: '不在',
  appointment: 'アポ獲得',
  advanced: '前進',
  won: '受注',
  lost: '失注',
  other: 'その他',
}

/** ロールは定義（`role('sales_rep', '営業担当', …)`）が名前を持つので、書き写さない。 */
export function roleLabel(key: string | null | undefined): string {
  if (key === null || key === undefined) return '—'
  return roles.find((role) => role.key === key)?.name ?? key
}
