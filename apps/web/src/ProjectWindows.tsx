import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, FolderKanban, Plus, ShieldCheck, X } from 'lucide-react';
import App from './App';
import type {Connection} from './agent';
import {OWNER_GRANTS_STORAGE_KEY,readGrantsFromJson} from './ownerGrants';
import { deleteProjectSnapshot } from './projectSnapshots';

type WindowInfo = { id: string; title: string; dirty: boolean };
const KEY = 'alicelabs-core-windows-v1';
const GRANT_KEY = OWNER_GRANTS_STORAGE_KEY;
const selectedFromUrl = new URLSearchParams(window.location.search).get('project');
const idValid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
function readWindows(): WindowInfo[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(x => x && idValid(x.id) && typeof x.title === 'string').slice(0, 16).map(x => ({ id:x.id, title:x.title.slice(0, 80), dirty:false })) : [];
  } catch { return []; }
}
function readProjectGrants():Record<string,string[]>{
  try{return readGrantsFromJson(localStorage.getItem(GRANT_KEY));}catch{return {};}
}
const firstWindow = { id: crypto.randomUUID(), title: 'Proyecto 1', dirty:false };
const initialWindows = (() => {
  const existing = readWindows();
  if (selectedFromUrl && idValid(selectedFromUrl) && !existing.some(p => p.id === selectedFromUrl)) {
    existing.push({ id:selectedFromUrl, title:'Ventana de proyecto', dirty:false });
  }
  return existing.length ? existing : [firstWindow];
})();
function initialSelected(): string {
  return selectedFromUrl && idValid(selectedFromUrl) ? selectedFromUrl :
    sessionStorage.getItem('alicelabs-core-active-project') || initialWindows[0].id;
}

export default function ProjectWindows() {
  const [windows, setWindows] = useState<WindowInfo[]>(initialWindows);
  // Global owner account catalogue lives in RAM. Secret material is never saved here.
  const [ownerConnections,setOwnerConnections]=useState<Connection[]>([]);
  // Grants store only non-secret random profile identifiers for each isolated project.
  const [projectGrants,setProjectGrants]=useState<Record<string,string[]>>(readProjectGrants);
  const [selected, setSelected] = useState(initialSelected);
  const [mounted, setMounted] = useState<string[]>(() => [initialSelected()]);
  const activeId = windows.some(x => x.id === selected) ? selected : windows[0].id;
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(windows.map(x => ({id:x.id,title:x.title}))));
  }, [windows]);
  useEffect(()=>{
    try{localStorage.setItem(GRANT_KEY,JSON.stringify(projectGrants));}catch{/* Storage unavailable */}
  },[projectGrants]);
  const setProjectGrant=useCallback((projectId:string,connectionId:string,enabled:boolean)=>{
    setProjectGrants(prev=>{
      const updated=new Set(prev[projectId]||[]);
      if(enabled)updated.add(connectionId);else updated.delete(connectionId);
      return {...prev,[projectId]:[...updated]};
    });
  },[]);
  useEffect(() => {
    sessionStorage.setItem('alicelabs-core-active-project', activeId);
    if (!mounted.includes(activeId)) setMounted(prev => [...prev,activeId]);
    const params = new URLSearchParams(window.location.search);
    params.set('project',activeId);
    window.history.replaceState(null,'',window.location.pathname+'?'+params.toString());
  }, [activeId, mounted]);

  const rename = useCallback((id:string,title:string) => {
    setWindows(prev => prev.map(x => x.id===id && x.title!==title ? {...x,title:title.slice(0,80)} : x));
  },[]);
  const markDirty = useCallback((id:string,dirty:boolean) => {
    setWindows(prev => prev.some(x=>x.id===id && x.dirty!==dirty) ? prev.map(x=>x.id===id?{...x,dirty}:x) : prev);
  },[]);
  function switchTo(id:string) {
    setSelected(id);
    if(!mounted.includes(id))setMounted(prev=>[...prev,id]);
  }
  function newProject() {
    if(windows.length>=16) return window.alert('Máximo 16 ventanas simultáneas. Cierra una antes de crear otra.');
    const id=crypto.randomUUID();
    setWindows(prev=>[...prev,{id,title:'Proyecto '+(prev.length+1),dirty:false}]);
    switchTo(id);
  }
  function popOut(id:string) {
    const url = new URL(window.location.href);
    url.searchParams.set('project',id);
    window.open(url.toString(),'_blank','noopener');
  }
  async function closeProject(id:string) {
    const project=windows.find(p=>p.id===id);
    if(project?.dirty && !window.confirm('Este proyecto tiene cambios sin guardar en sus archivos. ¿Cerrar y eliminar esta sesión local?'))return;
    if(!project?.dirty && !window.confirm('¿Cerrar y eliminar esta ventana y sus borradores guardados en este dispositivo?'))return;
    const rest=windows.filter(p=>p.id!==id);
    const next=rest.length?rest:[{id:crypto.randomUUID(),title:'Proyecto 1',dirty:false}];
    setWindows(next);
    setMounted(prev=>prev.filter(x=>x!==id));
    setProjectGrants(prev=>{const next={...prev};delete next[id];return next;});
    if(activeId===id)setSelected(next[next.length-1].id);
    try {await deleteProjectSnapshot(id);} catch { /* local storage permissions vary */ }
  }
  const active = useMemo(()=>windows.find(p=>p.id===activeId),[windows,activeId]);
  return <div className="core-window-root">
    <nav className="project-window-bar" aria-label="Ventanas de proyecto">
      <span className="project-window-heading" title="Proyectos independientes"><FolderKanban size={16}/><span>Proyectos</span></span>
      <div className="project-window-tabs" role="tablist" aria-label="Seleccionar proyecto">
        {windows.map(item=><div role="presentation" className={'project-window-tab '+(activeId===item.id?'selected':'')} key={item.id}>
          <button role="tab" aria-selected={activeId===item.id} title={'Cambiar a '+item.title} onClick={()=>switchTo(item.id)}>
            <span className={'project-window-dot '+(item.dirty?'unsaved':'')}/><span className="project-window-name">{item.title}</span>
          </button>
          <button className="project-window-close" aria-label={'Cerrar '+item.title} title="Cerrar proyecto" onClick={()=>void closeProject(item.id)}><X size={13}/></button>
        </div>)}
      </div>
      <div className="project-window-tools">
        <button title="Abrir el proyecto en otra ventana del navegador" aria-label="Abrir en ventana" onClick={()=>popOut(activeId)}><ArrowUpRight size={15}/></button>
        <button className="project-window-new" title="Nueva ventana de proyecto independiente" aria-label="Nuevo proyecto" onClick={newProject}><Plus size={16}/><span>Nuevo</span></button>
      </div>
    </nav>
    <div className="project-window-content">
      {mounted.map(id=>windows.some(p=>p.id===id) && <section key={id} className="project-window-instance" aria-label={'Proyecto '+(windows.find(p=>p.id===id)?.title||'')} hidden={id!==activeId}>
        <App projectId={id} activeProject={id===activeId} onProjectTitle={title=>rename(id,title)} onDirtyChange={dirty=>markDirty(id,dirty)}
          connections={ownerConnections} setConnections={setOwnerConnections} projectGrantIds={projectGrants[id]||[]}
          onProjectGrant={(connectionId,enabled)=>setProjectGrant(id,connectionId,enabled)}/>
      </section>)}
    </div>
    <div className="project-window-status" role="status"><ShieldCheck size={13}/> {active?.title||'Proyecto'} · Sesión separada · Guardado local en este dispositivo</div>
  </div>;
}
