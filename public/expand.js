/** "Expand map": a CSS pseudo-fullscreen that works everywhere (including iPhone Safari, which has no
 * element Fullscreen API), plus real fullscreen where the browser offers it. Presentation only.
 * The container gets `.map-expanded` (position:fixed over the page, safe-area padding) and the page
 * scroll is locked. Real fullscreen is a bonus: a rejection is ignored, and leaving it through the
 * browser also leaves the pseudo state, so the two never disagree. */
const expanded = new Set();
export class ExpandableMap {
  /** `onChange(on)` lets the host re-fit its atlas (the camera centre is kept by the viewBox). `target` is
   * what real fullscreen is requested on (default: the container); `escape: false` when the host owns
   * Escape ordering (the live match closes its menu and panels first). */
  constructor(container, button, { onChange = () => {}, label = 'map', target = container, escape = true } = {}) {
    Object.assign(this, { container, button, onChange, label, target });
    this.on = false;
    this.click = () => this.toggle();
    this.fullscreen = () => { if (this.on && !document.fullscreenElement && this.requested) this.set(false, { fromBrowser: true }); };
    this.key = event => {
      if (!this.on || event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target.closest?.('input:not([type=range]),select,textarea,dialog') || document.querySelector('dialog[open]')) return;
      event.preventDefault(); this.set(false);
    };
    button.addEventListener('click', this.click);
    document.addEventListener('fullscreenchange', this.fullscreen);
    if (escape) document.addEventListener('keydown', this.key);
    this.render();
  }
  toggle() { this.set(!this.on); }
  set(on, { fromBrowser = false } = {}) {
    if (on === this.on) return;
    this.on = on; this.container.classList.toggle('map-expanded', on);
    if (on) expanded.add(this); else expanded.delete(this);
    document.documentElement.classList.toggle('map-expanded-lock', expanded.size > 0);
    this.render();
    this.requested = false;
    if (on && document.fullscreenEnabled && this.target.requestFullscreen) this.target.requestFullscreen().then(() => { this.requested = true; }, () => {});
    if (!on && !fromBrowser && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (!on) this.button.focus({ preventScroll: true });
    this.onChange(on);
  }
  render() {
    this.button.setAttribute('aria-pressed', String(this.on));
    this.button.setAttribute('aria-label', this.on ? `Exit expanded ${this.label} (Escape)` : `Expand ${this.label} to fill the screen`);
    this.button.textContent = this.on ? '✕ Exit' : '⤢ Expand';
  }
  destroy() {
    this.set(false, { fromBrowser: true });
    this.button.removeEventListener('click', this.click);
    document.removeEventListener('fullscreenchange', this.fullscreen);
    document.removeEventListener('keydown', this.key);
  }
}
