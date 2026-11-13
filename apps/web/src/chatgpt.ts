import type { AgentResponse, ChatMessage } from './agent';

export const CHATGPT_COMPANION = 'http://127.0.0.1:39008';

export type ChatGPTAccount = {
  id: string; label: string; email: string; subject: string;
  connected: boolean; planAccess: boolean; expiresAt: number | null;
};
export type ChatGPTModel = { id: string; name: string };
export type AccountSnapshot = { accounts: ChatGPTAccount[]; pending: boolean; lastFailure: string };

async function send<T>(path: string, pairToken: string, body?: unknown): Promise<T> {
  const response = await fetch(CHATGPT_COMPANION + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-Core-Token': pairToken.trim(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store', signal: AbortSignal.timeout(path === '/chat' ? 125000 : 25000)
  });
  const data = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) throw new Error(data.error || 'No se pudo contactar con el componente local de ChatGPT');
  return data as T;
}

export async function companionHealth(): Promise<boolean> {
  try {
    const response = await fetch(CHATGPT_COMPANION + '/health', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    const data = await response.json();
    return response.ok && data.service === 'alicelabs-chatgpt-companion';
  } catch { return false; }
}
export async function getChatGPTAccounts(token: string): Promise<AccountSnapshot> {
  return send<AccountSnapshot & { ok: boolean }>('/accounts', token);
}
export async function startChatGPTLogin(token: string, id?: string): Promise<string> {
  const result = await send<{ ok: boolean; url: string }>('/oauth/start', token, { id: id || null });
  if (!result.url.startsWith('https://auth.openai.com/api/accounts/authorize?')) throw new Error('Respuesta de autenticación no reconocida');
  return result.url;
}
export async function getChatGPTModels(token: string, id: string): Promise<ChatGPTModel[]> {
  const result = await send<{ ok: boolean; models: ChatGPTModel[] }>('/models', token, { id });
  return result.models || [];
}
export async function disconnectChatGPTAccount(token: string, id: string, remove = false): Promise<{ revoked: boolean }> {
  return send<{ ok: boolean; revoked: boolean }>(remove ? '/remove' : '/disconnect', token, { id });
}
export async function runChatGPT(args: {
  token: string; id: string; model: string; action: 'chat' | 'edit' | 'guide';
  question: string; project?: string; path?: string; code?: string; history: ChatMessage[];
}): Promise<AgentResponse> {
  return send<AgentResponse>('/chat', args.token, {
    id: args.id, model: args.model, action: args.action, question: args.question,
    project: args.project || '', path: args.path || '', code: args.code || '',
    history: args.history.slice(-6).map(m => ({ role: m.role, content: m.content }))
  });
}
