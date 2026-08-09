/**
 * 「どこから起票したか」→「何についての要望か」。
 * docs/impl/phase-9-change-requests.md 論点D・§7-3
 *
 * **スクショの ①（どの画面か）と ②（どの部品か）を、人に払わせずに埋める部分。**
 * ここが弱いと「宣言的なフォーム」は単に項目の多いフォームに退化する（§2-1）。
 *
 * ⚠ **業務画面からシェルへ状態を push させない。** 起票ボタンが持ち回るのは
 *    押した瞬間のハッシュ1本だけで、そこから機械的に導けるものだけを埋める。
 *    「いま何を見ているか」を各画面が登録する仕組みにすると、画面を足すたびに
 *    登録を忘れうるし、シェルと業務画面が結合する。
 *
 * ⚠ ここは**ルートから分かることだけ**を返す純関数。現在ステップや未充足の出口条件は
 *    サーバにしかないので、フォーム側が対象レコードを引いて足す（`RequestNew`）。
 */
import { flows } from '@alt/definitions'
import { parseRoute } from '../../shell/router'

/** ルート名 → そこで扱っているテーブル。ルーティング表はシェルの持ち物なのでここに書く。 */
const TABLE_OF_ROUTE: Partial<Record<ReturnType<typeof parseRoute>['name'], string>> = {
  deals: 'deal',
  deal: 'deal',
  requests: 'change_request',
  request: 'change_request',
}

/** そのテーブルを target にしているフロー。**定義から引く**ので対応表を二重に持たない。 */
function flowTargeting(table: string): string | undefined {
  return flows.find((flow) => flow.target === table)?.key
}

/**
 * ルートから埋められる対象。
 *
 * ⚠ `ChangeRequestInput` から `Pick` しない。あちらは「値を消す」ための `null` を許すが、
 *    ここは**まだ何も決まっていない**の意味しか要らない。混ぜると
 *    「未指定」と「明示的に空」が同じ型になって、判定が `=== undefined` では済まなくなる。
 */
export interface ContextDraft {
  screenRoute?: string
  targetTable?: string
  targetRecordId?: string
  targetFlow?: string
  targetStep?: string
}

/**
 * 起票元のハッシュから、埋められる対象を導く。
 *
 * `from` が無い（ナビから直接来た）ときは何も埋めない — 嘘の対象を入れるより空のほうがよい。
 */
export function contextFromRoute(from: string | undefined): ContextDraft {
  if (from === undefined || from === '') return {}

  const route = parseRoute(from)
  const draft: ContextDraft = { screenRoute: from }

  // フロー参照画面（`#/flows/sales?step=qualified`）は、対象そのものを指して来ている
  if (route.name === 'flow') {
    draft.targetFlow = route.key
    if (route.step !== undefined) draft.targetStep = stepRef(route.key, route.step)
    return draft
  }

  const table = TABLE_OF_ROUTE[route.name]
  if (table === undefined) return draft

  draft.targetTable = table
  const flowKey = flowTargeting(table)
  if (flowKey !== undefined) draft.targetFlow = flowKey
  if (route.name === 'deal' || route.name === 'request') draft.targetRecordId = route.id
  return draft
}

/** `definitionRef('step')` の合成キー。区切りは `@alt/dsl` の `definitionRefOptions` と同じ。 */
export function stepRef(flowKey: string, stepKey: string): string {
  return `${flowKey}.${stepKey}`
}

/** `definitionRef('check')` の合成キー。 */
export function checkRef(flowKey: string, stepKey: string, checkKey: string): string {
  return `${flowKey}.${stepKey}.${checkKey}`
}

/** `definitionRef('field')` の合成キー。 */
export function fieldRef(table: string, field: string): string {
  return `${table}.${field}`
}
