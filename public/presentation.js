/** Original game insignia, not historical coats of arms. Presentation only.
 * All SVG fragments are authored constants; player speech never enters SVG markup.
 */
const icons = {
  march: '<path d="M4 19L20 3M11 3h9v9M4 10v9h9"/>',
  coordinate: '<path d="M3 4l6 5m12-5l-6 5M3 20l6-5m12 5l-6-5"/><circle cx="12" cy="12" r="4"/>',
  develop: '<path d="M3 21V10l6 4V9l6 4V3h4l2 18H3Z M7 18h1m4 0h1m4 0h1"/>',
  council: '<path d="M3 9l9-6 9 6H3Zm1 12h16M6 11v7m6-7v7m6-7v7"/>',
  dispatches: '<path d="M3 5h18v14H3V5Zm0 0l9 8 9-8"/>',
  land: '<path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
  troops: '<path d="M4 6h16v12H4V6Zm0 0l16 12M20 6L4 18"/>',
  prestige: '<path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z"/>',
  journal: '<path d="M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4"/>',
  overview: '<path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z"/>',
  replay: '<path d="M9 7l8 5-8 5V7Z"/><circle cx="12" cy="12" r="10"/>',
  military: '<path d="M4 3l13 13m-1-5l-5 5m4-1l6 6M20 3L7 16m1-5l5 5m-4-1l-6 6"/>',
  economy: '<path d="M4 20h16M6 17V9h3v8m3 0V4h3v13m3 0v-6h3v6"/>',
  diplomacy: '<path d="M4 4v16m0-15c6-5 10 5 16 0v10c-6 5-10-5-16 0"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15 6l-1 8-8 4 4-8 5-4Z"/>',
  war: '<path d="M4 4l10 10m-3 3l3-3 3 3-3 3-3-3Zm9-13L10 14m3 3l-3-3-3 3 3 3 3-3Z"/>',
  treaty: '<path d="M6 3h10l3 3v15H6V3Zm10 0v3h3M9 10h7m-7 4h7m-7 4h4"/>',
  ribbon: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14L6 22l3-2 2 3 1-8m1.5-1L18 22l-3-2-2 3"/><path d="M9.5 9l2 2 3-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10l2.1 2.1m0-14.2L17 7m-10 10l-2.1 2.1"/><circle cx="12" cy="12" r="7"/>',
  fallen: '<path d="M5 21V3m0 1h12l-3 4 3 4H5M3 21h8M14 15l6 6m0-6l-6 6"/>',
};
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
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${Object.hasOwn(icons,name) ? icons[name] : icons.compass}</svg>`;
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
