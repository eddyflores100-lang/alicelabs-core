import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import Editor, { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import {
  Activity, ArrowRight, Bell, BellOff, Bot, Braces, Check, CheckCircle2, Cloud, Download, Upload, Smartphone,
  ChevronDown, ChevronRight, CircleDot, Code2, Copy, File, FileCode2,
  FilePlus2, Folder, FolderOpen, FolderPlus, GitBranch, Github, HardDrive,
  Keyboard, Layers3, LoaderCircle, LockKeyhole, MessageSquareText,
  PanelBottomClose, PanelBottomOpen, PanelLeftClose, PanelRightClose,
  PanelRightOpen, Play, Plus, RefreshCw, Save, Search, Settings2,
  ShieldCheck, Sparkles, SquareTerminal, WandSparkles, Wifi, X
} from 'lucide-react';
import {
  chooseLocalWorkspace, flatten, languageOf, loadPublicRepository,
  makeFile, persistDocument, readDocument, scanFolder
} from './workspace';
import type { FileNode, OpenDocument, Workspace } from './workspace';
import { discoverModels, pingWorker, requestAgent } from './agent';
import type { ChatMessage, Provider, Connection, Guidance, GuideStep } from './agent';
import { chooseRoute } from './routing';
import type { Priority } from './routing';
import ChatGPTPanel from './ChatGPTPanel';
import AIConnectionsHub from './AIConnectionsHub';
import { eraseStoredVault, exportEncryptedVault, importEncryptedVault, hasStoredVault, sealConnections, unsealConnections } from './credentialVault';
import { OWNER_REMOTE_VAULT_ENABLED, uploadEncryptedVault, fetchEncryptedVault, deleteEncryptedVault } from './ownerVaultSync';
import InstallApp from './InstallApp';
import VoiceInput from './VoiceInput';
import CloudRunnerPanel from './CloudRunnerPanel';
import { requestTaskNotificationPermission, taskFinishedNotification } from './taskNotifications';
import { getProjectSnapshot, saveProjectSnapshot } from './projectSnapshots';
import type { ProjectSnapshot } from './projectSnapshots';
import { companionHealth, getChatGPTAccounts, getChatGPTModels, startChatGPTLogin, disconnectChatGPTAccount, runChatGPT } from './chatgpt';
import type { ChatGPTAccount, ChatGPTModel } from './chatgpt';

// Load Monaco from same-origin static assets; no CDN and no 7 MB bundler worker.
loader.config({ paths: { vs: '/vs' } });
type Section = 'files' | 'search' | 'changes' | 'activity';
type Dialog = 'github' | 'new' | 'settings' | 'chatgpt' | 'providers' | 'commands' | 'bridge' | 'cloud' | 'diff' | null;
type LogEntry = { id: number; time: string; level: 'info' | 'success' | 'error'; text: string };
type TerminalResult = { id: number; command: string; output: string; exitCode: number | null };
const LOCAL_BRIDGE = 'http://127.0.0.1:39007';
const labelProvider: Record<Provider, string> = {
  openai: 'OpenAI', openrouter: 'OpenRouter', anthropic: 'Anthropic', google: 'Google Gemini', deepseek: 'DeepSeek', groq: 'Groq', mistral: 'Mistral', xai: 'xAI Grok'
};
const iconsFor = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['tsx', 'ts', 'jsx', 'js', 'json', 'html', 'css', 'py', 'rs', 'go'].includes(ext || '')) return <FileCode2 size={15} />;
  if (['md', 'txt'].includes(ext || '')) return <File size={15} />;
  return <FileCode2 size={15} />;
};
function stamp() { return new Date().toLocaleTimeString('es-EC', { hour12: false }); }
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function FileTree({ nodes, level = 0, expanded, onToggle, onOpen, current }: {
  nodes: FileNode[]; level?: number; expanded: Set<string>;
  onToggle: (path: string) => void; onOpen: (node: FileNode) => void; current: string | null
}) {
  return <div className="file-tree">
    {nodes.map(node => <div key={node.path}>
      <button
        className={'tree-row ' + (current === node.path ? 'selected' : '')}
        style={{ paddingLeft: 12 + level * 15 }}
        onClick={() => node.kind === 'directory' ? onToggle(node.path) : onOpen(node)}
        title={node.path}
      >
        {node.kind === 'directory'
          ? <>{expanded.has(node.path) ? <ChevronDown size={13} className="tree-chevron" /> : <ChevronRight size={13} className="tree-chevron" />}
            {expanded.has(node.path) ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />}</>
          : <><span className="file-gutter" />{iconsFor(node.name)}</>}
        <span className="tree-name">{node.name}</span>
      </button>
      {node.kind === 'directory' && expanded.has(node.path) && node.children &&
        <FileTree nodes={node.children} level={level + 1} expanded={expanded} onToggle={onToggle} onOpen={onOpen} current={current} />}
    </div>)}
  </div>;
}
function BrandMark({ size = 'normal' }: { size?: 'normal' | 'large' }) {
  return <div className={'brand-mark ' + (size === 'large' ? 'brand-mark-large' : '')} aria-label="AliceLabs Core">
    <div className="brand-cross cross-one" /><div className="brand-cross cross-two" /><div className="brand-pixel" />
  </div>;
}
type AppProps = {
  projectId: string;
  activeProject: boolean;
  onProjectTitle: (name: string) => void;
  onDirtyChange: (dirty: boolean) => void;
};
export default function App({ projectId, activeProject, onProjectTitle, onDirtyChange }: AppProps) {
  const [hydrated, setHydrated] = useState(false);
  const didWarnStorage = useRef(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [docs, setDocs] = useState<OpenDocument[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('files');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const [agentOpen, setAgentOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<'events' | 'terminal'>('events');
  const [dialog, setDialog] = useState<Dialog>(() => new URLSearchParams(window.location.search).get('open') === 'models' ? 'providers' : null);
  const [githubURL, setGithubURL] = useState('');
  const [newPath, setNewPath] = useState('');
  const [busyWorkspace, setBusyWorkspace] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([{ id: 1, time: stamp(), level: 'info', text: 'Core iniciado. Abre una carpeta o repositorio para comenzar.' }]);
  const [toast, setToast] = useState('');
  // All credentials remain in this tab's RAM. No localStorage or backend vault.
  const [connections, setConnections] = useState<Connection[]>([]);
  const [draftProvider, setDraftProvider] = useState<Provider>('openrouter');
  const [draftLabel, setDraftLabel] = useState('');
  const [draftKey, setDraftKey] = useState('');
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultExists, setVaultExists] = useState(hasStoredVault);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [cloudVaultBusy, setCloudVaultBusy] = useState(false);
  const [addingConnection, setAddingConnection] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>('balanced');
  const [selectedProfile, setSelectedProfile] = useState('auto');
  const [selectedModel, setSelectedModel] = useState('auto');
  const [lastRoute, setLastRoute] = useState<{ model: string; provider: Provider; profile: string; reason: string } | null>(null);
  const [authMode, setAuthMode] = useState<'chatgpt' | 'api'>('chatgpt');
  const [chatGPTPair, setChatGPTPair] = useState('');
  const [chatGPTReady, setChatGPTReady] = useState(false);
  const [chatGPTAccounts, setChatGPTAccounts] = useState<ChatGPTAccount[]>([]);
  const [chatGPTActiveId, setChatGPTActiveId] = useState('');
  const [chatGPTModels, setChatGPTModels] = useState<ChatGPTModel[]>([]);
  const [chatGPTModel, setChatGPTModel] = useState('');
  const [chatGPTBusy, setChatGPTBusy] = useState<string | null>(null);
  const [chatGPTFailure, setChatGPTFailure] = useState('');
  const [workerReady, setWorkerReady] = useState<boolean | null>(null);
  const [includeFile, setIncludeFile] = useState(false);
  const [includeProject, setIncludeProject] = useState(false);
  const [agentMode, setAgentMode] = useState<'chat' | 'edit' | 'guide'>('chat');
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [notifyOnFinish, setNotifyOnFinish] = useState(false);
  const [proposal, setProposal] = useState<{ path: string; next: string; original: string } | null>(null);
  const [agentWidth, setAgentWidth] = useState(380);
  const [bridgeToken, setBridgeToken] = useState('');
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeTools, setBridgeTools] = useState<{antigravity:boolean;gemini:boolean;claude:boolean}>({antigravity:false,gemini:false,claude:false});
  const [launchingTool, setLaunchingTool] = useState<string | null>(null);
  const [bridgeWorkspace, setBridgeWorkspace] = useState('');
  const [terminalCommand, setTerminalCommand] = useState('');
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<TerminalResult[]>([]);
  const [commandFilter, setCommandFilter] = useState('');
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const fileImportRef = useRef<HTMLInputElement | null>(null);
  const importedContents = useRef<Map<string, string>>(new Map());
  const toastTimer = useRef<number | null>(null);

  const active = useMemo(() => docs.find(doc => doc.path === activePath) || null, [docs, activePath]);
  const dirty = useMemo(() => docs.filter(doc => doc.text !== doc.savedText), [docs]);
  const allFiles = useMemo(() => workspace ? flatten(workspace.nodes).filter(n => n.kind === 'file') : [], [workspace]);
  const filteredFiles = useMemo(() => allFiles.filter(n => n.path.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 180), [allFiles, filter]);
  const routePreview = useMemo(
    () => chooseRoute(connections, priority, agentMode, question, selectedProfile, selectedModel),
    [connections, priority, agentMode, question, selectedProfile, selectedModel]
  );
  const visibleModels = useMemo(() => {
    const pool = selectedProfile === 'auto' ? connections : connections.filter(c => c.id === selectedProfile);
    return Array.from(new Set(pool.flatMap(c => c.models.map(m => m.id)))).slice(0, 180);
  }, [connections, selectedProfile]);

  const log = useCallback((text: string, level: LogEntry['level'] = 'info') => {
    setLogs(prev => [{ id: Date.now() + Math.random(), text, level, time: stamp() }, ...prev].slice(0, 250));
  }, []);
  const notify = useCallback((text: string, isError = false) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 4200);
    log(text, isError ? 'error' : 'success');
  }, [log]);

  useEffect(() => {
    void pingWorker().then(setWorkerReady);
  }, []);
  // Recover this particular project without restoring credentials or temporary pairing tokens.
  useEffect(() => {
    let cancelled = false;
    void getProjectSnapshot(projectId).then(data => {
      if (cancelled) return;
      if (data) {
        setWorkspace(data.workspace);
        setDocs(data.docs || []);
        setActivePath(data.activePath || null);
        setQuestion(data.question || '');
        setHistory(data.history || []);
        setGuidance(data.guidance || null);
        setExpanded(new Set(data.expanded || []));
        importedContents.current = new Map((data.docs || []).map(doc => [doc.path, doc.text]));
      }
    }).catch(() => {
      if (!cancelled) log('No se pudo recuperar el estado guardado de este proyecto', 'error');
    }).finally(() => { if(!cancelled)setHydrated(true); });
    return () => { cancelled = true; };
  }, [projectId, log]);
  useEffect(() => {
    if (workspace?.name) onProjectTitle(workspace.name);
  }, [workspace?.name, onProjectTitle]);
  useEffect(() => {
    onDirtyChange(dirty.length > 0);
  }, [dirty.length, onDirtyChange]);
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const snapshot: ProjectSnapshot = {
        workspace, docs: docs.slice(0, 50), activePath, question,
        history: history.slice(-100), guidance, expanded: [...expanded], savedAt: Date.now()
      };
      void saveProjectSnapshot(projectId, snapshot).catch(async () => {
        // Older or restricted browsers may not structured-clone FileSystemHandles.
        const simpleWorkspace = workspace ? {
          ...workspace, root: undefined,
          nodes: JSON.parse(JSON.stringify(workspace.nodes, (key, value) => key === 'handle' ? undefined : value))
        } : null;
        const simpleDocs = docs.map(({handle, ...doc}) => doc);
        try {
          await saveProjectSnapshot(projectId, { ...snapshot, workspace: simpleWorkspace,
            docs: simpleDocs });
        } catch {
          if (!didWarnStorage.current) {
            didWarnStorage.current = true;
            log('No se pudieron conservar los borradores. Exporta los archivos antes de cerrar.', 'error');
          }
        }
      });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [hydrated, projectId, workspace, docs, activePath, question, history, guidance, expanded, log]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    function update(ev: MediaQueryListEvent) {
      setMobile(ev.matches);
      setSidebarOpen(!ev.matches);
      setAgentOpen(!ev.matches);
      setBottomOpen(false);
    }
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  // Poll only while the ChatGPT account manager is open. Tokens stay local.
  useEffect(() => {
    if (dialog !== 'chatgpt' || !chatGPTReady || !chatGPTPair) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getChatGPTAccounts(chatGPTPair).then(snapshot => {
        if (!cancelled) { setChatGPTAccounts(snapshot.accounts); setChatGPTFailure(snapshot.lastFailure || ''); }
      }).catch(() => { if (!cancelled) setChatGPTReady(false); });
    }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [dialog, chatGPTReady, chatGPTPair]);
  useEffect(() => {
    const warn = (ev: BeforeUnloadEvent) => {
      if (dirty.length) { ev.preventDefault(); ev.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty.length]);
  useEffect(() => { terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' }); }, [terminalHistory]);

  function resetWorkspace(next: Workspace) {
    if (dirty.length && !window.confirm('Hay cambios sin guardar. ¿Cambiar de proyecto y descartarlos?')) return false;
    setWorkspace(next); setDocs([]); setActivePath(null); setExpanded(new Set(next.nodes.filter(n => n.kind === 'directory').slice(0, 7).map(n => n.path)));
    setHistory([]); setGuidance(null); setProposal(null); setSection('files'); setDialog(null);
    log('Proyecto abierto: ' + next.name + (next.kind === 'github' ? ' · GitHub lectura' : ' · Carpeta local'));
    return true;
  }
  function exportImportedDoc(doc: OpenDocument) {
    const blob = new Blob([doc.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const element = document.createElement('a');
    element.href = url;
    element.download = doc.name;
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    element.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).slice(0, 30);
    event.target.value = '';
    if (dirty.length && !window.confirm('Hay cambios sin guardar. ¿Importar otro proyecto y descartarlos?')) return;
    const nextDocs: OpenDocument[] = [];
    const nextNodes: FileNode[] = [];
    const imported = new Map<string, string>();
    for (const file of files) {
      if (file.size > 900000) { notify(file.name + ': máximo 900 KB por archivo', true); continue; }
      const text = await file.text();
      if (text.includes('\0')) { notify(file.name + ': no se admiten archivos binarios', true); continue; }
      let name = file.name;
      let i = 1;
      while (imported.has(name)) name = '(' + ++i + ') ' + file.name;
      imported.set(name, text);
      nextDocs.push({ path: name, name, text, savedText: text, language: languageOf(file.name), readOnly: false });
      nextNodes.push({ path: name, name, kind: 'file' });
    }
    if (!nextDocs.length) return;
    importedContents.current = imported;
    setWorkspace({ kind: 'local', name: 'Archivos importados', nodes: nextNodes });
    setDocs(nextDocs);
    setActivePath(nextDocs[0].path);
    setSection('files');
    setSidebarOpen(false);
    setAgentOpen(false);
    setProposal(null);
    notify(nextDocs.length + ' archivos importados. En móvil, Guardar exporta una copia a Descargas.');
  }
  async function openLocal() {
    if (mobile) { fileImportRef.current?.click(); return; }
    setBusyWorkspace(true);
    try { resetWorkspace(await chooseLocalWorkspace()); } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      notify(e instanceof Error ? e.message : 'No fue posible abrir la carpeta', true);
    } finally { setBusyWorkspace(false); }
  }
  async function openGithub(e?: FormEvent) {
    e?.preventDefault(); setBusyWorkspace(true);
    try { resetWorkspace(await loadPublicRepository(githubURL)); }
    catch (error) { notify(error instanceof Error ? error.message : 'No se pudo abrir GitHub', true); }
    finally { setBusyWorkspace(false); }
  }
  const openNode = useCallback(async (node: FileNode) => {
    if (!workspace || node.kind !== 'file') return;
    if (docs.some(d => d.path === node.path)) { setActivePath(node.path); if (mobile) setSidebarOpen(false); return; }
    try {
      const document = workspace.kind === 'local' && !workspace.root && !node.handle ?
        { path: node.path, name: node.name, text: importedContents.current.get(node.path) || '', savedText: importedContents.current.get(node.path) || '', readOnly: false, language: languageOf(node.name) } as OpenDocument :
        await readDocument(node, workspace);
      setDocs(prev => prev.some(d => d.path === document.path) ? prev : [...prev, document]);
      setActivePath(document.path);
      if (mobile) setSidebarOpen(false);
      log('Archivo abierto: ' + node.path);
    } catch (error) { notify(error instanceof Error ? error.message : 'Error al leer archivo', true); }
  }, [workspace, docs, log, notify, mobile]);
  function toggleFolder(path: string) {
    setExpanded(prev => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  }
  function updateText(path: string, next: string) {
    setDocs(prev => prev.map(d => d.path === path ? { ...d, text: next } : d));
  }
  async function saveDoc(path: string) {
    const doc = docs.find(d => d.path === path);
    if (!doc) return;
    if (doc.readOnly) return notify('Repositorio remoto en modo lectura. Abre una carpeta local para guardar.', true);
    try {
      if (!doc.handle) {
        exportImportedDoc(doc);
      } else await persistDocument(doc);
      setDocs(prev => prev.map(d => d.path === path && d.text === doc.text ? { ...d, savedText: doc.text } : d));
      notify((doc.handle ? 'Guardado: ' : 'Exportación solicitada: ') + doc.path);
    } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo guardar', true); }
  }
  async function saveAll() {
    const changes = docs.filter(d => d.text !== d.savedText && !d.readOnly);
    for (const doc of changes) {
      try { if (doc.handle) await persistDocument(doc); else exportImportedDoc(doc); setDocs(prev => prev.map(d => d.path === doc.path && d.text === doc.text ? { ...d, savedText: doc.text } : d)); }
      catch (error) { notify('Error guardando ' + doc.path + ': ' + String(error), true); return; }
    }
    if (changes.length) notify(changes.length + ' archivo(s) guardado(s)');
  }
  function closeDoc(path: string) {
    const doc = docs.find(d => d.path === path);
    if (doc && doc.text !== doc.savedText && !window.confirm('¿Cerrar ' + doc.name + ' sin guardar cambios?')) return;
    const rest = docs.filter(d => d.path !== path);
    setDocs(rest);
    if (activePath === path) setActivePath(rest[rest.length - 1]?.path || null);
  }
  async function createNew(e: FormEvent) {
    e.preventDefault();
    if (!workspace || !newPath.trim()) return;
    try {
      const node = await makeFile(workspace, newPath);
      const nodes = await scanFolder(workspace.root!);
      setWorkspace({ ...workspace, nodes });
      setExpanded(prev => new Set([...prev, ...node.path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))]));
      setDialog(null); setNewPath('');
      await openNode(node);
      notify('Archivo creado: ' + node.path);
    } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo crear el archivo', true); }
  }
  async function refreshFiles() {
    if (!workspace) return;
    if (workspace.kind === 'local' && !workspace.root) return notify('Los archivos importados solo se actualizan al volver a importarlos', true);
    try {
      const next = workspace.kind === 'local' ? { ...workspace, nodes: await scanFolder(workspace.root!) } :
        await loadPublicRepository('https://github.com/' + workspace.github!.owner + '/' + workspace.github!.repo);
      setWorkspace(next); notify('Explorador actualizado');
    } catch (error) { notify(String(error), true); }
  }
  function handleEditorMount(editor: monaco.editor.IStandaloneCodeEditor, editorAPI: typeof monaco) {
    editorRef.current = editor;
    editor.addCommand(editorAPI.KeyMod.CtrlCmd | editorAPI.KeyCode.KeyS, () => { document.dispatchEvent(new CustomEvent('core-save')); });
  }
  useEffect(() => {
    const save = () => { if (activeProject && activePath) void saveDoc(activePath); };
    document.addEventListener('core-save', save);
    return () => document.removeEventListener('core-save', save);
  });
  useEffect(() => {
    function shortcuts(e: KeyboardEvent) {
      if (!activeProject) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); if (activePath) void saveDoc(activePath);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')) {
        e.preventDefault(); setDialog('commands'); setCommandFilter('');
      }
      if (e.key === 'Escape') setDialog(null);
    }
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  });
  async function saveOwnerVault() {
    if (vaultBusy) return;
    setVaultBusy(true);
    try {
      await sealConnections(connections, vaultPassword);
      setVaultExists(true);
      notify('Bóveda API cifrada guardada en este navegador. Guarda tu contraseña: no puede recuperarse.');
      setVaultPassword('');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo guardar la bóveda.', true);
    } finally { setVaultBusy(false); }
  }
  async function unlockOwnerVault() {
    if (vaultBusy) return;
    setVaultBusy(true);
    try {
      const restored = await unsealConnections(vaultPassword);
      setConnections(current => {
        const seen = new Set(current.map(c => c.provider + ':' + c.apiKey));
        return [...current, ...restored.filter(c => !seen.has(c.provider + ':' + c.apiKey))];
      });
      setVaultPassword('');
      notify(restored.length + ' perfiles recuperados. Comprueba disponibilidad y créditos antes de usarlos.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo desbloquear la bóveda.', true);
    } finally { setVaultBusy(false); }
  }
  function clearOwnerVault() {
    if (!window.confirm('¿Eliminar la bóveda cifrada guardada en este navegador? Las conexiones activas de esta pestaña no se eliminan.')) return;
    try {
      eraseStoredVault();
      setVaultExists(false);
      setVaultPassword('');
      notify('Bóveda cifrada local eliminada.');
    } catch {
      notify('No se pudo eliminar la bóveda del navegador.', true);
    }
  }
  async function syncEncryptedVault() {
    if(cloudVaultBusy)return;
    if(!window.confirm('¿Enviar únicamente tu bóveda CIFRADA al almacenamiento privado del propietario? El servidor no recibe la contraseña.'))return;
    setCloudVaultBusy(true);
    try {await uploadEncryptedVault(exportEncryptedVault());notify('Bóveda cifrada sincronizada con tu identidad de Cloudflare Access.');}
    catch(e){notify(e instanceof Error?e.message:'No se pudo subir la bóveda cifrada.',true);}
    finally{setCloudVaultBusy(false);}
  }
  async function recoverEncryptedVault() {
    if(cloudVaultBusy)return;
    if(vaultExists && !window.confirm('¿Sustituir la copia CIFRADA de este navegador por la del servidor privado? Las conexiones activas no se modifican.'))return;
    setCloudVaultBusy(true);
    try {const envelope=await fetchEncryptedVault();importEncryptedVault(envelope);setVaultExists(true);
      notify('Bóveda cifrada recuperada. Introduce su contraseña y pulsa Desbloquear cuentas.');}
    catch(e){notify(e instanceof Error?e.message:'No se pudo recuperar la bóveda.',true);}
    finally{setCloudVaultBusy(false);}
  }
  async function removeCloudVault() {
    if(cloudVaultBusy || !window.confirm('¿Borrar la bóveda sincronizada del servidor del propietario? La copia local no se elimina.'))return;
    setCloudVaultBusy(true);
    try{await deleteEncryptedVault();notify('Copia remota cifrada eliminada.');}
    catch(e){notify(e instanceof Error?e.message:'No se pudo eliminar la copia remota.',true);}
    finally{setCloudVaultBusy(false);}
  }
  async function addConnection(e: FormEvent) {
    e.preventDefault();
    const key = draftKey.trim();
    if (!key || addingConnection) return;
    if (connections.some(c => c.apiKey === key && c.provider === draftProvider)) {
      notify('Esta clave ya está conectada. Puedes agregar otra clave del mismo proveedor.', true);
      return;
    }
    setAddingConnection(true);
    try {
      const catalog = await discoverModels(draftProvider, key);
      const label = draftLabel.trim().slice(0, 60) || labelProvider[draftProvider] + ' ' + (connections.filter(c => c.provider === draftProvider).length + 1);
      const connection: Connection = {
        id: crypto.randomUUID(), label, provider: draftProvider, apiKey: key,
        models: catalog.models, refreshedAt: catalog.refreshedAt, meta: catalog.meta
      };
      setConnections(prev => [...prev, connection]);
      setSelectedModel('auto');
      setDraftLabel('');
      setDraftKey('');
      notify('Conectada ' + label + ' · ' + catalog.models.length + ' modelos descubiertos');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo verificar la clave API', true);
    } finally {
      setAddingConnection(false);
    }
  }
  async function refreshConnection(connection: Connection) {
    setRefreshingId(connection.id);
    try {
      const catalog = await discoverModels(connection.provider, connection.apiKey);
      setConnections(prev => prev.map(c => c.id === connection.id ? { ...c, ...catalog } : c));
      notify('Catálogo actualizado: ' + connection.label + ' (' + catalog.models.length + ' modelos)');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Error al actualizar el catálogo', true);
    } finally {
      setRefreshingId(null);
    }
  }
  function removeConnection(id: string) {
    setConnections(prev => prev.filter(c => c.id !== id));
    if (selectedProfile === id) setSelectedProfile('auto');
    setSelectedModel('auto');
    notify('Conexión desconectada de esta pestaña');
  }
  function runGuideStep(action: GuideStep['action'], command?: string | null) {
    if (!action) return;
    if (action === 'open_folder') void openLocal();
    else if (action === 'open_github') setDialog('github');
    else if (action === 'search_files') { setSection('search'); setSidebarOpen(true); }
    else if (action === 'configure_ai') setDialog('settings');
    else if (action === 'open_terminal') { setBottomOpen(true); setBottomTab('terminal'); if (!bridgeConnected) setDialog('bridge'); }
    else if (action === 'save_active') { if (activePath) void saveDoc(activePath); else notify('Primero abre un archivo', true); }
    else if (action === 'run_command' && command) {
      if (mobile) return notify('La PWA del teléfono no tiene terminal remota. Abre Core en tu computadora.', true);
      setTerminalCommand(command);
      setBottomTab('terminal');
      setBottomOpen(true);
      if (!bridgeConnected) setDialog('bridge');
      notify('Comando preparado para revisión. Pulsa ejecutar y autorízalo localmente.');
    }
    else if (action === 'edit_active') {
      setAgentMode('edit');
      setQuestion('Propón una mejora concreta de este archivo sin alterar las funciones existentes.');
    }
  }
  async function pairChatGPT() {
    if (!chatGPTPair.trim()) return;
    setChatGPTBusy('pairing');
    try {
      if (!await companionHealth()) throw new Error('Inicia el componente local con node tools/chatgpt-companion/server.mjs');
      const state = await getChatGPTAccounts(chatGPTPair);
      setChatGPTAccounts(state.accounts);
      setChatGPTReady(true);
      setChatGPTFailure(state.lastFailure || '');
      setAuthMode('chatgpt');
      notify('Componente ChatGPT conectado. Puedes iniciar sesión con tu correo.');
    } catch (error) {
      setChatGPTReady(false);
      setChatGPTFailure(error instanceof Error ? error.message : 'No se pudo conectar');
    } finally { setChatGPTBusy(null); }
  }
  async function refreshChatGPT() {
    if (!chatGPTPair) return;
    setChatGPTBusy('refresh');
    try {
      const state = await getChatGPTAccounts(chatGPTPair);
      setChatGPTAccounts(state.accounts);
      setChatGPTFailure(state.lastFailure || '');
      const selected = state.accounts.find(a => a.id === chatGPTActiveId);
      if (selected && (!selected.connected || !selected.planAccess)) {
        setChatGPTActiveId(''); setChatGPTModels([]); setChatGPTModel('');
      }
    } catch (error) {
      setChatGPTFailure(error instanceof Error ? error.message : 'Error de conexión');
      setChatGPTReady(false);
    } finally { setChatGPTBusy(null); }
  }
  async function loginChatGPT(id?: string) {
    if (!chatGPTReady) return;
    // Create the popup synchronously from the click to avoid browser popup blocking.
    const popup = window.open('about:blank', '_blank');
    setChatGPTBusy('login');
    try {
      const url = await startChatGPTLogin(chatGPTPair, id);
      if (popup) popup.location.replace(url);
      else {
        setChatGPTFailure('El navegador bloqueó la ventana. Autoriza las ventanas emergentes para continuar con ChatGPT.');
        return;
      }
      setChatGPTFailure('');
      log('Autorización de cuenta iniciada en la página oficial de OpenAI');
    } catch (error) {
      popup?.close();
      setChatGPTFailure(error instanceof Error ? error.message : 'No se pudo iniciar OAuth');
    } finally { setChatGPTBusy(null); }
  }
  async function selectChatGPT(id: string) {
    setChatGPTBusy('models');
    try {
      const models = await getChatGPTModels(chatGPTPair, id);
      if (!models.length) throw new Error('Esta cuenta no publicó modelos disponibles para uso del plan');
      setChatGPTModels(models);
      setChatGPTModel(models[0].id);
      setChatGPTActiveId(id);
      setAuthMode('chatgpt');
      setChatGPTFailure('');
      notify('Cuenta ChatGPT activa · ' + models.length + ' modelos disponibles');
    } catch (error) {
      setChatGPTFailure(error instanceof Error ? error.message : 'No se pudo seleccionar la cuenta');
    } finally { setChatGPTBusy(null); }
  }
  async function disconnectChatGPT(id: string, remove: boolean) {
    setChatGPTBusy('disconnect');
    try {
      const result = await disconnectChatGPTAccount(chatGPTPair, id, remove);
      const state = await getChatGPTAccounts(chatGPTPair);
      setChatGPTAccounts(state.accounts);
      if (chatGPTActiveId === id) { setChatGPTActiveId(''); setChatGPTModels([]); setChatGPTModel(''); }
      notify((remove ? 'Registro eliminado' : 'Sesión local cerrada') + (!result.revoked ? ' · La revocación remota no se confirmó' : ' · Acceso revocado'));
    } catch (error) {
      setChatGPTFailure(error instanceof Error ? error.message : 'No se pudo desconectar la cuenta');
    } finally { setChatGPTBusy(null); }
  }
  async function enableTaskAlerts() {
    if (notifyOnFinish) {setNotifyOnFinish(false);notify('Avisos de tareas desactivados para este proyecto');return;}
    try {
      await requestTaskNotificationPermission();
      setNotifyOnFinish(true);
      notify('Avisos habilitados para tareas que finalicen mientras Core esté funcionando.');
    } catch(error) { notify(error instanceof Error ? error.message : 'No se pudieron activar las notificaciones',true); }
  }
  function completeTaskNotice(message:string) {
    if(!notifyOnFinish)return;
    void taskFinishedNotification(projectId, 'AliceLabs · '+(workspace?.name||'Proyecto'), message);
  }
  async function askAgent(e?: FormEvent) {
    e?.preventDefault();
    const prompt = question.trim();
    if (!prompt || agentBusy) return;
    const loginMode = authMode === 'chatgpt';
    const route = loginMode ? null : chooseRoute(connections, priority, agentMode, prompt, selectedProfile, selectedModel);
    const chatAccount = chatGPTAccounts.find(a => a.id === chatGPTActiveId);
    if (loginMode && (!chatGPTReady || !chatAccount?.connected || !chatAccount.planAccess || !chatGPTModel)) {
      notify('Inicia sesión con ChatGPT y elige un modelo disponible', true);
      setDialog('chatgpt');
      return;
    }
    if (!loginMode && !route) {
      notify('Conecta un proveedor de API y sus modelos', true);
      setDialog('settings');
      return;
    }
    if (agentMode === 'edit' && (!active || active.readOnly)) {
      notify('Abre un archivo local editable para proponer cambios', true);
      return;
    }
    const filepath = active?.path || '';
    const includeActive = !!active && (includeFile || agentMode === 'edit');
    const fileContext = includeActive && active ? active.text : '';
    const projectContext = includeProject && workspace
      ? 'Workspace: ' + workspace.name + '\nArchivos visibles:\n' + allFiles.slice(0, 50).map(f => f.path).join('\n')
      : '';
    const before = active?.text || '';
    const userMessage: ChatMessage = { role: 'user', content: prompt, timestamp: Date.now() };
    setHistory(prev => [...prev, userMessage]);
    setQuestion('');
    setGuidance(null);
    setAgentBusy(true);
    setLastRoute(route ? { model: route.model.id, provider: route.connection.provider, profile: route.connection.label, reason: route.reason } : null);
    const selectedLabel = loginMode ? (chatAccount?.email || 'ChatGPT') : (route?.connection.label || 'modelo');
    try {
      const result = loginMode ? await runChatGPT({
        token: chatGPTPair, id: chatGPTActiveId, model: chatGPTModel,
        action: agentMode, question: prompt, project: projectContext,
        path: includeActive ? filepath : '', code: fileContext, history
      }) : await requestAgent({
        provider: route!.connection.provider,
        model: route!.model.id,
        apiKey: route!.connection.apiKey,
        action: agentMode, question: prompt, project: projectContext,
        path: includeActive ? filepath : '', code: fileContext, history
      });
      if (agentMode === 'edit') {
        if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('El modelo no devolvió contenido válido');
        setProposal({ path: filepath, next: result.answer, original: before });
        setHistory(prev => [...prev, { role: 'assistant', content: 'Propuesta lista para ' + filepath + '. Revisa el diff antes de aplicar.', timestamp: Date.now() }]);
      } else if (agentMode === 'guide') {
        const plan = result.guide || { summary: result.answer || 'Guía sin pasos', steps: [] };
        setGuidance(plan);
        setHistory(prev => [...prev, { role: 'assistant', content: plan.summary, timestamp: Date.now() }]);
      } else {
        setHistory(prev => [...prev, { role: 'assistant', content: result.answer || '', timestamp: Date.now() }]);
      }
      log('Agente · ' + selectedLabel + ' / ' + (loginMode ? chatGPTModel : route!.model.id), 'success');
      completeTaskNotice('La respuesta del agente está lista para revisar.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Fallo de conexión';
      setHistory(prev => [...prev, { role: 'assistant', content: 'Error: ' + msg, timestamp: Date.now() }]);
      log('Agente (' + selectedLabel + '): ' + msg, 'error');
    } finally {
      setAgentBusy(false);
    }
  }
  function applyProposal() {
    if (!proposal) return;
    const target = docs.find(d => d.path === proposal.path);
    if (!target || target.readOnly || target.text !== proposal.original) {
      notify('El archivo cambió mientras se preparaba la propuesta. No se aplicó.', true); return;
    }
    updateText(proposal.path, proposal.next);
    setActivePath(proposal.path); setProposal(null);
    notify('Cambios aplicados en memoria. Pulsa Ctrl+S para guardarlos.');
  }
  function resizeAgent(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const move = (event: PointerEvent) => setAgentWidth(clamp(window.innerWidth - event.clientX, 310, 610));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  }
  async function connectBridge(e?: FormEvent) {
    e?.preventDefault();
    try {
      const response = await fetch(LOCAL_BRIDGE + '/health', { signal: AbortSignal.timeout(4000), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || data.service !== 'alicelabs-core-bridge') throw new Error('No se encontró un Core Local Bridge compatible');
      const toolsResponse = await fetch(LOCAL_BRIDGE + '/tools', { headers: {'X-Core-Token': bridgeToken.trim()}, cache:'no-store', signal:AbortSignal.timeout(6000) });
      if (!toolsResponse.ok) throw new Error('Token inválido o Bridge desactualizado');
      const toolsData = await toolsResponse.json();
      if (!toolsData.ok) throw new Error('Bridge sin autorización');
      setBridgeTools({ antigravity:toolsData.available?.antigravity===true, gemini: toolsData.available?.gemini===true, claude: toolsData.available?.claude===true });
      setBridgeWorkspace(data.workspace || 'Local');
      setBridgeConnected(true); setDialog(null); setBottomOpen(true); setBottomTab('terminal');
      notify('Terminal local conectado a ' + (data.workspace || 'la carpeta configurada'));
    } catch {
      setBridgeConnected(false); notify('Bridge no disponible. Inícialo en tu equipo y vuelve a conectar.', true);
    }
  }
  async function launchOfficialCLI(tool: 'antigravity' | 'gemini' | 'claude') {
    if (mobile) return notify('El teléfono no puede abrir terminales del equipo mediante localhost. Usa Core desde Windows.', true);
    if (!bridgeConnected || !bridgeToken.trim()) { setDialog('bridge'); return; }
    if (!bridgeTools[tool]) return notify('Primero instala el CLI oficial ' + tool + ' en tu equipo', true);
    if (launchingTool) return;
    setLaunchingTool(tool);
    try {
      const response = await fetch(LOCAL_BRIDGE + '/launch', {
        method:'POST', headers:{'Content-Type':'application/json','X-Core-Token':bridgeToken.trim()},
        body:JSON.stringify({tool}),signal:AbortSignal.timeout(120000)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo abrir el cliente');
      notify('Solicitado ' + tool + '. Revisa la nueva terminal nativa y autentícate allí con el proveedor.');
      log('CLI abierto con aprobación local: ' + tool, 'success');
    } catch(error) {
      notify(error instanceof Error ? error.message : 'Error al abrir la terminal', true);
    } finally { setLaunchingTool(null); }
  }
  async function runTerminal(e: FormEvent) {
    e.preventDefault();
    const cmd = terminalCommand.trim();
    if (!bridgeConnected || !bridgeToken.trim() || !cmd || terminalRunning) return;
    setTerminalRunning(true); setTerminalCommand('');
    try {
      const response = await fetch(LOCAL_BRIDGE + '/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Core-Token': bridgeToken.trim() },
        body: JSON.stringify({ command: cmd }), signal: AbortSignal.timeout(120000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error al ejecutar');
      setTerminalHistory(prev => [...prev, { id: Date.now(), command: cmd, output: data.output || '(sin salida)', exitCode: data.exitCode ?? null }]);
      log('Terminal: ' + cmd + ' · exit ' + String(data.exitCode), data.exitCode === 0 ? 'success' : 'error');
      completeTaskNotice('Comando terminado: '+cmd.slice(0,65)+' · exit '+String(data.exitCode));
    } catch (error) {
      setTerminalHistory(prev => [...prev, { id: Date.now(), command: cmd, output: String(error), exitCode: null }]);
      log('Error de terminal', 'error');
    } finally { setTerminalRunning(false); }
  }
  const commands = [
    { title: 'Abrir carpeta local', detail: 'Permitir acceso a archivos locales', icon: HardDrive, action: () => { setDialog(null); void openLocal(); } },
    { title: 'Abrir repositorio GitHub', detail: 'Explorar código público', icon: Github, action: () => setDialog('github') },
    { title: 'Guardar archivo', detail: 'Ctrl+S', icon: Save, action: () => { setDialog(null); if (activePath) void saveDoc(activePath); } },
    { title: 'Nuevo archivo', detail: 'Crear en el proyecto local', icon: FilePlus2, action: () => setDialog('new') },
    { title: 'Administrar cuentas y proveedores IA', detail: 'ChatGPT, Gemini, Claude, DeepSeek, OpenRouter', icon: Bot, action: () => setDialog('providers') },
    { title: 'Conectar ChatGPT con correo', detail: 'OAuth oficial, sin clave API', icon: Bot, action: () => {setAuthMode('chatgpt');setDialog('chatgpt');} },
    { title: 'Conectar modelo de IA con API', detail: 'Clave API temporal', icon: Bot, action: () => {setAuthMode('api');setDialog('settings');} },
    { title: 'Terminal local', detail: 'Conectar Core Local Bridge', icon: SquareTerminal, action: () => setDialog('bridge') },
    { title: 'Entorno remoto por proyecto', detail: 'Cloudflare Access + contenedor aislado · configuración opcional', icon: Cloud, action: () => setDialog('cloud') },
    { title: 'Mostrar cambios', detail: 'Archivos con modificaciones pendientes', icon: CircleDot, action: () => { setSection('changes'); setSidebarOpen(true); setDialog(null); } },
    ...allFiles.slice(0, 100).map(n => ({ title: n.name, detail: n.path, icon: FileCode2, action: () => { setDialog(null); void openNode(n); } }))
  ];
  const visibleCommands = commands.filter(c => (c.title + ' ' + c.detail).toLowerCase().includes(commandFilter.toLowerCase())).slice(0, 35);

  return <div className="app-shell" style={{ '--agent-width': agentWidth + 'px' } as React.CSSProperties}>
    <input aria-label="Importar archivos de texto" ref={fileImportRef} type="file" multiple accept=".txt,.md,.html,.css,.js,.jsx,.ts,.tsx,.json,.xml,.svg,.py,.go,.rs,.yml,.yaml,.toml,.sql,.sh,.java,.c,.cpp,.h,.php,.rb,.vue,.svelte" style={{ display:'none' }} onChange={importFiles}/>
    <div className="titlebar">
      <div className="title-brand"><BrandMark /><span className="brand-word">AliceLabs</span><span className="brand-core">CORE</span><span className="brand-separator" /></div>
      <button className="project-crumb" onClick={() => setDialog('commands')}><Layers3 size={14}/><span>{workspace?.name || 'Nuevo espacio de trabajo'}</span><ChevronDown size={13}/></button>
      <button className="top-search" onClick={() => setDialog('commands')}><Search size={15}/><span>Buscar archivos, proyectos o acciones</span><kbd>Ctrl K</kbd></button>
      <div className="title-actions">
        <InstallApp/>
        <button className="icon-button cloud-toggle" title="Entorno remoto de este proyecto" aria-label="Entorno remoto" onClick={() => setDialog('cloud')}><Cloud size={16}/></button>
        <span className={'api-status ' + (workerReady ? 'online' : workerReady === false ? 'offline' : '')}><span className="status-orb"/>{workerReady ? 'Worker conectado' : workerReady === false ? 'Worker desconectado' : 'Conectando...'}</span>
        <button className="icon-button hide-small" title="Centro de conexiones de IA" onClick={() => setDialog('providers')}><Settings2 size={16}/></button>
        <button className="icon-button" title={agentOpen ? 'Ocultar agente' : 'Mostrar agente'} onClick={() => setAgentOpen(v => !v)}>{agentOpen ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}</button>
      </div>
    </div>

    <div className="main-layout">
      <nav className="activity-rail" aria-label="Actividades">
        <div className="rail-group">
          {([
            ['files', 'Explorador', Layers3], ['search', 'Buscar archivos', Search],
            ['changes', 'Cambios pendientes', GitBranch], ['activity', 'Actividad', Activity]
          ] as const).map(([id, title, Icon]) =>
            <button key={id} title={title} className={'rail-button ' + (section === id && sidebarOpen ? 'rail-active' : '')} onClick={() => { setSection(id); setSidebarOpen(true); }}>
              <Icon size={20}/>{id === 'changes' && dirty.length > 0 && <span className="rail-dot"/>}
            </button>
          )}
        </div>
        <div className="rail-group rail-bottom">
          <button title="Terminal" className="rail-button" onClick={() => { setBottomOpen(true); setBottomTab('terminal'); }}><SquareTerminal size={20}/></button>
          <button title="Proveedores y cuentas" className="rail-button" onClick={() => setDialog('providers')}><Settings2 size={20}/></button>
        </div>
      </nav>

      {sidebarOpen && <aside className="explorer-pane">
        <div className="pane-caption">
          <span>{section === 'files' ? 'EXPLORADOR' : section === 'search' ? 'BÚSQUEDA' : section === 'changes' ? 'CAMBIOS' : 'ACTIVIDAD'}</span>
          <div className="pane-actions">
            {section === 'files' && <><button title="Nuevo archivo" disabled={!workspace?.root || workspace.kind !== 'local'} onClick={() => setDialog('new')}><FilePlus2 size={15}/></button>
              <button title="Actualizar árbol" disabled={!workspace || (workspace.kind==='local' && !workspace.root)} onClick={() => void refreshFiles()}><RefreshCw size={15}/></button></>}
            <button title="Ocultar panel" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={15}/></button>
          </div>
        </div>
        {section === 'files' && <div className="sidebar-body">
          {workspace ? <>
            <div className="workspace-head"><span className="workspace-head-title">{workspace.name.toUpperCase()}</span><span className="workspace-source">{workspace.kind === 'github' ? <Github size={12}/> : <HardDrive size={12}/>}</span></div>
            <FileTree nodes={workspace.nodes} expanded={expanded} onToggle={toggleFolder} onOpen={openNode} current={activePath}/>
            {workspace.nodes.length === 0 && <div className="empty-sidebar">Esta carpeta no contiene archivos visibles.</div>}
          </> : <div className="sidebar-placeholder"><FolderPlus size={26}/><strong>Sin proyecto</strong><span>Abre una carpeta local o explora un repositorio GitHub.</span><button className="thin-action" onClick={() => mobile ? fileImportRef.current?.click() : void openLocal()}>{mobile ? 'Importar código' : 'Abrir carpeta'} <ArrowRight size={13}/></button></div>}
        </div>}
        {section === 'search' && <div className="sidebar-body">
          <div className="search-field"><Search size={14}/><input placeholder="Filtrar archivos por ruta..." value={filter} onChange={e => setFilter(e.target.value)} autoFocus/></div>
          <div className="section-subtitle">{workspace ? filteredFiles.length + ' ARCHIVOS' : 'ABRE UN PROYECTO'}</div>
          {filteredFiles.map(node => <button key={node.path} className="search-hit" onClick={() => void openNode(node)}><FileCode2 size={14}/><span><strong>{node.name}</strong><small>{node.path}</small></span></button>)}
        </div>}
        {section === 'changes' && <div className="sidebar-body">
          <div className="changes-header"><span>{dirty.length} sin guardar</span><button disabled={!dirty.length} onClick={() => void saveAll()} title="Guardar todos"><Save size={15}/></button></div>
          {dirty.map(doc => <button className="change-row" key={doc.path} onClick={() => setActivePath(doc.path)}><span className="change-m">M</span><span>{doc.path}</span></button>)}
          {!dirty.length && <div className="empty-sidebar muted"><CheckCircle2 size={22}/><span>Todos los archivos abiertos están guardados.</span></div>}
          <div className="sidebar-note">Estos son cambios sin guardar del editor, no el estado Git del repositorio.</div>
        </div>}
        {section === 'activity' && <div className="sidebar-body event-sidebar">
          {logs.slice(0, 45).map(l => <div key={l.id} className={'activity-entry ' + l.level}><span>{l.time}</span><p>{l.text}</p></div>)}
        </div>}
        <div className="sidebar-footer"><button onClick={() => mobile ? fileImportRef.current?.click() : void openLocal()}><Plus size={14}/> {mobile ? 'Importar' : 'Abrir carpeta'}</button><button onClick={() => setDialog('github')}><Github size={14}/> GitHub</button></div>
      </aside>}

      <main className="editor-main">
        <div className="tabstrip">
          <div className="tabs-list">
            {docs.map(doc => <div key={doc.path} className={'editor-tab ' + (activePath === doc.path ? 'tab-active' : '')} onClick={() => setActivePath(doc.path)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setActivePath(doc.path); }}>
              <FileCode2 size={14}/><span>{doc.name}</span>{doc.text !== doc.savedText && <span className="dirty-dot" title="Cambios sin guardar"/>}
              <button className="tab-close" title="Cerrar" onClick={e => { e.stopPropagation(); closeDoc(doc.path); }}><X size={13}/></button>
            </div>)}
            {!docs.length && <div className="no-tabs"><Braces size={15}/> Editor</div>}
          </div>
          <div className="tabstrip-actions">
            <button title="Guardar archivo" onClick={() => { if (activePath) void saveDoc(activePath); }} disabled={!active || active.readOnly || active.text === active.savedText}><Save size={15}/></button>
            <button title="Ocultar o mostrar consola" onClick={() => setBottomOpen(v => !v)}>{bottomOpen ? <PanelBottomClose size={16}/> : <PanelBottomOpen size={16}/>}</button>
          </div>
        </div>
        {active && <div className="breadcrumbs"><span>{workspace?.name}</span><ChevronRight size={12}/>{active.path.split('/').map((part,i,arr) => <span className={i === arr.length-1?'breadcrumb-current':''} key={i}>{part}{i < arr.length - 1 && <ChevronRight size={12}/>}</span>)}{active.readOnly && <span className="readonly-chip"><LockKeyhole size={11}/> Solo lectura</span>}</div>}
        <div className="editor-area">
          {active ? (mobile ? <div className="mobile-code-editor">
            <div className="mobile-editor-tools"><span>{active.name} · {active.text.split('\n').length} líneas</span><button disabled={active.readOnly} onClick={() => void saveDoc(active.path)}><Download size={15}/>{active.handle ? 'Guardar' : 'Exportar'}</button></div>
            <textarea aria-label={'Editor: '+active.name} className="mobile-code-input" value={active.text} onChange={e => updateText(active.path,e.target.value)} readOnly={active.readOnly} autoCapitalize="off" autoCorrect="off" spellCheck={false} wrap="off"/>
            <div className="mobile-editor-hint">{active.readOnly ? 'GitHub remoto · solo lectura' : active.handle ? 'Guardar conserva cambios en tu carpeta autorizada' : 'Exportar descarga una copia; no modifica el archivo original'}</div>
          </div> : <Editor
            key={active.path}
            path={active.path} language={active.language} value={active.text}
            onChange={value => updateText(active.path, value || '')}
            onMount={handleEditorMount} theme="vs-dark"
            options={{ readOnly: active.readOnly, automaticLayout:true, fontSize:13.5, lineHeight:23, fontFamily:"'JetBrains Mono', 'Cascadia Code', Consolas, monospace", fontLigatures:true, minimap:{enabled:false}, scrollbar:{verticalScrollbarSize:10,horizontalScrollbarSize:10}, smoothScrolling:true, cursorSmoothCaretAnimation:'on', padding:{top:20,bottom:20}, renderWhitespace:'selection', wordWrap:'off', tabSize:2, bracketPairColorization:{enabled:true}, guides:{indentation:true,bracketPairs:true}, stickyScroll:{enabled:true} }}
          />) :
            <div className="welcome">
              <div className="welcome-center"><BrandMark size="large"/><div className="welcome-eyebrow">EL ESPACIO DE DESARROLLO DE ALICELABS</div>
                <h1>Construye con <span>claridad.</span></h1><p>Tu código, tus herramientas y tus agentes. Un espacio diseñado para trabajar, no para mostrar paneles vacíos.</p>
                <div className="welcome-actions"><button className="primary-button" disabled={busyWorkspace} onClick={() => mobile ? fileImportRef.current?.click() : void openLocal()}>{busyWorkspace ? <LoaderCircle size={16} className="spin"/> : mobile ? <Upload size={16}/> : <FolderOpen size={16}/>} {mobile ? 'Importar código' : 'Abrir carpeta local'}</button><button className="secondary-button" onClick={() => setDialog('github')}><Github size={16}/> Explorar GitHub</button><button className="secondary-button" onClick={() => setDialog('providers')}><Bot size={16}/> Conectar mis IA</button></div>
                {mobile && <div className="mobile-welcome-tip"><Smartphone size={14}/> Instala la app desde el botón superior. Importa archivos para editarlos o abre repositorios públicos.</div>}
                <div className="welcome-shortcuts"><span><kbd>Ctrl</kbd> + <kbd>K</kbd> Paleta de acciones</span><span><kbd>Ctrl</kbd> + <kbd>S</kbd> Guardar</span></div>
              </div><div className="welcome-grid"/><div className="welcome-version">CORE / PROJECT WINDOWS + VOICE v0.7</div>
            </div>}
        </div>
        {bottomOpen && <section className="bottom-panel">
          <div className="bottom-header"><button className={bottomTab==='events'?'bottom-selected':''} onClick={() => setBottomTab('events')}><Activity size={14}/> Eventos</button><button className={bottomTab==='terminal'?'bottom-selected':''} onClick={() => setBottomTab('terminal')}><SquareTerminal size={14}/> Terminal local</button><div className="bottom-fill"/><button title="Cerrar consola" onClick={() => setBottomOpen(false)}><X size={15}/></button></div>
          {bottomTab === 'events' ? <div className="event-output">{logs.map(l => <div key={l.id} className={'event-line '+l.level}><span>{l.time}</span><span className="event-level">{l.level.toUpperCase()}</span><span>{l.text}</span></div>)}</div> :
            <div className="terminal-panel">
              {!bridgeConnected ? <div className="terminal-empty"><SquareTerminal size={23}/><strong>Consola de tu equipo</strong><p>{mobile ? 'La terminal del teléfono no puede acceder al equipo remoto mediante localhost. El acceso remoto autenticado todavía no está implementado; usa el Bridge desde la computadora.' : 'La página web no ejecuta comandos directamente. Conecta Core Local Bridge, que solicita autorización en el terminal de tu equipo para cada comando.'}</p><button className="secondary-button" disabled={mobile} onClick={() => setDialog('bridge')}>Conectar Bridge <ArrowRight size={14}/></button></div> :
                <><div className="terminal-meta"><span className="connected-dot"/> LOCAL · {bridgeWorkspace}<span className="terminal-right">Comandos autorizados en el equipo</span></div><div className="terminal-scroll" ref={terminalRef}>{terminalHistory.map(t => <div className="terminal-entry" key={t.id}><div className="term-command"><span>❯</span> {t.command}</div><pre>{t.output}</pre><div className={'term-exit '+(t.exitCode===0?'pass':'fail')}>exit {t.exitCode ?? 'error'}</div></div>)}{!terminalHistory.length && <div className="terminal-hint">Escribe un comando. La ejecución necesita aprobación en la ventana del Bridge.</div>}</div><form className="terminal-input-row" onSubmit={runTerminal}><span>❯</span><input value={terminalCommand} onChange={e=>setTerminalCommand(e.target.value)} placeholder="git status" disabled={terminalRunning}/><button disabled={terminalRunning || !terminalCommand.trim() || !bridgeToken}>{terminalRunning ? <LoaderCircle size={15} className="spin"/> : <Play size={15}/>}</button></form></>}
            </div>}
        </section>}
      </main>

      {agentOpen && <><div className="resize-grip" onPointerDown={resizeAgent} title="Arrastra para cambiar el ancho"/><aside className="agent-pane">
        <div className="agent-heading"><div className="agent-identity"><div className="agent-avatar"><Sparkles size={18}/></div><div><strong>Core Agent</strong><span>ASISTENTE DE DESARROLLO</span></div></div><div className="agent-head-actions"><button className={'icon-button '+(notifyOnFinish?'alerts-active':'')} title={notifyOnFinish?'Desactivar avisos al terminar':'Activar aviso del navegador al terminar'} aria-label="Notificaciones de tareas" onClick={() => void enableTaskAlerts()}>{notifyOnFinish?<Bell size={16}/>:<BellOff size={16}/>}</button><button className="icon-button" title="Proveedores de IA" onClick={() => setDialog('providers')}><Settings2 size={16}/></button></div></div>
        <div className="agent-auth-modes"><button className={authMode==='chatgpt'?'mode-current':''} onClick={() => setAuthMode('chatgpt')}><Bot size={13}/> ChatGPT con correo</button><button className={authMode==='api'?'mode-current':''} onClick={() => setAuthMode('api')}><LockKeyhole size={13}/> API</button></div>
        <div className="agent-model-row"><div className="agent-model"><span className={authMode==='chatgpt'?(chatGPTActiveId && chatGPTReady?'connected-dot':'unconnected-dot'):(routePreview?'connected-dot':'unconnected-dot')}/><span>{authMode==='chatgpt'?(chatGPTAccounts.find(a=>a.id===chatGPTActiveId)?.email || 'ChatGPT sin conectar'):(routePreview ? routePreview.connection.label : 'Sin cuenta API')}</span><span className="agent-model-short">{authMode==='chatgpt'?(chatGPTModel || 'Iniciar sesión'):(routePreview ? routePreview.model.id : 'Conectar modelos')}</span></div><button onClick={() => setDialog(authMode==='chatgpt'?'chatgpt':'settings')} title="Rutas, modelos y cuentas"><ChevronDown size={15}/></button></div>
        <button className="route-banner" onClick={() => setDialog(authMode==='chatgpt'?'chatgpt':'settings')} title={authMode==='chatgpt'?'Cuenta seleccionada manualmente · OAuth oficial':routePreview?.reason || 'Conecta un proveedor para descubrir modelos'}>
          <Sparkles size={13}/> {authMode==='chatgpt'?(chatGPTActiveId?'ChatGPT · cuenta autorizada · sin API key':'Continuar con ChatGPT · correo, sin API key'):(routePreview?'Auto · '+priority+' · '+routePreview.considered+' modelos evaluados':'Conecta una cuenta API')} <ArrowRight size={12}/>
        </button>
        <div className="agent-thread">
          {!history.length && <div className="agent-starter"><div className="agent-star"><WandSparkles size={24}/></div><h2>Tu IA residente, a tu lado.</h2><p>{workspace ? 'Proyecto ' + workspace.name + ' preparado. Puedo guiarte, explicar el archivo abierto o proponerte una edición que revisarás.' : 'Puedo acompañarte desde abrir un proyecto hasta revisar el código, sin inventar acciones ni ejecutar comandos sin permiso.'}</p><div className="agent-suggestions"><button onClick={() => { setAgentMode('guide'); setQuestion('Guíame paso a paso para comenzar a trabajar con mi proyecto en AliceLabs Core.'); }}>Guíame en el IDE <ArrowRight size={13}/></button><button onClick={() => { setAgentMode('chat'); setQuestion('Explícame la arquitectura del archivo abierto y cómo mejorarla.'); }}>Explicar código <ArrowRight size={13}/></button><button onClick={() => { setAgentMode('edit'); setQuestion('Refactoriza este archivo para mejorar calidad y legibilidad sin cambiar su comportamiento.'); }}>Refactorizar archivo <ArrowRight size={13}/></button></div></div>}
          {history.map((m,i) => <div key={i} className={'chat-message '+m.role}><div className="chat-author">{m.role==='user'?'Tú':'CORE AGENT'}<span>{new Date(m.timestamp).toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'})}</span></div><div className="chat-text">{m.content}</div></div>)}
          {agentBusy && <div className="agent-thinking"><LoaderCircle size={15} className="spin"/> Consultando {authMode==='chatgpt'?(chatGPTAccounts.find(a=>a.id===chatGPTActiveId)?.email||'ChatGPT'):(lastRoute?.profile||'modelo')}...</div>}
          {guidance && <div className="guide-plan"><div className="guide-plan-title"><Bot size={16}/> Plan de trabajo <span>{guidance.steps.length} pasos</span></div>{guidance.steps.map((step,i) => <div className="guide-step" key={i}><div className="guide-step-number">{i+1}</div><div className="guide-step-body"><strong>{step.title}</strong><p>{step.description}</p>{step.action && <button onClick={() => runGuideStep(step.action, step.command)}>{step.action==='run_command'?'Preparar comando':'Abrir acción'} <ArrowRight size={12}/></button>}</div></div>)}</div>}
          {proposal && <div className="proposal-card"><div className="proposal-header"><CheckCircle2 size={16}/><strong>Propuesta preparada</strong></div><div className="proposal-path">{proposal.path}</div><div className="proposal-stats"><span>{proposal.original.split('\n').length} líneas actuales</span><ArrowRight size={13}/><span>{proposal.next.split('\n').length} propuestas</span></div><p>El cambio no se aplicará sin tu aprobación. Luego podrás guardarlo.</p><div className="proposal-actions"><button onClick={() => setProposal(null)} className="secondary-button">Descartar</button><button onClick={() => setDialog('diff')} className="secondary-button"><Code2 size={14}/> Revisar diff</button><button onClick={applyProposal} className="primary-button"><Check size={14}/> Aplicar al editor</button></div></div>}
        </div>
        <div className="agent-compose">
          <div className="composer-tabs"><button className={agentMode==='chat'?'mode-active':''} onClick={() => setAgentMode('chat')}><MessageSquareText size={13}/> Preguntar</button><button className={agentMode==='edit'?'mode-active':''} onClick={() => setAgentMode('edit')}><Code2 size={13}/> Editar</button><button className={agentMode==='guide'?'mode-active':''} onClick={() => setAgentMode('guide')}><Bot size={13}/> Guía</button></div>
          <form onSubmit={askAgent} className="compose-box"><textarea rows={3} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) {e.preventDefault(); void askAgent();} }} placeholder={agentMode==='edit'?'Describe el cambio que quieres aplicar...':agentMode==='guide'?'¿Qué quieres hacer? Te guiaré paso a paso.':'Pregunta sobre tu código o proyecto...'} disabled={agentBusy}/><div className="compose-bottom"><div className="context-options"><label className="file-context-toggle"><input type="checkbox" checked={agentMode==='edit' || includeFile} onChange={e=>setIncludeFile(e.target.checked)} disabled={agentMode==='edit' || !active}/><span>{agentMode==='edit' ? 'Archivo activo' : 'Archivo'}</span></label><label className="file-context-toggle"><input type="checkbox" checked={includeProject} onChange={e=>setIncludeProject(e.target.checked)} disabled={!workspace}/><span>Mapa proyecto</span></label></div><VoiceInput disabled={agentBusy} onTranscript={text=>setQuestion(prev=>(prev.trim()?prev.trim()+' ':'')+text)} onNotice={notify}/><button className="send-button" type="submit" disabled={agentBusy || !question.trim()} title="Enviar al agente">{agentBusy ? <LoaderCircle size={17} className="spin"/> : <ArrowRight size={18}/>}</button></div></form>
          <div className="agent-disclaimer"><ShieldCheck size={12}/> {authMode==='chatgpt'?'Autorización oficial · credenciales solo en el compañero local':'Claves API solo en memoria'} · Sin evasión de límites</div>
        </div>
      </aside></>}
    </div>
    <footer className="statusbar"><div className="status-left"><span className="status-highlight"><BrandMark/> Core</span><button onClick={() => setSection('activity')}><Activity size={12}/> {logs[0]?.level === 'error' ? 'Revisar evento' : 'Listo'}</button><span className="status-divider"/><span>{workspace?.kind === 'github' ? <Github size={12}/> : <HardDrive size={12}/>} {workspace?.name || 'Sin proyecto'}</span></div><div className="status-right">{active && <><span>{active.language}</span><span>{active.text.split('\n').length} líneas</span><span>{active.readOnly?'Lectura':'Editable'}</span></>}<button title="Mostrar terminal" onClick={()=>{setBottomOpen(true);setBottomTab('terminal');}}><SquareTerminal size={13}/></button><span>UTF-8</span></div></footer>
    {mobile && <nav className="mobile-tabs" aria-label="Navegación móvil">
      <button className={sidebarOpen&&section==='files'?'mobile-tab-current':''} onClick={() => {setSection('files');setSidebarOpen(true);setAgentOpen(false);}}><Folder size={19}/><span>Archivos</span></button>
      <button className={!sidebarOpen&&!agentOpen?'mobile-tab-current':''} onClick={() => {setSidebarOpen(false);setAgentOpen(false);}}><Code2 size={19}/><span>Editor</span></button>
      <button className={agentOpen?'mobile-tab-current':''} onClick={() => {setSidebarOpen(false);setAgentOpen(true);}}><Bot size={19}/><span>Agente</span></button>
      <button onClick={() => setDialog('providers')}><Search size={19}/><span>Modelos</span></button>
      <button onClick={() => {setSidebarOpen(false);setAgentOpen(false);setBottomOpen(true);setBottomTab('terminal');}}><SquareTerminal size={19}/><span>Consola</span></button>
    </nav>}
    {toast && <div className="toast" role="status"><CircleDot size={15}/>{toast}<button onClick={()=>setToast('')}><X size={14}/></button></div>}
    {dialog && <div className="modal-backdrop" onMouseDown={e => {if(e.target===e.currentTarget)setDialog(null);}}><div className={'dialog '+(dialog==='commands'?'command-dialog':dialog==='diff'?'diff-dialog':dialog==='settings'?'settings-dialog':dialog==='chatgpt'?'chatgpt-dialog':dialog==='providers'?'ai-hub-dialog':dialog==='cloud'?'cloud-dialog':'')} role="dialog" aria-modal="true">
      {dialog==='diff' && proposal ? <><div className="dialog-top"><div><span className="dialog-eyebrow">REVISIÓN DE CAMBIOS</span><h3>{proposal.path}</h3></div><button className="dialog-close" onClick={()=>setDialog(null)}><X size={18}/></button></div><div className="diff-body"><DiffEditor original={proposal.original} modified={proposal.next} language={languageOf(proposal.path)} theme="vs-dark" options={{ readOnly: true, automaticLayout:true, minimap:{enabled:false}, fontSize:12, renderSideBySide: true, scrollBeyondLastLine:false }} /></div><div className="dialog-actions diff-actions"><button className="secondary-button" onClick={()=>setDialog(null)}>Volver</button><button className="primary-button" onClick={()=>{applyProposal();setDialog(null);}}><Check size={14}/> Aplicar al editor</button></div></> : dialog==='commands' ? <><div className="command-input"><Search size={19}/><input autoFocus placeholder="Escribe una acción o un archivo..." value={commandFilter} onChange={e=>setCommandFilter(e.target.value)}/><kbd>ESC</kbd></div><div className="command-list">{visibleCommands.map((item,i)=><button key={i} onClick={item.action}><item.icon size={17}/><div><strong>{item.title}</strong><small>{item.detail}</small></div><ArrowRight size={14}/></button>)}</div><div className="command-footer"><Keyboard size={13}/> Acciones y archivos del proyecto</div></>
      : <><div className="dialog-top"><div><span className="dialog-eyebrow">ALICELABS CORE</span><h3>{dialog==='github'?'Abrir repositorio GitHub':dialog==='new'?'Nuevo archivo':dialog==='settings'?'Cuentas API y modelos':dialog==='chatgpt'?'Conectar cuentas ChatGPT':dialog==='providers'?'Proveedores y cuentas de IA':dialog==='cloud'?'Nube privada del proyecto':'Conectar terminal local'}</h3></div><button className="dialog-close" onClick={()=>setDialog(null)}><X size={18}/></button></div>
        {dialog==='github' && <form onSubmit={openGithub} className="dialog-content"><p>Explora cualquier repositorio público de GitHub, con árbol de archivos y editor en modo lectura. Para editar y guardar, abre una carpeta local.</p><label>URL del repositorio</label><div className="input-with-icon"><Github size={16}/><input autoFocus placeholder="https://github.com/usuario/repositorio" value={githubURL} onChange={e=>setGithubURL(e.target.value)}/></div><div className="dialog-actions"><button type="button" className="secondary-button" onClick={()=>setDialog(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={busyWorkspace||!githubURL.trim()}>{busyWorkspace?<LoaderCircle size={15} className="spin"/>:<ArrowRight size={15}/>} Abrir repositorio</button></div></form>}
        {dialog==='new' && <form onSubmit={createNew} className="dialog-content"><p>Crea un archivo en la carpeta local. Puedes indicar subcarpetas con /.</p><label>Nombre o ruta</label><div className="input-with-icon"><FilePlus2 size={16}/><input autoFocus placeholder="src/components/Nuevo.tsx" value={newPath} onChange={e=>setNewPath(e.target.value)}/></div><div className="dialog-actions"><button className="secondary-button" type="button" onClick={()=>setDialog(null)}>Cancelar</button><button className="primary-button" disabled={!newPath.trim()}>Crear archivo</button></div></form>}
        {dialog==='settings' && <div className="dialog-content connection-manager">
          <button className="secondary-button" onClick={() => setDialog('providers')}><Layers3 size={15}/> Volver al centro de proveedores</button>
          <button className="siwc-link" onClick={() => {setAuthMode('chatgpt');setDialog('chatgpt');}}><Bot size={17}/><span><strong>Iniciar sesión con ChatGPT</strong><small>Con correo, sin clave API · conexiones múltiples</small></span><ArrowRight size={16}/></button>
          <p>Conecta varias claves API, incluso del mismo proveedor. Cada perfil se verifica contra su API y descubre sus modelos. Las claves activas viven en esta pestaña. Opcionalmente puedes guardar una copia cifrada en este navegador mediante la bóveda del propietario; no se envía a Cloudflare.</p>
          <section className="owner-vault" aria-label="Bóveda cifrada de cuentas API">
            <div className="accounts-head"><strong>Bóveda cifrada del propietario</strong><span>{vaultExists ? 'Guardada en este dispositivo' : 'Sin configurar'}</span></div>
            <p>Protege tus perfiles API con una contraseña propia. El cifrado AES-GCM se realiza en este navegador antes de guardarlos. No sincroniza entre equipos ni incluye sesiones OAuth o CLI. Al conectar o quitar claves, vuelve a guardar la bóveda para actualizarla.</p>
            <label htmlFor="owner-vault-password">Contraseña de la bóveda (mínimo 12 caracteres)</label>
            <div className="input-with-icon"><LockKeyhole size={16}/><input id="owner-vault-password" type="password" autoComplete="off" value={vaultPassword} onChange={e=>setVaultPassword(e.target.value)} placeholder="Contraseña privada del propietario"/></div>
            <div className="dialog-actions">
              <button type="button" className="primary-button" disabled={vaultBusy || vaultPassword.length < 12} onClick={()=>void saveOwnerVault()}>{vaultBusy ? 'Procesando…' : vaultExists ? 'Actualizar bóveda cifrada' : 'Guardar bóveda cifrada'}</button>
              {vaultExists && <button type="button" className="secondary-button" disabled={vaultBusy || !vaultPassword} onClick={()=>void unlockOwnerVault()}>Desbloquear cuentas</button>}
              {vaultExists && <button type="button" className="secondary-button" disabled={vaultBusy} onClick={clearOwnerVault}>Eliminar bóveda local</button>}
            </div>
            <p>No compartas esta contraseña. Si la pierdes, deberás crear una bóveda nueva y volver a conectar tus API. En equipos compartidos, no guardes credenciales.</p>
            {OWNER_REMOTE_VAULT_ENABLED ? <div className="owner-vault-remote">
              <p><strong>Sincronización privada entre web y móvil.</strong> Solo se transfiere el archivo cifrado. Cloudflare Access identifica al propietario; necesitas la contraseña para abrirlo en otro dispositivo.</p>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" disabled={cloudVaultBusy||!vaultExists} onClick={()=>void syncEncryptedVault()}>Sincronizar bóveda cifrada</button>
                <button type="button" className="secondary-button" disabled={cloudVaultBusy} onClick={()=>void recoverEncryptedVault()}>Recuperar desde la nube</button>
                <button type="button" className="secondary-button" disabled={cloudVaultBusy} onClick={()=>void removeCloudVault()}>Borrar copia remota</button>
              </div>
            </div> : <p>La sincronización entre dispositivos requiere un servidor privado configurado y autenticación de Cloudflare Access.</p>}
          </section>
          <div className="route-controls">
            <label>Prioridad del agente<select value={priority} onChange={e => setPriority(e.target.value as Priority)}><option value="balanced">Equilibrada · recomendada</option><option value="quality">Máxima calidad aproximada</option><option value="economy">Economía y velocidad</option></select></label>
            <label>Cuenta autorizada<select value={selectedProfile} onChange={e => { setSelectedProfile(e.target.value); setSelectedModel('auto'); }}><option value="auto">Automático entre mis conexiones</option>{connections.map(c => <option key={c.id} value={c.id}>{c.label} ({labelProvider[c.provider]})</option>)}</select></label>
            <label className="route-model-control">Modelo<select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}><option value="auto">Automático · analizar disponibilidad</option>{visibleModels.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
          </div>
          {routePreview && <div className="selected-route"><Sparkles size={16}/><div><strong>{routePreview.model.id}</strong><span>{routePreview.connection.label} · {routePreview.considered} modelos evaluados</span><p>{routePreview.reason}</p></div></div>}
          <div className="accounts-head"><strong>Mis conexiones</strong><span>{connections.length} {connections.length===1?'cuenta':'cuentas'} · {connections.reduce((n,c)=>n+c.models.length,0)} entradas de modelo</span></div>
          <div className="account-list">
            {connections.map(c => <div className="account-item" key={c.id}><div className="account-identity"><span className="connected-dot"/><div><strong>{c.label}</strong><small>{labelProvider[c.provider]} · {c.models.length} modelos</small></div></div><div className="account-actions">{c.meta && c.meta.remaining !== null && <span className="quota-hint">Crédito restante: {c.meta.remaining}</span>}<button title="Actualizar catálogo" onClick={() => void refreshConnection(c)} disabled={refreshingId===c.id}>{refreshingId===c.id?<LoaderCircle size={15} className="spin"/>:<RefreshCw size={15}/>}</button><button title="Desconectar cuenta" onClick={() => removeConnection(c.id)}><X size={15}/></button></div></div>)}
            {!connections.length && <div className="accounts-empty"><LockKeyhole size={18}/> Añade una clave API para activar el selector de modelos y el asistente residente.</div>}
          </div>
          <form className="connection-form" onSubmit={addConnection}>
            <div className="accounts-head"><strong>Añadir otra conexión</strong><span>Las claves se verifican antes de añadirse</span></div>
            <label>Proveedor</label>
            <div className="provider-grid">{(Object.keys(labelProvider) as Provider[]).map(p=><button type="button" className={'provider-option '+(draftProvider===p?'provider-selected':'')} key={p} onClick={()=>setDraftProvider(p)}><span>{labelProvider[p]}</span>{draftProvider===p&&<Check size={15}/>}</button>)}</div>
            <label>Nombre de cuenta (opcional)</label>
            <input className="dialog-text-input" value={draftLabel} onChange={e=>setDraftLabel(e.target.value)} maxLength={60} autoComplete="off" placeholder="Trabajo, personal, cliente..."/>
            <label>Clave API de esta cuenta</label>
            <div className="input-with-icon"><LockKeyhole size={16}/><input type="password" value={draftKey} onChange={e=>setDraftKey(e.target.value)} autoComplete="new-password" placeholder="Pega aquí una clave autorizada"/></div>
            <button type="submit" className="primary-button add-account-button" disabled={addingConnection || !draftKey.trim()}>{addingConnection?<LoaderCircle size={15} className="spin"/>:<Plus size={15}/>} {addingConnection?'Descubriendo modelos...':'Conectar y detectar modelos'}</button>
          </form>
          <div className="info-note"><ShieldCheck size={17}/><span>Las cuentas no se cambian automáticamente ante errores 401 o 429; elige otra solo si sus reglas lo permiten. No se crean proxies, identidades falsas ni fingerprints. El agente usa los modelos disponibles en las conexiones que agregues.</span></div>
          <div className="dialog-actions"><button className="secondary-button" onClick={()=>setDialog(null)}>Cerrar</button></div>
        </div>}
        {dialog==='providers' && <AIConnectionsHub
          chatGPTCount={chatGPTAccounts.length}
          apiCounts={connections.reduce<Partial<Record<Provider, number>>>((counts, connection) => {
            counts[connection.provider] = (counts[connection.provider] || 0) + 1;
            return counts;
          }, {})}
          onChatGPT={() => {setAuthMode('chatgpt');setDialog('chatgpt');}}
          onApi={(provider) => {setDraftProvider(provider);setAuthMode('api');setDialog('settings');}}
          onClose={() => setDialog(null)}
          onNotify={notify}
          onLaunch={launchOfficialCLI}
          bridgeReady={bridgeConnected}
          bridgeTools={bridgeTools}
          launchingTool={launchingTool}
        />}
        {dialog==='chatgpt' && <ChatGPTPanel
          pairToken={chatGPTPair} setPairToken={setChatGPTPair}
          online={chatGPTReady} accounts={chatGPTAccounts} activeId={chatGPTActiveId}
          models={chatGPTModels} model={chatGPTModel} setModel={setChatGPTModel}
          failure={chatGPTFailure} busy={chatGPTBusy}
          onPair={pairChatGPT} onLogin={loginChatGPT} onSelect={selectChatGPT}
          onRefresh={refreshChatGPT} onDisconnect={disconnectChatGPT}
          onClose={() => setDialog(null)}
        />}
        {dialog==='cloud' && <CloudRunnerPanel
          projectId={projectId} workspaceName={workspace?.name||'Proyecto sin abrir'}
          activeFile={active?{path:active.path,text:active.text}:null}
          onNotice={notify} onComplete={completeTaskNotice} onClose={()=>setDialog(null)}
        />}
        {dialog==='bridge' && <form onSubmit={connectBridge} className="dialog-content"><p>Para ejecutar comandos necesitas Core Local Bridge en tu propio equipo. Abre la terminal en la carpeta del repositorio y ejecuta:</p><div className="command-snippet"><code>node tools/local-bridge/server.mjs</code><button type="button" onClick={()=>void navigator.clipboard.writeText('node tools/local-bridge/server.mjs')} title="Copiar"><Copy size={15}/></button></div><p>El Bridge mostrará un token de sesión. Cada comando solicitará autorización en esa terminal.</p><label>Token de emparejamiento local</label><div className="input-with-icon"><LockKeyhole size={16}/><input type="password" autoFocus value={bridgeToken} onChange={e=>setBridgeToken(e.target.value)} placeholder="Pega el token que aparece en tu terminal"/></div><div className="dialog-actions"><button type="button" className="secondary-button" onClick={()=>setDialog(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={!bridgeToken.trim()}><Wifi size={15}/> Conectar</button></div></form>}
        </>}
    </div></div>}
  </div>;
}
