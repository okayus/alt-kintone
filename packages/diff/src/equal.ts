/**
 * 定義どうしの比較。
 *
 * ⚠ `JSON.stringify` の一致で済ませない。比べるのは
 * 「**JSON から読んだバンドル**（適用済み）」と「**TS が組み立てたバンドル**（作業ツリー）」で、
 * オブジェクトのキーの順序が一致する保証がない。順序差を「変わった」と報告すると、
 * 何も直していないのに差分が出る（いちばん信用を失う壊れ方）。
 *
 * `undefined` と欠けたキーは同じものとして扱う。DSL のビルダーが
 * 「未指定のときはキーごと持たない」形で書いているのに対し、手で組み立てた値は
 * `undefined` を持つことがあるため。
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameValue(item, b[index]))
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] === undefined && right[key] === undefined) continue
    if (!sameValue(left[key], right[key])) return false
  }
  return true
}
