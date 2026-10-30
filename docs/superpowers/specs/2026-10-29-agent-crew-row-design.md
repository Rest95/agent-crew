# agent-crew: the row above the prompt — design

Adds to agent-crew one row above the prompt that says, at a glance, how the
work is going and where the session stands. It replaces both session-band
(claude-kit) and the owner's status line, so everything lives in one place.

## Why

The owner wants one place to look: the overall progress of the work, the
model in use, the branch, the context, and the prompt-cache countdown with a
warning before the cache runs out. Today that is split between session-band
(above the prompt), a custom status line (below it: model, context bar,
branch) and the Agents panel. Two bands plus a status line is what they
called "everything condensed at the bottom".

Success: during a plan, one glance at the row answers "how far along, which
model, which branch, how full is the context, how long until the cache goes
cold", and a notification arrives before the cache expires.

## What the row shows

Left to right, on one line:

1. **Total progress** (left, when there is something to show):
   - **A plan is running** (agent-crew's plan view is set and not `Done`, or
     one of its agents still runs): the plan's title, the dithered progress
     bar with its pill (`Tasks 3/5`, `Review 5/5`) and percent, the same
     drawing the panel's header uses, then `N working` when agents are
     running. A finished plan shows `Done` until something else runs.
   - **No plan running, but subagents are running**: `N working · M done`,
     counting the runs started since the last plan finished (all of the
     session's runs when there was no plan).
   - **Nothing running and no plan**: the progress part is absent.
2. **Model and effort**: the main session's model, as the panel names
   models, and its effort level (`Opus 5.5 · high`): the level the settings
   give that model until the first request, then each request's own (added
   at the owner's request).
3. **Branch**: the git branch of the session's working directory, with a
   branch mark (`⎇ feat/payments`). Absent outside a git repository or on a
   detached HEAD (owner's status line showed nothing there either).
4. **Context**: how full the main session's context is, as a small bar and
   a percent. The bar is green below 65%, amber from 65%, red from 85%.
5. **Cache countdown**: an hourglass and `mm:ss` left before the prompt
   cache expires, counted from Claude's last answer in the main session
   with a 1-hour cache; `…` while a main turn runs; `expired` at zero; `—`
   before the session's first answer (nothing is cached yet, and a session
   resumed in a new process starts here too).
   - The row always has a rounded frame: white at rest (the owner's
     choice), amber at 20 minutes left, red at 10. While a turn runs it
     stays white.
   - **Notification** at 10 and at 5 minutes left, once each per answer,
     never while a turn runs, sent through Claude Code's own notification
     (which also reaches the owner's phone over Remote Control), titled with
     the project folder's name in the message, as session-band did:
     `<project>: Prompt cache expires in N min`. Where it is not delivered
     (Claude Code skips it while the owner is at the session), a toast says
     it instead.

Drawn on both surfaces, as in the approved mockup (the preview artifact's
"The row above the prompt" section):

- **Terminal**: text with coloured glyphs: `●`, the bar in `█`/`░`, the
  pill as bold text, `⎇`, a context bar of `█`/`░`, `⧗`. The frame is a
  rounded border, white or in the warning colour.
- **Desktop app**: the plan bar as the same SVG the panel draws; the model
  as text; small ring icons for branch, context (ring filling with the
  context, plus an 80-px bar) and cache (hourglass), as session-band drew
  them.

**Narrow windows** (0.5.1: in the terminal the row measures its real content and drops whole pieces in order: the working count, the branch, a shorter plan name, the context bar, the progress bar; the desktop keeps fixed widths): the row never wraps (the frame and its padding count
against the width). As it narrows it drops, in order:
the branch, the context bar (the percent stays), the progress bar (the pill
text stays), the `N working` count; `N working · M done` shortens to
`N working`.

## How it knows

- **Progress**: agent-crew's own state (plan, runs); nothing new to track.
- **Model**: the model of the main session's latest model request
  (`turn.step` with no agent id); before the first request, the session's
  own model as `/model` shows it (never a settings alias like `opus[1m]`).
  A reload keeps the model already learned.
- **Branch**: `git -C <cwd> branch --show-current`, read beside the session
  start (never holding it up), after each Bash call in the main session, and
  once a minute otherwise; an error or empty output means no branch shown.
- **Context**: the main session's context fill, as session-band read it
  (`$.session.usage()`'s context percent), refreshed after each main
  request and each answer.
- **Cache**: the cache is warm for 60 minutes from the main session's latest
  request that was served (a `turn.step` with usage). A main `turn.complete`
  clears the busy flag and sets the expiry from that request, so a turn that
  ends in an error or an interrupt without a new request does not restart
  the clock; a main `turn.start` sets busy. `/clear` (a `session.end` with
  reason `clear`) forgets the countdown and the context. A 1-second
  clock counts down while not busy, writes the seconds left so the row
  redraws every second, and fires the notifications. The expiry,
  the busy flag, which thresholds already fired and the `/crew row` choice
  live in `$.state`, which survives a reload of the mod, so a reload never
  fires a notification twice.
- **Frame**: the row's `Box` takes a rounded border in the warning colour,
  as session-band's did, on both surfaces.

## Non-goals

- No costs, turn number or output speed in the row (the Agents panel keeps
  cost).
- No macOS helper app for notifications (session-band's `Session Band.app`).
- No changes to the panel, to models, or to agents' instructions.

## Anti-goals

- The row must never delay a turn, a tool call or an agent: everything it
  reads happens beside the work, never in its path.
- Never a notification while a turn runs, and never twice for the same
  threshold after one answer.
- Never a wrong branch: unsure means no branch.

## Constraints

- Same mod (agent-crew, version 0.2.0), same repository, same tests and
  checks as before; the drawing goes in `art.ts` so the preview can show it.
- It draws through the `AbovePrompt` component. Other mods' bands, if any
  are installed later, are drawn beneath it.

## Delivery

- Installing 0.2.0 uninstalls `session-band@claude-kit` at the same time, so
  the two never draw rows and send notifications side by side (our call;
  reinstalling it is one command).
- The owner's check compares the row's context percent with the old status
  line's before that line goes (both read Claude Code's own figure, but the
  check confirms it).
- After the owner's check: remove the `statusLine` entry from
  `~/.claude/settings.json` (the script file `~/.claude/statusline-command.sh`
  stays, so it can be switched back on), and remove the claude-kit
  marketplace if nothing else uses it.
- The preview artifact shows the real row in place of the mockup.

## Calls made for the owner (not discussed)

- `/crew row` hides or shows the row for the session (our call; the row
  has no ✕ of its own).
- The cache countdown assumes the 1-hour cache, as session-band did.
- A finished plan shows `Done` in the row until something else runs; ad-hoc
  agents after it are counted from that point.
- `—` before the first answer; no seeding from another mod's cache state.
- session-band is uninstalled when 0.2.0 is installed, not after the check.

## Left to the builder

State shape, how the row measures its width, the exact density thresholds,
and test cases, within the above.

**Colours** (0.5.2): terminal text and frames paint with Claude Code's theme keys (`THEME` in `art.ts`) so they read on light themes; the frame at rest is the theme's text colour. Role and agent-type colours stay as they are, and the SVG drawings keep their hex values.
