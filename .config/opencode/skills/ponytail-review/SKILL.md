---
name: ponytail-review
description: Compatibility skill for the existing over-engineering review command. Uses the current Pi complexity-review guidance; does not delegate review or replace correctness checks.
---

# Over-Engineering Review

Required reference for the code-review skill's complexity pass. Formerly the standalone ponytail-review skill. Apply only to the changes under review; read existing code for context, not additional findings.

Review diffs for unnecessary complexity. One line per finding: location, what
to cut, what replaces it. The diff's best outcome is getting shorter.

## Format

`L<line>: <tag> <what>. <replacement>.`, or `<file>:L<line>: ...` for
multi-file diffs.

Tags:

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Examples

❌ "This EmailValidator class might be more complex than necessary, have you
considered whether all these validation rules are needed at this stage?"

✅ `L12-38: stdlib: 27-line validator class. "@" in email, 1 line, real validation is the confirmation mail.`

✅ `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`

✅ `repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`

✅ `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`

✅ `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

## Scoring

When concrete proposed cuts support a line-count estimate, end the complexity section with `net: -<N> lines possible.` Do not invent an estimate or treat line count as the correctness review's metric.

If there is nothing to cut, say `Lean already.` Finish the correctness and quality review too; this reference alone does not justify shipping.

## Boundaries

Complexity only: correctness bugs, security holes, and performance belong in the main review's Correctness and Quality section, not this section. Necessary smoke tests and meaningful test assertions are not bloat; do not recommend deleting them to reduce line count. Follow the project's assertion policy: temporary development assertions should not leak into production, but necessary runtime validation and error handling must remain.

Review only the changes. Do not recommend deleting unrelated existing code. List proposed cuts without applying them.
