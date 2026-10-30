## Safety

When writing code:
- Use simple, explicit control flow. No recursion.
- Put limits on everything: loops, queues, work per time period.
- During implementation, debugging, and testing, add assertions wherever arguments, state, pre/postconditions, invariants, or results could meaningfully fail. Check before and after risky operations where useful. No numerical quotas, tautologies, or checks already guaranteed by types.
- Before finishing, preserve useful assertion coverage in tests and remove temporary assertions from production code. Keep necessary runtime validation and explicit error handling in production; never remove those as assertion cleanup.
- Handle all errors. 92% of catastrophic failures come from unhandled non-fatal errors.
- Always say why: explain rationale, not just what.

## Performance

- Think about performance from the start. Best wins come in the design phase.
- Optimize slowest resources first: network, disk, memory, CPU.
- Batch operations: amortize network, disk, memory, CPU costs.
- Extract hot loops into standalone functions with primitive args.

## Developer Experience

### Naming
- Follow the language's idiomatic convention.
- No abbreviations (except single-letter loop variables).
- Units/qualifiers last: `latency_ms_max`, not `max_latency_ms`.
- Same length for related variables: `source`/`target`, not `src`/`dest`.
- Callback last in params.

### Code Quality
- No dead code. No commented-out code left in.
- No magic numbers — use named constants.
- Functions do one thing.
- Prefer explicit over implicit.
- Smallest variable scope.
- Calculate/check variables close to where used.
- Prefer simpler return types: `void` > `bool` > value > nullable > result/error.

#### Helper Functions
- Keep single-use logic inline by default.
- Extract a helper when identical logic occurs in 2+ places and extraction reduces total code.
- A single-use helper is justified only when it meaningfully clarifies a complex operation or isolates a performance-critical loop.
- Avoid trivial wrappers, pass-through helpers, and speculative reuse.

#### Variables
- Inline expressions used only once at the call site instead of introducing a variable.
- Exception: keep a variable when a long expression becomes easier to read or its name adds meaningful context (e.g. `firstName` from `user.name.split(" ")[0]`).
- Do not inline when doing so changes evaluation order, repeats side effects, or loses a necessary stable value.
- Bad: `const backgroundColor = colors.surfaceColor;` followed only by `backgroundColor: backgroundColor`.
- Good: `backgroundColor: colors.surfaceColor`.

#### Comments
- Do not comment behavior obvious to a developer reading the code.
- Add comments only for workarounds (library bugs, platform quirks, race conditions), reasoning that requires tracing several layers of definitions/dependencies, or non-obvious decisions involving constraints and tradeoffs.
- Explain why, not what. The code shows what; the comment justifies it.

### Detailed Code Diffs
- When presenting new features, fixes, implementation plans, or architectural changes, show detailed implementation diffs rather than hand-wavy summaries.
- Use diff-formatted blocks with file paths and unified-diff hunk headers showing line numbers; include enough surrounding context to make each change understandable.
- For plans, label diffs as proposed. Use actual source line numbers where available; if a file has not been inspected, do not invent line numbers or claim a proposal was applied.

### Numeric Precision
- Distinguish `index`, `count`, `size` — these are different things.
- Be explicit about integer division intent (floor vs. exact vs. ceiling).

## Scope Discipline
- Fix what was asked. Don't refactor adjacent code unless explicitly asked.
- If you notice a related bug, surface it — don't silently fix it.
- Don't add dependencies without explicit approval.
- Don't change public APIs without discussion.
- Don't modify unrelated files.

## Security
- No hardcoded secrets or credentials in code or config.
- Validate all external inputs before use.
- Never log sensitive values.
- Principle of least privilege: request only the access needed.

## Testing
- Run existing tests after any change.
- Don't delete or disable tests to make a build pass.
- If no test suite exists, say so rather than skipping verification.
- For bug fixes with a clear, cheap regression path, write the smallest behavior-focused check before editing production code. Run it against the old behavior and confirm it fails for the intended reason; after the fix, rerun it and nearby tests to demonstrate passing-after evidence.
- If the check already passes, fails for an unrelated reason, or is impractical because of expensive infrastructure, brittle mocks, or unrelated fixture churn, do not claim failing-before proof. Refine the reproduction when feasible; otherwise use the closest safe executable check and report its limits. Do not weaken expected behavior or alter tests merely to match a wrong implementation.
- Prefer assertions on observable behavior over implementation details. Mocks prove only the behavior they exercise, not compatibility with an untested framework or external service. Use isolated real-application verification for integration claims when practical; disclose blocked or unverified paths.
- Report the regression check, its actual failing-before and passing-after outcomes, and nearby validation. If either outcome could not be demonstrated, say why and identify the evidence actually obtained. Keep evidence free of credentials and sensitive output; never fabricate a reproduction.
