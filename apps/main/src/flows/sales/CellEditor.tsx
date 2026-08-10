/**
 * セルの実エディタ。docs/impl/phase-7-list-grid-edit.md §4・決定N・Q
 *
 * 型で出し分ける（text / integer → input、enum → select、yearMonth → month）。
 * 候補・ラベル・必須は定義から取る（`DealForm` と同じ線）。
 *
 * draft は親（`DealList`）の状態にある — 編集中の行が画面外に出るとエディタごと
 * アンマウントされるが、draft が親にあればスクロールで戻ったとき編集中のまま復元される
 * （§2-1。アンマウントでは blur が飛ばないので、勝手に確定もされない）。
 *
 * 確定・取消のキーはここで受けて**伝播を止める**。止めないと、取消の Esc が
 * スクロール枠のフォーカスモード（Esc = セルフォーカス解除）にも効いてしまう。
 */
import type { FieldDef } from '@alt/dsl'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { isImeKey } from '../../shell/keys'

/** 確定後にフォーカスが移る先。Enter = 下 / Tab = 右 / Shift+Tab = 左 / blur = 移動なし。 */
export type CommitMove = 'down' | 'right' | 'left' | null

export interface CellEditorProps {
  field: FieldDef
  draft: string
  /** 事前検証で確定を止めた理由（決定P）。あれば invalid 表示になる。 */
  invalid: string | undefined
  onDraft(draft: string): void
  onCommit(move: CommitMove): void
  onCancel(): void
}

export function CellEditor({
  field,
  draft,
  invalid,
  onDraft,
  onCommit,
  onCancel,
}: CellEditorProps) {
  const ref = useRef<HTMLInputElement | HTMLSelectElement | null>(null)

  // マウント時に DOM フォーカスを移す。text / integer は全選択（打てば置換、End で追記）
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    el.focus()
    if (el instanceof HTMLInputElement && (field.type === 'text' || field.type === 'integer')) {
      el.select()
    }
  }, [field.type])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      // 変換確定の Enter は「文字列の確定」。セルの確定にしない（§2-2）
      if (isImeKey(event.nativeEvent)) return
      event.preventDefault()
      event.stopPropagation()
      onCommit('down')
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      onCommit(event.shiftKey ? 'left' : 'right')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    // 矢印などはエディタのもの（テキストのカーソル・select の候補）。セル移動しない —
    // スクロール枠側は「編集中なら無視する」ので、伝播しても二重処理にはならない
  }

  const attach = (el: HTMLInputElement | HTMLSelectElement | null) => {
    ref.current = el
  }
  const className = `cell-editor${invalid === undefined ? '' : ' invalid'}`

  // select の change では確定しない（決定Q）: 閉じた select の ↑↓ は押すたび change が
  // 発火するので、候補を眺めるだけで版が積まれてしまう。確定は他の型と同じ
  // Enter / Tab / blur に揃える
  if (field.type === 'enum') {
    return (
      <select
        ref={attach}
        className={className}
        title={invalid}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => onCommit(null)}
      >
        {!field.required && <option value="">—</option>}
        {(field.values ?? []).map((value) => (
          <option key={value.key} value={value.key}>
            {value.label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      ref={attach}
      className={className}
      title={invalid}
      type={field.type === 'integer' ? 'number' : field.type === 'yearMonth' ? 'month' : 'text'}
      step={field.type === 'integer' ? 1 : undefined}
      value={draft}
      onChange={(event) => onDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => onCommit(null)}
    />
  )
}
