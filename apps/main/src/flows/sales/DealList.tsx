/**
 * 案件一覧（グリッド）。docs/impl/phase-6-list-grid.md 論点E・G /
 * docs/impl/phase-7-list-grid-edit.md（セル編集）
 *
 * **共通の一覧コンポーネントに寄せない**（docs/product-concept.md §4-3）。
 * 汎用の一覧部品を作ると、その部品の表現力が上限になる。ここは営業の案件一覧として書く。
 * 入れてよいのは **UI を持たない道具**（`@tanstack/react-virtual` は headless）で、
 * 避けるのは UI を持つ共通部品（フル機能グリッド）——という線を論点E で引いた。
 *
 * 現在ステップと未確認件数の列が残っているのが要点（論点G）。**これは「フローに乗った
 * レコードの一覧」であって、案件テーブルのビューアではない。**
 *
 * ## セル編集（フェーズ7）
 *
 * - DOM フォーカスはスクロール枠が持ち続け、「どのセルにいるか」は React 状態
 *   `{row, col}`（論理フォーカス）。仮想化でセルの DOM は消えるため（§2-1）
 * - Enter / ダブルクリックでセル位置に実エディタ（`CellEditor`）。確定 = `PATCH` 1回 =
 *   有効期間型の1バージョン。同値なら送らない（決定N）
 * - 確定成功はレスポンスの行でその場を置換し、裏でソフト世代（`refresh`）が時点と
 *   順序を揃える（決定K）。スクロールは動かない
 * - 編集できるかは API の `_permissions.update` を見るだけ。FE で認可を再判定しない（§4-1）
 *
 * `<table>` ではなく div + CSS グリッドなのは、仮想化した行を絶対配置するため。
 * `role="grid"` は最小限だけ付ける（PC中心・社内利用の決定に従う）。
 */
import { deal as dealDef, sales } from '@alt/definitions'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { isChanged, parseDraft, toDraft } from './cellEdit'
import { CellEditor, type CommitMove } from './CellEditor'
import { DealFilters } from './DealFilters'
import { nextSort, parseSort, STEP_SORT_KEY, useDealQuery, type Sort } from './dealQuery'
import { clampPos, keyToMove, moveFocus, type CellPos, type FocusMove } from './gridCursor'
import { fieldLabel, label } from './labels'
import { useDealPage, type DealPage } from './useDealPage'
import { ApiError } from '../../shell/api'
import type { ScreenProps } from '../../shell/App'
import { orDash, yen } from '../../shell/format'
import { href } from '../../shell/router'
import type { Deal } from '../../shell/types'

/** 行の高さ（px）。仮想化は固定高で計算する。 */
const ROW_HEIGHT = 37

/**
 * 見出しの高さ（px）。**`app.css` の `.grid-head` と同じ値にすること。**
 *
 * 見出しをスクロール枠の**中**に sticky で置いてある（外に出すと、縦スクロールバーの幅だけ
 * 列がずれる／横スクロール時に見出しだけ動かない）。その代わり仮想化の基準位置が
 * 見出しのぶんずれるので、`scrollMargin` で引く。
 */
const HEAD_HEIGHT = 37

interface Column {
  key: string
  label: string
  /** 幅（CSS grid の track）。**合計を変えたら `app.css` の `min-width` も合わせる。** */
  width: string
  /** 右寄せ（金額）。 */
  numeric?: boolean
  /**
   * サーバに投げるソートキー。無いものは並べ替えできない
   * （自社収益＝2フィールドの合成、顧客企業＝FK先の名前。論点B・G）。
   */
  sort?: string
  /**
   * 編集できるフィールド名（定義のキー）。エディタの型・候補・必須は
   * `dealDef.fields[edit]` から決まる。無い列は編集対象外 — リンク・FK・合成・フロー列
   * （docs/impl/phase-7-list-grid-edit.md 決定O）。
   */
  edit?: string
  render(deal: Deal, screen: ScreenProps): ReactNode
}

const COLUMNS: Column[] = [
  {
    // 詳細への導線。案件名セルを編集対象にしたので、リンクはここに分離した（決定M。
    // 同じセルに置くと、クリックが「フォーカスする」と「開く」で衝突する）
    key: 'open',
    label: '',
    width: '44px',
    render: (deal) => (
      <a className="grid-open" href={href.deal(deal.id)}>
        開く
      </a>
    ),
  },
  {
    key: 'title',
    label: fieldLabel(dealDef, 'title'),
    width: 'minmax(180px, 2fr)',
    sort: 'title',
    edit: 'title',
    render: (deal) => deal.title,
  },
  {
    key: 'companyId',
    label: fieldLabel(dealDef, 'companyId'),
    width: 'minmax(120px, 1fr)',
    render: (deal, { masters }) => orDash(masters.companies.get(deal.companyId)?.name),
  },
  {
    key: 'productType',
    label: fieldLabel(dealDef, 'productType'),
    width: '84px',
    sort: 'productType',
    edit: 'productType',
    render: (deal) => label(dealDef.fields.productType, deal.productType),
  },
  {
    key: 'dealType',
    label: fieldLabel(dealDef, 'dealType'),
    width: '64px',
    sort: 'dealType',
    edit: 'dealType',
    render: (deal) => label(dealDef.fields.dealType, deal.dealType),
  },
  {
    // 金額系の自動判定（予算感・金額提示）が読むのはこの2列（決定L）。
    // 一覧で金額を直すと未確認件数がその場で変わる、の「金額」はここ
    key: 'initialBilling',
    label: fieldLabel(dealDef, 'initialBilling'),
    width: '118px',
    numeric: true,
    sort: 'initialBilling',
    edit: 'initialBilling',
    render: (deal) => yen(deal.initialBilling),
  },
  {
    key: 'monthlyBilling',
    label: fieldLabel(dealDef, 'monthlyBilling'),
    width: '118px',
    numeric: true,
    sort: 'monthlyBilling',
    edit: 'monthlyBilling',
    render: (deal) => yen(deal.monthlyBilling),
  },
  {
    // 単一フィールドではないので定義からラベルを取れない（金額2つの合成）。編集は元の
    // *Profit フィールドが対象で、合成列は表示のみ（決定O の「計算列」）
    key: 'profit',
    label: '自社収益',
    width: '130px',
    numeric: true,
    render: (deal) => <Profit deal={deal} />,
  },
  {
    key: 'expectedCloseMonth',
    label: fieldLabel(dealDef, 'expectedCloseMonth'),
    width: '104px',
    sort: 'expectedCloseMonth',
    edit: 'expectedCloseMonth',
    render: (deal) => orDash(deal.expectedCloseMonth),
  },
  {
    key: 'confidence',
    label: fieldLabel(dealDef, 'confidence'),
    width: '68px',
    sort: 'confidence',
    edit: 'confidence',
    render: (deal) => orDash(label(dealDef.fields.confidence, deal.confidence)),
  },
  {
    key: 'status',
    label: fieldLabel(dealDef, 'status'),
    width: '72px',
    sort: 'status',
    edit: 'status',
    render: (deal) => label(dealDef.fields.status, deal.status),
  },
  {
    // フロー由来の列。定義のフィールドではなく _flow_state から来る（論点G）
    key: 'step',
    label: '現在ステップ',
    width: '185px',
    sort: STEP_SORT_KEY,
    render: (deal) => <StepCell deal={deal} />,
  },
  {
    key: 'ownerEmployeeId',
    label: fieldLabel(dealDef, 'ownerEmployeeId'),
    width: '96px',
    sort: 'ownerEmployeeId',
    render: (deal, { masters }) => orDash(masters.employees.get(deal.ownerEmployeeId)?.name),
  },
]

const TEMPLATE = COLUMNS.map((column) => column.width).join(' ')

/** 確定キーごとの移動先（決定N）。Tab は折り返す。 */
const AFTER_COMMIT: Record<Exclude<CommitMove, null>, FocusMove> = {
  down: 'down',
  right: 'next',
  left: 'prev',
}

/** 編集中のセル。位置に加えて**編集開始時に掴んだ相手と元の値**を持つ（下の理由）。 */
interface EditingCell extends CellPos {
  /** 定義のフィールド名（`Column.edit`）。 */
  field: string
  /**
   * 編集対象のレコード id。位置ではなく id で確定するのは、ソフト世代（決定K）で
   * 行の並びが編集中に入れ替わっても、PATCH がユーザーの見ていた相手に打たれるように。
   */
  dealId: string
  /** 編集開始時の値。同値判定（決定N）は「ユーザーが見て直した元の値」と比べる。 */
  original: unknown
  draft: string
  /** 事前検証で確定を止めた理由（決定P）。あればセルが invalid 表示になる。 */
  invalid?: string
}

export function DealList(screen: ScreenProps) {
  const query = useDealQuery()
  const sort = useMemo(() => parseSort(query.sort), [query.sort])
  const page = useDealPage({
    client: screen.client,
    filters: query.filters,
    sort: query.sort,
    asOf: screen.asOf,
    user: screen.user,
    onError: screen.onError,
  })

  return (
    <>
      <DealFilters query={query} masters={screen.masters} total={page.total} />
      <Grid
        page={page}
        sort={sort}
        onSort={(key) => void query.set({ sort: nextSort(sort, key) })}
        screen={screen}
      />
    </>
  )
}

function Grid({
  page,
  sort,
  onSort,
  screen,
}: {
  page: DealPage
  sort: Sort | undefined
  onSort: (key: string) => void
  screen: ScreenProps
}) {
  const scroller = useRef<HTMLDivElement>(null)
  /** 論理フォーカス（§2-1）。DOM フォーカスはスクロール枠にある。 */
  const [focus, setFocus] = useState<CellPos | null>(null)
  /**
   * 編集に入れなかった理由（決定S）。グレーの枠と行の地色だけでは「なぜ効かないか」が
   * 伝わらず、**編集不可が不具合として2回報告された**。次に成功する編集開始まで残す。
   */
  const [blocked, setBlocked] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingCell | null>(null)
  /**
   * `editing` の同期ミラー。キー確定 → blur の順で同じ編集が二度届くので、
   * ハンドラは**レンダーを待たずに**「もう閉じた」を知る必要がある。
   */
  const editingRef = useRef<EditingCell | null>(null)
  /** 保存中セル（`${id}:${field}`）。応答までの間だけ薄く出す。 */
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set())

  const virtualizer = useVirtualizer({
    count: page.total ?? 0,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    // 前後に少し余分を描いておくと、速いスクロールでも空白が見えにくい
    overscan: 10,
    // 行が始まるのは見出しの下から。これが無いと窓の判定が見出しのぶんずれる
    scrollMargin: HEAD_HEIGHT,
  })

  // ハード世代（絞り込み・並び・時点・ユーザー）が変わったら先頭へ戻し、フォーカスも捨てる
  // （行の意味が変わっている）。ソフト世代（編集後の refresh）では変わらない（決定K）。
  // ここで scroller.focus() はしない — フィルタ入力の途中でフォーカスを奪ってしまう
  const resetKey = page.resetKey
  useEffect(() => {
    if (scroller.current !== null) scroller.current.scrollTop = 0
    editingRef.current = null
    setEditing(null)
    setFocus(null)
    setBlocked(null)
  }, [resetKey])

  const items = virtualizer.getVirtualItems()
  const first = items[0]?.index
  const last = items[items.length - 1]?.index

  // 見えている範囲（+ overscan）を取得の窓に伝える。
  // インデックスに依存させているので、同じ範囲を見ている間は再取得を投げない
  useEffect(() => {
    if (first === undefined || last === undefined) return
    page.ensureRange(first, last)
  }, [first, last, page])

  const bounds = { rows: page.total ?? 0, cols: COLUMNS.length }

  /** キーボード移動。クリックと違い、移動先が画面外のことがあるので追従スクロールする。 */
  const focusCell = (pos: CellPos) => {
    const next = clampPos(pos, bounds)
    setFocus(next)
    virtualizer.scrollToIndex(next.row)
  }

  const closeEditor = () => {
    editingRef.current = null
    setEditing(null)
    // キーボードを生かしたまま編集を閉じる。DOM フォーカスをスクロール枠へ返す
    scroller.current?.focus()
  }

  /**
   * 編集開始。入れないときは**理由を言葉で出す**（決定S）。
   * 編集できるか自体の判定は API の `_permissions.update` を見るだけ（§4-1。FE で
   * 認可を再判定しない）。`as_of` 中はサーバが update を落とすので条件を足す必要はなく、
   * ここで分けているのは**説明の文言**だけ。
   */
  const startEdit = (pos: CellPos) => {
    const column = COLUMNS[pos.col]
    const deal = page.rowAt(pos.row)
    if (column === undefined || deal === undefined) return
    if (column.edit === undefined) {
      setBlocked(
        `${column.label === '' ? 'この' : `「${column.label}」`}列は一覧では編集できない（会社・担当の付け替えや金額の内訳は詳細画面から）`,
      )
      return
    }
    if (!deal._permissions.update) {
      setBlocked(
        screen.asOf === undefined
          ? ownedByOther(deal, screen)
          : '過去の時点を見ているので読み取り専用（ヘッダの「現在に戻す」で現在に戻る）',
      )
      return
    }
    setBlocked(null)
    const original = (deal as unknown as Record<string, unknown>)[column.edit]
    const next: EditingCell = {
      ...pos,
      field: column.edit,
      dealId: deal.id,
      original,
      draft: toDraft(original),
    }
    setFocus(pos)
    editingRef.current = next
    setEditing(next)
  }

  /** 確定（決定N・P）。同値なら PATCH を送らず移動だけ。 */
  const commitEdit = (move: CommitMove) => {
    const cell = editingRef.current
    if (cell === null) return

    const field = dealDef.fields[cell.field]
    if (field === undefined) {
      closeEditor()
      return
    }
    const parsed = parseDraft(field, cell.draft)
    if (!parsed.ok) {
      // 送らずセルで知らせる。黙って捨てない — 捨てるのは Esc だけ（決定P）
      const next = { ...cell, invalid: parsed.reason }
      editingRef.current = next
      setEditing(next)
      return
    }

    closeEditor()
    if (move !== null) focusCell(moveFocus(cell, AFTER_COMMIT[move], bounds))
    if (!isChanged(cell.original, parsed.value)) return

    const marker = `${cell.dealId}:${cell.field}`
    setSaving((previous) => new Set(previous).add(marker))
    screen.client
      .patch<Deal>('deal', cell.dealId, { [cell.field]: parsed.value })
      .then((record) => {
        // その場で置換（未確認件数のセルもこの時点で変わる）→ 裏で時点と順序を揃える（決定K）
        page.replaceRow(cell.dealId, record)
        page.refresh()
      })
      .catch((cause: unknown) => {
        screen.onError(cause)
        // 409 の hint「最新を読み直してから更新する」を UI が代行する（決定P）
        if (cause instanceof ApiError && cause.status === 409) page.refresh()
      })
      .finally(() => {
        setSaving((previous) => {
          const next = new Set(previous)
          next.delete(marker)
          return next
        })
      })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editingRef.current !== null) {
      // 編集中のキーはエディタが受ける。ただし invalid のまま blur で外へ出たあとは
      // DOM フォーカスがこちらに居る（エディタにキーが届かない）ので、Esc の血路だけ通す
      if (event.key === 'Escape') closeEditor()
      return
    }
    if (event.key === 'Escape') {
      // フォーカス解除。Tab をセル移動に使う間はキーボードがグリッドに閉じるので、
      // 外へ抜ける出口を1つ残す（決定N）
      setFocus(null)
      return
    }
    if (focus === null) {
      // Tab などで DOM フォーカスだけがグリッドに来た状態。最初の矢印 / Enter で
      // 見えている先頭行に論理フォーカスを置く（キーボードだけで編集まで辿り着ける）。
      // Tab はここで奪わない — フォーカスが無い間は素通りできないと外へ出られなくなる
      if (
        event.key === 'Enter' ||
        (event.key !== 'Tab' && keyToMove(event.key, false) !== undefined)
      ) {
        event.preventDefault()
        focusCell({ row: first ?? 0, col: 1 })
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      startEdit(focus)
      return
    }
    const move = keyToMove(event.key, event.shiftKey)
    if (move === undefined) return
    event.preventDefault()
    focusCell(moveFocus(focus, move, bounds))
  }

  /**
   * DOM フォーカスがグリッドの外へ出たら、論理フォーカス（枠）も消す。
   *
   * 分離モデル（§2-1）の代償で、これが無いと「枠は出ているのにキーは別の場所へ行く」
   * という**嘘の状態**ができる（外を1回クリックしただけで Enter が無反応になる）。
   * 枠が見えている ＝ キーがセルに効く、を不変条件にする。
   *
   * グリッドの中で完結するフォーカス移動（編集エディタ・列見出しのソートボタン）では
   * 消さない — keydown はスクロール枠までバブルするので、枠が見えていればキーは効く。
   */
  const onGridBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next !== null && event.currentTarget.contains(next)) return
    // 編集中は消さない（invalid のまま外をクリックした場合、draft と赤枠を保つ。決定P）
    if (editingRef.current !== null) return
    setFocus(null)
  }

  const clickCell = (pos: CellPos) => {
    // 編集中セルの中のクリックは編集の一部。別セルへのクリックは blur（確定）が先に
    // 走って editing を閉じているので、ここに来るのは同一セル内だけ
    if (editingRef.current !== null) return
    setFocus(pos)
    scroller.current?.focus()
  }

  const doubleClickCell = (pos: CellPos) => {
    if (editingRef.current !== null) return
    startEdit(pos)
  }

  const editField = editing === null ? undefined : dealDef.fields[editing.field]
  const editorNode =
    editing === null || editField === undefined ? undefined : (
      <CellEditor
        key={`${editing.row}:${editing.col}`}
        field={editField}
        draft={editing.draft}
        invalid={editing.invalid}
        onDraft={(draft) => {
          const cell = editingRef.current
          if (cell === null) return
          const next = { ...cell, draft, invalid: undefined }
          editingRef.current = next
          setEditing(next)
        }}
        onCommit={commitEdit}
        onCancel={closeEditor}
      />
    )

  if (page.total === undefined) return <p className="loading">読み込み中…</p>
  if (page.total === 0) return <p className="empty">条件に合う案件がない。</p>

  return (
    <>
      {blocked !== null && (
        <p className="grid-blocked" role="status">
          {blocked}
        </p>
      )}
      <div className="grid" role="grid" aria-rowcount={page.total}>
        {/* DOM フォーカスの置き場（§2-1）。セルの DOM は消えるので、キーはここで受ける */}
        <div
          className="grid-scroller"
          ref={scroller}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={onGridBlur}
        >
          {/* 見出しはスクロール枠の中。縦には貼り付き、横は本体と一緒に動く */}
          <div
            className="grid-head"
            role="row"
            style={{ gridTemplateColumns: TEMPLATE, height: HEAD_HEIGHT }}
          >
            {COLUMNS.map((column) => (
              <HeadCell key={column.key} column={column} sort={sort} onSort={onSort} />
            ))}
          </div>

          <div className="grid-canvas" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => (
              <Row
                key={item.key}
                index={item.index}
                top={item.start - HEAD_HEIGHT}
                deal={page.rowAt(item.index)}
                screen={screen}
                focusCol={focus !== null && focus.row === item.index ? focus.col : undefined}
                editingCol={
                  editing !== null && editing.row === item.index ? editing.col : undefined
                }
                editor={editing !== null && editing.row === item.index ? editorNode : undefined}
                saving={saving}
                onCell={(col, action) =>
                  action === 'focus'
                    ? clickCell({ row: item.index, col })
                    : doubleClickCell({ row: item.index, col })
                }
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function HeadCell({
  column,
  sort,
  onSort,
}: {
  column: Column
  sort: Sort | undefined
  onSort: (key: string) => void
}) {
  const key = column.sort
  const active = key !== undefined && sort?.key === key
  const className = `grid-cell grid-th${column.numeric === true ? ' num' : ''}`

  if (key === undefined) return <div className={className}>{column.label}</div>
  return (
    <div
      className={`${className}${active ? ' sorted' : ''}`}
      role="columnheader"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className="grid-sort" onClick={() => onSort(key)}>
        {column.label}
        <span className="grid-sort-mark">
          {active ? (sort.direction === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </div>
  )
}

function Row({
  index,
  top,
  deal,
  screen,
  focusCol,
  editingCol,
  editor,
  saving,
  onCell,
}: {
  index: number
  top: number
  deal: Deal | undefined
  screen: ScreenProps
  /** この行に論理フォーカスがあるときだけ列番号が入る。 */
  focusCol: number | undefined
  editingCol: number | undefined
  editor: ReactNode
  saving: ReadonlySet<string>
  onCell: (col: number, action: 'focus' | 'edit') => void
}) {
  const writable = deal !== undefined && deal._permissions.update
  const rowClass = [
    'grid-row',
    deal === undefined ? 'loading-row' : '',
    // 書けない行（担当外・as_of 中）はフォーカス前から見た目で分かるようにする（決定O）。
    // 地色にして文字は薄くしない — 担当フィルタを外すと他人の行が多数派になるため
    deal !== undefined && !writable ? 'row-ro' : '',
  ]
    .filter((name) => name !== '')
    .join(' ')

  return (
    <div
      className={rowClass}
      role="row"
      aria-rowindex={index + 1}
      style={{
        transform: `translateY(${top}px)`,
        height: ROW_HEIGHT,
        gridTemplateColumns: TEMPLATE,
      }}
    >
      {COLUMNS.map((column, col) => {
        const editable = column.edit !== undefined && writable
        const classes = ['grid-cell']
        if (column.numeric === true) classes.push('num')
        if (col === editingCol) classes.push('editing')
        else if (col === focusCol) {
          classes.push('focused')
          // 編集に入れないセルはフォーカス枠の色で分かる（決定O）
          if (!editable) classes.push('ro')
        }
        if (
          deal !== undefined &&
          column.edit !== undefined &&
          saving.has(`${deal.id}:${column.edit}`)
        ) {
          classes.push('saving')
        }
        return (
          <div
            key={column.key}
            className={classes.join(' ')}
            role="gridcell"
            onClick={() => onCell(col, 'focus')}
            onDoubleClick={() => onCell(col, 'edit')}
          >
            {col === editingCol && editor !== undefined ? (
              editor
            ) : deal === undefined ? (
              // 未取得の行は骨だけ出す。総件数が分かっているので高さは正しい
              <span className="skeleton" />
            ) : (
              column.render(deal, screen)
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * 行が書けない理由の説明（決定S）。担当者の名前と「いま誰として操作しているか」まで
 * 出す — 開発用ユーザーの切り替えを忘れて「編集できない」と混乱したのが実例
 * （§7 追記3）。認可の判定自体はサーバの `_permissions` で済んでいて、ここは説明だけ。
 */
function ownedByOther(deal: Deal, screen: ScreenProps): string {
  const self = [...screen.masters.employees.values()].find(
    (employee) => employee.email === screen.user,
  )
  const me = self?.name ?? screen.user

  // 閲覧のみの立場（フロー定義の viewers）は、担当かどうかに関係なく全行が編集不可。
  // 「担当が違うから」と説明すると嘘になる（自分が担当の案件でも編集できない）。
  // ⚠ 可否を決めているのは `_permissions`（サーバ）で、ここは**説明の出し分けだけ**。
  if (self !== undefined && (sales.viewers ?? []).includes(self.role)) {
    return `${me} は この業務を見るだけの立場（営業マネージャーなど）。編集できるのは案件の担当者と管理者`
  }

  const owner = screen.masters.employees.get(deal.ownerEmployeeId)?.name ?? '別の担当者'
  return `この案件の担当は ${owner}。編集できるのは担当者本人と管理者だけ（いま ${me} として操作している）`
}

/**
 * 金額は**自社収益（粗利）**を出す。顧客請求額（総額）ではない。
 * 代理店ビジネスでは両者が乖離するので、予測・目標・ランキングは粗利ベースで揃える
 * （docs/sales-domain.md、`packages/definitions/src/tables/deal.ts`）。
 */
function Profit({ deal }: { deal: Deal }) {
  const parts: string[] = []
  if (deal.initialProfit !== null) parts.push(yen(deal.initialProfit))
  if (deal.monthlyProfit !== null) parts.push(`${yen(deal.monthlyProfit)}/月`)
  return <>{parts.length === 0 ? '—' : parts.join(' + ')}</>
}

function StepCell({ deal }: { deal: Deal }) {
  if (deal._flow === null) return <span className="muted">フロー外</span>
  return (
    <>
      <span className="badge badge-step">{deal._flow.stepName}</span>
      {deal._flow.unsatisfied > 0 && (
        <span className="unmet"> 未確認 {deal._flow.unsatisfied}件</span>
      )}
    </>
  )
}
