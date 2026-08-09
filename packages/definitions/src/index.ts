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
import { request } from './flows/request.js'
import { sales } from './flows/sales.js'
import {
  activity,
  changeRequest,
  changeRequestMessage,
  changeRequestRead,
  company,
  contact,
  deal,
  employee,
} from './tables/index.js'

export * from './roles.js'
export * from './tables/index.js'
export { sales } from './flows/sales.js'
export { request } from './flows/request.js'

/** テーブルの全体。条件式の参照解決と DDL 生成の入力になる。 */
export const tables = registry(
  company,
  contact,
  deal,
  activity,
  employee,
  changeRequest,
  changeRequestMessage,
  changeRequestRead,
)

/**
 * 業務フローの全体。
 *
 * 2本目（`request`）は**開発への要望を受ける業務そのもの**
 * （docs/impl/phase-9-change-requests.md 論点A）。1本目が営業の業務、2本目が
 * 自分たちの業務、という並びになっている。
 */
export const flows = [sales, request]
