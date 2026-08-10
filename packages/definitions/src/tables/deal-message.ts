/**
 * 案件をめぐる社内のやりとり。docs/impl/phase-11-chat.md 決定B
 *
 * **役割は「案件をめぐる社内のやりとり（相談・指示・引き継ぎ）を、案件に紐づけて残す場」**
 * ＝ kintone のレコードコメント欄の代替。顧客はこの系のユーザーではないので、
 * 顧客とのやりとりは載らない — **それは活動（`activity`）の記録**（論点F）。
 *
 * ⚠ この区別は言葉でしか支えられていない。チャットができると接触の報告がこちらに
 * 流れ、`activity` が書かれなくなる方向の圧力がある。そうなると出口条件の自動判定
 * （アポイントの予定がある・決裁者に会えている）が充足しなくなり、
 * **「データを直すと勝手に充足に変わる」という中核価値が痩せる**。
 * v1 の手当は言葉の区別まで（画面でも別区画にする）。
 *
 * 形は `change_request_message` と**意図的に同じ**（論点G の G1）。プラットフォームの
 * コメント機構（全テーブルに生える `_comment`）にしないのは、2本目はまだ
 * 「業務テーブルでは足りない」ではなく「繰り返し」だから。形を揃えておくこと自体が、
 * 3本目が来たときに平台化するかどうかの判断材料になる。
 */
import { createdAt, enumOf, reference, table, text, uuid } from '@alt/dsl'

export const dealMessage = table(
  'deal_message',
  {
    id: uuid('ID').primaryKey(),
    dealId: reference('deal', '案件').required(),
    authorEmployeeId: reference('employee', '投稿者').required(),
    body: text('本文').required(),
    /** サーバが埋める。これが無いと追記を時系列に並べられない（フェーズ9 決定G）。 */
    postedAt: createdAt('投稿日時'),
    /**
     * 書き手の種類。**AI を当事者に入れるのは v1 ではやらないが、場所だけ空けておく**
     * （フェーズ9 論点K）。列1つのコストで、入れるときの移行が要らなくなる。
     */
    authorKind: enumOf('書き手', [
      { key: 'human', label: '人' },
      { key: 'ai', label: 'AI' },
    ]).required(),
  },
  { label: '案件のやりとり' },
)
