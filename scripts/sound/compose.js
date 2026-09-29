/* Council of Iron sound design, rendered offline with Tone.js (MIT) in headless Chromium.
 * Build-time only: `python scripts/sound/generate.py` loads Tone.js from node_modules and this
 * file into a blank page, renders every cue with Tone.Offline and encodes the results.
 * Pure synthesis: no samples, soundfonts or loops. The page seeds Math.random first, so
 * Tone's noise buffers and the reverb impulse are the same on every render.
 * Classic browser script (global `Tone`), not an ES module and never served to players.
 */
/* global Tone */
(() => {
  const SAMPLE_RATE = 48000;
  const BPM = 90, BEAT = 60 / BPM, BAR = 4 * BEAT;
  const MUSIC_BARS = 24, TENSION_BARS = 6; // 64 s and 16 s: the tension loop divides the theme exactly
  const rnd = (() => { let s = 0x5eed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; })();
  const human = (v, spread = 0.08) => Math.max(0.05, Math.min(1, v + (rnd() - 0.5) * spread));
  // Monophonic Tone instruments need chronological triggers; queue them and flush in time order.
  let pending = [];
  const ordered = (synth, timeArg = 2) => ({ triggerAttackRelease: (...a) => { pending.push([a[timeArg] ?? 0, pending.length, synth, () => synth.triggerAttackRelease(...a)]); } });
  const flush = () => { // a later hit that coincides (<2 ms) with an earlier one on the same drum is dropped
    const last = new Map();
    for (const [time, , synth, play] of pending.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      if (time - (last.get(synth) ?? -1) < 0.002) continue;
      last.set(synth, time); play();
    }
    pending = [];
  };

  /** Shared output chain: dry + hall reverb into a gentle bus compressor and a -1 dBFS limiter. */
  async function hall({ decay = 3, wet = 0.28, preDelay = 0.02 } = {}) {
    const limiter = new Tone.Limiter(-1).toDestination();
    const comp = new Tone.Compressor({ threshold: -18, ratio: 2.5, attack: 0.02, release: 0.25 }).connect(limiter);
    const reverb = new Tone.Reverb({ decay, preDelay, wet }).connect(comp);
    await reverb.ready;
    return reverb;
  }

  // ---- Instrument factories (all synthesized) -------------------------------------------
  const strings = (out, { cutoff = 1100, volume = -16, attack = 0.7, release = 1.8 } = {}) => {
    const filter = new Tone.Filter({ frequency: cutoff, type: 'lowpass', rolloff: -24 }).connect(out);
    const vibrato = new Tone.Vibrato({ frequency: 5, depth: 0.04 }).connect(filter);
    return new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 12, volume,
      oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
      envelope: { attack, decay: 0.3, sustain: 0.85, release },
    }).connect(vibrato);
  };
  const brass = (out, { volume = -14, bright = 3, base = 180, attack = 0.06 } = {}) =>
    new Tone.PolySynth(Tone.MonoSynth, {
      maxPolyphony: 8, volume,
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', rolloff: -24, Q: 1.2 },
      envelope: { attack, decay: 0.25, sustain: 0.75, release: 0.5 },
      filterEnvelope: { attack: attack * 1.4, decay: 0.35, sustain: 0.55, release: 0.6, baseFrequency: base, octaves: bright },
    }).connect(out);
  const horn = (out, opts = {}) => brass(out, { volume: -13, bright: 2.2, base: 140, attack: 0.1, ...opts });
  const bass = (out, volume = -12) => ordered(new Tone.MonoSynth({
    volume, oscillator: { type: 'sawtooth' },
    filter: { type: 'lowpass', rolloff: -24, Q: 0.8 },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.4 },
    filterEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.3, release: 0.4, baseFrequency: 90, octaves: 2.2 },
  }).connect(out));
  const timpani = (out, volume = -8) => ordered(new Tone.MembraneSynth({
    volume, pitchDecay: 0.06, octaves: 1.6, oscillator: { type: 'sine' },
    envelope: { attack: 0.002, decay: 1.1, sustain: 0, release: 0.6 },
  }).connect(out));
  const snare = (out, volume = -20) => {
    const band = new Tone.Filter({ frequency: 2600, type: 'bandpass', Q: 0.7 }).connect(out);
    return ordered(new Tone.NoiseSynth({ volume, noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.05 } }).connect(band), 1);
  };
  const bell = (out, volume = -18) => new Tone.PolySynth(Tone.FMSynth, {
    maxPolyphony: 8, volume, harmonicity: 3.01, modulationIndex: 9,
    oscillator: { type: 'sine' }, modulation: { type: 'sine' },
    envelope: { attack: 0.002, decay: 2.2, sustain: 0, release: 2.2 },
    modulationEnvelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.8 },
  }).connect(out);
  const noise = (out, { type = 'white', volume = -18, attack = 0.001, decay = 0.2, sustain = 0, release = 0.1 } = {}) =>
    ordered(new Tone.NoiseSynth({ volume, noise: { type }, envelope: { attack, decay, sustain, release } }).connect(out), 1);
  const filtered = (out, frequency, type = 'lowpass', Q = 0.7) => new Tone.Filter({ frequency, type, Q, rolloff: -24 }).connect(out);

  const roll = (drum, start, length, from = 0.2, to = 0.9, rate = 1 / 28) => {
    for (let t = 0, i = 0; t < length; t += rate, i++) drum.triggerAttackRelease(0.05, start + t, human(from + (to - from) * t / length, 0.1));
  };
  /** Play [beat, note(s), beats, velocity] events, beats measured from `start`. */
  const phrase = (synth, start, events, beat = BEAT) => {
    for (const [at, note, length, velocity = 0.8] of events) synth.triggerAttackRelease(note, length * beat, start + at * beat, human(velocity, 0.06));
  };

  // ---- Theme: "The Council Sits", D minor, 90 BPM, 24 bars = 64 s --------------------------
  const CHORDS = {
    Dm: [['D3', 'F3', 'A3'], 'D2', 'A1'], Gm: [['G2', 'Bb2', 'D3'], 'G1', 'D2'], Bb: [['Bb2', 'D3', 'F3'], 'Bb1', 'F1'],
    A: [['A2', 'C#3', 'E3'], 'A1', 'E2'], F: [['A2', 'C3', 'F3'], 'F1', 'C2'], C: [['G2', 'C3', 'E3'], 'C2', 'G1'],
  };
  const PROGRESSION = ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Gm', 'A', 'A', 'F', 'C', 'Dm', 'Bb', 'Gm', 'Dm', 'A', 'A', 'Bb', 'F', 'Gm', 'Dm', 'Bb', 'C', 'A', 'A'];
  // [bar, beat, note, beats]
  const MELODY = [
    [4, 0, 'A3', 2], [4, 2, 'D4', 1], [4, 3, 'E4', 1], [5, 0, 'F4', 2], [5, 2, 'D4', 1], [5, 3, 'Bb3', 1], [6, 0, 'C#4', 2], [6, 2, 'E4', 2], [7, 0, 'A3', 3.5],
    [8, 0, 'C4', 1], [8, 1, 'F4', 1], [8, 2, 'A4', 2], [9, 0, 'G4', 2], [9, 2, 'E4', 1], [9, 3, 'C4', 1], [10, 0, 'D4', 1], [10, 1, 'F4', 1], [10, 2, 'A4', 2],
    [11, 0, 'Bb4', 2], [11, 2, 'A4', 1], [11, 3, 'F4', 1], [12, 0, 'G4', 2], [12, 2, 'D4', 2], [13, 0, 'F4', 2], [13, 2, 'A4', 2],
    [14, 0, 'E4', 1], [14, 1, 'C#4', 1], [14, 2, 'E4', 1], [14, 3, 'A4', 1], [15, 0, 'A4', 3],
    [16, 0, 'D4', 1.5], [16, 1.5, 'D4', 0.5], [16, 2, 'F4', 2], [17, 0, 'C4', 1.5], [17, 1.5, 'C4', 0.5], [17, 2, 'A3', 2],
    [18, 0, 'Bb3', 1.5], [18, 1.5, 'D4', 0.5], [18, 2, 'G4', 2], [19, 0, 'F4', 2], [19, 2, 'A3', 2],
    [20, 0, 'Bb3', 1], [20, 1, 'D4', 1], [20, 2, 'F4', 1], [20, 3, 'Bb4', 1], [21, 0, 'C5', 2], [21, 2, 'G4', 2],
    [22, 0, 'A4', 2], [22, 2, 'G4', 1], [22, 3, 'E4', 1], [23, 0, 'C#4', 2], [23, 2, 'A3', 1.5],
  ];

  async function theme(cycles) {
    const out = await hall({ decay: 3.4, wet: 0.3 });
    const pad = strings(out, { cutoff: 950, volume: -19 });
    const lead = horn(out, { volume: -17 });
    const low = bass(out, -17);
    const timp = timpani(out, -15);
    const drum = snare(out, -27);
    const swell = noise(filtered(out, 5200, 'highpass'), { volume: -34, attack: 1.8, decay: 0.2, sustain: 0.6, release: 0.3 });
    const crash = noise(filtered(out, 4200, 'highpass'), { volume: -30, attack: 0.002, decay: 1.8 }); // resolves the swell on the loop's downbeat
    for (let c = 0; c < cycles; c++) for (let bar = 0; bar < MUSIC_BARS; bar++) {
      const t = (c * MUSIC_BARS + bar) * BAR, [chord, root, fifth] = CHORDS[PROGRESSION[bar]], section = Math.floor(bar / 8);
      pad.triggerAttackRelease(chord, BAR * 0.96, t, human(section === 1 ? 0.62 : 0.52));
      low.triggerAttackRelease(root, BEAT * 1.4, t, human(0.7));
      low.triggerAttackRelease(section === 0 ? root : fifth, BEAT * 1.4, t + 2 * BEAT, human(0.6));
      timp.triggerAttackRelease(root.replace(/\d/, '2'), BEAT, t, human(section === 2 ? 0.7 : 0.5));
      if (section === 2) timp.triggerAttackRelease(fifth.replace(/\d/, '2'), BEAT, t + 2 * BEAT, human(0.45));
      const hits = section === 0 ? [3] : section === 1 ? [1, 3, 3.75] : [0, 1.5, 1.75, 2, 3, 3.5];
      for (const beat of hits) drum.triggerAttackRelease(0.05, t + beat * BEAT, human(beat % 1 ? 0.35 : 0.6));
      if (bar % 8 === 7) roll(drum, t + 2 * BEAT, 2 * BEAT - 0.05, 0.25, 0.8, BEAT / 6);
      if (bar === MUSIC_BARS - 1) swell.triggerAttackRelease(BAR * 0.9, t + BAR * 0.05, 0.5);
      if (bar === 0) crash.triggerAttackRelease(1.8, t, 0.6);
    }
    for (let c = 0; c < cycles; c++) for (const [bar, beat, note, beats] of MELODY)
      lead.triggerAttackRelease(note, beats * BEAT * 0.94, (c * MUSIC_BARS + bar) * BAR + beat * BEAT, human(bar >= 8 && bar < 16 ? 0.8 : 0.65));
    flush();
  }

  /** Percussion/ostinato layer (16 s) mixed in only while the viewer is at war or a victory countdown runs. */
  async function tension(cycles) {
    const out = await hall({ decay: 2.4, wet: 0.2 });
    const timp = timpani(out, -12), drum = snare(out, -22);
    const pulse = ordered(new Tone.MonoSynth({
      volume: -24, oscillator: { type: 'sawtooth' }, filter: { type: 'lowpass', rolloff: -24, Q: 2 },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0.2, release: 0.1 },
      filterEnvelope: { attack: 0.005, decay: 0.12, sustain: 0.2, release: 0.1, baseFrequency: 120, octaves: 2.5 },
    }).connect(out));
    for (let c = 0; c < cycles; c++) for (let bar = 0; bar < TENSION_BARS; bar++) {
      const t = (c * TENSION_BARS + bar) * BAR;
      for (let e = 0; e < 8; e++) {
        pulse.triggerAttackRelease(e % 4 === 3 ? 'A1' : 'D2', BEAT * 0.3, t + e * BEAT / 2, human(e % 2 ? 0.45 : 0.7));
        timp.triggerAttackRelease('D2', BEAT * 0.4, t + e * BEAT / 2, human(e === 0 ? 0.8 : e % 2 ? 0.3 : 0.45));
      }
      for (let s = 0; s < 16; s++) if ([2, 6, 7, 10, 14, 15].includes(s)) drum.triggerAttackRelease(0.04, t + s * BEAT / 4, human(s % 4 === 3 ? 0.35 : 0.55));
      if (bar === TENSION_BARS - 1) roll(drum, t + 3 * BEAT, BEAT - 0.03, 0.2, 0.6, BEAT / 6);
    }
    flush();
  }

  // ---- Stingers and interface cues (absolute seconds) --------------------------------------
  const CUES = {
    async war() { // drum roll into a low brass stab and an ominous horn call
      const out = await hall({ decay: 3.2, wet: 0.3 });
      roll(snare(out, -14), 0, 1.25, 0.15, 1, 1 / 30);
      timpani(out, -4).triggerAttackRelease('D1', 1.4, 1.28, 1);
      const stab = brass(out, { volume: -9, bright: 3.4, base: 160 });
      stab.triggerAttackRelease(['D2', 'A2', 'D3', 'F3'], 0.45, 1.28, 0.95);
      const call = horn(out, { volume: -9 });
      phrase(call, 1.95, [[0, 'D3', 0.75, 0.8], [0.75, 'A3', 1.5, 0.9], [2.25, 'Bb3', 0.6, 0.85], [2.85, 'A3', 1.8, 0.75]], 0.4);
      strings(out, { cutoff: 650, volume: -17 }).triggerAttackRelease(['D2', 'A2', 'Eb3'], 2.2, 1.95, 0.6);
      return 4.6;
    },
    async alliance() { // bright brass fanfare resolving to a held F major with bells
      const out = await hall({ decay: 2.6, wet: 0.28 });
      const fan = brass(out, { volume: -9, bright: 3.8, base: 260, attack: 0.03 });
      phrase(fan, 0, [[0, 'C4', 0.33, 0.75], [0.33, 'C4', 0.33, 0.7], [0.66, 'C4', 0.34, 0.75], [1, 'F4', 0.9, 0.9], [2, 'A4', 0.9, 0.9]], 0.36);
      fan.triggerAttackRelease(['F3', 'A3', 'C4', 'F4'], 1.6, 1.1, 0.9);
      timpani(out, -8).triggerAttackRelease('F2', 1, 1.1, 0.8);
      phrase(bell(out, -14), 1.1, [[0, 'F5', 2, 0.8], [0.25, 'A5', 2, 0.7], [0.5, 'C6', 2, 0.6]], 0.36);
      strings(out, { cutoff: 1800, volume: -16, attack: 0.25 }).triggerAttackRelease(['F3', 'C4', 'A4'], 1.5, 1.1, 0.6);
      return 3.6;
    },
    async peace() { // soft suspension resolving, with bells
      const out = await hall({ decay: 3.6, wet: 0.35 });
      const pad = strings(out, { cutoff: 1400, volume: -12, attack: 0.35, release: 1.6 });
      pad.triggerAttackRelease(['G2', 'C3', 'D3', 'G3'], 1.1, 0, 0.6);
      pad.triggerAttackRelease(['G2', 'B2', 'D3', 'G3'], 1.6, 1.1, 0.65);
      phrase(bell(out, -15), 1.1, [[0, 'D5', 2, 0.6], [0.5, 'G5', 2, 0.6], [1, 'B5', 2, 0.5]], 0.3);
      return 3.8;
    },
    async battle() { // distant cannon: two booms and a low rumble, far from the listener
      const out = await hall({ decay: 4, wet: 0.45, preDelay: 0.05 });
      const far = filtered(out, 420);
      const boom = new Tone.MembraneSynth({ volume: -2, pitchDecay: 0.12, octaves: 3.5, envelope: { attack: 0.003, decay: 1.4, sustain: 0, release: 0.8 } }).connect(far);
      const blast = noise(filtered(far, 260), { type: 'brown', volume: -3, attack: 0.004, decay: 1.6 });
      boom.triggerAttackRelease('A0', 1.2, 0.02, 1); blast.triggerAttackRelease(1.6, 0.02, 1);
      boom.triggerAttackRelease('F0', 1.2, 0.72, 0.7); blast.triggerAttackRelease(1.2, 0.72, 0.6);
      noise(filtered(out, 160), { type: 'brown', volume: -12, attack: 0.3, decay: 2.2 }).triggerAttackRelease(2.2, 0.1, 0.8);
      return 3.2;
    },
    async fallen() { // descending muted funeral horn
      const out = await hall({ decay: 3.8, wet: 0.35 });
      phrase(horn(out, { volume: -9, base: 110, bright: 1.6, attack: 0.14 }), 0, [[0, 'A3', 0.95, 0.75], [1, 'G3', 0.95, 0.7], [2, 'F3', 0.95, 0.7], [3, 'D3', 2.4, 0.75]], 0.5);
      timpani(out, -10).triggerAttackRelease('D2', 1.2, 1.5, 0.6);
      strings(out, { cutoff: 700, volume: -18 }).triggerAttackRelease(['D2', 'A2', 'F3'], 2.2, 1.5, 0.5);
      return 3.9;
    },
    async defeat() { // heavier own-country variant: lower, longer, timpani roll into the last chord
      const out = await hall({ decay: 4.2, wet: 0.36 });
      phrase(horn(out, { volume: -7, base: 100, bright: 1.8, attack: 0.14 }), 0, [[0, 'D3', 0.95, 0.8], [1, 'C3', 0.95, 0.75], [2, 'Bb2', 0.95, 0.75], [3, 'A2', 1.9, 0.8]], 0.55);
      const timp = timpani(out, -8);
      for (let t = 1.6; t < 2.7; t += 0.07) timp.triggerAttackRelease('A1', 0.2, t, human(0.25 + (t - 1.6) * 0.45, 0.08));
      timp.triggerAttackRelease('D1', 1.8, 2.75, 1);
      const low = strings(out, { cutoff: 600, volume: -13, attack: 0.3 });
      low.triggerAttackRelease(['D2', 'A2', 'D3', 'F3'], 2.3, 2.75, 0.75);
      horn(out, { volume: -12, base: 90 }).triggerAttackRelease(['D2', 'A2'], 2.1, 2.75, 0.7);
      return 5.4;
    },
    async industry_up() { // clank, clank, rising steam
      const out = await hall({ decay: 1.4, wet: 0.18 });
      const clank = new Tone.MetalSynth({ volume: -16, harmonicity: 5.1, modulationIndex: 22, resonance: 2800, octaves: 1.2, envelope: { attack: 0.001, decay: 0.22, release: 0.1 } }).connect(out);
      clank.triggerAttackRelease(180, 0.18, 0.0, 0.9); clank.triggerAttackRelease(240, 0.16, 0.22, 0.8);
      timpani(out, -14).triggerAttackRelease('G2', 0.2, 0.0, 0.5);
      const hissFilter = new Tone.Filter({ frequency: 700, type: 'bandpass', Q: 1.2 }).connect(out);
      hissFilter.frequency.setValueAtTime(700, 0.35); hissFilter.frequency.exponentialRampToValueAtTime(6000, 1.5);
      noise(hissFilter, { volume: -10, attack: 0.35, decay: 0.8, sustain: 0.4, release: 0.3 }).triggerAttackRelease(0.9, 0.35, 0.8);
      phrase(bell(out, -22), 0.5, [[0, 'G5', 1, 0.5], [1, 'D6', 1, 0.5]], 0.25);
      return 2.0;
    },
    async countdown() { // accelerating ticks over a low dissonant swell
      const out = await hall({ decay: 2.2, wet: 0.22 });
      const tick = new Tone.MembraneSynth({ volume: -10, pitchDecay: 0.008, octaves: 2, envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 } }).connect(filtered(out, 1800, 'highpass'));
      for (const t of [0, 0.5, 0.92, 1.26, 1.54, 1.78, 1.98]) tick.triggerAttackRelease('C6', 0.05, t, 0.9);
      const timp = timpani(out, -9); for (const t of [0, 1.0, 1.98]) timp.triggerAttackRelease('D2', 0.5, t, t > 1.5 ? 0.9 : 0.55);
      const pad = strings(out, { cutoff: 800, volume: -16, attack: 1.4 });
      pad.triggerAttackRelease(['D2', 'A2', 'Eb3'], 2.1, 0, 0.7);
      return 3.0;
    },
    async countdown_stop() { // tension released: suspended chord falling open
      const out = await hall({ decay: 3, wet: 0.32 });
      const pad = strings(out, { cutoff: 1100, volume: -13, attack: 0.08, release: 1.4 });
      pad.triggerAttackRelease(['D3', 'Eb3', 'A3'], 0.5, 0, 0.6);
      pad.triggerAttackRelease(['Bb2', 'D3', 'F3'], 1.4, 0.5, 0.6);
      timpani(out, -12).triggerAttackRelease('Bb1', 1, 0.5, 0.5);
      return 2.8;
    },
    async victory() { // full fanfare: triplet pickups, D major, timpani, cymbal, bells
      const out = await hall({ decay: 3, wet: 0.3 });
      const fan = brass(out, { volume: -9, bright: 3.8, base: 250, attack: 0.03 });
      phrase(fan, 0, [[0, 'A3', 0.33, 0.7], [0.33, 'A3', 0.33, 0.7], [0.66, 'A3', 0.34, 0.75], [1, 'D4', 1, 0.9], [2, 'A3', 0.5, 0.75], [2.5, 'D4', 0.5, 0.8], [3, 'F#4', 1, 0.9], [4, 'A4', 3.4, 0.95]], 0.36);
      fan.triggerAttackRelease(['D3', 'A3', 'D4', 'F#4'], 1.9, 1.44, 0.85);
      const timp = timpani(out, -6); for (const [t, n] of [[0.36, 'A1'], [1.08, 'D2'], [1.44, 'D2']]) timp.triggerAttackRelease(n, 0.8, t, 0.8);
      noise(filtered(out, 6000, 'highpass'), { volume: -18, attack: 0.002, decay: 2.4 }).triggerAttackRelease(2.4, 1.44, 0.8);
      phrase(bell(out, -14), 1.44, [[0, 'D5', 2, 0.7], [0.25, 'F#5', 2, 0.6], [0.5, 'A5', 2, 0.6], [0.75, 'D6', 2, 0.5]], 0.36);
      strings(out, { cutoff: 1800, volume: -15, attack: 0.3 }).triggerAttackRelease(['D3', 'A3', 'F#4'], 2.4, 1.44, 0.6);
      return 5.2;
    },
    async draw() { // unresolved: sus4 to sus2, bells, no tonic arrival
      const out = await hall({ decay: 3.2, wet: 0.32 });
      const pad = strings(out, { cutoff: 1300, volume: -12, attack: 0.3 });
      pad.triggerAttackRelease(['D3', 'G3', 'A3'], 1.3, 0, 0.6);
      pad.triggerAttackRelease(['D3', 'E3', 'A3'], 1.8, 1.3, 0.6);
      phrase(horn(out, { volume: -13 }), 0, [[0, 'A3', 1, 0.7], [1, 'G3', 1, 0.65], [2, 'A3', 2.2, 0.65]], 0.6);
      phrase(bell(out, -17), 1.3, [[0, 'A5', 2, 0.5], [0.5, 'E5', 2, 0.5]], 0.4);
      return 3.8;
    },
    async dispatch() { // alliance changed/dissolved: two neutral muted notes
      const out = await hall({ decay: 2.4, wet: 0.3 });
      phrase(horn(out, { volume: -11, base: 120, bright: 1.5 }), 0, [[0, 'A3', 0.9, 0.7], [1, 'E3', 1.6, 0.65]], 0.42);
      bell(out, -22).triggerAttackRelease('E5', 1.4, 0.42, 0.4);
      return 1.9;
    },
    async click() { // quiet order click: short wooden tick
      const out = await hall({ decay: 0.4, wet: 0.08 });
      new Tone.MembraneSynth({ volume: -6, pitchDecay: 0.004, octaves: 1.5, envelope: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.01 } })
        .connect(filtered(out, 900, 'highpass')).triggerAttackRelease('G5', 0.02, 0.002, 0.9);
      noise(filtered(out, 3500, 'highpass'), { volume: -22, decay: 0.012 }).triggerAttackRelease(0.012, 0.002, 0.7);
      return 0.14;
    },
    async march() { // dispatched: a short whoosh and three muffled boots
      const out = await hall({ decay: 1, wet: 0.14 });
      const sweep = new Tone.Filter({ frequency: 400, type: 'bandpass', Q: 1.4 }).connect(out);
      sweep.frequency.setValueAtTime(400, 0); sweep.frequency.exponentialRampToValueAtTime(2600, 0.28); sweep.frequency.exponentialRampToValueAtTime(900, 0.5);
      noise(sweep, { type: 'pink', volume: -8, attack: 0.12, decay: 0.35 }).triggerAttackRelease(0.4, 0, 0.8);
      const boot = noise(filtered(out, 320), { type: 'brown', volume: -1, decay: 0.07 });
      const thud = new Tone.MembraneSynth({ volume: -12, pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 } }).connect(out);
      for (const [i, t] of [0.34, 0.54, 0.74].entries()) { boot.triggerAttackRelease(0.07, t, 0.9 - i * 0.2); thud.triggerAttackRelease('A1', 0.05, t, 0.8 - i * 0.2); }
      return 1.0;
    },
    async warning() { // incoming army: two soft two-tone bugle calls
      const out = await hall({ decay: 1.2, wet: 0.16 });
      const bugle = new Tone.PolySynth(Tone.Synth, { volume: -14, oscillator: { type: 'square8' }, envelope: { attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.08 } }).connect(filtered(out, 2400));
      phrase(bugle, 0, [[0, 'E5', 0.9, 0.75], [1, 'B4', 0.9, 0.7], [2.2, 'E5', 0.9, 0.7], [3.2, 'B4', 0.9, 0.65]], 0.18);
      return 1.1;
    },
    async chat() { // world message: telegraph-like double blip
      const out = await hall({ decay: 0.6, wet: 0.1 });
      const blip = new Tone.Synth({ volume: -10, oscillator: { type: 'sine' }, envelope: { attack: 0.003, decay: 0.05, sustain: 0.3, release: 0.04 } }).connect(out);
      blip.triggerAttackRelease('E6', 0.05, 0.002, 0.8); blip.triggerAttackRelease('A6', 0.07, 0.09, 0.7);
      return 0.3;
    },
  };

  const pack = buffer => {
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const bytes = new Uint8Array(buffer.getChannelData(c).buffer.slice(0));
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      channels.push(btoa(s));
    }
    return { sampleRate: buffer.sampleRate, channels };
  };

  /** Loops render two cycles; the generator keeps the second (steady state, reverb tails wrapped). */
  window.renderLoop = async name => {
    const bars = name === 'theme' ? MUSIC_BARS : TENSION_BARS;
    const buffer = await Tone.Offline(() => (name === 'theme' ? theme : tension)(2), 2 * bars * BAR, 2, SAMPLE_RATE);
    return { ...pack(buffer), period: bars * BAR };
  };
  window.renderCue = async name => {
    let length = 0;
    const buffer = await Tone.Offline(async () => { length = await CUES[name](); flush(); }, 8, 1, SAMPLE_RATE);
    return { ...pack(buffer), length };
  };
  window.cueNames = Object.keys(CUES);
})();
