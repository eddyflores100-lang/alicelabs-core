import {useCallback,useEffect,useMemo,useState} from 'react';
import {CheckCircle2,CircleAlert,Clock3,Cloud,ExternalLink,Play,RefreshCw,Square,Workflow} from 'lucide-react';
import type {GithubRepoInfo} from './githubWorkspace';
import GithubAutopilotPanel from './GithubAutopilotPanel';
import {
  cancelGithubRun,dispatchGithubWorkflow,dispatchGithubCloudCoder,isCloudCoderWorkflow,listGithubRuns,listGithubWorkflows
} from './githubActions';
import type {GithubWorkflow,GithubWorkflowRun} from './githubActions';

function readableStatus(run:GithubWorkflowRun):string{
  if(run.status==='completed'){
    const labels:Record<string,string>={
      success:'Correcta',failure:'Falló',cancelled:'Cancelada',timed_out:'Tiempo agotado',
      neutral:'Neutra',skipped:'Omitida',action_required:'Requiere acción'
    };
    return labels[run.conclusion||'']||'Finalizada';
  }
  return run.status==='in_progress'?'Ejecutándose':run.status==='queued'?'En cola':run.status;
}

export default function GithubActionsPanel({repo,token,onNotice}:{
  repo:GithubRepoInfo;token:string;onNotice:(message:string,error?:boolean)=>void;
}){
  const [workflows,setWorkflows]=useState<GithubWorkflow[]>([]);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [runs,setRuns]=useState<GithubWorkflowRun[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [dispatchLink,setDispatchLink]=useState<string|null>(null);
  const [cloudGoal,setCloudGoal]=useState('');
  const [cloudFiles,setCloudFiles]=useState('');
  const selected=useMemo(()=>workflows.find(w=>w.id===selectedId)||null,[workflows,selectedId]);
  const cloudCoder=isCloudCoderWorkflow(selected);
  const autopilot=selected?.path==='.github/workflows/core-autopilot.yml';
  const load=useCallback(async()=>{
    if(!token)return;
    setLoading(true);
    try{
      const list=await listGithubWorkflows(repo,token);
      setWorkflows(list);
      setSelectedId(current=>list.some(w=>w.id===current)?current:list[0]?.id||null);
    }catch(e){
      onNotice(e instanceof Error?e.message:'No se pudo obtener el catálogo de GitHub Actions',true);
    }finally{setLoading(false);}
  },[repo.owner,repo.repo,repo.branch,token,onNotice]);
  const refreshRuns=useCallback(async()=>{
    if(!token||selectedId===null)return;
    try{setRuns(await listGithubRuns(repo,token,selectedId));}
    catch(e){onNotice(e instanceof Error?e.message:'No se pudo leer el estado de ejecuciones',true);}
  },[repo.owner,repo.repo,repo.branch,token,selectedId,onNotice]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    setRuns([]);
    if(selectedId===null)return;
    void refreshRuns();
    const timer=window.setInterval(()=>void refreshRuns(),15000);
    return ()=>window.clearInterval(timer);
  },[selectedId,refreshRuns]);
  async function run(){
    if(!selected||busy||!token)return;
    const confirmText=(cloudCoder?'¿Lanzar al equipo autónomo de Core para proponer cambios en '+cloudFiles+'?\nObjetivo: '+cloudGoal.slice(0,160):'¿Ejecutar el workflow "'+selected.name+'"')+' en '+
      repo.owner+'/'+repo.repo+' (rama '+repo.branch+')?\n\nGitHub Actions ejecutará instrucciones existentes en el repositorio, que pueden consumir minutos facturables, desplegar servicios o utilizar secretos de GitHub. Confirma solo si conoces este workflow.';
    if(!window.confirm(confirmText))return;
    setBusy(true);
    try{
      const result=cloudCoder?await dispatchGithubCloudCoder(repo,token,selected.id,cloudGoal,cloudFiles):
        await dispatchGithubWorkflow(repo,token,selected.id);
      setDispatchLink(result.url);
      onNotice(result.runId?'GitHub aceptó la ejecución #'+result.runId:'GitHub aceptó la solicitud; consulta las ejecuciones recientes.');
      await refreshRuns();
    }catch(e){onNotice(e instanceof Error?e.message:'No se pudo iniciar el workflow',true);}
    finally{setBusy(false);}
  }
  async function cancel(run:GithubWorkflowRun){
    if(busy||!window.confirm('¿Solicitar cancelación de la ejecución #'+run.id+' de GitHub Actions?'))return;
    setBusy(true);
    try{await cancelGithubRun(repo,token,run.id);onNotice('Cancelación solicitada a GitHub para la ejecución #'+run.id);await refreshRuns();}
    catch(e){onNotice(e instanceof Error?e.message:'No se pudo cancelar',true);}
    finally{setBusy(false);}
  }
  return <div className="dialog-content github-actions-panel">
    <p>Inicia y supervisa workflows existentes en GitHub desde la web o Android. GitHub ejecuta los trabajos en sus propios runners incluso al cerrar Core; este panel no requiere Cloudflare Containers.</p>
    <p><strong>Repositorio:</strong> {repo.owner}/{repo.repo} · <strong>Rama:</strong> {repo.branch}</p>
    <p>La cuenta GitHub debe autorizar <strong>Actions: Read and write</strong> para el repositorio. Solo funcionan workflows que permiten <code>workflow_dispatch</code>.</p>
    <div className="cloud-action-row">
      <button type="button" className="secondary-button" disabled={busy||loading} onClick={()=>void load()}>
        <RefreshCw size={14}/> {loading?'Consultando…':'Actualizar workflows'}
      </button>
    </div>
    <label htmlFor="core-github-action-select">Workflow del repositorio</label>
    <select id="core-github-action-select" className="dialog-text-input" value={selectedId??''}
      disabled={busy||loading||!workflows.length}
      onChange={e=>{setSelectedId(Number(e.target.value));setDispatchLink(null);}}>
      {!workflows.length&&<option value="">No hay workflows disponibles</option>}
      {workflows.map(w=><option key={w.id} value={w.id}>{w.name} · {w.path}</option>)}
    </select>
    {selected&&<div className="github-actions-details">
      <p><Workflow size={14}/> {selected.path}</p>
      {autopilot&&<GithubAutopilotPanel repo={repo} token={token} onNotice={onNotice}/>}
      {cloudCoder&&<div className="github-cloud-coder-form">
        <p><strong>Core Cloud Coder</strong> ejecuta agentes planificador → programador → revisor en GitHub, crea una rama y abre un PR. No fusiona ni ejecuta el código generado con secretos presentes.</p>
        <label htmlFor="core-cloud-goal">Objetivo del desarrollo</label>
        <textarea id="core-cloud-goal" rows={3} maxLength={1600} className="dialog-text-input"
          placeholder="Explica qué debe corregir o mejorar el agente" value={cloudGoal} onChange={e=>setCloudGoal(e.target.value)}/>
        <label htmlFor="core-cloud-files">Dos a seis archivos de código, o auto para selección mediante IA</label>
        <input id="core-cloud-files" maxLength={900} className="dialog-text-input"
          placeholder="auto o apps/web/src/App.tsx#L100-L170,apps/web/src/agent.ts" value={cloudFiles} onChange={e=>setCloudFiles(e.target.value)}/>
        <button className="secondary-button" type="button" onClick={()=>setCloudFiles("auto")}>Seleccionar archivos con subagentes</button>
        {cloudFiles.trim().toLowerCase()==="auto"&&<p>Selección automática: autorizarás al subagente a elegir entre dos y seis módulos de código rastreados por Git. No podrá acceder a rutas privadas u ocultas. Puede requerir una llamada adicional al proveedor de IA.</p>}
        <p>En GitHub configura el secreto CORE_AGENT_API_KEY y, opcionalmente, las variables CORE_AGENT_PROVIDER y CORE_AGENT_MODEL. Activa permiso para crear PR mediante Actions. El código de los archivos seleccionados se envía al proveedor de IA configurado. Consume tokens y minutos de CI; revisa los archivos y el PR antes de autorizar.</p>
      </div>}
      <button className="primary-button" type="button" disabled={busy||loading||autopilot||(cloudCoder&&(!cloudGoal.trim()||!cloudFiles.trim()))} onClick={()=>void run()}>
        <Play size={14}/> {busy?'Procesando…':'Ejecutar workflow con confirmación'}
      </button>
      {dispatchLink&&<a href={dispatchLink} target="_blank" rel="noopener noreferrer">Abrir ejecución solicitada <ExternalLink size={13}/></a>}
    </div>}
    <div className="accounts-head">
      <strong>Historial de ejecuciones</strong>
      <button className="secondary-button" type="button" disabled={!selected||busy} onClick={()=>void refreshRuns()}><RefreshCw size={13}/> Actualizar</button>
    </div>
    {!runs.length&&<p>Selecciona un workflow para ver sus ejecuciones recientes.</p>}
    <div className="github-action-runs">
      {runs.map(run=><div className="github-action-run" key={run.id}>
        <span aria-hidden="true">{run.status==='completed'?(run.conclusion==='success'?<CheckCircle2 size={15}/>:<CircleAlert size={15}/>):<Clock3 size={15}/>}</span>
        <div><strong>{run.name||'Workflow'} #{run.id}</strong><small>{readableStatus(run)} · {run.event} · {run.created_at?.slice(0,16)||'Fecha desconocida'}</small></div>
        <a href={run.html_url} target="_blank" rel="noopener noreferrer" title="Abrir ejecución en GitHub"><ExternalLink size={15}/></a>
        {['in_progress','queued','waiting'].includes(run.status)&&<button type="button" className="secondary-button" disabled={busy} title="Solicitar cancelación" onClick={()=>void cancel(run)}><Square size={13}/></button>}
      </div>)}
    </div>
    <p className="github-actions-note"><Cloud size={14}/> Los resultados se consultan directamente en GitHub. Cerrar Core no detiene una ejecución iniciada; GitHub controla permisos, presupuesto y retención.</p>
  </div>;
}
