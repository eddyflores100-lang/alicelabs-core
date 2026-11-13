/**
 * Browser-only GitHub workspace access with an owner-provided fine-grained PAT.
 * Tokens are held in memory, never in URLs, IndexedDB, logs or repo snapshots.
 * Writes are guarded by GitHub's blob sha optimistic concurrency requirement.
 */
export type GithubRepoInfo = {
  owner:string;repo:string;branch:string;private:boolean;permissions?:{push?:boolean};
};
export type GithubFile = {text:string;sha:string};
export type GithubFetch = typeof fetch;
const API = 'https://api.github.com';

function validPart(part:string):boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(part) && part!=='.' && part!=='..';
}
export function repoIdentity(raw:string):{owner:string;repo:string} {
  let value=raw.trim();
  if(value.startsWith('https://github.com/'))value=value.slice('https://github.com/'.length);
  value=value.replace(/\.git$/,'').replace(/\/$/,'');
  const match=value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if(!match||!validPart(match[1])||!validPart(match[2]))throw new Error('Usa https://github.com/propietario/repositorio');
  return {owner:match[1],repo:match[2]};
}
export function repoPath(raw:string):string {
  if(typeof raw!=='string'||raw.length>900||raw.startsWith('/')||raw.includes('\\')||/[\x00-\x1f\x7f]/.test(raw))throw new Error('Ruta inválida');
  const pieces=raw.split('/');
  if(pieces.length>20||pieces.some(x=>!x||x==='.'||x==='..'||x.length>255))throw new Error('Ruta de archivo no admitida');
  return pieces.map(encodeURIComponent).join('/');
}
export function utf8ToBase64(text:string):string {
  const bytes=new TextEncoder().encode(text);
  let binary='';
  for(let i=0;i<bytes.length;i+=0x6000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x6000));
  return btoa(binary);
}
export function base64ToUtf8(input:string):string {
  const bytes=Uint8Array.from(atob(input.replace(/\s/g,'')),c=>c.charCodeAt(0));
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
async function githubRequest<T>(route:string,token:string,method='GET',body?:object,request:GithubFetch=fetch):Promise<T> {
  if(!route.startsWith('/')||route.includes('://'))throw new Error('Ruta API GitHub inválida');
  const headers:Record<string,string>={
    Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'
  };
  if(token)headers.Authorization='Bearer '+token;
  if(body)headers['Content-Type']='application/json';
  const response=await request(API+route,{
    method,headers,cache:'no-store',redirect:'error',credentials:'omit',
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)
  });
  if(!response.ok){
    if(response.status===401)throw new Error('GitHub rechazó el token: verifica que sea válido.');
    if(response.status===403)throw new Error('GitHub denegó la operación: faltan permisos o hay límites de API.');
    if(response.status===404)throw new Error('Repositorio o archivo no encontrado, o sin permisos de acceso.');
    if(response.status===409||response.status===422)throw new Error('Conflicto de GitHub: otro cambio, rama protegida o validación fallida. Actualiza antes de publicar.');
    throw new Error('GitHub API: error HTTP '+response.status);
  }
  return response.json() as Promise<T>;
}
export async function inspectGithubRepo(raw:string,token:string,request:GithubFetch=fetch):Promise<GithubRepoInfo> {
  const {owner,repo}=repoIdentity(raw);
  const info=await githubRequest<{
    full_name?:string;default_branch?:string;private?:boolean;permissions?:{push?:boolean};
  }>('/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo),token,'GET',undefined,request);
  if(!info.default_branch)throw new Error('GitHub no informó la rama principal');
  if(info.private&&!token)throw new Error('Conecta una cuenta GitHub autorizada para este repositorio privado.');
  return {owner,repo,branch:info.default_branch,private:info.private===true,permissions:info.permissions};
}
export async function githubFileRead(repo:GithubRepoInfo,path:string,token:string,request:GithubFetch=fetch):Promise<GithubFile> {
  const encoded=repoPath(path);
  const data=await githubRequest<{type?:string;size?:number;encoding?:string;content?:string;sha?:string}>(
    '/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo)+'/contents/'+encoded+
    '?ref='+encodeURIComponent(repo.branch),token,'GET',undefined,request);
  if(data.type!=='file'||data.encoding!=='base64'||!data.content||!data.sha||typeof data.size!=='number'||data.size>900000||data.size<0||data.content.length>1250000)
    throw new Error('GitHub no devolvió un archivo de texto admitido (máximo 900 KB).');
  const text=base64ToUtf8(data.content);
  if(text.includes('\0'))throw new Error('No se admiten archivos binarios');
  return {text,sha:data.sha};
}
export async function githubFileCommit(input:{
  repo:GithubRepoInfo;path:string;text:string;sha:string;token:string;message:string;branch?:string;
},request:GithubFetch=fetch):Promise<{sha:string;commitSha:string}> {
  if(!input.token||input.token.trim().length<10)throw new Error('Se requiere un token autorizado para publicar.');
  if(!/^[a-f0-9]{40}$/i.test(input.sha))throw new Error('Falta el SHA de la versión original. Vuelve a abrir el archivo.');
  if(new TextEncoder().encode(input.text).length>900000||input.text.includes('\0'))throw new Error('Solo archivos de texto de hasta 900 KB.');
  if(!input.message.trim()||input.message.trim().length>180)throw new Error('Mensaje de commit inválido.');
  const route='/repos/'+encodeURIComponent(input.repo.owner)+'/'+encodeURIComponent(input.repo.repo)+'/contents/'+repoPath(input.path);
  const value=await githubRequest<{content?:{sha?:string};commit?:{sha?:string}}>(route,input.token,'PUT',{
    message:input.message.trim(),content:utf8ToBase64(input.text),sha:input.sha,branch:input.branch||input.repo.branch
  },request);
  if(!value.content?.sha||!value.commit?.sha)throw new Error('GitHub no devolvió la confirmación del commit.');
  return {sha:value.content.sha,commitSha:value.commit.sha};
}
export async function githubFileCreate(input:{
  repo:GithubRepoInfo;path:string;text:string;token:string;message:string;branch?:string;
},request:GithubFetch=fetch):Promise<{sha:string;commitSha:string}>{
  if(!input.token||input.token.trim().length<10)throw new Error('Se requiere un token autorizado para crear un archivo.');
  if(new TextEncoder().encode(input.text).length>900000||input.text.includes('\0'))throw new Error('Solo archivos de texto de hasta 900 KB.');
  if(!input.message.trim()||input.message.trim().length>180)throw new Error('Mensaje de commit inválido.');
  const route='/repos/'+encodeURIComponent(input.repo.owner)+'/'+encodeURIComponent(input.repo.repo)+'/contents/'+repoPath(input.path);
  const value=await githubRequest<{content?:{sha?:string};commit?:{sha?:string}}>(route,input.token,'PUT',{
    message:input.message.trim(),content:utf8ToBase64(input.text),branch:input.branch||input.repo.branch
  },request);
  if(!value.content?.sha||!value.commit?.sha)throw new Error('GitHub no devolvió la confirmación del commit.');
  return {sha:value.content.sha,commitSha:value.commit.sha};
}
export async function githubTree(repo:GithubRepoInfo,token:string,request:GithubFetch=fetch):Promise<{path:string;type:string}[]> {
  const route='/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo)+'/git/trees/'+encodeURIComponent(repo.branch)+'?recursive=1';
  const data=await githubRequest<{truncated?:boolean;tree?:{path:string;type:string}[]}>(route,token,'GET',undefined,request);
  if(data.truncated||!Array.isArray(data.tree))throw new Error('Repositorio demasiado grande o sin árbol accesible.');
  return data.tree;
}


export async function githubProposePullRequest(input:{
  repo:GithubRepoInfo;path:string;text:string;sha?:string;token:string;title:string;message:string;
},request:GithubFetch=fetch):Promise<{url:string;branch:string;commitSha:string}>{
  if(!input.token||input.token.trim().length<10)throw new Error('Para crear un PR se requiere una cuenta GitHub autorizada.');
  const title=input.title.trim();
  if(!title||title.length>180||/[\x00-\x1F]/.test(title))throw new Error('Título de PR inválido.');
  repoPath(input.path);
  const base='/repos/'+encodeURIComponent(input.repo.owner)+'/'+encodeURIComponent(input.repo.repo);
  const ref=await githubRequest<{object?:{sha?:string}}>(base+'/git/ref/heads/'+encodeURIComponent(input.repo.branch),input.token,'GET',undefined,request);
  if(!ref.object?.sha||!/^[a-f0-9]{40}$/i.test(ref.object.sha))throw new Error('GitHub no proporcionó la referencia de la rama de origen.');
  const branch='core/'+Date.now().toString(36)+'-'+crypto.randomUUID().slice(0,8);
  await githubRequest(base+'/git/refs',input.token,'POST',{ref:'refs/heads/'+branch,sha:ref.object.sha},request);
  let commitSha='';
  try {
    const version=input.sha
      ? await githubFileCommit({...input,branch,sha:input.sha},request)
      : await githubFileCreate({...input,branch},request);
    commitSha=version.commitSha;
    const response=await githubRequest<{html_url?:string}>(base+'/pulls',input.token,'POST',{
      title,head:branch,base:input.repo.branch,
      body:'Propuesta creada y aprobada en AliceLabs Core para el archivo '+input.path+'. Revisa el diff y las pruebas antes de fusionar.'
    },request);
    if(!response.html_url||!response.html_url.startsWith('https://github.com/'))throw new Error('GitHub no confirmó la URL del Pull Request.');
    return {url:response.html_url,branch,commitSha};
  }catch(error){
    throw new Error((error instanceof Error?error.message:'Error de GitHub')+
      ' La rama '+branch+' quedó creada; revisa la rama en GitHub antes de reintentar. '+
      (commitSha?'El commit '+commitSha.slice(0,10)+' se guardó.':''));
  }
}
