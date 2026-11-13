import test from 'node:test';
import assert from 'node:assert/strict';
import {readGrantsFromJson,grantedProfiles} from './src/ownerGrants.ts';
const owner='ea2b674a-827e-431a-bafb-91b8af2f6c13';
const allowed='14bcbd5f-fd6b-482d-a6ec-de0a50bb9d47';
const other='8672bb27-77a4-48c6-91da-d3f21ba622c3';
test('Brand-new projects receive no API privileges',()=>{
  assert.deepEqual(readGrantsFromJson(null),{});
  assert.deepEqual(grantedProfiles([{id:allowed}],[]),[]);
});
test('Only explicitly granted profiles are available in an individual project',()=>{
  const all=[{id:allowed,apiKey:'secret1'},{id:other,apiKey:'secret2'}];
  const ids=readGrantsFromJson(JSON.stringify({[owner]:[allowed]}));
  assert.deepEqual(grantedProfiles(all,ids[owner]),[all[0]]);
  assert.equal(grantedProfiles(all,ids[owner]).some(x=>x.apiKey==='secret2'),false);
});
test('Corrupted grants and invalid project IDs never grant access',()=>{
  assert.deepEqual(readGrantsFromJson('{bad'),{});
  assert.deepEqual(readGrantsFromJson(JSON.stringify({'../bad':[allowed],[owner]:['bad','also-bad']})),{[owner]:[]});
});
