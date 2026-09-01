import { formatStateLong, stateNameOnly, isValidStateCode } from '../usStates';

test('formatStateLong expands a valid code to "Name (CODE)"', () => {
  expect(formatStateLong('TX')).toEqual({ text: 'Texas (TX)', valid: true });
});

test('formatStateLong tolerates whitespace and case', () => {
  expect(formatStateLong(' tx ')).toEqual({ text: 'Texas (TX)', valid: true });
});

test('formatStateLong flags an unrecognized code as invalid, echoing the raw value', () => {
  expect(formatStateLong('TE')).toEqual({ text: 'TE', valid: false });
});

test('formatStateLong handles blank input', () => {
  expect(formatStateLong('')).toEqual({ text: '', valid: false });
  expect(formatStateLong(null)).toEqual({ text: '', valid: false });
});

test('stateNameOnly returns the full name for valid, raw code for invalid', () => {
  expect(stateNameOnly('TX')).toBe('Texas');
  expect(stateNameOnly('TE')).toBe('TE');
});

test('isValidStateCode covers DC and a territory', () => {
  expect(isValidStateCode('DC')).toBe(true);
  expect(isValidStateCode('PR')).toBe(true);
  expect(isValidStateCode('TE')).toBe(false);
});
