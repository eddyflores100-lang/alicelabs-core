import type {GithubRepoInfo,GithubFetch} from './githubWorkspace';
import {repoPath} from './githubWorkspace.ts';

export type GithubBatchFile={path:string;content:string;expectedSha:string};
export type GithubBatchPRResult={url:string;branch:string;commitSha:string;files:number};
type RepoFileResponse={sha?:string;type?:string};
type GithubObject={sha?:string;tree?:{sha?:string};object?:{sha?:string}};

const shaPattern=/^[a-f0-9]{40}$/i;
const bytes=(text:string)=>new TextEncoder().encode(text).byteLength;
function routeBase(repo:GithubRepoInfo){
  return '/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo);
}
async function req<T>(repo:GithubRepoInfo,token:string,path:string,method='GET',
  body?:object,request:GithubFetch=fetch):Promise<T>{
  if(!token||token.length<10)throw new Error('Se necesita una cuenta GitHub autorizada.');
  const url='https://api.github.com'+routeBase(repo)+path;
  const response=await request(url,{
    method,headers:{
      Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2026-03-10',
      'Content-Type':'application/json'
    },credentials:'omit',redirect:'error',cache:'no-store',
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)
  });
  if(!response.ok){
    if(response.status===401)throw new Error('GitHub rechazó la credencial de propietario.');
    if(response.status===403)throw new Error('GitHub denegó acceso: falta autorización a Contents o Pull Requests.');
    if(response.status===404)throw new Error('Archivo o repositorio GitHub no encontrado.');
    if([409,422].includes(response.status))throw new Error('GitHub detectó un conflicto o una rama protegida; vuelve a revisar.');
    throw new Error('GitHub API: HTTP '+response.status);
  }
  return response.json() as Promise<T>;
}
export function validateBatchGithubFiles(files:GithubBatchFile[]):GithubBatchFile[]{
  if(!Array.isArray(files)||files.length<2||files.length>8)
    throw new Error('Publica en un lote de 2 a 8 archivos existentes.');
  const paths=new Set<string>();let sum=0;
  for(const file of files){
    if(!file||typeof file.path!=='string'||typeof file.content!=='string'||
       typeof file.expectedSha!=='string'||!shaPattern.test(file.expectedSha))
      throw new Error('Algún archivo no tiene el SHA original de GitHub.');
    repoPath(file.path);
    if(paths.has(file.path))throw new Error('Hay archivos duplicados en el lote.');
    paths.add(file.path);
    sum+=bytes(file.content);
    if(bytes(file.content)>16000||sum>52000)throw new Error('Lote demasiado grande.');
  }
  return files;
}
export async function createGithubBatchPR(input:{
  repo:GithubRepoInfo;token:string;files:GithubBatchFile[];
  title:string;message:string;
},request:GithubFetch=fetch):Promise<GithubBatchPRResult>{
  const files=validateBatchGithubFiles(input.files);
  if(!input.token||input.token.length<10)throw new Error('Falta credencial GitHub autorizada.');
  if(!input.title.trim()||input.title.length>180||/[\u0000-\u001f]/.test(input.title))
    throw new Error('Título del Pull Request inválido.');
  if(!input.message.trim()||input.message.length>180)throw new Error('Mensaje del commit inválido.');
  if(!/^[A-Za-z0-9_.\/-]{1,200}$/.test(input.repo.branch)||
     input.repo.branch.startsWith('/')||input.repo.branch.includes('..'))
    throw new Error('Rama GitHub inválida.');
  const branchRef=await req<GithubObject>(input.repo,input.token,
    '/git/ref/heads/'+encodeURIComponent(input.repo.branch),'GET',undefined,request);
  const head=branchRef.object?.sha;
  if(!head||!shaPattern.test(head))throw new Error('GitHub no confirmó el SHA de la rama.');
  const headCommit=await req<GithubObject>(input.repo,input.token,
    '/git/commits/'+head,'GET',undefined,request);
  const baseTree=headCommit.tree?.sha;
  if(!baseTree||!shaPattern.test(baseTree))throw new Error('GitHub no confirmó el árbol base.');
  const treeData=await req<{truncated?:boolean;tree?:{path:string;type:string;mode:string}[]}>(input.repo,input.token,
    '/git/trees/'+baseTree+'?recursive=1','GET',undefined,request);
  if(treeData.truncated||!Array.isArray(treeData.tree))throw new Error('Árbol GitHub demasiado grande o incompleto para conservar permisos.');
  const fileModes=new Map(treeData.tree.filter(f=>f.type==='blob'&&['100644','100755'].includes(f.mode))
    .map(f=>[f.path,f.mode]));
  for(const f of files){
    if(!fileModes.has(f.path))throw new Error('Archivo no encontrado en el árbol GitHub: '+f.path);
  }
  // Optimistic concurrency check before creating any objects or refs.
  for(const f of files){
    const current=await req<RepoFileResponse>(input.repo,input.token,
      '/contents/'+repoPath(f.path)+'?ref='+encodeURIComponent(input.repo.branch),'GET',undefined,request);
    if(current.type!=='file'||current.sha!==f.expectedSha)
      throw new Error('El archivo remoto cambió: '+f.path+'. Actualiza el proyecto antes de crear el PR.');
  }
  const blobs=[];
  for(const f of files){
    const blob=await req<GithubObject>(input.repo,input.token,
      '/git/blobs','POST',{content:f.content,encoding:'utf-8'},request);
    if(!blob.sha||!shaPattern.test(blob.sha))throw new Error('GitHub no confirmó el contenido para '+f.path);
    blobs.push({path:f.path,mode:fileModes.get(f.path)!,type:'blob',sha:blob.sha});
  }
  const tree=await req<GithubObject>(input.repo,input.token,'/git/trees','POST',{
    base_tree:baseTree,tree:blobs
  },request);
  if(!tree.sha||!shaPattern.test(tree.sha))throw new Error('GitHub no confirmó el árbol del lote.');
  const commit=await req<GithubObject>(input.repo,input.token,'/git/commits','POST',{
    message:input.message.trim(),tree:tree.sha,parents:[head]
  },request);
  if(!commit.sha||!shaPattern.test(commit.sha))throw new Error('GitHub no confirmó el commit multiarchivo.');
  const branch='core/batch-'+Date.now().toString(36)+'-'+crypto.randomUUID().slice(0,8);
  await req(input.repo,input.token,'/git/refs','POST',{
    ref:'refs/heads/'+branch,sha:commit.sha
  },request);
  let url='';
  try{
    const pull=await req<{html_url?:string}>(input.repo,input.token,'/pulls','POST',{
      title:input.title.trim(),head:branch,base:input.repo.branch,
      body:'Propuesta multiarchivo generada en AliceLabs Core, revisada y confirmada por el propietario. Revisa las comprobaciones antes de fusionar.'
    },request);
    url=pull.html_url||'';
    const safe='https://github.com/'+input.repo.owner+'/'+input.repo.repo+'/pull/';
    if(!url.toLowerCase().startsWith(safe.toLowerCase())||
       !/^\d+$/.test(url.slice(safe.length)))throw new Error('GitHub no confirmó un PR válido.');
  }catch(error){
    throw new Error((error instanceof Error?error.message:'Error al crear PR')+
      '. El commit se conserva en la rama '+branch+' para recuperarlo manualmente.');
  }
  return {url,branch,commitSha:commit.sha,files:files.length};
}
