# Session rules

Pi tool `session_rules` stores short correction rules in the current session, not in instruction files. Activate with a user-initiated `/reload` or a new Pi process; installation does not reload an active session.

```text
session_rules {"action":"list","offset":0,"limit":20}
session_rules {"action":"add","text":"Keep project-specific corrections in this session."}
session_rules {"action":"remove","id":"<ID from list>"}
```

- One nonblank rule per add; maximum 160 Unicode code points, including whitespace and line breaks. No line/word limit or overall rule-count cap. Short text improves clarity. Text is preserved exactly; exact duplicates are rejected, semantic duplicates require reading the list first.
- IDs are stable UUIDs. List defaults to 20 rules, maximum 100 per page; follow `nextOffset` until null. Offsets refer to the current insertion-ordered list, not a snapshot; restart listing after mutations.
- Native custom entries persist adds/removals across resume, reload, and compaction. Rules are session-wide: tree navigation does not undo them. Session-ID ownership excludes copied entries in forks/new sessions. No global files, separate database, dependency, model call, or network request is added.
- `context_with_system` adds a request-only prompt-section delta before every model request, so changes apply on the next request even within a run. Other prompt sections and tool declarations remain intact. This requires Pi's section-aware `context_with_system` API (verified on 1.5.0).
- Removal stops active rule injection; it does not erase historical tool messages, custom entries, or summaries. The injected section explicitly identifies its list as authoritative over historical rules, but cannot guarantee model compliance. Rules remain subordinate to higher-priority instructions. Never store secrets.
- Restore scans native session entries; work is proportional to session-history size, with no hidden truncation or rule-count cap. Prompt size grows with active rules. Rules are not a security boundary. A later extension can alter request context; native hook errors are reported by Pi, not a guarantee of request cancellation.
- Native Pi creates a JSONL file once a user/assistant message exists. Before then custom entries are in memory, following Pi's normal persistence behavior. `--no-session` sessions cannot survive process exit.

## Verification

```sh
node --test agent/extensions/session-rules/*.test.mjs
```

Tests use installed Pi (`PI_PACKAGE_ROOT` overrides its default global npm location). Coverage: character boundaries with native schema validation, multiline/emoji, duplicates, stable IDs/removal, 105 rules with pagination, invalid arguments, cancelled/failed writes, native JSONL resume and synthetic native compaction entries, native forks, tree navigation and fresh-session isolation. The isolated native SDK loads the extension from its file path, exposes its real wrapped tool, and runs Pi's actual request-context transform while preserving other instructions/tools. Temporary fixture directories are removed in `finally` and removal is asserted.

`application.test.mjs` additionally launches the actual bundled Pi CLI in RPC mode, in an isolated HOME/config/project with an allowlisted environment and this extension autodiscovered from its copied directory. A scripted OpenAI-compatible provider listens only on loopback. The complete agent loop executes list/add/duplicate/invalid/remove calls; assertions inspect actual provider-bound instructions and tool results before and after changes. Normal global/appended/project instructions and the native read-tool declaration remain present.

The application check covers native extension reload (`ctx.reload()` through a fixture command, the same runtime operation used by `/reload`), native compaction with a summary returned by the loopback provider, process stop/restart/resume, native clone/fork, switch-back, removal across reload/restart, and fresh-session isolation. It verifies persisted custom entries, a real native compaction entry, a reload lifecycle event, exactly one active request-only rule section, and byte-identical instruction files. The first successful run made **29 loopback provider requests**. Profiles/processes/server are cleaned up in `finally`; deletion is asserted.

No real model service, credentials, external requests, personal session reload, or terminal UI automation is used by the session-rule tests. Scripted responses establish the agent lifecycle and provider-bound payload, not real-model compliance or summary quality. Two initial harness runs failed on fixture request-content parsing (array versus string), before correcting the fixture; no production change or failing-before product-bug proof is claimed.

Initial implementation checks: **110 extension tests passed**, including five session-rule tests; **23 shared configuration tests passed**; strict current-source TypeScript and `build.py --links --check` passed. The additional isolated CLI lifecycle test passed separately. The nearby replies CLI test also passed offline with its session log unchanged; its task-owned temporary evidence was removed after recording that result here.

After adding isolated lifecycle coverage: **111 extension tests and 23 shared configuration tests passed**; JavaScript syntax, `build.py --links --check`, and tracked-diff whitespace checks passed. Direct review found no actionable correctness or complexity issues. No production code changed during this verification task. Task-owned application profiles were removed after recording outcomes here.
