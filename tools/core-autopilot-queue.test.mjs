import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVED,CLAIMED,REVIEW,FAILED,parseAutopilotIssue,
  chooseAutopilotIssue,countClaimsToday,claimNextAutopilotTask,markAutopilotTask
} from './core-autopilot-queue.mjs';
const repo='alice-labs/core';
const token='github_auth_test_token_for_repo';
const now=new Date('2026-11-13T08:00:00Z');
function issue(number,body,more={}){
  return {
    number,state:'open',author_association:'OWNER',
    labels:[{name:APPROVED}],
    body:JSON.stringify(body),
    ...more
  };
}
const task=(number,goal='Fix bug in source modules')=>
  issue(number,{goal,files:'src/a.ts,src/a.test.ts'});
function json(code,body){return Response.json(body,{status:code});}
test('Only approved owner/collaborator Issues qualify for automatic AI work',()=>{
  assert.deepEqual(parseAutopilotIssue(task(3)),{
    number:3,goal:'Fix bug in source modules',files:'src/a.ts,src/a.test.ts'
  });
  const candidates=[
    issue(5,{goal:'Fix app',files:'src/a.ts,src/b.ts'},{author_association:'NONE'}),
    issue(6,{goal:'Fix app',files:'src/a.ts,src/b.ts'},{labels:[]}),
    issue(7,{goal:'Fix app',files:'src/a.ts,src/b.ts'},{labels:[{name:APPROVED},{name:CLAIMED}]}),
    issue(8,{goal:'Fix app',files:'src/a.ts,../.env'}),
    issue(9,{goal:'Fix app',files:'src/a.ts,src/b.ts'},{pull_request:{url:'github'}}),
    issue(10,{goal:'Fix app',files:'src/a.ts,src/b.ts'},{body:'non JSON'})
  ];
  for(const one of candidates)assert.equal(parseAutopilotIssue(one),null);
});
test('Owner-approved Core monorepo files reach the autopilot queue',()=>{
  const approved=issue(44,{goal:'Refactor Core web and API modules',
    files:'apps/web/src/App.tsx,apps/api/src/index.js'});
  assert.deepEqual(parseAutopilotIssue(approved),{number:44,
    goal:'Refactor Core web and API modules',files:'apps/web/src/App.tsx,apps/api/src/index.js'});
  assert.equal(parseAutopilotIssue(issue(45,{goal:'Edit CI scripts',
    files:'.github/workflows/core-ci.yml,apps/web/src/App.tsx'})),null);
});
test('Large Core files may be approved with bounded line selectors',()=>{
  const requested=issue(62,{goal:'Fix small part of large Core App',
    files:'apps/web/src/App.tsx#L120-L180,apps/web/src/agent.ts'});
  assert.equal(parseAutopilotIssue(requested)?.number,62);
  assert.equal(parseAutopilotIssue(issue(63,{goal:'Unsafe line selection',
    files:'apps/web/src/App.tsx#L1-L500,apps/web/src/agent.ts'})),null);
});
test('Autopilot caps daily paid tasks and processes oldest approved one first',()=>{
  const tasks=[task(8),task(2),task(7)];
  assert.equal(chooseAutopilotIssue(tasks,0,2).number,2);
  assert.equal(chooseAutopilotIssue(tasks,2,2),null);
  assert.equal(chooseAutopilotIssue(tasks,3,100),null);
  assert.equal(chooseAutopilotIssue(tasks,0,0).number,2);
});
test('Daily count uses label history; updated old issues conservatively count',async()=>{
  const request=async(url,init)=>{
    assert.match(String(url),/state=all&labels=core-agent%3Aclaimed/);
    assert.equal(init.credentials,'omit');
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);
    return json(200,[
      {number:1,updated_at:'2026-11-13T00:00:00Z'},
      {number:2,updated_at:'2026-11-13T07:00:00Z'},
      {number:3,updated_at:'2026-11-12T23:59:00Z'},
      {number:4,updated_at:'2026-11-13T07:00:00Z',pull_request:{url:'...'}}
    ]);
  };
  assert.equal(await countClaimsToday({repo,token,now,request}),2);
});
test('Claims issue once after verifying daily cap and successful approved label',async()=>{
  const requests=[];
  const request=async(url,init)=>{
    const pathname=new URL(url).pathname;
    requests.push({pathname,method:init.method});
    if(pathname.endsWith('/labels/core-agent%3Aclaimed'))return json(200,{name:CLAIMED});
    if(pathname.endsWith('/issues/2/labels'))return json(200,[{name:APPROVED},{name:CLAIMED}]);
    if(pathname.endsWith('/issues'))return json(200,[task(3),task(2)]);
    return json(200,[]);
  };
  const result=await claimNextAutopilotTask({repo,token,now,limit:2,request});
  assert.equal(result.task.number,2);
  assert.equal(result.usage,1);
  assert.deepEqual(requests.map(x=>x.method),['GET','GET','GET','POST']);
});
test('Budget exhaustion skips any Issue read or write',async()=>{
  let calls=0;
  const request=async(url)=>{
    calls++;
    assert.match(String(url),/state=all&labels/);
    return json(200,[
      {updated_at:'2026-11-13T00:00:00Z'},
      {updated_at:'2026-11-13T07:00:00Z'}
    ]);
  };
  assert.equal((await claimNextAutopilotTask({repo,token,now,limit:2,request})).task,null);
  assert.equal(calls,1);
});
test('Finisher adds review state and a validated PR link only',async()=>{
  const request=async(url,init)=>{
    const pathname=new URL(url).pathname;
    if(pathname.endsWith('/labels/core-agent%3Areview'))return json(200,{name:REVIEW});
    if(pathname.endsWith('/issues/2/labels')){
      assert.deepEqual(JSON.parse(init.body),{labels:[REVIEW]});
      return json(200,[{name:REVIEW}]);
    }
    if(pathname.endsWith('/issues/2/comments')){
      const comment=JSON.parse(init.body).body;
      assert.match(comment,/https:\/\/github.com\/alice-labs\/core\/pull\/3/);
      assert.doesNotMatch(comment,/evil\.example/);
      return json(201,{id:8});
    }
    throw Error('Unexpected endpoint '+pathname);
  };
  const result=await markAutopilotTask({repo,token,number:2,success:true,
    prUrl:'https://github.com/alice-labs/core/pull/3',
    runUrl:'https://evil.example/alice-labs/core/actions/runs/3',request});
  assert.equal(result.label,REVIEW);
});
test('Failed work is marked failed and is never requeued without new authorization',async()=>{
  const calls=[];
  const request=async(url,init)=>{
    const pathname=new URL(url).pathname;
    calls.push({pathname,method:init.method});
    if(pathname.endsWith('/labels/core-agent%3Afailed'))return json(200,{name:FAILED});
    if(pathname.endsWith('/issues/2/labels'))return json(200,[{name:FAILED}]);
    if(pathname.endsWith('/issues/2/comments')){
      assert.match(JSON.parse(init.body).body,/no se reintentará automáticamente/);
      return json(201,{id:22});
    }
    throw Error('Unexpected endpoint '+pathname);
  };
  assert.equal((await markAutopilotTask({repo,token,number:2,success:false,request})).label,FAILED);
  assert.equal(calls.length,3);
});
