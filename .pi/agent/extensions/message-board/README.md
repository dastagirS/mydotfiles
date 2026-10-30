# Pi RPC message board

Opt-in delegation, bound to one parent Pi session. Loading the extension registers tools and commands; it does not start a coordinator or workers. Use human `/board init` to initialize a paused board in the current directory without workers or a model call. Delegate through `/skill:subagent` and the `subagent` tool only after agreeing on task design.

## Architecture

```text
parent Pi extension ── authenticated local HTTP ── detached coordinator
       ↑ pushed availability                         ├─ SQLite FIFO inbox
       │ explicit claim / acknowledgement            └─ worker RPC stdin/stdout
       └──────────── upward-only worker reports ──────────────┘
```

The coordinator owns and drains each worker's RPC pipes. Delegation returns a handle immediately. Worker posts persist before availability notifications. Those notifications update a passive agent summary rail, not the model conversation.

## Manual delivery and agent summary

Delivery starts **paused** on every session start, resume, or reload. There is no inactivity timer or automatic unpausing.

- `/board init`: initialize this parent's board using the current directory, with delivery paused and no workers/model call. No arguments or directory override. If already attached, reports the existing-board error without changing it or its delivery mode.
- `/subagent:continue`: explicitly enable delivery, including future batches, until paused again.
- `/subagent:pause`: stop further delivery without cancelling workers or the parent's current response. It does not retract an already-delivered batch.

These are human commands, not `subagent` tool actions. Initialization, delegation, status checks, retries, and reconnection do not enable a paused board. `status` includes the current `deliveryMode`.

A single, non-focus-capturing summary row sits above the editor. It remains visible when quiet: `agents / off` before attachment, then `paused` or `live` for report delivery. A lost connection adds an explicit `offline` warning without hiding the delivery setting; stalled delivery is also explicit. Counts replace agent names, so up to 32 retained indicators never add summary rows. Error/interruption/decision counts take priority on narrow terminals; truncation is explicit. The native footer, token/context/cost display and My PA status remain untouched.

Counts use Pi's native animated loader for starting/working/stopping, amber `!` for decisions, green `✓` for agents with results awaiting review, red `×` for failure, `?` for interrupted control, and muted `·`/`−` for idle/stopped work with retained reports. Counts describe agent indicators, not total report bodies, physical live-worker inventory, task success, or Docket Done. Acknowledged idle results disappear; deferred unanswered decisions remain visible. Workers may continue while delivery is paused.

Human `/board agents` opens a focused, on-demand roster using the public native custom-UI overlay. It never automatically opens or initializes a board. Stable creation-order names (`agent1`, `agent2`, …) are sorted with failures/interrupted control/decisions first, then working/results/retained idle work. At most six agent rows are visible; use Up/Down, PageUp/PageDown, Home/End to scroll and Esc or `q` to close. Smaller terminals reduce the viewport or show the compact summary; counts and rows fit available width. Closing restores editor focus without changing unsent input; unrelated dialogs remain intact.

State arrives as bounded passive metadata in existing availability pushes. Rendering and roster inspection do not read report bodies, lease/acknowledge reports, call the model, enable delivery, or poll. The spinner is local UI animation only and stops while blocked, hidden, disconnected, or disposed. RPC/print mode keeps normal tools/status commands; native component factories are not rendered there, and `/board agents` safely directs unsupported clients to `/board status`.

A coordinator already running older code cannot push per-agent metadata. Its queued-report aggregate is shown without inventing worker states (`activity unknown` when there are no reports); full rows arrive after an explicit coordinator restart when its workers are safely handled. Loading the extension never automatically restarts a live coordinator. To pick up changed native `.mjs` helpers reliably, restart only the parent Pi process and resume the same session (`pi --continue`); `/reload` can retain cached helpers. This UI revision needs no coordinator/worker restart.

Pending counts travel in availability notifications. A coordinator still running older code is supported through an event-driven status read; no restart, timer polling, or model call is required to update the label.

While explicitly enabled, the parent receives up to three reports per batch through Pi custom messages with `triggerTurn: true` and steering delivery. New `board-updates` messages use `display: false`: internal JSON/instruction blocks are hidden from the transcript UI, but remain in session history and model context for handling/acknowledgement. Ordinary tool calls and assistant replies remain visible. This does not change delivery timing or rewrite older visible entries. Idle parents wake; busy parents receive reports at Pi's safe steering boundaries. A long blocking parent tool still delays reasoning. A pause received during an outstanding claim retains that undelivered batch's lease until continue or disconnection; it is neither injected nor acknowledged. Disconnection releases its lease for durable recovery.

This is at-least-once delivery, not exactly-once model execution. Claiming/injecting does not delete a report. Parent acknowledges after handling or explicitly deferring it. Unanswered decision records remain visible after acknowledgement. Replayed answered events include an answer preview and explicit truncation flag; the complete answer stays in SQLite. Do not answer an already-answered event again. Exhausted delivery attempts stall FIFO instead of silently dropping reports; inspect before explicitly retrying.

## Compact tool output

Both parent `subagent` and worker `board_post` use two compact content lines by default: tool/action, then a short outcome. Status summarizes bounded job/state/pending counts instead of dumping task/path previews. Acknowledgements show report counts; worker posts say queued, not handled. Acceptance/cancellation/stop requests never imply implementation success or process exit. Errors remain visible in red.

Use Pi's native expand toggle (`Ctrl+O` by default, or click the tool row) for full arguments and textual results. Expanded rendering has a 1 Mi-character safety limit with an explicit marker; normal bounded board responses fit in full. Incomplete/malformed/older results fall back to a compact "expand for details" message, not a raw JSON dump. These are display-only renderers: original model results, saved session data, FIFO, delivery timing and explicit controls are unchanged. Reload the parent to load the new TypeScript renderers; running workers do not need to be stopped.

## Parent interface

Use the parent-only `subagent` skill for the coordination protocol.

| Action | Inputs / behavior |
|---|---|
| `init` | Optional existing `cwd`, default current directory; starts or reconnects this session's board. |
| `delegate` | `task`, explicit `scope[]`, `acceptance[]`; optional existing `cwd`, `provider`, `model`, `thinking`, `taskKey`, and explicit Docket `ticketId`; returns `jobId`. |
| `instruct` | Idle `jobId`, new `task`; optional updated `scope[]` / `acceptance[]`; increments assignment revision in the same worker conversation. Directory and model settings stay fixed. |
| `respond` | Exact decision `eventId` and `answer`; routed to its originating worker/revision. Native RPC confirmation answers are the strings `"true"` or `"false"`; selections must match an offered option. |
| `ack` | Exact delivered `ids[]`; acknowledges this parent consumer's batch, not task success. |
| `status` | Bounded job/task/path previews, up to 50 current-revision unanswered decision previews, pending count, stalled flag. Full data remains in SQLite. |
| `retry` | Explicitly resets retry counters for unleased pending reports; does not unpause delivery. Inspect prior actions first. |
| `reconnect` | Reattaches this parent; may restart a dead coordinator without replaying tasks. |
| `cancel` | Stops one controlled `jobId`; no guessed process IDs, rollback, or workspace deletion. |
| `stop` | Stops this coordinator and all controlled workers; preserves evidence. |

Human shortcuts: `/board status`, `/board reconnect`, `/board stop`. There is deliberately no wait action; status is for deliberate inspection, not routine polling. Normal completion, review, and human approval remain the parent's responsibility.

A logical task defaults to the hash of its normalized assignment. Repeated delegation of that same assignment returns its existing handle even under a fresh tool-call ID. Use a distinct explicit `taskKey` only for an intentionally separate execution; reusing a key for different assignment data is rejected. An existing interrupted/cancelled task is not silently relaunched. New logical attempts need an explicitly distinct key.

## Optional Docket ticket binding

For ticket work, the user first prompts the responsible parent to claim a ticket through the repo-scoped `docket` tool. Delegate with its explicit `ticketId`; the coordinator derives the project from the repo marker, atomically checks local ownership and freezes board/ticket/generation/policy. Another project directory or unowned ticket is rejected. `instruct` cannot add/change a binding; use a new worker for another ticket. Status includes the assigned ticket/project for bound jobs. Active/interrupted ticket workers block ownership handoff until cancelled/recovered.

Bound workers get `docket_worker`, not parent Docket tools, alongside normal resources. Non-ticket workers get no Docket tools. All existing manual delivery controls remain unchanged; comments and ticket events never unpause the report inbox or launch work. A legacy running coordinator must be explicitly stopped/reinitialized before ticket delegation; the parent checks its capability and never restarts it silently. See [Docket integration](../docket/README.md) for setup, limits, uncertainty and recovery.

## Worker interface and normal Pi behavior

Workers get `board_post({kind, summary, details?, artifacts?, eventId?})`, with kinds `progress`, `needs_decision`, `result`, `failed`. Identity and recipient come from the worker capability, not model parameters. Worker credentials cannot consume the parent inbox, reply to another worker, or invoke managed delegation. Duplicate report IDs reconcile identical reports and reject changed content.

Workers retain normal Pi settings, model/auth resources, tools, skills, built-in/configured extensions, native MCP, project instructions, custom `SYSTEM.md`, and normal `APPEND_SYSTEM.md` discovery. The `subagent` skill alone is filtered from the worker resource loader and prompt. Role/reporting instructions are appended persistently, and each run refreshes its current assignment in the system prompt. Native extension UI decisions are forwarded to the parent, never auto-approved. Native project-trust policy is respected; an untrusted project must be trusted explicitly before delegation unless existing Pi policy already grants trust.

Worker `enabledModels` configuration is resolved through the installed public `resolveModelScopeWithDiagnostics` SDK API, preserving the resolved session scope. Scope warnings retain only known diagnostic codes, not raw patterns or messages.

Bootstrap failures emit `startup_failed`, with a bounded, allowlisted phase and error type plus a private stderr path; the job stage remains `startup_failed` after process exit. Prompt/command rejection remains `rpc_error`. Private startup stderr includes phase/type and a fixed safe reason where known; raw exception messages/stacks and arbitrary configuration values are deliberately not logged. An accepted delegation handle does not mean RPC startup or task execution succeeded.

Workers ask asynchronously: post a decision request, then finish the turn or continue independent approved work. The parent response resumes/steers them over RPC. Prompt acceptance and `agent_settled` are not proof of successful work.

**Not a sandbox:** normal shell/filesystem access remains. The managed coordinator rejects worker delegation and peer addressing, but cannot prevent independent agent spawning, credential-file access, or arbitrary networking through unrestricted shell. Role instructions prohibit agent spawning. Scope declarations do not lock files; shared-directory whole-file writes can lose updates. Arrange separate workspaces or explicit handoffs separately; this extension never runs Rift or creates/deletes workspaces. Messages join the normal model context; do not post secrets or raw sensitive output.

## Persistence and lifecycle

State lives under `getAgentDir()/boards/<parent-session-id>/`:

- `config.json`, `endpoint.json`: private ownership/capability and connection metadata.
- `board.sqlite` and SQLite WAL files: assignments, durable reports, command identities, acknowledgements, answers.
- `workers/<jobId>/worker.json`, `instructions.md`, `sessions/*.jsonl`, `stderr.log`: private worker bootstrap, role instructions, normal Pi transcripts and bounded diagnostics.
- `service.log`: coordinator startup diagnostics.

Parent reload/exit disconnects its subscription, not the workers. Session binding entries restore ownership on resume/reload, but never restore an enabled delivery mode: reports remain paused until the human continues again. Other sessions and forks do not automatically inherit it. A coordinator crash loses RPC control; restart retains reports, clears abandoned inbox leases, and marks prior workers interrupted. It does not reattach guessed PIDs or replay tasks. Inspect actual artifacts before deciding on a new attempt. Cancelling cannot undo completed edits or other side effects.

Defaults in `protocol.mjs`: four live workers (including idle ones), 32 cumulative jobs per parent-session board, 10,000 retained events and command identities, three reports per batch, three delivery attempts, 60 reports per worker/minute, 1,000 coordinator requests/minute, 64 KiB command bodies and worker stderr, 512 KiB client responses, 16 MiB buffered worker RPC output. A worker lifetime is 30 minutes including idle time; coordinator lifetime is 24 hours per process, with five-minute detached shutdown only when no workers remain. These are bounds, not automatic retries or scheduling guarantees. Exhaustion requires explicit inspection; no automatic pruning is performed.

## Updating an existing installation

### Legacy task-key schema repair

Opening a board now validates its schema and atomically upgrades the pre-task-key `jobs` table. The migration and schema-version stamp share one SQLite transaction; failed/interrupted copies do not publish a partial table. Job IDs, original row order, capability hashes, raw assignment data, revisions/states, and all reports/answers/leases/commands remain unchanged by migration. Normal coordinator restart recovery may subsequently release abandoned leases/mark lost workers interrupted, as before; it never relaunches historical work.

Logical keys use the stored assignment parsed and serialized through the existing SHA-256 convention. For identical legacy definitions, the newest original row owns the canonical key; older duplicates retain their records under distinct `legacy_<SHA-256-of-job-ID>` keys. Original pre-revision instructions are not reconstructed. Current task-key databases keep their existing keys. Named-column insertion works regardless of physical column order. Unsupported/future schemas, excessive legacy row/assignment sizes, custom jobs indexes/triggers, or foreign-key dependents refuse safely rather than dropping history. Concurrent journal-mode negotiation has a small bounded retry before any data writes; HTTP/task operations are not automatically retried.

A running coordinator does not hot-load this repair. In the **affected parent session**, inspect/finish/cancel any needed workers, then `/board stop` and `/reload` (or resume that same parent in a new Pi process). Its restored binding opens the same database and applies migration. Do not delete/reset the board or create a new parent merely to bypass the error. No live coordinator or user database is restarted/migrated by the tests.

SQLite request failures now return sanitized schema/storage/recovery guidance and write only fixed diagnostic text plus numeric SQLite codes to `service.log`, capped at the existing 64 KiB diagnostic budget. If logging fails or is full, the response explicitly says so instead of claiming a diagnostic was saved. Request bodies, task text, capabilities and raw SQLite exception messages are not logged.


The bootstrap fix applies to newly launched workers. A coordinator already running in memory does not hot-load the improved startup-failure classification; loading that reporting change requires an explicit coordinator restart. Do not restart a board with needed live workers merely to refresh diagnostics. Existing failed jobs and reports are not rewritten, and no application worker is automatically retried. An intentional new attempt needs a distinct task key as described above.

## Compatibility and verification

Tested with Pi **1.4.0**, Node **26.11.1**, built-in `node:sqlite`. Worker bootstrapping deliberately uses installed Pi internals to retain its normal built-in extensions and RPC runtime; rerun integration tests when upgrading Pi. No new dependencies are installed.

```sh
node --test agent/extensions/docket/*.test.mjs agent/extensions/message-board/*.test.mjs agent/extensions/god/tests.test.mjs
```

Docket tests require its built executable (`DOCKET_TEST_BINARY`, default `~/dojo/personal/docket/bin/docket`) and run a separate real server, never the live board. Real parent/worker checks cover scoped reads/progress/comments, completion/retarget denial, dedupe, preserved ordinary resources and paused report delivery. Tests use disposable agent directories, project trust, local model/MCP HTTP fixtures, and real Pi RPC processes. They exercise startup with omitted, empty, nonempty, and unmatched `enabledModels`, actual session scope preservation, sanitized scope warnings, bootstrap failure classification and private-cause redaction, normal capability/prompt inheritance, parent-only skill exclusion, upward-only identities, duplicate launches, asynchronous decisions, manual parent wakeups/acknowledgements, paused UI state without model calls, chat without implicit continuation, reload resetting an enabled board to paused with a retained worker and revised assignment, controlled pause-during-claim/acknowledgement/restoration races, coordinator crash recovery, native confirmation routing, cancellation, FIFO/retry bounds, configuration privacy, bounded status output, a 32-agent constant-height rail, six-row scrolling/resizing, native main/fullscreen widget/dialog focus, unknown legacy metadata, and passive roster inspection preserving report receipts. Failed fixtures are retained for inspection; successful fixtures are removed. They do not use live model providers or existing user sessions. Model adherence to scope, verification discipline, notification policy, and the no-spawning prompt is not established by a scripted fixture.
