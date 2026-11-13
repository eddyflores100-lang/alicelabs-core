/** Human-approved, bounded multi-agent file edits via already selected provider credentials. */
export type AgentRoleRequest = {action:'chat'|'edit';question:string;code:string;path:string;project:string};
export type AgentRoleCall = (input:AgentRoleRequest)=>Promise<{answer?:string}>;
export type AgentTeamResult = {proposal:string;plan:string;review:string;approved:boolean;modelCalls:number;revisionCount:number};

function verdictFromText(raw:string):{approved:boolean;issues:string[]} {
  let source=raw.trim();
  const fence=String.fromCharCode(96).repeat(3);
  if(source.startsWith(fence)){
    const first=source.indexOf('\n');
    const last=source.lastIndexOf(fence);
    if(first>0 && last>first)source=source.slice(first+1,last).trim();
  }
  try {
    const object:unknown=JSON.parse(source);
    if(!object||typeof object!=='object'||Array.isArray(object))throw Error('Invalid review');
    const value=object as Record<string,unknown>;
    if(typeof value.approved!=='boolean'||!Array.isArray(value.issues))throw Error('Invalid review');
    const issues=value.issues.filter(x=>typeof x==='string').slice(0,6).map(x=>(x as string).slice(0,250));
    return {approved:value.approved&&issues.length===0,issues};
  }catch{return {approved:false,issues:['El revisor no devolvió un informe estructurado válido.']};}
}
async function required(call:AgentRoleCall,input:AgentRoleRequest):Promise<string>{
  const response=await call(input);
  if(!response.answer||!response.answer.trim())throw new Error('Un subagente respondió sin contenido.');
  return response.answer.trim();
}
export async function runAgentEditTeam(args:{
  call:AgentRoleCall;request:string;original:string;path:string;project:string;
}):Promise<AgentTeamResult>{
  if(!args.path||!args.request.trim())throw new Error('Falta el archivo o el objetivo de edición.');
  if(args.original.length>35000)throw new Error('El archivo supera el límite del equipo de agentes (35 KB).');
  const base={path:args.path,project:args.project};
  const plan=await required(args.call,{
    ...base,action:'chat',code:args.original,
    question:'ROL PLANIFICADOR. Explica un plan breve y específico para modificar SOLO el archivo '+args.path+
      '. No afirmes haber ejecutado herramientas. Objetivo del propietario: '+args.request
  });
  let proposal=await required(args.call,{
    ...base,action:'edit',code:args.original,
    question:'ROL PROGRAMADOR. Implementa el objetivo en el archivo completo sin cambiar otros archivos. Objetivo: '+
      args.request+'\nPlan de referencia (no ejecutado): '+plan.slice(0,4000)
  });
  let review='',approved=false,revisionCount=0;
  let calls=2;
  for(let round=0;round<2;round++){
    review=await required(args.call,{
      ...base,action:'chat',
      code:'ORIGINAL\n'+args.original.slice(0,21000)+'\n\nPROPUESTA\n'+proposal.slice(0,21000),
      question:'ROL REVISOR. Compara la propuesta con el objetivo y código original. Busca regresiones y vulnerabilidades.'+
        ' No ejecutes herramientas ni afirmes pruebas. Devuelve SOLO JSON: {"approved":true,"issues":[]} o'+
        ' {"approved":false,"issues":["problema concreto"]}. Objetivo: '+args.request
    });
    calls++;
    const verdict=verdictFromText(review);
    approved=verdict.approved;
    if(approved||round===1)break;
    proposal=await required(args.call,{
      ...base,action:'edit',code:proposal,
      question:'ROL PROGRAMADOR — CORRECCIÓN. Revisa tu propuesta para el mismo archivo.'+
        ' Resuelve estas observaciones: '+verdict.issues.join('; ').slice(0,1300)+
        '\nObjetivo inicial: '+args.request
    });
    revisionCount++;calls++;
  }
  return {proposal,plan,review,approved,modelCalls:calls,revisionCount};
}
