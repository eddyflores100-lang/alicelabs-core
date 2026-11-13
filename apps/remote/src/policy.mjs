/** Strict validation; all actual requests additionally require Cloudflare Access. */
export const PROJECT_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const COMMANDS = new Set(['git', 'node', 'npm', 'pnpm', 'python3', 'ls', 'pwd']);
export function validProject(value) {return typeof value==='string' && PROJECT_RE.test(value);}
export function safePath(value) {
  if(typeof value!=='string'||value.length>180||!value.length||value.includes('\\')||value.includes('\0'))return null;
  const segments=value.split('/');
  if(segments.length>16||segments.some(s=>!s||s==='.'||s==='..'||! /^[A-Za-z0-9._@+-]+$/.test(s)))return null;
  return segments.join('/');
}
export function safeCommand(body) {
  if(!body||typeof body!=='object'||body.approved!==true||!COMMANDS.has(body.bin))return null;
  if(!Array.isArray(body.args)||body.args.length>32||body.args.some(x=>typeof x!=='string'||x.length>180||x.includes('\0')))return null;
  return {bin:body.bin,args:body.args};
}
export function safeText(body) {
  return typeof body==='string' && body.length<=250000 && !body.includes('\0') ? body : null;
}
