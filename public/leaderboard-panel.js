/** Always-visible map leaderboard (v0.6, v0.7 relations). Presentation only; ranking and
 * relations come from leaderboard.js. Rows are fixed slots updated in place (textContent), so
 * polling never flickers or reflows. Alliance names are player text: textContent only.
 */
import { leaderboard, warsOf, allianceColor } from './leaderboard.js';
import { insignia } from './presentation.js';

const ARROW_MS = 4000;
const node = (tag, className) => { const e = document.createElement(tag); e.className = className; return e; };
const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
const RELATION = { enemy: ['⚔', 'at war with you'], ally: ['⛓', 'allied with you'] };

export class LeaderboardPanel {
  /** `fronts` lists bloc-vs-bloc wars in the alliances view; `onFocus(country|null)` fires when a
   * row is hovered or focused, so the map can light up that country's enemies and allies. */
  constructor({ root, rows, toggle, summary, modes, fronts, onFocus }, names) {
    Object.assign(this, { root, list: rows, toggle, summary, modes, fronts, onFocus, names });
    this.mode = 'players'; this.previous = new Map(); this.arrows = new Map(); this.lastMode = null;
    const focusRow = event => { const li = event.target.closest?.('.lb-row'); this.onFocus?.(li ? li.dataset.focus || null : null); };
    rows.addEventListener('mouseover', focusRow); rows.addEventListener('focusin', focusRow);
    rows.addEventListener('mouseleave', () => this.onFocus?.(null));
    rows.addEventListener('focusout', event => { if (!rows.contains(event.relatedTarget)) this.onFocus?.(null); });
  }
  get open() { return this.toggle.getAttribute('aria-expanded') === 'true'; }
  setOpen(open) {
    this.toggle.setAttribute('aria-expanded', String(open));
    this.root.classList.toggle('collapsed', !open);
  }
  setMode(mode) {
    this.mode = mode;
    for (const b of this.modes) b.setAttribute('aria-pressed', String(b.dataset.lbMode === mode));
  }
  label(row) { return row.kind === 'alliance' ? row.name : (this.names.short ?? this.names.country)(row.id); }
  update(state, limit = 5) {
    const board = leaderboard(state, { mode: this.mode, you: state.you, limit });
    const now = Date.now(), sameMode = this.lastMode === this.mode;
    for (const row of board.rows) {
      const before = this.previous.get(row.id);
      if (sameMode && before !== undefined && before !== row.rank) this.arrows.set(row.id, { up: row.rank < before, until: now + ARROW_MS });
    }
    this.previous = new Map(board.rows.map(r => [r.id, r.rank])); this.lastMode = this.mode;
    // Coalitions still in their activation notice are "forming": shown dashed, distinct from active.
    this.forming = new Map();
    for (const q of state.proposals || []) if (q.status === 'pending') for (const id of q.roster) this.forming.set(id, q);
    while (this.list.children.length < board.rows.length) this.list.append(this.slot());
    while (this.list.children.length > board.rows.length) this.list.lastElementChild.remove();
    board.rows.forEach((row, i) => this.fill(this.list.children[i], row, now, i, state));
    const own = board.rows.find(r => r.you), lead = board.rows[0];
    const pick = own || lead;
    setText(this.summary, pick ? `${own ? 'You' : this.label(lead)} #${pick.rank} · ${(pick.share * 100).toFixed(1)}% · ${pick.troops} troops` : '');
    this.renderFronts(state);
    return board;
  }
  slot() {
    const li = node('li', 'lb-row'); li.tabIndex = 0;
    li.append(node('span', 'lb-rank'), node('span', 'lb-move'), node('span', 'lb-flags'), node('span', 'lb-name'),
      node('span', 'lb-rel'), node('span', 'lb-land'), node('span', 'lb-troops'));
    return li;
  }
  fill(li, row, now, index, state) {
    const [rank, move, flags, name, rel, land, troops] = li.children;
    li.classList.toggle('you', Boolean(row.you)); li.classList.toggle('eliminated', row.eliminated);
    li.classList.toggle('detached', row.rank !== index + 1); // own row shown outside the top N
    li.dataset.id = row.id; li.dataset.provinces = String(row.provinces); li.dataset.troops = String(row.troops);
    li.dataset.focus = row.countries[0] || ''; li.dataset.relation = row.relation || '';
    // Alliance band: the coalition's colour on the row edge (players view) or a swatch (alliances view).
    const side = row.kind === 'alliance' ? row.id : state.players.find(p => p.id === row.id)?.side;
    const alliance = side && !side.startsWith('solo:') ? state.sides.find(s => s.id === side) : null;
    const pending = !alliance && row.kind !== 'alliance' ? this.forming.get(row.id) : null;
    const color = alliance ? allianceColor(alliance.id) : pending ? allianceColor(pending.coalition) || '#c8a773' : null;
    li.dataset.band = alliance ? 'active' : pending ? 'forming' : '';
    li.dataset.side = alliance?.id || '';
    if (color) li.style.setProperty('--band', color); else li.style.removeProperty('--band');
    setText(rank, String(row.rank));
    const arrow = this.arrows.get(row.id), live = arrow && arrow.until > now;
    setText(move, live ? (arrow.up ? '▲' : '▼') : '');
    move.className = `lb-move${live ? (arrow.up ? ' up' : ' down') : ''}`;
    move.setAttribute('aria-label', live ? (arrow.up ? 'rank up' : 'rank down') : '');
    const key = row.countries.slice(0, 3).join(',');
    if (flags.dataset.key !== key) { flags.dataset.key = key; flags.innerHTML = row.countries.slice(0, 3).map(insignia).join(''); } // authored SVG only
    setText(name, this.label(row) + (row.eliminated ? ' · fallen' : '')); // alliance name is player text
    const [mark, words] = RELATION[row.relation] || ['', ''];
    setText(rel, mark); rel.className = `lb-rel${row.relation ? ` ${row.relation}` : ''}`;
    const membership = alliance ? `${row.kind === 'alliance' ? 'Alliance' : 'Member of'} ${alliance.name}` : pending ? `Forming ${pending.name}` : row.kind === 'alliance' ? '' : 'Independent';
    const enemies = row.atWarWith.map(this.names.country).join(', ');
    const summary = [row.countries.map(this.names.country).join(' + '), membership, words, enemies ? `at war with ${enemies}` : ''].filter(Boolean).join(' · ');
    if (li.title !== summary) { li.title = summary; li.setAttribute('aria-label', `#${row.rank} ${this.label(row)} · ${summary} · ${(row.share * 100).toFixed(1)}% land · ${row.troops} troops`); }
    setText(land, `${(row.share * 100).toFixed(1)}% · ${row.provinces}`);
    setText(troops, String(row.troops));
  }
  /** Alliances view: the war pairs between blocs (names are player text → textContent). */
  renderFronts(state) {
    if (!this.fronts) return;
    const fronts = this.mode === 'alliances' ? warsOf(state) : [];
    this.fronts.hidden = !fronts.length;
    const key = JSON.stringify(fronts.map(f => f.sides.map(s => [s.side, s.name])));
    if (this.fronts.dataset.key === key) return;
    this.fronts.dataset.key = key;
    this.fronts.replaceChildren(...fronts.map(f => {
      const li = node('li', 'lb-front');
      const [a, b] = f.sides.map(s => s.name || s.countries.map(this.names.country).join(' + '));
      const left = node('span', ''), right = node('span', ''), swords = node('b', ''); swords.textContent = '⚔';
      left.textContent = a; right.textContent = b; li.append(left, swords, right);
      return li;
    }));
  }
}
