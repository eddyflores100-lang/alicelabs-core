import test from 'node:test';
import assert from 'node:assert/strict';
import {
  repoIdentity,repoPath,utf8ToBase64,base64ToUtf8,inspectGithubRepo,
  githubFileRead,githubFileCommit,githubFileCreate,githubTree,githubProposePullRequest
} from './src/githubWorkspace.ts';

const repo={owner:'alice-labs',repo:'app',branch:'main',private:true};
const token='github_pat_secure_for_tests_only';

function json(status,body){
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}
test('GitHub repo names and paths reject hostile URLs and traversal',()=>{
  assert.deepEqual(repoIdentity('https://github.com/alice-labs/app.git'),{owner:'alice-labs',repo:'app'});
  assert.equal(repoPath('src/index.ts'),'src/index.ts');
  assert.throws(()=>repoIdentity('https://evil.example/alice-labs/app'));
  assert.throws(()=>repoPath('../secrets'));
  assert.throws(()=>repoPath('/root/file.ts'));
  assert.throws(()=>repoPath('src\\private.ts'));
});
test('Unicode code round-trips as UTF-8 base64',()=>{
  const input='const mensaje = "¡Hola 🌱!";';
  assert.equal(base64ToUtf8(utf8ToBase64(input)),input);
});
test('Private repository reads use GitHub token only in Authorization header',async()=>{
  const request=async(url,init)=>{
    assert.equal(String(url),'https://api.github.com/repos/alice-labs/app');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.redirect,'error');
    return json(200,{default_branch:'main',private:true,permissions:{push:true}});
  };
  assert.deepEqual(await inspectGithubRepo('alice-labs/app',token,request),
    {...repo,permissions:{push:true}});
});
test('Read authentic GitHub file with original blob SHA',async()=>{
  const original='export const name = "mundo";';
  const request=async(url,init)=>{
    assert.match(String(url),/\/contents\/src\/index.ts\?ref=main$/);
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);
    return json(200,{type:'file',size:original.length,encoding:'base64',content:utf8ToBase64(original),sha:'a'.repeat(40)});
  };
  assert.deepEqual(await githubFileRead(repo,'src/index.ts',token,request),{text:original,sha:'a'.repeat(40)});
});
test('Saving GitHub file requires original sha and returns commit SHA',async()=>{
  const original='export default "café";';
  const request=async(url,init)=>{
    assert.equal(init?.method,'PUT');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);
    const body=JSON.parse(String(init?.body));
    assert.equal(body.branch,'main');
    assert.equal(body.sha,'a'.repeat(40));
    assert.equal(body.content,utf8ToBase64(original));
    assert.equal(body.message,'Core: cambio autorizado');
    assert.doesNotMatch(String(url),/github_pat_/);
    return json(200,{content:{sha:'b'.repeat(40)},commit:{sha:'c'.repeat(40)}});
  };
  const result=await githubFileCommit({repo,path:'src/index.ts',text:original,
    sha:'a'.repeat(40),message:'Core: cambio autorizado',token},request);
  assert.deepEqual(result,{sha:'b'.repeat(40),commitSha:'c'.repeat(40)});
});
test('A conflict rejects commit and never silently overwrites GitHub',async()=>{
  const request=async()=>json(409,{message:'sha does not match'});
  await assert.rejects(
    githubFileCommit({repo,path:'src/index.ts',text:'updated',
      sha:'a'.repeat(40),message:'change',token},request),/Conflicto/);
});
test('New file commit must not carry sha and requires token',async()=>{
  const request=async(_url,init)=>{
    const payload=JSON.parse(String(init?.body));
    assert.equal('sha' in payload,false);
    assert.equal(payload.branch,'main');
    assert.equal(payload.content,utf8ToBase64('hola'));
    return json(201,{content:{sha:'d'.repeat(40)},commit:{sha:'e'.repeat(40)}});
  };
  assert.deepEqual(await githubFileCreate({repo,path:'src/new.ts',text:'hola',
    message:'create',token},request),{sha:'d'.repeat(40),commitSha:'e'.repeat(40)});
  await assert.rejects(githubFileCreate({repo,path:'src/new.ts',text:'hola',
    message:'create',token:''},request),/token/);
});
test('Authorized private repository tree uses the same credentials',async()=>{
  const request=async(_url,init)=>{
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);
    return json(200,{truncated:false,tree:[{path:'src/index.ts',type:'blob'}]});
  };
  assert.deepEqual(await githubTree(repo,token,request),[{path:'src/index.ts',type:'blob'}]);
});

test('A Pull Request is created on a dedicated branch without modifying main',async()=>{
  const calls=[];
  const request=async(url,init)=>{
    const path=new URL(url).pathname;
    const method=init?.method||'GET';
    calls.push({path,method,body:init?.body?JSON.parse(String(init.body)):null});
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);
    if(method==='GET')return json(200,{object:{sha:'f'.repeat(40)}});
    if(path.endsWith('/git/refs'))return json(201,{ref:'refs/heads/core/new-branch'});
    if(path.endsWith('/contents/src/index.ts')){
      const body=JSON.parse(String(init.body));
      assert.equal(body.sha,'a'.repeat(40));
      assert.notEqual(body.branch,'main');
      assert.match(body.branch,/^core\//);
      return json(200,{content:{sha:'b'.repeat(40)},commit:{sha:'c'.repeat(40)}});
    }
    if(path.endsWith('/pulls')){
      const body=JSON.parse(String(init.body));
      assert.equal(body.base,'main');
      assert.match(body.head,/^core\//);
      assert.equal(body.title,'Core: comprobar tests');
      return json(201,{html_url:'https://github.com/alice-labs/app/pull/23'});
    }
    throw Error('unexpected route '+path);
  };
  const result=await githubProposePullRequest({
    repo,path:'src/index.ts',text:'export const x=2',sha:'a'.repeat(40),
    token,title:'Core: comprobar tests',message:'Core: comprobar tests'
  },request);
  assert.equal(result.url,'https://github.com/alice-labs/app/pull/23');
  assert.equal(result.commitSha,'c'.repeat(40));
  assert.match(result.branch,/^core\//);
  assert.deepEqual(calls.map(x=>x.method),['GET','POST','PUT','POST']);
  assert.equal(calls[1].body.sha,'f'.repeat(40));
});
test('Pull Request creation errors disclose only branch name, not credential',async()=>{
  const request=async(url,init)=>{
    const path=new URL(url).pathname;
    if(init?.method==='GET')return json(200,{object:{sha:'a'.repeat(40)}});
    if(path.endsWith('/git/refs'))return json(201,{ref:'refs/heads/core/test'});
    if(path.includes('/contents/'))return json(200,{content:{sha:'b'.repeat(40)},commit:{sha:'c'.repeat(40)}});
    return json(403,{message:'Pull requests permission missing'});
  };
  await assert.rejects(
    githubProposePullRequest({repo,path:'src/index.ts',text:'hello',sha:'a'.repeat(40),
      token,title:'Review this',message:'Update'},request),
    error=>{
      assert.match(error.message,/La rama core\//);
      assert.doesNotMatch(error.message,/github_pat_secure/);
      return true;
    }
  );
});
