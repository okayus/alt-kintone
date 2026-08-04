import { z } from 'zod'

/**
 * AST のスキーマバージョン。
 *
 * この AST は TypeScript と Go の契約であり（docs/condition-ast.md）、両者が
 * 食い違うと静かに壊れる。ノードの追加・変更時にこの値を上げ、Go 側が
 * 受け取った定義のバージョンを検証できるようにする。
 */
export const AST_VERSION = 1

/**
 * リテラル値。docs/condition-ast.md §2-1
 *
 * `null` を含むのは意図的。SQL の三値論理を素直に扱うため、値の不在は
 * 専用ノードではなくリテラルとして表現する。
 */
export const literalSchema = z.object({
  type: z.literal('literal'),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
})

export type Literal = z.infer<typeof literalSchema>

/** リテラルノードを組み立てる。 */
export function literal(value: Literal['value']): Literal {
  return { type: 'literal', value }
}
