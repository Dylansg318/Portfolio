// A structurally COMPLETE MediaStream / MediaStreamTrack for tests.
//
// WHY THIS EXISTS AND NOT A CAST. Both scanner suites need a stream to hang off
// `video.srcObject` and to read `getCapabilities()` / `getSettings()` back from,
// and both reached for `{ getTracks, getVideoTracks } as unknown as MediaStream`
// — the partial object cannot be asserted to MediaStream directly, so it went
// through `unknown`. The source project bans `as unknown as` disguised casts
// with a lint ratchet, and because the test file is CO-LOCATED rather than
// under a `__tests__/` directory, the ratchet reads it as production source —
// so a pre-commit hook scoped to staged files commits it clean and it only
// fails later, in CI.
//
// Filling in every member costs ~40 lines once and lets the stub be typed
// honestly, so neither suite needs an assertion and the ratchet has nothing to
// find. Overrides are shallow-merged last, so a test that cares about one
// setting writes only that setting.
//
// Lives next to the decoder rather than a test folder because both consumers
// are here and jest is deliberately NOT imported — callers supply their own
// spies.

const noop = (): void => {};

/** One video track. `overrides` wins over every default below. */
export function makeTrackStub(overrides: Partial<MediaStreamTrack> = {}): MediaStreamTrack {
  const track: MediaStreamTrack = {
    contentHint: '',
    enabled: true,
    id: 'stub-track',
    kind: 'video',
    label: 'stub camera',
    muted: false,
    readyState: 'live',
    onended: null,
    onmute: null,
    onunmute: null,
    applyConstraints: () => Promise.resolve(),
    clone: () => makeTrackStub(overrides),
    getCapabilities: () => ({}),
    getConstraints: () => ({}),
    getSettings: () => ({}),
    stop: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    ...overrides,
  };
  return track;
}

/**
 * A stream over `tracks`. `getTracks` and `getVideoTracks` both return them —
 * the scan loop stops via the first and inspects torch/resolution via the
 * second, and every caller here is a video-only camera stream.
 */
export function makeStreamStub(tracks: MediaStreamTrack[] = [makeTrackStub()]): MediaStream {
  const stream: MediaStream = {
    active: true,
    id: 'stub-stream',
    onaddtrack: null,
    onremovetrack: null,
    addTrack: noop,
    clone: () => makeStreamStub(tracks),
    getAudioTracks: () => [],
    getTrackById: (id: string) => tracks.find((t) => t.id === id) ?? null,
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
    removeTrack: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
  };
  return stream;
}
