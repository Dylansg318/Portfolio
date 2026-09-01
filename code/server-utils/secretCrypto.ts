'use strict';
/**
 * AES-256-GCM symmetric encryption for short secrets stored in Postgres bytea
 * columns.
 *
 * `secretCipher(envVar)` builds a cipher bound to a 32-byte base64 key read
 * from process.env[envVar]. The key is read lazily (per call) so tests and
 * boot-time requires work before the env var is set.
 *
 * Wire format on disk (bytea): [12-byte IV][16-byte auth tag][N-byte ciphertext]
 *
 * In use: carrier webhook-listener secrets and hardware-agent (printer /
 * shipping-station) API keys, each bound to its own env var.
 */

const crypto = require('crypto');

const IV_LEN  = 12;
const TAG_LEN = 16;

function secretCipher(envVar: string) {
  function getKey(): Buffer {
    const b64 = process.env[envVar];
    if (!b64) throw new Error(`${envVar} env var is not set (32-byte base64 expected).`);
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error(`${envVar} must decode to 32 bytes (got ${key.length}).`);
    return key;
  }

  function encrypt(plain: string): Buffer {
    if (typeof plain !== 'string') throw new Error('encrypt expects a string.');
    const key = getKey();
    const iv  = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]); // 12 + 16 + N
  }

  function decrypt(buf: Buffer): string {
    if (!Buffer.isBuffer(buf)) throw new Error('decrypt expects a Buffer.');
    if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('Ciphertext too short.');
    const key = getKey();
    const iv  = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  // True when the bound env var is present — lets callers degrade gracefully
  // (skip encryption) instead of throwing when the key is not yet configured.
  function available(): boolean {
    return !!process.env[envVar];
  }

  return { encrypt, decrypt, available };
}

// Default binding for webhook-listener secrets — original API, behaviour unchanged.
const _default = secretCipher('SECRET_CIPHER_KEY');

export const encryptSecret = _default.encrypt;
export const decryptSecret = _default.decrypt;
export { secretCipher };
