/**
 * 案件の編集フォーム。docs/impl/phase-4-frontend.md 決定I
 *
 * **定義からフォームを組み立てない。** 汎用のフィールドレンダラ（`FieldDef` を見て
 * input を出し分ける仕組み）を作ると、その表現力がそのまま画面の上限になる。それが
 * kintone の失敗構造なので、ここは「案件のフォーム」として手で書く
 * （docs/product-concept.md §4-3）。下の `TextField` などはこのファイル専用の部品で、
 * 共通部品ではない。
 *
 * ただし **enum の候補は定義から取る**（`deal.fields.productType.values`）。候補は
 * 業務ルールであってレイアウトではないので、書き写すと単に古くなる。
 * ⚠ 一方でラベルは定義に無いので `labels.ts` の手書きに落ちる。定義に無い値は
 *    英語キーのまま表示される（§8-2 論点14 が画面に出る形）。
 *
 * 送るのは**変更のあったフィールドだけ**。サーバは PATCH を差分として扱い、
 * 書かれなかったフィールドは現在行から引き継ぐ（有効期間型の「閉じて INSERT」）。
 */
import { deal as dealDef } from '@alt/definitions'
import { useState, type ReactNode } from 'react'
import { CONFIDENCE, DEAL_STATUS, DEAL_TYPE, OUTCOME_REASON, PRODUCT_TYPE, label } from './labels'
import type { Deal, DealPatch } from '../../shell/types'

/** 入力中はすべて文字列で持つ。空文字が null を表す。 */
type Draft = Record<string, string>

const REQUIRED = ['title', 'productType', 'dealType', 'status']

export interface DealFormProps {
  deal: Deal
  busy: boolean
  onSave: (patch: DealPatch) => void
  onCancel: () => void
}

export function DealForm({ deal, busy, onSave, onCancel }: DealFormProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(deal))
  const set = (name: string, value: string) => setDraft((prev) => ({ ...prev, [name]: value }))

  const patch = toPatch(deal, draft)
  const missing = REQUIRED.filter((name) => (draft[name] ?? '') === '')
  const changed = Object.keys(patch).length > 0

  return (
    <form
      className="deal-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (changed && missing.length === 0) onSave(patch)
      }}
    >
      <div className="fields">
        <TextField name="title" label="案件名" draft={draft} set={set} />
        <SelectField
          name="productType"
          label="商材"
          labels={PRODUCT_TYPE}
          draft={draft}
          set={set}
        />
        <SelectField name="dealType" label="区分" labels={DEAL_TYPE} draft={draft} set={set} />
        <SelectField name="status" label="状態" labels={DEAL_STATUS} draft={draft} set={set} />

        <NumberField name="initialBilling" label="一時金・請求額" draft={draft} set={set} />
        <NumberField name="initialProfit" label="一時金・自社収益" draft={draft} set={set} />
        <NumberField name="monthlyBilling" label="月額・請求額" draft={draft} set={set} />
        <NumberField name="monthlyProfit" label="月額・自社収益" draft={draft} set={set} />
        <NumberField name="contractMonths" label="契約期間（月）" draft={draft} set={set} />

        <Field label="見込み受注月">
          <input
            type="month"
            value={draft['expectedCloseMonth'] ?? ''}
            onChange={(event) => set('expectedCloseMonth', event.target.value)}
          />
        </Field>
        <SelectField
          name="confidence"
          label="ヨミ確度"
          labels={CONFIDENCE}
          draft={draft}
          set={set}
        />

        <SelectField
          name="outcomeReasonCategory"
          label="決着理由"
          labels={OUTCOME_REASON}
          draft={draft}
          set={set}
        />
        <TextField name="outcomeReasonDetail" label="決着理由（詳細）" draft={draft} set={set} />
        <TextField name="competitor" label="競合先" draft={draft} set={set} />
        <Field label="決着日">
          <input
            type="date"
            value={draft['closedAt'] ?? ''}
            onChange={(event) => set('closedAt', event.target.value)}
          />
        </Field>

        <Field label="メモ" wide>
          <textarea
            rows={3}
            value={draft['note'] ?? ''}
            onChange={(event) => set('note', event.target.value)}
          />
        </Field>
      </div>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy || !changed || missing.length > 0}>
          保存
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          やめる
        </button>
        {missing.length > 0 && <span className="unmet">必須が空: {missing.join(', ')}</span>}
        {missing.length === 0 && !changed && <span className="muted">変更なし</span>}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// このフォーム専用の部品（共通部品ではない）
// ---------------------------------------------------------------------------

function Field({
  label: text,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <label className={wide === true ? 'field wide' : 'field'}>
      <span className="field-label">{text}</span>
      {children}
    </label>
  )
}

interface Bound {
  name: string
  label: string
  draft: Draft
  set: (name: string, value: string) => void
}

function TextField({ name, label: text, draft, set }: Bound) {
  return (
    <Field label={text}>
      <input
        type="text"
        value={draft[name] ?? ''}
        onChange={(event) => set(name, event.target.value)}
      />
    </Field>
  )
}

function NumberField({ name, label: text, draft, set }: Bound) {
  return (
    <Field label={text}>
      <input
        type="number"
        step={1}
        value={draft[name] ?? ''}
        onChange={(event) => set(name, event.target.value)}
      />
    </Field>
  )
}

/** 候補は定義から、表示は `labels.ts` から。 */
function SelectField({
  name,
  label: text,
  draft,
  set,
  labels,
}: Bound & { labels: Record<string, string> }) {
  const values = dealDef.fields[name]?.values ?? []
  const required = REQUIRED.includes(name)
  return (
    <Field label={text}>
      <select value={draft[name] ?? ''} onChange={(event) => set(name, event.target.value)}>
        {!required && <option value="">—</option>}
        {values.map((value) => (
          <option key={value} value={value}>
            {label(labels, value)}
          </option>
        ))}
      </select>
    </Field>
  )
}

// ---------------------------------------------------------------------------
// 変換
// ---------------------------------------------------------------------------

const NUMBERS = [
  'initialBilling',
  'initialProfit',
  'monthlyBilling',
  'monthlyProfit',
  'contractMonths',
]

/** 編集できるフィールド。`companyId` / `ownerEmployeeId` は含めない（参照の付け替えはしない）。 */
const EDITABLE = [
  'title',
  'productType',
  'dealType',
  'status',
  ...NUMBERS,
  'expectedCloseMonth',
  'confidence',
  'outcomeReasonCategory',
  'outcomeReasonDetail',
  'competitor',
  'closedAt',
  'note',
]

function toDraft(deal: Deal): Draft {
  const draft: Draft = {}
  for (const name of EDITABLE) {
    const value = (deal as unknown as Record<string, unknown>)[name]
    draft[name] = value === null || value === undefined ? '' : String(value)
  }
  return draft
}

/**
 * 変更のあったフィールドだけを取り出す。
 *
 * 空文字は null にする（サーバは null を「値を消す」として受ける。required なフィールドは
 * サーバ側でも弾かれるが、送る前に止めている）。
 */
function toPatch(deal: Deal, draft: Draft): DealPatch {
  const patch: Record<string, unknown> = {}
  const current = deal as unknown as Record<string, unknown>

  for (const name of EDITABLE) {
    const raw = draft[name] ?? ''
    const value = raw === '' ? null : NUMBERS.includes(name) ? Number(raw) : raw
    if (value !== null && NUMBERS.includes(name) && !Number.isInteger(value)) continue
    if (value === (current[name] ?? null)) continue
    patch[name] = value
  }
  return patch as DealPatch
}
