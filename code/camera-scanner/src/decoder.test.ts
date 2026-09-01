/**
 * The decode-engine seam, tested against the REAL decoder module with only the
 * WASM package mocked. What lives here (and not in CameraScanner.test.tsx):
 * the format allow-lists, the GS1 payload composition the server parser
 * depends on, the audit symbology names, the frame loop, and the still-photo
 * crop ladder.
 *
 * All payloads in this suite are synthetic: order number 12345678, textbook
 * UPC 012345678905, and a made-up postal GS1-128 / UDI DataMatrix with valid
 * SHAPE but invented digits.
 */

const mockReadBarcodes = jest.fn();
const mockPrepare = jest.fn().mockResolvedValue({});
jest.mock('zxing-wasm/reader', () => ({
  readBarcodes: (...args: unknown[]) => mockReadBarcodes(...args),
  prepareZXingModule: (...args: unknown[]) => mockPrepare(...args),
}));
// The Vite ?url asset does not exist as a resolvable module under jest.
jest.mock('zxing-wasm/reader/zxing_reader.wasm?url', () => ({ default: 'blob:wasm' }), { virtual: true });

import {
  AUDIT_SYMBOLOGY,
  auditSymbology,
  composeScanPayload,
  decodeStillImage,
  readerOptionsFor,
  startScanLoop,
  SCAN_VIDEO_CONSTRAINTS,
} from './decoder';
import { makeStreamStub, makeTrackStub } from './streamStub';

const GS = '\x1d';

afterEach(() => {
  mockReadBarcodes.mockReset();
  jest.restoreAllMocks();
});

// ── Options: the format allow-list is half of the wrong-number fix ──────────

test('only \'all\' believes everything; every named surface gets an explicit list', () => {
  expect(readerOptionsFor('all').formats).toBeUndefined();
  expect(readerOptionsFor('shipping').formats).toEqual(['Code128', 'QRCode', 'DataMatrix']);
  expect(readerOptionsFor('product').formats).toEqual(
    ['Code128', 'Code39', 'ITF14', 'UPCA', 'UPCE', 'EAN8', 'EAN13', 'QRCode', 'DataMatrix'],
  );
});

test('\'universal\' is shipping u product — the Scan page is narrowed, not unbounded', () => {
  // The whole point of the change: the Scan page does not know what it will be
  // shown, but "unknown" is not "anything". Asserted as a UNION rather than a
  // literal list so adding a format to either member set reaches the Scan page
  // automatically — it must never be the narrow surface.
  const universal = readerOptionsFor('universal').formats as string[];
  const shipping = readerOptionsFor('shipping').formats as string[];
  const product = readerOptionsFor('product').formats as string[];
  expect(universal).toBeDefined();
  expect([...universal].sort()).toEqual([...new Set([...shipping, ...product])].sort());
  // The carrier 2D block is deliberately absent: the number that names an order
  // is the Code 128, and reading MaxiCode/PDF417 would add fabrication surface
  // for no lookup we can perform.
  expect(universal).not.toContain('MaxiCode');
  expect(universal).not.toContain('PDF417');
});

test('every option set decodes hard and yields Plain text — the GS bytes the server walks', () => {
  for (const set of ['all', 'shipping', 'product', 'universal'] as const) {
    const opts = readerOptionsFor(set);
    // tryHarder OFF is a read-rate regression, not an optimisation: measured,
    // it drops the marginal Code 128 from 67% of frames to 47%.
    expect(opts.tryHarder).toBe(true);
    // Off on the live loop — the inverted pass is pure cost per frame.
    expect(opts.tryInvert).toBe(false);
    // ...but ON for the still-photo escalation, where giving up a read costs more
    // than 4ms ever could and light-on-dark DPM marks are a real class.
    expect(readerOptionsFor(set, { inverted: true }).tryInvert).toBe(true);
    expect(opts.textMode).toBe('Plain');
    expect(opts.maxNumberOfSymbols).toBe(1);
  }
});

test('EVERY format the real engine can output has an explicit audit name — no fallback', () => {
  // Review caught the first version of this suite checking the map against
  // itself: it was keyed on INPUT aliases ('EAN-13') while the engine outputs
  // canonical names ('EAN13'), so every retail scan would have stored 'ean13'
  // where every historical row says 'ean_13'. Assert against the PACKAGE's own
  // export of what ReadResult.format can be — a library rename now fails here
  // instead of silently drifting the audit trail.
  const { READABLE_BARCODE_FORMATS } = jest.requireActual('zxing-wasm/reader');
  expect(READABLE_BARCODE_FORMATS.length).toBeGreaterThan(30);
  const unmapped = (READABLE_BARCODE_FORMATS as string[]).filter((name) => !(name in AUDIT_SYMBOLOGY));
  expect(unmapped).toEqual([]);
});

test('the camera is asked for 1920x1080, environment-facing, continuous focus — all ideal', () => {
  // `exact` fails getUserMedia outright on a device that cannot meet it; that
  // is how a scan button goes dead on one phone model with no error anywhere.
  // focusMode: no decoder setting reads a blurred frame, and a small glossy
  // UDI square is a focus problem before it is a decode problem.
  expect(SCAN_VIDEO_CONSTRAINTS).toEqual({
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    focusMode: { ideal: 'continuous' },
  });
  for (const value of Object.values(SCAN_VIDEO_CONSTRAINTS)) {
    expect(value).not.toHaveProperty('exact');
  }
});

// ── Symbology names: the audit trail survives the engine swap ───────────────

test('engine format names map to the audit names the barcode store already uses', () => {
  // Canonical OUTPUT names ('EAN13', 'UPCA') — what ReadResult.format really
  // carries — not the 'EAN-13'/'UPC-A' input aliases the first cut used.
  expect(auditSymbology('Code128')).toBe('code_128');
  expect(auditSymbology('DataMatrix')).toBe('data_matrix');
  expect(auditSymbology('UPCA')).toBe('upc_a');
  expect(auditSymbology('EAN13')).toBe('ean_13');
  expect(auditSymbology('EAN8')).toBe('ean_8');
  expect(auditSymbology('UPCE')).toBe('upc_e');
  expect(auditSymbology('QRCode')).toBe('qr_code');
  expect(auditSymbology('ISBN')).toBe('ean_13'); // an ISBN is an EAN-13 to the audit trail
  expect(auditSymbology('SomethingNew')).toBe('somethingnew'); // fallback, never a crash
  expect(auditSymbology(null)).toBe('unknown');
});

// ── GS1 payload composition: the wire contract with the server parser ───────

test('a GS1-128 payload carries ]C1 and its GS separators — the postal-label case', () => {
  // Without the AIM identifier and separators, a postal label arrives as one
  // undelimited 34-digit run that matches no tracking number we store.
  expect(composeScanPayload({
    text: `420123456789${GS}9200123456789012345675`,
    symbologyIdentifier: ']C1',
    contentType: 'GS1',
  })).toBe(`]C1420123456789${GS}9200123456789012345675`);
});

test('a GS1 DataMatrix payload carries ]d2 — parses to the same GTIN the old form did', () => {
  // The old engine emitted a LEADING GS instead; the server parser accepts
  // either anchor and binds the same GTIN (verified during the swap).
  expect(composeScanPayload({
    text: '010001234567890521DEMO123456',
    symbologyIdentifier: ']d2',
    contentType: 'GS1',
  })).toBe(']d2010001234567890521DEMO123456');
});

test('a plain barcode stays bare — no identifier prefix on a UPC or a slip number', () => {
  expect(composeScanPayload({ text: '12345678', symbologyIdentifier: ']C0', contentType: 'Text' }))
    .toBe('12345678');
  expect(composeScanPayload({ text: '012345678905', symbologyIdentifier: ']E0', contentType: 'Text' }))
    .toBe('012345678905');
});

// ── The frame loop ──────────────────────────────────────────────────────────

function stubVideoPipeline() {
  const stop = jest.fn();
  const tracks = [makeTrackStub({ stop })];
  const stream = makeStreamStub(tracks);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: jest.fn().mockResolvedValue(stream) },
  });
  const video = document.createElement('video');
  Object.defineProperty(video, 'readyState', { configurable: true, get: () => 2 });
  Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 480 });
  Object.defineProperty(video, 'srcObject', { configurable: true, writable: true, value: null });
  Object.defineProperty(video, 'play', { configurable: true, value: jest.fn().mockResolvedValue(undefined) });
  jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(function ctx(this: HTMLCanvasElement) {
    const canvas = this;
    return {
      drawImage: jest.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: canvas.width, height: canvas.height }),
    } as unknown as CanvasRenderingContext2D;
  });
  return { video, tracks, stop };
}

test('the loop hands the caller a composed, audit-named hit — and null for a blank frame', async () => {
  const { video } = stubVideoPipeline();
  mockReadBarcodes
    .mockResolvedValueOnce([]) // blank frame
    .mockResolvedValue([{
      isValid: true,
      text: `420123456789${GS}9200123456789012345675`,
      symbologyIdentifier: ']C1',
      contentType: 'GS1',
      format: 'Code128',
    }]);
  const frames: Array<{ payload: string; symbology: string } | null> = [];
  const controls = await startScanLoop({
    video, formats: 'shipping', attemptMs: 1, successPauseMs: 1, onFrame: (h) => frames.push(h),
  });
  try {
    await new Promise((r) => { setTimeout(r, 50); });
  } finally {
    controls.stop();
  }
  expect(frames[0]).toBeNull();
  expect(frames[1]).toEqual({
    payload: `]C1420123456789${GS}9200123456789012345675`,
    symbology: 'code_128',
  });
  // The surface's narrowing reached the engine on every call.
  expect(mockReadBarcodes.mock.calls[0][1].formats).toEqual(['Code128', 'QRCode', 'DataMatrix']);
});

test('stop() ends the loop and releases every track — the camera light goes off', async () => {
  const { video, stop } = stubVideoPipeline();
  mockReadBarcodes.mockResolvedValue([]);
  const onFrame = jest.fn();
  const controls = await startScanLoop({ video, formats: 'all', attemptMs: 1, onFrame });
  await new Promise((r) => { setTimeout(r, 20); });
  controls.stop();
  const callsAtStop = onFrame.mock.calls.length;
  await new Promise((r) => { setTimeout(r, 30); });
  expect(onFrame.mock.calls.length).toBe(callsAtStop);
  expect(stop).toHaveBeenCalled();
});

test('the loop decodes the VISIBLE crop of a portrait stream, not the whole frame', async () => {
  // The preview video is object-fit: cover in a 4:3 stage over a 9:16 stream:
  // the operator sees ~42% of the frame's height. A barcode above or below that
  // window must not be a candidate — the old engine decoded 100% of the frame
  // and could lock onto a label the operator could not see.
  const { video } = stubVideoPipeline();
  Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 1080 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 1920 });
  Object.defineProperty(video, 'clientWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(video, 'clientHeight', { configurable: true, get: () => 300 });
  mockReadBarcodes.mockResolvedValue([]);
  const controls = await startScanLoop({ video, formats: 'shipping', attemptMs: 1, onFrame: () => {} });
  try {
    await new Promise((r) => { setTimeout(r, 30); });
  } finally {
    controls.stop();
  }
  const [image] = mockReadBarcodes.mock.calls[0];
  expect(image.width).toBe(1080);
  expect(image.height).toBe(810); // 1080 / (400/300) — the centred cover crop
});

test('a refused camera throws to the caller and leaves no live track behind', async () => {
  const tracks = [{ stop: jest.fn() }];
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: jest.fn().mockRejectedValue(new Error('NotAllowedError')) },
  });
  const video = document.createElement('video');
  await expect(startScanLoop({ video, formats: 'all', onFrame: () => {} })).rejects.toThrow();
  expect(tracks[0].stop).not.toHaveBeenCalled(); // no stream was ever acquired
});

test('an engine that fails to load releases the camera it never got to use', async () => {
  // The reversed race: getUserMedia RESOLVES (slow permission prompt) while the
  // engine chunk/wasm fetch REJECTS (fast network error). The stream exists but
  // was never attached to the video, so the component's own cleanup cannot
  // reach it — the loop must stop the tracks itself before rethrowing, or the
  // camera light stays on until the tab closes. Found in review.
  const tracks = [{ stop: jest.fn() }];
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => tracks, getVideoTracks: () => tracks }),
    },
  });
  mockPrepare.mockRejectedValueOnce(new Error('wasm fetch failed'));
  // A fresh module instance: the shared decoder module memoizes a SUCCESSFUL
  // engine load, so an earlier test's load would short-circuit this failure.
  await jest.isolateModulesAsync(async () => {
    const fresh = await import('./decoder');
    const video = document.createElement('video');
    await expect(fresh.startScanLoop({ video, formats: 'all', onFrame: () => {} }))
      .rejects.toThrow('wasm fetch failed');
  });
  await new Promise((r) => { setTimeout(r, 0); }); // let the cleanup .then run
  expect(tracks[0].stop).toHaveBeenCalled();
});

// ── The still-photo crop ladder ─────────────────────────────────────────────

function stubStillPipeline(naturalWidth = 4032, naturalHeight = 3024) {
  Object.defineProperty(window.HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true, get() { return naturalWidth; },
  });
  Object.defineProperty(window.HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true, get() { return naturalHeight; },
  });
  Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
    configurable: true,
    set() { setTimeout(() => this.onload?.(), 0); },
  });
  jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(function ctx(this: HTMLCanvasElement) {
    const canvas = this;
    return {
      drawImage: jest.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: canvas.width, height: canvas.height }),
    } as unknown as CanvasRenderingContext2D;
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:x') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
}

test('the photo escalates: whole image capped at 3000px, then centre 50%, then centre 25%', async () => {
  stubStillPipeline(4032, 3024);
  mockReadBarcodes
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{
      isValid: true, text: '012345678905', symbologyIdentifier: ']E0', contentType: 'Text', format: 'UPCA',
    }]);
  const hit = await decodeStillImage(new Blob(['x']), { formats: 'product' });
  expect(hit).toEqual({ payload: '012345678905', symbology: 'upc_a' });
  expect(mockReadBarcodes).toHaveBeenCalledTimes(3);
  const sizes = mockReadBarcodes.mock.calls.map(([img]) => [img.width, img.height]);
  expect(sizes[0]).toEqual([3000, 2250]);  // capped: 4032 -> 3000 long edge
  expect(sizes[1]).toEqual([2016, 1512]);  // centre 50% at NATIVE pixels
  expect(sizes[2]).toEqual([1008, 756]);   // centre 25% at native pixels
});

test('a photo with nothing decodable in ANY crop returns null, not a throw', async () => {
  stubStillPipeline();
  mockReadBarcodes.mockResolvedValue([]);
  await expect(decodeStillImage(new Blob(['x']))).resolves.toBeNull();
  expect(mockReadBarcodes).toHaveBeenCalledTimes(3);
});


// ── The cadence: attemptMs is a gap between attempt STARTS, not a sleep ─────

/** Distinctive, so the harness's own wait is never read back as a loop delay. */
const SENTINEL_WAIT = 37;

/**
 * Run the loop with a controlled decode duration and return every delay it
 * scheduled. `performance.now` is stubbed instead of really waiting, so these
 * assert the cadence ARITHMETIC rather than this machine's timing under load.
 */
async function cadenceDelays({ attemptMs, decodeMs }: { attemptMs?: number; decodeMs: number }) {
  const { video } = stubVideoPipeline();
  mockReadBarcodes.mockResolvedValue([]);
  // Two performance.now() reads per tick: startedAt, then the post-decode
  // elapsed. It is monotonic on purpose — Date.now() could jump forward and be
  // read as a colossally slow decode, parking the loop for half the jump.
  let clock = 1_000_000;
  let reads = 0;
  const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => {
    reads += 1;
    if (reads % 2 === 0) clock += decodeMs; // even read = after that tick's decode
    return clock;
  });
  const delays: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const timerSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    if (typeof ms === 'number' && ms !== SENTINEL_WAIT) delays.push(ms);
    // Fire promptly — we measure the REQUESTED delay, never real elapsed time.
    return realSetTimeout(fn, 0);
  }) as unknown as typeof setTimeout);
  const controls = await startScanLoop({
    video,
    formats: 'universal',
    ...(attemptMs === undefined ? {} : { attemptMs }),
    onFrame: () => {},
  });
  await new Promise((r) => { realSetTimeout(r, SENTINEL_WAIT); });
  controls.stop();
  timerSpy.mockRestore();
  nowSpy.mockRestore();
  return delays;
}

test("the default cadence is 60ms — @zxing/library's inherited 120 is gone", async () => {
  // 120 was `delayBetweenScanAttempts`, a pure-JS-engine default the engine
  // swap carried over verbatim. zxing-cpp decodes a real 1080x810 crop in
  // 5-22ms, so the loop sat idle ~85-90% of the wall clock. 60 is where the
  // bench's --spacingMs gate still measures WRONG=0 across every fixture at
  // 220 sessions.
  const delays = await cadenceDelays({ decodeMs: 0 });
  expect(delays[0]).toBe(60);
});

test('decode time is paid OUT of the budget, not added on top of it', async () => {
  // The old form scheduled a full attemptMs AFTER the decode, charging a slow
  // phone twice: once for the slow decode, again for a full-length wait after.
  const delays = await cadenceDelays({ attemptMs: 60, decodeMs: 10 });
  expect(delays[0]).toBe(60); // first tick has no decode to subtract yet
  expect(delays[1]).toBe(50); // 60 - 10, so attempt STARTS stay 60ms apart
});

test('a device too slow to keep up backs off instead of pinning its UI thread', async () => {
  // The decode runs on the main thread, so a naive cadence target would tell the
  // WEAKEST device to try hardest. Capped at ~2/3 duty: a 200ms decode yields
  // 100ms (a 300ms cadence) rather than dropping to the 8ms floor.
  const delays = await cadenceDelays({ attemptMs: 60, decodeMs: 200 });
  expect(delays[1]).toBe(100);
});

test('the loop always yields, even when the cadence budget is tiny', async () => {
  // Without a floor the loop could re-enter immediately and starve the
  // compositor — freezing the very preview it exists to render.
  const delays = await cadenceDelays({ attemptMs: 4, decodeMs: 0 });
  expect(delays[1]).toBeGreaterThanOrEqual(8);
});

test('bare ITF is never offered — only the check-digit-bearing ITF14', () => {
  // Bare ITF short-reads a truncated subset of the bars as a valid shorter code:
  // the fabrication class this whole file exists to avoid. ITF14 is fixed at 14
  // digits with a check digit, and covers the inbound manufacturer case code
  // the Scan page would otherwise have LOST when it stopped asking for 'all'.
  for (const set of ['shipping', 'product', 'universal'] as const) {
    const formats = readerOptionsFor(set).formats as string[];
    expect(formats).not.toContain('ITF');
  }
  expect(readerOptionsFor('product').formats).toContain('ITF14');
  expect(readerOptionsFor('universal').formats).toContain('ITF14');
});

test('the anti-storm pause is charged on an ACCEPT, never on a frame that merely decoded', async () => {
  // THE BUG THIS LOCKS DOWN: the loop used to pause `successPauseMs` after any
  // frame that decoded. Every frame of a confirmation streak decodes, so the
  // frames trying to AGREE were spaced 800ms apart and a 3-confirmation read cost
  // 1.6s — which is where the Scan page's latency actually lived. Hardware
  // imagers ship these as two independent settings (redundancy level vs
  // same-symbol timeout) and the timeout applies only after a completed decode.
  const { video } = stubVideoPipeline();
  mockReadBarcodes.mockResolvedValue([
    { isValid: true, text: '12345678', symbologyIdentifier: ']C0', contentType: 'Text', format: 'Code128' },
  ]);
  const delays: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const timerSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    if (typeof ms === 'number' && ms !== SENTINEL_WAIT) delays.push(ms);
    return realSetTimeout(fn, 0);
  }) as unknown as typeof setTimeout);

  // onFrame reports "still building the streak" — the loop must NOT pause.
  const controls = await startScanLoop({
    video, formats: 'universal', attemptMs: 50, successPauseMs: 9999, onFrame: () => false,
  });
  await new Promise((r) => { realSetTimeout(r, SENTINEL_WAIT); });
  controls.stop();
  timerSpy.mockRestore();
  expect(delays.length).toBeGreaterThan(1);
  expect(delays).not.toContain(9999);
});

test('an accepted read DOES pause — a continuous surface must not re-fire on the same box', async () => {
  const { video } = stubVideoPipeline();
  mockReadBarcodes.mockResolvedValue([
    { isValid: true, text: '12345678', symbologyIdentifier: ']C0', contentType: 'Text', format: 'Code128' },
  ]);
  const delays: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const timerSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    if (typeof ms === 'number' && ms !== SENTINEL_WAIT) delays.push(ms);
    return realSetTimeout(fn, 0);
  }) as unknown as typeof setTimeout);

  const controls = await startScanLoop({
    video, formats: 'universal', attemptMs: 50, successPauseMs: 9999, onFrame: () => true,
  });
  await new Promise((r) => { realSetTimeout(r, SENTINEL_WAIT); });
  controls.stop();
  timerSpy.mockRestore();
  expect(delays).toContain(9999);
});
