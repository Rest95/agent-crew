# agent-crew Everyday Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In any Claude Code session that uses subagents, the panel and the row show what each agent is doing, its progress and its cost; Claude's own task list becomes the plan when there is one.

**Architecture:** Pure functions in `hooks/model.ts` turn tool calls into an action line and into checklists (Claude's, and each agent's own). `hooks/register.tsx` feeds them from one matcher-less `tool.call` hook and a `prompt.submit` hook, stores Claude's list in a new `checklist` atom, and renders it through the existing plan view by converting it to a `Plan` (`checklistAsPlan`). A superpowers plan, when present, always wins.

**Tech Stack:** Claude Code mod API (build 2.1.312), TypeScript/TSX hooks module, `claude-code/testing` (`claude plugin test`).

**Spec:** `docs/superpowers/specs/2026-10-30-agent-crew-everyday-design.md`

## Global Constraints

- No new command, setting or step for the person; no change to any agent's instructions in everyday mode (the `STEP_BRIEF` stays superpowers-implementers only).
- Never slow a tool call: everything after `next(e)` runs through the existing `beside()` queue and is wrapped in try/catch; the hook always returns `next(e)`'s result unchanged.
- Every agent update is keyed by the calling loop's `agentId`; a call without one belongs to the main conversation and never changes an agent's row.
- Only main-loop task calls build Claude's list; task ids are kept per loop.
- Precedence of views: superpowers plan, then Claude's task list, then no list.
- Action words, exactly: `✎ Editing <path>` (Edit, Write, MultiEdit, NotebookEdit), `⌕ Reading <path>` (Read), `⌕ Searching "<pattern>"` (Grep), `⌕ Finding <glob>` (Glob), `▶ Running <description or command>` (Bash), `⇣ Fetching <host>` (WebFetch), `⇣ Searching the web` (WebSearch), `↳ Starting <description>` (Agent), `· <tool name>` otherwise (MCP tools by the part after the last `__`).
- No-list heading: `N agents · W working · D done`; its bar: `D/N done` and percent. Task-list path line: `Claude's task list`; heading fallback: `Claude's task list`.
- Client and project names never appear in the repo (samples stay neutral); commits use the repo-local noreply author already configured.
- Every task ends with `claude plugin test plugins/agent-crew` green, `claude plugin validate plugins/agent-crew` passing and the type-check clean: `tsc -p <scratchpad>/crew-tsc/tsconfig.json` (its `include` points at `plugins/agent-crew/hooks/**` and `types/**`).

## Review Focus

1. Two agents' tool calls interleaving: each keeps its own action and step count (no lost update between `update` calls). Test in Task 3.
2. A subagent's `TaskUpdate` whose id equals a main-list id leaves Claude's list untouched. Test in Task 3.
3. A malformed task call (no `task.id` in the result, `todos` not an array, a null result) changes nothing and the tool's result comes back unchanged. Test in Task 3.
4. A multi-line or very long Bash command, a path outside the session folder, an empty Grep pattern: the action line is one line, at most 60 characters. Test in Task 1.
5. A superpowers plan plus a main-loop task list: the panel and row show the superpowers plan. Test in Task 4.

---

### Task 1: Pure model — actions and checklists

**Files:**
- Modify: `plugins/agent-crew/types/index.d.ts` (new types, `Run` fields, two state keys)
- Modify: `plugins/agent-crew/hooks/model.ts`
- Test: `plugins/agent-crew/hooks/model.test.ts`

**Interfaces:**
- Produces (types):
  - `ChecklistItem = { key: string; n: number; text: string; active?: string; status: 'pending' | 'in_progress' | 'completed' }` (`key`: the task id, or the todo's text for `TodoWrite`; `n`: stable number, never reused within a list)
  - `Checklist = { heading: string; items: ChecklistItem[] }`
  - `TaskCall = { tool: string; input: unknown; result: unknown }`
  - `Run` gains `action?: string`, `steps?: number`, `ownList?: ChecklistItem[]`, `stepSource?: 'tool' | 'list'`
  - `PluginState['agent-crew']` gains `checklist: Checklist | null` and `prompt: string`
- Produces (functions, all exported from `model.ts`):
  - `describeAction(tool: string, input: unknown, cwd: string | null): string | null` — the action words above; paths relative to `cwd` when inside it; first line only; cut to 60 characters with `…` (paths cut from the left: `…/export/csv.ts`). `null` for `TaskCreate`, `TaskUpdate`, `TodoWrite`, `TaskList`, `TaskGet` and the `mcp__agent-crew__step` tool (bookkeeping, not work).
  - `applyTaskCall(items: readonly ChecklistItem[], call: TaskCall): ChecklistItem[]` — `TaskCreate`: append `{ key: result.task.id, n: max n + 1, text: input.subject, active: input.activeForm, status: 'pending' }`; `TaskUpdate`: find `key === input.taskId`; `status: 'deleted'` removes it; `subject`/`activeForm`/`status` update it; `TodoWrite`: the new list is `input.todos`, matched to existing items by text (keeping their `n`), new texts get fresh numbers. Any shape it can't read returns `items` unchanged (same array).
  - `checklistProgress(items: readonly ChecklistItem[]): { done: number; total: number; note: string | undefined }` — note: the first in-progress item's `active ?? text`.
  - `isListDone(items: readonly ChecklistItem[]): boolean` — at least one item and all completed.
  - `applyMainTaskCall(list: Checklist | null, call: TaskCall, heading: string): Checklist | null` — starts a new list (`{ heading, items: applyTaskCall([], call) }`) when `list` is null or `isListDone(list.items)`, or when a `TodoWrite` shares no text with the current items; otherwise applies to the current list. A result with no items is `null`.
  - `placeAgent(items: readonly ChecklistItem[], description: string): number | null` — one in-progress item: its `n`; several: the one sharing the most lower-cased words of 3+ letters with `description`, ties to the highest `n`; none: `null`.
  - `checklistAsPlan(list: Checklist): Plan` — `{ path: "Claude's task list", title: list.heading, tasks: items as { n, title: text }, complete: completed ns, current: first in-progress n ?? null, workspace: null, inline: false }`.
  - `headingOf(prompt: string): string` — first non-empty line, trimmed, cut to 60 with `…`; empty → `Claude's task list`.

- [ ] **Step 1: Write the failing tests** in `model.test.ts`:
  - `describeAction: one line per kind of tool` — `('Edit', { file_path: '/repo/app/lib/export/csv.ts' }, '/repo/app')` → `'✎ Editing lib/export/csv.ts'`; `('Read', { file_path: '/etc/hosts' }, '/repo/app')` → `'⌕ Reading /etc/hosts'`; `('Grep', { pattern: 'toLocaleDateString' }, null)` → `'⌕ Searching "toLocaleDateString"'`; `('Glob', { pattern: '**/*.ts' }, null)` → `'⌕ Finding **/*.ts'`; `('Bash', { command: 'pnpm test', description: 'Run the tests' }, null)` → `'▶ Running Run the tests'`; `('Bash', { command: 'pnpm ts-prune' }, null)` → `'▶ Running pnpm ts-prune'`; `('WebFetch', { url: 'https://docs.example.com/a' }, null)` → `'⇣ Fetching docs.example.com'`; `('WebSearch', { query: 'x' }, null)` → `'⇣ Searching the web'`; `('Agent', { description: 'Map routes' }, null)` → `'↳ Starting Map routes'`; `('mcp__github__create_issue', {}, null)` → `'· create_issue'`; `('TodoWrite', { todos: [] }, null)` → `null`.
  - `describeAction: always one short line` — a Bash command `'cd a\nnpm test'` → `'▶ Running cd a'`; a 200-character command → length ≤ 60 and ends with `…`; an Edit path of 120 characters → length ≤ 60 and starts with `'✎ Editing …'`; `('Grep', { pattern: '' }, null)` → `'⌕ Searching ""'`.
  - `applyTaskCall: create, update, delete by id` — create `{subject:'A'}` → result `{task:{id:'1',subject:'A'}}`, create B (id `'2'`), update `{taskId:'1', status:'completed'}`, update `{taskId:'2', status:'deleted'}` → `[{ key:'1', n:1, text:'A', status:'completed' }]`; a third create gets `n: 3` (numbers are never reused).
  - `applyTaskCall: TodoWrite keeps numbers by text` — todos `[a pending, b pending]` then `[a completed, c in_progress, b pending]` → ns `a:1, c:3, b:2`, statuses as given; `active` taken from `activeForm`.
  - `applyTaskCall: unreadable calls change nothing` — `TaskCreate` with result `null`, with result `{}`, `TodoWrite` with `todos: 'x'`, `TaskUpdate` for an unknown id: each returns the same array (`toBe`).
  - `applyMainTaskCall: a new list after a finished one, or a TodoWrite with new texts` — headings `'first'` then `'second'` show which list is current.
  - `placeAgent: one, several, none` — single in-progress → its n; two in progress `'Add the CSV writer'` (n 2) and `'Wire the export button'` (n 3) with description `'Write the CSV writer and tests'` → 2; a tie → the higher n; none in progress → `null`.
  - `checklistAsPlan` and `headingOf` — values as specified above; `headingOf('\n  Add CSV export to the reports page\nmore')` → `'Add CSV export to the reports page'`.

- [ ] **Step 2: Run them to see them fail**
  Run: `claude plugin test plugins/agent-crew`
  Expected: the new tests fail with "is not a function" / undefined exports; the existing 114 pass.

- [ ] **Step 3: Implement the types and functions above** in `types/index.d.ts` and `model.ts`.

- [ ] **Step 4: Run tests, validate and type-check**
  Expected: all pass, `✔ Validation passed`, no tsc output.

- [ ] **Step 5: Commit** — `feat(everyday): pure model for actions and checklists`

---

### Task 2: Drawing — everyday groups, titles and the desktop rows

**Files:**
- Modify: `plugins/agent-crew/hooks/art.ts`
- Test: `plugins/agent-crew/hooks/art.test.ts`

**Interfaces:**
- Consumes: `Run.action`, `Run.task` (Task 1 types).
- Produces:
  - `planGroups`: the `other` group holds runs with `role === 'other' && task === null` (an everyday run placed under a task appears there only).
  - `runTitle(run, plan)`: the `Task n · title` form only for superpowers roles (`role !== 'other'`); everyday runs keep their label.
  - `agentRowHeight(run: Run): number` — `AGENT_ROW_HEIGHT` (66), or 80 for a running run with an `action`; `agentRowSvg` draws the action line (font 11, colour `#e8c66a`) under the title and moves the rest down by 14 when it does.
  - `desktopPaneItems` with no plan: the no-list view — an `svg` header (`noListSvg(width, runs)`: `N agents · W working · D done`, a bar of D/N, percent), the totals, a `rule`, a `section` `Working · W`, running agents, then the `finished` toggle and finished agents as now. Agents use `agentRowHeight`.
  - `finishedLine(run: Run, now: number): string` — `✓ <label>  <type> · <time> · ≈<cost>` (✗ for failed), used by the terminal in Task 4.

- [ ] **Step 1: Write the failing tests** in `art.test.ts`:
  - `planGroups: an everyday run under a task is not also under Other agents` — plan of 2 tasks, run `{ role:'other', task: 2 }` and run `{ role:'other', task: null }` → group `t2` has the first, `other` has only the second.
  - `runTitle: everyday runs keep their name` — `{ role:'other', task: 1, label:'Write the CSV writer' }` → `'Write the CSV writer'`; `{ role:'implement', task: 1 }` → `'Task 1 · …'` as today.
  - `agentRowSvg: a running agent's action is drawn` — the svg contains `✎ Editing lib/a.ts`; `agentRowHeight` is 80; a finished run with an action draws none and is 66.
  - `desktopPaneItems: the no-list view` — 3 runs (2 running, 1 done), no plan → first svg's alt contains `3 agents · 2 working · 1 done`, a `section` `Working · 2` follows a `rule`.
  - `finishedLine` — a done Explore run → `'✓ Map the API routes  Explore · 0:31 · ≈$0.01'`.

- [ ] **Step 2: Run them to see them fail.** Expected: the new tests fail; nothing else does.
- [ ] **Step 3: Implement** in `art.ts`.
- [ ] **Step 4: Tests, validate, type-check** — all green.
- [ ] **Step 5: Commit** — `feat(everyday): groups, titles and desktop rows for everyday runs`

---

### Task 3: Tracking — tool calls, prompts, placement

**Files:**
- Modify: `plugins/agent-crew/hooks/register.tsx`
- Modify: `plugins/agent-crew/hooks/fixtures.ts`
- Test: `plugins/agent-crew/hooks/register.test.tsx`

**Interfaces:**
- Consumes: Task 1's functions and types.
- Produces:
  - atoms `checklistAtom` (`{ plugin: 'agent-crew', key: 'checklist' }`, `null`) and `promptAtom` (`key: 'prompt'`, `''`).
  - `shownPlan($): Promise<Plan | null>` — the superpowers plan, else `checklistAsPlan(checklist)` when a checklist exists, else `null`. Tasks 4 and 5 render from it; `tickRow` uses it for `planDoneAt`.
  - Hooks:
    - `prompt.submit` (main loop): after `next(e)`, store `e.text` in `promptAtom`.
    - one matcher-less `tool.call`: `const done = await next(e)`, then beside the call:
      - no `agentId` and a task tool → `checklistAtom = applyMainTaskCall(current, { tool, input: e, result: done.result }, headingOf(prompt))`; a new list resets `main.planDoneAt` to `null`.
      - with an `agentId` of a running tracked run (`newestOf`) → `action = describeAction(...) ?? action`, `steps = (steps ?? 0) + 1` for every call except the bookkeeping ones; a task tool → `ownList = applyTaskCall(ownList ?? [], …)` and, unless `stepSource === 'tool'`, `stepDone/stepTotal/stepNote` from `checklistProgress` with `stepSource: 'list'`.
      - an `agentId` with no tracked run → dropped.
    - `tool.call` on the step tool: also sets `stepSource: 'tool'`.
    - `agent.spawn`, when there is no superpowers plan: if the checklist is done and no item is open → `checklistAtom = null`; else `task = placeAgent(items, description)` (role stays `other`). With a superpowers plan, unchanged.
    - `turn.complete` of an agent: clears its `action`.
    - `session.end` with reason `clear`: `checklistAtom = null`, `promptAtom = ''`.
- Fixtures (`fixtures.ts`):
  - stand-ins for `TaskCreate` (answers `{ result: { task: { id: String(++w.taskIds), subject } } }`), `TaskUpdate` (`{ result: { success: true, taskId, updatedFields: [] } }`), `TodoWrite`, `Read`, `Edit`, `Grep` (`{ result: {} }`), and `prompt.submit` (answers as the API's types say).
  - helpers `call($, tool, input, agentId?)` and `submit($, text)`, both ending in `settle()`; `checklist(w)` reads the stored list.

- [ ] **Step 1: Write the failing tests** in `register.test.tsx`:
  - `Claude's task list is tracked from the main conversation` — `submit('Add CSV export to the reports page')`, `TaskCreate` A and B, `TaskUpdate` A in_progress → `checklist(w)` heading `'Add CSV export to the reports page'`, items A (in_progress, n 1), B (pending, n 2).
  - `an agent sits under the task in progress when it starts` — after the above, `spawn('t1', 'Write the CSV writer')` → its run has `role: 'other', task: 1`.
  - `an agent's action and steps follow its own tool calls` — `call(Edit, {file_path:'/repo/payments/lib/a.ts'}, 'a-t1')`, then `call(Grep, {pattern:'x'}, 'a-t1')` → run `action: '⌕ Searching "x"'`, `steps: 2`.
  - `two agents keep their own actions` (Review Focus 1) — spawn t1 and t2, interleave Edit on a-t1, Read on a-t2, Grep on a-t1 → a-t1 `⌕ Searching …` with steps 2, a-t2 `⌕ Reading …` with steps 1.
  - `an agent's own checklist is its progress` — `TodoWrite` from `a-t1` with 4 todos, 1 completed, 1 in_progress with activeForm `'Writing the tests'` → `stepDone 1, stepTotal 4, stepNote 'Writing the tests', stepSource 'list'`; Claude's list unchanged.
  - `a subagent's TaskUpdate never touches Claude's list` (Review Focus 2) — main list has id `'1'`; `TaskUpdate {taskId:'1', status:'completed'}` from `a-t1` → Claude's item 1 still in_progress.
  - `the step tool wins over an agent's own checklist` — a step report then a TodoWrite from the same agent → step values stay.
  - `unreadable task calls change nothing and pass their result back` (Review Focus 3) — a `TaskCreate` stand-in answering `{ result: null }` → `checklist(w)` stays `null` and `call(...)` returns `{ result: null }`.
  - `a finished list gives way to the next agent` — all items completed, then `spawn` → `checklist(w)` is `null`.
  - `/clear forgets the list` — `session.end` with reason `clear` → `checklist(w)` `null`.

- [ ] **Step 2: Run them to see them fail.** Expected: the new tests fail; the rest pass.
- [ ] **Step 3: Implement** the atoms, `shownPlan`, hooks and fixture stand-ins above. The matcher-less hook must coexist with the `Bash` and step-tool hooks (the step tool answers for itself; the generic hook skips it).
- [ ] **Step 4: Tests, validate, type-check** — all green.
- [ ] **Step 5: Commit** — `feat(everyday): track Claude's task list, agents' actions and checklists`

---

### Task 4: Terminal panel — task-list view, no-list view, action lines

**Files:**
- Modify: `plugins/agent-crew/hooks/register.tsx` (the `Pane` render)
- Test: `plugins/agent-crew/hooks/pane.test.tsx`

**Interfaces:**
- Consumes: `shownPlan` (Task 3), `finishedLine`, `agentRowHeight`, the no-list `desktopPaneItems` (Task 2).
- Produces:
  - The `Pane` render reads `shownPlan($)` instead of `planAtom` for drawing; the grouped plan view then draws Claude's list (path line `Claude's task list`) with no further change.
  - `agentLine(r)` adds, for a running run with an `action`, one line under the name: four spaces, then the action in `#e8c66a`, truncated. This applies to superpowers rows too (spec: *my call*).
  - The no-list terminal view replaces today's plain list (and drops its unreachable plan branch): heading `N agents · W working · D done` (bold, `ACCENT`), the bar line `bar(D/N·100, 24)` + `D/N done` + percent, the totals line, a rule, `Working · W` and each running `agentLine`, then (when any finished) a rule, the `Finished · D` toggle and `finishedLine` per finished run.

- [ ] **Step 1: Write the failing tests** in `pane.test.tsx`:
  - `terminal: Claude's task list shows as the plan` — submit + two TaskCreates + one in_progress + a spawn → Texts `/Add CSV export/`, `/Claude's task list/`, `/Tasks 0\/2/` exist; the spawned agent's name is under the open task.
  - `terminal: a running agent shows what it is doing` — after an Edit call from it → a Text matching `/✎ Editing lib\/a\.ts/`.
  - `terminal: a superpowers agent shows its action too` — `midPlan` + an Edit from `a-t2` → `/✎ Editing/` under Task 2.
  - `terminal: no task list` — two spawns, one finished → `/2 agents · 1 working · 1 done/`, `/1\/2 done/`, `/Working · 1/`, `/Finished · 1/`.
  - `a superpowers plan wins over Claude's list` (Review Focus 5) — `midPlan` plus a main TaskCreate → `/Payments/` heading shown, `/Claude's task list/` absent.

- [ ] **Step 2: Run them to see them fail.** Expected: the new tests fail; existing pane tests may need their `Running ·` expectations moved to `Working ·` — update those in this step, say so in the commit.
- [ ] **Step 3: Implement** the render changes above.
- [ ] **Step 4: Tests, validate, type-check** — all green.
- [ ] **Step 5: Commit** — `feat(everyday): panel views for Claude's task list and for no list`

---

### Task 5: The row above the prompt

**Files:**
- Modify: `plugins/agent-crew/hooks/register.tsx` (the `AbovePrompt` render, `tickRow`)
- Test: `plugins/agent-crew/hooks/row.test.tsx`

**Interfaces:**
- Consumes: `shownPlan` (Task 3).
- Produces: the row draws from `shownPlan($)` (so Claude's list shows as `<heading> <bar> Tasks n/N <percent>`); the `agents` progress gains a bar of done over all agents and the percent, at tiers below 3: `● W working · D done <bar 16> <percent>`. `tickRow` sets `planDoneAt` from `shownPlan`.

- [ ] **Step 1: Write the failing tests** in `row.test.tsx`:
  - `the row shows Claude's task list` — submit + TaskCreates + spawn → Texts `/^Add CSV export/` (shortened as today) and `/Tasks 0\/2/`.
  - `the row's agent count has a bar` — two spawns, one finished, no list → `/1 working · 1 done/` and a Text matching `/[█░]{16}/` and `/50%/`.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Tests, validate, type-check** — all green.
- [ ] **Step 5: Commit** — `feat(everyday): the row follows Claude's task list and counts agents with a bar`

---

### Task 6: Preview, docs, version, and the check in a real session

**Files:**
- Modify: `scripts/preview.ts`, `scripts/preview-page.html` (two everyday moments beside the superpowers ones: "Task list" and "No task list", neutral sample names as in the mockup), `README.md` (everyday mode first, superpowers second; screenshots retaken from the preview into `docs/screenshots/`), `docs/superpowers/specs/2026-10-30-agent-crew-everyday-design.md` (mark built, 0.4.0), both manifests to `0.4.0`.

- [ ] **Step 1: Preview.** `bun scripts/preview.ts > preview/index.html`; open it and check both new moments render for terminal and desktop. Expected: no stray `…` on rules, the action lines visible.
- [ ] **Step 2: Docs and version** as listed.
- [ ] **Step 3: Full checks** — tests, validate, type-check, `scan_secrets`, and `git grep` for client names (none).
- [ ] **Step 4: By hand, in tmux** (throwaway folder in the scratchpad, `claude --model haiku`, the mod installed from this branch with `claude plugin marketplace update agent-crew` + `claude plugin update agent-crew@agent-crew`):
  1. Ask for two background Explore agents that each read several files: the panel shows `2 agents · 2 working`, each agent's `⌕ Reading …` line changing, then `Finished`.
  2. Ask Claude to make a 3-item task list and start an agent on the first: the panel shows the heading, `Claude's task list`, `Tasks 0/3`, the agent under task 1.
  3. Record what the real `TaskCreate`/`TodoWrite` calls looked like (from the transcript) and confirm they match the API types Task 1 parses; a mismatch is a ruling plus a fix.
  Close the throwaway windows afterwards.
- [ ] **Step 5: Commit** — `docs(everyday): preview, README, screenshots; version 0.4.0`
