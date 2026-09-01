// The two decode engines under test, normalized to one shape:
//   decode({ data: Uint8ClampedArray(RGBA), width, height }) -> { payload, format } | null
//
// In the source app both engines resolved from the app's node_modules — the
// bench must measure the exact versions the app ships, not a second copy pinned
// here. In this extracted copy they resolve from this folder's own
// node_modules (`npm install` in the parent directory first).
//
// The js adapter mirrors src/decoder.ts's old-engine hints EXACTLY:
// TRY_HARDER, ASSUME_GS1, POSSIBLE_FORMATS per format set. If decoder.ts
// changes its options, change this file in the same commit or the baseline
// stops describing the app.

import { createRequire } from 'module';

const req = createRequire(import.meta.url);

// Same sets as ScanFormatSet in src/decoder.ts ('narrowed' here means "the set
// the surface that shows this fixture actually declares").
const SHIPPING = ['CODE_128', 'QR_CODE', 'DATA_MATRIX'];
const PRODUCT = ['CODE_128', 'CODE_39', 'ITF_14', 'UPC_A', 'UPC_E', 'EAN_8', 'EAN_13', 'QR_CODE', 'DATA_MATRIX'];

export const FORMAT_SET_NAMES = {
  shipping: SHIPPING,
  product: PRODUCT,
  // shipping u product — what the universal Scan page declares, replacing
  // 'all'. Mirrors FORMAT_SETS in src/decoder.ts.
  universal: [...new Set([...SHIPPING, ...PRODUCT])],
};

// zxing-js enum names -> zxing-wasm CANONICAL format strings (the output
// names ReadResult.format uses — 'UPCA' not the 'UPC-A' input alias; keying
// the reverse map on aliases is how a review-blocking bug happened).
const WASM_FORMAT_NAMES = {
  CODE_128: 'Code128',
  CODE_39: 'Code39',
  // zxing-wasm distinguishes ITF from ITF14; @zxing/library has only ITF, so the
  // js baseline is necessarily the WIDER (short-read-prone) variant here. That
  // makes the js column pessimistic for this format, which is the safe direction
  // for a baseline. See PRODUCT_FORMATS in src/decoder.ts.
  ITF_14: 'ITF14',
  UPC_A: 'UPCA',
  UPC_E: 'UPCE',
  EAN_8: 'EAN8',
  EAN_13: 'EAN13',
  QR_CODE: 'QRCode',
  DATA_MATRIX: 'DataMatrix',
};

function toLuma(rgba, width, height) {
  const luma = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) {
    luma[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  return luma;
}

/** The RETIRED app engine: @zxing/library, hints copied from the old decoder. */
export function makeJsEngine(formatSet) {
  const zx = req('@zxing/library');
  const {
    MultiFormatReader, DecodeHintType, BarcodeFormat,
    RGBLuminanceSource, HybridBinarizer, BinaryBitmap,
  } = zx;
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.ASSUME_GS1, true);
  if (formatSet !== 'all') {
    const wanted = FORMAT_SET_NAMES[formatSet]
      // ITF_14 has no zxing-js enum — fall back to its ITF superset (see the
      // note on WASM_FORMAT_NAMES.ITF_14).
      .map((name) => BarcodeFormat[name] ?? BarcodeFormat[name.replace(/_14$/, '')])
      .filter((v) => typeof v === 'number');
    hints.set(DecodeHintType.POSSIBLE_FORMATS, wanted);
  }
  const names = {};
  for (const [name, value] of Object.entries(BarcodeFormat)) {
    if (typeof value === 'number') names[value] = name.toLowerCase();
  }
  const reader = new MultiFormatReader();
  return {
    name: 'js',
    decode({ data, width, height }) {
      const source = new RGBLuminanceSource(toLuma(data, width, height), width, height);
      const bitmap = new BinaryBitmap(new HybridBinarizer(source));
      try {
        const result = reader.decode(bitmap, hints);
        const payload = result?.getText();
        if (!payload) return null;
        return { payload, format: names[result.getBarcodeFormat()] ?? 'unknown' };
      } catch {
        return null; // NotFoundException — a blank frame
      }
    },
  };
}

/**
 * The SHIPPED engine: zxing-wasm (zxing-cpp). Payload composition mirrors
 * src/decoder.ts: a GS1 result carries its AIM identifier (]C1 / ]d2) so the
 * server-side GS1 parser keeps seeing the anchor it keys on; a non-GS1 result
 * stays bare, matching the old zxing-js output.
 */
const WASM_TO_AUDIT_NAME = Object.fromEntries(
  Object.entries(WASM_FORMAT_NAMES).map(([js, wasm]) => [wasm, js.toLowerCase()]),
);

export async function makeWasmEngine(formatSet, extraOpts = {}) {
  const { readBarcodes } = await import(req.resolve('zxing-wasm/reader'));
  const opts = {
    tryHarder: true,
    // Mirrors readerOptionsFor() in src/decoder.ts: printed labels are
    // dark-on-light, and the inverted pass is pure cost on every missed frame.
    tryInvert: false,
    textMode: 'Plain',
    maxNumberOfSymbols: 1,
    ...extraOpts, // --wasmOpts sweeps land here; production options live in decoder.ts
  };
  if (formatSet !== 'all') {
    opts.formats = FORMAT_SET_NAMES[formatSet].map((n) => WASM_FORMAT_NAMES[n]).filter(Boolean);
  }
  return {
    name: 'wasm',
    async decode({ data, width, height }) {
      const results = await readBarcodes({ data, width, height }, opts);
      const r = results.find((x) => x.isValid && x.text);
      if (!r) return null;
      const payload = r.contentType === 'GS1' ? `${r.symbologyIdentifier}${r.text}` : r.text;
      return { payload, format: WASM_TO_AUDIT_NAME[r.format] ?? r.format.toLowerCase() };
    },
  };
}
