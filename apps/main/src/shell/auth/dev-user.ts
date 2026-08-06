/**
 * 開発用のユーザー詐称。docs/implementation.md 決定8
 *
 * ⚠ **本番ビルドにコードごと含めない。** サーバ側の `packages/server/src/auth/dev-user.ts`
 *    と同じ扱いで、このモジュールを import してよいのは dev エントリ（`src/main.tsx`）だけ。
 *    本番エントリを作るときは、ここではなく OIDC のトークンからヘッダを作る実装を
 *    `createClient` に渡す。api.ts はどちらも知らない。
 *
 * 候補を API から引かないのは「ユーザーを決めるためにユーザーが要る」ため。
 * `alt seed` が入れる固定 ID と同じ、**開発用の裏口**としてべた書きする。
 */

export interface DevUser {
  email: string
  name: string
  /** 画面で何が確認できるか。切り替える理由が分かるように持たせている。 */
  note: string
}

export const DEV_USERS: readonly DevUser[] = [
  { email: 'yamada@example.com', name: '山田 太郎（営業担当）', note: '自分の案件だけ編集できる' },
  { email: 'sato@example.com', name: '佐藤 花子（営業担当）', note: '山田の案件は編集できない' },
  {
    email: 'suzuki@example.com',
    name: '鈴木 一郎（営業マネージャー）',
    // docs/product-concept.md §8-2 論点12。認可を定義から導出した帰結で、
    // 「操作しないが見る」立場が表現できていない。画面で見える形にしてある
    note: '403 になる（どのステップも担当していないのでフローに参加できない）',
  },
  { email: 'admin@example.com', name: '管理者', note: '全案件を編集でき、強制遷移もできる' },
]

const STORAGE_KEY = 'alt.devUser'
const FALLBACK = DEV_USERS[0]?.email ?? ''

export function currentDevUser(): string {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored !== null && DEV_USERS.some((u) => u.email === stored)) return stored
  return FALLBACK
}

export function setDevUser(email: string): void {
  window.localStorage.setItem(STORAGE_KEY, email)
}

/** `createClient` に渡す。呼ばれるたびに読むので、切り替えが即座に効く。 */
export function devUserHeaders(): Record<string, string> {
  return { 'X-Dev-User': currentDevUser() }
}
