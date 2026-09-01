import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  decodeStillImage,
  hasTorch,
  setTorch,
  startScanLoop,
  trackResolution,
} from './decoder';
import type { ScanFormatSet, ScanLoopControls } from './decoder';
import './CameraScanner.css';

// THE camera stage. Every scan surface in the app (packing, product detail,
// tracking-number paste, cycle counting) renders this one component, so a fix
// lands everywhere at once — before this existed there were two
// implementations, and one had `playsInline`, a real error message and a hard
// stop-on-first-read that the other silently lacked. Chrome the surfaces
// differ in (a sheet vs an inline preview) belongs to the CALLER; the camera
// does not.
//
// Decode settings (resolution, tryHarder, torch) live in decoder.ts.

/** True when this device has a camera we can open. Callers MUST gate on this. */
export function hasCameraScanner(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export interface CameraScannerProps {
  /** Fires on every accepted read. Symbology is the audit-trail format name. */
  onDetected: (payload: string, symbology: string) => void;
  /**
   * 'once'       — stop the camera on the first ACCEPTED read (a sheet that closes).
   * 'continuous' — keep decoding, de-duplicating repeats for `dedupeMs`.
   */
  mode?: 'once' | 'continuous';
  dedupeMs?: number;
  /**
   * How many CONSECUTIVE frames must return the same payload before it counts.
   * Defaults to 2, or 3 when `formats` is 'all' — see the table below for why
   * those two numbers differ.
   *
   * THIS IS THE FIX FOR A MEASURED WRONG-NUMBER BUG, not a debounce. The engine
   * calls back per frame and this component used to accept frame one, which
   * meant one bad frame was the answer. Measured over 220 simulated hand-held
   * sessions on our own packing-slip barcode (a Code 128 order number — the
   * bench fixture uses the synthetic `12345678` — module 2 at 203 dpi,
   * ~2.1 px/module, the framing the real packing bench reported from):
   *
   *   formats   accept policy      accepted   WRONG
   *   all       first frame wins    154/220   9  (5.8% of accepted)
   *   all       2 in a row          125/220   1  (0.8%)
   *   all       3 in a row          108/220   0  (0.0%)
   *   narrowed  first frame wins    149/220   2  (1.3%)
   *   narrowed  2 in a row          124/220   0  (0.0%)
   *
   * The wrong payloads are a Code 128 order number arriving as a checksum-valid
   * EAN-13, and other Code 128 strings that pass Code 128's OWN check character
   * — the second kind is why a format allow-list alone is not enough and why
   * this exists. Read the table as one rule: THE WIDER THE FORMAT SET, THE MORE
   * CONFIRMATION IT NEEDS. That is why the default is derived from `formats`
   * rather than fixed, so a future surface widening to 'all' cannot silently
   * inherit the weaker setting.
   *
   * NO SURFACE RENDERS WITH 'all' ANY MORE — the universal Scan page moved to
   * 'universal' (shipping ∪ product, see ScanFormatSet) — AND 'universal' STILL
   * PAYS THREE. Read the table by what a set can PRODUCE, not by how many
   * formats it lists: the measured `narrowed` row was 'shipping'
   * {Code128, QRCode, DataMatrix}, which contains no EAN/UPC and therefore
   * cannot produce the fabrication mode at all. 'universal' does contain
   * EAN13/UPCA/UPCE/EAN8, so for the slip fixture it behaves like 'all', not
   * like 'shipping' — measured on the retired js engine at 220 sessions,
   * first-frame-wins gives 'universal' 3 wrong where 'shipping' gives 0. The
   * only cell that ever fabricated at 2-in-a-row is all@2 (1/125, 0.8%), and a
   * 220-session run showing 0 is entirely consistent with that rate. So dropping
   * 'universal' to two would have been a real loosening dressed up as a format
   * narrowing; the third frame stays until a run large enough to tell 0% from
   * 0.8% says otherwise (~1,500 accepted sessions on the js engine).
   *
   * The third frame is nearly free now anyway — see `successPauseMs` in
   * decoder.ts. Confirmation frames used to be 800 ms apart, so three cost
   * 1.6 s; they now run at the frame cadence.
   *
   * A BLANK FRAME BREAKS THE STREAK, deliberately: the false decodes are
   * artefacts of one specific pose, and back-to-back agreement is what a
   * drifting hand-held camera cannot repeat. The lenient variant (blanks
   * ignored) was measured too — it accepts ~10% more scans but leaves 1.5% wrong
   * on 'all', so it is the wrong trade for a warehouse number.
   *
   * Setting this to 1 restores the old accept-anything behaviour. Do not, except
   * on a surface where a wrong value is visibly harmless.
   */
  confirmations?: number;
  /**
   * Which symbologies to believe — see ScanFormatSet in decoder.ts.
   * A surface that knows what it will be shown should say so; 'all' is for a
   * universal scan surface, which does not.
   */
  formats?: ScanFormatSet;
  className?: string;
  /** Rendered over the preview (e.g. a counting reticle). */
  overlay?: ReactNode;
  /** Called with a human-readable reason when the camera cannot be opened. */
  onError?: (message: string) => void;
}

const CAMERA_BLOCKED = 'Camera blocked — type the barcode or use the wedge scanner instead.';
const NO_CAMERA = 'This device can’t scan with the camera — type the barcode or use the wedge scanner instead.';

export default function CameraScanner({
  onDetected,
  mode = 'continuous',
  dedupeMs = 1500,
  confirmations,
  formats = 'all',
  className,
  overlay,
  onError,
}: CameraScannerProps) {
  // Derived, not fixed — see the `confirmations` doc. A surface that will accept
  // any symbology has more ways to be wrong and pays one more frame for it.
  // 'universal' counts as wide: it contains the EAN/UPC family, which is the
  // half of the measured fabrication mode (a Code 128 slip arriving as a
  // checksum-valid EAN-13) that 'shipping' structurally cannot produce.
  const needed = Math.max(1, confirmations
    ?? (formats === 'all' || formats === 'universal' ? 3 : 2));
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<ScanLoopControls | null>(null);
  const deadRef = useRef(false);
  const firedRef = useRef(false);
  const lastRef = useRef<{ payload: string | null; t: number }>({ payload: null, t: 0 });
  // The confirmation streak: the payload the previous frame returned, and how
  // many frames in a row have now returned it.
  const streakRef = useRef<{ payload: string | null; count: number }>({ payload: null, count: 0 });
  // Frames that decoded but never agreed with their neighbour. A code that reads
  // differently every frame is one the operator can hold still for forever
  // without anything happening, so after ~1.5s of that we say so rather than
  // letting the preview sit on "Waiting for scan…" looking broken.
  const unsteadyRef = useRef(0);
  const [unsteady, setUnsteady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [lastRead, setLastRead] = useState<{ payload: string; symbology: string } | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [photoState, setPhotoState] = useState<'idle' | 'decoding' | 'nothing'>('idle');

  // Call sites pass an inline arrow, so onDetected's identity changes on
  // every parent render and the parent re-renders constantly (a query cache
  // flag flips; the OS camera prompt blurs the window). With it in the
  // effect deps that was a full MediaStream teardown + re-acquire per render:
  // a black-flashing preview, decodes dropped mid-flight, and on Android Chrome
  // a re-acquire racing its own teardown throws NotReadableError — "Camera
  // blocked" on the exact phones this exists for. Hold it in a ref.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Call sites hand us an ASYNC handler and we do not await it, so a rejection
  // would become an unhandled promise rejection — the operator scans, nothing
  // happens, and nothing says why. Swallow it here only so it cannot vanish
  // silently; the call site still owns showing the message.
  const emit = useCallback((payload: string, symbology: string) => {
    try {
      const r = onDetectedRef.current(payload, symbology) as unknown;
      if (r && typeof (r as Promise<unknown>).catch === 'function') {
        (r as Promise<unknown>).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[CameraScanner] onDetected rejected', err);
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[CameraScanner] onDetected threw', err);
    }
  }, []);

  // Idempotent. A leaked MediaStreamTrack keeps the warehouse phone's camera
  // light on until the tab is closed.
  const stopCamera = useCallback(() => {
    deadRef.current = true;
    const controls = controlsRef.current;
    controlsRef.current = null;
    if (controls) { try { controls.stop(); } catch { /* already stopped */ } }
    const v = videoRef.current;
    const stream = (v?.srcObject ?? null) as MediaStream | null;
    if (stream && typeof stream.getTracks === 'function') {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* already ended */ }
      }
    }
    if (v) { try { v.srcObject = null; } catch { /* jsdom */ } }
  }, []);

  // The escalation when the live stream will not read a label: the phone's own
  // camera app, full sensor resolution, real autofocus. Works even when
  // getUserMedia is blocked, which is why it renders in the error state too.
  const onPhoto = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same photo be retried
    if (!file) return;
    setPhotoState('decoding');
    try {
      const still = await decodeStillImage(file, { formats });
      if (!still) { setPhotoState('nothing'); return; }
      setPhotoState('idle');
      setLastRead(still);
      if (mode === 'once') { firedRef.current = true; stopCamera(); }
      emit(still.payload, still.symbology);
    } catch {
      setPhotoState('nothing');
    }
  }, [mode, stopCamera, emit, formats]);

  const photoInput = (
    <label className="scan-photo scan-btn">
      {photoState === 'decoding' ? 'Reading photo…' : 'Take a photo instead'}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        data-testid="scan-photo-input"
        onChange={onPhoto}
      />
    </label>
  );

  const toggleTorch = useCallback(async () => {
    const stream = (videoRef.current?.srcObject ?? null) as MediaStream | null;
    const next = !torchOn;
    if (await setTorch(stream, next)) setTorchOn(next);
  }, [torchOn]);

  useEffect(() => {
    let cancelled = false;
    deadRef.current = false;
    firedRef.current = false;
    streakRef.current = { payload: null, count: 0 };
    unsteadyRef.current = 0;

    async function start() {
      if (!hasCameraScanner()) {
        setError(NO_CAMERA);
        onErrorRef.current?.(NO_CAMERA);
        return;
      }
      let controls: ScanLoopControls;
      try {
        const video = videoRef.current;
        if (!video) return;
        controls = await startScanLoop({
          video,
          formats,
          // The loop calls back on EVERY attempt; a frame that read nothing
          // arrives as null.
          onFrame: (hit) => {
            if (deadRef.current) return false;
            if (mode === 'once' && firedRef.current) return false;
            const payload = hit?.payload;

            // A frame that read nothing breaks the streak — see `confirmations`.
            if (!payload) { streakRef.current = { payload: null, count: 0 }; return false; }

            const streak = streakRef.current;
            const count = payload === streak.payload ? streak.count + 1 : 1;
            streakRef.current = { payload, count };
            if (count < needed) {
              unsteadyRef.current += 1;
              if (unsteadyRef.current === 12) setUnsteady(true);
              return false; // streak still building — do NOT charge the anti-storm pause
            }

            const now = Date.now();
            if (mode === 'continuous'
              && payload === lastRef.current.payload
              && now - lastRef.current.t < dedupeMs) return true; // a repeat IS an accept — pause
            lastRef.current = { payload, t: now };

            // Confirmed. Clear the streak so `continuous` needs a fresh pair for
            // the NEXT item rather than coasting on this one's count.
            streakRef.current = { payload: null, count: 0 };
            unsteadyRef.current = 0;
            setUnsteady(false);

            const { symbology } = hit;
            setLastRead({ payload, symbology });
            if (mode === 'once') { firedRef.current = true; stopCamera(); }
            emit(payload, symbology);
            return true; // accepted — the loop may now pause successPauseMs
          },
        });
      } catch {
        setError(CAMERA_BLOCKED);
        onErrorRef.current?.(CAMERA_BLOCKED);
        return;
      }
      // Unmounted / closed while getUserMedia was in flight — don't leak it.
      if (cancelled || deadRef.current) { try { controls.stop(); } catch { /* noop */ } return; }
      controlsRef.current = controls;
      const stream = (videoRef.current?.srcObject ?? null) as MediaStream | null;
      setTorchAvailable(hasTorch(stream));
      // What the browser ACTUALLY gave us, not what we asked for.
      setResolution(trackResolution(stream));
    }

    void start();
    return () => { cancelled = true; stopCamera(); };
    // stopCamera is a stable useCallback([]); mode/dedupeMs/confirmations/formats
    // are fixed literals per call site, so none of these re-acquire the camera in
    // practice. onDetected is deliberately absent — see onDetectedRef above.
  }, [stopCamera, mode, dedupeMs, needed, formats, emit]);

  // The photo path does not need getUserMedia, so a blocked camera is not the
  // end of the road — it is the case where it matters most.
  if (error) {
    return (
      <div className="scan-fallback">
        <div className="scan-error" role="alert">{error}</div>
        {photoInput}
        {photoState === 'nothing' && (
          <div className="scan-photo-miss" role="status">No barcode found in that photo — fill the frame with it and try again.</div>
        )}
      </div>
    );
  }

  return (
    <div className="scan-wrap">
      <div className={className ?? 'scan-stage'}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          className="scan-video"
          data-testid="cc-scan-video"
          playsInline
          muted
          autoPlay
        />
        {overlay}
        {torchAvailable && (
          <button type="button" className="scan-btn scan-torch" onClick={toggleTorch}>
            {torchOn ? 'Light off' : 'Light on'}
          </button>
        )}
        {/* The resolution is the frame the engine actually decodes — the
            constraint is only a request. A label that will not read is a
            measurement question, so put the measurement on screen. `once` mode
            closes on the first read, so its last-read line would have nothing
            to say. */}
        <div aria-live="polite" className="scan-lastread">
          {/* A code that decodes differently every frame never confirms, so the
              line would otherwise sit on "Waiting for scan…" while the camera is
              in fact reading — and reading something untrustworthy. Say which
              one it is; "hold steady" is also the actual remedy.

              THE UNSTEADY STATE OUTRANKS `lastRead`, and this is the whole point
              on a continuous surface: `lastRead` is set forever after the first
              accept, so gating the hint on `!lastRead` meant item 1 scanned fine
              and item 7 — the marginal one — showed a STALE "Last read: item 1"
              and no guidance, which is exactly the looks-broken state the hint
              was built for. `unsteady` is cleared on every accept, so it can only
              be true about the item in front of the camera right now. */}
          {unsteady
            ? <>Hold steady — not reading the same twice</>
            : lastRead
              ? <>Last read: <strong>{lastRead.payload}</strong> <span>({lastRead.symbology})</span></>
              : mode === 'continuous' ? <>Waiting for scan…</> : <>Scanning…</>}
          {resolution && <span className="scan-res"> · {resolution}</span>}
        </div>
      </div>
      {photoInput}
      {photoState === 'nothing' && (
        <div className="scan-photo-miss" role="status">No barcode found in that photo — fill the frame with it and try again.</div>
      )}
    </div>
  );
}
