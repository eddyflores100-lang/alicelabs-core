import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentEditTeam} from './src/agentTeam.ts';

test('Planner, programmer, reviewer create approved diff without changing files',async()=>{
  const calls=[];
  const values=['Plan: rename variable','export const total = 2;',
    '{"approved":true,"issues":[]}'];
  const result=await runAgentEditTeam({
    request:'Rename a variable',original:'export const total = 1;',path:'src/test.ts',project:'isolated-test',
    call:async input=>{calls.push(input);return {answer:values.shift()};}
  });
  assert.deepEqual(calls.map(x=>x.action),['chat','edit','chat']);
  assert.equal(result.approved,true);
  assert.equal(result.proposal,'export const total = 2;');
  assert.equal(result.modelCalls,3);
  assert.equal(result.revisionCount,0);
});
test('Reviewer findings require revised code and second review before approval',async()=>{
  const values=[
    'Plan to fix the bug','const answer = 1',
    '{"approved":false,"issues":["One-off bug"]}',
    'const answer = 2',
    '{"approved":true,"issues":[]}'
  ];
  const result=await runAgentEditTeam({
    request:'Fix bug',original:'const answer=0',path:'src/test.ts',project:'project',
    call:async()=>({answer:values.shift()})
  });
  assert.equal(result.modelCalls,5);
  assert.equal(result.revisionCount,1);
  assert.equal(result.approved,true);
  assert.equal(result.proposal,'const answer = 2');
});
test('Malformed reviews cannot mark an edit approved',async()=>{
  const values=['Planning','new code','not JSON','revised code','not JSON again'];
  const result=await runAgentEditTeam({
    request:'Review',original:'old code',path:'src/test.ts',project:'project',
    call:async()=>({answer:values.shift()})
  });
  assert.equal(result.modelCalls,5);
  assert.equal(result.approved,false);
  assert.equal(result.revisionCount,1);
});
test('File limits and missing file prevent costly requests',async()=>{
  let called=false;
  await assert.rejects(runAgentEditTeam({
    request:'Change',original:'a'.repeat(35001),path:'a.ts',project:'',
    call:async()=>{called=true;return {answer:'anything'};}
  }),/35 KB/);
  assert.equal(called,false);
});
