import { RuleError, requireRule } from './engine.js';

/**
 * Human-browser voice input: proxy a seated player's short recording to an optional local
 * speech-to-text sidecar (tools/stt) and return the transcript to that player only.
 * Nothing here touches game state: the player reviews the text and sends it as a normal chat
 * action, which keeps chat validation, cooldown and length limits identical for every client.
 * Audio and transcripts are never stored or logged.
 */
export const STT_MAX_BYTES = 2 * 1024 * 1024; // ~30 s of browser opus/aac with generous headroom
export const STT_PER_MINUTE = 12;
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/x-m4a'];

export function makeStt({ url = process.env.STT_URL || '', timeoutMs = 20000, perMinute = STT_PER_MINUTE } = {}) {
  const base = url.replace(/\/+$/, '');
  const active = new Set(), windows = new Map();
  let health = { at: 0, ok: false };

  async function available() {
    if (!base) return false;
    if (Date.now() - health.at < 10000) return health.ok;
    let ok = false;
    try { ok = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { ok = false; }
    health = { at: Date.now(), ok };
    return ok;
  }

  async function readAudio(req) {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    requireRule(AUDIO_TYPES.includes(type), 'Send audio/webm, audio/ogg or audio/mp4.', 415);
    requireRule(Number(req.headers['content-length'] || 0) <= STT_MAX_BYTES, 'Recording too large (30 seconds maximum).', 413);
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > STT_MAX_BYTES) { req.destroy(); throw new RuleError('Recording too large (30 seconds maximum).', 413); }
      chunks.push(chunk);
    }
    requireRule(size > 0, 'Empty recording.');
    return { audio: Buffer.concat(chunks), type: req.headers['content-type'] };
  }

  /** `key` identifies the seated player (profile + match). Returns `{text}` for that player only. */
  async function transcribe(req, key) {
    requireRule(base, 'Voice input unavailable on this server.', 503);
    requireRule(!active.has(key), 'Already transcribing a recording.', 429);
    const now = Date.now(), recent = (windows.get(key) || []).filter(t => now - t < 60000);
    requireRule(recent.length < perMinute, 'Voice input limit reached; try again in a minute.', 429);
    recent.push(now); windows.set(key, recent);
    active.add(key);
    try {
      const { audio, type } = await readAudio(req);
      let response;
      try {
        response = await fetch(`${base}/transcribe`, { method: 'POST', body: audio, headers: { 'Content-Type': type },
          signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        health = { at: Date.now(), ok: false };
        throw new RuleError('Voice input unavailable right now.', 503);
      }
      if (response.status === 422 || response.status === 413) throw new RuleError('Could not understand that recording.', 422);
      requireRule(response.ok, 'Voice input unavailable right now.', 503);
      const data = await response.json().catch(() => ({}));
      requireRule(typeof data.text === 'string', 'Voice input unavailable right now.', 503);
      return { text: data.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 2000) };
    } finally {
      active.delete(key);
    }
  }

  function prune() {
    const now = Date.now();
    for (const [key, times] of windows) if (!times.some(t => now - t < 60000)) windows.delete(key);
  }

  return { configured: Boolean(base), available, transcribe, prune };
}
