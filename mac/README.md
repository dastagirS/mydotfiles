# macOS-only helpers

Scripts here are macOS-specific and linked into `~/.local/bin`, which is already on `PATH`. The
repository stays the source of truth; nothing is copied.

## dockctl

Hides the Dock completely and restores exactly what was there before.

Dock.app cannot be unloaded: it is SIP-protected and launchd restarts it within a second. Verified
on macOS 27.2.1 (build 26B131), where `autohide-delay` alone is not enough — the pointer at the
screen edge still revealed it. So `dockctl off` uses two layers:

| Mode | Settings | Process | Hover reveal |
| --- | --- | --- | --- |
| `off` | `autohide`, `autohide-delay` 1000, animation 0 | `SIGSTOP`ped | impossible — the process cannot run its edge detection |
| `off --soft` | same | running | delayed ~17 minutes, may still fire |

Cost of the hard mode: Mission Control, Launchpad and Dock clicks stop responding, because Dock.app
hosts them. A reboot, or `dockctl on`, brings them back. Spaceman's own three-finger workspace swipe
is unaffected.

Minimized windows live in the Dock, so `Cmd+M` strands them. Use `Cmd+H`. Drag-to-Trash is gone too:
`Cmd+Backspace` in Finder.

```sh
dockctl off        # freeze Dock.app; nothing can reveal it
dockctl off --soft # hide by preference only
dockctl status     # visible | auto-hide | never appears (delay only) | never appears (frozen)
dockctl on         # SIGCONT, restore saved settings, restart the Dock
```

The three `com.apple.dock` keys are captured on the first `off` into
`~/Library/Application Support/dockctl/state.properties` and never overwritten, so `on` restores
what you actually had rather than a re-captured intermediate state. A reboot leaves the saved
settings in place but unfreezes the Dock, so run `dockctl off` again after logging in.

Install:

```sh
ln -sfn "$HOME/dotfiles/mac/bin/dockctl" "$HOME/.local/bin/dockctl"
```
