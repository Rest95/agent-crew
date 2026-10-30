# agent-crew Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One row above the prompt, drawn by agent-crew, showing total progress, the main model, the branch, the context and the prompt-cache countdown (with notifications), replacing session-band and the status line.

**Architecture:** Pure decisions (which progress to show, the cache text and warning level, the density tier, context colour, branch parsing) go in `model.ts`; desktop icons in `art.ts`; `register.tsx` gains a `main` state value fed by main-session events, a 1-second tick, and a `ui.render` hook on `AbovePrompt`. Atoms stay declared in `register.tsx` (the engine's scan needs them in the file that uses them).

**Tech Stack:** Claude Code mod API (build 2.1.312), TypeScript, Bun (preview only).

**Spec:** `docs/superpowers/specs/2026-10-29-agent-crew-row-design.md` (and the first design, `2026-10-29-agent-crew-design.md`, for the panel it builds on).

## Global Constraints

- Plugin `agent-crew`, version `0.2.0` (manifest and marketplace entry).
- Colours: plan bar accent `#8f8cf4`, finished `#5fbf8f`; cache `#4fb3a9`; warn `#e2a94e`; alert `#e0846b`; context bar green `#4caf6e` below 65%, warn from 65%, alert from 85%; context ring `#5fa8d3`.
- Cache: expiry = main `turn.complete` time + 3,600,000 ms; frame warn at ≤ 1,200 s left, alert at ≤ 600 s; no frame while a main turn runs; text `—` before the first answer, `…` while busy, `expired` at 0, else `mm:ss`.
- Notifications at 10 and 5 minutes left, once each per answer, never while busy: `$.tool.call({ tool: 'PushNotification', message: '<project>: Prompt cache expires in N min', status: 'proactive' })`, `<project>` = last segment of `$.session.cwd()`, N = `ceil(secondsLeft / 60)`; when the result is denied, errored, or has neither `pushSent` nor `localSent` true, `$.ui.toast('⏳ ' + message, { timeoutMs: 30000 })`.
- Branch: `git -C <cwd> branch --show-current` via `$.process.run`; non-zero exit or empty output → no branch.
- Row text pieces: `N working`, `N working · M done`, `⎇ <branch>`, `ctx`, `⧗`.
- `/crew row` toggles the row (`Crew row hidden.` / `Crew row shown.`); `/crew` alone still toggles the panel.
- Every hook passes through `next(e)` first and keeps its own work in try/catch, as the existing hooks do.
- Checks for every code task: `claude plugin test plugins/agent-crew`, `claude plugin validate plugins/agent-crew`, and the type-check from the first plan's Task 1 step 6.

## Review Focus

- A subagent's `turn.start` / `turn.complete` / `turn.step` must never move the main session's cache, busy flag, model or context. Test in Task 3.
- Two answers in a row: the 10-minute notification fires again after the second answer, not only once per session. Test in Task 3.
- A mod reload mid-countdown: thresholds already fired live in state, so nothing fires twice. Test in Task 3 (seeded `state.get`).
- Not in a git repository: no branch piece, no error text. Test in Task 3.
- A very narrow row (40 columns): no wrap, the cache and context percent still shown. Test in Task 4.

---

### Task 1: Row decisions

**Files:**
- Modify: `plugins/agent-crew/hooks/model.ts`, `plugins/agent-crew/types/index.d.ts`
- Test: `plugins/agent-crew/hooks/model.test.ts`

**Interfaces:**
- Produces (`types/index.d.ts`): `export type Main = { model: string | null; branch: string | null; context: number | null; busy: boolean; expiresAt: number | null; warned: number; rowHidden: boolean; planDoneAt: number | null }`, and `main: Main` added to `PluginState['agent-crew']`. `warned` = the smallest threshold (10 or 5) already announced since the last answer, `0` for none. `planDoneAt` = when the plan view first became `Done`.
- Produces (`model.ts`):
  - `type RowProgress = { kind: 'plan'; working: number } | { kind: 'agents'; working: number; done: number } | { kind: 'none' }`
  - `rowProgress(plan: Plan | null, runs: readonly Run[], planDoneAt: number | null): RowProgress` — `plan` while a plan is set and not finished (`planPhase(...).isFinished` false) or one of its runs is running, and also when finished and no run started after `planDoneAt`; otherwise `agents` when any run is running (counting runs started after `planDoneAt`, or all runs when it is null); else `none`.
  - `cacheView(main: Main, now: number): { text: string; level: 'warn' | 'alert' | null; secondsLeft: number | null }` (Global Constraints values).
  - `dueWarning(main: Main, now: number): 10 | 5 | null` — the threshold to announce now: not busy, `0 < secondsLeft ≤ 600` and `warned` is 0 or above 10 → 10; `≤ 300` and `warned` not 5 → 5; else null.
  - `contextLevel(percent: number): 'ok' | 'warn' | 'alert'` (65 / 85).
  - `rowTier(columns: number): 0 | 1 | 2 | 3` — 0 everything (≥ 110), 1 no branch (≥ 90), 2 also no context bar (≥ 70), 3 also no progress bar nor `working` count.
  - `parseBranch(exitCode: number, stdout: string): string | null`.
- [ ] **Step 1: Write the failing tests:** `rowProgress` for: unfinished plan → `{ kind: 'plan', working: 1 }` with one running run; finished plan, no later runs → `plan`; finished plan, two runs started after `planDoneAt` (one running) → `{ kind: 'agents', working: 1, done: 1 }`; no plan, no running run → `none`. `cacheView`: expiresAt null → `—`; busy → `…`, level null even at 300 s left; 900 s left → `15:00`, `warn`; 480 s → `08:00`, `alert`; past expiry → `expired`. `dueWarning`: 590 s, warned 0 → 10; 290 s, warned 10 → 5; 290 s, warned 5 → null; busy → null. `contextLevel(64)` → `ok`, `65` → `warn`, `85` → `alert`. `rowTier(120)` → 0, `95` → 1, `75` → 2, `40` → 3. `parseBranch(0, 'feat/x\n')` → `feat/x`; `(0, '')` → null; `(128, 'fatal')` → null.
- [ ] **Step 2: Run** tests — expected: FAIL (exports missing).
- [ ] **Step 3: Implement** the functions and the type.
- [ ] **Step 4: Run** tests, validate, type-check — expected: all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat: row decisions"`

### Task 2: Row icons

**Files:**
- Modify: `plugins/agent-crew/hooks/art.ts`
- Test: `plugins/agent-crew/hooks/art.test.ts`

**Interfaces:**
- Produces (`art.ts`): `CACHE_COLOR`, `WARN_COLOR`, `ALERT_COLOR`, `OK_COLOR`, `CONTEXT_COLOR` (Global Constraints values); `branchIconSvg(): string`, `contextRingSvg(percent: number): string`, `contextBarSvg(percent: number): string` (80×6, colour by `contextLevel`), `hourglassSvg(color: string): string` — 24×24 viewBox rings drawn like session-band's (`ring`, `contextIcon`, `cacheIcon`, `contextBar` in claude-kit's session-band `hooks/register.tsx`).
- [ ] **Step 1: Write the failing tests:** `contextBarSvg(90)` contains `#e0846b` and `width="72"`; `contextBarSvg(30)` contains `#4caf6e`; `contextRingSvg(50)` contains `stroke-dasharray="31.4 62.8"`; `hourglassSvg('#e2a94e')` contains `#e2a94e`.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.** `art.ts` may import `contextLevel` from `./model` (pure).
- [ ] **Step 4: Run** tests, validate, type-check, and `bun -e "await import('./plugins/agent-crew/hooks/art.ts')"` — expected: all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat: row icons"`

### Task 3: Main-session tracking and the cache warning

**Files:**
- Modify: `plugins/agent-crew/hooks/register.tsx`, `plugins/agent-crew/hooks/fixtures.ts`
- Test: `plugins/agent-crew/hooks/row.test.ts`

**Interfaces:**
- Consumes: Task 1's `Main`, `dueWarning`, `parseBranch`, `rowProgress`.
- Produces: `mainAtom = atom({ plugin: 'agent-crew', key: 'main' } as const, { model: null, branch: null, context: null, busy: false, expiresAt: null, warned: 0, rowHidden: false, planDoneAt: null })` in `register.tsx`, kept current by:
  - `session.start`: model from `$.settings.read()`'s `model` when a string; branch read.
  - `turn.start` without `agentId`: `busy: true`.
  - `turn.step` without `agentId`: after `next`, `model` from `usage.model` (else `e.model`) through `modelName`'s input, and `context` from `$.session.usage()`'s `context.percent`.
  - `turn.complete` without `agentId`: after `next`, `busy: false`, `expiresAt: now + 3_600_000`, `warned: 0`, context refreshed.
  - `tool.call` on `Bash` without `agentId`: branch re-read (the existing Bash hook gains this).
  - the 1-second tick: when `dueWarning` gives a threshold, set `warned` to it, then notify (Global Constraints); every 60 ticks, re-read the branch; `planDoneAt` set the first tick `planPhase` is finished (cleared when a new plan starts).
  - `command.run` `crew` with args `row`: toggle `rowHidden`.
- [ ] **Step 1: Extend `fixtures.ts`**: `world()` answers `session.start` (`{ cwd: '/repo/payments' }`), `session.cwd` (`'/repo/payments'`), `command.register`, `tool.register`, `settings.read` (`{ model: 'claude-opus-5-5' }`), `session.usage` (`{ context: { window: 1e6, percent: w.context } }`), `process.run` (`{ exitCode: w.branch ? 0 : 128, stdout: w.branch ? w.branch + '\n' : '', stderr: '' }`), `tool.call` for `PushNotification` (records the message, answers `{ result: { pushSent: w.pushes } }`), and `ui.toast` (records the text); new `World` fields `context: number`, `branch: string | null`, `pushes: boolean`, `notified: string[]`, `toasts: string[]`; helper `start($)` raising `session.start`; helper `mainTurn($, kind: 'start' | 'complete')`.
- [ ] **Step 2: Write the failing tests** in `row.test.ts`:
  - session start → `main.model` `claude-opus-5-5`, `main.branch` `feat/payments` (with `w.branch = 'feat/payments'`)
  - not a git repository (`w.branch = null`) → `main.branch` null
  - main turn start → `busy`; main turn complete at `t` → `busy` false, `expiresAt` `t + 3_600_000`, `context` from `w.context`
  - a subagent's turn start/complete (with `agentId`) leaves `busy`, `expiresAt` and `context` unchanged
  - advance the clock to 591 s left → one notification `payments: Prompt cache expires in 10 min`; to 291 s → a second, `… in 5 min`; further ticks add none
  - a second answer then 591 s left → the 10-minute notification fires again
  - `w.pushes = false` → a toast (`ui.toast` recorded) instead
  - busy at 300 s left → no notification
  - reload: seed `state.get` for `main` with `warned: 10` and 590 s left → no 10-minute notification
  - `/crew row` → `rowHidden: true`, answer `Crew row hidden.`; again → `false`, `Crew row shown.`
- [ ] **Step 3: Run** — expected: FAIL.
- [ ] **Step 4: Implement** the hooks in `register.tsx`.
- [ ] **Step 5: Run** the whole suite, validate, type-check — expected: all pass.
- [ ] **Step 6: Commit** — `git commit -am "feat: follow the main session for the row and warn before the cache expires"`

### Task 4: The row

**Files:**
- Modify: `plugins/agent-crew/hooks/register.tsx` (a `ui.render` hook on `{ component: 'AbovePrompt' }`)
- Test: `plugins/agent-crew/hooks/row.test.ts`

**Interfaces:**
- Consumes: state (Task 3 and the panel's), `rowProgress`, `cacheView`, `rowTier`, `contextLevel`, `planPhase`, `planBarSvg`, the Task 2 icons, `modelName`.
- Produces: the row. When `e.props.hasSurvey` or `main.rowHidden`, return `next(e)`. Otherwise one `Box` row (`flexDirection="row"`, `flexWrap="nowrap"`, `overflow="hidden"`, `paddingX={1}`, `columnGap` 2), with `borderStyle="round"` and `borderColor` = warn/alert colour when `cacheView` has a level; then whatever the mods beneath draw (`next(e)`, unless it is the engine's placeholder `{ type: 'engine' }`), as savvy-progress's band nested it. Pieces in order: progress (plan: terminal `●` title, `bar(percent, 16)`, bold pill text, dim percent, dim `· N working`; desktop: `planBarSvg(title, phase, working, 330)` then `N working`; agents: `● N working · M done`), a spacer, model (`modelName`), `⎇ branch` (desktop: branch icon), context (terminal `ctx` + `bar(percent, 8)` in its level colour + bold percent; desktop: ring + bar + percent), cache (`⧗` / hourglass in cache or level colour + bold text). `rowTier(e.props.bodyColumns)` drops pieces as Task 1 says; a missing model, branch or context drops that piece.
- [ ] **Step 1: Write the failing tests** (mount `{ plugin: 'agent-crew', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} } }`):
  - terminal, plan of 3 with task 1 complete and task 2's implementer running, branch `feat/payments`, context 34, one answer given: texts `Tasks 1/3`, `1 working`, `Opus 5.5`, `feat/payments`, `34%`, a `mm:ss` cache text
  - desktop, same: an `Svg` whose source contains `Tasks 1/3`, and one containing the hourglass in `#4fb3a9`
  - no plan, one Explore agent running and one finished: text `1 working · 1 done`
  - 480 s left, not busy: the row's `Box` has `borderColor` `#e0846b`
  - `bodyColumns: 40`: no `feat/payments` text, `34%` and the cache text still present, no `Tasks` bar glyphs
  - `rowHidden: true`: the mount shows only what is beneath (a test `ui.render` stand-in drawing `<Text>beneath</Text>`)
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement** the render hook.
- [ ] **Step 4: Run** the whole suite, validate, type-check — expected: all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat: the row above the prompt"`

### Task 5: Preview, version, README

**Files:**
- Modify: `scripts/preview.ts`, `scripts/preview-page.html`, `README.md`, `.claude-plugin/marketplace.json`, `plugins/agent-crew/.claude-plugin/plugin.json`
- [ ] **Step 1:** version `0.2.0` in both manifests.
- [ ] **Step 2:** the preview draws the row's desktop pieces with `planBarSvg` and the Task 2 icons and its terminal text with `bar`, for each moment, under the panel, with the cache pickers of the mockup (fresh, 15 min, 8 min) and the notification card at 8 min; the mockup's "Proposed" label goes. Run `bun scripts/preview.ts > preview/index.html` — expected: the file contains `Tasks 1/5` and `feat/payments`.
- [ ] **Step 3:** README: a "The row above the prompt" section (pieces, warnings, notification, `/crew row`) and the install note that session-band is no longer needed.
- [ ] **Step 4: Commit** — `git commit -am "docs: the row in the preview and README; 0.2.0"`

### Task 6: Install, check, clean up (owner-gated where marked)

- [ ] **Step 1:** merge to `main`, push to `Rest95/agent-crew` (scan with the plugin-authoring secret scan first; sample names stay neutral), `claude plugin marketplace update agent-crew`, `claude plugin update agent-crew@agent-crew`; `claude plugin uninstall session-band@claude-kit`. Expected: settings list `agent-crew@agent-crew: true`, no `session-band`.
- [ ] **Step 2:** republish the preview artifact `https://claude.ai/artifact/MAGtMgKW5xiWenqtp1sCJU` from `preview/index.html`.
- [ ] **Step 3 (owner):** in a new session at ≥ 144 columns the owner runs a plan and checks the panel and the row, comparing the row's context percent with the status line's. Wait for their word.
- [ ] **Step 4 (owner-gated):** remove `statusLine` from `~/.claude/settings.json` (keep `~/.claude/statusline-command.sh`); `claude plugin marketplace remove claude-kit` if no installed plugin comes from it; together with the first plan's open steps: `rm -rf ~/.claude/local-plugins`, `gh repo delete Rest95/claude-local-mods --yes` (after the owner's `gh auth refresh -h github.com -s delete_repo`), and the leftover `~/.claude/plugins/cache/claude-kit/savvy-flow` and `.../savvy-progress` folders.
