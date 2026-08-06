/**
 * リクエストとレスポンスの形。docs/impl/phase-3-backend.md 3-2
 *
 * **HTTP そのものはここに現れない**。`app.handle(req)` は body をパース済みの
 * `ApiRequest` を受けて `ApiResponse` を返す同期関数で、`node:http` は http.ts の
 * アダプタ1枚に閉じてある。テストがソケットを開かずに書けるのと、Go に移すのが
 * この純関数側だけで済むのが理由。
 */

export interface ApiRequest {
  method: string
  /** クエリを除いたパス。 */
  path: string
  query: Record<string, string>
  /** キーは小文字。 */
  headers: Record<string, string>
  /** パース済みの body。 */
  body?: unknown
}

export interface ApiResponse {
  status: number
  body: unknown
}

/**
 * 想定内の失敗。ハンドラは throw して、app.ts の境界で拾う。
 *
 * `code` は kebab-case の識別子、`hint` は**どう直すか**。`alt validate` の
 * `ValidationError` と同じ方針で、FE を書くのも AI なので読んで直せる形にする。
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

  toBody(): unknown {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint === undefined ? {} : { hint: this.hint }),
      },
    }
  }
}

export const notFound = (message: string, hint?: string): ApiError =>
  new ApiError(404, 'not-found', message, hint)

export const badRequest = (message: string, hint?: string): ApiError =>
  new ApiError(400, 'bad-request', message, hint)

export const unauthorized = (message: string, hint?: string): ApiError =>
  new ApiError(401, 'unauthorized', message, hint)

export const forbidden = (message: string, hint?: string): ApiError =>
  new ApiError(403, 'forbidden', message, hint)

export const conflict = (message: string, hint?: string): ApiError =>
  new ApiError(409, 'conflict', message, hint)
