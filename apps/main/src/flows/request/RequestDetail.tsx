/**
 * 要望の詳細。docs/impl/phase-9-change-requests.md 完了条件3・6・7
 *
 * **業務フロー定義がUIに現れる場所**（§4-3）が、案件詳細と同じ形でもう1つできる。
 * 現在地・出口条件チェックリスト・遷移は `shell/flow/` の部品で、要望用に書き直していない
 * （決定H）。ここに書くのは**要望という業務に固有のもの**だけ:
 * 対象の表示・対応者と対応内容の編集・やりとり・既読。
 *
 * **対象は業務の言葉で出す**（完了条件3）。保存されているのは `sales.proposed` のような
 * 合成キーだが、画面に出すのは「営業（新規開拓） ＞ 提案」。定義を値として持っているので
 * サーバに翻訳させない。
 */
import { changeRequest as requestDef, flows, tables } from '@alt/definitions'
import {
  definitionRefLabel,
  resolveDefinitionRef,
  type DefinitionRefKind,
  type DefinitionScope,
} from '@alt/dsl'
import { useCallback, useEffect, useState } from 'react'
import { RequestChat } from './RequestChat'
import { RequestProposal } from './RequestProposal'
import type { ScreenProps } from '../../shell/App'
import { AdvanceButtons } from '../../shell/flow/AdvanceButtons'
import { exitLabelOf, stepNameOf } from '../../shell/flow/definitions'
import { ExitChecklist } from '../../shell/flow/ExitChecklist'
import { StepTrack } from '../../shell/flow/StepTrack'
import { dateTime, orDash } from '../../shell/format'
import { fieldLabel, label } from '../../shell/labels'
import { href } from '../../shell/router'
import type { ChangeRequest, ChangeRequestPatch, ChangeRequestRead } from '../../shell/types'

const DEFS: DefinitionScope = { tables, flows }

export function RequestDetail({
  client,
  masters,
  asOf,
  user,
  meId,
  onError,
  id,
}: ScreenProps & { id: string }) {
  const [record, setRecord] = useState<ChangeRequest | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** 本体を読み直す合図。やりとりを書くと `replied` が変わるので、そのときも上げる。 */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let live = true
    client
      .get<ChangeRequest>('change_request', id, { asOf })
      .then((next) => {
        if (live) setRecord(next)
      })
      .catch((cause: unknown) => {
        if (live) onError(cause)
      })
    return () => {
      live = false
    }
  }, [client, id, asOf, user, generation, onError])

  // 開いたら既読にする（未読バッジが消える条件）。過去を見ているときは書かない
  useEffect(() => {
    if (meId === '' || asOf !== undefined) return
    void markRead(client, id, meId).catch(() => undefined)
  }, [client, id, meId, asOf])

  const nameOf = useCallback(
    (employeeId: string | null | undefined): string =>
      employeeId === null || employeeId === undefined
        ? '—'
        : (masters.employees.get(employeeId)?.name ?? employeeId),
    [masters],
  )

  const mutate = (run: () => Promise<ChangeRequest>) => {
    setBusy(true)
    setNotice(null)
    run()
      .then(setRecord)
      .catch(onError)
      .finally(() => setBusy(false))
  }

  if (record === undefined) return <p className="loading">読み込み中…</p>
  const flow = record._flow

  return (
    <article className="request-detail">
      <p className="crumb">
        <a href={href.requests()}>← 要望の一覧</a>
      </p>

      <header className="request-head">
        <p className="muted">
          {label(requestDef.fields.kind, record.kind)} / {nameOf(record.reporterEmployeeId)} が{' '}
          {dateTime(record.filedAt)} に起票
        </p>
        <h2>{record.problem}</h2>
        {record.wish !== null && (
          <p className="request-wish">
            <span className="muted">{fieldLabel(requestDef, 'wish')}:</span> {record.wish}
          </p>
        )}
      </header>

      {flow !== null && (
        <section className="flow-panel">
          <p className="flow-panel-link">
            <a href={href.flow(flow.flow, flow.step)}>この業務の流れを見る →</a>
          </p>
          <StepTrack flow={flow} />

          <ExitChecklist
            flow={flow}
            permissions={record._permissions}
            busy={busy}
            nameOf={nameOf}
            onToggle={(key, checked) =>
              mutate(() =>
                client.setCheck<ChangeRequest>('change_request', record.id, key, checked),
              )
            }
          />

          <AdvanceButtons
            flow={flow}
            permissions={record._permissions}
            busy={busy}
            onAdvance={(to) =>
              mutate(async () => {
                const result = await client.advance<ChangeRequest>('change_request', record.id, to)
                setNotice(advanceNotice(flow.flow, to, result.unmet))
                return result.record
              })
            }
          />
          {notice !== null && <p className="app-banner app-banner-info">{notice}</p>}
        </section>
      )}

      <Target record={record} />

      {/* 対応者が `alt diff --request` で添えたときだけ出る（フェーズ10 決定D） */}
      {record.proposal !== null && <RequestProposal proposal={record.proposal} />}

      <Handling
        record={record}
        busy={busy}
        employees={[...masters.employees.values()]}
        onSave={(patch) =>
          mutate(() => client.patch<ChangeRequest>('change_request', record.id, patch))
        }
      />

      <RequestChat
        client={client}
        requestId={record.id}
        meId={meId}
        nameOf={nameOf}
        asOf={asOf}
        onError={onError}
        // 書き込むと出口条件「起票者に返信した」が自動で充足に変わる。読み直して反映する
        onPosted={() => setGeneration((value) => value + 1)}
      />

      <footer className="deal-version">
        最終更新 {dateTime(record._version.validFrom)} / {nameOf(record._version.changedBy)}
        {record._version.changedStep !== null && (
          <>（{stepNameOf('request', record._version.changedStep)} で変更）</>
        )}
      </footer>
    </article>
  )
}

// ---------------------------------------------------------------------------

function advanceNotice(flowKey: string, to: string, unmet: readonly string[]): string {
  const name = stepNameOf(flowKey, to)
  if (unmet.length === 0) return `${name} へ進めた。`
  return `${name} へ進めた。未確認だった ${unmet.length} 件（${unmet
    .map((key) => exitLabelOf(flowKey, key))
    .join(' / ')}）を記録に残した。`
}

/**
 * 何についての要望か。**保存されている合成キーではなく業務の言葉で出す**（完了条件3）。
 * ここが読めることが、スクショ + 赤ペンに対する優位の中身そのもの。
 */
function Target({ record }: { record: ChangeRequest }) {
  const rows: Array<[string, string]> = []
  const push = (kind: DefinitionRefKind, field: string, value: string | null) => {
    if (value === null || value === '') return
    const target = resolveDefinitionRef(DEFS, kind, value)
    rows.push([
      fieldLabel(requestDef, field),
      // 解決できない ＝ 定義から消えたものを指している。値をそのまま出して気づけるようにする
      target === undefined ? `${value}（いまの定義に無い）` : definitionRefLabel(target),
    ])
  }

  push('flow', 'targetFlow', record.targetFlow)
  push('step', 'targetStep', record.targetStep)
  push('check', 'targetCheck', record.targetCheck)
  push('field', 'targetField', record.targetField)
  push('table', 'targetTable', record.targetTable)

  const unmet = record.situation?.unmetChecks ?? []

  return (
    <section className="request-target">
      <h3>何についての要望か</h3>
      {rows.length === 0 ? (
        <p className="muted">対象が指定されていない。やりとりで決める。</p>
      ) : (
        <dl className="facts">
          {rows.map(([name, value]) => (
            <div key={name} className="fact">
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/*
        対象レコードの ID は出さない。ID が入るのはレコードの画面から起票したときだけで、
        そのとき `screenRoute` が同じレコードを指しているので、生の UUID は重複した雑音になる。
      */}
      <p className="muted request-context">
        {record.screenRoute !== null && (
          <>
            起票した画面: <a href={record.screenRoute}>{record.screenRoute}</a>
          </>
        )}
        {unmet.length > 0 && (
          <>
            {' / '}起票時に未確認だった条件:{' '}
            {unmet.map((key) => exitLabelOf(record.targetFlow ?? '', key)).join(' / ')}
          </>
        )}
      </p>
      {/* 有効期間型があるので、起票時刻さえ残っていれば当時のデータを丸ごと引ける（論点D） */}
      <p className="muted">
        起票時のデータは、画面上部の「時点」に {dateTime(record.filedAt)} を入れると読める。
      </p>
    </section>
  )
}

/** 対応側の記入欄。書けるのは `_permissions.update` が立っている人だけ（＝起票者と管理者）。 */
function Handling({
  record,
  busy,
  employees,
  onSave,
}: {
  record: ChangeRequest
  busy: boolean
  employees: Array<{ id: string; name: string }>
  onSave: (patch: ChangeRequestPatch) => void
}) {
  const [assignee, setAssignee] = useState(record.assigneeEmployeeId ?? '')
  const [resolution, setResolution] = useState(record.resolution ?? '')

  if (!record._permissions.update) {
    return (
      <section className="request-handling">
        <h3>対応</h3>
        <dl className="facts">
          <div className="fact">
            <dt>{fieldLabel(requestDef, 'assigneeEmployeeId')}</dt>
            <dd>{orDash(employees.find((e) => e.id === record.assigneeEmployeeId)?.name)}</dd>
          </div>
          <div className="fact">
            <dt>{fieldLabel(requestDef, 'resolution')}</dt>
            <dd>{orDash(record.resolution)}</dd>
          </div>
        </dl>
        {/* フェーズ7 決定S: 入れない理由をその場に言葉で出す */}
        <p className="muted">この要望を直せるのは起票者本人と管理者。意見はやりとりに書く。</p>
      </section>
    )
  }

  const changed =
    (assignee === '' ? null : assignee) !== record.assigneeEmployeeId ||
    (resolution === '' ? null : resolution) !== record.resolution

  return (
    <section className="request-handling">
      <h3>対応</h3>
      <div className="fields">
        <label className="field">
          <span className="field-label">{fieldLabel(requestDef, 'assigneeEmployeeId')}</span>
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">—</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field wide">
          <span className="field-label">{fieldLabel(requestDef, 'resolution')}</span>
          <textarea
            rows={2}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
          />
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !changed}
          onClick={() =>
            onSave({
              assigneeEmployeeId: assignee === '' ? null : assignee,
              resolution: resolution === '' ? null : resolution,
            })
          }
        >
          保存
        </button>
        {!changed && <span className="muted">変更なし</span>}
      </div>
    </section>
  )
}

/**
 * 既読の記録。行があれば更新、無ければ作成。
 *
 * ⚠ 有効期間型なので、開くたびに版が1つ積まれる（`change-request.ts` の注記）。
 *    業務の出来事ではないので履歴に意味は無いが、規模的に問題にならないので受け入れている。
 */
async function markRead(
  client: ScreenProps['client'],
  requestId: string,
  meId: string,
): Promise<void> {
  const existing = await client.list<ChangeRequestRead>('change_request_read', {
    filters: { requestId, employeeId: 'me' },
  })
  const readAt = new Date().toISOString()
  const current = existing[0]
  if (current === undefined) {
    await client.create<ChangeRequestRead>('change_request_read', {
      requestId,
      employeeId: meId,
      readAt,
    })
    return
  }
  await client.patch<ChangeRequestRead>('change_request_read', current.id, { readAt })
}
