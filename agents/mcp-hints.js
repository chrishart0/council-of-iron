import { troopAvailability } from './board.js';

const supported = new Set(['move', 'coordinated_attack', 'transit', 'preview', 'develop']);

/** Small repair facts from the same authenticated observation as the read tools. */
export function repairHint(observation, map, toolName, args) {
  if (!supported.has(toolName) || !observation.you) return null;
  const available = troopAvailability(observation);
  const provinces = new Map(observation.provinces.map(p => [p.id, p]));
  const geometry = new Map(map.provinces.map(p => [p.id, p]));
  const sourceIds = toolName === 'coordinated_attack' ? (args.sources || []).map(s => s.from)
    : args.from ? [args.from] : [];
  const sources = [...new Set(sourceIds)].slice(0, 16).map(id => {
    const province = provinces.get(id), place = geometry.get(id);
    if (!province || !place) return null;
    return { id, owner: province.owner, directNeighbors: place.neighbors,
      ...(province.owner === observation.you ? { available: available.get(id),
        ...(toolName === 'develop' ? { development: province.development,
          developmentCost: observation.rules?.developmentCosts?.[province.development] ?? null,
          developing: Boolean(province.developing) } : {}) } : {}) };
  }).filter(Boolean);
  const target = args.to && provinces.get(args.to);
  return { observedAtTick: observation.tick, status: observation.status, sources,
    ...(target ? { target: { id: target.id, owner: target.owner } } : {}) };
}
