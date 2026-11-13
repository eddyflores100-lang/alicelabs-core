import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  parseScopedPaths,readScopedFiles,extractModelText,callModel,runCloudCoder
} from './cloud-code-agent.mjs';

const token='github_token_test_with_scoped_permissions';
const key='provider_api_key_for_testing_only_1234';
function mockProvider(outputs){
  let index=0;
  return async (url,options)=>{
    assert.equal(String(url),'https://api.openai.com/v1/responses');
    assert.equal(new Headers(options.headers).get('Authorization'),'Bearer '+key);
    assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);
    assert.equal(body.store,false);
    assert.ok(body.input.includes('Untrusted project files'));
    return Response.json({output_text:outputs[index++]});
  };
}
async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'core-cloud-coder-'));
  await mkdir(path.join(root,'src'),{recursive:true});
  await writeFile(path.join(root,'src/a.ts'),'export const n=1','utf8');
  await writeFile(path.join(root,'src/a.test.ts'),'expect(n).toBe(1)','utf8');
  return root;
}
test('Only explicit existing src/ paths are accepted',()=>{
  assert.deepEqual(parseScopedPaths('src/a.ts, src/a.test.ts'),['src/a.ts','src/a.test.ts']);
  assert.deepEqual(parseScopedPaths('apps/web/src/App.tsx,apps/api/src/index.js'),
    ['apps/web/src/App.tsx','apps/api/src/index.js']);
  for(const input of [
    'apps/web/src/../.env,src/a.ts',
    'apps/other/src/malicious.js,src/a.ts',
    'apps/api/test.mjs,src/a.ts',
    '.github/workflows/core-ci.yml,src/a.ts',
    '../.env,src/b.ts','src/../.github/workflows/x.ts,src/a.ts',
    'src/a.ts,src/a.ts','/src/a.ts,src/b.ts',
    'src/a.ts,src/.env','src/a.ts,src\\b.ts'
  ])assert.throws(()=>parseScopedPaths(input));
});
test('File reader refuses symlinks and only reads scoped content',async()=>{
  const root=await fixture();
  try{
    assert.deepEqual((await readScopedFiles(root,parseScopedPaths('src/a.ts,src/a.test.ts')))
      .map(x=>x.path),['src/a.ts','src/a.test.ts']);
    await symlink(path.join(root,'src/a.ts'),path.join(root,'src/link.ts'));
    await assert.rejects(readScopedFiles(root,['src/a.ts','src/link.ts']),/enlaces simbólicos/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Cloud agent reads real Core monorepo directories without escaping the scope',async()=>{
  const root=await fixture();
  try {
    const web=path.join(root,'apps/web/src');const api=path.join(root,'apps/api/src');
    await mkdir(web,{recursive:true});await mkdir(api,{recursive:true});
    await writeFile(path.join(web,'App.tsx'),'export const component=1');
    await writeFile(path.join(api,'index.js'),'export const api=2');
    const paths=parseScopedPaths('apps/web/src/App.tsx,apps/api/src/index.js');
    assert.deepEqual((await readScopedFiles(root,paths)).map(x=>x.path),paths);
    await assert.rejects(readScopedFiles(root,['apps/web/src/App.tsx','apps/api/src/absent.js']));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Model response adapters parse official provider response shapes',()=>{
  assert.equal(extractModelText('openai',{output_text:'OpenAI output'}),'OpenAI output');
  assert.equal(extractModelText('anthropic',{content:[{text:'Claude output'}]}),'Claude output');
  assert.equal(extractModelText('openrouter',{choices:[{message:{content:'Router output'}}]}),'Router output');
  assert.equal(extractModelText('google',{candidates:[{content:{parts:[{text:'Gemini output'}]}}]}),'Gemini output');
  for(const provider of ['deepseek','groq','mistral','xai']){
    assert.equal(extractModelText(provider,{choices:[{message:{content:'official completion'}}]}),'official completion');
  }
  assert.throws(()=>extractModelText('openai',{}),/sin texto/);
});
test('Provider failures never include secret-bearing response content',async()=>{
  const fetcher=async()=>new Response('provider_api_key_for_testing_only_1234',{status:401});
  await assert.rejects(callModel({
    provider:'openai',model:'gpt-4.1-mini',apiKey:key,role:'coder',message:'Explain',
    codeContext:'data'
  },fetcher),err=>{
    assert.match(err.message,/HTTP 401/);
    assert.doesNotMatch(err.message,/provider_api_key/);
    return true;
  });
});
test('Bounded cloud team creates a branch, commit and PR without executing generated code',async()=>{
  const root=await fixture();
  try{
    const outputs=[
      'Change constant and test only',
      JSON.stringify({changes:[
        {path:'src/a.ts',content:'export const n=2'},
        {path:'src/a.test.ts',content:'expect(n).toBe(2)'}
      ]}),
      '{"approved":true,"issues":[]}'
    ];
    const commands=[];
    const result=await runCloudCoder({
      root,goal:'Update constant and associated test',paths:'src/a.ts,src/a.test.ts',
      provider:'openai',model:'gpt-4.1-mini',apiKey:key,
      githubToken:token,baseBranch:'main',
      fetcher:mockProvider(outputs),
      gitCommand:(_cwd,args)=>{
        commands.push(args);
        if(args[0]==='status')return '';
        return 'ok';
      },
      ghCommand:(_cwd,args,provided)=>{
        assert.equal(provided,token);
        assert.deepEqual(args.slice(0,2),['pr','create']);
        return 'https://github.com/owner/repo/pull/42';
      }
    });
    assert.match(result.branch,/^core\/cloud-/);
    assert.equal(result.files.length,2);
    assert.equal(result.modelCalls,3);
    assert.equal(await readFile(path.join(root,'src/a.ts'),'utf8'),'export const n=2');
    assert.equal(await readFile(path.join(root,'src/a.test.ts'),'utf8'),'expect(n).toBe(2)');
    assert.deepEqual(commands.map(x=>x[0]),['status','status','switch','add','-c','push']);
    assert.equal(commands.some(x=>x[0]==='test'||x[0]==='run'||x[0]==='sh'),false);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Rejected AI reviews never change local files or launch git',async()=>{
  const root=await fixture();
  try{
    const outputs=[
      'Plan',
      '{"changes":[{"path":"src/a.ts","content":"export const n=100"}]}',
      '{"approved":false,"issues":["wrong"]}',
      '{"changes":[{"path":"src/a.ts","content":"export const n=101"}]}',
      '{"approved":false,"issues":["still wrong"]}'
    ];
    let gitCalls=0;
    await assert.rejects(runCloudCoder({
      root,goal:'Change number',paths:'src/a.ts,src/a.test.ts',provider:'openai',
      model:'gpt-4.1-mini',apiKey:key,githubToken:token,
      fetcher:mockProvider(outputs),
      gitCommand:()=>{gitCalls++;return '';}
    }),/revisor/);
    assert.equal(gitCalls,1); // read-only git status preflight, no write commands
    assert.equal(await readFile(path.join(root,'src/a.ts'),'utf8'),'export const n=1');
  }finally{await rm(root,{recursive:true,force:true});}
});


test('Dirty checkout aborts before any model call or file write',async()=>{
  const root=await fixture();
  try{
    let calls=0;
    await assert.rejects(runCloudCoder({
      root,goal:'Update sources',paths:'src/a.ts,src/a.test.ts',
      provider:'openai',model:'gpt-4.1-mini',apiKey:key,githubToken:token,
      fetcher:async()=>{calls++;throw Error('No model call allowed');},
      gitCommand:()=> ' M src/a.ts'
    }),/antes de consumir tokens/);
    assert.equal(calls,0);
    assert.equal(await readFile(path.join(root,'src/a.ts'),'utf8'),'export const n=1');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('Official model adapters use their own documented HTTPS endpoints and credentials',async()=>{
  const adapters=[
    ['anthropic','https://api.anthropic.com/v1/messages','x-api-key',{content:[{text:'okay'}]}],
    ['openrouter','https://openrouter.ai/api/v1/chat/completions','Authorization',{choices:[{message:{content:'okay'}}]}],
    ['deepseek','https://api.deepseek.com/chat/completions','Authorization',{choices:[{message:{content:'okay'}}]}],
    ['groq','https://api.groq.com/openai/v1/chat/completions','Authorization',{choices:[{message:{content:'okay'}}]}],
    ['mistral','https://api.mistral.ai/v1/chat/completions','Authorization',{choices:[{message:{content:'okay'}}]}],
    ['xai','https://api.x.ai/v1/chat/completions','Authorization',{choices:[{message:{content:'okay'}}]}],
    ['google','https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent','x-goog-api-key',{candidates:[{content:{parts:[{text:'okay'}]}}]}]
  ];
  for(const [provider,expectedUrl,header,answer] of adapters){
    const model=provider==='google'?'gemini-2.5-flash':'model-one';
    const received=await callModel({provider,model,apiKey:key,role:'coder',message:'Change',codeContext:'source'},
      async(url,init)=>{
        assert.equal(url,expectedUrl);
        assert.ok(new Headers(init.headers).get(header)?.includes(key));
        assert.equal(init.redirect,'error');
        return Response.json(answer);
      });
    assert.equal(received,'okay');
  }
});

test('Core monorepo autopilot generates a reviewed PR for real apps/web and apps/api paths',async()=>{
  const root=await fixture();
  try {
    await mkdir(path.join(root,'apps/web/src'),{recursive:true});
    await mkdir(path.join(root,'apps/api/src'),{recursive:true});
    await writeFile(path.join(root,'apps/web/src/Feature.ts'),'export const enabled=false');
    await writeFile(path.join(root,'apps/api/src/handler.js'),'export const status=0');
    const outputs=['Plan two bounded edits',JSON.stringify({changes:[
      {path:'apps/web/src/Feature.ts',content:'export const enabled=true'},
      {path:'apps/api/src/handler.js',content:'export const status=1'}
    ]}),JSON.stringify({approved:true,issues:[]})];
    const gitOps=[];
    const result=await runCloudCoder({
      root,goal:'Improve the web feature and API handler',
      paths:'apps/web/src/Feature.ts,apps/api/src/handler.js',
      provider:'openai',model:'gpt-4.1-mini',apiKey:key,githubToken:token,baseBranch:'main',
      fetcher:mockProvider(outputs),
      gitCommand:(_cwd,args)=>{gitOps.push(args);return args[0]==='status'?'':'ok';},
      ghCommand:()=> 'https://github.com/owner/repo/pull/123'
    });
    assert.equal(result.files.length,2);
    assert.equal(result.reviewApproved,true);
    assert.equal(await readFile(path.join(root,'apps/web/src/Feature.ts'),'utf8'),'export const enabled=true');
    assert.equal(gitOps.some(args=>['sh','bash','npm','node','test','run'].includes(args[0])),false);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('Large Core file can be patched by line range while preserving all surrounding content',async()=>{
  const root=await fixture();
  try{
    const folder=path.join(root,'apps/web/src');
    await mkdir(folder,{recursive:true});
    const full=Array.from({length:600},(_,i)=>
      i===0?'// PRIVATE OUTSIDE-OF-RANGE SENTINEL':
      'export const value'+i+' = '+i+';'
    ).join('\n')+'\n';
    const file=path.join(folder,'App.tsx');
    await writeFile(file,full);
    assert.ok(new TextEncoder().encode(full).length>12000);
    const paths='apps/web/src/App.tsx#L120-L124,src/a.test.ts';
    const expectedSnippet=full.split('\n').slice(119,124).join('\n');
    const sources=await readScopedFiles(root,parseScopedPaths(paths));
    assert.equal(sources[0].text,expectedSnippet);
    assert.equal(sources[0].path,'apps/web/src/App.tsx');
    assert.equal(sources[0].slice.start,120);
    assert.equal(sources[0].originalWhole,full);
    const revised=expectedSnippet.replace('value121 = 121','value121 = 999');
    const outputs=[
      'Review only the selected lines',
      JSON.stringify({changes:[
        {path:'apps/web/src/App.tsx',content:revised},
        {path:'src/a.test.ts',content:'expect(n).toBe(999)'}
      ]}),
      '{"approved":true,"issues":[]}'
    ];
    let calls=0;
    const gitOps=[];
    const result=await runCloudCoder({
      root,goal:'Update one constant and its test',
      paths,provider:'openai',model:'gpt-4.1-mini',apiKey:key,githubToken:token,
      fetcher:async(url,options)=>{
        const input=JSON.parse(options.body).input;
        assert.equal(input.includes('PRIVATE OUTSIDE-OF-RANGE SENTINEL'),false);
        return Response.json({output_text:outputs[calls++]});
      },
      gitCommand:(_cwd,args)=>{gitOps.push(args);return args[0]==='status'?'':'ok';},
      ghCommand:()=> 'https://github.com/owner/repo/pull/55'
    });
    assert.equal(result.reviewApproved,true);
    const after=await readFile(file,'utf8');
    const originalLines=full.split('\n'),changedLines=after.split('\n');
    assert.deepEqual(changedLines.slice(0,119),originalLines.slice(0,119));
    assert.deepEqual(changedLines.slice(124),originalLines.slice(124));
    assert.equal(changedLines[121],'export const value121 = 999;');
    assert.equal(gitOps.some(x=>x[0]==='sh'||x[0]==='bash'),false);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Invalid range selectors and duplicate paths are rejected before model calls',()=>{
  const companion='src/a.test.ts';
  for(const bad of [
    'apps/web/src/App.tsx#L0-L10',
    'apps/web/src/App.tsx#L25-L20',
    'apps/web/src/App.tsx#L10-L210',
    'apps/web/src/App.tsx#L100-Labc',
    'apps/web/src/../secrets.ts#L1-L10',
    'apps/web/src/App.tsx#L1-L10,apps/web/src/App.tsx#L20-L30'
  ]){
    assert.throws(()=>parseScopedPaths(bad.includes(',')?bad:bad+','+companion));
  }
});
test('Concurrent modification aborts a range edit without a git branch or overwrite',async()=>{
  const root=await fixture();
  try{
    const folder=path.join(root,'apps/web/src');
    await mkdir(folder,{recursive:true});
    const file=path.join(folder,'Large.ts');
    const original=Array.from({length:500},(_,i)=>'export const line'+i+' = '+i+';').join('\n');
    await writeFile(file,original);
    const excerpt=original.split('\n').slice(99,105).join('\n');
    const replies=[
      'Plan',JSON.stringify({changes:[{path:'apps/web/src/Large.ts',content:excerpt.replace('line101 = 101','line101 = 888')}]}),
      '{"approved":true,"issues":[]}'
    ];
    let calls=0;
    const gitCalls=[];
    await assert.rejects(runCloudCoder({
      root,goal:'Change selected range only',
      paths:'apps/web/src/Large.ts#L100-L105,src/a.test.ts',
      provider:'openai',model:'gpt-4.1-mini',apiKey:key,githubToken:token,
      fetcher:async()=>{
        const response=Response.json({output_text:replies[calls++]});
        if(calls===3)await writeFile(file,original+'\n// Concurrent edit');
        return response;
      },
      gitCommand:(_cwd,args)=>{gitCalls.push(args[0]);return '';},
      ghCommand:()=>{throw Error('should never open a PR');}
    }),/cambió durante la revisión/);
    assert.deepEqual(gitCalls,['status','status']);
    assert.equal(await readFile(file,'utf8'),original+'\n// Concurrent edit');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('Invalid UTF-8 source is rejected before model calls or writes',async()=>{
  const root=await fixture();
  try{
    await writeFile(path.join(root,'src/a.ts'),Buffer.from([0xff,0xfe,0x80,0x00]));
    await assert.rejects(
      readScopedFiles(root,parseScopedPaths('src/a.ts,src/a.test.ts')),
      /UTF-8|binarios/
    );
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Line-sliced edits preserve original BOM and CRLF newlines',async()=>{
  const root=await fixture();
  try{
    const folder=path.join(root,'apps/web/src');
    await mkdir(folder,{recursive:true});
    const file=path.join(folder,'Unicode.ts');
    const original='\ufeff'+Array.from({length:450},(_,i)=>'export const line'+i+' = '+i+';').join('\r\n')+'\r\n';
    await writeFile(file,original,'utf8');
    const excerpt=original.split(/\r?\n/).slice(120,123).join('\r\n');
    const changed=excerpt.replace('line121 = 121','line121 = 555');
    const outputs=[
      'Edit only selected section',
      JSON.stringify({changes:[{path:'apps/web/src/Unicode.ts',content:changed}]}),
      '{"approved":true,"issues":[]}'
    ];
    const result=await runCloudCoder({
      root,goal:'Modify the selected Unicode source lines safely',
      paths:'apps/web/src/Unicode.ts#L121-L123,src/a.test.ts',
      provider:'openai',model:'gpt-4.1-mini',apiKey:key,githubToken:token,
      fetcher:mockProvider(outputs),
      gitCommand:(_cwd,args)=>args[0]==='status'?'':'ok',
      ghCommand:()=> 'https://github.com/owner/repo/pull/71'
    });
    assert.equal(result.reviewApproved,true);
    const next=await readFile(file,'utf8');
    assert.ok(next.startsWith('\ufeff'));
    assert.ok(next.includes('line121 = 555'));
    assert.equal(next.split('\n').filter(x=>x.length>0&&!x.endsWith('\r')).length,0);
    assert.equal(next.split('\r\n').length,original.split('\r\n').length);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Automatic scoper discovers files, then planner/coder/reviewer produce a bounded PR',async()=>{
  const root=await fixture();
  try{
    const paths=['src/a.ts','src/a.test.ts'];
    const outputs=[
      JSON.stringify({files:paths}),
      'Plan: update the constant and its corresponding test',
      JSON.stringify({changes:[
        {path:paths[0],content:'export const n=42'},
        {path:paths[1],content:'expect(n).toBe(42)'}
      ]}),
      JSON.stringify({approved:true,issues:[]})
    ];
    const operations=[];
    const result=await runCloudCoder({
      root,goal:'Update the constant and its associated test',paths:'auto',
      provider:'openai',model:'gpt-4.1-mini',apiKey:key,githubToken:token,
      fetcher:mockProvider(outputs),
      gitCommand:(_cwd,args)=>{
        operations.push(args[0]);
        if(args[0]==='status')return '';
        if(args[0]==='ls-files')return paths.join('\0')+'\0';
        return 'ok';
      },
      ghCommand:()=> 'https://github.com/owner/repo/pull/60'
    });
    assert.equal(result.reviewApproved,true);
    assert.equal(result.modelCalls,4);
    assert.deepEqual(result.selectedFiles,paths);
    assert.equal(await readFile(path.join(root,'src/a.ts'),'utf8'),'export const n=42');
    assert.deepEqual(operations,['status','ls-files','status','switch','add','-c','push']);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Automatic scoper cannot select a file absent from Git tracked candidates',async()=>{
  const root=await fixture();
  try{
    let calls=0;
    const operations=[];
    await assert.rejects(runCloudCoder({
      root,goal:'Edit file outside tracked repository',paths:'auto',
      provider:'openai',model:'gpt-4.1-mini',apiKey:key,githubToken:token,
      fetcher:mockProvider([
        JSON.stringify({files:['src/a.ts','src/private.ts']})
      ]),
      gitCommand:(_cwd,args)=>{
        operations.push(args[0]);
        return args[0]==='ls-files'?'src/a.ts\0src/a.test.ts\0':'';
      },
      ghCommand:()=>{throw Error('Must not create a PR');}
    }),/rastreado|fuera/);
    assert.deepEqual(operations,['status','ls-files']);
    assert.equal(await readFile(path.join(root,'src/a.ts'),'utf8'),'export const n=1');
  }finally{await rm(root,{recursive:true,force:true});}
});
