/**
 * 社内従業員【横断マスタ】。docs/domain-model.md §5
 *
 * `global: true` を宣言しているので明示バインドは不要で、実参照は
 * ステップの reads/writes から自動記録される（docs/product-concept.md §3-4 の案C）。
 */
import { enumOf, table, text, uuid } from '@alt/dsl'
import { ROLE_VALUES } from '../roles.js'

export const employee = table(
  'employee',
  {
    id: uuid('ID').primaryKey(),
    name: text('氏名').required(),
    email: text('メール').required(),
    /** 担当ロール。候補もラベルも roles.ts の宣言から導く。 */
    role: enumOf('ロール', ROLE_VALUES).required(),
    /** 目標（quota）をチーム単位で置くときに使う。 */
    team: text('所属チーム'),
    status: enumOf('状態', [
      { key: 'active', label: '在籍' },
      { key: 'retired', label: '退職' },
    ]).required(),
  },
  { label: '従業員', global: true },
)

// ※ 認証は外部IdPに委譲する（docs/product-concept.md §8-1）が、プロトタイプでは
//    実装しないので IdP の subject 識別子はまだ持たない。認証を入れる時点で足す。
