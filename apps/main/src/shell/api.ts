/**
 * API クライアント。共通シェルの一部（docs/product-concept.md §4-3）。
 *
 * 認証は**注入で受ける**。サーバ側が `createApp({ authenticator })` で認証を切り離して
 * あるのと同じ形で、OIDC を入れるときに差し替わるのはヘッダを作る関数だけになる。
 * このファイルは `X-Dev-User` を知らない。
 *
 * `flow` は全エンドポイント共通のクエリパラメータ。いまはフローが1本なので固定にしている。
 */

/** サーバが返すエラー本文（`packages/server/src/api.ts` の `ApiError.toBody`）。 */
interface ErrorBody {
  error?: { code?: string; message?: string; hint?: string }
}

/**
 * 失敗したリクエスト。**`hint` を捨てない** — サーバは「どう直すか」を返す設計なので、
 * それを画面に出さないとフェーズ3の投資が消える。
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export type AuthHeaders = () => Record<string, string>

/**
 * マスタ（会社・従業員）を全件引くときの件数。**サーバの `MAX_LIMIT` と同じ値**。
 *
 * 名前解決を全件取得に乗せているので、マスタがこれを超えると**黙って名前が「—」になる**
 * （docs/impl/phase-6-list-grid.md 決定F）。超える規模になったら、名前解決の方式ごと
 * 考え直すことになる（v1 では作らない）。
 */
export const MASTER_LIMIT = 500

export interface QueryOptions {
  /** 時点指定。省略時は現在。**過去を見る＝読み取り専用**になる。 */
  asOf?: string | undefined
  /**
   * 窓取得の時点固定（docs/impl/phase-6-list-grid.md 決定A）。
   *
   * `asOf` と違って読み取り専用にはならない。**サーバが返した `now` をそのまま渡す**
   * （クライアント時計を信用しない）。世代の途中で何が更新されても窓の中身が動かない。
   */
  snapshot?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
  /** `<フィールド>:asc|desc` か `_step:asc`。 */
  sort?: string | undefined
  /**
   * 絞り込み。**キーはそのまま API のパラメータ名**（`status` / `title_like` / `step` …）。
   * FE で AST を組み立てないのは、条件式の解釈をサーバ1箇所に閉じるため（論点C）。
   */
  filters?: Readonly<Record<string, string>> | undefined
}

/** クエリ文字列を組み立てる。テストが直接呼ぶ。 */
export function buildQuery(flow: string, opts: QueryOptions = {}): string {
  const params = new URLSearchParams({ flow })
  if (opts.asOf !== undefined && opts.asOf !== '') params.set('as_of', opts.asOf)
  if (opts.snapshot !== undefined && opts.snapshot !== '') params.set('snapshot', opts.snapshot)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.offset !== undefined && opts.offset > 0) params.set('offset', String(opts.offset))
  if (opts.sort !== undefined && opts.sort !== '') params.set('sort', opts.sort)
  for (const [key, value] of Object.entries(opts.filters ?? {})) {
    if (value !== '') params.set(key, value)
  }
  return `?${params.toString()}`
}

export interface ListResponse<T> {
  table: string
  flow: string
  asOf: string | null
  /** 実際に固定して読んだ時点。渡さなければ null。 */
  snapshot: string | null
  /** サーバ時刻。**次の窓の `snapshot` はこれを使う**。 */
  now: string
  /** 絞り込みに一致する総件数（窓の外も含む）。 */
  total: number
  offset: number
  limit: number
  records: T[]
}

export interface AdvanceResponse<T> {
  record: T
  /** 進んだ時点で満たしていなかった出口条件のキー。 */
  unmet: string[]
}

export interface Client {
  /**
   * このクライアントが属する業務フロー。**取得のキーの先頭になる**
   * （フェーズ12 論点C）。`flow` は認可の範囲を決める値なので、キーを組む側に
   * 文字列で渡させると「`request` のクライアントで `sales` のキー」が書けてしまう。
   * クライアント自身に持たせて、そこから読ませる。
   */
  readonly flow: string
  list<T>(table: string, opts?: QueryOptions): Promise<T[]>
  /** 一覧を窓で引く。総件数と時点が要るので、レスポンスをそのまま返す。 */
  listPage<T>(table: string, opts?: QueryOptions): Promise<ListResponse<T>>
  get<T>(table: string, id: string, opts?: QueryOptions): Promise<T>
  /**
   * 新規作成（フェーズ9 で追加。それまで FE は作成の口を持っていなかった）。
   * サーバが埋める列（`id` / 有効期間型 / `fill`）は送らない — 送ると 400 になる。
   */
  create<T>(table: string, body: unknown): Promise<T>
  patch<T>(table: string, id: string, body: unknown): Promise<T>
  advance<T>(table: string, id: string, to: string): Promise<AdvanceResponse<T>>
  setCheck<T>(table: string, id: string, key: string, checked: boolean): Promise<T>
}

export function createClient(auth: AuthHeaders, flow = 'sales'): Client {
  async function request<T>(
    method: string,
    path: string,
    opts: QueryOptions = {},
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`/api/${path}${buildQuery(flow, opts)}`, {
      method,
      headers: {
        ...auth(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) throw toApiError(response.status, payload)
    return payload as T
  }

  // 型注釈を省くと、ジェネリックなメソッドの引数が Client の宣言から
  // 文脈型を受け取れず implicit any になる。ここは明示する。
  return {
    flow,
    async list<T>(table: string, opts?: QueryOptions): Promise<T[]> {
      return (await request<ListResponse<T>>('GET', table, opts)).records
    },
    listPage<T>(table: string, opts?: QueryOptions): Promise<ListResponse<T>> {
      return request<ListResponse<T>>('GET', table, opts)
    },
    async get<T>(table: string, id: string, opts?: QueryOptions): Promise<T> {
      return (await request<{ record: T }>('GET', `${table}/${id}`, opts)).record
    },
    async create<T>(table: string, body: unknown): Promise<T> {
      return (await request<{ record: T }>('POST', table, {}, body)).record
    },
    async patch<T>(table: string, id: string, body: unknown): Promise<T> {
      return (await request<{ record: T }>('PATCH', `${table}/${id}`, {}, body)).record
    },
    advance<T>(table: string, id: string, to: string): Promise<AdvanceResponse<T>> {
      return request<AdvanceResponse<T>>('POST', `${table}/${id}/advance`, {}, { to })
    },
    async setCheck<T>(table: string, id: string, key: string, checked: boolean): Promise<T> {
      return (await request<{ record: T }>('PUT', `${table}/${id}/checks/${key}`, {}, { checked }))
        .record
    },
  }
}

/** レスポンス本文を `ApiError` にする。本文が読めなくてもステータスだけで作る。 */
export function toApiError(status: number, payload: unknown): ApiError {
  const error = (payload as ErrorBody | undefined)?.error
  return new ApiError(
    status,
    error?.code ?? 'unknown',
    error?.message ?? `リクエストが失敗した（HTTP ${status}）`,
    error?.hint,
  )
}
