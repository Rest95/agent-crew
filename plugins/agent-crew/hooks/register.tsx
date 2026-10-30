import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Checklist, Main, Plan, Run } from '../types'
import {
  ACCENT,
  AGENT_ROW_HEIGHT,
  ALERT_COLOR,
  BAR_HEIGHT,
  CACHE_COLOR,
  DONE_COLOR,
  ACTION_COLOR,
  GLYPH,
  finishedLine,
  noListHeading,
  noListPhase,
  ROLE_STYLE,
  TASK_ROW_HEIGHT,
  TOTALS_HEIGHT,
  WARN_COLOR,
  agentRowSvg,
  branchIconSvg,
  desktopPaneItems,
  groupCount,
  isGroupOpen,
  planGroups,
  contextBarSvg,
  contextRingSvg,
  hourglassSvg,
  levelColor,
  modelName,
  bar,
  colorOf,
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
} from './art'
import { cacheView, classify, currentTask, isPlanLabel, contextLevel, costOf, countFindings, dueWarning, rowProgress, rowTier, fixRound, parseBranch, parseLedger, parsePlan, parseScriptCall, planPhase, rootOf, samePlan, windowOf, workspaceFrom } from './model'
import { applyMainTaskCall, applyTaskCall, checklistAsPlan, checklistProgress, describeAction, headingOf, isListDone, isTaskTool, placeAgent } from './model'
import type { ScriptCall, Usage } from './model'

const PANE = 'agent-crew'
const PANE_TITLE = 'Agents'
// The panel sits on the terminal's own background, not Claude Code's grey fill, so its colours read.
const PANE_BACKGROUND = 'transparent'
const STEP_TOOL = 'mcp__agent-crew__step'
// Appended to an implementer's instructions, so its row can show `3/6 · retries`.
const STEP_BRIEF = `\n\nProgress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar.`
const MAX_RUNS = 200

const planAtom = atom({ plugin: 'agent-crew', key: 'plan' } as const, null)
const runsAtom = atom({ plugin: 'agent-crew', key: 'runs' } as const, [])
const finishedOpenAtom = atom({ plugin: 'agent-crew', key: 'finishedOpen' } as const, true)
const openGroupsAtom = atom({ plugin: 'agent-crew', key: 'openGroups' } as const, {} as Record<string, boolean>)
const nowAtom = atom({ plugin: 'agent-crew', key: 'now' } as const, 0)
const mainAtom = atom({ plugin: 'agent-crew', key: 'main' } as const, {
  model: null,
  effort: null,
  branch: null,
  context: null,
  busy: false,
  expiresAt: null,
  warned: 0,
  rowHidden: false,
  planDoneAt: null,
  lastServedAt: null,
} as Main)
const cacheLeftAtom = atom({ plugin: 'agent-crew', key: 'cacheLeft' } as const, -1)
const checklistAtom = atom({ plugin: 'agent-crew', key: 'checklist' } as const, null as Checklist | null)
const promptAtom = atom({ plugin: 'agent-crew', key: 'prompt' } as const, '')

/** What the panel and the row draw as the plan: superpowers' plan, else Claude's own task list. */
const shownPlan = async ($: EngineInterface): Promise<Plan | null> => {
  const plan: Plan | null = await read($, planAtom)
  if (plan) return plan
  const list: Checklist | null = await read($, checklistAtom)
  return list ? checklistAsPlan(list) : null
}

const CACHE_TTL_MS = 60 * 60 * 1000
const RECONCILE_EVERY_TICKS = 5
const BRANCH_EVERY_TICKS = 60

// ---------------------------------------------------------------------------
// The main session, for the row above the prompt.

const setMain = ($: EngineInterface, patch: Partial<Main>): Promise<unknown> => update($, mainAtom, (m: Main) => ({ ...m, ...patch }))

// Work done beside the engine's calls: in order, never in their way.
let queue: Promise<void> = Promise.resolve()
const beside = (work: () => Promise<unknown>): void => {
  queue = queue.then(work).then(
    () => undefined,
    () => undefined,
  )
}

// Reads can overlap (a burst of Bash calls): only the latest one started may write.
let branchReads = 0
async function readBranch($: EngineInterface): Promise<void> {
  const read = ++branchReads
  const cwd = await $.session.cwd()
  const ran = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'], { timeoutMs: 5000 }).catch(() => null)
  if (read !== branchReads) return
  await setMain($, { branch: ran ? parseBranch(ran.exitCode, ran.stdout) : null })
}

// Before the first request, the effort the settings give the session's model (then any default).
async function readEffortSetting($: EngineInterface): Promise<void> {
  const main: Main = await read($, mainAtom)
  if (main.effort !== null) return
  const settings = (await $.settings.read()) as { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown } | undefined> }
  const level = (main.model ? settings.modelSettings?.[main.model]?.effortLevel : undefined) ?? settings.effortLevel
  if (typeof level === 'string') await setMain($, { effort: level })
}

async function readContext($: EngineInterface): Promise<void> {
  const percent = (await $.session.usage()).context.percent
  if (typeof percent === 'number') await setMain($, { context: Math.round(percent) })
}

// The cache warning: Claude Code's own notification (it reaches the phone too), else a toast.
async function notifyCache($: EngineInterface, minutes: number): Promise<void> {
  const project = (await $.session.cwd()).split('/').filter(Boolean).pop() ?? 'session'
  const message = `${project}: Prompt cache expires in ${minutes} min`
  const sent = await $.tool.call({ tool: 'PushNotification', message, status: 'proactive' } as never).catch(() => null)
  const result = (sent as { deny?: unknown; isError?: boolean; result?: { pushSent?: boolean; localSent?: boolean } } | null) ?? null
  const isDelivered = result !== null && result.deny === undefined && result.isError !== true && (result.result?.pushSent === true || result.result?.localSent === true)
  if (!isDelivered) $.ui.toast(`⏳ ${message}`, { timeoutMs: 30000 })
}

// Once a second: the cache warning, the moment the plan is done, and now and then the branch.
let ticks = 0
let ledgerTicks = 0
const LEDGER_EVERY_TICKS = 10
async function tickRow($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const main: Main = await read($, mainAtom)
  if (main.expiresAt === null && (await read($, planAtom)) === null) {
    ticks = (ticks + 1) % BRANCH_EVERY_TICKS
    if (ticks === 0 && main.branch !== null) await readBranch($)
    return
  }
  // While a plan is open, its ledger is read again every few seconds: tasks finish between events.
  ledgerTicks = (ledgerTicks + 1) % LEDGER_EVERY_TICKS
  const openPlan: Plan | null = await read($, planAtom)
  if (ledgerTicks === 0 && openPlan && !planPhase(openPlan, await read($, runsAtom)).isFinished) await refreshLedger($)
  const due = dueWarning(main, now)
  if (due !== null) {
    await setMain($, { warned: due })
    const left = main.expiresAt === null ? 0 : Math.ceil((main.expiresAt - now) / 60_000)
    await notifyCache($, left)
  }
  // The countdown is drawn from the clock: one small write a second keeps the row redrawing.
  if (!main.busy && main.expiresAt !== null) {
    const left = Math.max(0, Math.floor((main.expiresAt - now) / 1000))
    if ((await read($, cacheLeftAtom)) !== left) await update($, cacheLeftAtom, () => left)
  }
  const plan = await shownPlan($)
  if (plan && main.planDoneAt === null && planPhase(plan, await read($, runsAtom)).isFinished) await setMain($, { planDoneAt: now })
  // Outside a repository there is nothing to poll; a Bash call (a cd, a git init) reads it again.
  ticks = (ticks + 1) % BRANCH_EVERY_TICKS
  if (ticks === 0 && main.branch !== null) await readBranch($)
}

const openPane = ($: EngineInterface): void => {
  void $.ui.open({ id: PANE, title: PANE_TITLE, backgroundColor: PANE_BACKGROUND }).catch(() => undefined)
}

/** The newest run of an agent: a resumed implementer has several. */
const newestOf = (list: readonly Run[], agentId: string): Run | undefined => list.filter(r => r.agentId === agentId).at(-1)

/**
 * The runs after an agent is resumed: a finished implementer comes back as a new `fix` row (its
 * first row keeps its tokens and its crab); any other agent's newest row runs again.
 */
function resumedList(list: Run[], agentId: string, at: number): Run[] {
  const run = newestOf(list, agentId)
  if (!run || run.status === 'running') return list
  if (run.role === 'implement' || run.role === 'fix') {
    const fix: Run = {
      ...run,
      id: `${agentId}#${list.filter(r => r.agentId === agentId).length + 1}`,
      role: 'fix',
      round: fixRound(run.task ?? 0, list),
      status: 'running',
      startedAt: at,
      endedAt: undefined,
      contextTokens: 0,
      tokens: 0,
      costUsd: 0,
      requests: 0,
      stepDone: undefined,
      stepTotal: undefined,
      stepNote: undefined,
    }
    return [...list, fix].slice(-MAX_RUNS)
  }
  return list.map(r => (r === run ? { ...run, status: 'running', endedAt: undefined } : r))
}

// The engine's word on agents the mod still shows as running.
async function reconcile($: EngineInterface, at: number): Promise<void> {
  const agents = await $.agent.list()
  const statusOf = new Map(agents.map(a => [a.id, a.status]))
  await update($, runsAtom, (list: Run[]) =>
    list.map(r => {
      const status = r.status === 'running' && r.agentId ? statusOf.get(r.agentId) : undefined
      if (status === 'completed' || status === 'idle') return { ...r, status: 'done', endedAt: at }
      if (status === 'failed' || status === 'killed') return { ...r, status: 'failed', endedAt: at }
      return r
    }),
  )
}

// A press on an agent's row: its transcript in the main view, or back to main when it is already there.
async function viewAgent($: EngineInterface, run: Run, viewing: string | undefined): Promise<void> {
  if (!run.agentId) return
  const answer = await $.ui.view(viewing === run.agentId ? {} : { agentId: run.agentId })
  if (answer.deny !== undefined) $.ui.toast("That agent's transcript isn't available any more.", { timeoutMs: 6000 })
}

async function resume($: EngineInterface, agentId: string, at: number): Promise<void> {
  await update($, runsAtom, (list: Run[]) => resumedList(list, agentId, at))
  await update($, nowAtom, () => at)
}

// A name cut to `max` characters, the last one an ellipsis when it had to.
const shorten = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)

const usageTokens = (u: Usage): number =>
  (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

// ---------------------------------------------------------------------------
// Finding a plan's workspace without the scripts' output (Claude often captures it, as in
// `BRIEF=$(bash …/task-start …)`): superpowers keeps each plan's files in
// <repo-root>/.superpowers/sdd/<plan>/, with a `plan-path` marker naming the plan.

async function repoRoot($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  const ran = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 }).catch(() => null)
  return ran && ran.exitCode === 0 && ran.stdout.trim() ? ran.stdout.trim() : cwd
}

async function workspaces($: EngineInterface): Promise<{ dir: string; plan: string }[]> {
  const base = `${await repoRoot($)}/.superpowers/sdd`
  const entries = await $.fs.list(base).catch(() => [])
  const found: { dir: string; plan: string }[] = []
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    const dir = `${base}/${entry.name}`
    const marker = await $.fs.read(`${dir}/plan-path`).then(
      text => String(text).trim(),
      () => '',
    )
    if (marker) found.push({ dir, plan: marker })
  }
  return found
}

const findWorkspace = async ($: EngineInterface, planPath: string): Promise<string | null> =>
  (await workspaces($)).find(w => samePlan(w.plan, planPath))?.dir ?? null

// The plan most recently worked on: the workspace whose ledger changed last.
async function latestWorkspace($: EngineInterface): Promise<{ dir: string; plan: string } | null> {
  let best: { dir: string; plan: string; at: number } | null = null
  for (const w of await workspaces($)) {
    const at = await $.fs.stat(`${w.dir}/progress.md`).then(
      st => st.mtimeMs,
      () => -1,
    )
    if (at >= 0 && (!best || at > best.at)) best = { ...w, at }
  }
  return best ? { dir: best.dir, plan: best.plan } : null
}

// A plan's file, read from its worktree's root first when the workspace names one.
async function readPlanFile($: EngineInterface, planPath: string, workspace: string | null): Promise<string | null> {
  const candidates = workspace && !planPath.startsWith('/') ? [`${rootOf(workspace)}/${planPath}`, planPath] : [planPath]
  for (const path of candidates) {
    const text = await $.fs.read(path).then(
      t => String(t),
      () => null,
    )
    if (text !== null) return text
  }
  return null
}

// /crew with no plan showing: the plan in progress, with what its ledger says is done.
async function discoverPlan($: EngineInterface): Promise<void> {
  const latest = await latestWorkspace($)
  if (!latest) return
  const text = await readPlanFile($, latest.plan, latest.dir)
  if (text === null) return
  await update($, planAtom, () => ({ path: latest.plan, ...parsePlan(latest.plan, text), workspace: latest.dir, complete: [], current: null, inline: false }))
  await refreshLedger($)
}

// The ledger says which tasks are complete; a workspace that is gone means the plan was closed clean.
async function refreshLedger($: EngineInterface): Promise<void> {
  let plan: Plan | null = await read($, planAtom)
  if (plan && !plan.workspace) {
    const found = await findWorkspace($, plan.path)
    if (found) {
      await update($, planAtom, (p: Plan | null) => (p && p.path === plan?.path ? { ...p, workspace: found } : p))
      plan = { ...plan, workspace: found }
    }
  }
  if (!plan?.workspace) return
  let complete: number[] | null = null
  try {
    const file = `${plan.workspace}/progress.md`
    if (!(await $.fs.exists(plan.workspace))) complete = plan.tasks.map(t => t.n)
    else if (await $.fs.exists(file)) complete = parseLedger(String(await $.fs.read(file)), plan.path)
  } catch {
    return
  }
  if (complete) await update($, planAtom, (p: Plan | null) => (p && p.path === plan.path ? { ...p, complete } : p))
}

async function onScript($: EngineInterface, call: ScriptCall, stdout: string): Promise<void> {
  let plan: Plan | null = await read($, planAtom)
  // The output names the workspace when it was printed; else its marker does.
  const workspace = workspaceFrom(call, stdout) ?? (plan && samePlan(plan.path, call.plan) && plan.workspace ? plan.workspace : await findWorkspace($, call.plan))
  const isOther = !plan || !samePlan(plan.path, call.plan) || (workspace !== null && plan.workspace !== null && workspace !== plan.workspace)
  if (isOther) {
    // In a worktree the plan may exist only there: the workspace names the worktree's root.
    const text = await readPlanFile($, call.plan, workspace)
    if (text === null) {
      // A plan the mod cannot read is no plan: agents stay plain rows.
      await update($, planAtom, () => null)
      return
    }
    plan = { path: call.plan, ...parsePlan(call.plan, text), workspace, complete: [], current: null, inline: false }
    await setMain($, { planDoneAt: null })
    // A new plan starts with its own crew; agents still running stay.
    await update($, runsAtom, (list: Run[]) => list.filter(r => r.status === 'running'))
  }
  if (!plan) return
  const next: Plan = {
    ...plan,
    workspace: workspace ?? plan.workspace,
    inline: plan.inline || call.script === 'task-start',
    current: (call.script === 'task-brief' || call.script === 'task-start') && call.task !== null ? call.task : plan.current,
  }
  await update($, planAtom, () => next)
  await refreshLedger($)
  // The pane opens when a plan starts; later scripts of the same plan leave a closed pane closed.
  if (isOther) openPane($)
}

const stdoutOf = (done: unknown): string => {
  const result = (done as { result?: unknown } | null)?.result
  if (typeof result === 'string') return result
  const stdout = (result as { stdout?: unknown } | null)?.stdout
  return typeof stdout === 'string' ? stdout : ''
}

/** Everyday tracking: Claude's task list from the main conversation; an agent's action, steps and own list from its loop. */
async function onToolCall($: EngineInterface, tool: string, input: unknown, result: unknown, agentId: string | undefined): Promise<void> {
  const call = { tool, input, result }
  if (!agentId) {
    if (!isTaskTool(tool)) return
    const heading = headingOf(await read($, promptAtom))
    let list: Checklist | null = null
    await update($, checklistAtom, (current: Checklist | null) => (list = applyMainTaskCall(current, call, heading)))
    // A list at work starts the row's Done afresh (superpowers keeps its own).
    if (list && !isListDone((list as Checklist).items) && (await read($, planAtom)) === null) await setMain($, { planDoneAt: null })
    return
  }
  const action = describeAction(tool, input, await $.session.cwd().catch(() => null))
  await update($, runsAtom, (runs: Run[]) => {
    const run = newestOf(runs, agentId)
    if (!run || run.status !== 'running') return runs
    let next: Run = { ...run, ...(action ? { action } : {}), ...(isTaskTool(tool) ? {} : { steps: (run.steps ?? 0) + 1 }) }
    if (isTaskTool(tool)) {
      const base = run.ownList ?? []
      const own = applyTaskCall(base, call)
      if (own !== base) {
        next = { ...next, ownList: own }
        if (run.stepSource !== 'tool') {
          const p = checklistProgress(own)
          next = { ...next, stepDone: p.done, stepTotal: p.total, stepNote: p.note, stepSource: 'list' }
        }
      }
    }
    return runs.map(r => (r === run ? next : r))
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: 'step',
      description:
        'For implementer subagents of a superpowers plan: report progress on your own task to the Agents panel. ' +
        'Right after reading your brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
        'call it again as each step finishes. Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'crew', description: 'Show or hide the Agents panel; /crew row shows or hides the row above the prompt', argumentHint: '[row]' })
    // Elapsed times tick while something runs; quiet otherwise. Every few seconds the engine's own
    // agent list closes a run whose end never reached the mod (a reload mid-agent).
    let panelTicks = 0
    $.clock.every(1000, () => {
      void (async () => {
        const list: Run[] = await read($, runsAtom)
        if (!list.some(r => r.status === 'running')) return
        const at = await $.clock.now()
        await update($, nowAtom, () => at)
        panelTicks = (panelTicks + 1) % RECONCILE_EVERY_TICKS
        if (panelTicks === 0) await reconcile($, at)
      })().catch(() => undefined)
    })
    $.clock.every(1000, () => {
      void tickRow($).catch(() => undefined)
    })
    try {
      // The session's own model (as /model shows it), not a settings alias; a reload keeps what was learned.
      if ((await read($, mainAtom)).model === null) await setMain($, { model: await $.session.model() })
    } catch {
      // The row shows what it has.
    }
    // Reading the branch and the effort setting never holds up the start.
    void readBranch($).catch(() => undefined)
    beside(() => readEffortSetting($))
    // A plan carried over (a reload, a resumed session) shows what its ledger says now, every
    // task at its default (the current one open).
    beside(() => refreshLedger($))
    beside(() => update($, openGroupsAtom, () => ({})))
    return started
  })

  on('command.run', { command: 'crew' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'row') {
      const main: Main = await read($, mainAtom)
      await setMain($, { rowHidden: !main.rowHidden })
      return { text: main.rowHidden ? 'Crew row shown.' : 'Crew row hidden.' }
    }
    // The panel shows what the ledger says now: pick up the plan in progress, or read it again.
    try {
      if ((await read($, planAtom)) === null) await discoverPlan($)
      else await refreshLedger($)
    } catch {
      // The panel shows what it has.
    }
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Crew panel closed.' }
    }
    await $.ui.open({ id: PANE, title: PANE_TITLE, backgroundColor: PANE_BACKGROUND })
    return { text: 'Crew panel opened.' }
  })

  // Every tool call: what an agent is doing, and task lists. Beside the call, never in its way.
  on('tool.call', async ($, e, next) => {
    const done = await next(e)
    try {
      const tool = String((e as { tool?: unknown }).tool ?? '')
      if (tool !== STEP_TOOL) {
        const result = (done as { result?: unknown } | null)?.result
        const agentId = e.agentId
        beside(() => onToolCall($, tool, e, result, agentId))
      }
    } catch {
      // The panel never gets in the way of a tool call.
    }
    return done
  })

  // The person's latest prompt: the heading of the next task list.
  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    try {
      if (!e.isMeta && !e.command && entered && !('drop' in entered && entered.drop)) beside(() => update($, promptAtom, () => e.text))
    } catch {
      // Nothing to remember.
    }
    return entered
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const done = await next(e)
    try {
      const call = parseScriptCall(String((e as { command?: unknown }).command ?? ''))
      if (call) {
        const stdout = stdoutOf(done)
        beside(() => onScript($, call, stdout))
      }
      // A Bash call of the main session may have switched branches; read it beside the work.
      if (!e.agentId) void readBranch($).catch(() => undefined)
    } catch {
      // The panel never gets in the way of a tool call.
    }
    return done
  })

  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { agentId?: string; done?: number; total?: number; note?: string }
    const agentId = input.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    let matched = false
    await update($, runsAtom, (list: Run[]) => {
      const run = newestOf(list, agentId)
      if (!run || run.status !== 'running') return list
      matched = true
      const total = Math.max(0, Math.round(input.total ?? run.stepTotal ?? 0))
      const doneSteps = Math.max(0, Math.round(input.done ?? run.stepDone ?? 0))
      const stepped: Run = { ...run, stepTotal: total, stepDone: total ? Math.min(total, doneSteps) : doneSteps, stepNote: input.note?.trim() || undefined, stepSource: 'tool' }
      return list.map(r => (r === run ? stepped : r))
    })
    return { result: matched ? 'ok' : `ignored: no running row for agent ${agentId}` }
  })

  on('agent.spawn', async ($, e, next) => {
    // A resumed agent (a fix round of its implementer) keeps its first row and gets a new one.
    const resumed = e.resume?.agentId
    if (resumed) {
      const started = await next(e)
      if (started.deny !== undefined) return started
      try {
        await resume($, resumed, await $.clock.now())
      } catch {
        // The turn.step fallback will try again.
      }
      openPane($)
      return started
    }
    // Classifying never holds up the spawn: unsure means a plain row.
    let kind: ReturnType<typeof classify> = { role: 'other', task: null, round: 0 }
    try {
      // A plan's agent with no plan showing (its scripts went unseen): pick up the plan in progress.
      if ((await read($, planAtom)) === null && isPlanLabel(e.description)) await discoverPlan($)
      // The controller ledgers a task right before starting the next agent: read it first.
      await refreshLedger($)
      kind = classify(e.description, await read($, planAtom), await read($, runsAtom))
      // No superpowers plan: Claude's own list places the agent, and a finished list gives way.
      if ((await read($, planAtom)) === null) {
        const list: Checklist | null = await read($, checklistAtom)
        if (list && isListDone(list.items)) await update($, checklistAtom, () => null)
        else if (list) kind = { ...kind, task: placeAgent(list.items, e.description) }
      }
    } catch {
      // Keep the plain row.
    }
    const isImplementer = (kind.role === 'implement' || kind.role === 'fix') && !e.prompt.includes(STEP_TOOL)
    const started = await next(isImplementer ? { ...e, prompt: e.prompt + STEP_BRIEF } : e)
    if (started.deny !== undefined) return started
    try {
      const at = await $.clock.now()
      const model = started.model || e.model || e.parentModel
      const run: Run = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        label: e.description,
        type: e.subagentType,
        model,
        ...kind,
        status: 'running',
        startedAt: at,
        contextTokens: 0,
        contextMax: windowOf(model),
        tokens: 0,
        costUsd: 0,
        requests: 0,
      }
      await update($, runsAtom, (list: Run[]) => [...list.filter(r => r.id !== run.id), run].slice(-MAX_RUNS))
      if (run.task !== null) await update($, planAtom, (p: Plan | null) => (p ? { ...p, current: run.task } : p))
      // New work on a group shows itself: a task (or the final review) closed by hand opens again.
      const group = run.role === 'final' ? 'final' : run.task !== null ? `t${run.task}` : null
      if (group) await update($, openGroupsAtom, (o: Record<string, boolean>) => (group in o ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== group)) : o))
      await update($, nowAtom, () => at)
    } catch {
      // A row the panel could not record is a row it does not draw.
    }
    openPane($)
    return started
  })

  // Claude Code's own measure after each turn and after /compact: the row's context follows it.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    const percent = e.context.percent
    if (typeof percent === 'number') await setMain($, { context: Math.round(percent) }).catch(() => undefined)
    return measured
  })

  // /clear starts a new conversation: the old one's cache and context no longer apply.
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear') {
      await setMain($, { busy: false, expiresAt: null, warned: 0, context: null, lastServedAt: null }).catch(() => undefined)
      await update($, checklistAtom, () => null).catch(() => undefined)
      await update($, promptAtom, () => '').catch(() => undefined)
    }
    return ended
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (!e.agentId) beside(() => setMain($, { busy: true }))
    return started
  })

  // Each model request of a subagent: live context, tokens and cost; a finished implementer
  // that makes a request again was resumed for a fix round.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    if (!agentId) {
      beside(async () => {
        const model = result.usage?.model || e.model
        const servedAt = result.usage ? await $.clock.now() : null
        const effort = typeof e.effort === 'string' ? e.effort : null
        await setMain($, { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(servedAt !== null ? { lastServedAt: servedAt } : {}) })
        await readContext($)
      })
      return result
    }
    // Stats are best effort, kept beside the agent's work.
    beside(async () => {
      const at = await $.clock.now()
      const usage = result.usage
      await update($, runsAtom, (list: Run[]) => {
        let run = newestOf(list, agentId)
        if (!run) return list
        let out = list
        if (run.status !== 'running') {
          // A resume that raised no agent.spawn: the same bookkeeping, here.
          out = resumedList(list, agentId, at)
          run = newestOf(out, agentId) ?? run
        }
        if (!usage) return out
        const model = usage.model || e.model || run.model
        const updated: Run = {
          ...run,
          model,
          effort: typeof e.effort === 'string' ? e.effort : run.effort,
          contextTokens: usageTokens(usage),
          contextMax: windowOf(model),
          tokens: run.tokens + usageTokens(usage),
          costUsd: run.costUsd + costOf(model, usage, true),
          requests: run.requests + 1,
        }
        return out.map(r => (r === run ? updated : r))
      })
      await update($, nowAtom, () => at)
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (!agentId) {
      // The turn ended: the cache is warm for an hour from the latest request served, which an
      // error or an interrupt does not move.
      beside(async () => {
        const m: Main = await read($, mainAtom)
        const expiresAt = m.lastServedAt === null ? m.expiresAt : m.lastServedAt + CACHE_TTL_MS
        await setMain($, expiresAt !== m.expiresAt ? { busy: false, expiresAt, warned: 0 } : { busy: false })
        await readContext($)
      })
      return result
    }
    // The panel never gets in the way of an agent: its bookkeeping is queued beside it.
    beside(async () => {
      const at = await $.clock.now()
      const answer = typeof (e as { answer?: unknown }).answer === 'string' ? (e as { answer: string }).answer : ''
      await update($, runsAtom, (list: Run[]) => {
        const run = newestOf(list, agentId)
        if (!run) return list
        const usage = e.usage
        const ended: Run = {
          ...run,
          status: e.reason === 'answer' ? 'done' : 'failed',
          endedAt: at,
          ...(run.role === 'review' || run.role === 'rereview' ? { findings: countFindings(answer) } : {}),
          ...(run.requests === 0 && usage ? { model: usage.model || run.model, tokens: usageTokens(usage), costUsd: costOf(usage.model || run.model, usage, false) } : {}),
        }
        return list.map(r => (r === run ? ended : r))
      })
      await update($, nowAtom, () => at)
      await refreshLedger($)
    })
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const plan = await shownPlan($)
    const list: Run[] = await read($, runsAtom)
    const isOpen: boolean = await read($, finishedOpenAtom)
    const openGroups: Record<string, boolean> = await read($, openGroupsAtom)
    const toggleGroup = (key: string, wasOpen: boolean) => update($, openGroupsAtom, (o: Record<string, boolean>) => ({ ...o, [key]: !wasOpen }))
    const now = Math.max(await read($, nowAtom), ...list.map(r => r.startedAt), 0)
    const running = list.filter(r => r.status === 'running')
    const finished = list.filter(r => r.status !== 'running').reverse()
    const cost = list.reduce((n, r) => n + r.costUsd, 0)
    const tokens = list.reduce((n, r) => n + r.tokens, 0)
    const span = list.length ? Math.max(...list.map(r => r.endedAt ?? now)) - Math.min(...list.map(r => r.startedAt)) : 0
    const phase = plan ? planPhase(plan, list) : null
    const percent = phase ? Math.round((phase.isFinished ? 1 : phase.total ? phase.done / phase.total : 0) * 100) : 0
    // The main session works a task inline until the ledger marks it complete.
    const inlineTask =
      plan?.inline && plan.current !== null && running.length === 0 && !plan.complete.includes(plan.current) && !phase?.isFinished
        ? plan.tasks.find(t => t.n === plan.current)
        : undefined
    const current = plan ? currentTask(plan, list) : null
    const taskState = (n: number): 'done' | 'current' | 'waiting' =>
      plan?.complete.includes(n) ? 'done' : n === current || running.some(r => r.task === n) ? 'current' : 'waiting'
    // The transcript in the main view: an agent's, opened from a row here or from Claude Code's list.
    const viewing = e.props.view?.agentId
    const backButton = viewing ? <Button key="view-main" label="← Back to main" plain onPress={() => void $.ui.view({})} /> : null
    const finishedButton = (
      <Button
        key="finished"
        label={`${isOpen ? '▾' : '▸'} Finished · ${finished.length}`}
        plain
        onPress={() => update($, finishedOpenAtom, (v: boolean) => !v)}
      />
    )

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      // The layout is art.ts's, so the preview draws exactly this.
      const items = desktopPaneItems(W, plan, list, now, { finishedOpen: isOpen, open: openGroups, ...(phase ? { phase } : {}) })
      return (
        <Box flexDirection="column" gap={1}>
          {backButton}
          {items.map((item, i) =>
            item.kind === 'svg' && item.agentId ? (
              <Box key={item.key} flexDirection="column">
                <Svg source={item.svg} alt={item.alt} width={W} height={item.height} />
                <Button
                  key={`view-${item.key}`}
                  label={viewing === item.agentId ? 'Viewing' : 'View'}
                  plain
                  onPress={() => {
                    const run = list.find(r => r.id === item.key)
                    if (run) void viewAgent($, run, viewing)
                  }}
                />
              </Box>
            ) : item.kind === 'svg' ? (
              <Svg key={item.key} source={item.svg} alt={item.alt} width={W} height={item.height} />
            ) : item.kind === 'rule' ? (
              <Text key={`i${i}`} dimColor>
                {'─'.repeat(Math.max(10, Math.floor(W / 8)))}
              </Text>
            ) : item.kind === 'group' ? (
              <Button key={`group-${item.key}`} label={item.label} plain onPress={() => toggleGroup(item.key, item.open)} />
            ) : item.kind === 'finished' ? (
              finishedButton
            ) : item.kind === 'empty' ? (
              <Text key={`i${i}`} dimColor>
                No subagents yet.
              </Text>
            ) : item.kind === 'inline' ? (
              <Text key={`i${i}`}>{item.text}</Text>
            ) : (
              <Text key={`i${i}`} dimColor>
                {item.text}
              </Text>
            ),
          )}
        </Box>
      )
    }

    // Terminal: the same content in text rows.
    // One agent under its task: its name, then its role, model, status, time and cost, then (while it runs) its bar.
    const agentLine = (r: Run) => {
      const color = colorOf(r)
      const progress = progressOf(r)
      const steps = stepsText(r)
      const mark = r.status === 'failed' ? 'red' : r.status === 'done' ? 'green' : color
      const name = [
        <Text key="mark" color={color}>
          {'  ▣ '}
        </Text>,
        <Text key="name" bold>
          {r.label || r.type}
        </Text>,
        ...(viewing === r.agentId && r.agentId
          ? [
              <Text key="viewing" dimColor>
                {'  ◀ viewing'}
              </Text>,
            ]
          : []),
      ]
      return (
        <Box key={r.id} flexDirection="column">
          {r.agentId ? (
            // The name is the agent's button: it puts its transcript in the main view.
            <Button key={`view-${r.id}`} plain onPress={() => void viewAgent($, r, viewing)}>
              {name}
            </Button>
          ) : (
            <Text wrap="truncate-end">{name}</Text>
          )}
          {r.status === 'running' && r.action && (
            <Text wrap="truncate-end">
              {'    '}
              <Text color={ACTION_COLOR}>{r.action}</Text>
            </Text>
          )}
          <Text wrap="truncate-end">
            {'    '}
            <Text color={color}>{runRole(r)}</Text>
            <Text dimColor>{` · ${runModel(r)} · `}</Text>
            <Text color={mark}>{GLYPH[r.status]}</Text>
            <Text dimColor>{` ${fmtTime(elapsed(r, now))}  ≈${fmtCost(r.costUsd)}`}</Text>
            {r.findings && r.status !== 'running' ? <Text color={ROLE_STYLE.review.color}>{`  ${r.findings} findings`}</Text> : ''}
          </Text>
          {r.status === 'running' && (
            <Text wrap="truncate-end">
              {'    '}
              {progress === null ? <Text dimColor>{bar(ctxPercent(r), 14)}</Text> : <Text color={color}>{bar(progress * 100, 14)}</Text>}
              <Text dimColor>
                {' '}
                {steps ? `${steps} · ` : ''}ctx {ctxPercent(r)}% · {fmtTokens(r.contextTokens)}
              </Text>
            </Text>
          )}
        </Box>
      )
    }

    const rule = <Text dimColor>{'─'.repeat(Math.max(10, (e.props.bodyColumns || 40) - 2))}</Text>
    if (plan && phase) {
      const groups = planGroups(plan, list)
      return (
        <Box flexDirection="column">
          {backButton}
          <Box key="head" flexDirection="column">
            <Text bold color={ACCENT} wrap="truncate-end">
              {plan.title}
            </Text>
            <Text dimColor wrap="truncate-end">
              {plan.path}
            </Text>
            <Text wrap="truncate-end">
              <Text color={phase.isFinished ? DONE_COLOR : ACCENT}>{bar(percent, 24)}</Text> <Text bold>{phase.label}</Text>{' '}
              <Text dimColor>{`${percent}%`}</Text>
            </Text>
            <Text dimColor>{`≈${fmtCost(cost)} · ${fmtTokens(tokens)} tokens · ${fmtTime(span)}`}</Text>
          </Box>
          {rule}
          {groups.map(g => {
            const open = isGroupOpen(g, openGroups)
            const chevron = g.runs.length ? (open ? '▾ ' : '▸ ') : '  '
            const markEl =
              g.kind === 'final' ? (
                <Text key="m" color={ROLE_STYLE.final.color}>
                  ◆
                </Text>
              ) : g.kind === 'other' ? (
                <Text key="m" color={colorOf(g.runs[0] ?? ({ role: 'other', type: 'Explore' } as Run))}>
                  ◇
                </Text>
              ) : g.state === 'done' ? (
                <Text key="m" color="green">
                  {GLYPH.done}
                </Text>
              ) : g.state === 'current' ? (
                <Text key="m" color={ROLE_STYLE.implement.color}>
                  {GLYPH.running}
                </Text>
              ) : (
                <Text key="m" color={ACCENT}>
                  {GLYPH.waiting}
                </Text>
              )
            const name =
              g.kind === 'task' && g.state === 'waiting' && g.n !== null ? (
                <Text key="n">
                  <Text color={ACCENT}>{`${g.n}.`}</Text> {g.name.slice(String(g.n).length + 2)}
                </Text>
              ) : (
                <Text key="n" bold={g.state === 'current'}>
                  {g.name}
                </Text>
              )
            const line = [
              <Text key="c" dimColor>
                {chevron}
              </Text>,
              markEl,
              <Text key="s"> </Text>,
              name,
              ...(g.runs.length
                ? [
                    <Text key="k" dimColor>
                      {`  ${groupCount(g)}`}
                    </Text>,
                  ]
                : []),
            ]
            return (
              <Box key={g.key} flexDirection="column">
                {g.kind === 'other' && rule}
                {g.runs.length ? (
                  <Button key={`group-${g.key}`} plain onPress={() => toggleGroup(g.key, open)}>
                    {line}
                  </Button>
                ) : (
                  <Text wrap="truncate-end">{line}</Text>
                )}
                {open && g.runs.map(agentLine)}
                {open && inlineTask && g.n === inlineTask.n && (
                  <Text wrap="truncate-end">
                    <Text color={ROLE_STYLE.implement.color}>{'  ▣ '}</Text>
                    <Text bold>{`Main session · Task ${inlineTask.n}`}</Text>
                    <Text dimColor>{' · working inline'}</Text>
                  </Text>
                )}
              </Box>
            )
          })}
        </Box>
      )
    }

    // No list: how many agents and how far along, the ones at work, then the finished ones folded away.
    const noList = noListPhase(list)
    const noListPercent = noList.total ? Math.round((noList.done / noList.total) * 100) : 0
    return (
      <Box flexDirection="column">
        {backButton}
        {list.length === 0 ? (
          <Text dimColor>No subagents yet.</Text>
        ) : (
          <Box key="head" flexDirection="column">
            <Text bold color={ACCENT} wrap="truncate-end">
              {noListHeading(list)}
            </Text>
            <Text wrap="truncate-end">
              <Text color={noList.isFinished ? DONE_COLOR : ACCENT}>{bar(noListPercent, 24)}</Text> <Text bold>{noList.label}</Text>{' '}
              <Text dimColor>{`${noListPercent}%`}</Text>
            </Text>
            <Text dimColor>{`≈${fmtCost(cost)} · ${fmtTokens(tokens)} tokens · ${fmtTime(span)}`}</Text>
          </Box>
        )}
        {list.length > 0 && rule}
        {running.length > 0 && <Text dimColor>{`Working · ${running.length}`}</Text>}
        {running.map(agentLine)}
        {finished.length > 0 && rule}
        {finished.length > 0 && finishedButton}
        {isOpen &&
          finished.map(r => (
            <Text key={r.id} wrap="truncate-end">
              {'  '}
              <Text color={r.status === 'failed' ? 'red' : 'green'}>{finishedLine(r, now).slice(0, 1)}</Text>
              <Text dimColor>{finishedLine(r, now).slice(1)}</Text>
            </Text>
          ))}
      </Box>
    )
  })

  // The row above the prompt: total progress, model, branch, context, cache.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const main: Main = await read($, mainAtom)
    if (e.props.hasSurvey || main.rowHidden) return next(e)
    // Read so the countdown redraws each second.
    await read($, cacheLeftAtom)
    // Other mods' bands are drawn beneath this row; Claude Code's own placeholder is never nested.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const plan = await shownPlan($)
    const list: Run[] = await read($, runsAtom)
    const now = await $.clock.now()
    const progress = rowProgress(plan, list, main.planDoneAt)
    const cache = cacheView(main, now)
    // The frame and its padding take four columns.
    const tier = rowTier((e.props.bodyColumns || 120) - 4)
    const warn = cache.level === 'alert' ? ALERT_COLOR : cache.level === 'warn' ? WARN_COLOR : null
    const phase = plan && progress.kind === 'plan' ? planPhase(plan, list) : null
    const percent = phase ? Math.round((phase.isFinished ? 1 : phase.total ? phase.done / phase.total : 0) * 100) : 0
    const planColor = phase?.isFinished ? DONE_COLOR : ACCENT
    const working = progress.kind === 'none' ? 0 : progress.working
    // Agents without a plan: finished out of all of them.
    const agentsPercent = progress.kind === 'agents' && progress.working + progress.done > 0 ? Math.round((progress.done / (progress.working + progress.done)) * 100) : 0
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const icon = 22
    // About 8 CSS px per column on the desktop; the bar takes about a third of the row.
    const barWidth = Math.max(180, Math.min(420, Math.round((e.props.bodyColumns || 120) * 8 * 0.35)))

    const progressPiece =
      progress.kind === 'agents' ? (
        <Box key="progress" flexDirection="row" columnGap={1} flexShrink={1}>
          <Text wrap="truncate-end" color={ACCENT}>●</Text>
          <Text bold wrap="truncate-end">
            {tier < 3 ? `${progress.working} working · ${progress.done} done` : `${progress.working} working`}
          </Text>
          {tier < 3 && <Text wrap="truncate-end" color={ACCENT}>{bar(agentsPercent, 16)}</Text>}
          {tier < 3 && <Text wrap="truncate-end" dimColor>{`${agentsPercent}%`}</Text>}
        </Box>
      ) : plan && phase ? (
        <Box key="progress" flexDirection="row" columnGap={1} flexShrink={1} alignItems="center">
          {Svg && tier < 3 ? (
            <Svg source={planBarSvg(plan.title, phase, working, barWidth)} alt={`${plan.title}: ${phase.label}`} width={barWidth} height={BAR_HEIGHT} />
          ) : (
            <Box flexDirection="row" columnGap={1}>
              <Text wrap="truncate-end" color={planColor}>●</Text>
              <Text wrap="truncate-end" bold>{shorten(plan.title, tier === 0 ? 28 : 18)}</Text>
              {tier < 3 && <Text wrap="truncate-end" color={planColor}>{bar(percent, 16)}</Text>}
              <Text wrap="truncate-end" bold>{phase.label}</Text>
              <Text wrap="truncate-end" dimColor>{`${percent}%`}</Text>
            </Box>
          )}
          {tier === 0 && working > 0 && <Text wrap="truncate-end" dimColor>{`· ${working} working`}</Text>}
        </Box>
      ) : null

    return (
      <Box flexDirection="column">
        <Box
          key="crew-row"
          flexDirection="row"
          alignItems="center"
          flexWrap="nowrap"
          overflow="hidden"
          paddingX={1}
          columnGap={2}
          // Always framed: white at rest, amber or red as the cache runs out.
          borderStyle="round"
          borderColor={warn ?? 'white'}
        >
          {progressPiece}
          <Box flexGrow={1} flexShrink={1} />
          {main.model && (
            <Text key="model" bold wrap="truncate-end">
              {main.effort ? `${modelName(main.model)} · ${main.effort}` : modelName(main.model)}
            </Text>
          )}
          {tier === 0 && main.branch && (
            <Box key="branch" flexDirection="row" columnGap={1} flexShrink={0} alignItems="center">
              {Svg ? <Svg source={branchIconSvg()} alt="branch" width={icon} height={icon} /> : <Text wrap="truncate-end" dimColor>⎇</Text>}
              <Text wrap="truncate-end">{main.branch}</Text>
            </Box>
          )}
          {main.context !== null && (
            <Box key="context" flexDirection="row" columnGap={1} flexShrink={0} alignItems="center">
              {Svg ? <Svg source={contextRingSvg(main.context)} alt="context" width={icon} height={icon} /> : <Text wrap="truncate-end" dimColor>ctx</Text>}
              {tier < 2 &&
                (Svg ? (
                  <Svg source={contextBarSvg(main.context)} alt={`context ${main.context}%`} width={80} height={6} />
                ) : (
                  <Text wrap="truncate-end" color={levelColor(contextLevel(main.context))}>{bar(main.context, 8)}</Text>
                ))}
              <Text wrap="truncate-end" bold>{`${main.context}%`}</Text>
            </Box>
          )}
          <Box key="cache" flexDirection="row" columnGap={1} flexShrink={0} alignItems="center">
            {Svg ? <Svg source={hourglassSvg(warn ?? CACHE_COLOR)} alt="cache" width={icon} height={icon} /> : <Text wrap="truncate-end" color={warn ?? CACHE_COLOR}>⧗</Text>}
            <Text wrap="truncate-end" bold {...(warn ? { color: warn } : {})}>
              {cache.text}
            </Text>
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
