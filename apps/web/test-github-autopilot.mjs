import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOPILOT_APPROVED_LABEL,validateAutopilotGoal,
  createApprovedAutopilotIssue,listApprovedAutopilotIssues,readAutopilotConfig,setAutopilotConfig
} from './src/githubAutopilot.ts';
const repo={owner:'alice-labs',repo:'core',branch:'main',private:true};
const token='github_pat_owner_test_token';
test('Autopilot issue inputs strictly restrict scope',()=>{
  assert.deepEqual(validateAutopilotGoal(' Improve this module ', 'src/a.ts, src/a.test.ts'),{
    goal:'Improve this module',files:'src/a.ts,src/a.test.ts'
  });
  assert.deepEqual(validateAutopilotGoal('Improve Core monorepo',
    'apps/web/src/App.tsx,apps/api/src/index.js'),{
    goal:'Improve Core monorepo',files:'apps/web/src/App.tsx,apps/api/src/index.js'
  });
  assert.deepEqual(validateAutopilotGoal('Edit one section of App safely',
    'apps/web/src/App.tsx#L120-L180,apps/web/src/agent.ts'),{
    goal:'Edit one section of App safely',
    files:'apps/web/src/App.tsx#L120-L180,apps/web/src/agent.ts'
  });
  for(const files of [
    'apps/web/src/App.tsx#L0-L10,src/a.ts',
    'apps/web/src/App.tsx#L20-L10,src/a.ts',
    'apps/web/src/App.tsx#L1-L250,src/a.ts',
    'apps/web/src/App.tsx#L1-L10,apps/web/src/App.tsx#L11-L20',
    'apps/web/src/../secrets.json,src/a.ts',
    'apps/untrusted/src/index.ts,src/a.ts',
    '.github/workflows/ci.yml,src/a.ts',
    'src/a.ts','src/a.ts,src/a.ts','src/a.ts,../.env',
    'src/a.ts,src/../private.ts','src/a.ts,src\\b.ts','src/a.ts,src/.env'
  ])assert.throws(()=>validateAutopilotGoal('Review existing files',files));
  assert.throws(()=>validateAutopilotGoal('bad','src/a.ts,src/b.ts'));
});
test('Owner queue Issue is explicitly labeled and uses a typed JSON body',async()=>{
  const request=async(url,init)=>{
    if(String(url)==='https://api.github.com/repos/alice-labs/core/labels/core-agent%3Aapproved'){
      assert.equal(init.method,'GET');
      return Response.json({name:AUTOPILOT_APPROVED_LABEL});
    }
    assert.equal(String(url),'https://api.github.com/repos/alice-labs/core/issues');
    assert.equal(init.method,'POST');
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);
    const body=JSON.parse(init.body);
    assert.deepEqual(body.labels,[AUTOPILOT_APPROVED_LABEL]);
    assert.deepEqual(JSON.parse(body.body),{
      goal:'Fix typecheck and refactor',files:'src/a.ts,src/a.test.ts'
    });
    assert.equal(init.redirect,'error');
    return Response.json({number:11,html_url:'https://github.com/alice-labs/core/issues/11'});
  };
  assert.deepEqual(await createApprovedAutopilotIssue(repo,token,
    'Fix typecheck and refactor','src/a.ts,src/a.test.ts',request),{
    number:11,url:'https://github.com/alice-labs/core/issues/11'
  });
});
test('Queue listing filters PRs and URL spoofing',async()=>{
  const request=async(url)=>{
    assert.match(String(url),/labels=core-agent%3Aapproved/);
    return Response.json([
      {number:11,title:'Coding task',html_url:'https://github.com/alice-labs/core/issues/11'},
      {number:15,title:'PR',html_url:'https://github.com/alice-labs/core/pull/15',pull_request:{}},
      {number:12,title:'Fake',html_url:'https://evil.invalid/core/issues/12'}
    ]);
  };
  const result=await listApprovedAutopilotIssues(repo,token,request);
  assert.equal(result.length,1);
  assert.equal(result[0].number,11);
});
test('Public API errors never repeat owner credentials',async()=>{
  const request=async(url)=>String(url).includes('/labels/')?Response.json({name:AUTOPILOT_APPROVED_LABEL}):Response.json({error:token},{status:403});
  await assert.rejects(createApprovedAutopilotIssue(repo,token,'Fix the files','src/a.ts,src/b.ts',request),
    err=>{assert.match(err.message,/autorización/);assert.doesNotMatch(err.message,/github_pat_/);return true;});
});


test('Autopilot variables report safe defaults for absent repository settings',async()=>{
  const request=async(url,init)=>{
    assert.equal(init.method,'GET');
    assert.match(String(url),/\/actions\/variables\/CORE_AUTOPILOT_/);
    return new Response(null,{status:404});
  };
  const status=await readAutopilotConfig(repo,token,request);
  assert.deepEqual(status,{enabled:false,codingEnabled:false,dailyLimit:2});
});
test('Enabling paid autopilot commits daily cap before enabling the coding gate',async()=>{
  const writes=[];
  const request=async(url,init)=>{
    if(init.method==='GET')return new Response(null,{status:404});
    writes.push({url,method:init.method,body:JSON.parse(init.body)});
    return Response.json({name:JSON.parse(init.body).name},{status:201});
  };
  await setAutopilotConfig(repo,token,{enabled:true,codingEnabled:true,dailyLimit:1},request);
  assert.deepEqual(writes.map(x=>x.body),[
    {name:'CORE_AUTOPILOT_CODING_ENABLED',value:'false'},
    {name:'CORE_AUTOPILOT_DAILY_LIMIT',value:'1'},
    {name:'CORE_AUTOPILOT_ENABLED',value:'true'},
    {name:'CORE_AUTOPILOT_CODING_ENABLED',value:'true'}
  ]);
});
test('Stopping autopilot disables new paid coding before the scheduler itself',async()=>{
  const writes=[];
  const request=async(url,init)=>{
    if(init.method==='GET')return Response.json({name:'status',value:'true'});
    writes.push(JSON.parse(init.body));
    return new Response(null,{status:204});
  };
  await setAutopilotConfig(repo,token,{enabled:false,codingEnabled:false,dailyLimit:3},request);
  assert.deepEqual(writes,[
    {name:'CORE_AUTOPILOT_CODING_ENABLED',value:'false'},
    {name:'CORE_AUTOPILOT_ENABLED',value:'false'}
  ]);
});
test('Autopilot cannot be configured for unlimited daily tasks',async()=>{
  let requests=0;
  await assert.rejects(setAutopilotConfig(repo,token,{enabled:true,codingEnabled:true,dailyLimit:10},
    async()=>{requests++;throw Error('Invalid request');}),/1 a 3 tareas/);
  assert.equal(requests,0);
});
