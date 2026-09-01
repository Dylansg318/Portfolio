'use strict';

// Convert a data: URL logo into a ZPL ^GFA graphics block.
// Output shape: { zpl, height, width } so the renderer can advance the cursor
// and keep things in their lanes.
//
// A hard threshold (not the dither in zplThumbnail.ts) is the RIGHT tool here:
// a logo is line art whose pixels are already meant to be pure black or pure
// white, so threshold(180) cleans up anti-aliasing instead of destroying tone.
//
// ZPL ^GFA format (ASCII variant):
//   ^GFA,<total bytes>,<total bytes>,<bytes per row>,<hex>
// Each row is bitmap data, 1 bit per pixel, MSB first. Rows are padded to a
// whole byte.

import sharp from 'sharp';

const MAX_W = 280;   // 4-in label is 812 dots; cap so the logo never elbows
const MAX_H = 120;   // the order-number text.

async function buildLogoZpl(dataUrl, maxWidth = MAX_W, maxHeight = MAX_H) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return null;
  }
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return null;
  const b64 = dataUrl.slice(commaIdx + 1);
  let buf;
  try { buf = Buffer.from(b64, 'base64'); }
  catch (_) { return null; }

  // Resize, threshold to monochrome. `raw` gives us a Buffer of 0/255 bytes;
  // we then pack 8 pixels per byte for ZPL.
  let resized;
  try {
    resized = await sharp(buf)
      .flatten({ background: '#ffffff' })
      .resize({
        width: maxWidth,
        height: maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .greyscale()
      .threshold(180)
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (e) {
    return null;
  }

  const { data, info } = resized;
  const width = info.width;
  const height = info.height;
  const bytesPerRow = Math.ceil(width / 8);
  const totalBytes = bytesPerRow * height;

  // Pack 0/255 grayscale bytes (post-threshold) into MSB-first 1-bit rows.
  // 0 = ink (printed black), 255 = white. ZPL uses 1 = black.
  const packed = Buffer.alloc(totalBytes);
  let outIdx = 0;
  for (let y = 0; y < height; y++) {
    for (let xByte = 0; xByte < bytesPerRow; xByte++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        if (x < width) {
          const pixel = data[y * width + x];
          if (pixel === 0) byte |= (1 << (7 - bit));
        }
      }
      packed[outIdx++] = byte;
    }
  }

  const hex = packed.toString('hex').toUpperCase();
  const zpl = `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hex}^FS`;
  return { zpl, width, height };
}

export { buildLogoZpl };
