/**
 * グリッドのキーボード配線を**実 Chromium**で検証する。
 * docs/impl/phase-7-list-grid-edit.md 決定R の追記
 *
 * この層に置く理由: 決定Rの欠陥（外を1回クリックすると枠は残るのに Enter が
 * どこにも届かない）は「DOM フォーカスがいまどこにあるか」というブラウザ実物の
 * 挙動が本体で、純関数（`gridCursor` / `cellEdit`）の層では原理的に捕まらない。
 * jsdom も focus / blur / relatedTarget の忠実度が低く不適。
 *
 * `userEvent` は playwright プロバイダ経由で **CDP の実イベント**（isTrusted: true）を
 * 送る。API はスタブ（`ScreenProps.client` が注入なので、サーバ無しで密閉できる）。
 * IME の変換確定だけは OS の IME を機械から駆動できないため、実イベントと同じ印
 * （`isComposing` / `keyCode 229`）を持つ合成イベントで代替し、対照として
 * 実 Enter が確定することを同じテストで確認する。
 */
import { NuqsAdapter } from 'nuqs/adapters/react'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { DealList } from './DealList'
import type { Client, ListResponse, QueryOptions } from '../../shell/api'
import type { Company, Deal, Employee } from '../../shell/types'
import '../../shell/app.css'

const NOW = '2026-08-08T00:00:00.000Z'

function makeDeal(index: number, overrides: Partial<Deal> = {}): Deal {
  return {
    id: `d-${index}`,
    companyId: 'c-1',
    title: `案件 ${index}`,
    productType: 'job_ad',
    dealType: 'new',
    initialBilling: null,
    initialProfit: null,
    monthlyBilling: null,
    monthlyProfit: null,
    contractMonths: null,
    expectedCloseMonth: null,
    confidence: null,
    status: 'open',
    outcomeReasonCategory: null,
    outcomeReasonDetail: null,
    competitor: null,
    ownerEmployeeId: 'e-1',
    closedAt: null,
    note: null,
    _flow: null,
    _version: {
      validFrom: NOW,
      validTo: null,
      changedBy: null,
      changedFlow: null,
      changedStep: null,
    },
    _permissions: { update: true, advance: true },
    ...overrides,
  }
}

interface PatchLog {
  id: string
  body: unknown
}

/**
 * API のスタブ。`patch` は差分を記録しつつ deals に**適用する** — 確定後の
 * ソフト世代（refresh）が再取得したとき、実サーバと同じく更新後の行が返るように。
 */
function stubClient(deals: Deal[], patches: PatchLog[]): Client {
  return {
    async list<T>(): Promise<T[]> {
      return []
    },
    async listPage<T>(_table: string, opts?: QueryOptions): Promise<ListResponse<T>> {
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? 100
      return {
        table: 'deal',
        flow: 'sales',
        asOf: null,
        snapshot: opts?.snapshot ?? null,
        now: NOW,
        total: deals.length,
        offset,
        limit,
        records: deals.slice(offset, offset + limit) as unknown as T[],
      }
    },
    async get<T>(): Promise<T> {
      throw new Error('このテストでは使わない')
    },
    async patch<T>(_table: string, id: string, body: unknown): Promise<T> {
      patches.push({ id, body })
      const index = deals.findIndex((deal) => deal.id === id)
      const current = deals[index]
      if (current === undefined) throw new Error(`知らない id: ${id}`)
      const next = { ...current, ...(body as Partial<Deal>) }
      deals[index] = next
      return next as unknown as T
    },
    async advance<T>(): Promise<T> {
      throw new Error('このテストでは使わない')
    },
    async setCheck<T>(): Promise<T> {
      throw new Error('このテストでは使わない')
    },
  } as Client
}

let root: Root | undefined
let mounted: HTMLElement[] = []

interface Harness {
  /** グリッドの外を表すクリック先（決定Rの再現に使う）。 */
  outside: HTMLButtonElement
  errors: unknown[]
}

function renderList(client: Client): Harness {
  const errors: unknown[] = []
  const outside = document.createElement('button')
  outside.textContent = 'グリッドの外'
  const host = document.createElement('div')
  document.body.append(outside, host)
  mounted = [outside, host]

  root = createRoot(host)
  root.render(
    <StrictMode>
      <NuqsAdapter>
        <DealList
          client={client}
          masters={{
            companies: new Map<string, Company>(),
            employees: new Map<string, Employee>(),
          }}
          asOf={undefined}
          user="yamada@example.com"
          onError={(cause) => errors.push(cause)}
        />
      </NuqsAdapter>
    </StrictMode>,
  )
  return { outside, errors }
}

afterEach(() => {
  root?.unmount()
  root = undefined
  for (const node of mounted) node.remove()
  mounted = []
  // nuqs が location.search を触った場合に、次のテストへ漏らさない
  history.replaceState(null, '', location.pathname)
})

/** セル（nth-child は 1 始まり + 列は 0 始まりなので +1）。 */
function cellOrNull(row: number, col: number): HTMLElement | null {
  const el = document.querySelector(
    `.grid-row[aria-rowindex="${row}"] .grid-cell:nth-child(${col + 1})`,
  )
  return el instanceof HTMLElement ? el : null
}

function cell(row: number, col: number): HTMLElement {
  const el = cellOrNull(row, col)
  if (el === null) throw new Error(`セルが無い: row=${row} col=${col}`)
  return el
}

const focusedCell = () => document.querySelector('.grid-cell.focused')
const editor = () => document.querySelector('.cell-editor')

/** 行が描画されるまで待つ（スタブは即時だが、レンダーは非同期）。 */
async function firstRowShown(): Promise<void> {
  await expect.poll(() => cellOrNull(1, 1)).not.toBeNull()
}

describe('フォーカスの正直さ（決定R）', () => {
  it('外をクリックすると枠が消え、戻れば Enter で編集に入れる', async () => {
    const { outside, errors } = renderList(stubClient([makeDeal(1), makeDeal(2)], []))
    await firstRowShown()

    await userEvent.click(cell(1, 1))
    await expect.poll(focusedCell).not.toBeNull()

    // ここが 2026-08-08 の欠陥の再現手順: 外を1回クリック → 枠が残ったまま
    // Enter がどこにも届かない、だった。枠は消えるのが正しい
    await userEvent.click(outside)
    await expect.poll(focusedCell).toBeNull()

    await userEvent.click(cell(1, 1))
    await userEvent.keyboard('{Enter}')
    await expect.poll(editor).not.toBeNull()

    await userEvent.keyboard('{Escape}')
    await expect.poll(editor).toBeNull()
    expect(errors).toEqual([])
  })

  it('フォーカスが無い状態でも、矢印でグリッドに入って編集まで行ける', async () => {
    renderList(stubClient([makeDeal(1), makeDeal(2)], []))
    await firstRowShown()

    const scroller = document.querySelector('.grid-scroller')
    if (!(scroller instanceof HTMLElement)) throw new Error('スクロール枠が無い')
    scroller.focus() // Tab でグリッドに入った状態

    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(focusedCell).not.toBeNull()

    await userEvent.keyboard('{Enter}')
    await expect.poll(editor).not.toBeNull()
  })
})

describe('編集の確定', () => {
  it('IME 変換確定の Enter ではセル確定せず、実キーの Enter で確定する', async () => {
    const patches: PatchLog[] = []
    renderList(stubClient([makeDeal(1)], patches))
    await firstRowShown()

    await userEvent.click(cell(1, 1))
    await userEvent.keyboard('{Enter}')
    await expect.poll(editor).not.toBeNull()

    // 変換確定の形（Chrome / Firefox: isComposing）と Safari の癖（keyCode 229）。
    // React の状態更新は dispatchEvent の同期外で flush されるので、ティックを挟んで見る
    const input = editor()
    if (input === null) throw new Error('エディタが無い')
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    const legacy = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(legacy, 'keyCode', { get: () => 229 })
    input.dispatchEvent(legacy)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(editor()).not.toBeNull()

    // 対照: 実キーボードの Enter は確定して閉じる。値が同じなので PATCH は飛ばない（決定N）
    await userEvent.keyboard('{Enter}')
    await expect.poll(editor).toBeNull()
    expect(patches).toEqual([])
  })

  it('値を変えた確定が PATCH になり、行がその場で置き換わってフォーカスは下へ移る', async () => {
    const patches: PatchLog[] = []
    renderList(stubClient([makeDeal(1), makeDeal(2)], patches))
    await firstRowShown()

    // 月額・請求額（col 6）に 25000 を入れる
    await userEvent.click(cell(1, 6))
    await userEvent.keyboard('{Enter}')
    await expect.poll(editor).not.toBeNull()
    await userEvent.keyboard('25000')
    await userEvent.keyboard('{Enter}')

    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0]).toEqual({ id: 'd-1', body: { monthlyBilling: 25000 } })
    await expect.poll(() => cellOrNull(1, 6)?.textContent).toContain('¥25,000')

    const row = focusedCell()?.closest('.grid-row')
    expect(row?.getAttribute('aria-rowindex')).toBe('2')
  })
})

describe('編集できないセル（決定O・S）', () => {
  it('書けない行は編集に入れず、理由が言葉で出る', async () => {
    const deals = [makeDeal(1), makeDeal(2, { _permissions: { update: false, advance: false } })]
    renderList(stubClient(deals, []))
    await firstRowShown()

    const row = document.querySelector('.grid-row[aria-rowindex="2"]')
    expect(row?.className).toContain('row-ro')

    await userEvent.click(cell(2, 1))
    await userEvent.keyboard('{Enter}')
    await userEvent.dblClick(cell(2, 1))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(editor()).toBeNull()
    // 枠はグレー（編集に入れない印）
    expect(focusedCell()?.className).toContain('ro')
    // 「なぜ効かないか」がその場に出る（決定S。編集不可が不具合として2回報告された跡）
    expect(document.querySelector('.grid-blocked')?.textContent).toContain('この案件の担当は')
  })

  it('編集対象外の列（FK など）でも理由が出て、編集を始めると消える', async () => {
    renderList(stubClient([makeDeal(1)], []))
    await firstRowShown()

    // 顧客企業（FK 列）で Enter
    await userEvent.click(cell(1, 2))
    await userEvent.keyboard('{Enter}')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(editor()).toBeNull()
    expect(document.querySelector('.grid-blocked')?.textContent).toContain(
      '列は一覧では編集できない',
    )

    // 編集できるセルで編集を始めると消える
    await userEvent.click(cell(1, 1))
    await userEvent.keyboard('{Enter}')
    await expect.poll(editor).not.toBeNull()
    expect(document.querySelector('.grid-blocked')).toBeNull()
  })
})
