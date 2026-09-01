import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// One camera for every scan surface. These assert the COMPONENT's contract —
// the confirmation streak, dedupe, the unsteady hint, the photo escalation and
// the blocked-camera state — against a mocked decoder seam. The decode engine
// itself (formats, GS1 payload composition, the frame loop) is asserted in
// decoder.test.ts against the real module.
//
// All payloads here are synthetic (made-up order number 12345678, textbook
// UPC examples, an invented EAN-13).
const mockStartScanLoop = jest.fn();
const mockDecodeStill = jest.fn();
const mockStop = jest.fn();
jest.mock('./decoder', () => ({
  startScanLoop: (opts: unknown) => mockStartScanLoop(opts),
  decodeStillImage: (file: unknown, opts: unknown) => mockDecodeStill(file, opts),
  hasTorch: () => false,
  setTorch: jest.fn(),
  trackResolution: (stream: unknown) => (stream ? '1920×1080' : null),
}));

import CameraScanner from './CameraScanner';
import type { ScanHit, ScanLoopOptions } from './decoder';
import { makeStreamStub, makeTrackStub } from './streamStub';

let capturedFrame: ((hit: ScanHit | null) => void) | null = null;
let capturedOpts: ScanLoopOptions | null = null;

beforeAll(() => {
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true, value: jest.fn().mockResolvedValue(undefined),
  });
});

function stubMediaDevices() {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
}

beforeEach(() => {
  capturedFrame = null;
  capturedOpts = null;
  mockStartScanLoop.mockReset();
  mockDecodeStill.mockReset();
  mockStop.mockClear();
  mockStartScanLoop.mockImplementation(async (opts: ScanLoopOptions) => {
    capturedOpts = opts;
    capturedFrame = opts.onFrame;
    // The loop owns the stream and parks it on the element, exactly like the
    // real startScanLoop — the resolution readout reads it back from there.
    try {
      // A typed stub rather than a double-cast through `unknown` — the source
      // project's lint ratchet bans that form, and this co-located test file is
      // read as production source by it.
      opts.video.srcObject = makeStreamStub([
        makeTrackStub({ getSettings: () => ({ width: 1920, height: 1080 }) }),
      ]);
    } catch { /* jsdom */ }
    return { stop: mockStop };
  });
  stubMediaDevices();
});

afterEach(() => {
  try { delete (navigator as { mediaDevices?: unknown }).mediaDevices; } catch { /* not configurable */ }
  jest.clearAllMocks();
});

const hit = (payload: string, symbology = 'upc_a'): ScanHit => ({ payload, symbology });

test('the scan loop is started with the surface\'s declared format set', async () => {
  // The format allow-list is half of the wrong-number fix; a surface that
  // stops passing it silently widens to `all`.
  render(<CameraScanner formats="shipping" onDetected={() => {}} />);
  await waitFor(() => expect(mockStartScanLoop).toHaveBeenCalled());
  expect(capturedOpts?.formats).toBe('shipping');
  expect(capturedOpts?.video).toBeInstanceOf(HTMLVideoElement);
});

// ── The confirmation gate ───────────────────────────────────────────────────
// The decoder calls back per frame and this component used to accept frame one.
// On the packing-slip barcode at the bench's real ~2.1 px/module, 5.8% of
// accepted scans came back WRONG that way (220-session simulation) — including
// a Code 128 order number arriving as a checksum-valid EAN-13. These tests are
// the gate that took it to 0.0%; do not "simplify" them by dropping frames.

test('ONE frame is not an answer', async () => {
  const onDetected = jest.fn();
  render(<CameraScanner formats="product" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => { capturedFrame!(hit('012345678905')); });
  expect(onDetected).not.toHaveBeenCalled();
});

test('two frames that DISAGREE are not an answer — this is the bug', async () => {
  const onDetected = jest.fn();
  render(<CameraScanner formats="product" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => {
    capturedFrame!(hit('12345678', 'code_128'));        // the real slip
    capturedFrame!(hit('5901234123457', 'ean_13'));     // the invented one
  });
  expect(onDetected).not.toHaveBeenCalled();
  // …and the real value still wins the moment it repeats.
  act(() => {
    capturedFrame!(hit('12345678', 'code_128'));
    capturedFrame!(hit('12345678', 'code_128'));
  });
  expect(onDetected).toHaveBeenCalledTimes(1);
  expect(onDetected).toHaveBeenCalledWith('12345678', 'code_128');
});

test('a blank frame breaks the streak', async () => {
  // The loop reports an empty frame as onFrame(null). Two agreeing reads either
  // side of one are NOT back-to-back, and back-to-back is what a drifting
  // hand-held camera cannot fake.
  const onDetected = jest.fn();
  render(<CameraScanner formats="product" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => {
    capturedFrame!(hit('012345678905'));
    capturedFrame!(null);
    capturedFrame!(hit('012345678905'));
  });
  expect(onDetected).not.toHaveBeenCalled();
});

test('the wider the format set, the more confirmation it takes', async () => {
  // 'all' can be wrong in more ways, so it pays one more frame. Two agreeing
  // frames must NOT be enough there.
  const onDetected = jest.fn();
  render(<CameraScanner formats="all" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => {
    capturedFrame!(hit('012345678905'));
    capturedFrame!(hit('012345678905'));
  });
  expect(onDetected).not.toHaveBeenCalled();
  act(() => { capturedFrame!(hit('012345678905')); });
  expect(onDetected).toHaveBeenCalledTimes(1);
});

test("'universal' pays the third frame too — it carries the EAN/UPC fabrication family", async () => {
  // THE REVIEW BLOCKER. Narrowing the universal Scan page from 'all' to
  // 'universal' looked like it should also buy the cheaper 2-frame policy,
  // because 'universal' lists fewer formats. It must not: the measured
  // `narrowed` row was 'shipping' {Code128, QRCode, DataMatrix}, which contains
  // NO EAN/UPC and so cannot produce the documented fabrication (a Code 128
  // slip arriving as a checksum-valid EAN-13). 'universal' does contain that
  // family — measured, it fabricates 3 at first-frame where 'shipping'
  // fabricates 0. Count what a set can PRODUCE, not how many formats it lists.
  const onDetected = jest.fn();
  render(<CameraScanner formats="universal" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => {
    capturedFrame!(hit('012345678905'));
    capturedFrame!(hit('012345678905'));
  });
  expect(onDetected).not.toHaveBeenCalled();
  act(() => { capturedFrame!(hit('012345678905')); });
  expect(onDetected).toHaveBeenCalledTimes(1);
});

test('onFrame reports the ACCEPT, so the loop knows not to pause mid-streak', async () => {
  // The loop charges its anti-storm pause on this boolean. Returning true while a
  // streak is still building would space the confirming frames 800ms apart and
  // put back the 1.6s the successPauseMs fix removed; returning false on the
  // accept would let a continuous surface re-fire on the box still under the
  // lens.
  const onDetected = jest.fn();
  render(<CameraScanner formats="product" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  let first: unknown;
  let second: unknown;
  act(() => {
    first = capturedFrame!(hit('012345678905'));
    second = capturedFrame!(hit('012345678905'));
  });
  expect(first).toBe(false);   // streak building — no pause
  expect(second).toBe(true);   // accepted — pause is correct
  act(() => { expect(capturedFrame!(null)).toBe(false); }); // blank breaks it
});

test('the symbology reaches the caller, on every surface', async () => {
  const onDetected = jest.fn();
  render(<CameraScanner formats="product" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => {
    capturedFrame!(hit('010001234567890521DEMO123456', 'code_128'));
    capturedFrame!(hit('010001234567890521DEMO123456', 'code_128'));
  });
  expect(onDetected).toHaveBeenCalledWith('010001234567890521DEMO123456', 'code_128');
});

test('continuous mode collapses the per-frame repeat storm', async () => {
  const onDetected = jest.fn();
  render(<CameraScanner mode="continuous" formats="product" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => {
    for (let i = 0; i < 5; i += 1) capturedFrame!(hit('012345678905'));
  });
  expect(onDetected).toHaveBeenCalledTimes(1);
});

test('continuous mode still passes a DIFFERENT barcode straight through', async () => {
  const onDetected = jest.fn();
  render(<CameraScanner mode="continuous" formats="product" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => {
    capturedFrame!(hit('012345678905'));
    capturedFrame!(hit('012345678905'));
    capturedFrame!(hit('036000291452'));
    capturedFrame!(hit('036000291452'));
  });
  expect(onDetected).toHaveBeenCalledTimes(2);
});

test('once mode fires a single time even under a burst, and stops the loop', async () => {
  const onDetected = jest.fn();
  render(<CameraScanner mode="once" formats="product" onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => {
    capturedFrame!(hit('012345678905'));
    capturedFrame!(hit('012345678905'));
    capturedFrame!(hit('036000291452'));
    capturedFrame!(hit('036000291452'));
  });
  expect(onDetected).toHaveBeenCalledTimes(1);
  expect(mockStop).toHaveBeenCalled();
});

test('a blocked camera says so on EVERY surface, and reports it to the caller', async () => {
  // One scan surface used to swallow this into an empty catch, leaving an open
  // panel with a black rectangle and no explanation.
  mockStartScanLoop.mockRejectedValueOnce(new Error('NotAllowedError'));
  const onError = jest.fn();
  render(<CameraScanner onDetected={() => {}} onError={onError} />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/camera blocked/i));
  expect(onError).toHaveBeenCalled();
});

test('THE MEASUREMENT: the frame the decoder actually got is shown, not the one we asked for', async () => {
  // "The camera is high quality, it's a flagship phone" is not the same claim
  // as "the MediaStream track is high resolution" — the loop decodes
  // videoWidth×videoHeight, so put that number on screen instead of guessing.
  render(<CameraScanner onDetected={() => {}} />);
  await waitFor(() => expect(screen.getByText(/1920×1080/)).toBeInTheDocument());
});

test('a still photo decodes and reports the payload, so a stream that will not read is not the end', async () => {
  mockDecodeStill.mockResolvedValue({ payload: '010001234567890521DEMO123456', symbology: 'data_matrix' });
  const onDetected = jest.fn();
  render(<CameraScanner formats="product" onDetected={onDetected} />);
  await waitFor(() => expect(mockStartScanLoop).toHaveBeenCalled());

  const input = screen.getByTestId('scan-photo-input');
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
  });

  await waitFor(() => expect(onDetected).toHaveBeenCalledWith('010001234567890521DEMO123456', 'data_matrix'));
  // The photo path must inherit the surface's format narrowing too.
  expect(mockDecodeStill).toHaveBeenCalledWith(expect.any(File), { formats: 'product' });
});

test('the photo path is offered even when the live camera is BLOCKED', async () => {
  // It does not use getUserMedia at all, so this is the case it matters most.
  mockStartScanLoop.mockRejectedValueOnce(new Error('NotAllowedError'));
  render(<CameraScanner onDetected={() => {}} />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByTestId('scan-photo-input')).toBeInTheDocument();
});

test('a photo with no barcode says so instead of failing silently', async () => {
  mockDecodeStill.mockResolvedValue(null);
  const onDetected = jest.fn();
  render(<CameraScanner onDetected={onDetected} />);
  await waitFor(() => expect(mockStartScanLoop).toHaveBeenCalled());

  await act(async () => {
    fireEvent.change(screen.getByTestId('scan-photo-input'), {
      target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] },
    });
  });

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/no barcode found/i));
  expect(onDetected).not.toHaveBeenCalled();
});

test('a rejecting onDetected cannot vanish as an unhandled rejection', async () => {
  const boom = jest.fn().mockRejectedValue(new Error('server said no'));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<CameraScanner formats="product" onDetected={boom} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => {
    capturedFrame!(hit('012345678905'));
    capturedFrame!(hit('012345678905'));
  });
  await waitFor(() => expect(spy).toHaveBeenCalledWith('[CameraScanner] onDetected rejected', expect.any(Error)));
  spy.mockRestore();
});

test('empty frames never fire onDetected', async () => {
  const onDetected = jest.fn();
  render(<CameraScanner onDetected={onDetected} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());
  act(() => { capturedFrame!(null); capturedFrame!(null); });
  expect(onDetected).not.toHaveBeenCalled();
});

test('unmounting stops the scan loop — a leaked track keeps the camera light on', async () => {
  const { unmount } = render(<CameraScanner onDetected={() => {}} />);
  await waitFor(() => expect(mockStartScanLoop).toHaveBeenCalled());
  unmount();
  expect(mockStop).toHaveBeenCalled();
});

test('an unstable code says "hold steady" even AFTER an earlier item scanned fine', async () => {
  // The regression this pins: the hint used to be gated on !lastRead, and
  // lastRead is set forever after the first accept. On a continuous pack bench
  // that meant item 1 scanned, item 7 went marginal, and the operator saw a
  // stale "Last read: <item 1>" with no guidance — the exact looks-broken state
  // the hint exists for.
  render(<CameraScanner mode="continuous" formats="product" onDetected={() => {}} />);
  await waitFor(() => expect(capturedFrame).toBeTruthy());

  act(() => {
    capturedFrame!(hit('012345678905'));
    capturedFrame!(hit('012345678905'));
  });
  expect(await screen.findByText(/Last read:/)).toBeInTheDocument();

  // Now a code that decodes differently every frame: never confirms.
  act(() => {
    for (let i = 0; i < 14; i += 1) capturedFrame!(hit(`bogus-${i}`));
  });
  expect(await screen.findByText(/Hold steady/)).toBeInTheDocument();
  expect(screen.queryByText(/Last read:/)).not.toBeInTheDocument();
});
