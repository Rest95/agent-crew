import { expect, test } from 'claude-code/testing'

import type { Main, Plan, Run } from '../types'
import { cacheView, classify, currentTask, isPlanLabel, contextLevel, costOf, countFindings, dueWarning, parseBranch, parseLedger, parsePlan, parseScriptCall, planPhase, rowProgress, rowTier, windowOf, workspaceFrom } from './model'

const PLAN_TEXT = '# Payments Module Implementation Plan\n\n### Task 1: API client\n```md\n### Task 9: not a task\n```\n## Task 2: Background jobs\n'

test('parsePlan: title from the first heading, tasks outside code fences', () => {
  expect(parsePlan('docs/superpowers/plans/2026-10-29-payments.md', PLAN_TEXT)).toEqual({
    title: 'Payments Module',
    tasks: [
      { n: 1, title: 'API client' },
      { n: 2, title: 'Background jobs' },
    ],
  })
})

test('parsePlan: no title heading falls back to the file name', () => {
  expect(parsePlan('docs/superpowers/plans/2026-10-29-payments.md', '### Task 1: A\n').title).toBe('2026-10-29-payments')
})

const LEDGER = '# SDD ledger — plan: docs/plans/x.md\nTask 1: complete (commits a1..b2, review clean)\nTask 3: complete (commits c..d, 1 parked)\nTask 2: fix round 1\n'

test('parseLedger: complete tasks of this plan', () => {
  expect(parseLedger(LEDGER, './docs/plans/x.md')).toEqual([1, 3])
})

test("parseLedger: another plan's ledger counts for nothing", () => {
  expect(parseLedger(LEDGER, 'docs/plans/y.md')).toEqual([])
})

test('parseScriptCall: sdd-workspace by its full path', () => {
  const command = 'bash /u/.claude/plugins/cache/x/superpowers/7.0.0/skills/subagent-driven-development/scripts/sdd-workspace docs/plans/x.md'
  expect(parseScriptCall(command)).toEqual({ script: 'sdd-workspace', plan: 'docs/plans/x.md', task: null })
})

test('parseScriptCall: a quoted plan path and a task number after cd', () => {
  expect(parseScriptCall('cd /repo && bash scripts/task-brief "docs/my plan.md" 2')).toEqual({ script: 'task-brief', plan: 'docs/my plan.md', task: 2 })
})

test('parseScriptCall: task-done keeps its task number', () => {
  expect(parseScriptCall('scripts/task-done docs/plans/x.md 3 abc1234 -- pnpm test')?.task).toBe(3)
})

test('parseScriptCall: any other command is not a plan script', () => {
  expect(parseScriptCall('git status')).toBeNull()
})

test('workspaceFrom: the directory each script reports', () => {
  expect(workspaceFrom({ script: 'task-start', plan: 'p', task: 1 }, 'brief: /r/.superpowers/sdd/x/task-1-brief.md\nbase: abc\n')).toBe('/r/.superpowers/sdd/x')
  expect(workspaceFrom({ script: 'task-brief', plan: 'p', task: 2 }, 'wrote /r/.superpowers/sdd/x/task-2-brief.md: 40 lines\n')).toBe('/r/.superpowers/sdd/x')
  expect(workspaceFrom({ script: 'sdd-workspace', plan: 'p', task: null }, '/r/.superpowers/sdd/x\n')).toBe('/r/.superpowers/sdd/x')
  expect(workspaceFrom({ script: 'task-done', plan: 'p', task: 1 }, 'ok')).toBeNull()
})

const plan = (tasks: number, complete: number[] = []): Plan => ({
  path: 'docs/plans/x.md',
  title: 'X',
  tasks: Array.from({ length: tasks }, (_, i) => ({ n: i + 1, title: `T${i + 1}` })),
  workspace: null,
  complete,
  current: null,
  inline: false,
})

const run = (over: Partial<Run>): Run => ({
  id: over.id ?? 'r',
  label: '',
  type: 'general-purpose',
  model: 'claude-sonnet-5-5',
  role: 'other',
  task: null,
  round: 0,
  status: 'done',
  startedAt: 0,
  contextTokens: 0,
  contextMax: 1e6,
  tokens: 0,
  costUsd: 0,
  requests: 0,
  ...over,
})

test('classify: an implementer of a planned task', () => {
  expect(classify('Implement Task 2: Background jobs', plan(3), [])).toEqual({ role: 'implement', task: 2, round: 0 })
  expect(classify('implement task 2: x', plan(3), []).role).toBe('implement')
})

test('classify: a second implementer of a task with findings is a fix round', () => {
  const runs = [run({ id: 'a', role: 'implement', task: 2 }), run({ id: 'b', role: 'review', task: 2, findings: 2 })]
  expect(classify('Implement Task 2: Background jobs', plan(3), runs)).toEqual({ role: 'fix', task: 2, round: 1 })
})

test('classify: reviews and re-reviews', () => {
  expect(classify('Review Task 2 (spec + quality)', plan(3), [])).toEqual({ role: 'review', task: 2, round: 0 })
  expect(classify('Re-review Task 2 fix round 3', plan(3), [])).toEqual({ role: 'rereview', task: 2, round: 3 })
})

test('classify: the final review only once every task is complete', () => {
  expect(classify('Review code changes', plan(3, [1, 2, 3]), [])).toEqual({ role: 'final', task: null, round: 0 })
  expect(classify('Review code changes', plan(3, [1]), []).role).toBe('other')
})

test('classify: never a task the plan does not have, nor one with no plan', () => {
  expect(classify('Implement Task 7: ghost', plan(3), [])).toEqual({ role: 'other', task: null, round: 0 })
  expect(classify('Implement Task 1: x', null, []).role).toBe('other')
})

test('countFindings: Critical and Important items, not Minor', () => {
  const answer = '### Issues\n#### Critical (Must Fix)\n- a.ts:3 wrong\n#### Important (Should Fix)\n1. b.ts:9 missing test\n2. c.ts:1 leak\n#### Minor (Nice to Have)\n- naming\n'
  expect(countFindings(answer)).toBe(3)
  expect(countFindings('**Task quality:** Approved')).toBe(0)
})

test('planPhase: tasks, then review, then done', () => {
  expect(planPhase(plan(5, [1, 2]), [])).toEqual({ done: 2, total: 5, label: 'Tasks 2/5', isFinished: false })
  const all = plan(5, [1, 2, 3, 4, 5])
  expect(planPhase(all, [run({ role: 'final', status: 'running' })]).label).toBe('Review 5/5')
  expect(planPhase(all, [run({ role: 'final', status: 'done' })])).toEqual({ done: 5, total: 5, label: 'Done', isFinished: true })
})

test('costOf and windowOf: list prices and context windows', () => {
  const turn = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 2e6, cache_creation_input_tokens: 1e6 }
  expect(costOf('claude-sonnet-5-5', turn, false).toFixed(2)).toBe('16.20')
  expect(windowOf('claude-haiku-4-5')).toBe(200_000)
  expect(windowOf('claude-sonnet-5-5')).toBe(1_000_000)
})

// --- Final review fixes

test('parseScriptCall: shell fragments are never taken for a plan', () => {
  expect(parseScriptCall('WS=$(bash /x/skills/subagent-driven-development/scripts/sdd-workspace docs/plans/x.md); echo $WS; ls $WS')).toEqual({ script: 'sdd-workspace', plan: 'docs/plans/x.md', task: null })
  expect(parseScriptCall('bash "$SKILL/scripts/task-brief" "$PLAN" 3')).toBeNull()
  expect(parseScriptCall('bash scripts/task-brief docs/plans/x.md 2; echo done')).toEqual({ script: 'task-brief', plan: 'docs/plans/x.md', task: 2 })
  expect(parseScriptCall('cat /x/scripts/task-start /x/scripts/task-done')).toBeNull()
})

test('parseScriptCall: review-package is a plan script too', () => {
  expect(parseScriptCall('bash scripts/review-package docs/plans/x.md abc1234 def5678')).toEqual({ script: 'review-package', plan: 'docs/plans/x.md', task: null })
})

test('workspaceFrom: only a workspace-shaped path counts', () => {
  const ledgerToo = '/r/.superpowers/sdd/x\n# SDD ledger — plan: docs/plans/x.md\nTask 1: complete (commits a..b)\n'
  expect(workspaceFrom({ script: 'sdd-workspace', plan: 'p', task: null }, ledgerToo)).toBe('/r/.superpowers/sdd/x')
  expect(workspaceFrom({ script: 'sdd-workspace', plan: 'p', task: null }, 'Task 1: complete\n')).toBeNull()
  expect(workspaceFrom({ script: 'review-package', plan: 'p', task: null }, 'wrote /r/.superpowers/sdd/x/review-a..b.diff: 3 commit(s), 900 bytes\n')).toBe('/r/.superpowers/sdd/x')
  expect(workspaceFrom({ script: 'task-brief', plan: 'p', task: 1 }, 'wrote /tmp/brief.md: 4 lines\n')).toBeNull()
})

test('parseLedger: a header with the path in backticks or quotes is still this plan', () => {
  expect(parseLedger('# SDD ledger — plan: `docs/plans/x.md`\nTask 1: complete (commits a..b)\n', 'docs/plans/x.md')).toEqual([1])
  expect(parseLedger('# SDD ledger — plan: "docs/plans/x.md"\nTask 2: complete (commits a..b)\n', 'docs/plans/x.md')).toEqual([2])
})

test('countFindings: re-review verdicts and new breakage; "None" is no finding', () => {
  const rereview = '### Finding Verdicts\n- **leak in c.ts** — ADDRESSED, c.ts:4\n- **missing test** — NOT ADDRESSED, b.ts:9\n### New Breakage in the Fix Diff\n- Important: d.ts:2 null deref\n- Minor: naming\n### Verdict\n**Fix round:** Findings remain open\n'
  expect(countFindings(rereview)).toBe(2)
  expect(countFindings('#### Critical (Must Fix)\n- None\n#### Important (Should Fix)\n- N/A\n#### Minor\n- naming\n')).toBe(0)
  expect(countFindings('### New Breakage in the Fix Diff\nNone\n')).toBe(0)
})

test('fixRound: the round after the latest re-review that found something', () => {
  const runs = [
    run({ id: 'i', role: 'implement', task: 2 }),
    run({ id: 'v', role: 'review', task: 2, findings: 2 }),
    run({ id: 'r2', role: 'rereview', task: 2, round: 2, findings: 1 }),
  ]
  expect(classify('Implement Task 2: Background jobs', plan(3), runs)).toEqual({ role: 'fix', task: 2, round: 3 })
})

// --- The row above the prompt

const main = (over: Partial<Main>): Main => ({ model: null, effort: null, branch: null, context: null, busy: false, expiresAt: null, warned: 0, rowHidden: false, planDoneAt: null, lastServedAt: null, ...over })
const NOW = 1_000_000

test('rowProgress: the plan while it runs, Done until something else runs, then agents', () => {
  expect(rowProgress(plan(3, [1]), [run({ status: 'running', task: 2, role: 'implement' })], null)).toEqual({ kind: 'plan', working: 1 })
  expect(rowProgress(plan(2, [1, 2]), [run({ startedAt: 10 })], 50)).toEqual({ kind: 'plan', working: 0 })
  const later = [run({ id: 'a', startedAt: 60, status: 'running' }), run({ id: 'b', startedAt: 70, status: 'done' }), run({ id: 'c', startedAt: 10 })]
  expect(rowProgress(plan(2, [1, 2]), later, 50)).toEqual({ kind: 'agents', working: 1, done: 1 })
  expect(rowProgress(null, [run({ status: 'done' })], null)).toEqual({ kind: 'none' })
  expect(rowProgress(null, [run({ id: 'x', status: 'running' }), run({ id: 'y' })], null)).toEqual({ kind: 'agents', working: 1, done: 1 })
})

test('cacheView: nothing yet, working, minutes left with warnings, expired', () => {
  expect(cacheView(main({}), NOW)).toEqual({ text: '—', level: null, secondsLeft: null })
  expect(cacheView(main({ busy: true, expiresAt: NOW + 300_000 }), NOW)).toEqual({ text: '…', level: null, secondsLeft: null })
  expect(cacheView(main({ expiresAt: NOW + 900_000 }), NOW)).toEqual({ text: '15:00', level: 'warn', secondsLeft: 900 })
  expect(cacheView(main({ expiresAt: NOW + 480_000 }), NOW)).toEqual({ text: '08:00', level: 'alert', secondsLeft: 480 })
  expect(cacheView(main({ expiresAt: NOW + 3_000_000 }), NOW).level).toBeNull()
  expect(cacheView(main({ expiresAt: NOW - 5_000 }), NOW).text).toBe('expired')
})

test('dueWarning: 10 then 5 minutes, once each, never while busy', () => {
  expect(dueWarning(main({ expiresAt: NOW + 590_000 }), NOW)).toBe(10)
  expect(dueWarning(main({ expiresAt: NOW + 290_000, warned: 10 }), NOW)).toBe(5)
  expect(dueWarning(main({ expiresAt: NOW + 290_000, warned: 5 }), NOW)).toBeNull()
  expect(dueWarning(main({ expiresAt: NOW + 590_000, warned: 10 }), NOW)).toBeNull()
  expect(dueWarning(main({ expiresAt: NOW + 590_000, busy: true }), NOW)).toBeNull()
  expect(dueWarning(main({ expiresAt: NOW + 900_000 }), NOW)).toBeNull()
})

test('contextLevel, rowTier and parseBranch', () => {
  expect([contextLevel(64), contextLevel(65), contextLevel(85)]).toEqual(['ok', 'warn', 'alert'])
  expect([rowTier(120), rowTier(95), rowTier(75), rowTier(40)]).toEqual([0, 1, 2, 3])
  expect(parseBranch(0, 'feat/x\n')).toBe('feat/x')
  expect(parseBranch(0, '')).toBeNull()
  expect(parseBranch(128, 'fatal')).toBeNull()
})

// --- Small fixes

test('parsePlan: a task number repeated outside a fence keeps its first heading', () => {
  expect(parsePlan('p.md', '### Task 1: A\n### Task 2: B\n### Task 2: B again\n').tasks).toEqual([
    { n: 1, title: 'A' },
    { n: 2, title: 'B' },
  ])
})

test('currentTask: the highest-numbered task with activity that is not complete', () => {
  const p = { ...plan(3, [1]), current: 1 }
  const runs = [run({ id: 'i2', role: 'implement', task: 2 }), run({ id: 'v1', role: 'review', task: 1 })]
  expect(currentTask(p, runs)).toBe(2)
  expect(currentTask({ ...plan(3, [1, 2]), current: 2 }, runs)).toBeNull()
  expect(currentTask({ ...plan(3), current: 3, inline: true }, [])).toBe(3)
})

test('parseScriptCall: a script reached through a shell variable', () => {
  expect(parseScriptCall('S=/u/x/subagent-driven-development/scripts; W=$(bash $S/sdd-workspace docs/plans/x.md); echo $W; ls $W')).toEqual({ script: 'sdd-workspace', plan: 'docs/plans/x.md', task: null })
  expect(parseScriptCall('bash $S/task-brief docs/plans/x.md 1')).toEqual({ script: 'task-brief', plan: 'docs/plans/x.md', task: 1 })
  expect(parseScriptCall('bash "${SKILL}/task-start" docs/plans/x.md 2')).toEqual({ script: 'task-start', plan: 'docs/plans/x.md', task: 2 })
})

test('classify: any plan task label that is not a review counts as its implementer', () => {
  expect(classify('Finish Task 2: background jobs', plan(3), [])).toEqual({ role: 'implement', task: 2, round: 0 })
  expect(classify('Continue task 3 after a crash', plan(3), [])).toEqual({ role: 'implement', task: 3, round: 0 })
  // A second implementer with no review findings is not a fix round.
  expect(classify('Finish Task 2: x', plan(3), [run({ id: 'i', role: 'implement', task: 2, status: 'failed' })])).toEqual({ role: 'implement', task: 2, round: 0 })
  expect(isPlanLabel('Finish Task 2: background jobs')).toBe(true)
  expect(isPlanLabel('Find the payment rules')).toBe(false)
})

test('countFindings: only the top-level items count, not the bullets under them', () => {
  const answer = [
    '### Issues',
    '#### Critical (Must Fix)',
    'None.',
    '',
    '#### Important (Should Fix)',
    '1. **Duplicate total label.**',
    '   - `a.ts:335` appends a suffix.',
    '   - The template prints its own note.',
    '   - Suggested fix: print the total directly.',
    '2. **Subtotal can disagree.**',
    '   - `b.ts:328` uses another sum.',
    '     - nested detail',
    '',
    '#### Minor (Nice to Have)',
    '- naming',
  ].join('\n')
  expect(countFindings(answer)).toBe(2)
})
