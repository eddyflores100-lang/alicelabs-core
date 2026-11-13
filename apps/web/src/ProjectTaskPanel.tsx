import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Play, RefreshCw, Square, Trash2 } from 'lucide-react';

type TaskStatus = 'queued'|'running'|'completed'|'failed'|'cancelled';
type TaskResult = {action:string;ok:boolean;exitCode:number|null;output:string;stopped:boolean};
type ProjectTask = {
  id:string;title:string;steps:string[];status:TaskStatus;current:number;
  createdAt:number;updatedAt:number;results:TaskResult[];error?:string;
};
const ACTIONS = [
  {id:'git-status',label:'Estado Git'},
  {id:'pnpm-typecheck',label:'TypeScript'},
  {id:'pnpm-test',label:'Pruebas'},
  {id:'pnpm-build',label:'Compilación'},
  {id:'git-diff',label:'Resumen de cambios'},
  {id:'git-log',label:'Últimos commits'},
  {id:'node-version',label:'Versión Node'}
];
const STATUS:Record<TaskStatus,string> = {
  queued:'En cola',running:'Ejecutándose',completed:'Completada',failed:'Falló',cancelled:'Cancelada'
};

export default function ProjectTaskPanel({endpoint,ready,onNotice,onComplete,onGeneratePlan}:{
  endpoint:string;
  ready:boolean;
  onNotice:(message:string,isError?:boolean)=>void;
  onComplete:(message:string)=>void;
  onGeneratePlan:(goal:string)=>Promise<{title:string;steps:string[]}>;
}) {
  const [title,setTitle]=useState('Comprobar proyecto');
  const [goal,setGoal]=useState('Revisar el estado de Git, ejecutar pruebas y verificar la compilación.');
  const [planning,setPlanning]=useState(false);
  const [selected,setSelected]=useState<string[]>(['git-status','pnpm-typecheck','pnpm-test','pnpm-build']);
  const [tasks,setTasks]=useState<ProjectTask[]>([]);
  const [busy,setBusy]=useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  const known=useRef(new Map<string,TaskStatus>());
  const refresh=useCallback(async (silent=false)=>{
    if(!ready)return;
    try {
      const r=await fetch(endpoint+'/tasks',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(12000)});
      const data=await r.json() as {ok?:boolean;tasks?:ProjectTask[];error?:string};
      if(!r.ok||!data.ok||!Array.isArray(data.tasks))throw Error(data.error||'No se pudo consultar la cola');
      for(const t of data.tasks){
        const old=known.current.get(t.id);
        if(old && old!==t.status && ['completed','failed'].includes(t.status))onComplete('Tarea '+t.title+': '+STATUS[t.status]);
        known.current.set(t.id,t.status);
      }
      setTasks(data.tasks);
    } catch(e) {
      if(!silent)onNotice(e instanceof Error?e.message:'Error al consultar tareas',true);
    }
  },[endpoint,ready,onNotice]);
  useEffect(()=>{
    if(!ready)return;
    void refresh(true);
    const timer=window.setInterval(()=>void refresh(true),4000);
    return ()=>window.clearInterval(timer);
  },[refresh,ready]);
  async function generatePlan(){
    if(planning||!goal.trim())return;
    setPlanning(true);
    try {
      const proposal=await onGeneratePlan(goal.trim());
      const ids=proposal.steps.filter(step=>ACTIONS.some(x=>x.id===step));
      if(!ids.length||ids.length>8||ids.length!==proposal.steps.length)throw Error('El plan contiene acciones no permitidas');
      setTitle(proposal.title.slice(0,90));setSelected(ids);
      onNotice('Plan de IA preparado. Revisa los pasos antes de autorizarlo.');
    }catch(e){onNotice(e instanceof Error?e.message:'No se pudo preparar el plan',true);}
    finally{setPlanning(false);}
  }
  async function submit() {
    if(!ready||busy||!selected.length||!title.trim())return;
    const commands=selected.map(id=>ACTIONS.find(x=>x.id===id)?.label||id).join(' → ');
    if(!window.confirm('Autorizar estos pasos en el contenedor PRIVADO de este proyecto, en este orden:\n\n'+commands+'\n\nLa ejecución puede modificar archivos del proyecto.'))return;
    setBusy(true);
    try {
      const r=await fetch(endpoint+'/tasks',{method:'POST',credentials:'include',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({title:title.trim(),steps:selected,approved:true}),
        signal:AbortSignal.timeout(20000)});
      const data=await r.json() as {ok?:boolean;task?:ProjectTask;error?:string};
      if(!r.ok||!data.ok)throw Error(data.error||'No se pudo iniciar la tarea');
      onNotice('Tarea autorizada y guardada: '+title);
      await refresh(true);
    }catch(e){onNotice(e instanceof Error?e.message:'Error al crear tarea',true);}
    finally{setBusy(false);}
  }
  async function taskAction(id:string,action:'cancel'|'delete'){
    if(!window.confirm(action==='cancel'?'¿Cancelar la tarea en cola?':'¿Eliminar el historial de esta tarea?'))return;
    setBusy(true);
    try {
      const route=endpoint+'/tasks/'+encodeURIComponent(id);
      const r=await fetch(action==='cancel'?route+'/cancel':route,{
        method:action==='cancel'?'POST':'DELETE',credentials:'include',
        cache:'no-store',signal:AbortSignal.timeout(12000)});
      const data=await r.json() as {ok?:boolean;error?:string};
      if(!r.ok||!data.ok)throw Error(data.error||'Operación rechazada');
      await refresh(true);
    }catch(e){onNotice(e instanceof Error?e.message:'Error remoto',true);}
    finally{setBusy(false);}
  }
  function toggle(id:string){
    setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  }
  return <section className="core-task-panel" aria-label="Tareas multipaso del proyecto">
    <div className="accounts-head"><strong>Cola de tareas multipaso</strong><span>Estado guardado en el entorno privado</span></div>
    <p>Selecciona pasos y autorízalos juntos. Cada proyecto mantiene su propia cola: las tareas no dependen de que dejes abierta la pestaña, siempre que el runner esté desplegado y autenticado.</p>
    <label htmlFor="task-goal">Objetivo para el planificador de IA</label>
    <textarea id="task-goal" className="dialog-text-input" rows={2} value={goal} maxLength={1400}
      onChange={e=>setGoal(e.target.value)} placeholder="Describe qué quieres verificar en este proyecto"/>
    <div className="cloud-action-row"><button className="secondary-button" type="button" disabled={planning||!goal.trim()} onClick={()=>void generatePlan()}>{planning?"Consultando IA…":"Proponer plan con IA"}</button></div>
    <label htmlFor="task-title">Nombre de la tarea</label>
    <input id="task-title" className="dialog-text-input" value={title} maxLength={90}
      onChange={e=>setTitle(e.target.value)} placeholder="Comprobar proyecto"/>
    <div className="core-task-actions" role="group" aria-label="Pasos aprobados">
      {ACTIONS.map(x=><label key={x.id}><input type="checkbox" checked={selected.includes(x.id)} onChange={()=>toggle(x.id)} disabled={!ready||busy}/>{x.label}</label>)}
    </div>
    <div className="cloud-action-row">
      <button type="button" className="primary-button" disabled={!ready||busy||!title.trim()||!selected.length}
        onClick={()=>void submit()}><Play size={14}/> Autorizar y ejecutar {selected.length} pasos</button>
      <button type="button" className="secondary-button" disabled={!ready||busy} onClick={()=>void refresh()}>
        <RefreshCw size={14}/> Actualizar historial</button>
    </div>
    {tasks.length>0 && <div className="core-task-history">
      {tasks.map(task=><article className="core-task-entry" key={task.id}>
        <div className="cloud-action-row">
          <button type="button" className="secondary-button" onClick={()=>setExpanded(expanded===task.id?null:task.id)}>
            {task.status==='completed'?<CheckCircle2 size={14}/>:task.status==='failed'?<CircleAlert size={14}/>:<Clock3 size={14}/>}
            {task.title} · {STATUS[task.status]} ({task.current}/{task.steps.length})
          </button>
          {task.status==='queued' && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void taskAction(task.id,'cancel')}><Square size={13}/> Cancelar</button>}
          {['completed','failed','cancelled'].includes(task.status) && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void taskAction(task.id,'delete')}><Trash2 size={13}/> Borrar</button>}
        </div>
        {expanded===task.id && <div>
          {task.error && <p role="alert">{task.error}</p>}
          <p>{task.steps.map(x=>ACTIONS.find(a=>a.id===x)?.label||x).join(' → ')}</p>
          {task.results.map((step,i)=><pre className="cloud-result" key={i}>$ {step.action} · {step.ok?'OK':'FALLÓ'} · exit {String(step.exitCode)}
{step.output}</pre>)}
        </div>}
      </article>)}
    </div>}
  </section>;
}
