import { expect, test } from 'claude-code/testing'

import { FINDINGS, LEDGER, PLAN_PATH, PLAN_TEXT, STEP_TAIL, WS, bash, finish, plan, request, runs, spawn, start, world } from './fixtures'
import { call, checklist, mainTurn, submit } from './fixtures'

test('a plan script starts the plan view', async ($, on) => {
  const w = world(on)
  await bash($, `bash /x/skills/subagent-driven-development/scripts/sdd-workspace ${PLAN_PATH}`)
  expect(plan(w)).toMatchObject({ path: PLAN_PATH, title: 'Payments', workspace: WS, complete: [], inline: false })
  expect((plan(w))?.tasks.map(t => t.title)).toEqual(['API client', 'Background jobs', 'Queue screen'])
  expect(w.opened).toEqual(['agent-crew'])
})

test('a plan file that cannot be read leaves agents as plain rows', async ($, on) => {
  const w = world(on, {})
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  expect(plan(w)).toBeNull()
  await spawn($, 't1', 'Implement Task 1: API client')
  expect((runs(w))[0]).toMatchObject({ role: 'other', task: null })
})

test('implementers are asked for steps; reviewers are not; every spawn opens the pane', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't1', 'Implement Task 1: API client')
  await spawn($, 't2', 'Review Task 1 (spec + quality)')
  expect(w.prompts).toEqual([`p${STEP_TAIL}`, 'p'])
  expect(w.opened).toEqual(['agent-crew', 'agent-crew', 'agent-crew'])
  expect((runs(w)).map(r => [r.role, r.task, r.agentId])).toEqual([
    ['implement', 1, 'a-t1'],
    ['review', 1, 'a-t2'],
  ])
})

test('an agent that ends with an error fails and completes nothing', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't1', 'Implement Task 1: API client')
  await finish($, 'a-t1', 'error')
  expect((runs(w))[0]?.status).toBe('failed')
  expect((plan(w))?.complete).toEqual([])
})

test('a review with findings, then the resumed implementer is a fix round', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't1', 'Implement Task 1: API client')
  await finish($, 'a-t1')
  await spawn($, 't2', 'Review Task 1 (spec + quality)')
  await finish($, 'a-t2', 'answer', FINDINGS)
  expect((runs(w))[1]).toMatchObject({ role: 'review', findings: 3, status: 'done' })
  await request($, 'a-t1')
  const fix = (runs(w)).at(-1)
  expect(fix).toMatchObject({ role: 'fix', task: 1, round: 1, status: 'running', agentId: 'a-t1' })
})

test('the ledger marks tasks complete once an agent finishes', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't1', 'Review Task 1 (spec + quality)')
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b, review clean)\n`)
  await finish($, 'a-t1')
  expect((plan(w))?.complete).toEqual([1])
})

test('steps come from a running agent only', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't1', 'Implement Task 1: API client')
  const ok = await $.tool.call({ tool: 'mcp__agent-crew__step', agentId: 'a-t1', done: 2, total: 5, note: 'mock' } as never)
  expect(ok).toMatchObject({ result: 'ok' })
  expect((runs(w))[0]).toMatchObject({ stepDone: 2, stepTotal: 5, stepNote: 'mock' })
  const main = await $.tool.call({ tool: 'mcp__agent-crew__step', done: 1 } as never)
  expect(String((main as { result?: unknown }).result)).toMatch(/^ignored/)
})

test('inline mode: task-start marks the current task', async ($, on) => {
  const w = world(on)
  await bash($, `bash /x/skills/executing-plans/scripts/task-start ${PLAN_PATH} 2`)
  expect(plan(w)).toMatchObject({ inline: true, current: 2, workspace: WS })
})

test('a workspace removed after the final review completes every task', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  w.dirs.delete(WS)
  await spawn($, 't9', 'Review code changes')
  await finish($, 'a-t9')
  expect((plan(w))?.complete).toEqual([1, 2, 3])
})

// --- Final review fixes

test('the final review is recognised right after the last task completes', async ($, on) => {
  const w = world(on)
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b)\nTask 2: complete (commits c..d)\n`)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't3', 'Review Task 3 (spec + quality)')
  await finish($, 'a-t3')
  // The controller ledgers task 3 only after its reviewer has finished.
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b)\nTask 2: complete (commits c..d)\nTask 3: complete (commits e..f)\n`)
  await spawn($, 't9', 'Review code changes')
  expect(runs(w).at(-1)).toMatchObject({ role: 'final', task: null })
})

test('a resumed implementer keeps its first row and adds a fix row, its message untouched', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't1', 'Implement Task 1: API client')
  await finish($, 'a-t1')
  await spawn($, 't2', 'Review Task 1 (spec + quality)')
  await finish($, 'a-t2', 'answer', FINDINGS)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'Fix these findings', description: 'Implement Task 1: API client', subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-opus-5-5', background: false, fork: false, resume: { agentId: 'a-t1' } } as never)
  expect(w.prompts.at(-1)).toBe('Fix these findings')
  expect(runs(w).map(r => [r.role, r.status, r.agentId])).toEqual([
    ['implement', 'done', 'a-t1'],
    ['review', 'done', 'a-t2'],
    ['fix', 'running', 'a-t1'],
  ])
  expect(runs(w).at(-1)?.round).toBe(1)
})

test('a chained command with the ledger in its output never fakes Done', async ($, on) => {
  const w = world(on)
  w.stdout = `${WS}\n# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b)\n`
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b)\n`)
  await bash($, `bash scripts/sdd-workspace ${PLAN_PATH} && cat ${LEDGER}`)
  expect(plan(w)).toMatchObject({ workspace: WS, complete: [1] })
})

test('a plan that exists only in the worktree is read from there', async ($, on) => {
  const tree = '/repo/.worktrees/payments'
  const w = world(on, { [`${tree}/${PLAN_PATH}`]: '# Worktree Plan\n### Task 1: Only here\n' })
  w.stdout = `${tree}/.superpowers/sdd/payments\n`
  w.dirs.add(`${tree}/.superpowers/sdd/payments`)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  expect(plan(w)).toMatchObject({ title: 'Worktree Plan', workspace: `${tree}/.superpowers/sdd/payments` })
})

test('inline mode: the pane opens when the plan starts, not on every task', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/task-start ${PLAN_PATH} 1`)
  await bash($, `scripts/task-start ${PLAN_PATH} 2`)
  expect(w.opened).toEqual(['agent-crew'])
})

// --- Small fixes

test('a step from an agent the panel has no row for is ignored', async ($, on) => {
  world(on)
  const result = await $.tool.call({ tool: 'mcp__agent-crew__step', agentId: 'a-ghost', done: 1 } as never)
  expect(String((result as { result?: unknown }).result)).toMatch(/^ignored/)
})

test('a run whose end never arrived is closed from the agent list', async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, 't1', 'Find the payment rules', 'Explore')
  w.agentStatus.set('a-t1', 'completed')
  await w.clock.advance(6_000)
  expect(runs(w)[0]?.status).toBe('done')
})

test('a slow plan read never holds up the Bash call', async ($, on) => {
  const w = world(on)
  w.slowFiles.add(PLAN_PATH)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  expect(plan(w)).toBeNull()
})

// --- Finding the plan's progress without the scripts' output

const MARKER = `${WS}/plan-path`

test('a workspace the script printed nothing about is found by its marker', async ($, on) => {
  const w = world(on, { [PLAN_PATH]: PLAN_TEXT, [MARKER]: `${PLAN_PATH}\n`, [LEDGER]: `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b)\nTask 2: complete (commits c..d)\n` })
  w.stdout = ''
  await bash($, `BRIEF=$(bash scripts/task-start ${PLAN_PATH} 3)`)
  expect(plan(w)).toMatchObject({ workspace: WS, complete: [1, 2] })
})

test('/crew picks up the plan in progress, with its finished tasks', async ($, on) => {
  const w = world(on, { [PLAN_PATH]: PLAN_TEXT, [MARKER]: `${PLAN_PATH}\n`, [LEDGER]: `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b)\n` })
  await start($)
  await $.command.run({ command: 'crew' } as never)
  await w.clock.settle()
  expect(plan(w)).toMatchObject({ path: PLAN_PATH, title: 'Payments', workspace: WS, complete: [1] })
})

test('the ledger is re-read every few seconds while a plan is open', async ($, on) => {
  const w = world(on)
  await start($)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  w.files.set(LEDGER, `# SDD ledger — plan: ${PLAN_PATH}\nTask 1: complete (commits a..b)\nTask 2: complete (commits c..d)\n`)
  await w.clock.advance(11_000)
  expect(plan(w)?.complete).toEqual([1, 2])
})

test('an agent labelled like a plan task finds the plan in progress when none is showing', async ($, on) => {
  const w = world(on, { [PLAN_PATH]: PLAN_TEXT, [MARKER]: `${PLAN_PATH}\n`, [LEDGER]: `# SDD ledger — plan: ${PLAN_PATH}\n` })
  await spawn($, 't1', 'Implement Task 1: API client')
  expect(plan(w)).toMatchObject({ path: PLAN_PATH, workspace: WS })
  expect(runs(w)[0]).toMatchObject({ role: 'implement', task: 1 })
})

// ---------------------------------------------------------------------------
// Everyday mode: Claude's task list, agents' actions and their own lists

async function withList($: Parameters<typeof spawn>[0]) {
  await submit($, 'Add CSV export to the reports page')
  await call($, 'TaskCreate', { subject: 'Add the CSV writer', description: 'd' })
  await call($, 'TaskCreate', { subject: 'Wire the export button', description: 'd' })
  await call($, 'TaskUpdate', { taskId: '1', status: 'in_progress' })
}

test("Claude's task list is tracked from the main conversation", async ($, on) => {
  const w = world(on)
  await withList($)
  const list = checklist(w)
  expect(list?.heading).toBe('Add CSV export to the reports page')
  expect(list?.items.map(i => [i.text, i.n, i.status])).toEqual([
    ['Add the CSV writer', 1, 'in_progress'],
    ['Wire the export button', 2, 'pending'],
  ])
})

test('an agent sits under the task in progress when it starts', async ($, on) => {
  const w = world(on)
  await withList($)
  await spawn($, 't1', 'Write the CSV writer')
  expect(runs(w)[0]).toMatchObject({ role: 'other', task: 1 })
})

test("an agent's action and steps follow its own tool calls", async ($, on) => {
  const w = world(on)
  await spawn($, 't1', 'Look around')
  await call($, 'Edit', { file_path: '/repo/payments/lib/a.ts' }, 'a-t1')
  expect(runs(w)[0]?.action).toBe('✎ Editing lib/a.ts')
  await call($, 'Grep', { pattern: 'x' }, 'a-t1')
  expect(runs(w)[0]).toMatchObject({ action: '⌕ Searching "x"', steps: 2 })
})

test('two agents keep their own actions', async ($, on) => {
  const w = world(on)
  await spawn($, 't1', 'One')
  await spawn($, 't2', 'Two')
  await call($, 'Edit', { file_path: '/repo/payments/a.ts' }, 'a-t1')
  await call($, 'Read', { file_path: '/repo/payments/b.ts' }, 'a-t2')
  await call($, 'Grep', { pattern: 'y' }, 'a-t1')
  const [one, two] = [runs(w).find(r => r.agentId === 'a-t1'), runs(w).find(r => r.agentId === 'a-t2')]
  expect(one).toMatchObject({ action: '⌕ Searching "y"', steps: 2 })
  expect(two).toMatchObject({ action: '⌕ Reading b.ts', steps: 1 })
})

test("an agent's own checklist is its progress", async ($, on) => {
  const w = world(on)
  await withList($)
  const before = checklist(w)
  await spawn($, 't1', 'Write the CSV writer')
  const todos = [
    { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
    { content: 'Write the tests', status: 'in_progress', activeForm: 'Writing the tests' },
    { content: 'Write the writer', status: 'pending', activeForm: 'Writing the writer' },
    { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
  ]
  await call($, 'TodoWrite', { todos }, 'a-t1')
  expect(runs(w)[0]).toMatchObject({ stepDone: 1, stepTotal: 4, stepNote: 'Writing the tests', stepSource: 'list' })
  expect(checklist(w)).toEqual(before)
})

test("a subagent's TaskUpdate never touches Claude's list", async ($, on) => {
  const w = world(on)
  await withList($)
  await spawn($, 't1', 'Write the CSV writer')
  await call($, 'TaskUpdate', { taskId: '1', status: 'completed' }, 'a-t1')
  expect(checklist(w)?.items[0]?.status).toBe('in_progress')
})

test("the step tool wins over an agent's own checklist", async ($, on) => {
  const w = world(on)
  await spawn($, 't1', 'One')
  await call($, 'mcp__agent-crew__step', { done: 2, total: 5, note: 'mock' }, 'a-t1')
  await call($, 'TodoWrite', { todos: [{ content: 'a', status: 'pending', activeForm: 'a' }] }, 'a-t1')
  expect(runs(w)[0]).toMatchObject({ stepDone: 2, stepTotal: 5, stepNote: 'mock', stepSource: 'tool' })
})

test('unreadable task calls change nothing and pass their result back', async ($, on) => {
  const w = world(on)
  w.taskCreateNull = true
  const done = await call($, 'TaskCreate', { subject: 'A', description: 'd' })
  expect(checklist(w)).toBeNull()
  expect(done).toMatchObject({ result: null })
})

test('a finished list gives way to the next agent', async ($, on) => {
  const w = world(on)
  await withList($)
  await call($, 'TaskUpdate', { taskId: '1', status: 'completed' })
  await call($, 'TaskUpdate', { taskId: '2', status: 'completed' })
  await spawn($, 't9', 'Something else')
  expect(checklist(w)).toBeNull()
})

test('/clear forgets the list', async ($, on) => {
  const w = world(on)
  await withList($)
  await ($.session.end as (e: unknown) => Promise<unknown>)({ sessionId: 's', reason: 'clear' })
  await w.clock.settle()
  expect(checklist(w)).toBeNull()
})

// ---------------------------------------------------------------------------
// Final review fixes

test('the action shows as the call starts, not when it ends', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'WebFetch' }, () => new Promise(() => undefined) as never)
  await spawn($, 't1', 'Look it up')
  void $.tool.call({ tool: 'WebFetch', url: 'https://docs.example.com/a', agentId: 'a-t1' } as never)
  await w.clock.settle()
  expect(runs(w)[0]?.action).toBe('⇣ Fetching docs.example.com')
})

test('a stuck background read never holds up placement or actions', async ($, on) => {
  const w = world(on)
  w.usageHangs = true
  await withList($)
  await mainTurn($, 'complete')
  await call($, 'TaskUpdate', { taskId: '1', status: 'completed' })
  await call($, 'TaskUpdate', { taskId: '2', status: 'in_progress' })
  await spawn($, 't2', 'Wire the export button')
  expect(runs(w).find(r => r.agentId === 'a-t2')?.task).toBe(2)
  await call($, 'Edit', { file_path: '/repo/payments/lib/b.ts' }, 'a-t2')
  expect(runs(w).find(r => r.agentId === 'a-t2')?.action).toBe('✎ Editing lib/b.ts')
})

test("a new task list doesn't inherit the last list's agents", async ($, on) => {
  const w = world(on)
  await call($, 'TodoWrite', { todos: [{ content: 'alpha', status: 'completed', activeForm: 'a' }, { content: 'beta', status: 'in_progress', activeForm: 'b' }] })
  await spawn($, 't1', 'beta work')
  expect(runs(w)[0]?.task).toBe(2)
  await call($, 'TodoWrite', { todos: [{ content: 'gamma', status: 'pending', activeForm: 'g' }, { content: 'delta', status: 'in_progress', activeForm: 'd' }] })
  expect(runs(w)[0]?.task).toBeNull()
})

test("a superpowers plan doesn't adopt everyday agents' task numbers", async ($, on) => {
  const w = world(on)
  await withList($)
  await call($, 'TaskUpdate', { taskId: '2', status: 'in_progress' })
  await spawn($, 't1', 'Wire the export button')
  expect(runs(w)[0]?.task).toBe(2)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  expect(runs(w)[0]?.task).toBeNull()
})

// ---------------------------------------------------------------------------
// Deferred review minors

test('a fix round starts with a clean slate; a resumed agent drops its old action', async ($, on) => {
  const w = world(on)
  await bash($, `scripts/sdd-workspace ${PLAN_PATH}`)
  await spawn($, 't1', 'Implement Task 1: API client')
  await call($, 'Edit', { file_path: '/repo/payments/a.ts' }, 'a-t1')
  await call($, 'TodoWrite', { todos: [{ content: 'a', status: 'pending', activeForm: 'a' }] }, 'a-t1')
  await finish($, 'a-t1')
  await spawn($, 'x1', 'Look around')
  await call($, 'Edit', { file_path: '/repo/payments/b.ts' }, 'a-x1')
  await finish($, 'a-x1')
  const resume = (id: string, description: string) => $.agent.spawn({ tool_use_id: id, prompt: 'Again', description, subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-opus-5-5', background: false, fork: false, resume: { agentId: `a-${id}` } } as never)
  await resume('t1', 'Implement Task 1: API client')
  await resume('x1', 'Look around')
  await w.clock.settle()
  const fix = runs(w).find(r => r.role === 'fix')
  expect([fix?.action, fix?.steps, fix?.ownList, fix?.stepSource]).toEqual([undefined, undefined, undefined, undefined])
  expect(runs(w).find(r => r.agentId === 'a-x1')?.action).toBeUndefined()
})

test("only the person's prompt heads a list, as it entered", async ($, on) => {
  const w = world(on)
  await submit($, 'Add CSV export')
  await submit($, 'A note from another session', 'peer')
  await call($, 'TaskCreate', { subject: 'A', description: 'd' })
  expect(checklist(w)?.heading).toBe('Add CSV export')
  await call($, 'TaskUpdate', { taskId: '1', status: 'completed' })
  w.promptRewrite = 'The rewritten prompt'
  await submit($, 'The typed prompt')
  await call($, 'TaskCreate', { subject: 'B', description: 'd' })
  expect(checklist(w)?.heading).toBe('The rewritten prompt')
})

test('reading a task list writes nothing', async ($, on) => {
  const w = world(on)
  const writes = () => (w.writes.get('runs') ?? 0) + (w.writes.get('checklist') ?? 0)
  await spawn($, 't1', 'One')
  await w.clock.settle()
  const before = writes()
  await call($, 'TaskList', {}, 'a-t1')
  await call($, 'TaskList', {})
  expect(writes()).toBe(before)
})

test('a denied call counts for nothing', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'WebSearch' }, () => ({ deny: 'no' }) as never)
  await withList($)
  await spawn($, 't1', 'One')
  await call($, 'Edit', { file_path: '/repo/payments/a.ts' }, 'a-t1')
  await call($, 'WebSearch', { query: 'x' }, 'a-t1')
  expect(runs(w)[0]?.steps).toBe(1)
  w.taskDeny = true
  await call($, 'TaskUpdate', { taskId: '1', status: 'completed' })
  await call($, 'TaskCreate', { subject: 'Own', description: 'd' }, 'a-t1')
  expect(checklist(w)?.items[0]?.status).toBe('in_progress')
  expect(runs(w)[0]?.ownList).toBeUndefined()
})

test('calls arriving together all land', async ($, on) => {
  const w = world(on)
  await spawn($, 't1', 'One')
  await spawn($, 't2', 'Two')
  await Promise.all([
    call($, 'Edit', { file_path: '/repo/payments/a.ts' }, 'a-t1'),
    call($, 'Read', { file_path: '/repo/payments/b.ts' }, 'a-t2'),
    call($, 'Read', { file_path: '/repo/payments/c.ts' }, 'a-t1'),
    call($, 'Read', { file_path: '/repo/payments/d.ts' }, 'a-t2'),
  ])
  expect(runs(w).find(r => r.agentId === 'a-t1')?.steps).toBe(2)
  expect(runs(w).find(r => r.agentId === 'a-t2')?.steps).toBe(2)
})
