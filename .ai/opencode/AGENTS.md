# OpenCode Workspace

Personal OpenCode configuration. Shared coding and communication rules are generated from `/home/ichigo/.ai/shared/AGENTS.md`; runtime-specific instructions below describe OpenCode, not Pi.

## Locations

| Location | Purpose |
| --- | --- |
| `opencode.jsonc` | Existing providers, permissions, plugins and MCP configuration; unchanged by this sync |
| `skills/` | Symlinked shared skills and their original resources, plus the existing command's updated ponytail-review compatibility skill |
| `prompts/` | Reference-only prompt templates; not registered as commands |
| `agent/*.md.bak` | Disabled custom subagent definitions |
| `command/`, `commands/` | Existing command definitions; unchanged |

## Runtime and delegation boundaries

- Do not delegate automatically. Do not invoke helper, browser, architecture or review agents merely because an old description says to do so.
- Perform routine code review, blast-radius assessment and complexity review directly in the current parent agent. Do not delegate code review.
- Any other delegation requires explicit user agreement on its task, scope and model. Availability of a bundled agent is not authorization to invoke it.
- The four custom subagent profiles are disabled as `.md.bak`. This does not remove OpenCode's bundled agents or terminate running sessions.
- Pi's managed `subagent`/message-board and `docket` skills are not active here: their Pi tools have not been integrated. Do not substitute OpenCode's native subagent tool for the Pi RPC protocol or invent missing tools.
- Load skills through OpenCode's available skill tool using the directory ID, for example `skill({ id: 'code-reviewer' })`. Display names can differ: `code-reviewer` displays as `code-review`; `ffframes` displays as `fframes-video`.
- Use only tools actually available in this OpenCode session. Pi extensions, shortcuts, prompt commands and secret-cloaking behavior are not implicitly installed by copying Markdown.
- Prompts in `prompts/` are reference files only. Existing command definitions have deliberately not been updated or enabled by this sync.

## Shared Configuration

Edit common rules in `/home/ichigo/.ai/shared/AGENTS.md` and OpenCode-specific instructions in `/home/ichigo/.ai/opencode/AGENTS.md`. Run `python3 /home/ichigo/.ai/build.py` after instruction edits. This client's generated `AGENTS.md` is not an editable source. Portable skill directories link to `/home/ichigo/.ai/shared/skills/`; do not make local copies.
