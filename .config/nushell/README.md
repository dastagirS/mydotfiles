# Nushell

Shared `nu` login-shell config for macOS and Linux. One source, two platforms;
each machine links these files into the directory nushell actually reads.

| File | Purpose |
| --- | --- |
| `env.nu` | `PATH` and `PNPM_HOME`, branched on `$nu.os-info.name` |
| `config.nu` | Editor/prompt/history/table settings, plus starship hook regeneration |

## Link, don't copy

```sh
# macOS: $nu.default-config-dir
mkdir -p "$HOME/Library/Application Support/nushell"
ln -sfn ../../../dotfiles/.config/nushell/env.nu "$HOME/Library/Application Support/nushell/env.nu"
ln -sfn ../../../dotfiles/.config/nushell/config.nu "$HOME/Library/Application Support/nushell/config.nu"

# Linux: $nu.default-config-dir
mkdir -p "$HOME/.config/nushell"
ln -sfn ../../dotfiles/.config/nushell/env.nu "$HOME/.config/nushell/env.nu"
ln -sfn ../../dotfiles/.config/nushell/config.nu "$HOME/.config/nushell/config.nu"
```

Files are linked individually, never the directory: on macOS `$nu.data-dir` is the
same directory as the config dir, so it also holds `history.sqlite3`. Linking the
directory would pull runtime state into this repo.

`starship.nu` is generated per machine by `config.nu` into `$nu.user-autoload-dirs`
(`$nu.data-dir/autoload`), because the hook hardcodes the absolute starship path
for that platform. Never tracked; delete it to force regeneration.

## Make it the login shell

`chsh` refuses shells missing from `/etc/shells`, so add the binary first:

```sh
# macOS
sudo sh -c 'echo /opt/homebrew/bin/nu >> /etc/shells' && chsh -s /opt/homebrew/bin/nu

# Linux
echo "$(command -v nu)" | sudo tee -a /etc/shells && chsh -s "$(command -v nu)"
```

Rollback: `chsh -s /bin/zsh` (macOS) or `chsh -s "$(command -v zsh)"` (Linux).
