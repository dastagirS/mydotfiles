# Nushell config, loaded after env.nu. Shared by macOS and Linux.
#
# Every assignment is granular: real defaults live in nushell's Rust source, not
# in an editable config file, so replacing whole records here would silently drop
# settings this file does not mention.

$env.config.show_banner = false
$env.config.edit_mode = "emacs"
$env.config.history.file_format = "sqlite"
$env.config.history.max_size = 100_000
$env.config.history.sync_on_enter = true
# Keeps a command out of sqlite history when prefixed with a space, so one-off
# tokens and passwords don't get written to disk.
$env.config.history.ignore_space_prefixed = true

# macOS ships a native trash. Linux only redirects rm to the trash when
# trash-cli is installed, and hard-fails otherwise, so this stays macOS-only.
if $nu.os-info.name == "macos" { $env.config.rm.always_trash = true }

# Ctrl-O hands the current command line to this editor.
$env.config.buffer_editor = "nvim"

$env.config.table.mode = "rounded"
$env.config.table.index_mode = "never"
$env.config.error_style = "fancy"
$env.config.use_ansi_coloring = true
$env.config.filesize = { unit: "metric", show_unit: true, precision: 1 }
$env.config.datetime_format = { normal: "%Y-%m-%d %H:%M", table: "%Y-%m-%d" }

# fish-style expansions: typed bare and expanded on the following space.
$env.config.abbreviations = {
    gs: "git status --short --branch"
    gd: "git diff"
    gl: "git log --oneline --graph --decorate --max-count=20"
    ll: "ls -la"
}

$env.config.completions.case_sensitive = false
$env.config.completions.quick = true
$env.config.completions.partial = true
$env.config.completions.algorithm = "prefix"
$env.config.completions.use_ls_colors = true

# Prompt. Starship's output hardcodes this platform's starship path, so it is
# generated per machine and never committed. It goes in nushell's user autoload
# dir, which is derived from $nu.data-dir on every platform, so no path here is
# macOS- or Linux-specific.
let starship_module = ($nu.user-autoload-dirs | first | path join "starship.nu")
if (which starship | is-not-empty) and not ($starship_module | path exists) {
    let autoload_dir = ($starship_module | path dirname)
    if not ($autoload_dir | path exists) { mkdir $autoload_dir }
    ^starship init nu | save -f $starship_module
}
