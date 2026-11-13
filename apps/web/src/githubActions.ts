import type {GithubRepoInfo,GithubFetch} from './githubWorkspace';
import {validateAutopilotGoal} from './githubAutopilot.ts';

export type GithubWorkflow = {
  id:number; name:string; path:string; state:string;
};
export type GithubWorkflowRun = {
  id:number; name:string; status:string; conclusion:string|null;
  html_url:string; event:string; created_at:string; head_branch:string|null;
};
export type GithubDispatchResult = {accepted:boolean;runId:number|null;url:string|null};

function base(repo:GithubRepoInfo):string {
  return '/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo);
}
function workflowId(id:number):number {
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Identificador de workflow inválido');
  return id;
}
function safeRunUrl(url:unknown,repo:GithubRepoInfo):string|null {
  if(typeof url!=='string')return null;
  try{
    const parsed=new URL(url);
    const path='/'+repo.owner+'/'+repo.repo+'/actions/runs/';
    if(parsed.protocol!=='https:'||parsed.hostname!=='github.com'||
      !parsed.pathname.toLowerCase().startsWith(path.toLowerCase())||
      !/^\d+$/.test(parsed.pathname.slice(path.length))||
      parsed.search||parsed.hash)return null;
    return parsed.toString();
  }catch{return null;}
}
async function api<T>(repo:GithubRepoInfo,token:string,route:string,method:'GET'|'POST',
  body?:object,request:GithubFetch=fetch):Promise<T|null>{
  if(!token||token.length<10)throw new Error('Conecta el token GitHub del propietario con acceso Actions.');
  if(!route.startsWith('/')||route.includes('://'))throw new Error('Ruta de GitHub Actions inválida');
  const response=await request('https://api.github.com'+base(repo)+route,{
    method,credentials:'omit',cache:'no-store',redirect:'error',
    headers:{
      Accept:'application/vnd.github+json','Content-Type':'application/json',
      'X-GitHub-Api-Version':'2026-03-10',Authorization:'Bearer '+token
    },
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)
  });
  if(!response.ok){
    if(response.status===401)throw new Error('GitHub rechazó el token; vuelve a conectar.');
    if(response.status===403)throw new Error('Falta permiso Actions o GitHub ha limitado la petición.');
    if(response.status===404)throw new Error('Workflow no encontrado o sin permisos de acceso.');
    if(response.status===422)throw new Error('El workflow no admite ejecución manual, o la rama no cumple sus condiciones.');
    throw new Error('GitHub Actions: HTTP '+response.status);
  }
  if(response.status===204||response.status===202||response.headers.get('content-length')==='0')return null;
  return response.json() as Promise<T>;
}
export async function listGithubWorkflows(repo:GithubRepoInfo,token:string,request:GithubFetch=fetch):Promise<GithubWorkflow[]> {
  const result=await api<{workflows?:GithubWorkflow[]}>(repo,token,'/actions/workflows?per_page=50','GET',undefined,request);
  if(!Array.isArray(result?.workflows))throw new Error('GitHub no devolvió un catálogo de workflows');
  return result.workflows.filter(w=>Number.isSafeInteger(w.id)&&w.id>0&&
    typeof w.name==='string'&&w.state==='active').slice(0,50);
}
export async function dispatchGithubWorkflow(repo:GithubRepoInfo,token:string,id:number,request:GithubFetch=fetch):Promise<GithubDispatchResult>{
  workflowId(id);
  const response=await api<{workflow_run_id?:number;html_url?:string}>(repo,token,
    '/actions/workflows/'+id+'/dispatches','POST',{ref:repo.branch},request);
  if(response && response.workflow_run_id!==undefined &&
     (!Number.isSafeInteger(response.workflow_run_id)||response.workflow_run_id<=0))
    throw new Error('GitHub devolvió un identificador de ejecución inválido');
  return {
    accepted:true,runId:response?.workflow_run_id||null,
    url:safeRunUrl(response?.html_url,repo)
  };
}
export function isCloudCoderWorkflow(workflow:GithubWorkflow|null):boolean{
  return Boolean(workflow&&
    /^\.github\/workflows\/(?:core-)?cloud-coder\.ya?ml$/i.test(workflow.path));
}
export async function dispatchGithubCloudCoder(repo:GithubRepoInfo,token:string,id:number,
  goal:string,files:string,request:GithubFetch=fetch):Promise<GithubDispatchResult>{
  workflowId(id);
  const task=validateAutopilotGoal(goal,files);
  const response=await api<{workflow_run_id?:number;html_url?:string}>(repo,token,
    '/actions/workflows/'+id+'/dispatches','POST',{
      ref:repo.branch,inputs:task
    },request);
  if(response && response.workflow_run_id!==undefined&&
     (!Number.isSafeInteger(response.workflow_run_id)||response.workflow_run_id<=0))
    throw new Error('GitHub devolvió un identificador inválido.');
  return {accepted:true,runId:response?.workflow_run_id||null,
    url:safeRunUrl(response?.html_url,repo)};
}
export async function listGithubRuns(repo:GithubRepoInfo,token:string,id:number,request:GithubFetch=fetch):Promise<GithubWorkflowRun[]>{
  workflowId(id);
  const response=await api<{workflow_runs?:GithubWorkflowRun[]}>(repo,token,
    '/actions/workflows/'+id+'/runs?per_page=12','GET',undefined,request);
  if(!Array.isArray(response?.workflow_runs))throw new Error('GitHub no devolvió las ejecuciones');
  return response.workflow_runs.filter(run=>Number.isSafeInteger(run.id)&&run.id>0&&
    Boolean(safeRunUrl(run.html_url,repo))).slice(0,12);
}
export async function cancelGithubRun(repo:GithubRepoInfo,token:string,runId:number,request:GithubFetch=fetch):Promise<boolean> {
  if(!Number.isSafeInteger(runId)||runId<=0)throw new Error('Ejecución inválida');
  await api(repo,token,'/actions/runs/'+runId+'/cancel','POST',undefined,request);
  return true;
}
