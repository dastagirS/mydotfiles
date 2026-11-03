---
name: create-verification-skill
description: Create a project-local skill for exercising a real application in isolation, with launch, doctor, drive, evidence, cleanup, and feature journeys. Use only when the user requests a verification skill or harness.
disable-model-invocation: true
---

# Create a verification skill

Adapted for Pi from pstack's [create-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md).

Generate instructions another agent can execute against the real application. Passing unit tests alone does not establish that the user-facing path works.

## 1. Discover the existing workflow

Read project instructions, run scripts, tests, and relevant application code. Identify:

- The user-facing surface: browser, CLI/TUI, desktop application, service, or library.
- Existing launch, readiness, authentication, seed-data, and teardown steps.
- Existing automation before choosing a new harness. Do not install dependencies without approval.
- Observable results: UI state, responses, exit codes, files, database changes, or other side effects.
- Isolation controls: ports, profiles, configuration directories, disposable sessions, and test data.

Inspect configuration names without exposing credentials. Do not read unrelated session histories. If the current build or startup is broken, report the blocker; repairing it is a separate scope decision.

## 2. Agree on the generated skill

Before writing files, propose the target application, verification surface, existing harness, isolation strategy, evidence location, and representative feature journeys. Ask one unresolved question at a time, then obtain explicit approval of the design.

Default output is `.pi/skills/verify-<app>/SKILL.md`, plus `features/README.md` and focused feature journey files inside that skill directory. Follow established project conventions when they differ. Do not generate a project-specific skill merely because this authoring skill was installed.

If isolation is unavailable, stop before driving a shared instance. Ask for an approved safe alternative. Never substitute a real user session for a disposable one.

## 3. Write executable instructions

Use valid Pi skill frontmatter: a name matching its directory and a description naming the application, surface, and trigger. Ground every command and selector in inspected source or an observed run; leave no invented commands or unresolved placeholders in the deliverable.

Include these sections:

- **Launch:** exact commands, required configuration names, isolated state, usable readiness criteria, and finite startup timeouts. A listening port alone is not proof that initialization finished.
- **Doctor:** read-only checks for the expected build, process ownership, readiness, and required authentication, without displaying secrets.
- **Drive:** real user paths using existing tests, stable selectors, HTTP requests, or an isolated PTY as appropriate. Set explicit limits on waits, retries, polling, and generated data. Do not use internal setters as substitutes for user actions.
- **Evidence:** capture the action and resulting state, not just a final screenshot. Assert meaningful outcomes and relevant side effects. Label mocked seams and any behavior they cannot verify. Keep evidence outside directories removed by cleanup, and redact secrets and private data.
- **Cleanup:** stop only processes this run started, using their recorded identifiers; remove only its identified disposable state. Preserve evidence. Run cleanup after failed attempts too. Never kill by process name or perform destructive cleanup without permission.

External messages, payments, deployments, production writes, and irreversible operations require explicit authorization. A dry-run name is not proof of safety: inspect what it actually does. Prefer existing isolated test facilities; label stand-ins and their verification limits.

## 4. Map representative features

Create an index and one journey file per agreed feature. Each journey states:

- User goal and necessary preconditions.
- Entry point and actions on the real surface.
- Expected observable outcome and side effects, with meaningful assertions.
- Known limitations, cleanup needs, and evidence paths.

Cover the agreed scope, not every conceivable feature. Missing preconditions are blockers, not permission to weaken the expected outcome. The map records untested journeys as unverified.

## 5. Prove the generated instructions

Execute launch, doctor, one agreed representative journey, and cleanup in isolation. Use bounded attempts; if verification requires a material design change, return for approval instead of expanding scope.

Confirm the proof artifacts still exist after cleanup. Report commands run, actual outcomes, evidence paths, cleanup status, and remaining gaps. One successful journey verifies that journey, not the entire feature map. If execution is blocked, deliver the skill as an unverified draft and state why.

Do not automatically commit, push, send notifications, change global configuration, or repair unrelated code.
