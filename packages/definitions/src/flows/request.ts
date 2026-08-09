/**
 * 改善要望・障害報告のフロー。docs/impl/phase-9-change-requests.md §7-2
 *
 * **2本目の業務フロー**であり、**開発の業務そのものをこの基盤に載せたもの**（論点A 案1）。
 * 客先から見れば社内業務が1本増えるだけで、概念の濫用ではない — スクショを撮って
 * Slack に投げる運用も業務フローの一種だった（§2-5）。
 *
 * 営業フローと違うところが2つある。どちらもフェーズ8 で書けるようになったもの:
 *
 *  1. **起票は全社員がする**ので、担当ロールが `ROLE_KEYS`（導出。列挙しない）
 *  2. **対応者は管理者**（決定J）。開発者ロールを作らない — 「開発者は客先の従業員では
 *     ない」に踏み込むと §8-2 論点13 に触れるので、必要が確認されるまで開けない
 *
 * ⚠ `roles: ROLE_KEYS` でも**誰でも他人の要望を進められるわけではない**。
 * `advance` は行レベル認可（`update`）も要求するので、進められるのは起票者本人と管理者だけ
 * （`packages/server/src/authz.ts` の `permissionsOf`）。
 */
import {
  bind,
  check,
  flow,
  manualCheck,
  ROOT_SOURCE,
  step,
  type ExitCondition,
  type Pred,
  type RowFilter,
} from '@alt/dsl'
import { ROLE_KEYS } from '../roles.js'
import {
  changeRequest,
  changeRequestMessage,
  changeRequestRead,
  employee,
} from '../tables/index.js'

// ---------------------------------------------------------------------------
// 出口条件の条件式
// ---------------------------------------------------------------------------

/**
 * 対象が指定されている。
 *
 * 起票時に画面から自動で入る（論点D）ので、**普通は何もしなくても充足している**。
 * 空なのは「一覧から漠然と出した」場合で、そのとき対象を聞き返す根拠になる。
 */
const targetSpecified: Pred = {
  type: 'isNotNull',
  operand: { type: 'field', source: ROOT_SOURCE, path: ['targetFlow'] },
}

/** 対応者が決まっている。 */
const assigneeSet: Pred = {
  type: 'isNotNull',
  operand: { type: 'field', source: ROOT_SOURCE, path: ['assigneeEmployeeId'] },
}

/**
 * 起票者に返信した。
 *
 * **営業フローの「アポイントの予定がある」と同じ形**（追記テーブルの exists）。
 * 起票者以外が1件でも書き込めば充足するので、**返信を書いた瞬間にチェックが変わる**
 * — 「データを直すと自動判定が勝手に充足に変わる」（構想の中核）が、
 * 2本目のフローでも働くことの検証を兼ねている。
 */
const repliedToReporter: Pred = {
  type: 'exists',
  table: 'change_request_message',
  alias: 'm',
  where: {
    type: 'and',
    operands: [
      {
        type: 'compare',
        op: 'eq',
        left: { type: 'field', source: 'm', path: ['requestId'] },
        right: { type: 'field', source: ROOT_SOURCE, path: ['id'] },
      },
      {
        type: 'compare',
        op: 'ne',
        left: { type: 'field', source: 'm', path: ['authorEmployeeId'] },
        right: { type: 'field', source: ROOT_SOURCE, path: ['reporterEmployeeId'] },
      },
    ],
  },
}

/** 何をどう変えた（変えない）かが書かれている。 */
const resolutionWritten: Pred = {
  type: 'isNotNull',
  operand: { type: 'field', source: ROOT_SOURCE, path: ['resolution'] },
}

// ---------------------------------------------------------------------------
// 行レベル認可
//
// 「読みは全員、書きは担当者＋管理者」（docs/product-concept.md §4-1）。
// 要望における「担当者」は**起票者**で、対応側は管理者としてバイパスする（決定J）。
// ---------------------------------------------------------------------------

const ownedBy = (field: string): RowFilter => ({
  write: {
    type: 'compare',
    op: 'eq',
    left: { type: 'field', source: ROOT_SOURCE, path: [field] },
    right: { type: 'context', name: 'currentUser.id' },
  },
})

// ---------------------------------------------------------------------------
// フロー
// ---------------------------------------------------------------------------

/** どのステップでも読み書きするもの。要望・やりとり・既読は常にセットで動く。 */
const OWNED_TABLES = [changeRequest, changeRequestMessage, changeRequestRead]

/**
 * 全社員が操作するステップの担当ロール。
 *
 * ⚠ **展開して渡す。** `ROLE_KEYS` は `readonly string[]` で、`StepSpec.roles` は
 * `string[]`（定義は最終的にただの JSON なので、DSL 側は可変配列のまま持っている）。
 * フェーズ8 決定F は `roles: ROLE_KEYS` と書けると想定していたが、実際は型が通らない
 * — 初めて使ったのがここなので、いま分かった。導出であることは変わらない
 * （ロールを足せば自動で伸びる）ので、`[...]` を足すだけにしてある。
 */
const everyRole = (): string[] => [...ROLE_KEYS]

/**
 * 対応側のステップ。担当は管理者だけで、遷移先が違うだけの形が3つあるのでまとめる。
 */
const handling = (
  key: string,
  name: string,
  intent: string,
  exit: ExitCondition[],
  next: string[],
) =>
  step({ key, name, intent, roles: ['admin'], reads: [employee], writes: OWNED_TABLES, exit, next })

export const request = flow({
  key: 'request',
  name: '改善要望・障害報告',
  goal: '困りごとが解消され、起票者がそれを確認している状態',
  target: changeRequest,
  initial: 'filed',

  // viewers は要らない。起票ステップの担当が ROLE_KEYS なので**全員が operator**になる
  // （＝ 全員が読める）。「操作しないが見る」立場がこのフローには存在しない

  steps: [
    step({
      key: 'filed',
      name: '起票',
      intent:
        '困っていることが、対応者が読んで分かる形になっている状態にする。解決策ではなく困りごとを書く段階',
      // 全社員が起票する。列挙するとロールを足したときに書き漏れる（フェーズ8 決定F）
      roles: everyRole(),
      reads: [employee],
      writes: OWNED_TABLES,
      exit: [
        check(
          'target_specified',
          '対象が指定されている',
          '画面から起票すれば自動で入る。入っていなければ「対象の業務フロー」を選ぶ',
          targetSpecified,
        ),
        manualCheck(
          'reproduction_written',
          '壊れているなら、何をしてどうなったかが書いてある',
          '種類が「壊れている（障害）」のときだけ。何をしたか・どうなると思ったか・実際どうなったかが本文にあれば ✓。障害でなければ ✓ にしてよい',
        ),
      ],
      next: ['triaged', 'declined'],
    }),

    handling(
      'triaged',
      '受付',
      '何をどう変えるかの見当がつき、起票者がそれを知っている状態にする',
      [
        check(
          'assignee_set',
          '対応者が決まっている',
          '要望の「対応者」に担当を入れると充足する',
          assigneeSet,
        ),
        check(
          'replied',
          '起票者に返信した',
          'やりとりに、起票者以外の書き込みが1件でもあると充足する',
          repliedToReporter,
        ),
      ],
      // 書かれていることが足りなければ起票へ差し戻す
      ['in_progress', 'filed', 'declined'],
    ),

    handling(
      'in_progress',
      '対応中',
      '定義の変更が本番に適用され、画面で確かめられる状態にする',
      [
        check(
          'resolution_written',
          '何を変えたかが書いてある',
          '要望の「対応の内容」に、変えた定義と結果を書くと充足する',
          resolutionWritten,
        ),
        manualCheck(
          'definition_changed',
          '定義を変更して適用した',
          'alt apply まで済んで、実際の画面に出ていたら ✓。作業ブランチの段階では立てない',
        ),
      ],
      ['applied', 'triaged'],
    ),

    step({
      key: 'applied',
      name: '適用済',
      intent:
        '起票者が自分の仕事の中で解決を確かめている状態にする。開発側の自己判定で終わらせない',
      // 確認するのは起票者なので、ここも全ロールが操作する
      roles: everyRole(),
      reads: [employee],
      writes: OWNED_TABLES,
      exit: [
        manualCheck(
          'confirmed_by_reporter',
          '起票者が解決を確認した',
          '起票者が実際の業務で使ってみて、困りごとが消えていたら ✓。画面を見ただけでは立てない',
        ),
      ],
      // 直っていなければ対応中へ戻る
      next: ['closed', 'in_progress'],
    }),

    handling('closed', '完了', '困りごとが解消され、起票者が確認した。ここで終わり', [], []),
    handling(
      'declined',
      '見送り',
      '今回は変えないと決めた。理由が起票者に伝わっていることが条件で、放置とは違う',
      [],
      [],
    ),
  ],

  bindings: [
    bind(changeRequest, 'primary', '要望そのもの。対象と困りごとの記録', {
      rowFilter: ownedBy('reporterEmployeeId'),
    }),
    bind(changeRequestMessage, 'primary', '起票後のやりとり。内容の宣言性をここで詰める', {
      rowFilter: ownedBy('authorEmployeeId'),
    }),
    bind(changeRequestRead, 'primary', '未読の基準（ユーザー × 要望 × 最終閲覧）', {
      rowFilter: ownedBy('employeeId'),
    }),
    // employee は global: true なので宣言不要。実参照は導出の副産物として記録される
  ],
})
