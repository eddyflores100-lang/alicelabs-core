import test from 'node:test';
import assert from 'node:assert/strict';
import {createGithubBatchPR,validateBatchGithubFiles} from './src/githubBatchPullRequest.ts';
const repo={owner:'example-org',repo:'demo',branch:'main',private:true};
const token='github_pat_test_token_restricted_to_demo';
const sha=n=>n.repeat(40);
const files=[
  {path:'src/a.ts',content:'export const a = 2',expectedSha:sha('a')},
  {path:'src/b.ts',content:'export const b = 3',expectedSha:sha('b')}
];
function response(status,data){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
}
test('Atomic Git Trees create one commit for multiple reviewed files, and a new PR',async()=>{
  const calls=[];
  const request=async(url,init)=>{
    const p=new URL(url).pathname;
    const method=init?.method||'GET';
    calls.push({p,method,body:init?.body?JSON.parse(String(init.body)):null});
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);
    assert.equal(init.credentials,'omit');
    if(method==='GET'&&p.includes('/git/ref/heads/'))return response(200,{object:{sha:sha('c')}});
    if(method==='GET'&&p.includes('/git/commits/'))return response(200,{tree:{sha:sha('d')}});
    if(method==='GET'&&p.includes('/git/trees/'))return response(200,{truncated:false,tree:[
      {path:'src/a.ts',type:'blob',mode:'100644'},{path:'src/b.ts',type:'blob',mode:'100755'}
    ]});
    if(method==='GET'&&p.includes('/contents/')){
      return response(200,{type:'file',sha:p.endsWith('/a.ts')?sha('a'):sha('b')});
    }
    if(method==='POST'&&p.endsWith('/git/blobs'))return response(201,{sha:sha('e')});
    if(method==='POST'&&p.endsWith('/git/trees')){
      const tree=JSON.parse(String(init.body));
      assert.equal(tree.base_tree,sha('d'));
      assert.equal(tree.tree.length,2);
      assert.equal(tree.tree[0].path,'src/a.ts');
      assert.equal(tree.tree[1].path,'src/b.ts');
      assert.equal(tree.tree[1].mode,'100755');
      return response(201,{sha:sha('f')});
    }
    if(method==='POST'&&p.endsWith('/git/commits')){
      const commit=JSON.parse(String(init.body));
      assert.deepEqual(commit.parents,[sha('c')]);
      assert.equal(commit.tree,sha('f'));
      return response(201,{sha:sha('1')});
    }
    if(method==='POST'&&p.endsWith('/git/refs')){
      assert.match(JSON.parse(String(init.body)).ref,/^refs\/heads\/core\/batch-/);
      assert.equal(JSON.parse(String(init.body)).sha,sha('1'));
      return response(201,{ref:'refs/heads/core/batch-test'});
    }
    if(method==='POST'&&p.endsWith('/pulls')){
      const pr=JSON.parse(String(init.body));
      assert.equal(pr.base,'main');
      assert.match(pr.head,/^core\/batch-/);
      return response(201,{html_url:'https://github.com/example-org/demo/pull/7'});
    }
    throw Error('Unexpected '+method+' '+p);
  };
  const result=await createGithubBatchPR({repo,token,files,title:'Core: refactor',message:'Refactor tests'},request);
  assert.equal(result.url,'https://github.com/example-org/demo/pull/7');
  assert.equal(result.files,2);
  assert.equal(result.commitSha,sha('1'));
  assert.equal(calls.filter(x=>x.method==='POST'&&x.p.endsWith('/git/commits')).length,1);
  assert.equal(calls.filter(x=>x.method==='POST'&&x.p.endsWith('/git/trees')).length,1);
});
test('Original SHA mismatch stops all writes before Git blobs are created',async()=>{
  let writes=0;
  const request=async(url,init)=>{
    if(init.method==='POST'){writes++;throw Error('Must never write');}
    const p=new URL(url).pathname;
    if(p.includes('/git/ref/heads/'))return response(200,{object:{sha:sha('c')}});
    if(p.includes('/git/commits/'))return response(200,{tree:{sha:sha('d')}});
    if(p.includes('/git/trees/'))return response(200,{truncated:false,tree:[{path:'src/a.ts',type:'blob',mode:'100644'},{path:'src/b.ts',type:'blob',mode:'100644'}]});
    return response(200,{type:'file',sha:sha('9')});
  };
  await assert.rejects(createGithubBatchPR({
    repo,token,files,title:'Update',message:'Update'
  },request),/cambió/);
  assert.equal(writes,0);
});
test('A malformed or unapproved batch never reaches GitHub',async()=>{
  assert.throws(()=>validateBatchGithubFiles([files[0]]),/2 a 8/);
  assert.throws(()=>validateBatchGithubFiles([files[0],files[0]]),/duplicados/);
  assert.throws(()=>validateBatchGithubFiles([{...files[0],path:'../.env'},files[1]]),/Ruta/);
  assert.throws(()=>validateBatchGithubFiles([{...files[0],expectedSha:'invalid'},files[1]]),/SHA/);
  let contacted=false;
  await assert.rejects(createGithubBatchPR({
    repo,token:'',files,title:'Update',message:'Update'
  },async()=>{contacted=true;throw Error('Not expected');}),/credencial GitHub/);
  assert.equal(contacted,false);
});
