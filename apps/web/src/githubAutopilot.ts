import type {GithubRepoInfo,GithubFetch} from './githubWorkspace';
export const AUTOPILOT_APPROVED_LABEL='core-agent:approved';
export type AutopilotQueueIssue={number:number;title:string;html_url:string;created_at:string};
const pth=(repo:GithubRepoInfo)=>'/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo);
async function api<T>(repo:GithubRepoInfo,token:string,route:string,method='GET',body?:object,request:GithubFetch=fetch):Promise<T>{
  if(!token||token.length<10)throw new Error('Conecta un token GitHub autorizado para Issues.');
  if(!route.startsWith('/'))throw new Error('Ruta API inválida.');
  const response=await request('https://api.github.com'+pth(repo)+route,{
    method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'},
    credentials:'omit',redirect:'error',cache:'no-store',
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)
  });
  if(!response.ok){
    if(response.status===401)throw new Error('GitHub rechazó el token.');
    if(response.status===403)throw new Error('Falta autorización para Issues o ajustes del repositorio.');
    if(response.status===404)throw new Error('Repositorio, Issue o etiqueta no encontrados.');
    if(response.status===422)throw new Error('Datos del Issue inválidos o etiqueta no configurada.');
    throw new Error('GitHub Issues: HTTP '+response.status);
  }
  return response.json() as Promise<T>;
}
export function validScopedAutopilotFile(selector:string):boolean{
  const match=selector.match(/^(.*?)(?:#L([1-9]\d*)-L([1-9]\d*))?$/);
  if(!match)return false;
  const path=match[1];
  if(!/^(?:src\/|apps\/(?:web|api|remote)\/src\/)/.test(path)||
    path.length>220||path.startsWith('/')||path.includes('\\')||
    /[\u0000-\u001f\u007f]/.test(path)||
    path.split('/').some(part=>!part||part==='.'||part==='..')||
    !/\.(ts|tsx|js|jsx|css|md|json|py|go|rs|html)$/i.test(path))return false;
  if(match[2]){
    const start=Number(match[2]),end=Number(match[3]);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start||end-start>=200)return false;
  }
  return true;
}
export function validateAutopilotGoal(goal:string,files:string):{goal:string;files:string}{
  const summary=goal.replace(/[\r\n\t]/g,' ').trim();
  if(summary.length<5||summary.length>1600||/[\u0000-\u001f\u007f]/.test(summary))
    throw new Error('Especifica un objetivo de entre 5 y 1600 caracteres.');
  const paths=files.split(',').map(x=>x.trim()).filter(Boolean);
  const actualPaths=paths.map(value=>value.split('#L')[0]);
  if(paths.length<2||paths.length>6||new Set(actualPaths).size!==paths.length||
    paths.some(value=>!validScopedAutopilotFile(value)))
    throw new Error('Selecciona 2–6 archivos de src/ existentes y separados por comas.');
  return {goal:summary,files:paths.join(',')};
}
export async function createApprovedAutopilotIssue(
  repo:GithubRepoInfo,token:string,goal:string,files:string,request:GithubFetch=fetch
):Promise<{number:number;url:string}>{
  const task=validateAutopilotGoal(goal,files);
  // Only a repository writer can configure labels. This never exposes API credentials.
  let exists=false;
  try{
    const response=await request('https://api.github.com'+pth(repo)+'/labels/'+encodeURIComponent(AUTOPILOT_APPROVED_LABEL),{
      method:'GET',credentials:'omit',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(15000)
    });
    if(response.ok)exists=true;
    else if(response.status!==404)throw new Error('No se pudo comprobar la etiqueta del repositorio ('+response.status+').');
  }catch(error){
    if(error instanceof Error)throw error;
    throw new Error('No se pudo comprobar la etiqueta del repositorio.');
  }
  if(!exists){
    await api(repo,token,'/labels','POST',{name:AUTOPILOT_APPROVED_LABEL,
      color:'286a59',description:'Owner-approved Core Autopilot coding task'},request);
  }
  const response=await api<{number?:number;html_url?:string}>(repo,token,'/issues','POST',{
    title:'Core Autopilot: '+task.goal.slice(0,110),
    body:JSON.stringify(task),
    labels:[AUTOPILOT_APPROVED_LABEL]
  },request);
  if(!Number.isSafeInteger(response.number)||!response.number||response.number<1||
     !response.html_url?.startsWith('https://github.com/'+repo.owner+'/'+repo.repo+'/issues/'))
    throw new Error('GitHub no confirmó el Issue autorizado.');
  return {number:response.number,url:response.html_url};
}
export type AutopilotConfig={enabled:boolean;codingEnabled:boolean;dailyLimit:1|2|3};
const VARIABLE_NAMES=['CORE_AUTOPILOT_ENABLED','CORE_AUTOPILOT_CODING_ENABLED','CORE_AUTOPILOT_DAILY_LIMIT'] as const;
async function variableRequest<T>(repo:GithubRepoInfo,token:string,path:string,method='GET',body?:object,request:GithubFetch=fetch):Promise<T|null>{
  if(!token||token.length<10)throw new Error('Se necesita un token GitHub con permiso Variables.');
  const response=await request('https://api.github.com'+pth(repo)+'/actions/variables'+path,{
    method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'},
    credentials:'omit',redirect:'error',cache:'no-store',
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)
  });
  if(response.status===404)return null;
  if(!response.ok){
    if(response.status===403)throw new Error('El token no tiene permiso Variables: read/write para este repositorio.');
    throw new Error('GitHub Variables: HTTP '+response.status);
  }
  if(response.status===204)return null;
  return response.json() as Promise<T>;
}
async function readVariable(repo:GithubRepoInfo,token:string,name:string,request:GithubFetch):Promise<string>{
  const data=await variableRequest<{value?:string}>(repo,token,'/'+name,'GET',undefined,request);
  return data?.value||'';
}
async function writeVariable(repo:GithubRepoInfo,token:string,name:string,value:string,request:GithubFetch):Promise<void>{
  const current=await variableRequest<{value?:string}>(repo,token,'/'+name,'GET',undefined,request);
  if(current){
    await variableRequest(repo,token,'/'+name,'PATCH',{name,value},request);
  }else{
    await variableRequest(repo,token,'','POST',{name,value},request);
  }
}
export async function readAutopilotConfig(repo:GithubRepoInfo,token:string,request:GithubFetch=fetch):Promise<AutopilotConfig>{
  const values=await Promise.all(VARIABLE_NAMES.map(name=>readVariable(repo,token,name,request)));
  const n=Number(values[2]);
  return {enabled:values[0]==='true',codingEnabled:values[1]==='true',
    dailyLimit:[1,2,3].includes(n)?n as 1|2|3:2};
}
export async function setAutopilotConfig(repo:GithubRepoInfo,token:string,config:AutopilotConfig,request:GithubFetch=fetch):Promise<void>{
  if(![1,2,3].includes(config.dailyLimit))throw new Error('El presupuesto diario permite solamente de 1 a 3 tareas.');
  // Disable paid coding first; enable the last gate only after the other values are committed.
  if(!config.enabled||!config.codingEnabled){
    await writeVariable(repo,token,VARIABLE_NAMES[1],'false',request);
    await writeVariable(repo,token,VARIABLE_NAMES[0],'false',request);
    return;
  }
  await writeVariable(repo,token,VARIABLE_NAMES[1],'false',request);
  await writeVariable(repo,token,VARIABLE_NAMES[2],String(config.dailyLimit),request);
  await writeVariable(repo,token,VARIABLE_NAMES[0],'true',request);
  await writeVariable(repo,token,VARIABLE_NAMES[1],'true',request);
}
export async function listApprovedAutopilotIssues(
  repo:GithubRepoInfo,token:string,request:GithubFetch=fetch
):Promise<AutopilotQueueIssue[]>{
  const response=await api<Array<AutopilotQueueIssue&{pull_request?:object}>>(repo,token,
    '/issues?state=open&labels='+encodeURIComponent(AUTOPILOT_APPROVED_LABEL)+'&per_page=50','GET',undefined,request);
  if(!Array.isArray(response))throw new Error('GitHub no devolvió la cola.');
  return response.filter(issue=>!issue.pull_request&&Number.isSafeInteger(issue.number)&&
    issue.html_url?.startsWith('https://github.com/'+repo.owner+'/'+repo.repo+'/issues/')).slice(0,50);
}
