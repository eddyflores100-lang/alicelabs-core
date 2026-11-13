import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const headers=await readFile(new URL('./public/_headers',import.meta.url),'utf8');
const policies=new Map(headers.split(/\r?\n/)
  .map(line=>line.trim()).filter(line=>/^[A-Za-z-]+:\s/.test(line))
  .map(line=>{const i=line.indexOf(':');return [line.slice(0,i).toLowerCase(),line.slice(i+1).trim()];}));

test('Voice can request microphone permission only from AliceLabs Core origin',()=>{
  const permissions=policies.get('permissions-policy');
  assert.ok(permissions);
  assert.match(permissions,/(?:^|,\s*)microphone=\(self\)(?:,|$)/);
  assert.doesNotMatch(permissions,/microphone=\(\)/);
});
test('Camera and geolocation remain disabled without blocking voice',()=>{
  const permissions=policies.get('permissions-policy');
  assert.match(permissions,/camera=\(\)/);
  assert.match(permissions,/geolocation=\(\)/);
});
test('Security headers keep CSP, frame protection, and GitHub-only API access',()=>{
  const csp=policies.get('content-security-policy');
  assert.ok(csp);
  assert.match(csp,/default-src 'self'/);
  assert.match(csp,/frame-ancestors 'none'/);
  assert.match(csp,/connect-src 'self' https:\/\/api.github.com/);
  assert.equal(policies.get('x-content-type-options'),'nosniff');
  assert.equal(policies.get('x-frame-options'),'DENY');
});
test('Voice activation remains an explicit user action',async()=>{
  const code=await readFile(new URL('./src/VoiceInput.tsx',import.meta.url),'utf8');
  assert.match(code,/onClick=\{toggle\}/);
  assert.match(code,/SpeechRecognition\.requestPermissions\(\)/);
  assert.match(code,/instance\.start\(\)/);
});
