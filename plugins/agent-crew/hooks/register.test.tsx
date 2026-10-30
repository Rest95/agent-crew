import { expect, test } from 'claude-code/testing'

import { FINDINGS, LEDGER, PLAN_PATH, PLAN_TEXT, STEP_TAIL, WS, bash, finish, plan, request, runs, spawn, start, world } from './fixtures'

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
