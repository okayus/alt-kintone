/**
 * サイドパネルの決めごと（純関数）。docs/impl/phase-13-chat-side-panel.md 決定B・C・G
 *
 * **パネルはチャットを知らない**（決定G）。ここにあるのは「幅をどう画面に収めるか」と
 * 「閉じている間に何件増えたか」だけで、どちらも DOM を触らないので unit で固定できる。
 *
 * 置き場がシェルなのは実装ハブ 決定13 のとおり — 開閉・幅・ハンドルは
 * **形が固定の機構**であって、業務ごとの形（一覧・フォーム）ではない。
 */

/**
 * 画面種別。**開閉はこの単位で覚える**（決定B）。
 * 案件のやりとりは補助、要望のやりとりは本体なので、閉じたい度合いが違う。
 */
export type PanelKind = 'deal' | 'request'

/** 既定の幅。ダブルクリックで戻る先でもある（決定F）。 */
export const DEFAULT_WIDTH = 420
/** これ以上狭いとやりとりが読めない。 */
export const MIN_WIDTH = 280
/**
 * 本文に必ず残す幅。パネルは本文を**狭める**もので、消すものではない（決定A）。
 * ⚠ この下限は**ドラッグ中だけでなく適用時にも**効かせる — 広いモニタで保存した幅を
 *   狭いウィンドウで開くと本文が消えるため（決定B ⚠、完了条件7）。
 */
export const MIN_BODY_WIDTH = 520

/** 閉じているときに取っ手のぶんだけ空ける幅。 */
export const CLOSED_GUTTER = 36

/**
 * シェルが空ける余白。パネルは viewport に貼り付くので、**本文だけでなく
 * ヘッダ・ナビ・バナーもそのぶん詰める**（決定A の push）。詰めないと、上部の
 * 操作（利用者切替・時点）がパネルの下に潜る。
 */
export function gutterWidth(open: boolean, width: number): number {
  return open ? width : CLOSED_GUTTER
}

/** 幅は画面ではなくモニタの好みなので、種別で分けず1つ（決定B）。 */
export const WIDTH_STORAGE_KEY = 'alt.panel.width'

export function openStorageKey(kind: PanelKind): string {
  return `alt.panel.open.${kind}`
}

/**
 * 幅を画面に収める。**保存値ではなく実効値を出す関数**なので、
 * ウィンドウが狭いときは「保存された好み」を残したまま表示だけ縮める。
 */
export function clampWidth(desired: number, viewportWidth: number): number {
  const max = Math.max(MIN_WIDTH, Math.round(viewportWidth) - MIN_BODY_WIDTH)
  const wanted = Number.isFinite(desired) ? Math.round(desired) : DEFAULT_WIDTH
  return Math.min(Math.max(wanted, MIN_WIDTH), max)
}

/** localStorage の値を幅にする。壊れていたら既定（起動を止めるほどのことではない）。 */
export function parseWidth(stored: string | null): number {
  if (stored === null) return DEFAULT_WIDTH
  const value = Number.parseInt(stored, 10)
  return Number.isFinite(value) ? value : DEFAULT_WIDTH
}

/** **既定は開**（決定B）。保存が無い＝まだ閉じたことがない人には見えていてほしい。 */
export function parseOpen(stored: string | null): boolean {
  return stored !== 'false'
}

/**
 * 「閉じてから増えた件数」の基準（決定C）。
 *
 * 開いている間は基準を持たない（＝合図を出さない）。閉じている間は
 * **閉じた瞬間の件数**が基準で、まだ読めていない間（`undefined`）は基準を持ち直す。
 *
 * ⚠ 持ち直しが要るのは**利用者の切替**のため。キーに `user` が入るので切り替えると
 *   別クエリになり件数が一度 `undefined` に戻る（フェーズ12 論点C）。ここで基準を
 *   引き継ぐと、前の利用者の件数との差が新着として出てしまう（完了条件11）。
 */
export function nextBaseline(
  open: boolean,
  count: number | undefined,
  current: number | null,
): number | null {
  if (open) return null
  if (count === undefined) return null
  return current ?? count
}

/** トグルに出す件数。**未読ではない**（サーバに状態を持たない、視界の外の増分）。 */
export function newSince(count: number | undefined, baseline: number | null): number {
  if (count === undefined || baseline === null) return 0
  return Math.max(0, count - baseline)
}
