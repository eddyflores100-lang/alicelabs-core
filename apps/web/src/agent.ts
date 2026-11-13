export type Provider = 'openai' | 'openrouter' | 'anthropic' | 'google';
export type ChatMessage = { role: 'user' | 'assistant'; content: string; timestamp: number };
export type AgentResponse = { ok: boolean; answer?: string; error?: string; action?: 'edit' | 'chat'; model?: string; durationMs?: number };
export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: 'gpt-4.1-mini', openrouter: 'openai/gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-5', google: 'gemini-2.5-flash'
};
export const API_ENDPOINT = import.meta.env.VITE_CORE_API || 'https://alicelabs-core-agent.eddyflores100.workers.dev';
export async function pingWorker(): Promise<boolean> {
  try {
    const r = await fetch(API_ENDPOINT + '/api/health', { cache: 'no-store', signal: AbortSignal.timeout(9000) });
    const j = await r.json();
    return r.ok && j.ok === true && j.service === 'alicelabs-core-agent';
  } catch { return false; }
}
export async function requestAgent(args: {
  provider: Provider; model: string; apiKey: string; action: 'edit' | 'chat';
  question: string; path?: string; code?: string; history?: ChatMessage[];
}): Promise<AgentResponse> {
  const response = await fetch(API_ENDPOINT + '/api/agent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: args.provider, model: args.model, apiKey: args.apiKey,
      action: args.action, question: args.question, path: args.path || '',
      code: args.code || '',
      history: (args.history || []).slice(-8).map(({ role, content }) => ({ role, content }))
    })
  });
  const data = (await response.json()) as AgentResponse;
  if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo contactar con el agente');
  return data;
}
