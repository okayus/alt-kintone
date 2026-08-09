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
const outcome = (key: string, name: string, intent: string) =>
  step({ key, name, intent, roles: ['sales_rep'], writes: [deal], exit: [], next: [] })

export const sales = flow({
  key: 'sales',
  name: '営業（新規開拓）',
  goal: '受注',
  // ステップを進む主体。出口条件 AST の `source: 'root'` が指すテーブルであり、
  // `_flow_state.table_name` に入る値でもある。primary バインド（所有）とは別の軸。
  target: deal,
  initial: 'contacted',

  // 操作はしないが全案件を読む立場。ヨミ会・予測のために見る場所であって、
  // 直すのは担当者（確定事項「書きは担当者＋管理者」）。これが無いと
  // マネージャーは案件を1件も読めない（§8-2 論点12 / phase-8 論点A）。
  viewers: ['sales_manager'],

  // intent（この段階で目指すこと）は sales-domain.md §4-5 の原則
  // 「ステージは買い手の状態変化で定義する」を、定義そのものに残す場所。
  // howTo（充足のしかた）は営業が画面で読む説明文。条件式を変えたら直すこと
  // — ズレは画面の「見ているデータ」（AST からの機械抽出）との食い違いで見える。
  steps: [
    step({
      key: 'contacted',
      name: '接触',
      intent:
        '買い手が話を聞く気になった状態にする。接触の回数ではなく、次の商談の約束が取れたかで判定する',
      roles: ['sales_rep'],
      reads: REFERENCE_TABLES,
      writes: OWNED_TABLES,
      exit: [
        check(
          'appointment_scheduled',
          'アポイントの予定がある',
          '活動に、予定日時が入った未実施の「訪問」か「オンライン商談」を登録すると充足する',
          appointmentScheduled,
        ),
      ],
      // 即決商談は qualified を飛ばして proposed に進む
      next: ['qualified', 'proposed', 'lost'],
    }),

    step({
      key: 'qualified',
      name: 'ヒアリング',
      intent:
        '買い手が自分の課題を言語化できている状態にする。売り手が資料を作ったかではなく、買い手の状態で判定する',
      roles: ['sales_rep'],
      reads: REFERENCE_TABLES,
      writes: OWNED_TABLES,
      exit: [
        manualCheck(
          'problem_identified',
          '課題を確認した',
          '先方が自分の言葉で困っていることを説明できたら ✓。こちらが推測した課題では立てない',
        ),
        check(
          'budget_confirmed',
          '予算感を確認した',
          '案件の「一時金・請求額」か「月額・請求額」のどちらかに金額を入れると充足する',
          amountEntered,
        ),
        check(
          'decision_maker_identified',
          '決裁者を特定した',
          '先方担当者に「決裁権」ありの人を登録すると充足する',
          decisionMakerIdentified,
        ),
      ],
      next: ['proposed', 'suspended', 'lost'],
    }),

    step({
      key: 'proposed',
      name: '提案',
      intent:
        '買い手が自社案を前提に検討している状態にする。金額・時期・決裁者の3点が揃っているかで判定する',
      roles: ['sales_rep'],
      reads: REFERENCE_TABLES,
      writes: OWNED_TABLES,
      exit: [
        check(
          'amount_presented',
          '金額を提示した',
          '案件の「一時金・請求額」か「月額・請求額」に提示した金額を入れると充足する',
          amountEntered,
        ),
        check(
          'decision_maker_met',
          '決裁者に会えている',
          '「決裁権」ありの先方担当者を相手にした実施済みの活動を記録すると充足する',
          decisionMakerMet,
        ),
        check(
          'timing_confirmed',
          '導入時期を確認した',
          '案件の「見込み受注月」を入れると充足する',
          closeMonthEntered,
        ),
      ],
      // 「決裁者だと思っていた人が違った」で qualified に差し戻る
      next: ['won', 'qualified', 'lost', 'abandoned'],
    }),

    outcome('won', '受注', '買い手が発注を決めた。ここで営業は終わり、制作・運用の工程へ引き継ぐ'),
    outcome(
      'lost',
      '失注',
      '買い手が他社か別の解決策を選んだ。理由と競合先を記録して、次の提案の材料にする',
    ),
    outcome(
      'abandoned',
      '消滅',
      '買い手が何も決めないまま立ち消えた（No Decision）。課題の切迫度を見誤った兆候として記録する',
    ),

    // 保留は決着ではない。先方都合で凍結しているだけなので追跡は続け、予測からは外す。
    // 決着ステップと違って戻り先があるので、出口条件（＝再開の判断）を持つ。
    // 「再開できる状況か」は先方の事情なので自動判定できず、手動チェックになる
    step({
      key: 'suspended',
      name: '保留',
      intent: '先方都合の凍結。追跡は続けるが、ヨミ（予測）からは外す',
      roles: ['sales_rep'],
      writes: [deal],
      exit: [
        manualCheck(
          'resumable',
          '再開できる状況になった',
          '凍結の理由（予算時期・担当交代など）が解消したと先方に確認できたら ✓。こちらの都合では立てない',
        ),
      ],
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
