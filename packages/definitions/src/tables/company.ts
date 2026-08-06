/**
 * 顧客企業。docs/domain-model.md §5
 *
 * enum の値は英語キー。DB に入り条件式 AST のリテラルになるものなので、
 * 表示ラベル（日本語）とは分ける。ラベルを直したときに既存データが
 * 孤児にならないようにするため（出口条件を明示キーで識別するのと同じ理由）。
 * フェーズ5からラベルも定義が持つ（EnumValue の label。§8-2 論点14 の解決）。
 */
import { enumOf, reference, table, text, uuid } from '@alt/dsl'

export const company = table(
  'company',
  {
    id: uuid('ID').primaryKey(),
    name: text('名称').required(),
    nameKana: text('名称カナ'),
    industry: enumOf('業種', [
      { key: 'restaurant', label: '飲食' },
      { key: 'beauty', label: '美容' },
      { key: 'medical', label: '医療' },
      { key: 'retail', label: '小売' },
      { key: 'other', label: 'その他' },
    ]),
    prefecture: text('都道府県'),
    city: text('市区町村'),
    address: text('住所'),
    phone: text('電話'),
    website: text('Webサイト'),
    leadSource: enumOf('流入経路', [
      { key: 'cold_call', label: 'テレアポ' },
      { key: 'web_form', label: 'フォーム' },
      { key: 'referral', label: '紹介' },
      { key: 'existing_upsell', label: '既存深耕' },
    ]),
    ownerEmployeeId: reference('employee', '担当'),
    status: enumOf('状態', [
      { key: 'prospect', label: '見込み' },
      { key: 'active', label: '取引中' },
      { key: 'dormant', label: '休眠' },
      { key: 'churned', label: '解約済' },
    ]).required(),
    note: text('備考'),
  },
  { label: '顧客企業' },
)

// ※ 店舗（store）は最小スコープに入れていない。チェーン店顧客の有無が未確認で、
//    顧客の粒度（企業/店舗の分離が必要か）自体がヒアリング項目のため。
