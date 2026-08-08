/**
 * 案件一覧の絞り込み・並びを URL に持つ。docs/impl/phase-6-list-grid.md 論点C・D
 *
 * **URL のパラメータ名を API のパラメータ名と同じにする。** 変換表を作らないので
 * 「URL に出ているもの＝サーバが解釈するもの」になり、共有された URL を読めば
 * 何で絞られているかが分かる。FE 側で条件式 AST を組み立てないのと同じ線
 * （条件式の解釈はサーバ1箇所）。
 *
 * 置き場は `location.search`（ハッシュの外。論点D 案A）。ルータはハッシュのままで、
 * nuqs は `?...` だけを書き換える。**一覧 → 詳細 → 戻る でフィルタが保たれる**のは
 * その副産物。
 */
import { parseAsArrayOf, parseAsString, useQueryStates } from 'nuqs'
import { useMemo } from 'react'

/** ログインユーザー自身を指す糖衣。サーバ側で `currentUser.id` に解決される（決定C）。 */
export const ME = 'me'

/**
 * 現在ステップの並べ替えキー。**サーバの `STEP_COLUMN`（`@alt/sql`）と同じ値**。
 *
 * FE は `@alt/sql` に依存しない（SQL 生成をブラウザに持ち込まない）ので、ここだけは
 * 文字列が二重になる。定義由来の名前ではなくプラットフォームの語彙なので、
 * 定義から取ることもできない。
 */
export const STEP_SORT_KEY = '_step'

/**
 * URL のパーサ。**キーは API のパラメータ名そのもの**。
 *
 * 配列はカンマ区切り（`confidence=A,B`）。サーバの語彙（`<field>` = IN、
 * `<field>_gte` / `_lte` = レンジ、`<field>_like` = 部分一致）に合わせてある。
 */
export const dealQueryParsers = {
  step: parseAsArrayOf(parseAsString, ','),
  ownerEmployeeId: parseAsArrayOf(parseAsString, ','),
  productType: parseAsArrayOf(parseAsString, ','),
  dealType: parseAsArrayOf(parseAsString, ','),
  confidence: parseAsArrayOf(parseAsString, ','),
  status: parseAsArrayOf(parseAsString, ','),
  expectedCloseMonth_gte: parseAsString,
  expectedCloseMonth_lte: parseAsString,
  title_like: parseAsString,
  sort: parseAsString,
}

export type DealQueryState = {
  [K in keyof typeof dealQueryParsers]: K extends 'sort'
    ? string | null
    : ReturnType<(typeof dealQueryParsers)[K]['parse']> | null
}

export type SetDealQuery = ReturnType<typeof useQueryStates<typeof dealQueryParsers>>[1]

/** シェルが持つパラメータ（時点指定）。フィルタではないが未知でもない。 */
const SHELL_KEYS: readonly string[] = ['as_of']

export interface DealQuery {
  state: DealQueryState
  set: SetDealQuery
  /** API に渡す形。`sort` だけは別扱い（絞り込みではなく並び）。 */
  filters: Record<string, string>
  sort: string | undefined
  /** 絞り込みが1つでも掛かっているか。「解除」ボタンの出し分けに使う。 */
  filtered: boolean
  /**
   * URL にあるが解釈できないパラメータ。
   *
   * nuqs は宣言したキーしか読まないので、綴り間違いは**黙って無視される**。
   * 共有された URL が「絞り込んだつもりで絞られていない一覧」を映すのが最悪なので、
   * 画面に出す。サーバは同じものを 400 + ヒントで返す（`list-query.ts`）が、
   * FE がそもそも送らないのでそこには届かない。
   */
  unknownKeys: string[]
  clear(): void
}

export function useDealQuery(): DealQuery {
  // 履歴に積むのは replace。フィルタのトグル1回ごとに「戻る」が1段増えると
  // 一覧から詳細へ行って戻るのが面倒になる
  const [state, set] = useQueryStates(dealQueryParsers, { history: 'replace' })

  // 解釈できないキーの検出は URL を直に見るしかない（nuqs は宣言したキーしか返さない）
  const search = useSearch()

  return useMemo(() => {
    const known = [...Object.keys(dealQueryParsers), ...SHELL_KEYS]
    const unknownKeys = [...new URLSearchParams(search).keys()].filter(
      (key) => !known.includes(key),
    )

    const filters: Record<string, string> = {}
    for (const [key, value] of Object.entries(state)) {
      if (key === 'sort' || value === null) continue
      const text = Array.isArray(value) ? value.join(',') : String(value)
      if (text !== '') filters[key] = text
    }
    return {
      state: state as DealQueryState,
      set,
      filters,
      sort: state.sort ?? undefined,
      filtered: Object.keys(filters).length > 0,
      unknownKeys,
      // null を書くとパラメータが URL から消える（nuqs の約束）
      clear: () => {
        void set(Object.fromEntries(Object.keys(dealQueryParsers).map((key) => [key, null])))
      },
    }
  }, [state, set, search])
}

/**
 * `location.search` を購読する。nuqs 自身は宣言したキーしか見ないので、
 * 「知らないキーが URL にある」の検出はこちらで持つ。
 *
 * nuqs の更新は `pushState` / `replaceState` で `popstate` を出さないため、
 * イベントだけでは追随できない。`state`（nuqs 側）が変わるたびに読み直せば足りる。
 */
function useSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search
}

// ---------------------------------------------------------------------------
// 並び
// ---------------------------------------------------------------------------

export type SortDirection = 'asc' | 'desc'

export interface Sort {
  key: string
  direction: SortDirection
}

export function parseSort(raw: string | undefined): Sort | undefined {
  if (raw === undefined || raw === '') return undefined
  const [key = '', direction] = raw.split(':')
  if (key === '') return undefined
  return { key, direction: direction === 'desc' ? 'desc' : 'asc' }
}

/**
 * 見出しをクリックしたときの次の並び。昇順 → 降順 → 既定（並び指定なし）で一周する。
 *
 * 「既定」に戻れることが要る。既定は valid_from の降順（更新が新しい順）で、
 * どのフィールドでも表現できない並びなので、解除できないと戻る手段が無くなる。
 */
export function nextSort(current: Sort | undefined, key: string): string | null {
  if (current?.key !== key) return `${key}:asc`
  if (current.direction === 'asc') return `${key}:desc`
  return null
}
