/**
 * `node:http` アダプタ。
 *
 * **HTTP に依存するのはこのファイルだけ。** app.ts より内側は
 * `ApiRequest → ApiResponse` の同期関数なので、テストはソケットを開かない。
 */
import type { ApiRequest, App } from './index.js'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export function createRequestListener(app: App) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    void handle(app, req, res)
  }
}

export function serve(app: App, port: number): Server {
  const server = createServer(createRequestListener(app))
  server.listen(port)
  return server
}

async function handle(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  let body: unknown
  try {
    body = await readBody(req)
  } catch (error) {
    return send(res, {
      status: 400,
      body: {
        error: {
          code: 'bad-request',
          message: `body が JSON として読めない: ${error instanceof Error ? error.message : String(error)}`,
        },
      },
    })
  }

  const request: ApiRequest = {
    method: req.method ?? 'GET',
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: headersOf(req),
    body,
  }
  send(res, app.handle(request))
}

function headersOf(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers[name] = Array.isArray(value) ? (value[0] ?? '') : value
  }
  return headers
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw === '' ? undefined : JSON.parse(raw)
}

function send(res: ServerResponse, response: { status: number; body: unknown }): void {
  const payload = JSON.stringify(response.body, null, 2)
  res.writeHead(response.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}
