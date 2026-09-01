// Decode a rendered label PNG with the production reader config and assert the
// payload. The point of a symbology change is that the symbol still SCANS —
// "it renders" is not that claim, and a renderer will happily draw an
// unreadable square. Usage: node bench/decode-check.mjs <png>=<expected> ...
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const req = createRequire(import.meta.url);
const { readBarcodes } = await import(req.resolve('zxing-wasm/reader'));

// Mirrors PRODUCT_FORMATS in src/decoder.ts.
const FORMATS = ['Code128', 'Code39', 'ITF14', 'UPCA', 'UPCE', 'EAN8', 'EAN13', 'QRCode', 'DataMatrix'];

let failed = 0;
for (const arg of process.argv.slice(2)) {
  const i = arg.lastIndexOf('=');
  const file = arg.slice(0, i);
  const expected = arg.slice(i + 1);
  const { data, info } = await sharp(await readFile(file))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const results = await readBarcodes(
    { data: new Uint8ClampedArray(data), width: info.width, height: info.height },
    { tryHarder: true, tryInvert: false, textMode: 'Plain', maxNumberOfSymbols: 1, formats: FORMATS },
  );
  const hit = results.find((x) => x.isValid && x.text);
  const ok = hit?.text === expected;
  if (!ok) failed += 1;
  const name = file.split('/').pop();
  console.log(`${name.padEnd(22)} ${ok ? 'PASS' : 'FAIL'}  got=${JSON.stringify(hit?.text ?? null)}`
    + ` fmt=${hit?.format ?? '-'}  want=${JSON.stringify(expected)}`);
}
process.exit(failed ? 1 : 0);
