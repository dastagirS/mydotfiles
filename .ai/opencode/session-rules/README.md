# OpenCode session rules

Dependency-free OpenCode **2** plugin exposing `session_rules`. Canonical code lives here; `~/.config/opencode/plugins/session-rules` links here relatively. No provider, permission, package-lock, or model settings changes are needed. No live reload/restart is requested; OpenCode may discover source changes through its own watcher.

```text
session_rules {"action":"list","offset":0,"limit":20}
session_rules {"action":"add","text":"Keep this correction session-local."}
session_rules {"action":"remove","id":"<ID from list>"}
```

- One nonblank rule per add; at most 160 Unicode code points, including whitespace/newlines. No line/word limit or overall rule-count cap. Text is preserved exactly. Exact duplicates are rejected; read all list pages before adding to check semantic duplicates.
- List defaults to 20 rules, maximum 100 per page, in insertion order. Follow `nextOffset` until null. Restart listing after mutations because offsets are not a snapshot. Remove by stable UUID.
- Native plugin-scoped KV stores a versioned snapshot at `session:<sessionID>`. Resume, reload and compaction preserve it. Fresh/fork sessions with different IDs start empty, even when their historical messages contain old rules. **Recreating a deleted session with the same ID intentionally restores that ID's stored rules, as explicitly accepted by the user.** No AGENTS.md/SYSTEM.md edits or separate database/files are used.
- The native `session.hook('context')` refreshes one request-only system part before each primary request, including after a tool call in the same agent run. Existing instructions, messages and tools remain intact. The current list (including an explicit empty list) supersedes inactive historical rules. Compaction uses OpenCode's own summarizer; the next primary request reloads current rules independently of the summary.
- Reads and prompt rendering are proportional to rule count, without hidden truncation. KV atomically replaces one snapshot. Within a plugin instance, overlapping mutations fail explicitly instead of queuing or losing updates; list again before retrying. This is not a multi-server distributed write protocol: do not run independent OpenCode services concurrently against the same data directory. Native storage is persistent session-keyed data, not ephemeral process memory. Removing/deleting a session does not currently remove its plugin-KV snapshot; it is never inherited by a different session.
- Rules are not a security boundary or a guarantee of model compliance. They remain subordinate to higher-priority instructions. Removal stops active injection but does not erase tool history/summaries. Never store secrets. Other plugins can change request context; hook failures are surfaced by OpenCode, not a promised request-cancellation boundary.

## Compatibility

Verified against installed **OpenCode 2.2.0**, using upstream source pin `1097e2668b1e08ad63bdf0b1c4860b9bc01e420c` for contracts:

- `packages/plugin/src/promise/{plugin,session,tool,storage}.ts`
- `packages/core/src/{plugin/module,plugin/host,plugin/source-directory,kv}.ts`
- `packages/core/src/config/plugin/source.ts`
- `packages/core/src/session/compaction.ts`

This uses the native default `{ id, setup }` definition and JSON tool schema, without importing or upgrading the locally installed **legacy** `@opencode-ai/plugin` package. OpenCode 1.x is unsupported. The shared `correct` skill uses the same tool name in either harness and reports unavailability when a harness does not provide it.

## Verification

```sh
node --check ~/.ai/opencode/session-rules/index.js
node --test ~/.ai/opencode/session-rules/rules.test.mjs
python3 ~/.ai/opencode/session-rules/application.test.py
```

Four focused Node tests cover Unicode/multiline boundaries, duplicates/removal, 105 rules with pagination, invalid arguments, reconstruction/isolation, failure/cancellation, mutation overlap, and corrupt saved state. These use a storage adapter fixture, not the actual OpenCode database.

The Python check launches the **real installed OpenCode executable** (`OPENCODE_BINARY` overrides `/usr/bin/opencode`) as private stdio-owned servers in a disposable HOME/config/data/state/cache/project. Environment is allowlisted, model-catalog fetches disabled, MCP/remote plugins absent. A scripted provider listens only on loopback. No dependencies are installed or personal credentials/session databases inspected.

The actual agent loop performs list/add/duplicate/invalid/remove calls and asserts provider-bound system instructions/results. It verifies a 160-code-point multiline emoji rule through native schema validation; autodiscovery; native location reload; native compaction with a persisted summary; process restart/resume; real session fork/new-session isolation; removal across reload/restart; and byte-identical project instructions. The original lifecycle check used **26 scripted loopback requests**; the extended check also verifies deletion/recreation with the same ID restores its rule. Servers and profiles are cleaned up on failure as well as success, and profile deletion is asserted.

Initial lifecycle harness checks misclassified native compaction (which retains tool declarations but uses a different hook and a structured-summary prompt), causing fixture assertions/timeouts. After correcting only the fixture's compaction classification/summary format, the same production plugin passed. This is a new feature, not a failing-before product-bug reproduction. Real-model compliance, summary quality, terminal UI, live personal-service activation and cross-service concurrent writes are not claimed verified. There is no dedicated formatter/linter or current OpenCode-2 TypeScript SDK installed for these JavaScript files; syntax and real-runtime checks are used without installing tooling.

## Session-ID decision

Review initially classified reused-ID restoration as an isolation issue. The isolated check demonstrated that a deleted ID's rules return when that ID is recreated. The user explicitly accepted this behavior: rules belong to the session ID, not to an individual creation of that ID. The test now asserts restoration (`REUSED_ID`) while retaining empty-rule assertions for new IDs and forks. This is a clarified expected behavior, not a production bug fix or a failing-before/passing-after repair claim. Storage logic is unchanged; tool/skill descriptions document the accepted distinction.

Final checks after the session-ID clarification: four focused OpenCode tests passed; the full isolated OpenCode lifecycle passed with **32 loopback requests**, including accepted ID-reuse restoration; six focused Pi session-rule tests and 23 shared configuration tests passed. JavaScript/Python syntax, generated-config/link checks and tracked whitespace checks passed. Direct review found no unresolved actionable findings under the agreed ID-scoped contract; Lean already. The relative activation link was restored without requesting a personal-service reload/restart. No commit was requested or made.
