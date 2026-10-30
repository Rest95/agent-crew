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
    }
  }
}
