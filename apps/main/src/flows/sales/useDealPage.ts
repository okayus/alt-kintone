/**
 * 一覧の窓取得。docs/impl/phase-6-list-grid.md 論点B /
 * docs/impl/phase-7-list-grid-edit.md 決定K / docs/impl/phase-12-data-fetching.md 論点D
 *
 * **描画の仮想化（DOM）と取得の窓化（通信）は別の仕組み**で、「いま何行目が見えているか」
 * でだけ繋がる（フェーズ6 §2-1）。ここは後者だけを持つ。前者は `DealList.tsx` の virtualizer。
 *
 * ## 世代（generation）は2種類ある（決定K）
 *
 * - **ハード**（絞り込み・並び・時点・ユーザーが変わった）: 行を捨てて先頭から取り直す。
 *   `resetKey` が変わり、スクロールも先頭へ戻る（フェーズ6 決定J）。位置の意味が
 *   消えているので、捨てるのが正しい
 * - **ソフト**（`refresh()`。セル編集の確定後）: 行・total・スクロールを保ったまま
 *   `snapshot` と total を取り直す。固定時点のまま新しい行を重ねると1画面に2つの時点が
 *   混ざる（論点B）が、ハードにすると確定のたびに一覧が白くなって先頭へ飛び、
 *   「下のセルへ移って次を直す」が成立しない。古い行は見えている窓から順に置き換わる
 *
 * どちらも、世代の中の窓取得はすべて同じ `snapshot` で引くので、取得の合間に誰かが
 * 更新しても**行の重複・欠落が起きない**（フェーズ6 §2-2、決定A）。
 * `snapshot` はサーバが返した `now` をそのまま使う。クライアントの時計は信用しない。
 *
 * ## 取得は宣言（フェーズ12）
 *
 * 「どの窓が要るか」を宣言すると、取得の重複排除・遅れて返った応答の扱いはライブラリが持つ
 * （`let live` と `requested` Set が消えた）。**2つの世代はキーの設計として残る** —
 * ハード = キーの前半、ソフト = キーに載せたカウンタ。
 *
 * ⚠ **行の蓄積（`rows`）だけは手書きが残る**（フェーズ12 レビュー③）。理由は2つあり、
 *   どちらもライブラリが持てない:
 *   1. ソフト世代をまたいで**前の時点の行を出し続ける**（キャッシュはキー単位なので、
 *      `snapshot` が変わった瞬間に全部「未取得」に戻ってしまう ＝ 一覧が白くなる）
 *   2. **スクロールで通り過ぎた窓**を出し続ける（宣言を見えている範囲に絞ると、
 *      overscan が範囲外を描いた瞬間にスケルトンへ戻る）
 */
import { useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useReducer, useRef, useState } from 'react'
import type { Client, ListResponse } from '../../shell/api'
import { keyOf } from '../../shell/query'
import type { Deal } from '../../shell/types'

/** 1回の取得で引く行数。サーバの上限は 500。 */
export const PAGE_SIZE = 100

export interface DealPageInput {
  client: Client
  /** API のパラメータ名そのまま（`useDealQuery().filters`）。 */
  filters: Readonly<Record<string, string>>
  sort: string | undefined
  /** 時点指定（過去を見る）。省略時は現在。 */
  asOf: string | undefined
  /** 詐称中のユーザー。変われば `_permissions` も rowFilter も変わるので取り直す。 */
  user: string
}

export interface DealPage {
  /**
   * ハード世代の識別子。変わったら**スクロールを先頭に戻し、フォーカスを捨てる**合図
   * （絞り込みを変えたのに 5,000 行目を見ている、という絵にしないため）。
   * ソフト世代（`refresh`）では変わらない。
   */
  resetKey: string
  /** 絞り込みに一致する総件数。1枚目が返るまでは undefined。 */
  total: number | undefined
  /** 取得済みの行。未取得のインデックスは undefined（スケルトンを出す）。 */
  rowAt(index: number): Deal | undefined
  /** 見えている範囲を告げる。足りない窓があれば取りに行く。 */
  ensureRange(start: number, end: number): void
  /** PATCH レスポンスの行でその場を置き換える（裏の取り直しを待たずに反映する）。 */
  replaceRow(id: string, record: Deal): void
  /** ソフト世代を進める（決定K）。行・total・スクロールを保ったまま時点を取り直す。 */
  refresh(): void
}

/** いま何を取りに行っているか。ハード世代が変わったら丸ごと捨てる。 */
interface Generation {
  /** ハード世代の識別子。 */
  key: string
  /** ソフト世代。`refresh()` のたびに増える ＝ 窓のキーが全部変わる。 */
  soft: number
  /** この世代の起点ページ。ハードは先頭、ソフトは**最後に見ていた位置**。 */
  head: number
  /**
   * 宣言している窓。**この世代の間は減らさない** — 減らすと、通り過ぎた窓の行が
   * キャッシュから外れて蓄積の意味が薄れる（ソフト世代では起点だけに戻す）。
   */
  pages: readonly number[]
}

function firstGeneration(key: string): Generation {
  return { key, soft: 0, head: 0, pages: [0] }
}

export function useDealPage(input: DealPageInput): DealPage {
  const { client, filters, sort, asOf, user } = input

  // 依存の同一性が毎レンダー変わる（オブジェクト）ので、
  // 「ハード世代が変わったか」は文字列に畳んでから判定する
  const key = JSON.stringify([filters, sort ?? '', asOf ?? '', user])

  const [stored, setStored] = useState<Generation>(() => firstGeneration(key))
  // ハード世代が変わったフレームで**古い宣言のまま取りに行かない**ように、
  // 保存された世代ではなく「いまのキーに対する世代」を使う（effect で戻すと1フレーム遅れ、
  // その1フレームで前の絞り込みの窓を丸ごと取りに行ってしまう）
  const generation = stored.key === key ? stored : firstGeneration(key)

  const update = useCallback(
    (change: (base: Generation) => Generation) => {
      setStored((previous) => change(previous.key === key ? previous : firstGeneration(key)))
    },
    [key],
  )

  /** 最後に見えていた範囲。ソフト世代の起点ページを決めるのに使う。 */
  const lastRange = useRef({ start: 0, end: 0 })

  const at = { user, asOf }
  const fetchWindow = (page: number, snapshot: string | undefined) =>
    client.listPage<Deal>('deal', {
      filters,
      sort,
      asOf,
      snapshot,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })

  /**
   * 起点の窓。**`snapshot` を付けずに引き、返ってきた `now` を以後の固定に使う**。
   * この1本だけが世代の時点を決めるので、鮮度は既定のまま（画面に戻ったら取り直す）。
   */
  const head = useQuery({
    queryKey: keyOf(
      client,
      'deal',
      at,
      'window',
      filters,
      sort ?? '',
      generation.soft,
      generation.head,
    ),
    queryFn: () => fetchWindow(generation.head, undefined),
  })

  const pinned = head.data === undefined ? undefined : (head.data.snapshot ?? head.data.now)

  const windows = useQueries({
    queries: generation.pages
      .filter((page) => page !== generation.head)
      .map((page) => ({
        queryKey: keyOf(
          client,
          'deal',
          at,
          'window',
          filters,
          sort ?? '',
          generation.soft,
          page,
          pinned ?? '',
        ),
        queryFn: () => fetchWindow(page, pinned),
        // 時点が固定される前は引かない（世代の中で時点が混ざらないため）
        enabled: pinned !== undefined,
        // 同じ `snapshot` の同じ窓は**不変**なので、取り直す理由が無い
        staleTime: Infinity,
      })),
  })

  // --- 蓄積（手書きが残る部分。冒頭の ⚠ を参照） ---------------------------------

  const rows = useRef<{ key: string; map: Map<number, Deal> }>({ key, map: new Map() })
  const totals = useRef<{ key: string; value: number | undefined }>({ key, value: undefined })
  if (rows.current.key !== key) rows.current = { key, map: new Map() }
  if (totals.current.key !== key) totals.current = { key, value: undefined }

  /**
   * 取り込み済みのレスポンス。**同じものを二度重ねない**のが要点 —
   * 毎レンダー重ね直すと、`replaceRow` で差し替えた行が元に戻ってしまう。
   * 重ねるのは単調（消さない・上書きは新しい応答だけ）なので、描画の途中で走っても壊れない。
   */
  const taken = useRef(new WeakSet<object>())
  const take = (response: ListResponse<Deal> | undefined): void => {
    if (response === undefined || taken.current.has(response)) return
    taken.current.add(response)
    response.records.forEach((record, i) => {
      rows.current.map.set(response.offset + i, record)
    })
  }

  take(head.data)
  for (const window of windows) take(window.data)
  if (head.data !== undefined) totals.current.value = head.data.total

  // 起点が読めない（403 など）なら 0 件として畳む。読み込み中のまま止めない
  const total = head.isError && totals.current.value === undefined ? 0 : totals.current.value

  const [, redraw] = useReducer((count: number) => count + 1, 0)

  // --- 外から見える口（フェーズ12 でも1文字も変えていない） -----------------------

  const ensureRange = useCallback(
    (start: number, end: number) => {
      lastRange.current = { start, end }
      if (total === undefined || total === 0) return
      const first = Math.max(0, Math.floor(start / PAGE_SIZE))
      const last = Math.min(Math.floor(end / PAGE_SIZE), Math.floor((total - 1) / PAGE_SIZE))

      update((base) => {
        const added: number[] = []
        for (let page = first; page <= last; page += 1) {
          if (!base.pages.includes(page)) added.push(page)
        }
        // 増えていないなら**同じオブジェクトを返す**（再描画を起こさない）
        return added.length === 0 ? base : { ...base, pages: [...base.pages, ...added] }
      })
    },
    [total, update],
  )

  /**
   * ソフト世代（決定K）。行は捨てず、窓のキーだけ変える。起点は**最後に見ていた範囲**の
   * ページ — ハード世代の「先頭ページ」と違い、ユーザーはいまの位置に居続けるため。
   * 見えている残りの窓は、既存の `ensureRange` 経路が新しい固定で埋め直す。
   */
  const refresh = useCallback(() => {
    const anchor = Math.max(0, Math.floor(lastRange.current.start / PAGE_SIZE))
    update((base) => ({ ...base, soft: base.soft + 1, head: anchor, pages: [anchor] }))
  }, [update])

  const replaceRow = useCallback((id: string, record: Deal) => {
    for (const [index, row] of rows.current.map) {
      if (row.id !== id) continue
      rows.current.map.set(index, record)
      redraw()
      return
    }
  }, [])

  return {
    resetKey: key,
    total,
    // 蓄積を読むだけ。描き直しは取得結果の変化（と `replaceRow`）が起こす
    rowAt: useCallback((index: number) => rows.current.map.get(index), []),
    ensureRange,
    replaceRow,
    refresh,
  }
}
