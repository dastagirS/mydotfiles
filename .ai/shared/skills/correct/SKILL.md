---
name: correct
description: "Use when the user explicitly asks to correct recurring agent mistakes or invokes correct. Find evidenced repeat mistakes, propose structural enforcement, and apply only approved fixes."
disable-model-invocation: true
---

# Correct

Stop a recurring agent mistake at its source instead of adding another instruction agents can ignore.

Adapted from [pstack correct](https://github.com/cursor/plugins/blob/ae5650febf4320793844c12c4adaa937f417f8da/pstack/skills/correct/SKILL.md).

## Find the pattern, read-only first

Use the named repository and current conversation. Read relevant instructions, code, tests, and local commits or reverts as needed. Do not search unrelated chats, session databases, or workspaces. Ask which repository or correction the user means if the target is unclear.

Group concrete examples by the mistake they share. Call a mistake recurring only when at least two evidenced instances support that claim. Distinguish a demonstrated failure from an untested suspicion. Do not manufacture examples to justify a policy change.

Start with the most consequential recurring mistake, not an exhaustive cleanup. A one-off bug can still deserve a fix, but label it a one-off rather than inventing a pattern.

## Choose enforcement

Consider these options in order, without assuming a larger refactor is better:

1. **Ownership and structure:** one owner for state, one authoritative source, or one supported operation that makes the wrong path unavailable.
2. **Types and schemas:** make the invalid state or mismatched value impossible to express.
3. **Existing lint or validation:** reject the mistake with a diagnostic explaining the supported alternative. If an existing pattern is widespread, consider preventing new occurrences rather than forcing unrelated migration.
4. **Behavior tests:** exercise the observable failure, not an implementation detail or a mock that cannot reveal it.
5. **Session rules:** reserve prose for judgment calls that cannot reasonably be enforced in code. Keep project/session-specific corrections in the current session, never in global/shared or repository instruction files.

Pick the smallest effective change. Do not add a dependency, redesign adjacent modules, or replace public APIs merely to enforce a preference. Explain briefly why the chosen level works and why a structural alternative is unnecessary or impractical.

## Agree before changing state

Present the examples, proposed scope, enforcement mechanism, and verification approach. Get explicit approval before implementation unless that exact fix and approach have already been approved. Invoking this skill authorizes investigation, not arbitrary refactoring or commits.

For an approved prose correction, use `session_rules` when available:

- Call `list` first and follow `nextOffset` through all pages. Check semantic duplicates; the tool rejects exact duplicates only.
- Call `add` once per rule, with precise, nonblank text of at most 160 Unicode characters. Line breaks are allowed; there is no line/word limit or overall rule-count cap. Short rules improve clarity and avoid confusing the model.
- Call `remove` with a listed stable ID when a rule is obsolete or the user asks to remove it. To replace a rule, agree on the replacement, remove the old rule, then add the new one; report any partial failure.
- Rules survive resume, reload, and compaction in the same session. New sessions and forks do not inherit them. Adds/removals apply to the next model request; removing a rule does not erase historical messages.

Do not substitute edits to AGENTS.md, SYSTEM.md, shared policy, or repository instructions. If this harness does not expose `session_rules` (for example, OpenCode), say session-rule persistence is unavailable and offer the proposed rule in the conversation without claiming it was saved. A separately requested global-policy change requires its own explicit scope and approval.

## Implement and prove the approved fix

For a cheap regression path, first run the smallest behavior-focused check against the old behavior and confirm the intended failure. Then apply the approved fix, rerun the check, and run nearby tests. Preserve useful regression coverage.

Do not rewind the user's working tree, switch branches, or create workspaces to reproduce history without authorization. If old behavior cannot be exercised safely, state that limitation and use the strongest available check. Never weaken expected behavior or verification merely to make it pass.

Review changes directly in the current session. Do not automatically commit, push, open a PR, file tickets, notify external services, or delegate a review.

## Report

For each approved correction, give the evidenced mistake, chosen enforcement, actual failing-before/passing-after results, nearby validation, and remaining limits. If only a proposal was approved, stop at that scope. Do not claim that a written instruction makes recurrence impossible.
