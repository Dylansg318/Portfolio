'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { convertEplToZpl } = require('../eplToZpl');

test('minimal slip emits one ^XA…^XZ frame', () => {
  const epl = 'JF\r\nQ1218,24\r\nR10,10\r\nN\r\nA20,20,0,3,1,1,N,"hello"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.match(zpl, /^\^XA/);
  assert.match(zpl, /\^XZ$/);
  assert.equal((zpl.match(/\^XA/g) || []).length, 1);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
});

test('label height + origin land in the ZPL frame', () => {
  const epl = 'JF\r\nQ1218,24\r\nR10,5\r\nA0,0,0,3,1,1,N,"x"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.match(zpl, /\^LL1218/);
  assert.match(zpl, /\^LH10,5/);
});

test('A text command becomes ^FO + ^A0 + ^FD + ^FS', () => {
  const epl = 'JF\r\nQ100,10\r\nA20,30,0,2,1,1,N,"ORDER 1234"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  // Font 2 = 10×16; hm=vm=1 → ^A0N,16,10
  assert.match(zpl, /\^FO20,30\^A0N,16,10\^FDORDER 1234\^FS/);
});

test('A text with embedded comma in quotes is preserved', () => {
  const epl = 'JF\r\nQ100,10\r\nA0,0,0,2,1,1,N,"SPRINGFIELD, IL 62701"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.ok(zpl.includes('^FDSPRINGFIELD, IL 62701^FS'));
});

test('A with hmult/vmult scales the ZPL font dimensions linearly', () => {
  const epl = 'JF\r\nA0,0,0,3,2,3,N,"big"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  // Font 3 base = 12×20; hm=2 → w=24; vm=3 → h=60
  assert.match(zpl, /\^A0N,60,24/);
});

test('A reverse-video flag injects ^FR before ^FD', () => {
  const epl = 'JF\r\nA0,0,0,3,1,1,R,"rev"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.match(zpl, /\^FR\^A0N,20,12\^FDrev\^FS/);
});

test('A rotation maps EPL 0/1/2/3 → ZPL N/R/I/B', () => {
  for (const [rot, orient] of [['0', 'N'], ['1', 'R'], ['2', 'I'], ['3', 'B']]) {
    const zpl = convertEplToZpl(`A0,0,${rot},3,1,1,N,"x"\nP1`);
    assert.match(zpl, new RegExp(`\\^A0${orient},`));
  }
});

test('B Code 128 barcode → ^BY + ^BC', () => {
  const epl = 'JF\r\nB20,55,0,3,3,10,120,N,"10002003"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.match(zpl, /\^FO20,55\^BY3/);
  assert.match(zpl, /\^BCN,120,N,N,N,N/);
  assert.match(zpl, /\^FD10002003\^FS/);
});

test('B with human-readable flag B → printHr=Y', () => {
  const epl = 'JF\r\nB0,0,0,3,3,10,80,B,"42"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.match(zpl, /\^BCN,80,Y,N,N,N/);
});

test('LO becomes a filled ^GB rectangle', () => {
  const epl = 'JF\r\nA0,0,0,3,1,1,N,"x"\r\nLO8,305,770,3\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.match(zpl, /\^FO8,305\^GB770,3,3,B\^FS/);
});

test('P<n> sets the print quantity', () => {
  const epl = 'JF\r\nA0,0,0,3,1,1,N,"x"\r\nP2\r\n';
  const zpl = convertEplToZpl(epl);
  assert.match(zpl, /\^PQ2,0,1,Y/);
});

test('multi-page EPL → multiple ^XA…^XZ frames', () => {
  const epl =
    'JF\r\nQ1218,24\r\nR10,10\r\nN\r\nA0,0,0,3,1,1,N,"page1"\r\nP1\r\n' +
    'JF\r\nQ1218,24\r\nR10,10\r\nN\r\nA0,0,0,3,1,1,N,"page2"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.equal((zpl.match(/\^XA/g) || []).length, 2);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 2);
  assert.ok(zpl.includes('^FDpage1^FS'));
  assert.ok(zpl.includes('^FDpage2^FS'));
});

test('caret in text is hex-escaped so it cannot terminate the ZPL field', () => {
  const epl = 'JF\r\nA0,0,0,3,1,1,N,"a^b"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.ok(!zpl.includes('^FDa^b^FS'), 'raw ^ would break ZPL field');
  assert.ok(zpl.includes('^FDa\\5Eb^FS'));
});

test('preamble (JF, S, D, N) is silently dropped', () => {
  const epl = 'JF\r\nS6\r\nD10\r\nN\r\nA0,0,0,3,1,1,N,"x"\r\nP1\r\n';
  const zpl = convertEplToZpl(epl);
  assert.ok(!zpl.match(/\^FX.*JF/), 'JF should not appear in output');
  assert.ok(!zpl.match(/\^FX.*\bS6\b/));
});

test('captured slip fixture round-trips through the converter', () => {
  // Shaped like a real captured packing slip from the upstream label system;
  // the order number, barcode value, name and total are synthetic.
  const epl = [
    'JF',
    'Q1218,24',
    'R10,10',
    'S6', 'D10', 'N',
    'A5,1160,0,2,1,1,N,"                UPSTREAM SHIPPING SOLUTION"',
    'A700,10,0,5,1,1,N,"7"',
    'B20,55,0,3,3,10,120,N,"10002003"',
    'A20,185,0,3,1,1,N,"ORDER 1234567"',
    'A20,205,0,3,1,1,N,"CT# 10002003"',
    'LO8,305,770,3',
    'A20,315,0,2,1,1,N,"SOLD"',
    'A85,337,0,2,1,1,N,"ALEX SAMPLE"',
    'A470,605,0,2,1,1,N,"ORDER TOTAL:      $99.95"',
    'P1',
  ].join('\r\n');
  const zpl = convertEplToZpl(epl);
  // Key contents must round-trip.
  assert.ok(zpl.includes('^FDORDER 1234567^FS'));
  assert.ok(zpl.includes('^FDCT# 10002003^FS'));
  assert.ok(zpl.includes('^FDALEX SAMPLE^FS'));
  assert.ok(zpl.includes('^FDORDER TOTAL:      $99.95^FS'));
  // Code 128 with the CT# value.
  assert.ok(zpl.includes('^FD10002003^FS'));
  assert.ok(zpl.includes('^BCN,120,N,N,N,N'));
  // Exactly one label frame.
  assert.equal((zpl.match(/\^XA/g) || []).length, 1);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
});

test('accepts a Buffer', () => {
  const zpl = convertEplToZpl(Buffer.from('JF\nA0,0,0,3,1,1,N,"buf"\nP1', 'utf8'));
  assert.ok(zpl.includes('^FDbuf^FS'));
});

test('empty input returns empty string', () => {
  assert.equal(convertEplToZpl(''), '');
  assert.equal(convertEplToZpl(null), '');
});
