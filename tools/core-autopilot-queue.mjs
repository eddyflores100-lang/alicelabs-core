/**
 * Safe five-minute GitHub Autopilot queue.
 * Only repository-collaborator issues bearing an explicit approval label qualify.
 * Max three claimed tasks per UTC day; GitHub concurrency serializes claims.
 * The scanner never reads or executes repository code or calls an LLM.
 */
import {appendFile} from 'node:fs/promises';
import {parseScopedPaths} from './cloud-code-agent.mjs';

export const APPROVED='core-agent:approved';
export const CLAIMED='core-agent:claimed';
export const REVIEW='core-agent:review';
export const FAILED='core-agent:failed';
const MAX_DAILY=3;
const trustedAssociations=new Set(['OWNER','MEMBER','COLLABORATOR']);
const issueNumber=n=>Number.isSafeInteger(n)&&n>0&&n<=100000000;
function encode(s){return encodeURIComponent(String(s));}
function validRepo(s){return /^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(s)&&!s.includes('..');}
export function parseAutopilotIssue(issue){
  if(!issue||typeof issue!=='object'||!issueNumber(issue.number)||issue.pull_request||
     !trustedAssociations.has(issue.author_association)||issue.state!=='open')return null;
  const names=(Array.isArray(issue.labels)?issue.labels:[]).map(x=>typeof x==='string'?x:x?.name);
  if(!names.includes(APPROVED)||names.includes(CLAIMED))return null;
  if(typeof issue.body!=='string'||issue.body.length>2400)return null;
  let payload;
  try{payload=JSON.parse(issue.body);}catch{return null;}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
     typeof payload.goal!=='string'||typeof payload.files!=='string')return null;
  const goal=payload.goal.replace(/[\r\n\t]+/g,' ').trim();
  if(goal.length<5||goal.length>1600||/[\u0000-\u001f\u007f]/.test(goal))return null;
  let paths;
  try{paths=parseScopedPaths(payload.files);}catch{return null;}
  return {number:issue.number,goal,files:paths.join(',')};
}
function dailyLimit(value){
  const raw=Number(value);
  return Number.isSafeInteger(raw)&&raw>=1&&raw<=MAX_DAILY?raw:2;
}
export function chooseAutopilotIssue(issues,usage,limit){
  if(!Array.isArray(issues)||!Number.isSafeInteger(usage)||usage<0||
     usage>=dailyLimit(limit))return null;
  const candidates=issues.map(parseAutopilotIssue).filter(Boolean);
  candidates.sort((a,b)=>a.number-b.number);
  return candidates[0]||null;
}
export async function githubApi(repo,token,route,method='GET',body,request=fetch){
  if(!validRepo(repo)||typeof token!=='string'||token.length<10)throw new Error('Repositorio o token GitHub inválido.');
  if(!route.startsWith('/')||route.includes('://'))throw new Error('Ruta GitHub inválida.');
  const response=await request('https://api.github.com'+route,{
    method,credentials:'omit',redirect:'error',cache:'no-store',
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)
  });
  if(!response.ok){
    if(response.status===404)throw new Error('GitHub no encontró el recurso de la cola.');
    if(response.status===403)throw new Error('GitHub rechazó los permisos para Issues.');
    if(response.status===422)throw new Error('Etiqueta o contenido de Issue no válido.');
    throw new Error('GitHub queue HTTP '+response.status);
  }
  if(response.status===204)return null;
  return response.json();
}
async function ensureLabel(repo,token,label,color,description,request){
  const root='/repos/'+repo+'/labels';
  try{
    await githubApi(repo,token,root+'/'+encode(label),'GET',undefined,request);
    return;
  }catch(error){
    if(!(error instanceof Error)||!error.message.includes('no encontró'))throw error;
  }
  await githubApi(repo,token,root,'POST',{name:label,color,description},request);
}
export async function countClaimsToday({repo,token,now=new Date(),request=fetch}){
  const today=now.toISOString().slice(0,10)+'T00:00:00Z';
  // REST issues listing is immediately consistent enough for serialized claims;
  // search indexing can lag minutes and would risk claiming beyond the budget.
  const issues=await githubApi(repo,token,'/repos/'+repo+'/issues?state=all&labels='+
    encode(CLAIMED)+'&per_page=100&sort=updated&direction=desc','GET',undefined,request);
  if(!Array.isArray(issues))throw new Error('No se pudo verificar el límite de tareas del día.');
  return issues.filter(issue=>!issue.pull_request&&
    typeof issue.updated_at==='string'&&issue.updated_at>=today).length;
}
export async function claimNextAutopilotTask({
  repo,token,now=new Date(),limit=2,request=fetch
}){
  if(!validRepo(repo))throw new Error('Repositorio inválido.');
  const usage=await countClaimsToday({repo,token,now,request});
  if(usage>=dailyLimit(limit))return {task:null,usage,limit:dailyLimit(limit)};
  const response=await githubApi(repo,token,'/repos/'+repo+'/issues?state=open&labels='+
    encode(APPROVED)+'&per_page=50&sort=created&direction=asc','GET',undefined,request);
  if(!Array.isArray(response))throw new Error('GitHub no devolvió la cola de Issues.');
  const task=chooseAutopilotIssue(response,usage,limit);
  if(!task)return {task:null,usage,limit:dailyLimit(limit)};
  await ensureLabel(repo,token,CLAIMED,'235789','Autopilot claim; counts towards daily budget',request);
  const claimed=await githubApi(repo,token,'/repos/'+repo+'/issues/'+task.number+'/labels',
    'POST',{labels:[CLAIMED]},request);
  if(!Array.isArray(claimed)||!claimed.some(x=>x?.name===CLAIMED))
    throw new Error('No se pudo reservar de forma segura el Issue.');
  return {task,usage:usage+1,limit:dailyLimit(limit)};
}
export async function markAutopilotTask({repo,token,number,success,prUrl='',runUrl='',request=fetch}){
  if(!issueNumber(number))throw new Error('Issue inválido.');
  const label=success?REVIEW:FAILED;
  await ensureLabel(repo,token,label,success?'2f854a':'aa3333',
    success?'Agent PR ready for human review':'Autopilot workflow failed',request);
  await githubApi(repo,token,'/repos/'+repo+'/issues/'+number+'/labels',
    'POST',{labels:[label]},request);
  const safePr=typeof prUrl==='string'&&prUrl.startsWith('https://github.com/'+repo+'/pull/')&&
    /^\d+$/.test(prUrl.split('/').at(-1)||'')?prUrl:'';
  const message=success?'Core Cloud Coder preparó una propuesta para revisión humana.':
    'Core Cloud Coder no pudo completar este trabajo; no se reintentará automáticamente.';
  const safeRun=typeof runUrl==='string'&&runUrl.startsWith('https://github.com/'+repo+'/actions/runs/')?
    runUrl:'';
  await githubApi(repo,token,'/repos/'+repo+'/issues/'+number+'/comments',
    'POST',{body:message+(safePr?'\nPR: '+safePr:'')+(safeRun?'\nEjecución: '+safeRun:'')},request);
  return {number,label};
}
async function main(){
  const repo=process.env.GITHUB_REPOSITORY||'';
  const token=process.env.GITHUB_TOKEN||'';
  const mode=process.argv[2]||'claim';
  if(mode==='claim'){
    const result=await claimNextAutopilotTask({
      repo,token,limit:process.env.CORE_AUTOPILOT_DAILY_LIMIT||'2'
    });
    if(process.env.GITHUB_OUTPUT){
      const lines=result.task?[
        'issue='+result.task.number,'goal='+result.task.goal,'files='+result.task.files
      ]:['issue=','goal=','files='];
      await appendFile(process.env.GITHUB_OUTPUT,lines.join('\n')+'\n');
    }
    process.stdout.write(result.task?'Reserved approved issue #'+result.task.number+'\n':
      'No approved issue or daily budget exhausted.\n');
  }else if(mode==='finish'){
    const success=process.env.CORE_AUTOPILOT_RESULT==='success';
    const issue=Number(process.env.CORE_AUTOPILOT_ISSUE||0);
    const runUrl='https://github.com/'+repo+'/actions/runs/'+process.env.GITHUB_RUN_ID;
    const result=await markAutopilotTask({repo,token,number:issue,success,
      prUrl:process.env.CORE_AUTOPILOT_PR||'',runUrl});
    process.stdout.write('Issue #'+result.number+' marked '+result.label+'\n');
  }else throw new Error('Modo de autopiloto inválido.');
}
if(process.argv[1]?.endsWith('core-autopilot-queue.mjs')){
  main().catch(error=>{
    process.stderr.write('Autopilot queue: '+(error instanceof Error?error.message:'Error de cola').slice(0,230)+'\n');
    process.exitCode=1;
  });
}
