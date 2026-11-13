import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';
const base = 'https://alicelabs-core-agent.example.test';
const origin = 'https://alicelabs-core.pages.dev';
function request(path, { method = 'GET', data, from = origin } = {}) {
  return new Request(base + path, { method, headers: { Origin: from, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
test('health responds with provider capabilities and no credentials', async () => {
  const r = await worker.fetch(request('/api/health'));
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.ok, true);
  assert.equal(json.mode, 'bring-your-own-key');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), origin);
});
test('rejects non-project origin', async () => {
  const r = await worker.fetch(request('/api/health', { from: 'https://malicious.example' }));
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
});
test('enforces BYOK and never responds with API key', async () => {
  const r = await worker.fetch(request('/api/agent', { method: 'POST', data: { provider: 'openrouter', question: 'Hola' } }));
  assert.equal(r.status, 400);
  assert.doesNotMatch(await r.text(), /sk-secret-do-not-leak/);
});
test('rejects unrecognized provider and fake model names', async () => {
  const r = await worker.fetch(request('/api/agent', { method: 'POST', data: { provider: 'random-url', model: 'https://fake', apiKey: 'example', question: 'Hola' } }));
  assert.equal(r.status, 400);
});
test('returns a real provider result without leaking the key or executing a tool', async () => {
  const saved = globalThis.fetch;
  let captured = null;
  try {
    globalThis.fetch = async (url, opts) => {
      captured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
      return Response.json({ choices: [{ message: { content: 'Respuesta del proveedor' } }] });
    };
    const apiKey = 'sk-secret-do-not-leak';
    const r = await worker.fetch(request('/api/agent', { method: 'POST', data: { provider: 'openai', model: 'gpt-4.1-mini', apiKey, question: 'Explícame el archivo', path: 'src/test.js', code: 'console.log(1)' } }));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.answer, 'Respuesta del proveedor');
    assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(captured.headers.Authorization, 'Bearer ' + apiKey);
    assert.doesNotMatch(JSON.stringify(data), /sk-secret-do-not-leak/);
    assert.match(captured.body.messages[1].content, /console.log/);
  } finally { globalThis.fetch = saved; }
});
