import { useCallback, useMemo, useState, lazy, Suspense } from "react";
import { Activity, Bot, Braces, ChevronDown, ChevronRight, CircleDot, Command, ExternalLink, File, FileCode2, FileJson, FileText, Folder, FolderGit2, GitBranch, Github, Maximize2, MoreHorizontal, PanelBottom, PanelRight, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, SquareTerminal, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

const MonacoEditor = lazy(() => import("./MonacoEditor"));
const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined;
const GITHUB_APP_INSTALL_URL = import.meta.env.VITE_GITHUB_APP_INSTALL_URL as string | undefined;
const API = "https://api.github.com";

type Repo = { id:number; name:string; full_name:string; description:string|null; private:boolean; default_branch:string; language:string|null; updated_at:string; html_url:string; stargazers_count:number };
type TreeItem = { path:string; type:"blob"|"tree"; sha:string; size?:number };
type OpenFile = { path:string; name:string; content:string; sha:string; language:string };
type GitHubUser = { login:string; avatar_url:string; name:string|null };

function apiHeaders(token:string) { return { Accept:"application/vnd.github+json", Authorization:"Bearer "+token, "X-GitHub-Api-Version":"2022-11-28" }; }
async function fetchRepositoryPage(token:string,page:number):Promise<Repo[]> {
  const response=await fetch(API+"/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member&page="+page,{headers:apiHeaders(token)});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||"Could not load GitHub repositories.");}
  return await response.json() as Repo[];
}
function languageFor(path:string) {
  const ext=path.split(".").pop()?.toLowerCase();
  const map:Record<string,string>={ts:"typescript",tsx:"typescript",js:"javascript",jsx:"javascript",json:"json",md:"markdown",rs:"rust",py:"python",go:"go",html:"html",css:"css",scss:"scss",yml:"yaml",yaml:"yaml",toml:"ini",sh:"shell",sql:"sql",xml:"xml",java:"java",kt:"kotlin",swift:"swift",c:"c",cpp:"cpp",h:"cpp",cs:"csharp",php:"php",rb:"ruby",vue:"html",svelte:"html"};
  return map[ext||""]||"plaintext";
}
function decodeBase64(value:string) {
  const clean=value.split(String.fromCharCode(10)).join("").split(" ").join("");
  const bytes=Uint8Array.from(atob(clean),c=>c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function fileIcon(path:string) {
  const ext=path.split(".").pop()?.toLowerCase();
  if(ext==="json") return <FileJson size={14}/>;
  if(["ts","tsx","js","jsx","rs","py","go"].includes(ext||"")) return <FileCode2 size={14}/>;
  if(ext==="md") return <FileText size={14}/>;
  return <File size={14}/>;
}

export function App() {
  const [token,setToken]=useState("");
  const [user,setUser]=useState<GitHubUser|null>(null);
  const [repos,setRepos]=useState<Repo[]>([]);
  const [repoPage,setRepoPage]=useState(1);
  const [hasMoreRepos,setHasMoreRepos]=useState(false);
  const [repoFilter,setRepoFilter]=useState("");
  const [selectedRepo,setSelectedRepo]=useState<Repo|null>(null);
  const [tree,setTree]=useState<TreeItem[]>([]);
  const [expanded,setExpanded]=useState<Set<string>>(new Set([""]));
  const [openFiles,setOpenFiles]=useState<OpenFile[]>([]);
  const [activePath,setActivePath]=useState("");
  const [deviceFlow,setDeviceFlow]=useState<{device_code:string;user_code:string;verification_uri:string;interval:number;expires_in:number}|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [leftMode,setLeftMode]=useState<"repos"|"search"|"source">("repos");
  const [rightOpen,setRightOpen]=useState(true);
  const [bottomOpen,setBottomOpen]=useState(false);
  const [bottomTab,setBottomTab]=useState("Terminal");
  const [fileQuery,setFileQuery]=useState("");

  const filteredRepos=useMemo(()=>repos.filter(r=>r.full_name.toLowerCase().includes(repoFilter.toLowerCase())||(r.description||"").toLowerCase().includes(repoFilter.toLowerCase())),[repos,repoFilter]);
  const activeFile=openFiles.find(f=>f.path===activePath)||null;

  const githubRequest=useCallback(async(path:string,init:RequestInit={})=>{
    if(!token) throw new Error("Connect your GitHub account first.");
    const response=await fetch(API+path,{...init,headers:{...apiHeaders(token),...(init.headers as Record<string,string>||{})}});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||("GitHub API error "+response.status));}
    return response.json();
  },[token]);

  const loadRepositories=useCallback(async()=>{
    setBusy("repos");setError("");
    try {
      const results=await Promise.all([githubRequest("/user"),fetchRepositoryPage(token,1)]);
      setUser(results[0] as GitHubUser);setRepos(results[1]);setRepoPage(1);setHasMoreRepos(results[1].length===100);
    } catch(e){setError(e instanceof Error?e.message:"Could not load repositories.");}
    finally{setBusy("");}
  },[githubRequest,token]);

  async function beginGitHubConnect(){
    setError("");
    if(!GITHUB_CLIENT_ID){setError("GitHub App is not configured in this build. Set VITE_GITHUB_CLIENT_ID after registering the AliceLabs Core GitHub App and enabling Device Flow.");return;}
    setBusy("connect");
    try{
      const data=await invoke<{device_code:string;user_code:string;verification_uri:string;interval:number;expires_in:number}>("github_device_code",{clientId:GITHUB_CLIENT_ID});
      setDeviceFlow(data);
    }catch(e){setError(e instanceof Error?e.message:"GitHub authorization failed.");}
    finally{setBusy("");}
  }

  async function completeGitHubConnect(){
    if(!deviceFlow||!GITHUB_CLIENT_ID)return;
    setBusy("authorize");setError("");
    try{
      await new Promise(resolve=>setTimeout(resolve,Math.max(deviceFlow.interval||5,5)*1000));
      const data=await invoke<Record<string,any>>("github_exchange_device_code",{clientId:GITHUB_CLIENT_ID,deviceCode:deviceFlow.device_code});
      if(data.error==="authorization_pending")throw new Error("Authorization is still pending. Approve the request on GitHub, then check again.");
      if(data.error==="slow_down")throw new Error("GitHub asks us to wait a little longer before checking again.");
      if(data.error==="expired_token"){setDeviceFlow(null);throw new Error("The GitHub device code expired. Start the connection again.");}
      if(data.error==="access_denied")throw new Error("GitHub authorization was cancelled.");
      if(!data.access_token)throw new Error(data.error_description||data.error||"GitHub authorization was not completed.");
      setToken(data.access_token);setDeviceFlow(null);
      const h=apiHeaders(data.access_token);
      const profileResponse=await fetch(API+"/user",{headers:h});
      if(!profileResponse.ok)throw new Error("Token received, but the GitHub profile could not be loaded.");
      const profile=await profileResponse.json();
      const loadedRepos=await fetchRepositoryPage(data.access_token,1);
      setUser(profile);setRepos(loadedRepos);setRepoPage(1);setHasMoreRepos(loadedRepos.length===100);
    }catch(e){setError(e instanceof Error?e.message:"Could not verify authorization.");}
    finally{setBusy("");}
  }

  function disconnectGitHub(){setToken("");setUser(null);setRepos([]);setRepoPage(1);setHasMoreRepos(false);setSelectedRepo(null);setTree([]);setOpenFiles([]);setActivePath("");setDeviceFlow(null);}
  async function loadMoreRepositories(){
    if(!token||!hasMoreRepos||busy==="more")return;
    setBusy("more");setError("");
    try{
      const nextPage=repoPage+1;
      const batch=await fetchRepositoryPage(token,nextPage);
      setRepos(current=>[...current,...batch]);setRepoPage(nextPage);setHasMoreRepos(batch.length===100);
    }catch(e){setError(e instanceof Error?e.message:"Could not load more repositories.");}
    finally{setBusy("");}
  }

  async function selectRepository(repo:Repo){
    setSelectedRepo(repo);setOpenFiles([]);setActivePath("");setTree([]);setExpanded(new Set([""]));setBusy("tree");setError("");
    try{
      const result=await githubRequest("/repos/"+repo.full_name+"/git/trees/"+encodeURIComponent(repo.default_branch)+"?recursive=1");
      setTree((result.tree||[]).filter((item:TreeItem)=>item.type==="blob").slice(0,5000));setBottomOpen(false);
    }catch(e){setError(e instanceof Error?e.message:"Could not read repository tree.");}
    finally{setBusy("");}
  }

  async function openFile(item:TreeItem){
    if(!selectedRepo)return;
    const existing=openFiles.find(f=>f.path===item.path);
    if(existing){setActivePath(item.path);return;}
    setBusy("file:"+item.path);setError("");
    try{
      const encodedPath=item.path.split("/").map(encodeURIComponent).join("/");
      const result=await githubRequest("/repos/"+selectedRepo.full_name+"/contents/"+encodedPath+"?ref="+encodeURIComponent(selectedRepo.default_branch));
      if(result.encoding!=="base64"||!result.content)throw new Error("This file cannot be previewed in the editor.");
      const file:OpenFile={path:item.path,name:item.path.split("/").pop()||item.path,content:decodeBase64(result.content),sha:result.sha,language:languageFor(item.path)};
      setOpenFiles(current=>[...current,file]);setActivePath(item.path);
    }catch(e){setError(e instanceof Error?e.message:"Could not open file.");}
    finally{setBusy("");}
  }

  function updateActiveContent(content:string){setOpenFiles(current=>current.map(file=>file.path===activePath?{...file,content}:file));}
  function closeFile(path:string){
    const index=openFiles.findIndex(f=>f.path===path);const next=openFiles.filter(f=>f.path!==path);setOpenFiles(next);
    if(activePath===path)setActivePath(next[Math.max(0,index-1)]?.path||next[0]?.path||"");
  }
  async function openNewWindow(){
    try{
      const {WebviewWindow}=await import("@tauri-apps/api/webviewWindow");
      new WebviewWindow("core-"+Date.now(),{url:"index.html",title:"AliceLabs Core",width:1440,height:920,minWidth:980,minHeight:640});
    }catch{window.open(window.location.href,"_blank","noopener,noreferrer");}
  }

  const folders=useMemo(()=>{
    const visible=tree.filter(item=>item.path.toLowerCase().includes(fileQuery.toLowerCase()));
    const root:Record<string,any>={};
    for(const item of visible){
      const parts=item.path.split("/");let current=root;
      parts.forEach((part,index)=>{
        if(!current[part])current[part]=index===parts.length-1?{__file:item}:{};
        if(!current[part].__file)current=current[part];
      });
    }
    return root;
  },[tree,fileQuery]);

  return <div className="ide-shell">
    <header className="titlebar">
      <div className="brand-lockup"><div className="core-mark">C</div><span className="brand-name">CORE</span><span className="brand-sub">ALICELABS</span></div>
      <div className="titlebar-center"><span className="titlebar-project">{selectedRepo?selectedRepo.full_name:"No repository opened"}</span><ChevronDown size={13}/></div>
      <div className="titlebar-actions">
        <button className="chrome-btn" title="New window" onClick={openNewWindow}><Plus size={15}/><span>New window</span></button>
        <button className="chrome-btn square" title="Toggle assistant panel" onClick={()=>setRightOpen(v=>!v)}><PanelRight size={16}/></button>
        <button className="chrome-btn square" title="Toggle bottom panel" onClick={()=>setBottomOpen(v=>!v)}><PanelBottom size={16}/></button>
        <div className="titlebar-divider"/>
        {user?<button className="account-chip" onClick={disconnectGitHub}><img src={user.avatar_url} alt=""/><span>{user.login}</span><span className="connected-dot"/></button>:<button className="connect-top" onClick={beginGitHubConnect}><Github size={15}/> Connect GitHub</button>}
      </div>
    </header>
    <div className="ide-body">
      <nav className="activity-rail">
        <button className={leftMode==="repos"?"rail-button selected":"rail-button"} title="Git repositories" onClick={()=>setLeftMode("repos")}><Github size={20}/></button>
        <button className={leftMode==="search"?"rail-button selected":"rail-button"} title="Search" onClick={()=>setLeftMode("search")}><Search size={19}/></button>
        <button className={leftMode==="source"?"rail-button selected":"rail-button"} title="Source control" onClick={()=>setLeftMode("source")}><GitBranch size={19}/></button>
        <div className="rail-spacer"/>
        <button className="rail-button" title="Security"><ShieldCheck size={19}/></button><button className="rail-button" title="Settings"><Settings2 size={19}/></button>
      </nav>
      <aside className="explorer-pane">
        <div className="pane-heading"><span>{leftMode==="repos"?"GITHUB REPOSITORIES":leftMode==="search"?"SEARCH":"SOURCE CONTROL"}</span><button className="tiny-icon" onClick={loadRepositories} title="Refresh"><RefreshCw size={14}/></button></div>
        {leftMode==="repos"&&(!user?<div className="github-connect-card">
          <div className="github-icon-large"><Github size={25}/></div><h3>Connect your GitHub</h3>
          <p>Browse repositories granted to the AliceLabs Core GitHub App. Install the app on your personal account or organization and choose which repositories it may read.</p>
          {!GITHUB_CLIENT_ID&&<div className="config-warning">GitHub App configuration required for this build.</div>}
          <button className="blue-button full" onClick={beginGitHubConnect} disabled={!!busy}>{busy==="connect"?"Connecting…":"Connect GitHub account"}</button>
          {deviceFlow&&<div className="device-flow"><span>ENTER THIS CODE ON GITHUB</span><strong>{deviceFlow.user_code}</strong><button className="text-link" onClick={()=>window.open(deviceFlow.verification_uri,"_blank","noopener,noreferrer")}>Open GitHub device page <ExternalLink size={12}/></button><button className="blue-button full" onClick={completeGitHubConnect} disabled={busy==="authorize"}>{busy==="authorize"?"Checking…":"I've authorized — continue"}</button></div>}
          {error&&<div className="inline-error">{error}</div>}
        </div>:<>
          <div className="github-profile"><img src={user.avatar_url} alt=""/><div><strong>{user.name||user.login}</strong><small>@{user.login}</small></div><span className="connected-dot"/></div>
          <div className="repo-search"><Search size={14}/><input value={repoFilter} onChange={e=>setRepoFilter(e.target.value)} placeholder="Filter repositories…"/></div>
          <div className="repo-count">{filteredRepos.length} REPOSITORIES <button onClick={loadRepositories} title="Refresh"><RefreshCw size={12}/></button></div>
          {GITHUB_APP_INSTALL_URL&&<a className="install-link manage-install" href={GITHUB_APP_INSTALL_URL} target="_blank" rel="noreferrer">Manage GitHub App access <ExternalLink size={11}/></a>}
          <div className="repo-list">{filteredRepos.map(repo=><button key={repo.id} className={selectedRepo?.id===repo.id?"repo-entry active":"repo-entry"} onClick={()=>selectRepository(repo)}><FolderGit2 size={15}/><span className="repo-entry-text"><strong>{repo.name}</strong><small>{repo.full_name}</small></span><span className={repo.private?"private-dot":"public-dot"} title={repo.private?"Private":"Public"}/></button>)}{filteredRepos.length===0&&<div className="empty-small">{repos.length?"No repositories match your search.":"No repositories available to this GitHub App. Install it on an account or organization and grant repository access."}{repos.length===0&&GITHUB_APP_INSTALL_URL&&<a className="install-link" href={GITHUB_APP_INSTALL_URL} target="_blank" rel="noreferrer">Install AliceLabs Core <ExternalLink size={11}/></a>}</div>}</div>
          {hasMoreRepos&&<button className="load-more" onClick={loadMoreRepositories} disabled={busy==="more"}>{busy==="more"?"Loading…":"Load more repositories"}</button>}
          {error&&<div className="inline-error side-error">{error}</div>}
        </>)}
        {leftMode==="search"&&<div className="search-pane"><Search size={22}/><p>Filter files in the opened repository.</p><input value={fileQuery} onChange={e=>setFileQuery(e.target.value)} placeholder="Filter file paths…"/></div>}
        {leftMode==="source"&&<div className="search-pane"><GitBranch size={22}/><p>Source control for the selected repository.</p><small>{selectedRepo?"Branch: "+selectedRepo.default_branch:"Select a GitHub repository to inspect source."}</small></div>}
        {selectedRepo&&<div className="file-tree-section"><div className="tree-heading"><span>EXPLORER</span><span>{selectedRepo.name}</span></div>{busy==="tree"?<div className="tree-loading"><RefreshCw size={13}/> Loading repository tree…</div>:<TreeView nodes={folders} prefix="" onFile={openFile} expanded={expanded} setExpanded={setExpanded} busy={busy}/>}</div>}
      </aside>
      <main className="editor-area">
        <div className="editor-toolbar"><div className="editor-tabs"><div className="welcome-tab"><Command size={13}/> CORE IDE</div>{openFiles.map(file=><div key={file.path} className={activePath===file.path?"file-tab active":"file-tab"} onClick={()=>setActivePath(file.path)}>{fileIcon(file.path)}<span>{file.name}</span><button onClick={e=>{e.stopPropagation();closeFile(file.path)}}><X size={12}/></button></div>)}</div><div className="editor-actions"><button className="tiny-icon" title="New window" onClick={openNewWindow}><Maximize2 size={14}/></button><button className="tiny-icon" title="More actions"><MoreHorizontal size={16}/></button></div></div>
        {activeFile?<div className="editor-content"><div className="breadcrumb"><span>{selectedRepo?.full_name}</span><ChevronRight size={12}/><span>{activeFile.path}</span></div><div className="monaco-wrap"><Suspense fallback={<div className="editor-loading">Loading editor engine…</div>}><MonacoEditor value={activeFile.content} language={activeFile.language} onChange={updateActiveContent}/></Suspense></div></div>:<div className="editor-empty"><div className="empty-mark"><Braces size={37}/></div><h1>{selectedRepo?"Repository loaded":"Your workspace starts here"}</h1><p>{selectedRepo?"Choose a file from the explorer to open it in the editor.":"Connect your GitHub account and open any repository. No sample projects, no preloaded workspaces."}</p>{!user&&<button className="blue-button" onClick={beginGitHubConnect}><Github size={15}/> Connect GitHub</button>}{selectedRepo&&<div className="repo-summary"><span><FolderGit2 size={14}/>{selectedRepo.full_name}</span><span><GitBranch size={14}/>{selectedRepo.default_branch}</span><span><CircleDot size={14}/>{selectedRepo.language||"Unknown language"}</span></div>}<div className="shortcut-hints"><span><kbd>Ctrl</kbd><kbd>P</kbd> Quick open</span><span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd> Commands</span><span><kbd>Ctrl</kbd><kbd>`</kbd> Terminal</span></div>{error&&<div className="editor-error">{error}</div>}</div>}
        {bottomOpen&&<div className="bottom-panel"><div className="bottom-tabs">{["Terminal","Problems","Output","Git"].map(tab=><button key={tab} className={bottomTab===tab?"bottom-tab active":"bottom-tab"} onClick={()=>setBottomTab(tab)}>{tab}</button>)}<button className="tiny-icon close-bottom" onClick={()=>setBottomOpen(false)}><X size={14}/></button></div><div className="terminal-placeholder">{bottomTab==="Terminal"?<><SquareTerminal size={16}/><span>Terminal backend is not connected yet. Local shell sessions will be provided by the Core daemon.</span></>:<><Activity size={16}/><span>{bottomTab} output will appear here when its service is connected.</span></>}</div></div>}
        <footer className="statusbar"><span><GitBranch size={12}/>{selectedRepo?.default_branch||"No branch"}</span><span><CircleDot size={12}/>{selectedRepo?"GitHub remote":"No repository"}</span><span className="status-spacer"/><span>{activeFile?.language||"Ready"}</span><span>UTF-8</span><span>CORE · LOCAL-FIRST</span></footer>
      </main>
      {rightOpen&&<aside className="assistant-pane"><div className="assistant-heading"><div><Sparkles size={15}/><strong>CORE AGENT</strong></div><button className="tiny-icon" onClick={()=>setRightOpen(false)}><X size={14}/></button></div><div className="assistant-empty"><div className="agent-orb"><Bot size={25}/></div><h3>AI workspace</h3><p>Connect a model provider to start a coding session. Agents will work with the active repository and scoped tools.</p><button className="outline-blue" disabled><Plus size={13}/> Add model provider</button><small>Provider management is being implemented.</small></div><div className="agent-input"><div className="agent-input-box"><textarea placeholder="Ask Core to work on this repository…" disabled/><div className="agent-input-bottom"><span>Model: not configured</span><button disabled><Sparkles size={14}/></button></div></div><small>AI actions will require explicit tool permissions.</small></div></aside>}
    </div>
  </div>;
}

function TreeView({nodes,prefix,onFile,expanded,setExpanded,busy}:{nodes:Record<string,any>;prefix:string;onFile:(item:TreeItem)=>void;expanded:Set<string>;setExpanded:React.Dispatch<React.SetStateAction<Set<string>>>;busy:string}) {
  const entries=Object.entries(nodes).sort(([a,av],[b,bv])=>{const ad=!(av as any).__file,bd=!(bv as any).__file;return ad===bd?a.localeCompare(b):ad?-1:1;});
  return <div className="tree-list">{entries.map(([name,node])=>{
    const path=prefix?prefix+"/"+name:name;
    if((node as any).__file)return <button key={path} className={busy==="file:"+path?"tree-file loading":"tree-file"} onClick={()=>onFile((node as any).__file)}>{fileIcon(path)}<span>{name}</span></button>;
    const isOpen=expanded.has(path);
    return <div key={path}><button className="tree-folder" onClick={()=>setExpanded(current=>{const next=new Set(current);if(next.has(path))next.delete(path);else next.add(path);return next;})}>{isOpen?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<Folder size={14}/><span>{name}</span></button>{isOpen&&<TreeView nodes={node as Record<string,any>} prefix={path} onFile={onFile} expanded={expanded} setExpanded={setExpanded} busy={busy}/>}</div>;
  })}</div>;
}
