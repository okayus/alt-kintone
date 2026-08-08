/**
 * 案件一覧のフィルタ面。docs/impl/phase-6-list-grid.md 論点C-3
 *
 * **汎用のフィルタビルダーは作らない。** 営業の案件一覧のフィルタ面として手で書く
 * （`DealForm` を定義から組み立てなかったのと同じ線。docs/product-concept.md §4-3）。
 * ただし**候補・ラベル・型は定義から取る** — enum は `{key, label}` から、
 * ステップはフロー定義から、担当はマスタから。文言の二重管理を作らない。
 *
 * どのフィールドを面に出すかだけが設計判断（全部出すと逆に使いにくい）。v1 は
 * ステップ・担当・商材・確度・状態・見込み月レンジ・案件名。**残りも URL では効く**
 * （`dealQueryParsers` にあるものはすべてサーバに届く）。
 */
import { deal as dealDef, sales } from '@alt/definitions'
import type { EnumValue } from '@alt/dsl'
import { useEffect, useState } from 'react'
import { dealQueryParsers, ME, type DealQuery } from './dealQuery'
import type { Masters } from '../../shell/App'

export function DealFilters({
  query,
  masters,
  total,
}: {
  query: DealQuery
  masters: Masters
  total: number | undefined
}) {
  const { state, set } = query

  return (
    <div className="filters">
      <div className="filters-row">
        <TitleSearch
          value={state.title_like}
          onChange={(value) => void set({ title_like: value })}
        />
        <span className="filters-count">
          {total === undefined ? '…' : `${total.toLocaleString()} 件`}
        </span>
        {query.filtered && (
          <button type="button" onClick={query.clear}>
            絞り込みを解除
          </button>
        )}
      </div>

      {/* 綴り間違いを黙って無視すると、「絞ったつもりで絞られていない一覧」を共有してしまう */}
      {query.unknownKeys.length > 0 && (
        <p className="filters-warn" role="status">
          URL の <code>{query.unknownKeys.join(', ')}</code>{' '}
          は絞り込みとして解釈できないので無視した。 使えるのは{' '}
          <code>{Object.keys(dealQueryParsers).join(', ')}</code>。
        </p>
      )}

      <div className="filters-row">
        {/* ステップはフロー定義から。ステップを足すとフィルタも勝手に増える */}
        <Toggles
          label="ステップ"
          options={sales.steps.map((step) => ({ key: step.key, label: step.name }))}
          selected={state.step}
          onChange={(value) => void set({ step: value })}
        />
      </div>

      <div className="filters-row">
        <Owner
          selected={state.ownerEmployeeId}
          masters={masters}
          onChange={(value) => void set({ ownerEmployeeId: value })}
        />
      </div>

      <div className="filters-row">
        <Toggles
          label={dealDef.fields.productType?.label ?? '商材'}
          options={dealDef.fields.productType?.values ?? []}
          selected={state.productType}
          onChange={(value) => void set({ productType: value })}
        />
        <Toggles
          label={dealDef.fields.confidence?.label ?? '確度'}
          options={dealDef.fields.confidence?.values ?? []}
          selected={state.confidence}
          onChange={(value) => void set({ confidence: value })}
        />
        <Toggles
          label={dealDef.fields.status?.label ?? '状態'}
          options={dealDef.fields.status?.values ?? []}
          selected={state.status}
          onChange={(value) => void set({ status: value })}
        />
      </div>

      <div className="filters-row">
        <span className="filters-label">
          {dealDef.fields.expectedCloseMonth?.label ?? '見込み受注月'}
        </span>
        <input
          type="month"
          value={state.expectedCloseMonth_gte ?? ''}
          onChange={(event) =>
            void set({ expectedCloseMonth_gte: emptyToNull(event.target.value) })
          }
        />
        <span className="muted">〜</span>
        <input
          type="month"
          value={state.expectedCloseMonth_lte ?? ''}
          onChange={(event) =>
            void set({ expectedCloseMonth_lte: emptyToNull(event.target.value) })
          }
        />
      </div>
    </div>
  )
}

/**
 * 案件名の部分一致。**入力のたびには投げない**（Enter か離れたときに確定）。
 *
 * URL に載る値が「打ちかけの文字列」になるのを避ける意味もある。共有された URL の
 * `title_like=看` が意図した条件かどうか、読み手には区別が付かない。
 */
function TitleSearch({
  value,
  onChange,
}: {
  value: string | null
  onChange: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  // 「解除」や戻る操作で URL 側が変わったら入力欄も合わせる
  useEffect(() => setDraft(value ?? ''), [value])

  const commit = () => {
    const next = draft.trim()
    if (next !== (value ?? '')) onChange(next === '' ? null : next)
  }

  return (
    <label className="filters-search">
      案件名
      <input
        type="search"
        value={draft}
        placeholder="含む文字で絞る"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(value ?? '')
        }}
      />
    </label>
  )
}

/**
 * 担当。**「自分の案件」を先頭に置く**（論点C-3）。
 *
 * `me` はサーバで `currentUser.id` に解決される糖衣なので、URL を共有すると
 * 読み手にとっての「自分」になる（決定C）。
 */
function Owner({
  selected,
  masters,
  onChange,
}: {
  selected: string[] | null
  masters: Masters
  onChange: (value: string[] | null) => void
}) {
  const employees = [...masters.employees.values()]
  return (
    <Toggles
      label={dealDef.fields.ownerEmployeeId?.label ?? '担当'}
      options={[
        { key: ME, label: '自分の案件' },
        ...employees.map((employee) => ({ key: employee.id, label: employee.name })),
      ]}
      selected={selected}
      onChange={onChange}
    />
  )
}

/** 複数選択のトグル群。選択が空なら URL からパラメータごと消す。 */
function Toggles({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: readonly EnumValue[]
  selected: string[] | null
  onChange: (value: string[] | null) => void
}) {
  const current = selected ?? []
  const toggle = (key: string) => {
    const next = current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]
    onChange(next.length === 0 ? null : next)
  }

  return (
    <div className="filters-group">
      <span className="filters-label">{label}</span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`chip${current.includes(option.key) ? ' on' : ''}`}
          aria-pressed={current.includes(option.key)}
          onClick={() => toggle(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value
}
