// Builds preview/index.html: the panel at three moments of a sample plan, drawn by the mod's own art.ts.
// Run: bun scripts/preview.ts > preview/index.html
import type { Plan, Run } from '../plugins/agent-crew/types'
import {
  ACCENT,
  ALERT_COLOR,
  CACHE_COLOR,
  WARN_COLOR,
  branchIconSvg,
  contextBarSvg,
  contextRingSvg,
  hourglassSvg,
  AGENT_ROW_HEIGHT,
  BAR_HEIGHT,
  CRAB_CSS,
  DONE_COLOR,
  GLYPH,
  ROLE_STYLE,
  TASK_ROW_HEIGHT,
  TOTALS_HEIGHT,
  agentRowSvg,
  desktopPaneItems,
  groupCount,
  isGroupOpen,
  planGroups,
  bar,
  colorOf,
  crab,
  ctxPercent,
  elapsed,
  fmtCost,
  fmtTime,
  fmtTokens,
  planBarSvg,
  progressOf,
  runModel,
  runRole,
  runTitle,
  stepsText,
  taskRowSvg,
  totalsSvg,
} from '../plugins/agent-crew/hooks/art'
import { ACTION_COLOR, finishedLine, noListHeading, noListPhase } from '../plugins/agent-crew/hooks/art'
import { checklistAsPlan, planPhase } from '../plugins/agent-crew/hooks/model'

const W = 380
const MIN = 60_000
const TASKS = ['API client and its test mock', 'Background jobs with retries', 'One receipt per order', 'Refunds and partial returns', 'Job queue screen']

const basePlan = (complete: number[], current: number | null): Plan => ({
  path: 'docs/superpowers/plans/2026-10-29-payments.md',
  title: 'Payments module',
  tasks: TASKS.map((title, i) => ({ n: i + 1, title })),
  workspace: '.superpowers/sdd/2026-10-29-payments',
  complete,
  current,
  inline: false,
})

let seq = 0
const LABEL: Record<Run['role'], (task: number | null, round: number) => string> = {
  implement: t => `Implement Task ${t}: ${TASKS[(t ?? 1) - 1]}`,
  fix: t => `Implement Task ${t}: ${TASKS[(t ?? 1) - 1]}`,
  review: t => `Review Task ${t} (spec + quality)`,
  rereview: (t, r) => `Re-review Task ${t} fix round ${r}`,
  final: () => 'Review code changes',
  other: () => '',
}
const run = (role: Run['role'], task: number | null, start: number, minutes: number, over: Partial<Run> = {}): Run => {
  const model = over.model ?? (role === 'final' ? 'claude-opus-5-5' : 'claude-sonnet-5-5')
  const ctx = Math.round(30_000 + minutes * 9_000)
  return {
    id: `r${++seq}`,
    agentId: `a${seq}`,
    label: LABEL[role](task, over.round ?? 0),
    type: 'general-purpose',
    model,
    role,
    task,
    round: 0,
    status: 'done',
    startedAt: start * MIN,
    endedAt: (start + minutes) * MIN,
    contextTokens: ctx,
    contextMax: 1_000_000,
    tokens: ctx * minutes * 4,
    costUsd: (ctx * minutes * 4 * 0.1 + ctx * 4) / 1e6 + minutes * 0.03,
    requests: minutes * 4,
    ...over,
  }
}

const running = (r: Run, now: number): Run => ({ ...r, status: 'running', endedAt: undefined, startedAt: now - (r.endedAt! - r.startedAt) / 2 })

// The crew of the whole sample run, in order.
const T1 = [run('implement', 1, 0, 3, { stepDone: 5, stepTotal: 5 }), run('review', 1, 3, 1)]
const T2 = [
  run('implement', 2, 4, 4, { stepDone: 6, stepTotal: 6 }),
  run('review', 2, 8, 1, { findings: 2 }),
  run('fix', 2, 9, 1, { round: 1, stepDone: 3, stepTotal: 3 }),
  run('rereview', 2, 10, 1, { round: 1 }),
]
const T3 = [run('implement', 3, 11, 3, { stepDone: 4, stepTotal: 4 }), run('review', 3, 14, 1)]
const T4 = [run('implement', 4, 15, 4, { stepDone: 5, stepTotal: 5 }), run('review', 4, 19, 1)]
const T5 = [run('implement', 5, 20, 2, { model: 'claude-haiku-5-5', stepDone: 4, stepTotal: 4 }), run('review', 5, 22, 1)]
const FINAL = run('final', null, 23, 3)
const EXPLORE = run('other', null, 0, 1, { type: 'Explore', label: 'Map payment rules in design.md', model: 'claude-haiku-5-5' })

// Everyday mode: Claude's own task list, and agents with no list at all.
const LIST = checklistAsPlan({
  heading: 'Add CSV export to the reports page',
  items: [
    { key: '1', n: 1, text: 'Find how reports are built', status: 'completed' },
    { key: '2', n: 2, text: 'Add the CSV writer', status: 'in_progress' },
    { key: '3', n: 3, text: 'Wire the export button', status: 'pending' },
    { key: '4', n: 4, text: 'Run the tests', status: 'pending' },
  ],
})
const HAIKU = 'claude-haiku-5-5'
const EVERYDAY_LIST = [
  run('other', 1, 0, 1, { type: 'Explore', label: 'Find report builders', model: HAIKU }),
  running(run('other', 2, 1, 4, { label: 'Write the CSV writer and tests', stepDone: 3, stepTotal: 5, stepNote: 'Writing the tests', action: '✎ Editing lib/export/csv.ts', steps: 23 }), 6 * MIN),
  running(run('other', 2, 4, 2, { type: 'Explore', label: 'Check date formats in reports', model: HAIKU, action: '⌕ Searching "toLocaleDateString"', steps: 14 }), 6 * MIN),
]
const EVERYDAY_AGENTS = [
  run('other', null, 0, 1, { type: 'Explore', label: 'Map the API routes', model: HAIKU }),
  running(run('other', null, 0, 4, { type: 'code-reviewer', label: 'Review the auth middleware', model: 'claude-opus-5-5', stepDone: 2, stepTotal: 4, stepNote: 'Checking token expiry', action: '⌕ Reading src/auth/session.ts', steps: 11 }), 3 * MIN),
  running(run('other', null, 1, 2, { type: 'Explore', label: 'Find unused exports', model: HAIKU, action: '▶ Running pnpm ts-prune', steps: 9 }), 3 * MIN),
]

type Moment = { id: string; name: string; note: string; plan: Plan | null; runs: Run[]; now: number }

const MOMENTS: Moment[] = [
  {
    id: 'everyday-list',
    name: 'Task list',
    note: "No superpowers: Claude's own task list is the plan, and each agent sits under the task it was started for, saying what it is doing.",
    plan: LIST,
    now: 6 * MIN,
    runs: EVERYDAY_LIST,
  },
  {
    id: 'everyday-agents',
    name: 'No task list',
    note: 'Claude just sends agents out: the bar counts the ones finished, and each running agent says what it is doing.',
    plan: null,
    now: 3 * MIN,
    runs: EVERYDAY_AGENTS,
  },
  {
    id: 'rereview',
    name: 'Task 2 · fix round',
    note: 'The reviewer found 2 issues, the implementer fixed them, and a re-reviewer checks the fix.',
    plan: basePlan([1], 2),
    now: 10.5 * MIN,
    runs: [EXPLORE, ...T1, ...T2.slice(0, 3), running(T2[3]!, 10.5 * MIN)],
  },
  {
    id: 'implementing',
    name: 'Task 4 · implementing',
    note: 'The implementer reports its own steps, so its bar shows 2 of 5 done.',
    plan: basePlan([1, 2, 3], 4),
    now: 17 * MIN,
    runs: [EXPLORE, ...T1, ...T2, ...T3, { ...running(T4[0]!, 17 * MIN), stepDone: 2, stepTotal: 5, stepNote: 'reversal' }],
  },
  {
    id: 'done',
    name: 'Done',
    note: 'Every task is complete and the whole-branch review came back clean.',
    plan: basePlan([1, 2, 3, 4, 5], null),
    now: 26 * MIN,
    runs: [EXPLORE, ...T1, ...T2, ...T3, ...T4, ...T5, FINAL],
  },
]

type Img = { svg: string; w: number; h: number; alt: string; agentId?: string }

// The desktop panel of one moment: the mod's own layout (art.ts desktopPaneItems), so the two cannot drift.
// The page shows the first four finished rows and counts the rest, to keep it short.
function desktop(m: Moment): (Img | string)[] {
  const items = desktopPaneItems(W, m.plan, m.runs, m.now, { finishedOpen: true, ...(m.plan ? { phase: planPhase(m.plan, m.runs) } : {}) })
  const out: (Img | string)[] = []
  let finishedShown = 0
  let finishedTotal = 0
  let afterFinished = false
  for (const item of items) {
    if (item.kind === 'svg') {
      if (afterFinished) {
        finishedTotal++
        if (finishedShown >= 4) continue
        finishedShown++
      }
      out.push({ svg: item.svg, w: W, h: item.height, alt: item.alt, ...(item.agentId ? { agentId: item.agentId } : {}) })
    } else if (item.kind === 'finished') {
      afterFinished = true
      out.push(`btn:▾ Finished · ${item.count}`)
    } else if (item.kind === 'path') out.push(`path:${item.text}`)
    else if (item.kind === 'empty') out.push('sec:No subagents yet.')
    else if (item.kind === 'rule') out.push('rule:')
    else if (item.kind === 'group') out.push(`btn:${item.label}`)
    else out.push(`sec:${item.text}`)
  }
  if (finishedTotal > finishedShown) out.push(`more:${finishedTotal - finishedShown} more finished`)
  return out
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const span = (color: string | null, text: string, cls = '') => `<span${color ? ` style="color:${color}"` : ''}${cls ? ` class="${cls}"` : ''}>${esc(text)}</span>`

// The terminal panel of one moment, grouped by task as the panel draws it: a line under the
// header, each task with its agents (the current task open; the page opens and closes the rest).
function terminal(m: Moment): string {
  if (!m.plan) return noListTerminal(m)
  const phase = planPhase(m.plan, m.runs)
  const pct = Math.round((phase.isFinished ? 1 : phase.done / phase.total) * 100)
  const cost = m.runs.reduce((n, r) => n + r.costUsd, 0)
  const tokens = m.runs.reduce((n, r) => n + r.tokens, 0)
  const RULE = span(null, '─'.repeat(52), 'dim')
  const agent = (r: Run) => {
    const c = colorOf(r)
    const p = progressOf(r)
    const mark = r.status === 'done' ? span('#5fd787', GLYPH.done) : r.status === 'failed' ? span('#ff6b6b', GLYPH.failed) : span(c, GLYPH.running)
    const steps = stepsText(r)
    const name = `  ${span(c, '▣')} ${span(null, r.label || r.type, 'b')}`
    const details = `    ${span(c, runRole(r))}${span(null, ` · ${runModel(r)} · `, 'dim')}${mark}${span(null, ` ${fmtTime(elapsed(r, m.now))}  ≈${fmtCost(r.costUsd)}`, 'dim')}${r.findings ? span(ROLE_STYLE.review.color, `  ${r.findings} findings`) : ''}`
    const out = [r.agentId ? `<button type="button" class="tview" data-view="${r.agentId}">${name}</button><!--VIEWING:${r.agentId}-->` : name]
    if (r.status === 'running' && r.action) out.push(`    ${span(ACTION_COLOR, r.action)}`)
    out.push(details)
    if (r.status === 'running') out.push(`    ${p === null ? span(null, bar(ctxPercent(r), 14), 'dim') : span(c, bar(p * 100, 14))}${span(null, ` ${steps ? steps + ' · ' : ''}ctx ${ctxPercent(r)}% · ${fmtTokens(r.contextTokens)}`, 'dim')}`)
    return out
  }
  const lines: string[] = [
    span(ACCENT, m.plan.title, 'b'),
    span(null, m.plan.path, 'dim'),
    `${span(phase.isFinished ? DONE_COLOR : ACCENT, bar(pct, 24))} ${span(null, phase.label, 'b')} ${span(null, `${pct}%`, 'dim')}`,
    span(null, `≈${fmtCost(cost)} · ${fmtTokens(tokens)} tokens`, 'dim'),
    RULE,
  ]
  for (const g of planGroups(m.plan, m.runs)) {
    const open = isGroupOpen(g)
    if (g.kind === 'other') lines.push(RULE)
    const mark = g.kind === 'final' ? span(ROLE_STYLE.final.color, '◆') : g.kind === 'other' ? span(colorOf(g.runs[0]!), '◇') : g.state === 'done' ? span('#5fd787', GLYPH.done) : g.state === 'current' ? span(ROLE_STYLE.implement.color, GLYPH.running) : span(ACCENT, GLYPH.waiting)
    const name = g.state === 'waiting' && g.n !== null ? `${span(ACCENT, `${g.n}.`)} ${esc(g.name.slice(String(g.n).length + 2))}` : span(null, g.name, g.state === 'current' ? 'b' : '')
    const count = g.runs.length ? span(null, `  ${groupCount(g)}`, 'dim') : ''
    if (!g.runs.length) {
      lines.push(`  ${mark} ${name}`)
      continue
    }
    lines.push(`<button type="button" class="tgroup" data-group="${g.key}" aria-expanded="${open}"><span class="dim chev">${open ? '▾' : '▸'}</span> ${mark} ${name}${count}</button>`)
    lines.push(`<div class="tbody" data-body="${g.key}"${open ? '' : ' hidden'}>${g.runs.flatMap(agent).map(l => `<div class="ln">${l}</div>`).join('')}</div>`)
  }
  return lines.map(l => (l.startsWith('<div class="tbody"') ? l : `<div class="ln">${l || '&nbsp;'}</div>`)).join('')
}

// The terminal panel with no task list: counts and a bar, the agents at work, the finished ones folded.
function noListTerminal(m: Moment): string {
  const ph = noListPhase(m.runs)
  const pct = ph.total ? Math.round((ph.done / ph.total) * 100) : 0
  const cost = m.runs.reduce((n, r) => n + r.costUsd, 0)
  const tokens = m.runs.reduce((n, r) => n + r.tokens, 0)
  const RULE = span(null, '─'.repeat(52), 'dim')
  const working = m.runs.filter(r => r.status === 'running')
  const done = m.runs.filter(r => r.status !== 'running')
  const lines: string[] = [
    span(ACCENT, noListHeading(m.runs), 'b'),
    `${span(ACCENT, bar(pct, 24))} ${span(null, ph.label, 'b')} ${span(null, `${pct}%`, 'dim')}`,
    span(null, `≈${fmtCost(cost)} · ${fmtTokens(tokens)} tokens`, 'dim'),
    RULE,
    span(null, `Working · ${working.length}`, 'dim'),
  ]
  for (const r of working) {
    const c = colorOf(r)
    const p = progressOf(r)
    const steps = stepsText(r)
    lines.push(`  ${span(c, '▣')} <button type="button" class="tview" data-view="${r.agentId}">${span(null, r.label, 'b')}</button><!--VIEWING:${r.agentId}-->`)
    if (r.action) lines.push(`    ${span(ACTION_COLOR, r.action)}`)
    lines.push(`    ${span(c, runRole(r))}${span(null, ` · ${runModel(r)} · `, 'dim')}${span(c, GLYPH.running)}${span(null, ` ${fmtTime(elapsed(r, m.now))}  ≈${fmtCost(r.costUsd)}`, 'dim')}`)
    lines.push(`    ${p === null ? span(null, bar(ctxPercent(r), 14), 'dim') : span(c, bar(p * 100, 14))}${span(null, ` ${steps ? steps + ' · ' : ''}ctx ${ctxPercent(r)}%`, 'dim')}`)
    lines.push('')
  }
  if (done.length) {
    lines.push(RULE, span(null, `▾ Finished · ${done.length}`, 'dim'))
    for (const r of done) lines.push(`  ${span('#5fd787', finishedLine(r, m.now).slice(0, 1))}${span(null, finishedLine(r, m.now).slice(1), 'dim')}`)
  }
  return lines.map(l => `<div class="ln">${l || '&nbsp;'}</div>`).join('')
}

const ROLES: { role: Run['role']; label: string; example: string }[] = [
  { role: 'implement', label: 'Implementing', example: 'Implement Task N: …' },
  { role: 'review', label: 'Reviewing', example: 'Review Task N (spec + quality)' },
  { role: 'fix', label: 'Fixing, re-reviewing', example: 'Re-review Task N fix round R' },
  { role: 'final', label: 'Final review', example: 'Review code changes' },
]
// Agents outside a plan's roles: a colour per type.
const TYPES: { type: string; costume: string; label: string; example: string }[] = [
  { type: 'Explore', costume: 'explore', label: 'Explore', example: 'searches, outside a plan' },
  { type: 'general-purpose', costume: 'other', label: 'Other agents', example: 'a colour per agent type' },
]

const legend = ROLES.map(({ role, label, example }) => {
  const style = ROLE_STYLE[role]
  const costume = role === 'other' ? 'other' : style.costume
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="33" height="31" viewBox="-1 -2 33 31">${CRAB_CSS}${crab(0, 0, costume, { walking: true, scale: 1, accent: style.color })}</svg>`
  return { role, label, example, color: style.color, svg }
}).concat(
  TYPES.map(({ type, costume, label, example }) => {
    const color = colorOf({ role: 'other', type } as Run)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="33" height="31" viewBox="-1 -2 33 31">${CRAB_CSS}${crab(0, 0, costume, { walking: true, scale: 1, accent: color })}</svg>`
    return { role: 'other' as Run['role'], label, example, color, svg }
  }),
)

// The row above the prompt: its pieces for each moment, drawn by the mod's own art.ts.
const CONTEXTS: Record<string, number> = { 'everyday-list': 22, 'everyday-agents': 12, rereview: 22, implementing: 38, done: 46 }
const row = Object.fromEntries(
  MOMENTS.map(m => {
    const phase = m.plan ? planPhase(m.plan, m.runs) : noListPhase(m.runs)
    const working = m.runs.filter(r => r.status === 'running').length
    const title = m.plan ? m.plan.title : `${working} working · ${m.runs.length - working} done`
    const pct = Math.round((phase.isFinished ? 1 : phase.total ? phase.done / phase.total : 0) * 100)
    const agent = m.runs.filter(r => r.status === 'running').at(-1)
    return [m.id, { title: m.plan && title.length > 28 ? title.slice(0, 27) + '…' : title, bar: planBarSvg(title, phase, working, 330), label: m.plan ? phase.label : '', pct, working: m.plan ? working : 0, isFinished: phase.isFinished, context: CONTEXTS[m.id] ?? 30, line: agent ? `Agent(${agent.label || runTitle(agent, m.plan)})` : 'All 5 tasks are complete and the branch review is clean.' }]
  }),
)
const rowIcons = {
  branch: branchIconSvg(),
  hourglass: { cache: hourglassSvg(CACHE_COLOR), warn: hourglassSvg(WARN_COLOR), alert: hourglassSvg(ALERT_COLOR) },
  ring: Object.fromEntries([12, 22, 30, 38, 46].map(p => [p, contextRingSvg(p)])),
  bar: Object.fromEntries([12, 22, 30, 38, 46].map(p => [p, contextBarSvg(p)])),
  colors: { cache: CACHE_COLOR, warn: WARN_COLOR, alert: ALERT_COLOR, accent: ACCENT, done: DONE_COLOR },
}

const data = {
  moments: MOMENTS.map(m => ({
    id: m.id,
    name: m.name,
    note: m.note,
    desktop: desktop(m),
    terminal: terminal(m),
    // What the main view would show for each agent: its row's title and role.
    views: Object.fromEntries(m.runs.filter(r => r.agentId).map(r => [r.agentId, `${runTitle(r, m.plan)} (${runRole(r)})`])),
  })),
  legend,
  row: { moments: row, icons: rowIcons },
}

const page = await Bun.file(new URL('./preview-page.html', import.meta.url)).text()
process.stdout.write(page.replace('/*DATA*/null', JSON.stringify(data).replace(/</g, '\\u003c')))
