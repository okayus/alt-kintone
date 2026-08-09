/**
 * 改善要望・障害報告。docs/impl/phase-9-change-requests.md
 *
 * **開発の業務そのものを alt-kintone の定義として書く**（論点A 案1）。
 * 「業務フローが第一級」という主張が正しいなら、開発への要望も業務フロー1本として
 * 載るはずで、載らないなら主張のほうが間違っている — という自己適用の実験でもある。
 *
 * 置き換えているのは「アプリ画面のスクショに赤ペンで注釈して渡す」運用（§0-1）。
 * スクショが運んでいた「どの画面か」「どの部品か」は**アプリが機械で添え**（論点D）、
 * 対象は**定義の語彙で指す**（`definitionRef`。§2-2 の「参照の宣言性」）。
 *
 * 3本まとめてあるのは1つのかたまりだから: 要望（フローの target）と、
 * それにぶら下がる追記（メッセージ）と、未読の基準（既読）。
 */
import {
  createdAt,
  datetime,
  definitionRef,
  enumOf,
  json,
  reference,
  table,
  text,
  uuid,
} from '@alt/dsl'

/**
 * 要望1件。`request` フローの target。
 *
 * ⚠ **`status` 列を持たない。** 状態は `_flow_state` のステップだけ
 * （docs/impl/phase-9-change-requests.md 決定F）。営業フローで
 * `deal.status` とステップが二重管理になった（§8-2 論点9）のを、知っていて繰り返さない。
 *
 * ⚠ **件名も持たない。** 必須入力を「困りごと1つ」に保つため（完了条件1）。
 * 一覧には `problem` の先頭を出す。
 */
export const changeRequest = table(
  'change_request',
  {
    id: uuid('ID').primaryKey(),

    // 種類は「開発者向けの分類」ではなく**次の問いを変えるためのもの**（§0-2 論点C）。
    // 文言が起票者向けなのはそのため
    kind: enumOf('種類', [
      { key: 'cannot_record', label: '記録したいことが記録できない' },
      { key: 'field_unclear', label: '項目が分かりにくい・要らない' },
      { key: 'steps_mismatch', label: '仕事の段取りと画面が合っていない' },
      { key: 'exit_mismatch', label: '次に進む条件が実態と合わない' },
      { key: 'ui_friction', label: '見え方・操作を変えたい' },
      { key: 'new_business', label: '新しい業務を載せたい' },
      { key: 'defect', label: '壊れている（障害）' },
      { key: 'other', label: 'その他' },
    ]).required(),

    /**
     * **唯一の必須自由文**。「どうしてほしいか」ではなく「何ができなくて困っているか」を
     * 訊く（§2-1 の ⑤ が押し出されないようにするため）。
     */
    problem: text('いま何ができなくて困っているか').required(),
    /** 任意。訊けば手段で書かれるので、必須にしない（§2-2 の「内容の宣言性は強制できない」）。 */
    wish: text('どうしてほしいか'),

    // --- 参照の宣言性（§2-2）。全部任意で、画面から自動で入る（決定E） ---
    targetFlow: definitionRef('flow', '対象の業務フロー'),
    targetStep: definitionRef('step', '対象のステップ'),
    targetCheck: definitionRef('check', '対象の出る条件'),
    targetField: definitionRef('field', '対象のデータ項目'),

    // --- 機械が添えるコンテキスト（論点D）。人の入力コストをゼロに保つ部分 ---
    targetTable: definitionRef('table', '対象のデータ'),
    /**
     * 対象レコードのID。**`reference()` にできない** — 指す先のテーブルが
     * `targetTable` によって変わるので、外部キーとして固定できない。
     */
    targetRecordId: text('対象レコード'),
    /** 起票元の画面（`#/deals/d-xxx`）。「どの画面か」＝ スクショの① の代わり。 */
    screenRoute: text('起票した画面'),
    /**
     * 起票時に画面で起きていたこと（未充足だった出口条件など）。
     * ⚠ json は絞り込みにも並べ替えにも使えない。読むだけの記録として持つ。
     */
    situation: json('起票時の状況'),

    reporterEmployeeId: reference('employee', '起票者').required(),
    assigneeEmployeeId: reference('employee', '対応者'),
    /**
     * **サーバが埋める**（決定G）。`_version.validFrom` は現在バージョンの開始時刻なので、
     * 対応者やステップが変わると起票時刻ではなくなる。
     * これがあると `as_of` で**当時の画面を丸ごと再現できる**（論点D の ③ の上位互換）。
     */
    filedAt: createdAt('起票日時'),

    /** 何をどう変えたか（見送りならその理由）。対応者が書く。 */
    resolution: text('対応の内容'),
  },
  { label: '改善要望' },
)

/**
 * 要望へのやりとり1件。
 *
 * **`activity` と同じ形**（フローの target にぶら下がる追記）で、前例がある（§1）。
 * チャットの役割は「起票後の連絡」ではなく**内容の宣言性を詰める場**（§2-2）で、
 * 最初の起票は自由文1つでよく、構造は往復で埋まっていく、という設計になっている。
 */
export const changeRequestMessage = table(
  'change_request_message',
  {
    id: uuid('ID').primaryKey(),
    requestId: reference('change_request', '要望').required(),
    authorEmployeeId: reference('employee', '投稿者').required(),
    body: text('本文').required(),
    /** サーバが埋める。これが無いと追記を時系列に並べられない（決定G）。 */
    postedAt: createdAt('投稿日時'),
    /**
     * 書き手の種類。**AI を当事者に入れるのは v1 ではやらないが、場所だけ空けておく**
     * （論点K）。列1つのコストで、入れるときの移行が要らなくなる。
     */
    authorKind: enumOf('書き手', [
      { key: 'human', label: '人' },
      { key: 'ai', label: 'AI' },
    ]).required(),
  },
  { label: 'やりとり' },
)

/**
 * 未読の基準。「ユーザー × 要望 × 最終閲覧時刻」（論点H）。
 *
 * ⚠ **有効期間型なので、開くたびに版が1つ積まれる。** 数十人 × 日に数件の規模では
 * 問題にならないが、これは業務の出来事ではなく画面の状態なので、
 * 「履歴が業務の意味を持つ」テーブルではない。件数が効きだしたら持ち方ごと考え直す。
 */
export const changeRequestRead = table(
  'change_request_read',
  {
    id: uuid('ID').primaryKey(),
    requestId: reference('change_request', '要望').required(),
    employeeId: reference('employee', '読んだ人').required(),
    readAt: datetime('最終閲覧').required(),
  },
  { label: '要望の既読' },
)
