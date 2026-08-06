/**
 * テーブル定義。docs/product-concept.md §5-6、docs/domain-model.md §5
 *
 * まだ型パズルは入れていない（`deal.amount.gt(0)` のような型安全な書き味は
 * 条件式ビルダーの層で後から足す）。ここが持つのは:
 *
 *  - フィールドの名前と型（条件式を SQL にするため）
 *  - 外部キー（暗黙結合の判定 docs/condition-ast.md §4 と、リレーションを辿る
 *    field の JOIN 解決のため）
 *  - **表示名（label）**。定義を営業がそのまま読めるようにするため
 *    （docs/impl/phase-5-flow-reference.md。FE が enum ラベルを手書きで二重管理する
 *    §8-2 論点14 をここで解く）
 *
 * ラベルは**必須**。省略可にすると必ず書かれないものが出て、画面に英語キーが漏れる。
 */
import { z } from 'zod'

export const FIELD_TYPES = [
  'uuid',
  'text',
  'integer',
  'boolean',
  'date',
  'datetime',
  /** 見込み受注月など。YYYY-MM */
  'yearMonth',
  'enum',
  'json',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/**
 * enum の候補1つ。`key` が DB に入り条件式 AST のリテラルになる識別子で、
 * `label` は表示だけ。分けるのは、文言を直した瞬間に既存データが孤児になるのを
 * 防ぐため（出口条件を明示キーで識別するのと同じ理由）。
 *
 * `Record<key, label>` でなく配列なのは**表示順を保つ**ため。Record にすると
 * Go の map で反復順が不定になり、候補の並びが定義から失われる。
 */
export interface EnumValue {
  key: string
  label: string
}

export interface FieldDef {
  type: FieldType
  /** 表示名。 */
  label: string
  required: boolean
  primaryKey: boolean
  /** 外部キーの参照先テーブル名。 */
  references?: string
  /** `type: 'enum'` のときの候補。 */
  values?: readonly EnumValue[]
}

export interface TableDef {
  name: string
  /** 表示名。 */
  label: string
  /**
   * 横断マスタ（docs/product-concept.md §3-4）。
   * true なら明示バインド（role / purpose）が不要になり、参照は自動記録される。
   */
  global: boolean
  fields: Record<string, FieldDef>
}

// ---------------------------------------------------------------------------
// ビルダー
// ---------------------------------------------------------------------------

/**
 * フィールドビルダー。イミュータブルで、チェーンのたびに新しい値を返す。
 * class を使わないのは、定義が最終的にただの JSON になるため。
 */
export interface FieldBuilder {
  readonly def: FieldDef
  required(): FieldBuilder
  primaryKey(): FieldBuilder
}

function builder(def: FieldDef): FieldBuilder {
  return {
    def,
    required: () => builder({ ...def, required: true }),
    // 主キーは NOT NULL なので required も立てる
    primaryKey: () => builder({ ...def, primaryKey: true, required: true }),
  }
}

// ラベルは第1引数。書き忘れは型エラーになる（docs/impl/phase-5-flow-reference.md 決定A）
const scalar =
  (type: FieldType) =>
  (label: string): FieldBuilder =>
    builder({ type, label, required: false, primaryKey: false })

export const uuid = scalar('uuid')
export const text = scalar('text')
/** 金額は整数円・税抜（docs/domain-model.md §9-5）。 */
export const integer = scalar('integer')
export const boolean = scalar('boolean')
export const date = scalar('date')
export const datetime = scalar('datetime')
export const yearMonth = scalar('yearMonth')
export const json = scalar('json')

export function enumOf(label: string, values: readonly EnumValue[]): FieldBuilder {
  return builder({ type: 'enum', label, required: false, primaryKey: false, values })
}

/**
 * 外部キー。参照先はテーブル名の文字列で指定する。
 *
 * テーブルオブジェクトを直接渡さないのは、ドメインに相互参照があるため
 * （deal.sourceContractId → contract、contract.dealId → deal）。
 * 参照先が実在するかは validate の参照整合層で検証する。
 */
export function reference(tableName: string, label: string): FieldBuilder {
  return builder({
    type: 'uuid',
    label,
    required: false,
    primaryKey: false,
    references: tableName,
  })
}

export function table(
  name: string,
  fields: Record<string, FieldBuilder>,
  opts: { label: string; global?: boolean },
): TableDef {
  return {
    name,
    label: opts.label,
    global: opts.global ?? false,
    fields: Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.def])),
  }
}

// ---------------------------------------------------------------------------
// レジストリと参照解決
// ---------------------------------------------------------------------------

export type Registry = Record<string, TableDef>

export function registry(...tables: TableDef[]): Registry {
  return Object.fromEntries(tables.map((t) => [t.name, t]))
}

/**
 * `from` から `toTable` への外部キーとなるフィールド名を列挙する。
 *
 * 暗黙結合の判定に使う（docs/condition-ast.md §4）:
 *  - ちょうど1つ  → 暗黙結合できる
 *  - 0個 or 複数  → 明示必須。validate でエラーにする
 */
export function foreignKeysTo(from: TableDef, toTable: string): string[] {
  return Object.entries(from.fields)
    .filter(([, f]) => f.references === toTable)
    .map(([name]) => name)
}

export interface ResolvedPath {
  /** 辿り着いたフィールド。 */
  field: FieldDef
  /** 経由したテーブル名（末尾が最終的にフィールドを持つテーブル）。 */
  tables: string[]
}

/**
 * field の path を解決する（docs/condition-ast.md §2-1）。
 *
 * 長さ1なら自テーブルの列、2以上ならリレーションを辿る。
 * 解決できなければ undefined を返す。validate の参照整合層と、
 * SQL 変換の JOIN 解決の両方で使う。
 */
export function resolveFieldPath(
  reg: Registry,
  tableName: string,
  path: readonly string[],
): ResolvedPath | undefined {
  const root = reg[tableName]
  if (root === undefined || path.length === 0) return undefined

  const tables: string[] = [tableName]
  // 明示的に TableDef で受ける。注釈が無いと current と next が互いの初期化子を
  // 参照する形になり、型推論が循環して TS7022 になる。
  let current: TableDef = root

  for (const [i, segment] of path.entries()) {
    const field: FieldDef | undefined = current.fields[segment]
    if (field === undefined) return undefined

    const isLast = i === path.length - 1
    if (isLast) return { field, tables }

    // 途中のセグメントは外部キーでなければ辿れない
    if (field.references === undefined) return undefined
    const next: TableDef | undefined = reg[field.references]
    if (next === undefined) return undefined
    current = next
    tables.push(next.name)
  }
  return undefined
}

/**
 * camelCase のフィールド名を snake_case の列名にする。
 * 定義とDBのマッピングはここ1箇所に閉じる。
 */
export function toColumnName(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

// ---------------------------------------------------------------------------
// zod スキーマ（定義そのものの検証）
// ---------------------------------------------------------------------------

export const enumValueSchema: z.ZodType<EnumValue> = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
})

export const fieldDefSchema: z.ZodType<FieldDef> = z
  .object({
    type: z.enum(FIELD_TYPES),
    label: z.string().min(1),
    required: z.boolean(),
    primaryKey: z.boolean(),
    references: z.string().min(1).optional(),
    values: z.array(enumValueSchema).min(1).readonly().optional(),
  })
  .refine((f) => f.type !== 'enum' || f.values !== undefined, {
    message: 'enum には values が必要',
    path: ['values'],
  })
  // key の重複はチェック状態の識別キー重複（duplicate-exit-key）と同種の壊れ方をする
  .refine(
    (f) => f.values === undefined || new Set(f.values.map((v) => v.key)).size === f.values.length,
    {
      message: 'enum の値（key）が重複している',
      path: ['values'],
    },
  )

export const tableDefSchema: z.ZodType<TableDef> = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  global: z.boolean(),
  fields: z.record(z.string().min(1), fieldDefSchema),
})
