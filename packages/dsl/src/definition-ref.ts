/**
 * 定義そのものへの参照の解決。docs/impl/phase-9-change-requests.md §7-1 (1)
 *
 * 改善要望が対象を**座標ではなく名前で指す**ための部品（§2-2「参照の宣言性」）。
 * スクリーンショットに矢印を引く代わりに「営業（新規開拓） ＞ 提案 ＞ 導入時期を確認した」
 * と指せるようにするのがこのファイルの役目。
 *
 * **1つの純関数をサーバとFEが共有する。**
 *
 *  - サーバ … 書き込み値がその kind の候補にあるかを検査する（`enum` と同じ場所で弾く）
 *  - FE     … 選択肢を出し、保存済みの値を**業務の言葉**に戻す
 *
 * 両方が同じ列挙を使うので、「保存できたのに画面に出ない」「画面に出た候補が弾かれる」が
 * 構造的に起きない。`compilePred` を `alt validate` とサーバが共有しているのと同じ形。
 *
 * ⚠ ここが見るのは**定義**であって**データ**ではない。定義を変えた結果、既存の要望が
 *    消えたステップを指す（＝解決できなくなる）ことは起こりうる。それを検出するのは
 *    フェーズ10（`alt diff`）の仕事で、`alt validate` の仕事ではない。
 */
import type { FlowDef } from './flow.js'
import type { DefinitionRefKind, Registry } from './table.js'

/** 値の区切り。フィールド名・キーに使えない文字であること。 */
const SEPARATOR = '.'

/** 解決に必要な定義の範囲。`DefinitionBundle` から `roles` を落としたもの。 */
export interface DefinitionScope {
  tables: Registry
  flows: readonly FlowDef[]
}

/** 選択肢1つ。`value` が保存される識別子で、`labels` は表示だけ（enum の key/label と同じ分離）。 */
export interface DefinitionRefOption {
  value: string
  /** 外側から内側へ。`['営業（新規開拓）', '提案', '導入時期を確認した']` */
  labels: string[]
}

export interface DefinitionRefTarget extends DefinitionRefOption {
  kind: DefinitionRefKind
}

/**
 * その kind で指せるものを全部並べる（宣言順）。
 *
 * 選択肢の出し分け（「いま見ている画面のテーブルだけ」など）は**呼び出し側で絞る**。
 * ここで絞る仕組みを持たせると、絞り方の種類だけ引数が増える。
 */
export function definitionRefOptions(
  defs: DefinitionScope,
  kind: DefinitionRefKind,
): DefinitionRefOption[] {
  const options: DefinitionRefOption[] = []

  if (kind === 'table' || kind === 'field') {
    for (const table of Object.values(defs.tables)) {
      if (kind === 'table') {
        options.push({ value: table.name, labels: [table.label] })
        continue
      }
      for (const [name, field] of Object.entries(table.fields)) {
        options.push({
          value: [table.name, name].join(SEPARATOR),
          labels: [table.label, field.label],
        })
      }
    }
    return options
  }

  for (const flow of defs.flows) {
    if (kind === 'flow') {
      options.push({ value: flow.key, labels: [flow.name] })
      continue
    }
    for (const step of flow.steps) {
      if (kind === 'step') {
        options.push({
          value: [flow.key, step.key].join(SEPARATOR),
          labels: [flow.name, step.name],
        })
        continue
      }
      for (const exit of step.exit) {
        options.push({
          value: [flow.key, step.key, exit.key].join(SEPARATOR),
          labels: [flow.name, step.name, exit.label],
        })
      }
    }
  }
  return options
}

/**
 * 値 → 指している対象。解決できなければ undefined。
 *
 * 列挙して突き合わせる（分解して個別に引かない）。**候補に無い値は解決もできない**という
 * 対応を保つほうが、サーバの検査とFEの選択肢が食い違わない。定義は小さいので実測上も問題ない。
 */
export function resolveDefinitionRef(
  defs: DefinitionScope,
  kind: DefinitionRefKind,
  value: string,
): DefinitionRefTarget | undefined {
  const found = definitionRefOptions(defs, kind).find((option) => option.value === value)
  return found === undefined ? undefined : { kind, ...found }
}

/** 表示用。`営業（新規開拓） ＞ 提案 ＞ 導入時期を確認した` */
export function definitionRefLabel(target: DefinitionRefOption): string {
  return target.labels.join(' ＞ ')
}
