---
name: ketchup
description: "Use when the user invokes ketchup or explicitly asks for a catch-up on the current conversation. Give a concise read-only account of changes, verification gaps, and decisions waiting on the user."
disable-model-invocation: true
---

# Ketchup

Catch the user up in plain words. Explain what changed for them, what remains uncertain, and what actually needs their decision.

Adapted from [pstack ketchup](https://github.com/cursor/plugins/blob/ae5650febf4320793844c12c4adaa937f417f8da/pstack/skills/ketchup/SKILL.md).

## Gather only relevant evidence

Use the current conversation since the user's last substantive message before the catch-up request. Treat tool events and worker reports as reports, not user messages. Include earlier unresolved user decisions when they still matter.

Use evidence already available in this conversation and narrowly scoped read-only artifact checks when needed. If compaction or missing context prevents reconstruction, state what is unavailable instead of inventing continuity. Do not read unrelated session histories or databases.

Respect human-controlled worker/report delivery. When delivery is paused, do not poll for reports, fetch worker state to bypass the pause, resume delivery, or acknowledge messages. Use only already delivered reports and label potentially stale state. Do not delegate a status investigation or review merely to prepare a catch-up.

Keep this turn read-only: no code or instruction edits, app launches, new jobs, report acknowledgements, branch changes, external messages, commits, or ticket updates. If a live status cannot be checked safely within the existing authorization, say it is unverified.

## Explain what happened

Use plain sentences and short bullets. Prefer user-visible outcomes over implementation narration. Include paths, commands, identifiers, and test counts only when they help the user act or understand a real limitation.

For each requested outcome, distinguish:

- Implemented and exercised on the real surface.
- Checked only through unit tests, mocks, static inspection, or generated-file comparisons.
- Still running, blocked, failed, or unverified.

Passing tests do not establish an untested integration. A worker's report is not independent verification. If an earlier completion claim was too broad, correct it explicitly.

Mention existing screenshots or other artifacts only when useful. Do not require new visuals, repeat the same fact in several formats, or add a diagram for a status list.

## Surface actual decisions

A user action is something only the user can decide or authorize: a product choice, an approval, access, or an irreversible operation. Unfinished work the agent can already perform is not automatically a user action item.

For each genuine decision, state the choice, recommendation, relevant evidence and uncertainty, and material tradeoff. Include a verified link or command only if useful. Do not invent decisions to fill a template or request approval for unrelated work.

Default shape: a short catch-up, remaining work or verification gaps, then decisions if any. Start with whether anything needs the user's decision. Keep small updates small; include every material waiting decision rather than hiding them behind a count. If nothing changed and nothing waits on the user, say so and stop.
