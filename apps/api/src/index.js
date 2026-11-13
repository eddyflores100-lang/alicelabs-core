/**
 * AliceLabs Core — Cloudflare Worker (BYOK model gateway).
 * Keys exist only for the duration of an individual request. No storage or logging.
 * No tool/shell execution and no unrestricted proxy URLs.
 */
const DEFAULT_MODELS = Object.freeze({
  openai: 'gpt-4.1-mini',
  openrouter: 'openai/gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-5',
  google: 'gemini-2.5-flash'
});
const MAX_BODY = 130000;
const corsOrigin = (origin) => {
  if (!origin) return '';
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && (u.hostname === 'alicelabs-core.pages.dev' || u.hostname.endsWith('.alicelabs-core.pages.dev'))) return origin;
    if (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && ['5173', '4173'].includes(u.port)) return origin;
  } catch {}
  return '';
};
const headersFor = (origin) => {
  const h = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
  };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
};
const json = (data, status, origin) => new Response(JSON.stringify(data), {
  status, headers: { ...headersFor(origin), 'Content-Type': 'application/json; charset=utf-8' }
});
const reject = (message, status, origin) => json({ ok: false, error: message }, status, origin);

function normalizeText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : (part.text || '')).join('\n');
  return '';
}
function cleanEdit(result) {
  const text = result.trim();
  const code = text.match(/^```(?:[\w+.-]+)?\s*\n([\s\S]*?)\n```\s*$/);
  return code ? code[1] : result;
}
function systemPrompt(action, path) {
  if (action === 'edit') return 'You are AliceLabs Core code editor. Return the complete revised contents of exactly one file. No markdown fences, no explanations, no surrounding tags. Preserve unrelated code. The active file is: ' + path + '.';
  return 'You are AliceLabs Core, an expert programming assistant inside an IDE. Be precise, concise, helpful. Reply in the language of the user. Do not pretend to have executed tools or changed files; you can only propose changes.';
}
async function callProvider({ provider, model, apiKey, system, messages }) {
  let endpoint, headers, body, extract;
  if (provider === 'openai' || provider === 'openrouter') {
    endpoint = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    headers = { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
    body = { model, messages: [{ role: 'system', content: system }, ...messages], stream: false };
    extract = (data) => normalizeText(data.choices?.[0]?.message?.content);
  } else if (provider === 'anthropic') {
    endpoint = 'https://api.anthropic.com/v1/messages';
    headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
    body = { model, max_tokens: 8192, system, messages };
    extract = (data) => normalizeText(data.content);
  } else if (provider === 'google') {
    endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    headers = { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' };
    body = { systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 8192 } };
    extract = (data) => (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n');
  } else throw new Error('Proveedor no admitido');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 85000);
  try {
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Do not forward arbitrary upstream error bodies; they may contain request details.
      const msg = typeof data.error?.message === 'string' ? data.error.message.slice(0, 250) : 'Solicitud rechazada por el proveedor';
      const err = new Error(msg);
      err.status = res.status === 401 || res.status === 403 ? 401 : (res.status === 429 ? 429 : 502);
      throw err;
    }
    const result = extract(data);
    if (!result) throw new Error('El proveedor respondió sin texto');
    return result;
  } finally { clearTimeout(timer); }
}
export default {
  async fetch(request) {
    const origin = corsOrigin(request.headers.get('Origin'));
    if (request.headers.has('Origin') && !origin) return reject('Origen no autorizado', 403, '');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headersFor(origin) });
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, service: 'alicelabs-core-agent', version: '1.0.0', mode: 'bring-your-own-key', providers: DEFAULT_MODELS }, 200, origin);
    }
    if (request.method !== 'POST' || url.pathname !== '/api/agent') return reject('Ruta no encontrada', 404, origin);
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return reject('Solicitud demasiado grande', 413, origin);
    let input;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return reject('Solicitud demasiado grande', 413, origin);
      input = JSON.parse(raw);
    } catch { return reject('JSON inválido', 400, origin); }
    const provider = String(input.provider || '').toLowerCase();
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const model = String(input.model || DEFAULT_MODELS[provider] || '').trim();
    const action = input.action === 'edit' ? 'edit' : 'chat';
    const question = typeof input.question === 'string' ? input.question.slice(0, 12000) : '';
    const path = typeof input.path === 'string' ? input.path.slice(0, 500) : '';
    const code = typeof input.code === 'string' ? input.code.slice(0, 50000) : '';
    if (!Object.hasOwn(DEFAULT_MODELS, provider)) return reject('Proveedor no admitido', 400, origin);
    if (!apiKey || apiKey.length > 600) return reject('Añade una clave de API válida en Conexiones', 400, origin);
    if (!/^[\w./:+-]{2,120}$/.test(model)) return reject('Nombre de modelo inválido', 400, origin);
    if (!question.trim()) return reject('Escribe una solicitud', 400, origin);
    if (action === 'edit' && !path) return reject('Abre un archivo de texto antes de editar con IA', 400, origin);
    const recent = Array.isArray(input.history) ? input.history.slice(-8).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 5000) })) : [];
    const activeContext = path ? '\n\nCurrent file: ' + path + '\n' + code + '\n' : '';
    const messages = action === 'edit'
      ? [{ role: 'user', content: 'Instruction: ' + question + activeContext }]
      : [...recent, { role: 'user', content: question + activeContext }];
    const started = Date.now();
    try {
      const answer = await callProvider({ provider, model, apiKey, system: systemPrompt(action, path), messages });
      return json({ ok: true, action, answer: action === 'edit' ? cleanEdit(answer) : answer, model, durationMs: Date.now() - started }, 200, origin);
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Tiempo de espera agotado con el proveedor' : String(error.message || 'Error del proveedor').slice(0, 280);
      return reject(message, error.status || 502, origin);
    }
  }
};
