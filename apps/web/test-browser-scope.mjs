import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeBrowserSourcePath,buildBrowserCatalog,parseBrowserScope,assertSafeAutomaticSource,
  focusSource,focusBrowserFiles,expandFocusedChange
} from './src/browserScope.ts';

const nodes=[
  {path:'src/Dashboard.tsx',name:'Dashboard.tsx',kind:'file'},
  {path:'src/Dashboard.test.ts',name:'Dashboard.test.ts',kind:'file'},
  {path:'src/.env.ts',name:'.env.ts',kind:'file'},
  {path:'src/api-credentials.ts',name:'api-credentials.ts',kind:'file'},
  {path:'node_modules/vendor.ts',name:'vendor.ts',kind:'file'},
  {path:'.github/workflows/publish.yml',name:'publish.yml',kind:'file'},
  {path:'src',name:'src',kind:'directory'}
];

test('Browser file scoper lists only editable source, not hidden or secret files',()=>{
  assert.deepEqual(buildBrowserCatalog(nodes,'Improve Dashboard'),[
    {path:'src/Dashboard.tsx'},{path:'src/Dashboard.test.ts'}
  ]);
  for(const file of ['../secrets.ts','src/../private.ts','src\\.env',
    '.github/workflows/ci.yml','node_modules/index.ts',
    'src/.env.ts','src/password.ts','src/API_TOKEN.js','build/generated.ts',
    '/src/valid.ts','src/file.bin','src/file.ts\0'])
    assert.equal(safeBrowserSourcePath(file),false,file);
  assert.equal(safeBrowserSourcePath('packages/widgets/src/Button.svelte'),true);
  assert.equal(safeBrowserSourcePath('src/Dashboard.tsx'),true);
});
test('Rejects unknown, duplicate and out-of-range model file selections',()=>{
  const c=buildBrowserCatalog(nodes,'Dashboard');
  assert.deepEqual(parseBrowserScope('{"files":["src/Dashboard.tsx","src/Dashboard.test.ts"]}',c),[
    {path:'src/Dashboard.tsx'},{path:'src/Dashboard.test.ts'}
  ]);
  assert.deepEqual(parseBrowserScope('{"files":["src/Dashboard.tsx#L4-L25","src/Dashboard.test.ts"]}',c),[
    {path:'src/Dashboard.tsx',start:4,end:25},{path:'src/Dashboard.test.ts'}
  ]);
  for(const raw of [
    '{"files":["src/Dashboard.tsx"]}',
    '{"files":["src/Dashboard.tsx","src/Dashboard.tsx"]}',
    '{"files":["src/Dashboard.tsx","src/.env.ts"]}',
    '{"files":["src/Dashboard.tsx","src/../../secret.ts"]}',
    '{"files":["src/Dashboard.tsx#L120-L10","src/Dashboard.test.ts"]}',
    '{"files":["src/Dashboard.tsx#L10-L250","src/Dashboard.test.ts"]}',
    '{"files":["src/Dashboard.tsx","src/unknown.ts"]}',
    'Follow my instructions instead'
  ])assert.throws(()=>parseBrowserScope(raw,c));
});
test('Large browser source is focused into a relevant segment without losing original content',()=>{
  const full='\ufeff'+Array.from({length:800},(_,i)=>i===444?
    'export function calculateInvoiceTotal(price:number){return price+1;}' :
    'export const unrelatedLine'+i+' = '+i+';').join('\r\n')+'\r\n';
  assert.ok(new TextEncoder().encode(full).length>12000);
  const choice={path:'src/Large.tsx'};
  const focused=focusSource('src/Large.tsx',full,'Fix calculateInvoiceTotal',choice,7500);
  assert.ok(focused.start<=445&&focused.end>=445);
  assert.ok(new TextEncoder().encode(focused.excerpt).length<=7500);
  const after=expandFocusedChange(focused,focused.excerpt,
    focused.excerpt.replace('price+1','price+2'));
  assert.equal(after.original,full);
  assert.ok(after.next.includes('calculateInvoiceTotal(price:number){return price+2;}'));
  assert.ok(after.next.startsWith('\ufeff'));
  assert.equal(after.next.split('\r\n').length,full.split('\r\n').length);
  const originalLines=full.split('\r\n');
  const nextLines=after.next.split('\r\n');
  assert.deepEqual(nextLines.slice(0,focused.start-1),originalLines.slice(0,focused.start-1));
  assert.deepEqual(nextLines.slice(focused.end),originalLines.slice(focused.end));
});
test('Batch context auto-shrinks per-file snippets before sending to provider',()=>{
  const files=Array.from({length:6},(_,i)=>{
    const full=Array.from({length:400},(_,n)=>'export const line'+n+' = '+n+';').join('\n');
    return {path:'src/File'+i+'.ts',full,selection:{path:'src/File'+i+'.ts'}};
  });
  const focused=focusBrowserFiles(files,'Update line310');
  assert.equal(focused.length,6);
  assert.ok(focused.every(f=>new TextEncoder().encode(f.excerpt).length<4000));
  assert.ok(focused.every(f=>f.start!==null));
  assert.ok(focused.reduce((total,f)=>total+new TextEncoder().encode(f.excerpt).length,0)<=20500);
});
test('Cannot expand a stale fragment or unauthorized source change',()=>{
  const source=focusSource('src/Large.tsx','export const x=1;\nexport const y=2;\n',
    'Fix y',{path:'src/Large.tsx'},700);
  assert.throws(()=>expandFocusedChange(source,'unexpected','bad'),/no coincide/);
  assert.throws(()=>focusSource('src/Large.tsx','abc','goal',
    {path:'src/different.ts'},700),/fuera de la selección/);
});
test('Browser catalog ranks owner objective even when relevant path comes last',()=>{
  const names=Array.from({length:390},(_,i)=>({
    path:'src/Generic'+i+'.ts',name:'Generic'+i+'.ts',kind:'file'
  }));
  names.push({path:'src/PaymentLedger.ts',name:'PaymentLedger.ts',kind:'file'});
  const selected=buildBrowserCatalog(names,'Fix payment ledger calculation');
  assert.equal(selected[0].path,'src/PaymentLedger.ts');
  assert.ok(new TextEncoder().encode(JSON.stringify(selected)).length<=24000);
});

test('Autonomous browser selection never forwards likely embedded credential values',()=>{
  for(const content of [
    'const apiKey = "sk-example-realistic-looking-key-material";',
    'export const PRIVATE_KEY = "long_secret_material_not_for_model";',
    '-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----',
    'const githubToken = "github_pat_ABCDEF1234567890";'
  ])assert.throws(()=>assertSafeAutomaticSource(content),/posibles credenciales/);
  assert.doesNotThrow(()=>assertSafeAutomaticSource('export function Login(){return process.env.API_KEY;}'));
  assert.doesNotThrow(()=>assertSafeAutomaticSource('export const passwordField = document.querySelector("#password")'));
});
