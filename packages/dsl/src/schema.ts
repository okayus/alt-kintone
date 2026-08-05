/**
 * 条件式 AST の JSON Schema。
 *
 * Go 側はこのスキーマを読んで、受け取った定義を検証する
 * （docs/product-concept.md §4-0「条件式のAST が TS と Go の契約」）。
 * TS 側の zod 定義を正とし、ここから機械的に導出することで二重管理を避ける。
 */
import { z } from 'zod'
import { AST_VERSION, predSchema } from './ast.js'

/** 生成した JSON Schema。`$id` にバージョンを埋めて食い違いを検出可能にする。 */
export function predJsonSchema(): Record<string, unknown> {
  return {
    $id: `https://alt-kintone.dev/schema/condition-ast/v${AST_VERSION}.json`,
    ...z.toJSONSchema(predSchema, { io: 'input' }),
  }
}
