/**
 * 共通シェル。docs/product-concept.md §4-3
 *
 * **共通化するのはここまで**。ナビ・レイアウト・エラー表示・時点指定・
 * マスタの名前解決までがシェルで、一覧やフォームの中身は業務画面（`flows/sales/`）に書く。
 * 一覧・フォームまで共通部品にすると部品の表現力が上限になる ＝ kintone の失敗構造。
 *
 * **FEは1つのアプリに統合する**（§4-3）。業務フローごとにアプリを分けない。
 * いまナビに項目が1つしか無いのは、フローが1本しか定義されていないからにすぎない。
 */
import { flows, sales } from '@alt/definitions'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Client } from './api'
import { asOfParam } from './format'
// 型だけの import なので実行時のコードは含まれない（決定F の「本番ビルドに含めない」は保たれる）。
import type { DevUser } from './auth/dev-user'
import { href, useRoute } from './router'
import type { Company, Employee } from './types'
import { FlowReference } from '../flows/FlowReference'
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
  onError: (error: unknown) => void
}

export interface DevUserSwitch {
  users: readonly DevUser[]
  current: string
  onChange: (email: string) => void
}

export interface AppProps {
  client: Client
  /** 開発用ユーザー切替。本番エントリでは渡さないのでヘッダに出ない。 */
  devUsers: DevUserSwitch
}

export function App({ client, devUsers }: AppProps) {
  const route = useRoute()
  const [user, setUser] = useState(devUsers.current)
  const [asOf, setAsOf] = useState('')
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
    Promise.all([client.list<Company>('company'), client.list<Employee>('employee')])
      .then(([companies, employees]) => {
        if (!live) return
        setMasters({ companies: byId(companies), employees: byId(employees) })
      })
      .catch((cause: unknown) => {
        if (!live) return
        setMasters(emptyMasters())
        setError(cause)
      })
    return () => {
      live = false
    }
  }, [client, user])

  const screen: ScreenProps = {
    client,
    masters,
    asOf: asOfParam(asOf),
    user,
    onError,
  }

  return (
    <div className="app">
      <header className="app-header">
        <a className="app-brand" href={href.deals()}>
          alt-kintone
        </a>
        {/* フロー名は定義から取る。ここが乖離しないのは §4-3 の狙いそのもの */}
        <span className="app-flow">{sales.name}</span>
        <span className="app-spacer" />
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
        <a className={route.name === 'deals' ? 'current' : ''} href={href.deals()}>
          案件
        </a>
        {/* フローが増えても壊れない形で回す（フェーズ5）。1本のうちは総称で出す */}
        {flows.map((flow) => (
          <a
            key={flow.key}
            className={route.name === 'flow' && route.key === flow.key ? 'current' : ''}
            href={href.flow(flow.key)}
          >
            {flows.length === 1 ? '業務フロー' : flow.name}
          </a>
        ))}
      </nav>

      {asOf !== '' && (
        <p className="app-banner app-banner-info">
          {asOf.replace('T', ' ')} 時点を見ている（読み取り専用）
        </p>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <main className="app-main">
        {route.name === 'deals' ? (
          <DealList {...screen} />
        ) : route.name === 'deal' ? (
          <DealDetail {...screen} id={route.id} />
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
