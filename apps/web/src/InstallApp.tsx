import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowDownToLine, CheckCircle2, Download, MoreVertical, Share2, Smartphone, X } from 'lucide-react';
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
function installed() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(installed);
  const [instructions, setInstructions] = useState(false);
  const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent);
  useEffect(() => {
    const handler = (ev: Event) => { ev.preventDefault(); setPrompt(ev as InstallPromptEvent); };
    const update = () => { setStandalone(installed()); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', update);
    return () => { window.removeEventListener('beforeinstallprompt', handler); window.removeEventListener('appinstalled', update); };
  }, []);
  async function install() {
    if (standalone) return;
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(null);
      if (choice.outcome === 'accepted') setStandalone(true);
      else setInstructions(true);
    } else setInstructions(true);
  }
  if (standalone || Capacitor.isNativePlatform()) return null;
  return <>
    <button className="install-trigger" title="Instalar AliceLabs Core como app" onClick={() => void install()}><Download size={15}/><span>Instalar</span></button>
    {instructions && <div className="install-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setInstructions(false);}}>
      <div className="install-modal" role="dialog" aria-modal="true" aria-label="Instalar AliceLabs Core">
        <button className="install-close" onClick={()=>setInstructions(false)} aria-label="Cerrar"><X size={18}/></button>
        <div className="install-illustration"><Smartphone size={30}/></div>
        <h2>Instala Core en tu dispositivo</h2>
        <p>Es una aplicación web progresiva (PWA). Puede abrirse desde la pantalla de inicio, sin descargar un APK ni pasar por una tienda.</p>
        <div className="install-steps">
          {ios ? <>
            <div><Share2 size={19}/><span>Abre Core en Safari (u otro navegador compatible) y pulsa <strong>Compartir</strong>.</span></div>
            <div><ArrowDownToLine size={19}/><span>Selecciona <strong>Añadir a pantalla de inicio</strong> y confirma.</span></div>
          </> : <>
            <div><MoreVertical size={19}/><span>En Chrome o Edge, abre el menú del navegador (⋮).</span></div>
            <div><ArrowDownToLine size={19}/><span>Elige <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</span></div>
          </>}
          <div><CheckCircle2 size={19}/><span>Abre AliceLabs Core desde el icono instalado. Para conectar IA necesitarás internet.</span></div>
        </div>
        <p className="install-disclaimer">La versión móvil permite consultar GitHub, explorar modelos y editar archivos importados. Ejecutar terminales de otra computadora requiere un puente remoto seguro todavía no disponible.</p>
        <button className="primary-button" onClick={()=>setInstructions(false)}>Entendido</button>
      </div>
    </div>}
  </>;
}
