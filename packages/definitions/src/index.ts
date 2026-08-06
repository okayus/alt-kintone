/**
 * 客先（求人広告・MEO営業会社）の定義。
 *
 * ここが唯一の正（docs/product-concept.md §5-1）。CLI が読んでバックエンドへ適用し、
 * FE が型として import する。
 *
 * **集約は手で並べる。** ディレクトリ走査にしない理由は、定義の集合が型として
 * 確定していないと FE の import が効かず、順序に依存する不具合も検出しにくいため。
 * 定義が増えて手作業が辛くなったら CLI 側で走査する。
 */
import { registry } from '@alt/dsl'
import { sales } from './flows/sales.js'
import { activity, company, contact, deal, employee } from './tables/index.js'

export * from './roles.js'
export * from './tables/index.js'
export { sales } from './flows/sales.js'

/** テーブルの全体。条件式の参照解決と DDL 生成の入力になる。 */
export const tables = registry(company, contact, deal, activity, employee)

/** 業務フローの全体。最小スコープでは営業フロー1本だけ。 */
export const flows = [sales]
