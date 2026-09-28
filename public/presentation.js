/** Original game insignia, not historical coats of arms. Presentation only.
 * All SVG fragments are authored constants; player speech never enters SVG markup.
 */
const icons = {
  // v0.9 engraved line set (original drawings, 24-unit grid). Aliases name what the icon stands for.
  troops: '<path d="M5 15a7 7 0 0 1 14 0v1H5zM3 16h18M12 8V4m-2 0h4M8 19l-1 2m9-2 1 2"/>',
  land: '<path d="M6 21V4m0 0h11l-2.5 3.5L17 11H6M3 21h18"/>',
  industry: '<path d="M3 21h18M4 21v-9l5 3v-3l5 3V5h4v16M15 3h2"/>',
  clock: '<path d="M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/>',
  seal: '<path d="M12 2.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 6l1.2 2.5 2.7.3-2 1.8.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.8 2.7-.3zM8 15.5 6 21.5l3-1.2 1.6 2.4 1.4-5.2m4-2 2 6-3-1.2-1.6 2.4-1.4-5.2"/>',
  war: '<path d="M5 4l12 12M19 4 7 16m7 2 4-4m-8 4-4-4m10 2 3 3M8 16l-3 3"/>',
  ally: '<path d="M9 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm6 0a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/>',
  gear: '<path d="M18.6 9.5 21.4 10.1 21.4 13.9 18.6 14.5 18.4 14.9 20.0 17.3 17.3 20.0 14.9 18.4 14.5 18.6 13.9 21.4 10.1 21.4 9.5 18.6 9.1 18.4 6.7 20.0 4.0 17.3 5.6 14.9 5.4 14.5 2.6 13.9 2.6 10.1 5.4 9.5 5.6 9.1 4.0 6.7 6.7 4.0 9.1 5.6 9.5 5.4 10.1 2.6 13.9 2.6 14.5 5.4 14.9 5.6 17.3 4.0 20.0 6.7 18.4 9.1zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
  globe: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 0c-3 3-3 15 0 18m0-18c3 3 3 15 0 18M3.5 9h17M3.5 15h17"/>',
  home: '<path d="M4 11l8-7 8 7M6 10v10h12V10m-8 10v-5h4v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  dispatches: '<path d="M3 6h18v12H3zm0 0 9 7 9-7"/>',
  economy: '<path d="M4 20h16M6 20v-6h4v6m0 0V9h4v11m0 0v-8h4v8"/>',
  send: '<path d="M4 12 20 4l-5 16-3-6zm8 2 8-10"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M8 5v14m8-14v14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  rewind: '<path d="M11 7l-5 5 5 5m7-10-5 5 5 5"/>',
  forward: '<path d="M13 7l5 5-5 5M6 7l5 5-5 5"/>',
  first: '<path d="M6 5v14m12-14-9 7 9 7z"/>',
  last: '<path d="M18 5v14M6 5l9 7-9 7z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  laurel: '<path d="M12 21v-9m0 0C8 12 6 9 6 5c3 0 6 2 6 7zm0 0c4 0 6-3 6-7-3 0-6 2-6 7zM8 21h8"/>',
  door: '<path d="M14 4H5v16h9m-4-8h11m-4-4 4 4-4 4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  march: '<path d="M3 12h14m-4-5 5 5-5 5"/>',
  battle: '<path d="M12 3l1.8 5 5-2.2-2.2 5 5 1.8-5 1.8 2.2 5-5-2.2-1.8 5-1.8-5-5 2.2 2.2-5-5-1.8 5-1.8-2.2-5 5 2.2z"/>',
  book: '<path d="M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1zm16 0c-3-1-6-1-8 1v14c2-2 5-2 8-1z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  threat: '<path d="M12 3l9 17H3zm0 6v5m0 3v.5"/>',
};
for (const [alias, name] of Object.entries({"council": "economy", "journal": "book", "military": "war", "compass": "globe", "treaty": "seal", "ribbon": "ally", "fallen": "close"})) icons[alias] = icons[name];

const factions = {
  britain: { code: 'BR', short: 'Britain', motif: '<path d="M13 29l-3-12 9 6 5-11 5 11 9-6-3 12H13Zm0 5h22M20 9h8m-4-4v8"/>' },
  france: { code: 'FR', short: 'France', motif: '<path d="M21 39l-2-17h10l-2 17h-6Zm-3-20c-5-8 8-8 7-17 10 12 3 16 1 17m-8 0h12M16 41h16"/>' },
  germany: { code: 'DE', short: 'Germany', motif: '<path d="M24 17l-5-5 10 1-2 5 2 5 12-11-3 15-9 3-5 12-5-12-9-3-3-15 12 11 5-6Zm-6 15l-5 5m17-5l5 5"/>' },
  russia: { code: 'RU', short: 'Russia', motif: '<path d="M24 39l-5-9-8 3-3-19 10 9 3-5-6-5 7 1 2 7 2-7 7-1-6 5 3 5 10-9-3 19-8-3-5 9Zm-4-30h8m-4-4v7M18 40h12"/>' },
  ottoman: { code: 'OT', short: 'Ottoman', motif: '<path d="M28 10a15 15 0 1 0 0 28A16 16 0 0 1 28 10Z"/><path d="M34 16l2 5 5 1-4 3 1 6-4-3-5 3 1-6-4-3 6-1 2-5Z"/>' },
  qing: { code: 'QI', short: 'Qing', motif: '<path d="M32 11l-8-3-11 6-1 12 8 9 11-2 5-8-3-6-10-3-5 6 4 6 7-2m0-2h4M27 8l6-4-1 7 6 2-6 2M20 35l2 7 9-4M12 23l-5 3m28-3l6 3"/>' },
  japan: { code: 'JP', short: 'Japan', motif: '<circle cx="24" cy="24" r="8"/><path d="M24 6v6m0 24v6M6 24h6m24 0h6M11 11l5 5m16 16l5 5m0-26l-5 5M16 32l-5 5M17 7l2 6m10 22l2 6M7 17l6 2m22 10l6 2M31 7l-2 6M19 35l-2 6M41 17l-6 2M13 29l-6 2"/>' },
  usa: { code: 'US', short: 'United States', motif: '<path d="M24 8l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Zm-10 22v6l10 7 10-7v-6m-14 0v9m8-9v9"/>' },
};
const observer = { code: '—', short: 'Observer', motif: '<path d="M24 6l4 13 13 5-13 4-4 14-4-14-13-4 13-5 4-13Z"/>' };
export const faction = id => Object.hasOwn(factions, id) ? factions[id] : observer;
export function icon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${Object.hasOwn(icons,name) ? icons[name] : icons.compass}</svg>`;
}
export function insignia(id) {
  return `<svg class="insignia" data-faction="${faction(id).code}" viewBox="0 0 48 56" aria-hidden="true" focusable="false"><path class="insignia-shield" d="M2 2h44v32c0 10-13 17-22 20C15 51 2 44 2 34V2Z"/><path class="insignia-rim" d="M6 6h36v27c0 8-10 14-18 17C16 47 6 41 6 33V6Z"/><g transform="translate(3 5) scale(.875)" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${faction(id).motif}</g></svg>`;
}
/** Report only completed, relevant battles; never infer a win from an order/preview. */
export function battleSignal(state, events) {
  if (state.status !== 'running' || !state.you) return null;
  const e = events.filter(e => e.type === 'battle' && e.tick <= state.tick && state.tick - e.tick <= 12 &&
    (e.previousOwner === state.you || e.owner === state.you)).at(-1);
  if (!e) return null;
  const lost = e.owner !== state.you;
  return { id: e.id, province: e.province, tick: e.tick, troops: e.troops,
    tone: lost ? 'lost' : 'held', title: lost ? 'Province lost' : e.previousOwner === state.you ? 'Line held' : 'Province secured' };
}
