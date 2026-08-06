/**
 * 営業フロー。docs/domain-model.md §6-1
 *
 * ステップは**買い手の状態変化**で定義する（docs/sales-domain.md §4-5）。
 * 「提案書を作った」は売り手の作業なのでステップにしない。SMB相手の即決型なので
 * 進行中のステップは3つに絞ってある。
 *
 * **出口条件の AST は直接書く。** 条件式ビルダー（`deal.amount.gt(0)`）は最小スコープでは
 * 作らない（docs/impl/phase-1-definitions.md）。読みにくいが動く。書き味の改善は
 * ブラウザで動くものを見てから決める。
 */
import {
  bind,
  check,
  flow,
  manualCheck,
  ROOT_SOURCE,
  step,
  type Pred,
  type RowFilter,
} from '@alt/dsl'
import { activity, company, contact, deal, employee } from '../tables/index.js'

// ---------------------------------------------------------------------------
// 出口条件の条件式
//
// 暗黙結合（docs/condition-ast.md §4）は TS 側で展開してから AST にする決まりなので、
// 結合条件はすべて明示的に書いてある。Go 側は結合ルールを知らなくてよい。
// ---------------------------------------------------------------------------

/** `activity` を評価対象の案件に結び付ける。activity → deal の外部キーは dealId ただ1つ。 */
const joinedToDeal = (alias: string): Pred => ({
  type: 'compare',
  op: 'eq',
  left: { type: 'field', source: alias, path: ['dealId'] },
  right: { type: 'field', source: ROOT_SOURCE, path: ['id'] },
})

/**
 * アポイントの予定がある。
 *
 * 未完了（`completedAt` が null）で予定日時が入った訪問・オンライン商談があること。
 * 未完了レコードが次アクションそのものなので、営業が別途フラグを立てる必要がない。
 */
const appointmentScheduled: Pred = {
  type: 'exists',
  table: 'activity',
  alias: 'a',
  where: {
    type: 'and',
    operands: [
      joinedToDeal('a'),
      {
        type: 'in',
        left: { type: 'field', source: 'a', path: ['type'] },
        values: ['visit', 'online_meeting'],
      },
      { type: 'isNotNull', operand: { type: 'field', source: 'a', path: ['scheduledAt'] } },
      { type: 'isNull', operand: { type: 'field', source: 'a', path: ['completedAt'] } },
    ],
  },
}

/**
 * 金額欄が埋まっている。
 *
 * ヒアリングの「予算感を確認した」と提案の「金額を提示した」は同じ式になる
 * （docs/condition-ast.md §6-1）。一時金と月額のどちらかでよいのは、
 * フロー型（求人広告の掲載定額）とストック型（MEO）で使う欄が違うため。
 */
const amountEntered: Pred = {
  type: 'or',
  operands: [
    {
      type: 'compare',
      op: 'gt',
      left: { type: 'field', source: ROOT_SOURCE, path: ['initialBilling'] },
      right: { type: 'literal', value: 0 },
    },
    {
      type: 'compare',
      op: 'gt',
      left: { type: 'field', source: ROOT_SOURCE, path: ['monthlyBilling'] },
      right: { type: 'literal', value: 0 },
    },
  ],
}

/**
 * 決裁者を特定した。
 *
 * `deal` から `contact` への直接の外部キーが無い（deal → company → contact）ので、
 * 暗黙結合できず結合条件を明示する（docs/condition-ast.md §4 の3つ目のケース）。
 */
const decisionMakerIdentified: Pred = {
  type: 'exists',
  table: 'contact',
  alias: 'c',
  where: {
    type: 'and',
    operands: [
      {
        type: 'compare',
        op: 'eq',
        left: { type: 'field', source: 'c', path: ['companyId'] },
        right: { type: 'field', source: ROOT_SOURCE, path: ['companyId'] },
      },
      {
        type: 'compare',
        op: 'eq',
        left: { type: 'field', source: 'c', path: ['isDecisionMaker'] },
        right: { type: 'literal', value: true },
      },
    ],
  },
}

/**
 * 決裁者に会えている。
 *
 * 「特定した」との違いは、完了済みの活動が決裁者に紐づいていること。
 * `['contactId', 'isDecisionMaker']` は activity → contact のリレーションを辿る
 * （path に書くのは外部キーのフィールド名そのもの。docs/condition-ast.md §2-1）。
 */
const decisionMakerMet: Pred = {
  type: 'exists',
  table: 'activity',
  alias: 'a',
  where: {
    type: 'and',
    operands: [
      joinedToDeal('a'),
      { type: 'isNotNull', operand: { type: 'field', source: 'a', path: ['completedAt'] } },
      {
        type: 'compare',
        op: 'eq',
        left: { type: 'field', source: 'a', path: ['contactId', 'isDecisionMaker'] },
        right: { type: 'literal', value: true },
      },
    ],
  },
}

/** 導入時期を確認した。 */
const closeMonthEntered: Pred = {
  type: 'isNotNull',
  operand: { type: 'field', source: ROOT_SOURCE, path: ['expectedCloseMonth'] },
}

// ---------------------------------------------------------------------------
// 行レベル認可
//
// 「読みは全員、書きは担当者＋管理者」（docs/product-concept.md §4-1）の担当者の部分。
// 管理者のバイパスはロールで効くのでここには書かない。バインド先のテーブルが
// ルートになるので、`source: 'root'` は deal / activity 自身を指す。
// ---------------------------------------------------------------------------

/** 自分が担当のレコードだけ書ける。 */
const ownedByCurrentUser: RowFilter = {
  write: {
    type: 'compare',
    op: 'eq',
    left: { type: 'field', source: ROOT_SOURCE, path: ['ownerEmployeeId'] },
    right: { type: 'context', name: 'currentUser.id' },
  },
}

// ---------------------------------------------------------------------------
// フロー
// ---------------------------------------------------------------------------

/** 商談相手のマスタ。この営業フローは読むだけで、維持は別（マスタ管理の置き場は未確定）。 */
const REFERENCE_TABLES = [company, contact, employee]
/** このフローが生成・更新するもの。 */
const OWNED_TABLES = [deal, activity]

/**
 * 決着ステップ。出口条件を持たない（出る先が無いので、出る条件も無い）。
 * `alt validate` の `step-without-exit` は `next` が空なら免除する
 * （docs/product-concept.md §8-1 フェーズ2）。
 *
 * ⚠ `deal.status` と値が1対1で重なっている。二重管理になりうる論点として
 * docs/product-concept.md §8-2 に記録した。
 */
const outcome = (key: string, name: string) =>
  step({ key, name, role: 'sales_rep', writes: [deal], exit: [], next: [] })

export const sales = flow({
  key: 'sales',
  name: '営業（新規開拓）',
  goal: '受注',
  // ステップを進む主体。出口条件 AST の `source: 'root'` が指すテーブルであり、
  // `_flow_state.table_name` に入る値でもある。primary バインド（所有）とは別の軸。
  target: deal,
  initial: 'contacted',

  steps: [
    step({
      key: 'contacted',
      name: '接触',
      role: 'sales_rep',
      reads: REFERENCE_TABLES,
      writes: OWNED_TABLES,
      exit: [check('appointment_scheduled', 'アポイントの予定がある', appointmentScheduled)],
      // 即決商談は qualified を飛ばして proposed に進む
      next: ['qualified', 'proposed', 'lost'],
    }),

    step({
      key: 'qualified',
      name: 'ヒアリング',
      role: 'sales_rep',
      reads: REFERENCE_TABLES,
      writes: OWNED_TABLES,
      exit: [
        manualCheck('problem_identified', '課題を確認した'),
        check('budget_confirmed', '予算感を確認した', amountEntered),
        check('decision_maker_identified', '決裁者を特定した', decisionMakerIdentified),
      ],
      next: ['proposed', 'suspended', 'lost'],
    }),

    step({
      key: 'proposed',
      name: '提案',
      role: 'sales_rep',
      reads: REFERENCE_TABLES,
      writes: OWNED_TABLES,
      exit: [
        check('amount_presented', '金額を提示した', amountEntered),
        check('decision_maker_met', '決裁者に会えている', decisionMakerMet),
        check('timing_confirmed', '導入時期を確認した', closeMonthEntered),
      ],
      // 「決裁者だと思っていた人が違った」で qualified に差し戻る
      next: ['won', 'qualified', 'lost', 'abandoned'],
    }),

    outcome('won', '受注'),
    outcome('lost', '失注'),
    outcome('abandoned', '消滅'),

    // 保留は決着ではない。先方都合で凍結しているだけなので追跡は続け、予測からは外す。
    // 決着ステップと違って戻り先があるので、出口条件（＝再開の判断）を持つ。
    // 「再開できる状況か」は先方の事情なので自動判定できず、手動チェックになる
    step({
      key: 'suspended',
      name: '保留',
      role: 'sales_rep',
      writes: [deal],
      exit: [manualCheck('resumable', '再開できる状況になった')],
      next: ['qualified'],
    }),
  ],

  // 使用テーブルと access は steps の reads/writes から導出される（product-concept.md §3-3）。
  // ここに書くのは導出できない role と purpose だけ。
  // employee は global: true なので宣言不要。実参照は導出の副産物として記録される（§3-4）。
  bindings: [
    bind(deal, 'primary', '営業の主対象。ヨミ管理と予測の元データ', {
      rowFilter: ownedByCurrentUser,
    }),
    bind(activity, 'primary', '接触記録と次アクション', { rowFilter: ownedByCurrentUser }),
    bind(company, 'reference', '商談相手の組織情報'),
    bind(contact, 'reference', '決裁者の特定と接触相手の記録'),
    // ※ store / contract は最小スコープでは定義していない（domain-model.md §6-1 では
    //    それぞれ reference バインド）。テーブルを足すときに合わせて宣言する
  ],
})
