# Session Context Import

Global Pi extension that adds `/import-session`.

It lets the user select another Pi session, creates a bounded deterministic summary of that session's active context, previews it for editing, and imports the confirmed result into the current session.

## Commands

```text
/import-session
/import-session <session-id-or-name>
/import-session "/absolute/path/to/session.jsonl"
/import-session --path "/absolute/path/to/session.jsonl"
/import-session --all <session-id-or-name>
/import-session --cwd ~/work/project <session-id-or-name>
/import-session --fast <session-id-or-name>
/import-session --deep <session-id-or-name>
/import-session --refresh <session-id-or-name>
```

A full `.jsonl` path is opened directly and does not require `--all`; this works even when the source session belongs to another project directory. The default mode uses the current Pi model to produce a compact structured Project State. Large sessions can be processed with bounded chunks and a final merge. Results are cached by source session state, model, and mode.

`--fast` skips the model and uses deterministic extraction. `--deep` preserves more historical evidence and may use multiple bounded model calls. `--refresh` bypasses a cached summary.

The extension never raw-merges JSONL histories, switches sessions, replays commands, or modifies the source session. Imported context is appended through Pi's official `sendMessage` path as a hidden `custom_message` delivered on the next turn.

The design is inspired by [`pi-session-merge`](https://github.com/robbirob/pi-session-merge) and [`pi-session-handoff`](https://pi.dev/packages/pi-session-handoff?name=context&page=8), but this implementation is local and dependency-free.
