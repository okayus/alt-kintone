#!/usr/bin/env bash
# package.json / pnpm-workspace.yaml を編集したら、コンテナ内で pnpm install を流す。
#
# compose の command は**起動時にしか** pnpm install しないので、依存を足したあとは
# 手で叩く必要がある。忘れると `Cannot find module` / `TS2307` という、原因が
# 依存の未インストールだと分かりにくい形で落ちる（フェーズ2で zod の追加時に踏んだ）。
#
# PostToolUse hook として動く。matcher は**ツール名**にしか効かないので、
# 対象ファイルの判定はここで行う（.claude/settings.json 参照）。
#
# 出力方針:
#   - 何もしなかったとき（対象外・コンテナ停止中）は完全に沈黙する
#   - install が実際に何か変えたときだけ additionalContext で知らせる
#     （知らせないと、結局こちらが手で pnpm install を叩いてしまい hook の意味が消える）
#   - install が失敗したら exit 2 で stderr を見せる
set -uo pipefail

SERVICE=dev

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# 発火の証跡。exit 0 のとき stdout は transcript に出ないので、これが無いと
# 「設定ミスで一度も呼ばれていない」と「呼ばれた上で対象外だった」を区別できない
# （守られているつもりで空振りするのが一番まずい）。.gitignore 済み。
printf '%s %s\n' "$(date -Iseconds)" "${file:-<no-file-path>}" >> .claude/.hook-log 2>/dev/null

# 対象外のファイルなら何もしない
case "$(basename "${file:-}")" in
  package.json | pnpm-workspace.yaml) ;;
  *) exit 0 ;;
esac

# このリポジトリの外（他プロジェクトや node_modules 配下）は無視する
case "$file" in
  "$PWD"/*) ;;
  *) exit 0 ;;
esac
case "$file" in
  */node_modules/*) exit 0 ;;
esac

# コンテナが動いていなければ黙って諦める（up していないのは異常ではない）
if ! docker compose ps --format json "$SERVICE" 2>/dev/null | grep -q '"State":"running"'; then
  exit 0
fi

# 何か起きたかは lockfile の変化で判定する。
# pnpm の出力では判定できない — **依存を足したときでも "Already up to date" を出す**
# （lockfile の supply-chain 検証フェーズの出力で、install 本体の結果ではない）。実測で確認済み。
before=$(cksum pnpm-lock.yaml 2>/dev/null)

if ! output=$(docker compose exec -T "$SERVICE" pnpm install 2>&1); then
  printf 'pnpm install に失敗しました（%s の編集後）:\n%s\n' "${file#"$PWD"/}" "$output" >&2
  exit 2
fi

# 変化が無いときは沈黙する
[ "$before" = "$(cksum pnpm-lock.yaml 2>/dev/null)" ] && exit 0

jq -n --arg f "${file#"$PWD"/}" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ($f + " の編集を受けて pnpm install を実行しました（依存が更新されています）。手で叩き直す必要はありません。")
  }
}'
