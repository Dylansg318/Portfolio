# zen-browser — Claude Code's browser tools inside Zen, with your own logins

An MCP server that gives Claude Code browser tools in Zen, the Firefox-based browser, two
ways. **`browser_*`** drives a hidden Zen that Claude starts itself, carrying a fresh copy
of your Zen logins, one container at a time. **`live_*`** works in your own open Zen, in
your real tabs, and only while you've turned remote control on.

| | `browser_*` — headless copy | `live_*` — your own Zen |
|---|---|---|
| Where it runs | a hidden Zen the server starts | your open Zen window, in your tabs |
| Logins | copied from your Zen each time it opens | yours, as they are |
| Needs | nothing | you run `zen-live.mjs on` (restarts Zen) |
| Use for | everyday work on sites you're signed in to only in Zen | "work in my browser", "look at the tab I have open" |

## The problem

- **Logins that live in one browser.** Some sites are signed in only in your everyday
  browser: one behind a code sent to your phone, one whose login cookie is session-only.
  The usual Playwright MCP runs its own Chrome on an empty profile, so it can't see any of
  them, and signing in again there means another code every time it starts fresh.
- **A window that steals your screen.** A headed test browser pops up over whatever you're
  doing, and the moment you touch it, the run breaks.
- **Two accounts on one site.** Zen's containers keep, say, a Work and a Personal account on
  the same site apart. An automated tab opens outside any container, so a plain cookie copy
  either misses the container's login or mixes both accounts on one site.
- **Sometimes it has to be the real tab.** "Look at what I have open" needs your actual
  browser, not a copy of it.

## The pieces

| File | Role |
|---|---|
| `zen-mcp.mjs` | The MCP server. Wraps `@playwright/mcp` so its `browser_*` tools drive a headless Zen launched on a throwaway profile, and adds `browser_container` and the `live_*` tools. Owns closing the browser, the watchdog and the leak guard. Every result starts with the container it acted as and when the logins were copied. |
| `profile.mjs` | Builds the throwaway profile: copies Zen's cookie database and its session-only cookies, flattens one container into the default cookie jar, drops the never-copy sites. Run on its own (`node profile.mjs [container]`), it prints which sites a copy would carry, as names and counts, never values. |
| `live.mjs` | The `live_*` tools (`live_tabs`, `live_open`, `live_use_tab`, `live_navigate`, `live_snapshot`, `live_click`, `live_type`, `live_screenshot` and the rest): a small WebDriver BiDi client of its own, working in your running Zen. |
| `zen-live.mjs` | `on`, `off` or `status`. Turns live mode on or off by restarting Zen with or without `--remote-debugging-port`. |
| `config.example.json` | The default container, short aliases, the leak-guard limits, and the containers and sites that are never copied or touched. Copy it to `config.json`. |
| `package.json` | `@playwright/mcp` pinned to an exact version; see the tab patch below. |

## What it touches

A tool that copies your cookies should say exactly what it does with them. It reads only
your own Zen profile on your own Mac, for your own automation, and sends nothing anywhere:
the copies stay on the machine and are deleted when the browser closes.

- **Copied, each time the headless browser opens:** the cookies in `cookies.sqlite`, the
  session-only cookies in `sessionstore-backups/recovery.jsonlz4`, and `cert_override.txt`
  (so local dev certificates you've accepted still work). They come from the Zen profile
  whose cookies changed last, or from `ZEN_PROFILE_DIR`. Firefox stores cookies
  unencrypted, so anyone who can read a copy can use those logins.
- **Never copied:** saved passwords, history, extensions, the Sync account, open tabs,
  site storage. Sites in `neverSites` and containers in `neverContainers` are left out
  entirely. The example list covers common banks, card issuers, payment processors,
  payroll and brokerages; add your own. Live mode refuses those sites and containers too,
  and `live_tabs` lists a tab on a never-copy site without its address.
- **Where copies live:** `~/Library/Caches/claude-zen/runs/<server-pid>-*`, folders only
  you can read, and only while the browser is open. A close, the leak guard, the server
  exiting or the watchdog deletes the copy, and a server that finds a dead server's copy
  on start deletes that too. Snapshots and screenshots go to
  `~/Library/Caches/claude-zen/output` and are deleted after 7 days, since they hold page
  text from signed-in sites.
- **Nothing flows back,** but the sessions are shared. The copy never writes to your Zen
  profile. It does use the same login sessions, though, so signing *out* in the copy signs
  you out in Zen as well.
- **What `zen-live.mjs on` writes:** one line in your profile's `user.js`,
  `user_pref("remote.prefs.recommended", false);`. Without it, starting remote control
  applies Firefox's ~110 settings for throwaway test browsers to your real profile:
  phishing and malware protection off, password saving off, pop-up blocker off, no crash
  recovery, reverted only on a clean quit.
- **While live mode is on, every site you visit sees `navigator.webdriver = true`.**
  Firefox flags the whole browser as automated, not just Claude's tabs, so Google sign-in
  and bot checks may challenge you more. Turn it off when Claude is done
  (`zen-live.mjs off`, or quit and reopen Zen).

## Interesting design points

- **Flattening a container.** Firefox keeps a container's cookies in the same database,
  tagged in each cookie's origin attributes (`^userContextId=2&partitionKey=…`). The copy
  strips the container tag from the chosen container's cookies so an automated tab sees
  them, and fills in cookies from outside any container only for sites the container has
  none for. Two accounts never land on one site.
- **Session cookies aren't in the database.** Firefox never writes session-only cookies
  to `cookies.sqlite`. They live only in the session-restore file, rewritten every ~15
  seconds as one LZ4 block behind a `mozLz40` header. `profile.mjs` decodes it with a
  short LZ4 decoder of its own and inserts those cookies into the copy. Without that, the
  copy looks signed out on exactly the sites that matter: one profile held over a
  thousand session-only cookies on one day.
- **Copying a locked database.** Zen keeps `cookies.sqlite` locked while it runs, so the
  file and its WAL are copied raw and checked with `PRAGMA quick_check`, up to three tries.
- **The tab patch, and why `@playwright/mcp` is pinned.** Playwright opens every new page
  as a new window. Firefox's remote agent opens windows only when the app is literally
  named "Firefox" (`openWindow() not supported in Zen`), while tabs work because Zen keeps
  Firefox's app ID. A Node load hook swaps that one call to a tab, in memory, and refuses
  to start unless the call appears exactly once, so a Playwright update that moves it
  fails loudly instead of quietly opening nothing.
- **`browser_close` is handled here.** When Playwright's MCP is handed a browser context,
  its own close only drops its tab list and the session stays wedged. The server closes
  the context itself, gives a graceful close 3 seconds (a graceful Firefox shutdown can
  take ~30 waiting on background services), then kills the process group. The next
  browser call reopens with fresh logins.
- **The watchdog.** A server killed outright can't close its browser, and Zen outlives it:
  13 orphaned processes and about 2.6 GB before this existed. Each open browser gets a
  ~1 MB shell loop that kills Zen's process group and deletes the copy within 2 seconds
  of the server dying, and exits on its own after a normal close.
- **The leak guard.** A copy opened for one lookup sat idle and grew to 61 GB in under 80
  minutes, all in Zen's main process (its pages under 120 MB), with the Mac 21 of 22.5 GB
  into swap. Now, each minute the browser is open, the server closes it after
  `idleCloseMinutes` (10) without a browser call, or at once when Zen's processes together
  pass `maxFootprintGB` (4). It reads `top`'s MEM column, the number `footprint` reports;
  `ps` RSS showed only 4–10 GB of that 61. The next call reopens the browser and its
  result says why the last one closed, and each close is a line in
  `~/Library/Caches/claude-zen/guard.log`.
- **Cheap when idle.** The server starts in every Claude session, so Playwright loads on
  the first browser call, not at startup, and the tool list comes from a cache the first
  load writes. Idle went from ~160 MB to ~70 MB per session.
- **No Playwright in live mode, on purpose.** Playwright's BiDi set-up applies to a whole
  container (it would deny downloads and inject scripts into every one of your tabs there)
  and its close path quits the browser and deletes the container. `live.mjs` is its own
  small BiDi client: it touches only tabs it opened or the one you point it at, opens new
  tabs in the background, never closes your tabs and never quits Zen.
- **Same snapshots in both modes.** `live.mjs` lifts Playwright's own in-page snapshot
  script out of the pinned `playwright-core` and runs it in an isolated sandbox, so pages
  and element refs read the same as in the `browser_*` tools. Clicks and keys are real
  input events.
- **Proving which container is which.** Remote control names containers with random ids.
  `live.mjs` takes the order in `containers.json` as a first guess, then proves each one
  by its cookies (the sites it holds have to match that container better than any other
  id), and refuses a container it can't prove rather than act as the wrong account.
- **Your dialogs stay yours.** The live session leaves prompts alone, so your own alerts
  and confirms behave as they would without Claude. Firefox holds back a dialog that
  follows another within 3 seconds (an anti-abuse rule, kept because it's your real
  browser), so input waits out that window, and a click that hasn't finished after 15
  seconds reports instead of hanging.
- **One live session at a time.** Firefox allows one remote-control session, so a second
  Claude session gets "already has a remote-control session". A live session ends after
  10 idle minutes.
- **Why live mode restarts Zen.** The Zen build this was written against had Firefox's
  "Remote control for AI assistants" strings and banner but not the button that starts
  it, so the `--remote-debugging-port` launch flag is the only way in. Session restore
  brings your tabs back.

## External deps / environment

macOS (it uses `ps`, `top`, `osascript`, `open` and `~/Library` paths), Zen installed at
`/Applications/Zen.app`, and Node 24 (it needs `module.registerHooks`, `node:sqlite` and
the built-in `WebSocket`, so Node 22.15 is the floor). The headless browser launches
through Playwright's WebDriver BiDi Firefox driver (`channel: 'moz-firefox'` with
`executablePath` pointing at Zen), so there's no Playwright browser download; another
Firefox-family browser would need its binary path, profile folder and app id changed in
`profile.mjs` and `zen-live.mjs`.

```sh
cd zen-browser
npm install
cp config.example.json config.json      # set your container names and never-copy sites
node profile.mjs                        # which sites a copy of the default container would carry
claude mcp add --scope user zen -- node /path/to/zen-browser/zen-mcp.mjs
node zen-live.mjs status                # is live mode on?
```

New Claude Code sessions pick the server up; a running one needs `/mcp` to reconnect.
For tests, `ZEN_IDLE_CLOSE_MINUTES`, `ZEN_MAX_FOOTPRINT_GB` and `ZEN_GUARD_INTERVAL_MS`
override the leak guard, and `ZEN_PROFILE_DIR` picks the profile.

Limits: the headless browser acts as one container at a time, and switching closes its
tabs. A site that isn't signed in needs you to sign in on Zen, in that container, then a
`browser_close` so the next call copies again. The tab patch and the snapshot-script
lookup both read inside Playwright's bundle, so upgrading `@playwright/mcp` means
re-checking them; both refuse to run rather than guess.

Extracted from a private setup; container names, sites and account details were
replaced, and the design reasoning was kept.
