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
  if (state.rules.distanceMovement) return chooseIndustrial(state, map, country);
  if (!state.commandBudget?.remaining) return null;
  const side = id => state.players.find(p => p.id === id)?.side;
  const friendly = p => p.owner && side(p.owner) === me.side;
  const owned = state.provinces.filter(p => p.owner === country);
  const reserved = from => state.commandBudget.reserved.filter(o => o.from === from && o.type === 'move')
    .reduce((n,o) => n+o.amount,0);
  // Expand before fighting; avoid sending several attacks that already cover the same target.
  const candidates = [];
  for (const p of owned) {
    const available = p.troops - reserved(p.id) - 1;
    if (available < 3) continue;
    for (const id of map.provinces.find(m => m.id === p.id).neighbors) {
      const target = state.provinces.find(v => v.id === id);
      const incoming = state.armies.filter(a => a.to === id && side(a.country) === me.side).reduce((n,a) => n+a.amount,0);
      if (!friendly(target) && incoming <= target.troops && available > target.troops + (target.owner ? 2 : 0))
        candidates.push({ from: p.id, to: id, amount: available, value: available-target.troops+(target.owner ? 0 : 30) });
    }
  }
  candidates.sort((a,b) => b.value-a.value || a.to.localeCompare(b.to));
  if (candidates.length) { const { from,to,amount }=candidates[0]; return { type:'move',from,to,amount }; }
  // Breadth-first distances through friendly territory to the nearest frontier.
  const distance = new Map(), queue = [];
  for (const p of state.provinces.filter(friendly)) if (map.provinces.find(m => m.id === p.id).neighbors
    .some(id => !friendly(state.provinces.find(v => v.id === id)))) { distance.set(p.id,0); queue.push(p.id); }
  for (let i=0;i<queue.length;i++) for (const id of map.provinces.find(m=>m.id===queue[i]).neighbors) {
    if (!distance.has(id) && friendly(state.provinces.find(v=>v.id===id))) { distance.set(id,distance.get(queue[i])+1); queue.push(id); }
  }
  for (const p of owned.sort((a,b) => b.troops-a.troops)) {
    if (!distance.get(p.id)) continue;
    const target = map.provinces.find(m=>m.id===p.id).neighbors.find(id => distance.get(id) < distance.get(p.id));
    if (!target) continue;
    const amount = p.troops-reserved(p.id)-1;
    if (amount >= 3) return { type:'move',from:p.id,to:target,amount };
    if (p.route !== target) return { type:'route',from:p.id,to:target };
  }
  return null;
}
