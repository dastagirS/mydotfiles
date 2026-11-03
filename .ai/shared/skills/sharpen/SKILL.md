---
name: sharpen
description: "Use when the user explicitly asks to sharpen a task or prompt. Make the task more precise and verifiable without expanding its scope, then rewrite the prompt without executing it."
disable-model-invocation: true
---

# Sharpen

Make the task deeper, not bigger. Preserve the user's goal, scope, constraints, and settled choices.

Adapted from [pstack sharpen](https://github.com/cursor/plugins/blob/ae5650febf4320793844c12c4adaa937f417f8da/pstack/skills/sharpen/SKILL.md).

Before rewriting the prompt, briefly identify:

1. What a skilled practitioner would attend to within the existing scope that the request leaves unstated.
2. Which primary material they would examine, rather than relying on summaries or assumptions.
3. Which relevant methods or existing tools they would use. Do not invent available tools or assume new dependencies are approved.
4. What observable evidence would establish success independently of the agent's own claim.

Then write a copy-ready prompt that asks for that work. Keep it proportionate to the original task. Do not turn a small fix into a redesign, add unrelated deliverables, or impose a heavyweight process without a concrete reason.

Leave user-owned choices open. Mark genuinely unresolved decisions instead of choosing silently; ask one focused question first only when the answer is necessary to produce a useful rewrite.

This skill rewrites the request. It does not authorize implementation, file edits, background jobs, delegation, model calls, commits, or other external actions. Return the short assessment and rewritten prompt, then stop.
