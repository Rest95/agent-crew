export type Role = 'implement' | 'fix' | 'review' | 'rereview' | 'final' | 'other'

export type Status = 'running' | 'done' | 'failed'

export type PlanTask = { n: number; title: string }

/** The superpowers plan being followed: read from its file, its workspace and its ledger. */
export type Plan = {
  path: string
  title: string
  tasks: PlanTask[]
  workspace: string | null
  complete: number[]
  current: number | null
  /** Run by executing-plans (the main session), not by subagents. */
  inline: boolean
}

/** One item of a task list: Claude's own (the main conversation's) or an agent's. */
export type ChecklistItem = {
  /** The task id, or the todo's text for `TodoWrite`. */
  key: string
  /** Stable within its list: agents are placed under it by this number. */
  n: number
  text: string
  /** The present-continuous form shown while it is in progress. */
  active?: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Claude's task list in the main conversation, shown as the plan when no superpowers plan runs. */
export type Checklist = {
  /** The prompt that started it, first line. */
  heading: string
  items: ChecklistItem[]
}

/** A task-list tool call as the hooks see it: its input and its result. */
export type TaskCall = { tool: string; input: unknown; result: unknown }

/** One subagent run; a resumed implementer is a new run with the same agentId. */
export type Run = {
  id: string
  agentId?: string
  label: string
  type: string
  model: string
  effort?: string
  role: Role
  task: number | null
  round: number
  status: Status
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  requests: number
  findings?: number
  /** Self-reported by an implementer through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  /** What it is doing now, from its latest tool call (`✎ Editing lib/a.ts`). */
  action?: string
  /** Tool calls it has made. */
  steps?: number
  /** Its own task list, when it keeps one. */
  ownList?: ChecklistItem[]
  /** Where its step counter comes from: the `step` tool wins over its own list. */
  stepSource?: 'tool' | 'list'
}

/** The main session, as the row above the prompt shows it. */
export type Main = {
  model: string | null
  /** The main session's effort level (`high`, `xhigh`…): the model's setting, then each request's own. */
  effort: string | null
  branch: string | null
  context: number | null
  /** A main-session turn is running: the cache stays warm. */
  busy: boolean
  expiresAt: number | null
  /** The smallest threshold (10 or 5 minutes) announced since the last answer; 0 for none. */
  warned: number
  rowHidden: boolean
  /** When the plan view first became Done. */
  planDoneAt: number | null
  /** When the main session's latest request was served: the cache is warm from there. */
  lastServedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-crew': {
      plan: Plan | null
      runs: Run[]
      finishedOpen: boolean
      /** Which groups of the panel's plan view the person opened or closed (`t2`, `final`, `other`). */
      openGroups: Record<string, boolean>
      now: number
      main: Main
      /** Seconds of cache left, written each second while it counts down so the row redraws. */
      cacheLeft: number
      /** Claude's task list in the main conversation; null when it keeps none. */
      checklist: Checklist | null
      /** The latest prompt the person submitted: the heading of the next task list. */
      prompt: string
    }
  }
}
