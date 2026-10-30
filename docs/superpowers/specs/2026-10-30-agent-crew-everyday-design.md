# agent-crew everyday mode — design

agent-crew follows superpowers plans today. Without superpowers, the panel
falls back to a bare list of agents, and the row shows `2 working · 1 done`.
This design gives every Claude Code session that uses subagents the same kind
of feedback, so the mod is worth publishing to people who don't use
superpowers.

Mockup: https://claude.ai/artifact/A1iEaeiJZzD4o5Qe1y6F68 (approved by the
owner on 2026-10-30).

## Why

The owner's own workflow is superpowers, but the mod is now public
(`Rest95/agent-crew`), and most people run Claude Code the default way: they
ask for something, Claude may keep a task list and sends subagents off.
What they want to see for each agent, in the owner's words: **what it is
doing, its progress, its cost.**

Success: in a plain session, with no setup and no command, the panel shows
each running agent's current action, how far along it is and what it has cost,
and the row above the prompt sums up the session.

## Goals

- **What each agent is doing.** A live line under each agent's name, from its
  latest tool call, in plain words:
  - `✎ Editing <path>` for Edit, Write, MultiEdit, NotebookEdit
  - `⌕ Reading <path>` for Read; `⌕ Searching "<pattern>"` for Grep;
    `⌕ Finding <glob>` for Glob
  - `▶ Running <command>` for Bash (its `description` when it has one, else
    the first words of the command)
  - `⇣ Fetching <host>` for WebFetch; `⇣ Searching the web` for WebSearch
  - `↳ Starting <description>` for Agent
  - any other tool: `· <tool name>` (MCP tools by their short name)

  Paths show relative to the session's folder, shortened from the left when
  long. The line stays on the last action until the next one; a finished
  agent shows no action line.
- **Each agent's progress.**
  - When the agent keeps its own checklist (its own `TodoWrite`, or
    `TaskCreate`/`TaskUpdate` calls made from its loop): a solid bar, with
    `done/total · <the in-progress item>`.
  - When it keeps none: a count of the tool calls it has made (`14 steps`) and
    its context fill as a dim bar, as the plain list draws it today.
  - A superpowers implementer's `step` tool reports keep working as now and
    win over its own checklist.
- **Each agent's cost.** Unchanged: its tokens at list prices, beside model
  and time.
- **Claude's task list as the plan.** When the main conversation keeps a task
  list (`TaskCreate`/`TaskUpdate`, or `TodoWrite`), the panel shows it the way
  it shows a superpowers plan: a heading, a `Tasks n/N` bar, cost, tokens and
  time totals, a rule, then the tasks (✓ done, ● in progress, ◷ pending),
  each opening on a click to show its agents. An agent sits under the task
  that was in progress when it started (see Agent placement).
- **No task list.** The heading reads `N agents · W working · D done`, the
  bar counts agents finished out of all agents, then `Working · W` with each
  running agent, then a rule and a folded `Finished · D` list (one line each:
  ✓, name, type, time, cost).
- **The row above the prompt.**
  - With a task list: the heading (shortened as today), the bar,
    `Tasks n/N`, percent and `N working`.
  - Without one: `W working · D done` with a bar of agents finished.
  - Model, effort, branch, context and cache countdown are unchanged.
- **Superpowers keeps its view, plus the action line.** When a superpowers
  plan is detected, the plan view stays as it is today, and its agent rows
  also gain the action line (*my call*: it answers "what is each agent
  doing" there too). Superpowers progress still comes from the `step` tool.
  Precedence of views: superpowers plan, then Claude's task list, then no
  list.
- **Both surfaces.** The terminal and the desktop app show the same
  information; on the desktop the action line and the progress text join the
  agent's row drawing.

## Non-goals

- No new command, setting or step the person has to take.
- No changes to any agent's instructions in everyday mode. (The step brief is
  still added for superpowers implementers only.)
- No attempt to infer roles like implementing / reviewing outside superpowers;
  the agent's type (Explore, general-purpose, a custom agent) takes that place,
  coloured as today.
- Workflow-tool agents (whose ids `$.agent.list()` doesn't name) are not
  tracked beyond what the plain list does today.

## Anti-goals

- **Never slow a tool call.** The action and step tracking runs beside the
  call (the existing `beside()` queue), never in its path.
- **Never show the wrong agent's action.** Every update is keyed by the
  calling loop's `agentId`; a call with none belongs to the main conversation
  and never changes an agent's line.
- **Never leak a subagent's checklist into the plan.** Only items created in
  the main loop make up Claude's task list.

## How it works (decided)

- **Main task list.** Hooks on `tool.call` for `TaskCreate`, `TaskUpdate` and
  `TodoWrite`, main loop only (no `agentId`):
  - `TaskCreate` adds an item with the id its result returns (`task.id`).
  - `TaskUpdate` changes status or subject of a known id; status `deleted`
    removes it. Only main-loop updates touch this list: ids are kept per loop
    (*my call*), so a subagent's `TaskUpdate` with id `1` is its own item 1,
    never the plan's.
  - `TodoWrite` replaces the whole list (items keyed by position and text).
  - A new list starts when an item is created after every item was
    completed or deleted, or when `TodoWrite` replaces the list. `/clear`
    resets it.
  - **When the list is done** (*my call*, mirroring superpowers): the bar
    reads `Done` and the view stays until something else runs. A new agent
    starting while no item is open switches to the no-list view.
  - **Input shapes** follow the API's own tool types (`TaskCreate` result
    `task.id`, `TaskUpdate` `status`, `TodoWrite` `todos[].status` and
    `activeForm`). Parse tolerantly: a call whose shape doesn't match is
    ignored, never fatal. The owner's own transcripts hold almost no
    task-list calls, so the no-list view is the common case and the by-hand
    check captures real calls first.
- **Heading.** The latest prompt the person submitted before the list's first
  item, first line, cut to fit (from `prompt.submit`). Without one,
  `Claude's task list`.
- **Agent placement.** At `agent.spawn`, with a task list showing:
  - one item in progress: the agent goes under it;
  - several: under the one whose words best match the agent's description,
    ties to the most recently started;
  - none in progress, or no list yet: under `Other agents`.

  Placement is fixed at spawn: agents started before a list appeared stay
  under `Other agents` (*my call*).
- **Agent checklists and actions.** One `tool.call` hook without a matcher
  reads calls carrying an `agentId` that belongs to a tracked run: it records
  the action line and the step count, and the agent's own
  `TodoWrite`/`TaskCreate`/`TaskUpdate` calls become its progress (its own
  id space). A call from an agent the mod doesn't track yet is dropped
  (*my call*; buffering briefly is fine if the builder finds early calls
  being lost).
- **Claude Code's own agent list** stays hidden by the plugin's
  `subagentStatusLine` (0.2.11).

## Left to the builder

- New state shape (where checklist, action and step count live; extending
  `Run` is fine), names, and how `art.ts` draws the new lines.
- Exact text cutting and path shortening, and the word-match rule for
  placement, within the rules above.
- How often the action line may redraw (at most once per tool call is fine).
- Tests in the existing style (`claude plugin test`), including a real-session
  check in tmux: a plain session with a task list and two agents, and one
  without a list.
- The preview page gains the two everyday views next to the superpowers ones,
  and the README describes the everyday mode first, superpowers second.
