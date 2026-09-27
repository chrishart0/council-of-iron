"""Voice input in a real browser: Chromium fake microphone -> MediaRecorder -> /api/games/{id}/stt
-> sidecar -> transcript inserted into the composer, never sent automatically.

The sidecar is a test fake (fixed transcript, records what it received) unless --real-stt URL is
given, in which case the actual GPU sidecar transcribes the generated speech.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PHRASE = 'The French Republic proposes an alliance against the German Empire.'


def fake_sidecar():
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass

        def reply(self, data):
            body = json.dumps(data).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body)

        def do_GET(self): self.reply({'ok': True, 'model': 'fake'})

        def do_POST(self):
            audio = self.rfile.read(int(self.headers['Content-Length']))
            seen.append({'type': self.headers['Content-Type'], 'bytes': len(audio)})
            self.reply({'text': PHRASE, 'ms': 1})

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f'http://127.0.0.1:{server.server_port}', seen


def speech_wav(tmp):
    """A spoken clip for the fake microphone (espeak-ng), or a tone if TTS is unavailable."""
    wav = Path(tmp) / 'mic.wav'
    raw = Path(tmp) / 'raw.wav'
    if shutil.which('espeak-ng'):
        subprocess.run(['espeak-ng', '-v', 'en-us', '-s', '165', '-w', str(raw), PHRASE], check=True)
        source = ['-i', str(raw), '-af', 'apad=pad_dur=3']
    else:
        source = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4']
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *source, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], check=True)
    return wav


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--executable', default=os.environ.get('BROWSER_EXECUTABLE'))
    parser.add_argument('--artifacts', default=str(ROOT / 'artifacts' / 'voice'))
    parser.add_argument('--real-stt', help='URL of a running tools/stt sidecar to use instead of the fake.')
    args = parser.parse_args()
    artifacts = Path(args.artifacts); artifacts.mkdir(parents=True, exist_ok=True)
    report = {'assertions': [], 'pageErrors': []}
    fake, fake_url, seen = fake_sidecar()
    with tempfile.TemporaryDirectory(prefix='council-voice-') as tmp:
        wav = speech_wav(tmp)
        env = {**os.environ, 'PORT': '0', 'TEST_DB': str(Path(tmp) / 'test.db'), 'TEST_CLOCK_SCALE': '1', 'STT_URL': args.real_stt or fake_url}
        server = subprocess.Popen(['node', 'tests/browser-server.js'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            url = json.loads(server.stdout.readline())['url']

            def http(path, data=None, token=None):
                request = urllib.request.Request(url + path, method='POST' if data is not None else 'GET', data=json.dumps(data).encode() if data is not None else None,
                    headers={**({'Content-Type': 'application/json'} if data is not None else {}), **({'Authorization': f'Bearer {token}'} if token else {})})
                with urllib.request.urlopen(request, timeout=15) as response:
                    return json.load(response)

            me = http('/api/players', {'name': 'Speaker'})
            room = http('/api/games', {'name': 'Voice test'}, me['token'])['id']
            http(f'/api/games/{room}/join', {'country': 'france', 'kind': 'human'}, me['token'])
            http(f'/api/games/{room}/bots', {}, me['token'])
            http(f'/api/games/{room}/start', {}, me['token'])

            def ok(name):
                report['assertions'].append(name)

            with sync_playwright() as playwright:
                launch = {'headless': True, 'args': ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                                                     f'--use-file-for-fake-audio-capture={wav}']}
                if args.executable: launch['executable_path'] = args.executable
                browser = playwright.chromium.launch(**launch)
                context = browser.new_context(viewport={'width': 1366, 'height': 768}, permissions=['microphone'])
                context.add_init_script(f"localStorage.setItem('coi.identity', {json.dumps(json.dumps(me))})")
                page = context.new_page()
                page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
                page.goto(f'{url}/?match={room}')
                feed_input = page.locator('#feed-text')
                expect(feed_input).to_be_visible(timeout=15000)
                mic = page.locator('#feed-form .voice-mic')
                expect(mic).to_be_visible()
                expect(mic).to_have_attribute('aria-label', 'Voice input (local GPU speech-to-text)')
                expect(page.locator('#chat-form .voice-mic')).to_have_count(1)
                ok('mic attached to the world composer and the dispatches composer')

                # Tap to start, tap to stop.
                feed_input.fill('Proposal:')
                mic.click()
                expect(mic).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#feed-form .voice-meter')).to_be_visible()
                page.wait_for_timeout(1500)
                page.screenshot(path=str(artifacts / 'recording.png'))
                # The clip is speech then silence: recording stops by itself after ~1.5 s of trailing silence.
                expect(mic).to_have_attribute('aria-pressed', 'false', timeout=15000)
                expect(feed_input).to_have_value(__import__('re').compile(r'^Proposal: \S'), timeout=20000)
                value = feed_input.input_value()
                if args.real_stt:
                    for word in ('french', 'alliance', 'german'): assert word in value.lower(), value
                else:
                    assert value == f'Proposal: {PHRASE}', value
                    assert seen[-1]['type'].startswith('audio/webm') and seen[-1]['bytes'] > 1000, seen
                expect(feed_input).to_be_focused()
                expect(page.locator('#feed-form .voice-status')).to_contain_text('Review, then Send')
                ok('tap-to-talk auto-stops on trailing silence, transcribes, appends after existing text with a space and focuses the input')
                page.screenshot(path=str(artifacts / 'inserted.png'))

                page.wait_for_timeout(1500)
                state = http(f'/api/games/{room}', token=me['token'])
                assert not [e for e in state['events'] if e['type'] == 'message'], 'voice input must not send chat'
                expect(page.locator('#feed-list')).not_to_contain_text('proposes an alliance')
                ok('transcript is not sent automatically')

                # Escape cancels a recording without inserting or uploading.
                before, count = feed_input.input_value(), len(seen)
                mic.click()
                expect(mic).to_have_attribute('aria-pressed', 'true')
                page.keyboard.press('Escape')
                expect(mic).to_have_attribute('aria-pressed', 'false')
                expect(page.locator('#feed-form .voice-status')).to_contain_text('cancelled')
                page.wait_for_timeout(800)
                assert feed_input.input_value() == before and len(seen) == count
                ok('Escape cancels without uploading')

                # Keyboard shortcut from the composer, then press-and-hold.
                feed_input.fill('')
                feed_input.focus()
                page.keyboard.press('Control+Shift+Space')
                expect(mic).to_have_attribute('aria-pressed', 'true')
                page.wait_for_timeout(1200)
                page.keyboard.press('Control+Shift+Space')
                expect(feed_input).not_to_have_value('', timeout=20000)
                ok('Ctrl+Shift+Space toggles recording while the composer is focused')
                feed_input.fill('')
                box = mic.bounding_box()
                page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
                page.mouse.down()
                expect(mic).to_have_attribute('aria-pressed', 'true')
                page.wait_for_timeout(1500)
                page.mouse.up()
                expect(mic).to_have_attribute('aria-pressed', 'false')
                expect(feed_input).not_to_have_value('', timeout=20000)
                ok('press-and-hold records until release')
                live_tracks = page.evaluate("navigator.mediaDevices.enumerateDevices().then(()=>document.querySelectorAll('.voice[data-state=recording]').length)")
                assert live_tracks == 0

                # A page without HTTPS explains why the mic cannot work.
                insecure = context.new_page()
                insecure.add_init_script("Object.defineProperty(window,'isSecureContext',{get:()=>false})")
                insecure.goto(f'{url}/?match={room}')
                imic = insecure.locator('#feed-form .voice-mic')
                expect(imic).to_have_attribute('title', 'Voice input needs HTTPS', timeout=15000)
                imic.click()
                expect(insecure.locator('#feed-form .voice-status')).to_contain_text('needs HTTPS')
                ok('insecure context shows "Voice input needs HTTPS"')

                # Spectators get no mic.
                spectator = browser.new_context(viewport={'width': 1366, 'height': 768}).new_page()
                spectator.goto(f'{url}/?match={room}&spectate=1')
                expect(spectator.locator('#map')).to_be_visible(timeout=15000)
                expect(spectator.locator('#feed-form .voice-mic')).to_be_hidden()
                ok('spectators have no mic')
                browser.close()
            assert not report['pageErrors'], report['pageErrors']
        finally:
            server.terminate(); server.wait(timeout=10)
            fake.shutdown()
            (artifacts / 'voice-report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
