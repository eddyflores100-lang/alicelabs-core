import test from 'node:test';
import assert from 'node:assert/strict';
import {listGithubWorkflows,dispatchGithubWorkflow,dispatchGithubCloudCoder,isCloudCoderWorkflow,listGithubRuns,cancelGithubRun} from './src/githubActions.ts';
const repo={owner:'alice-labs',repo:'core-demo',branch:'main',private:true};
const token='github_pat_test_token_with_actions_permission';
function json(status,content){
  return new Response(JSON.stringify(content),{status,headers:{'content-type':'application/json'}});
}
test('Actions list comes only from authorized GitHub API and filters inactive workflows',async()=>{
  const request=async(url,init)=>{
    assert.equal(String(url),'https://api.github.com/repos/alice-labs/core-demo/actions/workflows?per_page=50');
    assert.equal(init.method,'GET');
    assert.equal(init.credentials,'omit');
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);
    assert.equal(new Headers(init.headers).get('X-GitHub-Api-Version'),'2026-03-10');
    return json(200,{workflows:[
      {id:5,name:'Build',path:'.github/workflows/build.yml',state:'active'},
      {id:6,name:'Disabled',path:'.github/workflows/old.yml',state:'disabled_manually'}
    ]});
  };
  const result=await listGithubWorkflows(repo,token,request);
  assert.equal(result.length,1);
  assert.equal(result[0].name,'Build');
});
test('Workflow dispatch references only selected workflow and repository branch',async()=>{
  const request=async(url,init)=>{
    assert.equal(String(url),'https://api.github.com/repos/alice-labs/core-demo/actions/workflows/5/dispatches');
    assert.equal(init.method,'POST');
    assert.deepEqual(JSON.parse(init.body),{ref:'main'});
    return json(200,{workflow_run_id:77,html_url:'https://github.com/alice-labs/core-demo/actions/runs/77'});
  };
  assert.deepEqual(await dispatchGithubWorkflow(repo,token,5,request),{
    accepted:true,runId:77,url:'https://github.com/alice-labs/core-demo/actions/runs/77'
  });
});
test('Accepted 204 dispatch reports receipt without inventing run ID',async()=>{
  const request=async()=>new Response(null,{status:204});
  assert.deepEqual(await dispatchGithubWorkflow(repo,token,5,request),{accepted:true,runId:null,url:null});
});
test('Rejects hostile run URL returned from remote API',async()=>{
  const request=async()=>json(200,{workflow_run_id:123,html_url:'https://evil.invalid/alice-labs/core-demo/actions/runs/123'});
  const result=await dispatchGithubWorkflow(repo,token,5,request);
  assert.equal(result.url,null);
});
test('Workflow list ignores runs with unknown links or invalid IDs',async()=>{
  const request=async(_url,init)=>{
    assert.equal(init.method,'GET');
    return json(200,{workflow_runs:[
      {id:77,name:'Build',status:'completed',conclusion:'success',
        html_url:'https://github.com/alice-labs/core-demo/actions/runs/77',event:'workflow_dispatch',
        created_at:'2026-11-13T12:00:00Z',head_branch:'main'},
      {id:78,html_url:'https://untrusted.example/path',status:'queued',conclusion:null},
      {id:-1,html_url:'https://github.com/alice-labs/core-demo/actions/runs/1'}
    ]});
  };
  const result=await listGithubRuns(repo,token,5,request);
  assert.equal(result.length,1);
  assert.equal(result[0].id,77);
});
test('Actions cannot be started without consent token or valid workflow ID',async()=>{
  let contacted=false;
  const request=async()=>{contacted=true;throw Error('Should not reach network');};
  await assert.rejects(dispatchGithubWorkflow(repo,token,0,request),/inválido/);
  await assert.rejects(dispatchGithubWorkflow(repo,'',5,request),/token/);
  assert.equal(contacted,false);
});
test('Cancels one named running workflow via official API only',async()=>{
  const request=async(url,init)=>{
    assert.equal(String(url),'https://api.github.com/repos/alice-labs/core-demo/actions/runs/77/cancel');
    assert.equal(init.method,'POST');
    return new Response(null,{status:204});
  };
  assert.equal(await cancelGithubRun(repo,token,77,request),true);
});
test('Insufficient Actions write permissions are reported as permission error',async()=>{
  const request=async()=>json(403,{error:'Not authorized'});
  await assert.rejects(dispatchGithubWorkflow(repo,token,5,request),/permiso Actions/);
});

test('Cancellation accepts GitHub HTTP 202 without a JSON body',async()=>{
  const request=async(_url,init)=>{
    assert.equal(init.method,'POST');
    return new Response(null,{status:202});
  };
  assert.equal(await cancelGithubRun(repo,token,83,request),true);
});

test('Core Cloud Coder dispatch sends bounded goal and file allowlist only to GitHub',async()=>{
  const request=async(url,init)=>{
    assert.equal(String(url),'https://api.github.com/repos/alice-labs/core-demo/actions/workflows/10/dispatches');
    assert.equal(init.method,'POST');
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);
    assert.deepEqual(JSON.parse(init.body),{
      ref:'main',inputs:{goal:'Refactor two files and update the tests',files:'src/a.ts,src/b.test.ts'}
    });
    return new Response(null,{status:204});
  };
  const result=await dispatchGithubCloudCoder(
    repo,token,10,'Refactor two files and update the tests',
    ' src/a.ts , src/b.test.ts ',request
  );
  assert.deepEqual(result,{accepted:true,runId:null,url:null});
});
test('Cloud Coder dispatch rejects invalid task sizes and escaped paths without network calls',async()=>{
  let called=0;
  const request=async()=>{called++;throw Error('Should not call API');};
  const cases=[
    ['no','src/a.ts,src/b.ts'],
    ['x'.repeat(1601),'src/a.ts,src/b.ts'],
    ['Update source files','src/a.ts,../secrets.ts'],
    ['Update source files','src/a.ts,src/a.ts'],
    ['Update source files','src/a.ts'],
    ['Update source files','src/a.ts,src/.env'],
    ['Update source files','src/a.ts,src\\bad.ts']
  ];
  for(const [goal,files] of cases){
    await assert.rejects(dispatchGithubCloudCoder(repo,token,10,goal,files,request));
  }
  assert.equal(called,0);
});


test('Cloud coding workflows are recognized by exact official or reusable wrapper path',()=>{
  assert.equal(isCloudCoderWorkflow({path:'.github/workflows/core-cloud-coder.yml'}),true);
  assert.equal(isCloudCoderWorkflow({path:'.github/workflows/cloud-coder.yml'}),true);
  assert.equal(isCloudCoderWorkflow({path:'.github/workflows/build.yml'}),false);
  assert.equal(isCloudCoderWorkflow(null),false);
});
