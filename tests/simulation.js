import { chooseIndustrial } from '../agents/industrial-policy.js';
/** Seeded test controllers. No hidden state or privileged army actions.
 * These deliberately simple heuristics are NOT language models or human substitutes.
 */
export function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const STYLES = [
  { name: 'expander', neutral: 24, fraction: .72, reserve: 0 },
  { name: 'aggressor', neutral: 4, fraction: 1, reserve: 0 },
  { name: 'cautious', neutral: 30, fraction: .85, reserve: 2 },
  { name: 'opportunist', neutral: 12, fraction: .58, reserve: 1 },
];
export function controller(map, seed, style, overrides = {}) {
  const rng = random(seed), geometry = new Map(map.provinces.map(p => [p.id, p]));
  return state => {
    if (state.rules.distanceMovement) return chooseIndustrial(state, map, state.you, { ...style, rng, develop: style.name !== 'aggressor', coordinated: style.name !== 'opportunist', recall: style.name !== 'aggressor', investFirst: style.name === 'cautious', ...overrides });
    const me = state.players.find(p => p.id === state.you);
    if (!me || me.eliminatedAt !== null || !state.commandBudget?.remaining) return null;
    const board = new Map(state.provinces.map(p => [p.id, p]));
    const side = new Map(state.players.map(p => [p.id, p.side]));
    const friendly = p => p.owner && side.get(p.owner) === me.side;
    const own = state.provinces.filter(p => p.owner === me.id);
    const reserved = new Map();
    for (const o of state.commandBudget.reserved) if (o.type === 'move') reserved.set(o.from, (reserved.get(o.from) || 0) + o.amount);
    const available = p => p.troops - (reserved.get(p.id) || 0) - 1;
    const incoming = new Map();
    for (const a of state.armies) if (side.get(a.country) === me.side) incoming.set(a.to, (incoming.get(a.to) || 0) + a.amount);
    const candidates = [];
    for (const p of own) for (const id of geometry.get(p.id).neighbors) {
      const target = board.get(id), defenders = target.troops + (target.owner ? 2 : 0);
      const spare = available(p) - style.reserve;
      if (friendly(target) || (incoming.get(id) || 0) > defenders || spare <= defenders) continue;
      const amount = Math.min(spare, Math.max(defenders + 1, Math.ceil(spare * style.fraction)));
      candidates.push({ type: 'move', from: p.id, to: id, amount,
        value: (target.owner ? 0 : style.neutral) + (spare - defenders) * .2 + rng() * 5 });
    }
    candidates.sort((a, b) => b.value - a.value);
    if (candidates.length) { const { value, ...action } = candidates[0]; return action; }
    const distance = new Map(), queue = [];
    for (const p of state.provinces.filter(friendly)) if (geometry.get(p.id).neighbors.some(id => !friendly(board.get(id)))) {
      distance.set(p.id, 0); queue.push(p.id);
    }
    for (let i = 0; i < queue.length; i++) for (const id of geometry.get(queue[i]).neighbors) {
      if (!distance.has(id) && friendly(board.get(id))) { distance.set(id, distance.get(queue[i]) + 1); queue.push(id); }
    }
    for (const p of own.sort((a, b) => b.troops - a.troops)) {
      if (!distance.get(p.id)) continue;
      const neighbors = geometry.get(p.id).neighbors.filter(id => distance.get(id) < distance.get(p.id));
      const target = neighbors[Math.floor(rng() * neighbors.length)];
      if (!target) continue;
      const amount = available(p);
      if (amount >= 3) return { type: 'move', from: p.id, to: target, amount };
      if (p.route !== target) return { type: 'route', from: p.id, to: target };
    }
    return null;
  };
}
