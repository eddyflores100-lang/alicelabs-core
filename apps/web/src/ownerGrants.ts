import type {Connection} from './agent';

export const OWNER_GRANTS_STORAGE_KEY='alicelabs-core-project-connection-grants-v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readGrantsFromJson(json:string|null):Record<string,string[]> {
  try {
    const raw:unknown=JSON.parse(json||'{}');
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
    const grants:Record<string,string[]>={};
    for(const [key,value] of Object.entries(raw)){
      if(!uuid.test(key)||!Array.isArray(value))continue;
      grants[key]=Array.from(new Set(value.filter(x=>typeof x==='string'&&uuid.test(x)))).slice(0,100);
    }
    return grants;
  }catch{return {};}
}
export function grantedProfiles(profiles:Connection[],grantedIds:string[]):Connection[] {
  const allowed=new Set(grantedIds);
  return profiles.filter(profile=>allowed.has(profile.id));
}
