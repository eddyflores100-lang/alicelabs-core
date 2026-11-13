import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  validDiscoveryPath,buildRepositoryCatalog,parseScoperResponse,chooseSourceFiles
} from './repository-scope.mjs';

async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'core-auto-scope-'));
  await mkdir(path.join(root,'apps/web/src'),{recursive:true});
  await mkdir(path.join(root,'apps/api/src'),{recursive:true});
  await mkdir(path.join(root,'src'),{recursive:true});
  await writeFile(path.join(root,'apps/web/src/Widget.tsx'),
    'export function Widget() { return "ready"; }\nexport const status = true;\n');
  await writeFile(path.join(root,'apps/api/src/worker.js'),'export function handler() {return 1;}\n');
  await writeFile(path.join(root,'src/entry.ts'),'export const entry=1;\n');
  await writeFile(path.join(root,'apps/web/src/.secret.ts'),'SUPER_SECRET_API=should_not_leak\n');
  await writeFile(path.join(root,'apps/web/src/binary.ts'),Buffer.from([0xff,0xfe,0x00]));
  await symlink(path.join(root,'src/entry.ts'),path.join(root,'src/link.ts'));
  const tracked=[
    'apps/web/src/Widget.tsx','apps/api/src/worker.js','src/entry.ts',
    'apps/web/src/.secret.ts','apps/web/src/binary.ts','src/link.ts',
    '.env','apps/remote/private-key.pem','docs/README.md','node_modules/evil.js'
  ].join('\0')+'\0';
  return {root,tracked};
}

test('Automatic discovery scope is limited to tracked source code, never secrets',()=>{
  for(const p of ['src/entry.ts','apps/web/src/App.tsx','apps/api/src/index.js',
    'apps/remote/src/index.js'])assert.equal(validDiscoveryPath(p),true,p);
  for(const p of ['../.env','.github/workflows/ci.yml','apps/web/src/.secret.ts',
    'apps/other/src/index.ts','apps/web/secret.ts','src/../evil.ts','src/link\\escape.ts',
    'node_modules/index.js','src/no-extension','/src/entry.ts'])
    assert.equal(validDiscoveryPath(p),false,p);
});
test('File catalog omits hidden, binary, symlink and untracked files',async()=>{
  const {root,tracked}=await fixture();
  try{
    const catalog=await buildRepositoryCatalog(root,tracked);
    assert.deepEqual(catalog.map(f=>f.path),[
      'apps/web/src/Widget.tsx','apps/api/src/worker.js','src/entry.ts'
    ]);
    assert.deepEqual(catalog[0].hints[0],{line:1,kind:'function',name:'Widget'});
    assert.doesNotMatch(JSON.stringify(catalog),/SUPER_SECRET_API/);
    assert.equal(catalog[0].bytes>0,true);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Scoper may select only two to six known, distinct source paths',()=>{
  const catalog=[
    {path:'src/entry.ts',bytes:20,lines:5,hints:[]},
    {path:'apps/api/src/worker.js',bytes:100,lines:10,hints:[]}
  ];
  assert.deepEqual(parseScoperResponse(
    '{"files":["src/entry.ts","apps/api/src/worker.js"]}',catalog
  ),['src/entry.ts','apps/api/src/worker.js']);
  for(const proposed of [
    '{"files":["src/entry.ts"]}',
    '{"files":["src/entry.ts","src/entry.ts"]}',
    '{"files":["src/entry.ts","src/../escape.ts"]}',
    '{"files":["src/entry.ts","apps/api/src/unknown.js"]}',
    '{"files":["src/entry.ts","apps/api/src/worker.js#L20-L22"]}',
    '{"files":["src/entry.ts","apps/api/src/worker.js#L8-L5"]}',
    'file paths are in my explanation'
  ])assert.throws(()=>parseScoperResponse(proposed,catalog),/archivos|fuera|repetido|rango|JSON|lista/);
});
test('Large files require a bounded line window and preserve the selection',()=>{
  const catalog=[
    {path:'src/entry.ts',bytes:100,lines:4,hints:[]},
    {path:'apps/web/src/App.tsx',bytes:95000,lines:2000,hints:[]}
  ];
  assert.throws(()=>parseScoperResponse(
    '{"files":["src/entry.ts","apps/web/src/App.tsx"]}',catalog),/rango/);
  assert.deepEqual(parseScoperResponse(
    '{"files":["src/entry.ts","apps/web/src/App.tsx#L130-L185"]}',catalog
  ),['src/entry.ts','apps/web/src/App.tsx#L130-L185']);
});
test('Automatic selection sends only bounded structural hints, not source content',async()=>{
  const {root,tracked}=await fixture();
  try{
    let calls=0;
    const result=await chooseSourceFiles({
      root,goal:'Change the widget and API handler',tracked,
      ask:async(message,context)=>{
        calls++;
        assert.match(message,/ROL SCOPER/);
        assert.match(message,/Change the widget and API handler/);
        assert.ok(context.length<38000);
        assert.doesNotMatch(context,/SUPER_SECRET_API/);
        assert.doesNotMatch(context,/should_not_leak/);
        return JSON.stringify({files:['apps/web/src/Widget.tsx','apps/api/src/worker.js']});
      }
    });
    assert.equal(calls,1);
    assert.equal(result.candidates,3);
    assert.deepEqual(result.selectors,['apps/web/src/Widget.tsx','apps/api/src/worker.js']);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Oversized or empty repository index refuses autonomous selection',async()=>{
  const {root}=await fixture();
  try{
    await assert.rejects(buildRepositoryCatalog(root,'src/entry.ts\0'),/dos archivos/);
    await assert.rejects(buildRepositoryCatalog(root,'a'.repeat(5000001)),/demasiado extenso/);
  }finally{await rm(root,{recursive:true,force:true});}
});


test('No source initializers or embedded secrets are leaked through symbol hints',async()=>{
  const {root,tracked}=await fixture();
  try {
    await writeFile(path.join(root,'apps/web/src/Widget.tsx'),
      'export const PRIVATE_KEY = "SENSITIVE_VALUE_KEEP_PRIVATE";\n'+
      'export function Widget(){return "MORE_SENSITIVE_CONTENT";}\n');
    const catalog=await buildRepositoryCatalog(root,tracked,'Widget');
    const transferred=JSON.stringify(catalog);
    assert.match(transferred,/PRIVATE_KEY/);
    assert.doesNotMatch(transferred,/SENSITIVE_VALUE_KEEP_PRIVATE|MORE_SENSITIVE_CONTENT/);
    assert.deepEqual(catalog[0].hints[0],{line:1,kind:'const',name:'PRIVATE_KEY'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('A large catalog is bounded and ranks relevant paths before model call',async()=>{
  const {root}=await fixture();
  try {
    const dir=path.join(root,'apps/web/src');
    const names=[];
    for(let i=0;i<190;i++){
      const name='File'+String(i).padStart(3,'0')+'.ts';
      names.push('apps/web/src/'+name);
      await writeFile(path.join(dir,name),'export function Ordinary(){return '+i+';}\n'.repeat(9));
    }
    await writeFile(path.join(dir,'PaymentDashboard.ts'),'export function PaymentDashboard(){}\n');
    names.push('apps/web/src/PaymentDashboard.ts','apps/api/src/worker.js');
    const catalog=await buildRepositoryCatalog(root,names.join('\0')+'\0','Fix payment dashboard bug');
    assert.ok(Buffer.byteLength(JSON.stringify(catalog))<=38000);
    assert.equal(catalog[0].path,'apps/web/src/PaymentDashboard.ts');
    assert.ok(catalog.length>=2);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Relevant module beyond the first 450 tracked files is still discovered',async()=>{
  const {root}=await fixture();
  try{
    const dir=path.join(root,'apps/web/src');
    const paths=[];
    for(let i=0;i<470;i++){
      const name='Generic'+String(i).padStart(4,'0')+'.ts';
      paths.push('apps/web/src/'+name);
      await writeFile(path.join(dir,name),'export const val'+i+'='+i+';\n');
    }
    const desired='apps/web/src/InvoiceLedger.ts';
    paths.push(desired);
    await writeFile(path.join(dir,'InvoiceLedger.ts'),'export function InvoiceLedger(){}\n');
    const catalog=await buildRepositoryCatalog(root,paths.join('\0')+'\0',
      'Repair invoice ledger processing');
    assert.equal(catalog[0].path,desired);
    assert.ok(catalog.length<=450);
  }finally{await rm(root,{recursive:true,force:true});}
});
