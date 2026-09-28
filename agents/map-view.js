/** Decorative map image derived only from a seat's observation and the public map. */
import { spawn } from 'node:child_process';

const escapeXml = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

export function mapViewSvg(observation, map) {
  if (!observation.you) throw new Error('Join a country to view the map.');
  const state = new Map(observation.provinces.map(province => [province.id, province]));
  const colors = new Map(map.countries.map(country => [country.id, country.color]));
  const mine = new Set(observation.provinces.filter(p => p.owner === observation.you).map(p => p.id));
  const nearby = new Set(map.provinces.filter(p => mine.has(p.id)).flatMap(p => p.neighbors));
  const paths = map.provinces.map(place => {
    const province = state.get(place.id);
    const fill = colors.get(province.owner) || '#485961';
    const border = mine.has(place.id) ? '#f3d999' : '#182b32';
    return `<path d="${escapeXml(place.path)}" fill="${fill}" stroke="${border}" stroke-width="${mine.has(place.id) ? 2.8 : 1.1}"/>`;
  }).join('');
  const markers = map.provinces.filter(p => mine.has(p.id) || nearby.has(p.id)).map(place => {
    const province = state.get(place.id);
    const owned = mine.has(place.id);
    return `<g><circle cx="${place.x}" cy="${place.y}" r="${owned ? 12 : 9}" fill="${owned ? '#1b3039' : '#263942'}" stroke="${owned ? '#ffe3a0' : '#e4e8df'}" stroke-width="1.7"/><text x="${place.x}" y="${place.y + 3.5}" text-anchor="middle" fill="#fff" font-family="DejaVu Sans" font-size="${owned ? 10 : 9}" font-weight="bold">${province.troops}</text></g>`;
  }).join('');
  const legend = map.countries.map((country, index) => {
    const x = 24 + (index % 4) * 305, y = 575 + Math.floor(index / 4) * 38;
    return `<rect x="${x}" y="${y}" width="16" height="16" fill="${country.color}"/><text x="${x + 23}" y="${y + 13}" fill="#e7e9e2" font-family="DejaVu Sans" font-size="16">${escapeXml(country.name)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="680" viewBox="0 0 1280 680"><rect width="1280" height="680" fill="#10232c"/><text x="24" y="30" fill="#f4ebd4" font-family="DejaVu Sans" font-size="20" font-weight="bold">Council of Iron · tick ${observation.tick} · ${escapeXml(observation.you)}</text><g transform="translate(0 38) scale(1 .75)">${paths}${markers}</g><rect x="0" y="550" width="1280" height="130" fill="#10232c"/>${legend}<text x="24" y="665" fill="#a5b4b7" font-family="DejaVu Sans" font-size="13">Gold outlines are yours. Numbered circles show your and neighboring garrisons. Use board for exact province IDs and orders.</text></svg>`;
}

export async function mapViewPng(observation, map) {
  const svg = mapViewSvg(observation, map);
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/convert', ['svg:-', 'png:-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0, errorText = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 4_000_000) child.kill('SIGKILL'); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-1000); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || size > 4_000_000) reject(new Error(`Map rasterization failed: ${errorText || code}`));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(svg);
  });
}
