import { chooseIndustrial } from './industrial-policy.js';
/** Deliberately modest deterministic practice opponent. This is NOT an LLM.
 * Only reads the same observation provided to external agents and humans.
 */
export function choose(state, map, country) {
  if (state.status !== 'running') return null;
  const me = state.players.find(p => p.id === country);
  if (!me || me.eliminatedAt !== null) return null;
  const offer = state.proposals.find(q => q.status === 'open' && q.roster.includes(country)
    && !q.accepted.includes(country) && q.roster.length <= 3);
  if (offer) return { type: 'accept', proposalId: offer.id };
  return chooseIndustrial(state, map, country);
}
