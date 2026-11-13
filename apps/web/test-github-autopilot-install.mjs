import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_AUTOPILOT_WORKFLOW_PATH,getAutopilotInstallation,
  installAutopilotWorkflow,uninstallAutopilotWorkflow,renderAutopilotWorkflow
} from './src/githubAutopilotInstall.ts';
import {utf8ToBase64} from './src/githubWorkspace.ts';

const repo={owner:'alice-labs',repo:'sample-project',branch:'main',private:true};
const token='github_pat_scoped_autopilot_test';
const core='a'.repeat(40);
const fileSha='b'.repeat(40);
const installedSha='c'.repeat(40);
const url='https://api.github.com/repos/alice-labs/sample-project/contents/'+CORE_AUTOPILOT_WORKFLOW_PATH;
function json(status,data){
  return Response.json(data,{status});
}
test('Template is SHA pinned and disabled by default',()=>{
  const result=renderAutopilotWorkflow(core);
  assert.match(result,/cron: '\*\/5 \* \* \* \*'/);
  assert.match(result,/core-autopilot\.yml@a{40}/);
  assert.match(result,/engine_sha: a{40}/);
  assert.match(result,/CORE_AUTOPILOT_ENABLED == 'true'/);
  assert.match(result,/CORE_AGENT_API_KEY/);
  assert.equal(result.includes(token),false);
  assert.throws(()=>renderAutopilotWorkflow('main'),/SHA/);
});
test('Core repository is built in and does not need an installer',async()=>{
  const request=async()=>{throw Error('No network expected');};
  const state=await getAutopilotInstallation({
    ...repo,owner:'eddyflores100-lang',repo:'alicelabs-core'
  },token,request);
  assert.equal(state.installed,true);
  assert.equal(state.builtin,true);
});
test('An unrelated workflow at the managed path is never overwritten',async()=>{
  const request=async(_url)=>json(200,{type:'file',encoding:'base64',
    sha:fileSha,content:utf8ToBase64('name: private build\non: push')});
  const state=await getAutopilotInstallation(repo,token,request);
  assert.equal(state.conflict,true);
  assert.equal(state.installed,false);
  let attempts=0;
  await assert.rejects(installAutopilotWorkflow(repo,token,async(...args)=>{
    attempts++;return request(...args);
  }),/no se sobrescribirá/);
  assert.equal(attempts,1);
});
test('Owner installs pinned workflow with only target scoped token',async()=>{
  const calls=[];
  const request=async(target,init)=>{
    calls.push({target,init});
    if(init.method==='GET'&&target.startsWith(url))return new Response(null,{status:404});
    if(init.method==='GET'&&String(target).endsWith('/commits/main')){
      assert.equal(new Headers(init.headers).get('Authorization'),null);
      return json(200,{sha:core});
    }
    assert.equal(target,url.split('?')[0]);
    assert.equal(init.method,'PUT');
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);
    assert.equal(init.credentials,'omit');
    const body=JSON.parse(init.body);
    assert.equal(body.branch,'main');
    assert.equal('sha' in body,false);
    assert.equal(body.content,utf8ToBase64(renderAutopilotWorkflow(core)));
    return json(201,{content:{sha:installedSha}});
  };
  const installed=await installAutopilotWorkflow(repo,token,request);
  assert.deepEqual(installed,{sourceSha:core,fileSha:installedSha,
    url:'https://github.com/alice-labs/sample-project/blob/main/'+CORE_AUTOPILOT_WORKFLOW_PATH});
  assert.deepEqual(calls.map(x=>x.init.method),['GET','GET','PUT']);
});
test('Updating a managed workflow uses optimistic SHA, does not overwrite unknown content',async()=>{
  let calls=0;
  const request=async(target,init)=>{
    calls++;
    if(target.startsWith(url)&&init.method==='GET')return json(200,{
      type:'file',encoding:'base64',sha:fileSha,
      content:utf8ToBase64(renderAutopilotWorkflow('d'.repeat(40)))
    });
    if(init.method==='GET')return json(200,{sha:core});
    assert.equal(JSON.parse(init.body).sha,fileSha);
    return json(200,{content:{sha:installedSha}});
  };
  const updated=await installAutopilotWorkflow(repo,token,request);
  assert.equal(updated.fileSha,installedSha);
  assert.equal(calls,3);
});
test('Missing Workflows permission yields an actionable error without exposing credentials',async()=>{
  const request=async(target,init)=>{
    if(target.startsWith(url)&&init.method==='GET')return new Response(null,{status:404});
    if(init.method==='GET')return json(200,{sha:core});
    return json(403,{secret:token});
  };
  await assert.rejects(installAutopilotWorkflow(repo,token,request),e=>{
    assert.match(e.message,/Workflows: write/);
    assert.doesNotMatch(e.message,/github_pat_/);
    return true;
  });
});

test('Uninstall removes only previously marked Core workflow with optimistic SHA',async()=>{
  const seen=[];
  const request=async(target,init)=>{
    seen.push({target,method:init.method});
    if(init.method==='GET')return json(200,{
      type:'file',encoding:'base64',sha:fileSha,
      content:utf8ToBase64(renderAutopilotWorkflow(core))
    });
    assert.equal(init.method,'DELETE');
    assert.equal(target,url);
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);
    assert.deepEqual(JSON.parse(init.body),{
      message:'Core: desinstalar autopiloto aprobado',sha:fileSha,branch:'main'
    });
    return json(200,{commit:{sha:installedSha}});
  };
  assert.equal(await uninstallAutopilotWorkflow(repo,token,request),true);
  assert.deepEqual(seen.map(x=>x.method),['GET','DELETE']);
});
test('Uninstall refuses to delete unrelated workflows',async()=>{
  let writes=0;
  const request=async(_target,init)=>{
    if(init.method==='DELETE')writes++;
    return json(200,{type:'file',encoding:'base64',sha:fileSha,content:utf8ToBase64('name: unrelated')});
  };
  await assert.rejects(uninstallAutopilotWorkflow(repo,token,request),/No existe un workflow/);
  assert.equal(writes,0);
});
