/**
 * TOTP code generation per RFC 6238.
 * No external dependencies — uses Node's built-in crypto.
 */
const crypto = require('crypto');

/** Decode a base32-encoded string to a Buffer. */
export function base32Decode(str: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = str.replace(/[\s=-]+/g, '').toUpperCase();
  let bits = '';
  for (const ch of cleaned) {
    const val = alphabet.indexOf(ch);
    if (val === -1) throw new Error(`Invalid base32 character: ${ch}`);
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Generate a TOTP code.
 * @param {string} secret  Base32-encoded secret
 * @param {object} [opts]
 * @param {number} [opts.digits=6]   Code length
 * @param {number} [opts.period=30]  Time step in seconds
 * @param {string} [opts.algorithm='SHA1']  HMAC algorithm
 * @returns {{ code: string, remaining: number, period: number }}
 */
export function generateTOTP(secret: string, { digits = 6, period = 30, algorithm = 'SHA1' }: { digits?: number; period?: number; algorithm?: string } = {}): { code: string; remaining: number; period: number } {
  const key = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / period);

  // Counter as 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmacAlgo = algorithm.toLowerCase().replace('-', '');
  const hmac = crypto.createHmac(hmacAlgo, key).update(counterBuf).digest();

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) <<  8) |
     (hmac[offset + 3] & 0xff);

  const code = (binary % (10 ** digits)).toString().padStart(digits, '0');
  const remaining = period - (now % period);

  return { code, remaining, period };
}
