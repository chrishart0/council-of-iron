import { randomInt } from 'node:crypto';

const ADJECTIVES = ['Amber', 'Ashen', 'Brass', 'Bronze', 'Cobalt', 'Crimson', 'Distant', 'Eastern', 'Gilded', 'Golden',
  'Granite', 'Hidden', 'Iron', 'Ivory', 'Northern', 'Quiet', 'Scarlet', 'Silent', 'Silver', 'Southern', 'Steel',
  'Stormy', 'Western', 'Winter'];
const NOUNS = ['Accord', 'Anvil', 'Armistice', 'Bastion', 'Beacon', 'Chancery', 'Charter', 'Citadel', 'Compass', 'Crown',
  'Embassy', 'Frontier', 'Garrison', 'Harbour', 'Lantern', 'Meridian', 'Parliament', 'Rampart', 'Summit', 'Treaty'];

const pick = words => words[randomInt(words.length)];

/** A random two-word room name ("Cobalt Harbour"), different from every name in `taken` while one is free. */
export function roomName(taken = new Set()) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
    if (!taken.has(name)) return name;
  }
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}
