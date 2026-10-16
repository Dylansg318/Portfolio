#!/usr/bin/env python3
"""
session panel — every Claude session on this Mac in iTerm2's side panel (the toolbelt), one block
per run with its orchestrator first, the sessions waiting on you on top. Click a session and it
opens with `claude attach` — by default in one shared tab that switches to whichever session you
click, the way agent view does (viewer.py); the panel's ⋯ menu switches to a tab each, grouped and
coloured by run. Either way the tab's status dot follows the session. The New session box starts a
background session the way agent view's input box does; a picture pasted or dragged into it is
saved under PICTURES and its path goes in the first message, for the session to open. Rename types
`/rename` into the session through a hidden `claude attach` — the only way Claude Code renames a
running session.

  uv run --with iterm2 --with pyobjc-framework-Cocoa python panel.py              run it in the foreground
  uv run --with iterm2 --with pyobjc-framework-Cocoa python panel.py --install    start at login (LaunchAgent)
  uv run --with iterm2 --with pyobjc-framework-Cocoa python panel.py --uninstall  stop it and remove the LaunchAgent

The list is `session-board.mjs --json`, the one implementation of "what is a session doing"; this
file only serves index.html and drives iTerm2. A tab it opened carries the session's short id in
the iTerm2 variable user.claudeJob, so a second click finds it again. Closing a tab only closes the
viewer — the session keeps running. Inside a tab, Ctrl+Z leaves; ← turns that tab into agent view.

The page's buttons can start a session with permissions skipped, so the server answers only on
127.0.0.1, only to its own Host, and only POSTs carrying the key it put in the page it served.
"""

import asyncio
import fcntl
import functools
import hashlib
import importlib.util
import json
import os
import plistlib
import pty
import re
import secrets
import select
import shlex
import shutil
import struct
import subprocess
import sys
import termios
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path.home()
PORT = 47820
HOST = f"127.0.0.1:{PORT}"
TOOL_ID = "com.example.session-panel"
LABEL = "com.example.session-panel"
PLIST = HOME / "Library" / "LaunchAgents" / f"{LABEL}.plist"
LOG = HOME / ".claude" / "logs" / "session-panel.log"
RUNS = HOME / ".claude" / "logs" / "session-panel"  # one-tab mode's requests, read by viewer.py
PICTURES = RUNS / "pictures"  # pictures given to New session, kept PICTURE_DAYS for the session to open
PICTURE_DAYS = 30
PICTURE_RE = re.compile(r"[0-9a-f]{12}\.(png|jpg|gif|webp)")
PICTURE_FILES = {"png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tiff", "tif", "bmp"}
MAX_PICTURE = 30 * 1024 * 1024
JOBS = HOME / ".claude" / "jobs"  # agent view's job files: <short id>/state.json carries the session's name
CLIPBOARD_PANEL = HERE.parent / "clipboard-panel" / "panel.py"
VIEWER = HERE / "viewer.py"
BOARD = HERE.parent / "session-board.mjs"
IT2 = "/Applications/iTerm.app/Contents/Resources/utilities/it2"
CLAUDE = str(HOME / ".local" / "bin" / "claude")
NODE = shutil.which("node") or "/opt/homebrew/opt/node@24/bin/node"
PROJECTS = HOME / "code"  # where your repos live
DEFAULT_FOLDER = PROJECTS / "app"  # the repo New session starts in unless you pick another
TRANSCRIPTS = HOME / ".claude" / "projects"  # Claude Code's folder per place it has run, named by the path with each non-alphanumeric as "-"
REFRESH_S = 2.5
KEY = secrets.token_urlsafe(24)
BOOT = int(time.time())  # part of the page version, so a restarted panel's page reloads and picks up the new KEY
JOB_RE = re.compile(r"[0-9a-f]{6,40}")
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")

# The board's state word → what the tab's dot says; the same words and colours as the panel
# (amber needs a look, blue is in progress, grey is finished).
DOTS = {
    "waiting": ("Needs you", "#f59e0b"),
    "working": ("Working", "#3b82f6"),
    "shell": ("Running", "#3b82f6"),
    "done": ("Done", "#6b7280"),
    "idle": ("Idle", "#6b7280"),
}
STALLED = ("Stalled", "#f59e0b")  # the board decides when (session-board.mjs STALLED_MS)
ENDED = ("Ended", "#6b7280")


def log(*parts):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *parts, flush=True)


# ---------------------------------------------------------------- LaunchAgent


def install():
    uv = shutil.which("uv") or "/opt/homebrew/bin/uv"
    path = ":".join([str(HOME / ".local" / "bin"), os.path.dirname(NODE), "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])
    LOG.parent.mkdir(parents=True, exist_ok=True)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    PLIST.write_bytes(plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": [uv, "run", "--quiet", "--with", "iterm2", "--with", "pyobjc-framework-Cocoa", "python", "-I", str(Path(__file__).resolve())],
        "EnvironmentVariables": {"PATH": path, "HOME": str(HOME)},
        "WorkingDirectory": str(HERE),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 15,
        "StandardOutPath": str(LOG),
        "StandardErrorPath": str(LOG),
    }))
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", f"{domain}/{LABEL}"], capture_output=True)
    subprocess.run(["launchctl", "bootstrap", domain, str(PLIST)], check=True)
    print(f"installed {PLIST}; log at {LOG}")


def uninstall():
    subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}/{LABEL}"], capture_output=True)
    PLIST.unlink(missing_ok=True)
    print("removed the LaunchAgent; the panel stops showing a list once iTerm2 restarts")


# ---------------------------------------------------------------- pictures and the clipboard


def keep_picture(data, ext):
    """Saves a picture for a session to open and returns its name. Claude opens PNG, JPEG, GIF and
    WebP, so anything else (an iPhone's HEIC, a TIFF) is turned into a PNG first."""
    PICTURES.mkdir(parents=True, exist_ok=True)
    stem = hashlib.sha1(data).hexdigest()[:12]
    ext = "jpg" if ext == "jpeg" else ext
    if ext in ("png", "jpg", "gif", "webp"):
        path = PICTURES / f"{stem}.{ext}"
        path.write_bytes(data)
        return path.name
    src = PICTURES / f"{stem}.in"
    src.write_bytes(data)
    done = subprocess.run(["sips", "-s", "format", "png", str(src), "--out", str(PICTURES / f"{stem}.png")], capture_output=True)
    src.unlink(missing_ok=True)
    if done.returncode != 0:
        raise ValueError("That isn't a picture macOS can open.")
    return f"{stem}.png"


def prune_pictures():
    cutoff = time.time() - PICTURE_DAYS * 86400
    for p in PICTURES.glob("*"):
        if p.stat().st_mtime < cutoff:
            p.unlink(missing_ok=True)


@functools.cache
def read_pasteboard():
    """The clipboard panel's reader — the one place that knows what is on the Mac's clipboard."""
    spec = importlib.util.spec_from_file_location("clipboard_panel", CLIPBOARD_PANEL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.read_pasteboard


def paste_from_mac():
    """What ⌘V or Paste brings into New session: text to type, and pictures to attach. The side
    panel's own paste can't bring a picture, so the page asks the panel to read the clipboard."""
    from AppKit import NSPasteboard

    item = read_pasteboard()(NSPasteboard.generalPasteboard())
    if item is None:
        return {"ok": False, "message": "Nothing to paste — the clipboard is empty, or a password manager marked it private."}
    if item["kind"] == "image":
        return {"ok": True, "pictures": [keep_picture(item["png"], "png")], "text": ""}
    if item["kind"] == "file":
        pictures, others = [], []
        for p in item["text"].split("\n"):
            ext = Path(p).suffix.lower().lstrip(".")
            if ext in PICTURE_FILES and Path(p).is_file():
                pictures.append(keep_picture(Path(p).read_bytes(), ext))
            else:
                others.append(shlex.quote(p))
        return {"ok": True, "pictures": pictures, "text": " ".join(others)}
    return {"ok": True, "pictures": [], "text": item["text"]}


def with_pictures(prompt, names):
    if not names:
        return prompt
    return prompt + "\n\nPictures I attached — open each one:\n" + "\n".join(str(PICTURES / n) for n in names)


# ---------------------------------------------------------------- rename


def job_name(job):
    try:
        return json.loads((JOBS / job / "state.json").read_text()).get("name")
    except (OSError, ValueError):
        return None


def rename(job, name):
    """Types `/rename <name>` into the session through a hidden `claude attach`, then leaves with
    Ctrl+Z. Every tab showing a session shares its input box, so Ctrl+S first stashes anything
    half-typed there; Claude Code puts it back once the rename is in. Checked by reading the job's
    name back, since the screen is only drawn for the eye."""
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    proc = subprocess.Popen([CLAUDE, "attach", job], stdin=slave, stdout=slave, stderr=slave,
                            env={**os.environ, "TERM": "xterm-256color"}, start_new_session=True)
    os.close(slave)

    def drain(secs, quiet=None):
        """Reads the screen for `secs`, or until it has been still for `quiet` after drawing something."""
        end, seen, last = time.time() + secs, False, time.time()
        while time.time() < end and not (quiet and seen and time.time() - last >= quiet):
            if select.select([master], [], [], 0.1)[0]:
                try:
                    os.read(master, 65536)
                except OSError:
                    return
                seen, last = True, time.time()

    try:
        drain(8, quiet=1)
        for keys, wait in ((b"\x13", 0.5), (f"/rename {name}".encode(), 0.5), (b"\r", 0)):
            os.write(master, keys)
            drain(wait)
        end = time.time() + 8
        while time.time() < end and job_name(job) != name:
            drain(0.25)
        return job_name(job) == name
    finally:
        try:
            os.write(master, b"\x1a")
            end = time.time() + 3
            while proc.poll() is None and time.time() < end:
                drain(0.2)
        except OSError:
            pass
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        os.close(master)


# ---------------------------------------------------------------- the list


def repo_root(cwd):
    m = re.match(r"^(.*)/\.claude/worktrees/[^/]+", cwd or "")
    return m.group(1) if m else cwd


def projects():
    """The New session folder list: DEFAULT_FOLDER first, then every PROJECTS folder Claude has run in, A–Z."""
    ran = {p.name for p in TRANSCRIPTS.iterdir()}
    found = sorted((p for p in PROJECTS.iterdir() if p != DEFAULT_FOLDER and re.sub(r"[^A-Za-z0-9]", "-", str(p)) in ran), key=lambda p: p.name.lower())
    return [str(DEFAULT_FOLDER), *map(str, found)]


async def read_board():
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_CODE_SESSION_ID"}
    proc = await asyncio.create_subprocess_exec(NODE, str(BOARD), "--json", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env)
    out, err = await asyncio.wait_for(proc.communicate(), 30)
    if proc.returncode != 0:
        raise RuntimeError(f"board exited {proc.returncode}: {err.decode()[-300:]}")
    return json.loads(out)


async def tabs_by_job(app):
    """The tabs this panel opened, by the session short id each one shows."""
    found = {}
    for win in app.terminal_windows:
        for tab in win.tabs:
            sess = tab.current_session
            job = sess and await sess.async_get_variable("user.claudeJob")
            if job:
                found[job] = tab
    return found


def dot_for(session):
    word, colour = DOTS.get(session["state"], ("", "#6b7280"))
    if session.get("stalled"):
        word, colour = STALLED
    q = (session.get("questions") or [{}])[0].get("question") if session["state"] == "waiting" else None
    running = (session.get("running") or {}).get("text") if session["state"] == "shell" or session.get("stalled") else None
    detail = q or running or session.get("now") or ""
    return word, colour, detail[:140]


async def set_dot(sess, word, colour, detail):
    proc = await asyncio.create_subprocess_exec(
        IT2, "session", "set-status", "--session", sess.session_id, "--status", word, "--dot-color", colour, "--detail", detail,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        log("set-status failed:", err.decode().strip()[:200])


class Panel:
    def __init__(self, connection):
        self.conn = connection
        self.loop = asyncio.get_running_loop()
        self.state = {"groups": [], "folders": projects(), "at": 0, "error": None}
        self.dots = {}  # tab id → (word, colour, detail) last written
        self.reveal_pending = True

    async def reveal(self):
        """Show the toolbelt once per start. Its menu item is disabled while iTerm2 isn't the
        front app, so this waits for the person to switch to iTerm2 rather than pulling it forward."""
        try:
            state = await iterm2.MainMenu.async_get_menu_item_state(self.conn, "Show Toolbelt")
            if not state.enabled:
                return
            if not state.checked:
                await iterm2.MainMenu.async_select_menu_item(self.conn, "Show Toolbelt")
            self.reveal_pending = False
        except iterm2.mainmenu.MenuItemException:
            pass

    async def refresh(self):
        board = await read_board()
        app = await iterm2.async_get_app(self.conn)
        tabs = await tabs_by_job(app)
        by_job = {}
        folders = projects()
        for g in board["groups"]:
            for s in g["sessions"]:
                s["open"] = s["job"] in tabs
                by_job[s["job"]] = s
                root = repo_root(s.get("cwd"))
                if root and root not in folders and Path(root).is_dir():
                    folders.append(root)
        for job, tab in tabs.items():
            want = dot_for(by_job[job]) if job in by_job else (*ENDED, "")
            if self.dots.get(tab.tab_id) != want:
                await set_dot(tab.current_session, *want)
                self.dots[tab.tab_id] = want
        # `page` changes when index.html is edited or the panel restarts; the page reloads itself when it sees that.
        page = f"{int((HERE / 'index.html').stat().st_mtime)}.{BOOT}"
        self.state = {"groups": board["groups"], "folders": folders, "at": time.time(), "error": None, "page": page}
        if self.reveal_pending:
            await self.reveal()

    async def run_refresh(self):
        failures = 0
        while True:
            try:
                await self.refresh()
                failures = 0
            except Exception as e:  # noqa: BLE001 — one bad cycle must not stop the panel
                failures += 1
                self.state = {**self.state, "error": str(e)[:300]}
                log("refresh failed:", repr(e)[:300])
                if failures >= 4:
                    log("iTerm2 connection looks gone; exiting so launchd restarts the panel")
                    os._exit(1)
            await asyncio.sleep(REFRESH_S)

    # ------------------------------------------------------------ actions

    async def new_tab(self, app, command):
        win = app.current_terminal_window or (app.terminal_windows[0] if app.terminal_windows else None)
        if win is None:
            return win, (await iterm2.Window.async_create(self.conn, command=command)).current_tab
        return win, await win.async_create_tab(command=command)

    async def open(self, job, run=None, colour=None, mode="tabs"):
        app = await iterm2.async_get_app(self.conn)
        if mode == "one":
            return await self.show_in_viewer(app, job)
        tab = (await tabs_by_job(app)).get(job)
        if tab:
            await tab.async_activate(order_window_front=True)
            return {"ok": True, "opened": False}
        win, tab = await self.new_tab(app, f"/bin/zsh -lic 'exec {CLAUDE} attach {job}'")
        await tab.current_session.async_set_variable("user.claudeJob", job)
        if run:
            await app.async_refresh()
            win = app.get_window_for_tab(tab.tab_id) or win
            group = next((g for g in win.tab_groups if g.name == run), None)
            if group:
                await app.get_tab_by_id(tab.tab_id).async_add_to_tab_group(group)
            else:
                rgb = colour if isinstance(colour, list) and len(colour) == 3 else [110, 118, 129]
                await win.async_create_tab_group(run, [app.get_tab_by_id(tab.tab_id)], color=iterm2.Color(*rgb))
        await tab.async_activate(order_window_front=True)
        return {"ok": True, "opened": True}

    async def show_in_viewer(self, app, job):
        """One-tab mode: every session shows in the same tab, like agent view. The tab runs
        viewer.py, which swaps to whichever session the newest request names."""
        tab = None
        for win in app.terminal_windows:
            for t in win.tabs:
                if t.current_session and await t.current_session.async_get_variable("user.claudeViewer"):
                    tab = t
        if tab is None:
            _, tab = await self.new_tab(app, f"/bin/zsh -lic 'exec python3 -I {VIEWER}'")
            await tab.current_session.async_set_variable("user.claudeViewer", "1")
        RUNS.mkdir(parents=True, exist_ok=True)
        # Already on screen: bring it forward and hand it the keyboard. A new request would end the
        # attach and start another — the tab goes black and drops what you type until it redraws.
        try:
            shown = (RUNS / f"{tab.current_session.session_id}.shown").read_text().split()
        except OSError:
            shown = []
        if shown[1:] == [job]:
            await tab.current_session.async_activate(select_tab=True, order_window_front=True)
            return {"ok": True, "tab": tab.tab_id}
        req = RUNS / f"{tab.current_session.session_id}.req"
        tmp = req.with_suffix(".tmp")
        tmp.write_text(f"{time.time_ns()} {job}")
        tmp.replace(req)
        await tab.current_session.async_set_variable("user.claudeJob", job)
        await tab.current_session.async_activate(select_tab=True, order_window_front=True)
        return {"ok": True, "tab": tab.tab_id}

    async def close(self, job):
        """`claude rm`, what agent view's ctrl+x does: ends the session if it is still running and takes
        it off the board and agent view. Its worktree goes only when that is safe; otherwise rm says why."""
        proc = await asyncio.create_subprocess_exec(CLAUDE, "rm", job, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await asyncio.wait_for(proc.communicate(), 60)
        text = ANSI.sub("", out.decode()).strip()
        return {"ok": proc.returncode == 0, "message": text[-300:]}

    async def new(self, name, prompt, folder):
        """Starts it and leaves your tabs alone: it shows up in the list, and a click opens it."""
        # Through a login shell, like the "Claude Agents" profile that starts agent view, so the
        # session gets the same environment a session dispatched from agent view gets.
        # No name: Claude Code titles the session from its first message, and Rename changes it later.
        script = 'cd -- "$1" && shift && exec "$@"'
        named = ["-n", name] if name else []
        proc = await asyncio.create_subprocess_exec(
            "/bin/zsh", "-lic", script, "zsh", folder, CLAUDE, "--bg", *named, "--dangerously-skip-permissions", prompt,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, stdin=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), 120)
        text = ANSI.sub("", out.decode())
        # "backgrounded · <id>", then " · <name>" when it was given one.
        m = re.search(r"backgrounded\s+·\s+([0-9a-f]{6,40})\b", text)
        if not m:
            return {"ok": False, "message": (text.strip().splitlines() or ["claude --bg printed nothing"])[-1][:300]}
        return {"ok": True, "job": m.group(1)}


def rename_session(body):
    job = str(body.get("job") or "")
    name = "".join(ch for ch in " ".join(str(body.get("name") or "").split()) if ch.isprintable())[:60]
    s = next((s for g in PANEL.state["groups"] for s in g["sessions"] if s["job"] == job), None) if JOB_RE.fullmatch(job) else None
    if s is None:
        return {"ok": False, "message": "That session is gone from the list."}
    if not name:
        return {"ok": False, "message": "Give it a name."}
    if s.get("kind") not in (None, "bg"):
        return {"ok": False, "message": "It runs in its own terminal tab — rename it there with /rename."}
    if s["state"] == "waiting":
        return {"ok": False, "message": "It's asking you something — answer that first, then rename it."}
    if rename(job, name):
        return {"ok": True}
    return {"ok": False, "message": "The name didn't take — open the session and type /rename there."}


# ---------------------------------------------------------------- HTTP

PANEL = None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def ours(self):
        return self.headers.get("Host") == HOST

    def do_GET(self):
        if not self.ours():
            return self.reply(403, '{"error":"wrong host"}')
        path = self.path.split("?")[0]
        if path == "/":
            html = (HERE / "index.html").read_text().replace("__PANEL_KEY__", KEY)
            return self.reply(200, html, "text/html; charset=utf-8")
        if path == "/api/state":
            return self.reply(200, json.dumps(PANEL.state))
        name = path.removeprefix("/pic/")
        if path.startswith("/pic/") and PICTURE_RE.fullmatch(name) and (PICTURES / name).is_file():
            kind = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}[name.rsplit(".", 1)[1]]
            return self.reply(200, (PICTURES / name).read_bytes(), kind)
        self.reply(404, '{"error":"not found"}')

    def take_picture(self):
        """A picture dragged onto the page, sent as its own bytes."""
        size = int(self.headers.get("Content-Length") or 0)
        kind = (self.headers.get("Content-Type") or "").lower()
        ext = re.sub(r"[^a-z0-9]", "", kind.removeprefix("image/"))[:8] if kind.startswith("image/") else ""
        if not ext or not 0 < size <= MAX_PICTURE:
            return self.reply(400, '{"ok":false,"message":"Only a picture under 30 MB can go in."}')
        try:
            return self.reply(200, json.dumps({"ok": True, "pictures": [keep_picture(self.rfile.read(size), ext)]}))
        except ValueError as e:
            return self.reply(400, json.dumps({"ok": False, "message": str(e)}))

    def do_POST(self):
        if not self.ours() or self.headers.get("X-Panel-Key") != KEY:
            return self.reply(403, '{"error":"forbidden"}')
        path = self.path.split("?")[0]
        if path == "/api/picture":
            return self.take_picture()
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except ValueError:
            return self.reply(400, '{"error":"bad json"}')
        mode = "one" if body.get("mode") == "one" else "tabs"
        try:
            if path == "/api/clipboard":
                return self.reply(200, json.dumps(paste_from_mac()))
            if path == "/api/rename":
                result = rename_session(body)
                log(path, json.dumps(body)[:160], "->", json.dumps(result)[:200])
                return self.reply(200, json.dumps(result))
            if path in ("/api/open", "/api/close"):
                job = str(body.get("job") or "")
                if not JOB_RE.fullmatch(job):
                    return self.reply(400, '{"error":"bad session id"}')
                coro = PANEL.open(job, body.get("run"), body.get("colour"), mode) if path == "/api/open" else PANEL.close(job)
            elif path == "/api/new":
                name = str(body.get("name") or "").strip()[:60]
                prompt = str(body.get("prompt") or "").strip()
                folder = str(body.get("folder") or DEFAULT_FOLDER)
                if not prompt:
                    return self.reply(400, '{"ok":false,"message":"Say what it should do."}')
                if not Path(folder).is_dir():
                    return self.reply(400, '{"ok":false,"message":"That folder does not exist."}')
                pictures = [str(n) for n in body.get("pictures") or []]
                if not all(PICTURE_RE.fullmatch(n) and (PICTURES / n).is_file() for n in pictures):
                    return self.reply(400, '{"ok":false,"message":"A picture is gone — add it again."}')
                coro = PANEL.new(name, with_pictures(prompt, pictures), folder)
            else:
                return self.reply(404, '{"error":"not found"}')
            result = asyncio.run_coroutine_threadsafe(coro, PANEL.loop).result(150)
            log(path, json.dumps(body)[:160], "->", json.dumps(result)[:200])
            self.reply(200, json.dumps(result))
        except Exception as e:  # noqa: BLE001
            log(path, "failed:", repr(e)[:300])
            self.reply(500, json.dumps({"ok": False, "message": str(e)[:300]}))


async def bind():
    """The port, once a copy started by hand (or one still shutting down) lets go of it."""
    while True:
        try:
            return ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
        except OSError as e:
            if e.errno != 48:  # EADDRINUSE
                raise
            log(f"port {PORT} is held by another copy of the panel; trying again in 10s")
            await asyncio.sleep(10)


async def main(connection):
    global PANEL
    PANEL = Panel(connection)
    prune_pictures()
    server = await bind()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    await PANEL.refresh()
    await iterm2.tool.async_register_web_view_tool(connection, "Sessions", TOOL_ID, True, f"http://{HOST}/")
    log(f"panel up on http://{HOST}/")
    await PANEL.run_refresh()


def iterm_running():
    return subprocess.run(["pgrep", "-x", "iTerm2"], capture_output=True).returncode == 0


if __name__ == "__main__":
    if "--install" in sys.argv:
        install()
    elif "--uninstall" in sys.argv:
        uninstall()
    else:
        import iterm2  # noqa: E402 — only the running panel needs it; --install runs without it

        while not iterm_running():  # never launch iTerm2 ourselves; wait for the person to open it
            time.sleep(5)
        time.sleep(3)  # let iTerm2's API server come up
        iterm2.run_until_complete(main)
