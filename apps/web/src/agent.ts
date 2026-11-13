export type Provider = 'openai' | 'openrouter' | 'anthropic' | 'google' | 'deepseek';
export type ChatMessage = { role: 'user' | 'assistant'; content: string; timestamp: number };
export type ModelInfo = {
  id: string; name: string; context: number | null; inputPerMillion: number | null; outputPerMillion: number | null;
  qualityRank: number | null; created: number | null;
};
export type ProviderMeta = { remaining: number | null; limit: number | null } | null;
export type Connection = {
  id: string; provider: Provider; label: string; apiKey: string; models: ModelInfo[]; refreshedAt: number; meta: ProviderMeta;
};
export type GuideStep = { title: string; description: string; action: 'open_folder' | 'open_github' | 'search_files' | 'configure_ai' | 'open_terminal' | 'save_active' | 'edit_active' | null };
export type Guidance = { summary: string; steps: GuideStep[] };
export type AgentResponse = { ok: boolean; answer?: string; error?: string; action?: 'edit' | 'chat' | 'guide'; model?: string; provider?: Provider; durationMs?: number; guide?: Guidance };
export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: 'gpt-6.1-sol', openrouter: 'openai/gpt-6.1-sol',
  anthropic: 'claude-sonnet-4-5', google: 'gemini-2.5-flash', deepseek: 'deepseek-flash'
};
export const API_ENDPOINT = import.meta.env.VITE_CORE_API || 'https://alicelabs-core-agent.eddyflores100.workers.dev';
export async function pingWorker(): Promise<boolean> {
  try {
    const r = await fetch(API_ENDPOINT + '/api/health', { cache: 'no-store', signal: AbortSignal.timeout(9000) });
    const j = await r.json();
    return r.ok && j.ok === true && j.service === 'alicelabs-core-agent';
  } catch { return false; }
}
export async function discoverModels(provider: Provider, apiKey: string): Promise<{ models: ModelInfo[]; refreshedAt: number; meta: ProviderMeta }> {
  const response = await fetch(API_ENDPOINT + '/api/models', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey }), signal: AbortSignal.timeout(40000)
  });
  const result = await response.json() as { ok: boolean; models?: ModelInfo[]; error?: string; refreshedAt?: number; meta?: ProviderMeta };
  if (!response.ok || !result.ok || !Array.isArray(result.models)) throw new Error(result.error || 'No se pudo consultar el catálogo del proveedor');
  return { models: result.models, refreshedAt: result.refreshedAt || Date.now(), meta: result.meta || null };
}
export async function requestAgent(args: {
  provider: Provider; model: string; apiKey: string; action: 'edit' | 'chat' | 'guide';
  question: string; project?: string; path?: string; code?: string; history?: ChatMessage[];
}): Promise<AgentResponse> {
  const response = await fetch(API_ENDPOINT + '/api/agent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: args.provider, model: args.model, apiKey: args.apiKey, action: args.action, question: args.question,
      project: args.project || '', path: args.path || '', code: args.code || '',
      history: (args.history || []).slice(-8).map(({ role, content }) => ({ role, content }))
    }), signal: AbortSignal.timeout(110000)
  });
  const data = await response.json() as AgentResponse;
  if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo contactar con el agente');
  return data;
}
