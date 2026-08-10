/**
 * validate の各ルールが実際に検出することを確かめる。
 *
 * 検査対象は客先定義ではなく、ここで組み立てた**最小の正しい定義**。客先定義を
 * 壊して回すと、定義が育つたびにテストが巻き添えで壊れる。客先定義に対しては
 * 「通ること」だけを見る。
 */
import { loadBundle } from './bundle.js'
import { validate, type ValidationError } from './validate.js'
import {
  bind,
  check,
  flow,
  manualCheck,
  reference,
  registry,
  role,
  ROOT_SOURCE,
  step,
  table,
  text,
  uuid,
  type AutoCheck,
  type DefinitionBundle,
  type Pred,
} from '@alt/dsl'
import { describe, expect, it } from 'vitest'

const person = table(
  'person',
  {
    id: uuid('ID').primaryKey(),
    name: text('氏名').required(),
  },
  { label: '人' },
)

const task = table(
  'task',
  {
    id: uuid('ID').primaryKey(),
    title: text('タイトル').required(),
    ownerId: reference('person', '担当').required(),
  },
  { label: 'タスク' },
)

const titled: Pred = {
  type: 'isNotNull',
  operand: { type: 'field', source: ROOT_SOURCE, path: ['title'] },
}

const TEMPLATE: DefinitionBundle = {
  tables: registry(task, person),
  flows: [
    flow({
      key: 'work',
      name: '作業',
      goal: '完了',
      target: task,
      initial: 'todo',
      steps: [
        step({
          key: 'todo',
          name: '未着手',
          intent: '作業を始められる状態にする',
          roles: ['worker'],
          reads: [person],
          writes: [task],
          exit: [check('titled', 'タイトルが入っている', 'タイトルを入れると充足する', titled)],
          next: ['done'],
        }),
        step({
          key: 'done',
          name: '完了',
          intent: '作業が終わった',
          roles: ['worker'],
          writes: [task],
          exit: [],
          next: [],
        }),
      ],
      bindings: [bind(task, 'primary', '作業対象'), bind(person, 'reference', '担当者')],
    }),
  ],
  roles: [role('worker', '作業者', 'タスクを進める')],
}

/** 定義はただの JSON なので、複製すればテストごとに独立して壊せる。 */
const base = (): DefinitionBundle => structuredClone(TEMPLATE)

function broken(mutate: (bundle: DefinitionBundle) => void): ValidationError[] {
  const bundle = base()
  mutate(bundle)
  return validate(bundle)
}

const rules = (errors: readonly ValidationError[]): string[] => errors.map((e) => e.rule)

/** 型が通らない壊し方をするための逃げ道。壊れた定義こそが検査対象なので要る。 */
const anyway = <T>(value: unknown): T => value as T

describe('正しい定義は通る', () => {
  it('最小の定義', () => {
    expect(validate(base())).toEqual([])
  })

  it('客先定義（@alt/definitions）', () => {
    expect(validate(loadBundle())).toEqual([])
  })
})

describe('層1: 構文', () => {
  it('schema — 壊れた条件式 AST を、フロー・ステップ・チェックのキーで位置指定する', () => {
    const errors = broken((b) => {
      anyway<AutoCheck>(b.flows[0]?.steps[0]?.exit[0]).condition = anyway<Pred>({
        type: 'compare',
        op: 'equals',
        left: { type: 'literal', value: 1 },
        right: { type: 'literal', value: 2 },
      })
    })
    expect(rules(errors)).toEqual(['schema'])
    // Pred は8ノードの union。候補ごとに8件出す、ということが起きていない
    expect(errors[0]?.where).toMatchObject({
      flow: 'work',
      step: 'todo',
      check: 'titled',
      at: 'condition.op',
    })
  })

  it('registry-key-mismatch', () => {
    const errors = broken((b) => {
      b.tables = { tasks: anyway(task), person: anyway(person) }
    })
    expect(rules(errors)).toContain('registry-key-mismatch')
  })

  it('duplicate-flow-key', () => {
    const errors = broken((b) => {
      b.flows = [anyway(b.flows[0]), anyway(structuredClone(b.flows[0]))]
    })
    expect(rules(errors)).toContain('duplicate-flow-key')
  })

  it('duplicate-role-key', () => {
    const errors = broken((b) => {
      b.roles.push(role('worker', '別名', '重複したキー'))
    })
    expect(rules(errors)).toContain('duplicate-role-key')
  })

  it('構文が壊れているときは参照整合・業務ルールを走らせない', () => {
    const errors = broken((b) => {
      // initial の実在は flowDefSchema（構文層）が見ている。同時に全ステップが
      // 到達不能（業務ルール層）になるが、そちらは走らない
      anyway<{ initial: string }>(b.flows[0]).initial = 'nowhere'
    })
    expect(rules(errors)).toEqual(['schema'])
  })
})

describe('層2: 参照整合', () => {
  it('unknown-reference-table', () => {
    const errors = broken((b) => {
      anyway<{ references?: string }>(b.tables['task']?.fields['ownerId']).references = 'ghost'
    })
    expect(rules(errors)).toContain('unknown-reference-table')
  })

  it('unknown-flow-target', () => {
    const errors = broken((b) => {
      anyway<{ target: string }>(b.flows[0]).target = 'ghost'
    })
    expect(rules(errors)).toContain('unknown-flow-target')
  })

  it('unknown-step-table', () => {
    const errors = broken((b) => {
      anyway<{ reads: string[] }>(b.flows[0]?.steps[0]).reads = ['ghost']
    })
    expect(rules(errors)).toContain('unknown-step-table')
  })

  it('unknown-binding-table', () => {
    const errors = broken((b) => {
      anyway<{ table: string }>(b.flows[0]?.bindings[1]).table = 'ghost'
    })
    expect(rules(errors)).toContain('unknown-binding-table')
  })

  it('unknown-step-role — どのロールが不正かを where に載せる', () => {
    const errors = broken((b) => {
      anyway<{ roles: string[] }>(b.flows[0]?.steps[0]).roles = ['worker', 'ghost']
    })
    const error = errors.find((e) => e.rule === 'unknown-step-role')
    expect(error?.where).toMatchObject({ flow: 'work', step: 'todo', role: 'ghost' })
  })

  it('unknown-flow-viewer', () => {
    const errors = broken((b) => {
      anyway<{ viewers: string[] }>(b.flows[0]).viewers = ['ghost']
    })
    expect(rules(errors)).toContain('unknown-flow-viewer')
  })

  it('step-without-role — 担当が居ないステップは管理者しか進められない', () => {
    const errors = broken((b) => {
      anyway<{ roles: string[] }>(b.flows[0]?.steps[0]).roles = []
    })
    expect(rules(errors)).toContain('step-without-role')
  })

  it('viewer-also-operates — 担当ロールを viewers に書くと曖昧になる', () => {
    const errors = broken((b) => {
      anyway<{ viewers: string[] }>(b.flows[0]).viewers = ['worker']
    })
    const error = errors.find((e) => e.rule === 'viewer-also-operates')
    expect(error?.where).toMatchObject({ flow: 'work', viewer: 'worker' })
    expect(error?.message).toContain('todo')
  })

  it('append-by-participants-without-viewers — 開ける相手が居ない宣言', () => {
    // 追記を「参加者全員」に開いても、viewers が居なければ担当ロールと管理者しか
    // 居ない ＝ 宣言が何も変えていない（フェーズ11 決定A）
    const errors = broken((b) => {
      anyway<{ appendBy: string }>(b.flows[0]?.bindings[0]).appendBy = 'participants'
    })
    const error = errors.find((e) => e.rule === 'append-by-participants-without-viewers')
    expect(error?.where).toMatchObject({ flow: 'work', table: 'task' })
    expect(error?.hint).toContain('viewers')

    // viewers が居れば通る
    const ok = broken((b) => {
      anyway<{ appendBy: string }>(b.flows[0]?.bindings[0]).appendBy = 'participants'
      anyway<{ viewers: string[] }>(b.flows[0]).viewers = ['watcher']
      b.roles.push(role('watcher', '見る人', '進捗を見る'))
    })
    expect(rules(ok)).not.toContain('append-by-participants-without-viewers')
  })

  it('unknown-next-step — 候補を hint に並べる', () => {
    const errors = broken((b) => {
      anyway<{ next: string[] }>(b.flows[0]?.steps[0]).next = ['don']
    })
    const error = errors.find((e) => e.rule === 'unknown-next-step')
    expect(error?.where).toMatchObject({ flow: 'work', step: 'todo' })
    expect(error?.hint).toContain('done')
  })

  it('unresolved-condition — 存在しないフィールドを参照している', () => {
    const errors = broken((b) => {
      anyway<AutoCheck>(b.flows[0]?.steps[0]?.exit[0]).condition = {
        type: 'isNotNull',
        operand: { type: 'field', source: ROOT_SOURCE, path: ['ghost'] },
      }
    })
    const error = errors.find((e) => e.rule === 'unresolved-condition')
    expect(error?.message).toContain('task.ghost')
    expect(error?.where).toMatchObject({ check: 'titled' })
  })

  it('target が解決できないときは条件式のエラーを重ねて出さない', () => {
    const errors = broken((b) => {
      anyway<{ target: string }>(b.flows[0]).target = 'ghost'
    })
    expect(rules(errors)).not.toContain('unresolved-condition')
  })
})

describe('層3: 業務ルール', () => {
  it('target-not-primary', () => {
    const errors = broken((b) => {
      anyway<{ role: string }>(b.flows[0]?.bindings[0]).role = 'reference'
    })
    expect(rules(errors)).toContain('target-not-primary')
  })

  it('step-without-exit — next があるのに出口条件が無い', () => {
    const errors = broken((b) => {
      anyway<{ exit: unknown[] }>(b.flows[0]?.steps[0]).exit = []
    })
    expect(rules(errors)).toContain('step-without-exit')
  })

  it('step-without-exit — next が空の決着ステップは免除（論点10 の決着）', () => {
    // TEMPLATE の 'done' は exit も next も空。これが通ることが免除の証明
    expect(base().flows[0]?.steps[1]).toMatchObject({ key: 'done', exit: [], next: [] })
    expect(validate(base())).toEqual([])
  })

  it('unreachable-step', () => {
    const errors = broken((b) => {
      // next を空にすると step-without-exit のほうは免除されるので、到達不能だけが残る
      anyway<{ next: string[] }>(b.flows[0]?.steps[0]).next = []
    })
    expect(rules(errors)).toEqual(['unreachable-step'])
  })

  it('undeclared-table', () => {
    const errors = broken((b) => {
      anyway<{ bindings: unknown[] }>(b.flows[0]).bindings = [bind(task, 'primary', '作業対象')]
    })
    expect(rules(errors)).toContain('undeclared-table')
  })

  it('undeclared-table — global なテーブルは宣言不要（§3-4 の案C）', () => {
    const errors = broken((b) => {
      b.tables['person'] = table(
        'person',
        { id: uuid('ID').primaryKey() },
        { label: '人', global: true },
      )
      anyway<{ bindings: unknown[] }>(b.flows[0]).bindings = [bind(task, 'primary', '作業対象')]
    })
    expect(rules(errors)).not.toContain('undeclared-table')
  })

  it('unused-binding', () => {
    const errors = broken((b) => {
      anyway<{ reads: string[] }>(b.flows[0]?.steps[0]).reads = []
    })
    expect(rules(errors)).toContain('unused-binding')
  })

  it('duplicate-exit-key', () => {
    const errors = broken((b) => {
      anyway<{ exit: unknown[] }>(b.flows[0]?.steps[0]).exit.push(
        manualCheck('titled', '同じキーの手動チェック', '重複キーの検査用'),
      )
    })
    expect(rules(errors)).toContain('duplicate-exit-key')
  })

  it('orphan-table — どのフローからも使われていない', () => {
    const errors = broken((b) => {
      b.tables['memo'] = table('memo', { id: uuid('ID').primaryKey() }, { label: 'メモ' })
    })
    expect(rules(errors)).toEqual(['orphan-table'])
  })
})
