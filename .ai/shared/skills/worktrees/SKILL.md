---
name: worktrees
description: Manage isolated development workspaces with Git worktrees by default, Rift on Linux Btrfs, and macOS copy-on-write folder copies. Use when the user asks to create, inspect, list, switch between, or remove a workspace for a repository or feature.
---

# Worktrees

For creation, choose the backend from the source checkout's platform and filesystem. For inspection or removal, identify the existing workspace's actual backend; never convert or move it merely because the current platform's creation default differs:

| Environment | Backend | Destination |
| --- | --- | --- |
| macOS | `cp -cR` for directories; `cp -c` for files | `~/.worktrees/{projectname}/{worktreename}` |
| Linux, source checkout on Btrfs | Rift | Rift's own managed layout |
| Other environments, or filesystem not confirmed as Btrfs | Git worktrees | `~/.worktrees/{projectname}/{worktreename}` |

Use `uname -s` to identify the platform. On Linux, check the actual source path with `findmnt -no FSTYPE -T "$source"`; do not infer its filesystem from another mount. If the probe is unavailable, disclose that and use the Git default. Do not install detection tools.

## Before creation

- Confirm the source checkout, project name, workspace name, and intended branch/ref. Inspect its Git status without changing it; never stash, reset, or commit source work automatically.
- Validate project/workspace names as single path components. Reject empty names, `.`/`..`, path traversal, path separators, and leading `-`. Quote all paths. Resolve the source and destination parent to their real locations before containment/filesystem checks.
- For Git and macOS only, set `target="$HOME/.worktrees/$project_name/$worktree_name"`. Require a new, non-symlink destination outside the source tree; never merge into or overwrite an existing path. Create only its parent directory.
- Read applicable hooks/configuration before running commands that may execute them. Do not install dependencies or skip hooks automatically.

## Git default

A Git worktree starts from a Git ref, not a copy of the source's dirty or ignored files. Make that distinction clear when the user expects their working-folder state or dependencies to carry over.

Create a new branch from the agreed ref:

```sh
mkdir -p "$HOME/.worktrees/$project_name"
git -C "$source" worktree add -b "$branch_name" "$target" "$start_ref"
```

For an existing branch, omit `-b` and use that branch as the final argument. Check branch validity and whether it is already checked out; do not force, detach, or invent a branch strategy to bypass a conflict. If creation fails, inspect the result before retrying.

Verify with `git -C "$source" worktree list --porcelain` and Git status in the new path. Keep the original checkout untouched.

## Linux Btrfs: Rift

Check `command -v rift`. If missing, stop and ask the user to install Rift; **never install it yourself** or silently fall back to another backend. [Rift documentation](https://github.com/anomalyco/rift).

Before `rift init`, confirm the exact target and authorization: initializing an ordinary Btrfs directory can convert/swap its filesystem layout. Inspect `.rift.toml` because lifecycle hooks execute code. Do not bypass hooks without approval.

From the selected source, initialize only if needed, then create:

```sh
rift init --here
rift create --name "$worktree_name" --copy-all
```

Rift owns its workspace paths. **Do not pass `--into` or relocate its folders to `~/.worktrees`.** Capture and use the path Rift prints rather than predicting it. Retain `--copy-all` unless the user explicitly requests a filtered copy. Verify Git status and branch state; Rift copies can have detached HEADs and preserve dirty source state.

If a hook or creation fails, inspect `rift list`/`rift ancestors` and the reported path before retrying: a workspace may already exist. Do not infer cleanup permission from a failed command.

## macOS: copy the working folder

Use a self-contained checkout with a real `.git` directory. If `.git` is a pointer/symlink, Git metadata is shared or external, or the checkout records other linked worktrees, stop and ask for a safe alternative rather than copying those references. Inspect external symlinks/submodules before copying; copied links can still refer outside the new folder. Copy only a stable source; coordinate concurrent writers rather than stopping unrelated processes or claiming a consistent snapshot during writes.

Confirm the source and destination parent are on the same APFS filesystem, using macOS filesystem metadata such as `diskutil info`. `cp -c` can fall back to a full copy on an unsupported or different filesystem; if clone eligibility cannot be confirmed, ask before proceeding. Do not claim physical block sharing merely because the command succeeded.

For a directory, copy the whole working folder, including hidden and ignored files:

```sh
mkdir -p "$HOME/.worktrees/$project_name"
cp -cR "$source" "$target"
```

For an individual file, use `cp -c "$source" "$target"`. Never substitute hard links or retry without `-c` automatically. A failed recursive copy may leave a partial destination: report it and inspect before retrying.

A copied repository is an independent checkout, not a registered Git worktree. Before editing it, verify its Git directory/common directory resolve inside the copy and inspect its status; do not switch the source branch or alter source Git metadata. Do not claim a new branch was created by the copy.

## Inspect and remove

- Git: use `git worktree list --porcelain`; remove only the identified workspace with `git worktree remove "$target"`. Never force removal of dirty work or blindly prune registrations.
- Rift: use `rift list` and `rift ancestors`; remove only the identified created workspace with `rift remove`. Do not remove the source root or unrelated descendants. `rift gc` permanently deletes trash and requires explicit user intent.
- macOS copies: inspect the exact copied path and Git status. Remove only that identified copy after checking for uncommitted/untracked work, active processes, and user authorization; do not use `git worktree remove` for it.

Never remove active work, run wildcard cleanup, or delete another workspace as a recovery shortcut. Report the backend, actual path, branch/state, and checks performed. Do not create a workspace merely because this skill was loaded.
