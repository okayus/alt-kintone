/**
 * 差分を業務の言葉にするための語彙。docs/impl/phase-10-definition-diff.md 決定B
 *
 * ⚠ **パッケージに日本語の文言が入っている。** 意図的な判断で、理由は
 * 「提案差分は保存され、あとから読まれる」こと（§2-1）。表示側で組み立てると、
 * 保存済みの JSON が表示側の版に依存してしまう。客先1社・日本語のみなので許容する。
 *
 * ここに置くのは**型やキーを人の言葉に写す表**だけ。文の組み立ては bundle-diff.ts。
 */
import { ROOT_SOURCE, type FieldDef, type FieldType, type Registry } from '@alt/dsl'

/** 入力の種類。起票者が読む言葉なので「integer」ではなく「数値」。 */
const FIELD_TYPES: Record<FieldType, string> = {
  uuid: 'ID',
  text: '文字',
  integer: '数値',
  boolean: 'はい / いいえ',
  date: '日付',
  datetime: '日時',
  yearMonth: '年月',
  enum: '選択',
  json: 'まとまった記録',
}

const DEFINITION_REFS: Record<string, string> = {
  table: 'データ',
  flow: '業務フロー',
  step: 'ステップ',
  field: 'データ項目',
  check: '出る条件',
}

const BINDING_ROLES: Record<string, string> = {
  primary: '主対象',
  reference: '参照',
  master: 'マスタ',
}

export const bindingRoleLabel = (role: string): string => BINDING_ROLES[role] ?? role

/**
 * 項目の性格を1語で。「文字・任意」「選択・必須」「案件への参照」。
 *
 * 型だけを出しても起票者には意味がないので、参照であることや必須かどうかを混ぜる。
 */
export function fieldKindLabel(field: FieldDef, tables: Registry): string {
  const required = field.required ? '必須' : '任意'
  if (field.references !== undefined) {
    const target = tables[field.references]?.label ?? field.references
    return `「${target}」への参照・${required}`
  }
  if (field.definitionRef !== undefined) {
    return `${DEFINITION_REFS[field.definitionRef] ?? field.definitionRef}を指す・${required}`
  }
  if (field.fill === 'createdAt') return 'アプリが自動で入れる日時'
  return `${FIELD_TYPES[field.type]}・${required}`
}

/** 型そのものの表示（型が変わったときの前後に使う）。 */
export const fieldTypeLabel = (field: FieldDef): string =>
  field.references !== undefined ? 'ID（参照）' : FIELD_TYPES[field.type]

/**
 * 条件式が見ているフィールド1つを「案件.見込み受注月」の形にする。
 *
 * フロー参照画面の `SeenData`（フェーズ5 決定D）と同じ読み替え。`root` は
 * フローの target テーブルに読み替える。
 */
export function describeFieldRef(
  tables: Registry,
  rootTable: string,
  ref: { source: string; path: readonly string[] },
): string {
  const parts: string[] = []
  let current = tables[ref.source === ROOT_SOURCE ? rootTable : ref.source]
  parts.push(current?.label ?? ref.source)
  for (const segment of ref.path) {
    const field: FieldDef | undefined = current?.fields[segment]
    parts.push(field?.label ?? segment)
    current = field?.references === undefined ? undefined : tables[field.references]
  }
  return parts.join('.')
}

/** 「＋A ／ ＋B ／ −C」。増減を1行にまとめる共通の形。 */
export function plusMinus(added: readonly string[], removed: readonly string[]): string {
  return [...added.map((v) => `＋${v}`), ...removed.map((v) => `−${v}`)].join(' ／ ')
}

/** 前後の値。長い文（intent / howTo / purpose）に使う。 */
export const beforeAfter = (before: string, after: string): string => `「${before}」→「${after}」`
