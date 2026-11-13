import test from 'node:test';
import assert from 'node:assert/strict';
import {TASK_ACTIONS,validateTaskRequest,createTask,recordTaskStep,sanitizedTask} from './src/projectTasks.mjs';

test('A task requires explicit owner approval and an allowlisted bounded plan',()=>{
  assert.equal(validateTaskRequest({title:'CI',steps:['pnpm-test']}),null);
  assert.equal(validateTaskRequest({approved:true,title:'CI',steps:['pnpm-test','rm -rf /']}),null);
  assert.equal(validateTaskRequest({approved:true,title:'CI',steps:[]}),null);
  assert.equal(validateTaskRequest({approved:true,title:'CI',steps:Array(9).fill('git-status')}),null);
  assert.equal(validateTaskRequest({approved:true,title:'\n',steps:['git-status']}),null);
  assert.deepEqual(validateTaskRequest({approved:true,title:' Revisar Core ',steps:['git-status','pnpm-test']}),{
    title:'Revisar Core',steps:['git-status','pnpm-test']
  });
  assert.deepEqual(TASK_ACTIONS['pnpm-test'],{bin:'pnpm',args:['test'],label:'Pruebas'});
});

test('Task state moves through queue, execution and completion with bounded output',()=>{
  const spec=validateTaskRequest({approved:true,title:'Verificar proyecto',steps:['git-status','pnpm-test']});
  const initial=createTask(spec,'ea2b674a-827e-431a-bafb-91b8af2f6c13',100);
  assert.equal(initial.status,'queued');
  assert.equal(initial.current,0);
  const first=recordTaskStep(initial,'git-status',{ok:true,exitCode:0,output:'A'.repeat(10000)},110);
  assert.equal(first.status,'queued');
  assert.equal(first.current,1);
  assert.equal(first.results[0].output.length,8000);
  const last=recordTaskStep(first,'pnpm-test',{ok:true,exitCode:0,output:'all green'},150);
  assert.equal(last.status,'completed');
  assert.equal(last.current,2);
  assert.equal(last.results.length,2);
  assert.equal('approved' in sanitizedTask(last),false);
});
test('Failed command halts workflow instead of treating it as success',()=>{
  const spec=validateTaskRequest({approved:true,title:'Test',steps:['pnpm-test','pnpm-build']});
  const job=createTask(spec,'ea2b674a-827e-431a-bafb-91b8af2f6c13',100);
  const failed=recordTaskStep(job,'pnpm-test',{ok:false,exitCode:1,output:'Test failure'});
  assert.equal(failed.status,'failed');
  assert.equal(failed.current,1);
  assert.equal(failed.results[0].ok,false);
});
