/**
 * 取得の宣言化。docs/impl/phase-12-data-fetching.md 論点C・F
 *
 * **シェルの一部**（§4-3 の「共通化はシェルのみ」）。ここが決めるのは2つだけ:
 *
 * 1. **キーの規約** — `[flow, table, user, asOf, ...固有]`。取得の同一性がこの並びで決まる
 * 2. **既定値** — ライブラリの既定を今日の挙動に倒す（入れたら挙動が変わった、を潰す）
 *
 * ⚠ **画面はキーの配列リテラルを手書きしない。** 先頭の `flow` は認可の範囲を決める値
 *   （決定14）で、取り違えると「別フローの認可範囲で取ったキャッシュを読む」になる。
 *   だから `flow` は引数で受けず、**クライアント自身から読む**（`Client.flow`）。
 */
import { QueryCache, QueryClient } from '@tanstack/react-query'
import type { Client } from './api'

/**
 * クエリに添える印。
 *
 * `silent` は「**数えられないことが業務の失敗ではない**」取得に立てる（未読バッジ）。
 * 共通のエラー表示がこれを見て黙る。握りつぶす場所を画面の `catch` ではなく
 * クエリの宣言に置くのは、握りつぶしが**意図的だと読める**ようにするため。
 */
export type AltQueryMeta = { silent?: boolean }

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: AltQueryMeta
    mutationMeta: AltQueryMeta
  }
}

/**
 * 時点と利用者。**キーに必ず入る**（フェーズ12 論点C）。
 *
 * - `user`: 詐称を切り替えると `_permissions` も rowFilter も変わる。キーに入れておけば
 *   「切替後に前の利用者のキャッシュが見える」が原理的に起きない（フェーズ9 決定N を
 *   キーの同一性で保証し直す形）
 * - `asOf`: 時点が違えば別のデータ。**時点に追随させない取得もある**ので
 *   （マスタの名前解決）、省略可能にせず `undefined` を明示させる
 */
export interface QueryAt {
  user: string
  asOf: string | undefined
}

/** キーに置ける値。オブジェクトはライブラリがキー順に依存しない形で畳む。 */
export type QueryKeyPart =
  | string
  | number
  | boolean
  | null
  | undefined
  | Readonly<Record<string, string>>

/**
 * queryKey を作る。**画面はこれ以外の方法でキーを作らない。**
 *
 * @param client 取得に使うクライアント。**先頭の `flow` はここから読む**
 * @param table テーブル名（複数テーブルを1回で数えるものは `'unread'` のような論理名）
 * @param at 利用者と時点
 * @param extra 画面固有の識別子（レコードID・絞り込み・ページ番号など）
 */
export function keyOf(
  client: Client,
  table: string,
  at: QueryAt,
  ...extra: readonly QueryKeyPart[]
): readonly unknown[] {
  return [client.flow, table, at.user, at.asOf, ...extra]
}

/**
 * QueryClient。**既定を今日の挙動に倒す**（論点F）。
 *
 * @param report fetch の失敗を出す先（App の上部バナー）。`meta.silent` のクエリは通さない
 */
export function createQueryClient(report: (error: unknown) => void): QueryClient {
  return new QueryClient({
    // v5 は useQuery の onError を廃止した。**全クエリ共通の1箇所**がここ。
    // 画面ごとに `.catch(onError)` を配る必要が無くなる（論点B）
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.silent === true) return
        report(error)
      },
    }),
    defaultOptions: {
      queries: {
        // 今日はリトライしない（失敗は即バナー）。3回黙って粘られると、
        // 「壊れているのに画面が黙っている時間」が増える
        retry: false,
        // 今日はウィンドウフォーカスで取り直さない
        refetchOnWindowFocus: false,
        // staleTime は既定 0 のまま = 再マウントで取り直す（今日と同じ鮮度）。
        // 一覧の窓だけ Infinity を明示する（同じ snapshot の同じ窓は不変なので）
      },
    },
  })
}
