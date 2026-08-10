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
    // フェーズ8（§8-2 論点12 の解決）で、フロー定義の viewers として参加するようになった。
    // フェーズ11 決定A で、やりとりへの追記だけ開いた（案件は依然として直せない）
    note: '全案件を読めるが直せない。やりとりには書ける（viewers）',
  },
  {
    email: 'mori@example.com',
    name: '森 次郎（制作担当）',
    // フェーズ11 決定C で営業フローの viewers に入った（受注後の引き継ぎを受ける側）。
    // ⚠ これで**客先の定義に「403 になる人」が居なくなった** — 引き継ぎ先は無く、
    //    非参加の 403 は `authz.test.ts` の純関数テストだけが守っている
    note: '受注した求人広告の引き継ぎを受ける。案件は読めるが直せない（viewers）',
  },
  {
    email: 'kubo@example.com',
    name: '久保 綾（MEO運用担当）',
    // 引き継ぎ先は商材で分かれる。MEO の受注案件（d-yamada-meo）のやりとりに居るのはこの人
    note: '受注した MEO の引き継ぎを受ける。案件は読めるが直せない（viewers）',
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
