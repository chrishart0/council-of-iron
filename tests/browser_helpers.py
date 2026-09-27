"""Browser rendering helper. Native HTTP is the default; bridge is explicit.

Bridge mode never changes managed browser policy. It renders the real modules in
an in-memory page and forwards only relative requests to the local test server.
It is a DOM/integration test, not evidence of native navigation or CSP behavior.
"""
import base64
import json
from pathlib import Path
import re
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def load_bridge(page, url, saved=None):
    def local_http(payload):
        path = payload['path']
        assert path.startswith('/') and not path.startswith('//')
        options = payload.get('options') or {}
        request = urllib.request.Request(url + path, method=options.get('method', 'GET'),
            headers=options.get('headers') or {},
            data=options['body'].encode() if options.get('body') is not None else None)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return {'status': response.status, 'body': response.read().decode()}
        except urllib.error.HTTPError as error:
            return {'status': error.code, 'body': error.read().decode()}
    page.expose_function('__localHttp', local_http)
    html = (ROOT / 'public/index.html').read_text()
    html = re.sub(r'<script[^>]+src="/app.js"[^>]*></script>', '', html)
    html = re.sub(r'<link[^>]+href="/(?:style|review|map-layers|feed).css"[^>]*>', '', html)
    page.set_content(html)
    for name in ['style.css', 'review.css', 'map-layers.css', 'feed.css']:
        page.add_style_tag(content=(ROOT / 'public' / name).read_text())
    page.evaluate('''saved => {
        const storage = saved || {};
        Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v,removeItem:k=>delete storage[k]}});
        window.__testStorage=storage;
        history.replaceState=()=>{};
        window.fetch=async(path,options={})=>{const r=await window.__localHttp({path,options});return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>JSON.parse(r.body)};};
    }''', saved or {})
    cache = {}
    def source(name):
        text = (ROOT / 'public' / name).read_text()
        return re.sub(r"from (['\"])(\./[\w-]+\.js)\1", lambda m: 'from ' + json.dumps(module_url(m.group(2)[2:])), text)
    def module_url(name):
        if name not in cache:
            cache[name] = 'data:text/javascript;base64,' + base64.b64encode(source(name).encode()).decode()
        return cache[name]
    page.add_script_tag(type='module', content=source('app.js'))
