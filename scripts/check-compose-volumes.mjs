#!/usr/bin/env node
// pnpm workspace のパッケージと docker-compose.yml の匿名ボリュームを突き合わせる。
//
// bind mount（.:/app）は各パッケージの node_modules をホスト側の（空の）ディレクトリで
// 覆い隠すため、パッケージごとに匿名ボリュームの宣言が要る（docker-compose.yml 参照）。
// 追記を忘れると「コンテナ内で依存が消える」形で壊れるので、verify の先頭で機械検知する。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(message)
  process.exit(1)
}

// pnpm-workspace.yaml の packages: 直下の "- <dir>/*" だけを解釈する最小パーサ（依存を増やさない）
const globs = []
{
  let inPackages = false
  for (const line of readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').split('\n')) {
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

const pkgDirs = []
for (const glob of globs) {
  const m = glob.match(/^([\w./-]+)\/\*$/)
  if (!m) {
    fail(
      `pnpm-workspace.yaml: glob "${glob}" は scripts/check-compose-volumes.mjs が解釈できない形です。\n` +
        `対応しているのは "<dir>/*" だけです。glob を増やした場合はこのスクリプトも追従させてください。`,
    )
  }
  const base = join(root, m[1])
  if (!existsSync(base)) continue
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(base, entry.name, 'package.json'))) {
      pkgDirs.push(`${m[1]}/${entry.name}`)
    }
  }
}

const declared = new Set()
for (const line of readFileSync(join(root, 'docker-compose.yml'), 'utf8').split('\n')) {
  const m = line.match(/^\s*-\s*(\/app(?:\/\S+)?\/node_modules)\s*$/)
  if (m) declared.add(m[1])
}

const required = ['/app/node_modules', ...pkgDirs.map((dir) => `/app/${dir}/node_modules`)]
const missing = required.filter((path) => !declared.has(path))
const stale = [...declared].filter((path) => !required.includes(path))

if (stale.length > 0) {
  console.error(
    'docker-compose.yml: 対応する workspace パッケージが無い匿名ボリュームがあります（動作に害は無いが消し忘れ）:\n' +
      stale.map((path) => `      - ${path}`).join('\n'),
  )
}

if (missing.length > 0) {
  fail(
    'docker-compose.yml: services.dev.volumes に匿名ボリュームが足りません。\n' +
      'このままだと bind mount がコンテナ内の node_modules を空ディレクトリで覆い隠し、依存が消えます。\n' +
      '以下の行を volumes: に追記してください:\n' +
      missing.map((path) => `      - ${path}`).join('\n'),
  )
}
