import { useState } from 'react';
import { ArrowRight, Cloud, CloudOff, ExternalLink, FileCode2, LoaderCircle, LockKeyhole, Play, ShieldCheck } from 'lucide-react';

const configured = String(import.meta.env.VITE_CORE_REMOTE_URL || '').trim().replace(/\/+$/, '');
function trustedRemote(value:string){
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      (u.hostname.endsWith('.workers.dev') || u.hostname.endsWith('.alicelabs.site') || u.hostname.endsWith('.alicelabs-core.pages.dev'));
  } catch { return false; }
}
const REMOTE = trustedRemote(configured) ? configured : '';
const ACTIONS = [
  { name:'Estado de Git', bin:'git', args:['status','--short'] },
  { name:'Directorio', bin:'pwd', args:[] },
  { name:'Node instalado', bin:'node', args:['--version'] },
  { name:'Dependencias del proyecto', bin:'pnpm', args:['install','--ignore-scripts'] },
  { name:'Pruebas del proyecto', bin:'pnpm', args:['test'] }
] as const;

export default function CloudRunnerPanel({projectId,workspaceName,activeFile,onNotice,onComplete,onClose}:{
  projectId:string;
  workspaceName:string;
  activeFile:{path:string;text:string}|null;
  onNotice:(message:string,isError?:boolean)=>void;
  onComplete:(message:string)=>void;
  onClose:()=>void;
}){
  const [status,setStatus]=useState<'not-connected'|'online'|'error'>('not-connected');
  const [busy,setBusy]=useState(false);
  const [command,setCommand]=useState('0');
  const [result,setResult]=useState('');
  const [notifyEnabled,setNotifyEnabled]=useState(false);
  const [notifyConfigured,setNotifyConfigured]=useState(false);
  const [notifyRecipient,setNotifyRecipient]=useState<string|null>(null);
  const [notifyPhone,setNotifyPhone]=useState('');
  const [notifyConsent,setNotifyConsent]=useState(false);
  const endpoint=REMOTE+'/v1/projects/'+encodeURIComponent(projectId);
  async function call(route:string,method:'GET'|'POST'|'PUT'='GET',body?:string){
    if(!REMOTE)throw new Error('No existe un servidor remoto configurado con Cloudflare Access');
    const r=await fetch(endpoint+route,{method,credentials:'include',cache:'no-store',
      headers:body===undefined?{}:{'Content-Type':method==='PUT'?'text/plain;charset=utf-8':'application/json'},
      ...(body===undefined?{}:{body}),signal:AbortSignal.timeout(80000)});
    const contentType=r.headers.get('content-type')||'';
    if(!contentType.includes('application/json') && !(route.startsWith('/files/') && method==='GET'))
      throw new Error('Se necesita autenticación de Cloudflare Access. Abre la página del servidor para iniciar sesión.');
    const response=await r.json() as {ok?:boolean;error?:string;output?:string;exitCode?:number;files?:number;running?:boolean;enabled?:boolean;configured?:boolean;recipient?:string|null};
    if(!r.ok||response.error)throw new Error(response.error||'Error remoto '+r.status);
    return response;
  }
  async function check(){
    setBusy(true);
    try{
      const r=await call('/status');
      setStatus('online');
      try {
        const current=await call('/notify');
        setNotifyEnabled(current.enabled===true);
        setNotifyConfigured(current.configured===true);
        setNotifyRecipient(current.recipient||null);
      } catch { setNotifyConfigured(false); }
      setResult('Proyecto autenticado · '+String(r.files||0)+' archivos · '+(r.running?'Entorno activo':'Entorno detenido'));
    }catch(e){setStatus('error');setResult(e instanceof Error?e.message:'No se pudo verificar la sesión');}
    finally{setBusy(false);}
  }
  async function saveNotification(enabled:boolean){
    if(enabled && (!notifyConsent || !/^\+[1-9]\d{7,14}$/.test(notifyPhone.trim()))){
      onNotice('Indica número E.164 y acepta recibir avisos antes de activar WhatsApp.',true);
      return;
    }
    if(!window.confirm(enabled
      ? '¿Activar avisos automáticos de tareas terminadas a este número por WhatsApp oficial?'
      : '¿Desactivar avisos automáticos de este proyecto?'))return;
    setBusy(true);
    try {
      const body=enabled?{enabled:true,optIn:true,to:notifyPhone.trim()}:{enabled:false};
      const r=await call('/notify','PUT',JSON.stringify(body));
      setNotifyEnabled(r.enabled===true);
      setNotifyPhone('');setNotifyConsent(false);
      setNotifyRecipient(enabled?'Número registrado (oculto)':null);
      onNotice(enabled?'Avisos WhatsApp habilitados para este proyecto':'Avisos WhatsApp desactivados');
    }catch(e){onNotice(e instanceof Error?e.message:'No se pudo cambiar la suscripción',true);}
    finally{setBusy(false);}
  }
  async function sendFile(){
    if(!activeFile)return;
    if(activeFile.text.length>250000){onNotice('Este archivo supera el límite remoto de 250 KB',true);return;}
    if(!/^[\w.@+-]+(?:\/[\w.@+-]+)*$/.test(activeFile.path)){onNotice('Ruta no admitida en la nube',true);return;}
    if(!window.confirm('¿Enviar '+activeFile.path+' al entorno remoto privado del proyecto '+workspaceName+'? No incluyas contraseñas ni archivos sensibles.'))return;
    setBusy(true);
    try{
      await call('/files/'+activeFile.path,'PUT',activeFile.text);
      onNotice('Archivo enviado al espacio remoto de este proyecto');
      setResult('Archivo enviado: '+activeFile.path);
    }catch(e){onNotice(e instanceof Error?e.message:'No se pudo enviar el archivo',true);}
    finally{setBusy(false);}
  }
  async function run(){
    const action=ACTIONS[Number(command)]||ACTIONS[0];
    const exact=[action.bin,...action.args].join(' ');
    if(!window.confirm('¿Autorizar el comando remoto en el contenedor aislado de este proyecto?\n\n'+exact+'\n\nEl comando puede modificar sus archivos.'))return;
    setBusy(true);
    try{
      const data=await call('/run','POST',JSON.stringify({bin:action.bin,args:action.args,approved:true}));
      setResult('$ '+exact+'\n\n'+String(data.output||'(sin salida)')+'\n\nexit '+String(data.exitCode??'desconocido'));
      onComplete('Comando remoto finalizado: '+exact);
    }catch(e){setResult(e instanceof Error?e.message:'No se pudo ejecutar el comando');onNotice('No se completó el comando en la nube',true);}
    finally{setBusy(false);}
  }
  return <div className="cloud-manager">
    <div className="cloud-manager-intro"><Cloud size={24}/><div><strong>Entorno remoto del proyecto</strong>
      <p>Proyecto: {workspaceName} · {projectId.slice(0,8)} · Cloudflare Access + contenedor aislado</p></div></div>
    {!REMOTE ? <div className="cloud-unconfigured"><CloudOff size={19}/><div><strong>Nube todavía no configurada</strong>
      <p>El cliente web ya está preparado, pero el runner no está publicado. Requiere configurar Cloudflare Access y activar Containers en una cuenta de pago. No se ejecutan comandos mientras no exista ese servidor privado.</p>
      <a href="https://github.com/eddyflores100-lang/alicelabs-core/blob/main/apps/remote/README.md" target="_blank" rel="noopener noreferrer">Guía técnica de activación <ExternalLink size={13}/></a></div></div>
    : <>
      <div className="cloud-action-row"><button className="secondary-button" onClick={()=>window.open(endpoint+'/status','_blank','noopener')}><LockKeyhole size={14}/> Abrir autenticación <ExternalLink size={13}/></button>
        <button className="secondary-button" onClick={()=>void check()} disabled={busy}>{busy?<LoaderCircle size={14} className="spin"/>:<ShieldCheck size={14}/>} Comprobar acceso</button></div>
      <div className="cloud-status">{status==='online'?'Identidad autorizada y servicio disponible':status==='error'?'No se ha podido comprobar Access':'Autenticación pendiente'}</div>
      <div className="cloud-action-row"><span><FileCode2 size={15}/> {activeFile?.path||'Ningún archivo abierto'}</span><button className="secondary-button" onClick={()=>void sendFile()} disabled={busy||status!=='online'||!activeFile}>Enviar archivo <ArrowRight size={13}/></button></div>
      <section className="cloud-whatsapp" aria-label="Avisos WhatsApp del proyecto">
        <strong>Avisos WhatsApp al terminar tareas</strong>
        <p>Requiere un servidor privado activo, la integración oficial de Meta y tu consentimiento. No envía código ni secretos del proyecto.</p>
        <p>Estado: {notifyEnabled?'Activado':'Desactivado'} · {notifyConfigured?'Meta configurado':'Meta no configurado'} {notifyRecipient?'· '+notifyRecipient:''}</p>
        {!notifyEnabled && <>
          <label>Teléfono internacional (E.164)</label>
          <input className="dialog-text-input" type="tel" inputMode="tel" autoComplete="tel" value={notifyPhone} onChange={e=>setNotifyPhone(e.target.value)} placeholder="+593..." maxLength={16}/>
          <label><input type="checkbox" checked={notifyConsent} onChange={e=>setNotifyConsent(e.target.checked)}/> Acepto recibir notificaciones de finalización por WhatsApp en este número.</label>
        </>}
        <div className="cloud-action-row">
          {!notifyEnabled
            ? <button className="secondary-button" type="button" disabled={busy||!notifyConfigured||!notifyConsent||!/^\+[1-9]\d{7,14}$/.test(notifyPhone.trim())} onClick={()=>void saveNotification(true)}>Activar avisos</button>
            : <button className="secondary-button" type="button" disabled={busy} onClick={()=>void saveNotification(false)}>Desactivar avisos</button>}
        </div>
      </section>
      <label className="cloud-action-label">Comando permitido (requiere confirmación)</label>
      <div className="cloud-action-row"><select value={command} onChange={e=>setCommand(e.target.value)} disabled={busy}>{ACTIONS.map((a,i)=><option value={String(i)} key={a.name}>{a.name}: {[a.bin,...a.args].join(' ')}</option>)}</select><button className="primary-button" onClick={()=>void run()} disabled={busy||status!=='online'}><Play size={14}/> Ejecutar con aprobación</button></div>
    </>}
    {!!result && <pre className="cloud-result" role="status">{result}</pre>}
    <div className="cloud-security"><ShieldCheck size={16}/> Aislamiento por cuenta y proyecto. Sin terminal pública, sin permisos generales del móvil y sin acceso remoto a tu computadora. Las credenciales se verifican con Cloudflare Access.</div>
    <div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button></div>
  </div>;
}
