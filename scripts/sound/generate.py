"""Render, level and encode the Council of Iron sound set. Development tool only.

    npm install                     # dev dependency: tone (MIT), loaded only into headless Chromium
    python scripts/sound/generate.py [--report DIR]

Needs Python with numpy, scipy and Playwright's Chromium (tests/requirements.txt plus numpy/scipy),
and ffmpeg built with libopus and libmp3lame. Writes public/audio/{theme,tension,effects}.{ogg,mp3}
and public/audio/manifest.json. With --report it also writes spectrogram PNGs and a JSON of the
measured levels and loop seams. Every sound is synthesized by scripts/sound/compose.js; nothing
is sampled. Math.random is seeded before Tone.js loads, so renders are repeatable.
"""
import argparse, base64, hashlib, json, subprocess, tempfile, wave
from pathlib import Path
import numpy as np
from scipy import signal
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/audio'
RATE = 48000
LOOP_PAD = 0.5          # seconds of the loop's own beginning appended after its end
LOOP_START = 1.0        # the loop's own last second is prepended, so neither loop point sits in codec start-up frames
GAP = 0.25              # silence between sprite cues
# Loudness targets. Stingers: maximum momentary loudness (400 ms, BS.1770 K-weighting).
# Music: gated integrated loudness. Sample-peak ceiling −1 dBFS; 4× oversampled peak reported.
TARGETS = {'stinger': -16.0, 'ui': -24.0, 'click': -27.0, 'theme': -23.0, 'tension': -25.0}
KIND = {'click': 'click', 'march': 'ui', 'chat': 'ui', 'warning': 'ui'}
CEILING = 10 ** (-1 / 20)
SEED = 'Math.random=(()=>{let s=0x1910;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};})();'


def k_weight(x):
    # ITU-R BS.1770-4 pre-filter and RLB high-pass at 48 kHz.
    x = signal.lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585], x, axis=-1)
    return signal.lfilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621], x, axis=-1)


def blocks(x, size=0.4, hop=0.1):
    y = k_weight(np.atleast_2d(x)); n, h = int(size * RATE), int(hop * RATE)
    if y.shape[1] < n: y = np.pad(y, ((0, 0), (0, n - y.shape[1])))
    power = [np.sum(np.mean(y[:, i:i + n] ** 2, axis=1)) for i in range(0, y.shape[1] - n + 1, h)]
    return np.array(power) + 1e-20


lufs = lambda p: -0.691 + 10 * np.log10(p)


def integrated(x):
    p = blocks(x); p = p[lufs(p) > -70]
    if not len(p): return -70.0
    p = p[lufs(p) > lufs(np.mean(p)) - 10]
    return float(lufs(np.mean(p)))


momentary_max = lambda x: float(np.max(lufs(blocks(x))))
true_peak = lambda x: float(np.max(np.abs(signal.resample_poly(np.atleast_2d(x), 4, 1, axis=-1))))
db = lambda v: float(20 * np.log10(max(v, 1e-12)))


def level(x, target, measure):
    gain = 10 ** ((target - measure(x)) / 20)
    peak = np.max(np.abs(x)) * gain
    if peak > CEILING: gain *= CEILING / peak   # ceiling wins; report shows the shortfall
    return x * gain


def decode(data):
    return np.stack([np.frombuffer(base64.b64decode(c), dtype='<f4') for c in data['channels']])


def trim(x, nominal):
    # Keep the nominal length, then the tail until it falls below −50 dBFS, with a 60 ms fade.
    loud = np.nonzero(np.max(np.abs(x), axis=0) > 10 ** (-50 / 20))[0]
    end = max(int(nominal * RATE), (loud[-1] + 1) if len(loud) else 0)
    end = min(x.shape[1], end + int(0.06 * RATE)); x = x[:, :end].copy()
    fade = int(0.06 * RATE); x[:, -fade:] *= np.linspace(1, 0, fade) ** 2
    return x


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).round().astype('<i2').T
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(x.shape[0]); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())


def encode(wav, stem):
    opus, mp3 = {'theme': ('40k', '64k'), 'tension': ('32k', '48k'), 'effects': ('32k', '48k')}[stem]
    for ext, codec in [('ogg', ['-c:a', 'libopus', '-b:a', opus, '-application', 'audio']),
                       ('mp3', ['-c:a', 'libmp3lame', '-b:a', mp3, '-ar', '44100'])]:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), *codec, '-map_metadata', '-1', str(OUT / f'{stem}.{ext}')], check=True)


def decoded(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(RATE), '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype='<f4')


def seam(path, period):
    # Compare 20 ms just before loopEnd with 20 ms just before loopStart in the DECODED file:
    # identical content means the jump is inaudible. Also report the sample step at the join.
    y = decoded(path); a, b, n = int(LOOP_START * RATE), int((LOOP_START + period) * RATE), int(0.02 * RATE)
    before, wrapped = y[b - n:b], y[a - n:a]
    rms = np.sqrt(np.mean(y[a:b] ** 2))
    def bands(w):  # energy in 20 log-spaced bands, 60 Hz–16 kHz, of a Hann-windowed 40 ms frame
        spec = np.abs(np.fft.rfft(w * np.hanning(len(w)))) ** 2; f = np.fft.rfftfreq(len(w), 1 / RATE)
        edges = np.geomspace(60, 16000, 21)
        return np.array([10 * np.log10(spec[(f >= lo) & (f < hi)].sum() + 1e-12) for lo, hi in zip(edges, edges[1:])])
    m = int(0.04 * RATE); loud = bands(y[a - m:a]) > bands(y[a - m:a]).max() - 30
    spectral = float(np.max(np.abs(bands(y[b - m:b]) - bands(y[a - m:a]))[loud]))
    return {'bandDiffDb': round(spectral, 2), 'decodedSeconds': round(len(y) / RATE, 3), 'windowDiffDb': round(db(np.sqrt(np.mean((before - wrapped) ** 2)) / rms), 1),
            'joinStep': round(float(abs(y[b] - y[b - 1]) - abs(y[a] - y[a - 1])), 4)}


def spectrogram(x, title, path):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    mono = np.mean(x, axis=0); t = np.arange(len(mono)) / RATE
    fig, (top, bottom) = plt.subplots(2, 1, figsize=(10, 5), sharex=True, gridspec_kw={'height_ratios': [1, 2]})
    top.plot(t, mono, lw=.4, color='#1f3b4d'); top.axhline(CEILING, color='r', lw=.6); top.axhline(-CEILING, color='r', lw=.6)
    top.set_ylim(-1.05, 1.05); top.set_title(title, fontsize=9)
    bottom.specgram(mono + 1e-9, NFFT=2048, Fs=RATE, noverlap=1536, cmap='magma', vmin=-140)
    bottom.set_ylim(0, 12000); bottom.set_xlabel('s'); bottom.set_ylabel('Hz')
    fig.tight_layout(); fig.savefig(path, dpi=80); plt.close(fig)


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--report'); args = parser.parse_args()
    report_dir = Path(args.report) if args.report else None
    if report_dir: report_dir.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True); page = browser.new_page()
        page.goto('about:blank'); page.evaluate(SEED)
        page.add_script_tag(path=str(ROOT / 'node_modules/tone/build/Tone.js'))
        page.add_script_tag(path=str(ROOT / 'scripts/sound/compose.js'))
        names = page.evaluate('cueNames')
        loops = {name: page.evaluate('n => renderLoop(n)', name) for name in ['theme', 'tension']}
        cues = {name: page.evaluate('n => renderCue(n)', name) for name in names}
        browser.close()

    manifest = {'generator': 'scripts/sound/generate.py (Tone.js offline synthesis)', 'formats': ['ogg', 'mp3'], 'loops': {}, 'cues': {}}
    metrics = {}
    with tempfile.TemporaryDirectory() as tmp:
        for name, data in loops.items():
            x = decode(data); period = data['period']; n = int(round(period * RATE))
            body = x[:, n:2 * n]                      # steady-state second cycle
            if name == 'tension': body = np.mean(body, axis=0, keepdims=True)
            body = level(body, TARGETS[name], integrated)
            lead = int(LOOP_START * RATE)
            full = np.concatenate([body[:, -lead:], body, body[:, :int(LOOP_PAD * RATE)]], axis=1)
            write_wav(Path(tmp) / f'{name}.wav', full); encode(Path(tmp) / f'{name}.wav', name)
            manifest['loops'][name] = {'loopStart': LOOP_START, 'loopEnd': round(LOOP_START + period, 6), 'period': period}
            metrics[name] = {'seconds': round(full.shape[1] / RATE, 3), 'channels': full.shape[0], 'integratedLufs': round(integrated(body), 1),
                             'samplePeakDb': round(db(np.max(np.abs(body))), 2), 'truePeakDb': round(db(true_peak(body)), 2),
                             'sourceSeamMaxDiff': float(np.max(np.abs(full[:, lead + n - lead:lead + n + int(LOOP_PAD * RATE)] - full[:, :lead + int(LOOP_PAD * RATE)]))),
                             'seam': {ext: seam(OUT / f'{name}.{ext}', period) for ext in ['ogg', 'mp3']}}
            if report_dir: spectrogram(full, f'{name} ({LOOP_START} s lead-in + {period:.1f} s loop + {LOOP_PAD} s wrap)', report_dir / f'{name}.png')
        sprite, cursor = [np.zeros(int(GAP * RATE))], GAP
        for name in names:
            x = trim(decode(cues[name]), cues[name]['length'])
            kind = KIND.get(name, 'stinger'); x = level(x, TARGETS[kind], momentary_max)
            manifest['cues'][name] = {'start': round(cursor, 6), 'duration': round(x.shape[1] / RATE, 6)}
            metrics[name] = {'seconds': round(x.shape[1] / RATE, 3), 'kind': kind, 'target': TARGETS[kind], 'maxMomentaryLufs': round(momentary_max(x), 1),
                             'samplePeakDb': round(db(np.max(np.abs(x))), 2), 'truePeakDb': round(db(true_peak(x)), 2),
                             'leadingSilenceMs': round(1000 * np.argmax(np.abs(x[0]) > 1e-3) / RATE, 1)}
            if report_dir: spectrogram(x, f'{name} · {metrics[name]["maxMomentaryLufs"]} LUFS-M max', report_dir / f'{name}.png')
            sprite += [x[0], np.zeros(int(GAP * RATE))]; cursor += x.shape[1] / RATE + GAP
        effects = np.concatenate(sprite)[None, :]
        write_wav(Path(tmp) / 'effects.wav', effects); encode(Path(tmp) / 'effects.wav', 'effects')
    digest = hashlib.sha256()
    for stem in ['theme', 'tension', 'effects']:
        for ext in ['ogg', 'mp3']: digest.update((OUT / f'{stem}.{ext}').read_bytes())
    manifest['version'] = digest.hexdigest()[:12]
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    sizes = {f.name: f.stat().st_size for f in sorted(OUT.iterdir())}
    summary = {'sizes': sizes, 'totalBytes': sum(sizes.values()), 'metrics': metrics}
    if report_dir: (report_dir / 'levels.json').write_text(json.dumps(summary, indent=1) + '\n')
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main()
