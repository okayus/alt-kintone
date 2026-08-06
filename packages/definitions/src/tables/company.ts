/**
 * 顧客企業。docs/domain-model.md §5
 *
 * enum の値は英語キー。DB に入り条件式 AST のリテラルになるものなので、
 * 表示ラベル（日本語）とは分ける。ラベルを直したときに既存データが
 * 孤児にならないようにするため（出口条件を明示キーで識別するのと同じ理由）。
 * ラベル対応は docs/domain-model.md §5 の表を参照。
 */
import { enumOf, reference, table, text, uuid } from '@alt/dsl'

export const company = table('company', {
  id: uuid().primaryKey(),
  name: text().required(),
  nameKana: text(),
  // restaurant 飲食 / beauty 美容 / medical 医療 / retail 小売 / other その他
  industry: enumOf(['restaurant', 'beauty', 'medical', 'retail', 'other']),
  prefecture: text(),
  city: text(),
  address: text(),
  phone: text(),
  website: text(),
  // cold_call テレアポ / web_form フォーム / referral 紹介 / existing_upsell 既存深耕
  leadSource: enumOf(['cold_call', 'web_form', 'referral', 'existing_upsell']),
  ownerEmployeeId: reference('employee'),
  // prospect 見込み / active 取引中 / dormant 休眠 / churned 解約済
  status: enumOf(['prospect', 'active', 'dormant', 'churned']).required(),
  note: text(),
})

// ※ 店舗（store）は最小スコープに入れていない。チェーン店顧客の有無が未確認で、
//    顧客の粒度（企業/店舗の分離が必要か）自体がヒアリング項目のため。
