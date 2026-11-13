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
  for(const input of [
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
