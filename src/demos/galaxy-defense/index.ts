/**
 * GALAXY DEFENSE — the island lane of the demo seam.
 *
 * A faithful port of a Code.org Game Lab project (senior year of high school,
 * 790 lines of Blockly-generated JavaScript) onto a plain canvas. The original
 * source ships beside this write-up at
 * src/content/projects/galaxy-defense/snippets/original.js — every rule below
 * is traceable to a line in it.
 *
 * WHAT IS FAITHFUL
 *   Field is 400x400, the same coordinate space Game Lab gave you. Speeds,
 *   spawn ranges, prices, health totals, the FTL charge rate and its asymmetric
 *   discharge (-98 right, -99 elsewhere — a typo in the original, kept) all
 *   carry the original's numbers, not tuned equivalents.
 *
 * WHAT CHANGED, AND WHY
 *   1. Sprites. Game Lab resolves setAnimation("alien") against Code.org's
 *      asset service. Those PNGs are loaded here from /demos/galaxy-defense/
 *      instead; if one is missing the sprite falls back to a flat shape so the
 *      demo degrades instead of breaking.
 *   2. Starfield. The original called ellipse() at random coordinates every
 *      frame, so the stars strobed at 60fps. That is a photosensitivity risk on
 *      a public page, so the field is generated once per background and held.
 *   3. One real bug fixed: at baseHealth2 === 7 the original set the animation
 *      on homeBase instead of homeBase2, so the middle base flickered to the
 *      wrong damage state. Ported correctly.
 *   4. Timestep. Game Lab's draw() is 30fps and every speed is written per
 *      frame, so a 60Hz loop would run the whole game at double speed. See
 *      STEP_MS.
 *   5. Collision. p5.play collides on the whole image box, transparent margin
 *      included; this collides on the visible art. See ASSETS.
 *
 * NOT changed, despite looking like bugs — see the comment on step():
 * the help and store "menus" do not pause anything, because Game Lab has no
 * pause. They re-park every sprite each frame, which makes them a panic button,
 * the only alien respawn in the game, and a safe place to charge the FTL drive.
 *
 * Contract: export mount(el) => cleanup. See src/components/mdx/Demo.astro.
 */

const W = 400;
const H = 400;

/**
 * The original art, drawn in Piskel and exported from Code.org. Each entry is
 * an animation: `frames` files named <name>_1.png … <name>_n.png under
 * public/demos/galaxy-defense/, all cropped to one shared bounding box so a
 * multi-frame sprite cannot jitter as it cycles.
 *
 * `w`/`h` are the on-screen size in field units, and double as the collision
 * box. They are not invented — they are the source PNG's visible content
 * multiplied by the `scale` the original set on that sprite:
 *   spaceship/aliens  scale 0.5   ·   projectile/bomb/bases  unscaled
 * so a ship is 50 units wide here because it was 50 units wide in Game Lab.
 *
 * (One deliberate deviation: p5.play collides on the whole image box, including
 * transparent margin, so an alien's real hitbox was the full 50x50 canvas
 * around a 31x19 drawing. Colliding on the visible art instead removes hits
 * that land on nothing.)
 */
const ASSETS = {
  spaceShip: { frames: 2, w: 50, h: 37.5 },
  alien: { frames: 2, w: 31, h: 19 },
  angryAlien: { frames: 2, w: 31, h: 19 },
  projectile: { frames: 2, w: 7, h: 8 },
  bomb: { frames: 6, w: 23, h: 23 },
  homeBase: { frames: 8, w: 46, h: 23 },
} as const;

type AssetName = keyof typeof ASSETS;

const BOX: Record<AssetName, { w: number; h: number }> = Object.fromEntries(
  (Object.keys(ASSETS) as AssetName[]).map((k) => [k, { w: ASSETS[k].w, h: ASSETS[k].h }]),
) as Record<AssetName, { w: number; h: number }>;

/**
 * Game Lab's draw() runs at 30fps, and every speed in the original is written
 * per-frame, not per-second: the ship moves 4 "per frame", the FTL drive charges
 * 1% "per frame". Running this on a 60Hz requestAnimationFrame would silently
 * double the speed of the entire game, so the simulation steps on a fixed 30Hz
 * accumulator and only rendering follows the display.
 */
const STEP_MS = 1000 / 30;
/** Game Lab advances an animation every 4 draw ticks. */
const TICKS_PER_FRAME = 4;

/** Fallback colours, used only for sprites whose PNG failed to load. */
const FALLBACK: Record<AssetName, string> = {
  spaceShip: '#7ee081',
  alien: '#5ad152',
  angryAlien: '#ff5c5c',
  projectile: '#ff4d4d',
  bomb: '#dfe8ff',
  homeBase: '#2f9e3f',
};

type Sprite = { x: number; y: number; vx: number; vy: number };

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** p5.play's isTouching, which is an axis-aligned box overlap. */
const touching = (
  a: Sprite,
  ab: { w: number; h: number },
  b: Sprite,
  bb: { w: number; h: number },
) =>
  Math.abs(a.x - b.x) < (ab.w + bb.w) / 2 && Math.abs(a.y - b.y) < (ab.h + bb.h) / 2;

export function mount(el: HTMLElement): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  el.innerHTML = `
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 text-sm">
      <span class="font-medium text-ink">Galaxy Defense</span>
      <span class="text-ink-muted">Code.org Game Lab, 2020 — ported to canvas</span>
      <button type="button" data-stop hidden
        class="ml-auto rounded-md border border-border px-2.5 py-1 text-xs font-medium text-ink-muted hover:text-ink">
        Stop <span class="text-ink-faint">(Esc)</span>
      </button>
    </div>
    <div data-stage class="relative mx-auto w-full max-w-[400px] bg-black">
      <canvas data-canvas class="block w-full" style="aspect-ratio:1/1;image-rendering:pixelated"></canvas>
      <button type="button" data-start
        class="absolute inset-0 grid place-items-center gap-3 bg-black/70 text-center backdrop-blur-[1px]">
        <span class="grid gap-2 px-6">
          <span class="text-lg font-semibold text-white">Galaxy Defense</span>
          <span class="text-sm text-white/70">Arrows to move, space to shoot. Hold H for help.</span>
          <span class="mx-auto mt-1 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">Start</span>
          <span class="text-xs text-white/50">Keyboard is captured only while the game runs.</span>
        </span>
      </button>
    </div>
    <p class="border-t border-border px-4 py-2 text-xs text-ink-faint">
      Arrows move · Space shoots · <kbd>Q</kbd>+arrow FTL jump · <kbd>E</kbd> bomb ·
      <kbd>T</kbd> store · <kbd>H</kbd> help · <kbd>R</kbd> restart
    </p>
  `;

  const canvas = el.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const startBtn = el.querySelector<HTMLButtonElement>('[data-start]')!;
  const stopBtn = el.querySelector<HTMLButtonElement>('[data-stop]')!;
  const ctx = canvas.getContext('2d')!;

  // ---- assets ---------------------------------------------------------
  const images = new Map<AssetName, HTMLImageElement[]>();
  const loadAssets = () =>
    Promise.all(
      (Object.keys(ASSETS) as AssetName[]).flatMap((name) => {
        const strip: HTMLImageElement[] = [];
        images.set(name, strip);
        return Array.from({ length: ASSETS[name].frames }, (_, i) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              strip[i] = img;
              resolve();
            };
            img.onerror = () => resolve(); // fall back to a flat shape
            img.src = `/demos/galaxy-defense/${name}_${i + 1}.png`;
          }),
        );
      }),
    );

  // ---- state ----------------------------------------------------------
  let score = 0;
  let lives = 3;
  let bomb = 0;
  let ftl = 0;
  let baseHealth = [8, 8, 8];
  let bossHealth = 2;
  let over = false;
  let running = false;
  let raf = 0;
  let tick = 0;

  const ship: Sprite = { x: 200, y: 300, vx: 0, vy: 0 };
  const aliens: Sprite[] = [];
  const shots: Sprite[] = [];
  let shotTurn = 0;
  const boss: Sprite = { x: 0, y: -50, vx: 0, vy: 0 };
  const pickup: Sprite = { x: rand(10, 390), y: -15, vx: 0, vy: 1 };
  // The original centres a 100x100 base canvas on y=390; the drawing inside it
  // occupies rows 28-51, so the visible base sat centred on y=379.5. Cropping
  // the art to its content means using that number directly.
  const bases: Sprite[] = [
    { x: 200, y: 379.5, vx: 0, vy: 0 },
    { x: 55, y: 379.5, vx: 0, vy: 0 },
    { x: 345, y: 379.5, vx: 0, vy: 0 },
  ];

  /** Stars are generated once, not re-randomised per frame — see header. */
  let stars: { x: number; y: number }[] = [];
  const makeStars = () => {
    stars = Array.from({ length: 18 }, () => ({ x: rand(5, 395), y: rand(5, 395) }));
  };

  const spawnAlien = (a: Sprite) => {
    a.x = rand(10, 390);
    a.y = -15;
    a.vy = score >= 50 ? rand(1.5, 2) : rand(1, 1.5);
  };

  const reset = () => {
    score = 0;
    lives = 3;
    bomb = 0;
    ftl = 0;
    baseHealth = [8, 8, 8];
    bossHealth = 2;
    over = false;
    ship.x = 200;
    ship.y = 300;
    aliens.length = 0;
    for (let i = 0; i < 5; i++) {
      const a: Sprite = { x: 0, y: 0, vx: 0, vy: 0 };
      spawnAlien(a);
      aliens.push(a);
    }
    shots.length = 0;
    for (let i = 0; i < 3; i++) shots.push({ x: -50, y: -50, vx: 0, vy: -5 });
    shotTurn = 0;
    boss.x = 0;
    boss.y = -50;
    boss.vx = 0;
    boss.vy = 0;
    pickup.x = rand(10, 390);
    pickup.y = rand(-600, -400);
    makeStars();
  };

  // ---- input ----------------------------------------------------------
  const held = new Set<string>();
  const pressed = new Set<string>();
  const CAPTURED = new Set([
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ',
    'q', 'e', 't', 'h', 'r', '1', '2', '3',
  ]);

  const keyName = (e: KeyboardEvent) => e.key.toLowerCase();

  const onKeyDown = (e: KeyboardEvent) => {
    if (!running) return;
    const k = keyName(e);
    if (k === 'escape') {
      stop();
      return;
    }
    if (!CAPTURED.has(k)) return;
    e.preventDefault(); // arrows and space would otherwise scroll the page
    if (!held.has(k)) pressed.add(k);
    held.add(k);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(keyName(e));
  };
  const onBlur = () => held.clear();

  const down = (k: string) => held.has(k);
  const went = (k: string) => pressed.has(k);

  // ---- drawing --------------------------------------------------------
  /**
   * `frame` selects a specific cel (the eight base damage states); omit it and
   * the animation cycles on the global tick.
   */
  const drawSprite = (
    name: AssetName,
    s: Sprite,
    opts: { frame?: number; scale?: number } = {},
  ) => {
    const scale = opts.scale ?? 1;
    const w = BOX[name].w * scale;
    const h = BOX[name].h * scale;
    const strip = images.get(name);
    const idx =
      opts.frame ?? Math.floor(tick / TICKS_PER_FRAME) % ASSETS[name].frames;
    const img = strip?.[idx];
    if (img) {
      ctx.drawImage(img, s.x - w / 2, s.y - h / 2, w, h);
      return;
    }
    ctx.fillStyle = FALLBACK[name];
    ctx.fillRect(s.x - w / 2, s.y - h / 2, w, h);
  };

  const drawBackground = () => {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, W, H);
    // The original switches the star colour from yellow to blue at 50 points.
    ctx.fillStyle = score >= 50 ? '#4a7bff' : '#ffd400';
    for (const s of stars) {
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 2.5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const text = (str: string, x: number, y: number, size = 17, color = 'white') => {
    ctx.fillStyle = color;
    ctx.font = `${size}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(str, x, y);
  };

  const drawHud = () => {
    // The original draws label and value as two calls at fixed x. That assumes a
    // proportional face; in monospace the label runs into its own value, so each
    // readout is one string here. Same corners, same information.
    text(`Lives:  ${lives}`, 6, 328, 15);
    text(`Points: ${score}`, 6, 348, 15);
    text(`Bombs: ${bomb}`, 232, 328, 15);
    text(`FTL:   ${String(Math.round(ftl)).padStart(3, ' ')}%`, 232, 348, 15);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#139d08';
    ctx.font = '30px Impact, "Arial Narrow", Haettenschweiler, sans-serif';
    ctx.fillText('Galaxy Defense', W / 2, 32);
    text("(hold 'h' for help)", W / 2, 48, 13, '#8fbf8a');
    ctx.textAlign = 'left';
  };

  const drawHelp = () => {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 55, W, 220);
    text('How to Play:', 12, 85, 18);
    text('Arrow keys to move', 12, 112, 16);
    text('Space to shoot', 12, 136, 16);
    text('One bullet at a time — shoot wisely', 12, 156, 12, '#9aa7bd');
    text("'q' + arrow at 100% FTL to teleport", 12, 184, 16);
    text("'e' with a bomb clears the field, +4", 12, 210, 16);
    text("'r' to restart", 12, 236, 16);
    text("hold 't' for the store", 12, 262, 16);
  };

  const drawStore = () => {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 60, W, 200);
    ctx.textAlign = 'center';
    text('Store', W / 2, 100, 20);
    text('Press the number to buy', W / 2, 120, 13, '#9aa7bd');
    text('1. Bombs', 60, 180, 15);
    text('20 pts', 60, 245, 15, score >= 20 ? '#7ee081' : '#8a94a6');
    text('2. Lives', 200, 180, 15);
    text('50 pts', 200, 245, 15, score >= 50 ? '#7ee081' : '#8a94a6');
    text('3. Heal bases', 330, 180, 15);
    text('200 pts', 330, 245, 15, score >= 200 ? '#7ee081' : '#8a94a6');
    ctx.textAlign = 'left';
    drawSprite('bomb', { x: 60, y: 208, vx: 0, vy: 0 });
    drawSprite('spaceShip', { x: 200, y: 208, vx: 0, vy: 0 }, { scale: 0.6 });
    drawSprite('homeBase', { x: 330, y: 208, vx: 0, vy: 0 }, { frame: 0 });
  };

  const drawGameOver = () => {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    text('GAME OVER', W / 2, 200, 46);
    text("press 'r' to restart", W / 2, 232, 22);
    text(`Final score ${score}`, W / 2, 264, 16, '#9aa7bd');
    ctx.textAlign = 'left';
  };

  // ---- update ---------------------------------------------------------
  /**
   * There is no pause in Game Lab. draw() runs every frame, forever, and the
   * only thing a "menu" can do is put the world back where it started on each
   * pass — which is exactly what the original does: while H or T is held, every
   * alien is shoved to y = -15, the ship is snapped to (200, 300) and the bomb
   * pickup is thrown back above the screen. It looks frozen; nothing stopped.
   *
   * That has consequences the original never spells out, and they are the most
   * interesting thing in the file:
   *
   *   - Opening a menu CLEARS THE FIELD. Every alien goes back to the top, so a
   *     menu is also a panic button — hold T when you are about to be hit and
   *     the thing about to hit you is now at the top of the screen.
   *   - It is also the ONLY way aliens come back. Nothing in the original resets
   *     an alien that falls off the bottom, so any alien that slips through a
   *     gap between the bases is gone for good. The menus are the game's
   *     respawn: holding T sweeps them all back into play.
   *   - The FTL drive keeps charging the whole time, because playerMovement()
   *     runs whether a menu is open or not. The shop is a safe place to refuel.
   *   - The store also sets alien6health = 0, so browsing it despawns the boss.
   *   - It costs you your position: the ship is teleported back to centre, and a
   *     bomb pickup you were about to collect is thrown off the top of the map.
   *
   * So this port does NOT freeze the loop. It reproduces the original's phase
   * order — the order the effects above actually emerge from — and re-parks the
   * sprites each frame the way the original does.
   */
  const parkField = () => {
    // Note the original only resets y here; an alien keeps its column.
    for (const a of aliens) a.y = -15;
    boss.y = -50;
    ship.x = 200;
    ship.y = 300;
    pickup.x = rand(10, 390);
    pickup.y = rand(-600, -400);
  };

  const step = () => {
    // restartGame() — checked first here so a finished game can still restart.
    if (went('r')) reset();
    if (over) return;

    // --- startGame(): the help card, drawn before anything moves ---
    if (down('h')) parkField();

    // --- levels(): the original re-rolls every alien's speed every frame ---
    for (const a of aliens) a.vy = score >= 50 ? rand(1.5, 2) : rand(1, 1.5);

    // --- playerMovement(): runs even while a menu is open ---
    ftl = Math.min(100, ftl + 1);
    const speed = 4;
    if (down('arrowright')) ship.x += speed;
    if (down('arrowleft')) ship.x -= speed;
    if (down('arrowup')) ship.y -= speed;
    if (down('arrowdown')) ship.y += speed;

    if (ftl >= 100 && down('q')) {
      // The original spends 98 jumping right and 99 in every other direction.
      if (down('arrowright')) { ship.x += 100; ftl -= 98; }
      else if (down('arrowleft')) { ship.x -= 100; ftl -= 99; }
      else if (down('arrowup')) { ship.y -= 100; ftl -= 99; }
      else if (down('arrowdown')) { ship.y += 100; ftl -= 99; }
    }
    ship.x = Math.max(BOX.spaceShip.w / 2, Math.min(W - BOX.spaceShip.w / 2, ship.x));
    ship.y = Math.max(BOX.spaceShip.h / 2, Math.min(H - BOX.spaceShip.h / 2, ship.y));

    // Three projectiles taken in turn — the original's stand-in for an array.
    if (went(' ')) {
      const s = shots[shotTurn];
      s.x = ship.x;
      s.y = ship.y;
      shotTurn = (shotTurn + 1) % 3;
    }

    if (bomb >= 1 && went('e')) {
      bomb -= 1;
      score += 4;
      for (const a of aliens) spawnAlien(a);
      bossHealth = 0;
    }

    // --- alienShot(): collisions ---
    for (const a of aliens) {
      for (const s of shots) {
        if (touching(a, BOX.alien, s, BOX.projectile)) {
          spawnAlien(a);
          score += 1;
          s.y = -50;
        }
      }
      for (let i = 0; i < bases.length; i++) {
        if (baseHealth[i] > 0 && touching(a, BOX.alien, bases[i], BOX.homeBase)) {
          spawnAlien(a);
          baseHealth[i] -= 1;
        }
      }
    }
    if (touching(pickup, BOX.bomb, ship, BOX.spaceShip)) {
      pickup.x = rand(10, 390);
      pickup.y = rand(-600, -400);
      bomb += 1;
    }
    if (score >= 30 && bossHealth > 0) {
      if (boss.y < -40) {
        boss.y = 60;
        boss.vx = 5;
        boss.vy = 0.5;
      }
      if (boss.x >= W - 20) boss.vx = -5;
      if (boss.x <= 20) boss.vx = 5;
      for (const s of shots) {
        if (touching(boss, BOX.angryAlien, s, BOX.projectile)) {
          bossHealth -= 1;
          s.y = -50;
        }
      }
      for (let i = 0; i < bases.length; i++) {
        if (baseHealth[i] > 0 && touching(boss, BOX.angryAlien, bases[i], BOX.homeBase)) {
          baseHealth[i] -= 2;
          bossHealth = 0;
        }
      }
    }

    // --- store(): the shop, and the same fake pause ---
    if (down('t')) {
      if (went('1') && score >= 20) {
        bomb += 1;
        score -= 20;
      }
      if (went('2') && score >= 50) {
        lives += 1;
        score -= 50;
      }
      if (went('3') && score >= 200) {
        baseHealth = [8, 8, 8];
        score -= 200;
      }
      parkField();
      bossHealth = 0; // browsing the shop despawns the boss, as in the original
    }

    // --- spaceshipLife(): ship collisions, checked after the store parks ---
    for (const a of aliens) {
      if (touching(a, BOX.alien, ship, BOX.spaceShip)) {
        spawnAlien(a);
        lives -= 1;
        ship.x = 200;
        ship.y = 300;
      }
    }
    if (score >= 30 && boss.y > -40 && touching(boss, BOX.angryAlien, ship, BOX.spaceShip)) {
      lives -= 1;
      bossHealth -= 1;
      ship.x = 200;
      ship.y = 300;
    }
    if (bossHealth <= 0) {
      // alien6health <= 0 sends it back to the corner and re-arms it.
      if (score >= 30 && boss.y > -40) score += 1;
      boss.x = 0;
      boss.y = -50;
      bossHealth = 2;
    }

    // --- drawSprites(): Game Lab applies velocity at the END of the frame ---
    // Nothing recycles an alien that falls off the bottom — see parkField().
    for (const a of aliens) a.y += a.vy;
    for (const s of shots) {
      s.y += s.vy;
      if (s.y < -20) s.y = -50;
    }
    boss.x += boss.vx;
    boss.y += boss.vy;
    pickup.y += pickup.vy;

    if (lives <= 0 || baseHealth.every((h) => h <= 0)) over = true;
  };

  const render = () => {
    drawBackground();

    if (over) {
      drawGameOver();
      return;
    }

    for (let i = 0; i < bases.length; i++) {
      const h = baseHealth[i];
      if (h <= 0) continue;
      // homeBase_1 is full health through homeBase_8 at one hit remaining.
      // homeBase_1 is undamaged, homeBase_8 is one hit from gone.
      drawSprite('homeBase', bases[i], { frame: Math.min(7, Math.max(0, 8 - h)) });
    }
    for (const s of shots) if (s.y > -40) drawSprite('projectile', s);
    for (const a of aliens) drawSprite('alien', a);
    if (score >= 30 && boss.y > -40) {
      // The original swaps the boss to the plain alien art once it is damaged.
      drawSprite(bossHealth >= 2 ? 'angryAlien' : 'alien', boss);
    }
    drawSprite('bomb', pickup);
    drawSprite('spaceShip', ship);

    drawHud();
    if (down('h')) drawHelp();
    if (down('t')) drawStore();
  };

  let acc = 0;
  let last = 0;
  const loop = (now: number) => {
    if (!last) last = now;
    // Clamped so a backgrounded tab does not return and run a thousand steps.
    acc += Math.min(250, now - last);
    last = now;
    while (acc >= STEP_MS) {
      tick++;
      step();
      pressed.clear();
      acc -= STEP_MS;
    }
    render();
    raf = requestAnimationFrame(loop);
  };

  // ---- lifecycle ------------------------------------------------------
  const sizeCanvas = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'alphabetic';
  };

  const start = async () => {
    if (running) return;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    sizeCanvas();
    await loadAssets();
    reset();
    acc = 0;
    last = 0;
    running = true;
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    raf = requestAnimationFrame(loop);
  };

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    held.clear();
    pressed.clear();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    startBtn.hidden = false;
    stopBtn.hidden = true;
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);

  // Nothing animates before the reader asks — which also satisfies
  // prefers-reduced-motion without a separate code path.
  sizeCanvas();
  makeStars();
  drawBackground();
  if (reduced) {
    // Held still deliberately: the start overlay is the only moving part.
  }

  return () => {
    stop();
    el.innerHTML = '';
  };
}
