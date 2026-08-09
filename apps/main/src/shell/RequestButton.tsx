/**
 * 起票の導線。docs/impl/phase-9-change-requests.md 論点D
 *
 * **どの画面からでも1クリック**（完了条件1）。シェルに常設するのは、
 * 困ったその場で出せないと結局スクショと口頭に戻るため。
 *
 * ⚠ 持ち回るのは**押した瞬間のハッシュ1本だけ**。これを URL（`?from=`）に載せるので、
 *    リロードしても対象が消えない。業務画面がシェルに状態を渡す仕組みは作らない
 *    （`requestContext.ts` の注記）。
 */
import { href, useRoute } from './router'

export function RequestButton() {
  const route = useRoute()
  // 起票画面から自分自身を起票させない（対象が「起票画面」になっても意味がない）
  if (route.name === 'requestNew') return null

  return (
    <a
      className="app-file-request"
      href={href.requestNew(window.location.hash)}
      title="いま見ている画面と、その状況を添えて起票する"
    >
      困りごとを出す
    </a>
  )
}
