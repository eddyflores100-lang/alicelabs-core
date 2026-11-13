/**
 * Browser-side bounded source selection for the resident Core agent.
 * The scoper sees filenames only, never source values or API credentials.
 * A deterministic local focus window keeps huge files within model context.
 */
import type {FileNode} from './workspace';

export type BrowserCatalogEntry={path:string};
export type BrowserSelection={path:string;start?:number;end?:number};
export type FocusedSource={
  path:string;full:string;excerpt:string;start:number|null;end:number|null;
};
const TEXT=/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|css|scss|html|htm|md|mdx|json|sql|yml|yaml|vue|svelte)$/i;
const BLOCKED_SEGMENTS=new Set([
  '.git','.github','.next','node_modules','dist','build','target','coverage',
  '.cache','vendor','generated','secrets','credentials','private'
]);
const SECRET_NAME=/(?:^|[._-])(?:secrets?|passwords?|credentials?|api[_-]?keys?|tokens?|private[_-]?keys?|id[_-]?rsa|\.env)(?:[._-]|$)/i;
const MAX_CATALOG_ITEMS=350;
const MAX_CATALOG_BYTES=24000;
const MAX_CONTEXT=20500;
const encoder=new TextEncoder();

const EMBEDDED_SECRET=/(?:-----BEGIN\s+(?:(?:OPENSSH|RSA|EC)\s+)?PRIVATE\s+KEY-----)|(?:github_pat_|ghp_|sk-|AIza)[A-Za-z0-9_-]{14,}|(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["']([^"'\r\n]{8,})["']/i;
export function assertSafeAutomaticSource(content:string):void{
  if(typeof content!=='string'||EMBEDDED_SECRET.test(content))
    throw new Error('Archivo con posibles credenciales: exclúyelo de selección automática y revisa su contenido de forma manual.');
}
export function safeBrowserSourcePath(file:string):boolean{
  return typeof file==='string'&&file.length>0&&file.length<=260&&TEXT.test(file)&&
    !file.startsWith('/')&&!file.includes('\\')&&!/[\u0000-\u001f\u007f]/.test(file)&&
    file.split('/').every(x=>x&&x!=='.'&&x!=='..'&&!x.startsWith('.')&&!BLOCKED_SEGMENTS.has(x.toLowerCase()))&&
    !SECRET_NAME.test(file.split('/').at(-1)||'');
}
export function buildBrowserCatalog(nodes:FileNode[],goal:string):BrowserCatalogEntry[]{
  const seen=new Set<string>();
  const candidates=nodes.filter(n=>n.kind==='file'&&safeBrowserSourcePath(n.path)&&!seen.has(n.path)&&!!seen.add(n.path))
    .map(n=>({path:n.path}));
  const terms=Array.from(new Set(goal.toLowerCase().match(/[a-z0-9_]{3,}/g)||[])).slice(0,15);
  const rank=(entry:BrowserCatalogEntry)=>{
    const path=entry.path.toLowerCase(),name=path.split('/').at(-1)||path;
    return terms.reduce((score,t)=>score+(name.includes(t)?4:path.includes(t)?2:0),0);
  };
  const ranked=candidates.sort((a,b)=>rank(b)-rank(a));
  const selected:BrowserCatalogEntry[]=[];
  let bytes=2;
  for(const entry of ranked.slice(0,MAX_CATALOG_ITEMS)){
    const next=encoder.encode(JSON.stringify(entry)).length+1;
    if(bytes+next>MAX_CATALOG_BYTES)continue;
    selected.push(entry);bytes+=next;
  }
  if(selected.length<2)throw new Error('El proyecto necesita al menos dos archivos de código permitidos.');
  return selected;
}
export function parseBrowserScope(raw:string,catalog:BrowserCatalogEntry[]):BrowserSelection[]{
  if(typeof raw!=='string'||raw.length>9000)throw new Error('El scoper no devolvió una selección válida.');
  let text=raw.trim();
  const fence=String.fromCharCode(96).repeat(3);
  if(text.startsWith(fence)){
    const begin=text.indexOf('\n'),end=text.lastIndexOf(fence);
    if(begin<0||end<=begin)throw new Error('Respuesta del scoper inválida.');
    text=text.slice(begin+1,end).trim();
  }
  let parsed:unknown;
  try{parsed=JSON.parse(text);}catch{throw new Error('El scoper debe responder con JSON estricto.');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('El scoper debe devolver una lista.');
  const files=(parsed as Record<string,unknown>).files;
  if(!Array.isArray(files)||files.length<2||files.length>8)
    throw new Error('El scoper debe seleccionar entre dos y ocho archivos.');
  const known=new Set(catalog.map(f=>f.path));
  const used=new Set<string>(),out:BrowserSelection[]=[];
  for(const selector of files){
    if(typeof selector!=='string'||selector.length>290)throw new Error('Selector de archivo inválido.');
    const match=selector.match(/^(.*?)(?:#L([1-9]\d*)-L([1-9]\d*))?$/);
    if(!match||!safeBrowserSourcePath(match[1])||!known.has(match[1])||used.has(match[1]))
      throw new Error('El modelo propuso una ruta desconocida, repetida o privada.');
    used.add(match[1]);
    const start=match[2]?Number(match[2]):undefined;
    const end=match[3]?Number(match[3]):undefined;
    if(start!==undefined&&(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
      end!<start||end!-start>=200))
      throw new Error('El scoper propuso un rango de líneas inválido.');
    out.push({path:match[1],...(start===undefined?{}:{start,end})});
  }
  return out;
}

function words(goal:string):string[]{
  return Array.from(new Set(goal.toLowerCase().match(/[a-z0-9_]{4,}/g)||[])).slice(0,14);
}
function bestLine(lines:string[],goal:string):number {
  const terms=words(goal);
  let highest=-1,index=0;
  for(let i=0;i<lines.length;i++){
    const line=lines[i].toLowerCase();
    const score=terms.reduce((sum,t)=>sum+(line.includes(t)?2:0),0)+
      (/^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\b/.test(line)?1:0);
    if(score>highest){highest=score;index=i;}
  }
  return index;
}
export function focusSource(path:string,full:string,goal:string,
  selection:BrowserSelection,budget:number):FocusedSource{
  if(selection.path!==path||!safeBrowserSourcePath(path))throw new Error('Ruta fuera de la selección aprobada.');
  if(encoder.encode(full).length>900000||full.includes('\0'))
    throw new Error('Archivo binario o de más de 900 KB no admitido.');
  if(!Number.isSafeInteger(budget)||budget<700||budget>12000)
    throw new Error('Presupuesto de contexto inválido.');
  if(selection.start===undefined&&encoder.encode(full).length<=budget)
    return {path,full,excerpt:full,start:null,end:null};
  const eol=full.includes('\r\n')?'\r\n':'\n';
  const lines=full.split(/\r?\n/);
  const center=selection.start===undefined?bestLine(lines,goal):
    Math.floor((selection.start+selection.end!)/2)-1;
  if(center<0||center>=lines.length||
    selection.start!==undefined&&selection.end!>lines.length)
    throw new Error('Rango seleccionado fuera del archivo.');
  let begin=Math.max(0,center-55),finish=Math.min(lines.length-1,center+55);
  if(selection.start!==undefined){
    begin=selection.start-1;finish=selection.end!-1;
  }
  while(begin<finish&&encoder.encode(lines.slice(begin,finish+1).join(eol)).length>budget){
    if(finish-center>=center-begin)finish--;else begin++;
  }
  const excerpt=lines.slice(begin,finish+1).join(eol);
  if(encoder.encode(excerpt).length>budget)
    throw new Error('La línea seleccionada supera el presupuesto; divide la tarea.');
  return {path,full,excerpt,start:begin+1,end:finish+1};
}
export function focusBrowserFiles(files:{path:string;full:string;selection:BrowserSelection}[],
  goal:string):FocusedSource[]{
  if(files.length<2||files.length>8)throw new Error('Selecciona entre dos y ocho archivos.');
  const perFile=Math.min(11200,Math.floor(MAX_CONTEXT/files.length)-100);
  const focused=files.map(file=>focusSource(file.path,file.full,goal,file.selection,perFile));
  const used=focused.reduce((sum,f)=>sum+encoder.encode(f.excerpt).length,0);
  if(used>MAX_CONTEXT)throw new Error('El lote supera el contexto de código permitido.');
  return focused;
}
export function expandFocusedChange(focused:FocusedSource,originalExcerpt:string,next:string):{
  path:string;original:string;next:string;
}{
  if(originalExcerpt!==focused.excerpt||typeof next!=='string'||next.includes('\0'))
    throw new Error('La respuesta de IA no coincide con el fragmento autorizado.');
  if(focused.start===null)return {path:focused.path,original:focused.full,next};
  const eol=focused.full.includes('\r\n')?'\r\n':'\n';
  const lines=focused.full.split(/\r?\n/);
  const existing=lines.slice(focused.start-1,focused.end!).join(eol);
  if(existing!==originalExcerpt)throw new Error('El fragmento cambió antes de crear la propuesta.');
  const replacement=next.replace(/\r\n?/g,'\n').split('\n');
  return {
    path:focused.path,original:focused.full,
    next:[...lines.slice(0,focused.start-1),...replacement,...lines.slice(focused.end!)].join(eol)
  };
}
