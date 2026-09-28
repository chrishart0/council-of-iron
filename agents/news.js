import { situation } from './situation.js';

/** Delivered game news without repeating the full province board. */
export function news(observation) {
  const brief = situation(observation);
  const { id, status, tick, you, side, wars, proposals, diplomacy, events, cursor, hasMore, outcome } = brief;
  return { id, status, tick, you, side, wars, proposals, diplomacy, events, cursor, hasMore, outcome };
}
