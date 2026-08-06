/**
 * 客先の定義をバンドルに束ねる**唯一の場所**。
 *
 * CLI のほかのモジュールは `@alt/definitions` を知らない。任意パスの定義を実行時に
 * ロードする仕組みを持たないのは、それが「基盤として作るか客先アプリの内部構造として
 * 作るか」（docs/product-concept.md §10-1、未判断）を先に決めてしまうため。
 * ここ1ファイルに閉じておけば、汎用化するときの差し替え点がここだけで済む。
 */
import { flows, roles, tables } from '@alt/definitions'
import type { DefinitionBundle } from '@alt/dsl'

export function loadBundle(): DefinitionBundle {
  return { tables, flows, roles }
}
