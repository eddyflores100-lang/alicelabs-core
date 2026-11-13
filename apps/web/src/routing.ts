import type { Connection, ModelInfo, Provider } from './agent';
export type Priority = 'quality' | 'balanced' | 'economy';
export type Action = 'chat' | 'edit' | 'guide';
export type Route = {
  connection: Connection; model: ModelInfo; reason: string; mode: Priority; considered: number;
};
const BAD_MODELS = /(vision|embedding|moderation|audio|image|realtime|transcrib|speech|whisper|preview|experimental|deprecated|search-only)/i;
function isValidTextModel(model: ModelInfo) {
  return model?.id && !BAD_MODELS.test(model.id) && model.id.length < 121;
}
function qualityBase(provider: Provider, id: string) {
  const s = id.toLowerCase().replace(/^.*\//, '');
  if (/gpt-6-astra|claude-opus-5-5/.test(s)) return 120;
  if (/gpt-6\.1-sol|claude-opus|gemini-3(?:\.5)?-pro|gemini-4.*pro/.test(s)) return 114;
  if (/gpt-6\.1-terra|claude-sonnet-5|gpt-5\.6|gemini-3-pro/.test(s)) return 108;
  if (/gpt-6-sol|claude-sonnet|gemini-2\.5-pro|gemini-3.*flash/.test(s)) return 102;
  if (/deepseek-v4-pro/.test(s)) return 107;
  if (/deepseek-flash/.test(s)) return 96;
  if (/gpt-6-luna|gpt-5\.5|gpt-5\.4|gemini-2\.5-flash/.test(s)) return 96;
  if (/gpt-5|gpt-4\.1|gpt-4o|gemini-2.*flash|haiku/.test(s)) return 87;
  if (provider === 'openrouter') return 89;
  return 80;
}
function priceEstimate(model: ModelInfo): number | null {
  if (model.inputPerMillion == null || model.outputPerMillion == null) return null;
  return model.inputPerMillion * 0.8 + model.outputPerMillion * 0.2;
}
function speedHint(id: string): number {
  const s = id.toLowerCase();
  if (/(flash-lite|nano|haiku|luna|mini|turbo|small|fast)/.test(s)) return 18;
  if (/(flash|terra|sonnet|sol)/.test(s)) return 9;
  if (/(opus|astra|max|pro)/.test(s)) return -3;
  return 1;
}
function qualityScore(profile: Connection, model: ModelInfo) {
  const heuristic = qualityBase(profile.provider, model.id);
  // OpenRouter's intelligence-high-to-low feed is ranked within OpenRouter only.
  const sourceRank = profile.provider === 'openrouter' && model.qualityRank !== null
    ? Math.max(0, 108 - model.qualityRank * 0.52)
    : null;
  return sourceRank === null ? heuristic : Math.max(heuristic * 0.74 + sourceRank * 0.26, heuristic - 10);
}
export function chooseRoute(profiles: Connection[], priority: Priority, action: Action, question: string, chosenProfile = 'auto', chosenModel = 'auto'): Route | null {
  const pool = chosenProfile === 'auto' ? profiles : profiles.filter(p => p.id === chosenProfile);
  const candidates: Array<{ profile: Connection; model: ModelInfo; score: number }> = [];
  const complexity = action === 'edit' || /(arquitectura|refactor|depurar|debug|seguridad|migraci[oó]n|bug|review|analiza|audita)/i.test(question);
  for (const profile of pool) {
    if (!profile.apiKey.trim()) continue;
    if (profile.meta?.remaining !== null && profile.meta?.remaining !== undefined && profile.meta.remaining <= 0) continue;
    for (const model of profile.models) {
      if (!isValidTextModel(model)) continue;
      if (chosenModel !== 'auto' && model.id !== chosenModel) continue;
      let score = qualityScore(profile, model);
      const speed = speedHint(model.id);
      const price = priceEstimate(model);
      if (priority === 'quality') score += complexity ? score * 0.09 : score * 0.02;
      if (priority === 'balanced') score += speed * 0.6 - (price === null ? 1 : Math.min(price, 120) * 0.35);
      if (priority === 'economy') score += speed * 1.2 - (price === null ? 12 : Math.min(price, 120) * 1.2);
      if (complexity && priority !== 'economy') score += (score - 80) * 0.11;
      if (model.context !== null && model.context < Math.ceil(question.length / 3) + 10000) score -= 75;
      if (!Number.isFinite(score)) continue;
      candidates.push({ profile, model, score });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || a.profile.label.localeCompare(b.profile.label) || a.model.id.localeCompare(b.model.id));
  const picked = candidates[0];
  const mode = { quality: 'calidad', balanced: 'equilibrio entre calidad y coste/velocidad', economy: 'coste y velocidad' }[priority];
  const reason = 'Selección orientativa por ' + mode +
    (picked.model.qualityRank != null ? '; puesto del catálogo de OpenRouter: ' + picked.model.qualityRank : '; estimación por familia y capacidades') +
    (priceEstimate(picked.model) !== null ? '; precio estimado: $' + priceEstimate(picked.model)!.toFixed(2) + '/M tokens (mezcla aproximada)' : '; precio no verificado') +
    '. No garantiza ser el mejor modelo para todos los casos.';
  return { connection: picked.profile, model: picked.model, reason, mode: priority, considered: candidates.length };
}
