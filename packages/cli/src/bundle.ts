/**
 * 客先の定義をバンドルに束ねる**唯一の場所**。
 *
 * CLI のほかのモジュールは `@alt/definitions` を知らない。任意パスの定義を実行時に
 * ロードする仕組みを持たないのは、それが「基盤として作るか客先アプリの内部構造として
 * 作るか」（docs/product-concept.md §10-1、未判断）を先に決めてしまうため。
 * ここ1ファイルに閉じておけば、汎用化するときの差し替え点がここだけで済む。
 */
import { changeRequest, flows, request, roles, tables } from '@alt/definitions'
import type { DefinitionBundle } from '@alt/dsl'

export function loadBundle(): DefinitionBundle {
  return { tables, flows, roles }
}

/**
 * `alt diff --request <id>` が書き込む先。
 *
 * ⚠ **CLI が客先定義の名前を知っている箇所**だが、それはこのファイルの役目そのもの
 * （CLI のほかのモジュールは `@alt/definitions` を知らない）。プラットフォーム側が
 * 名前を直に持ってしまう §8-2 論点13 とは別で、ここは差し替え点として1箇所に閉じている。
 */
export const REQUEST = {
  flow: request.key,
  table: changeRequest.name,
  /** 変更案を入れる項目。 */
  proposalField: 'proposal',
} as const
