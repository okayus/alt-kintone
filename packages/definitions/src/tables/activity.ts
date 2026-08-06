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

export const activity = table(
  'activity',
  {
    id: uuid('ID').primaryKey(),
    companyId: reference('company', '顧客企業').required(),
    dealId: reference('deal', '案件'),
    contactId: reference('contact', '先方担当者'),
    type: enumOf('種別', [
      { key: 'call', label: '架電' },
      { key: 'visit', label: '訪問' },
      { key: 'online_meeting', label: 'オンライン商談' },
      { key: 'email', label: 'メール' },
      { key: 'other', label: 'その他' },
    ]).required(),
    /** 何をするか。次アクションの「何を」。 */
    subject: text('件名').required(),
    scheduledAt: datetime('予定日時'),
    completedAt: datetime('実施日時'),
    ownerEmployeeId: reference('employee', '担当').required(),
    result: enumOf('結果', [
      { key: 'connected', label: '接続' },
      { key: 'no_answer', label: '不在' },
      { key: 'appointment', label: 'アポ獲得' },
      { key: 'advanced', label: '前進' },
      { key: 'won', label: '受注' },
      { key: 'lost', label: '失注' },
      { key: 'other', label: 'その他' },
    ]),
    note: text('内容メモ'),
  },
  { label: '活動' },
)

// ※ contractId は contract テーブルが未定義のため最小スコープでは持たない。
