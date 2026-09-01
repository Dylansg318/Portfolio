#!/usr/bin/env node
/**
 * codegraph-viz.mjs — render a local CodeGraph index as an interactive
 * module-level dependency map (force-directed, vis-network).
 *
 * CodeGraph stores tens of thousands of symbol nodes and edges — too dense to
 * draw raw (this project's index: ~19K nodes / ~38K edges). This aggregates
 * every symbol to its directory ("module") and every calls/imports/references
 * edge to a cross-module dependency, so the result is a readable ~200-node
 * architecture map you can pan, zoom, search, and filter. Reads
 * .codegraph/codegraph.db read-only via node:sqlite (no npm deps); writes a
 * self-contained HTML (vis-network from CDN) and prints its path.
 *
 * Usage: node codegraph-viz.mjs [outPath]   (run from the indexed repo root)
 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB = resolve('.codegraph/codegraph.db');
const OUT = resolve(process.argv[2] || '.codegraph/codegraph-viz.html');

const db = new DatabaseSync(DB, { readOnly: true });

// --- top-level area + color for each module (tune the prefixes to your layout) ---
const AREA = (p) => {
  if (p.startsWith('client/')) return 'client';
  if (p.startsWith('server/routes')) return 'server·routes';
  if (p.startsWith('server/services')) return 'server·services';
  if (p.startsWith('server/jobs')) return 'server·jobs';
  if (p.startsWith('server/lib')) return 'server·lib';
  if (p.startsWith('server/')) return 'server·other';
  if (p.startsWith('scripts')) return 'scripts';
  if (p.startsWith('storefront-theme')) return 'storefront';
  if (p.startsWith('tools')) return 'tools';
  return 'misc';
};
const COLOR = {
  client: '#4f9cf9', 'server·routes': '#f97316', 'server·services': '#ef4444',
  'server·jobs': '#a855f7', 'server·lib': '#22c55e', 'server·other': '#eab308',
  scripts: '#64748b', storefront: '#ec4899', tools: '#14b8a6', misc: '#94a3b8',
};

const moduleOf = (filePath) => {
  const d = dirname(filePath);
  return d === '.' ? '(root)' : d;
};

// --- 1. node -> module map + per-module symbol/kind tallies ---
const nodeRows = db.prepare('SELECT id, kind, file_path FROM nodes').all();
const nodeModule = new Map();        // node id -> module
const modules = new Map();           // module -> {symbols, kinds:{}, area}
for (const r of nodeRows) {
  if (r.kind === 'file' || r.kind === 'import') {
    // still need file/import nodes mapped so edges resolve, but don't count them as "symbols"
    nodeModule.set(r.id, moduleOf(r.file_path));
    let m = modules.get(moduleOf(r.file_path));
    if (!m) { m = { symbols: 0, kinds: {}, area: AREA(moduleOf(r.file_path)) }; modules.set(moduleOf(r.file_path), m); }
    if (r.kind === 'file') m.kinds.file = (m.kinds.file || 0) + 1;
    continue;
  }
  const mod = moduleOf(r.file_path);
  nodeModule.set(r.id, mod);
  let m = modules.get(mod);
  if (!m) { m = { symbols: 0, kinds: {}, area: AREA(mod) }; modules.set(mod, m); }
  m.symbols += 1;
  m.kinds[r.kind] = (m.kinds[r.kind] || 0) + 1;
}

// --- 2. aggregate cross-module edges ---
const edgeRows = db.prepare(
  "SELECT source, target, kind FROM edges WHERE kind IN ('calls','imports','references','instantiates','extends')"
).all();
const pairs = new Map(); // "sm tm" -> {weight, kinds:{}}
for (const e of edgeRows) {
  const sm = nodeModule.get(e.source);
  const tm = nodeModule.get(e.target);
  if (!sm || !tm || sm === tm) continue;
  const key = sm + ' ' + tm;
  let p = pairs.get(key);
  if (!p) { p = { weight: 0, kinds: {} }; pairs.set(key, p); }
  p.weight += 1;
  p.kinds[e.kind] = (p.kinds[e.kind] || 0) + 1;
}

// --- 3. degree tallies for sizing/info ---
const outDeg = new Map(), inDeg = new Map();
for (const [key, p] of pairs) {
  const [sm, tm] = key.split(' ');
  outDeg.set(sm, (outDeg.get(sm) || 0) + p.weight);
  inDeg.set(tm, (inDeg.get(tm) || 0) + p.weight);
}

// --- 4. build vis-network payload ---
const visNodes = [];
for (const [mod, m] of modules) {
  if (m.symbols === 0 && (m.kinds.file || 0) === 0) continue;
  const kindStr = Object.entries(m.kinds)
    .filter(([k]) => k !== 'file')
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`).join(', ');
  visNodes.push({
    id: mod,
    label: mod.replace(/^client\/src\//, '').replace(/^server\//, ''),
    fullPath: mod,
    area: m.area,
    color: COLOR[m.area],
    symbols: m.symbols,
    value: Math.max(m.symbols, 1),
    isTest: mod.includes('__tests__'),
    title: `${mod}\n${m.symbols} symbols\n${kindStr || '—'}\n→ out ${outDeg.get(mod) || 0} · in ${inDeg.get(mod) || 0}`,
  });
}
const visEdges = [];
for (const [key, p] of pairs) {
  const [from, to] = key.split(' ');
  const kindStr = Object.entries(p.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
  visEdges.push({ from, to, weight: p.weight, title: `${from} → ${to}\n${p.weight} refs (${kindStr})` });
}

const meta = {
  files: db.prepare("SELECT COUNT(*) c FROM nodes WHERE kind='file'").get().c,
  nodes: db.prepare('SELECT COUNT(*) c FROM nodes').get().c,
  edges: db.prepare('SELECT COUNT(*) c FROM edges').get().c,
  modules: visNodes.length,
  modEdges: visEdges.length,
};
db.close();

const PAYLOAD = JSON.stringify({ nodes: visNodes, edges: visEdges, colors: COLOR, meta });

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>CodeGraph — module map</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
  :root { --bg:#0b0f17; --panel:#141b2b; --ink:#e6edf6; --muted:#8b9bb4; --line:#1f2a3d; }
  * { box-sizing:border-box; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--ink);
    font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  #net { position:fixed; inset:0; }
  #panel { position:fixed; top:14px; left:14px; width:300px; background:var(--panel);
    border:1px solid var(--line); border-radius:12px; padding:14px 16px; z-index:5;
    box-shadow:0 10px 40px rgba(0,0,0,.5); max-height:calc(100vh - 28px); overflow:auto; }
  h1 { font-size:15px; margin:0 0 2px; }
  .sub { color:var(--muted); font-size:11px; margin-bottom:12px; }
  .stat { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
  .stat b { background:#1d2740; border:1px solid var(--line); border-radius:7px;
    padding:3px 8px; font-weight:600; font-size:11px; }
  .stat span { color:var(--muted); font-weight:400; }
  label.row { display:flex; align-items:center; gap:8px; margin:8px 0; cursor:pointer; }
  input[type=search]{ width:100%; padding:7px 9px; border-radius:8px; border:1px solid var(--line);
    background:#0e1422; color:var(--ink); margin-bottom:6px; }
  input[type=range]{ width:100%; accent-color:#4f9cf9; }
  .legend { margin-top:12px; border-top:1px solid var(--line); padding-top:10px; }
  .lg { display:flex; align-items:center; gap:7px; margin:4px 0; cursor:pointer; user-select:none; }
  .lg.off { opacity:.32; }
  .dot { width:11px; height:11px; border-radius:3px; flex:none; }
  .lg .n { margin-left:auto; color:var(--muted); font-size:11px; }
  .hint { color:var(--muted); font-size:10.5px; margin-top:12px; border-top:1px solid var(--line); padding-top:8px; }
  #info { position:fixed; bottom:14px; left:14px; width:300px; background:var(--panel);
    border:1px solid var(--line); border-radius:12px; padding:12px 16px; z-index:5; display:none; }
  #info h2 { font-size:13px; margin:0 0 6px; word-break:break-all; }
  #info .k { color:var(--muted); }
  button.sm { background:#1d2740; color:var(--ink); border:1px solid var(--line);
    border-radius:7px; padding:5px 9px; cursor:pointer; font-size:11px; }
</style></head><body>
<div id="net"></div>
<div id="panel">
  <h1>CodeGraph module map</h1>
  <div class="sub">module-level dependency map · directories as nodes, calls+imports as edges</div>
  <div class="stat" id="stat"></div>
  <input type="search" id="q" placeholder="Filter modules (e.g. orders, billing, auth)…" autocomplete="off"/>
  <label class="row"><input type="checkbox" id="tests"/> show <code>__tests__</code> dirs</label>
  <label class="row"><input type="checkbox" id="physics" checked/> physics (drift)</label>
  <div class="row" style="display:block">
    <div style="color:var(--muted);margin-bottom:3px">min edge weight: <b id="thv">3</b></div>
    <input type="range" id="thr" min="1" max="40" value="3"/>
  </div>
  <button class="sm" id="fit">Fit to screen</button>
  <div class="legend" id="legend"></div>
  <div class="hint">Click a node to inspect. Drag to reposition. Scroll to zoom. Double-click empty space to release a pinned node.</div>
</div>
<div id="info"></div>
<script>
const DATA = ${PAYLOAD};
const S = document.getElementById('stat');
S.innerHTML = [
  ['files', DATA.meta.files],['symbols', DATA.meta.nodes],['edges', DATA.meta.edges],
  ['modules', DATA.meta.modules],['links', DATA.meta.modEdges],
].map(([k,v])=>'<b>'+v.toLocaleString()+' <span>'+k+'</span></b>').join('');

const areaCounts = {};
DATA.nodes.forEach(n=>{ areaCounts[n.area]=(areaCounts[n.area]||0)+1; });
const areaOff = new Set();
const L = document.getElementById('legend');
L.innerHTML = Object.entries(DATA.colors).filter(([a])=>areaCounts[a]).map(([a,c])=>
  '<div class="lg" data-a="'+a+'"><span class="dot" style="background:'+c+'"></span>'+a+'<span class="n">'+areaCounts[a]+'</span></div>').join('');

const allNodes = new vis.DataSet(DATA.nodes.map(n=>({
  id:n.id, label:n.label, title:n.title, value:n.value,
  color:{background:n.color, border:'#0b0f17', highlight:{background:n.color,border:'#fff'}},
  font:{color:'#dbe6f5', size:12, strokeWidth:3, strokeColor:'#0b0f17'},
  _area:n.area, _test:n.isTest, _sym:n.symbols, _path:n.fullPath
})));
const allEdges = new vis.DataSet(DATA.edges.map((e,i)=>({
  id:i, from:e.from, to:e.to, value:e.weight, title:e.title, _w:e.weight,
  arrows:{to:{enabled:true,scaleFactor:.45}},
  color:{color:'rgba(120,140,170,.22)', highlight:'#4f9cf9', hover:'rgba(160,190,230,.6)'},
  smooth:{type:'continuous'}
})));

let threshold=3, showTests=false, q='';
const nodesView = new vis.DataView(allNodes, { filter:n=>passNode(n) });
const edgesView = new vis.DataView(allEdges, { filter:e=>passEdge(e) });

function passNode(n){
  if(!showTests && n._test) return false;
  if(areaOff.has(n._area)) return false;
  if(q && !n._path.toLowerCase().includes(q)) return false;
  return true;
}
function passEdge(e){
  if(e._w < threshold) return false;
  const f=allNodes.get(e.from), t=allNodes.get(e.to);
  return f&&t&&passNode(f)&&passNode(t);
}

const net = new vis.Network(document.getElementById('net'),
  { nodes:nodesView, edges:edgesView },
  {
    nodes:{ shape:'dot', scaling:{ min:6, max:46, label:{enabled:true,min:10,max:22} } },
    edges:{ scaling:{ min:.4, max:7 }, selectionWidth:2 },
    physics:{ stabilization:{iterations:220}, barnesHut:{ gravitationalConstant:-9000,
      springLength:130, springConstant:.035, damping:.5, avoidOverlap:.25 } },
    interaction:{ hover:true, tooltipDelay:120, multiselect:true, navigationButtons:false },
  });

function refresh(){ nodesView.refresh(); edgesView.refresh(); }
document.getElementById('thr').oninput=e=>{ threshold=+e.target.value; document.getElementById('thv').textContent=threshold; refresh(); };
document.getElementById('tests').onchange=e=>{ showTests=e.target.checked; refresh(); };
document.getElementById('physics').onchange=e=>{ net.setOptions({physics:{enabled:e.target.checked}}); };
document.getElementById('q').oninput=e=>{ q=e.target.value.trim().toLowerCase(); refresh(); };
document.getElementById('fit').onclick=()=>net.fit({animation:true});
L.querySelectorAll('.lg').forEach(el=>el.onclick=()=>{
  const a=el.dataset.a;
  if(areaOff.has(a)){areaOff.delete(a);el.classList.remove('off');}
  else{areaOff.add(a);el.classList.add('off');}
  refresh();
});

const info=document.getElementById('info');
net.on('click', p=>{
  if(!p.nodes.length){ info.style.display='none'; return; }
  const n=allNodes.get(p.nodes[0]);
  const ins=allEdges.get().filter(e=>e.to===n.id).sort((a,b)=>b._w-a._w).slice(0,6);
  const outs=allEdges.get().filter(e=>e.from===n.id).sort((a,b)=>b._w-a._w).slice(0,6);
  const fmt=arr=>arr.map(e=>'<div class="k">· '+(e.from===n.id?e.to:e.from)+' <b>('+e._w+')</b></div>').join('')||'<div class="k">—</div>';
  info.innerHTML='<h2>'+n._path+'</h2>'+
    '<div class="k">'+n._sym+' symbols · '+n._area+'</div>'+
    '<div style="margin-top:8px"><b>Depends on →</b>'+fmt(outs)+'</div>'+
    '<div style="margin-top:8px"><b>← Depended on by</b>'+fmt(ins)+'</div>';
  info.style.display='block';
});
net.on('doubleClick', p=>{ if(p.nodes.length) net.unselectAll(); });
</script></body></html>`;

writeFileSync(OUT, html);
console.log('Modules:', visNodes.length, '| cross-module links:', visEdges.length);
console.log('Wrote', OUT);
