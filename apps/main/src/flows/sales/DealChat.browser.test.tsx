/**
 * 閉じている間のエラーを黙らせる配線を**実 Chromium**で確認する。
 * docs/impl/phase-13-chat-side-panel.md 決定I・完了条件9
 *
 * 見たいのは「`meta.silent` が開閉に追随するか」— `QueryCache.onError`（フェーズ12）と
 * パネルの開閉という**別々の機構の噛み合わせ**なので、どちらの単体テストでも捕まらない。
 * 実害は小さい（件数が止まるだけ）が、見えていない機構のエラーで上部バナーを
 * 赤くすると「壊れていないのに壊れて見える」になる。
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { DealChat } from './DealChat'
import type { Client } from '../../shell/api'
import { openStorageKey } from '../../shell/panel/panel'
import { createQueryClient } from '../../shell/query'
import '../../shell/app.css'

/** 取得が必ず失敗するクライアント。 */
function brokenClient(): Client {
  return {
    flow: 'sales',
    list: () => Promise.reject(new Error('取れなかった')),
  } as unknown as Client
}

let root: Root | undefined
let host: HTMLElement | undefined
let queries: QueryClient | undefined
let reported: unknown[] = []

function render(): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  queries = createQueryClient((error) => reported.push(error))
  root.render(
    <StrictMode>
      <QueryClientProvider client={queries}>
        <DealChat
          client={brokenClient()}
          dealId="d-1"
          meId="e-yamada"
          user="yamada@example.com"
          nameOf={() => '山田'}
          asOf={undefined}
          onError={() => undefined}
        />
      </QueryClientProvider>
    </StrictMode>,
  )
}

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 300)) as Promise<void>

beforeEach(() => {
  window.localStorage.clear()
  reported = []
})

afterEach(() => {
  root?.unmount()
  root = undefined
  host?.remove()
  host = undefined
  queries?.clear()
  queries = undefined
  window.localStorage.clear()
})

describe('閉じている間の取得失敗（完了条件9）', () => {
  it('閉じていれば上部バナーに出さない', async () => {
    window.localStorage.setItem(openStorageKey('deal'), 'false')
    render()
    await settle()
    expect(reported).toEqual([])
  })

  it('開いていれば出す', async () => {
    render()
    await settle()
    expect(reported.length).toBeGreaterThan(0)
  })

  it('開いた後の失敗は出る（黙らせるのは開閉に追随する）', async () => {
    window.localStorage.setItem(openStorageKey('deal'), 'false')
    render()
    await settle()
    expect(reported).toEqual([])

    const toggle = document.querySelector('.side-panel-toggle')
    if (!(toggle instanceof HTMLElement)) throw new Error('取っ手が無い')
    await userEvent.click(toggle)
    await queries?.refetchQueries()
    await settle()
    expect(reported.length).toBeGreaterThan(0)
  })
})
