import type { Connection, Provider } from './agent';

const STORAGE_KEY = 'alicelabs-core:owner-api-vault:v1';
const ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const allowedProviders: Provider[] = ['openai', 'openrouter', 'anthropic', 'google', 'deepseek', 'groq', 'mistral', 'xai'];

type VaultEnvelope = {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

function encode(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
}
function decode(input: string): Uint8Array {
  return Uint8Array.from(atob(input), char => char.charCodeAt(0));
}
async function keyFor(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export function hasStoredVault(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) !== null; }
  catch { return false; }
}

export async function sealConnections(connections: Connection[], password: string): Promise<void> {
  if (password.length < 12) throw new Error('La contraseña de la bóveda debe tener al menos 12 caracteres.');
  if (!crypto?.subtle) throw new Error('El navegador no permite cifrado seguro en este contexto.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, ITERATIONS);
  const plaintext = encoder.encode(JSON.stringify(connections));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const envelope: VaultEnvelope = {
    version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
    salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted))
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

export async function unsealConnections(password: string): Promise<Connection[]> {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) throw new Error('No hay una bóveda guardada en este navegador.');
  let envelope: VaultEnvelope;
  try { envelope = JSON.parse(stored) as VaultEnvelope; }
  catch { throw new Error('El formato de la bóveda no es válido.'); }
  if (envelope.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256' ||
      !Number.isInteger(envelope.iterations) || envelope.iterations < 310_000 ||
      envelope.iterations > 1_000_000 ||
      typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string' ||
      typeof envelope.ciphertext !== 'string') {
    throw new Error('Formato o parámetros de cifrado de bóveda no admitidos.');
  }
  try {
    const salt = decode(envelope.salt);
    const iv = decode(envelope.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid parameters');
    const key = await keyFor(password, salt, envelope.iterations);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, decode(envelope.ciphertext) as BufferSource);
    const parsed: unknown = JSON.parse(decoder.decode(decrypted));
    if (!Array.isArray(parsed) || parsed.length > 100 ||
        !parsed.every((c: unknown) => {
          if (!c || typeof c !== 'object') return false;
          const p = c as Record<string, unknown>;
          return typeof p.id === 'string' && typeof p.label === 'string' &&
            allowedProviders.includes(p.provider as Provider) && typeof p.apiKey === 'string' &&
            p.apiKey.length > 0 && p.apiKey.length < 10_000 &&
            Array.isArray(p.models) && typeof p.refreshedAt === 'number';
        })) throw new Error('Invalid vault data');
    return parsed as Connection[];
  } catch {
    throw new Error('No se pudo desbloquear la bóveda: contraseña incorrecta o datos dañados.');
  }
}

export function eraseStoredVault(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

/** Export only encrypted envelope bytes for owner-authenticated remote sync. */
export function exportEncryptedVault(): string {
  const value=window.localStorage.getItem(STORAGE_KEY);
  if(!value)throw new Error('Primero guarda una bóveda cifrada en este navegador.');
  validateEncryptedEnvelope(value);
  return value;
}
export function importEncryptedVault(value: string): void {
  validateEncryptedEnvelope(value);
  window.localStorage.setItem(STORAGE_KEY,value);
}
function validateEncryptedEnvelope(value: string): void {
  if(value.length>1100000)throw new Error('Bóveda cifrada demasiado grande.');
  let e: unknown;
  try { e=JSON.parse(value); } catch {throw new Error('Formato de bóveda cifrada no válido.');}
  if(!e||typeof e!=='object'||Array.isArray(e))throw new Error('Bóveda no válida.');
  const p=e as Record<string,unknown>;
  if(p.version!==1||p.kdf!=='PBKDF2-SHA256'||!Number.isInteger(p.iterations)||
     (p.iterations as number)<310000||(p.iterations as number)>1000000||
     typeof p.salt!=='string'||typeof p.iv!=='string'||typeof p.ciphertext!=='string'||
     !/^[A-Za-z0-9+/=]+$/.test(p.salt)|| !/^[A-Za-z0-9+/=]+$/.test(p.iv)||
     !/^[A-Za-z0-9+/=]+$/.test(p.ciphertext)||p.ciphertext.length<20)
    throw new Error('Bóveda cifrada no válida.');
}
