import { describe, expect, it } from 'vitest'
import {
  boolean,
  createdAt,
  datetime,
  definitionRef,
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
    id: uuid('ID').primaryKey(),
    name: text('氏名').required(),
    role: enumOf('ロール', [
      { key: 'sales_rep', label: '営業担当' },
      { key: 'sales_manager', label: '営業マネージャー' },
      { key: 'production', label: '制作担当' },
      { key: 'meo_operator', label: 'MEO運用担当' },
      { key: 'admin', label: '管理者' },
    ]).required(),
  },
  { label: '従業員', global: true }, // 横断マスタ
)

const company = table(
  'company',
  {
    id: uuid('ID').primaryKey(),
    name: text('名称').required(),
    ownerEmployeeId: reference('employee', '担当'),
  },
  { label: '顧客企業' },
)

const contact = table(
  'contact',
  {
    id: uuid('ID').primaryKey(),
    companyId: reference('company', '顧客企業').required(),
    name: text('氏名').required(),
    isDecisionMaker: boolean('決裁権').required(),
  },
  { label: '先方担当者' },
)

const deal = table(
  'deal',
  {
    id: uuid('ID').primaryKey(),
    companyId: reference('company', '顧客企業').required(),
    initialBilling: integer('一時金・請求額').required(),
    expectedCloseMonth: yearMonth('見込み受注月'),
    // deal ↔ contract は相互参照する。だから reference は文字列で受ける
    sourceContractId: reference('contract', '元契約'),
    ownerEmployeeId: reference('employee', '担当').required(),
  },
  { label: '案件' },
)

const activity = table(
  'activity',
  {
    id: uuid('ID').primaryKey(),
    companyId: reference('company', '顧客企業').required(),
    dealId: reference('deal', '案件'),
    contactId: reference('contact', '先方担当者'),
    completedAt: datetime('実施日時'),
    ownerEmployeeId: reference('employee', '担当').required(),
  },
  { label: '活動' },
)

const reg = registry(employee, company, contact, deal, activity)

describe('table', () => {
  it('フィールド定義を取り出す', () => {
    expect(deal.fields.initialBilling).toEqual({
      type: 'integer',
      label: '一時金・請求額',
      required: true,
      primaryKey: false,
    })
  })

  it('テーブルとフィールドの表示名が定義に載る（§8-2 論点14）', () => {
    expect(deal.label).toBe('案件')
    expect(contact.fields.isDecisionMaker?.label).toBe('決裁権')
  })

  it('enum は key と label を持ち、宣言順を保つ', () => {
    expect(employee.fields.role?.values?.map((v) => v.key)).toEqual([
      'sales_rep',
      'sales_manager',
      'production',
      'meo_operator',
      'admin',
    ])
    expect(employee.fields.role?.values?.[0]).toEqual({ key: 'sales_rep', label: '営業担当' })
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
    const base = integer('金額')
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
    const broken = {
      name: 'x',
      label: 'X',
      global: false,
      fields: { s: { type: 'enum', label: 'S', required: true, primaryKey: false } },
    }
    expect(tableDefSchema.safeParse(broken).success).toBe(false)
  })

  it('enum の値（key）が重複していたら弾かれる', () => {
    const broken = {
      name: 'x',
      label: 'X',
      global: false,
      fields: {
        s: {
          type: 'enum',
          label: 'S',
          required: true,
          primaryKey: false,
          values: [
            { key: 'a', label: 'あ' },
            { key: 'a', label: '亜' },
          ],
        },
      },
    }
    expect(tableDefSchema.safeParse(broken).success).toBe(false)
  })

  it('ラベルが空だと弾かれる（省略可にすると画面に英語キーが漏れる）', () => {
    const broken = {
      name: 'x',
      label: '',
      global: false,
      fields: {},
    }
    expect(tableDefSchema.safeParse(broken).success).toBe(false)
  })
})

// docs/impl/phase-9-change-requests.md §7-1。改善要望が「営業フローの提案ステップ」を
// 指せるようにするための2つ。どちらも **FIELD_TYPES を増やさない** のが要点で、
// reference() が外部キーを新しい型ではなく references で表しているのと同じ形にしてある。
describe('definitionRef / createdAt', () => {
  const changeRequest = table(
    'change_request',
    {
      id: uuid('ID').primaryKey(),
      targetFlow: definitionRef('flow', '対象の業務フロー'),
      targetStep: definitionRef('step', '対象のステップ'),
      filedAt: createdAt('起票日時'),
    },
    { label: '改善要望' },
  )

  it('definitionRef は text で、参照の種類を持つ', () => {
    expect(changeRequest.fields.targetFlow).toEqual({
      type: 'text',
      label: '対象の業務フロー',
      required: false,
      primaryKey: false,
      definitionRef: 'flow',
    })
  })

  it('createdAt は datetime・必須で、サーバが埋める印を持つ', () => {
    expect(changeRequest.fields.filedAt).toEqual({
      type: 'datetime',
      label: '起票日時',
      required: true,
      primaryKey: false,
      fill: 'createdAt',
    })
  })

  it('定義がスキーマを満たす', () => {
    expect(tableDefSchema.safeParse(changeRequest).success).toBe(true)
  })

  it('definitionRef が text 以外に付いていたら弾かれる', () => {
    const broken = {
      name: 'x',
      label: 'X',
      global: false,
      fields: {
        f: {
          type: 'integer',
          label: 'F',
          required: false,
          primaryKey: false,
          definitionRef: 'flow',
        },
      },
    }
    expect(tableDefSchema.safeParse(broken).success).toBe(false)
  })

  it('fill が datetime 以外に付いていたら弾かれる', () => {
    const broken = {
      name: 'x',
      label: 'X',
      global: false,
      fields: {
        f: { type: 'text', label: 'F', required: true, primaryKey: false, fill: 'createdAt' },
      },
    }
    expect(tableDefSchema.safeParse(broken).success).toBe(false)
  })

  it('未知の kind は弾かれる', () => {
    const broken = {
      name: 'x',
      label: 'X',
      global: false,
      fields: {
        f: {
          type: 'text',
          label: 'F',
          required: false,
          primaryKey: false,
          definitionRef: 'screen',
        },
      },
    }
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
    const task = table(
      'task',
      {
        id: uuid('ID').primaryKey(),
        createdByEmployeeId: reference('employee', '作成者').required(),
        assignedEmployeeId: reference('employee', '担当者'),
      },
      { label: 'タスク' },
    )
    expect(foreignKeysTo(task, 'employee')).toEqual(['createdByEmployeeId', 'assignedEmployeeId'])
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
