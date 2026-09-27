/** Public replay format v1: sparse, end-of-tick board changes; never command logs.
 * Browser and API use the same decoder. Frames share immutable unchanged objects.
 */
export function replayReader(replay) {
  if (replay.version !== 1 || !Array.isArray(replay.frames) || !replay.frames.length)
    throw new Error('Unsupported or empty replay.');
  let board = { provinces: [], armies: [], battles: [], players: [], dominance: {}, sides: [], wars: [] };
  const frames = replay.frames.map(patch => {
    const replacements = new Map((patch.provinces || []).map(p => [p.id, p]));
    const provinces = !board.provinces.length ? patch.provinces : patch.provinces
      ? board.provinces.map(p => replacements.get(p.id) || p) : board.provinces;
    const players = patch.players || board.players;
    const affiliations = new Map(players.map(p => [p.id, p.side]));
    const names = new Map((patch.sideNames || board.sideNames || []).map(s => [s.id, s.name]));
    const sides = [...new Set(players.map(p => p.side))].map(id => ({ id,
      name: names.get(id) || players.find(p => p.side === id).id,
      members: players.filter(p => p.side === id).map(p => p.id),
      provinces: provinces.filter(p => p.owner && affiliations.get(p.owner) === id).length,
      economy: provinces.filter(p => p.owner && affiliations.get(p.owner) === id)
        .reduce((n, p) => n + p.development, 0) }));
    const economyThreshold = replay.rules.economyShare === undefined ? replay.rules.threshold
      : Math.ceil(provinces.filter(p => p.owner)
        .reduce((n, p) => n + p.development, 0) * replay.rules.economyShare);
    board = { ...board, ...patch, provinces, players, sides, economyThreshold };
    return board;
  });
  return tick => {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick > replay.duration)
      throw new Error(`Replay tick must be an integer from 0 to ${replay.duration}.`);
    let lo = 0, hi = frames.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1;
      if (frames[mid].tick <= tick) lo = mid + 1; else hi = mid; }
    return { ...frames[Math.max(0, lo - 1)], tick, status: 'replay', speed: 0,
      rules: replay.rules, scenario: replay.scenario, you: null };
  };
}
