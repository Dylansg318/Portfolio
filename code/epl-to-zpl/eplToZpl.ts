'use strict';

// Convert an upstream label system's EPL2 line-mode output to ZPL II.
//
// The warehouse Zebras (ZP 450 / ZP 500) are installed under the **ZPL** Windows
// driver. When the upstream system's "use ZPL" toggle is off — or a carrier path
// bypasses it — it emits a packing slip in EPL2 line-mode. The print-agent
// forwards those bytes RAW via the Win32 spooler, the printer can't decode EPL
// while in ZPL mode, and the slip lands blank. Converting at ingest keeps the
// printer + agent language-agnostic and the queue homogeneous (always ZPL).
//
// We support the subset of EPL2 the upstream system actually emits (observed
// across the live capture stream as of 2026-05-19):
//
//   Q<h>,<g>   label height + interlabel gap   → ^LL<h>
//   R<x>,<y>   reference point (origin offset) → ^LH<x>,<y>
//   A<args>    ASCII text                      → ^FO ^A0 ^FD ^FS
//   B<args>    barcode                         → ^FO ^BY ^BC|^B3 ^FD ^FS
//   LO<args>   line/box (solid black)          → ^FO ^GB ^FS
//   P<n>       end of page, print n copies     → ^PQ<n>,0,1,Y ^XZ
//   JF,N,S,D   line-mode preamble              → ignored (ZPL handles them)
//
// Unknown commands are emitted as a ZPL `^FX` comment so production regressions
// are visible without breaking the print.

const EPL_FONTS = {
  // Base size in dots @ 203 dpi (width × height); EPL hmult/vmult multiply linearly.
  '1': { w: 8,  h: 12 },
  '2': { w: 10, h: 16 },
  '3': { w: 12, h: 20 },
  '4': { w: 14, h: 24 },
  '5': { w: 32, h: 48 }, // big numerals (page number, etc.)
};

const EPL_ROTATIONS = { '0': 'N', '1': 'R', '2': 'I', '3': 'B' };

function escapeZplText(s): string {
  // ZPL field data terminates on ^ or ~ and uses \ as an escape lead-in. The
  // upstream templates never include these in real data, but escape via
  // ^FH-style hex (`\xx`) defensively so a stray ^ in an address line can't
  // cut a slip in half.
  return String(s).replace(/[\^~\\]/g, (c) =>
    '\\' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  );
}

// Parse an EPL command's comma-separated args + final quoted string. The text
// may contain commas (e.g. `"SPRINGFIELD, IL 62701"`), so split the quoted tail
// off first and tokenize the prefix on commas.
function parseEplArgs(rest: string) {
  const m = rest.match(/^([^"]*)"([\s\S]*)"\s*$/);
  if (!m) return null;
  const prefix = m[1].replace(/,\s*$/, '');
  const args = prefix.split(',').map((s) => s.trim());
  return { args, text: m[2] };
}

export function convertEplToZpl(eplPayload): string {
  const text = Buffer.isBuffer(eplPayload) ? eplPayload.toString('utf8') : String(eplPayload || '');
  const lines = text.split(/\r?\n/);

  const out = [];
  let labelHeight = 1218; // the upstream system's 4×6 default
  let originX = 0;
  let originY = 0;
  let inLabel = false;

  const startLabel = () => {
    if (inLabel) return;
    out.push('^XA');
    out.push('^CI28');                  // UTF-8 — safe superset of EPL's 7-bit ASCII
    out.push('^PW812');                 // 4" @ 203dpi — matches the upstream label width
    out.push(`^LL${labelHeight}`);
    out.push(`^LH${originX},${originY}`);
    inLabel = true;
  };

  const endLabel = (copies) => {
    if (!inLabel) return;
    out.push(`^PQ${copies || 1},0,1,Y`);
    out.push('^XZ');
    inLabel = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Preamble — ignore (ZPL handles speed/density via driver settings).
    if (line === 'JF' || line === 'N' || line === 'ZB') continue;
    if (/^[SD]\d+$/.test(line)) continue;
    if (line === 'OD' || line === 'I8,A,001') continue; // misc setup we've seen

    let m;

    // Q<height>,<gap> — sticky, applies to the next ^XA we open.
    if ((m = line.match(/^Q(\d+)/))) {
      labelHeight = parseInt(m[1], 10);
      continue;
    }

    // R<x>,<y> — sticky origin offset.
    if ((m = line.match(/^R(\d+),(\d+)/))) {
      originX = parseInt(m[1], 10);
      originY = parseInt(m[2], 10);
      continue;
    }

    // P<n> — end of label + print quantity.
    if ((m = line.match(/^P(\d+)/))) {
      endLabel(parseInt(m[1], 10));
      continue;
    }

    // A<x>,<y>,<rot>,<font>,<hm>,<vm>,<R|N>,"text"
    if (/^A\d/.test(line)) {
      startLabel();
      const parsed = parseEplArgs(line.slice(1));
      if (!parsed) { out.push(`^FX epl-unparseable-A: ${escapeZplText(line)}^FS`); continue; }
      const [x, y, rot, font, hm, vm, rev] = parsed.args;
      const base = EPL_FONTS[font] || EPL_FONTS['3'];
      const heightDots = base.h * (parseInt(vm, 10) || 1);
      const widthDots  = base.w * (parseInt(hm, 10) || 1);
      const orient = EPL_ROTATIONS[rot] || 'N';
      const reverse = rev === 'R' ? '^FR' : '';
      out.push(
        `^FO${x},${y}${reverse}^A0${orient},${heightDots},${widthDots}` +
        `^FD${escapeZplText(parsed.text)}^FS`
      );
      continue;
    }

    // B<x>,<y>,<rot>,<type>,<narrow>,<wide>,<height>,<B|N>,"text"
    if (/^B\d/.test(line)) {
      startLabel();
      const parsed = parseEplArgs(line.slice(1));
      if (!parsed) { out.push(`^FX epl-unparseable-B: ${escapeZplText(line)}^FS`); continue; }
      const [x, y, rot, type, narrow, , height, human] = parsed.args;
      const orient = EPL_ROTATIONS[rot] || 'N';
      const printHr = (human === 'B') ? 'Y' : 'N';
      out.push(`^FO${x},${y}^BY${narrow || 2}`);
      if (type === '3' || type === '4') {
        // Code 128 (auto / subset)
        out.push(`^BC${orient},${height},${printHr},N,N,N`);
      } else if (type === '0' || type === '1') {
        // Code 39 (no check / with check)
        out.push(`^B3${orient},N,${height},${printHr},N`);
      } else if (type === '2') {
        // Interleaved 2 of 5
        out.push(`^B2${orient},${height},${printHr},N,N`);
      } else {
        // Unknown → fall back to Code 128 so SOMETHING scans, log it.
        out.push(`^FX epl-unknown-barcode-type-${type}^FS`);
        out.push(`^BC${orient},${height},${printHr},N,N,N`);
      }
      out.push(`^FD${escapeZplText(parsed.text)}^FS`);
      continue;
    }

    // LO<x>,<y>,<width>,<height> — black-filled rectangle (used as divider line).
    if ((m = line.match(/^LO(\d+),(\d+),(\d+),(\d+)/))) {
      startLabel();
      const [, x, y, w, h] = m;
      out.push(`^FO${x},${y}^GB${w},${h},${h},B^FS`);
      continue;
    }

    // LE<x>,<y>,<width>,<height> — XOR'd (exclusive) line. Same rect for ZPL.
    if ((m = line.match(/^LE(\d+),(\d+),(\d+),(\d+)/))) {
      startLabel();
      const [, x, y, w, h] = m;
      out.push(`^FO${x},${y}^GB${w},${h},${h},B^FS`);
      continue;
    }

    // Anything else — emit as a ZPL comment so we can grep for regressions.
    out.push(`^FX epl-unhandled: ${escapeZplText(line).slice(0, 200)}^FS`);
  }

  // EPL streams sometimes end without a trailing P<n>; close the open label.
  endLabel(1);

  return out.join('\n');
}
