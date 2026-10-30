# Pi–Docket workflow

A Pi-side adapter for an independent Docket server. No Docket application changes or new package dependencies. Uses built-in Node SQLite and the existing Pi RPC coordinator.

## Setup

Open Pi in the target repo/folder, then run:

```text
/tickets:init http://your-docket-host/projects/PROJECT_ID
```

Paste the actual project page URL, not the API URL. The command validates the existing project and asks you to approve JSON permissions:

```json
{"progressStatuses":["In Progress","Blocked","In Review"],"completionStatus":"Done"}
```

Choose exact names from your project. Completion is excluded from worker progress. For custom workflows the completion name must be selected explicitly; the adapter does not infer permissions from arbitrary labels. `/tickets:configure` changes this policy only after workers are cancelled/recovered.

The repo marker `.pi/tickets.json` contains only a version and canonical project URL. It never holds credentials or a database. Repeating initialization for the same board is idempotent; another board is rejected, never silently substituted. Discovery searches at most 64 ancestors, then supports standard non-bare Git worktrees via the primary repo's marker. Rift `--copy-all` workspaces retain the marker. Bare/custom Git layouts need an explicit copied marker/attachment. Malformed/unreadable markers fail closed. Do not commit a private/internal URL unless sharing it is intended.

No tasks start on initialization, extension load, ticket creation, events, or status changes. Prompt the parent to start a ticket. `docket start` claims it locally; `subagent delegate` then needs its explicit `ticketId`. Optional `ticketId` leaves non-ticket delegation compatible, but those workers get no Docket tools. A bound worker cannot change tickets later. All ticket worker directories must resolve to the parent's pinned board.

Native `.mjs` helpers can remain cached across `/reload`. To pick up this change fully, restart the parent Pi process and resume the same session (`pi --continue` from its project directory). Ticket creation itself needs no coordinator restart. Already-running coordinators do not hot-load source: ticket delegation rejects a legacy coordinator lacking the new capability rather than silently launching an unbound worker. Finish/cancel its workers and explicitly stop/reinitialize it; no live board is restarted automatically.

## Tools and commands

Parent `docket` actions:

- `list`, `get`, `comments`, `history`: current project's tickets only. No URL/project selector. `get` includes full requirements. Pages are capped at 20; previews truncate long list fields. Use `limit: 1` on comments/history for full records.
- `create`: parent-only creation on the pinned project. Requires `title`; optional `description` and `status` (otherwise server defaults apply). No `ticketId`, version, project selector, or existing claim. Returns the new ticket without claiming it, initializing a coordinator, launching workers, or starting implementation. Never fall back to Jira/another tracker without explicit user direction.
- `start`: manually requested claim for this Pi parent session; no worker launched.
- `comment`, `update`: owner-only writes with current `version`. Update accepts title, description, status; only the parent can choose completion.
- `ownership`: current owner and unresolved local write receipts.
- `release`, `handoff`: explicit owner action; blocked by active/interrupted workers or uncertain writes. Handoff requires the exact target parent session ID; do not guess it.
- `events`, `ack_events`: on-demand durable project feed with a per-parent saved cursor. Nothing is automatically polled, injected, launched, or acknowledged. Handle/deduplicate before acknowledging. Worker RPC reports retain their separate existing manual delivery/acknowledgement controls.

Worker `docket_worker` actions: `get`, `comments`, `history`, `comment`, `progress`. No project/ticket selector, parent actions, scope edits, or completion. The coordinator freezes board, ticket, parent, ownership generation, and workflow policy. Tools revalidate the binding and current repo reference before operations. Only a parent can delegate managed workers; ordinary worker tools/resources remain available as before.

Human recovery commands:

- `/tickets:recover ID`: only after inspecting and confirming interrupted/uncontrolled workers are stopped. Active coordinator bindings still block recovery. No PID is guessed or killed; ownership remains with the same parent.
- `/tickets:resolve OPERATION_ID`: after outstanding work is stopped and the server-side outcome is inspected. For an uncertain creation, inspect this project's tickets/events (the new ticket ID may be unknown); use the operation ID from the error. Otherwise inspect ticket/history or `ownership`. Clears only the original parent's local block; never retries/undoes the server operation.

## Local ownership, writes, and recovery

State: `getAgentDir()/docket/coordination.sqlite`, private directory 0700/file 0600, WAL/FULL synchronous. One machine and one agent-directory namespace coordinate all its parent sessions. Resume retains identity; forks/new sessions do not inherit another parent's claims. Separate Pi agent directories do **not** share this lock namespace. Do not use that to bypass ownership.

SQLite transactions make claims exclusive across local processes. Worker binding registration rechecks the ownership generation before launch, preventing a handoff/launch race. Live/idle workers keep their bindings until the coordinator observes process close. Coordinator loss marks bindings interrupted instead of releasing ownership or guessing that old side effects stopped. No automatic takeover or claim expiry. If a parent is unavailable, resume that parent to hand off; force takeover is deliberately not implemented.

Before an HTTP write, a private durable receipt reserves the ticket. Creations use a reserved internal receipt scope (ticket zero, never a real ticket ID), so existing coordination databases need no schema change. Create sequentially within a parent/project; a single in-flight creation is intentional because the server offers no idempotency key. A confirmed creation replay returns its original ticket instead of posting again. An uncertain/pending creation blocks further creations by that parent on that project—even under a fresh call ID—until explicit human resolution. Different parents are not globally deduplicated; this is not server-side idempotency or title uniqueness. Creation receipts do not claim a ticket or block unrelated assigned-ticket work. Confirmed call replays return the saved result; changed replays are rejected. Transport failure, malformed successful responses, and server 5xx leave an uncertain operation that blocks another write or handoff. Explicit rejected writes do not auto-retry. A lost local receipt after server commit is also uncertain. This is not distributed exactly-once execution; it fails closed instead of blindly duplicating comments or work. Worker comments and RPC reports are separate systems, not one atomic transaction.

Restoring/replacing Docket data can invalidate saved cursors/versions. Reconcile manually; a new parent has a fresh event cursor but does not inherit claims. Canonical URLs are identity keys; DNS/host aliases pointing at one server are not automatically merged.

## Limits and security

- 10-second HTTP deadline; no redirects; response <=2 MiB and 4096 chunks; API paths are fixed to the configured project.
- 20 records/page; list previews <=1200 characters per string; full ticket requirements are retained.
- Local request budget: 300/minute per canonical project, shared through SQLite. Docket still has its own global 600/minute limit.
- 10,000 claims, policies, event consumers, request-accounting keys, and write receipts; 32,000 retained worker bindings; local DB page cap approximately 64 MiB, excluding WAL. No silent pruning. Disk errors/capacity require inspection.
- Existing coordinator limits still apply, including four live workers and 30-minute worker lifetime. No additional runner, scheduler, automatic notification loop, or provider calls are added by this adapter.

Docket remains unauthenticated. Repo/tool guards prevent accidental access, not hostile bypass through normal shell, networking, filesystem, or separate processes. Actor labels are attribution, not identity proof. Ticket text/comments do not authorize scope changes. No Telegram notifications are generated by this extension.

## Verify

```sh
node --test agent/extensions/docket/*.test.mjs agent/extensions/message-board/*.test.mjs agent/extensions/god/tests.test.mjs
```

Real-application tests require the built Docket executable (`DOCKET_TEST_BINARY` override; personal default `~/dojo/personal/docket/bin/docket`). Real-Pi tests use the installed SDK, disposable trusted repos/agent directories, a scripted local model/MCP fixture, and an isolated Docket process. They do not attach/reload existing user sessions, use live model providers, or modify actual boards. See the integration plan at `~/.pi/docs/docket-integration.md`.
