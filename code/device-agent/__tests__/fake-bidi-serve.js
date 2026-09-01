'use strict';
// Emulates zebra-bidi.exe for BidiChannel tests. argv[2] scenario:
//   ok     — new exe: ready banner, answers every request
//   oldexe — old exe: "unknown mode" + exit 7 (the sniff-fallback path)
//   hang   — new exe that never answers requests (timeout/recycle path)
const scenario = process.argv[2] || 'ok';
if (scenario === 'oldexe') {
  console.log('{"ok":false,"error":"unknown mode"}');
  process.exit(7);
}
console.log('{"ok":true,"serve":true}');
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const cmd = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!cmd) continue;
    if (scenario === 'hang') continue;
    if (cmd === 'hs') {
      console.log(JSON.stringify({ ok: true, cmd: 'hs', ms: 5, hs: { paperOut: false, paused: false, labelLengthDots: 1320, formatsInBuffer: 0, labelsRemainingInBatch: 0, diagMode: false, headUp: false } }));
    } else if (cmd.startsWith('sgd:odometer')) {
      console.log(JSON.stringify({ ok: true, cmd, ms: 5, odometerInches: 1234 }));
    } else {
      console.log(JSON.stringify({ ok: true, cmd, ms: 5, raw: '' }));
    }
  }
});
process.stdin.on('end', () => process.exit(0));
