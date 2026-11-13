import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
type VoiceResult = { isFinal:boolean; 0:{transcript:string} };
type VoiceEvent = { resultIndex:number; results:ArrayLike<VoiceResult> };
type VoiceError = { error:string };
type Recognition = {
  lang:string; continuous:boolean; interimResults:boolean;
  onresult:((event:VoiceEvent)=>void)|null;
  onerror:((event:VoiceError)=>void)|null;
  onend:(()=>void)|null;
  start:()=>void; stop:()=>void; abort:()=>void;
};
type SpeechWin = Window & { SpeechRecognition?:new()=>Recognition; webkitSpeechRecognition?:new()=>Recognition };
export default function VoiceInput({ onTranscript, onNotice, disabled=false }:{
  onTranscript:(text:string)=>void;
  onNotice:(message:string,isError?:boolean)=>void;
  disabled?:boolean;
}) {
  const [recording,setRecording]=useState(false);
  const rec=useRef<Recognition|null>(null);
  useEffect(()=>()=>{try{rec.current?.abort();}catch{/* app closing */}},[]);
  async function toggle() {
    if (Capacitor.isNativePlatform()) {
      if (recording) return;
      setRecording(true);
      try {
        const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
        const support = await SpeechRecognition.available();
        if (!support.available) throw new Error('El reconocimiento de voz no está disponible en este dispositivo');
        const permission = await SpeechRecognition.requestPermissions();
        if (permission.speechRecognition !== 'granted') throw new Error('Autoriza el micrófono para dictar');
        const output = await SpeechRecognition.start({
          language:'es-EC',maxResults:1,popup:true,partialResults:false,
          prompt:'Dictar para AliceLabs Core'
        });
        const spoken = output.matches?.[0]?.trim();
        if(spoken)onTranscript(spoken);
      } catch(error) {
        onNotice(error instanceof Error?error.message:'No se pudo completar el dictado',true);
      } finally {setRecording(false);}
      return;
    }
    if(rec.current){rec.current.stop();return;}
    const constructor = (window as SpeechWin).SpeechRecognition || (window as SpeechWin).webkitSpeechRecognition;
    if(!constructor){onNotice('El dictado del navegador no está disponible en este dispositivo. Prueba Chrome Android o el dictado del teclado.',true);return;}
    try {
      const instance = new constructor();
      rec.current=instance;
      instance.lang='es-EC';
      instance.continuous=false;
      instance.interimResults=false;
      instance.onresult=event=>{
        const parts:string[]=[];
        for(let i=event.resultIndex;i<event.results.length;i++){
          if(event.results[i].isFinal)parts.push(event.results[i][0].transcript.trim());
        }
        if(parts.length)onTranscript(parts.join(' '));
      };
      instance.onerror=event=>{
        if(event.error!=='aborted')onNotice(event.error==='not-allowed'?'Permiso de micrófono rechazado':'No se pudo reconocer la voz: '+event.error,true);
      };
      instance.onend=()=>{rec.current=null;setRecording(false);};
      instance.start();setRecording(true);
    } catch(e) {
      rec.current=null;setRecording(false);
      onNotice(e instanceof Error?e.message:'No se pudo iniciar el micrófono',true);
    }
  }
  return <button type="button" className={'voice-button '+(recording?'recording':'')} onClick={toggle} disabled={disabled}
    aria-label={recording?'Detener dictado':'Dictar mensaje por voz'} title={recording?'Detener dictado':'Dictar en español con autorización del micrófono'}>
    {recording?<MicOff size={16}/>:<Mic size={16}/>}
    <span>{recording?'Detener':'Dictar'}</span>
  </button>;
}
