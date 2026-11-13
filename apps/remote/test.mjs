import test from 'node:test';
import assert from 'node:assert/strict';
import {validProject,safePath,safeText,safeCommand} from './src/policy.mjs';
import {validOptIn,whatsappReady,notifyWhatsApp} from './src/whatsapp.mjs';

test('Project namespace ids are UUIDs, not arbitrary paths',()=>{
  assert.equal(validProject('09c33b7e-6a83-4d65-a0ad-8d6d8113abef'),true);
  assert.equal(validProject('../secrets'),false);
  assert.equal(validProject(''),false);
  assert.equal(validProject('abc'),false);
});
test('Reject unsafe paths and limit text files',()=>{
  for(const path of ['../test','../../etc/passwd','/etc/passwd','project/../secret','.','file\\name','folder//file','file%2ftrick','C:/windows']) {
    assert.equal(safePath(path),null,path);
  }
  assert.equal(safePath('src/components/App.tsx'),'src/components/App.tsx');
  assert.equal(safeText('hello'),'hello');
  assert.equal(safeText('x\0y'),null);
  assert.equal(safeText('x'.repeat(250001)),null);
});
test('No commands without explicit approval; no shell binary',()=>{
  assert.equal(safeCommand({bin:'git',args:['status'],approved:false}),null);
  assert.equal(safeCommand({bin:'bash',args:['-c','id'],approved:true}),null);
  assert.equal(safeCommand({bin:'node',args:['--version'],approved:true}).bin,'node');
  assert.equal(safeCommand({bin:'git',args:[],approved:true}).bin,'git');
  assert.equal(safeCommand({bin:'git',args:[null],approved:true}),null);
});
test('WhatsApp requires explicit opt-in, valid number and platform secrets',()=>{
  assert.equal(validOptIn({enabled:true,to:'+593987654321',optIn:false}),null);
  assert.equal(validOptIn({enabled:true,to:'1234',optIn:true}),null);
  assert.deepEqual(validOptIn({enabled:false}),{enabled:false,optIn:false,to:''});
  assert.equal(whatsappReady({}),false);
  assert.equal(whatsappReady({WHATSAPP_TOKEN:'s',WHATSAPP_PHONE_NUMBER_ID:'987654321',WHATSAPP_TEMPLATE_NAME:'tarea_finalizada'}),true);
});
test('Only approved Meta template endpoint is called; no exposed key or body text',async()=>{
  const env={WHATSAPP_TOKEN:'fake-private-key',WHATSAPP_PHONE_NUMBER_ID:'987654321',WHATSAPP_TEMPLATE_NAME:'tarea_finalizada'};
  const realFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,opts)=>{
    calls++;
    assert.equal(url,'https://graph.facebook.com/v25.0/987654321/messages');
    assert.equal(opts.headers.Authorization,'Bearer fake-private-key');
    const payload=JSON.parse(opts.body);
    assert.equal(payload.to,'593987654321');
    assert.equal(payload.type,'template');
    assert.equal(payload.template.name,'tarea_finalizada');
    assert.ok(!('text' in payload));
    return Response.json({messages:[{id:'wamid.test'}]});
  };
  try{
    assert.deepEqual(await notifyWhatsApp(env,{enabled:true,optIn:true,to:'+593987654321'},'job123','tarea finalizada'),{sent:true});
    assert.equal(calls,1);
    assert.deepEqual(await notifyWhatsApp(env,{enabled:false,optIn:false,to:''},'job123','tarea'),{sent:false,reason:'not-configured'});
    assert.equal(calls,1);
  }finally{globalThis.fetch=realFetch;}
});
