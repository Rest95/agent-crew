import { expect, test } from 'claude-code/testing'

import type { Plan, Run } from '../types'
import { TYPE_PALETTE, agentRowSvg, colorOf, desktopPaneItems, bar, contextBarSvg, contextRingSvg, fmtTime, fmtTokens, hourglassSvg, runRole, runTitle, taskRowSvg } from './art'

const plan: Plan = {
  path: 'docs/plans/x.md',
  title: 'X',
  tasks: [
    { n: 1, title: 'A & B' },
    { n: 2, title: 'Background jobs' },
  ],
  workspace: null,
  complete: [],
  current: 1,
  inline: false,
}

const run = (over: Partial<Run>): Run => ({
  id: 'r',
  agentId: 'a',
  label: 'Implement Task 1: A & B',
  type: 'general-purpose',
  model: 'claude-sonnet-5-5',
  role: 'implement',
  task: 1,
  round: 0,
  status: 'running',
  startedAt: 0,
  contextTokens: 40_000,
  contextMax: 1_000_000,
  tokens: 120_000,
  costUsd: 0.21,
  requests: 3,
  ...over,
})

test('runTitle: the task, or the whole branch for the final review', () => {
  expect(runTitle(run({ task: 2 }), plan)).toBe('Task 2 · Background jobs')
  expect(runTitle(run({ role: 'final', task: null, label: 'Review code changes' }), plan)).toBe('Whole branch')
  expect(runTitle(run({ role: 'other', task: null, label: 'Find the docs' }), null)).toBe('Find the docs')
})

test('runRole: the role word and its fix round', () => {
  expect(runRole(run({ role: 'rereview', round: 2 }))).toBe('re-reviewing · round 2')
  expect(runRole(run({ role: 'implement' }))).toBe('implementing')
  expect(runRole(run({ role: 'other', type: 'Explore' }))).toBe('Explore')
})

test('agentRowSvg: title, role colour, model, a walking engineer while running', () => {
  const svg = agentRowSvg(360, run({}), plan, 65_000)
  expect(svg).toContain('Task 1 · A &amp; B')
  expect(svg).toContain('#378ADD')
  expect(svg).toContain('Sonnet 5.5')
  expect(svg).toContain('class="c-careful run"')
})

test('agentRowSvg: a done row is ticked, a failed one crossed', () => {
  expect(agentRowSvg(360, run({ status: 'done', endedAt: 9_000 }), plan, 9_000)).toContain('stroke="#3B9C5F"')
  expect(agentRowSvg(360, run({ status: 'failed', endedAt: 9_000 }), plan, 9_000)).toContain('stroke="#D0453F"')
})

test('taskRowSvg: one crab per run, none walking while the task waits', () => {
  const waiting = taskRowSvg(360, { n: 2, title: 'Background jobs' }, 'waiting', [], 0)
  expect(waiting).not.toContain('run"')
  const busy = taskRowSvg(360, { n: 1, title: 'A & B' }, 'current', [run({}), run({ id: 'v', role: 'review', status: 'done' })], 0)
  expect(busy.match(/class="c-/g)?.length).toBe(2)
})

test('terminal and number helpers', () => {
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(fmtTime(65_000)).toBe('1:05')
  expect(fmtTokens(61_000)).toBe('61k')
})

test('row icons: context bar by level, a ring that fills, a coloured hourglass', () => {
  expect(contextBarSvg(90)).toContain('#e0846b')
  expect(contextBarSvg(90)).toContain('width="72"')
  expect(contextBarSvg(30)).toContain('#4caf6e')
  expect(contextRingSvg(50)).toContain('stroke-dasharray="31.4 62.8"')
  expect(hourglassSvg('#e2a94e')).toContain('#e2a94e')
})

test('taskRowSvg: at most 8 crabs, then +N', () => {
  const many = Array.from({ length: 20 }, (_, i) => run({ id: `r${i}`, status: 'done' }))
  const svg = taskRowSvg(360, { n: 1, title: 'A & B' }, 'current', many, 0)
  expect(svg.match(/class="c-/g)?.length).toBe(8)
  expect(svg).toContain('+12')
})

test('desktopPaneItems: the plan view grouped by task, the same list the preview draws', () => {
  const items = desktopPaneItems(360, plan, [run({ id: 'a' }), run({ id: 'b', status: 'done' })], 0, { finishedOpen: true })
  // Header, a line, then each task: its row, its toggle and (open) its agents; the current task starts open.
  expect(items.map(i => i.kind)).toEqual(['svg', 'path', 'svg', 'rule', 'svg', 'group', 'svg', 'svg', 'svg'])
  expect(items.filter(i => i.kind === 'group').map(i => (i as { label: string }).label)).toEqual(['▾ 2 agents'])
})

test('plain agents get a colour by type, never the grey of nothing', () => {
  expect(colorOf(run({ role: 'other', type: 'Explore', task: null }))).toBe('#1D9E75')
  expect(colorOf(run({ role: 'other', type: 'general-purpose', task: null }))).toBe('#C2557A')
  const custom = colorOf(run({ role: 'other', type: 'code-reviewer', task: null }))
  expect(TYPE_PALETTE).toContain(custom)
  expect(colorOf(run({ role: 'other', type: 'code-reviewer', task: null }))).toBe(custom)
  expect(colorOf(run({ role: 'implement' }))).toBe('#378ADD')
})
