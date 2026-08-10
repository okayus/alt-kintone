/**
 * セル編集の値まわり（純関数）。docs/impl/phase-7-list-grid-edit.md 決定N・P
 *
 * エディタの型・候補・必須は**定義（`FieldDef`）から決める**。`DealForm` と同じ線で、
 * ここに書き写さない（書き写すと単に古くなる）。
 */
import type { FieldDef } from '@alt/dsl'

/** 編集中の入力は文字列で持つ。空文字が null を表す（`DealForm` の Draft と同じ）。 */
export function toDraft(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export type ParsedDraft =
  | { ok: true; value: string | number | null }
  | { ok: false; reason: string }

/**
 * draft → PATCH に載せる値。
 *
 * 送る前に弾くのは `DealForm` と同じ範囲（必須の空・非整数）だけで、それ以外の検証は
 * サーバの `validateInput` にある。FE に複製しない（§4-1 の認可と同じ理由 — 2箇所に
 * 分かれると必ず乖離する）。
 */
export function parseDraft(field: FieldDef, draft: string): ParsedDraft {
  if (draft === '') {
    if (field.required) return { ok: false, reason: `${field.label}は必須` }
    return { ok: true, value: null }
  }
  if (field.type === 'integer') {
    const value = Number(draft)
    if (!Number.isInteger(value)) return { ok: false, reason: '整数で入力する' }
    return { ok: true, value }
  }
  return { ok: true, value: draft }
}

/** 同値の確定は PATCH を送らない（決定N。Enter 連打で同値の版を積まない）。 */
export function isChanged(current: unknown, next: string | number | null): boolean {
  return (current ?? null) !== next
}

// ⚠ `isImeKey` はここから `shell/keys.ts` へ移した（フェーズ11 T1）。
//    チャットの Enter 送信も同じ罠を踏むので、業務フローの配下に置いておけない。
