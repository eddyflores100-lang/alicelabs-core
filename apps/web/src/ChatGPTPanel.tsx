import { useState } from 'react';
import { ArrowRight, Check, CheckCircle2, Copy, ExternalLink, Link2, LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, ShieldCheck, Trash2, UserRound, Wifi } from 'lucide-react';
import type { ChatGPTAccount, ChatGPTModel } from './chatgpt';

type Props = {
  pairToken: string;
  setPairToken: (value: string) => void;
  online: boolean;
  accounts: ChatGPTAccount[];
  activeId: string;
  models: ChatGPTModel[];
  model: string;
  setModel: (value: string) => void;
  failure: string;
  busy: string | null;
  onPair: () => Promise<void>;
  onLogin: (id?: string) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onDisconnect: (id: string, remove: boolean) => Promise<void>;
  onClose: () => void;
};
export default function ChatGPTPanel(p: Props) {
  const [copied, setCopied] = useState(false);
  const startCommand = 'node tools/chatgpt-companion/server.mjs';
  const selected = p.accounts.find(a => a.id === p.activeId);
  return <div className="chatgpt-manager">
    <div className="chatgpt-intro">
      <div className="chatgpt-emblem"><UserRound size={21}/></div>
      <div><strong>ChatGPT · iniciar sesión con correo</strong><p>Conecta cuentas con el inicio de sesión oficial de OpenAI. Sin API key. Cada cuenta mantiene sus propios permisos y límites del plan.</p></div>
    </div>
    <div className="chatgpt-pair">
      <div className="chatgpt-step"><span>1</span> Inicia el componente local en la carpeta de AliceLabs Core</div>
      <div className="command-snippet"><code>{startCommand}</code><button title="Copiar comando" onClick={async () => { await navigator.clipboard.writeText(startCommand); setCopied(true); }}>{copied ? <Check size={15}/> : <Copy size={15}/>}</button></div>
      <p>El componente se ejecuta solo en tu equipo y conserva allí los tokens. No envía credenciales a Pages ni a Cloudflare Workers.</p>
      <div className="chatgpt-step"><span>2</span> Pega el token de emparejamiento mostrado en tu terminal</div>
      <div className="chatgpt-pair-input"><div className="input-with-icon"><LockKeyhole size={16}/><input type="password" value={p.pairToken} onChange={e=>p.setPairToken(e.target.value)} autoComplete="off" placeholder="Token local del componente"/></div><button className="primary-button" onClick={() => void p.onPair()} disabled={!p.pairToken.trim() || !!p.busy}>{p.busy==='pairing' ? <LoaderCircle size={15} className="spin"/> : <Wifi size={15}/>} Conectar</button></div>
      <div className={'chatgpt-status '+(p.online?'connected':'')}><span className={p.online?'connected-dot':'unconnected-dot'}/>{p.online ? 'Componente conectado · OAuth disponible' : 'Todavía no conectado'}<span>127.0.0.1:39008</span></div>
    </div>
    {p.online && <>
      <div className="chatgpt-account-header"><strong>Mis cuentas ChatGPT</strong><button onClick={() => void p.onRefresh()} disabled={!!p.busy}><RefreshCw size={14}/> Actualizar</button></div>
      <div className="chatgpt-account-list">
        {p.accounts.map(a => <div key={a.id} className={'chatgpt-account '+(p.activeId===a.id?'chatgpt-account-selected':'')}>
          <div className="chatgpt-account-info"><div className="chatgpt-avatar"><UserRound size={16}/></div><div><strong>{a.email || a.label}</strong><small>{a.connected ? (a.planAccess ? 'Autorizada para IA' : 'Sin permiso de uso del plan') : 'Inicia sesión para activar'} {p.activeId===a.id?'· Cuenta activa':''}</small></div></div>
          <div className="chatgpt-account-actions">
            {a.connected && a.planAccess && <button title="Seleccionar cuenta" onClick={() => void p.onSelect(a.id)} disabled={!!p.busy}>{p.activeId===a.id?<CheckCircle2 size={16}/>:<ArrowRight size={16}/>}</button>}
            <button title={a.connected?'Volver a autorizar':'Iniciar sesión'} onClick={() => void p.onLogin(a.id)} disabled={!!p.busy}><ExternalLink size={15}/></button>
            {a.connected && <button title="Cerrar sesión en este componente" onClick={() => void p.onDisconnect(a.id,false)} disabled={!!p.busy}><LogOut size={15}/></button>}
            <button title="Eliminar registro de cuenta" onClick={() => { if (confirm('¿Desconectar y quitar esta cuenta de AliceLabs Core?')) void p.onDisconnect(a.id,true); }} disabled={!!p.busy}><Trash2 size={15}/></button>
          </div>
        </div>)}
        {!p.accounts.length && <div className="accounts-empty"><UserRound size={17}/> No hay cuentas registradas. Añade la primera usando el navegador oficial.</div>}
      </div>
      <button className="secondary-button chatgpt-add" disabled={!!p.busy} onClick={() => void p.onLogin()}>{p.busy==='login'?<LoaderCircle size={15} className="spin"/>:<Plus size={15}/>} Continuar con ChatGPT · añadir cuenta</button>
      <div className="chatgpt-model-section"><label>Cuenta activa</label><div className="chatgpt-active-account"><Link2 size={14}/>{selected ? selected.email || selected.label : 'Selecciona una cuenta autorizada'}</div>
        <label>Modelo disponible en esta cuenta</label><select value={p.model} onChange={e=>p.setModel(e.target.value)} disabled={!selected || !p.models.length}><option value="">Selecciona un modelo</option>{p.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <p>El listado lo entrega OpenAI para la cuenta elegida. La disponibilidad real se comprueba al enviar la solicitud.</p></div>
    </>}
    {p.failure && <p className="chatgpt-failure">{p.failure}</p>}
    <div className="chatgpt-security"><ShieldCheck size={16}/><span>Sesiones separadas. No hay rotación para evitar bloqueos. Los límites dependen del plan. Esta primera versión almacena tokens solo en memoria del componente; deberás volver a autenticar después de reiniciarlo.</span></div>
    <div className="dialog-actions"><button className="secondary-button" onClick={p.onClose}>Cerrar</button></div>
  </div>;
}
