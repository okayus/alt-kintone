# alt-kintone — 開発用イメージ。
#
#   docker compose up -d                -> "dev" ステージ。ソースを bind mount し常駐
#   docker compose exec dev pnpm test   -> コンテナ内でテスト実行
#
# 本番イメージは作らない。バックエンドは最終的に Go になり、TS版は仕様として
# 書き捨てるため（docs/product-concept.md §4-0）。

FROM node:24 AS base
# esbuild（vitest/tsx が内部で使う）と better-sqlite3 は install 時に
# ネイティブビルドが走る。素の node:24 には C++ ツールチェーンが無い。
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
# sqlite3 CLI。`alt dump` が書き出した SQL を流す口（docs/local-setup.md）と、
# DB の中身を覗く手段。無いと「使い捨てスクリプトを書いて実行する」しか無くなる。
# アプリ本体は better-sqlite3 で繋ぐので、これは開発の道具でしかない。
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
# vitest browser mode（apps/main のコンポーネントテスト）が使う実 Chromium。
# playwright にダウンロードさせず apt 版を executablePath で指す
# （apps/main/vite.config.ts）— playwright のバージョンとブラウザ実体の版結合を
# 避けるため。フォントはヘッドレスの日本語描画用（無いと豆腐になる）。
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-ipafont-gothic \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium
# playwright パッケージの postinstall（ブラウザDL）は使わない、の明示。
# pnpm-workspace.yaml の allowBuilds: playwright: false と対になる
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ---- Node と pnpm は mise が入れる（版の真実は mise.toml） ---------------------
# イメージ側の node:24 は「mise を動かすための土台」でしかなく、アプリが使う Node は
# 下の `mise install` が入れた版になる（shims を PATH の先頭に置いているため）。
#
#   MISE_*_DIR を ~ の外に置く … home をボリュームにしても隠れないようにするため
#   shims を PATH 先頭に      … `eval "$(mise activate)"` のシェル連携が要らなくなる
#                               （`mise doctor` は activated: no と出るが、それでよい）
#   MISE_TRUSTED_CONFIG_PATHS … これが無いと /app/mise.toml は「信頼されていない設定」
#                               として**黙って無視**され、イメージ側の Node が使われる。
#                               エラーで止まらないのでいちばん気づきにくい
ENV MISE_DATA_DIR=/usr/local/share/mise
ENV MISE_CONFIG_DIR=/usr/local/share/mise
ENV MISE_CACHE_DIR=/usr/local/share/mise/cache
ENV MISE_INSTALL_PATH=/usr/local/bin/mise
ENV PATH=/usr/local/share/mise/shims:$PATH
ENV MISE_TRUSTED_CONFIG_PATHS=/app
RUN curl -fsSL https://mise.run | sh

WORKDIR /app
# ビルド時に版を固定してしまう。build context がリポジトリ直下なので mise.toml を
# そのまま COPY でき、**版の pin は mise.toml の1箇所のまま**でいられる
# （コンテナ起動のたびに `mise install` を待たされることもない）。
# mise.toml を書き換えたら `docker compose build` をやり直すこと。
COPY mise.toml /app/mise.toml
RUN mise install

# ---- dev -------------------------------------------------------------------
# docker-compose がリポジトリを /app に bind mount する。`pnpm install` は
# イメージに焼かず、compose の command として実行する。
FROM base AS dev
# 将来 API と FE の dev サーバーを立てるときに使う
EXPOSE 3000 5173
