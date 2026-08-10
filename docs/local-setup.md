# 別のマシンで動かす

クローンした直後は **`data/` が空**（`.gitignore` に入っている）。
アプリを起動しても案件も従業員も1件も無いので、動かす前にデータを用意する。

用意するものは**2つ**あり、片方は SQL では代替できない。

| 要るもの | 何のためか | 作り方 |
|---|---|---|
| `data/definitions.json` | **サーバが起動時に1回読む定義**。テーブル・業務フロー・ロールの実体で、API が生えるかどうかもこれで決まる | `alt export` **だけ**（SQL には入っていない） |
| `data/alt.db` | スキーマとデータ | `alt apply` + `alt seed`、または `sql/testdata.sql` |

> ⚠ **定義 JSON を忘れると「テーブルの API が生えていない」という顔で失敗する。**
> DB にデータが入っていても直らないので、最初に作る。

---

## 手順（推奨）

```sh
git clone <repo> && cd alt-kintone
docker compose up -d                                                  # 初回は5〜10分（Chromium を焼く）

docker compose exec dev pnpm alt export --out data/definitions.json   # ① 定義
docker compose exec dev pnpm alt apply --recreate                     # ② スキーマ
docker compose exec dev pnpm alt seed --reset                         # ③ テストデータ（約1秒）

docker compose exec -d dev pnpm serve                                 # API  → localhost:3100
docker compose exec -d dev pnpm dev                                   # FE   → localhost:5273
```

ブラウザで `localhost:5273` を開く。右上の「開発用」で利用者を切り替えられる
（認証は実装していない。`X-Dev-User` ヘッダの詐称で代用している）。

一覧グリッドの性能を見るなら ③ を `pnpm alt seed --reset --deals 10000` にする。

## 手順（SQL を流す）

`sql/testdata.sql` に**スキーマ + テストデータ**が1本で入っている。
上の ②③ の代わりにこれを流してもよい。

```sh
docker compose exec dev pnpm alt export --out data/definitions.json   # ① 定義（これは同じ）
docker compose exec dev sh -c 'sqlite3 data/alt.db < sql/testdata.sql'
```

- ファイルの中身は **`alt apply` + `alt seed` と1行も違わない**（同じ定義・同じ固定シードから
  作っていて、`packages/cli/src/dump.test.ts` が一致を見張っている）
- **何度流してもよい**。先頭に `DROP TABLE IF EXISTS` が並んでいるので、
  流すたびに作り直しになる（`--recreate` + `--reset` に当たる）
- 全体が1つのトランザクションなので、途中で失敗すれば何も残らない
- コンテナの外（ホスト）から流してもよい。リポジトリは bind mount されているので
  `sqlite3 data/alt.db < sql/testdata.sql` で同じことになる

### どちらを使うか

**基本は `alt seed`。** コマンドが1本増えるだけで、SQL を経由しない分だけ確実。
SQL が要るのは次のようなとき:

- コンテナを立てずに DB だけ先に作りたい
- DB ビューアや他のツールに読ませたい
- 何が入るのかを**目で読んで**から流したい

## SQL を作り直す

`sql/testdata.sql` は**生成物**。手で編集しない。

```sh
# コミットするもの。**ホスト側にリダイレクトする**（下の ⚠ を参照）
docker compose exec -T dev pnpm --silent alt dump > sql/testdata.sql

docker compose exec dev pnpm alt dump --deals 10000 --out /tmp/big.sql   # 1万件版（数MB。コミットしない）
docker compose exec dev pnpm alt dump                                    # 中身を見るだけ
```

`alt dump` は **DB を触らない**。インメモリの SQLite に定義を適用してシードを流し、
その結果を読み出して SQL にする。だから「SQL を見ただけで手元のデータが消えた」は起きない。

> ⚠ **`--out` でリポジトリ内に書くと root 所有のファイルができる**（コンテナが root で
> 動いていて、リポジトリは bind mount なので）。ホストから編集も削除もできなくなるため、
> **コミットする生成物は `--out` を使わずリダイレクトで作る**。
> `--silent` は pnpm がコマンド行を stdout に echo するのを止めるためで、
> 付け忘れると SQL の先頭に `$ tsx ...` が混ざる。
> 既に root 所有にしてしまったら `docker compose exec dev chown $(id -u):$(id -g) <path>`。

> **定義を変えたら出し直す。** 忘れると `pnpm verify` が
> 「コミットしてある sql/testdata.sql が定義と一致している」で落ちる
> （生成物をリポジトリに置く以上、黙って古くなるのを機械で塞いである）。

## つまずくところ

| 症状 | 原因と対処 |
|---|---|
| API が 404 を返す / テーブルが無いと言われる | `data/definitions.json` が無い。`alt export --out data/definitions.json` |
| 定義を足したのに API に出ない | サーバは**起動時に1回**しか定義を読まない。`pnpm serve` を上げ直す |
| `ERR_MODULE_NOT_FOUND` | コンテナを作り直して `node_modules` が空。README の対処（`rm -f node_modules/.pnpm-workspace-state-v1.json node_modules/.package-map.json && pnpm install`） |
| `alt apply` が「既存のテーブルがある」と止まる | 差分適用は持っていない。作り直してよければ `--recreate` |
| ホストから `localhost:3100` / `5273` に繋がらない | ポートはホスト側でずらしてある（3000/5173 は別プロジェクトが使用中のため）。`docker compose ps` で確認 |

## この構成について

- **DB は SQLite**（`data/alt.db`）。プロトタイプはローカルで動けばよく、インフラは決めていない
  （`docs/product-concept.md` §8-1）。本番は Go + PostgreSQL の想定なので、
  `sql/testdata.sql` も SQLite 方言に固定してある
- **認証は実装していない**。`X-Dev-User` ヘッダでの詐称で代用し、本番ビルドには
  コードごと含めない方針（`docs/implementation.md` 決定8）
- 開発の入口は `docs/implementation.md`（実装ハブ）。このファイルは「動かすまで」だけを扱う
