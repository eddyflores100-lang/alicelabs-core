export type SourceKind = 'local' | 'github';
export type FileNode = { path: string; name: string; kind: 'file' | 'directory'; children?: FileNode[]; handle?: FileSystemFileHandle };
export type Workspace = {
  kind: SourceKind;
  name: string;
  nodes: FileNode[];
  root?: FileSystemDirectoryHandle;
  github?: { owner: string; repo: string; branch: string };
};
export type OpenDocument = { path: string; name: string; text: string; savedText: string; language: string; readOnly: boolean; handle?: FileSystemFileHandle };
type Budget = { count: number };
const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.vercel', '.turbo', 'target', '.cache', 'coverage']);

export function languageOf(name: string) {
  const suffix = name.split('.').pop()?.toLowerCase() || '';
  const mapping: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    mjs: 'javascript', cjs: 'javascript', json: 'json', jsonc: 'json',
    html: 'html', htm: 'html', css: 'css', scss: 'scss',
    md: 'markdown', mdx: 'markdown', py: 'python', rs: 'rust',
    go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'cpp',
    cs: 'csharp', php: 'php', rb: 'ruby', sh: 'shell',
    ps1: 'powershell', yml: 'yaml', yaml: 'yaml', sql: 'sql',
    xml: 'xml', svg: 'xml', toml: 'ini', env: 'ini',
  };
  return mapping[suffix] || 'plaintext';
}
export function flatten(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap(n => [n, ...flatten(n.children || [])]);
}
function sortNodes(nodes: FileNode[]) {
  nodes.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
  nodes.forEach(n => { if (n.children) sortNodes(n.children); });
  return nodes;
}
export async function scanFolder(folder: FileSystemDirectoryHandle, prefix = '', depth = 0, budget: Budget = { count: 0 }): Promise<FileNode[]> {
  if (depth >= 9 || budget.count >= 2200) return [];
  const nodes: FileNode[] = [];
  for await (const entry of (folder as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (budget.count++ >= 2200) break;
    if (ignored.has(entry.name)) continue;
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.kind === 'directory') {
      const dir = entry as FileSystemDirectoryHandle;
      nodes.push({ path, name: entry.name, kind: 'directory', children: await scanFolder(dir, path, depth + 1, budget) });
    } else {
      nodes.push({ path, name: entry.name, kind: 'file', handle: entry as FileSystemFileHandle });
    }
  }
  return sortNodes(nodes);
}
export async function chooseLocalWorkspace(): Promise<Workspace> {
  const browser = window as Window & { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle> };
  if (!browser.showDirectoryPicker) throw new Error('Abre AliceLabs Core en Chrome o Edge actualizado para usar carpetas locales.');
  const root = await browser.showDirectoryPicker({ mode: 'readwrite' });
  return { kind: 'local', name: root.name, root, nodes: await scanFolder(root) };
}
function parseRepo(raw: string) {
  let text = raw.trim().replace(/\.git$/, '');
  if (!text) throw new Error('Introduce la URL de un repositorio público');
  if (text.startsWith('https://github.com/')) text = text.replace('https://github.com/', '');
  if (text.startsWith('http')) throw new Error('Introduce una URL de GitHub válida');
  const match = text.match(/^([\w.-]+)\/([\w.-]+)(?:\/.*)?$/);
  if (!match) throw new Error('Formato: https://github.com/usuario/repositorio');
  return { owner: match[1], repo: match[2] };
}
function addPath(root: FileNode[], path: string) {
  const segments = path.split('/');
  let list = root, soFar = '';
  segments.forEach((name, i) => {
    soFar = soFar ? soFar + '/' + name : name;
    const last = i === segments.length - 1;
    let node = list.find(n => n.name === name);
    if (!node) {
      node = { name, path: soFar, kind: last ? 'file' : 'directory', ...(!last ? { children: [] } : {}) };
      list.push(node);
    }
    if (!last) {
      if (!node.children) node.children = [];
      list = node.children;
    }
  });
}
async function githubJSON(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(response.status === 404 ? 'Repositorio público no encontrado o inaccesible' : 'GitHub devolvió el error ' + response.status);
  return response.json();
}
export async function loadPublicRepository(raw: string): Promise<Workspace> {
  const { owner, repo } = parseRepo(raw);
  const base = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
  const info = await githubJSON(base);
  if (info.private) throw new Error('Esta conexión admite repositorios públicos. Para repositorios privados se necesita OAuth.');
  const branch: string = info.default_branch;
  const tree = await githubJSON(base + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1');
  if (tree.truncated) throw new Error('El árbol excede el límite de GitHub; abre este repositorio como carpeta local.');
  const nodes: FileNode[] = [];
  (tree.tree as Array<{ type: string; path: string }>).filter(item => item.type === 'blob' && !item.path.split('/').some(x => ignored.has(x))).slice(0, 3000).forEach(item => addPath(nodes, item.path));
  return { kind: 'github', name: owner + '/' + repo, github: { owner, repo, branch }, nodes: sortNodes(nodes) };
}
export async function readDocument(node: FileNode, workspace: Workspace): Promise<OpenDocument> {
  if (node.kind !== 'file') throw new Error('Selecciona un archivo');
  let text = '';
  if (workspace.kind === 'local' && node.handle) {
    const file = await node.handle.getFile();
    if (file.size > 900000) throw new Error('El editor limita archivos a 900 KB para evitar bloqueos');
    text = await file.text();
  } else if (workspace.github) {
    const { owner, repo, branch } = workspace.github;
    const path = node.path.split('/').map(encodeURIComponent).join('/');
    const data = await githubJSON('https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents/' + path + '?ref=' + encodeURIComponent(branch));
    if (data.encoding !== 'base64') throw new Error('Archivo no compatible con vista de texto');
    const bytes = Uint8Array.from(atob(String(data.content).replace(/\s/g, '')), c => c.charCodeAt(0));
    text = new TextDecoder().decode(bytes);
  }
  if (text.includes('\0')) throw new Error('El archivo parece binario y no puede abrirse como texto');
  return { path: node.path, name: node.name, text, savedText: text, language: languageOf(node.name), readOnly: workspace.kind !== 'local', handle: node.handle };
}
export async function persistDocument(doc: OpenDocument) {
  if (!doc.handle || doc.readOnly) throw new Error('Solo puedes guardar archivos de carpetas locales autorizadas');
  const stream = await doc.handle.createWritable();
  try { await stream.write(doc.text); await stream.close(); }
  catch (error) { await stream.abort(); throw error; }
}
export async function makeFile(workspace: Workspace, rawPath: string) {
  if (!workspace.root || workspace.kind !== 'local') throw new Error('Primero abre una carpeta local');
  const parts = rawPath.trim().replace(/\\/g, '/').split('/');
  if (!parts.length || parts.some(n => !n || n === '.' || n === '..') || parts.some(n => n.includes('\0'))) throw new Error('Ruta de archivo inválida');
  let dir = workspace.root;
  for (const segment of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(segment, { create: true });
  const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  return { path: parts.join('/'), name: parts[parts.length - 1], kind: 'file' as const, handle };
}
