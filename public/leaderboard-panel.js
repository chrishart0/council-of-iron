/** Always-visible map leaderboard (v0.6; v0.7 teams and relations). Presentation only: ranking,
 * totals and relations come from leaderboard.js / relations.js. Rows are slots updated in place
 * (textContent), so polling never flickers. Alliance names are player text: textContent only.
 * Teams view (default): one total row per alliance (colour swatch + name) with its members nested
 * underneath, each with a bar for its share of the alliance's troops; groups collapse to their total.
 */
import { leaderboard, warsOf, truceFronts } from './leaderboard.js';
import { allianceColors } from './relations.js';
import { insignia, icon } from './presentation.js';
import { seatType, clock, setText, setAttr } from './ui.js';

const ARROW_MS = 4000;
const node = (tag, className) => { const e = document.createElement(tag); e.className = className; return e; };
const RELATION = { enemy: ['war', 'at war with you'], ally: ['ally', 'allied with you'] };
const percent = n => `${Math.round(n * 100)}%`;

export class LeaderboardPanel {
  /** `fronts` lists bloc-vs-bloc wars in the teams view; `onFocus(country|null)` fires when a row is
   * hovered or focused, so the map can light up that country's enemies and allies. */
  /** v0.8: `onSelect(country)` opens diplomacy for a row (click or Enter); `powers` is a strip of standards
   * shown while collapsed (phones), one button per other country, marked with its relation to you;
   * `onFront(front)` frames a war front on the map. */
  constructor({ root, rows, toggle, summary, modes, fronts, frontCount, powers, onFocus, onSelect, onFront }, names) {
    Object.assign(this, { root, list: rows, toggle, summary, modes, fronts, frontCount, powers, onFocus, onSelect, onFront, names });
    this.mode = 'teams'; this.previous = new Map(); this.arrows = new Map(); this.lastMode = null; this.collapsed = new Set();
    const focusRow = event => { const li = event.target.closest?.('.lb-row'); this.onFocus?.(li ? li.dataset.focus || null : null); };
    rows.addEventListener('mouseover', focusRow); rows.addEventListener('focusin', focusRow);
    rows.addEventListener('mouseleave', () => this.onFocus?.(null));
    rows.addEventListener('focusout', event => { if (!rows.contains(event.relatedTarget)) this.onFocus?.(null); });
    const choose = event => {
      const li = event.target.closest('.lb-row');
      if (!li || event.target.closest('.lb-expand') || li.dataset.kind === 'group') return false;
      if (li.dataset.focus) this.onSelect?.(li.dataset.focus); return true;
    };
    rows.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.lb-row') && choose(event)) event.preventDefault(); });
    powers?.addEventListener('click', event => { const b = event.target.closest('[data-power]'); if (b) this.onSelect?.(b.dataset.power); });
    fronts?.addEventListener('click', event => { const b = event.target.closest('[data-front]'); if (b) this.onFront?.(JSON.parse(b.dataset.front)); });
    rows.addEventListener('click', event => {
      if (choose(event)) return;
      const button = event.target.closest('.lb-expand'); if (!button) return;
      const id = button.closest('.lb-row').dataset.id;
      if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
      if (this.state) this.update(this.state, this.limit);
      this.list.querySelector(`.lb-row[data-id="${CSS.escape(id)}"] .lb-expand`)?.focus();
    });
  }
  get open() { return this.toggle.getAttribute('aria-expanded') === 'true'; }
  setOpen(open) {
    this.toggle.setAttribute('aria-expanded', String(open));
    this.root.classList.toggle('collapsed', !open);
  }
  /** 'teams' | 'players'. v0.9: the war fronts are always listed under the rows (sized for 8 seats, 4 blocs). */
  setMode(mode) {
    this.mode = mode; this.root.dataset.mode = mode;
    for (const b of this.modes) b.setAttribute('aria-pressed', String(b.dataset.lbMode === mode));
  }
  label(row) { return row.kind === 'alliance' ? row.name : (this.names.short ?? this.names.country)(row.id); }
  update(state, limit = 5) {
    this.state = state; this.limit = limit;
    const board = leaderboard(state, { mode: this.mode, you: state.you, limit });
    const now = Date.now(), sameMode = this.lastMode === this.mode;
    for (const row of board.rows) {
      const before = this.previous.get(row.id);
      if (sameMode && before !== undefined && before !== row.rank) this.arrows.set(row.id, { up: row.rank < before, until: now + ARROW_MS });
    }
    this.previous = new Map(board.rows.map(r => [r.id, r.rank])); this.lastMode = this.mode;
    this.colors = allianceColors(state);
    // Players view: coalitions in their activation delay are "forming" (dashed), distinct from active.
    this.forming = new Map();
    for (const q of state.proposals || []) if (q.status === 'pending') for (const id of q.roster) this.forming.set(id, q);
    const display = board.rows.flatMap(row => row.members
      ? [{ row, type: 'group' }, ...(this.collapsed.has(row.id) ? [] : row.members.map(m => ({ row: m, type: 'member', group: row })))]
      : [{ row, type: 'single' }]);
    while (this.list.children.length < display.length) this.list.append(this.slot());
    while (this.list.children.length > display.length) this.list.lastElementChild.remove();
    display.forEach((item, i) => this.fill(this.list.children[i], item, now, board, state));
    const own = board.rows.find(r => r.you), lead = board.rows[0];
    const pick = own || lead;
    // "You #3" stays visible on phones; the rest is detail (alliance names are text).
    const head = pick ? `${own ? 'You' : this.label(lead)} #${pick.rank}` : '', rest = pick ? `${own?.kind === 'alliance' ? ` (${own.name})` : ''} · ${(pick.share * 100).toFixed(1)}% · ${pick.troops} troops` : '';
    if (this.summary.dataset.key !== head + rest) { this.summary.dataset.key = head + rest; const b = node('b', 'lb-rank-me'), span = node('span', 'lb-rest'); b.textContent = head; span.textContent = rest; this.summary.replaceChildren(b, span); }
    this.renderFronts(state);
    this.renderPowers(state, leaderboard(state, { mode: 'players', you: state.you }));
    return board;
  }
  slot() {
    const li = node('li', 'lb-row'); li.tabIndex = 0;
    const flags = node('span', 'lb-flags'), expand = node('button', 'lb-expand'); expand.type = 'button';
    flags.append(expand, node('span', 'lb-standards'));
    const name = node('span', 'lb-name'), bar = node('i', 'lb-bar');
    bar.append(node('i', ''));
    name.append(node('span', 'lb-label'), bar);
    li.append(node('span', 'lb-rank'), node('span', 'lb-move'), flags, name, node('span', 'lb-rel'), node('span', 'lb-land'), node('span', 'lb-troops'));
    return li;
  }
  fill(li, { row, type, group }, now, board, state) {
    const [rank, move, flags, name, rel, land, troops] = li.children;
    const [expand, standards] = flags.children, [label, bar] = name.children;
    setAttr(li, 'class', `lb-row lb-${type}${row.you && type !== 'group' ? ' you' : ''}${type === 'group' && row.you ? ' your-team' : ''}${row.eliminated ? ' eliminated' : ''}${
      type !== 'member' && board.rows.indexOf(row) !== row.rank - 1 ? ' detached' : ''}`); // detached: own entry outside the top N
    for (const [k, v] of Object.entries({ id: row.id, kind: type, provinces: String(row.provinces), troops: String(row.troops), focus: row.countries[0] || '',
      relation: row.relation || '', countries: row.countries.join(','), share: type === 'member' ? String(row.shareOfAlliance) : '' })) if (li.dataset[k] !== v) li.dataset[k] = v;
    // Alliance colour: a band on the row edge (group, its members, and players-view rows of a member).
    const alliance = type === 'group' ? row : group || null, pending = !alliance && this.forming.get(row.id);
    const side = alliance ? (alliance.forming ? '' : alliance.id) : state.players.find(p => p.id === row.id)?.side;
    const active = !alliance && side && !side.startsWith('solo:') ? state.sides.find(s => s.id === side) : null;
    const color = alliance ? this.colors[alliance.id] : active ? this.colors[active.id] : pending ? this.colors[pending.id] : null;
    const band = alliance ? (alliance.forming ? 'forming' : 'active') : active ? 'active' : pending ? 'forming' : '', sideId = alliance ? (alliance.forming ? '' : alliance.id) : active?.id || '';
    if (li.dataset.band !== band) li.dataset.band = band;
    if (li.dataset.side !== sideId) li.dataset.side = sideId;
    if (li.style.getPropertyValue('--band') !== (color || '')) { if (color) li.style.setProperty('--band', color); else li.style.removeProperty('--band'); }
    setText(rank, type === 'member' ? '' : String(row.rank));
    const arrow = type !== 'member' && this.arrows.get(row.id), live = arrow && arrow.until > now;
    setText(move, live ? (arrow.up ? '▲' : '▼') : '');
    setAttr(move, 'class', `lb-move${live ? (arrow.up ? ' up' : ' down') : ''}`);
    setAttr(move, 'aria-label', live ? (arrow.up ? 'rank up' : 'rank down') : '');
    if (expand.hidden !== (type !== 'group')) expand.hidden = type !== 'group';
    if (type === 'group') {
      const open = !this.collapsed.has(row.id);
      setAttr(expand, 'aria-expanded', String(open)); setText(expand, open ? '▾' : '▸');
      setAttr(expand, 'aria-label', `${open ? 'Collapse' : 'Expand'} ${row.name}: ${row.countries.length} members`);
    }
    const shown = type === 'group' ? [] : type === 'member' ? [row.id] : row.countries.slice(0, 3);
    const key = shown.join(',');
    if (standards.dataset.key !== key) { standards.dataset.key = key; standards.innerHTML = shown.map(insignia).join(''); } // authored SVG only
    const player = type === 'group' ? null : state.players.find(p => p.id === row.id);
    const role = player ? seatType(player) : '';
    setText(label, `${this.label(row)}${row.eliminated ? ' · fallen' : ''}${type === 'group' && row.forming ? ' · forming' : ''}`); // alliance name: text
    if (bar.hidden !== (type !== 'member')) bar.hidden = type !== 'member';
    if (type === 'member' && bar.firstChild.style.width !== percent(row.shareOfAlliance)) bar.firstChild.style.width = percent(row.shareOfAlliance);
    const [mark, words] = RELATION[row.relation] || ['', ''];
    if (rel.dataset.mark !== mark) { rel.dataset.mark = mark; rel.innerHTML = mark ? icon(mark) : ''; } // authored SVG only
    setAttr(rel, 'class', `lb-rel${row.relation ? ` ${row.relation}` : ''}`);
    const membership = type === 'group' ? `${row.forming ? 'Forming alliance' : 'Alliance'} of ${row.countries.map(this.names.country).join(', ')}`
      : type === 'member' ? `${percent(row.shareOfAlliance)} of ${group.name}'s troops` : active ? `Member of ${active.name}` : pending ? `Forming ${pending.name}` : row.kind === 'alliance' ? '' : 'Independent';
    const enemies = row.atWarWith.map(this.names.country).join(', ');
    const summary = [type === 'group' ? '' : row.countries.map(this.names.country).join(' + '), role, player?.displayName || player?.name, membership, words, enemies ? `at war with ${enemies}` : ''].filter(Boolean).join(' · ');
    setAttr(li, 'title', summary); setAttr(li, 'aria-label', `${type === 'member' ? '' : `#${row.rank} `}${this.label(row)} · ${summary} · ${(row.share * 100).toFixed(1)}% land · ${row.troops} troops`);
    setText(land, `${(row.share * 100).toFixed(1)}%`); setAttr(land, 'title', `${row.provinces} of ${board.provinces} provinces`);
    setText(troops, String(row.troops));
  }
  /** Collapsed strip (phones): every other country's standard, ranked, as a one-tap way into diplomacy. */
  renderPowers(state, board) {
    if (!this.powers) return;
    const offers = (state.proposals || []).filter(q => q.status === 'open' && state.you && q.roster.includes(state.you));
    const items = board.rows.filter(r => !r.you && !r.eliminated).map(r => {
      const offer = offers.find(q => q.roster.includes(r.id));
      const band = this.colors[state.players.find(p => p.id === r.id)?.side];
      return { id: r.id, relation: offer ? 'offer' : r.relation || '', band: r.relation === 'ally' ? band || '' : '' };
    });
    const key = JSON.stringify(items);
    if (this.powers.dataset.key === key) return;
    this.powers.dataset.key = key;
    const words = { enemy: 'at war with you', ally: 'your ally', neutral: 'not at war', offer: 'alliance offer pending' };
    this.powers.replaceChildren(...items.map(item => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lb-power'; b.dataset.power = item.id; b.dataset.relation = item.relation;
      if (item.band) b.style.setProperty('--band', item.band);
      b.innerHTML = insignia(item.id); // authored SVG only
      b.setAttribute('aria-label', `${this.names.country(item.id)}${words[item.relation] ? `, ${words[item.relation]}` : ''}: open diplomacy`);
      b.title = this.names.country(item.id);
      return b;
    }));
  }
  /** Teams view: the war pairs between blocs (names are player text → textContent). */
  renderFronts(state) {
    if (!this.fronts) return;
    const fronts = warsOf(state), truces = truceFronts(state); // every active war and truce, side vs side
    if (this.frontCount) setText(this.frontCount, fronts.length ? String(fronts.length) : '');
    const key = JSON.stringify([state.you, [fronts, truces].map(list => list.map(f => [f.until, f.sides.map(s => [s.side, s.name, s.countries])]))]);
    if (this.fronts.dataset.key === key) return;
    this.fronts.dataset.key = key;
    // After peace: "A · truce until 12:40 · B" (names are player text → textContent).
    const truceRows = truces.map(f => {
      const li = node('li', `lb-front lb-truce${state.you && f.sides.some(x => x.countries.includes(state.you)) ? ' involved' : ''}`);
      const button = node('button', 'lb-front-button'); button.type = 'button'; button.title = 'Show these sides on the map';
      button.dataset.front = JSON.stringify(f.sides.map(s => s.countries));
      const [left, right, mark] = [node('span', ''), node('span', ''), node('b', '')];
      [left.textContent, right.textContent] = f.sides.map(s => s.name || s.countries.map(this.names.country).join(' + '));
      mark.innerHTML = icon('laurel'); mark.setAttribute('aria-label', 'truce with'); // authored SVG only
      const until = node('small', 'lb-truce-until'); until.textContent = `Truce until ${clock(f.until)}`;
      button.append(left, mark, right, until); li.append(button); return li;
    });
    if (!fronts.length) { const empty = node('li', 'lb-front-empty'); empty.textContent = 'No wars: every country is at peace.'; this.fronts.replaceChildren(empty, ...truceRows); return; }
    this.fronts.replaceChildren(...fronts.map(f => {
      const li = node('li', `lb-front${state.you && f.sides.some(x => x.countries.includes(state.you)) ? ' involved' : ''}`);
      const [a, b] = f.sides.map(s => s.name || s.countries.map(this.names.country).join(' + '));
      const button = node('button', 'lb-front-button'); button.type = 'button'; button.title = 'Show this front on the map';
      button.dataset.front = JSON.stringify(f.sides.map(s => s.countries));
      const left = node('span', ''), right = node('span', ''), swords = node('b', ''); swords.innerHTML = icon('war'); swords.setAttribute('aria-label', 'at war with');
      left.textContent = a; right.textContent = b; button.append(left, swords, right); li.append(button);
      return li;
    }));
    this.fronts.append(...truceRows);
  }
}
