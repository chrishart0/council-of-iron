/**
 * Voice input for chat composers (human browsers only; agents type).
 *
 * Self-contained: it finds every `[data-voice]` input/textarea, adds a mic button beside it and
 * never sends anything. The transcript is inserted at the caret for the player to edit and Send,
 * so the normal chat action keeps its validation, cooldown and length limit.
 *
 * Paths, best first:
 *  1. server: record with MediaRecorder, POST to /api/games/{match}/stt (seated players only); the server
 *     transcribes with OpenAI's API (labelled) or the optional local sidecar.
 *  2. browser speech (Web Speech API), labelled because browsers may send audio to a cloud service.
 * Microphones need a secure context (HTTPS or localhost); otherwise the button explains that.
 *
 * Player text is untrusted: transcripts only ever reach `input.value` / `textContent`.
 */
const MAX_MS = 30000, SILENCE_MS = 1500, HOLD_MS = 400, SPEECH_LEVEL = 0.035;
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const LABEL = { server: 'Voice input (local speech-to-text)', openai: 'Voice input (transcribed by OpenAI)', browser: 'Voice input: browser speech (may use a cloud service)' };

let mode = null; // 'server' | 'browser' | 'insecure' | null (none)
let active = null; // the one composer currently recording/transcribing

function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text) n.textContent = text; return n; }
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function credential() {
  // Same sources the game client uses: the saved identity and the ?match= room in the address bar.
  const params = new URL(location.href).searchParams;
  let token = null; try { token = JSON.parse(localStorage.getItem('coi.identity'))?.token || null; } catch { token = null; }
  return { match: params.get('match'), token, spectating: params.get('spectate') === '1' };
}
function pickMime() {
  if (!globalThis.MediaRecorder) return null;
  return MIME_TYPES.find(t => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

async function detectMode() {
  if (!window.isSecureContext) return 'insecure';
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && pickMime() !== null);
  if (canRecord) {
    try { const s = await (await fetch('/api/stt', { cache: 'no-store' })).json(); if (s.available) return s.provider === 'openai' ? 'openai' : 'server'; } catch { /* fall through */ }
  }
  return Recognition ? 'browser' : null;
}

class Composer {
  constructor(input) {
    this.input = input;
    this.box = el('span', 'voice');
    this.button = el('button', 'voice-mic');
    this.button.type = 'button';
    this.button.setAttribute('aria-pressed', 'false');
    this.button.append(el('span', 'voice-glyph'));
    this.meter = el('span', 'voice-meter'); this.meter.append(el('i'));
    this.status = el('span', 'voice-status');
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.box.append(this.button, this.meter, this.status);
    input.after(this.box);
    input.dataset.voiceReady = '1';
    this.button.addEventListener('pointerdown', e => this.pointerDown(e));
    this.button.addEventListener('pointerup', e => this.pointerUp(e));
    this.button.addEventListener('pointercancel', e => this.pointerUp(e));
    this.button.addEventListener('click', e => { if (e.detail === 0) this.toggle(); }); // keyboard (Enter/Space)
    this.button.addEventListener('contextmenu', e => e.preventDefault()); // long-press on phones
    input.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && (e.code === 'Space' || e.key === ' ')) { e.preventDefault(); this.toggle(); }
    });
    this.state = 'idle';
    this.render();
  }
  render() {
    const hidden = !mode || (mode !== 'insecure' && credential().spectating);
    this.box.hidden = hidden;
    this.button.title = mode === 'insecure' ? 'Voice input needs HTTPS' : `${LABEL[mode] || ''} · tap, or hold to talk · Ctrl+Shift+Space`;
    this.button.setAttribute('aria-label', mode === 'insecure' ? 'Voice input needs HTTPS' : LABEL[mode] || 'Voice input');
    this.button.classList.toggle('voice-unavailable', mode === 'insecure');
    this.box.dataset.mode = mode || '';
  }
  set(state, message = '') {
    this.state = state;
    this.box.dataset.state = state;
    this.button.setAttribute('aria-pressed', String(state === 'recording'));
    this.status.textContent = message;
    clearTimeout(this.clearTimer);
    if (state === 'idle' || state === 'error') this.clearTimer = setTimeout(() => { if (this.state === state) this.status.textContent = ''; }, 6000);
  }
  pointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault(); // keep the text box focused and stop long-press selection
    if (this.state === 'recording') { this.stop(); return; }
    this.downAt = performance.now();
    this.toggle();
  }
  pointerUp() {
    // Walkie-talkie: a long press records until release; a short tap keeps recording until the next tap.
    const held = this.downAt && performance.now() - this.downAt > HOLD_MS;
    if (held && this.state === 'recording') this.stop();
    else if (held && this.state === 'starting') this.stopWhenReady = true;
    this.downAt = 0;
  }
  toggle() {
    if (mode === 'insecure') { this.set('error', 'Voice input needs HTTPS. Open the game over https:// to use the microphone.'); return; }
    if (this.state === 'recording') return this.stop();
    if (this.state === 'transcribing') return;
    if (active && active !== this) active.cancel();
    return mode === 'browser' ? this.startBrowser() : this.start();
  }

  async start() {
    active = this;
    this.cancelled = this.stopWhenReady = false;
    this.set('starting', 'Starting microphone…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (error) {
      active = null;
      return this.set('error', error?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'No microphone available.');
    }
    if (this.cancelled) return this.release();
    const mime = pickMime();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    this.recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => this.finish();
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.heardAt = 0;
    this.watch();
    this.set('recording', 'Recording… tap again to stop, Esc to cancel');
    if (this.stopWhenReady) this.stop();
  }
  watch() {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.audio = new Ctx();
      this.audio.resume?.();
      this.analyser = this.audio.createAnalyser();
      this.analyser.fftSize = 1024;
      this.audio.createMediaStreamSource(this.stream).connect(this.analyser);
    } catch { this.analyser = null; }
    const samples = new Float32Array(1024);
    this.timer = setInterval(() => {
      const now = performance.now(), elapsed = now - this.startedAt;
      let level = 0;
      if (this.analyser) {
        this.analyser.getFloatTimeDomainData(samples);
        let sum = 0; for (const s of samples) sum += s * s;
        level = Math.sqrt(sum / samples.length);
      }
      if (level > SPEECH_LEVEL) this.heardAt = now;
      this.meter.firstChild.style.transform = `scaleX(${Math.min(1, level * 8).toFixed(3)})`;
      this.status.dataset.elapsed = clock(elapsed);
      this.meter.dataset.elapsed = clock(elapsed);
      if (elapsed >= MAX_MS || (this.heardAt && now - this.heardAt > SILENCE_MS)) this.stop();
    }, 50);
  }
  release() {
    clearInterval(this.timer); this.timer = null;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; // mic indicator off immediately
    this.audio?.close?.().catch(() => {}); this.audio = null; this.analyser = null;
    this.meter.firstChild.style.transform = 'scaleX(0)';
  }
  stop() {
    if (this.state !== 'recording') return;
    this.set('transcribing', this.recognition ? 'Finishing…' : 'Transcribing…');
    if (this.recognition) return this.recognition.stop();
    this.release();
    if (this.recorder?.state !== 'inactive') this.recorder.stop(); else this.finish();
  }
  cancel() {
    this.cancelled = true;
    this.controller?.abort();
    this.recognition?.abort();
    this.release();
    if (this.recorder?.state === 'recording') this.recorder.stop();
    if (active === this) active = null;
    this.set('idle', 'Voice input cancelled.');
  }
  async finish() {
    const type = this.recorder?.mimeType || this.chunks[0]?.type || 'audio/webm';
    const blob = new Blob(this.chunks, { type }); this.chunks = []; this.recorder = null;
    if (this.cancelled) return;
    if (blob.size < 1200) { active = null; return this.set('error', 'Too short. Hold the mic or tap, speak, then tap again.'); }
    const { match, token } = credential();
    if (!match || !token) { active = null; return this.set('error', 'Join a country to use voice input.'); }
    this.controller = new AbortController();
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(match)}/stt`, { method: 'POST', body: blob, signal: this.controller.signal,
        headers: { 'Content-Type': type, Authorization: `Bearer ${token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Voice input failed.');
      if (this.cancelled) return;
      this.insert(data.text);
    } catch (error) {
      if (error.name !== 'AbortError') this.set('error', error.message);
      if (error.message?.includes('unavailable') && Recognition) { mode = 'browser'; composers.forEach(c => c.render()); }
    } finally {
      if (active === this) active = null;
      this.controller = null;
    }
  }
  insert(text) {
    text = String(text || '').trim();
    if (!text) return this.set('idle', 'No speech heard.');
    const input = this.input, value = input.value;
    const start = input.selectionStart ?? value.length, end = input.selectionEnd ?? value.length;
    const before = value.slice(0, start), after = value.slice(end);
    let piece = (before && !/\s$/.test(before) ? ' ' : '') + text + (after && !/^\s/.test(after) ? ' ' : '');
    const room = input.maxLength > 0 ? input.maxLength - before.length - after.length : Infinity;
    const trimmed = piece.length > room;
    if (trimmed) piece = piece.slice(0, Math.max(0, room));
    input.value = before + piece + after; // value, never markup
    const caret = before.length + piece.length;
    input.focus();
    input.setSelectionRange?.(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    this.set('idle', trimmed ? 'Transcript trimmed to fit. Review, then Send.' : 'Transcript added. Review, then Send.');
  }

  startBrowser() {
    active = this;
    this.cancelled = false;
    const recognition = this.recognition = new Recognition();
    recognition.lang = document.documentElement.lang || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = '';
    recognition.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      if (interim) this.status.textContent = `Hearing: ${interim}`;
    };
    recognition.onerror = e => { if (e.error !== 'aborted') this.set('error', e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Browser speech failed (${e.error}).`); };
    recognition.onend = () => {
      this.recognition = null;
      if (active === this) active = null;
      if (!this.cancelled && ['recording', 'transcribing'].includes(this.state)) finalText ? this.insert(finalText) : this.set('idle', 'No speech heard.');
    };
    recognition.start();
    this.set('recording', 'Listening (browser speech, may use a cloud service)… tap to stop');
  }
}

const composers = [];
/** Attach a mic to one more composer (the page's `[data-voice]` fields are attached automatically). */
export function attachVoice(input) { if (!input.dataset.voiceReady) composers.push(new Composer(input)); }
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && active && ['starting', 'recording', 'transcribing'].includes(active.state)) {
    e.preventDefault(); e.stopImmediatePropagation(); active.cancel();
  }
}, true);
// Re-check the spectator flag when the room in the address bar changes (the app uses replaceState).
addEventListener('popstate', () => composers.forEach(c => c.render()));
setInterval(() => composers.forEach(c => c.box.hidden !== (!mode || (mode !== 'insecure' && credential().spectating)) && c.render()), 2000);

mode = await detectMode();
document.querySelectorAll('[data-voice]').forEach(attachVoice);
