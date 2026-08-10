/**
 * キー入力の解釈（純関数）。共通シェルの一部。
 *
 * ここに置いてあるのは**業務に依らないもの**だけ。グリッドのセル編集（フェーズ7）と
 * チャットの Enter 送信（フェーズ11）が同じ罠を踏むので、片方の配下には置けない
 * — 部品（`shell/chat/`）が業務フローのコード（`flows/sales/`）を import する向きは逆。
 */

/**
 * IME の変換確定のキーか（docs/impl/phase-7-list-grid-edit.md §2-2）。
 *
 * 「文字列の確定」であって「セルやメッセージの確定」ではないので、これが true の
 * Enter は無視する。Chrome / Firefox は `isComposing`、古い経路と Safari の癖
 * （`compositionend` が先に飛ぶ）は `keyCode === 229` で拾う。
 */
export function isImeKey(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229
}
