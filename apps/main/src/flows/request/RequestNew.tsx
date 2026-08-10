/**
 * 起票フォーム。docs/impl/phase-9-change-requests.md 論点B・C・D
 *
 * **置き換えているのはスクショ + 赤ペン**（§0-1）。だから設計の要点は
 * 「もっと構造化された、もっと重いフォーム」にしないことにある（§2-1）:
 *
 *  - ①②③（どの画面・どの部品・そのときの状態）は**アプリが機械で添える**。
 *    人の入力コストをゼロのままにする（論点D）
 *  - ⑤（なぜ困るか）は**問いの立て方で引き出す**。必須は「何ができなくて困っているか」で、
 *    「どうしてほしいか」は任意 — 訊けば手段で書かれ、⑤ が押し出される（§2-2）
 *  - ⑥（定義のどこを直すかへの翻訳）は**語彙の共有で消す**。対象は `definitionRef` で指す
 *
 * ⚠ **添えるものは読み取り専用で見せる**（論点D の推奨）。黙って送らない —
 *    何が送られるか分かることが、この導線を使ってもらえるかの条件。
 */
import { changeRequest as requestDef, flows, tables } from '@alt/definitions'
import { definitionRefLabel, definitionRefOptions, resolveDefinitionRef } from '@alt/dsl'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { contextFromRoute, stepRef, type ContextDraft } from './requestContext'
import type { Clients } from '../../shell/App'
import type { ScreenProps } from '../../shell/App'
import { fieldLabel } from '../../shell/labels'
import { keyOf } from '../../shell/query'
import { href } from '../../shell/router'
import type { ChangeRequest, ChangeRequestInput, RequestSituation } from '../../shell/types'

/** `definitionRef` の解決に渡す定義の範囲。FE は定義を値として持っている。 */
const DEFS = { tables, flows }

type Props = Omit<ScreenProps, 'client'> & {
  clients: Clients
  /** 起票ボタンを押した瞬間のハッシュ。 */
  from?: string | undefined
}

export function RequestNew({ clients, meId, user, onError, from }: Props) {
  const base = useMemo(() => contextFromRoute(from), [from])

  const [kind, setKind] = useState('')
  const [problem, setProblem] = useState('')
  const [wish, setWish] = useState('')
  const [targetField, setTargetField] = useState('')
  const [busy, setBusy] = useState(false)

  // 対象レコードがあるなら、**現在ステップと未充足の出口条件をサーバから足す**。
  // 「なぜそこで困ったか」の状況証拠になる（論点D）。画面が状態を渡してくる形にしない
  const { targetTable, targetRecordId } = base
  const client = targetTable === 'change_request' ? clients.request : clients.sales
  const target = useQuery({
    queryKey: keyOf(client, targetTable ?? '', { user, asOf: undefined }, targetRecordId ?? ''),
    queryFn: () =>
      client
        .get<{ _flow: ChangeRequest['_flow'] }>(targetTable ?? '', targetRecordId ?? '')
        // 対象が読めない（権限が無い・消えている）ことは起票の妨げにしない。
        // 添えられるものが減るだけで、困りごとは書ける。**共通のエラー表示にも出さない**
        // ので、握りつぶしは queryFn の中に置く（フェーズ12 論点B）
        .catch(() => null),
    enabled: targetTable !== undefined && targetRecordId !== undefined,
  })

  // 添えるものは**取得結果から導く**（フェーズ12: マージ先の state を持たない）
  const flow = target.data?._flow ?? null
  const context = useMemo<ContextDraft>(
    () => (flow === null ? base : { ...base, targetStep: stepRef(flow.flow, flow.step) }),
    [base, flow],
  )
  const situation = useMemo<RequestSituation | null>(
    () =>
      flow === null
        ? null
        : { unmetChecks: flow.exit.filter((exit) => !exit.satisfied).map((exit) => exit.key) },
    [flow],
  )

  const kinds = requestDef.fields.kind?.values ?? []
  // 対象のデータ項目は **その画面のテーブルの中から**選ばせる（論点B）。
  // 全テーブル横断の 57 件から選ばせない
  const fieldOptions = useMemo(
    () =>
      context.targetTable === undefined
        ? []
        : definitionRefOptions(DEFS, 'field').filter((option) =>
            option.value.startsWith(`${context.targetTable}.`),
          ),
    [context.targetTable],
  )

  const ready = kind !== '' && problem.trim() !== '' && meId !== ''

  const submit = () => {
    if (!ready) return
    setBusy(true)
    const input: ChangeRequestInput = {
      kind: kind as ChangeRequestInput['kind'],
      problem: problem.trim(),
      reporterEmployeeId: meId,
      ...(wish.trim() === '' ? {} : { wish: wish.trim() }),
      ...(targetField === '' ? {} : { targetField }),
      ...context,
      ...(situation === null ? {} : { situation }),
    }
    clients.request
      .create<ChangeRequest>('change_request', input)
      .then((created) => {
        window.location.hash = href.request(created.id)
      })
      .catch((cause: unknown) => {
        onError(cause)
        setBusy(false)
      })
  }

  return (
    <article className="request-new">
      <p className="crumb">
        <a href={href.requests()}>← 要望の一覧</a>
      </p>
      <h2>困りごとを出す</h2>
      <p className="muted">
        書くのは「いま何ができなくて困っているか」だけでよい。対象と状況はアプリが添える。
      </p>

      <form
        className="request-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label className="field wide">
          <span className="field-label">
            {fieldLabel(requestDef, 'kind')}
            <em className="required">必須</em>
          </span>
          {/* 種類を必須にするのは、続く問いを変えるため（決定B）。分類のためではない */}
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">選ぶ</option>
            {kinds.map((value) => (
              <option key={value.key} value={value.key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field wide">
          <span className="field-label">
            {fieldLabel(requestDef, 'problem')}
            <em className="required">必須</em>
          </span>
          <textarea
            rows={4}
            value={problem}
            placeholder={placeholderFor(kind)}
            onChange={(event) => setProblem(event.target.value)}
          />
        </label>

        <label className="field wide">
          <span className="field-label">
            {fieldLabel(requestDef, 'wish')} <span className="muted">（任意）</span>
          </span>
          <textarea
            rows={2}
            value={wish}
            placeholder="思いつく直し方があれば。無くてよい"
            onChange={(event) => setWish(event.target.value)}
          />
        </label>

        {fieldOptions.length > 0 && (
          <label className="field wide">
            <span className="field-label">
              {fieldLabel(requestDef, 'targetField')} <span className="muted">（任意）</span>
            </span>
            <select value={targetField} onChange={(event) => setTargetField(event.target.value)}>
              <option value="">—</option>
              {fieldOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {definitionRefLabel(option)}
                </option>
              ))}
            </select>
          </label>
        )}

        <Attached context={context} situation={situation} />

        <div className="form-actions">
          <button type="submit" className="primary" disabled={!ready || busy}>
            出す
          </button>
          <a href={href.requests()}>やめる</a>
          {meId === '' && <span className="unmet">従業員マスタを読み込み中…</span>}
        </div>
      </form>
    </article>
  )
}

// ---------------------------------------------------------------------------

/**
 * 種類ごとの問いかけ（論点C の表）。
 * **内容の宣言性はフォームで強制できない**ので、文面で誘導するところまでが設計の範囲。
 */
function placeholderFor(kind: string): string {
  switch (kind) {
    case 'cannot_record':
      return '何を記録したいか／どの場面で使うか／例を1つ'
    case 'field_unclear':
      return 'どの項目か／どう困るか'
    case 'steps_mismatch':
      return 'どのステップか／実際はどうしているか'
    case 'exit_mismatch':
      return 'どの条件か／いま何が起きて困るか'
    case 'ui_friction':
      return 'どの画面か／何をしようとして手間取るか'
    case 'new_business':
      return 'どんな仕事か／いまどこでやっているか／関わる人'
    case 'defect':
      return '何をしたか／どうなると思ったか／実際どうなったか'
    default:
      return '困っていることを、そのまま書く'
  }
}

/**
 * 添えるもの（論点D）。**読み取り専用で見せる。**
 * 何が送られるか分からないまま送らせない、というのがここの唯一の役目。
 */
function Attached({
  context,
  situation,
}: {
  context: ContextDraft
  situation: RequestSituation | null
}) {
  const rows: Array<[string, string]> = []
  const push = (label: string, value: string | undefined) => {
    if (value !== undefined && value !== '') rows.push([label, value])
  }

  push('起票した画面', context.screenRoute)
  push('対象の業務', refLabel('flow', context.targetFlow))
  push('対象のステップ', refLabel('step', context.targetStep))
  push('対象のデータ', refLabel('table', context.targetTable))
  // 対象レコードの ID は出さない。「起票した画面」が同じレコードを指しているので重複になる
  if (situation?.unmetChecks !== undefined && situation.unmetChecks.length > 0) {
    push('そのとき未確認だった条件', `${situation.unmetChecks.length} 件`)
  }

  return (
    <section className="request-attached">
      <h3>この状況を添えます</h3>
      {rows.length === 0 ? (
        <p className="muted">
          ナビから直接来たので、添えられるものがない。対象は対応者と相談して決める。
        </p>
      ) : (
        <dl className="facts">
          {rows.map(([label, value]) => (
            <div key={label} className="fact">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {/* 起票時刻はサーバが埋める（決定G）。ここで見せる値を作ると嘘になる */}
      <p className="muted">起票時刻はサーバが記録する。あとから当時のデータを引ける。</p>
    </section>
  )
}

/** 保存される値（合成キー）ではなく、業務の言葉で見せる。 */
function refLabel(
  kind: 'flow' | 'step' | 'table' | 'field' | 'check',
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined
  const target = resolveDefinitionRef(DEFS, kind, value)
  return target === undefined ? value : definitionRefLabel(target)
}
