import test from 'node:test';
import assert from 'node:assert/strict';
import {runBatchCodingTeam,validateBatchChanges,applyBatchDraft} from './src/multiFileTeam.ts';

const files=[
  {path:'src/app.ts',text:'export const total = 1'},
  {path:'src/app.test.ts',text:'assert.equal(total, 1)'}
];
test('A three-role team edits two files and returns an approved in-memory patch set',async()=>{
  const replies=[
    'Plan: change constant and update test',
    JSON.stringify({changes:[
      {path:'src/app.ts',content:'export const total = 2'},
      {path:'src/app.test.ts',content:'assert.equal(total, 2)'}
    ]}),
    '{"approved":true,"issues":[]}'
  ];
  const roles=[];
  const result=await runBatchCodingTeam({goal:'Set total to 2 and update tests',files,
    call:async(role)=>{roles.push(role);return replies.shift();}});
  assert.deepEqual(roles,['planner','coder','reviewer']);
  assert.equal(result.approved,true);
  assert.equal(result.calls,3);
  assert.equal(result.changes.length,2);
  const modified=applyBatchDraft(files.map(f=>({...f,readOnly:false})),result);
  assert.equal(modified[0].text,'export const total = 2');
  assert.equal(modified[1].text,'assert.equal(total, 2)');
  assert.equal(files[0].text,'export const total = 1');
});
test('Reviewer correction is bounded to maximum five calls',async()=>{
  const output=[
    'Plan',JSON.stringify({changes:[{path:'src/app.ts',content:'export const total = 0'}]}),
    '{"approved":false,"issues":["wrong value"]}',
    JSON.stringify({changes:[{path:'src/app.ts',content:'export const total = 2'}]}),
    '{"approved":true,"issues":[]}'
  ];
  const result=await runBatchCodingTeam({files,goal:'Fix value',call:async()=>output.shift()});
  assert.equal(result.calls,5);
  assert.equal(result.revisions,1);
  assert.equal(result.approved,true);
});
test('Invalid reviewer response leaves entire batch blocked',async()=>{
  const output=[
    'Plan',JSON.stringify({changes:[{path:'src/app.ts',content:'new code'}]}),
    'looks good',JSON.stringify({changes:[{path:'src/app.ts',content:'more code'}]}),
    'looks good again'
  ];
  const result=await runBatchCodingTeam({files,goal:'Change code',call:async()=>output.shift()});
  assert.equal(result.approved,false);
  assert.throws(()=>applyBatchDraft(files.map(f=>({...f,readOnly:false})),result),/no aprobó/);
});
test('Unknown, duplicated and traversal paths never modify documents',()=>{
  assert.throws(()=>validateBatchChanges('{"changes":[{"path":"../../.env","content":"secret"}]}',files),/desconocido|inválido/);
  assert.throws(()=>validateBatchChanges(JSON.stringify({changes:[
    {path:'src/app.ts',content:'x'},{path:'src/app.ts',content:'y'}
  ]}),files),/repetido/);
  assert.throws(()=>validateBatchChanges('not JSON',files),/JSON/);
  assert.throws(()=>validateBatchChanges(JSON.stringify({changes:[
    {path:'src/app.ts',content:'export const total = 1'}
  ]}),files),/no modifica/);
});
test('Concurrent modification or locked document cancels the entire batch atomically',()=>{
  const proposed={changes:[
    {path:'src/app.ts',original:files[0].text,next:'new'},
    {path:'src/app.test.ts',original:files[1].text,next:'new test'}
  ],approved:true,plan:'plan',review:'ok',calls:3,revisions:0};
  assert.throws(()=>applyBatchDraft([
    {...files[0],readOnly:false},{...files[1],readOnly:true}
  ],proposed),/cancelado/);
  assert.throws(()=>applyBatchDraft([
    {...files[0],readOnly:false},{...files[1],readOnly:false,text:'changed elsewhere'}
  ],proposed),/cancelado/);
});
test('Input with more than eight files and oversized originals is blocked before model calls',async()=>{
  let calls=0;
  await assert.rejects(runBatchCodingTeam({
    goal:'Edit all',files:Array.from({length:9},(_,i)=>({path:'src/'+i+'.ts',text:'const x=1'})),
    call:async()=>{calls++;return 'no';}
  }),/2 a 8/);
  await assert.rejects(runBatchCodingTeam({
    goal:'Large',files:[{path:'big.txt',text:'x'.repeat(17000)},files[1]],
    call:async()=>{calls++;return 'no';}
  }),/demasiado grande/);
  assert.equal(calls,0);
});
