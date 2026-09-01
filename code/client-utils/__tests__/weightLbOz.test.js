import { splitOz, splitLbs, combineToOz, combineToLbs, quantizeLbsToWholeOz } from '../weightLbOz';

describe('splitOz — whole ounces only', () => {
  it('splits a total into whole lb + whole oz', () => {
    expect(splitOz(38)).toEqual({ lbs: '2', oz: '6' });
    expect(splitOz(16)).toEqual({ lbs: '1', oz: '' });   // 0 remainder → blank
  });
  it('rounds fractional ounces to a whole number (no more "1.6 oz")', () => {
    expect(splitOz(1.6)).toEqual({ lbs: '', oz: '2' });
    expect(splitOz(14.08)).toEqual({ lbs: '', oz: '14' }); // 0.88 lb
    expect(splitOz(51.2)).toEqual({ lbs: '3', oz: '3' });  // 51.2 → 51 whole
  });
  it('carries an ounce-overflow into the pound', () => {
    expect(splitOz(15.9)).toEqual({ lbs: '1', oz: '' });   // 15.9 → 16 oz → 1 lb 0 oz
  });
  it('blanks zero / negative / non-finite', () => {
    expect(splitOz(0)).toEqual({ lbs: '', oz: '' });
    expect(splitOz(-4)).toEqual({ lbs: '', oz: '' });
    expect(splitOz(null)).toEqual({ lbs: '', oz: '' });
    expect(splitOz(undefined)).toEqual({ lbs: '', oz: '' });
  });
});

describe('splitLbs', () => {
  it('splits decimal lbs into whole lb + whole oz', () => {
    expect(splitLbs(0.88)).toEqual({ lbs: '', oz: '14' }); // 14.08 oz → 14
    expect(splitLbs(2.5)).toEqual({ lbs: '2', oz: '8' });
  });
});

describe('combineToOz', () => {
  it('combines lb + oz into a whole total-oz count', () => {
    expect(combineToOz('1', '8')).toBe(24);
    expect(combineToOz('2', '')).toBe(32);
    expect(combineToOz('', '4')).toBe(4);
    expect(combineToOz('1.5', '')).toBe(24); // stray decimal lb still lands whole
  });
});

describe('combineToLbs', () => {
  it('combines into a decimal-lbs string', () => {
    expect(combineToLbs('1', '8')).toBe('1.5');
    expect(combineToLbs('0', '4')).toBe('0.25');
  });
  it('returns "" when both fields are blank so the caller falls back to auto', () => {
    expect(combineToLbs('', '')).toBe('');
  });
  it('returns "" for a non-positive total', () => {
    expect(combineToLbs('0', '0')).toBe('');
  });
});

describe('quantizeLbsToWholeOz — box weight snaps to a whole ounce, not 0.1 lb', () => {
  it('leaves an exact whole-oz weight unchanged', () => {
    expect(quantizeLbsToWholeOz(2)).toBe('2');     // 32 oz
    expect(quantizeLbsToWholeOz(1.5)).toBe('1.5'); // 24 oz
    expect(quantizeLbsToWholeOz(2.5)).toBe('2.5'); // 40 oz
    expect(quantizeLbsToWholeOz(45)).toBe('45');   // 720 oz
  });
  it('snaps a fractional-lb sum to the nearest ounce, agreeing with splitLbs (the field) and combineToLbs (typed)', () => {
    // 3 × ROUND(5/16,3) = 3 × 0.313 = 0.939 lb. Old .toFixed(1) → "0.9" (14 oz);
    // whole-oz → 15 oz, so the field and the "auto 15 oz" caption now match.
    expect(quantizeLbsToWholeOz(0.939)).toBe(combineToLbs('0', '15'));
    expect(splitLbs(quantizeLbsToWholeOz(0.939))).toEqual({ lbs: '', oz: '15' });
    // 3.75 lb (60 oz) is exact; 3.74 rounds to 60 oz too (was "3.7" = 59 oz before).
    expect(splitLbs(quantizeLbsToWholeOz(3.74))).toEqual({ lbs: '3', oz: '12' });
  });
  it('returns "" for a non-positive / sub-half-ounce weight', () => {
    expect(quantizeLbsToWholeOz(0)).toBe('');
    expect(quantizeLbsToWholeOz(-1)).toBe('');
    expect(quantizeLbsToWholeOz(0.01)).toBe(''); // rounds to 0 oz
    expect(quantizeLbsToWholeOz(null)).toBe('');
    expect(quantizeLbsToWholeOz(undefined)).toBe('');
  });
});
