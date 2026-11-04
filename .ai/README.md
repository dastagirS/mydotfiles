# Shared Pi / OpenCode configuration

Canonical shared rules and portable skills live directly in `~/.ai/shared/`. No dotfiles repository or background synchronizer is required.

## Edit here

| Source | Purpose |
| --- | --- |
| `shared/AGENTS.md` | Common safety, coding, testing, commit-review and communication rules |
| `shared/skills/<directory>/` | One copy of each portable skill, including all original resources |
| `pi/AGENTS.md` | Pi workspace-specific paths and instructions |
| `opencode/AGENTS.md` | OpenCode-specific tool syntax and runtime restrictions |

After changing shared rules or OpenCode-specific instructions:

```sh
python3 ~/.ai/build.py
python3 ~/.ai/build.py --check
```

To create missing managed links or convert existing links to relative targets:

```sh
python3 ~/.ai/build.py --links
python3 ~/.ai/build.py --links --check
```

The script locates its sources beside `build.py` and locates client files using `Path.home()`. Source checkout and home directory need not have the same parent. Generated headers use paths relative to their output file, not a username or absolute source location. For relocation without rebuilding, keep the same relative layout between the sources and client directories.

`--links` manages only the Pi workspace alias and links for directories currently in `shared/skills/`. It refuses real files/directories or symlinks pointing somewhere else. It neither deletes stale entries nor changes unrelated links. Link conflicts are checked before generated files are written. File generation and link installation are separate rollback groups, not one cross-filesystem transaction.

The builder generates these files; do not edit them directly:

- `~/.pi/agent/SYSTEM.md`: shared rules, using Pi's existing global system-prompt hook.
- `~/.config/opencode/AGENTS.md`: OpenCode-specific instructions plus shared rules.

`~/.pi/AGENTS.md` is a direct symlink to `~/.ai/pi/AGENTS.md`, not a generated copy. Editing that Pi workspace document needs no rebuild. Normal builds leave this link alone; `--links` creates or normalizes it. Setup tests verify its relative target and canonical source.

Shared rules therefore apply globally in Pi, not just while working inside `~/.pi`. Do not add a second global Pi `AGENTS.md` containing the same rules. The existing system-prompt override remains an override; this migration does not change how Pi chooses its prompt.

The builder validates both generated files' sources before writing, caps text at 128 KiB per file, preserves existing output permissions, skips unchanged files, writes each replacement atomically, and attempts rollback if a write fails. Concurrent builds fail immediately instead of waiting. Atomic replacement is per file, not an atomic multi-file transaction; rollback failures are explicitly reported. Initial originals remain under `backups/shared-*/`.

## Skills

Both clients retain their existing skill paths, now symlinked to `shared/skills/`. Edit the shared original. Skill descriptions already loaded into a client may require a manual reload or new session. No reload, provider call or worker action runs automatically.

Docket/subagent stay Pi-only. OpenCode's skill directory must match the shared portable Pi collection, with no legacy-only additions. The old ponytail-review/spec-builder/spec-planner skill copies and their matching command wrappers were archived outside discovery. Lumyx was removed from OpenCode's provider configuration. Other client-specific commands, reference prompts, disabled custom agents, permissions, plugins, MCP configuration, packages, credentials and runtime data remain separate.

To add a portable skill, create its complete directory under `shared/skills/`, then run `python3 ~/.ai/build.py --links` to link it into both clients' existing `skills/` folders. Use the same directory ID in both clients; OpenCode skill IDs and Pi display names/tool syntax are not interchangeable. Do not put a Pi-specific protocol in shared discovery merely because its Markdown is readable elsewhere.

## Verify

```sh
python3 -m unittest discover -s ~/.ai -p 'test_*.py' -v
python3 ~/.ai/build.py --check
```

Builder tests use disposable homes and cover composition, read-only checks, shared edits, invalid inputs, target symlinks, idempotence, atomic-write cleanup, write-failure rollback, safe relative link creation, link rollback, an alternate-home CLI run and moving the entire home directory. Setup tests inspect the installed links, generated output, Pi-only exclusions and original dashboard assets. Migration evidence, original hashes/modes and detailed diffs are retained with the initial backup. These checks are not model/provider or universal-client compatibility certification.
