/** Sound (v0.7): Web Audio playback of the pre-rendered, synthesized assets in /audio/.
 * No runtime library. Nothing is fetched, decoded or started before the first user gesture.
 * Cue choice and rate limits live in the pure `sound-model.js`; this module only plays them.
 * Every cue duplicates something visible (banner, feed row, threat strip or toast).
 * Each decision is announced as a `coi:sound` DOM event ({cue, priority, audible}) so tests
 * can observe what would be heard without real audio output.
 */
import { CuePolicy, PRIORITY, eventCues, breakCues, threatIds, tensionActive, isStinger } from './sound-model.js';
import { viewerOf } from './feed-model.js';

const KEY = 'coi.sound';
const DEFAULTS = { muted: false, music: 0.3, effects: 0.7, reduced: false };
const clamp = v => Math.min(1, Math.max(0, Number(v) || 0));
const node = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); e.append(...children); return e; };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { muted: saved.muted === true, reduced: saved.reduced === true,
      music: saved.music === undefined ? DEFAULTS.music : clamp(saved.music),
      effects: saved.effects === undefined ? DEFAULTS.effects : clamp(saved.effects) };
  } catch { return { ...DEFAULTS }; }
}

export class SoundBoard {
  constructor(root) {
    this.root = root; this.settings = loadSettings(); this.policy = new CuePolicy();
    this.ctx = null; this.assets = null; this.loading = null; this.room = null; this.threats = null; this.breakSeq = 0;
    this.tension = false; this.music = null; this.duckUntil = 0;
    this.render();
    // Browsers block audio before a gesture; so do we, for everything (including the fetches).
    const unlock = event => { if (event.isTrusted) { this.unlock(); for (const t of ['pointerdown', 'keydown']) removeEventListener(t, unlock, true); } };
    for (const t of ['pointerdown', 'keydown']) addEventListener(t, unlock, true);
    document.addEventListener('keydown', event => this.shortcut(event));
    document.addEventListener('visibilitychange', () => this.syncRunning());
  }

  // ---- Settings control ------------------------------------------------------------------
  render() {
    if (!this.root) return;
    const s = this.settings;
    this.toggle = node('button', { type: 'button', className: 'quiet sound-toggle', title: 'Sound settings (Shift+M mutes)' });
    this.toggle.setAttribute('aria-expanded', 'false'); this.toggle.setAttribute('aria-controls', 'sound-panel');
    const range = (id, value) => node('input', { id, type: 'range', min: 0, max: 100, step: 5, value: Math.round(value * 100) });
    this.mute = node('input', { id: 'sound-mute', type: 'checkbox', checked: s.muted });
    this.musicRange = range('sound-music', s.music); this.effectsRange = range('sound-effects', s.effects);
    this.reducedBox = node('input', { id: 'sound-reduced', type: 'checkbox', checked: s.reduced });
    this.panel = node('div', { id: 'sound-panel', className: 'sound-panel', hidden: true },
      node('label', { className: 'sound-check' }, this.mute, ' Mute all ', node('kbd', {}, 'Shift+M')),
      node('label', {}, 'Music', this.musicRange),
      node('label', {}, 'Effects', this.effectsRange),
      node('label', { className: 'sound-check' }, this.reducedBox, ' Reduced sound'),
      node('p', {}, 'Reduced: headline stingers only, quieter, no war drums. Every sound repeats a visible banner, feed row or notice.'));
    this.panel.setAttribute('role', 'group'); this.panel.setAttribute('aria-label', 'Sound settings');
    this.root.replaceChildren(this.toggle, this.panel);
    this.toggle.addEventListener('click', () => this.open(this.panel.hidden));
    this.mute.addEventListener('change', () => this.set({ muted: this.mute.checked }));
    this.reducedBox.addEventListener('change', () => this.set({ reduced: this.reducedBox.checked }));
    this.musicRange.addEventListener('input', () => this.set({ music: this.musicRange.value / 100 }));
    this.effectsRange.addEventListener('input', () => this.set({ effects: this.effectsRange.value / 100 }));
    this.panel.addEventListener('keydown', event => { if (event.key === 'Escape') { this.open(false); this.toggle.focus(); } });
    document.addEventListener('pointerdown', event => { if (!this.panel.hidden && !this.root.contains(event.target)) this.open(false); });
    this.reflect();
  }
  open(show) { this.panel.hidden = !show; this.toggle.setAttribute('aria-expanded', String(show)); }
  reflect() {
    if (!this.root) return;
    const s = this.settings;
    this.toggle.textContent = s.muted ? '♪ Sound off' : '♪ Sound';
    this.toggle.classList.toggle('muted', s.muted);
    this.mute.checked = s.muted; this.reducedBox.checked = s.reduced;
    this.musicRange.setAttribute('aria-valuetext', `${Math.round(s.music * 100)}%`);
    this.effectsRange.setAttribute('aria-valuetext', `${Math.round(s.effects * 100)}%`);
    Object.assign(this.root.dataset, { muted: String(s.muted), music: String(s.music), effects: String(s.effects), reduced: String(s.reduced), audio: this.ctx?.state || 'idle' });
  }
  set(change) {
    Object.assign(this.settings, change);
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch {}
    this.applyGains(); this.syncRunning(); this.reflect();
  }
  shortcut(event) {
    if (!event.shiftKey || event.key !== 'M' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input,select,textarea,[contenteditable],dialog')) return;
    event.preventDefault(); event.stopImmediatePropagation(); // Shift+M belongs to sound, not a map shortcut
    this.set({ muted: !this.settings.muted });
  }

  // ---- Audio graph -----------------------------------------------------------------------
  unlock() {
    if (this.ctx) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.ctx = new Context();
    const gain = value => { const g = this.ctx.createGain(); g.gain.value = value; return g; };
    this.master = gain(0); this.master.connect(this.ctx.destination);
    this.musicBus = gain(0); this.musicBus.connect(this.master);
    this.duck = gain(1); this.duck.connect(this.musicBus);
    this.effectsBus = gain(0); this.effectsBus.connect(this.master);
    this.applyGains(); this.syncRunning(); this.reflect();
    this.ctx.addEventListener?.('statechange', () => this.reflect());
    this.loading = this.load().then(() => this.startMusic()).catch(error => { console.warn('Sound unavailable:', error.message); this.root && (this.root.dataset.loaded = 'failed'); });
  }
  async load() {
    const manifest = await (await fetch('/audio/manifest.json')).json();
    const probe = document.createElement('audio');
    const order = probe.canPlayType('audio/ogg; codecs="opus"') ? ['ogg', 'mp3'] : ['mp3'];
    const decode = async (stem, ext) => this.ctx.decodeAudioData(await (await fetch(`/audio/${stem}.${ext}?v=${manifest.version}`)).arrayBuffer());
    for (const ext of order) {
      try {
        const [effects, theme, tension] = await Promise.all(['effects', 'theme', 'tension'].map(stem => decode(stem, ext)));
        this.assets = { manifest, effects, theme, tension, format: ext };
        if (this.root) this.root.dataset.loaded = ext;
        return;
      } catch (error) { if (ext === order.at(-1)) throw error; }
    }
  }
  applyGains() {
    if (!this.ctx) return;
    const s = this.settings, now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : 1, now, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music * (s.reduced ? 0.7 : 1), now, 0.2);
    this.effectsBus.gain.setTargetAtTime(s.effects * (s.reduced ? 0.5 : 1), now, 0.05);
    this.music?.tensionGain.gain.setTargetAtTime(this.tension && !s.reduced ? 1 : 0, now, 1.2);
  }
  /** Suspend the whole context while muted or hidden: pauses the music and saves CPU. */
  syncRunning() {
    if (!this.ctx) return;
    const want = !this.settings.muted && document.visibilityState !== 'hidden';
    if (want && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (!want && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }
  startMusic() {
    if (!this.assets || this.music) return;
    const { manifest, theme, tension } = this.assets, at = this.ctx.currentTime + 0.1;
    const loop = (buffer, spec, output) => {
      const source = this.ctx.createBufferSource(); Object.assign(source, { buffer, loop: true, loopStart: spec.loopStart, loopEnd: spec.loopEnd });
      source.connect(output); source.start(at, spec.loopStart); return source;
    };
    const fade = this.ctx.createGain(); fade.gain.setValueAtTime(0, at); fade.gain.linearRampToValueAtTime(1, at + 4); fade.connect(this.duck);
    const tensionGain = this.ctx.createGain(); tensionGain.gain.value = 0; tensionGain.connect(fade);
    this.music = { fade, tensionGain, sources: [loop(theme, manifest.loops.theme, fade), loop(tension, manifest.loops.tension, tensionGain)] };
    this.applyGains();
  }
  playCue(r) {
    const cue = this.assets?.manifest.cues[r.cue];
    if (!cue || !this.ctx) return;
    const source = this.ctx.createBufferSource(); source.buffer = this.assets.effects; source.connect(this.effectsBus);
    const at = this.ctx.currentTime + 0.01; source.start(at, cue.start, cue.duration);
    if (isStinger(r.cue)) { // duck the music under the stinger, then release
      const g = this.duck.gain; g.cancelScheduledValues(at); g.setTargetAtTime(0.3, at, 0.06);
      g.setTargetAtTime(1, at + cue.duration * 0.8, 0.6);
    }
  }

  // ---- Hooks called by app.js --------------------------------------------------------------
  /** Every poll. `events` are only the events received after catch-up; `live` is false while
   * catching up. Baselines (threats, stopped holds) always advance, so nothing old replays. */
  update(state, events = [], live = false) {
    if (!state) return;
    if (state.id !== this.room) { this.room = state.id; this.threats = null; this.breakSeq = 0; this.pastSides = new Set(); }
    const me = state.players?.find(p => p.id === state.you);
    if (me?.side) (this.pastSides ??= new Set()).add(me.side);
    const viewer = viewerOf(state, this.pastSides || []);
    const threats = threatIds(state), breaks = state.dominanceBreaks || [];
    const requests = [];
    if (live && this.threats) {
      requests.push(...eventCues(events, viewer), ...breakCues(breaks, this.breakSeq, viewer));
      if ([...threats].some(id => !this.threats.has(id))) requests.push({ cue: 'warning', priority: PRIORITY.warning + 2, mine: true });
    }
    this.threats = threats;
    this.breakSeq = Math.max(this.breakSeq, ...breaks.map(b => b.seq).filter(Number.isSafeInteger));
    this.play(requests);
    this.tension = tensionActive(state); this.applyGains();
  }
  /** The viewer's own committed order (the toast is the visible counterpart). */
  order(action) { this.play([{ cue: action?.type === 'march' ? 'march' : 'click', priority: 1, mine: true }]); }
  leave() { this.room = null; this.threats = null; this.tension = false; this.applyGains(); }
  play(requests) {
    if (!requests.length) return;
    const now = performance.now() / 1000; // one clock for cooldowns, before and after unlock
    for (const r of this.policy.choose(requests, now, { reduced: this.settings.reduced })) {
      const audible = Boolean(this.assets) && this.ctx?.state === 'running' && !this.settings.muted && this.settings.effects > 0;
      if (audible) this.playCue(r);
      document.dispatchEvent(new CustomEvent('coi:sound', { detail: { cue: r.cue, priority: r.priority, audible } }));
    }
  }
}
