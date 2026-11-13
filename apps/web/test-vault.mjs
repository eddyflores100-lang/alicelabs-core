import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sealConnections, unsealConnections, hasStoredVault, eraseStoredVault,
  exportEncryptedVault, importEncryptedVault
} from './src/credentialVault.ts';

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: k => values.has(k) ? values.get(k) : null,
    setItem: (k, v) => values.set(k, v),
    removeItem: k => values.delete(k)
  }
};

const password = 'strong-owner-passphrase-2026';
const profiles = [{
  id: 'profile-1', label: 'Cuenta dueña', provider: 'groq',
  apiKey: 'sk-test-secret-12345', models: [{id: 'model-one', name: 'Model One'}],
  refreshedAt: 1760000000000, meta: null
}];

test('Owner vault encrypts authenticated API profiles; wrong password and tampering fail', async () => {
  eraseStoredVault();
  assert.equal(hasStoredVault(), false);
  await assert.rejects(sealConnections(profiles, 'short'), /12/);
  await sealConnections(profiles, password);
  assert.equal(hasStoredVault(), true);
  const encrypted = exportEncryptedVault();
  assert.doesNotMatch(encrypted, /sk-test-secret-12345/);
  assert.doesNotMatch(encrypted, /Cuenta dueña/);
  assert.deepEqual(await unsealConnections(password), profiles);
  await assert.rejects(unsealConnections('not-the-owner-passphrase'), /desbloquear/);
  const envelope = JSON.parse(encrypted);
  envelope.ciphertext = envelope.ciphertext.slice(0,-4) + 'AAAA';
  importEncryptedVault(JSON.stringify(envelope));
  await assert.rejects(unsealConnections(password), /desbloquear/);
  importEncryptedVault(encrypted);
  assert.deepEqual(await unsealConnections(password), profiles);
  assert.throws(() => importEncryptedVault(JSON.stringify({connections: profiles})), /no válida/);
  eraseStoredVault();
  assert.equal(hasStoredVault(), false);
});
