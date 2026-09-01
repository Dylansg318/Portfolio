// Run: node --import tsx --test __tests__/secretCrypto.test.js
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { encryptSecret, decryptSecret, secretCipher } = require('../secretCrypto');

describe('secretCrypto', () => {
  const originalEnv = process.env.SECRET_CIPHER_KEY;

  before(() => {
    // 32-byte key, base64
    process.env.SECRET_CIPHER_KEY = require('crypto')
      .randomBytes(32)
      .toString('base64');
  });

  after(() => {
    process.env.SECRET_CIPHER_KEY = originalEnv;
  });

  test('round-trip encrypts and decrypts a 32-char secret', () => {
    const plain = 'MySecretKeyPhraseIs32BytesLength';
    assert.equal(plain.length, 32);
    const cipher = encryptSecret(plain);
    assert.equal(Buffer.isBuffer(cipher), true);
    assert.ok(cipher.length > 32); // iv + tag + ciphertext
    assert.equal(decryptSecret(cipher), plain);
  });

  test('decryptSecret throws on tampered ciphertext', () => {
    const cipher = encryptSecret('MySecretKeyPhraseIs32BytesLength');
    cipher[cipher.length - 1] ^= 1; // flip last byte
    assert.throws(() => decryptSecret(cipher));
  });

  test('throws if SECRET_CIPHER_KEY missing', () => {
    const saved = process.env.SECRET_CIPHER_KEY;
    delete process.env.SECRET_CIPHER_KEY;
    assert.throws(() => encryptSecret('x'), /SECRET_CIPHER_KEY/);
    process.env.SECRET_CIPHER_KEY = saved;
  });

  test('secretCipher binds to a custom env var and round-trips', () => {
    process.env.TEST_AGENT_CIPHER_KEY = require('crypto').randomBytes(32).toString('base64');
    const cipher = secretCipher('TEST_AGENT_CIPHER_KEY');
    assert.equal(cipher.available(), true);
    const plain = 'agent_' + 'x'.repeat(32);
    const enc = cipher.encrypt(plain);
    assert.equal(Buffer.isBuffer(enc), true);
    assert.equal(cipher.decrypt(enc), plain);
    delete process.env.TEST_AGENT_CIPHER_KEY;
  });

  test('secretCipher.available() is false when the env var is unset', () => {
    delete process.env.TEST_MISSING_CIPHER_KEY;
    assert.equal(secretCipher('TEST_MISSING_CIPHER_KEY').available(), false);
  });
});
