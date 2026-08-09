/**
 * ロール宣言。docs/domain-model.md §7
 *
 * ここに書くのは**ロールが存在すること**だけ。何ができるかは業務フロー定義の
 * ステップの `role` から導出する（docs/product-concept.md §4-1）。
 * ユーザーへの割当は定義ではなくデータ（`employee.role`）。
 */
import { role, type EnumValue } from '@alt/dsl'

export const roles = [
  role('sales_rep', '営業担当', '案件の作成・更新、活動記録'),
  // ⚠ 「閲覧・編集」と書いてあったが、確定事項は「書きは担当者＋管理者」
  // （docs/product-concept.md §4-1）。マネージャーは担当者ではないので編集できない。
  // 営業フローには `viewers` として参加する（閲覧のみ）。定義とコードの食い違いを
  // 残さないため、説明文のほうを実態に合わせた（docs/impl/phase-8-authz-participation.md 論点C）。
  role('sales_manager', '営業マネージャー', '全案件の閲覧、目標設定'),
  role('production', '制作担当', '求人広告の原稿作成・入稿'),
  role('meo_operator', 'MEO運用担当', '初期設定・運用・レポート'),
  role('admin', '管理者', 'マスタ管理、強制遷移、全権限'),
]

/**
 * 全ロールのキー。**「このステップは全員が操作する」を導出で書くため**にある
 * （docs/impl/phase-8-authz-participation.md 決定F）。
 *
 * `step({ roles: ROLE_KEYS })` と書けば、ロールを足したときに書き足し忘れが起きない。
 * 列挙してしまうと、新しいロールの人だけ静かに操作できなくなる。
 */
export const ROLE_KEYS: readonly string[] = roles.map((r) => r.key)

/**
 * `employee.role` の enum 候補。宣言から導くので、ロールを足したときに
 * マスタ側の候補（キーもラベルも）を書き足し忘れることがない。
 *
 * ※ テレアポ専任がいる場合は `inside_sales` を追加する（ヒアリング項目）。
 */
export const ROLE_VALUES: readonly EnumValue[] = roles.map((r) => ({
  key: r.key,
  label: r.name,
}))
