// The ONE camera-decode configuration. Every scan surface in the app builds its
// scan loop here, so a fix made for one operator complaint reaches all of them.
//
// ENGINE: zxing-wasm (zxing-cpp compiled to WebAssembly). It replaced the
// pure-JS @zxing/library, whose DataMatrix detector was genuinely weaker than a
// hardware imager on small glossy UDI squares and whose JS port is unmaintained
// upstream. The WASM engine is a library we bundle and serve ourselves — this
// is NOT the Chromium-only native BarcodeDetector API, which stays banned
// (absent in Safari/Firefox). The swap was gated on the degradation bench in
// bench/ — read BENCH.md before touching the options here; the confirmation
// policy in <CameraScanner> was measured against THIS configuration.
//
// WHY WE OWN THE FRAME LOOP (instead of a library helper): zxing-wasm decodes
// whatever ImageData we hand it, which lets the loop decode the region the
// operator actually SEES. The old engine decoded 100% of the frame while the
// preview stage showed ~42% of its height — anything above or below the
// visible window was a candidate the operator could not see.
//
// A GREAT PHONE CAMERA DOES NOT MEAN A GREAT FRAME. We decode the resolution
// the MediaStream TRACK negotiated, NOT the phone's sensor and NOT the CSS
// size of the <video>. So we ASK for 1920x1080 (`ideal`, so a weaker device
// can under-deliver instead of failing), and the scanner displays
// `trackResolution()` live — read the number off the preview before
// theorising about a label that will not read.
//
// The still-photo path (`decodeStillImage`) stays the escalation for a label
// the live stream will not read: the phone's own camera app produces a
// properly focused, full-resolution photo no getUserMedia stream will match.

import type { ReadResult, ReaderOptions } from 'zxing-wasm/reader';

/**
 * Camera request shared by every surface. `ideal` everywhere — an `exact`
 * constraint that the device cannot meet fails getUserMedia outright, which is
 * how a scanner button goes dead on one phone model and nobody can say why.
 */
export const SCAN_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  // NO DECODER SETTING READS A BLURRED FRAME. The stream is what the decoder
  // sees, and a small glossy UDI square on shrink-wrap is a FOCUS problem long
  // before it is a decode problem — for a long time we never asked for
  // autofocus at all and took whatever mode the browser defaulted to. Android
  // Chrome honours this; iOS Safari is already continuous and ignores it.
  // `ideal`, like everything else here: an `exact` focusMode a device cannot
  // meet fails getUserMedia outright and the scanner goes dead.
  focusMode: { ideal: 'continuous' },
} as MediaTrackConstraints;

/**
 * Which symbologies a surface is willing to believe.
 *
 * A DECODER THAT CAN READ EVERYTHING CAN ALSO INVENT ANYTHING. Measured
 * against our own packing-slip barcode degraded across thousands of hand-held
 * frames: with every format enabled, wrong-but-checksum-valid payloads appear
 * (Code 128 bars arriving as an EAN-13). Restricting the set to what the
 * surface actually prints removed the whole EAN/UPC class and cost nothing
 * measurable in read rate.
 *
 *   'all'       every format the engine supports. Nothing renders with this any
 *               more — see 'universal'. Kept because `decodeStillImage` needs a
 *               last-resort default and because narrowing is a decision a future
 *               surface should have to make explicitly.
 *   'shipping'  our packing slip and the three carriers' labels. All Code 128;
 *               QR and DataMatrix ride along because a 2D code cannot be
 *               confused with a linear one and costs a surface nothing.
 *   'product'   a product package: retail GTINs plus the UDI 2D squares.
 *   'universal' shipping ∪ product — everything this operation prints or
 *               receives, and what the universal Scan page runs (replacing 'all').
 *
 * WHY 'universal' IS NOT 'all'. The Scan page genuinely does not know what it is
 * about to be shown, but "unknown" is not "anything". Counted over ~53,000
 * archived print jobs from a 180-day window, every symbology this operation
 * emits:
 *
 *   ^BC Code 128   50,415     ^BD MaxiCode  17,217  (carrier passthrough)
 *   ^BX DataMatrix 22,933     ^B7 PDF417     8,430  (carrier passthrough)
 *   ^B3 Code 39    20,009     ^B2 ITF            0
 *   ^BQ QR            176     ^BE EAN-13         0
 *
 * — plus the retail GTINs and UDI DataMatrix squares on the goods we BUY. That
 * is the whole list, and 'universal' covers it. The ~30-format 'all' set adds
 * DataBar, Aztec, Telepen, DXFilmEdge, Codabar, MSI and more that appear on
 * nothing we handle.
 *
 * MaxiCode and PDF417 are real — 25,647 labels between them — and are excluded
 * ANYWAY, deliberately: they are the carrier's own 2D block, and the number that
 * names an order is the Code 128 tracking barcode, which the tracking-number
 * lookup already handles. Reading the 2D block would add fabrication surface and
 * buy no lookup we can perform.
 *
 * ITF14 IS IN, bare ITF is not. The census above counts what we PRINT, and it
 * cannot see what we RECEIVE: a manufacturer's outer carton classically carries a
 * GTIN-14 case code in Interleaved 2 of 5, and the Scan page is the surface an
 * un-catalogued carton gets pointed at. 'all' could read those; dropping to
 * 'universal' without ITF14 would have been a capability REMOVED, not merely one
 * not added. Bare ITF stays out — it short-reads a truncated subset of the bars
 * as a valid shorter code, exactly the fabrication class this file exists to
 * avoid, whereas ITF14 is fixed at 14 digits with a check digit. (The label
 * conversion path can also EMIT ^B2 when an upstream EPL capture declares
 * barcode type '2', so the outbound direction is covered too.)
 *
 * It is expressed as a UNION rather than a copy so a format added to 'shipping'
 * or 'product' reaches the Scan page automatically — the surface that must never
 * be the narrow one.
 *
 * If a real package shows up carrying something absent from a set, ADD IT —
 * do not widen a surface back to 'all'.
 */
export type ScanFormatSet = 'all' | 'shipping' | 'product' | 'universal';

// zxing-wasm CANONICAL format names — the exact strings `ReadResult.format`
// returns (`ReadOutputBarcodeFormat`). NOT the HRI aliases: the engine accepts
// 'EAN-13' as INPUT but reports 'EAN13' as output, and a map keyed on the
// alias silently falls through to the lowercase fallback ('ean13' where every
// stored row says 'ean_13'). Caught in review — decoder.test.ts now checks
// this map against the package's own READABLE_BARCODE_FORMATS export, so a
// renamed format fails the suite instead of drifting the audit trail.
const SHIPPING_FORMATS = ['Code128', 'QRCode', 'DataMatrix'];
// ITF14 — and never bare 'ITF'. A manufacturer's OUTER CARTON classically carries
// a GTIN-14 case code in Interleaved 2 of 5, and the Scan page is exactly the
// "what IS this box" surface for an un-catalogued carton, so leaving 'all' would
// otherwise have REMOVED a capability rather than merely declined to add one
// (caught in review: the print-job census measured what we PRINT, which cannot
// see what we RECEIVE). ITF14 is fixed at 14 digits and carries a check digit;
// bare ITF is the variant that short-reads a truncated subset as a valid shorter
// code, which is the fabrication class this file exists to avoid.
const PRODUCT_FORMATS = ['Code128', 'Code39', 'ITF14', 'UPCA', 'UPCE', 'EAN8', 'EAN13', 'QRCode', 'DataMatrix'];

const FORMAT_SETS: Record<Exclude<ScanFormatSet, 'all'>, string[]> = {
  shipping: SHIPPING_FORMATS,
  product: PRODUCT_FORMATS,
  universal: [...new Set([...SHIPPING_FORMATS, ...PRODUCT_FORMATS])],
};

// Engine output format -> the audit-trail name the barcode store already uses
// (the previous engine's enum names, lower-cased — kept so the stored history
// survives the engine swap). Engine variant names collapse to the family the
// old enum had (Code39Ext is still a Code 39 to the audit trail). Complete over
// READABLE_BARCODE_FORMATS, asserted in decoder.test.ts (exported for exactly
// that test — not an app API).
export const AUDIT_SYMBOLOGY: Record<string, string> = {
  Codabar: 'codabar',
  Code39: 'code_39',
  Code39Std: 'code_39',
  Code39Ext: 'code_39',
  Code32: 'code_32',
  PZN: 'pzn',
  Code93: 'code_93',
  Code128: 'code_128',
  ITF: 'itf',
  ITF14: 'itf_14',
  DataBar: 'rss_14',
  DataBarOmni: 'rss_14',
  DataBarStk: 'rss_14',
  DataBarStkOmni: 'rss_14',
  DataBarLtd: 'rss_limited',
  DataBarExp: 'rss_expanded',
  DataBarExpStk: 'rss_expanded',
  EANUPC: 'ean_upc',
  EAN13: 'ean_13',
  EAN8: 'ean_8',
  ISBN: 'ean_13',
  UPCA: 'upc_a',
  UPCE: 'upc_e',
  Telepen: 'telepen',
  TelepenAlpha: 'telepen',
  TelepenNumeric: 'telepen',
  OtherBarcode: 'unknown',
  DXFilmEdge: 'dx_film_edge',
  PDF417: 'pdf_417',
  CompactPDF417: 'pdf_417',
  MicroPDF417: 'micro_pdf_417',
  Aztec: 'aztec',
  AztecCode: 'aztec',
  AztecRune: 'aztec',
  QRCode: 'qr_code',
  QRCodeModel1: 'qr_code',
  QRCodeModel2: 'qr_code',
  MicroQRCode: 'micro_qr_code',
  RMQRCode: 'rmqr_code',
  DataMatrix: 'data_matrix',
  MaxiCode: 'maxicode',
};

/** Symbology name for the audit trail, lower-cased; 'unknown' when absent. */
export function auditSymbology(format: string | null | undefined): string {
  if (!format) return 'unknown';
  return AUDIT_SYMBOLOGY[format] ?? format.toLowerCase();
}

/**
 * Decode options for a surface. Pure — safe to call (and unit-test) without
 * the WASM module loaded.
 *
 * THE GS1 CONTRACT LIVES IN textMode + composeScanPayload, NOT IN A HINT.
 * The old engine dropped every FNC1 unless ASSUME_GS1 was set — that is why a
 * postal label once scanned as one undelimited 34-digit run and matched
 * nothing. zxing-cpp always keeps the separators; `textMode: 'Plain'` yields
 * the GS (0x1D) bytes the server-side GS1 parser walks.
 */
export function readerOptionsFor(set: ScanFormatSet, opt: { inverted?: boolean } = {}): ReaderOptions {
  const opts: ReaderOptions = {
    // KEEP THIS ON. It is the most expensive option per frame (measured:
    // 12.5 -> 21.7 ms on a missed 1080x810 frame), and it is buying the read
    // rate — off, the marginal Code 128 the fabrication bench is built around
    // drops from 67% of frames to 47%. Turning it off would make scanning feel
    // worse while looking faster in a profile.
    tryHarder: true,
    // Off on the LIVE loop, where 4 ms a frame is the whole point, and on for the
    // still-photo escalation, where latency is irrelevant and giving up a read is
    // the expensive outcome. "We never print or buy a reversed symbol" is an
    // ASSERTION, not a measurement — every bench fixture is a printed
    // dark-on-light label, so no run here could have seen the classes that would
    // refute it (laser-etched DPM DataMatrix UDI marks on metal instruments are
    // commonly light-on-dark; so is any code read off a screen in dark mode).
    // Keeping the escalation path inverted-capable is what stops that assertion
    // becoming a dead end. Caught in review.
    tryInvert: opt.inverted ?? false,
    textMode: 'Plain',
    maxNumberOfSymbols: 1,
  };
  if (set !== 'all') opts.formats = FORMAT_SETS[set] as ReaderOptions['formats'];
  return opts;
}

/**
 * The payload handed to callers (and ultimately to the server-side GS1 parser).
 * A GS1 result carries its AIM symbology identifier (`]C1` for GS1-128,
 * `]d2` for GS1 DataMatrix) so the server parser sees the anchor it keys on;
 * everything else stays bare, exactly like the old engine's output. Verified
 * during the swap: both engines' forms parse to identical lookup keys and
 * bindable payloads (the DataMatrix anchor differs in FORM — leading GS
 * before, `]d2` now — but not in what it resolves or binds).
 */
export function composeScanPayload(
  result: Pick<ReadResult, 'text' | 'symbologyIdentifier' | 'contentType'>,
): string {
  if (result.contentType === 'GS1' && result.symbologyIdentifier) {
    return `${result.symbologyIdentifier}${result.text}`;
  }
  return result.text;
}

/** One accepted-or-blank decode attempt, normalized for the component. */
export interface ScanHit {
  payload: string;
  symbology: string;
}

export interface ScanLoopControls {
  stop: () => void;
}

export interface ScanLoopOptions {
  video: HTMLVideoElement;
  formats: ScanFormatSet;
  /**
   * Called on EVERY attempt — a blank frame arrives as null. <CameraScanner>'s
   * confirmation streak depends on seeing the blanks, not just the reads.
   *
   * RETURN TRUE WHEN THE READ WAS ACCEPTED (the confirmation streak completed),
   * false/undefined while a streak is still building. The loop pauses
   * `successPauseMs` only on an accept — see the note on successPauseMs.
   */
  onFrame: (hit: ScanHit | null) => boolean | void;
  /**
   * TARGET ms between the START of one attempt and the start of the next — a
   * cadence, not a sleep. See the note on DEFAULT_ATTEMPT_MS.
   */
  attemptMs?: number;
  /**
   * ms to pause after an ACCEPTED read, so a `continuous` surface does not
   * re-fire on the item still sitting in front of the lens.
   *
   * IT USED TO PAUSE AFTER ANY FRAME THAT DECODED, WHICH IS THE OPPOSITE OF WHAT
   * THE SCANNER WANTS (since fixed). The confirmation streak needs N frames
   * that AGREE, and every one of those frames decodes — so an anti-storm pause
   * meant for a finished read was being charged between the frames still trying
   * to agree. A 3-confirmation read cost 2 x 800 ms of pure waiting, which is
   * where the Scan page's latency actually lived; the frame cadence only ever
   * governed the blank frames while the operator was still aiming. The loop now
   * pauses only when `onFrame` reports an accept.
   */
  successPauseMs?: number;
}

/**
 * How often the loop LOOKS while the operator is still aiming.
 *
 * IT WAS 120 ms, AND THAT NUMBER WAS NEVER OURS. `delayBetweenScanAttempts: 120`
 * / `delayBetweenScanSuccess: 800` are @zxing/library's
 * `BrowserMultiFormatReader` defaults, and the engine swap carried them
 * verbatim into this hand-rolled loop. They were tuned for a pure-JS decoder.
 * Measured on the bench's own fixtures composited into a real 1080x810
 * cover-crop, zxing-cpp decodes a frame in 5-22 ms, so the loop sat idle
 * ~85-90% of the wall clock between looks.
 *
 * BUT THIS WAS NEVER WHERE THE LATENCY LIVED, and the first version of this
 * comment claimed it was (~390-440 ms for a 3-confirmation read — wrong, caught
 * in review). `attemptMs` only ever governed BLANK frames. Every frame of a
 * confirmation streak decodes, and the loop used to charge `successPauseMs`
 * after any frame that decoded — so the frames trying to AGREE were 800 ms
 * apart and a 3-confirmation read really cost time-to-first-decode + 1,600 ms.
 * That is fixed separately (see `successPauseMs`); this constant is now
 * honestly just the aiming cadence.
 *
 * WHY 60 AND NOT 40. Looking more often is not free: adjacent frames become MORE
 * ALIKE, and "a drifting hand cannot repeat a wrong read" is the entire premise
 * of the <CameraScanner> confirmation streak. The bench's `--spacingMs` models
 * exactly that as an AR(1) correlation (it does NOT scale amplitude — the
 * first cut did, which suppressed the fabrications the gate was watching for and
 * made it unfailable). Do NOT lower this without re-running that gate, and read
 * the WRONG column, not the speed one.
 */
const DEFAULT_ATTEMPT_MS = 60;

/**
 * Floor on the gap between attempts. The cadence subtracts decode time, so on a
 * phone slow enough to spend the whole budget decoding this is what still yields
 * to the event loop — without it the loop could re-enter immediately and starve
 * the compositor, freezing the preview it exists to render.
 */
const MIN_YIELD_MS = 8;

/**
 * Hardest a slow device is allowed to work. `idle >= elapsed / 2` caps the
 * decoder at ~2/3 of wall clock, so a phone whose frames cost 200 ms backs off
 * to a 300 ms cadence on its own instead of pinning its main thread. Without
 * this the cadence target alone would tell exactly the weakest device to try
 * hardest — the decode runs on the UI thread.
 */
const MAX_DUTY_RATIO = 0.5;

// The WASM module is ~1MB and lazy: nothing loads until a scan surface opens.
// The binary is bundled and served from OUR origin via Vite's ?url asset —
// never a CDN (a scanner must not stop working because a third party is
// down). prepareZXingModule is module-global and idempotent per session.
let enginePromise: Promise<typeof import('zxing-wasm/reader')> | null = null;

async function loadEngine(): Promise<typeof import('zxing-wasm/reader')> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [engine, wasmUrl] = await Promise.all([
        import('zxing-wasm/reader'),
        import('zxing-wasm/reader/zxing_reader.wasm?url').then((m) => m.default),
      ]);
      // fireImmediately awaits the .wasm BINARY, not just the JS chunk.
      // Without it the binary is fetched lazily inside the first readBarcodes
      // call, whose failure the frame loop swallows as a blank frame — a live
      // preview saying "Waiting for scan…" forever, with the failed fetch
      // cached un-evictably inside the library. Found in review.
      await engine.prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) =>
            (path.endsWith('.wasm') ? wasmUrl : prefix + path),
        },
        fireImmediately: true,
      });
      return engine;
    })();
    // A transient load failure (flaky warehouse wifi mid-chunk) must not poison
    // every later attempt with a cached rejection.
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

/**
 * Open the camera on `video` and decode frames until stopped.
 *
 * Throws (getUserMedia rejection, engine load failure) only BEFORE the loop
 * starts — the caller shows its camera-blocked state. After that, per-frame
 * failures are just blank frames.
 */
export async function startScanLoop({
  video,
  formats,
  onFrame,
  attemptMs = DEFAULT_ATTEMPT_MS,
  successPauseMs = 800,
}: ScanLoopOptions): Promise<ScanLoopControls> {
  // Engine and camera load in parallel, but a failed HALF must not strand the
  // other: if the engine chunk fails while getUserMedia resolves (slow
  // permission prompt, fast network error — the common ordering), the stream
  // exists with no reference anywhere the component can reach, and the camera
  // light stays on until the tab closes. Stop it before rethrowing.
  const streamPromise = navigator.mediaDevices.getUserMedia({ video: SCAN_VIDEO_CONSTRAINTS });
  let readBarcodes: Awaited<ReturnType<typeof loadEngine>>['readBarcodes'];
  let stream: MediaStream;
  try {
    [{ readBarcodes }, stream] = await Promise.all([loadEngine(), streamPromise]);
  } catch (err) {
    streamPromise.then((s) => {
      for (const track of s.getTracks()) { try { track.stop(); } catch { /* ended */ } }
    }).catch(() => { /* camera failed too — nothing to release */ });
    throw err;
  }
  const opts = readerOptionsFor(formats);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch { /* already ended */ }
    }
  };

  try {
    video.srcObject = stream;
    // playsInline/muted/autoplay are the video element's job (the component
    // sets them); play() here covers browsers that ignore autoplay on a
    // programmatic srcObject swap.
    await video.play().catch(() => { /* autoplay-blocked; poster stays */ });
  } catch (err) {
    stop();
    throw err;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // DECODE WHAT THE OPERATOR SEES. The preview video is object-fit: cover
  // inside a 4:3 stage over a (typically) 9:16 stream, so the element shows a
  // centred crop — ~42% of the frame's height. The old engine decoded 100% of
  // the frame, so a barcode above or below the visible window could be the
  // thing that scanned, and the operator had no way to know it existed. Mirror
  // the cover geometry; when the element has no layout yet, decode the full
  // frame.
  const visibleSourceRect = () => {
    const fw = video.videoWidth;
    const fh = video.videoHeight;
    const ew = video.clientWidth;
    const eh = video.clientHeight;
    let sx = 0; let sy = 0; let sw = fw; let sh = fh;
    if (ew > 0 && eh > 0 && fw > 0 && fh > 0) {
      const elAspect = ew / eh;
      const frAspect = fw / fh;
      if (frAspect > elAspect) {
        sw = Math.max(1, Math.round(fh * elAspect));
        sx = Math.floor((fw - sw) / 2);
      } else if (frAspect < elAspect) {
        sh = Math.max(1, Math.round(fw / elAspect));
        sy = Math.floor((fh - sh) / 2);
      }
    }
    return { sx, sy, sw, sh };
  };

  const tick = async () => {
    if (stopped) return;
    // MONOTONIC, not Date.now(): the cadence subtracts this from the budget and
    // then floors at `elapsed * MAX_DUTY_RATIO`, so a wall-clock jump forward
    // (NTP correction, waking from sleep) would be read as a colossally slow
    // decode and park the loop for half the jump — a scanner that silently stops
    // looking. performance.now() cannot jump.
    const startedAt = performance.now();
    let hit: ScanHit | null = null;
    if (ctx && video.readyState >= 2 && video.videoWidth > 0) {
      const { sx, sy, sw, sh } = visibleSourceRect();
      canvas.width = sw;
      canvas.height = sh;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
      try {
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const results = await readBarcodes(image, opts);
        const r = results.find((x) => x.isValid && x.text);
        if (r) hit = { payload: composeScanPayload(r), symbology: auditSymbology(r.format) };
      } catch { /* a frame that failed to decode is a blank frame */ }
    }
    if (stopped) return; // stop() raced the await — do not call back into a dead component
    // An unreadable video (tab switched, OS lock) reports as a blank frame too:
    // the confirmation streak must not survive a camera suspension — back-to-
    // back agreement is the measured property, and a gap is a gap.
    // TRUE means the confirmation streak COMPLETED, not merely that this frame
    // decoded. Only an accept earns the anti-storm pause.
    const accepted = onFrame(hit) === true;
    if (stopped) return; // onFrame may have stopped us synchronously ('once' accept)
    // A CADENCE, NOT A SLEEP. `attemptMs` is the target gap between attempt
    // STARTS, so the decode is paid out of the budget instead of added on top of
    // it — the old form charged a slow phone twice, once for the slow decode and
    // again for a full-length wait after it. MIN_YIELD_MS keeps the event loop
    // breathing; MAX_DUTY_RATIO makes a device that cannot keep up back off
    // rather than pin its UI thread.
    const elapsed = performance.now() - startedAt;
    const idle = Math.max(MIN_YIELD_MS, attemptMs - elapsed, elapsed * MAX_DUTY_RATIO);
    timer = setTimeout(tick, accepted ? successPauseMs : idle);
  };
  timer = setTimeout(tick, attemptMs);

  return { stop };
}

/**
 * Turn the torch on if the device exposes it. Returns false when unsupported —
 * callers hide the button rather than offering one that does nothing. Glare and
 * a dim shelf are the two most common reasons a printed DataMatrix will not
 * decode, and the torch fixes one of them.
 */
export async function setTorch(stream: MediaStream | null, on: boolean): Promise<boolean> {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return false;
  const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
  if (!caps.torch) return false;
  try {
    // `torch` is a real constraint on Android Chrome and iOS Safari 17.4+ but is
    // not in the TS DOM lib, so the cast has to go through unknown.
    await track.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints);
    return true;
  } catch {
    return false;
  }
}

export function hasTorch(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks?.()[0];
  const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
  return Boolean(caps.torch);
}

/**
 * What the camera ACTUALLY gave us, e.g. "1920×1080". Displayed in the preview
 * so a failed scan produces a measurement instead of a theory — the constraint
 * above is a request, and the browser is free to ignore it.
 */
export function trackResolution(stream: MediaStream | null): string | null {
  const track = stream?.getVideoTracks?.()[0];
  const s = track?.getSettings?.();
  if (!s?.width || !s?.height) return null;
  return `${s.width}×${s.height}`;
}

/**
 * Decode a STILL photo — the escalation for a label a live stream will not read.
 *
 * `<input type="file" accept="image/*" capture="environment">` hands control to
 * the phone's own camera app, so the image arrives at full sensor resolution
 * with real autofocus and exposure, which is the quality a getUserMedia preview
 * never has. It is also the only camera path that works at all when
 * getUserMedia is blocked.
 *
 * Three passes, because a small DataMatrix in a 48-megapixel photo is a needle:
 *   1. whole image, capped at 3000px on the long edge,
 *   2. centre 50% at NATIVE resolution — people aim at the middle, and cropping
 *      instead of scaling is what preserves modules-per-pixel,
 *   3. centre 25% at native resolution.
 *
 * FIRST CROP THAT DECODES WINS, and unlike the live stream there is no
 * confirmation pass to back it up — a still is one frame, so there is no second
 * one to agree with it. That is an acceptable trade only because this path is
 * the OPPOSITE of the marginal-resolution case the live confirmation exists for:
 * a phone camera-app photo puts the symbol far above the px/module band where
 * mis-decodes live. Do NOT reuse this function as a shortcut around the live
 * scanner's confirmation.
 */
export async function decodeStillImage(
  file: Blob,
  options: { formats?: ScanFormatSet } = {},
): Promise<ScanHit | null> {
  const { readBarcodes } = await loadEngine();
  // inverted: true — this is the path of last resort; see readerOptionsFor.
  const opts = readerOptionsFor(options.formats ?? 'all', { inverted: true });
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    for (const attempt of stillAttempts(img)) {
      const ctx = attempt.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      try {
        const image = ctx.getImageData(0, 0, attempt.width, attempt.height);
        const results = await readBarcodes(image, opts);
        const r = results.find((x) => x.isValid && x.text);
        if (r) return { payload: composeScanPayload(r), symbology: auditSymbology(r.format) };
      } catch {
        // nothing decodable in this crop — try the next one
      }
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const STILL_MAX_EDGE = 3000;

function* stillAttempts(img: HTMLImageElement): Generator<HTMLCanvasElement> {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return;

  const scale = Math.min(1, STILL_MAX_EDGE / Math.max(w, h));
  yield drawTo(img, 0, 0, w, h, Math.round(w * scale), Math.round(h * scale));

  for (const fraction of [0.5, 0.25]) {
    const cw = Math.round(w * fraction);
    const ch = Math.round(h * fraction);
    yield drawTo(img, Math.round((w - cw) / 2), Math.round((h - ch) / 2), cw, ch, cw, ch);
  }
}

function drawTo(
  img: HTMLImageElement,
  sx: number, sy: number, sw: number, sh: number,
  dw: number, dh: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx?.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_decode_failed'));
    img.src = url;
  });
}
