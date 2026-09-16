/**
 * THE STILL FRAME — the home page as one frame that holds still.
 *
 * Scrolling does not move the page; it moves the reader through it. The row
 * on screen fades out, rising a little as it goes, the frame is empty for a
 * beat, and the next row fades in, rising into place. The response column
 * follows its prose a beat later, the way an answer arrives after a request.
 *
 * How the scroll maps to that:
 *
 *   - `.ref` gets a height (the sum of every row's stretch plus one frame),
 *     and `.ref-main` is sticky inside it, so the document scrolls while the
 *     frame stays put. When the stretch runs out the frame un-pins and the
 *     footer scrolls in like on any page.
 *   - Each row owns a stretch: a short hold, then its own overflow (a row
 *     taller than the frame scrolls inside it first, so nothing is cut off),
 *     another hold, then the fade into the next row.
 *   - Letting go mid-fade settles on the nearer row; the frame never rests
 *     between two. A rail entry or an in-page link two or more rows away cuts
 *     to it rather than flashing through every row between.
 *   - The address follows the row (#work, #contact) with replaceState: a
 *     shared link opens on its row, and Back still leaves the page.
 *   - Below 1024px there is no response column; the response is a drawer
 *     along the bottom of the frame.
 *   - While a game is open in the side panel the frame holds its scroll, so
 *     the arrow keys steer the game instead of changing rows.
 *   - Where the browser has scroll-driven animations and motion isn't
 *     reduced, the compositor moves the rows, not this script (`.still-css`,
 *     global.css). iOS hands scroll events to the page after it has already
 *     scrolled, at its own cadence, so anything moved from them lags the
 *     finger and stutters — it isn't the work (under 1ms a frame, measured
 *     2026-09-16 in WebKit as an iPhone 16 Pro Max), it's the delivery. So
 *     `measure()` writes each row's three ranges (in, scroll, out) as scroll
 *     offsets in `animation-range`, plus its overflow in `--ov`, and the
 *     keyframes do the rest; this script keeps the model, the settle, the
 *     jumps, the address, the rail and the drawer. Without scroll-driven
 *     animations it sets opacity and transform itself, as it always did —
 *     but only for a mouse or a trackpad, or with reduced motion, where the
 *     rows swap in a step and a beat of lag is invisible. A touch screen
 *     without them gets the ordinary page.
 *   - The settle waits for the finger to lift: a page that moves under a
 *     finger that's holding still is a page that fights.
 *
 * Without JavaScript, or in a window too short for a frame, none of this
 * runs and the home page is the ordinary scrolling reference it was.
 */

const LABELS: Record<string, string> = {
  dylan: 'Home',
  work: 'Work',
  experience: 'About',
  away: 'Away from work',
  contact: 'Contact',
};

/** The new row's rise, in px. Zero with reduced motion. */
const RISE = 16;
const MIN_FRAME_H = 480;

type Row = {
  el: HTMLElement;
  id: string;
  prose: HTMLElement;
  code: HTMLElement;
  stick: HTMLElement;
};
type Seg = { start: number; len: number; ovP: number; ovC: number };

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

function setup(): (() => void) | undefined {
  const root = document.documentElement;
  const ref = document.querySelector<HTMLElement>('.ref[data-still]');
  const main = ref?.querySelector<HTMLElement>('.ref-main');
  if (!ref || !main) return;

  const rows: Row[] = [...main.querySelectorAll<HTMLElement>(':scope > .ep')].map((el) => ({
    el,
    id: el.id,
    prose: el.querySelector<HTMLElement>('.ep-prose')!,
    code: el.querySelector<HTMLElement>('.ep-code')!,
    stick: el.querySelector<HTMLElement>('.ep-code .stick')!,
  }));
  if (rows.length < 2) return;

  const rail = ref.querySelector<HTMLElement>('.rail');
  const railLinks = [...(rail?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]') ?? [])];
  const where = main.querySelector<HTMLElement>('.still-where');
  const whereText = where?.querySelector<HTMLElement>('.still-next');
  const dots = [...(where?.querySelectorAll<HTMLElement>('.still-dots i') ?? [])];
  const drawer = main.querySelector<HTMLButtonElement>('.still-drawer');
  const drawerLabel = drawer?.querySelector<HTMLElement>('.still-drawer-ep');

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = window.matchMedia('(max-width: 1023px)');
  const strip = window.matchMedia('(max-width: 1279px)');
  const fine = window.matchMedia('(pointer: fine)');
  const sda = typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()');

  let on = false;
  /** This run's motion is the compositor's: ranges, not styles. */
  let css = false;
  let seg: Seg[] = [];
  let total = 0;
  let hold = 0;
  let fade = 0;
  let active = -1;
  let headH = 0;
  let frame = 0;
  let settleTimer = 0;
  let settling = false;
  let touching = false;
  let lastY = 0;
  let travel = 1;

  const headHeight = () => document.querySelector<HTMLElement>('.site-head')?.offsetHeight ?? 56;

  /** How far into the frame the reader is, in px of scroll. */
  const position = () => Math.max(0, headH - ref.getBoundingClientRect().top);

  function measure() {
    if (!on) return;
    headH = headHeight();
    const stripH = strip.matches && rail ? rail.offsetHeight : 0;
    root.style.setProperty('--still-top', `${headH + stripH}px`);
    const h = main!.clientHeight;
    hold = Math.round(h * 0.4);
    fade = Math.round(h * 0.55);
    let start = 0;
    seg = rows.map((r, i) => {
      const ovP = Math.max(0, r.prose.offsetHeight - h);
      const ovC = narrow.matches ? 0 : Math.max(0, r.code.offsetHeight - h);
      const len = hold + Math.max(ovP, ovC) + (i < rows.length - 1 ? fade : 0);
      const s = { start, len, ovP, ovC };
      start += len;
      return s;
    });
    total = start;
    ref!.style.setProperty('--still-h', `${stripH + h + total}px`);
    if (css) ranges();
    render();
  }

  /**
   * The CSS path: each row's motion as scroll offsets. The scroll at which the
   * frame is at y=0 is `base`; every range is `base` plus a frame position.
   * The prose fades out over the first 45% of the fade and the next row's in
   * over the last 45%; the response trails on both sides (5–50%, 62–100%).
   * The same numbers `render()` uses, so the two paths agree to the pixel.
   */
  function ranges() {
    const base = ref!.getBoundingClientRect().top + window.scrollY - headH;
    rows.forEach((r, i) => {
      const s = seg[i]!;
      // Both columns scroll over the taller one's overflow, each by its own,
      // so they finish together — `u` in render().
      const ov = Math.max(s.ovP, s.ovC);
      const fadeAt = s.start + hold + ov;
      const inAt = s.start - fade;
      const scrollAt = s.start + hold / 2;
      const last = i === rows.length - 1;
      const write = (el: HTMLElement, own: number, inA: number, inB: number, outA: number, outB: number) => {
        const names = [i === 0 ? 'none' : 'still-in', own > 0 ? 'still-scroll' : 'none', last ? 'none' : 'still-out'];
        const at = (y: number) => `${Math.round(base + y)}px`;
        const range = [
          `${at(inAt + fade * inA)} ${at(inAt + fade * inB)}`,
          `${at(scrollAt)} ${at(scrollAt + ov)}`,
          `${at(fadeAt + fade * outA)} ${at(fadeAt + fade * outB)}`,
        ];
        el.style.setProperty('--ov', String(own));
        el.style.setProperty('animation-name', names.join(', '));
        el.style.setProperty('animation-range', range.join(', '));
      };
      write(r.prose, s.ovP, 0.55, 1, 0, 0.45);
      write(r.stick, s.ovC, 0.62, 1, 0.05, 0.5);
    });
  }

  function locate(y: number) {
    let i = seg.findIndex((s) => y < s.start + s.len);
    if (i === -1) i = seg.length - 1;
    const s = seg[i]!;
    const local = y - s.start;
    const ov = Math.max(s.ovP, s.ovC);
    const u = ov ? clamp((local - hold / 2) / ov) : 0;
    const t = i < seg.length - 1 ? clamp((local - hold - ov) / fade) : 0;
    return { i, local, u, t, ov };
  }

  function paintRow(r: Row, pOp: number, pDy: number, pOff: number, cOp: number, cDy: number, cOff: number) {
    if (!css) {
      r.prose.style.opacity = String(pOp);
      r.prose.style.transform = pDy || pOff ? `translateY(${pDy - pOff}px)` : '';
      r.stick.style.opacity = String(cOp);
      r.stick.style.transform = cDy || cOff ? `translateY(${cDy - cOff}px)` : '';
    }
    // On the CSS path this lands a beat after the compositor's fade; inert is
    // hit-through and out of the tab order, so the beat costs nothing visible.
    const hidden = pOp < 0.02 && cOp < 0.02;
    if (hidden !== r.el.hasAttribute('inert')) r.el.toggleAttribute('inert', hidden);
  }

  function render() {
    if (!on || !seg.length) return;
    const y = Math.min(position(), total);
    const { i, local, u, t, ov } = locate(y);
    const s = seg[i]!;
    const still = reduce.matches;
    // Out, then in: the frame empties for a beat between rows, and the
    // response trails its prose on both sides of it.
    const outP = still ? (t >= 0.5 ? 1 : 0) : ease(clamp(t / 0.45));
    const inP = still ? (t >= 0.5 ? 1 : 0) : ease(clamp((t - 0.55) / 0.45));
    const outC = still ? outP : ease(clamp((t - 0.05) / 0.45));
    const inC = still ? inP : ease(clamp((t - 0.62) / 0.38));
    const rise = still ? 0 : RISE;

    rows.forEach((r, k) => {
      if (k === i) {
        paintRow(r, 1 - outP, -rise * outP, s.ovP * u, 1 - outC, -rise * outC, s.ovC * u);
      } else if (k === i + 1 && t > 0) {
        paintRow(r, inP, rise * (1 - inP), 0, inC, rise * (1 - inC), 0);
      } else {
        const past = k < i ? seg[k]! : null;
        paintRow(r, 0, 0, past?.ovP ?? 0, 0, 0, past?.ovC ?? 0);
      }
    });

    const now = t >= 0.5 ? i + 1 : i;
    // The rail entry's stripe fills as the row is read.
    const read = now === i ? clamp(local / (hold + ov + fade * 0.5)) : 0;
    const row = rows[now]!;
    railLinks.forEach((a) => {
      const mine = a.getAttribute('href') === `#${row.id}`;
      a.style.setProperty('--read', mine ? String(read) : '0');
    });

    if (now === active) return;
    active = now;
    railLinks.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${row.id}`)));
    dots.forEach((d, k) => d.classList.toggle('on', k === now));
    if (whereText && root.dataset.game !== 'open') whereText.innerHTML = whereCopy(now);
    if (drawerLabel) drawerLabel.innerHTML = row.prose.querySelector('.crumb')?.innerHTML ?? LABELS[row.id] ?? '';
    // Row one is the page itself: no fragment. replaceState keeps the
    // router's own history state, and Back still leaves the page.
    const url = now === 0 ? location.pathname + location.search : `#${row.id}`;
    try {
      history.replaceState(history.state, '', url);
    } catch {
      /* sandboxed or file: — the address just doesn't follow */
    }
  }

  const whereCopy = (now: number) => {
    const next = rows[now + 1];
    const arrow =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
    return next
      ? `<span><b>${now + 1} of ${rows.length}</b> · ${LABELS[next.id] ?? ''} next</span>${arrow}`
      : `<span><b>${rows.length} of ${rows.length}</b> · that's everything</span>`;
  };

  const onScroll = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
    const yNow = position();
    if (yNow !== lastY) travel = yNow > lastY ? 1 : -1;
    lastY = yNow;
    // The first real scroll is the sign the reader knows the frame moves;
    // the "next" arrow stops nudging from here on (global.css, .still-read).
    if (yNow > 24) main!.classList.add('still-read');
    armSettle();
  };

  /** 170ms after the last scroll event, if the frame rests mid-fade, settle it. */
  const armSettle = () => {
    window.clearTimeout(settleTimer);
    // Not under a finger: the finger is still deciding. touchend re-arms.
    if (settling || touching || root.dataset.game === 'open') return;
    settleTimer = window.setTimeout(() => {
      const y = position();
      if (y >= total) return;
      const { i, t, ov } = locate(y);
      if (t <= 0.001 || t >= 0.999) return;
      // Settle the way the reader was going: a fifth of a fade is enough
      // intent to move on, and the same going back.
      const forward = travel > 0 ? t > 0.2 : t > 0.8;
      const target = forward ? seg[i + 1]!.start : seg[i]!.start + hold + ov;
      settling = true;
      scrollToFrame(target, reduce.matches ? 'instant' : 'smooth');
      window.setTimeout(() => (settling = false), 650);
    }, 170);
  };

  const onTouchStart = () => {
    touching = true;
    window.clearTimeout(settleTimer);
  };
  // A flick's momentum keeps scroll events coming after touchend, and each
  // one re-arms the timer, so the settle still waits for the page to stop.
  const onTouchEnd = () => {
    touching = false;
    armSettle();
  };

  /** Scroll the document so the frame is `y` px in. */
  const scrollToFrame = (y: number, behavior: ScrollBehavior) => {
    const top = y + ref.getBoundingClientRect().top + window.scrollY - headH;
    window.scrollTo({ top, behavior });
  };

  function jump(k: number) {
    if (!seg[k]) return;
    const cur = active < 0 ? 0 : active;
    if (Math.abs(k - cur) <= 1 && !reduce.matches) {
      scrollToFrame(seg[k]!.start, 'smooth');
      return;
    }
    // Two or more rows away: cut, don't flash through the rows between.
    main!.classList.remove('still-cut');
    void main!.offsetWidth;
    main!.classList.add('still-cut');
    scrollToFrame(seg[k]!.start, 'instant');
    render();
  }

  // Capture phase, so this runs before the router treats a same-page hash
  // link as a scroll of its own.
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a) return;
    const k = rows.findIndex((r) => `#${r.id}` === a.getAttribute('href'));
    if (k === -1) return;
    e.preventDefault();
    e.stopPropagation();
    jump(k);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (root.dataset.game === 'open') return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable], [role="tablist"], .cx-out, .cx-req')) return;
    const y = position();
    if (y >= total || ref.getBoundingClientRect().bottom < window.innerHeight * 0.5) return;
    e.preventDefault();
    const { i, ov } = locate(y);
    const cur = active < 0 ? i : active;
    const step = main!.clientHeight * 0.6;
    const how: ScrollBehavior = reduce.matches ? 'instant' : 'smooth';
    if (e.key === 'ArrowDown') {
      const endOfRead = seg[i]!.start + hold + ov;
      if (ov > 0 && y < endOfRead - 4) scrollToFrame(Math.min(endOfRead, y + step), how);
      else if (i < seg.length - 1) scrollToFrame(seg[i + 1]!.start, how);
      else scrollToFrame(total + 1, how);
    } else {
      const s = seg[cur]!;
      const sov = Math.max(s.ovP, s.ovC);
      if (sov > 0 && y > s.start + hold / 2 + 4) scrollToFrame(Math.max(s.start, y - step), how);
      else if (cur > 0) {
        const p = seg[cur - 1]!;
        scrollToFrame(p.start + hold + Math.max(p.ovP, p.ovC), how);
      }
    }
  };

  // An edited address, or a link to /#row followed from this same page.
  const onHash = () => {
    const k = rows.findIndex((r) => `#${r.id}` === location.hash);
    if (k !== -1) jump(k);
  };

  const onDrawer = () => {
    const open = !main!.classList.contains('drawer-open');
    main!.classList.toggle('drawer-open', open);
    drawer?.setAttribute('aria-expanded', String(open));
  };

  const onGameOpen = () => {
    root.style.overflow = 'hidden';
    const title = (document.getElementById('gp')?.getAttribute('aria-label')) ?? 'The game';
    if (whereText) whereText.innerHTML = `<span><b>${title} is open</b> · close it to keep scrolling</span>`;
  };
  const onGameClose = () => {
    root.style.overflow = '';
    active = -1;
    render();
  };

  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  });
  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => (fits() ? enable() : disable()), 120);
  };
  const onBreakpoint = () => {
    main!.classList.remove('drawer-open');
    drawer?.setAttribute('aria-expanded', 'false');
    measure();
  };
  const onPath = () => {
    disable();
    if (fits()) enable();
  };

  // A touch screen gets the frame only when the compositor drives it, or when
  // reduced motion makes the script's step swap the whole of the motion.
  const fits = () => window.innerHeight >= MIN_FRAME_H && (fine.matches || sda || reduce.matches);

  function enable() {
    if (on) return measure();
    on = true;
    css = sda && !reduce.matches;
    root.classList.add('still');
    root.classList.toggle('still-css', css);
    rows.forEach((r) => {
      ro.observe(r.prose);
      ro.observe(r.code);
    });
    // The ranges are scroll offsets, so anything above the frame changing
    // height (the first-visit hint being dismissed) moves every one of them.
    if (css) ro.observe(document.body);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    document.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    drawer?.addEventListener('click', onDrawer);
    document.addEventListener('game-panel:open', onGameOpen);
    document.addEventListener('game-panel:close', onGameClose);
    narrow.addEventListener('change', onBreakpoint);
    strip.addEventListener('change', onBreakpoint);
    measure();
    if (root.dataset.game === 'open') onGameOpen();
  }

  function disable() {
    if (!on) return;
    on = false;
    root.classList.remove('still', 'still-css');
    root.style.removeProperty('--still-top');
    root.style.overflow = '';
    ref!.style.removeProperty('--still-h');
    ro.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    drawer?.removeEventListener('click', onDrawer);
    document.removeEventListener('game-panel:open', onGameOpen);
    document.removeEventListener('game-panel:close', onGameClose);
    narrow.removeEventListener('change', onBreakpoint);
    strip.removeEventListener('change', onBreakpoint);
    cancelAnimationFrame(frame);
    window.clearTimeout(settleTimer);
    touching = false;
    main!.classList.remove('drawer-open', 'still-cut', 'still-read');
    rows.forEach((r) => {
      r.el.removeAttribute('inert');
      for (const el of [r.prose, r.stick]) {
        el.style.opacity = '';
        el.style.transform = '';
        el.style.removeProperty('--ov');
        el.style.removeProperty('animation-name');
        el.style.removeProperty('animation-range');
      }
    });
    railLinks.forEach((a) => a.style.removeProperty('--read'));
    active = -1;
    css = false;
  }

  const initialHash = location.hash;
  window.addEventListener('resize', onResize);
  // A tablet that gains a trackpad, or loses one; reduced motion switched
  // either way, which picks the path.
  fine.addEventListener('change', onResize);
  reduce.addEventListener('change', onPath);
  if (fits()) enable();

  // A link to a row (/#work) opens on that row. After the router's own
  // scroll-to-hash, which would otherwise land on the top of the frame.
  const k = rows.findIndex((r) => `#${r.id}` === initialHash);
  if (on && k > 0) requestAnimationFrame(() => {
    scrollToFrame(seg[k]!.start, 'instant');
    render();
  });

  return () => {
    window.removeEventListener('resize', onResize);
    fine.removeEventListener('change', onResize);
    reduce.removeEventListener('change', onPath);
    disable();
  };
}

let teardown: (() => void) | undefined;
document.addEventListener('astro:page-load', () => {
  teardown?.();
  teardown = setup();
});
document.addEventListener('astro:before-swap', () => {
  teardown?.();
  teardown = undefined;
});
