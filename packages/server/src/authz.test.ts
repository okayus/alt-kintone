/**
 * 認可。docs/product-concept.md §4-1
 *
 * **権限設定はどこにも書いていない。** ここで通る／落ちる判定はすべて業務フロー定義
 * （ステップの role / reads / writes、バインディングの rowFilter）から導出されている。
 * kintone では権限が別画面にあって業務と乖離する、というのを構造で解いた部分。
 */
import {
  participation,
  permissionsOf as computePermissions,
  requireParticipation,
  requireStepRole,
  type Principal,
} from './authz.js'
import {
  ADMIN,
  bundle,
  errorCode,
  fixture,
  flowOf,
  MANAGER,
  permissionsOf,
  PRODUCTION,
  record,
  records,
  SATO,
} from './support.js'
import type { ApiError } from './api.js'
import type { FlowDef, StepDef } from '@alt/dsl'
import { describe, expect, it } from 'vitest'

describe('認証（プロトタイプの詐称）', () => {
  it('X-Dev-User が無ければ 401', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', { user: null })
    expect(response.status).toBe(401)
    expect(errorCode(response)).toBe('unauthorized')
  })

  it('従業員マスタに居ない識別子は 401', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', {
      user: 'nobody@example.com',
    })
    expect(response.status).toBe(401)
  })
})

describe('行レベル（読みは全員、書きは担当者＋管理者）', () => {
  it('他人の案件も読める', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', { user: SATO })
    expect(response.status).toBe(200)
    expect(records(response).map((r) => r['id'])).toContain('d-1')
  })

  it('他人の案件は更新できない', () => {
    const response = fixture().request('PATCH', '/api/deal/d-1?flow=sales', {
      body: { note: 'よそから書き換え' },
      user: SATO,
    })
    expect(response.status).toBe(403)
    expect(errorCode(response)).toBe('forbidden')
  })

  it('自分の案件は更新できる', () => {
    const response = fixture().request('PATCH', '/api/deal/d-3?flow=sales', {
      body: { note: '自分の案件' },
      user: SATO,
    })
    expect(response.status).toBe(200)
  })

  it('管理者は行レベルをバイパスする', () => {
    const response = fixture().request('PATCH', '/api/deal/d-1?flow=sales', {
      body: { note: '管理者が修正' },
      user: ADMIN,
    })
    expect(response.status).toBe(200)
  })
})

describe('_permissions（FEに認可ロジックを複製しない）', () => {
  it('レコードごとに、実際の可否と同じ値が返る', () => {
    const f = fixture()
    const mine = records(f.request('GET', '/api/deal?flow=sales')).find((r) => r['id'] === 'd-1')
    const others = records(f.request('GET', '/api/deal?flow=sales', { user: SATO })).find(
      (r) => r['id'] === 'd-1',
    )

    expect(permissionsOf(mine as Record<string, unknown>)).toEqual({
      update: true,
      advance: true,
    })
    expect(permissionsOf(others as Record<string, unknown>)).toEqual({
      update: false,
      advance: false,
    })
  })

  it('担当者でない営業には advance も update も false で返る', () => {
    const view = records(fixture().request('GET', '/api/deal?flow=sales', { user: SATO })).find(
      (r) => r['id'] === 'd-1',
    )
    expect(permissionsOf(view as Record<string, unknown>)).toEqual({
      update: false,
      advance: false,
    })
  })

  it('読むだけのテーブルでは update が false', () => {
    const view = records(fixture().request('GET', '/api/company?flow=sales'))[0]
    expect(permissionsOf(view as Record<string, unknown>)).toEqual({ update: false })
  })

  it('管理者には全部 true で返る', () => {
    const view = records(fixture().request('GET', '/api/deal?flow=sales', { user: ADMIN })).find(
      (r) => r['id'] === 'd-1',
    )
    expect(permissionsOf(view as Record<string, unknown>)).toEqual({ update: true, advance: true })
  })
})

describe('テーブルアクセス（access はステップの reads/writes から導出）', () => {
  it('reference バインドのテーブルには書けない', () => {
    const response = fixture().request('POST', '/api/company?flow=sales', {
      body: { name: '新しい会社', status: 'prospect' },
      user: ADMIN,
    })
    expect(response.status).toBe(403)
    // 管理者でも通らない。access は「フローがそのテーブルをどう使うか」であって偉さではない
    expect(errorCode(response)).toBe('forbidden')
  })

  it('横断マスタも読むだけなら書けない', () => {
    const response = fixture().request('PATCH', '/api/employee/e-yamada?flow=sales', {
      body: { team: 'B' },
      user: ADMIN,
    })
    expect(response.status).toBe(403)
  })
})

describe('フロー参加（定義から導出する）', () => {
  /**
   * ⚠ **客先の定義には「どのフローにも参加していないロール」がもう居ない**
   * （フェーズ11 決定C。制作・MEO運用が営業フローの viewers に入り、要望フローは
   * 元から全ロールが operator）。403 の役をフェーズ8 で鈴木 → 森 に移したが、
   * 今回は**引き継ぎ先が無い**。
   *
   * 定義にテスト専用のロールを足すのは本末転倒（定義は客先の業務の記録）なので、
   * この経路は**実物のフロー定義に、居ないロールを当てて**固定する。
   * HTTP 側は `resolveContext` がこの関数を呼ぶだけなので、判定の中身はここで足りる。
   */
  it('担当ロールでも viewers でもないロールは 403 で、hint に両方が出る', () => {
    const sales = bundle.flows.find((flow) => flow.key === 'sales')
    if (sales === undefined) throw new Error('営業フローが定義に無い')
    const outsider: Principal = {
      id: 'e-x',
      name: 'X',
      email: 'x@example.com',
      role: 'accounting',
    }

    expect(participation(outsider, sales)).toBe('none')
    try {
      requireParticipation(outsider, sales)
      throw new Error('403 にならなかった')
    } catch (error) {
      const api = error as ApiError
      expect(api.status).toBe(403)
      expect(api.code).toBe('forbidden')
      // 直しようがあるように、担当ロールと閲覧ロールの**両方**を出す
      expect(api.hint ?? '').toContain('sales_rep')
      expect(api.hint ?? '').toContain('sales_manager')
    }
  })

  it('管理者はステップを担当していなくても参加できる', () => {
    expect(fixture().request('GET', '/api/deal?flow=sales', { user: ADMIN }).status).toBe(200)
  })
})

/**
 * フェーズ11 決定C の帰結。**制作担当は営業フローの viewers になった**
 * （受注後の引き継ぎを受ける側なので、案件が1件も読めないままでは成立しない）。
 */
describe('引き継ぎ先のロール（フェーズ11 決定C）', () => {
  it('制作担当は全案件を読めるが、案件は直せない', () => {
    const f = fixture()
    const response = f.request('GET', '/api/deal?flow=sales', { user: PRODUCTION })
    expect(response.status).toBe(200)
    expect(records(response).map((r) => r['id'])).toContain('d-1')

    const denied = f.request('PATCH', '/api/deal/d-1?flow=sales', {
      body: { note: '制作が書き換え' },
      user: PRODUCTION,
    })
    expect(denied.status).toBe(403)
  })
})

/**
 * §8-2 論点12 の解決（docs/impl/phase-8-authz-participation.md）。
 *
 * 営業マネージャーはどのステップも担当していないが、フロー定義の `viewers` に居るので
 * **読める。ただし業務は進めない。** 以前はここが 403 で、「マネージャーは一覧が
 * 丸ごと見えない」という絵になっていた。
 *
 * ⚠ フェーズ11 決定A で「何も書けない」ではなくなった — `appendBy: 'participants'` を
 * 宣言したテーブル（案件のやりとり）にだけは追記できる。下の describe が対。
 */
describe('閲覧のみの参加（viewers）', () => {
  it('viewers のロールは全案件を読める', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', { user: MANAGER })
    expect(response.status).toBe(200)
    expect(records(response).map((r) => r['id'])).toContain('d-1')
  })

  it('viewers には update も advance も false で返る', () => {
    const response = fixture().request('GET', '/api/deal/d-1?flow=sales', { user: MANAGER })
    expect(permissionsOf(record(response))).toMatchObject({ update: false, advance: false })
  })

  /**
   * ⚠ **新規作成には行レベル認可が効かない**（まだ行が無いので rowFilter を評価できない）。
   * viewer をここで止めているのは `requireOperator` だけ。担当ロール（佐藤）との対比で、
   * 「担当でない」ではなく「閲覧のみ」で落ちていることが分かる。
   */
  it('viewers は新規作成できないが、担当ロールならできる', () => {
    const body = {
      companyId: 'co-1',
      title: '新規案件',
      productType: 'meo',
      dealType: 'new',
      status: 'open',
      ownerEmployeeId: 'e-sato',
    }
    expect(fixture().request('POST', '/api/deal?flow=sales', { body, user: SATO }).status).toBe(201)

    const denied = fixture().request('POST', '/api/deal?flow=sales', { body, user: MANAGER })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('forbidden')
  })

  it('viewers は更新できない', () => {
    const response = fixture().request('PATCH', '/api/deal/d-1?flow=sales', {
      body: { title: '書き換え' },
      user: MANAGER,
    })
    expect(response.status).toBe(403)
  })

  it('viewers はステップを進められない', () => {
    const response = fixture().request('POST', '/api/deal/d-1/advance?flow=sales', {
      body: { to: 'proposed' },
      user: MANAGER,
    })
    expect(response.status).toBe(403)
  })

  it('viewers は手動チェックを更新できない', () => {
    const response = fixture().request(
      'PUT',
      '/api/deal/d-1/checks/problem_identified?flow=sales',
      {
        body: { checked: true },
        user: MANAGER,
      },
    )
    expect(response.status).toBe(403)
  })
})

/**
 * 追記は参加者全員（フェーズ11 決定A）。
 *
 * **開くのはバインドの宣言（`appendBy: 'participants'`）であって、人の側の定義ではない。**
 * 同じ viewer が、宣言のあるテーブル（案件のやりとり）には書けて、無いテーブル（案件）
 * には書けない — この対比が、参加の4種類を崩していないことの実体。
 */
describe('追記の宣言（appendBy: participants）', () => {
  const aMessage = (author: string) => ({
    dealId: 'd-1',
    authorEmployeeId: author,
    body: '決裁者に会えていないのが気になる',
    authorKind: 'human',
  })

  it('viewers は宣言のあるテーブルには追記できる', () => {
    const response = fixture().request('POST', '/api/deal_message?flow=sales', {
      body: aMessage('e-suzuki'),
      user: MANAGER,
    })
    expect(response.status).toBe(201)
  })

  it('宣言が無いテーブル（案件本体）には、同じ人が追記できないまま', () => {
    const response = fixture().request('POST', '/api/deal?flow=sales', {
      body: {
        companyId: 'co-1',
        title: '新規案件',
        productType: 'meo',
        dealType: 'new',
        status: 'open',
        ownerEmployeeId: 'e-sato',
      },
      user: MANAGER,
    })
    expect(response.status).toBe(403)
  })

  it('開くのは追記だけ。自分が書いたものでも viewer は更新できない', () => {
    const f = fixture()
    const created = record(
      f.request('POST', '/api/deal_message?flow=sales', {
        body: aMessage('e-suzuki'),
        user: MANAGER,
      }),
    )
    const patch = f.request(`PATCH`, `/api/deal_message/${created['id'] as string}?flow=sales`, {
      body: { body: '直す' },
      user: MANAGER,
    })
    expect(patch.status).toBe(403)
  })

  it('決着済み（won）の案件にも書ける — 引き継ぎはそこで起きる', () => {
    const f = fixture()
    f.request('POST', '/api/deal/d-1/advance?flow=sales', { body: { to: 'proposed' } })
    f.request('POST', '/api/deal/d-1/advance?flow=sales', { body: { to: 'won' } })
    expect(flowOf(record(f.request('GET', '/api/deal/d-1?flow=sales')))['step']).toBe('won')

    const response = f.request('POST', '/api/deal_message?flow=sales', {
      body: { ...aMessage('e-mori'), body: '初期設定に入ります' },
      user: PRODUCTION,
    })
    expect(response.status).toBe(201)
  })
})

/**
 * **同じ段階を複数のロールが操作する**（phase-8 論点B）。営業フローは全ステップが
 * `sales_rep` 単独なので、この性質は実データでは踏めない。純関数として固定しておく
 * — フェーズ9（全社員が起票する要望フロー）が成立する保証がここ。
 */
describe('複数の担当ロール（純関数）', () => {
  const aStep = (key: string, roles: string[]): StepDef => ({
    key,
    name: key,
    intent: 'i',
    roles,
    reads: [],
    writes: [],
    exit: [],
    next: [],
  })
  const aFlow = (steps: StepDef[], viewers?: string[]): FlowDef => ({
    key: 'f',
    name: 'f',
    goal: 'g',
    target: 't',
    initial: steps[0]?.key ?? '',
    steps,
    bindings: [],
    ...(viewers === undefined ? {} : { viewers }),
  })
  const asRole = (role: string): Principal => ({ id: 'u', name: 'u', email: 'u@x', role })

  const filed = aStep('filed', ['sales_rep', 'production', 'meo_operator'])
  const flow = aFlow([filed], ['sales_manager'])

  it('担当ロールのどれでも operator として参加する', () => {
    for (const role of ['sales_rep', 'production', 'meo_operator']) {
      expect(participation(asRole(role), flow)).toBe('operator')
    }
  })

  it('viewers は viewer、どちらでもなければ none、管理者は admin', () => {
    expect(participation(asRole('sales_manager'), flow)).toBe('viewer')
    expect(participation(asRole('nobody'), flow)).toBe('none')
    expect(participation(asRole('admin'), flow)).toBe('admin')
  })

  it('ステップ操作は担当ロールのどれでも通り、含まれなければ 403', () => {
    for (const role of ['sales_rep', 'production', 'meo_operator']) {
      expect(() => requireStepRole(asRole(role), filed, '遷移')).not.toThrow()
    }
    // 403 のメッセージには**担当ロールを全部**出す（1つだけ出すと直しようがない）
    expect(() => requireStepRole(asRole('sales_manager'), filed, '遷移')).toThrow(/meo_operator/)
  })

  it('advance は担当ロールのどれでも true、viewer では false', () => {
    const usage = {
      table: 't',
      flow,
      access: 'write' as const,
      binding: undefined,
      steps: ['filed'],
    }
    const base = { usage, rowWritable: true, historical: false, step: filed }

    for (const role of ['sales_rep', 'production', 'meo_operator']) {
      expect(
        computePermissions({ ...base, principal: asRole(role), participation: 'operator' }),
      ).toMatchObject({ update: true, advance: true })
    }
    expect(
      computePermissions({
        ...base,
        principal: asRole('sales_manager'),
        participation: 'viewer',
      }),
    ).toMatchObject({ update: false, advance: false })
  })
})

describe('バインドされていないテーブルは使えない（§3-2）', () => {
  it('定義に無いテーブルは 404', () => {
    const response = fixture().request('GET', '/api/quota?flow=sales')
    expect(response.status).toBe(404)
    expect(errorCode(response)).toBe('not-found')
  })
})

describe('フローの指定', () => {
  it('使っていないフローを指定したら 400', () => {
    const response = fixture().request('GET', '/api/deal?flow=production')
    expect(response.status).toBe(400)
  })

  it('フローが1本なら省略できる', () => {
    const response = fixture().request('GET', '/api/deal')
    expect(response.status).toBe(200)
    expect((response.body as { flow: string }).flow).toBe('sales')
  })
})
