import http from 'node:http';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {mkdir,readFile,writeFile,readdir,stat,lstat} from 'node:fs/promises';
import {safePath,safeCommand,safeText} from './policy.mjs';

const ROOT='/workspace',PORT=8080,MAX_OUTPUT=120000;
function json(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function target(raw){
  const name=safePath(raw);
  if(!name)return null;
  const p=path.resolve(ROOT,name);
  return p.startsWith(ROOT+'/')?p:null;
}
async function readBody(request,max=260000){
  let data='';
  for await (const chunk of request){
    data+=chunk.toString('utf8');
    if(data.length>max)throw Error('Payload demasiado grande');
  }
  return data;
}
async function listText(dir=ROOT,prefix='',results={count:0,bytes:0,files:{}}){
  const entries=await readdir(dir,{withFileTypes:true});
  for(const entry of entries){
    if(results.count>=80||results.bytes>7000000)break;
    if(['.git','node_modules','dist','target','.next','build'].includes(entry.name))continue;
    const rel=prefix?prefix+'/'+entry.name:entry.name;
    const safe=safePath(rel);
    if(!safe)continue;
    const abs=target(safe);
    if(!abs)continue;
    if(entry.isSymbolicLink())continue;
    if(entry.isDirectory()){if(prefix.split('/').length<10)await listText(abs,rel,results);continue;}
    if(!entry.isFile())continue;
    const info=await stat(abs);
    if(info.size>250000||results.bytes+info.size>7000000)continue;
    const content=await readFile(abs,'utf8');
    if(safeText(content)===null)continue;
    results.files[rel]=content;
    results.count++;
    results.bytes+=content.length;
  }
  return results.files;
}
async function execute(command){
  return new Promise(resolve=>{
    const p=spawn(command.bin,command.args,{cwd:ROOT,env:{PATH:process.env.PATH,HOME:'/home/node',
      CI:'1',NODE_ENV:'development'},shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',killed=false;
    const collect=stream=>stream.on('data',chunk=>{
      const msg=chunk.toString('utf8');
      if(output.length+msg.length>MAX_OUTPUT){
        output+=msg.slice(0,Math.max(0,MAX_OUTPUT-output.length));
        if(!killed){killed=true;p.kill('SIGKILL');}
      } else output+=msg;
    });
    collect(p.stdout);collect(p.stderr);
    const timer=setTimeout(()=>{killed=true;p.kill('SIGKILL');},60000);
    p.once('error',e=>{clearTimeout(timer);resolve({ok:false,exitCode:null,output:String(e.message).slice(0,500)});});
    p.once('close',code=>{clearTimeout(timer);resolve({ok:code===0&&!killed,
      exitCode:typeof code==='number'?code:null,output,stopped:killed});});
  });
}
await mkdir(ROOT,{recursive:true});
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  try{
    if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true,kind:'isolated-container'});
    if(req.method==='PUT'&&u.pathname.startsWith('/file/')){
      const full=target(u.pathname.slice(6));
      if(!full)return json(res,400,{error:'Ruta inválida'});
      const body=await readBody(req);
      if(safeText(body)===null)return json(res,413,{error:'Archivo inválido'});
      // Reject symlink parent traversal. Files are scoped to the container workspace.
      const relative=path.relative(ROOT,path.dirname(full));
      let cursor=ROOT;
      for(const seg of relative==='.'?[]:relative.split(path.sep)){
        cursor=path.join(cursor,seg);
        try{if((await lstat(cursor)).isSymbolicLink())return json(res,400,{error:'Enlace simbólico no permitido'});}
        catch{await mkdir(cursor);}
      }
      try{if((await lstat(full)).isSymbolicLink())return json(res,400,{error:'Archivo simbólico no permitido'});}
      catch{/* file does not exist */}
      await writeFile(full,body,{encoding:'utf8',flag:'w',mode:0o600});
      return json(res,200,{ok:true});
    }
    if(req.method==='GET'&&u.pathname==='/snapshot'){
      return json(res,200,{ok:true,files:await listText()});
    }
    if(req.method==='POST'&&u.pathname==='/run'){
      const body=await readBody(req,8000);
      let value;try{value=JSON.parse(body);}catch{return json(res,400,{error:'JSON inválido'});}
      const command=safeCommand(value);
      if(!command)return json(res,400,{error:'Comando no admitido'});
      return json(res,200,await execute(command));
    }
    json(res,404,{error:'Ruta no disponible'});
  }catch(e){json(res,500,{error:String(e.message||e).slice(0,180)});}
}).listen(PORT,'0.0.0.0',()=>console.log('AliceLabs isolated sandbox on '+PORT));
