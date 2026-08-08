/**
 * 一覧の窓取得。docs/impl/phase-6-list-grid.md 論点B
 *
 * **描画の仮想化（DOM）と取得の窓化（通信）は別の仕組み**で、「いま何行目が見えているか」
 * でだけ繋がる（§2-1）。ここは後者だけを持つ。前者は `DealList.tsx` の virtualizer。
 *
 * ## 世代（generation）
 *
 * フィルタ・並び・時点・ユーザーが変わったら**世代を進める**: `snapshot` を取り直し、
 * 総件数を引き直し、窓のキャッシュを捨てる。世代の中の窓取得はすべて同じ `snapshot` で
 * 引くので、取得の合間に誰かが更新しても**行の重複・欠落が起きない**（§2-2、決定A）。
 *
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
   * 世代が変わると別の値になる。**スクロール位置を戻す合図**として使う
   * （絞り込みを変えたのに 5,000 行目を見ている、という絵にしないため）。
   */
  resetKey: string
  /** 絞り込みに一致する総件数。1枚目が返るまでは undefined。 */
  total: number | undefined
  /** 取得済みの行。未取得のインデックスは undefined（スケルトンを出す）。 */
  rowAt(index: number): Deal | undefined
  /** 見えている範囲を告げる。足りない窓があれば取りに行く。 */
  ensureRange(start: number, end: number): void
  /** 世代を進める（再読込）。 */
  reload(): void
}

const NO_ROWS: ReadonlyMap<number, Deal> = new Map()

export function useDealPage(input: DealPageInput): DealPage {
  const { client, filters, sort, asOf, user, onError } = input

  const [total, setTotal] = useState<number | undefined>(undefined)
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined)
  const [rows, setRows] = useState<ReadonlyMap<number, Deal>>(NO_ROWS)
  const [generation, setGeneration] = useState(0)

  /** 世代の識別子。古い世代のレスポンスを捨てるために見る。 */
  const token = useRef(0)
  /** 取得を投げた窓の番号。二重取得を防ぐ。 */
  const requested = useRef(new Set<number>())

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

  // 世代の起点。1枚目は snapshot を付けずに引き、返ってきた now を以後の固定に使う
  useEffect(() => {
    token.current += 1
    requested.current = new Set([0])
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
  }, [key, generation, fetchPage])

  const ensureRange = useCallback(
    (start: number, end: number) => {
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

  return {
    resetKey: `${key}#${generation}`,
    total,
    rowAt: useCallback((index: number) => rows.get(index), [rows]),
    ensureRange,
    reload: useCallback(() => setGeneration((value) => value + 1), []),
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
