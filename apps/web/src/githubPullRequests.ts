import type {GithubRepoInfo,GithubFetch} from './githubWorkspace';

export type GithubPullRequest = {
  number:number;title:string;state:string;draft:boolean;html_url:string;
  head:{sha:string;ref:string};base:{ref:string};
  mergeable?:boolean|null;mergeable_state?:string|null;
  additions?:number;deletions?:number;changed_files?:number;
};
export type GithubPullFile = {
  filename:string;status:string;additions:number;deletions:number;patch?:string;
};
const validNumber=(n:number)=>Number.isSafeInteger(n)&&n>0;
const validSha=(v:string)=>/^[a-f0-9]{40}$/i.test(v);
function base(repo:GithubRepoInfo){
  return '/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo);
}
function validPRLink(link:unknown,repo:GithubRepoInfo):boolean{
  if(typeof link!=='string')return false;
  try{
    const url=new URL(link);
    return url.protocol==='https:'&&url.hostname==='github.com'&&
      url.pathname.toLowerCase().startsWith(('/'+repo.owner+'/'+repo.repo+'/pull/').toLowerCase())&&
      /^\d+$/.test(url.pathname.split('/').at(-1)||'')&&!url.search&&!url.hash;
  }catch{return false;}
}
async function api<T>(repo:GithubRepoInfo,token:string,route:string,method:'GET'|'PUT'='GET',
  body?:object,request:GithubFetch=fetch):Promise<T>{
  if(!token||token.length<10)throw new Error('Conecta el token GitHub del propietario.');
  if(!route.startsWith('/')||route.includes('://'))throw new Error('Ruta de Pull Request inválida');
  const response=await request('https://api.github.com'+base(repo)+route,{
    method,credentials:'omit',redirect:'error',cache:'no-store',
    headers:{Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2026-03-10',
      'Content-Type':'application/json',Authorization:'Bearer '+token},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(25000)
  });
  if(!response.ok){
    if(response.status===401)throw new Error('GitHub rechazó la credencial.');
    if(response.status===403)throw new Error('GitHub denegó la operación: faltan permisos o reglas de protección.');
    if(response.status===404)throw new Error('Pull Request no encontrado o sin autorización.');
    if(response.status===405)throw new Error('GitHub bloquea la fusión: estado de PR, comprobaciones o reglas del repositorio.');
    if(response.status===409)throw new Error('GitHub detectó una nueva revisión del PR: actualiza antes de fusionar.');
    if(response.status===422)throw new Error('GitHub rechazó la operación por datos o reglas no válidos.');
    throw new Error('GitHub Pull Requests: HTTP '+response.status);
  }
  return response.json() as Promise<T>;
}
export async function listGithubPullRequests(repo:GithubRepoInfo,token:string,request:GithubFetch=fetch):Promise<GithubPullRequest[]>{
  const result=await api<GithubPullRequest[]>(repo,token,'/pulls?state=open&per_page=30','GET',undefined,request);
  if(!Array.isArray(result))throw new Error('GitHub no devolvió una lista de PRs');
  return result.filter(pr=>validNumber(pr.number)&&pr.state==='open'&&validPRLink(pr.html_url,repo)).slice(0,30);
}
export async function getGithubPullRequest(repo:GithubRepoInfo,token:string,number:number,request:GithubFetch=fetch):Promise<GithubPullRequest>{
  if(!validNumber(number))throw new Error('Número de Pull Request inválido');
  const pr=await api<GithubPullRequest>(repo,token,'/pulls/'+number,'GET',undefined,request);
  if(pr.number!==number||!validPRLink(pr.html_url,repo))throw new Error('Respuesta de GitHub no válida');
  return pr;
}
export async function listGithubPullFiles(repo:GithubRepoInfo,token:string,number:number,request:GithubFetch=fetch):Promise<GithubPullFile[]>{
  if(!validNumber(number))throw new Error('Número de Pull Request inválido');
  const files=await api<GithubPullFile[]>(repo,token,'/pulls/'+number+'/files?per_page=100','GET',undefined,request);
  if(!Array.isArray(files))throw new Error('GitHub no devolvió los archivos cambiados');
  return files.filter(f=>typeof f.filename==='string'&&f.filename.length<600).slice(0,60)
    .map(f=>({filename:f.filename,status:f.status,additions:f.additions||0,
      deletions:f.deletions||0,patch:typeof f.patch==='string'?f.patch.slice(0,3800):undefined}));
}
export function canMergeGithubPR(pr:GithubPullRequest,repo:GithubRepoInfo):boolean{
  return pr.state==='open'&&pr.draft!==true&&pr.mergeable===true&&
    pr.mergeable_state==='clean'&&pr.base?.ref===repo.branch&&
    validSha(pr.head?.sha||'');
}
export async function mergeGithubPullRequest(repo:GithubRepoInfo,token:string,
  expected:GithubPullRequest,request:GithubFetch=fetch):Promise<{merged:boolean;sha:string}>{
  if(!validNumber(expected.number))throw new Error('Número de PR inválido');
  if(!canMergeGithubPR(expected,repo))throw new Error('El PR no cumple las condiciones de fusión segura.');
  // Re-read the authoritative PR status immediately before attempting a write.
  const current=await getGithubPullRequest(repo,token,expected.number,request);
  if(!canMergeGithubPR(current,repo)||current.head.sha!==expected.head.sha)
    throw new Error('El PR cambió o ya no supera las comprobaciones: revisa otra vez antes de fusionar.');
  const response=await api<{merged?:boolean;sha?:string}>(repo,token,
    '/pulls/'+expected.number+'/merge','PUT',{
      sha:expected.head.sha,merge_method:'squash',commit_title:expected.title.slice(0,180)
    },request);
  if(response.merged!==true||!response.sha||!validSha(response.sha))throw new Error('GitHub no confirmó una fusión válida.');
  return {merged:true,sha:response.sha};
}
