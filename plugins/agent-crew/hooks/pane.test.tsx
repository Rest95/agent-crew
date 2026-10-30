import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { LEDGER, PLAN_PATH, bash, finish, spawn, start, world } from './fixtures'
import { call, submit } from './fixtures'

const pane = (surface: 'terminal' | 'desktop', bodyColumns = 60, view: { agentId?: string } = {}) =>
  ({
    plugin: 'agent-crew',
    surface,
    component: 'Pane',
    requestId: 'agent-crew',
    props: { title: 'Agents', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view },
  }) as const

// A three-task plan with task 1 complete and task 2's implementer at work.
async function midPlan($: Engine, on: Parameters<typeof world>[0]) {
  const w = world(on)
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b, review clean)\n`)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't2', 'Implement Task 2: Background jobs')
  return w
}

test('terminal: a line under the header, then the tasks with the current one open', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(pane('terminal'))
  for (const text of [/Tasks 1\/3/, /^─+$/, /2\. Background jobs/, /implementing/]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /Now ·|Plan ·/ })).toBeUndefined()
  await ui.unmount()
})

test('desktop: the plan bar and a walking engineer are drawn', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(pane('desktop'))
  const sources = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source))
  expect(sources.some(s => s.includes('Tasks 1/3'))).toBe(true)
  expect(sources.some(s => s.includes('class="c-careful run"'))).toBe(true)
  await ui.unmount()
})

test('no plan: a plain list of agents', async ($, on) => {
  world(on, {})
  await spawn($, 'x1', 'Find the payment rules', 'Explore')
  await finish($, 'a-x1')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ key: 'finished' })).toBeDefined()
  expect((await ui.find({ key: 'finished' }))?.props.label).toMatch(/Finished · 1/)
  expect(await ui.find({ type: 'Text', text: /Find the payment rules/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Plan ·/ })).toBeUndefined()
  await ui.unmount()
})

test('the Finished button folds the finished rows away', async ($, on) => {
  world(on, {})
  await spawn($, 'x1', 'Find the payment rules', 'Explore')
  await finish($, 'a-x1')
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'finished' })
  expect(await ui.find({ type: 'Text', text: /Find the payment rules/ })).toBeUndefined()
  await ui.unmount()
})

test('terminal: a narrow pane still draws', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(pane('terminal', 40))
  expect(await ui.find({ type: 'Text', text: /Tasks 1\/3/ })).toBeDefined()
  await ui.unmount()
})

test('inline mode: the main-session row leaves once its task is complete', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/task-start ${PLAN_PATH} 1`)
  const before = await $.ui.mount(pane('terminal'))
  expect(await before.find({ type: 'Text', text: /Main session · Task 1/ })).toBeDefined()
  await before.unmount()
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b, tests: pnpm test → ok)\n`)
  await bash($, `scripts/task-done ${PLAN_PATH} 1 abc123 -- pnpm test`)
  const after = await $.ui.mount(pane('terminal'))
  expect(await after.find({ type: 'Text', text: /Main session · Task 1/ })).toBeUndefined()
  await after.unmount()
})

// --- Click an agent to view its transcript

test('terminal: pressing an agent row puts its transcript in view', async ($, on) => {
  const w = await midPlan($, on)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'view-a-t2' })
  expect(w.views).toEqual([{ agentId: 'a-t2' }])
  await ui.unmount()
})

test('while an agent is in view: its row says so, and Back to main returns', async ($, on) => {
  const w = await midPlan($, on)
  const ui = await $.ui.mount(pane('terminal', 60, { agentId: 'a-t2' }))
  expect(await ui.find({ type: 'Text', text: /◀ viewing/ })).toBeDefined()
  await ui.press({ key: 'view-main' })
  await ui.press({ key: 'view-a-t2' })
  expect(w.views).toEqual([{}, {}])
  await ui.unmount()
})

test('an agent the engine cannot show any more: a toast says so', async ($, on) => {
  const w = await midPlan($, on)
  w.viewDenied = true
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'view-a-t2' })
  expect(w.toasts.some(t => /isn't available/.test(t))).toBe(true)
  await ui.unmount()
})

test('desktop: each agent row has a View button', async ($, on) => {
  const w = await midPlan($, on)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'view-a-t2' }))?.props.label).toBe('View')
  await ui.press({ key: 'view-a-t2' })
  expect(w.views).toEqual([{ agentId: 'a-t2' }])
  await ui.unmount()
})

// --- Livelier at rest

test('the panel opens on the terminal background, not a grey fill', async ($, on) => {
  const w = await midPlan($, on)
  expect(w.openArgs.every(o => o.backgroundColor === 'transparent')).toBe(true)
})

test('terminal: the plan in violet; waiting tasks in normal text with a violet mark', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^Payments$/ }))?.props.color).toBe('suggestion')
  expect((await ui.find({ type: 'Text', text: /^◷$/ }))?.props.color).toBe('suggestion')
  expect((await ui.find({ type: 'Text', text: /^3\.$/ }))?.props.color).toBe('suggestion')
  const waiting = await ui.find({ type: 'Text', text: /Queue screen/ })
  expect(waiting).toBeDefined()
  expect(waiting?.props.dimColor).toBeFalsy()
  await ui.unmount()
})

// --- Grouped by task

test('a closed task opens on a press and shows its agents', async ($, on) => {
  const w = world(on)
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\n`)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't1', 'Review Task 1 (spec + quality)')
  await finish($, 'a-t1')
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b)\n`)
  await spawn($, 't2', 'Implement Task 2: Background jobs')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /reviewing/ })).toBeUndefined()
  await ui.press({ key: 'group-t1' })
  expect(await ui.find({ type: 'Text', text: /reviewing/ })).toBeDefined()
  await ui.press({ key: 'group-t1' })
  expect(await ui.find({ type: 'Text', text: /reviewing/ })).toBeUndefined()
  await ui.unmount()
})

test('agents outside the plan sit in a closed Other agents group', async ($, on) => {
  await midPlan($, on)
  await spawn($, 'x1', 'Find the payment rules', 'Explore')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /Other agents/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Find the payment rules/ })).toBeUndefined()
  await ui.press({ key: 'group-other' })
  expect(await ui.find({ type: 'Text', text: /Find the payment rules/ })).toBeDefined()
  await ui.unmount()
})

test('desktop: a task opens on its button, showing its agents', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'group-t2' }))?.props.label).toMatch(/^▾/)
  expect((await ui.findAll({ type: 'Svg' })).some(el => /implementing/.test(String(el.props.alt)))).toBe(true)
  await ui.press({ key: 'group-t2' })
  expect((await ui.findAll({ type: 'Svg' })).some(el => /implementing/.test(String(el.props.alt)))).toBe(false)
  await ui.unmount()
})

test('a task closed by hand opens again when a new agent starts on it', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'group-t2' })
  expect(await ui.find({ type: 'Text', text: /implementing/ })).toBeUndefined()
  await ui.unmount()
  await spawn($, 'r2', 'Review Task 2 (spec + quality)')
  const again = await $.ui.mount(pane('terminal'))
  expect(await again.find({ type: 'Text', text: /reviewing/ })).toBeDefined()
  await again.unmount()
})

test('a new session starts with every task at its default', async ($, on) => {
  const w = world(on)
  on('state.get', (_$, e, next) =>
    (e as { key?: string }).key === 'openGroups' ? ({ value: { value: { t2: false }, version: 1 } } as never) : next(e),
  )
  await start($)
  await w.clock.settle()
  expect(w.stored.get('openGroups')).toEqual({})
})

test('terminal: each agent under a task shows its own name, then its role and model spaced from its status', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /Implement Task 2: Background jobs/ })).toBeDefined()
  const details = await ui.find({ type: 'Text', text: /^\s*implementing · / })
  expect(details?.text).toMatch(/^\s*implementing · Sonnet 5\.5(?: · \S+)? · ● /)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Everyday mode

test("terminal: Claude's task list shows as the plan", async ($, on) => {
  world(on)
  await submit($, 'Add CSV export to the reports page')
  await call($, 'TaskCreate', { subject: 'Add the CSV writer', description: 'd' })
  await call($, 'TaskCreate', { subject: 'Wire the export button', description: 'd' })
  await call($, 'TaskUpdate', { taskId: '1', status: 'in_progress' })
  await spawn($, 't1', 'Write the CSV writer')
  const ui = await $.ui.mount(pane('terminal'))
  for (const text of [/Add CSV export/, /Claude's task list/, /Tasks 0\/2/, /Write the CSV writer/]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Other agents/ })).toBeUndefined()
  await ui.unmount()
})

test('terminal: a running agent shows what it is doing', async ($, on) => {
  world(on)
  await spawn($, 't1', 'Look around')
  await call($, 'Edit', { file_path: '/repo/payments/lib/a.ts' }, 'a-t1')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /✎ Editing lib\/a\.ts/ })).toBeDefined()
  await ui.unmount()
})

test('terminal: a superpowers agent shows its action too', async ($, on) => {
  await midPlan($, on)
  await call($, 'Edit', { file_path: '/repo/payments/jobs.ts' }, 'a-t2')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /✎ Editing jobs\.ts/ })).toBeDefined()
  await ui.unmount()
})

test('terminal: no task list', async ($, on) => {
  world(on)
  await spawn($, 't1', 'One')
  await spawn($, 't2', 'Two')
  await finish($, 'a-t1')
  const ui = await $.ui.mount(pane('terminal'))
  for (const text of [/2 agents · 1 working · 1 done/, /1\/2 done/, /Working · 1/]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
  expect((await ui.find({ key: 'finished' }))?.props.label).toMatch(/Finished · 1/)
  await ui.unmount()
})

test("a superpowers plan wins over Claude's list", async ($, on) => {
  await midPlan($, on)
  await call($, 'TaskCreate', { subject: 'Something', description: 'd' })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /Payments/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Claude's task list/ })).toBeUndefined()
  await ui.unmount()
})

test('terminal: no task list and nothing working draws one line, not two', async ($, on) => {
  world(on)
  await spawn($, 't1', 'One')
  await finish($, 'a-t1')
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.findAll({ type: 'Text', text: /^─+$/ })).length).toBe(1)
  await ui.unmount()
})

test("a finished superpowers plan gives way to Claude's new task list", async ($, on) => {
  const w = world(on)
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete\nTask 2: complete\nTask 3: complete\n`)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await submit($, 'Follow-up work')
  await call($, 'TaskCreate', { subject: 'Next thing', description: 'd' })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /Claude's task list/ })).toBeDefined()
  await ui.unmount()
})

test('terminal: a finished agent still opens its transcript', async ($, on) => {
  const w = world(on)
  await spawn($, 't1', 'One')
  await finish($, 'a-t1')
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'view-a-t1' })
  expect(w.views).toEqual([{ agentId: 'a-t1' }])
  await ui.unmount()
})

test('desktop: a finished agent is one line, and opens its transcript', async ($, on) => {
  const w = world(on)
  await spawn($, 't1', 'One')
  await finish($, 'a-t1')
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'view-a-t1' }))?.props.label).toMatch(/^✓ One {2}general-purpose/)
  await ui.press({ key: 'view-a-t1' })
  expect(w.views).toEqual([{ agentId: 'a-t1' }])
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Colours follow the person's theme

// Picked for dark backgrounds: unreadable on a light one, so never painted on terminal text.
const DARK_ONLY = ['#8f8cf4', '#e8c66a', '#5fbf8f', '#4fb3a9', '#e2a94e', '#e0846b', '#4caf6e', 'white', 'green', 'red']

test('terminal: the panel paints with theme colours', async ($, on) => {
  world(on)
  await spawn($, 't1', 'One')
  await spawn($, 't2', 'Two')
  await call($, 'Edit', { file_path: '/repo/payments/a.ts' }, 'a-t2')
  await finish($, 'a-t1')
  await finish($, 'a-t2', 'error')
  await spawn($, 't3', 'Three')
  await call($, 'Edit', { file_path: '/repo/payments/b.ts' }, 'a-t3')
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.findAll({ type: 'Text', text: /✎ Editing b\.ts/ })).some(t => t.props.color === 'warning')).toBe(true)
  for (const t of await ui.findAll({ type: 'Text' })) expect(DARK_ONLY).not.toContain(t.props.color)
  await ui.unmount()
})

test('terminal: a plan paints with theme colours, done and all', async ($, on) => {
  const w = world(on)
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete\nTask 2: complete\nTask 3: complete\n`)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't1', 'Implement Task 1: API client')
  await finish($, 'a-t1')
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^█+$/ }))?.props.color).toBe('success')
  for (const t of await ui.findAll({ type: 'Text' })) expect(DARK_ONLY).not.toContain(t.props.color)
  await ui.unmount()
})

test('desktop: the divider is drawn, so it never wraps', async ($, on) => {
  world(on)
  await spawn($, 't1', 'One')
  const ui = await $.ui.mount(pane('desktop', 30))
  expect(await ui.find({ type: 'Text', text: /─/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Svg' })).some(el => el.props.alt === 'divider')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^1 agent · 1 working · 0 done$/ })).toBeDefined()
  await ui.unmount()
})
