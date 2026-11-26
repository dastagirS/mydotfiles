# Replies

Command-only browser for user prompts and completed assistant replies. Run `/replies` for an oldest-to-newest list that opens at the newest entry; no sidebar, ticks, hover popup, reserved columns or terminal input observers. Reload Pi yourself after updating the extension.

## Use

- **↑/↓**, **Page Up/Down**, **Home** (oldest), **End** (newest), **Enter** (jump), **Esc/q** (close). List mouse clicks and wheel work too.
- The list shows up to 20 entries, oldest at the top and newest at the bottom; **`/` or `f`** filters by user/agent text; type, then **Enter** jumps to the first match. **Esc** clears the filter.
- Navigation preserves native editor/focus/dock ownership and never resends prompts or restores model context. Typing a slash command replaces/submits command text through Pi normally; the navigator itself does not edit the draft. Manual jumps pause following; Pi's native jump-to-latest control resumes it.

## Indexed history

Current parent session and branch only. The extension reads `getBranch()` and never calls `getEntries()` or walks parent/sibling branches. Each persisted user prompt and each assistant message with `stopReason: "stop"`, nonempty text and no tool calls is separate, including later parent follow-ups to the same question. Worker/custom reports, tool results, thinking, tool-use commentary and aborted/error/length stops are excluded according to Pi's message contract.

Context replacements/deletions apply before indexing. Compaction does not erase saved branch entries: excluded prompts and finals render as labelled **Saved user** or **Saved agent** Markdown above the native conversation, without restoring them to model context. Existing native prompts and replies are located only by unique message identity (user prompts by entry ID, finals by message object); ambiguous/wrapped/edited renderings use an explicit saved copy instead of guessing by text. Expanded thinking is skipped to expose the final body.

No new database, dependencies, provider calls, settings changes, tree navigation, report acknowledgements or worker actions. Shared model history and the native layout root remain Pi-owned. The index and filter are in memory; no `rg`, `grep`, session-file scan or cross-branch read runs.

## Compatibility and bounds

The adapter validates the current fullscreen primary viewport/document structure instead of gating on a Pi version. Pi has no public scroll-to-entry API, so an unknown layout fails closed when `/replies` is invoked, not with an unsolicited compatibility warning at startup. Unexpected data/rendering errors still report failures.

The existing root, primary viewport and editor/footer dock are reused. Only a UI-history prefix extends the transcript document. A zero-height widget supplies the native TUI reference and lifecycle checks; it draws no controls. Cleanup restores only owned document/overlay state and preserves foreign dialogs. Regular-screen mode does not support the navigation command.

Bounds: last 20,000 branch entries, all candidate prompts/replies within the branch, 65,536 UTF-16 code units per item, 2,097,152 total text code units, 256 content parts, 4,096 inspected native nodes, depth 12 and 100,000 rendered history rows. These are work/text bounds, not a process-memory ceiling. Refresh is coalesced at 50 ms; archived lines are cached between changes. Saved copies use standard themed Markdown, not arbitrary third-party assistant rendering.

## Verify

```sh
node --test agent/extensions/replies/*.test.ts
node --test agent/extensions/docket/*.test.mjs agent/extensions/message-board/*.test.mjs agent/extensions/god/tests.test.mjs
```

Tests use the installed SDK (`PI_PACKAGE_ROOT` can override its default global npm location) and existing `python3`. The actual-CLI check creates an isolated offline home/config/session/PTY with no inherited credentials or model prompt. An oversized historical message proves quiet clipping; keyboard/mouse navigation, compacted history, editor focus and native reload are exercised while the actual session file stays byte-identical. A fixture-only widget records editor readiness, direct-viewport layout and overlay presence; it is never installed in the live profile. This is not universal terminal/provider/extension or accessibility certification.
