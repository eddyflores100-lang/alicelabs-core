import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRoute } from './src/routing.ts';
const profile = (id, label, provider, models, remaining = null) => ({
  id, label, provider, apiKey: 'test-not-real-' + id, models, refreshedAt: 0,
  meta: remaining === null ? null : { remaining, limit: 100 }
});
const model = (id, inputPerMillion = null, outputPerMillion = null) => ({
  id, name: id, context: 200000, inputPerMillion, outputPerMillion, qualityRank: null, created: null
});
const profiles = [
  profile('a', 'Trabajo', 'openai', [model('gpt-6-astra')]),
  profile('b', 'Personal', 'openrouter', [model('openai/gpt-6-luna', 0.2, 0.6)])
];
test('quality picks high quality available model', () => {
  const route = chooseRoute(profiles, 'quality', 'edit', 'Refactorización compleja');
  assert.equal(route?.model.id, 'gpt-6-astra');
  assert.equal(route?.connection.id, 'a');
});
test('economy selects lower-cost available model', () => {
  const route = chooseRoute(profiles, 'economy', 'chat', 'Hola');
  assert.equal(route?.connection.id, 'b');
});
test('manual profile selection remains inside that single account', () => {
  const route = chooseRoute(profiles, 'quality', 'edit', 'Código', 'b', 'auto');
  assert.equal(route?.connection.id, 'b');
});
test('no account silently substituted when selected account is out of quota', () => {
  const empty = [profile('a', 'Trabajo', 'openai', [model('gpt-6-astra')], 0), profiles[1]];
  assert.equal(chooseRoute(empty, 'quality', 'edit', 'Código', 'a'), null);
});
test('auto skips exhausted accounts without retrying requests', () => {
  const empty = [profile('a', 'Trabajo', 'openai', [model('gpt-6-astra')], 0), profiles[1]];
  const route = chooseRoute(empty, 'quality', 'chat', 'Hola');
  assert.equal(route?.connection.id, 'b');
});
test('unknown model selection does not silently choose another model', () => {
  assert.equal(chooseRoute(profiles, 'balanced', 'chat', 'Hola', 'a', 'not-real-model'), null);
});
