import {repoPath} from './githubWorkspace';
import {repoIdentity,inspectGithubRepo,githubTree,githubFileRead} from './githubWorkspace';
export type SourceKind = 'local' | 'github';
export type FileNode = { path: string; name: string; kind: 'file' | 'directory'; children?: FileNode[]; handle?: FileSystemFileHandle };
export type Workspace = {
  kind: SourceKind;
  name: string;
  nodes: FileNode[];
  root?: FileSystemDirectoryHandle;
  github?: { owner: string; repo: string; branch: string; writable?:boolean; private?:boolean };
};
export type OpenDocument = { path: string; name: string; text: string; savedText: string; language: string; readOnly: boolean; sha?:string; handle?: FileSystemFileHandle };
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
export async function loadPublicRepository(raw:string):Promise<Workspace>{
  return loadGithubRepository(raw,'');
}
export async function loadGithubRepository(raw:string,token:string):Promise<Workspace>{
  const {owner,repo}=repoIdentity(raw);
  const info=await inspectGithubRepo(raw,token);
  const items=await githubTree(info,token);
  const nodes:FileNode[]=[];
  items.filter(x=>x.type==='blob'&&!x.path.split('/').some(part=>ignored.has(part))).slice(0,3000).forEach(x=>addPath(nodes,x.path));
  return {kind:'github',name:owner+'/'+repo,github:{owner,repo,branch:info.branch,
    private:info.private,writable:Boolean(token)&&(info.permissions?.push!==false)},nodes:sortNodes(nodes)};
}
export async function readDocument(node: FileNode,workspace:Workspace,token=''):Promise<OpenDocument>{
  if(node.kind!=='file')throw new Error('Selecciona un archivo');
  let text='',sha:string|undefined;
  if(workspace.kind==='local'&&node.handle){
    const file=await node.handle.getFile();
    if(file.size>900000)throw new Error('El editor limita archivos a 900 KB');
    text=await file.text();
  }else if(workspace.github){
    const doc=await githubFileRead({...workspace.github,private:workspace.github.private===true},node.path,token);
    text=doc.text;sha=doc.sha;
  }
  if(text.includes('\0'))throw new Error('El archivo es binario');
  return {path:node.path,name:node.name,text,savedText:text,language:languageOf(node.name),
    readOnly:workspace.kind==='github'&&(!token||!workspace.github?.writable),sha,handle:node.handle};
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

export function stageGithubFile(workspace:Workspace,rawPath:string):{workspace:Workspace;node:FileNode}{
  if(workspace.kind!=='github'||!workspace.github?.writable)throw new Error('Conecta GitHub con permiso de escritura.');
  repoPath(rawPath);
  if(flatten(workspace.nodes).some(x=>x.path===rawPath))throw new Error('El archivo ya existe en el repositorio abierto.');
  const nodes=structuredClone(workspace.nodes) as FileNode[];
  addPath(nodes,rawPath);
  const node=flatten(nodes).find(x=>x.path===rawPath);
  if(!node)throw new Error('No se pudo preparar el archivo');
  return {workspace:{...workspace,nodes:sortNodes(nodes)},node};
}

export function unstageGithubFile(workspace:Workspace,path:string):Workspace {
  if(workspace.kind!=='github')return workspace;
  function prune(nodes:FileNode[]):FileNode[]{
    return nodes.filter(n=>n.path!==path).map(n=>n.kind==='directory'?{...n,children:prune(n.children||[])}:n)
      .filter(n=>n.kind==='file'||Boolean(n.children?.length));
  }
  return {...workspace,nodes:prune(workspace.nodes)};
}
