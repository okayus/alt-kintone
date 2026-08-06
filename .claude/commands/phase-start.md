---
description: 実装フェーズに着手する。読む範囲を最小に保ち、概要しか無いフェーズは詳細化してから実装に入る
argument-hint: [フェーズ番号]
---

フェーズ $ARGUMENTS に着手する。以下の手順で進めること。

1. `docs/implementation.md`（ハブ）を読み、現在地・「実装中ずっと効く決定」10項目・「作らないもの」を確認する
2. ハブの現在地表からフェーズ $ARGUMENTS のファイル（`docs/impl/phase-*.md`）を開く。**他のフェーズのファイルと、ドキュメントマップにある docs は必要になるまで読まない**
3. phase ファイルが「概要と完了条件だけ」の状態なら、実装より先に詳細化する:
   - ハブのドキュメントマップを頼りに、必要な docs の**該当セクションだけ**読んでタスクを具体化する
   - 詳細化した内容は phase ファイル自体に書き込み、ユーザーのレビューを受けてから実装に入る
4. 実装ループ: 編集 → `docker compose exec dev pnpm verify`。作業はすべてコンテナ内で行う
5. パッケージを新設したときの追記漏れ（compose の匿名ボリューム / `tsconfig.json` の `paths` / `vite.config.ts` の `resolve.alias` / `tsx` の `--tsconfig`）は、verify 先頭の `check:wiring` が検知して落とす。`pnpm install` は hook が自動で流す
6. 実装中に設計判断が発生したら、その場で `docs/product-concept.md` §8-2 に追記する（フェーズ完了まで溜めない）。仕様と実装が食い違ったら仕様を疑い、仕様側の doc を直す
