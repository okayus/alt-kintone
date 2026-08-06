/**
 * 定義バンドル。定義パッケージ全体を1つの値にまとめたもの。
 *
 * ここが**バックエンドとの受け渡し形**（docs/implementation.md 決定1）。定義の正は
 * TS ファイルだが、バックエンドが受け取るのは `alt export` が吐くこの形の JSON で、
 * Go 版もここを入口にする。
 *
 * `alt validate` の構文層がこのスキーマ1つで済むのも狙い。テーブル・フロー・ロールを
 * 個別に検証すると、集合としての整合（キーの重複など）を見る場所が別に要る。
 */
import { flowDefSchema, type FlowDef } from './flow.js'
import { roleDefSchema, type RoleDef } from './role.js'
import { tableDefSchema, type Registry } from './table.js'
import { z } from 'zod'

export interface DefinitionBundle {
  tables: Registry
  flows: FlowDef[]
  roles: RoleDef[]
}

export const definitionBundleSchema: z.ZodType<DefinitionBundle> = z.object({
  tables: z.record(z.string().min(1), tableDefSchema),
  flows: z.array(flowDefSchema),
  roles: z.array(roleDefSchema),
})
