/**
 * `alt` のコマンド解析と出力。docs/product-concept.md §5-3
 *
 * 解析は Node 標準の `parseArgs`。CLI フレームワークは入れない（TS版は仕様であって
 * Go 版完成後に捨てるので、依存を増やさない）。
 *
 * 全コマンドに `--json` を持たせるのは、これをAIが操作するため（§5-4）。
 * 出力先を `Io` で受けるのはテストのため。実体は main.ts が渡す。
 */
import { apply, openDatabase, resolveDbPath } from './apply.js'
import { loadBundle } from './bundle.js'
import { attachProposal, computeDiff, formatDiff, loadApplied } from './diff.js'
import { seed } from './seed.js'
import { validate, type ValidationError } from './validate.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs, type ParseArgsConfig } from 'node:util'

export interface Io {
  out(line: string): void
  err(line: string): void
}

export const consoleIo: Io = {
  out: (line) => void process.stdout.write(`${line}\n`),
  err: (line) => void process.stderr.write(`${line}\n`),
}

const USAGE = `alt — alt-kintone の定義を検証し、適用する

  alt validate [--json]
      定義を3層（構文 / 参照整合 / 業務ルール）で検証する

  alt apply [--db <path>] [--recreate] [--json]
      定義を SQLite にスキーマとして適用する。先に validate が走る
      適用先: --db > 環境変数 DATABASE_URL > data/alt.db
      既存のテーブルがあるときは --recreate が要る（作り直し。データは失われる）

  alt export [--out <path>] [--json]
      定義バンドルを JSON で吐く（バックエンドへの受け渡し形）
      --out を付けるとファイルに書く。バックエンドはこれを起動時に読む

  alt diff [--applied <path>] [--db <path>] [--request <id>] [--no-impact] [--json]
      適用済みの定義と作業ツリーの定義を比べ、業務の言葉で出す
      --applied  比較元（既定: data/definitions.json ＝ サーバが読んでいる定義）
      --request  差分を「変更案」として要望レコードに書き込む
      --no-impact  DB を見ない（いまのデータへの影響を数えない）
      ※ 差分があっても終了コードは 0（検査ではなく説明なので）

  alt seed [--db <path>] [--reset] [--deals <N>] [--json]
      開発用のデモデータを入れる。--reset で既存データを消してから入れる
      --deals <N> で N 件のダミー案件を追加する（一覧の性能検証用。乱数は固定シード）
      ※ マスタ（company / contact / employee）は API から作れないための裏口

終了コード: 0 成功 / 1 検証エラー・適用失敗 / 2 使い方の誤り`

/** 使い方の誤り。終了コード 2 になる。 */
class UsageError extends Error {}

export function run(argv: readonly string[], io: Io = consoleIo): number {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case 'validate':
        return runValidate(rest, io)
      case 'apply':
        return runApply(rest, io)
      case 'export':
        return runExport(rest, io)
      case 'diff':
        return runDiff(rest, io)
      case 'seed':
        return runSeed(rest, io)
      case '--help':
      case '-h':
        io.out(USAGE)
        return 0
      case undefined:
        io.err(USAGE)
        return 2
      default:
        throw new UsageError(`未知のコマンド: ${command}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.err(message)
    if (error instanceof UsageError) {
      io.err(`\n${USAGE}`)
      return 2
    }
    return 1
  }
}

// ---------------------------------------------------------------------------

function runValidate(args: readonly string[], io: Io): number {
  const opts = options(args, { json: { type: 'boolean' } })
  const errors = validate(loadBundle())
  report(errors, opts['json'] === true, io)
  return errors.length === 0 ? 0 : 1
}

function runApply(args: readonly string[], io: Io): number {
  const opts = options(args, {
    json: { type: 'boolean' },
    db: { type: 'string' },
    recreate: { type: 'boolean' },
  })
  const json = opts['json'] === true

  const bundle = loadBundle()
  // 検証を通らない定義は適用しない。DB には何も触らずに終わる
  const errors = validate(bundle)
  if (errors.length > 0) {
    report(errors, json, io)
    return 1
  }

  const path = resolveDbPath(
    typeof opts['db'] === 'string' ? opts['db'] : undefined,
    process.env['DATABASE_URL'],
  )
  const db = openDatabase(path)
  try {
    const result = apply(db, bundle, { recreate: opts['recreate'] === true })
    if (json) {
      io.out(JSON.stringify({ ok: true, db: path, ...result }, null, 2))
    } else {
      if (result.dropped.length > 0) io.out(`− 作り直し: ${result.dropped.join(', ')}`)
      io.out(`＋ 適用: ${result.created.join(', ')}`)
      io.out(`✔ ${path} に ${result.statements} 本の DDL を流した`)
    }
  } finally {
    db.close()
  }
  return 0
}

function runExport(args: readonly string[], io: Io): number {
  // 出力そのものが JSON なので --json は受け付けるだけ（全コマンドが持つ約束のため）
  const opts = options(args, { json: { type: 'boolean' }, out: { type: 'string' } })
  const json = JSON.stringify(loadBundle(), null, 2)

  const out = opts['out']
  if (typeof out !== 'string') {
    io.out(json)
    return 0
  }
  // 標準出力へのリダイレクトに頼らない。pnpm run の出力が混ざる事故を避ける
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${json}\n`)
  io.out(`✔ ${out} に定義を書き出した`)
  return 0
}

/**
 * 適用済みの定義との差分。
 *
 * ⚠ **差分があっても 0 で終わる。** `validate` と違って検査ではなく説明なので、
 * CI が「差分があるから失敗」と読むと運用が破綻する。
 */
function runDiff(args: readonly string[], io: Io): number {
  const opts = options(args, {
    json: { type: 'boolean' },
    applied: { type: 'string' },
    db: { type: 'string' },
    request: { type: 'string' },
    'no-impact': { type: 'boolean' },
  })

  const applied = loadApplied(typeof opts['applied'] === 'string' ? opts['applied'] : undefined)
  const working = loadBundle()
  const requestId = typeof opts['request'] === 'string' ? opts['request'] : undefined
  // 要望に添えるときは DB が要る（書き込み先なので --no-impact でも開く）
  const needsDb = opts['no-impact'] !== true || requestId !== undefined

  let diff = computeDiff(applied, working)
  let attached: string | undefined
  if (needsDb) {
    const path = resolveDbPath(
      typeof opts['db'] === 'string' ? opts['db'] : undefined,
      process.env['DATABASE_URL'],
    )
    const db = openDatabase(path)
    try {
      diff = computeDiff(applied, working, opts['no-impact'] === true ? undefined : db)
      if (requestId !== undefined) attached = attachProposal(db, working, requestId, diff)
    } finally {
      db.close()
    }
  }

  if (opts['json'] === true) {
    io.out(JSON.stringify({ ok: true, applied: applied.path, ...diff }, null, 2))
    return 0
  }
  for (const line of formatDiff(diff, applied)) io.out(line)
  if (attached !== undefined) io.out(`\n✔ 要望 ${attached} に変更案として添えた`)
  return 0
}

function runSeed(args: readonly string[], io: Io): number {
  const opts = options(args, {
    json: { type: 'boolean' },
    db: { type: 'string' },
    reset: { type: 'boolean' },
    deals: { type: 'string' },
  })

  const deals = parseCount(opts['deals'], 'deals')
  const bundle = loadBundle()
  const path = resolveDbPath(
    typeof opts['db'] === 'string' ? opts['db'] : undefined,
    process.env['DATABASE_URL'],
  )
  const db = openDatabase(path)
  try {
    const result = seed(db, bundle, {
      reset: opts['reset'] === true,
      ...(deals === undefined ? {} : { deals }),
    })
    if (opts['json'] === true) {
      io.out(JSON.stringify({ ok: true, db: path, ...result }, null, 2))
    } else {
      if (result.cleared) io.out('− 既存データを消した')
      for (const [table, count] of Object.entries(result.inserted)) {
        io.out(`＋ ${table}: ${count} 件`)
      }
      io.out(`✔ ${path} にデモデータを入れた`)
    }
  } finally {
    db.close()
  }
  return 0
}

// ---------------------------------------------------------------------------

/** `parseArgs` は数値型を持たないので、正の整数として読み直す。 */
function parseCount(raw: unknown, name: string): number | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new UsageError(`--${name} は正の整数で渡す: ${raw}`)
  }
  return value
}

type Options = NonNullable<ParseArgsConfig['options']>

function options(args: readonly string[], config: Options): Record<string, unknown> {
  try {
    return parseArgs({ args: [...args], options: config, strict: true, allowPositionals: false })
      .values
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
}

function report(errors: readonly ValidationError[], json: boolean, io: Io): void {
  if (json) {
    io.out(JSON.stringify({ ok: errors.length === 0, errorCount: errors.length, errors }, null, 2))
    return
  }
  if (errors.length === 0) {
    io.out('✔ 定義は妥当（エラー 0 件）')
    return
  }
  io.err(`✖ ${errors.length} 件`)
  for (const error of errors) io.err(`\n${format(error)}`)
}

function format(error: ValidationError): string {
  const where = Object.entries(error.where)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  const lines = [`[${error.layer}/${error.rule}]${where === '' ? '' : ` ${where}`}`]
  lines.push(`  ${error.message}`)
  if (error.hint !== undefined) lines.push(`  → ${error.hint}`)
  return lines.join('\n')
}
