import { safeNextPath } from '../safeNextPath';

test('returns a safe same-origin path (incl. query string)', () => {
  expect(safeNextPath('/inventory')).toBe('/inventory');
  expect(safeNextPath('/orders?status=open')).toBe('/orders?status=open');
});

test('rejects protocol-relative and absolute URLs (open redirect)', () => {
  expect(safeNextPath('//evil.example')).toBe('/orders');
  expect(safeNextPath('https://evil.example')).toBe('/orders');
});

test('rejects backslash payloads that browsers normalize to // (open redirect)', () => {
  expect(safeNextPath('/\\evil.example')).toBe('/orders');
  expect(safeNextPath('/\\/evil.example')).toBe('/orders');
});

test('never bounces back to /login', () => {
  expect(safeNextPath('/login')).toBe('/orders');
  expect(safeNextPath('/login?next=/x')).toBe('/orders');
});

test('falls back when next is missing/empty', () => {
  expect(safeNextPath(null)).toBe('/orders');
  expect(safeNextPath('')).toBe('/orders');
  expect(safeNextPath(undefined)).toBe('/orders');
});

test('honors a custom fallback', () => {
  expect(safeNextPath(null, '/home')).toBe('/home');
});
