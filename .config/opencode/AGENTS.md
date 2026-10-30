# AGENTS.md

## Project Overview

This is a personal OpenCode configuration directory. It contains:
- `opencode.jsonc` — main config (models, permissions, MCP servers, plugins)
- `skills/` — custom slash command skill definitions

---

## Design Goals

Safety, performance, developer experience. In that order.

---

## Safety

When writing code:

- Use simple, explicit control flow. No recursion.
- Put limits on everything: loops, queues, work per time period.
- **Assert all function arguments, pre/postconditions, invariants.** Minimum 2 assertions per function.
- **Pair assertions**: validate before and after operations.
- **70 lines max per function.** Centralize control flow: push `if`s up, `for`s down.
- **Handle all errors.** 92% of catastrophic failures come from unhandled non-fatal errors.
- **Always say why**: explain rationale, not just what.

---

## Performance

- Think about performance from the start. Best wins come in the design phase.
- Optimize slowest resources first: network, disk, memory, CPU.
- Batch operations: amortize network, disk, memory, CPU costs.
- Extract hot loops into standalone functions with primitive args.

---

## Developer Experience

### Naming

- Follow the language's idiomatic convention (`snake_case` for Python/Rust/shell, `camelCase` for JS/TS variables, `PascalCase` for types).
- No abbreviations (except single-letter loop variables).
- Units/qualifiers last: `latency_ms_max`, not `max_latency_ms`.
- Same length for related variables: `source`/`target`, not `src`/`dest`.
- Callback last in params (where the language convention supports it).

### Code Quality

- No dead code. No commented-out code left in.
- No magic numbers — use named constants.
- Functions do one thing.
- Prefer explicit over implicit.
- Smallest variable scope.
- Calculate/check variables close to where used.
- Prefer simpler return types: `void` > `bool` > value > nullable > result/error.

### Numeric Precision

- Distinguish `index`, `count`, `size` — these are different things.
- Be explicit about integer division intent (floor vs. exact vs. ceiling).

---

## Scope Discipline

- Fix what was asked. Don't refactor adjacent code unless explicitly asked.
- If you notice a related bug, surface it — don't silently fix it.
- Don't add dependencies without explicit approval.
- Don't change public APIs without discussion.
- Don't modify unrelated files.

---

## Security

- No hardcoded secrets or credentials in code or config.
- Validate all external inputs before use.
- Never log sensitive values.
- Principle of least privilege: request only the access needed.

---

## Testing

- Run existing tests after any change.
- Don't delete or disable tests to make a build pass.
- If no test suite exists, say so rather than skipping verification.

---

## Communication Principles

### Ask Before Assuming (Grill-Me Approach)

1. **Interview relentlessly** — ask questions until reaching shared understanding
2. **Walk the decision tree** — resolve dependencies between decisions one-by-one
3. **Ask one question at a time** — don't overwhelm with multiple questions at once
4. **Provide recommendations** — for each question, offer your suggested answer based on codebase patterns
5. **Search before asking.** Answerable by code search? Do that first.

**Never hallucinate or guess.** If you don't know how a feature should behave, what the user intended, which approach to take, or technical details not in the codebase — ask.

### Grill With Docs (`/grill-with-docs`)

Use `/grill-with-docs` when stress-testing a plan against an existing domain model. It:

- Challenges terminology against `CONTEXT.md` (ubiquitous language glossary)
- Sharpens fuzzy or overloaded terms by proposing canonical names
- Stress-tests domain relationships with concrete edge-case scenarios
- Cross-references decisions against the codebase to surface contradictions
- Updates `CONTEXT.md` inline as terms are resolved
- Creates ADRs sparingly — only when: hard to reverse + surprising without context + real trade-off

**Trigger conditions:** User wants to validate a design against documented domain decisions, or the conversation surfaces terminology conflicts.

### Improve Codebase Architecture (`/improve-codebase-architecture`)

Use `/improve-codebase-architecture` when the user wants to find refactoring opportunities, consolidate tightly-coupled modules, or improve testability. It:

- Explores the codebase organically, noting friction rather than applying rigid heuristics
- Surfaces **deepening opportunities** — refactors that turn shallow modules into deep ones
- Evaluates candidates using the **deletion test**: would deleting it concentrate complexity, or just move it?
- Grounds architecture language in the project's `CONTEXT.md` domain glossary and existing ADRs
- Runs parallel interface design sub-agents ("Design It Twice") to find the strongest shape
- Updates `CONTEXT.md` and offers ADRs inline as decisions crystallise

**Trigger conditions:** User wants to improve architecture, reduce coupling, increase testability, or make a codebase more AI-navigable.

### Ponytail Review (`/ponytail-review`)

Use `/ponytail-review` to flag over-engineering in diffs. Finds what to delete, simplify, or replace with stdlib/native equivalents. One line per finding — no essays. Complements the normal correctness/security review pass.

- `delete:` dead code, unused flexibility, speculative feature
- `stdlib:` hand-rolled thing the standard library already ships
- `native:` dependency or code the platform already does
- `yagni:` abstraction with one implementation, config nobody sets
- `shrink:` same logic, fewer lines

Ends with `net: -<N> lines possible`.

**Trigger conditions:** User asks to review for over-engineering, wants to cut bloat, or says "is this over-engineered?"

### Concise Communication Mode

**Rules:**
- Drop articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries, hedging
- Use short synonyms: "fix" not "implement a solution for"
- Fragments OK. Pattern: `[thing] [action] [reason]. [next step].`
- Technical terms exact. Code blocks unchanged. Errors quoted exact.

**Not:** "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
**Yes:** "Bug in auth middleware. Token expiry check uses `<` not `<=`. Fix:"

**Revert to normal mode for:**
- Security warnings or irreversible actions
- Multi-step sequences where order risks misread
- User expresses confusion

---

## Subagent Delegation Protocol

**MANDATORY**: Delegate to subagents whenever possible.

### Decision Matrix

| Task | Subagent | Why |
|------|----------|-----|
| Searching for files/patterns | `helper` | Parallel search while you continue other work |
| Reading multiple files | `helper` | Batch file reads, returns summaries |
| Fetching documentation/URLs | `helper` | Offloads I/O-bound work |
| Researching APIs/libraries | `helper` | Dedicated research without blocking main flow |
| Exploring codebase structure | `explore` | Fast read-only codebase exploration |
| Reviewing code changes | `code-reviewer` | Specialized quality/security analysis |
| Reviewing implementation plans | `the-architect` | Scalability/pattern compliance review |
| Testing web features | `browser-help` | Browser automation testing |
| Multi-step research tasks | `general` | Complex parallel work with file access |

### Rules

1. **Never search alone.** Find files or patterns? Launch `helper` or `explore`.
2. **Never read sequentially.** Batch file reads through `helper` or parallel Read calls.
3. **Always review after writing.** Launch `code-reviewer` after completing code changes.
4. **Always architect before building.** Launch `the-architect` before implementing features that touch more than 2 files or require new abstractions.
5. **Parallelize aggressively.** Two independent tasks? Run them concurrently via subagents.

### Anti-Patterns

- Searching for files one-by-one with glob/grep yourself
- Reading files sequentially when they could be batched
- Implementing features without architectural review for complex changes
- Skipping code review after writing significant code
- Doing I/O-bound work (webfetch, documentation) inline instead of delegating

<!-- ryoku-rashin:begin -->
## Ryoku Rashin system vault

This machine runs Ryoku (Arch Linux, Hyprland desktop). A maintained map of the
system lives at `~/.local/share/ryoku/rashin/`. Before exploring the machine or
guessing paths, read `AGENTS.md` there: it says where every config lives, which
binary owns it, and how to reload it. Write durable notes to `memory/` and
dated notes to `journal/YYYY-MM-DD.md`. For code questions prefer `prowl`
(cited code intelligence, reindexed each run): `prowl search "<question>"`,
`find`, `def`, `references`, `outline`, `impact` -- one call instead of grepping.
The `ryoku` agent skill (safety rules, a bar and dock guide, and the command
catalogue) is wired into this agent's skills directory; read it before
customising the desktop. Answer a desktop "how do I" question GUI-first: name
the Ryoku Hub page, shell picker, or QS Bar Settings before naming any command.
<!-- ryoku-rashin:end -->
