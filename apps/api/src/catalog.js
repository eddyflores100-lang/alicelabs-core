/**
 * Public model discovery, indexed from the documented models.dev catalog.
 * A catalog entry is a DISCOVERY result, not evidence that a user can execute it.
 * No secrets are accepted or forwarded, no arbitrary upstream URLs.
 */
const CATALOG_URL = 'https://models.dev/api.json';
const TTL = 60 * 60 * 1000;
let snapshot = null;
let loading = null;
function text(x, max = 160) { return typeof x === 'string' ? x.slice(0, max) : ''; }
function num(x) { const n = Number(x); return x === undefined || x === null || !Number.isFinite(n) ? null : n; }
function normalize(provider, id, model) {
  const p = text(provider.name, 90);
  const name = text(model.name || id, 125);
  const output = model.modalities?.output || ['text'];
  const input = model.modalities?.input || ['text'];
  if (!output.includes('text')) return null;
  // Specialized non-text interaction models do not belong to a coding/chat picker.
  if (model.type && !['language', 'chat'].includes(model.type)) return null;
  return {
    id: text(id, 160),
    providerId: text(provider.id, 90),
    provider: p,
    name,
    family: text(model.family, 70),
    description: text(model.description, 250),
    context: num(model.limit?.context),
    inputCost: num(model.cost?.input),
    outputCost: num(model.cost?.output),
    reasoning: model.reasoning === true,
    tools: model.tool_call === true,
    vision: input.includes('image'),
    openWeights: model.open_weights === true,
    updated: text(model.last_updated || model.release_date, 20),
    source: 'models.dev'
  };
}
async function downloadCatalog() {
  const response = await fetch(CATALOG_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(22000),
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  if (!response.ok) throw new Error('No se pudo consultar Models.dev (' + response.status + ')');
  const data = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Formato de catálogo inválido');
  const providers = [];
  const models = [];
  for (const [id, record] of Object.entries(data)) {
    if (!record || typeof record !== 'object' || !record.models) continue;
    const provider = { id: text(record.id || id, 90), name: text(record.name || id, 90) };
    let count = 0;
    for (const [modelId, item] of Object.entries(record.models)) {
      const parsed = normalize(provider, modelId, item);
      if (!parsed) continue;
      models.push(parsed);
      count++;
    }
    if (count) providers.push({ ...provider, count });
  }
  if (providers.length < 20 || models.length < 200) throw new Error('El catálogo está incompleto');
  providers.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { providers, models, fetchedAt: Date.now() };
}
async function catalog() {
  if (snapshot && Date.now() - snapshot.fetchedAt < TTL) return snapshot;
  if (!loading) loading = downloadCatalog().then(data => { snapshot = data; return data; }).finally(() => { loading = null; });
  try { return await loading; }
  catch (error) {
    if (snapshot) return snapshot; // stale-but-usable data, clearly stamped with fetchedAt
    throw error;
  }
}
export async function searchCatalog(url) {
  const result = await catalog();
  const query = text(url.searchParams.get('q') || '', 90).toLowerCase().trim();
  const providerId = text(url.searchParams.get('provider') || '', 90).toLowerCase();
  const reasoning = url.searchParams.get('reasoning') === 'true';
  const tools = url.searchParams.get('tools') === 'true';
  const vision = url.searchParams.get('vision') === 'true';
  const openWeights = url.searchParams.get('openWeights') === 'true';
  const size = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 36));
  const offset = Math.min(10000, Math.max(0, Number(url.searchParams.get('offset')) || 0));
  let found = result.models.filter(m =>
    (!providerId || m.providerId.toLowerCase() === providerId) &&
    (!query || (m.name + ' ' + m.id + ' ' + m.provider + ' ' + m.family + ' ' + m.description).toLowerCase().includes(query)) &&
    (!reasoning || m.reasoning) && (!tools || m.tools) &&
    (!vision || m.vision) && (!openWeights || m.openWeights)
  );
  const sort = url.searchParams.get('sort');
  if (sort === 'price') found = found.sort((a,b) => (a.inputCost ?? Infinity) - (b.inputCost ?? Infinity));
  else if (sort === 'context') found = found.sort((a,b) => (b.context ?? 0) - (a.context ?? 0));
  else if (sort === 'name') found = found.sort((a,b) => a.name.localeCompare(b.name));
  else found = found.sort((a,b) => (b.updated || '').localeCompare(a.updated || '') || a.name.localeCompare(b.name));
  return {
    ok: true,
    source: 'https://models.dev/api.json',
    status: 'discovery-only',
    fetchedAt: result.fetchedAt,
    stale: Date.now() - result.fetchedAt >= TTL,
    providers: result.providers,
    catalogTotal: result.models.length,
    providerTotal: result.providers.length,
    total: found.length,
    limit: size,
    offset,
    models: found.slice(offset, offset + size)
  };
}
export function resetCatalogForTests() { snapshot = null; loading = null; }
