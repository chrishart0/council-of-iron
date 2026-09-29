"""Performance probe shared by tests/perf-browser.py and ad-hoc measurement.

Installs in-page counters before the app loads (MutationObserver per poll, long tasks, app rAF calls,
live timers, poll payloads) and reads Chrome's own counters over CDP (task/script/layout/style time,
layout and style-recalc counts, DOM nodes, listeners, heap). Test-only; the game has no hooks for it.
"""
import json

# Runs before any page script. Counts, never changes behaviour.
INIT = r'''(() => {
  const P = window.__perf = { polls: 0, pollBytes: [], added: 0, addedTree: 0, removed: 0, attrs: 0, text: 0,
    perPoll: [], longTasks: [], raf: 0, rafIdle: 0, timers: new Map(), intervals: new Map(), seq: 0, frames: [] };
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = String(input && input.url || input);
    const response = await origFetch.apply(this, arguments);
    if (/\/api\/games\/[^/?]+(\?|$)/.test(url) && (!init || !init.method || init.method === 'GET')) {
      P.polls++;
      try { const clone = response.clone(); clone.text().then(t => P.pollBytes.push(t.length)); } catch {}
    }
    return response;
  };
  const oRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => { P.raf++; return oRaf(cb); };
  const oSI = window.setInterval.bind(window), oCI = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...a) => { const id = oSI(fn, ms, ...a); P.intervals.set(id, ms); return id; };
  window.clearInterval = id => { P.intervals.delete(id); return oCI(id); };
  const count = n => n.nodeType === 1 ? 1 + n.getElementsByTagName('*').length : 0;
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'childList') { for (const n of m.addedNodes) { if (n.nodeType === 1) { P.added++; P.addedTree += count(n); } } P.removed += m.removedNodes.length; }
      else if (m.type === 'attributes') P.attrs++; else P.text++;
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) P.longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch {}
  P.wire = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (/\/api\/games\/[^/?]+\?after=/.test(e.name)) P.wire.push(e.encodedBodySize); }).observe({ type: 'resource', buffered: true }); } catch {}
})();'''

SNAPSHOT = r'''() => {
  const P = window.__perf, all = document.getElementsByTagName('*');
  let heavy = { backdrop: 0, filter: 0, shadow: 0 };
  for (const e of all) {
    if (!e.checkVisibility || !e.checkVisibility()) continue;
    const s = getComputedStyle(e);
    if (s.backdropFilter && s.backdropFilter !== 'none') heavy.backdrop++;
    if (s.filter && s.filter !== 'none') heavy.filter++;
    if (s.boxShadow && s.boxShadow !== 'none') heavy.shadow++;
  }
  const anims = document.getAnimations().filter(a => a.playState === 'running');
  return { polls: P.polls, pollBytes: P.pollBytes.slice(), wire: P.wire.slice(), added: P.added, addedTree: P.addedTree, removed: P.removed, attrs: P.attrs, text: P.text,
    longTasks: P.longTasks.slice(), raf: P.raf, intervals: [...P.intervals.values()],
    nodes: all.length, svgNodes: document.querySelectorAll('#map *').length, uses: document.querySelectorAll('#map use').length,
    heavy, running: anims.length, infinite: anims.filter(a => a.effect?.getTiming().iterations === Infinity).length,
    tick: document.getElementById('clock')?.textContent };
}'''

METRICS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount',
           'Nodes', 'JSEventListeners', 'JSHeapUsedSize', 'Timestamp']

def metrics(cdp):
    return {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics'] if m['name'] in METRICS}

def window(page, cdp, seconds, trace_browser=None):
    """Measure `seconds` of steady state. Returns busy %, per-poll mutation counts, long tasks, and, with
    `trace_browser`, paint and frame counts from a devtools timeline trace."""
    if trace_browser: trace_browser.start_tracing(page=page, categories=['devtools.timeline', 'disabled-by-default-devtools.timeline.frame'])
    a, sa = metrics(cdp), page.evaluate(SNAPSHOT)
    page.wait_for_timeout(int(seconds * 1000))
    b, sb = metrics(cdp), page.evaluate(SNAPSHOT)
    out = {}
    if trace_browser:
        events = json.loads(trace_browser.stop_tracing())['traceEvents']
        names = {}
        for e in events: names[e.get('name')] = names.get(e.get('name'), 0) + 1
        out['paints'] = names.get('Paint', 0); out['frames'] = names.get('DrawFrame', 0) or names.get('BeginFrame', 0)
        out['layerize'] = names.get('Layerize', 0) + names.get('UpdateLayerTree', 0)
        # Where the renderer main thread spends its time (self-contained top-level slices).
        main = {(e['pid'], e['tid']) for e in events if e.get('name') == 'thread_name' and e.get('args', {}).get('name') == 'CrRendererMain'}
        spent = {}
        for e in events:
            if (e.get('pid'), e.get('tid')) in main and e.get('ph') == 'X' and e.get('name') in ('FunctionCall', 'TimerFire', 'FireAnimationFrame', 'UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint', 'Layerize', 'EventDispatch', 'ParseHTML', 'MajorGC', 'MinorGC', 'V8.GC_SCAVENGER', 'RunTask', 'Commit', 'HitTest', 'ScheduleStyleRecalculation', 'UpdateLayer', 'PaintImage', 'RasterTask', 'v8.run', 'EvaluateScript', 'v8.callFunction'):
                spent[e['name']] = spent.get(e['name'], 0) + e.get('dur', 0) / 1000
        out['main_ms'] = {k: round(v) for k, v in sorted(spent.items(), key=lambda kv: -kv[1])}
    wall = b['Timestamp'] - a['Timestamp']; polls = max(1, sb['polls'] - sa['polls'])
    out.update({
        'seconds': round(wall, 1), 'busy_pct': round(100 * (b['TaskDuration'] - a['TaskDuration']) / wall, 1),
        'script_pct': round(100 * (b['ScriptDuration'] - a['ScriptDuration']) / wall, 1),
        'layout_per_s': round((b['LayoutCount'] - a['LayoutCount']) / wall, 1), 'style_per_s': round((b['RecalcStyleCount'] - a['RecalcStyleCount']) / wall, 1),
        'layout_ms_per_s': round(1000 * (b['LayoutDuration'] - a['LayoutDuration']) / wall, 1), 'style_ms_per_s': round(1000 * (b['RecalcStyleDuration'] - a['RecalcStyleDuration']) / wall, 1),
        'polls': sb['polls'] - sa['polls'], 'poll_kb': round(sum(sb['pollBytes'][len(sa['pollBytes']):]) / polls / 1024, 1),
        'poll_wire_kb': round(sum(sb['wire'][len(sa['wire']):]) / max(1, len(sb['wire']) - len(sa['wire'])) / 1024, 1),
        'added_per_poll': round((sb['added'] - sa['added']) / polls, 1), 'added_tree_per_poll': round((sb['addedTree'] - sa['addedTree']) / polls, 1),
        'removed_per_poll': round((sb['removed'] - sa['removed']) / polls, 1), 'attrs_per_poll': round((sb['attrs'] - sa['attrs']) / polls, 1),
        'raf_per_s': round((sb['raf'] - sa['raf']) / wall, 1), 'long_tasks': sb['longTasks'][len(sa['longTasks']):],
        'nodes': sb['nodes'], 'dom_nodes_cdp': b['Nodes'], 'svg_nodes': sb['svgNodes'], 'listeners': b['JSEventListeners'],
        'heap_mb': round(b['JSHeapUsedSize'] / 2**20, 1), 'intervals': sb['intervals'], 'running_anims': sb['running'], 'infinite_anims': sb['infinite'],
        'heavy_css': sb['heavy'], 'clock': sb['tick'],
    })
    return out
