/**
 * REFERENCE DEMO — the island lane of the demo seam.
 *
 * THE CONTRACT: a demo is a plain `.ts` module exporting `mount`.
 *
 *   export function mount(el: HTMLElement): () => void
 *
 * It receives an empty container and returns a cleanup function. That's it.
 * No framework is imposed — use canvas, WebGL, plain DOM, or bring your own
 * library. Deliberately `.ts` and not `.tsx`: JSX files go through
 * @vitejs/plugin-react, which injects a Fast Refresh guard that throws unless
 * Astro has put a preamble in the page — and Astro only does that for
 * `client:*` islands it can see statically, which a dynamic import is not.
 *
 * The pattern every demo should copy:
 *   1. Mount is cheap — the heavy work waits behind an explicit start click.
 *   2. prefers-reduced-motion is honoured, not ignored.
 *   3. Colours come from the design tokens, so demos re-skin with the site.
 *   4. Cleanup actually cleans up: no timer outlives the returned function.
 */

const LIFETIME = 1400; // ms before a target fades out
const SPAWN_EVERY = 750;
const ROUND = 20_000;

export function mount(el: HTMLElement): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timers = new Set<number>();
  const every = (fn: () => void, ms: number) => {
    const id = window.setInterval(fn, ms);
    timers.add(id);
    return id;
  };
  const clearAll = () => {
    timers.forEach((id) => window.clearInterval(id));
    timers.clear();
  };

  let score = 0;
  let missed = 0;
  let remaining = ROUND;
  let running = false;

  el.innerHTML = `
    <div class="flex items-center gap-4 border-b border-border px-4 py-2.5 text-sm">
      <span class="font-medium text-ink">Score <span data-score class="tabular-nums text-accent">0</span></span>
      <span class="text-ink-muted">Missed <span data-missed class="tabular-nums">0</span></span>
      <span data-clock class="ml-auto tabular-nums text-ink-muted">20.0s</span>
    </div>
    <div data-field class="relative aspect-4/3 w-full overflow-hidden bg-surface-raised">
      <div data-overlay class="absolute inset-0 grid place-items-center p-6 text-center">
        <div>
          <p data-title class="text-lg font-semibold text-ink">Reflex</p>
          <p data-sub class="mt-1 max-w-xs text-sm text-ink-muted">
            Hit the dots before they fade. Twenty seconds.
          </p>
          <button data-start
            class="mt-5 rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-ink transition-colors hover:bg-accent-hover">
            Start
          </button>
          ${
            reduced
              ? `<p class="mt-3 text-xs text-ink-faint">Reduced motion is on — targets won't animate.</p>`
              : ''
          }
        </div>
      </div>
    </div>
    <style>
      @keyframes reflex-pop {
        0%   { transform: translate(-50%,-50%) scale(.4); opacity: 0 }
        12%  { transform: translate(-50%,-50%) scale(1);  opacity: 1 }
        100% { transform: translate(-50%,-50%) scale(.5); opacity: .15 }
      }
    </style>`;

  const $ = <T extends Element>(sel: string) => el.querySelector(sel) as T;
  const field = $<HTMLElement>('[data-field]');
  const overlay = $<HTMLElement>('[data-overlay]');
  const scoreEl = $<HTMLElement>('[data-score]');
  const missedEl = $<HTMLElement>('[data-missed]');
  const clockEl = $<HTMLElement>('[data-clock]');

  const spawn = () => {
    const dot = document.createElement('button');
    dot.setAttribute('aria-label', 'Target');
    dot.className =
      'absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center ' +
      'rounded-full bg-accent text-accent-ink shadow-lg';
    dot.style.left = `${8 + Math.random() * 84}%`;
    dot.style.top = `${8 + Math.random() * 84}%`;
    dot.innerHTML = '<span class="size-2 rounded-full bg-accent-ink/80"></span>';
    if (!reduced) dot.style.animation = `reflex-pop ${LIFETIME}ms linear forwards`;

    const expire = window.setTimeout(() => {
      if (!dot.isConnected) return;
      dot.remove();
      missed++;
      missedEl.textContent = String(missed);
    }, LIFETIME);

    dot.addEventListener('click', () => {
      window.clearTimeout(expire);
      dot.remove();
      score++;
      scoreEl.textContent = String(score);
    });

    field.appendChild(dot);
  };

  const finish = () => {
    running = false;
    clearAll();
    field.querySelectorAll('button[aria-label="Target"]').forEach((d) => d.remove());
    const accuracy = score + missed > 0 ? Math.round((score / (score + missed)) * 100) : 100;
    $<HTMLElement>('[data-title]').textContent = `${score} hits`;
    $<HTMLElement>('[data-sub]').textContent = `${accuracy}% accuracy · ${missed} missed`;
    $<HTMLElement>('[data-start]').textContent = 'Play again';
    overlay.style.display = '';
  };

  const start = () => {
    if (running) return;
    running = true;
    score = missed = 0;
    remaining = ROUND;
    scoreEl.textContent = '0';
    missedEl.textContent = '0';
    overlay.style.display = 'none';

    every(spawn, SPAWN_EVERY);
    every(() => {
      remaining -= 100;
      clockEl.textContent = `${(Math.max(0, remaining) / 1000).toFixed(1)}s`;
      if (remaining <= 0) finish();
    }, 100);
  };

  const startBtn = $<HTMLButtonElement>('[data-start]');
  startBtn.addEventListener('click', start);

  return () => {
    clearAll();
    startBtn.removeEventListener('click', start);
    el.innerHTML = '';
  };
}
