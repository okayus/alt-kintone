/**
 * 一覧の窓取得。docs/impl/phase-6-list-grid.md 論点B /
 * docs/impl/phase-7-list-grid-edit.md 決定K
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
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Client } from '../../shell/api'
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
  onError: (error: unknown) => void
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

const NO_ROWS: ReadonlyMap<number, Deal> = new Map()

export function useDealPage(input: DealPageInput): DealPage {
  const { client, filters, sort, asOf, user, onError } = input

  const [total, setTotal] = useState<number | undefined>(undefined)
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined)
  const [rows, setRows] = useState<ReadonlyMap<number, Deal>>(NO_ROWS)

  /** 世代の識別子。古い世代のレスポンスを捨てるために見る。 */
  const token = useRef(0)
  /** 取得を投げた窓の番号。二重取得を防ぐ。 */
  const requested = useRef(new Set<number>())
  /** 最後に見えていた範囲。ソフト世代の起点ページを決めるのに使う。 */
  const lastRange = useRef({ start: 0, end: 0 })

  // 依存の同一性が毎レンダー変わる（オブジェクト・関数）ので、
  // 「世代を進めるべきか」は文字列に畳んでから判定する
  const key = JSON.stringify([filters, sort ?? '', asOf ?? '', user])

  // 取得の中で読む最新の値。effect の依存には入れない
  const latest = useRef({ client, filters, sort, asOf, onError })
  latest.current = { client, filters, sort, asOf, onError }

  const fetchPage = useCallback((page: number, pinned: string | undefined) => {
    const { client: c, filters: f, sort: s, asOf: a, onError: fail } = latest.current
    const mine = token.current
    return c
      .listPage<Deal>('deal', {
        filters: f,
        sort: s,
        asOf: a,
        snapshot: pinned,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .catch((cause: unknown) => {
        if (token.current === mine) {
          // 取り直せるようにしておく（スクロールし直せば再挑戦になる）
          requested.current.delete(page)
          fail(cause)
        }
        return undefined
      })
      .then((response) => (token.current === mine ? response : undefined))
  }, [])

  // ハード世代の起点。1枚目は snapshot を付けずに引き、返ってきた now を以後の固定に使う
  useEffect(() => {
    token.current += 1
    requested.current = new Set([0])
    lastRange.current = { start: 0, end: 0 }
    setTotal(undefined)
    setSnapshot(undefined)
    setRows(NO_ROWS)

    void fetchPage(0, undefined).then((response) => {
      if (response === undefined) {
        setTotal(0)
        return
      }
      setSnapshot(response.snapshot ?? response.now)
      setTotal(response.total)
      setRows(indexed(new Map(), response.offset, response.records))
    })
  }, [key, fetchPage])

  /**
   * ソフト世代（決定K）。行は捨てず、`snapshot` だけ未定に戻して ensureRange を
   * 新しい固定が来るまで待たせる。起点は**最後に見えていた範囲**のページ —
   * ハード世代の「先頭ページ」と違い、ユーザーはいまの位置に居続けるため。
   * 見えている残りの窓は、既存の ensureRange 経路が新しい固定で埋め直す。
   */
  const refresh = useCallback(() => {
    const anchor = Math.max(0, Math.floor(lastRange.current.start / PAGE_SIZE))
    token.current += 1
    requested.current = new Set([anchor])
    setSnapshot(undefined)

    void fetchPage(anchor, undefined).then((response) => {
      // 失敗はバナーに出ている。古い行を出したままにする（スケルトンより情報が多い）
      if (response === undefined) return
      setSnapshot(response.snapshot ?? response.now)
      setTotal(response.total)
      setRows((previous) => indexed(previous, response.offset, response.records))
    })
  }, [fetchPage])

  const ensureRange = useCallback(
    (start: number, end: number) => {
      lastRange.current = { start, end }
      if (total === undefined || snapshot === undefined || total === 0) return
      const first = Math.max(0, Math.floor(start / PAGE_SIZE))
      const last = Math.min(Math.floor(end / PAGE_SIZE), Math.floor((total - 1) / PAGE_SIZE))

      for (let page = first; page <= last; page += 1) {
        if (requested.current.has(page)) continue
        requested.current.add(page)
        void fetchPage(page, snapshot).then((response) => {
          if (response === undefined) return
          setRows((previous) => indexed(previous, response.offset, response.records))
        })
      }
    },
    [total, snapshot, fetchPage],
  )

  const replaceRow = useCallback((id: string, record: Deal) => {
    setRows((previous) => {
      for (const [index, row] of previous) {
        if (row.id !== id) continue
        const next = new Map(previous)
        next.set(index, record)
        return next
      }
      return previous
    })
  }, [])

  return {
    resetKey: key,
    total,
    rowAt: useCallback((index: number) => rows.get(index), [rows]),
    ensureRange,
    replaceRow,
    refresh,
  }
}

/** 窓のレコードを絶対インデックスで置く。 */
function indexed(
  previous: ReadonlyMap<number, Deal>,
  offset: number,
  records: readonly Deal[],
): ReadonlyMap<number, Deal> {
  const next = new Map(previous)
  records.forEach((record, i) => next.set(offset + i, record))
  return next
}
