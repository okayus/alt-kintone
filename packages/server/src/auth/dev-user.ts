/**
 * 開発用のユーザー詐称。docs/product-concept.md §4-1
 *
 * ⚠ **本番ビルドにコードごと含めてはいけない。** 環境変数での切り替えにすると
 * 本番に残るリスクがあるので、ビルド時に落とす形にしてある — このモジュールを
 * import するのは dev エントリ（`main.ts`）だけで、app.ts より内側は知らない。
 * 本番エントリを作るときは、ここを import せず OIDC の実装を注入する。
 *
 * 認証（リクエスト → ユーザーIDの解決）の責務はここまで。可否の判定は authz.ts。
 */
import type { Authenticate } from '../authz.js'

export const DEV_USER_HEADER = 'x-dev-user'

/** ヘッダの値をそのまま利用者の識別子として返す。値の中身は `employee.email`。 */
export const devUserAuth: Authenticate = (headers) => headers[DEV_USER_HEADER]
