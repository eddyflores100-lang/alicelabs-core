import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,copyFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

class TestStorage {
  constructor(){this.data=new Map();this.nextAlarm=null;}
  async get(k){return this.data.get(k);}
  async put(k,v){this.data.set(k,v);}
  async delete(k){this.data.delete(k);}
  async list({prefix}={}){return new Map([...this.data.entries()].filter(([k])=>!prefix||k.startsWith(prefix)));}
  async setAlarm(t){this.nextAlarm=t;}
}
async function makeRuntime() {
  const folder=await mkdtemp(path.join(tmpdir(),'alice-core-tasks-'));
  const source=await readFile(new URL('./src/index.js',import.meta.url),'utf8');
  await writeFile(path.join(folder,'package.json'),JSON.stringify({type:'module'}));
  await writeFile(path.join(folder,'runtime.js'),source.replace("'cloudflare:workers'","'./mock.mjs'"));
  await writeFile(path.join(folder,'mock.mjs'),"export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}");
  for(const name of ['policy.mjs','vault.mjs','whatsapp.mjs','projectTasks.mjs']){
    await copyFile(new URL('./src/'+name,import.meta.url),path.join(folder,name));
  }
  const mod=await import(pathToFileURL(path.join(folder,'runtime.js')).href);
  return {mod,folder};
}
const account='owner@example.com';
const project='ea2b674a-827e-431a-bafb-91b8af2f6c13';
const base='https://private.example/v1/projects/'+project;
function makeServer(module){
  const instances=new Map();
  const env={SANDBOX:{getByName(name){
    if(!instances.has(name)){
      const storage=new TestStorage();
      const ctx={storage,container:null,waitUntil:()=>{}};
      const instance=new module.ProjectSandbox(ctx,{});
      instance.execute=async command=>Response.json({ok:true,exitCode:0,output:'MOCK '+command.bin});
      instances.set(name,instance);
    }
    return instances.get(name);
  }}};
  const ctx={access:{getIdentity:async()=>({email:account})}};
  return {env,ctx,instances};
}
test('Authenticated project task runs alarm and stores completed result',async()=>{
  const {mod,folder}=await makeRuntime();
  try {
    const server=makeServer(mod);
    const make=(method,url,body)=>new Request(url,{
      method,headers:{Origin:'https://alicelabs-core.pages.dev'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const deny=await mod.default.fetch(make('GET',base+'/tasks'),server.env,{});
    assert.equal(deny.status,403);
    const invalid=await mod.default.fetch(make('POST',base+'/tasks',{title:'No approval',steps:['node-version']}),server.env,server.ctx);
    assert.equal(invalid.status,400);
    const created=await mod.default.fetch(make('POST',base+'/tasks',{approved:true,title:'Test workflow',steps:['node-version','git-status']}),server.env,server.ctx);
    assert.equal(created.status,202);
    const {task}=await created.json();
    assert.equal(task.status,'queued');
    const [instance]=server.instances.values();
    assert.ok(instance.ctx.storage.nextAlarm);
    await instance.alarm();
    const midway=await mod.default.fetch(make('GET',base+'/tasks/'+task.id),server.env,server.ctx);
    const halfway=(await midway.json()).task;
    assert.equal(halfway.status,'queued');
    assert.equal(halfway.current,1);
    await instance.alarm();
    const done=await mod.default.fetch(make('GET',base+'/tasks/'+task.id),server.env,server.ctx);
    assert.equal((await done.json()).task.status,'completed');
    const deleted=await mod.default.fetch(make('DELETE',base+'/tasks/'+task.id),server.env,server.ctx);
    assert.equal(deleted.status,200);
    const missing=await mod.default.fetch(make('GET',base+'/tasks/'+task.id),server.env,server.ctx);
    assert.equal(missing.status,404);
  } finally {await rm(folder,{recursive:true,force:true});}
});
test('Cancel pending task stops future execution',async()=>{
  const {mod,folder}=await makeRuntime();
  try {
    const server=makeServer(mod);
    const request=(url,method,body)=>new Request(url,{method,headers:{Origin:'https://alicelabs-core.pages.dev'},...(body?{body:JSON.stringify(body)}:{})});
    const create=await mod.default.fetch(request(base+'/tasks','POST',{approved:true,title:'Cancel task',steps:['pnpm-build']}),server.env,server.ctx);
    assert.equal(create.status,202);
    const id=(await create.json()).task.id;
    const cancel=await mod.default.fetch(request(base+'/tasks/'+id+'/cancel','POST'),server.env,server.ctx);
    assert.equal(cancel.status,200);
    const [instance]=server.instances.values();
    await instance.alarm();
    const job=(await (await mod.default.fetch(request(base+'/tasks/'+id,'GET'),server.env,server.ctx)).json()).task;
    assert.equal(job.status,'cancelled');
    assert.equal(job.results.length,0);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('Identical project IDs are isolated across owner identities',async()=>{
  const {mod,folder}=await makeRuntime();
  try {
    const server=makeServer(mod);
    const make=(method,url,body)=>new Request(url,{method,headers:{Origin:'https://alicelabs-core.pages.dev'},...(body?{body:JSON.stringify(body)}:{})});
    const first=await mod.default.fetch(make('POST',base+'/tasks',{approved:true,title:'Private project task',steps:['node-version']}),server.env,server.ctx);
    assert.equal(first.status,202);
    const saved=(await first.json()).task;
    const foreign={access:{getIdentity:async()=>({email:'another-owner@example.com'})}};
    const other=await mod.default.fetch(make('GET',base+'/tasks/'+saved.id),server.env,foreign);
    assert.equal(other.status,404);
    assert.equal(server.instances.size,2);
    const original=await mod.default.fetch(make('GET',base+'/tasks/'+saved.id),server.env,server.ctx);
    assert.equal(original.status,200);
  }finally{await rm(folder,{recursive:true,force:true});}
});
