/* Service worker for the installed app. The game is live and multiplayer, so nothing is cached: every request goes
 * to the network as before (no stale code after a deploy, no match data kept on the device). The only thing it adds
 * is a self-contained "no connection" page when opening the app fails to reach the server. */
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#161b1d">
<title>Council of Iron</title><style>
html,body{height:100%;margin:0;background:#161b1d;color:#e8dcc4;font:18px/1.4 system-ui,sans-serif}
main{min-height:100%;display:grid;place-content:center;gap:12px;padding:24px;text-align:center}
h1{margin:0;font-size:24px;color:#e2c38a}p{margin:0}
a{justify-self:center;min-width:44px;padding:12px 24px;border:1px solid #c29a52;border-radius:8px;color:#e2c38a;text-decoration:none}
</style></head><body><main><svg width="96" height="96" aria-hidden="true" style="justify-self:center" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0d1b22"/><circle cx="256" cy="256" r="176" fill="#17303a" stroke="#c8a773" stroke-width="18"/><circle cx="256" cy="256" r="132" fill="none" stroke="#c8a77366" stroke-width="6"/><path d="M256 104l30 122 122 30-122 30-30 122-30-122-122-30 122-30z" fill="#e2c38a"/><path d="M256 104l30 122-30 30zm152 152l-122 30-30-30zM256 408l-30-122 30-30zM104 256l122-30 30 30z" fill="#9c7c46"/><circle cx="256" cy="256" r="16" fill="#0d1b22"/></svg>
<h1>No connection to the council</h1><p>Check your network, then try again.</p><a href="">Try again</a></main></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() =>
    new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
