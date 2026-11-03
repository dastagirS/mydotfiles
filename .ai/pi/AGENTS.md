# Pi Agent Workspace

Personal Pi coding agent configuration. Shared coding and communication rules are generated globally into `agent/SYSTEM.md`.

## Structure

```
~/.pi/
├── AGENTS.md                # This file — pi context
├── agent/
│   ├── settings.json        # Provider, model, theme, packages
│   ├── cloak.json           # Secret masking patterns
│   ├── auth.json            # Credentials
│   ├── SYSTEM.md            # Generated shared prompt rules
│   ├── extensions/
│   │   ├── pi-cloak/        # Secret cloaking extension
│   │   ├── web-tools/       # webfetch + websearch tools (Exa MCP)
│   │   ├── save-md/         # /save-md command
│   │   ├── god/             # /god session toggles + Telegram completion tool
│   │   └── message-board/   # Parent-owned RPC workers + durable upward reports
│   ├── skills/              # Agent skills (SKILL.md)
│   │   ├── agent-browser/
│   │   ├── grill-with-docs/
│   │   ├── improve-codebase-architecture/
│   │   ├── index-knowledge/
│   │   ├── code-reviewer/    # Includes references/over-engineering.md
│   │   └── subagent/         # Parent-only RPC delegation protocol
│   ├── prompts/             # Prompt templates (/commands)
│   │   ├── code-reviewer.md
│   │   ├── the-architect.md
│   │   ├── grill-with-docs.md
│   │   ├── improve-codebase-architecture.md
│   │   └── index-knowledge.md
│   └── npm/                 # Auto-managed packages
```

## Where to Look

| Task | Location |
|------|----------|
| Change default model/provider | `agent/settings.json` |
| Add API key | `agent/auth.json` |
| Add a package | `agent/settings.json` → `packages[]` |
| Run a skill | `/skill:name` (e.g., `/skill:code-review`) |
| Use a prompt template | `/template-name` (e.g., `/code-reviewer`) |
| Save assistant response | `/save-md <name>` |
| Web search / fetch | `websearch` / `webfetch` (native LLM tools) |
| Fuzzy file search | `fffind` / `ffgrep` (FFF-powered) |
| Check cloak status | `/cloak-status` |
| Toggle session features | `/god` (Telegram completion notifications) |
| Delegate approved tasks | `/skill:subagent`; `agent/extensions/message-board/README.md` |
| Inspect worker board | `/board status` (current parent session only) |

## Shared Configuration

- Edit common rules in `~/.ai/shared/AGENTS.md`; portable skills live in `~/.ai/shared/skills/` and are symlinked into both clients.
- `~/.pi/AGENTS.md` is a symlink to this canonical workspace document, `~/.ai/pi/AGENTS.md`; edits need no rebuild.
- Run `python3 ~/.ai/build.py` after shared-rule or OpenCode instruction edits; `--check` detects stale generated files without rewriting them. Do not edit generated instruction files directly.
- Run `python3 ~/.ai/build.py --links` to create or normalize managed relative links; add `--check` to verify without changing generated files or links. Unrelated entries are never replaced.
- Docket/subagent remain Pi-only. Shared rules already load through Pi's existing `agent/SYSTEM.md`; do not duplicate them in a second global context file.
