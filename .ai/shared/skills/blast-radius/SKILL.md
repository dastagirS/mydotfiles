---
name: blast-radius
description: Assess what a specified change could break beyond its immediate diff, identify the assumptions its safety depends on, and prove the critical ones with focused executable checks. Use for blast-radius requests or risky changes involving configuration, lifecycle, concurrency, persistence, or external interfaces. Review directly without subagents.
---

# Blast radius

Adapted for Pi from pstack's [blast-radius](https://github.com/cursor/plugins/blob/main/pstack/skills/blast-radius/SKILL.md).

Find concrete downstream risks introduced or worsened by the specified change. A caller list or persuasive explanation is not proof of safety. Run this investigation directly; do not delegate to subagents or multi-model panels.

## 1. Establish the change and scope

Use the diff, commit, branch, or files the user identified. For just-implemented work, use that change. Otherwise inspect staged and unstaged changes; if there is no target, ask rather than reviewing unrelated existing code.

Read the complete changed files and related code needed to understand their contracts. Consult existing domain documentation and decisions where available. Trace surrounding code as evidence, not as permission to refactor it or report unrelated defects as findings on this change.

## 2. Identify the safety assumptions

State the critical fact or facts that would make the change safe. For example: a setting is scoped to one session, an operation cannot run after shutdown, or an old reader accepts a new serialized value.

Follow behavior a name search may miss: configuration precedence, lifecycle ordering, asynchronous work, stored state, wire formats, cross-language consumers, feature flags, and library behavior at the installed version. Distinguish intended contracts from observed behavior. Do not invent callers or APIs.

Prioritize plausible failures and their impact. Keep investigation bounded to the named change and the dependencies needed to test its safety assumptions; do not expand into an exhaustive repository audit.

## 3. Prove the critical assumptions

For each important assumption, record the strongest evidence actually obtained:

1. **Unproven:** an assertion without supporting evidence.
2. **Source-backed:** a real file and line, installed library source, or documented contract.
3. **Execution-path argument:** trace the relevant state and ordering to show why a failure cannot occur under the stated conditions.
4. **Executable check:** a focused test or script calling the real implementation and asserting the critical outcome.
5. **Running-application reproduction:** exercise the actual user-facing path in isolation and observe the result.

These are evidence labels, not a requirement to run every level. Seek the cheapest useful executable proof; explicitly mark a critical assumption unproven when it cannot be tested safely. Source-backed reasoning does not become runtime proof by repetition.

Prefer existing tests and installed libraries over recreating framework behavior with mocks. For a suspected bug with a cheap regression path, establish failing-before and passing-after evidence. A mocked network can establish local behavior, but cannot establish remote delivery or service compatibility.

Use disposable sessions, configurations, ports, and data. Set finite timeouts and attempt limits. Keep checks read-only where possible; obtain approval before substantive file changes, live-process instrumentation, destructive actions, or external side effects. Never replay commands from another session or mutate the user's working session to prove a hypothesis. If approval or safe infrastructure is unavailable, stop at the evidence obtained and name the gap.

## 4. Report findings without widening scope

Return:

- **Change:** what behavior changes, including non-obvious consequences.
- **Safety assumptions:** each fact, its evidence label, source locations, and proof command/result or the reason it remains unproven.
- **Confirmed risks:** mechanism, affected path, plausible trigger, impact, and supporting evidence. Label likelihood as an assessment, not a measured fact.
- **Cleared checks:** specific scenarios investigated and why the evidence clears them within the tested conditions.
- **Before shipping:** the cheapest missing check, if any, and remaining uncertainty.

Separate observations, inferences, and open hypotheses. A checked scenario is not proof that all possible downstream behavior is safe. A negative search is evidence only within the searched scope.

Do not fix findings, commit, push, notify external systems, or alter unrelated files unless explicitly requested. When proposing a fix, follow the existing design-approval and detailed-diff rules. This skill supplements, rather than replaces, the required code review.
