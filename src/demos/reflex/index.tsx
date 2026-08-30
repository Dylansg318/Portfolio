import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * REFERENCE DEMO — the island lane of the demo seam.
 *
 * The pattern every in-repo demo should copy:
 *  1. The island hydrates cheap: it renders a poster and nothing else.
 *  2. The expensive work (RAF loop, audio, WASM) starts on an explicit click.
 *  3. prefers-reduced-motion is honoured, not ignored.
 *  4. Colours come from the design tokens, so demos re-skin with the site.
 */

type Target = { id: number; x: number; y: number; born: number };

const LIFETIME = 1400; // ms before a target expires
const SPAWN_EVERY = 750;
const ROUND = 20_000;

export default function Reflex() {
  const [started, setStarted] = useState(false);
  const [score, setScore] = useState(0);
  const [missed, setMissed] = useState(0);
  const [remaining, setRemaining] = useState(ROUND);
  const [targets, setTargets] = useState<Target[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);

  const areaRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Spawn loop + expiry. Only runs once the player has opted in.
  useEffect(() => {
    if (!started) return;

    const spawn = setInterval(() => {
      const el = areaRef.current;
      if (!el) return;
      setTargets((prev) => [
        ...prev,
        {
          id: nextId.current++,
          x: 8 + Math.random() * 84,
          y: 8 + Math.random() * 84,
          born: performance.now(),
        },
      ]);
    }, SPAWN_EVERY);

    const reap = setInterval(() => {
      const now = performance.now();
      setTargets((prev) => {
        const alive = prev.filter((t) => now - t.born < LIFETIME);
        const expired = prev.length - alive.length;
        if (expired > 0) setMissed((m) => m + expired);
        return alive;
      });
    }, 100);

    const tick = setInterval(() => {
      setRemaining((r) => {
        if (r <= 100) {
          setStarted(false);
          return 0;
        }
        return r - 100;
      });
    }, 100);

    return () => {
      clearInterval(spawn);
      clearInterval(reap);
      clearInterval(tick);
    };
  }, [started]);

  const start = useCallback(() => {
    setScore(0);
    setMissed(0);
    setRemaining(ROUND);
    setTargets([]);
    setStarted(true);
  }, []);

  const hit = useCallback((id: number) => {
    setTargets((prev) => prev.filter((t) => t.id !== id));
    setScore((s) => s + 1);
  }, []);

  const finished = !started && remaining === 0;
  const accuracy = score + missed > 0 ? Math.round((score / (score + missed)) * 100) : 100;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-4 border-b border-border px-4 py-2.5 text-sm">
        <span className="font-medium text-ink">
          Score <span className="tabular-nums text-accent">{score}</span>
        </span>
        <span className="text-ink-muted">
          Missed <span className="tabular-nums">{missed}</span>
        </span>
        <span className="ml-auto tabular-nums text-ink-muted">
          {(remaining / 1000).toFixed(1)}s
        </span>
      </div>

      <div
        ref={areaRef}
        className="relative aspect-4/3 w-full overflow-hidden bg-surface-raised"
      >
        {started &&
          targets.map((t) => (
            <button
              key={t.id}
              onClick={() => hit(t.id)}
              aria-label="Target"
              className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent text-accent-ink shadow-lg"
              style={{
                left: `${t.x}%`,
                top: `${t.y}%`,
                // The only animation, and it's the one reduced-motion users lose.
                animation: reducedMotion ? undefined : `reflex-pop ${LIFETIME}ms linear forwards`,
              }}
            >
              <span className="size-2 rounded-full bg-accent-ink/80" />
            </button>
          ))}

        {!started && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              {finished ? (
                <>
                  <p className="text-3xl font-bold text-ink">{score} hits</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {accuracy}% accuracy · {missed} missed
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold text-ink">Reflex</p>
                  <p className="mt-1 max-w-xs text-sm text-ink-muted">
                    Hit the dots before they fade. Twenty seconds.
                  </p>
                </>
              )}
              <button
                onClick={start}
                className="mt-5 rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-ink transition-colors hover:bg-accent-hover"
              >
                {finished ? 'Play again' : 'Start'}
              </button>
              {reducedMotion && !finished && (
                <p className="mt-3 text-xs text-ink-faint">
                  Reduced motion is on — targets won't animate.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes reflex-pop {
          0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
          12%  { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.15; }
        }
      `}</style>
    </div>
  );
}
