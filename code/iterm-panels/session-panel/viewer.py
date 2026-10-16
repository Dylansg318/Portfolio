#!/usr/bin/env python3
"""
viewer — the session panel's "one tab" mode: this tab shows whichever session the panel was last
clicked on, the way agent view switches sessions inside one tab. panel.py starts it in a tab and
writes "<seq> <short id>" to <runs>/<this tab's iTerm2 session id>.req on every click; a new seq
ends the attach on screen (SIGTERM — `claude attach` is only a viewer, the session keeps running)
and attaches the next one here. Leaving with Ctrl+Z, or the session ending, waits for the next click.
"""

import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

CLAUDE = str(Path.home() / ".local" / "bin" / "claude")
RUNS = Path.home() / ".claude" / "logs" / "session-panel"
TAB = (os.environ.get("ITERM_SESSION_ID") or "").split(":")[-1]
REQ = RUNS / f"{TAB}.req"
SHOWN = RUNS / f"{TAB}.shown"
# Leave the alternate screen, show the cursor, stop mouse, paste and focus reporting, clear —
# whatever the attach that was just ended had switched on.
RESET = "\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1004l\x1b[0m\x1b[2J\x1b[H"

shown = {"seq": None}
child = {"proc": None}


def request():
    try:
        seq, job = REQ.read_text().split()
        return seq, job
    except (OSError, ValueError):
        return None, None


def watch():
    """End the attach on screen as soon as the panel asks for a different one."""
    while True:
        seq, _ = request()
        proc = child["proc"]
        if seq and seq != shown["seq"] and proc and proc.poll() is None:
            proc.terminate()
        time.sleep(0.2)


def main():
    if not TAB:
        sys.exit("viewer: not running inside an iTerm2 tab")
    threading.Thread(target=watch, daemon=True).start()
    waiting_said = False
    while True:
        seq, job = request()
        if not seq or seq == shown["seq"]:
            if not waiting_said:
                sys.stdout.write(RESET + "Pick a session in the Sessions panel.\n")
                sys.stdout.flush()
                waiting_said = True
            time.sleep(0.2)
            continue
        shown["seq"] = seq
        waiting_said = False
        sys.stdout.write(RESET)
        sys.stdout.flush()
        started = time.time()
        child["proc"] = subprocess.Popen([CLAUDE, "attach", job])
        # What is on screen right now, so the panel can tell a click on it from a click on another.
        SHOWN.write_text(f"{seq} {job}")
        code = child["proc"].wait()
        child["proc"] = None
        SHOWN.unlink(missing_ok=True)
        subprocess.run(["stty", "sane"], check=False)
        # Refused straight away and nobody asked for another: the session is gone, so say so.
        if code != 0 and time.time() - started < 3 and request()[0] == seq:
            sys.stdout.write(RESET + f"{job} isn't running any more. Pick another in the Sessions panel.\n")
            sys.stdout.flush()
            waiting_said = True


if __name__ == "__main__":
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    main()
