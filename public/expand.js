/** "Expand map": a CSS pseudo-fullscreen that works everywhere (including iPhone Safari, which has no element
 * Fullscreen API), plus real fullscreen where the browser offers it. Presentation only.
 *
 * One state machine, always derived from the document rather than remembered:
 *   expanded  ⇔  our pseudo class is on  OR  the document is really fullscreen (standard or webkit-prefixed).
 * - The button toggles on what is true *now*: expanded → leave both (exitFullscreen if really fullscreen);
 *   otherwise → pseudo on at once and ask for real fullscreen synchronously inside the tap (user activation).
 * - Whenever the browser leaves real fullscreen by itself (Back, a swipe, Escape, rotation, switching apps), the
 *   pseudo state goes too, so the two never disagree. There is no flag set in a promise callback (the old
 *   `requested` flag) that could miss the browser's exit and leave the button pointing the wrong way.
 * - A rejected request (no user activation, iPhone) keeps the pseudo state: the map still fills the screen.
 * - Re-synced on fullscreenchange / webkitfullscreenchange, resize, orientationchange, visibilitychange and pageshow.
 * The container gets `.map-expanded`; the page gets `.map-expanded-lock` (no scroll). */
const expanded = new Set();
const realElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
export const fullscreenSupported = () => Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const SYNC_EVENTS = ['resize', 'orientationchange', 'pageshow'];

export class ExpandableMap {
  /** `onChange(on)` lets the host re-fit its atlas (the camera centre is kept by the viewBox). `target` is
   * what real fullscreen is requested on (default: the container); `escape: false` when the host owns
   * Escape ordering (the live match closes its menu and panels first). */
  constructor(container, button, { onChange = () => {}, label = 'map', target = container, escape = true, iconOnly = false } = {}) {
    Object.assign(this, { container, button, onChange, label, target, iconOnly });
    this.pseudo = false; this.ours = false; this.pending = false; this.shown = null;
    this.click = () => this.toggle();
    this.sync = () => {
      if (realElement()) this.pending = false;
      // Real fullscreen we were in is gone (the browser left it): the pseudo state leaves with it. While a request
      // is still pending (a resize can arrive before the browser switches) nothing is decided yet.
      else if (this.ours && !this.pending) { this.ours = false; this.pseudo = false; }
      this.apply();
    };
    this.visibility = () => { if (document.visibilityState === 'visible') this.sync(); };
    this.key = event => {
      if (!this.on || event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target.closest?.('input:not([type=range]),select,textarea,dialog') || document.querySelector('dialog[open]')) return;
      event.preventDefault(); this.set(false);
    };
    button.addEventListener('click', this.click);
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(type, this.sync);
    for (const type of SYNC_EVENTS) addEventListener(type, this.sync);
    document.addEventListener('visibilitychange', this.visibility);
    if (escape) document.addEventListener('keydown', this.key);
    this.apply();
  }
  /** Expanded right now: our pseudo state, or real fullscreen that this map asked for. */
  get on() { return this.pseudo || (this.ours && Boolean(realElement())); }
  toggle() { this.set(!this.on); }
  /** Idempotent and re-entrant: set(true) twice or set(false) twice is harmless. `fromBrowser`: leave real
   * fullscreen alone (the host is leaving the screen; the browser or the next set() decides). */
  set(on, { fromBrowser = false } = {}) {
    if (on) {
      this.pseudo = true;
      if (realElement()) this.ours = true; // already really fullscreen: a browser exit now leaves both
      else if (fullscreenSupported()) this.request();
    } else {
      const wasOn = this.on;
      this.pseudo = false; this.pending = false;
      if (!fromBrowser && realElement()) this.exit();
      this.ours = false;
      if (wasOn && !fromBrowser) this.button.focus({ preventScroll: true });
    }
    this.apply();
  }
  request() {
    const t = this.target, ask = t.requestFullscreen || t.webkitRequestFullscreen;
    if (!ask) return;
    this.ours = true; this.pending = true;
    const settle = ok => { this.pending = false; if (!ok && !realElement()) this.ours = false; this.sync(); };
    try {
      const result = ask.call(t, { navigationUI: 'hide' });
      // A rejection (no user activation, a policy) keeps the pseudo state; only the claim on real fullscreen goes.
      if (result?.then) result.then(() => settle(true), () => settle(false));
      else setTimeout(() => settle(Boolean(realElement())), 1000); // webkit-prefixed: no promise
    } catch { settle(false); }
  }
  exit() {
    const leave = document.exitFullscreen || document.webkitExitFullscreen;
    try { leave?.call(document)?.catch?.(() => {}); } catch { /* already out */ }
  }
  /** Paint the derived state; `onChange` only when it actually changes. */
  apply() {
    const on = this.on;
    this.container.classList.toggle('map-expanded', on);
    if (on) expanded.add(this); else expanded.delete(this);
    document.documentElement.classList.toggle('map-expanded-lock', expanded.size > 0);
    this.render();
    if (this.shown === null) { this.shown = on; return; }
    if (this.shown !== on) { this.shown = on; this.onChange(on); }
  }
  render() {
    const on = this.on;
    this.button.setAttribute('aria-pressed', String(on));
    this.button.setAttribute('aria-label', on ? `Exit expanded ${this.label} (Escape)` : `Expand ${this.label} to fill the screen`);
    const text = this.iconOnly ? (on ? '✕' : '⤢') : on ? '✕ Exit' : '⤢ Expand';
    if (this.button.textContent !== text) this.button.textContent = text;
  }
  destroy() {
    this.set(false, { fromBrowser: true });
    this.button.removeEventListener('click', this.click);
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) document.removeEventListener(type, this.sync);
    for (const type of SYNC_EVENTS) removeEventListener(type, this.sync);
    document.removeEventListener('visibilitychange', this.visibility);
    document.removeEventListener('keydown', this.key);
  }
}
