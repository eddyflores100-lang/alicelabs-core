/**
 * Per-project, same-device IndexedDB snapshots.
 * Never store API keys, OAuth credentials or temporary pairing tokens here.
 * FileSystemHandle objects are serializable in browsers supporting this API.
 */
import type { ChatMessage, Guidance } from './agent';
import type { Workspace, OpenDocument } from './workspace';

export type ProjectSnapshot = {
  workspace: Workspace | null;
  docs: OpenDocument[];
  activePath: string | null;
  question: string;
  history: ChatMessage[];
  guidance: Guidance | null;
  expanded: string[];
  savedAt: number;
};
const DB = 'alicelabs-core-project-windows';
const STORE = 'snapshots';
const VERSION = 1;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
  });
}

export async function getProjectSnapshot(id: string): Promise<ProjectSnapshot | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const request = t.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function saveProjectSnapshot(id: string, snapshot: ProjectSnapshot): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(snapshot, id);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error || new Error('No se pudo conservar el proyecto'));
      t.onabort = () => reject(t.error || new Error('Guardado cancelado'));
    });
  } finally { db.close(); }
}
export async function deleteProjectSnapshot(id: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).delete(id);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally { db.close(); }
}
