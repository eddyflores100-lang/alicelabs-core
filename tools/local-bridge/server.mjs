#!/usr/bin/env node
/**
 * Core Local Bridge: explicitly approved terminal execution on the user's machine.
 * Bind 127.0.0.1 ONLY. Never expose this port through tunnels or cloud routes.
 * Every command requires approval in the *local terminal* before spawning.
 */
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
const ROOT = path.resolve(process.argv[2] || process.cwd());
const TOKEN = crypto.randomBytes(32).toString('hex');
const PORT = 39007;
const rl = createInterface({ input: process.stdin, output: process.stdout });
let approvalQueue = Promise.resolve();
const validOrigin = (origin) => {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return (u.protocol === 'https:' && (u.hostname === 'alicelabs-core.pages.dev' || u.hostname.endsWith('.alicelabs-core.pages.dev')))
      || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && ['5173','4173'].includes(u.port));
  } catch { return false; }
};
function reply(res, origin, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Core-Token',
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin'
  });
  res.end(JSON.stringify(data));
}
function approve(command) {
  const task = approvalQueue.then(() => new Promise(resolve => {
    console.log('\n--- SOLICITUD CORE LOCAL BRIDGE ---');
    console.log('Carpeta: ' + ROOT);
    console.log('Comando: ' + command);
    rl.question('¿Autorizar ejecución? (escribe SI): ', input => resolve(input.trim().toUpperCase() === 'SI'));
  }));
  approvalQueue = task.then(() => undefined, () => undefined);
  return task;
}
function execute(command) {
  return new Promise(resolve => {
    const windows = process.platform === 'win32';
    const args = windows ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-lc', command];
    const child = spawn(windows ? 'powershell.exe' : '/bin/sh', args, { cwd: ROOT, shell: false, windowsHide: true, env: { ...process.env, CI: 'true', GIT_TERMINAL_PROMPT: '0' } });
    let output = '', truncated = false, finished = false;
    const onData = chunk => {
      if (output.length < 150000) output += chunk.toString().slice(0, 150000 - output.length);
      else truncated = true;
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const deadline = setTimeout(() => { child.kill(); }, 90000);
    const finish = (exitCode) => {
      if (finished) return;
      finished = true; clearTimeout(deadline);
      resolve({ output: output + (truncated ? '\n[Salida truncada]' : ''), exitCode });
    };
    child.on('error', error => finish(-1));
    child.on('close', code => finish(typeof code === 'number' ? code : -1));
  });
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (!validOrigin(origin)) { res.writeHead(403); res.end('Forbidden origin'); return; }
  if (req.method === 'OPTIONS') { reply(res, origin, 204, {}); return; }
  if (req.method === 'GET' && req.url === '/health') {
    reply(res, origin, 200, { ok: true, service: 'alicelabs-core-bridge', workspace: ROOT, pairing: 'required', approval: 'local-per-command' });
    return;
  }
  if (req.method === 'GET' && req.url === '/tools') {
    const received = String(req.headers['x-core-token'] || '');
    const a = Buffer.from(received), b = Buffer.from(TOKEN);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) { reply(res,origin,401,{error:'Token incorrecto'}); return; }
    const available = {};
    for (const name of ['agy','gemini','claude']) {
      available[name==='agy'?'antigravity':name] = process.platform === 'win32' &&
        spawnSync('where.exe',[name],{windowsHide:true,timeout:3500}).status === 0;
    }
    reply(res,origin,200,{ok:true,available,bridgeVersion:'0.2.0'});
    return;
  }
  if (req.method === 'POST' && req.url === '/launch') {
    const received = String(req.headers['x-core-token'] || '');
    const a = Buffer.from(received), b = Buffer.from(TOKEN);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) { reply(res,origin,401,{error:'Token incorrecto'}); return; }
    let payload = '';
    for await (const chunk of req) {
      payload += chunk.toString();
      if (payload.length > 1024) { reply(res,origin,413,{error:'Solicitud demasiado grande'}); return; }
    }
    let tool = '';
    try { tool = JSON.parse(payload).tool; } catch {}
    if (!['antigravity','gemini','claude'].includes(tool)) { reply(res,origin,400,{error:'Herramienta no permitida'}); return; }
    if (process.platform !== 'win32') { reply(res,origin,422,{error:'El lanzamiento interactivo está disponible únicamente en Windows por ahora'}); return; }
    const executable = tool==='antigravity' ? 'agy' : tool;
    if (spawnSync('where.exe',[executable],{windowsHide:true,timeout:3500}).status !== 0) {
      reply(res,origin,404,{error:'El CLI oficial no está instalado en el equipo: '+tool}); return;
    }
    const approved = await approve('ABRIR CLI OFICIAL: '+tool+' en una nueva terminal de Windows');
    if (!approved) { reply(res,origin,403,{error:'Inicio rechazado en la terminal local'}); return; }
    try {
      const child = spawn('powershell.exe',['-NoExit','-Command','& '+executable],{
        cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: false
      });
      child.unref();
      reply(res,origin,200,{ok:true,tool,started:true,message:'Se solicitó abrir el CLI en una nueva terminal nativa'});
    } catch {
      reply(res,origin,500,{error:'No se pudo abrir la terminal nativa'});
    }
    return;
  }
  if (req.method !== 'POST' || req.url !== '/run') { reply(res, origin, 404, { error: 'Ruta no encontrada' }); return; }
  const received = String(req.headers['x-core-token'] || '');
  const a = Buffer.from(received), b = Buffer.from(TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { reply(res, origin, 401, { error: 'Token de emparejamiento incorrecto' }); return; }
  let payload = ''; let tooLarge = false;
  for await (const chunk of req) {
    payload += chunk;
    if (payload.length > 4096) { tooLarge = true; break; }
  }
  if (tooLarge) { reply(res, origin, 413, { error: 'Comando demasiado grande' }); return; }
  let command;
  try { command = JSON.parse(payload).command; } catch {}
  if (typeof command !== 'string' || command.length < 1 || command.length > 450 || /[\r\n\0]/.test(command)) {
    reply(res, origin, 400, { error: 'Comando inválido' }); return;
  }
  const approved = await approve(command);
  if (!approved) { reply(res, origin, 403, { error: 'Comando rechazado en el equipo' }); return; }
  try { const result = await execute(command); reply(res, origin, 200, result); }
  catch { reply(res, origin, 500, { error: 'Error de ejecución' }); }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('\n╭─────────────────────────────────────────────────────╮');
  console.log('│  AliceLabs Core · LOCAL BRIDGE                     │');
  console.log('╰─────────────────────────────────────────────────────╯');
  console.log('Proyecto: ' + ROOT);
  console.log('Escuchando solo en http://127.0.0.1:' + PORT);
  console.log('\nTOKEN DE SESIÓN — pega esto en Core > Terminal:\n' + TOKEN);
  console.log('\nLa clave cambia al reiniciar. Cada comando requiere escribir SI aquí.');
  console.log('Presiona Ctrl+C para detener. No expongas este puerto a Internet.\n');
});
process.on('SIGINT', () => { console.log('\nBridge cerrado'); server.close(); rl.close(); process.exit(0); });
