import type {GithubRepoInfo,GithubFetch} from './githubWorkspace.ts';
import {base64ToUtf8,utf8ToBase64} from './githubWorkspace.ts';

/** Install a pinned, opt-in Core Autopilot workflow in one owner-approved repository. */
export const CORE_AUTOPILOT_WORKFLOW_PATH='.github/workflows/alicelabs-core-autopilot.yml';
const CORE='eddyflores100-lang/alicelabs-core';
const MARKER='# AliceLabs Core managed autopilot - owner opt-in';
const shaPattern=/^[a-f0-9]{40}$/i;
const D=String.fromCharCode(36);
export type AutopilotInstallation={
  installed:boolean;managed:boolean;pin:string|null;fileSha:string|null;builtin:boolean;conflict:boolean;
};
function isBuiltin(repo:GithubRepoInfo){return (repo.owner+'/'+repo.repo).toLowerCase()===CORE.toLowerCase();}
function root(repo:GithubRepoInfo){
  return 'https://api.github.com/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo);
}
function headers(token?:string):Record<string,string>{
  return {Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',
    ...(token?{Authorization:'Bearer '+token}:{})};
}
export function renderAutopilotWorkflow(sourceSha:string):string{
  if(!shaPattern.test(sourceSha))throw new Error('SHA de Core inválido.');
  return [
    MARKER,
    '# Review the pinned source before enabling model inference.',
    'name: AliceLabs Core Autopilot (owner opt-in)',
    'on:',
    '  schedule:',
    "    - cron: '*/5 * * * *'",
    '  workflow_dispatch:',
    'permissions:',
    '  contents: write',
    '  issues: write',
    '  pull-requests: write',
    'concurrency:',
    '  group: alicelabs-core-autopilot-'+D+'{{ github.repository }}',
    '  cancel-in-progress: false',
    'jobs:',
    '  run:',
    "    if: "+D+"{{ vars.CORE_AUTOPILOT_ENABLED == 'true' }}",
    '    uses: '+CORE+'/.github/workflows/core-autopilot.yml@'+sourceSha,
    '    with:',
    '      engine_sha: '+sourceSha,
    '    secrets:',
    '      CORE_AGENT_API_KEY: '+D+'{{ secrets.CORE_AGENT_API_KEY }}',
    ''
  ].join('\n');
}
export async function getAutopilotInstallation(repo:GithubRepoInfo,token:string,
  request:GithubFetch=fetch):Promise<AutopilotInstallation>{
  if(isBuiltin(repo))return {installed:true,managed:true,pin:null,fileSha:null,builtin:true,conflict:false};
  if(!token||token.length<10)throw new Error('Conecta un token GitHub autorizado.');
  const url=root(repo)+'/contents/'+CORE_AUTOPILOT_WORKFLOW_PATH+'?ref='+encodeURIComponent(repo.branch);
  const response=await request(url,{method:'GET',headers:headers(token),cache:'no-store',
    credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status===404)return {installed:false,managed:false,pin:null,fileSha:null,builtin:false,conflict:false};
  if(!response.ok)throw new Error('GitHub no permitió consultar el workflow ('+response.status+').');
  const data=await response.json() as {type?:string;encoding?:string;content?:string;sha?:string};
  if(data.type!=='file'||data.encoding!=='base64'||typeof data.content!=='string'||
    data.content.length>10000||!data.sha||!shaPattern.test(data.sha))
    throw new Error('El workflow remoto no tiene un formato compatible.');
  let decoded='';
  try{decoded=base64ToUtf8(data.content);}catch{throw new Error('Workflow remoto no tiene UTF-8 válido.');}
  if(!decoded.startsWith(MARKER))
    return {installed:false,managed:false,pin:null,fileSha:data.sha,builtin:false,conflict:true};
  const pin=decoded.match(/uses: eddyflores100-lang\/alicelabs-core\/\.github\/workflows\/core-autopilot\.yml@([a-f0-9]{40})/i)?.[1]||null;
  return {installed:Boolean(pin),managed:true,pin,fileSha:data.sha,builtin:false,conflict:false};
}
export async function installAutopilotWorkflow(repo:GithubRepoInfo,token:string,
  request:GithubFetch=fetch):Promise<{sourceSha:string;fileSha:string;url:string}>{
  if(isBuiltin(repo))throw new Error('Core ya incluye el workflow.');
  if(!token||token.length<10)throw new Error('GitHub requiere un token con permisos Workflows: write.');
  const current=await getAutopilotInstallation(repo,token,request);
  if(current.conflict)throw new Error('Ya existe un workflow ajeno con ese nombre: no se sobrescribirá.');
  // Public Core source: never forward a PAT from an unrelated repository.
  const upstream=await request('https://api.github.com/repos/'+CORE+'/commits/main',{
    method:'GET',headers:headers(),cache:'no-store',credentials:'omit',
    redirect:'error',signal:AbortSignal.timeout(15000)
  });
  if(!upstream.ok)throw new Error('No se pudo verificar la revisión pública de Core.');
  const source=await upstream.json() as {sha?:string};
  if(!source.sha||!shaPattern.test(source.sha))throw new Error('Core no devolvió un SHA verificable.');
  const response=await request(root(repo)+'/contents/'+CORE_AUTOPILOT_WORKFLOW_PATH,{
    method:'PUT',headers:{...headers(token),'Content-Type':'application/json'},
    cache:'no-store',credentials:'omit',redirect:'error',
    body:JSON.stringify({
      message:current.fileSha?'Core: actualizar autopiloto aprobado':'Core: instalar autopiloto aprobado',
      content:utf8ToBase64(renderAutopilotWorkflow(source.sha)),branch:repo.branch,
      ...(current.fileSha?{sha:current.fileSha}:{})
    }),signal:AbortSignal.timeout(20000)
  });
  if(!response.ok){
    if(response.status===403)throw new Error('Requiere permisos Contents: write y Workflows: write.');
    if(response.status===409||response.status===422)throw new Error('Conflicto o rama protegida. Revisa permisos de GitHub.');
    throw new Error('Falló instalación HTTP '+response.status);
  }
  const result=await response.json() as {content?:{sha?:string}};
  if(!result.content?.sha||!shaPattern.test(result.content.sha))
    throw new Error('GitHub no confirmó el archivo de instalación.');
  return {sourceSha:source.sha,fileSha:result.content.sha,
    url:'https://github.com/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo)+
      '/blob/'+encodeURIComponent(repo.branch)+'/'+CORE_AUTOPILOT_WORKFLOW_PATH};
}


export async function uninstallAutopilotWorkflow(repo:GithubRepoInfo,token:string,
  request:GithubFetch=fetch):Promise<boolean>{
  if(isBuiltin(repo))throw new Error('El workflow principal de Core se mantiene en el repositorio original.');
  const current=await getAutopilotInstallation(repo,token,request);
  if(!current.installed||!current.managed||!current.fileSha||current.conflict)
    throw new Error('No existe un workflow de Core administrado que pueda borrarse.');
  const response=await request(root(repo)+'/contents/'+CORE_AUTOPILOT_WORKFLOW_PATH,{
    method:'DELETE',headers:{...headers(token),'Content-Type':'application/json'},
    cache:'no-store',credentials:'omit',redirect:'error',
    body:JSON.stringify({message:'Core: desinstalar autopiloto aprobado',
      sha:current.fileSha,branch:repo.branch}),signal:AbortSignal.timeout(20000)
  });
  if(!response.ok){
    if(response.status===403)throw new Error('No tienes permisos para retirar este workflow.');
    if(response.status===409||response.status===422)throw new Error('GitHub detectó cambios en el workflow; revisa antes de borrar.');
    throw new Error('GitHub no pudo desinstalar el workflow (HTTP '+response.status+').');
  }
  return true;
}
