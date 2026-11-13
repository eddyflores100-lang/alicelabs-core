import {useCallback,useEffect,useState} from 'react';
import {Check,CheckCircle2,ChevronDown,ChevronRight,ExternalLink,GitMerge,RefreshCw,ShieldCheck} from 'lucide-react';
import type {GithubRepoInfo} from './githubWorkspace';
import {
  canMergeGithubPR,getGithubPullRequest,listGithubPullFiles,listGithubPullRequests,mergeGithubPullRequest
} from './githubPullRequests';
import type {GithubPullFile,GithubPullRequest} from './githubPullRequests';

export default function GithubPullRequestsPanel({repo,token,onNotice,onMerged}:{
  repo:GithubRepoInfo;token:string;
  onNotice:(text:string,isError?:boolean)=>void;onMerged:()=>void;
}){
  const [items,setItems]=useState<GithubPullRequest[]>([]);
  const [selected,setSelected]=useState<number|null>(null);
  const [detail,setDetail]=useState<GithubPullRequest|null>(null);
  const [files,setFiles]=useState<GithubPullFile[]>([]);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [reviewed,setReviewed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);

  const load=useCallback(async()=>{
    if(!token)return;
    setLoading(true);
    try{
      const result=await listGithubPullRequests(repo,token);
      setItems(result);
      if(selected&&!result.some(x=>x.number===selected)){
        setSelected(null);setDetail(null);setFiles([]);setReviewed(false);
      }
    }catch(e){onNotice(e instanceof Error?e.message:'Error consultando Pull Requests',true);}
    finally{setLoading(false);}
  },[repo.owner,repo.repo,repo.branch,token,selected,onNotice]);

  const inspect=useCallback(async(num:number)=>{
    if(!token)return;
    setLoading(true);setSelected(num);setDetail(null);setFiles([]);setReviewed(false);setExpanded(null);
    try{
      const [pr,changed]=await Promise.all([
        getGithubPullRequest(repo,token,num),listGithubPullFiles(repo,token,num)
      ]);
      setDetail(pr);setFiles(changed);
    }catch(e){onNotice(e instanceof Error?e.message:'Error al revisar Pull Request',true);}
    finally{setLoading(false);}
  },[repo.owner,repo.repo,repo.branch,token,onNotice]);

  useEffect(()=>{void load();},[load]);

  async function merge(){
    if(!detail||!canMergeGithubPR(detail,repo)||!reviewed||busy)return;
    const confirmText='¿Fusionar el Pull Request #'+detail.number+' en '+repo.owner+'/'+repo.repo+'?\n\n'+
      detail.title+'\nRama: '+detail.head.ref+' → '+detail.base.ref+
      '\nSHA: '+detail.head.sha.slice(0,12)+
      '\nMétodo: squash\n\nEsta operación cambia la rama principal. GitHub comprobará otra vez el SHA y las reglas. Confirma solo después de revisar archivos y resultados de CI.';
    if(!window.confirm(confirmText))return;
    setBusy(true);
    try{
      const result=await mergeGithubPullRequest(repo,token,detail);
      if(!result.merged)throw new Error('GitHub no confirmó la fusión.');
      onNotice('PR #'+detail.number+' fusionado: '+result.sha.slice(0,12));
      setSelected(null);setDetail(null);setFiles([]);setReviewed(false);
      onMerged();await load();
    }catch(e){onNotice(e instanceof Error?e.message:'No se pudo fusionar',true);setReviewed(false);}
    finally{setBusy(false);}
  }

  return <div className="dialog-content github-pr-panel">
    <p>Revisa los Pull Requests abiertos del repositorio, consulta los cambios y fusiona solo los que GitHub marque como limpios. No hay fusiones automáticas.</p>
    <p><strong>Repositorio:</strong> {repo.owner}/{repo.repo} · <strong>Rama principal:</strong> {repo.branch}</p>
    <div className="cloud-action-row">
      <button className="secondary-button" type="button" disabled={loading||busy} onClick={()=>void load()}><RefreshCw size={14}/>{loading?'Consultando…':'Actualizar lista'}</button>
    </div>
    {!items.length&&<p>No hay Pull Requests abiertos visibles para esta cuenta.</p>}
    <div className="github-pr-list">
      {items.map(item=><button type="button" key={item.number}
        className={'github-pr-item '+(selected===item.number?'selected':'')}
        onClick={()=>void inspect(item.number)} disabled={busy||loading}>
        <span><strong>#{item.number} · {item.title}</strong><small>{item.head.ref} → {item.base.ref}{item.draft?' · Borrador':''}</small></span>
        {selected===item.number?<ChevronDown size={15}/>:<ChevronRight size={15}/>}
      </button>)}
    </div>
    {selected&&loading&&<p>Consultando archivos y estado de GitHub…</p>}
    {detail&&<section className="github-pr-inspection">
      <div className="accounts-head"><strong>Revisión #{detail.number}</strong><span>{detail.changed_files||files.length} archivos</span></div>
      <a href={detail.html_url} target="_blank" rel="noopener noreferrer">Abrir PR en GitHub <ExternalLink size={13}/></a>
      <p>Rama: {detail.head.ref} → {detail.base.ref} · +{detail.additions||0} / −{detail.deletions||0}</p>
      <p>GitHub: {detail.mergeable_state||'Estado aún sin calcular'} · {detail.mergeable?'Cambios fusionables':'Fusión pendiente o bloqueada'}</p>
      {files.map(file=><div className="github-pr-file" key={file.filename}>
        <button className="secondary-button" type="button"
          onClick={()=>setExpanded(expanded===file.filename?null:file.filename)}>
          <span>{file.filename} · {file.status} · +{file.additions} −{file.deletions}</span>
          {expanded===file.filename?<ChevronDown size={14}/>:<ChevronRight size={14}/>}
        </button>
        {expanded===file.filename&&<pre>{file.patch||'GitHub no proporcionó un fragmento de diff para este archivo. Abre el PR para ver el diff completo.'}</pre>}
      </div>)}
      <p><ShieldCheck size={14}/> Para fusionar, el PR debe apuntar a la rama del proyecto, no ser borrador, y GitHub debe indicar estado <code>clean</code>.</p>
      <label className="github-pr-review-confirm">
        <input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>
        He revisado los cambios y las comprobaciones en GitHub.
      </label>
      <div className="cloud-action-row">
        <button className="primary-button" type="button" onClick={()=>void merge()}
          disabled={!reviewed||!canMergeGithubPR(detail,repo)||busy||loading}>
          {busy?<RefreshCw size={14}/>:<GitMerge size={14}/>} Fusionar PR (squash)
        </button>
        <button className="secondary-button" type="button" disabled={busy||loading}
          onClick={()=>void inspect(detail.number)}><CheckCircle2 size={14}/> Revalidar estado</button>
      </div>
      {!canMergeGithubPR(detail,repo)&&<p>Fusión deshabilitada: GitHub todavía no confirma un PR limpio y fusionable para esta rama.</p>}
    </section>}
    <p className="github-actions-note"><Check size={14}/> Para consultar PR necesitas Pull requests: Read. Para fusionar, GitHub requiere Contents: Write; las protecciones del repositorio siguen aplicándose.</p>
  </div>;
}
