// Parsing superpowers plans, ledgers and script calls; classifying agents. No engine calls.
import type { Checklist, ChecklistItem, Main, Plan, PlanTask, Role, Run, TaskCall } from '../types'

const TASK_HEADING = /^#{1,6}[ \t]+Task[ \t]+(\d+)[ \t]*:[ \t]*(.+?)[ \t]*$/i

const baseName = (path: string): string => path.split('/').pop() ?? path

/** A plan's title and tasks, read the way superpowers' task-brief finds them. */
export function parsePlan(path: string, text: string): { title: string; tasks: PlanTask[] } {
  let title = ''
  const tasks: PlanTask[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence
    if (inFence) continue
    if (!title && /^#[ \t]+/.test(line)) title = line.replace(/^#[ \t]+/, '').replace(/[ \t]*Implementation Plan[ \t]*$/i, '').trim()
    const task = TASK_HEADING.exec(line)
    // A repeated task number keeps its first heading, as task-brief's first match does.
    if (task && !tasks.some(t => t.n === Number(task[1]))) tasks.push({ n: Number(task[1]), title: task[2] ?? '' })
  }
  return { title: title || baseName(path).replace(/\.md$/i, ''), tasks }
}

const normPath = (path: string): string => path.trim().replace(/^\.\//, '')

/** True when two spellings of a plan path name the same file: one ends with the other. */
export const samePlan = (a: string, b: string): boolean => {
  const x = normPath(a)
  const y = normPath(b)
  return x === y || x.endsWith('/' + y) || y.endsWith('/' + x)
}

/** The task numbers the ledger marks complete; none when it belongs to another plan. */
export function parseLedger(text: string, planPath: string): number[] {
  const lines = text.split('\n')
  const owner = /^# SDD ledger — plan: (.+)$/.exec(lines[0] ?? '')
  // The controller writes the header by hand: the path may come in backticks or quotes.
  if (owner && !samePlan((owner[1] ?? '').replace(/^[`'"]+|[`'"]+$/g, ''), planPath)) return []
  const done = new Set<number>()
  for (const line of lines) {
    const m = /^Task (\d+): complete\b/.exec(line)
    if (m) done.add(Number(m[1]))
  }
  return [...done].sort((a, b) => a - b)
}

export type ScriptName = 'sdd-workspace' | 'task-brief' | 'task-start' | 'task-done' | 'review-package'

export type ScriptCall = { script: ScriptName; plan: string; task: number | null }

const SCRIPTS: readonly ScriptName[] = ['sdd-workspace', 'task-brief', 'task-start', 'task-done', 'review-package']

// Shell words with single and double quotes. Operators stay glued to a word when written without
// spaces (`x.md);`), so parseScriptCall cleans and checks the words it takes.
function shellWords(command: string): string[] {
  const words: string[] = []
  let word = ''
  let quote: string | null = null
  let has = false
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (/\s/.test(ch)) {
      if (has || word) words.push(word)
      word = ''
      has = false
    } else {
      word += ch
    }
  }
  if (has || word) words.push(word)
  return words
}

// By its name, however its folder is spelled: `…/scripts/task-brief`, `$S/task-brief`, `"${SKILL}/task-start"`.
const scriptOf = (word: string): ScriptName | null => SCRIPTS.find(s => word === s || word.endsWith('/' + s)) ?? null

/** True for the labels superpowers gives a plan's agents. */
export const isPlanLabel = (label: string): boolean => /\btask \d+\b|^review code changes\b/i.test(label.trim())

const trimOperators = (word: string): string => word.replace(/[);|&]+$/, '')

// A plan word the mod can trust: a markdown path with nothing the shell would still expand or split.
const isPlanPath = (word: string): boolean => /\.md$/i.test(word) && !/[$`()|;&]/.test(word)

/** The superpowers plan script a Bash command runs, with its plan and task number; null when unsure. */
export function parseScriptCall(command: string): ScriptCall | null {
  const words = shellWords(command)
  for (let i = 0; i < words.length; i++) {
    const script = scriptOf(trimOperators(words[i] ?? ''))
    if (!script) continue
    const plan = trimOperators(words[i + 1] ?? '')
    if (!isPlanPath(plan)) return null
    const n = Number(trimOperators(words[i + 2] ?? ''))
    return { script, plan, task: Number.isInteger(n) && n > 0 ? n : null }
  }
  return null
}

const dirName = (path: string): string => path.replace(/\/[^/]*$/, '')

// superpowers keeps every plan's files in <repo-root>/.superpowers/sdd/<plan>/.
const WORKSPACE = /^\/.+\/\.superpowers\/sdd\/[^/]+$/
const asWorkspace = (dir: string | undefined): string | null => (dir && WORKSPACE.test(dir) ? dir : null)

/** The plan's workspace directory, as the script's output reveals it; null when nothing looks like one. */
export function workspaceFrom(call: ScriptCall, stdout: string): string | null {
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
  if (call.script === 'sdd-workspace') return lines.find(l => WORKSPACE.test(l)) ?? null
  if (call.script === 'task-brief' || call.script === 'review-package') {
    const m = lines.map(l => /^wrote (.+?): \d+/.exec(l)).find(Boolean)
    return asWorkspace(m?.[1] ? dirName(m[1]) : undefined)
  }
  if (call.script === 'task-start') {
    const m = lines.map(l => /^brief: (.+)$/.exec(l)).find(Boolean)
    return asWorkspace(m?.[1] ? dirName(m[1]) : undefined)
  }
  return null
}

/** The repository a workspace belongs to: a worktree's own root when superpowers runs in one. */
export const rootOf = (workspace: string): string => workspace.replace(/\/\.superpowers\/sdd\/[^/]+$/, '')

// ---------------------------------------------------------------------------
// Agents: what superpowers (7.0.0) labels each one with.

const IMPLEMENT = /^implement task (\d+)\b/i
const REVIEW = /^review task (\d+)\b/i
const REREVIEW = /^re-review task (\d+) fix round (\d+)\b/i
const FINAL = /^review code changes\b/i
// Any other label naming a plan task (`Finish Task 2: …`, `Continue task 3`) is that task's implementer.
const ANY_TASK = /\btask (\d+)\b/i

/** A task's fix round: one per review that came back with findings, and never before the round after the latest re-review that did. */
export const fixRound = (task: number, runs: readonly Run[]): number => {
  const found = runs.filter(r => r.task === task && (r.role === 'review' || r.role === 'rereview') && r.status !== 'running' && (r.findings ?? 0) > 0)
  const afterRereview = Math.max(0, ...found.filter(r => r.role === 'rereview').map(r => r.round + 1))
  return Math.max(1, found.length, afterRereview)
}

const OTHER = { role: 'other' as Role, task: null, round: 0 }

/** The role and task an agent works on, from its label; `other` whenever it is not sure. */
export function classify(label: string, plan: Plan | null, runs: readonly Run[]): { role: Role; task: number | null; round: number } {
  if (!plan) return OTHER
  const text = label.trim()
  const known = (n: number) => plan.tasks.some(t => t.n === n)
  if (FINAL.test(text)) {
    const allDone = plan.tasks.length > 0 && plan.tasks.every(t => plan.complete.includes(t.n))
    return allDone ? { role: 'final', task: null, round: 0 } : OTHER
  }
  const rereview = REREVIEW.exec(text)
  if (rereview) {
    const n = Number(rereview[1])
    return known(n) ? { role: 'rereview', task: n, round: Number(rereview[2]) } : OTHER
  }
  const review = REVIEW.exec(text)
  if (review) {
    const n = Number(review[1])
    return known(n) ? { role: 'review', task: n, round: 0 } : OTHER
  }
  const implement = IMPLEMENT.exec(text) ?? ANY_TASK.exec(text)
  if (implement) {
    const n = Number(implement[1])
    if (!known(n)) return OTHER
    // A fix round only once a review of the task has found something; a restarted implementer is still implementing.
    const before = runs.some(r => r.task === n && (r.role === 'implement' || r.role === 'fix'))
    const found = runs.some(r => r.task === n && (r.role === 'review' || r.role === 'rereview') && r.status !== 'running' && (r.findings ?? 0) > 0)
    return before && found ? { role: 'fix', task: n, round: fixRound(n, runs) } : { role: 'implement', task: n, round: 0 }
  }
  return OTHER
}

const LIST_ITEM = /^\s{0,3}(?:[-*]|\d+[.)])\s+(.*\S)/
const NOTHING = /^(?:\*\*)?(none|n\/a)\.?(?:\*\*)?$/i

/**
 * What a reviewer's answer says still needs fixing: a task review's Critical and Important items
 * (Minor does not block a task); a re-review's NOT ADDRESSED verdicts plus Critical or Important new breakage.
 */
export function countFindings(answer: string): number {
  let section: 'blocking' | 'verdicts' | 'breakage' | null = null
  let count = 0
  // A section's findings are its top-level items; the bullets under one are its details.
  let top: number | null = null
  for (const line of answer.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      section = /^#{1,6}\s+(critical|important)\b/i.test(line) ? 'blocking' : /finding verdicts/i.test(line) ? 'verdicts' : /new breakage/i.test(line) ? 'breakage' : null
      top = null
      continue
    }
    const item = LIST_ITEM.exec(line)?.[1]
    if (!item) continue
    const indent = line.length - line.trimStart().length
    top ??= indent
    if (indent > top || NOTHING.test(item)) continue
    if (section === 'blocking') count++
    else if (section === 'verdicts' && /\bNOT ADDRESSED\b/.test(item)) count++
    else if (section === 'breakage' && /\b(critical|important)\b/i.test(item)) count++
  }
  return count
}

/** The task being worked on: the highest-numbered one with activity (an agent, a task-brief or task-start) that is not complete. */
export function currentTask(plan: Plan, runs: readonly Run[]): number | null {
  const active = plan.tasks
    .map(t => t.n)
    .filter(n => !plan.complete.includes(n) && (plan.current === n || runs.some(r => r.task === n)))
  return active.length ? Math.max(...active) : null
}

/** The plan's progress as the bar shows it. */
export function planPhase(plan: Plan, runs: readonly Run[]): { done: number; total: number; label: string; isFinished: boolean } {
  const total = plan.tasks.length
  const done = plan.tasks.filter(t => plan.complete.includes(t.n)).length
  const reviewing = runs.some(r => r.role === 'final' && r.status === 'running')
  if (total > 0 && done === total && !reviewing) return { done, total, label: 'Done', isFinished: true }
  return { done, total, label: `${reviewing ? 'Review' : 'Tasks'} ${done}/${total}`, isFinished: false }
}

// ---------------------------------------------------------------------------
// Prices: USD per million tokens (input, output, cache read, cache write), list
// prices as savvy-progress keeps them; the first row matching a model id wins.

type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]

// Haiku 5.5 is priced by prompt length: a request over 100K prompt tokens pays these.
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const priceOf = (model: string, prompt: number): Price => {
  const id = model.toLowerCase()
  if (prompt > HAIKU_LONG_PROMPT && /haiku-5-5/.test(id)) return HAIKU_LONG
  return PRICES.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8]
}

/** Estimated cost; `isRequest` says the usage is one model request, which a prompt-length price is set by. */
export function costOf(model: string, u: Usage, isRequest: boolean): number {
  const prompt = isRequest ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0
  const [i, o, r, w] = priceOf(model, prompt)
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6
}

/** Haiku 4.5 and the Claude 3 models have a 200K window; the rest 1M. */
export const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

// ---------------------------------------------------------------------------
// The row above the prompt.

export type RowProgress = { kind: 'plan'; working: number } | { kind: 'agents'; working: number; done: number } | { kind: 'none' }

const agentsOf = (list: readonly Run[]): RowProgress => {
  const working = list.filter(r => r.status === 'running').length
  return working ? { kind: 'agents', working, done: list.length - working } : { kind: 'none' }
}

/** What the row's progress shows: the plan while it runs (and Done until something else runs), else running agents, else nothing. */
export function rowProgress(plan: Plan | null, runs: readonly Run[], planDoneAt: number | null): RowProgress {
  const working = runs.filter(r => r.status === 'running')
  if (!plan) return agentsOf(runs)
  const isPlanWorking = working.some(r => r.role !== 'other')
  if (!planPhase(plan, runs).isFinished || isPlanWorking) return { kind: 'plan', working: working.length }
  const later = planDoneAt === null ? [] : runs.filter(r => r.startedAt > planDoneAt)
  return later.length === 0 ? { kind: 'plan', working: 0 } : agentsOf(later)
}

const CACHE_WARN_S = 20 * 60
const CACHE_ALERT_S = 10 * 60
const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The cache countdown: `—` before the first answer, `…` while a turn runs, then mm:ss with its warning level. */
export function cacheView(main: Main, now: number): { text: string; level: 'warn' | 'alert' | null; secondsLeft: number | null } {
  if (main.expiresAt === null) return { text: '—', level: null, secondsLeft: null }
  if (main.busy) return { text: '…', level: null, secondsLeft: null }
  const left = Math.max(0, Math.floor((main.expiresAt - now) / 1000))
  const level = left <= CACHE_ALERT_S ? 'alert' : left <= CACHE_WARN_S ? 'warn' : null
  return { text: left === 0 ? 'expired' : `${pad2(Math.floor(left / 60))}:${pad2(left % 60)}`, level, secondsLeft: left }
}

/** The cache warning due now, once per threshold per answer; never while a turn runs. */
export function dueWarning(main: Main, now: number): 10 | 5 | null {
  const { secondsLeft } = cacheView(main, now)
  if (secondsLeft === null || secondsLeft <= 0) return null
  if (secondsLeft <= 300 && main.warned !== 5) return 5
  if (secondsLeft <= 600 && (main.warned === 0 || main.warned > 10)) return 10
  return null
}

export const contextLevel = (percent: number): 'ok' | 'warn' | 'alert' => (percent >= 85 ? 'alert' : percent >= 65 ? 'warn' : 'ok')

/** How much of the row fits: 0 all; 1 no branch; 2 also no context bar; 3 also no progress bar or working count. */
export const rowTier = (columns: number): 0 | 1 | 2 | 3 => (columns >= 110 ? 0 : columns >= 90 ? 1 : columns >= 70 ? 2 : 3)

/** The branch `git branch --show-current` printed; null on an error or a detached HEAD. */
export const parseBranch = (exitCode: number, stdout: string): string | null => (exitCode === 0 && stdout.trim() ? stdout.trim() : null)

// ---------------------------------------------------------------------------
// Everyday mode: what an agent is doing, and task lists (Claude's and each agent's own).

const ACTION_MAX = 60
const LIST_FALLBACK = "Claude's task list"
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite', 'TaskList', 'TaskGet'])
const STATUSES: readonly ChecklistItem['status'][] = ['pending', 'in_progress', 'completed']

const objectOf = (x: unknown): Record<string, unknown> | null => (x !== null && typeof x === 'object' ? (x as Record<string, unknown>) : null)
const textOf = (x: unknown): string => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '')
const firstLine = (s: string): string => s.split('\n').map(l => l.trim()).find(Boolean) ?? ''
const cut = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)

/** True for the task-list tools: bookkeeping, not work. */
export const isTaskTool = (tool: string): boolean => TASK_TOOLS.has(tool)

/** A path as the person reads it: inside the session's folder relative to it, cut from the left to fit. */
function pathIn(path: string, cwd: string | null, room: number): string {
  const rel = cwd && path.startsWith(cwd.replace(/\/$/, '') + '/') ? path.slice(cwd.replace(/\/$/, '').length + 1) : path
  return rel.length > room ? '…' + rel.slice(rel.length - (room - 1)) : rel
}

/** What a tool call is doing, in a few words; null for bookkeeping (task lists, the step tool). */
export function describeAction(tool: string, input: unknown, cwd: string | null): string | null {
  if (isTaskTool(tool) || tool === 'mcp__agent-crew__step') return null
  const i = objectOf(input) ?? {}
  const withPath = (verb: string) => `${verb} ${pathIn(textOf(i.file_path ?? i.notebook_path ?? i.path), cwd, ACTION_MAX - verb.length - 1)}`
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return withPath('✎ Editing')
    case 'Read':
      return withPath('⌕ Reading')
    case 'Grep':
      return cut(`⌕ Searching "${firstLine(textOf(i.pattern))}"`, ACTION_MAX)
    case 'Glob':
      return cut(`⌕ Finding ${firstLine(textOf(i.pattern))}`, ACTION_MAX)
    case 'Bash':
      return cut(`▶ Running ${firstLine(textOf(i.description)) || firstLine(textOf(i.command))}`, ACTION_MAX)
    case 'WebFetch': {
      const url = textOf(i.url)
      let host = url
      try {
        host = new URL(url).host || url
      } catch {
        // Not a URL: show it as given.
      }
      return cut(`⇣ Fetching ${host}`, ACTION_MAX)
    }
    case 'WebSearch':
      return '⇣ Searching the web'
    case 'Agent':
      return cut(`↳ Starting ${firstLine(textOf(i.description))}`, ACTION_MAX)
    default:
      return cut(`· ${tool.startsWith('mcp__') ? tool.slice(tool.lastIndexOf('__') + 2) : tool}`, ACTION_MAX)
  }
}

const statusOf = (x: unknown): ChecklistItem['status'] | null => (STATUSES.includes(x as ChecklistItem['status']) ? (x as ChecklistItem['status']) : null)
const nextNumber = (items: readonly ChecklistItem[]): number => items.reduce((n, i) => Math.max(n, i.n), 0) + 1

/** A task list after one task-list call; a call it cannot read returns the same array. */
export function applyTaskCall(items: readonly ChecklistItem[], call: TaskCall): ChecklistItem[] {
  const same = items as ChecklistItem[]
  const input = objectOf(call.input)
  if (!input) return same
  if (call.tool === 'TaskCreate') {
    const task = objectOf(objectOf(call.result)?.task)
    const key = textOf(task?.id)
    const text = firstLine(textOf(input.subject) || textOf(task?.subject))
    if (!key || !text) return same
    // A numeric id is its number, so a deleted task's number is never handed out again.
    const n = Math.max(nextNumber(items), /^\d+$/.test(key) ? Number(key) : 0)
    const active = textOf(input.activeForm)
    return [...items, { key, n, text, ...(active ? { active } : {}), status: 'pending' }]
  }
  if (call.tool === 'TaskUpdate') {
    const key = textOf(input.taskId)
    const found = items.find(i => i.key === key)
    if (!found) return same
    if (input.status === 'deleted') return items.filter(i => i !== found)
    const text = firstLine(textOf(input.subject)) || found.text
    const active = textOf(input.activeForm) || found.active
    const status = statusOf(input.status) ?? found.status
    return items.map(i => (i === found ? { ...found, text, ...(active ? { active } : {}), status } : i))
  }
  if (call.tool === 'TodoWrite') {
    if (!Array.isArray(input.todos)) return same
    let n = nextNumber(items)
    const out: ChecklistItem[] = []
    for (const raw of input.todos) {
      const todo = objectOf(raw)
      const text = firstLine(textOf(todo?.content))
      if (!todo || !text || out.some(o => o.key === text)) continue
      const before = items.find(i => i.key === text)
      const active = textOf(todo.activeForm)
      out.push({ key: text, n: before?.n ?? n++, text, ...(active ? { active } : {}), status: statusOf(todo.status) ?? 'pending' })
    }
    return out.length ? out : same
  }
  return same
}

/** Done, total and the step in progress, as an agent's step counter shows them. */
export function checklistProgress(items: readonly ChecklistItem[]): { done: number; total: number; note: string | undefined } {
  const doing = items.find(i => i.status === 'in_progress')
  return { done: items.filter(i => i.status === 'completed').length, total: items.length, note: doing ? (doing.active ?? doing.text) : undefined }
}

/** Every item completed (an empty list is not done). */
export const isListDone = (items: readonly ChecklistItem[]): boolean => items.length > 0 && items.every(i => i.status === 'completed')

/** Claude's list after one of its calls: a new list starts with a task created after the last one finished, or a TodoWrite that shares no item. */
/** True when this call starts a new list rather than changing the current one. */
export function startsNewList(list: Checklist | null, call: TaskCall): boolean {
  if (!list) return true
  if (call.tool === 'TaskCreate') return isListDone(list.items)
  if (call.tool !== 'TodoWrite') return false
  const todos = applyTaskCall([], call)
  return todos.length > 0 && !todos.some(t => list.items.some(i => i.key === t.key))
}

export function applyMainTaskCall(list: Checklist | null, call: TaskCall, heading: string): Checklist | null {
  const isNew = startsNewList(list, call)
  const base = isNew || !list ? [] : list.items
  const items = applyTaskCall(base, call)
  if (items === base) return list
  if (items.length === 0) return null
  return { heading: isNew || !list ? heading : list.heading, items }
}

const wordsOf = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])

/** The task an agent starting now belongs under: the one in progress, the best-matching of several, else none. */
export function placeAgent(items: readonly ChecklistItem[], description: string): number | null {
  const doing = items.filter(i => i.status === 'in_progress')
  if (doing.length === 0) return null
  const words = wordsOf(description)
  const score = (i: ChecklistItem) => [...wordsOf(i.text)].filter(w => words.has(w)).length
  return doing.reduce((best, i) => (score(i) > score(best) || (score(i) === score(best) && i.n > best.n) ? i : best)).n
}

/** Claude's list in the shape the plan view draws. */
export function checklistAsPlan(list: Checklist): Plan {
  return {
    path: LIST_FALLBACK,
    title: list.heading,
    tasks: list.items.map(i => ({ n: i.n, title: i.text })),
    complete: list.items.filter(i => i.status === 'completed').map(i => i.n),
    current: list.items.find(i => i.status === 'in_progress')?.n ?? null,
    workspace: null,
    inline: false,
  }
}

/** A list's heading from the prompt that started it. */
export const headingOf = (prompt: string): string => cut(firstLine(prompt), ACTION_MAX) || LIST_FALLBACK
