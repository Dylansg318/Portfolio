# account-switcher — several Claude Code accounts on one Mac, and every account's usage in one place

`ccacct` is one Node script for people who own more than one Claude account (a work one
and a personal one, say) and use both from the same Mac. Each account gets its own
Claude Code profile with its own login. Switching changes which account a shell signs in
as, while skills, hooks, settings and memory stay the same. `ccacct list` shows each
account's usage as Claude Code last saved it, side by side.

It's for accounts you own. It never picks an account for you or switches on its own, and it
never reads a login or talks to Anthropic: signing in is always Claude Code's own flow.

## The problem

- **One login per config home.** Claude Code keeps a single login in `~/.claude`. Moving
  between a work and a personal account meant logging out, logging in, and going through
  the browser approval each time, and every session already running on that config home
  moved to the new account with it.
- **Usage is per account.** `/usage` shows the account you're signed in as. Seeing where
  the other account stood meant switching to it first.
- **A profile can drift without telling you.** The browser approval page signs you in as
  whichever claude.ai account the browser is on. Approve from the wrong one and the
  profile quietly becomes that account, while its name stays the same.

## The pieces

| File | Role |
|---|---|
| `ccacct.mjs` | The whole tool. Profiles live in `~/.claude-profiles/<name>`; `~/.claude` itself is the profile called `default`. |
| `accounts.example.json` | Sample for `~/.claude-profiles/accounts.json`, which says which address each profile must be signed in as. Optional; a profile it doesn't name is never flagged. |

Commands:

| Command | What it does |
|---|---|
| `ccacct list` | Every profile with its address and each usage limit as a bar with its reset time, from the reading Claude Code last saved, with how old it is. The default command. |
| `ccacct add <name> [--email a@b]` | Creates `~/.claude-profiles/<name>`, links the shared harness into it, and prints the `claude auth login` line to run. |
| `ccacct use <name>` | Switches the current shell (prints an `export` / `unset` for the shell function below to `eval`). |
| `ccacct run <name> [args]` | Runs `claude` once under that profile without switching the shell. |
| `ccacct which` | Which profile this shell is on. |
| `ccacct relogin <name>` | Signs a profile in again and checks it landed on the right address. |
| `ccacct sync [name]` | Re-links the shared harness. |
| `ccacct doctor` | Checks each profile's links, Keychain slot and signed-in address, and repairs missing links. |
| `ccacct path <name>` | Prints a profile's config folder. |
| `ccacct rm <name> --yes` | Deletes a profile folder and its Keychain slot. Without `--yes` it only says what it would remove. |

`use` needs a shell function, since a child process can't change its parent's
environment:

```zsh
ccacct() {
  case "$1" in
    use)
      local out
      out="$(node /path/to/ccacct.mjs use "$2")" || return 1
      eval "$out"
      echo "→ ${CLAUDE_CONFIG_DIR:-$HOME/.claude (default)}"
      ;;
    *) node /path/to/ccacct.mjs "$@" ;;
  esac
}
```

## Interesting design points

- **A Keychain slot per config folder, for free.** Claude Code names its Keychain item
  `Claude Code-credentials` for `~/.claude`, and `Claude Code-credentials-` plus the first
  8 hex characters of the SHA-256 of `CLAUDE_CONFIG_DIR` for any other folder. So two
  profiles never share a login, and the tool needs no credential store of its own: it
  computes the same name to check a profile has a login slot (without reading it) and to
  delete the slot on `rm`.
- **The default profile keeps its config one level up.** `~/.claude` stores its identity
  in `~/.claude.json`, not `~/.claude/.claude.json`; a `CLAUDE_CONFIG_DIR` profile keeps it
  inside the folder. The reader tries both.
- **A switch changes who you are, not what you have.** `agents`, `skills`, `hooks`,
  `scripts`, `plugins`, `commands`, `plans`, `projects` (memory and transcripts),
  `CLAUDE.md` and `settings.json` are symlinks from each profile back to `~/.claude`. Each
  profile keeps only its own login, usage cache and project trust. Linking never
  overwrites a real file or folder that's in the way; it reports it and leaves it.
- **Doctor checks for an atomic rewrite.** Folders are safe to symlink because the CLI
  writes files inside them. The two linked files aren't: anything that saves one by
  writing a temp file and renaming it over the link replaces the link with a real file,
  and that profile silently stops following `~/.claude`. `doctor` reports those as
  shadowed, puts back missing links, and checks each Keychain slot is present.
- **The identity check reads your file, not the profile.** A profile's own `.claude.json`
  follows whoever signed in last, so it can't catch drift. `list`, `doctor` and `relogin`
  compare against `accounts.json` instead. `relogin` passes `--email` to the login page,
  then reads the address Claude Code saved for the profile and fails if it landed on a
  different account. A malformed `accounts.json` stops the command rather than quietly
  turning the check off.
- **Every number carries its age.** The usage shown is the reading Claude Code itself last
  saved in that profile, so it's as old as that profile's last session, and `list` says
  how old. A profile nobody has used today shows yesterday's figure, labelled as
  yesterday's. Running `/usage` in a session under the profile updates it.
- **`BROWSER` is pinned for `relogin`.** A background Claude session can export
  `BROWSER=true`, which makes the CLI's own browser launch do nothing. `relogin` sets it
  to `/usr/bin/open`.

## External deps / environment

macOS, because each profile's login slot is checked for and, on `rm`, deleted in the login
Keychain with the `security` command. Node 18 or newer (top-level `await`); run here on
Node 24. No npm packages.

The Keychain naming was worked out against Claude Code 2.1.268 and still matched on
2.1.301. `relogin` looks for `claude` in `CCACCT_CLAUDE_BIN`, `~/.local/bin`,
`/opt/homebrew/bin`, `/usr/local/bin`, then `PATH`.

Usage is read from `cachedUsageUtilization` in each profile's `.claude.json`, which Claude
Code writes. It's an internal field, not a documented format, so its shape can change with
any release.

Extracted from a private setup; account addresses and the company's own reporting were
removed.
