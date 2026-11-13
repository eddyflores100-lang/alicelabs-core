/** Bounded, audited, human-approved project workflows.
 * Task steps are fixed commands, not arbitrary shell strings.
 */
export const TASK_ACTIONS = Object.freeze({
  'git-status': {bin:'git',args:['status','--short'],label:'Git: estado'},
  'git-diff': {bin:'git',args:['diff','--stat'],label:'Git: diferencias'},
  'git-log': {bin:'git',args:['log','-5','--oneline'],label:'Git: historial'},
  'node-version': {bin:'node',args:['--version'],label:'Node: versión'},
  'pnpm-test': {bin:'pnpm',args:['test'],label:'Pruebas'},
  'pnpm-build': {bin:'pnpm',args:['run','build'],label:'Compilar'},
  'pnpm-typecheck': {bin:'pnpm',args:['run','typecheck'],label:'Comprobar tipos'}
});
const ids = Object.keys(TASK_ACTIONS);

export function validateTaskRequest(value) {
  if(!value || typeof value!=='object' || value.approved!==true) return null;
  if(!Array.isArray(value.steps) || value.steps.length<1 || value.steps.length>8) return null;
  if(!value.steps.every(step => typeof step==='string' && ids.includes(step))) return null;
  const title=typeof value.title==='string' ? value.title.trim().slice(0,90) : '';
  if(!title || /[\r\n\0]/.test(title)) return null;
  return {title,steps:[...value.steps]};
}

export function createTask(spec,id,now=Date.now()) {
  return {
    id,title:spec.title,steps:spec.steps,status:'queued',current:0,
    createdAt:now,updatedAt:now,results:[],approved:true
  };
}

export function recordTaskStep(task, action, result, now=Date.now()) {
  const done=task.current+1;
  return {
    ...task,current:done,updatedAt:now,
    results:[...task.results,{
      action,ok:result.ok===true,exitCode:result.exitCode ?? null,
      output:String(result.output||'').slice(0,8000),stopped:result.stopped===true
    }],
    status:result.ok!==true ? 'failed' : done===task.steps.length ? 'completed' : 'queued'
  };
}

export function sanitizedTask(task) {
  const {approved,...publicTask}=task;
  return publicTask;
}
