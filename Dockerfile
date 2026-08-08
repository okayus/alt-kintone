# alt-kintone — 開発用イメージ。
#
#   docker compose up -d                -> "dev" ステージ。ソースを bind mount し常駐
#   docker compose exec dev pnpm test   -> コンテナ内でテスト実行
#
# 本番イメージは作らない。バックエンドは最終的に Go になり、TS版は仕様として
# 書き捨てるため（docs/product-concept.md §4-0）。

FROM node:24 AS base
# corepack は未取得のパッケージマネージャを落とす前に対話確認を求める。
# 非対話（docker compose up -d）だと install がその場で止まり続けるので無効化する。
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# esbuild（vite-plus/tsx/vitest が内部で使う）と better-sqlite3 は install 時に
# ネイティブビルドが走る。素の node:24 には C++ ツールチェーンが無い。
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
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
WORKDIR /app

# ---- dev -------------------------------------------------------------------
# docker-compose がリポジトリを /app に bind mount する。`pnpm install` は
# イメージに焼かず、compose の command として実行する。
FROM base AS dev
# 将来 API と FE の dev サーバーを立てるときに使う
EXPOSE 3000 5173
