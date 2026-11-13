import { DurableObject } from 'cloudflare:workers';
import { validProject, safePath, safeCommand, safeText } from './policy.mjs';
import { validOptIn, whatsappReady, notifyWhatsApp } from './whatsapp.mjs';
import {validEncryptedVault} from './vault.mjs';
import {TASK_ACTIONS,validateTaskRequest,createTask,recordTaskStep,sanitizedTask} from './projectTasks.mjs';

const ORIGINS = new Set(['https://alicelabs-core.pages.dev', 'http://localhost', 'https://localhost', 'capacitor://localhost']);
function allowedOrigin(value) {
  if (!value) return '';
  try {
    const u = new URL(value);
    if (ORIGINS.has(u.origin) || value === 'capacitor://localhost') return value;
    if (u.protocol === 'https:' && u.hostname.endsWith('.alicelabs-core.pages.dev')) return value;
  } catch { /* invalid origin */ }
  return '';
}
function responseJson(data,status=200,origin='') {
  return new Response(JSON.stringify(data),{
    status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      ...(origin?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'}:{})}
  });
}
export default {
  async fetch(request,env,ctx) {
    const origin=request.headers.get('Origin');
    const allow=allowedOrigin(origin);
    if(origin&&!allow)return responseJson({error:'Origin no autorizado'},403);
    if(request.method==='OPTIONS') {
      if(!allow)return responseJson({error:'Origin no autorizado'},403);
      return new Response(null,{status:204,headers:{
        'Access-Control-Allow-Origin':allow,'Access-Control-Allow-Credentials':'true',
        'Access-Control-Allow-Methods':'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type',
        'Access-Control-Max-Age':'120','Vary':'Origin'
      }});
    }
    // Access must be attached to this Worker. There is deliberately no dev bypass.
    if(!ctx.access)return responseJson({error:'Acceso de Cloudflare Access requerido'},403,allow);
    const identity=await ctx.access.getIdentity();
    const owner=String(identity?.email||'').toLowerCase().trim();
    if(!owner||owner.length>254)return responseJson({error:'Identidad no verificada'},403,allow);
    const url=new URL(request.url);
    if(url.pathname==='/v1/owner/vault'){
      if(!['GET','PUT','DELETE'].includes(request.method))return responseJson({error:'Método no permitido'},405,allow);
      if(request.method!=='GET' && !allow)return responseJson({error:'Origen autorizado requerido'},403);
      let body='';
      if(request.method==='PUT'){
        body=await request.text();
        if(body.length>1100000)return responseJson({error:'Bóveda cifrada demasiado grande'},413,allow);
        let envelope;try{envelope=JSON.parse(body);}catch{return responseJson({error:'JSON inválido'},400,allow);}
        if(!validEncryptedVault(envelope))return responseJson({error:'Solo se acepta una bóveda cifrada válida'},400,allow);
      }
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('owner-vault:v1:'+owner));
      const name=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
      const internal=new Request('https://internal.local/vault',{method:request.method,...(body?{body}:{}),
        ...(body?{headers:{'Content-Type':'application/json'}}:{})});
      const result=await env.SANDBOX.getByName(name).fetch(internal);
      const headers=new Headers(result.headers);headers.set('Cache-Control','no-store');
      if(allow){headers.set('Access-Control-Allow-Origin',allow);headers.set('Access-Control-Allow-Credentials','true');}
      return new Response(result.body,{status:result.status,headers});
    }
    const match=url.pathname.match(/^\/v1\/projects\/([a-f0-9-]{36})\/(status|run|notify|tasks(?:\/[a-f0-9-]{36}(?:\/cancel)?)?|files(?:\/.*)?)$/i);
    if(!match||!validProject(match[1]))return responseJson({error:'Proyecto inválido'},404,allow);
    const action=match[2];
    if(action==='run') {
      if(request.method!=='POST')return responseJson({error:'Método inválido'},405,allow);
      const raw=await request.text();
      if(raw.length>8000)return responseJson({error:'Solicitud excesiva'},413,allow);
      let data;try{data=JSON.parse(raw);}catch{return responseJson({error:'JSON inválido'},400,allow);}
      const command=safeCommand(data);
      if(!command)return responseJson({error:'Comando no permitido o sin autorización explícita'},400,allow);
      request=new Request('https://internal.local/run',{method:'POST',body:JSON.stringify(command),
        headers:{'Content-Type':'application/json'}});
    } else if(action.startsWith('tasks')) {
      const validRoute=/^tasks(?:\/[a-f0-9-]{36}(?:\/cancel)?)?$/i.test(action);
      if(!validRoute)return responseJson({error:'Ruta de tarea inválida'},404,allow);
      const create=action==='tasks'&&request.method==='POST';
      const cancel=action.endsWith('/cancel')&&request.method==='POST';
      const remove=/^tasks\/[a-f0-9-]{36}$/i.test(action)&&request.method==='DELETE';
      const read=request.method==='GET'&&!action.endsWith('/cancel');
      if(!create&&!cancel&&!read&&!remove)return responseJson({error:'Método inválido'},405,allow);
      if(create){
        const raw=await request.text();
        if(raw.length>2200)return responseJson({error:'Plan demasiado grande'},413,allow);
        let value;try{value=JSON.parse(raw);}catch{return responseJson({error:'Plan JSON inválido'},400,allow);}
        const plan=validateTaskRequest(value);
        if(!plan)return responseJson({error:'Plan inválido o no aprobado'},400,allow);
        request=new Request('https://internal.local/tasks',{method:'POST',body:JSON.stringify(plan)});
      } else request=new Request('https://internal.local/'+action,{method:request.method});
    } else if(action==='notify') {
      if(request.method!=='GET' && request.method!=='PUT')return responseJson({error:'Método inválido'},405,allow);
      if(request.method==='PUT') {
        const raw=await request.text();
        if(raw.length>900)return responseJson({error:'Solicitud excesiva'},413,allow);
        let body;try{body=JSON.parse(raw);}catch{return responseJson({error:'JSON inválido'},400,allow);}
        const settings=validOptIn(body);
        if(!settings)return responseJson({error:'Requiere consentimiento explícito y número E.164 válido'},400,allow);
        request=new Request('https://internal.local/notify',{method:'PUT',body:JSON.stringify(settings),
          headers:{'Content-Type':'application/json'}});
      } else request=new Request('https://internal.local/notify');
    } else if(action==='status') {
      if(request.method!=='GET')return responseJson({error:'Método inválido'},405,allow);
      request=new Request('https://internal.local/status');
    } else {
      const path=safePath(action.slice(6));
      if(!path)return responseJson({error:'Ruta de archivo inválida'},400,allow);
      if(request.method==='PUT') {
        const text=await request.text();
        if(safeText(text)===null)return responseJson({error:'Solo archivos de texto de hasta 250 KB'},413,allow);
        request=new Request('https://internal.local/file/'+path,{method:'PUT',body:text,
          headers:{'Content-Type':'text/plain;charset=utf-8'}});
      } else if(request.method==='GET')request=new Request('https://internal.local/file/'+path);
      else return responseJson({error:'Método inválido'},405,allow);
    }
    // The namespace key is owner-bound so project IDs cannot reveal another account's files.
    const key=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner+':'+match[1].toLowerCase()));
    const name=Array.from(new Uint8Array(key)).map(x=>x.toString(16).padStart(2,'0')).join('');
    const result=await env.SANDBOX.getByName(name).fetch(request);
    const headers=new Headers(result.headers);
    headers.set('Cache-Control','no-store');
    if(allow){headers.set('Access-Control-Allow-Origin',allow);headers.set('Access-Control-Allow-Credentials','true');}
    return new Response(result.body,{status:result.status,headers});
  }
};
const PORT=8080;
export class ProjectSandbox extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.env=env;this.starting=null;this.runTail=Promise.resolve();}
  async fetch(request) {
    const url=new URL(request.url);
    const path=url.pathname;
    if(path==='/vault'){
      if(request.method==='GET'){
        const envelope=await this.ctx.storage.get('owner:encrypted-vault');
        return envelope?responseJson({ok:true,envelope}):responseJson({error:'No existe una bóveda sincronizada'},404);
      }
      if(request.method==='PUT'){
        const envelope=await request.json();
        if(!validEncryptedVault(envelope))return responseJson({error:'Bóveda cifrada inválida'},400);
        await this.ctx.storage.put('owner:encrypted-vault',envelope);
        return responseJson({ok:true,updatedAt:Date.now()});
      }
      if(request.method==='DELETE'){
        await this.ctx.storage.delete('owner:encrypted-vault');
        return responseJson({ok:true,deleted:true});
      }
      return responseJson({error:'Método no permitido'},405);
    }
    if(path==='/tasks' && request.method==='GET'){
      const records=await this.ctx.storage.list({prefix:'task:'});
      return responseJson({ok:true,tasks:[...records.values()].filter(x=>x&&x.id).map(sanitizedTask).sort((a,b)=>b.createdAt-a.createdAt).slice(0,30)});
    }
    if(path==='/tasks' && request.method==='POST'){
      const spec=validateTaskRequest({...await request.json(),approved:true});
      if(!spec)return responseJson({error:'Plan inválido'},400);
      const records=await this.ctx.storage.list({prefix:'task:'});
      if(records.size>=30)return responseJson({error:'Límite de 30 tareas; elimina tareas anteriores antes de continuar'},409);
      const job=createTask(spec,crypto.randomUUID());
      await this.ctx.storage.put('task:'+job.id,job);
      await this.ctx.storage.setAlarm(Date.now()+100);
      return responseJson({ok:true,task:sanitizedTask(job)},202);
    }
    const taskMatch=path.match(/^\/tasks\/([a-f0-9-]{36})(\/cancel)?$/i);
    if(taskMatch){
      const key='task:'+taskMatch[1];
      const task=await this.ctx.storage.get(key);
      if(!task)return responseJson({error:'Tarea no encontrada'},404);
      if(request.method==='GET'&&!taskMatch[2])return responseJson({ok:true,task:sanitizedTask(task)});
      if(request.method==='DELETE'&&!taskMatch[2]){
        if(['queued','running'].includes(task.status))return responseJson({error:'No se puede eliminar una tarea pendiente'},409);
        await this.ctx.storage.delete(key);
        return responseJson({ok:true,deleted:true});
      }
      if(request.method==='POST'&&taskMatch[2]){
        if(task.status==='queued'){
          const cancelled={...task,status:'cancelled',updatedAt:Date.now()};
          await this.ctx.storage.put(key,cancelled);
          return responseJson({ok:true,task:sanitizedTask(cancelled)});
        }
        return responseJson({error:'La tarea ya inició o terminó; no se puede cancelar el comando en ejecución'},409);
      }
      return responseJson({error:'Método inválido'},405);
    }
    if(path==='/status'){
      const map=await this.ctx.storage.list({prefix:'file:'});
      return responseJson({ok:true,files:map.size,running:!!this.ctx.container?.running,isolated:true});
    }
    if(path==='/notify'){
      if(request.method==='GET'){
        const settings=await this.ctx.storage.get('notification:settings');
        return responseJson({ok:true,enabled:!!settings?.enabled,
          configured:whatsappReady(this.env),
          recipient:settings?.to?('••••'+settings.to.slice(-4)):null});
      }
      if(request.method==='PUT'){
        const settings=validOptIn(await request.json());
        if(!settings)return responseJson({error:'Consentimiento o destinatario no válido'},400);
        await this.ctx.storage.put('notification:settings',settings);
        return responseJson({ok:true,enabled:settings.enabled,configured:whatsappReady(this.env)});
      }
      return responseJson({error:'Método inválido'},405);
    }
    if(path.startsWith('/file/')){
      const name=safePath(path.slice('/file/'.length));
      if(!name)return responseJson({error:'Ruta inválida'},400);
      const key='file:'+name;
      if(request.method==='GET'){
        const text=await this.ctx.storage.get(key);
        return typeof text==='string'?new Response(text,{headers:{'Content-Type':'text/plain;charset=utf-8','Cache-Control':'no-store'}}):responseJson({error:'Archivo no encontrado'},404);
      }
      if(request.method==='PUT'){
        const text=await request.text();
        if(safeText(text)===null)return responseJson({error:'Archivo demasiado grande'},413);
        const files=await this.ctx.storage.list({prefix:'file:'});
        if(!files.has(key)&&files.size>=80)return responseJson({error:'Máximo 80 archivos por espacio'},413);
        await this.ctx.storage.put(key,text);
        // Restore onto the active container, if any. No container starts for file uploads.
        if(this.ctx.container?.running) {
          try {await this.ctx.container.getTcpPort(PORT).fetch('http://container/file/'+name,{method:'PUT',body:text});}
          catch{/* next run rehydrates saved files */}
        }
        return responseJson({ok:true,path:name});
      }
      return responseJson({error:'Método inválido'},405);
    }
    if(path==='/run'&&request.method==='POST'){
      const command=await request.json();
      if(!safeCommand({...command,approved:true}))return responseJson({error:'Comando no permitido'},400);
      const job=this.runTail.then(()=>this.execute(command));
      this.runTail=job.catch(()=>{});
      try{return await job;}catch(e){return responseJson({error:'Sandbox no disponible: '+String(e.message||e).slice(0,150)},503);}
    }
    return responseJson({error:'Ruta desconocida'},404);
  }
  async alarm(){
    const jobs=await this.ctx.storage.list({prefix:'task:'});
    const active=[...jobs.values()].filter(x=>x&&['queued','running'].includes(x.status))
      .sort((a,b)=>a.createdAt-b.createdAt);
    if(!active.length)return;
    const task=active[0];
    const key='task:'+task.id;
    if(task.status==='running'){
      await this.ctx.storage.put(key,{...task,status:'failed',updatedAt:Date.now(),error:'Ejecución interrumpida: requiere revisión manual antes de reintentar'});
    } else {
      await this.ctx.storage.put(key,{...task,status:'running',updatedAt:Date.now()});
      let result;
      try {
        const selected=TASK_ACTIONS[task.steps[task.current]];
        if(!selected)throw Error('Paso no permitido');
        const step=this.runTail.then(()=>this.execute({...selected,approved:true},false));
        this.runTail=step.catch(()=>{});
        const response=await step;
        if(!response.ok)throw Error('El contenedor no pudo completar el paso');
        result=await response.json();
      } catch(error){result={ok:false,exitCode:null,output:String(error.message||error).slice(0,400)};}
      const next=recordTaskStep(task,task.steps[task.current],result);
      await this.ctx.storage.put(key,next);
      if(next.status==='completed'&&whatsappReady(this.env)){
        const settings=await this.ctx.storage.get('notification:settings');
        const last=Number(await this.ctx.storage.get('notification:last')||0);
        if(settings?.enabled&&settings.optIn&&Date.now()-last>60000){
          await this.ctx.storage.put('notification:last',Date.now());
          this.ctx.waitUntil(notifyWhatsApp(this.env,settings,task.id.slice(0,8),'tarea finalizada').catch(()=>({sent:false})));
        }
      }
    }
    const pending=await this.ctx.storage.list({prefix:'task:'});
    if([...pending.values()].some(x=>x?.status==='queued'))await this.ctx.storage.setAlarm(Date.now()+250);
  }
  async boot() {
    if(!this.ctx.container)throw Error('Cloudflare Containers no está habilitado');
    if(this.ctx.container.running)return;
    if(!this.starting)this.starting=(async()=>{
      this.ctx.container.start({
        image:this.ctx.container.images.base,instance:'lite',enableInternet:false
      });
      await this.ctx.container.setInactivityTimeout(120000);
      const port=this.ctx.container.getTcpPort(PORT);
      for(let i=0;i<70;i++){
        try{
          const r=await port.fetch('http://container/health',{signal:AbortSignal.timeout(800)});
          await r.body?.cancel();
          if(r.ok){
            const files=await this.ctx.storage.list({prefix:'file:'});
            for(const [key,value] of files){
              if(typeof value!=='string')continue;
              const path=key.slice(5);
              await port.fetch('http://container/file/'+path,{method:'PUT',body:value});
            }
            return;
          }
        }catch{/* continue while container boots */}
        await scheduler.wait(250);
      }
      throw Error('El contenedor no respondió');
    })().finally(()=>{this.starting=null;});
    return this.starting;
  }
  async execute(command,shouldNotify=true) {
    await this.boot();
    const port=this.ctx.container.getTcpPort(PORT);
    const run=await port.fetch('http://container/run',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(command),
      signal:AbortSignal.timeout(90000)});
    const output=await run.text();
    // Persist all text files after each approved command before returning its result.
    const snapshot=await port.fetch('http://container/snapshot',{signal:AbortSignal.timeout(15000)});
    if(snapshot.ok){
      const data=await snapshot.json();
      if(data.files&&Object.keys(data.files).length<=80){
        const current=await this.ctx.storage.list({prefix:'file:'});
        for(const key of current.keys())if(!(key.slice(5) in data.files))await this.ctx.storage.delete(key);
        for(const [path,text] of Object.entries(data.files))if(safePath(path)&&safeText(text)!==null)await this.ctx.storage.put('file:'+path,text);
      }
    }
    if(shouldNotify&&run.ok&&whatsappReady(this.env)){
      let result;try{result=JSON.parse(output);}catch{result={};}
      if(result.ok){
        const settings=await this.ctx.storage.get('notification:settings');
        const last=Number(await this.ctx.storage.get('notification:last')||0);
        if(settings?.enabled&&settings.optIn&&Date.now()-last>60000){
          await this.ctx.storage.put('notification:last',Date.now());
          this.ctx.waitUntil(notifyWhatsApp(this.env,settings,
            this.ctx.id.toString().slice(0,8),'tarea finalizada').catch(()=>({sent:false})));
        }
      }
    }
    return new Response(output,{status:run.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
}
