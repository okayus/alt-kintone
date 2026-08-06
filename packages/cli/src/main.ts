/**
 * `alt` のエントリ。ルート package.json の `alt` スクリプトが tsx で直接実行する。
 *
 * 実処理は cli.ts にある。分けているのは、entry を import した瞬間にコマンドが
 * 走ってしまうとテストが書けないため。
 */
import { run } from './cli.js'

process.exitCode = run(process.argv.slice(2))
