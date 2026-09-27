/** Public bot settings, shared by the lobby and controller. No hidden bonuses. */
export const BOT_VERSION = 'council-bot-v6';
export const DIFFICULTIES = Object.freeze({
  easy: { label: 'Easy', cadence: 12, opening: 150, sources: 2, horizon: 120,
    description: 'A slower opponent. Gives you time to expand and reacts every 12 game seconds.' },
  standard: { label: 'Standard', cadence: 5, opening: 60, sources: 6, horizon: 180,
    description: 'Defends fronts, coordinates attacks and negotiates. Reacts every 5 game seconds.' },
  hard: { label: 'Hard', cadence: 3, opening: 30, sources: 16, horizon: 240,
    description: 'Quicker decisions and broader coordination. Same troops, information and command limits.' },
});
export const PERSONALITIES = Object.freeze({
  marshal: { label: 'Marshal', reserve: .38, attack: 1, neutral: 1, economy: .8, diplomacy: 1,
    description: 'Builds a coherent front, concentrates forces and values reliable allies.' },
  raider: { label: 'Raider', reserve: .22, attack: 1.3, neutral: 1.2, economy: .5, diplomacy: .7,
    description: 'Presses weak borders and expands early; its thinner defenses invite counterattacks.' },
  builder: { label: 'Industrialist', reserve: .5, attack: .85, neutral: 1, economy: 1.35, diplomacy: .9,
    description: 'Invests in secure industry and protects it. Slower to commit to a new offensive.' },
  diplomat: { label: 'Diplomat', reserve: .35, attack: .95, neutral: 1, economy: .9, diplomacy: 1.25,
    description: 'Seeks useful partnerships and supports allied fronts, but will not accept every offer.' },
});
export function botSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected bot settings.');
  if (Object.keys(input).some(k => !['difficulty', 'personality'].includes(k))) throw new Error('Unknown bot setting.');
  const difficulty = input.difficulty ?? 'standard', personality = input.personality ?? 'mixed';
  if (!Object.hasOwn(DIFFICULTIES, difficulty)) throw new Error('Choose easy, standard or hard difficulty.');
  if (personality !== 'mixed' && !Object.hasOwn(PERSONALITIES, personality)) throw new Error('Choose a listed bot personality.');
  return { difficulty, personality };
}
export function botLabel(config) {
  return config ? `${DIFFICULTIES[config.difficulty]?.label || 'Standard'} · ${PERSONALITIES[config.personality]?.label || 'Mixed doctrines'}` : 'Legacy practice bot';
}
