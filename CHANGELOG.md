# Changelog

What changed in each version of agent-crew, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

The history was squashed when the repository went public, so versions before 0.3.0 have no commits of their own here.

## [0.5.3] - 2026-10-30

Fixes from the first run in the real desktop app.

### Fixed

- The desktop panel's heading sits on its own line, whole. Beside the bar it was cut, and the progress pill ran into the percentage.
- The desktop divider is drawn, so it no longer wraps into two lines.
- A narrow desktop agent row gives up its token count before its steps, so `2 steps` stays whole.
- The row measures its content on the desktop too, so it keeps the effort and the done count when there's room.

## [0.5.2] - 2026-10-30

### Fixed

- Terminal text and frames are readable on light themes. The action line, plan title, bars and cache countdown were faint, and the row's frame was invisible.

### Changed

- Terminal colours now follow your Claude Code theme, so the title and bars may look different from before. Role and agent-type colours are unchanged.
- The row's frame at rest uses your theme's text colour: white on dark, black on light.

## [0.5.1] - 2026-10-30

### Fixed

- The row no longer cuts pieces mid-word. It measures what it's showing and drops whole pieces when it's tight: the working count, the branch, a shorter plan name, the context bar, the progress bar, then the plan name.

## [0.5.0] - 2026-10-30

### Added

- `open_panel` option: turn off the panel opening by itself, and open it with `/crew` instead.
- `hide_agent_list` option: keep Claude Code's own agent list under the prompt.
- An icon, and repository links and keywords in the plugin's details.

### Changed

- The `step` tool joins a session only when the first superpowers implementer starts, so other sessions never carry it.
- Descriptions now cover everyday use, not only superpowers plans.

## [0.4.0] - 2026-10-30

agent-crew now works without superpowers.

### Added

- A live line for each agent showing what it's doing, such as `✎ Editing lib/csv.ts`.
- Each agent's progress: its own checklist when it keeps one, otherwise the steps it has taken.
- Claude's task list as the plan: your prompt as the heading, a `Tasks 1/4` bar, and each agent under its task.
- A view for sessions with no task list, with a bar of agents finished and finished agents folded to one line.
- A bar beside the agent count in the row.

### Changed

- A finished superpowers plan gives way to a task list still at work.
- Finished agents are one line on the desktop.

### Fixed

- Corrected agent placement and tracking found in review, including when several tool calls arrive together.
- Denied calls no longer count as steps, and a fix round starts with a clean slate.

## [0.3.0] - 2026-10-30

### Changed

- Renamed from willbe-crew to agent-crew. If you installed the old name, remove it and install this one.
- The repository is public.

## [0.2.11] - 2026-10-29

### Added

- Each agent under a task shows its own name.

### Changed

- Claude Code's own agent list under the prompt is hidden, since the panel shows the same agents.

### Fixed

- A review's findings count only its issues, not the bullets under them.
- The status mark no longer runs into the effort.

## [0.2.10] - 2026-10-29

### Fixed

- A task you closed opens again when a new agent starts on it, and every task returns to its default at session start.

## [0.2.9] - 2026-10-29

### Fixed

- Any agent named after one of the plan's tasks counts toward that task, such as `Finish Task 2: …`.
- The row no longer wraps onto two lines.

## [0.2.8] - 2026-10-29

### Fixed

- Plans are detected when superpowers' scripts are reached through a shell variable.

## [0.2.7] - 2026-10-29

### Added

- The plan view is grouped by task, and each task opens and closes on a click.

### Fixed

- Tasks already done are read correctly when `/crew` opens on a plan in progress.

## [0.2.6] - 2026-10-29

### Fixed

- The current task stays current after an earlier task's reviewer runs.

## [0.2.5] - 2026-10-29

### Changed

- The panel has a transparent background and reads in colour at rest.

## [0.2.4] - 2026-10-29

### Added

- Agents outside a plan get a colour by type.

## [0.2.3] - 2026-10-29

### Added

- Click an agent in the panel to see its transcript in the main view.

## [0.2.2] - 2026-10-29

### Added

- The row shows the effort beside the model.

## [0.2.1] - 2026-10-29

### Fixed

- Small fixes to background work, branch reads, stuck agents, `/compact` and the shared panel layout.

## [0.2.0] - 2026-10-29

### Added

- A row above the prompt with progress, model, branch, context and a prompt-cache countdown, with notifications at 10 and 5 minutes left.

## [0.1.0] - 2026-10-29

### Added

- An Agents side panel that follows a superpowers plan: its progress, every task, and each agent's role, drawn as pixel crabs.

[0.5.3]: https://github.com/Rest95/agent-crew/commit/6f5b382
[0.5.2]: https://github.com/Rest95/agent-crew/commit/c71eae9
[0.5.1]: https://github.com/Rest95/agent-crew/commit/bffa52e
[0.5.0]: https://github.com/Rest95/agent-crew/commit/1a8c938
[0.4.0]: https://github.com/Rest95/agent-crew/commit/fd37be2
[0.3.0]: https://github.com/Rest95/agent-crew/commit/f049f0b
