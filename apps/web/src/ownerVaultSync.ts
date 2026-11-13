const URL_CONFIG = String(import.meta.env.VITE_CORE_REMOTE_URL || '').trim().replace(/\/+$/, '');

function trustedRemote(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname.endsWith('.workers.dev') ||
       url.hostname.endsWith('.alicelabs.site') ||
       url.hostname === 'alicelabs-core.pages.dev' ||
       url.hostname.endsWith('.alicelabs-core.pages.dev'));
  } catch { return false; }
}

/** Cloudflare Access must authenticate the owner; upload only AES-GCM ciphertext. */
export const OWNER_REMOTE_VAULT_ENABLED = trustedRemote(URL_CONFIG);
const ENDPOINT = URL_CONFIG + '/v1/owner/vault';

async function call(method: 'GET' | 'PUT' | 'DELETE', body?: string): Promise<Record<string, unknown>> {
  if (!OWNER_REMOTE_VAULT_ENABLED) throw new Error('Configura el servidor privado antes de sincronizar.');
  const response = await fetch(ENDPOINT, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(30000)
  });
  if (!(response.headers.get('content-type') || '').includes('application/json'))
    throw new Error('El servidor exige una sesión válida de Cloudflare Access.');
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || data.ok !== true) throw new Error(String(data.error || 'No se pudo sincronizar la bóveda.'));
  return data;
}

export async function uploadEncryptedVault(ciphertext: string): Promise<void> {
  await call('PUT', ciphertext);
}
export async function fetchEncryptedVault(): Promise<string> {
  const data = await call('GET');
  if (!data.envelope || typeof data.envelope !== 'object') throw new Error('No existe una bóveda cifrada válida.');
  return JSON.stringify(data.envelope);
}
export async function deleteEncryptedVault(): Promise<void> {
  await call('DELETE');
}
