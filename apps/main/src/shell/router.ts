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

export function parseRoute(hash: string): Route {
  // `#/flows/sales?step=qualified` — ハッシュの中にクエリを持つ
  const [path = '', search = ''] = hash.replace(/^#/, '').split('?')

  const deal = /^\/deals\/([^/]+)\/?$/.exec(path)?.[1]
  if (deal !== undefined && deal !== '') return { name: 'deal', id: decodeURIComponent(deal) }

  const flow = /^\/flows\/([^/]+)\/?$/.exec(path)?.[1]
  if (flow !== undefined && flow !== '') {
    const step = new URLSearchParams(search).get('step')
    return {
      name: 'flow',
      key: decodeURIComponent(flow),
      ...(step === null || step === '' ? {} : { step }),
    }
  }

  return { name: 'deals' }
}

export const href = {
  deals: (): string => '#/',
  deal: (id: string): string => `#/deals/${encodeURIComponent(id)}`,
  flow: (key: string, step?: string): string =>
    `#/flows/${encodeURIComponent(key)}${step === undefined ? '' : `?step=${encodeURIComponent(step)}`}`,
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
