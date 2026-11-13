import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import Editor, { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import {
  Activity, ArrowRight, Bot, Braces, Check, CheckCircle2,
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
import { DEFAULT_MODEL, pingWorker, requestAgent } from './agent';
import type { ChatMessage, Provider } from './agent';

// Load Monaco from same-origin static assets; no CDN and no 7 MB bundler worker.
loader.config({ paths: { vs: '/vs' } });
type Section = 'files' | 'search' | 'changes' | 'activity';
type Dialog = 'github' | 'new' | 'settings' | 'commands' | 'bridge' | 'diff' | null;
type LogEntry = { id: number; time: string; level: 'info' | 'success' | 'error'; text: string };
type TerminalResult = { id: number; command: string; output: string; exitCode: number | null };
const LOCAL_BRIDGE = 'http://127.0.0.1:39007';
const labelProvider: Record<Provider, string> = {
  openai: 'OpenAI', openrouter: 'OpenRouter', anthropic: 'Anthropic', google: 'Google Gemini'
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
export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [docs, setDocs] = useState<OpenDocument[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('files');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [agentOpen, setAgentOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<'events' | 'terminal'>('events');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [githubURL, setGithubURL] = useState('');
  const [newPath, setNewPath] = useState('');
  const [busyWorkspace, setBusyWorkspace] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([{ id: 1, time: stamp(), level: 'info', text: 'Core iniciado. Abre una carpeta o repositorio para comenzar.' }]);
  const [toast, setToast] = useState('');
  const [provider, setProvider] = useState<Provider>('openrouter');
  const [model, setModel] = useState(DEFAULT_MODEL.openrouter);
  const [apiKey, setApiKey] = useState('');
  const [workerReady, setWorkerReady] = useState<boolean | null>(null);
  const [includeFile, setIncludeFile] = useState(false);
  const [agentMode, setAgentMode] = useState<'chat' | 'edit'>('chat');
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [proposal, setProposal] = useState<{ path: string; next: string; original: string } | null>(null);
  const [agentWidth, setAgentWidth] = useState(380);
  const [bridgeToken, setBridgeToken] = useState('');
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeWorkspace, setBridgeWorkspace] = useState('');
  const [terminalCommand, setTerminalCommand] = useState('');
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<TerminalResult[]>([]);
  const [commandFilter, setCommandFilter] = useState('');
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<number | null>(null);

  const active = useMemo(() => docs.find(doc => doc.path === activePath) || null, [docs, activePath]);
  const dirty = useMemo(() => docs.filter(doc => doc.text !== doc.savedText), [docs]);
  const allFiles = useMemo(() => workspace ? flatten(workspace.nodes).filter(n => n.kind === 'file') : [], [workspace]);
  const filteredFiles = useMemo(() => allFiles.filter(n => n.path.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 180), [allFiles, filter]);

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
    setHistory([]); setProposal(null); setSection('files'); setDialog(null);
    log('Proyecto abierto: ' + next.name + (next.kind === 'github' ? ' · GitHub lectura' : ' · Carpeta local'));
    return true;
  }
  async function openLocal() {
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
    if (docs.some(d => d.path === node.path)) { setActivePath(node.path); return; }
    try {
      const document = await readDocument(node, workspace);
      setDocs(prev => prev.some(d => d.path === document.path) ? prev : [...prev, document]);
      setActivePath(document.path);
      log('Archivo abierto: ' + node.path);
    } catch (error) { notify(error instanceof Error ? error.message : 'Error al leer archivo', true); }
  }, [workspace, docs, log, notify]);
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
      await persistDocument(doc);
      setDocs(prev => prev.map(d => d.path === path && d.text === doc.text ? { ...d, savedText: doc.text } : d));
      notify('Guardado: ' + doc.path);
    } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo guardar', true); }
  }
  async function saveAll() {
    const changes = docs.filter(d => d.text !== d.savedText && !d.readOnly);
    for (const doc of changes) {
      try { await persistDocument(doc); setDocs(prev => prev.map(d => d.path === doc.path && d.text === doc.text ? { ...d, savedText: doc.text } : d)); }
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
    const save = () => { if (activePath) void saveDoc(activePath); };
    document.addEventListener('core-save', save);
    return () => document.removeEventListener('core-save', save);
  });
  useEffect(() => {
    function shortcuts(e: KeyboardEvent) {
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
  function changeProvider(next: Provider) { setProvider(next); setModel(DEFAULT_MODEL[next]); setApiKey(''); }
  async function askAgent(e?: FormEvent) {
    e?.preventDefault();
    const prompt = question.trim();
    if (!prompt || agentBusy) return;
    if (!apiKey.trim()) { notify('Configura tu proveedor y clave de IA en Conexiones', true); setDialog('settings'); return; }
    if (agentMode === 'edit' && (!active || active.readOnly)) {
      notify('Abre un archivo local editable para proponer cambios', true); return;
    }
    const path = active?.path || '';
    const includeActive = !!active && (includeFile || agentMode === 'edit');
    const fileContext = includeActive && active ? active.text : '';
    const before = active?.text || '';
    const userMessage: ChatMessage = { role: 'user', content: prompt, timestamp: Date.now() };
    setHistory(prev => [...prev, userMessage]);
    setQuestion(''); setAgentBusy(true);
    try {
      const r = await requestAgent({ provider, model, apiKey, action: agentMode,
        question: prompt, path: includeActive ? path : '', code: fileContext, history });
      if (agentMode === 'edit') {
        if (typeof r.answer !== 'string' || !r.answer.trim()) throw new Error('El modelo no devolvió un archivo válido');
        setProposal({ path, next: r.answer, original: before });
        setHistory(prev => [...prev, { role: 'assistant', content: 'Propuesta de edición lista para ' + path + '. Revísala antes de aplicarla.', timestamp: Date.now() }]);
      } else {
        setHistory(prev => [...prev, { role: 'assistant', content: r.answer || '', timestamp: Date.now() }]);
      }
      log('Agente respondió · ' + labelProvider[provider] + ' · ' + (r.durationMs || 0) + ' ms', 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Fallo de conexión';
      setHistory(prev => [...prev, { role: 'assistant', content: 'Error: ' + msg, timestamp: Date.now() }]);
      log('Agente: ' + msg, 'error');
    } finally { setAgentBusy(false); }
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
      setBridgeWorkspace(data.workspace || 'Local');
      setBridgeConnected(true); setDialog(null); setBottomOpen(true); setBottomTab('terminal');
      notify('Terminal local conectado a ' + (data.workspace || 'la carpeta configurada'));
    } catch {
      setBridgeConnected(false); notify('Bridge no disponible. Inícialo en tu equipo y vuelve a conectar.', true);
    }
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
    { title: 'Conectar modelo de IA', detail: 'Clave de API temporal', icon: Bot, action: () => setDialog('settings') },
    { title: 'Terminal local', detail: 'Conectar Core Local Bridge', icon: SquareTerminal, action: () => setDialog('bridge') },
    { title: 'Mostrar cambios', detail: 'Archivos con modificaciones pendientes', icon: CircleDot, action: () => { setSection('changes'); setSidebarOpen(true); setDialog(null); } },
    ...allFiles.slice(0, 100).map(n => ({ title: n.name, detail: n.path, icon: FileCode2, action: () => { setDialog(null); void openNode(n); } }))
  ];
  const visibleCommands = commands.filter(c => (c.title + ' ' + c.detail).toLowerCase().includes(commandFilter.toLowerCase())).slice(0, 35);

  return <div className="app-shell" style={{ '--agent-width': agentWidth + 'px' } as React.CSSProperties}>
    <div className="titlebar">
      <div className="title-brand"><BrandMark /><span className="brand-word">AliceLabs</span><span className="brand-core">CORE</span><span className="brand-separator" /></div>
      <button className="project-crumb" onClick={() => setDialog('commands')}><Layers3 size={14}/><span>{workspace?.name || 'Nuevo espacio de trabajo'}</span><ChevronDown size={13}/></button>
      <button className="top-search" onClick={() => setDialog('commands')}><Search size={15}/><span>Buscar archivos, proyectos o acciones</span><kbd>Ctrl K</kbd></button>
      <div className="title-actions">
        <span className={'api-status ' + (workerReady ? 'online' : workerReady === false ? 'offline' : '')}><span className="status-orb"/>{workerReady ? 'Worker conectado' : workerReady === false ? 'Worker desconectado' : 'Conectando...'}</span>
        <button className="icon-button hide-small" title="Conexiones de modelos" onClick={() => setDialog('settings')}><Settings2 size={16}/></button>
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
          <button title="Conexiones" className="rail-button" onClick={() => setDialog('settings')}><Settings2 size={20}/></button>
        </div>
      </nav>

      {sidebarOpen && <aside className="explorer-pane">
        <div className="pane-caption">
          <span>{section === 'files' ? 'EXPLORADOR' : section === 'search' ? 'BÚSQUEDA' : section === 'changes' ? 'CAMBIOS' : 'ACTIVIDAD'}</span>
          <div className="pane-actions">
            {section === 'files' && <><button title="Nuevo archivo" disabled={!workspace || workspace.kind !== 'local'} onClick={() => setDialog('new')}><FilePlus2 size={15}/></button>
              <button title="Actualizar árbol" disabled={!workspace} onClick={() => void refreshFiles()}><RefreshCw size={15}/></button></>}
            <button title="Ocultar panel" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={15}/></button>
          </div>
        </div>
        {section === 'files' && <div className="sidebar-body">
          {workspace ? <>
            <div className="workspace-head"><span className="workspace-head-title">{workspace.name.toUpperCase()}</span><span className="workspace-source">{workspace.kind === 'github' ? <Github size={12}/> : <HardDrive size={12}/>}</span></div>
            <FileTree nodes={workspace.nodes} expanded={expanded} onToggle={toggleFolder} onOpen={openNode} current={activePath}/>
            {workspace.nodes.length === 0 && <div className="empty-sidebar">Esta carpeta no contiene archivos visibles.</div>}
          </> : <div className="sidebar-placeholder"><FolderPlus size={26}/><strong>Sin proyecto</strong><span>Abre una carpeta local o explora un repositorio GitHub.</span><button className="thin-action" onClick={() => void openLocal()}>Abrir carpeta <ArrowRight size={13}/></button></div>}
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
        <div className="sidebar-footer"><button onClick={() => void openLocal()}><Plus size={14}/> Abrir carpeta</button><button onClick={() => setDialog('github')}><Github size={14}/> GitHub</button></div>
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
          {active ? <Editor
            key={active.path}
            path={active.path} language={active.language} value={active.text}
            onChange={value => updateText(active.path, value || '')}
            onMount={handleEditorMount} theme="vs-dark"
            options={{ readOnly: active.readOnly, automaticLayout:true, fontSize:13.5, lineHeight:23, fontFamily:"'JetBrains Mono', 'Cascadia Code', Consolas, monospace", fontLigatures:true, minimap:{enabled:false}, scrollbar:{verticalScrollbarSize:10,horizontalScrollbarSize:10}, smoothScrolling:true, cursorSmoothCaretAnimation:'on', padding:{top:20,bottom:20}, renderWhitespace:'selection', wordWrap:'off', tabSize:2, bracketPairColorization:{enabled:true}, guides:{indentation:true,bracketPairs:true}, stickyScroll:{enabled:true} }}
          /> :
            <div className="welcome">
              <div className="welcome-center"><BrandMark size="large"/><div className="welcome-eyebrow">EL ESPACIO DE DESARROLLO DE ALICELABS</div>
                <h1>Construye con <span>claridad.</span></h1><p>Tu código, tus herramientas y tus agentes. Un espacio diseñado para trabajar, no para mostrar paneles vacíos.</p>
                <div className="welcome-actions"><button className="primary-button" disabled={busyWorkspace} onClick={() => void openLocal()}>{busyWorkspace ? <LoaderCircle size={16} className="spin"/> : <FolderOpen size={16}/>} Abrir carpeta local</button><button className="secondary-button" onClick={() => setDialog('github')}><Github size={16}/> Explorar GitHub</button></div>
                <div className="welcome-shortcuts"><span><kbd>Ctrl</kbd> + <kbd>K</kbd> Paleta de acciones</span><span><kbd>Ctrl</kbd> + <kbd>S</kbd> Guardar</span></div>
              </div><div className="welcome-grid"/><div className="welcome-version">CORE / WEB WORKSPACE</div>
            </div>}
        </div>
        {bottomOpen && <section className="bottom-panel">
          <div className="bottom-header"><button className={bottomTab==='events'?'bottom-selected':''} onClick={() => setBottomTab('events')}><Activity size={14}/> Eventos</button><button className={bottomTab==='terminal'?'bottom-selected':''} onClick={() => setBottomTab('terminal')}><SquareTerminal size={14}/> Terminal local</button><div className="bottom-fill"/><button title="Cerrar consola" onClick={() => setBottomOpen(false)}><X size={15}/></button></div>
          {bottomTab === 'events' ? <div className="event-output">{logs.map(l => <div key={l.id} className={'event-line '+l.level}><span>{l.time}</span><span className="event-level">{l.level.toUpperCase()}</span><span>{l.text}</span></div>)}</div> :
            <div className="terminal-panel">
              {!bridgeConnected ? <div className="terminal-empty"><SquareTerminal size={23}/><strong>Consola de tu equipo</strong><p>La página web no ejecuta comandos directamente. Conecta Core Local Bridge, que solicita autorización en el terminal de tu equipo para cada comando.</p><button className="secondary-button" onClick={() => setDialog('bridge')}>Conectar Bridge <ArrowRight size={14}/></button></div> :
                <><div className="terminal-meta"><span className="connected-dot"/> LOCAL · {bridgeWorkspace}<span className="terminal-right">Comandos autorizados en el equipo</span></div><div className="terminal-scroll" ref={terminalRef}>{terminalHistory.map(t => <div className="terminal-entry" key={t.id}><div className="term-command"><span>❯</span> {t.command}</div><pre>{t.output}</pre><div className={'term-exit '+(t.exitCode===0?'pass':'fail')}>exit {t.exitCode ?? 'error'}</div></div>)}{!terminalHistory.length && <div className="terminal-hint">Escribe un comando. La ejecución necesita aprobación en la ventana del Bridge.</div>}</div><form className="terminal-input-row" onSubmit={runTerminal}><span>❯</span><input value={terminalCommand} onChange={e=>setTerminalCommand(e.target.value)} placeholder="git status" disabled={terminalRunning}/><button disabled={terminalRunning || !terminalCommand.trim() || !bridgeToken}>{terminalRunning ? <LoaderCircle size={15} className="spin"/> : <Play size={15}/>}</button></form></>}
            </div>}
        </section>}
      </main>

      {agentOpen && <><div className="resize-grip" onPointerDown={resizeAgent} title="Arrastra para cambiar el ancho"/><aside className="agent-pane">
        <div className="agent-heading"><div className="agent-identity"><div className="agent-avatar"><Sparkles size={18}/></div><div><strong>Core Agent</strong><span>ASISTENTE DE DESARROLLO</span></div></div><button className="icon-button" title="Ajustes de IA" onClick={() => setDialog('settings')}><Settings2 size={16}/></button></div>
        <div className="agent-model-row"><div className="agent-model"><span className={apiKey ? 'connected-dot':'unconnected-dot'}/><span>{labelProvider[provider]}</span><span className="agent-model-short">{model}</span></div><button onClick={() => setDialog('settings')} title="Cambiar modelo"><ChevronDown size={15}/></button></div>
        <div className="agent-thread">
          {!history.length && <div className="agent-starter"><div className="agent-star"><WandSparkles size={24}/></div><h2>Ideas que se vuelven código.</h2><p>Pregunta sobre el proyecto o solicita una modificación. Las ediciones se revisan antes de aplicarse.</p><div className="agent-suggestions"><button onClick={() => setQuestion('Explícame la arquitectura del archivo abierto y cómo mejorarla.')}>Explicar código <ArrowRight size={13}/></button><button onClick={() => { setAgentMode('edit'); setQuestion('Refactoriza este archivo para mejorar calidad, legibilidad y mantenimiento sin cambiar su comportamiento.'); }}>Refactorizar archivo <ArrowRight size={13}/></button></div></div>}
          {history.map((m,i) => <div key={i} className={'chat-message '+m.role}><div className="chat-author">{m.role==='user'?'Tú':'CORE AGENT'}<span>{new Date(m.timestamp).toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'})}</span></div><div className="chat-text">{m.content}</div></div>)}
          {agentBusy && <div className="agent-thinking"><LoaderCircle size={15} className="spin"/> Consultando {labelProvider[provider]}...</div>}
          {proposal && <div className="proposal-card"><div className="proposal-header"><CheckCircle2 size={16}/><strong>Propuesta preparada</strong></div><div className="proposal-path">{proposal.path}</div><div className="proposal-stats"><span>{proposal.original.split('\n').length} líneas actuales</span><ArrowRight size={13}/><span>{proposal.next.split('\n').length} propuestas</span></div><p>El cambio no se aplicará sin tu aprobación. Luego podrás guardarlo.</p><div className="proposal-actions"><button onClick={() => setProposal(null)} className="secondary-button">Descartar</button><button onClick={() => setDialog('diff')} className="secondary-button"><Code2 size={14}/> Revisar diff</button><button onClick={applyProposal} className="primary-button"><Check size={14}/> Aplicar al editor</button></div></div>}
        </div>
        <div className="agent-compose">
          <div className="composer-tabs"><button className={agentMode==='chat'?'mode-active':''} onClick={() => setAgentMode('chat')}><MessageSquareText size={13}/> Preguntar</button><button className={agentMode==='edit'?'mode-active':''} onClick={() => setAgentMode('edit')}><Code2 size={13}/> Editar archivo</button></div>
          <form onSubmit={askAgent} className="compose-box"><textarea rows={3} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) {e.preventDefault(); void askAgent();} }} placeholder={agentMode==='edit'?'Describe el cambio que quieres aplicar...':'Pregunta sobre tu código o proyecto...'} disabled={agentBusy}/><div className="compose-bottom"><label className="file-context-toggle"><input type="checkbox" checked={agentMode==='edit' || includeFile} onChange={e=>setIncludeFile(e.target.checked)} disabled={agentMode==='edit' || !active}/><span>{agentMode==='edit' ? 'Enviar archivo activo' : 'Incluir archivo'}</span></label><button className="send-button" type="submit" disabled={agentBusy || !question.trim()} title="Enviar al agente">{agentBusy ? <LoaderCircle size={17} className="spin"/> : <ArrowRight size={18}/>}</button></div></form>
          <div className="agent-disclaimer"><ShieldCheck size={12}/> Clave solo en memoria · El contexto se envía únicamente al solicitarlo</div>
        </div>
      </aside></>}
    </div>
    <footer className="statusbar"><div className="status-left"><span className="status-highlight"><BrandMark/> Core</span><button onClick={() => setSection('activity')}><Activity size={12}/> {logs[0]?.level === 'error' ? 'Revisar evento' : 'Listo'}</button><span className="status-divider"/><span>{workspace?.kind === 'github' ? <Github size={12}/> : <HardDrive size={12}/>} {workspace?.name || 'Sin proyecto'}</span></div><div className="status-right">{active && <><span>{active.language}</span><span>{active.text.split('\n').length} líneas</span><span>{active.readOnly?'Lectura':'Editable'}</span></>}<button title="Mostrar terminal" onClick={()=>{setBottomOpen(true);setBottomTab('terminal');}}><SquareTerminal size={13}/></button><span>UTF-8</span></div></footer>
    {toast && <div className="toast" role="status"><CircleDot size={15}/>{toast}<button onClick={()=>setToast('')}><X size={14}/></button></div>}
    {dialog && <div className="modal-backdrop" onMouseDown={e => {if(e.target===e.currentTarget)setDialog(null);}}><div className={'dialog '+(dialog==='commands'?'command-dialog':dialog==='diff'?'diff-dialog':'')} role="dialog" aria-modal="true">
      {dialog==='diff' && proposal ? <><div className="dialog-top"><div><span className="dialog-eyebrow">REVISIÓN DE CAMBIOS</span><h3>{proposal.path}</h3></div><button className="dialog-close" onClick={()=>setDialog(null)}><X size={18}/></button></div><div className="diff-body"><DiffEditor original={proposal.original} modified={proposal.next} language={languageOf(proposal.path)} theme="vs-dark" options={{ readOnly: true, automaticLayout:true, minimap:{enabled:false}, fontSize:12, renderSideBySide: true, scrollBeyondLastLine:false }} /></div><div className="dialog-actions diff-actions"><button className="secondary-button" onClick={()=>setDialog(null)}>Volver</button><button className="primary-button" onClick={()=>{applyProposal();setDialog(null);}}><Check size={14}/> Aplicar al editor</button></div></> : dialog==='commands' ? <><div className="command-input"><Search size={19}/><input autoFocus placeholder="Escribe una acción o un archivo..." value={commandFilter} onChange={e=>setCommandFilter(e.target.value)}/><kbd>ESC</kbd></div><div className="command-list">{visibleCommands.map((item,i)=><button key={i} onClick={item.action}><item.icon size={17}/><div><strong>{item.title}</strong><small>{item.detail}</small></div><ArrowRight size={14}/></button>)}</div><div className="command-footer"><Keyboard size={13}/> Acciones y archivos del proyecto</div></>
      : <><div className="dialog-top"><div><span className="dialog-eyebrow">ALICELABS CORE</span><h3>{dialog==='github'?'Abrir repositorio GitHub':dialog==='new'?'Nuevo archivo':dialog==='settings'?'Conexiones de IA':'Conectar terminal local'}</h3></div><button className="dialog-close" onClick={()=>setDialog(null)}><X size={18}/></button></div>
        {dialog==='github' && <form onSubmit={openGithub} className="dialog-content"><p>Explora cualquier repositorio público de GitHub, con árbol de archivos y editor en modo lectura. Para editar y guardar, abre una carpeta local.</p><label>URL del repositorio</label><div className="input-with-icon"><Github size={16}/><input autoFocus placeholder="https://github.com/usuario/repositorio" value={githubURL} onChange={e=>setGithubURL(e.target.value)}/></div><div className="dialog-actions"><button type="button" className="secondary-button" onClick={()=>setDialog(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={busyWorkspace||!githubURL.trim()}>{busyWorkspace?<LoaderCircle size={15} className="spin"/>:<ArrowRight size={15}/>} Abrir repositorio</button></div></form>}
        {dialog==='new' && <form onSubmit={createNew} className="dialog-content"><p>Crea un archivo en la carpeta local. Puedes indicar subcarpetas con /.</p><label>Nombre o ruta</label><div className="input-with-icon"><FilePlus2 size={16}/><input autoFocus placeholder="src/components/Nuevo.tsx" value={newPath} onChange={e=>setNewPath(e.target.value)}/></div><div className="dialog-actions"><button className="secondary-button" type="button" onClick={()=>setDialog(null)}>Cancelar</button><button className="primary-button" disabled={!newPath.trim()}>Crear archivo</button></div></form>}
        {dialog==='settings' && <div className="dialog-content"><p>Conecta tus propias credenciales. La clave vive únicamente en memoria de esta pestaña y se transmite por HTTPS al Worker para contactar a tu proveedor. No se almacena en Cloudflare.</p><label>Proveedor</label><div className="provider-grid">{(Object.keys(labelProvider) as Provider[]).map(p=><button className={'provider-option '+(provider===p?'provider-selected':'')} key={p} onClick={()=>changeProvider(p)}><span>{labelProvider[p]}</span>{provider===p&&<Check size={15}/>}</button>)}</div><label>Modelo</label><input className="dialog-text-input" value={model} onChange={e=>setModel(e.target.value)} placeholder="Nombre exacto del modelo"/><label>Clave API</label><div className="input-with-icon"><LockKeyhole size={16}/><input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Tu clave, nunca guardada en disco"/></div><div className="info-note"><ShieldCheck size={17}/><span>Solo se envía contexto de archivos cuando activas “Incluir archivo” o solicitas una edición. Las respuestas de código requieren revisión.</span></div><div className="dialog-actions"><button className="secondary-button" onClick={()=>{setApiKey('');notify('Credencial borrada de la sesión');}}>Borrar clave</button><button className="primary-button" onClick={()=>setDialog(null)}><Check size={15}/> Listo</button></div></div>}
        {dialog==='bridge' && <form onSubmit={connectBridge} className="dialog-content"><p>Para ejecutar comandos necesitas Core Local Bridge en tu propio equipo. Abre la terminal en la carpeta del repositorio y ejecuta:</p><div className="command-snippet"><code>node tools/local-bridge/server.mjs</code><button type="button" onClick={()=>void navigator.clipboard.writeText('node tools/local-bridge/server.mjs')} title="Copiar"><Copy size={15}/></button></div><p>El Bridge mostrará un token de sesión. Cada comando solicitará autorización en esa terminal.</p><label>Token de emparejamiento local</label><div className="input-with-icon"><LockKeyhole size={16}/><input type="password" autoFocus value={bridgeToken} onChange={e=>setBridgeToken(e.target.value)} placeholder="Pega el token que aparece en tu terminal"/></div><div className="dialog-actions"><button type="button" className="secondary-button" onClick={()=>setDialog(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={!bridgeToken.trim()}><Wifi size={15}/> Conectar</button></div></form>}
        </>}
    </div></div>}
  </div>;
}
