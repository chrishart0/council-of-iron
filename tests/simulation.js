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
  const rng = random(seed);
  return state => chooseIndustrial(state, map, state.you, {
    ...style, rng, develop: style.name !== 'aggressor',
    coordinated: style.name !== 'opportunist', recall: style.name !== 'aggressor',
    investFirst: style.name === 'cautious', ...overrides
  });
}
