/**
 * 共通シェル。docs/product-concept.md §4-3
 *
 * **共通化するのはここまで**。ナビ・レイアウト・エラー表示・時点指定・マスタの名前解決と、
 * **業務フロー描画**（`flow/` — 現在地・出口条件・遷移。フェーズ9 決定H）がシェルで、
 * 一覧やフォームの中身は業務画面（`flows/sales/`・`flows/request/`）に書く。
 * 一覧・フォームまで共通部品にすると部品の表現力が上限になる ＝ kintone の失敗構造。
 *
 * **FEは1つのアプリに統合する**（§4-3）。業務フローごとにアプリを分けない。
 * フェーズ9 で2本目（改善要望）が載り、ナビに項目が増えただけで済んでいる。
 */
import { flows, request as requestFlow, sales } from '@alt/definitions'
import { parseAsString, useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, MASTER_LIMIT, type Client } from './api'
import { asOfParam } from './format'
// 型だけの import なので実行時のコードは含まれない（決定F の「本番ビルドに含めない」は保たれる）。
import type { DevUser } from './auth/dev-user'
import { href, useRoute } from './router'
import { RequestButton } from './RequestButton'
import { UnreadBadge } from './UnreadBadge'
import type { Company, Employee } from './types'
import { FlowReference } from '../flows/FlowReference'
import { RequestDetail } from '../flows/request/RequestDetail'
import { RequestList } from '../flows/request/RequestList'
import { RequestNew } from '../flows/request/RequestNew'
import { DealDetail } from '../flows/sales/DealDetail'
import { DealList } from '../flows/sales/DealList'

/** 名前解決用のマスタ。API に JOIN 展開が無いので、FE で引き当てる。 */
export interface Masters {
  companies: Map<string, Company>
  employees: Map<string, Employee>
}

/** 業務画面が受け取るもの。 */
export interface ScreenProps {
  client: Client
  masters: Masters
  /** 時点指定。undefined なら現在。 */
  asOf: string | undefined
  /** 詐称中のユーザー。切り替えたら読み直すための依存キーでもある。 */
  user: string
  /**
   * ログイン中の従業員ID。マスタから引いてシェルが1回だけ解決する。
   *
   * 「自分」の判定は画面ごとに要る（起票者・投稿者・未読）が、API が返すのは ID なので
   * メールアドレス（`user`）のままでは突き合わせられない。**認可の判定には使わない**
   * — 可否は `_permissions` が答える（§4-1）。ここで使うのは表示と入力の既定値だけ。
   */
  meId: string
  onError: (error: unknown) => void
}

export interface DevUserSwitch {
  users: readonly DevUser[]
  current: string
  onChange: (email: string) => void
}

/**
 * 業務フローごとの API クライアント。
 *
 * **`flow` はクライアント単位で決める**（呼び出しごとに渡せるようにしない）。
 * `flow` は認可の範囲と `changed_flow` を決める値なので、指定漏れが
 * 「気づかないうちに別のフローの文脈で書いた」になる。画面はどちらか1本に属している。
 */
export interface Clients {
  sales: Client
  request: Client
}

export interface AppProps {
  clients: Clients
  /** 開発用ユーザー切替。本番エントリでは渡さないのでヘッダに出ない。 */
  devUsers: DevUserSwitch
}

export function App({ clients, devUsers }: AppProps) {
  const route = useRoute()
  const [user, setUser] = useState(devUsers.current)
  // 時点も URL に載せる（フェーズ6、論点D 補）。「先月末時点のこの絞り込み」ごと共有できる
  const [asOfParamValue, setAsOfParam] = useQueryState('as_of', parseAsString.withDefault(''))
  const asOf = asOfParamValue
  const setAsOf = (value: string) => void setAsOfParam(value === '' ? null : value)
  const [error, setError] = useState<unknown>(null)
  const [masters, setMasters] = useState<Masters>(emptyMasters)

  const onError = useCallback((value: unknown) => setError(value), [])

  const changeUser = (email: string) => {
    devUsers.onChange(email)
    setError(null)
    setUser(email)
  }

  // マスタは時点指定に追随させない。名前の表示に使うだけなので、
  // 過去の案件を見ているときも「いまの会社名・氏名」で読めるほうが分かりやすい。
  useEffect(() => {
    let live = true
    setError(null)
    // ⚠ **従業員は要望フローから引く。** 全ロールがこのフローの operator なので
    //    （起票ステップの担当が ROLE_KEYS）、営業フローに参加していない人でも名前を引ける。
    //    営業フローから引いていた頃は、制作担当がシェルの起動時点で 403 になっていた
    const employees = clients.request.list<Employee>('employee', { limit: MASTER_LIMIT })
    // ⚠ 会社は営業フローのデータなので、参加していない人は読めなくて**正しい**。
    //    ここでエラーにすると要望画面まで赤帯になるので、空のまま進む。
    //    案件の画面はそれぞれ自分で 403 を出す（黙って壊れるのはそちらでは起きない）
    const companies = clients.sales
      .list<Company>('company', { limit: MASTER_LIMIT })
      .catch(() => [] as Company[])

    Promise.all([companies, employees])
      .then(([companyList, employeeList]) => {
        if (!live) return
        setMasters({ companies: byId(companyList), employees: byId(employeeList) })
      })
      .catch((cause: unknown) => {
        if (!live) return
        setMasters(emptyMasters())
        setError(cause)
      })
    return () => {
      live = false
    }
  }, [clients, user])

  // 画面を移ったらエラーを消す。**エラーはそれを出した画面のもの**で、次の画面に
  // 貼り付いたままだと「移った先が壊れている」ように見える。フローが1本のうちは
  // 起きなかった壊れ方で、フェーズ9 で制作担当が案件一覧の 403 を要望画面まで
  // 連れて行ったことで見つかった
  useEffect(() => {
    setError(null)
  }, [route])

  // 「自分」は従業員マスタから引く。API が返すのは ID なので、メールアドレスのままでは
  // 起票者・投稿者・未読の突き合わせができない
  const meId = useMemo(
    () => [...masters.employees.values()].find((employee) => employee.email === user)?.id ?? '',
    [masters, user],
  )

  const screen = useMemo(
    () => ({ masters, asOf: asOfParam(asOf), user, meId, onError }),
    [masters, asOf, user, meId, onError],
  )

  const wide = route.name === 'deals'

  return (
    <div className="app">
      <header className="app-header">
        <a className="app-brand" href={href.deals()}>
          alt-kintone
        </a>
        <span className="app-spacer" />
        {/* どの画面からでも1クリックで起票できる（論点D）。押した瞬間の画面を持ち回る */}
        <RequestButton />
        <label className="app-asof" title="UTC で解釈する（DB に入っているのと同じ形）">
          時点
          <input
            type="datetime-local"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
          />
          {asOf !== '' && (
            <button type="button" onClick={() => setAsOf('')}>
              現在に戻す
            </button>
          )}
        </label>
        <label className="app-user">
          <span className="badge badge-dev">開発用</span>
          <select value={user} onChange={(event) => changeUser(event.target.value)}>
            {devUsers.users.map((candidate) => (
              <option key={candidate.email} value={candidate.email} title={candidate.note}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <nav className="app-nav">
        <a
          className={route.name === 'deals' || route.name === 'deal' ? 'current' : ''}
          href={href.deals()}
        >
          {sales.name}
        </a>
        <a
          className={route.name === 'requests' || route.name === 'request' ? 'current' : ''}
          href={href.requests()}
        >
          {requestFlow.name}
          {/* 未読はシェルの仕事（論点H）。要望画面を開いていないと気づけない形にしない */}
          <UnreadBadge client={clients.request} user={user} meId={meId} />
        </a>
        <span className="app-nav-sep" aria-hidden="true" />
        {/* フローが増えても壊れない形で回す（フェーズ5）。定義を足すと参照画面が増える */}
        {flows.map((flow) => (
          <a
            key={flow.key}
            className={route.name === 'flow' && route.key === flow.key ? 'current' : ''}
            href={href.flow(flow.key)}
          >
            {flow.name}の流れ
          </a>
        ))}
      </nav>

      {asOf !== '' && (
        <p className="app-banner app-banner-info">
          {asOf.replace('T', ' ')} 時点を見ている（読み取り専用）
        </p>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <main className={`app-main${wide ? ' wide' : ''}`}>
        {route.name === 'deals' ? (
          <DealList {...screen} client={clients.sales} />
        ) : route.name === 'deal' ? (
          <DealDetail {...screen} client={clients.sales} id={route.id} />
        ) : route.name === 'requests' ? (
          <RequestList {...screen} client={clients.request} />
        ) : route.name === 'requestNew' ? (
          <RequestNew {...screen} clients={clients} from={route.from} />
        ) : route.name === 'request' ? (
          <RequestDetail {...screen} client={clients.request} id={route.id} />
        ) : (
          // 参照画面は API を叩かないので ScreenProps を受け取らない（決定H）
          <FlowReference flowKey={route.key} currentStep={route.step} />
        )}
      </main>
    </div>
  )
}

/**
 * エラー表示。**サーバの `hint`（どう直すか）を捨てない** —
 * エラーメッセージを「読んで直せる形」にしたのがフェーズ2・3の投資なので、
 * 画面が握りつぶすとその意味が消える。
 */
function ErrorBanner({ error, onDismiss }: { error: unknown; onDismiss: () => void }) {
  if (error === null || error === undefined) return null

  const api = error instanceof ApiError ? error : undefined
  const message = error instanceof Error ? error.message : String(error)

  return (
    <div className="app-banner app-banner-error" role="alert">
      <div>
        <strong>{api === undefined ? 'エラー' : `${api.status} ${api.code}`}</strong>
        <span> {message}</span>
        {api?.hint !== undefined && <p className="app-banner-hint">→ {api.hint}</p>}
      </div>
      <button type="button" onClick={onDismiss}>
        閉じる
      </button>
    </div>
  )
}

function byId<T extends { id: string }>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((record) => [record.id, record]))
}

function emptyMasters(): Masters {
  return { companies: new Map(), employees: new Map() }
}
