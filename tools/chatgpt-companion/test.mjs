import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = 'https://alicelabs-core.pages.dev';
const base = 'http://127.0.0.1:39008';
test('local OAuth companion: pairing, origin protection, registration URL and non-secret metadata', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'core-siwc-qa-'));
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: { ...process.env, HOME: home, USERPROFILE: home },
    windowsHide: true, stdio: ['ignore','pipe','pipe']
  });
  let buffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', s => { buffer += s; });
  proc.stderr.on('data', s => { buffer += s; });
  let token = '';
  try {
    for (let i = 0; i < 70; i++) {
      const match = buffer.match(/TOKEN LOCAL[^:\n]*:\s*([a-f0-9]{64})/);
      if (match) { token = match[1]; break; }
      if (proc.exitCode !== null) throw new Error('Companion terminó: ' + buffer.slice(-500));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(token.length, 64, 'Companion must start with 256-bit token');
    const doFetch = (route, more = {}) => fetch(base + route, {
      ...more, headers: { Origin: origin, ...more.headers }
    });
    const health = await doFetch('/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'alicelabs-chatgpt-companion');
    const badOrigin = await fetch(base + '/health', { headers: { Origin: 'https://other-site.example' } });
    assert.equal(badOrigin.status, 403);
    const noKey = await doFetch('/accounts');
    assert.equal(noKey.status, 401);
    const accounts = await doFetch('/accounts', { headers: { 'X-Core-Token': token } });
    assert.equal(accounts.status, 200);
    assert.deepEqual((await accounts.json()).accounts, []);
    const start = await doFetch('/oauth/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Core-Token': token },
      body: JSON.stringify({})
    });
    assert.equal(start.status, 200);
    const data = await start.json();
    const url = new URL(data.url);
    assert.equal(url.origin, 'https://auth.openai.com');
    assert.equal(url.pathname, '/api/accounts/authorize');
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(url.searchParams.get('agent_name_hint'), 'AliceLabs Core');
    assert.match(url.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.match(url.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
    assert.ok(url.searchParams.get('code_challenge').length > 40);
    assert.ok(!data.url.includes(token), 'Pairing secret must not appear in OAuth URL');
    const after = await (await doFetch('/accounts', { headers: { 'X-Core-Token': token } })).json();
    assert.equal(after.pending, true);
    const info = JSON.parse(await readFile(path.join(home, '.alicelabs-core','chatgpt-registrations.json'), 'utf8'));
    assert.equal(info.hostId, url.searchParams.get('ext_agent_host_id'));
    assert.deepEqual(info.accounts, []);
    // OAuth callback state mismatch must be rejected without consuming the valid login.
    const callback = new URL(url.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', 'state-not-matching-the-session');
    const rejected = await fetch(callback);
    assert.equal(rejected.status, 400);
    const stillPending = await (await doFetch('/accounts', { headers: { 'X-Core-Token': token } })).json();
    assert.equal(stillPending.pending, true);
    // A matching callback without an authorization code is not a successful login.
    callback.searchParams.set('state', url.searchParams.get('state'));
    const missingCode = await fetch(callback);
    assert.equal(missingCode.status, 400);
    const failed = await (await doFetch('/accounts', { headers: { 'X-Core-Token': token } })).json();
    assert.equal(failed.pending, false);
    assert.equal(failed.accounts.length, 0);
    assert.match(failed.lastFailure, /código OAuth/);
  } finally {
    proc.kill();
    await new Promise(resolve => { if (proc.exitCode !== null) return resolve(); proc.once('exit', resolve); setTimeout(resolve, 3000); });
    await rm(home, { recursive:true, force:true, maxRetries:3, retryDelay:200 });
  }
});
