import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCatalog, resetCatalogForTests } from './src/catalog.js';
function fixture() {
  const data = {};
  for (let p=0;p<24;p++) {
    const models={};
    for(let m=0;m<12;m++){
      models['model-'+p+'-'+m]={
        id:'model-'+p+'-'+m,
        name:(p===0&&m===0?'Special Gemini Code Model':'Model '+p+' '+m),
        family: p===0?'gemini':'code',
        reasoning:m%2===0,tool_call:m%3===0,open_weights:m%5===0,
        modalities:{input:m%4===0?['text','image']:['text'],output:['text']},
        limit:{context:10000+m*1000},
        last_updated:'2026-11-'+String((m%12)+1).padStart(2,'0'),
        cost:{input:m===0?0:m*.1,output:m*.4}
      };
    }
    data['provider-'+p]={id:'provider-'+p,name:p===0?'Google Gemini':'Provider '+p,models};
  }
  return data;
}
async function mocked(callback) {
  resetCatalogForTests();
  const saved=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url)=>{calls++;assert.equal(url,'https://models.dev/api.json');return Response.json(fixture());};
  try {await callback(()=>calls);} finally{globalThis.fetch=saved;resetCatalogForTests();}
}
test('catalog normalizes providers and paginates 288 text models',async()=>{
  await mocked(async calls=>{
    const data=await searchCatalog(new URL('https://example.test/api/catalog?limit=20'));
    assert.equal(data.providerTotal,24);assert.equal(data.catalogTotal,288);
    assert.equal(data.models.length,20);assert.equal(data.status,'discovery-only');
    assert.match(data.source,/models.dev/);assert.equal(calls(),1);
    const second=await searchCatalog(new URL('https://example.test/api/catalog?offset=20&limit=20'));
    assert.equal(second.models.length,20);assert.notEqual(second.models[0].id,data.models[0].id);
    assert.equal(calls(),1,'second search uses one in-isolate cache');
  });
});
test('catalog filters by provider, query, tools and visual input',async()=>{
  await mocked(async()=>{
    const x=await searchCatalog(new URL('https://x.test/api/catalog?q=Special&provider=provider-0&tools=true&vision=true'));
    assert.equal(x.total,1);assert.equal(x.models[0].name,'Special Gemini Code Model');
    assert.equal(x.models[0].reasoning,true);assert.equal(x.models[0].inputCost,0);
    const none=await searchCatalog(new URL('https://x.test/api/catalog?q=Special&provider=provider-2'));
    assert.equal(none.total,0);
  });
});
test('catalog result limits and sorting bounded',async()=>{
  await mocked(async()=>{
    const res=await searchCatalog(new URL('https://x.test/api/catalog?limit=9999&sort=price'));
    assert.equal(res.models.length,60);
    assert.equal(res.models[0].inputCost,0);
    assert.ok(res.providers.length>20);
  });
});
test('catalog rejects incomplete upstream data',async()=>{
  resetCatalogForTests();
  const saved=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({bad:{models:{}}});
  try {
    await assert.rejects(searchCatalog(new URL('https://x.test/api/catalog')),/incompleto/);
  } finally {globalThis.fetch=saved;resetCatalogForTests();}
});
