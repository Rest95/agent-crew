# agent-crew Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod, `agent-crew`, whose Agents side panel follows a superpowers plan as it runs and lists every subagent, drawn in the pixel-crab style.

**Architecture:** One hooks module (`register.tsx`) wires engine events to state kept in `$.state` atoms. Two pure modules hold everything testable without the engine: `model.ts` (parsing superpowers' plan, ledger and script calls; classifying agents; pricing) and `art.ts` (sprites, SVG rows, terminal glyphs, number formatting). A Bun script reuses `art.ts` to build the preview page.

**Tech Stack:** Claude Code mod API (build 2.1.312: `on`, `$`, `atom/read/update`, `ui.render` Pane, `claude-code/testing`), TypeScript, Bun (preview script only).

**Spec:** `docs/superpowers/specs/2026-10-29-agent-crew-design.md`

## Global Constraints

- The mod lives in `plugins/agent-crew/`; the marketplace manifest at `.claude-plugin/marketplace.json` names the marketplace `agent-crew` and lists the plugin `agent-crew` (source `./plugins/agent-crew`).
- Plugin name and `$.state` key: `agent-crew`. Pane id: `agent-crew`, pane title: `Agents`. Slash command: `crew` (toggles the pane). Agent tool: `step` (seen by agents as `mcp__agent-crew__step`), registered with `isDeferred: false`.
- Role colours and costumes, verbatim: implementing `#378ADD` engineer (`careful` costume); fixing `#D85A30` engineer; reviewing `#BA7517` detective (`heavy` costume); re-reviewing `#D85A30` detective; final review `#7F77DD` astronaut (`fable` costume); other `#888780` plain crab, `Explore` agents keep the pirate (`explore` costume). Progress bar accent `#8f8cf4`, finished `#5fbf8f`.
- Labels matched case-insensitively on leading words: `Implement Task N:`, `Review Task N (spec + quality)`, `Re-review Task N fix round R`, `Review code changes`.
- Step paragraph appended to an implementer's prompt, verbatim:
  `\n\nProgress reporting: before any other work, call \`mcp__agent-crew__step\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar.`
- Every hook passes the call through (`next(e)`) and never throws past itself: a parse or file error leaves the run as a plain row.
- Never change an agent's model. Draw nothing above the prompt.
- Crab sprites and costumes are adapted from claude-kit's savvy-progress (MIT, © 2026 johnnyvizz): keep that notice in `LICENSE` and the README.
- Checks for every code task: `claude plugin test plugins/agent-crew`, `claude plugin validate plugins/agent-crew`, and a type-check (Task 1, step 6 says how).

## Review Focus

- A plan file that cannot be read (wrong cwd, worktree, deleted): no plan view, agents still listed as plain rows, nothing thrown. Test in Task 3.
- A label naming a task the plan does not have, or arriving with no plan: plain row, never a made-up task. Test in Task 2.
- A ledger left by another plan in the same workspace tree: ignored. Test in Task 1.
- An agent that ends with an error: ✗, and its task is not marked complete. Test in Task 3.
- A `step` call from the main session or from an agent without a row: ignored, `ok` never claimed. Test in Task 3.

---

### Task 1: Scaffold and superpowers parsing

**Files:**
- Create: `.claude-plugin/marketplace.json`, `.gitignore` (`plugins/*/.claude-plugin/types/`, `.DS_Store`), `LICENSE` (MIT: © 2026 Rest95, plus the savvy-progress notice), `README.md` (one paragraph; Task 6 fills it)
- Create: `plugins/agent-crew/.claude-plugin/plugin.json` (`name`, `version: "0.1.0"`, `description`, `types: "./types/index.d.ts"`, `license: "MIT"`), `plugins/agent-crew/hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`)
- Create: `plugins/agent-crew/types/index.d.ts`, `plugins/agent-crew/hooks/model.ts`, `plugins/agent-crew/hooks/register.tsx` (stub)
- Test: `plugins/agent-crew/hooks/model.test.ts`

**Interfaces:**
- Produces (`types/index.d.ts`, imported as `'../types'`):
  ```ts
  export type Role = 'implement' | 'fix' | 'review' | 'rereview' | 'final' | 'other'
  export type Status = 'running' | 'done' | 'failed'
  export type PlanTask = { n: number; title: string }
  export type Plan = { path: string; title: string; tasks: PlanTask[]; workspace: string | null; complete: number[]; current: number | null; inline: boolean }
  export type Run = { id: string; agentId?: string; label: string; type: string; model: string; effort?: string; role: Role; task: number | null; round: number; status: Status; startedAt: number; endedAt?: number; contextTokens: number; contextMax: number; tokens: number; costUsd: number; requests: number; findings?: number; stepDone?: number; stepTotal?: number; stepNote?: string }
  declare module 'claude-code' { interface PluginState { 'agent-crew': { plan: Plan | null; runs: Run[]; finishedOpen: boolean; now: number } } }
  ```
- Produces (`model.ts`):
  - `parsePlan(path: string, text: string): { title: string; tasks: PlanTask[] }` — tasks from `#{1,6} Task N: <title>` headings outside fenced code; title from the first `# ` heading minus a trailing `Implementation Plan`, else the file name without `.md`.
  - `parseLedger(text: string, planPath: string): number[]` — sorted task numbers with a `Task N: complete` line; `[]` when the first line `# SDD ledger — plan: <p>` names another plan (paths match when one ends with the other after dropping a leading `./`).
  - `type ScriptCall = { script: 'sdd-workspace' | 'task-brief' | 'task-start' | 'task-done'; plan: string; task: number | null }`
  - `parseScriptCall(command: string): ScriptCall | null` — finds a word ending in `/scripts/<script>` or equal to `<script>`, shell-splits the rest (single and double quotes), takes the next word as the plan and the one after as the task number.
  - `workspaceFrom(call: ScriptCall, stdout: string): string | null` — `sdd-workspace`: last non-empty line; `task-brief`: directory of the path in `wrote <path>: N lines`; `task-start`: directory of `brief: <path>`; `task-done`: `null`.

- [ ] **Step 1: Write the manifests, contract and stub.** `register.tsx` registers the `crew` command in `session.start` and imports `parsePlan` from `./model` (this proves a sibling import loads). The command answers `{ text: 'Crew panel opened.' }` for now.

- [ ] **Step 2: Write the failing tests** in `model.test.ts`:
  - `parsePlan('docs/superpowers/plans/2026-10-29-payments.md', '# Payments Module Implementation Plan\n\n### Task 1: API client\n```md\n### Task 9: not a task\n```\n## Task 2: Background jobs\n')` → `{ title: 'Payments Module', tasks: [{ n: 1, title: 'API client' }, { n: 2, title: 'Background jobs' }] }`
  - no `# ` heading → title `2026-10-29-payments`
  - `parseLedger('# SDD ledger — plan: docs/plans/x.md\nTask 1: complete (commits a1..b2, review clean)\nTask 3: complete (commits c..d, 1 parked)\nTask 2: fix round 1\n', './docs/plans/x.md')` → `[1, 3]`
  - same ledger checked against `docs/plans/y.md` → `[]`
  - `parseScriptCall('bash /u/.claude/plugins/cache/x/superpowers/7.0.0/skills/subagent-driven-development/scripts/sdd-workspace docs/plans/x.md')` → `{ script: 'sdd-workspace', plan: 'docs/plans/x.md', task: null }`
  - `parseScriptCall('cd /repo && bash scripts/task-brief "docs/my plan.md" 2')` → `{ script: 'task-brief', plan: 'docs/my plan.md', task: 2 }`
  - `parseScriptCall('scripts/task-done docs/plans/x.md 3 abc1234 -- pnpm test')` → task `3`
  - `parseScriptCall('git status')` → `null`
  - `workspaceFrom({ script: 'task-start', plan: 'p', task: 1 }, 'brief: /r/.superpowers/sdd/x/task-1-brief.md\nbase: abc\n')` → `/r/.superpowers/sdd/x`; `task-brief` with `wrote /r/.superpowers/sdd/x/task-2-brief.md: 40 lines` → `/r/.superpowers/sdd/x`; `sdd-workspace` with `/r/.superpowers/sdd/x\n` → `/r/.superpowers/sdd/x`

- [ ] **Step 3: Run** `claude plugin test plugins/agent-crew` — expected: the model tests FAIL (functions missing).

- [ ] **Step 4: Implement the four functions** in `model.ts`.

- [ ] **Step 5: Run** `claude plugin test plugins/agent-crew` — expected: PASS. Run `claude plugin validate plugins/agent-crew` — expected: `✔ Validation passed` (if it rejects the sibling import, stop and report: the module layout must change).

- [ ] **Step 6: Type-check.** If `plugins/agent-crew/.claude-plugin/types/` exists (the engine laid it), run `tsc -p plugins/agent-crew`. Otherwise write a tsconfig outside the repo with the options from the header of the plugin-authoring skill's `types/claude-code.d.ts` (path printed when that skill loads; in this build `<temp>/bundled-skills/<build>/<id>/plugin-authoring/types/claude-code.d.ts`), `files: [<that file>]`, `include: [<repo>/plugins/agent-crew/hooks/**/*, <repo>/plugins/agent-crew/types/**/*]`, and run `tsc -p <that tsconfig>`. Expected: no output.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: scaffold agent-crew and parse superpowers plans"`

### Task 2: Classifying agents, pricing, plan status

**Files:**
- Modify: `plugins/agent-crew/hooks/model.ts`
- Test: `plugins/agent-crew/hooks/model.test.ts`

**Interfaces:**
- Consumes: `Plan`, `Run`, `Role` from Task 1.
- Produces (`model.ts`):
  - `classify(label: string, plan: Plan | null, runs: readonly Run[]): { role: Role; task: number | null; round: number }`
  - `fixRound(task: number, runs: readonly Run[]): number` — the task's finished `review`/`rereview` runs with `findings > 0`, at least 1.
  - `countFindings(answer: string): number` — list items (`-`, `*`, `1.`) under `#### Critical` and `#### Important` headings, up to the next heading; `0` when none.
  - `planPhase(plan: Plan, runs: readonly Run[]): { done: number; total: number; label: string; isFinished: boolean }` — label `Tasks d/t`, `Review d/t` while a `final` run is running, `Done` once every task is complete and no `final` run is running.
  - `costOf(model: string, usage: Usage, isRequest: boolean): number`, `windowOf(model: string): number`, `type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }` — same price table, Haiku 5.5 long-prompt rule and windows as savvy-progress (`~/.claude/local-plugins/plugins/savvy-progress/hooks/register.tsx`, `PRICES`, `HAIKU_LONG`, `costOf`, `windowOf`).

- [ ] **Step 1: Write the failing tests:**
  - plan with tasks 1-3, no runs: `classify('Implement Task 2: Background jobs', plan, [])` → `{ role: 'implement', task: 2, round: 0 }`
  - `classify('implement task 2: x', ...)` → same role (case-insensitive)
  - an `implement` run for task 2 already exists and a finished `review` run for task 2 has `findings: 2`: `classify('Implement Task 2: Background jobs', ...)` → `{ role: 'fix', task: 2, round: 1 }`
  - `classify('Review Task 2 (spec + quality)', ...)` → `review`, task 2
  - `classify('Re-review Task 2 fix round 3', ...)` → `{ role: 'rereview', task: 2, round: 3 }`
  - `classify('Review code changes', plan with complete [1,2,3], [])` → `final`, task `null`; with complete `[1]` → `other`
  - `classify('Implement Task 7: ghost', plan, [])` → `{ role: 'other', task: null, round: 0 }`; `classify('Implement Task 1: x', null, [])` → `other`
  - `countFindings('### Issues\n#### Critical (Must Fix)\n- a.ts:3 wrong\n#### Important (Should Fix)\n1. b.ts:9 missing test\n2. c.ts:1 leak\n#### Minor (Nice to Have)\n- naming\n')` → `3`; `countFindings('**Task quality:** Approved')` → `0`
  - `planPhase` of tasks 1-5 with complete `[1,2]` → `{ done: 2, total: 5, label: 'Tasks 2/5', isFinished: false }`; all complete plus a running `final` run → `Review 5/5`; all complete, no `final` running → `Done`, `isFinished: true`
  - `costOf('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 2e6, cache_creation_input_tokens: 1e6 }, false)` → `16.2` (to 2 decimals); `windowOf('claude-haiku-4-5')` → `200000`; `windowOf('claude-sonnet-5-5')` → `1000000`

- [ ] **Step 2: Run** `claude plugin test plugins/agent-crew` — expected: new tests FAIL.
- [ ] **Step 3: Implement** the functions in `model.ts`.
- [ ] **Step 4: Run** tests, validate and type-check (Task 1, steps 5-6) — expected: all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat: classify superpowers agents and price runs"`

### Task 3: Wiring events to state

**Files:**
- Modify: `plugins/agent-crew/hooks/register.tsx`
- Test: `plugins/agent-crew/hooks/register.test.tsx`

**Interfaces:**
- Consumes: everything in `model.ts`.
- Produces: the `$.state` values in the contract, kept current by these hooks (Task 5 only reads them):
  - `session.start`: register tool `step` (input `{ done: integer ≥ 0, total?: integer ≥ 1, note?: string }`, `isDeferred: false`), command `crew`, a 1-second `$.clock.every` that updates `now` only while a run is running.
  - `tool.call` on `Bash`: `await next(e)` first; then `parseScriptCall(e.command)`. On a call: a new plan path (or a different workspace) replaces `plan` (read the file with `$.fs.read`; on failure keep `plan` null); set `workspace` from `workspaceFrom` when known; `task-start` sets `inline: true`; `task-brief`/`task-start` set `current`; then re-read the ledger (`<workspace>/progress.md` when `$.fs.exists`) into `complete`. Open the pane. Whenever the ledger is re-read and a workspace that existed is gone (superpowers deletes it when the final review is clean), mark every task complete.
  - `agent.spawn`: classify the label; for `implement`/`fix` from a new `Implement Task N:` label, call `next` with the step paragraph appended to `prompt`; record the run from the result (`agentId`, `model`, `contextMax: windowOf(model)`); set `current` to the run's task when it has one. Open the pane every time (`$.ui.open({ id: 'agent-crew', title: 'Agents' })`, not awaited).
  - `turn.step` with an `agentId`: update that agent's newest run (context = input + cache read + cache write + output of the request; tokens and cost added; `requests + 1`; `effort` when given). If that run is finished and it is an `implement`/`fix` run, a resume: add a new run with role `fix`, `round: fixRound(task, runs)`, same `agentId`.
  - `turn.complete` with an `agentId`: newest run of it gets `status` `done` (reason `answer`) or `failed` (any other), `endedAt`; a `review`/`rereview` gets `findings: countFindings(e.answer ?? '')`; a run with no requests seen takes its cost from `e.usage`. Then re-read the ledger.
  - `tool.call` for `mcp__agent-crew__step`: from an agent (`e.agentId`) with a running run → update its step fields, answer `{ result: 'ok' }`; otherwise `{ result: 'ignored: …' }`.
  - `command.run` `crew`: toggle the pane (`$.ui.panes()`), answer `Crew panel opened.` / `Crew panel closed.`

- [ ] **Step 1: Write the failing tests** (engine harness, mocks as in savvy-progress's `cost.test.ts`: `mock.clock`, `on('agent.spawn', …)`, `on('turn.step', async function* …)`, `on('turn.complete', …)`, `on('fs.read', …)`, `on('fs.exists', …)`, `on('ui.open', …)`, a Bash `on('tool.call', …)` answering `{ result: { stdout, stderr: '' } }`):
  - `sdd-workspace` Bash call → `plan` has the parsed title and tasks and the workspace; the pane was opened
  - plan file read rejects → `plan` stays `null`; a later `Implement Task 1: x` spawn is recorded as role `other`
  - spawn `Implement Task 1: API client` → the prompt seen beneath ends with the step paragraph; a `Review Task 1 (spec + quality)` spawn's prompt is unchanged; the pane was opened once per spawn
  - `turn.complete` with reason `error` → run `failed`, task 1 not in `complete`
  - review `turn.complete` with the Critical/Important answer from Task 2 → `findings: 3`; the implementer's next `turn.step` → a new run with role `fix`, round `1`
  - ledger now containing `Task 1: complete` and a re-read after an agent finishes → `complete: [1]`
  - `step` call with `agentId` of a running implementer → `ok` and `stepDone`/`stepTotal`/`stepNote` set; without `agentId` → result starts with `ignored`
  - `task-start docs/plans/x.md 2` → `inline: true`, `current: 2`
  - workspace reported, then `fs.exists` false on the next re-read → every task in `complete`
- [ ] **Step 2: Run** tests — expected: FAIL.
- [ ] **Step 3: Implement** the hooks in `register.tsx`.
- [ ] **Step 4: Run** tests, validate, type-check — expected: all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat: follow superpowers plans and agents in state"`

### Task 4: The drawing module

**Files:**
- Create: `plugins/agent-crew/hooks/art.ts` (pure: no imports from `'claude-code'` at runtime, no `$`)
- Test: `plugins/agent-crew/hooks/art.test.ts`

**Interfaces:**
- Consumes: `Run`, `Plan`, `Role` types.
- Produces (`art.ts`):
  - `ROLE_STYLE: Record<Role, { costume: string; color: string; word: string }>` — words: `implementing`, `fixing`, `reviewing`, `re-reviewing`, `final review`, and for `other` the run's type is shown instead.
  - `crab(x: number, y: number, costume: string, opts: { dim?: boolean; walking?: boolean; scale?: number; accent?: string }): string` — sprites and costumes (`careful`, `heavy`, `fable`, `explore`, `other`) and `CRAB_CSS` adapted from savvy-progress (`crabBody`, `stamp`, `COSTUMES`, `CRAB_CSS`).
  - `planBarSvg(title: string, phase: { done: number; total: number; label: string; isFinished: boolean }, running: number, width: number): string` — the dithered bar with its pill (adapt savvy-progress `rowSvg`).
  - `totalsSvg(width: number, cost: number, tokens: number, ms: number): string`, `agentRowSvg(width: number, run: Run, plan: Plan | null, now: number): string` (66 px tall), `taskRowSvg(width: number, task: PlanTask, state: 'done' | 'current' | 'waiting', runs: readonly Run[], now: number): string` (30 px tall).
  - `runTitle(run: Run, plan: Plan | null): string` — `Task N · <title>`, `Whole branch` for `final`, else the label or type.
  - `runRole(run: Run): string` — the role word, plus ` · round R` when `round > 0`.
  - Terminal helpers: `bar(percent: number, cells: number): string` (`█`/`░`), `GLYPH: Record<Status | 'waiting', string>` (`●`, `✓`, `✗`, `◷`).
  - Formatting: `fmtCost`, `fmtTokens`, `fmtTime`, `modelName` (as savvy-progress), `xml` (escape).
- [ ] **Step 1: Write the failing tests:**
  - `runTitle` of an implement run for task 2 of a plan whose task 2 is `Background jobs` → `Task 2 · Background jobs`; a `final` run → `Whole branch`
  - `runRole` of a `rereview` run with round 2 → `re-reviewing · round 2`
  - `agentRowSvg(360, run, plan, now)` contains the escaped title (`Task 1 · A &amp; B`), the role colour `#378ADD`, the model `Sonnet 5.5`, and `class="c-careful run"` while running
  - a done run's row contains the ✓ path (`stroke="#3B9C5F"`); a failed one the ✗ path (`stroke="#D0453F"`)
  - `taskRowSvg` for a waiting task has no `run"` class; with two runs it draws two crabs
  - `bar(50, 10)` → `█████░░░░░`; `fmtTime(65_000)` → `1:05`; `fmtTokens(61_000)` → `61k`
- [ ] **Step 2: Run** tests — expected: FAIL.
- [ ] **Step 3: Implement** `art.ts`.
- [ ] **Step 4: Run** tests, validate, type-check — expected: all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat: crew drawing module"`

### Task 5: The panel

**Files:**
- Modify: `plugins/agent-crew/hooks/register.tsx` (a `ui.render` hook on `{ component: 'Pane', requestId: 'agent-crew' }`)
- Test: `plugins/agent-crew/hooks/pane.test.tsx`

**Interfaces:**
- Consumes: state (Task 3), `art.ts` (Task 4), `planPhase` (Task 2).
- Produces: the pane, both surfaces.
  - **Plan view** (a plan is set): header (title; `plan.path` dimmed; bar with the phase label and percent; totals: `≈$cost · tokens · time`), `Now · N` (running runs, plus `Main session · Task N` when `inline` and nothing runs), `Plan · N tasks` (✓/●/◷ per task, a crab or coloured `▣` per run of that task), `▾ Finished · N` button toggling `finishedOpen`, then the finished runs newest first.
  - **Plain view** (no plan): totals, `Running · N`, `▾ Finished · N`, rows with the plain or Explore crab.
  - Desktop (`e.surface !== 'terminal'` and `'Svg' in ui`): one `Svg` per row, width `max(240, min(900, bodyColumns × 8 − 8))`. Terminal: `Box`/`Text` rows, `wrap="truncate-end"`, colours from `ROLE_STYLE`, bars 20 cells.
- [ ] **Step 1: Write the failing tests** (mount `{ plugin: 'agent-crew', component: 'Pane', requestId: 'agent-crew' }` after driving state through Task 3's hooks):
  - terminal, plan of 3 tasks, implementer of task 2 running: texts `Now · 1`, `Task 2 · <title>`, `implementing`, `Plan · 3 tasks`, `Tasks 1/3`
  - desktop, same state: one `Svg` whose source contains `Tasks 1/3` and one containing `class="c-careful run"`
  - no plan, one Explore run finished: terminal shows `Finished · 1` and the run's label; no `Plan ·` text
  - pressing the `Finished` button (key `finished`) hides the finished rows
  - terminal at `bodyColumns: 40` renders without throwing
- [ ] **Step 2: Run** tests — expected: FAIL.
- [ ] **Step 3: Implement** the render hook.
- [ ] **Step 4: Run** tests, validate, type-check — expected: all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat: crew panel for plans and plain agents"`

### Task 6: Preview page and README

**Files:**
- Create: `scripts/preview.ts` (Bun), output `preview/index.html` (git-ignored)
- Modify: `README.md`, `.gitignore`

**Interfaces:**
- Consumes: `art.ts`, `planPhase`.
- [ ] **Step 1: Write `scripts/preview.ts`**: a sample plan (`Payments module`, five tasks, the role sequence implement → review → fix → re-review on task 2, a final review) at three moments (task 2 re-review running; task 4 implementing with steps `2/5 · reversal`; done), each drawn with `planBarSvg`, `totalsSvg`, `agentRowSvg`, `taskRowSvg` into a light/dark page with a short legend of roles and colours. Run: `bun scripts/preview.ts > preview/index.html` — expected: the file exists and contains `Tasks 1/5`.
- [ ] **Step 2: README**: what it shows, install (`/plugin marketplace add Rest95/agent-crew`, `/plugin install agent-crew@agent-crew`), `/crew`, the 144-column note, the step paragraph disclosure, credits, tests.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "docs: README and preview script"`

### Task 7: Install, publish, clean up (owner-gated where marked)

- [ ] **Step 1: Install locally:** `claude plugin marketplace add <path to this repository>` then `claude plugin install agent-crew@agent-crew`; uninstall `savvy-progress@local-mods` and `savvy-progress@claude-kit`; `claude plugin marketplace remove local-mods`. Expected: `~/.claude/settings.json` has `agent-crew@agent-crew: true` and neither savvy-progress entry.
- [ ] **Step 2: Publish:** run the plugin-authoring skill's sharing checks (secret scan of staged files), then `gh repo create Rest95/agent-crew --private --source . --remote origin --push`. Expected: `gh repo view Rest95/agent-crew --json visibility` → `PRIVATE`.
- [ ] **Step 3: Owner check:** the owner starts a new session and runs a plan; the panel opens and shows the plan. Wait for their word before step 4.
- [ ] **Step 4 (owner-gated): Remove the old setup:** `rm -rf ~/.claude/local-plugins`; after the owner runs `gh auth refresh -h github.com -s delete_repo`, `gh repo delete Rest95/claude-local-mods --yes`; remove the orphaned `~/.claude/plugins/cache/claude-kit/savvy-flow` and `.../savvy-progress` folders. Expected: `gh repo view Rest95/claude-local-mods` fails; session-band still installed.
- [ ] **Step 5: Artifact:** publish `preview/index.html` as a new artifact.
