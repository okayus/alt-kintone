/**
 * ハッシュルータ。共通シェルの一部。
 *
 * ルータのライブラリは入れない。画面が2つしかない段階で概念を1つ増やす必要がなく、
 * `node:http` や `parseArgs` を選んだのと同じ判断（docs/impl/phase-4-frontend.md 決定A）。
 * 画面が増えて分岐が辛くなったら入れ替える。
 */
import { useMemo, useSyncExternalStore } from 'react'

export type Route = { name: 'deals' } | { name: 'deal'; id: string }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const matched = /^\/deals\/([^/]+)\/?$/.exec(path)
  const id = matched?.[1]
  if (id !== undefined && id !== '') return { name: 'deal', id: decodeURIComponent(id) }
  return { name: 'deals' }
}

export const href = {
  deals: (): string => '#/',
  deal: (id: string): string => `#/deals/${encodeURIComponent(id)}`,
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
