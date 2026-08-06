/**
 * 先方担当者。docs/domain-model.md §5
 *
 * `isDecisionMaker` は営業フローの出口条件「決裁者を特定した」「決裁者に会えている」の
 * 自動判定に使う（§6-1）。営業の入力負担を増やさずに判定できる典型例。
 */
import { boolean, reference, table, text, uuid } from '@alt/dsl'

export const contact = table(
  'contact',
  {
    id: uuid('ID').primaryKey(),
    companyId: reference('company', '顧客企業').required(),
    name: text('氏名').required(),
    title: text('役職'),
    phone: text('電話'),
    email: text('メール'),
    isDecisionMaker: boolean('決裁権').required(),
    note: text('備考'),
  },
  { label: '先方担当者' },
)
