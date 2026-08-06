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

export interface QueryOptions {
  /** 時点指定。省略時は現在。 */
  asOf?: string | undefined
}

/** クエリ文字列を組み立てる。テストが直接呼ぶ。 */
export function buildQuery(flow: string, opts: QueryOptions = {}): string {
  const params = new URLSearchParams({ flow })
  if (opts.asOf !== undefined && opts.asOf !== '') params.set('as_of', opts.asOf)
  return `?${params.toString()}`
}

export interface ListResponse<T> {
  table: string
  flow: string
  asOf: string | null
  records: T[]
}

export interface AdvanceResponse<T> {
  record: T
  /** 進んだ時点で満たしていなかった出口条件のキー。 */
  unmet: string[]
}

export interface Client {
  list<T>(table: string, opts?: QueryOptions): Promise<T[]>
  get<T>(table: string, id: string, opts?: QueryOptions): Promise<T>
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
    async list<T>(table: string, opts?: QueryOptions): Promise<T[]> {
      return (await request<ListResponse<T>>('GET', table, opts)).records
    },
    async get<T>(table: string, id: string, opts?: QueryOptions): Promise<T> {
      return (await request<{ record: T }>('GET', `${table}/${id}`, opts)).record
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
