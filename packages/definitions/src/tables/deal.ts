/**
 * 案件（ヨミ管理）。docs/domain-model.md §5、docs/sales-domain.md §4
 *
 * 営業フロー（sales）の target。ステップを進む主体はこのテーブルのレコード。
 */
import { date, enumOf, integer, reference, table, text, uuid, yearMonth } from '@alt/dsl'

export const deal = table('deal', {
  id: uuid().primaryKey(),
  companyId: reference('company').required(),
  title: text().required(),
  // job_ad 求人広告 / meo MEO / other その他
  productType: enumOf(['job_ad', 'meo', 'other']).required(),
  // new 新規 / renewal 更新 / repeat 再掲 / expansion 拡大
  // 受注率の分母に再掲・更新が混ざらないよう必須にする（sales-domain.md §17-2-7）
  dealType: enumOf(['new', 'renewal', 'repeat', 'expansion']).required(),

  // --- 金額は4分割（domain-model.md §5）。整数円・税抜 ---
  // 代理店ビジネスでは顧客請求額と自社収益が乖離する。広告費30万でマージン20%の
  // 案件を「30万」と数えると全KPIが狂うため、予測・目標・ランキングは
  // すべて *Profit（自社収益）ベースで集計する。
  /** 一時金・顧客請求額（掲載料・初期費用）。 */
  initialBilling: integer(),
  /** 一時金・自社収益。 */
  initialProfit: integer(),
  /** 月額・顧客請求額（MEO月額・運用型広告の月予算）。 */
  monthlyBilling: integer(),
  /** 月額・自社収益。 */
  monthlyProfit: integer(),
  /** 契約期間（月）。ストック型のみ。 */
  contractMonths: integer(),

  expectedCloseMonth: yearMonth(),
  /** ヨミ確度。 */
  confidence: enumOf(['A', 'B', 'C']),

  // open 進行中 / suspended 保留（予測から除外） / won 受注 / lost 失注 / abandoned 消滅
  // lost（買い手が何かを決めた）と abandoned（No Decision）を分けるのが要点。
  // 前者は差別化の問題、後者は課題の切迫度の問題で対策がまったく違う。
  status: enumOf(['open', 'suspended', 'won', 'lost', 'abandoned']).required(),
  // competitor 競合負け / own_reason 自社都合 / buyer_reason 買い手都合 / no_decision 意思決定なし
  outcomeReasonCategory: enumOf(['competitor', 'own_reason', 'buyer_reason', 'no_decision']),
  outcomeReasonDetail: text(),
  /** 競合先。「価格が高い」は最も当てにならない理由なので、これとセットで初めて分析に使える。 */
  competitor: text(),

  ownerEmployeeId: reference('employee').required(),
  /** 決着日。営業サイクル長（closedAt − 作成日の中央値）に使う。 */
  closedAt: date(),
  note: text(),
})

// ※ 最小スコープのため未実装のフィールド:
//    - storeId          … store テーブルが未定義（顧客の粒度がヒアリング待ち）
//    - sourceContractId … contract テーブルが未定義。更新・再掲の元契約を指す
//    - currentStep      … 持たない。現在ステップは _flow_state テーブル
//                         （docs/implementation.md 決定5）。業務テーブルの列にすると
//                         kintone と同じ「アプリが状態を抱える」構造になる
