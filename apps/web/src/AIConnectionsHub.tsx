import { useState } from 'react';
import {
  ArrowRight, Bot, Check, CircleHelp, Copy, ExternalLink, KeyRound,
  Laptop, Layers3, ShieldCheck, TerminalSquare, UsersRound
} from 'lucide-react';
import type { Provider } from './agent';
import ModelFinder from './ModelFinder';

type Props = {
  chatGPTCount: number;
  apiCounts: Partial<Record<Provider, number>>;
  onChatGPT: () => void;
  onApi: (provider: Provider) => void;
  onClose: () => void;
  onNotify: (message: string, error?: boolean) => void;
  onLaunch: (tool: 'antigravity' | 'gemini' | 'claude') => Promise<void>;
  bridgeReady: boolean;
  bridgeTools: {antigravity:boolean;gemini:boolean;claude:boolean};
  launchingTool: string | null;
};

type NativeGuide = {
  id: 'antigravity' | 'gemini' | 'claude';
  title: string;
  subtitle: string;
  command: string;
  install: string;
  docsUrl: string;
  loginNotes: string;
  provider: Provider;
};

const nativeGuides: NativeGuide[] = [
  {
    id: 'antigravity',
    title: 'Google Antigravity CLI',
    subtitle: 'Google · cuentas personales (Free, Pro, Ultra)',
    command: 'agy',
    install: 'irm https://antigravity.google/cli/install.ps1 | iex',
    docsUrl: 'https://antigravity.google/docs/cli/tutorial/',
    loginNotes: 'Google trasladó las cuentas personales de Gemini CLI a Antigravity CLI en junio de 2026. Ejecuta agy e inicia sesión directamente con Google; la sesión permanece en el cliente oficial, no se importa a Core.',
    provider: 'google'
  },
  {
    id: 'gemini',
    title: 'Gemini',
    subtitle: 'Google · Code Assist Enterprise / API',
    command: 'gemini',
    install: 'npm install -g @google/gemini-cli',
    docsUrl: 'https://geminicli.com/docs/get-started/authentication/',
    loginNotes: 'Gemini CLI sigue disponible para Gemini Code Assist empresarial y accesos compatibles. Para cuentas Google personales, usa Antigravity CLI (agy). Las credenciales no se importan a Core.',
    provider: 'google'
  },
  {
    id: 'claude',
    title: 'Claude',
    subtitle: 'Anthropic',
    command: 'claude',
    install: 'winget install Anthropic.ClaudeCode',
    docsUrl: 'https://code.claude.com/docs/en/overview',
    loginNotes: 'El inicio de sesión con correo se realiza dentro de Claude Code sin modificar. Claude no permite usar sus tokens de suscripción como acceso directo en el chat de una IDE externa.',
    provider: 'anthropic'
  }
];

export default function AIConnectionsHub({ chatGPTCount, apiCounts, onChatGPT, onApi, onClose, onNotify, onLaunch, bridgeReady, bridgeTools, launchingTool }: Props) {
  const [copied, setCopied] = useState('');
  async function copy(id: string, command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(id);
      onNotify('Comando copiado. Ejecútalo en la terminal nativa de tu equipo.');
    } catch {
      onNotify('El navegador no permitió copiar. Selecciona el comando visible para copiarlo.', true);
    }
  }
  const apiTotal = Object.values(apiCounts).reduce((sum, n) => sum + (n || 0), 0);
  return <div className="ai-hub">
    <div className="ai-hub-intro">
      <div className="ai-hub-logo"><Layers3 size={23}/></div>
      <div><strong>Un lugar para tus modelos y cuentas</strong>
        <p>Cada proveedor conserva su propia autenticación. Una cuenta web no se convierte automáticamente en acceso para otra aplicación.</p>
      </div>
    </div>
    <div className="ai-hub-totals">
      <div><UsersRound size={15}/><strong>{chatGPTCount}</strong><span>Cuenta(s) ChatGPT registradas</span></div>
      <div><KeyRound size={15}/><strong>{apiTotal}</strong><span>Perfiles API en esta pestaña</span></div>
      <div><ShieldCheck size={15}/><span>Sin extracción de cookies ni sesiones</span></div>
    </div>

    <ModelFinder onConnect={onApi}/>
    <div className="ai-hub-label">ACCESO DIRECTO DISPONIBLE EN CORE</div>
    <div className="ai-hub-card ai-hub-featured">
      <div className="ai-hub-card-heading"><div className="ai-hub-provider-icon chatgpt-icon"><Bot size={19}/></div>
        <div><strong>ChatGPT</strong><span>OpenAI · OAuth para aplicaciones elegibles</span></div>
        <span className="ai-hub-state ready">Beta en Core</span>
      </div>
      <p>Autoriza tu cuenta desde la página oficial de OpenAI, registra varias identidades separadas y selecciona el modelo habilitado en cada una. El componente local conserva los tokens; Pages no los recibe.</p>
      <button className="primary-button" onClick={onChatGPT}><UsersRound size={15}/> Administrar cuentas ChatGPT <ArrowRight size={14}/></button>
    </div>

    <div className="ai-hub-label">CLIENTES OFICIALES CON CORREO · SIN IMPORTAR CREDENCIALES A CORE</div>
    <div className="ai-hub-native-grid">
      {nativeGuides.map(guide => <div key={guide.id} className="ai-hub-card native-provider-card">
        <div className="ai-hub-card-heading"><div className={'ai-hub-provider-icon '+guide.id+'-icon'}><Laptop size={19}/></div>
          <div><strong>{guide.title}</strong><span>{guide.subtitle}</span></div>
          <span className="ai-hub-state native">CLI oficial</span>
        </div>
        <p>{guide.loginNotes}</p>
        <div className="ai-hub-command-label">Instalación oficial (opcional, si aún no lo tienes):</div>
        <div className="ai-hub-command"><code>{guide.install}</code><button type="button" title={'Copiar instalación de '+guide.title} onClick={() => void copy(guide.id+'-install',guide.install)}>{copied===guide.id+'-install'?<Check size={14}/>:<Copy size={14}/>}</button></div>
        <div className="ai-hub-command-label">Abrir la herramienta en la terminal nativa e iniciar sesión:</div>
        <div className="ai-hub-command">
          <code>{guide.command}</code>
          <button type="button" title={'Copiar '+guide.command} onClick={() => void copy(guide.id, guide.command)}>{copied===guide.id?<Check size={14}/>:<Copy size={14}/>}</button>
        </div>
        <div className="ai-hub-native-actions">
          <button className="native-launch-button" disabled={(bridgeReady && !bridgeTools[guide.id]) || !!launchingTool} onClick={() => void onLaunch(guide.id)}><TerminalSquare size={13}/>{launchingTool===guide.id ? 'Esperando autorización…' : bridgeReady ? bridgeTools[guide.id] ? 'Abrir CLI en Windows' : 'CLI no instalado' : 'Conectar Bridge para abrir'}</button>
          <a href={guide.docsUrl} target="_blank" rel="noopener noreferrer">Documentación oficial <ExternalLink size={13}/></a>
          <button onClick={()=>onApi(guide.provider)}>Usar API en Core <ArrowRight size={13}/></button>
        </div>
      </div>)}
    </div>

    <div className="ai-hub-label">OTRAS CONEXIONES Y CATÁLOGOS</div>
    <div className="ai-hub-card">
      <div className="ai-hub-card-heading"><div className="ai-hub-provider-icon deepseek-icon"><Layers3 size={19}/></div>
        <div><strong>DeepSeek</strong><span>Chat oficial independiente · API dentro de Core</span></div>
        <span className="ai-hub-state api">API en Core</span>
      </div>
      <p>Puedes usar su chat oficial con tu propia cuenta, pero DeepSeek no publica un inicio de sesión de cuenta de chat que autorice llamadas de modelos desde AliceLabs Core. La integración interna utiliza su API oficial y admite varias claves de cuentas autorizadas.</p>
      <div className="ai-hub-action-row">
        <button className="secondary-button" onClick={()=>onApi('deepseek')}><KeyRound size={14}/> Conectar DeepSeek API <ArrowRight size={13}/></button>
        <a href="https://chat.deepseek.com/" target="_blank" rel="noopener noreferrer">Chat web independiente <ExternalLink size={13}/></a>
        <a href="https://api-docs.deepseek.com/api/list-models/" target="_blank" rel="noopener noreferrer">Modelos oficiales <ExternalLink size={13}/></a>
      </div>
    </div>
    <div className="ai-hub-card compact-api">
      <div className="ai-hub-card-heading"><div className="ai-hub-provider-icon openrouter-icon"><KeyRound size={19}/></div>
        <div><strong>OpenRouter y más proveedores API</strong><span>Modelos de diferentes empresas, con claves propias</span></div>
        <span className="ai-hub-state api">API en Core</span>
      </div>
      <div className="ai-hub-action-row"><button className="secondary-button" onClick={()=>onApi('openrouter')}><KeyRound size={14}/> Administrar perfiles API <ArrowRight size={13}/></button></div>
    </div>

    <div className="ai-hub-label">NUEVOS PROVEEDORES CON API DIRECTA</div>
    <div className="ai-hub-native-grid">
      {([{id:'groq',name:'Groq Cloud',description:'Modelos alojados en Groq; cuenta y clave API propias.'},
         {id:'mistral',name:'Mistral AI',description:'Modelos Mistral; acceso autorizado mediante API.'},
         {id:'xai',name:'xAI Grok',description:'Modelos Grok; clave emitida por xAI.'}] as const).map(item =>
        <div key={item.id} className="ai-hub-card native-provider-card">
          <div className="ai-hub-card-heading"><div className="ai-hub-provider-icon"><KeyRound size={19}/></div><div><strong>{item.name}</strong><span>Cuenta API del proveedor</span></div><span className="ai-hub-state api">API Core</span></div>
          <p>{item.description} Las credenciales y los modelos se verifican al conectar.</p>
          <button className="secondary-button" onClick={()=>onApi(item.id)}>Conectar {item.name} API <ArrowRight size={13}/></button>
        </div>)}
    </div>
    <div className="ai-hub-policy"><CircleHelp size={17}/><span>Los botones Antigravity, Gemini CLI y Claude Code pueden abrir los programas oficiales en una terminal local Windows, con aprobación en el Bridge; no conectan sus suscripciones al chat de AliceLabs Core. La autenticación directa de DeepSeek por correo tampoco está disponible para terceros. Las conexiones API y ChatGPT permanecen separadas y no rotan cuentas para evitar límites.</span></div>
    <div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button></div>
  </div>;
}
