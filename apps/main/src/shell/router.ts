/**
 * ハッシュルータ。共通シェルの一部。
 *
 * ルータのライブラリは入れない。画面が3つしかない段階で概念を1つ増やす必要がなく、
 * `node:http` や `parseArgs` を選んだのと同じ判断（docs/impl/phase-4-frontend.md 決定A）。
 * 画面が増えて分岐が辛くなったら入れ替える。
 */
import { useMemo, useSyncExternalStore } from 'react'

export type Route =
  | { name: 'deals' }
  | { name: 'deal'; id: string }
  /** 業務フローの参照画面。`step` は案件詳細から来たときの現在地（強調に使う）。 */
  | { name: 'flow'; key: string; step?: string }
  | { name: 'requests' }
  /**
   * 起票（フェーズ9）。`from` は**押した瞬間に見ていた画面のハッシュ**で、
   * 対象（テーブル・レコード・フロー）はここから導出する（`requestContext.ts`）。
   * 業務画面がシェルへ状態を push する形にしないための持ち方。
   */
  | { name: 'requestNew'; from?: string }
  | { name: 'request'; id: string }

export function parseRoute(hash: string): Route {
  // `#/flows/sales?step=qualified` — ハッシュの中にクエリを持つ
  const [path = '', search = ''] = hash.replace(/^#/, '').split('?')
  const query = new URLSearchParams(search)

  const deal = /^\/deals\/([^/]+)\/?$/.exec(path)?.[1]
  if (deal !== undefined && deal !== '') return { name: 'deal', id: decodeURIComponent(deal) }

  const flow = /^\/flows\/([^/]+)\/?$/.exec(path)?.[1]
  if (flow !== undefined && flow !== '') {
    const step = query.get('step')
    return {
      name: 'flow',
      key: decodeURIComponent(flow),
      ...(step === null || step === '' ? {} : { step }),
    }
  }

  // 起票は `/requests/new`。ID との衝突を避けるため、ID 側より先に見る
  if (/^\/requests\/new\/?$/.test(path)) {
    const from = query.get('from')
    return { name: 'requestNew', ...(from === null || from === '' ? {} : { from }) }
  }

  const request = /^\/requests\/([^/]+)\/?$/.exec(path)?.[1]
  if (request !== undefined && request !== '') {
    return { name: 'request', id: decodeURIComponent(request) }
  }

  if (/^\/requests\/?$/.test(path)) return { name: 'requests' }

  return { name: 'deals' }
}

export const href = {
  deals: (): string => '#/',
  deal: (id: string): string => `#/deals/${encodeURIComponent(id)}`,
  flow: (key: string, step?: string): string =>
    `#/flows/${encodeURIComponent(key)}${step === undefined ? '' : `?step=${encodeURIComponent(step)}`}`,
  requests: (): string => '#/requests',
  request: (id: string): string => `#/requests/${encodeURIComponent(id)}`,
  requestNew: (from?: string): string =>
    `#/requests/new${from === undefined || from === '' ? '' : `?from=${encodeURIComponent(from)}`}`,
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/**
 * ⚠ スナップショットは**文字列**（`location.hash`）にする。`parseRoute` の結果を
 *    返すと毎回別オブジェクトになり、`useSyncExternalStore` が変化を検出し続けて
 *    再レンダリングが止まらない。
 */
export function useRoute(): Route {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  )
  return useMemo(() => parseRoute(hash), [hash])
}
