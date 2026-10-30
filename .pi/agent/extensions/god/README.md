# /god — session features

Open `/god` in Pi's interactive TUI. Enter toggles **Telegram notify**; Escape closes the modal. Changes apply immediately and are recorded as `god-settings` custom session entries, not LLM messages.

New sessions start disabled. Resuming/reloading a session restores its setting; session-tree navigation restores the selected branch's setting. Forks inherit the setting recorded on their branch. Nothing is saved as a global notification preference.

## Telegram configuration

Provide `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` only in Pi's agent-directory `.env`, normally `~/.pi/agent/.env`. The extension resolves this directory using Pi's `getAgentDir()` API, respecting `PI_CODING_AGENT_DIR` for isolated/custom Pi configurations. Exported Telegram variables and project-root `.env` files are ignored, so changing the session's working directory cannot change the notification destination. This extension reads only those two keys for its configuration and does not populate `process.env` or modify the file.

The bot must be added to the target channel with permission to post. The channel ID can be a numeric ID (usually `-100…`) or a public `@channel_username`.

Keep `.env` out of version control and restrict its permissions. This loading is specific to the Telegram extension; it does not make Pi load arbitrary environment variables globally. Do not paste the token into chat.

## Behavior

When enabled, `telegram_notify` is declared only to the model with a required `message` and optional `attachments` array. Its active-tool guidelines instruct the model to notify once on task completion, summarizing what was built/changed, outcome, verification, and blockers, optionally attaching task deliverables. No credentials, raw code, private personal data, or sensitive tool output should be included. Intermediate progress and clarification questions do not trigger notifications.

## Attachments

Each attachment specifies `path` (absolute or relative to Pi's working directory) and `type` (`image`, `video`, or `document`). Images use Telegram's `sendPhoto`, videos use `sendVideo`, and other files use `sendDocument`. Videos should be Telegram-compatible MPEG4; unsupported media can be sent as documents. Telegram performs final media-format validation.

Example tool arguments:

```json
{
  "message": "Built the dashboard; checks passed. Screenshot and report attached.",
  "attachments": [
    { "path": "output/dashboard.png", "type": "image" },
    { "path": "output/demo.mp4", "type": "video" },
    { "path": "output/report.html", "type": "document" }
  ]
}
```

Limits: at most 10 files, 10 MB per image, 50 MB per video/document, and 50 MB total per notification (decimal MB). Empty/non-regular files and overlong paths are rejected. All files are fully read and validated before sending the summary; uploaded bytes are the validated snapshot, not later changes to the file. Files are sent separately and sequentially, not as an album.

Paths containing `.env` or `.env.*` components are rejected, case-insensitively, including symlinks resolving to them. **No dedicated-folder restriction or general attachment secret scanner is implemented. Other files can contain secrets; filtering names does not guarantee safe content.** Only attach intended deliverables.

This is **LLM-invoked**, not an automatic `agent_end` hook. The model can omit the call; failed or interrupted tasks may not produce an update.

Disabled tools are hidden and reject stale calls. Disabling also cancels an in-flight request, but cannot retract a message Telegram already received. Bot token/channel configuration never appears in the tool schema, result, or instructions. Exact configured bot tokens and common Telegram bot-token patterns are refused in messages; arbitrary sensitive content cannot be guaranteed safe by pattern detection, so the model must follow the content policy.

Summaries are plain text, capped at 4,096 characters, with Telegram content protection enabled on the summary and each upload. Each prompt permits at most one notification-batch attempt. Summary requests have a 10-second timeout; uploads have a 60-second timeout; the whole notification, including attachment preparation, has a 120-second deadline. No redirects or automatic retries; response bodies are bounded.

An invalid attachment prevents the entire notification from starting. Once sending starts, a failure stops remaining uploads and reports whether the summary and how many files were confirmed. The last request may have arrived despite a timeout or network failure; already-delivered messages are not rolled back. Disabling cancels remaining work, not messages already received.

## Tests

From `~/.pi`:

```sh
node --test agent/extensions/god/tests.test.mjs
```

Tests use the already-installed Pi runtime and mocked network calls. If installed elsewhere, set `PI_PACKAGE_ROOT` to the Pi package directory. No dependencies are installed and no Telegram messages are sent.
