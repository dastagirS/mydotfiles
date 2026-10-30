# Pi–Docket integration

Pi workspace implementation notes, not Docket application work. Implementation lives in `agent/extensions/docket/` and reuses the existing RPC coordinator. See its README and the `docket` skill for setup, authority, limits, and recovery.

## Agreed behavior

- Docket remains an independent ticketing server with its existing generic REST API.
- The user supplies a project URL when attaching a repo/folder. Initialization must be idempotent; shared workspaces/worktrees retain the same project reference.
- Repo tools derive board identity from that stored reference rather than accepting arbitrary project URLs/IDs in model calls. Reject wrong-board ticket references.
- Parent sessions run only on this machine; reuse existing local Pi RPC workers. Coordinate ticket ownership locally, not across machines.
- One responsible parent per ticket, with explicit transfer rather than silent reassignment.
- Only the responsible parent session may delegate. The user prompts that parent to start a ticket. No automatic pickup or launches from Docket changes.
- Workers inherit the board and assigned ticket, may read that ticket and post comments/progress, but may not edit scope, reassign ownership, mark Done, or launch managed workers.
- Keep the existing message-board pause/continue policy. Do not enable report delivery implicitly or poll for queued reports while paused.
- Telegram only when the user explicitly requests it. Do not send automatic progress, question, or completion notices.
- These are accidental-access guards, not a sandbox against unrestricted shell/network tools. Docket currently has no authentication.

## Existing Docket API support

| Needed capability | Available API |
| --- | --- |
| Validate attached project URL and load workflow | GET /api/projects/{project} |
| List/read scoped tickets | GET /api/projects/{project}/tickets[/{ticket}] |
| Parent edit or worker status-only change | PATCH /api/projects/{project}/tickets/{ticket}, with If-Match |
| Ticket discussion/progress | GET/POST /api/projects/{project}/tickets/{ticket}/comments; writes use If-Match |
| Inspect actual committed changes | GET /api/projects/{project}/tickets/{ticket}/history |
| Replay changes after downtime | GET /api/projects/{project}/events?after=...; persist consumer position locally |
| Prevent wrong-board reference mistakes | Server rejects ticket/project mismatches, including comments/history |
| Prevent silent overwrite | Version preconditions, 409 on stale writes, transactional changes/history/events |

Docket does not supply Pi session ownership, worker roles, or a claim endpoint. Those belong in local Pi coordination under the agreed single-machine model. It also does not supply creation idempotency keys: do not blindly retry an ambiguous write. Inspect committed history and report uncertainty rather than claim exactly-once execution. Worker status permissions must be mapped to the project's configured names; do not infer authority from arbitrary status labels or actor text.

The routes and semantics above were inspected in Docket's API documentation and implementation. Existing API/store tests cover transactions, conflicts, project scoping, history/replay, and recovery. Disposable real-Docket and real-Pi checks now exercise the adapter too; scripted model fixtures prove the exercised routing/guards, not general model adherence or a shell/network sandbox.

## Pi implementation

- [x] Repo reference discovery/idempotent attachment; copied Rift markers and primary-repo discovery for standard non-bare Git worktrees.
- [x] Bounded configured-project client; version conflicts and durable uncertain-write receipts, without automatic retries.
- [x] Local transactional parent claims, explicit owner handoff/release, and human-confirmed interrupted-worker recovery.
- [x] Parent ticket tools and fixed assigned-ticket worker tools; human-approved workflow status mapping.
- [x] User-approved optional `ticketId` on parent delegation, frozen by the coordinator; follow-up instructions cannot rebind.
- [x] Durable explicit event delivery/ack cursors and existing manually controlled upward reports. No automatic polling, pickup, notifications, or launches.
- [x] Disposable real-Pi/application verification, including cross-process competing claims and lost HTTP write responses. No existing user session was reloaded and no actual board was attached/mutated for tests.

## Deliberate limits

Coordination is one machine **and one Pi agent-directory namespace**; separate agent directories do not share claims. Canonical project URLs must match exactly; hostname aliases are not automatically merged. Lost parents are resumed for handoff—no automatic/forced takeover. Unknown worker lifetimes require human inspection, not guessed PIDs. Database restore/replacement requires manual state/cursor reconciliation; it is not automatically detected. Ticket comments, Docket events, and RPC worker reports are not a cross-system atomic transaction. Docket remains unchanged and unauthenticated.
