# agent-crew — design

A Claude Code mod: an Agents side panel that follows a superpowers plan as it
runs and shows every subagent, drawn in the pixel-crab style of claude-kit's
savvy-progress. Written from scratch; the visual idea is borrowed, the code
and behaviour are ours.

## Why

The owner plans with superpowers (brainstorming → writing-plans) and then
executes either in subagent mode (`superpowers:subagent-driven-development`)
or inline (`superpowers:executing-plans`). While it runs, nothing on screen
says which plan task is being worked on or whether an agent is implementing
or reviewing. savvy-progress has the look they like, but it only lights up for
its own `/savvy-flow` command, and they do not want another command to run.

Success: start a plan the usual way and, with no extra step, a side panel shows
the plan, its progress, and each agent's task and role, in the savvy-flow
style.

## Goals

- **Opens by itself.** The panel opens when a superpowers plan starts running,
  and whenever any subagent starts (also after the person closed it). No
  command is needed; `/crew` toggles it by hand.
- **Plan view** while a plan runs:
  - header: the plan's title, its file path, a progress bar of tasks complete
    out of total (dithered, savvy-style, with a pill such as `Tasks 2/5`, then
    `Review 5/5` during the final branch review, then `Done`), and totals
    tiles: estimated cost, tokens, elapsed time;
  - **Now**: the agents running, each as a full row (see Agent rows);
  - **Plan**: every task in plan order, numbered, with a status mark (✓
    complete, ● current, ◷ waiting) and one small crab per agent that has
    worked on that task, in its role's costume and colour;
  - **Finished** (collapsible): past agents of this plan, newest first.
- **Agent rows** show: title `Task N · <task name>` (or `Whole branch` for the
  final review); the role in its colour, the fix round when there is one, and
  the model (`reviewing · Sonnet 5.5`); findings count when a review returned
  findings; a progress bar (context fill, grey); context %, tokens, estimated
  cost, elapsed time; a status mark (running ●, done ✓, failed ✗). A running
  crab walks and animates its prop.
- **Roles** come from the labels superpowers gives each agent (the Agent
  tool's `description`), in superpowers 7.0.0:

  | Label | Role | Costume | Colour |
  | --- | --- | --- | --- |
  | `Implement Task N: <name>` | implementing | engineer (hard hat, wrench) | blue `#378ADD` |
  | the task's implementer resumed, or a second `Implement Task N:` for the same task | fixing, round R | engineer | orange-red `#D85A30` |
  | `Review Task N (spec + quality)` | reviewing | detective (deerstalker, magnifier) | amber `#BA7517` |
  | `Re-review Task N fix round R` | re-reviewing, round R | detective | orange-red `#D85A30` |
  | `Review code changes` (after the tasks) | final review | astronaut (glass dome) | violet `#7F77DD` |
  | anything else | its agent type | plain crab (`Explore` keeps its pirate hat) | by type: Explore `#1D9E75`, general-purpose `#C2557A`, Plan `#2E9DB3`, others one of `#1D9E75 #C2557A #2E9DB3 #9A62C9 #7E9A2E` by name (0.2.4, at the owner's request) |

  The match is on the label's leading words, case-insensitive. A label that
  names a task number outside the plan, or arrives with no plan running,
  becomes a plain row: the panel never invents a task.
- **Inline mode** has no subagents: the plan view still shows, the current
  task marked ● from superpowers' `task-start` script and ✓ from `task-done`;
  the Now section shows the main session working on it (a row with no agent
  stats beyond elapsed time).
- **Grouped by task** (0.2.7, at the owner's request): under the header, a
  line, then one list of tasks; each task holds its agents (one line each,
  two while running) and opens or closes on a press, the current task open
  by default; the final review (`Whole branch`) and agents outside the plan
  (`Other agents`) have groups of their own. The plain view is unchanged.
  A session start clears the person's open/closed choices, and a new agent
  on a task (or the final review) opens its group again (0.2.10).
- **Agent names and the list under the prompt** (0.2.11): each agent under a
  task shows its own label on a line of its own, then role, model, status,
  time, cost and findings. A reviewer's findings are the top-level items of
  its Critical and Important sections, not the bullets under them. The
  plugin's `settings.json` sets a `subagentStatusLine` that blanks Claude
  Code's agent rows under the prompt (checked by hand: click-to-view still
  works with them hidden).
- **Any task label** (0.2.9): an agent labelled with one of the plan's task
  numbers (`Finish Task 2: …`) counts toward that task as its implementer
  unless it is a review; a second implementer is a fix round only once a
  review of the task found something.
- **Scripts by name** (0.2.8): a superpowers script is recognised by its
  name however its folder is spelled (`$S/task-brief`, `"${SKILL}/task-start"`),
  and an agent labelled like a plan's task, with no plan showing, makes the
  mod pick up the plan in progress from its workspace marker.
- **Finding the ledger** (0.2.7): when a script's output was captured, the
  workspace is found by its `plan-path` marker under
  `<repo-root>/.superpowers/sdd/`; the ledger is also re-read at session
  start, on `/crew`, and every 10 seconds while a plan is open; `/crew` with
  no plan showing loads the workspace whose ledger changed last.
- **At rest** (0.2.5, at the owner's request): the panel sits on the
  terminal's own background (opened with `backgroundColor: "transparent"`,
  not Claude Code's grey fill); the plan's title and bar are violet; waiting
  tasks are normal text with a violet ◷ and number.
- **Click to view** (added in 0.2.3 at the owner's request): pressing an
  agent's row puts its transcript in the main view (`$.ui.view`), as picking
  it in Claude Code's own agent list does; pressing the row of the agent in
  view, or `← Back to main`, returns. The row in view says `◀ viewing`. An
  agent Claude Code no longer lists cannot be shown; a toast says so. Claude
  Code's own agent list under the prompt stays: a mod cannot hide it, and the
  view needs it to hold the agent's row.
- **Plain list** when no plan is running: Running / Finished sections of
  every subagent of the session, as rows with the plain or Explore crab.
- **Surfaces:** the terminal (fullscreen layout, text rows with coloured
  glyphs, as in the preview) and the desktop app (one SVG per row, as in the
  preview). Both light and dark.

## How it knows (superpowers 7.0.0)

Where superpowers' own scripts differ from this section, the scripts win.

- **Plan start and plan file:** a Bash call running
  `subagent-driven-development/scripts/sdd-workspace <PLAN>`,
  `.../task-brief <PLAN> <N>`, `executing-plans/scripts/task-start <PLAN> <N>`
  or `.../task-done <PLAN> <N> ...`, or `.../review-package <PLAN> ...`. The first one
  seen for a plan path starts that plan's view and opens the pane once. A plan
  word that is not a plain `.md` path (a `$VAR`, a `$(...)` fragment) is ignored,
  and only an output line shaped like `<root>/.superpowers/sdd/<plan>` counts as
  the workspace.
- **Workspace:** `<repo-root>/.superpowers/sdd/<plan-name>/`, shared by both
  modes. `sdd-workspace` prints it; `task-brief` and `task-start` print the
  brief's path inside it (`brief: <path>` for `task-start`), so its directory
  is the workspace in inline mode too.
- **Tasks:** read from the plan file: `### Task N: <name>` headings (any
  heading level, outside fenced code blocks, as superpowers' own `task-brief`
  matches them). Title: the file's first `# ` heading, without a trailing
  "Implementation Plan"; else the file name.
- **Task complete:** a line `Task N: complete` in `<workspace>/progress.md`
  (the ledger both modes write; it survives compaction). Inline `task-done`
  appends that line only when the task's tests pass, so no exit code is
  needed. The ledger is re-read after each Bash call of the plan's scripts,
  after each agent of the plan finishes, and right before an agent is
  classified (superpowers ledgers a task just before starting the next agent).
  A header that quotes the plan path in backticks or quotes still matches.
- **Agent start, finish and stats:** `agent.spawn` gives the label, type and
  model; each model request of the agent (`turn.step` with its agent id)
  gives tokens and context; `turn.complete` with its agent id ends it, reason
  `answer` = done (✓), any other = failed (✗). A resumed agent's next request
  sets it running again. Cost is estimated from token counts with a list-price
  table per model, as savvy-progress does.
- **Fix rounds:** superpowers resumes the task's implementer for rounds 1-3
  (`agent.spawn` with `resume`: the first row stays, a new `fixing` row is
  added, and the resuming message is never changed) and starts a fresh
  `Implement Task N:` for rounds 4-5. Either way the row reads `fixing · round
  R`, R = the number of that task's finished reviews that returned findings,
  and at least the round after the latest re-review that found something (our
  call). Findings are Critical and Important items of a task review, or NOT
  ADDRESSED verdicts plus Critical or Important new breakage of a re-review;
  an item that only says `None` is not one.
- **Final review:** `Review code changes` counts as the final review only once
  every task is complete; earlier it is a plain row (our call). Inline mode
  may run one too, by the same rule.
- **Current task:** the highest-numbered task with activity (an agent, a
  `task-brief`/`task-start`) that is not complete.
- **Plan end:** all tasks complete and no final review running (if one runs,
  once it finishes), or the workspace removed. The view then shows `Done`
  until another plan starts or the session ends.
- **One plan at a time** (our call): a plan is identified by its workspace
  directory; scripts for a different plan replace the view.
- Paths: when the workspace is known, the plan is read from its repository
  root first (superpowers may run in a git worktree), then against the
  session's working directory.

## Step reporting

The owner wants step counters on implementer rows (`3/6 · retries`).

- The mod registers a tool for agents, `step` (`done`, `total`, a few-word
  `note`), listed up front (not behind tool search) so agents use it.
- When an agent labelled `Implement Task N:` starts, the mod appends one short
  paragraph to its instructions: report your plan in 3-8 steps with `step`
  (`total`, `done: 0`), then again as each step finishes. Nothing else in the
  instructions changes, and no other agent gets the paragraph.
- A resumed implementer (fix rounds 1-3) keeps reporting into its same row; a
  fix round starts its counter again when it reports a new `total`.
- A `step` call from the main session, or from an agent without a row, is
  ignored. Rows without reports show context fill in grey.

## Non-goals

- No command to start anything; no savvy-flow support; no band above the
  prompt (session-band, from claude-kit, keeps that space).
- Never changes which model an agent runs on; it only shows it.
- No notifications or sounds.
- No support for other plan formats or older superpowers labels; a mismatch
  degrades to plain rows.

## Anti-goals

- The panel must never block, delay or fail an agent or a tool call: every
  hook passes the call through first and draws after; a parsing error drops to
  the plain list.
- Never shows a wrong task: unsure means a plain row.
- Does not change agents' prompts, except the one step-reporting paragraph
  described under Step reporting, if the owner keeps it.

## Constraints

- Built as a Claude Code mod (hooks module + `ui.render` pane), the API of
  the installed build; tests with `claude plugin test`, validation with
  `claude plugin validate`, type-check with `tsc`.
- A pane opened unasked docks only from 144 terminal columns (110 once
  asked); below that it waits, as the engine decides. The side is the
  engine's (right, in the terminal).
- Costs are estimates from token counts and list prices, stated as such.
- The crab sprites and costumes are adapted from claude-kit's savvy-progress
  (MIT, © johnnyvizz); the README and LICENSE credit it.

## Delivery

- Its own repository, `agent-crew` (mod folder plus a marketplace manifest,
  marketplace name `agent-crew`), locally at
  `~/Documents/Projetos/agent-crew`, pushed to a new private GitHub repo, `Rest95/agent-crew`.
- Installed as `agent-crew@agent-crew`. Then the savvy-progress fork is
  uninstalled with its `local-mods` marketplace, `~/.claude/local-plugins` is
  removed, the private GitHub repo `Rest95/claude-local-mods` is deleted, and
  the disabled `savvy-progress@claude-kit` is uninstalled. session-band and
  the claude-kit marketplace stay.
- The cleanup runs last, after the mod is installed and checked. Deleting a
  GitHub repo needs the `delete_repo` permission, which the current `gh` login
  lacks: the owner runs `gh auth refresh -h github.com -s delete_repo` once.
- A new artifact shows the finished mod: a static page built from the mod's
  own drawing functions with a sample plan, so the drawing code lives in a
  module with no engine calls (our call).

## Left to the builder

Module layout, state shape, how rows are measured and drawn per surface, how
the ledger is re-read, test cases, and the exact parsing code, all within the
above.
