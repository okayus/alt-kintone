import type { Literal } from '@alt/dsl'

/** SQL 片とそのバインドパラメータ。 */
export interface SqlFragment {
  sql: string
  params: unknown[]
}

/**
 * リテラルは常にパラメータにバインドし、SQL 文字列に埋め込まない。
 * docs/condition-ast.md §5-2
 *
 * 埋め込むと (a) 引用符やエスケープの方言差を抱え込み、(b) 値がクエリの
 * 一部になってインジェクションの余地が生まれる。バインドすれば両方消える。
 */
export function literalToSql(node: Literal): SqlFragment {
  return { sql: '?', params: [node.value] }
}
