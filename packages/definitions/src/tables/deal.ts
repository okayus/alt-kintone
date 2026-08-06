/**
 * 案件（ヨミ管理）。docs/domain-model.md §5、docs/sales-domain.md §4
 *
 * 営業フロー（sales）の target。ステップを進む主体はこのテーブルのレコード。
 *
 * ラベル（表示名）は docs/domain-model.md §5・§5-0 の対応表から移した（フェーズ5）。
 * enum の値は英語キーのまま — DB に入り条件式 AST のリテラルになる識別子であって、
 * label を直しても既存データは孤児にならない。
 */
import { date, enumOf, integer, reference, table, text, uuid, yearMonth } from '@alt/dsl'

export const deal = table(
  'deal',
  {
    id: uuid('ID').primaryKey(),
    companyId: reference('company', '顧客企業').required(),
    title: text('案件名').required(),
    productType: enumOf('商材', [
      { key: 'job_ad', label: '求人広告' },
      { key: 'meo', label: 'MEO' },
      { key: 'other', label: 'その他' },
    ]).required(),
    // 受注率の分母に再掲・更新が混ざらないよう必須にする（sales-domain.md §17-2-7）
    dealType: enumOf('区分', [
      { key: 'new', label: '新規' },
      { key: 'renewal', label: '更新' },
      { key: 'repeat', label: '再掲' },
      { key: 'expansion', label: '拡大' },
    ]).required(),

    // --- 金額は4分割（domain-model.md §5）。整数円・税抜 ---
    // 代理店ビジネスでは顧客請求額と自社収益が乖離する。広告費30万でマージン20%の
    // 案件を「30万」と数えると全KPIが狂うため、予測・目標・ランキングは
    // すべて *Profit（自社収益）ベースで集計する。
    /** 掲載料・初期費用。 */
    initialBilling: integer('一時金・請求額'),
    initialProfit: integer('一時金・自社収益'),
    /** MEO月額・運用型広告の月予算。 */
    monthlyBilling: integer('月額・請求額'),
    monthlyProfit: integer('月額・自社収益'),
    /** ストック型のみ。 */
    contractMonths: integer('契約期間（月）'),

    expectedCloseMonth: yearMonth('見込み受注月'),
    confidence: enumOf('ヨミ確度', [
      { key: 'A', label: 'A' },
      { key: 'B', label: 'B' },
      { key: 'C', label: 'C' },
    ]),

    // lost（買い手が何かを決めた）と abandoned（No Decision）を分けるのが要点。
    // 前者は差別化の問題、後者は課題の切迫度の問題で対策がまったく違う。
    status: enumOf('状態', [
      { key: 'open', label: '進行中' },
      { key: 'suspended', label: '保留' },
      { key: 'won', label: '受注' },
      { key: 'lost', label: '失注' },
      { key: 'abandoned', label: '消滅' },
    ]).required(),
    outcomeReasonCategory: enumOf('決着理由', [
      { key: 'competitor', label: '競合負け' },
      { key: 'own_reason', label: '自社都合' },
      { key: 'buyer_reason', label: '買い手都合' },
      { key: 'no_decision', label: '意思決定なし' },
    ]),
    outcomeReasonDetail: text('決着理由（詳細）'),
    /** 「価格が高い」は最も当てにならない理由なので、これとセットで初めて分析に使える。 */
    competitor: text('競合先'),

    ownerEmployeeId: reference('employee', '担当').required(),
    /** 営業サイクル長（closedAt − 作成日の中央値）に使う。 */
    closedAt: date('決着日'),
    note: text('メモ'),
  },
  { label: '案件' },
)

// ※ 最小スコープのため未実装のフィールド:
//    - storeId          … store テーブルが未定義（顧客の粒度がヒアリング待ち）
//    - sourceContractId … contract テーブルが未定義。更新・再掲の元契約を指す
//    - currentStep      … 持たない。現在ステップは _flow_state テーブル
//                         （docs/implementation.md 決定5）。業務テーブルの列にすると
//                         kintone と同じ「アプリが状態を抱える」構造になる
