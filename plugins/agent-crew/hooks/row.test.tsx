import { expect, test } from 'claude-code/testing'

import type { Engine } from 'claude-code/testing'

import { LEDGER, PLAN_PATH, START, bash, finish, main, mainEnd, mainTurn, request, spawn, start, world } from './fixtures'
import { call, submit } from './fixtures'

const HOUR = 3_600_000

test('session start: the configured model and the branch', async ($, on) => {
  const w = world(on)
  await start($)
  // The branch is read beside the start, never in its way.
  await w.clock.settle()
  expect(main(w)).toMatchObject({ model: 'claude-opus-5-5', branch: 'feat/payments' })
})

test('outside a git repository there is no branch', async ($, on) => {
  const w = world(on)
  w.branch = null
  await start($)
  await w.clock.settle()
  expect(main(w)?.branch).toBeNull()
})

test('a main turn makes the session busy; its answer starts the hour', async ($, on) => {
  const w = world(on)
  await mainTurn($, 'start')
  expect(main(w)?.busy).toBe(true)
  await mainTurn($, 'complete')
  expect(main(w)).toMatchObject({ busy: false, expiresAt: START + HOUR, context: 34, warned: 0 })
})

test("a subagent's turns never move the main session", async ($, on) => {
  const w = world(on)
  await mainTurn($, 'complete')
  const before = main(w)
  await ($.turn.start as (e: unknown) => Promise<unknown>)({ text: 'sub', turnId: 's1', agentId: 'a-1' })
  await finish($, 'a-1')
  expect(main(w)).toMatchObject({ busy: false, expiresAt: before?.expiresAt, context: before?.context })
})

test('the cache warns at 10 and 5 minutes left, once each', async ($, on) => {
  const w = world(on)
  await start($)
  await mainTurn($, 'complete')
  await w.clock.advance(HOUR - 591_000)
  expect(w.notified).toEqual(['payments: Prompt cache expires in 10 min'])
  await w.clock.advance(300_000)
  expect(w.notified).toEqual(['payments: Prompt cache expires in 10 min', 'payments: Prompt cache expires in 5 min'])
  await w.clock.advance(60_000)
  expect(w.notified).toHaveLength(2)
})

test('a new answer warns again', async ($, on) => {
  const w = world(on)
  await start($)
  await mainTurn($, 'complete')
  await w.clock.advance(HOUR - 591_000)
  await mainTurn($, 'start')
  await mainTurn($, 'complete')
  await w.clock.advance(HOUR - 591_000)
  expect(w.notified).toEqual(['payments: Prompt cache expires in 10 min', 'payments: Prompt cache expires in 10 min'])
})

test('a notification that is not delivered becomes a toast', async ($, on) => {
  const w = world(on)
  w.pushes = false
  await start($)
  await mainTurn($, 'complete')
  await w.clock.advance(HOUR - 591_000)
  expect(w.toasts).toEqual(['⏳ payments: Prompt cache expires in 10 min'])
})

test('no warning while a turn runs', async ($, on) => {
  const w = world(on)
  await start($)
  await mainTurn($, 'complete')
  await mainTurn($, 'start')
  await w.clock.advance(HOUR - 300_000)
  expect(w.notified).toEqual([])
})

test('after a reload, a warning already given is not given again', async ($, on) => {
  const w = world(on)
  on('state.get', (_$, e, next) =>
    (e as { key?: string }).key === 'main'
      ? ({ value: { value: { model: null, effort: null, branch: null, context: null, busy: false, expiresAt: START + 590_000, warned: 10, rowHidden: false, planDoneAt: null, lastServedAt: null }, version: 1 } } as never)
      : next(e),
  )
  await start($)
  await w.clock.advance(1_000)
  expect(w.notified).toEqual([])
})

test('/crew row hides and shows the row', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await $.command.run({ command: 'crew', args: 'row' } as never)).toMatchObject({ text: 'Crew row hidden.' })
  expect(main(w)?.rowHidden).toBe(true)
  expect(await $.command.run({ command: 'crew', args: 'row' } as never)).toMatchObject({ text: 'Crew row shown.' })
  expect(main(w)?.rowHidden).toBe(false)
})

// --- The row itself

const row = (surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  ({
    plugin: 'agent-crew',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  }) as const

// Task 1 of 3 complete, task 2's implementer at work, one answer given.
async function midPlan($: Engine, on: Parameters<typeof world>[0]) {
  const w = world(on)
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b)\n`)
  await start($)
  await mainTurn($, 'complete')
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't2', 'Implement Task 2: Background jobs')
  return w
}

test('terminal: progress, model, branch, context and cache in one row', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(row('terminal'))
  for (const text of [/Tasks 1\/3/, /1 working/, /Opus 5\.5/, /feat\/payments/, /34%/, /\d\d:\d\d/]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  await ui.unmount()
})

test('desktop: the plan bar and the cache hourglass are drawn', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(row('desktop'))
  const sources = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source))
  expect(sources.some(s => s.includes('Tasks 1/3'))).toBe(true)
  expect(sources.some(s => s.includes('#4fb3a9'))).toBe(true)
  await ui.unmount()
})

test('agents without a plan: how many work and how many are done', async ($, on) => {
  world(on, {})
  await start($)
  await spawn($, 'x1', 'Find the payment rules', 'Explore')
  await spawn($, 'x2', 'Check the queue', 'Explore')
  await finish($, 'a-x1')
  const ui = await $.ui.mount(row('terminal'))
  expect(await ui.find({ type: 'Text', text: /1 working · 1 done/ })).toBeDefined()
  await ui.unmount()
})

test('8 minutes left: a red frame', async ($, on) => {
  const w = await midPlan($, on)
  await w.clock.advance(3_600_000 - 480_000)
  const ui = await $.ui.mount(row('terminal'))
  expect((await ui.find({ key: 'crew-row' }))?.props.borderColor).toBe('error')
  await ui.unmount()
})

test('a narrow row drops the branch and the bars, keeps context and cache', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(row('terminal', 40))
  expect(await ui.find({ type: 'Text', text: /feat\/payments/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /34%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\d\d:\d\d/ })).toBeDefined()
  await ui.unmount()
})

test('a hidden row leaves only what is drawn beneath', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  await midPlan($, on)
  await $.command.run({ command: 'crew', args: 'row' } as never)
  const ui = await $.ui.mount(row('terminal'))
  expect(await ui.find({ type: 'Text', text: /beneath/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeUndefined()
  await ui.unmount()
})

test('no warning: the frame stays, in white', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(row('terminal'))
  const frame = await ui.find({ key: 'crew-row' })
  expect(frame?.props.borderStyle).toBe('round')
  expect(frame?.props.borderColor).toBe('text')
  await ui.unmount()
})

// --- Final review fixes

test('the countdown redraws every second while it is shown', async ($, on) => {
  const w = await midPlan($, on)
  const ui = await $.ui.mount(row('terminal'))
  expect(await ui.find({ type: 'Text', text: /^60:00$/ })).toBeDefined()
  await w.clock.advance(5_000)
  expect(await ui.find({ type: 'Text', text: /^59:55$/ })).toBeDefined()
  await ui.unmount()
})

for (const reason of ['error', 'aborted']) {
  test(`a main turn that ends with "${reason}" keeps the cache clock`, async ($, on) => {
    const w = world(on)
    await start($)
    await mainTurn($, 'complete')
    await w.clock.advance(3_600_000 - 120_000)
    await mainTurn($, 'start')
    await mainEnd($, reason)
    expect(main(w)).toMatchObject({ busy: false, expiresAt: START + 3_600_000 })
  })
}

test('a narrow row with agents keeps the cache and context, shortening the count', async ($, on) => {
  world(on, {})
  await start($)
  await mainTurn($, 'complete')
  await spawn($, 'x1', 'Find the payment rules', 'Explore')
  await spawn($, 'x2', 'Check the queue', 'Explore')
  await finish($, 'a-x1')
  const ui = await $.ui.mount(row('terminal', 40))
  expect(await ui.find({ type: 'Text', text: /^1 working$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /34%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\d\d:\d\d/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Opus 5\.5/ }))?.props.wrap).toBe('truncate-end')
  await ui.unmount()
})

test("the model is the session's own, not the settings alias, and a reload keeps what was learned", async ($, on) => {
  const w = world(on)
  await start($)
  expect(main(w)?.model).toBe('claude-opus-5-5')
  w.sessionModel = 'opus'
  await start($)
  expect(main(w)?.model).toBe('claude-opus-5-5')
})

test('/clear forgets the old conversation’s cache and context', async ($, on) => {
  const w = world(on)
  await start($)
  await mainTurn($, 'complete')
  await ($.session.end as (e: unknown) => Promise<unknown>)({ reason: 'clear', sessionId: 's1', resume: {} })
  expect(main(w)).toMatchObject({ expiresAt: null, context: null, warned: 0, busy: false })
})

test('a slow git never holds up the session start', async ($, on) => {
  const w = world(on)
  w.gitHangs = true
  await start($)
  expect(main(w)?.model).toBe('claude-opus-5-5')
})

// --- Small fixes

test("a subagent's request leaves the main model and context alone", async ($, on) => {
  const w = world(on)
  await start($)
  await mainTurn($, 'complete')
  w.context = 90
  await spawn($, 'x1', 'Find the payment rules', 'Explore')
  await request($, 'a-x1')
  expect(main(w)).toMatchObject({ model: 'claude-opus-5-5', context: 34 })
})

test('a new context measure (after /compact) reaches the row', async ($, on) => {
  const w = world(on)
  await start($)
  await mainTurn($, 'complete')
  await ($.session.measure as (e: unknown) => Promise<unknown>)({ context: { window: 1e6, percent: 12 }, rateLimits: [], changed: ['context'] })
  await w.clock.settle()
  expect(main(w)?.context).toBe(12)
})

test('outside a repository the branch is not re-read every minute', async ($, on) => {
  const w = world(on)
  w.branch = null
  await start($)
  await w.clock.settle()
  const runsBefore = w.gitRuns
  await w.clock.advance(125_000)
  expect(w.gitRuns).toBe(runsBefore)
})

test('the latest branch read wins over an older one that answers late', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  w.holdNextGit = true
  await bash($, 'git checkout old')
  const late = w.gitHold
  w.branch = 'new'
  await bash($, 'git checkout new')
  late?.('old')
  await w.clock.settle()
  expect(main(w)?.branch).toBe('new')
})

test('/crew says it also toggles the row', async ($, on) => {
  const w = world(on)
  await start($)
  const crew = w.commands.find(c => c.name === 'crew')
  expect(crew?.description).toMatch(/row/)
  expect(crew?.argumentHint).toBe('[row]')
})

test('a slow usage read never holds up the end of a turn', async ($, on) => {
  const w = world(on)
  await start($)
  w.usageHangs = true
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ reason: 'answer', answer: 'ok', usage: null })
  expect(true).toBe(true)
})

// --- Effort

test("effort: the model's configured level at start, then each request's own", async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  expect(main(w)?.effort).toBe('high')
  await mainTurn($, 'complete', 'xhigh')
  expect(main(w)?.effort).toBe('xhigh')
})

test('the row names the effort beside the model', async ($, on) => {
  await midPlan($, on)
  const ui = await $.ui.mount(row('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Opus 5\.5 · high$/ })).toBeDefined()
  await ui.unmount()
})

test('a long plan name at a docked width: shortened, nothing wraps, the working count gives way', async ($, on) => {
  const w = world(on, { [PLAN_PATH]: '# Quarterly Reporting Dashboard Overhaul Implementation Plan\n### Task 1: A\n### Task 2: B\n' })
  await start($)
  await mainTurn($, 'complete')
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't2', 'Implement Task 2: B')
  const ui = await $.ui.mount(row('terminal', 110))
  const title = await ui.find({ type: 'Text', text: /^Quarterly/ })
  expect(title?.text.length).toBeLessThanOrEqual(28)
  expect(title?.text.endsWith('…')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /working/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /feat\/payments/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Tasks 0\/2$/ })).toBeDefined()
  for (const t of await ui.findAll({ type: 'Text' })) if (t.text.trim()) expect(t.props.wrap).toBe('truncate-end')
  void w
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Everyday mode

test("the row shows Claude's task list", async ($, on) => {
  world(on, {})
  await start($)
  await submit($, 'Add CSV export to the reports page')
  await call($, 'TaskCreate', { subject: 'Add the CSV writer', description: 'd' })
  await call($, 'TaskCreate', { subject: 'Wire the export button', description: 'd' })
  await call($, 'TaskUpdate', { taskId: '1', status: 'in_progress' })
  await spawn($, 't1', 'Write the CSV writer')
  const ui = await $.ui.mount(row('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Add CSV export/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Tasks 0\/2/ })).toBeDefined()
  await ui.unmount()
})

test("the row's agent count has a bar", async ($, on) => {
  world(on, {})
  await start($)
  await spawn($, 'x1', 'Find the payment rules', 'Explore')
  await spawn($, 'x2', 'Check the queue', 'Explore')
  await finish($, 'a-x1')
  const ui = await $.ui.mount(row('terminal'))
  expect(await ui.find({ type: 'Text', text: /1 working · 1 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^[█░]{16}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^50%$/ })).toBeDefined()
  await ui.unmount()
})

test("the row keeps a superpowers plan over Claude's list", async ($, on) => {
  await midPlan($, on)
  await submit($, 'Something else entirely')
  await call($, 'TaskCreate', { subject: 'A', description: 'd' })
  const ui = await $.ui.mount(row('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Payments/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Something else/ })).toBeUndefined()
  await ui.unmount()
})

test('the row keeps whole pieces when it is tight', async ($, on) => {
  world(on)
  await start($)
  await mainTurn($, 'complete')
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't2', 'Implement Task 2: Background jobs')
  const wide = await $.ui.mount(row('terminal', 150))
  for (const text of [/feat\/payments/, /· 1 working/, /^[█░]{16}$/]) expect(await wide.find({ type: 'Text', text })).toBeDefined()
  await wide.unmount()
  const tight = await $.ui.mount(row('terminal', 96))
  expect(await tight.find({ type: 'Text', text: /feat\/payments/ })).toBeUndefined()
  expect(await tight.find({ type: 'Text', text: /· 1 working/ })).toBeUndefined()
  expect(await tight.find({ type: 'Text', text: /^Tasks 0\/3$/ })).toBeDefined()
  expect(await tight.find({ type: 'Text', text: /^[█░]{16}$/ })).toBeDefined()
  await tight.unmount()
})

test('the row paints with theme colours', async ($, on) => {
  const w = world(on)
  await start($)
  await mainTurn($, 'complete')
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't2', 'Implement Task 2: Background jobs')
  const rest = await $.ui.mount(row('terminal', 150))
  const dark = ['#8f8cf4', '#5fbf8f', '#4fb3a9', '#e2a94e', '#e0846b', '#4caf6e', 'white', 'green', 'red']
  for (const t of await rest.findAll({ type: 'Text' })) expect(dark).not.toContain(t.props.color)
  expect((await rest.find({ type: 'Text', text: /^⧗$/ }))?.props.color).toBe('planMode')
  expect((await rest.find({ type: 'Text', text: /^[█░]{16}$/ }))?.props.color).toBe('suggestion')
  expect((await rest.find({ type: 'Text', text: /^[█░]{8}$/ }))?.props.color).toBe('success')
  await rest.unmount()
  await w.clock.advance(HOUR - 15 * 60_000)
  await w.clock.settle()
  const low = await $.ui.mount(row('terminal', 150))
  expect((await low.find({ key: 'crew-row' }))?.props.borderColor).toBe('warning')
  expect((await low.find({ type: 'Text', text: /^⧗$/ }))?.props.color).toBe('warning')
  await low.unmount()
})
