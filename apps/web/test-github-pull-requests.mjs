import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listGithubPullRequests,getGithubPullRequest,listGithubPullFiles,
  canMergeGithubPR,mergeGithubPullRequest
} from './src/githubPullRequests.ts';

const repo={owner:'alice-labs',repo:'core',branch:'main',private:true};
const token='github_pat_test_pr_scoped_token';
const headSha='a'.repeat(40);
function pr(overrides={}){
  return {number:42,title:'Feature PR',state:'open',draft:false,
    html_url:'https://github.com/alice-labs/core/pull/42',
    head:{sha:headSha,ref:'feature'},base:{ref:'main'},
    mergeable:true,mergeable_state:'clean',...overrides};
}
function response(code,data){
  return new Response(JSON.stringify(data),{status:code,headers:{'content-type':'application/json'}});
}
test('Lists scoped open PRs and ignores unrelated or malicious URLs',async()=>{
  const request=async(url,init)=>{
    assert.equal(url,'https://api.github.com/repos/alice-labs/core/pulls?state=open&per_page=30');
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);
    assert.equal(init.credentials,'omit');
    return response(200,[pr(),pr({number:8,html_url:'https://evil.invalid/alice-labs/core/pull/8'}),pr({number:9,state:'closed'})]);
  };
  const items=await listGithubPullRequests(repo,token,request);
  assert.equal(items.length,1);
  assert.equal(items[0].number,42);
});
test('Lists changed files with truncated safe text patches',async()=>{
  const request=async(url,init)=>{
    assert.match(url,/\/pulls\/42\/files\?per_page=100$/);
    assert.equal(init.method,'GET');
    return response(200,[{filename:'src/a.ts',status:'modified',additions:5,deletions:1,patch:'a'.repeat(10000)}]);
  };
  const files=await listGithubPullFiles(repo,token,42,request);
  assert.equal(files.length,1);
  assert.equal(files[0].patch.length,3800);
});
test('Only clean, reviewed mergeable PR for selected base may merge',()=>{
  assert.equal(canMergeGithubPR(pr(),repo),true);
  for(const blocked of [
    pr({draft:true}),pr({mergeable:false}),pr({mergeable_state:'blocked'}),
    pr({mergeable_state:'unstable'}),pr({base:{ref:'development'}}),
    pr({head:{sha:'invalid',ref:'feature'}}),pr({state:'closed'})
  ])assert.equal(canMergeGithubPR(blocked,repo),false);
});
test('Merge always re-reads authoritative SHA and requires squash method',async()=>{
  const calls=[];
  const request=async(url,init)=>{
    calls.push({url,method:init.method,body:init.body?JSON.parse(init.body):null});
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);
    if(init.method==='GET')return response(200,pr());
    assert.equal(url,'https://api.github.com/repos/alice-labs/core/pulls/42/merge');
    assert.equal(init.method,'PUT');
    assert.deepEqual(JSON.parse(init.body),{
      sha:headSha,merge_method:'squash',commit_title:'Feature PR'
    });
    return response(200,{merged:true,sha:'b'.repeat(40)});
  };
  const result=await mergeGithubPullRequest(repo,token,pr(),request);
  assert.deepEqual(result,{merged:true,sha:'b'.repeat(40)});
  assert.deepEqual(calls.map(c=>c.method),['GET','PUT']);
});
test('Remote head update stops merge before write',async()=>{
  let writes=0;
  const request=async(_url,init)=>{
    if(init.method==='PUT')writes++;
    return response(200,pr({head:{sha:'c'.repeat(40),ref:'feature'}}));
  };
  await assert.rejects(mergeGithubPullRequest(repo,token,pr(),request),/cambió/);
  assert.equal(writes,0);
});
test('Blocks a previously clean PR when latest checks become blocked',async()=>{
  const request=async()=>response(200,pr({mergeable_state:'blocked'}));
  await assert.rejects(mergeGithubPullRequest(repo,token,pr(),request),/comprobaciones/);
});
test('GitHub conflict rejects merge instead of claiming success',async()=>{
  const request=async(_url,init)=>init.method==='GET'?response(200,pr()):response(409,{message:'SHA conflict'});
  await assert.rejects(mergeGithubPullRequest(repo,token,pr(),request),/cambios|revisión/i);
});
test('Invalid token or PR number cannot reach external API',async()=>{
  let called=false;
  const request=async()=>{called=true;throw Error('Unexpected');};
  await assert.rejects(listGithubPullRequests(repo,'',request),/token/);
  await assert.rejects(getGithubPullRequest(repo,token,0,request),/inválido/);
  assert.equal(called,false);
});
