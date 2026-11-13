import {useCallback,useEffect,useState} from 'react';
import {Bot,CheckCircle2,Clock3,ExternalLink,PauseCircle,Play,RefreshCw,ShieldCheck} from 'lucide-react';
import type {GithubRepoInfo} from './githubWorkspace';
import {
  createApprovedAutopilotIssue,listApprovedAutopilotIssues,
  readAutopilotConfig,setAutopilotConfig
} from './githubAutopilot';
import type {AutopilotConfig,AutopilotQueueIssue} from './githubAutopilot';
import {getAutopilotInstallation,installAutopilotWorkflow,uninstallAutopilotWorkflow} from './githubAutopilotInstall';
import type {AutopilotInstallation} from './githubAutopilotInstall';

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
  const [installation,setInstallation]=useState<AutopilotInstallation|null>(null);
  const [installUrl,setInstallUrl]=useState('');
  const readStatus=useCallback(async()=>{
    try{
      const [current,issues,workflow]=await Promise.all([
        readAutopilotConfig(repo,token),
        listApprovedAutopilotIssues(repo,token),
        getAutopilotInstallation(repo,token)
      ]);
      setConfig(current);setLimit(current.dailyLimit);setQueue(issues);setInstallation(workflow);
    }catch(e){
      onNotice(e instanceof Error?e.message:'No se pudo consultar el autopiloto',true);
    }
  },[repo.owner,repo.repo,token,onNotice]);
  useEffect(()=>{void readStatus();},[readStatus]);
  async function install(){
    if(busy||installation?.builtin)return;
    if(!window.confirm('¿Instalar o actualizar el WORKFLOW de GitHub Actions en '+repo.owner+'/'+repo.repo+'?\n\n'+
      'Core creará un archivo YAML en la rama '+repo.branch+', fijado a una revisión concreta de AliceLabs Core. '+
      'El archivo declara un cron cada cinco minutos y permisos para Issues y Pull Requests. '+
      'Por defecto no activa llamadas pagadas ni procesa tareas; la activación se hace por separado.'))return;
    setBusy(true);
    try{
      const saved=await installAutopilotWorkflow(repo,token);
      setInstallUrl(saved.url);
      setInstallation({installed:true,managed:true,pin:saved.sourceSha,fileSha:saved.fileSha,builtin:false,conflict:false});
      onNotice('Workflow de GitHub instalado con versión Core fijada. No se activaron tareas pagadas.');
    }catch(error){onNotice(error instanceof Error?error.message:'No se pudo instalar workflow',true);}
    finally{setBusy(false);}
  }
  async function uninstall(){
    if(busy||installation?.builtin||!installation?.installed)return;
    if(config?.enabled||config?.codingEnabled){
      onNotice('Desactiva primero el autopiloto antes de quitar su workflow.',true);return;
    }
    if(!window.confirm('¿DESINSTALAR el workflow administrado por AliceLabs Core de '+
      repo.owner+'/'+repo.repo+'?\n\nSe borrará solamente el archivo de automatización identificado; no se tocarán otros workflows ni tareas existentes.'))return;
    setBusy(true);
    try{
      await uninstallAutopilotWorkflow(repo,token);
      setInstallation({installed:false,managed:false,pin:null,fileSha:null,builtin:false,conflict:false});
      setInstallUrl('');
      onNotice('Workflow del autopiloto retirado de GitHub.');
    }catch(e){onNotice(e instanceof Error?e.message:'No se pudo desinstalar el workflow',true);}
    finally{setBusy(false);}
  }
  async function toggle(enable:boolean){
    if(busy)return;
    if(enable&&!installation?.installed){onNotice('Instala primero el workflow del repositorio.',true);return;}
    if(enable && !window.confirm(
      '¿ACTIVAR el autopiloto de GitHub cada cinco minutos para este repositorio?\n\n'+
      'Solo ejecutará tareas de Issues aprobados. Hasta '+limit+' tareas de IA por día UTC, con un máximo de seis solicitudes al proveedor por tarea. '+
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
    if(!window.confirm('¿Crear un Issue de GitHub aprobado para que Core pueda modificar los archivos seleccionados cuando el autopiloto esté habilitado?\n\n'+goal.trim().slice(0,160)+(files.trim().toLowerCase()==='auto'?'\n\nPermiso AUTO: el agente elegirá archivos de código dentro de las rutas autorizadas.':'')+'\n\nLos nombres de archivos y el objetivo se guardarán en GitHub; el trabajo puede consumir API y minutos facturables.'))return;
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
    <div className="github-autopilot-installation">
      <strong>Instalación en este repositorio</strong>
      <p>{installation?.builtin?'Workflow incluido en Core':installation?.conflict?
        'Ya existe un workflow ajeno en esta ruta. No será sobrescrito.':installation?.installed?
        'Instalado · Core fijado a '+installation.pin?.slice(0,12):'No instalado; el cron no puede ejecutarse aquí.'}</p>
      {!installation?.builtin&&!installation?.conflict&&<button type="button" className="secondary-button"
        disabled={busy||installation===null} onClick={()=>void install()}>
        {installation?.installed?'Actualizar workflow fijado':'Instalar workflow del autopiloto'}</button>}
      {installation?.installed&&!installation.builtin&&<button type="button" className="secondary-button" disabled={busy||Boolean(config?.enabled||config?.codingEnabled)} onClick={()=>void uninstall()}>Desinstalar workflow</button>}
      {installUrl&&<a href={installUrl} rel="noopener noreferrer" target="_blank">Revisar workflow instalado <ExternalLink size={13}/></a>}
      <p>La instalación cambia el repositorio GitHub y requiere permisos Workflows: write y Contents: write. No inicia tareas de IA.</p>
    </div>
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
        <button type="button" className="primary-button" disabled={busy||!config||!installation?.installed} onClick={()=>void toggle(true)}><Play size={13}/> Activar con límite diario</button>}
    </div>
    <p className="github-autopilot-warning"><ShieldCheck size={14}/> Se requieren permisos GitHub Issues: write, Variables: write, Actions y Pull Requests; un secreto CORE_AGENT_API_KEY en GitHub. Las ejecuciones son bajo demanda, con presupuesto limitado y revisión obligatoria del PR.</p>
    <div className="github-autopilot-task-form">
      <strong>Agregar tarea aprobada a la cola</strong>
      <label htmlFor="core-auto-goal">Objetivo</label>
      <textarea id="core-auto-goal" rows={3} className="dialog-text-input" maxLength={1600}
        placeholder="Corrige una función y actualiza su prueba" value={goal} onChange={e=>setGoal(e.target.value)}/>
      <label htmlFor="core-auto-files">Dos a seis archivos o auto para selección mediante IA</label>
      <input id="core-auto-files" className="dialog-text-input" maxLength={900}
        placeholder="auto o apps/web/src/App.tsx#L120-L180,apps/web/src/agent.ts" value={files} onChange={e=>setFiles(e.target.value)}/>
      <button className="secondary-button" type="button" disabled={busy} onClick={()=>setFiles("auto")}>Permitir que los subagentes elijan archivos</button>
      {files.trim().toLowerCase()==="auto"&&<p>Este permiso permite seleccionar hasta seis archivos rastreados por Git dentro de src/, apps/web/src/, apps/api/src/ y apps/remote/src/. El subagente recibe solo un índice acotado; la edición se revisa mediante PR. Se añade una llamada al proveedor de IA.</p>}
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
