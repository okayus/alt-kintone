/**
 * 活動（予定と実績）。docs/domain-model.md §5、docs/sales-domain.md §8
 *
 * **未完了レコード（`completedAt` が null で `scheduledAt` がある）が次アクション**。
 * 案件属性として「次回アクション日」を持つ方式をやめたので、「いつ・誰が・何を」の
 * 3点が揃い、履歴が残り、予定と実績を同じエンティティで扱える。
 *
 * 営業フローの出口条件「アポイントの予定がある」「決裁者に会えている」は
 * どちらもこのテーブルの exists で判定する（§6-1）。
 */
import { datetime, enumOf, reference, table, text, uuid } from '@alt/dsl'

export const activity = table('activity', {
  id: uuid().primaryKey(),
  companyId: reference('company').required(),
  dealId: reference('deal'),
  contactId: reference('contact'),
  // call 架電 / visit 訪問 / online_meeting オンライン商談 / email メール / other その他
  type: enumOf(['call', 'visit', 'online_meeting', 'email', 'other']).required(),
  /** 件名・何をするか。次アクションの「何を」。 */
  subject: text().required(),
  scheduledAt: datetime(),
  completedAt: datetime(),
  ownerEmployeeId: reference('employee').required(),
  // connected 接続 / no_answer 不在 / appointment アポ獲得 / advanced 前進 /
  // won 受注 / lost 失注 / other その他
  result: enumOf(['connected', 'no_answer', 'appointment', 'advanced', 'won', 'lost', 'other']),
  note: text(),
})

// ※ contractId は contract テーブルが未定義のため最小スコープでは持たない。
