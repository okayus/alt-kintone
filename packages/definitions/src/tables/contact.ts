/**
 * 先方担当者。docs/domain-model.md §5
 *
 * `isDecisionMaker` は営業フローの出口条件「決裁者を特定した」「決裁者に会えている」の
 * 自動判定に使う（§6-1）。営業の入力負担を増やさずに判定できる典型例。
 */
import { boolean, reference, table, text, uuid } from '@alt/dsl'

export const contact = table('contact', {
  id: uuid().primaryKey(),
  companyId: reference('company').required(),
  name: text().required(),
  /** 役職。 */
  title: text(),
  phone: text(),
  email: text(),
  isDecisionMaker: boolean().required(),
  note: text(),
})
