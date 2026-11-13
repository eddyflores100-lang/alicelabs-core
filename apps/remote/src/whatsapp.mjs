/**
 * Optional Meta WhatsApp Cloud API completion notices.
 * Not active without a configured approved template, business sender, token,
 * and an explicit per-project recipient opt-in. Never send free-form cold messages.
 */
export const PHONE_RE=/^\+[1-9]\d{7,14}$/;
export function validOptIn(value) {
  if(!value || typeof value!=='object'||typeof value.enabled!=='boolean')return null;
  if(!value.enabled)return {enabled:false,optIn:false,to:''};
  if(value.optIn!==true||typeof value.to!=='string'||!PHONE_RE.test(value.to))return null;
  return {enabled:true,optIn:true,to:value.to};
}
export function whatsappReady(env) {
  return !!(env?.WHATSAPP_TOKEN && /^[0-9]{5,30}$/.test(String(env.WHATSAPP_PHONE_NUMBER_ID||'')) &&
    /^[a-z0-9_]{3,100}$/.test(String(env.WHATSAPP_TEMPLATE_NAME||'')));
}
export async function notifyWhatsApp(env,settings,projectId,kind) {
  if(!settings?.enabled||!settings.optIn||!PHONE_RE.test(settings.to)||!whatsappReady(env))return {sent:false,reason:'not-configured'};
  const url='https://graph.facebook.com/v25.0/'+env.WHATSAPP_PHONE_NUMBER_ID+'/messages';
  const data={
    messaging_product:'whatsapp',to:settings.to.slice(1),type:'template',
    template:{
      name:env.WHATSAPP_TEMPLATE_NAME,
      language:{code:env.WHATSAPP_TEMPLATE_LANG || 'es'},
      components:[{type:'body',parameters:[
        {type:'text',text:projectId.slice(0,8)},
        {type:'text',text:String(kind||'tarea').slice(0,65)}
      ]}]
    }
  };
  const response=await fetch(url,{method:'POST',headers:{
    'Content-Type':'application/json',Authorization:'Bearer '+env.WHATSAPP_TOKEN
  },body:JSON.stringify(data),signal:AbortSignal.timeout(12000)});
  if(!response.ok)return {sent:false,reason:'provider-'+response.status};
  const result=await response.json();
  return {sent:Array.isArray(result.messages)&&result.messages.length>0};
}
