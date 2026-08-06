/**
 * 表示ラベルの引き当て。
 *
 * フェーズ5で enum ラベルの手書き表は消えた（docs/product-concept.md §8-2 論点14 の解決）。
 * ラベルは定義が持ち（`FieldDef.label` / `EnumValue.label` / `RoleDef.name`）、
 * ここは**引くだけ**。定義に値を足せば画面も追随し、二重管理が構造的に起きない。
 *
 * 見つからないキーはそのまま返す。定義変更の取り残しが画面で見えるようにするため
 * （`steps.ts` の stepName / exitLabel と同じ方針）。
 */
import { roles } from '@alt/definitions'
import type { FieldDef, TableDef } from '@alt/dsl'

/** enum の値 → 定義のラベル。 */
export function label(field: FieldDef | undefined, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return field?.values?.find((candidate) => candidate.key === value)?.label ?? value
}

/** フィールドの表示名。 */
export function fieldLabel(table: TableDef, name: string): string {
  return table.fields[name]?.label ?? name
}

/** ロールは定義（`role('sales_rep', '営業担当', …)`）が名前を持つ。 */
export function roleLabel(key: string | null | undefined): string {
  if (key === null || key === undefined) return '—'
  return roles.find((role) => role.key === key)?.name ?? key
}
