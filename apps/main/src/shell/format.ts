/**
 * 表示の整形。**ドメインに依存しないものだけ**を置く。
 * enum のラベルなど営業ドメインの語彙は `flows/sales/labels.ts`（業務画面側）。
 *
 * 日時は ISO 文字列を切り出すだけにして、タイムゾーン変換をしない。DB に入っているのは
 * UTC の ISO 文字列で、プロトタイプの確認では「保存した値がそのまま見える」ほうが
 * 追いやすいため。ロケール表示は客先の運用が決まってから。
 */

/** 金額。整数円・税抜（docs/domain-model.md §9-5）。 */
export function yen(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `¥${value.toLocaleString('ja-JP')}`
}

/** `2026-07-01T09:00:00.000Z` → `2026-07-01 09:00` */
export function dateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`.trim()
}

/** `2026-07-01T09:00:00.000Z` → `2026-07-01` */
export function day(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  return iso.slice(0, 10)
}

/**
 * `<input type="datetime-local">` の値（`2026-07-05T12:00`）を `as_of` に渡せる形にする。
 *
 * 入力を**UTCとして解釈する**。ブラウザのローカル時刻で解釈すると、同じ操作が
 * 環境によって別の時点を指すことになり、有効期間型の確認に使えない。
 * DB に入っているのも UTC の ISO 文字列なので、そのまま比較できる形に合わせる。
 */
export function asOfParam(local: string): string | undefined {
  if (local === '') return undefined
  const seconds = local.length === 16 ? ':00' : ''
  return `${local}${seconds}.000Z`
}

/** 空文字と null を「—」に寄せる。 */
export function orDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : value
}
