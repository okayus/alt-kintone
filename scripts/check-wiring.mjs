#!/usr/bin/env node
// パッケージを追加したときの「追記漏れ」を機械検知する。verify の先頭で走る。
//
// このリポジトリでは、パッケージを1つ足すたびに**4箇所**に同じことを書く必要がある。
// どれも忘れても即座には壊れず、あとから静かに壊れる種類なので、人間（とAI）の記憶に
// 任せずここで落とす。
//
//   1. docker-compose.yml の匿名ボリューム
//        bind mount（.:/app）が各パッケージの node_modules をホスト側の（空の）
//        ディレクトリで覆い隠すため。忘れると「コンテナ内で依存が消える」
//   2. 各パッケージの tsconfig.json の paths
//        prebuild なしで typecheck するため。忘れると tsc が dist/ を見る
//   3. vite.config.ts の resolve.alias
//        vitest と dev サーバー用。**忘れると dist/ の古い成果物でテストが通る**（一番たちが悪い）
//        packages/* はルートの vite.config.ts を読む。自前の vite.config.ts を持つ
//        パッケージ（apps/*）はそちらが読まれるので、依存の alias もそちらに要る
//   4. ルート package.json の tsx 起動に --tsconfig
//        2 の paths を実行時にも効かせるため。忘れると alt が dist/ を読む
//
// 依存は増やさない方針なので、YAML / JSONC / TS の読み取りは最小の自前パーサで済ませる。
// 対応している書き方は各パーサのコメントに書いてある。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

const problems = []
const notes = []

// ---------------------------------------------------------------------------
// workspace のパッケージ一覧
// ---------------------------------------------------------------------------

// pnpm-workspace.yaml の packages: 直下の "- <dir>/*" だけを解釈する最小パーサ
const globs = []
{
  let inPackages = false
  for (const line of read('pnpm-workspace.yaml').split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (/^\S/.test(line)) inPackages = false
    if (!inPackages) continue
    const m = line.match(/^\s*-\s*["']?([^"'\s#]+)/)
    if (m) globs.push(m[1])
  }
}

/** @type {{ dir: string, name: string, deps: string[] }[]} */
const packages = []
for (const glob of globs) {
  const m = glob.match(/^([\w./-]+)\/\*$/)
  if (!m) {
    fail(
      `pnpm-workspace.yaml: glob "${glob}" は ${scriptName()} が解釈できない形です。\n` +
        `対応しているのは "<dir>/*" だけです。glob を増やした場合はこのスクリプトも追従させてください。`,
    )
  }
  const base = join(root, m[1])
  if (!existsSync(base)) continue
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const dir = `${m[1]}/${entry.name}`
    if (!entry.isDirectory() || !existsSync(join(root, dir, 'package.json'))) continue
    const manifest = JSON.parse(read(dir, 'package.json'))
    packages.push({
      dir,
      name: manifest.name,
      // workspace 内のパッケージへの依存だけを見る（paths / alias が要るのはこれ）
      deps: Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((d) =>
        d.startsWith('@alt/'),
      ),
    })
  }
}

// ---------------------------------------------------------------------------
// 1. docker-compose.yml の匿名ボリューム
// ---------------------------------------------------------------------------

{
  const declared = new Set()
  for (const line of read('docker-compose.yml').split('\n')) {
    const m = line.match(/^\s*-\s*(\/app(?:\/\S+)?\/node_modules)\s*$/)
    if (m) declared.add(m[1])
  }

  const required = ['/app/node_modules', ...packages.map((p) => `/app/${p.dir}/node_modules`)]
  const missing = required.filter((path) => !declared.has(path))
  const stale = [...declared].filter((path) => !required.includes(path))

  if (stale.length > 0) {
    notes.push(
      'docker-compose.yml: 対応する workspace パッケージが無い匿名ボリュームがあります（動作に害は無いが消し忘れ）:\n' +
        stale.map((path) => `      - ${path}`).join('\n'),
    )
  }
  if (missing.length > 0) {
    problems.push(
      'docker-compose.yml: services.dev.volumes に匿名ボリュームが足りません。\n' +
        'このままだと bind mount がコンテナ内の node_modules を空ディレクトリで覆い隠し、依存が消えます。\n' +
        '以下の行を volumes: に追記してください:\n' +
        missing.map((path) => `      - ${path}`).join('\n'),
    )
  }
}

// ---------------------------------------------------------------------------
// 2. 各パッケージの tsconfig.json の paths
// ---------------------------------------------------------------------------

for (const pkg of packages) {
  const file = join(pkg.dir, 'tsconfig.json')
  if (!existsSync(join(root, file))) {
    problems.push(`${file}: がありません。typecheck が走りません。`)
    continue
  }

  const declared = pathsIn(read(pkg.dir, 'tsconfig.json'), file)
  if (declared === undefined) continue
  const missing = pkg.deps.filter((dep) => !declared.includes(dep))
  const stale = declared.filter((dep) => !pkg.deps.includes(dep))

  if (missing.length > 0) {
    problems.push(
      `${file}: compilerOptions.paths に workspace 依存が足りません: ${missing.join(', ')}\n` +
        'このままだと tsc が dist/ を見るので、prebuild を忘れた状態で typecheck が通ります。\n' +
        missing
          .map((dep) => `      "${dep}": ["../../packages/${dep.replace('@alt/', '')}/src/index.ts"]`)
          .join('\n'),
    )
  }
  if (stale.length > 0) {
    notes.push(
      `${file}: package.json の依存に無い paths が残っています（消し忘れ）: ${stale.join(', ')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// 3. vite.config.ts の resolve.alias
// ---------------------------------------------------------------------------

{
  const declared = aliasesIn(read('vite.config.ts'))

  // ルートが面倒を見るのは packages/* だけ。apps/* は誰からも import されないので
  // 自分の名前の alias は要らず、代わりに自分の vite.config.ts が読まれる（下）。
  const required = packages.filter((p) => p.dir.startsWith('packages/')).map((p) => p.name)
  const missing = required.filter((name) => !declared.includes(name))
  const stale = declared.filter((name) => !packages.some((p) => p.name === name))

  if (missing.length > 0) {
    problems.push(
      `vite.config.ts: resolve.alias に足りません: ${missing.join(', ')}\n` +
        'これが無いと vitest が workspace シンボリックリンク経由で dist/ の**ビルド済み成果物**を読み、\n' +
        'prebuild を忘れると「古いコードのままテストが通る」という一番たちの悪い壊れ方をします。\n' +
        missing
          .map((name) => `      '${name}': source('${name.replace('@alt/', '')}'),`)
          .join('\n'),
    )
  }
  if (stale.length > 0) {
    notes.push(`vite.config.ts: 対応する workspace パッケージが無い alias があります: ${stale.join(', ')}`)
  }

  // 自前の vite.config.ts を持つパッケージは、そちらが最寄りの設定として読まれる。
  // ルートに書いてあっても効かないので、依存の alias はこちらに要る。
  for (const pkg of packages) {
    const file = join(pkg.dir, 'vite.config.ts')
    if (!existsSync(join(root, file))) continue

    const own = aliasesIn(read(pkg.dir, 'vite.config.ts'))
    const lacking = pkg.deps.filter((dep) => !own.includes(dep))
    if (lacking.length === 0) continue

    problems.push(
      `${file}: resolve.alias に workspace 依存が足りません: ${lacking.join(', ')}\n` +
        'このパッケージは自前の vite.config.ts を持つので、ルートの alias は効きません。\n' +
        'このままだと dev サーバーもテストも dist/ の古い成果物を読みます。\n' +
        lacking
          .map((dep) => `      '${dep}': source('${dep.replace('@alt/', '')}'),`)
          .join('\n'),
    )
  }
}

// ---------------------------------------------------------------------------
// 4. tsx 起動に --tsconfig
// ---------------------------------------------------------------------------

{
  const scripts = JSON.parse(read('package.json')).scripts ?? {}
  for (const [name, command] of Object.entries(scripts)) {
    if (!/(^|\s)tsx\s/.test(command) || command.includes('--tsconfig')) continue
    problems.push(
      `package.json: scripts.${name} が tsx を --tsconfig なしで起動しています。\n` +
        'tsx は --tsconfig を渡さないと tsconfig の paths を解釈せず、workspace シンボリックリンク経由で\n' +
        'dist/ の古い成果物を読みます（vitest の alias と同じ罠）。\n' +
        `      "${name}": "tsx --tsconfig <package>/tsconfig.json ${command.replace(/^.*tsx\s+/, '')}"`,
    )
  }
}

// ---------------------------------------------------------------------------

for (const note of notes) console.error(note)
if (problems.length > 0) fail(problems.join('\n\n'))

/**
 * tsconfig.json（JSONC）の compilerOptions.paths のキーを拾う。
 * 読めなければ問題として記録し undefined を返す。
 *
 * JSON.parse できないのは `//` コメントが入っているため。行頭コメントだけを落とす
 * 最小の前処理で済ませている（行中コメントや `/* *​/` は未対応。URL の `//` を
 * 巻き込まないよう、行頭に限っているのが要点）。
 */
function pathsIn(source, file) {
  const stripped = source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
  try {
    return Object.keys(JSON.parse(stripped).compilerOptions?.paths ?? {})
  } catch (error) {
    problems.push(
      `${file}: JSON として読めません（末尾カンマなどの構文エラー）: ${error.message}\n` +
        `※ ${scriptName()} は行頭の // コメントだけを落とします。行中コメントは未対応です。`,
    )
    return undefined
  }
}

/** vite.config.ts の resolve.alias のキーを拾う。`'@alt/xxx': source('xxx'),` の形だけを見る。 */
function aliasesIn(source) {
  return [...source.matchAll(/['"](@alt\/[\w-]+)['"]\s*:/g)].map((m) => m[1])
}

function scriptName() {
  return 'scripts/check-wiring.mjs'
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
