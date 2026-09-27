/** Always-visible map leaderboard (v0.6). Presentation only; ranking comes from leaderboard.js.
 * Rows are fixed slots updated in place (textContent), so polling never flickers or reflows.
 */
import { leaderboard } from './leaderboard.js';
import { insignia } from './presentation.js';

const ARROW_MS = 4000;
const node = (tag, className) => { const e = document.createElement(tag); e.className = className; return e; };
const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };

export class LeaderboardPanel {
  constructor({ root, rows, toggle, summary, modes }, names) {
    Object.assign(this, { root, list: rows, toggle, summary, modes, names });
    this.mode = 'players'; this.previous = new Map(); this.arrows = new Map(); this.lastMode = null;
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
    while (this.list.children.length < board.rows.length) this.list.append(this.slot());
    while (this.list.children.length > board.rows.length) this.list.lastElementChild.remove();
    board.rows.forEach((row, i) => this.fill(this.list.children[i], row, now, i));
    const own = board.rows.find(r => r.you), lead = board.rows[0];
    const pick = own || lead;
    setText(this.summary, pick ? `${own ? 'You' : this.label(lead)} #${pick.rank} · ${(pick.share * 100).toFixed(1)}% · ${pick.troops} troops` : '');
    return board;
  }
  slot() {
    const li = node('li', 'lb-row');
    li.append(node('span', 'lb-rank'), node('span', 'lb-move'), node('span', 'lb-flags'), node('span', 'lb-name'),
      node('span', 'lb-land'), node('span', 'lb-troops'));
    return li;
  }
  fill(li, row, now, index) {
    const [rank, move, flags, name, land, troops] = li.children;
    li.classList.toggle('you', Boolean(row.you)); li.classList.toggle('eliminated', row.eliminated);
    li.classList.toggle('detached', row.rank !== index + 1); // own row shown outside the top N
    li.dataset.id = row.id; li.dataset.provinces = String(row.provinces); li.dataset.troops = String(row.troops);
    setText(rank, String(row.rank));
    const arrow = this.arrows.get(row.id), live = arrow && arrow.until > now;
    setText(move, live ? (arrow.up ? '▲' : '▼') : '');
    move.className = `lb-move${live ? (arrow.up ? ' up' : ' down') : ''}`;
    move.setAttribute('aria-label', live ? (arrow.up ? 'rank up' : 'rank down') : '');
    const key = row.countries.slice(0, 3).join(',');
    if (flags.dataset.key !== key) { flags.dataset.key = key; flags.innerHTML = row.countries.slice(0, 3).map(insignia).join(''); } // authored SVG only
    setText(name, this.label(row) + (row.eliminated ? ' · fallen' : '')); // alliance name is player text
    name.title = row.countries.map(this.names.country).join(' + ');
    setText(land, `${(row.share * 100).toFixed(1)}% · ${row.provinces}`);
    setText(troops, String(row.troops));
  }
}
