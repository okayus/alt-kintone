/**
 * SQL 方言の差異。
 *
 * ローカルは SQLite、本番は PostgreSQL になる可能性があるため、AST 自体は
 * 方言非依存にして生成層だけを差し替えられるようにしておく
 * （docs/product-concept.md §4-0、docs/condition-ast.md §5-3）。
 */
export interface Dialect {
  /** 0始まりの位置に対応するバインドプレースホルダ。 */
  placeholder(index: number): string
  /** 識別子のクォート。 */
  quote(identifier: string): string
}

export const sqlite: Dialect = {
  // SQLite / MySQL は位置に依存しない
  placeholder: () => '?',
  quote: (identifier) => `"${identifier}"`,
}

export const postgres: Dialect = {
  placeholder: (index) => `$${index + 1}`,
  quote: (identifier) => `"${identifier}"`,
}
