import {useCallback,useEffect,useState} from 'react';
import {Bot,CheckCircle2,Clock3,ExternalLink,PauseCircle,Play,RefreshCw,ShieldCheck} from 'lucide-react';
import type {GithubRepoInfo} from './githubWorkspace';
import {
  createApprovedAutopilotIssue,listApprovedAutopilotIssues,
  readAutopilotConfig,setAutopilotConfig
} from './githubAutopilot';
import type {AutopilotConfig,AutopilotQueueIssue} from './githubAutopilot';

export default function GithubAutopilotPanel({repo,token,onNotice}:{
  repo:GithubRepoInfo;token:string;onNotice:(message:string,error?:boolean)=>void;
}){
  const [config,setConfig]=useState<AutopilotConfig|null>(null);
  const [limit,setLimit]=useState<1|2|3>(2);
  const [goal,setGoal]=useState('');
  const [files,setFiles]=useState('');
  const [queue,setQueue]=useState<AutopilotQueueIssue[]>([]);
  const [busy,setBusy]=useState(false);
  const [issueLink,setIssueLink]=useState('');
  const readStatus=useCallback(async()=>{
    try{
      const [current,issues]=await Promise.all([
        readAutopilotConfig(repo,token),
        listApprovedAutopilotIssues(repo,token)
      ]);
      setConfig(current);setLimit(current.dailyLimit);setQueue(issues);
    }catch(e){
      onNotice(e instanceof Error?e.message:'No se pudo consultar el autopiloto',true);
    }
  },[repo.owner,repo.repo,token,onNotice]);
  useEffect(()=>{void readStatus();},[readStatus]);
  async function toggle(enable:boolean){
    if(busy)return;
    if(enable && !window.confirm(
      '¿ACTIVAR el autopiloto de GitHub cada cinco minutos para este repositorio?\n\n'+
      'Solo ejecutará tareas de Issues aprobados. Hasta '+limit+' tareas de IA por día UTC, con un máximo de cinco solicitudes al proveedor por tarea. '+
      'Cada tarea puede consumir tokens y minutos facturables. '+
      'Debes configurar CORE_AGENT_API_KEY y permitir PRs de GitHub Actions. No fusiona PRs automáticamente.'))
      return;
    if(!enable && !window.confirm('¿Desactivar nuevas tareas automáticas? Los trabajos iniciados continuarán salvo que los canceles desde GitHub Actions.'))return;
    setBusy(true);
    try{
      await setAutopilotConfig(repo,token,{
        enabled:enable,codingEnabled:enable,dailyLimit:limit
      });
      const updated=await readAutopilotConfig(repo,token);
      setConfig(updated);
      onNotice(enable?'Autopiloto habilitado para tareas aprobadas y limitadas.':'Nuevas tareas del autopiloto desactivadas.');
    }catch(e){onNotice(e instanceof Error?e.message:'No se pudo modificar el autopiloto',true);}
    finally{setBusy(false);}
  }
  async function submitTask(){
    if(busy||!goal.trim()||!files.trim())return;
    if(!window.confirm('¿Crear un Issue de GitHub aprobado para que Core pueda modificar los archivos seleccionados cuando el autopiloto esté habilitado?\n\n'+goal.trim().slice(0,160)+'\n\nLos nombres de archivos y el objetivo se guardarán en GitHub; el trabajo puede consumir API y minutos facturables.'))return;
    setBusy(true);
    try{
      const created=await createApprovedAutopilotIssue(repo,token,goal,files);
      setIssueLink(created.url);
      setGoal('');setFiles('');
      onNotice('Tarea #'+created.number+' autorizada y añadida a la cola GitHub.');
      setQueue(await listApprovedAutopilotIssues(repo,token));
    }catch(e){onNotice(e instanceof Error?e.message:'No se pudo crear la tarea',true);}
    finally{setBusy(false);}
  }
  const enabled=config?.enabled&&config.codingEnabled;
  return <section className="github-autopilot-panel" aria-label="Autopiloto de desarrollo programado">
    <div className="accounts-head">
      <strong><Bot size={14}/> Core Autopilot · GitHub</strong>
      <span>{!config?'Estado pendiente':enabled?'Autopiloto activado':'Desactivado'}</span>
    </div>
    <p>Cuando está habilitado, GitHub busca cada cinco minutos tareas del propietario aprobadas. Core ejecuta planificador, programador y revisor, abre PRs y conserva el historial aunque cierres la aplicación. GitHub puede retrasar una ejecución programada.</p>
    <div className="github-autopilot-budget">
      <label htmlFor="core-autopilot-budget">Límite de tareas de IA por día UTC</label>
      <select id="core-autopilot-budget" value={limit} disabled={busy}
        onChange={e=>setLimit(Number(e.target.value) as 1|2|3)}>
        <option value={1}>1 tarea/día</option>
        <option value={2}>2 tareas/día</option>
        <option value={3}>3 tareas/día</option>
      </select>
    </div>
    <div className="cloud-action-row">
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>void readStatus()}><RefreshCw size={13}/> Actualizar</button>
      {enabled?<button type="button" className="secondary-button" disabled={busy} onClick={()=>void toggle(false)}><PauseCircle size={13}/> Desactivar autopiloto</button>:
        <button type="button" className="primary-button" disabled={busy||!config} onClick={()=>void toggle(true)}><Play size={13}/> Activar con límite diario</button>}
    </div>
    <p className="github-autopilot-warning"><ShieldCheck size={14}/> Se requieren permisos GitHub Issues: write, Variables: write, Actions y Pull Requests; un secreto CORE_AGENT_API_KEY en GitHub. Las ejecuciones son bajo demanda, con presupuesto limitado y revisión obligatoria del PR.</p>
    <div className="github-autopilot-task-form">
      <strong>Agregar tarea aprobada a la cola</strong>
      <label htmlFor="core-auto-goal">Objetivo</label>
      <textarea id="core-auto-goal" rows={3} className="dialog-text-input" maxLength={1600}
        placeholder="Corrige una función y actualiza su prueba" value={goal} onChange={e=>setGoal(e.target.value)}/>
      <label htmlFor="core-auto-files">2–6 archivos existentes bajo src/</label>
      <input id="core-auto-files" className="dialog-text-input" maxLength={700}
        placeholder="src/index.ts,src/index.test.ts" value={files} onChange={e=>setFiles(e.target.value)}/>
      <button className="secondary-button" type="button" disabled={busy||!goal.trim()||!files.trim()}
        onClick={()=>void submitTask()}><CheckCircle2 size={14}/> Crear tarea aprobada en GitHub</button>
      {issueLink&&<a href={issueLink} rel="noopener noreferrer" target="_blank">Ver tarea recién creada <ExternalLink size={13}/></a>}
    </div>
    <div className="accounts-head"><strong>Cola aprobada</strong><span>{queue.length} Issues</span></div>
    {queue.length===0&&<p>No hay tareas aprobadas pendientes. Puedes crear una arriba.</p>}
    <div className="github-autopilot-issues">
      {queue.map(issue=><a key={issue.number} href={issue.html_url} target="_blank" rel="noopener noreferrer">
        <Clock3 size={14}/> <span>#{issue.number} · {issue.title}</span><ExternalLink size={12}/>
      </a>)}
    </div>
  </section>;
}
