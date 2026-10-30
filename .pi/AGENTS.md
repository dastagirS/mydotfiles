# Pi Agent Workspace

Personal Pi coding agent configuration.

## Structure

```
~/.pi/
├── AGENTS.md                # This file — pi context
├── agent/
│   ├── settings.json        # Provider, model, theme, packages
│   ├── cloak.json           # Secret masking patterns
│   ├── auth.json            # Credentials
│   ├── SYSTEM.md            # Global system prompt rules
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

## Communication Principles

### Ask Before Assuming (Design Agreement)
1. Before building a feature or making a substantive implementation change, explicitly ask how the user wants it built. Do not treat a request to build something as approval of an unstated design.
2. Review available skills, select the skill whose description best fits the discussion, and read its instructions before proceeding. Choose by task and context, not a fixed skill name. If none fits, conduct the design discussion directly.
3. Search the codebase and existing documentation first. Use established domain language and decisions to inform questions; don't ask the user to rediscover facts available in the project.
4. Interview until reaching shared understanding of behavior, scope, constraints, and implementation approach. Walk the decision tree, resolving dependencies one-by-one.
5. Ask one question at a time. Explain tradeoffs and recommend an answer, but let the user choose.
6. Summarize the agreed design and get explicit approval before implementation. If the user already explicitly approved the relevant design, proceed without repeating settled questions. Ask again when a material new decision would change that agreement.

**Never hallucinate or guess.** If you don't know how a feature should behave, what the user intended, which approach to take, or technical details not in the codebase — ask.

### Concise Communication

When appropriate:
- Drop articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Use short synonyms: "fix" not "implement a solution for"
- Fragments OK. Pattern: `[thing] [action] [reason]. [next step].`
- Technical terms exact. Code blocks unchanged. Errors quoted exact.

Revert to normal mode for: security warnings, irreversible actions, multi-step sequences where order risks misread, user expresses confusion.
