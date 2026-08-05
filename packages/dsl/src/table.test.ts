import { describe, expect, it } from 'vitest'
import {
  boolean,
  datetime,
  enumOf,
  foreignKeysTo,
  integer,
  reference,
  registry,
  resolveFieldPath,
  table,
  tableDefSchema,
  text,
  toColumnName,
  uuid,
  yearMonth,
} from './table.js'

// docs/domain-model.md §5 のテーブルを一部抜き出したもの。
// 人工的な例ではなく実際のドメインで検証する。
const employee = table(
  'employee',
  {
    id: uuid().primaryKey(),
    name: text().required(),
    role: enumOf(['sales_rep', 'sales_manager', 'production', 'meo_operator', 'admin']).required(),
  },
  { global: true }, // 横断マスタ
)

const company = table('company', {
  id: uuid().primaryKey(),
  name: text().required(),
  ownerEmployeeId: reference('employee'),
})

const contact = table('contact', {
  id: uuid().primaryKey(),
  companyId: reference('company').required(),
  name: text().required(),
  isDecisionMaker: boolean().required(),
})

const deal = table('deal', {
  id: uuid().primaryKey(),
  companyId: reference('company').required(),
  initialBilling: integer().required(),
  expectedCloseMonth: yearMonth(),
  // deal ↔ contract は相互参照する。だから reference は文字列で受ける
  sourceContractId: reference('contract'),
  ownerEmployeeId: reference('employee').required(),
})

const activity = table('activity', {
  id: uuid().primaryKey(),
  companyId: reference('company').required(),
  dealId: reference('deal'),
  contactId: reference('contact'),
  completedAt: datetime(),
  ownerEmployeeId: reference('employee').required(),
})

const reg = registry(employee, company, contact, deal, activity)

describe('table', () => {
  it('フィールド定義を取り出す', () => {
    expect(deal.fields.initialBilling).toEqual({
      type: 'integer',
      required: true,
      primaryKey: false,
    })
  })

  it('primaryKey は required も立てる', () => {
    expect(deal.fields.id?.primaryKey).toBe(true)
    expect(deal.fields.id?.required).toBe(true)
  })

  it('global は既定で false、横断マスタだけ true', () => {
    expect(deal.global).toBe(false)
    expect(employee.global).toBe(true)
  })

  it('reference は参照先を保持する', () => {
    expect(deal.fields.companyId?.references).toBe('company')
  })

  it('ビルダーはイミュータブル（チェーンが元を壊さない）', () => {
    const base = integer()
    const req = base.required()
    expect(base.def.required).toBe(false)
    expect(req.def.required).toBe(true)
  })

  it('定義がスキーマを満たす', () => {
    for (const t of Object.values(reg)) {
      expect(tableDefSchema.safeParse(t).success).toBe(true)
    }
  })

  it('enum は values が無いと弾かれる', () => {
    const broken = { name: 'x', global: false, fields: { s: { type: 'enum', required: true, primaryKey: false } } }
    expect(tableDefSchema.safeParse(broken).success).toBe(false)
  })
})

describe('foreignKeysTo', () => {
  // docs/condition-ast.md §4: ちょうど1つのときだけ暗黙結合できる
  it('外部キーがちょうど1つなら暗黙結合できる', () => {
    expect(foreignKeysTo(activity, 'deal')).toEqual(['dealId'])
  })

  it('外部キーが無ければ空を返す（明示必須）', () => {
    // contact は deal を直接指していない。deal → company → contact と辿る必要がある
    expect(foreignKeysTo(contact, 'deal')).toEqual([])
  })

  it('外部キーが複数あれば全部返す（明示必須）', () => {
    // 同じテーブルを2つのフィールドが指す例。実ドメインには今のところ無いが、
    // 「作成者」と「担当者」のように後から生まれうる
    const task = table('task', {
      id: uuid().primaryKey(),
      createdByEmployeeId: reference('employee').required(),
      assignedEmployeeId: reference('employee'),
    })
    expect(foreignKeysTo(task, 'employee')).toEqual([
      'createdByEmployeeId',
      'assignedEmployeeId',
    ])
  })

  it('相互参照するテーブルも引ける', () => {
    expect(foreignKeysTo(deal, 'contract')).toEqual(['sourceContractId'])
  })
})

describe('resolveFieldPath', () => {
  it('自テーブルの列を解決する', () => {
    const resolved = resolveFieldPath(reg, 'deal', ['expectedCloseMonth'])
    expect(resolved?.field.type).toBe('yearMonth')
    expect(resolved?.tables).toEqual(['deal'])
  })

  // docs/domain-model.md §6-1「決裁者に会えている」で使う形。
  // path には外部キーのフィールド名（contactId）を書く。DSL の `a.contact` は
  // ビルダーがここへ展開する（docs/condition-ast.md §2-1）
  it('リレーションを辿る', () => {
    const resolved = resolveFieldPath(reg, 'activity', ['contactId', 'isDecisionMaker'])
    expect(resolved?.field.type).toBe('boolean')
    expect(resolved?.tables).toEqual(['activity', 'contact'])
  })

  it('2段辿る', () => {
    const resolved = resolveFieldPath(reg, 'activity', ['dealId', 'companyId'])
    expect(resolved?.tables).toEqual(['activity', 'deal'])
    expect(resolved?.field.references).toBe('company')
  })

  it('リレーション名では辿れない（フィールド名でなければならない）', () => {
    expect(resolveFieldPath(reg, 'activity', ['contact', 'isDecisionMaker'])).toBeUndefined()
  })

  it('存在しないフィールドは解決できない', () => {
    expect(resolveFieldPath(reg, 'deal', ['grossProfit'])).toBeUndefined()
  })

  it('外部キーでない列は辿れない', () => {
    // initialBilling は integer なので、その先に列は無い
    expect(resolveFieldPath(reg, 'deal', ['initialBilling', 'x'])).toBeUndefined()
  })

  it('未登録のテーブルは解決できない', () => {
    expect(resolveFieldPath(reg, 'unknown', ['id'])).toBeUndefined()
    // contract は registry に入れていない
    expect(resolveFieldPath(reg, 'deal', ['sourceContractId', 'id'])).toBeUndefined()
  })

  it('空のパスは解決できない', () => {
    expect(resolveFieldPath(reg, 'deal', [])).toBeUndefined()
  })
})

describe('toColumnName', () => {
  it('camelCase を snake_case にする', () => {
    expect(toColumnName('expectedCloseMonth')).toBe('expected_close_month')
    expect(toColumnName('id')).toBe('id')
    expect(toColumnName('ownerEmployeeId')).toBe('owner_employee_id')
  })
})
