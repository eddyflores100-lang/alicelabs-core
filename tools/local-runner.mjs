#!/usr/bin/env node
/**
 * Launch the two local, separately authenticated companions from one terminal.
 * The user remains responsible for approving commands and OAuth consent.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = [
  ['Terminal Bridge', 'tools/local-bridge/server.mjs'],
  ['ChatGPT OAuth Companion', 'tools/chatgpt-companion/server.mjs']
];
const children = [];
console.log('\nAliceLabs Core · componentes locales\n');
console.log('Ambos servicios escuchan exclusivamente en 127.0.0.1.');
console.log('Las claves temporales aparecen aquí y NO se envían a Cloudflare.');
console.log('Pulsa Ctrl+C para cerrar ambos procesos.\n');
for (const [name, script] of tools) {
  const child = spawn(process.execPath,[script], { cwd:root, stdio:'inherit', windowsHide:false });
  child.on('error',error=>console.error(name+': '+error.message));
  child.on('exit',code=>console.log(name+' terminó ('+String(code)+')'));
  children.push(child);
}
function stop() {
  for(const child of children) if(child.exitCode===null) child.kill();
  process.exit(0);
}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
