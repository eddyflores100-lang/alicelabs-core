import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';

const origin = 'https://alicelabs-core.pages.dev';
const base = 'https://alicelabs-core-agent.example.test';
const key = 'sk-secret-testing-key';
function request(path, { method = 'GET', body, from = origin } = {}) {
  return new Request(base + path, {
    method, headers: { Origin: from, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}
function withFakeFetch(handler, fn) {
  const saved = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = saved; });
}
test('health advertises live model discovery, no shared credentials', async () => {
  const r = await worker.fetch(request('/api/health'));
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.ok(data.features.includes('model-discovery'));
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), origin);
  assert.doesNotMatch(JSON.stringify(data), /secret/);
});
test('foreign website origins are rejected by the Worker', async () => {
  const r = await worker.fetch(request('/api/health', { from: 'https://malicious.example' }));
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
});
test('model discovery requires an API credential and restricts provider IDs', async () => {
  const a = await worker.fetch(request('/api/models', { method: 'POST', body: { provider: 'openrouter' } }));
  const b = await worker.fetch(request('/api/models', { method: 'POST', body: { provider: 'evil-provider', apiKey: key } }));
  assert.equal(a.status, 400);
  assert.equal(b.status, 400);
});
test('OpenRouter account is validated before its catalog is used', async () => {
  const visited = [];
  await withFakeFetch(async (url, init) => {
    visited.push(url);
    assert.equal(init.headers.Authorization, 'Bearer ' + key);
    if (url.endsWith('/key')) return Response.json({ data: { limit_remaining: 7.5, limit: 30 } });
    return Response.json({ data: [
      { id: 'openai/gpt-6.1-sol', name: 'Sol', context_length: 120000, pricing: { prompt: '0.000001', completion: '0.000005' } },
      { id: 'vendor/audio-special', architecture: { output_modalities: ['audio'] } }
    ] });
  }, async () => {
    const r = await worker.fetch(request('/api/models', { method: 'POST', body: { provider: 'openrouter', apiKey: key } }));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.models.length, 1);
    assert.equal(data.models[0].id, 'openai/gpt-6.1-sol');
    assert.equal(data.models[0].qualityRank, 1);
    assert.equal(data.models[0].inputPerMillion, 1);
    assert.equal(data.meta.remaining, 7.5);
    assert.doesNotMatch(JSON.stringify(data), /sk-secret/);
  });
  assert.equal(visited.length, 2);
  assert.ok(visited[1].includes('sort=intelligence-high-to-low'));
});
test('invalid OpenRouter key never silently accesses public model catalog', async () => {
  let visits = 0;
  await withFakeFetch(async () => { visits++; return Response.json({ error: { message: 'Invalid API key' } }, { status: 401 }); }, async () => {
    const r = await worker.fetch(request('/api/models', { method: 'POST', body: { provider: 'openrouter', apiKey: key } }));
    assert.equal(r.status, 401);
  });
  assert.equal(visits, 1);
});
test('OpenAI uses Responses API, does not persist generation or expose key', async () => {
  await withFakeFetch(async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization, 'Bearer ' + key);
    const requestBody = JSON.parse(init.body);
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.model, 'gpt-6.1-sol');
    assert.equal(requestBody.input[0].role, 'user');
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Arquitectura comprobada' }] }] });
  }, async () => {
    const r = await worker.fetch(request('/api/agent', { method: 'POST', body: {
      provider: 'openai', apiKey: key, model: 'gpt-6.1-sol', action: 'chat',
      question: 'Explica el archivo', path: 'src/App.tsx', code: 'export const ready = true'
    } }));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.answer, 'Arquitectura comprobada');
    assert.doesNotMatch(JSON.stringify(data), /sk-secret/);
  });
});
test('guided workflow produces approved UI actions and rejects invented tools', async () => {
  await withFakeFetch(async () => Response.json({ choices: [{ message: { content: JSON.stringify({
    summary: 'Abre el proyecto primero.',
    steps: [{ title: 'Abrir carpeta', description: 'Permitir acceso explícito.', action: 'open_folder' },
      { title: 'No permitido', description: 'No ejecutar.', action: 'execute_shell' }]
  }) } }] }), async () => {
    const r = await worker.fetch(request('/api/agent', { method: 'POST', body: {
      provider: 'openrouter', apiKey: key, model: 'openai/gpt-6.1-sol', action: 'guide', question: '¿Cómo empiezo?'
    } }));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.guide.steps[0].action, 'open_folder');
    assert.equal(data.guide.steps[1].action, null);
    assert.equal(data.action, 'guide');
  });
});
test('provider rate limit is returned without retrying another account', async () => {
  let calls = 0;
  await withFakeFetch(async () => { calls++; return Response.json({ error: { message: 'Rate limit ' + key } }, { status: 429 }); }, async () => {
    const r = await worker.fetch(request('/api/agent', { method: 'POST', body: {
      provider: 'openai', apiKey: key, model: 'gpt-6.1-sol', question: 'Hola'
    } }));
    assert.equal(r.status, 429);
    assert.doesNotMatch(await r.text(), /sk-secret/);
  });
  assert.equal(calls, 1);
});
test('Gemini discovery only includes generateContent text models', async () => {
  await withFakeFetch(async () => Response.json({ models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576 },
    { name: 'models/embedding-005', supportedGenerationMethods: ['embedContent'] }
  ] }), async () => {
    const r = await worker.fetch(request('/api/models', { method: 'POST', body: { provider: 'google', apiKey: key } }));
    const data = await r.json();
    assert.equal(r.status, 200);
    assert.equal(data.models.length, 1);
    assert.equal(data.models[0].context, 1048576);
  });
});
