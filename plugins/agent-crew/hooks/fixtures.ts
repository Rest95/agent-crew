// The fake engine the tests drive the mod through: files, the Bash tool, agents and the pane.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Checklist, Main, Plan, Run } from '../types'

export const PLAN_PATH = 'docs/plans/payments.md'
export const WS = '/repo/.superpowers/sdd/payments'
export const LEDGER = `${WS}/progress.md`
export const PLAN_TEXT = '# Payments Implementation Plan\n\n### Task 1: API client\n### Task 2: Background jobs\n### Task 3: Queue screen\n'
export const STEP_TAIL =
  '\n\nProgress reporting: before any other work, call `mcp__agent-crew__step` with `total` (your plan in 3-8 steps) and `done: 0`; call it again with `done` and a few-word `note` as each step finishes. It only draws a progress bar.'
export const FINDINGS = '### Issues\n#### Critical (Must Fix)\n- a.ts:3 wrong\n#### Important (Should Fix)\n1. b.ts:9 missing test\n2. c.ts:1 leak\n'

// The engine hands the file system absolute paths, resolved against the working directory.
export const find = (keys: Iterable<string>, path: string): string | undefined => [...keys].find(k => path === k || path.endsWith('/' + k))

export type World = {
  /** Task ids handed out by the TaskCreate stand-in. */
  taskIds: number
  /** The TaskCreate stand-in answers `{ result: null }`. */
  taskCreateNull: boolean
  files: Map<string, string>
  dirs: Set<string>
  opened: string[]
  /** Each pane open as the mod asked for it. */
  openArgs: { id: string; title?: string; backgroundColor?: string }[]
  prompts: string[]
  stored: Map<string, unknown>
  stdout: string | null
  // The main session, as the row reads it.
  context: number
  branch: string | null
  pushes: boolean
  notified: string[]
  toasts: string[]
  sessionModel: string
  gitHangs: boolean
  /** How many times git was run. */
  gitRuns: number
  /** When set, the next git run waits for the test to answer it. */
  gitHold: ((answer: string | null) => void) | null
  holdNextGit: boolean
  /** What the engine's agent list says about each agent. */
  agentStatus: Map<string, string>
  commands: { name: string; description: string; argumentHint?: string }[]
  /** Plan files whose read never answers. */
  slowFiles: Set<string>
  /** Modification times of fake files, for picking the latest plan. */
  mtimes: Map<string, number>
  usageHangs: boolean
  /** Each view the mod asked for, and whether the engine refuses it. */
  views: { agentId?: string }[]
  viewDenied: boolean
  clock: ReturnType<typeof mock.clock>
}

export const START = Date.parse('2026-10-29T12:00:00Z')

// The world the helpers below settle: work the mod queued beside an event lands before a test reads.
let current: World | null = null
const settle = async () => {
  await current?.clock.settle()
}

// The engine beneath the mod: files, the Bash tool, agents and the pane, all faked.
export function world(on: On, files: Record<string, string> = { [PLAN_PATH]: PLAN_TEXT }): World {
  const clock = mock.clock(on, { now: START })
  const w: World = { taskIds: 0, taskCreateNull: false, files: new Map(Object.entries(files)), dirs: new Set([WS]), opened: [], openArgs: [], prompts: [], stored: new Map(), stdout: null, context: 34, branch: 'feat/payments', pushes: true, notified: [], toasts: [], sessionModel: 'claude-opus-5-5', gitHangs: false, gitRuns: 0, gitHold: null, holdNextGit: false, agentStatus: new Map(), commands: [], slowFiles: new Set(), mtimes: new Map(), usageHangs: false, views: [], viewDenied: false, clock }
  current = w
  // What the mod writes to $.state, watched on its way to the kit's own store.
  on('state.set', (_$, e, next) => {
    const write = e as { plugin: string; key: string; value: unknown }
    if (write.plugin === 'agent-crew') w.stored.set(write.key, write.value)
    return next(e)
  })
  on('ui.open', (_$, e) => {
    w.opened.push(e.id)
    w.openArgs.push({ ...(e as { id: string; title?: string; backgroundColor?: string }) })
    return { value: { isPlaced: true } }
  })
  on('fs.read', (_$, e) => {
    if ([...w.slowFiles].some(k => e.path.endsWith(k))) return new Promise(() => undefined) as never
    const text = w.files.get(find(w.files.keys(), e.path) ?? '')
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text } as never
  })
  on('fs.exists', (_$, e) => ({ value: find([...w.files.keys(), ...w.dirs], e.path) !== undefined }) as never)
  // A directory's entries, from the fake files and folders beneath it.
  on('fs.list', (_$, e) => {
    const dir = String((e as { path?: string }).path ?? '').replace(/\/$/, '')
    const names = new Set<string>()
    for (const p of [...w.files.keys(), ...w.dirs]) if (p.startsWith(dir + '/')) names.add(p.slice(dir.length + 1).split('/')[0] ?? '')
    return { value: [...names].filter(Boolean).map(name => ({ name, kind: w.dirs.has(`${dir}/${name}`) ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false })) } as never
  })
  on('fs.stat', (_$, e) => {
    const path = String((e as { path?: string }).path ?? '')
    if (find([...w.files.keys(), ...w.dirs], path) === undefined) throw new Error(`ENOENT: ${path}`)
    return { value: { kind: w.dirs.has(path) ? 'dir' : 'file', size: 0, mtimeMs: w.mtimes.get(path) ?? 1, isLink: false } } as never
  })
  on('ui.panes', () => ({ value: [] }) as never)
  // The task-list tools and a few working tools, as Claude Code answers them.
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => {
    if (w.taskCreateNull) return { result: null } as never
    const subject = String((e as { subject?: unknown }).subject ?? '')
    return { result: { task: { id: String(++w.taskIds), subject } } } as never
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: String((e as { taskId?: unknown }).taskId), updatedFields: [] } }) as never)
  on('tool.call', { tool: /^(TodoWrite|Read|Edit|Grep)$/ }, () => ({ result: {} }) as never)
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command)
    const stdout = w.stdout ?? (command.includes('sdd-workspace') ? `${WS}\n` : command.includes('task-start') ? `brief: ${WS}/task-2-brief.md\nbase: abc123\n` : '')
    return { result: { stdout, stderr: '' } } as never
  })
  on('agent.spawn', (_$, e) => {
    w.prompts.push(e.prompt)
    return { model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` } as never
  })
  on('turn.step', async function* (_$, e) {
    // The main session's requests are served and counted; subagents' carry no usage here.
    const usage = (e as { agentId?: string }).agentId ? null : { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    const step = e as { turnId: string; index: number }
    return { turnId: step.turnId, index: step.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('session.start', () => ({ cwd: '/repo/payments' }) as never)
  on('session.cwd', () => ({ value: '/repo/payments' }) as never)
  on('command.register', (_$, e) => {
    w.commands.push(e as never)
    return { value: {} } as never
  })
  on('agent.list', () => ({ value: [...w.agentStatus].map(([id, status]) => ({ id, description: '', type: 'general-purpose', status })) }) as never)
  on('tool.register', () => ({ value: {} }) as never)
  on('settings.read', () => ({ value: { model: 'opus[1m]', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } } }) as never)
  on('session.model', () => ({ value: w.sessionModel }) as never)
  on('session.measure', (_$, e) => ({ changed: (e as { changed: string[] }).changed }) as never)
  on('session.end', (_$, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
  on('session.usage', () => (w.usageHangs ? new Promise(() => undefined) : { value: { context: { window: 1e6, percent: w.context } } }) as never)
  on('process.run', (_$, e) => {
    // The repository root, for finding a plan's workspace by its marker.
    if ((e as { argv?: string[] }).argv?.includes('--show-toplevel')) return { value: { exitCode: 0, stdout: '/repo\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    w.gitRuns++
    const answer = (branch: string | null) => ({ value: { exitCode: branch ? 0 : 128, stdout: branch ? `${branch}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
    if (w.gitHangs) return new Promise(() => undefined) as never
    if (w.holdNextGit) {
      w.holdNextGit = false
      return new Promise(resolve => {
        w.gitHold = branch => resolve(answer(branch))
      }) as never
    }
    return ({ value: { exitCode: w.branch ? 0 : 128, stdout: w.branch ? `${w.branch}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never)
  })
  on('tool.call', { tool: 'PushNotification' }, (_$, e) => {
    w.notified.push(String((e as { message?: unknown }).message))
    return { result: { pushSent: w.pushes, localSent: false } } as never
  })
  on('ui.view', (_$, e) => {
    w.views.push({ ...(e as { agentId?: string }) })
    return { value: w.viewDenied ? { deny: 'no row in the tasks list' } : {} } as never
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(String((e as { text?: unknown }).text))
    return { value: undefined } as never
  })
  return w
}

export const bash = async ($: Engine, command: string) => {
  const done = await $.tool.call({ tool: 'Bash', command } as never)
  await settle()
  return done
}
export const spawn = async ($: Engine, id: string, description: string, subagentType = 'general-purpose') => {
  const started = await $.agent.spawn({ tool_use_id: id, prompt: 'p', description, subagentType, provider: 'engine', parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
  await settle()
  return started
}
export const request = async ($: Engine, agentId: string) => {
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'turn', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId })
  for await (const _ of stream) void _
  await settle()
}
export const finish = async ($: Engine, agentId: string, reason = 'answer', answer = 'ok') => {
  const done = await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId, reason, answer, usage: null })
  await settle()
  return done
}
export const plan = (w: World) => (w.stored.get('plan') ?? null) as Plan | null
export const runs = (w: World) => (w.stored.get('runs') ?? []) as Run[]


export const main = (w: World) => w.stored.get('main') as Main | undefined
export const start = ($: Engine) => $.session.start({ source: 'startup', cwd: '/repo/payments', surface: 'terminal', isInteractive: true } as never)
/** A turn of the main session (no agent id); `complete` is one served request, then the answer. */
export const mainTurn = async ($: Engine, kind: 'start' | 'complete', effort?: string) => {
  if (kind === 'start') return ($.turn.start as (e: unknown) => Promise<unknown>)({ text: 'go', turnId: 'm1' })
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'm1', index: 0, model: 'claude-opus-5-5', messageCount: 1, effort: effort ?? 'high' })
  for await (const _ of stream) void _
  const done = await ($.turn.complete as (e: unknown) => Promise<unknown>)({ reason: 'answer', answer: 'ok', usage: null })
  await settle()
  return done
}
/** A main turn that ends without an answer and without a new request served. */
export const mainEnd = async ($: Engine, reason: string) => {
  const done = await ($.turn.complete as (e: unknown) => Promise<unknown>)({ reason, answer: '', usage: null })
  await settle()
  return done
}

/** A tool call from the main conversation, or from the agent `agentId`. */
export const call = async ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) => {
  const done = await $.tool.call({ tool, ...input, ...(agentId ? { agentId } : {}) } as never)
  await settle()
  return done
}
/** The person submits a prompt. */
export const submit = async ($: Engine, text: string) => {
  await ($.prompt.submit as (e: unknown) => Promise<unknown>)({ text, wait: false, origin: {} })
  await settle()
}
export const checklist = (w: World) => (w.stored.get('checklist') ?? null) as Checklist | null
