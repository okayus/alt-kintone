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
  requireStepRole,
  type Principal,
} from './authz.js'
import {
  ADMIN,
  errorCode,
  fixture,
  MANAGER,
  permissionsOf,
  PRODUCTION,
  record,
  records,
  SATO,
} from './support.js'
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
  it('担当ロールでも viewers でもないロールは参加できない', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', { user: PRODUCTION })
    expect(response.status).toBe(403)
    expect(errorCode(response)).toBe('forbidden')
  })

  it('参加できないときは、担当ロールと閲覧ロールの両方を hint に出す', () => {
    const response = fixture().request('GET', '/api/deal?flow=sales', { user: PRODUCTION })
    const hint = (response.body as { error: { hint?: string } }).error.hint ?? ''
    expect(hint).toContain('sales_rep')
    expect(hint).toContain('sales_manager')
  })

  it('管理者はステップを担当していなくても参加できる', () => {
    expect(fixture().request('GET', '/api/deal?flow=sales', { user: ADMIN }).status).toBe(200)
  })
})

/**
 * §8-2 論点12 の解決（docs/impl/phase-8-authz-participation.md）。
 *
 * 営業マネージャーはどのステップも担当していないが、フロー定義の `viewers` に居るので
 * **読める。ただし何も書けない。** 以前はここが 403 で、「マネージャーは一覧が
 * 丸ごと見えない」という絵になっていた。
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
