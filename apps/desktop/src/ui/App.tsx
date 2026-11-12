import { useState } from "react";
import Editor from "@monaco-editor/react";
import { Activity, Bot, Boxes, ChevronDown, CircleHelp, Command, FolderGit2, Gauge, GitBranch, Layers3, Plus, Search, Settings2, ShieldCheck, Sparkles, TerminalSquare, Workflow } from "lucide-react";

const projects = ["OpenSAM", "MarketNow", "VerifyKYC", "Vigía"];
const agents = [
  { name: "Architect", task: "Waiting for a task", model: "Automatic", state: "Idle" },
  { name: "Frontend Engineer", task: "No active session", model: "Manual", state: "Idle" },
  { name: "Code Auditor", task: "No active session", model: "Automatic", state: "Idle" },
];

export function App() {
  const [activeProject, setActiveProject] = useState("OpenSAM");
  const [view, setView] = useState("Workspace");
  return <div className="shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">C</div><span>CORE</span><span className="brand-by">by AliceLabs</span></div>
      <div className="workspace-switch"><Layers3 size={15}/><span>{activeProject}</span><ChevronDown size={14}/></div>
      <div className="top-actions"><div className="status"><i/> Daemon not connected</div><button className="icon-btn" aria-label="Settings"><Settings2 size={17}/></button><div className="avatar">AL</div></div>
    </header>
    <div className="main">
      <aside className="rail">
        <button className="rail-active" title="Workspace"><FolderGit2 size={18}/></button>
        <button title="Agents"><Bot size={18}/></button><button title="Models"><Sparkles size={18}/></button><button title="Integrations"><Boxes size={18}/></button><button title="Workflows"><Workflow size={18}/></button>
        <div className="rail-bottom"><button title="Security"><ShieldCheck size={18}/></button><button title="Help"><CircleHelp size={18}/></button></div>
      </aside>
      <aside className="sidebar">
        <div className="side-head"><span>WORKSPACE</span><button className="icon-btn"><Plus size={15}/></button></div>
        <div className="search"><Search size={14}/><span>Search files and commands</span><kbd>⌘ K</kbd></div>
        <div className="side-label">PROJECTS</div>
        {projects.map(p=><button key={p} className={"project "+(activeProject===p?"selected":"")} onClick={()=>setActiveProject(p)}><FolderGit2 size={15}/>{p}</button>)}
        <div className="side-label spaced">DEVELOPMENT</div>
        {["Explorer","Source Control","Extensions","Terminal"].map((x,i)=><button key={x} className="nav-item" onClick={()=>setView(x === "Explorer" ? "Editor" : "Workspace")}><span className="nav-dot">{["▤","⑂","◈","⌁"][i]}</span>{x}</button>)}
        <div className="side-bottom"><div className="profile"><div className="avatar">AL</div><div><strong>AliceLabs</strong><small>Local workspace</small></div><Settings2 size={15}/></div></div>
      </aside>
      <section className="content">
        <div className="tabs"><button className={"tab "+(view === "Workspace" ? "active" : "")} onClick={()=>setView("Workspace")}><Activity size={14}/> Overview</button><button className={"tab "+(view === "Editor" ? "active" : "")} onClick={()=>setView("Editor")}><FolderGit2 size={14}/> Editor</button><button className="tab"><TerminalSquare size={14}/> Terminal</button><div className="tab-spacer"/><span className="branch"><GitBranch size={13}/> main</span></div>
        {view === "Editor" ? <EditorView project={activeProject}/> : <div className="page">
          <div className="eyebrow">ALICELABS / DEVELOPMENT ENVIRONMENT</div>
          <div className="page-title"><div><h1>{activeProject}</h1><p>Project workspace · Local environment</p></div><button className="primary"><Plus size={15}/> New session</button></div>
          <div className="notice"><div className="notice-icon"><Command size={17}/></div><div><strong>Core foundation initialized</strong><p>This is the UI shell. Connect the local Core Daemon to activate providers, agents, tools and project indexing.</p></div><span className="pill muted">Foundation</span></div>
          <div className="section-title"><div><h2>Workspace overview</h2><p>Your development environment at a glance</p></div><button className="subtle">Last 24 hours <ChevronDown size={13}/></button></div>
          <div className="metrics">
            <Metric icon={<Bot size={17}/>} label="Active agents" value="0" note="No running sessions"/>
            <Metric icon={<Sparkles size={17}/>} label="Connected models" value="0" note="No providers configured"/>
            <Metric icon={<Boxes size={17}/>} label="Tool integrations" value="0" note="Bridge not connected"/>
            <Metric icon={<Gauge size={17}/>} label="Usage today" value="—" note="Awaiting provider data"/>
          </div>
          <div className="lower-grid">
            <div className="panel"><div className="panel-head"><div><h3>Agent workspace</h3><p>Manage your specialized AI team</p></div><button className="subtle">View all <span>→</span></button></div>
              {agents.map(a=><div className="agent-row" key={a.name}><div className="agent-icon"><Bot size={16}/></div><div className="agent-info"><strong>{a.name}</strong><small>{a.task}</small></div><span className="model-tag">{a.model}</span><span className="state">{a.state}</span></div>)}
              <button className="add-agent"><Plus size={14}/> Create agent profile</button>
            </div>
            <div className="panel"><div className="panel-head"><div><h3>Quick actions</h3><p>Configure your Core environment</p></div></div>
              <Quick icon={<Sparkles size={16}/>} title="Connect AI provider" desc="Claude, GPT, Gemini, OpenRouter"/>
              <Quick icon={<Boxes size={16}/>} title="Configure Tool Bridge" desc="MCP, APIs, CLI and extensions"/>
              <Quick icon={<ShieldCheck size={16}/>} title="Review permissions" desc="Project and agent access policies"/>
              <Quick icon={<Workflow size={16}/>} title="Create workflow" desc="Build a multi-agent task pipeline"/>
            </div>
          </div>
          <div className="footer-note"><span>CORE v0.1.0 · FOUNDATION</span><span>Local-first · Provider-agnostic · Human-governed</span></div>
        </div>}
      </section>
    </div>
  </div>;
}
function Metric({icon,label,value,note}:{icon:React.ReactNode;label:string;value:string;note:string}) {
 return <div className="metric"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{note}</small></div>;
}
function Quick({icon,title,desc}:{icon:React.ReactNode;title:string;desc:string}) {
 return <button className="quick"><span className="quick-icon">{icon}</span><span><strong>{title}</strong><small>{desc}</small></span><b>→</b></button>;
}

function EditorView({ project }: { project: string }) {
  const [code, setCode] = useState(`export interface AgentTask {
  id: string;
  projectId: string;
  objective: string;
  status: "queued" | "running" | "completed" | "failed";
}

export async function runTask(task: AgentTask) {
  if (!task.objective.trim()) {
    throw new Error("Task objective is required");
  }

  return {
    ...task,
    status: "queued" as const,
  };
}
`);

  return (
    <div className="editor-workspace">
      <aside className="file-explorer">
        <div className="file-explorer-title">EXPLORER <span>···</span></div>
        <div className="file-project"><ChevronDown size={13}/>{project.toUpperCase()}</div>
        <div className="file-item active"><span className="file-ts">TS</span> agent-task.ts</div>
        <div className="file-item"><span className="file-ts">TS</span> agent-runtime.ts</div>
        <div className="file-item"><span className="file-json">{ }</span> package.json</div>
        <div className="file-item"><span className="file-md">M</span> README.md</div>
        <div className="file-section">OUTLINE</div>
        <div className="outline-item">AgentTask</div>
        <div className="outline-item">runTask</div>
      </aside>
      <div className="editor-main">
        <div className="editor-file-tabs">
          <div className="editor-file-tab"><span className="file-ts">TS</span> agent-task.ts <span className="tab-close">×</span></div>
          <div className="editor-file-path">{project} / src / agent-task.ts</div>
        </div>
        <div className="monaco-host">
          <Editor
            height="100%"
            language="typescript"
            theme="vs-dark"
            value={code}
            onChange={(value) => setCode(value ?? "")}
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "JetBrains Mono, Consolas, monospace",
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              tabSize: 2,
              wordWrap: "on",
              padding: { top: 16 },
              renderLineHighlight: "all",
            }}
          />
        </div>
        <div className="editor-status"><span>TypeScript</span><span>UTF-8</span><span>LF</span><span>Ln 1, Col 1</span><span className="editor-status-right">CORE EDITOR · LOCAL BUFFER</span></div>
      </div>
    </div>
  );
}
