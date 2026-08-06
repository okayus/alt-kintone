/**
 * ロール定義。docs/domain-model.md §7、docs/product-concept.md §4-1
 *
 * 認可は業務フロー定義から導出するので、ここに権限は書かない
 * （kintone は権限設定が別画面にあって業務と乖離する。それを避けるのが要点）。
 * ロールが持つのは「誰か」の一覧だけで、何ができるかはステップの `role` で決まる。
 *
 * **ロールは定義で宣言（型になる）、ユーザーへの割当はデータ**（従業員マスタ）。
 * 宣言をコードに置くことで、存在しないロールを参照するステップを validate で弾ける。
 */
import { z } from 'zod'

export interface RoleDef {
  key: string
  name: string
  /** 何を担当するか。管理画面と生成FEの説明文に使う。 */
  description: string
}

export function role(key: string, name: string, description: string): RoleDef {
  return { key, name, description }
}

export const roleDefSchema: z.ZodType<RoleDef> = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
})
