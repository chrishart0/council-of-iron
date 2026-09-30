import { decisionKey, inboxUrgent } from '../playtest/lib.js';
import { relationsOf } from '../../public/relations.js';

/** Metadata-only triggers. Message text never controls the scheduler. */
export function plannerSnapshot(o) {
  const own = o.provinces.filter(p => p.owner === o.you);
  return { tick: o.tick, industry: own.reduce((n, p) => n + p.development, 0),
    relations: JSON.stringify(relationsOf(o, o.you)),
    presented: (o.inbox?.needsDecision || []).map(decisionKey) };
}

export function plannerWake(o, previous, { interval = 180, minimumGap = 10 } = {}) {
  if (!previous) return 'opening';
  const elapsed = o.tick - previous.tick;
  if (elapsed < minimumGap) return null;
  if (inboxUrgent(o.inbox, previous.presented)) return 'diplomacy';
  const now = plannerSnapshot(o);
  if (now.relations !== previous.relations) return 'relations-changed';
  if (previous.industry - now.industry >= Math.max(3, Math.ceil(previous.industry / 4))) return 'territory-loss';
  return elapsed >= interval ? 'strategy-review' : null;
}

/** Skip repeated menus; never cache and replay an old command. Arrival facts are relative except the
 * displayed absolute arrival tick. Troops, forecasts, reserves, priorities and threat flags remain. */
export function tacticalMenuKey(menu) {
  const { ticksLeft: _ticksLeft, ...position } = menu.state.position;
  return JSON.stringify({ strategy: menu.state.strategy, position, own: menu.state.own,
    options: menu.candidates.map(c => {
      const { arrivalTick: _arrivalTick, ...facts } = c.facts;
      return { kind: c.kind, action: c.action, facts };
    }) });
}
