# Nushell environment, loaded before config.nu. Shared by macOS and Linux.
#
# Nushell never reads .zshrc/.zshenv, so every PATH entry those files used to add
# is reproduced here. The list is explicit instead of inherited, because macOS
# and Linux otherwise resolve different versions of the same tool.

let home = $env.HOME

# Homebrew lives in different prefixes per platform; everything after this point
# is identical.
let package_prefixes = if $nu.os-info.name == "macos" {
    ["/opt/homebrew/bin" "/opt/homebrew/sbin"]
} else {
    ["/home/linuxbrew/.linuxbrew/bin" "/home/linuxbrew/.linuxbrew/sbin"]
}

# pnpm moved its home between the two platforms' installers.
$env.PNPM_HOME = if $nu.os-info.name == "macos" {
    $"($home)/Library/pnpm"
} else {
    $"($home)/.local/share/pnpm"
}

$env.PATH = (
    $env.PATH
    | prepend (
        $package_prefixes
        | append [
            $env.PNPM_HOME
            $"($home)/.local/bin"
            $"($home)/.opencode/bin"
            $"($home)/.cargo/bin"
            $"($home)/.spicetify"
        ]
    )
    | uniq
)

$env.PAGER = "less"
