---
name: worktrees
description: Manage isolated copy-on-write development workspaces with the Rift CLI. Use when the user wants to create, inspect, list, switch between, or remove isolated workspaces for a repository or feature.
allowed-tools: Bash(rift:*)
---

# Workspaces with Rift

Rift is an experimental alternative to Git worktrees. It creates copy-on-write or reflink-backed workspaces, which are fast and save disk space while keeping work isolated.

Use Rift only when the user wants an isolated workspace. Do not substitute Rift for ordinary Git branching or `git worktree` without explaining the difference.

**Source documentation:** <https://github.com/anomalyco/rift>

## Setup

### Install

Install the CLI using one of the documented methods:

```bash
npm install -g rift-snapshot
# or
bun add -g rift-snapshot
```

Release archives are available from the [latest GitHub release](https://github.com/anomalyco/rift/releases/latest).

Before using it, verify the command exists:

```bash
rift --help
```

Do not install packages automatically unless the user requested installation or the environment's setup workflow explicitly allows it.

### Platform support

- **Linux x64:** writable btrfs snapshots or native per-file reflinks.
- **macOS x64/arm64:** APFS `clonefile`.
- **Windows x64:** the package is published, but workspace creation is not implemented.

Rift is experimental. Mention this before initializing a repository when the user has not used Rift before.

## Core workflow

### 1. Initialize a source workspace

From the repository or directory to manage:

```bash
cd ~/code/app
rift init
```

`rift init` searches upward for an existing Rift root. If none exists, it selects the nearest Git root. Use `--here` to initialize exactly the selected directory:

```bash
rift init --here
```

Initialization can be destructive to the filesystem layout on Linux btrfs: the first initialization of an ordinary btrfs directory imports it into a new btrfs subvolume and swaps it into the same path. On other platforms it registers the directory in place after checking clone/reflink support.

Before running `rift init`:

1. Confirm the target path.
2. Confirm the user wants Rift metadata and filesystem initialization there.
3. Check for uncommitted work or backups when the platform may convert the directory.

If the target is already registered but `.rift` is missing, `rift init` restores the marker and completes required setup.

### 2. Create a workspace

Create a child workspace from an initialized Rift root. Always include `--copy-all` so dependencies, caches, and build artifacts are retained unless the user explicitly requests a filtered copy:

```bash
rift create --name foo --copy-all
rift create --name foo --copy-all --into /fast/rifts
```

Capture the path printed to stdout. Do not predict or reconstruct the workspace path.

Example:

```bash
workspace_path="$(rift create --name parser-fix --copy-all)"
printf 'Created workspace: %s\n' "$workspace_path"
cd "$workspace_path"
```

Rift normally omits heavyweight regenerable artifacts such as `node_modules`, `target`, virtual environments, framework caches, `dist`, `build`, and `coverage`. This skill defaults to `--copy-all` to retain those files along with manifests and lockfiles, avoiding dependency reinstalls and rebuilds in the new workspace. Copying everything can increase disk usage and creation time.

Use `--no-hooks` only when the user explicitly wants to skip configured hooks:

```bash
rift create --name parser-fix --copy-all --no-hooks
```

When the source is a Git repository, the created workspace has a detached `HEAD` and retains the source index and working-tree state. Explain this before creating a workspace when the user expects normal branch behavior.

### 3. Inspect workspaces

List direct active children of the current Rift workspace:

```bash
rift list
```

List parent workspaces, nearest first:

```bash
rift ancestors
```

Use these commands instead of guessing the parent/child relationship or workspace path.

### 4. Work inside the created workspace

After creation, run commands with the captured workspace path:

```bash
cd "$workspace_path"
git status --short
git branch --show-current
git diff
```

A created workspace is a separate filesystem location, but it is not necessarily a normal Git branch checkout. Check its detached-HEAD state and current status before making changes.

### 5. Remove workspaces

Remove the current created Rift subtree:

```bash
rift remove
```

Remove a specific created workspace and skip its hooks:

```bash
rift remove --no-hooks /path/to/workspace
```

Remove descendants while preserving the selected source workspace:

```bash
rift remove --children /path/to/source
```

Removing a created workspace moves its active subtree into adjacent `.trash` storage. It is not immediately physically deleted.

Removing a source root requires `-f`:

```bash
rift remove -f /path/to/source
```

This leaves the source directory on disk, removes its `.rift` marker, and moves registered descendants to trash.

### 6. Garbage-collect removed workspaces

Physically delete trashed workspaces and prune missing registry entries:

```bash
rift gc
```

`rift gc` is destructive and may be irreversible. Require explicit user intent before running it. Do not combine removal and garbage collection unless the user specifically asks for permanent cleanup.

## Hooks

If the source contains `.rift.toml`, Rift can run hooks during lifecycle operations:

```toml
version = 1

[[hooks.precreate]]
run = "pnpm run check"

[[hooks.postcreate]]
run = "pnpm install --frozen-lockfile"

[[hooks.postcreate]]
run = "pnpm run codegen"
```

Hook locations:

- `precreate` runs in the source workspace before creation.
- `postcreate` runs in the new workspace after it is registered and prepared.
- `preremove` runs in the selected workspace before removal.
- `postremove` runs after removal, from the moved trash directory when the selected workspace was trashed, or from the selected workspace when it was preserved.

A failing `precreate` hook prevents creation. A failing `postcreate` hook leaves the workspace registered and makes `rift create` exit with an error.

Treat hooks as arbitrary code execution. Inspect `.rift.toml` before creating or removing a workspace when hooks are present. Use `--no-hooks` only as an intentional choice, not as a default workaround.

## Shell integration

For zsh or bash:

```bash
eval "$(rift shell-init zsh)"
# or
eval "$(rift shell-init bash)"
```

For Nushell:

```nu
rift shell-init nushell | save -f (($nu.user-autoload-dirs | first) | path join "rift.nu")
```

The shell wrapper changes directory after initialization, creation, or removal of the current created workspace. Without shell integration, a subprocess cannot change the parent shell's directory; use the captured path and `cd` explicitly.

## Storage and registry

Each managed workspace has a `.rift` marker containing its identifier. Rift stores paths, parent identifiers, and trash entries in an SQLite registry.

The default layout is adjacent to the registered source root:

```text
~/code/app/                         source workspace
~/code/.rifts/app/parser-fix/      created workspace
~/code/.rifts/app/.trash/           removed workspace storage
```

Use `--into` when the user explicitly wants workspace storage elsewhere:

```bash
rift create --name parser-fix --copy-all --into /fast/rifts
```

## Safety rules

- Confirm the target before `rift init`; initialization may alter filesystem layout on Linux btrfs.
- Default to `--copy-all`; omit it only when the user explicitly requests a filtered copy.
- Inspect `.rift.toml` before running operations that may execute hooks.
- Capture and use Rift’s printed workspace path; never infer it from naming conventions.
- Do not assume a created workspace has a branch; check for detached `HEAD`.
- Treat `rift remove -f` as source-root metadata removal, not source-directory deletion.
- Treat `rift gc` as permanent cleanup and require explicit confirmation.
- Do not close or remove a workspace the user did not identify.
- Keep workspaces with active work intact unless the user explicitly asks to remove them.

## Troubleshooting

### `rift create` cannot find a root

Initialize the intended source directory first:

```bash
cd /path/to/repository
rift init --here
rift create --name feature-name --copy-all
```

### Creation is unavailable on Windows

Rift's documented Windows backend does not implement workspace creation. Use a supported platform or ordinary Git worktrees instead.

### A hook fails

Read the error and inspect `.rift.toml`. The workspace may remain registered after a failed `postcreate` hook. Do not immediately remove it; first determine whether the hook needs to be rerun, skipped intentionally, or fixed.

### A workspace is missing from `rift list`

Use both commands to distinguish an inactive child from a parent relationship:

```bash
rift list
rift ancestors
```

If a registered path is missing, `rift gc` can prune missing entries, but only after confirming that the missing workspace is no longer needed.

## JavaScript API

For Bun or Node integrations, Rift exposes:

```ts
import { ancestors, create, gc, init, list, remove } from "rift-snapshot";

init({ at: process.cwd() });
const workspace = create({ from: process.cwd(), name: "schema-work", copyAll: true });
console.log(list({ of: process.cwd() }));
console.log(ancestors({ of: workspace }));
remove({ at: workspace });
gc();
```

The Node binding requires Node.js 26.1 or later with experimental FFI enabled:

```bash
node --experimental-ffi app.mjs
```

With Node's permission model, also pass `--allow-ffi`.

Operation failures throw `RiftError` with a `code` and, when relevant, a `path`.
