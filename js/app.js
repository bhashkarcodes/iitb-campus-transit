"use strict";
/* ===========================================================================
   IITB TRANSIT - application
   =========================================================================== */

/* Sections, numbered to match the comment headers below:
     2. Geometry helpers
     3. Road graph + Dijkstra routing
     4. Map setup and landmark layers
     5. Vehicle fleet simulation
     6. Route planning UI
     7. Nearest-vehicle search
     8. Layer toggles + boot

   Section 1 is the campus data, which lives in campus-data.js and must
   load before this file. */

/* ---------------------------------------------------------------------------
   2. GEOMETRY HELPERS
--------------------------------------------------------------------------- */
const R_EARTH = 6371000;
const rad = d => d * Math.PI / 180;

/** Great-circle distance in metres. */
function haversine(a, b){
  const dLat = rad(b[0]-a[0]), dLng = rad(b[1]-a[1]);
  const s = Math.sin(dLat/2)**2 +
            Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLng/2)**2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}
/** Total length of a polyline, metres. */
const pathLength = pts => pts.reduce((m,p,i) => i ? m + haversine(pts[i-1],p) : 0, 0);
/** Linear interpolation between two coordinates. */
const lerp = (a,b,t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
/** Compass bearing a -> b, degrees. */
function bearing(a,b){
  const y = Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0]))*Math.sin(rad(b[0])) -
            Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1]));
  return (Math.atan2(y,x)*180/Math.PI + 360) % 360;
}
const fmtKm  = m => m < 950 ? Math.round(m) + " m" : (m/1000).toFixed(2) + " km";
const fmtMin = m => m < 1 ? "<1 min" : Math.round(m) + " min";
/** Travel time in minutes for a distance in metres at a km/h speed. */
const minutesFor = (metres, kmh) => (metres/1000) / kmh * 60;

/* ---------------------------------------------------------------------------
   3. ROAD GRAPH + DIJKSTRA
   Nodes are de-duplicated by rounded coordinate, so roads that share a
   landmark automatically connect there.
--------------------------------------------------------------------------- */
const key = p => p[0].toFixed(5) + "," + p[1].toFixed(5);
const GRAPH = new Map();   // key -> { pt, edges: Map(key -> metres) }

function node(p){
  const k = key(p);
  if (!GRAPH.has(k)) GRAPH.set(k, { pt:[+p[0], +p[1]], edges:new Map() });
  return k;
}
function link(a, b){
  const ka = node(a), kb = node(b);
  if (ka === kb) return;
  const w = haversine(GRAPH.get(ka).pt, GRAPH.get(kb).pt);
  GRAPH.get(ka).edges.set(kb, w);
  GRAPH.get(kb).edges.set(ka, w);
}
ROADS.forEach(r => { for (let i = 1; i < r.pts.length; i++) link(r.pts[i-1], r.pts[i]); });

/** Graph node closest to an arbitrary coordinate. */
function nearestNode(pt){
  let best = null, bd = Infinity;
  for (const [k, n] of GRAPH){
    const d = haversine(pt, n.pt);
    if (d < bd){ bd = d; best = k; }
  }
  return best;
}

/**
 * Dijkstra over the road graph.
 * @param {string} src node key
 * @param {string} dst node key
 * @param {Set<string>} [penalise] undirected edge ids ("a|b" sorted) to weight up
 * @returns {{keys:string[], pts:number[][], dist:number}|null}
 */
function shortestPath(src, dst, penalise){
  const PENALTY = 3.2;
  const dist = new Map(), prev = new Map(), seen = new Set();
  for (const k of GRAPH.keys()) dist.set(k, Infinity);
  dist.set(src, 0);

  while (true){
    let u = null, ud = Infinity;
    for (const [k, d] of dist) if (!seen.has(k) && d < ud){ ud = d; u = k; }
    if (u === null || u === dst) break;
    seen.add(u);
    for (const [v, w] of GRAPH.get(u).edges){
      if (seen.has(v)) continue;
      const eid = u < v ? u + "|" + v : v + "|" + u;
      const cost = ud + w * (penalise && penalise.has(eid) ? PENALTY : 1);
      if (cost < dist.get(v)){ dist.set(v, cost); prev.set(v, u); }
    }
  }
  if (!isFinite(dist.get(dst))) return null;

  const keys = [];
  for (let k = dst; k !== undefined; k = prev.get(k)){
    keys.unshift(k);
    if (k === src) break;
  }
  if (keys[0] !== src) return null;
  const pts = keys.map(k => GRAPH.get(k).pt);
  return { keys, pts, dist: pathLength(pts) };
}

/** Undirected edge ids along a node path. */
function edgeIds(keys){
  const s = new Set();
  for (let i = 1; i < keys.length; i++){
    const a = keys[i-1], b = keys[i];
    s.add(a < b ? a + "|" + b : b + "|" + a);
  }
  return s;
}

/** Route through an ordered list of landmark ids (used for patrol loops). */
function routeThrough(ids){
  let pts = [];
  for (let i = 1; i < ids.length; i++){
    const r = shortestPath(nearestNode(P(ids[i-1])), nearestNode(P(ids[i])));
    if (!r) continue;
    pts = pts.length ? pts.concat(r.pts.slice(1)) : r.pts.slice();
  }
  return pts;
}

/* ---------------------------------------------------------------------------
   4. MAP SETUP
--------------------------------------------------------------------------- */
const map = L.map('map', { zoomControl:false, attributionControl:true })
             .setView(CAMPUS_CENTER, CAMPUS_ZOOM);
L.control.zoom({ position:'bottomright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:19,
  /* tiles, roads and landmark positions all come from OSM, ODbL licensed */
  attribution:'&copy; OpenStreetMap contributors'
}).addTo(map);

const layers = {
  academic : L.layerGroup().addTo(map),
  hostels  : L.layerGroup().addTo(map),
  gates    : L.layerGroup().addTo(map),
  autos    : L.layerGroup().addTo(map),
  buggies  : L.layerGroup().addTo(map),
  roads    : L.layerGroup(),
  routes   : L.layerGroup().addTo(map),
  markers  : L.layerGroup().addTo(map)
};

/* academic zone shading */
L.polygon(ACADEMIC_ZONE, {
  color:'#1f6feb', weight:1.5, opacity:.5, fillColor:'#1f6feb', fillOpacity:.07
}).addTo(layers.academic);

/* road network (hidden by default) */
ROADS.forEach(r => {
  L.polyline(r.pts, { color:'#8b94a3', weight:3, opacity:.75, dashArray:'1 6',
                      lineCap:'round' })
   .bindTooltip(r.name, { sticky:true }).addTo(layers.roads);
});

/* landmark pins */
const initials = l => {
  if (l.cat === 'hostel') return l.name.replace('Hostel ', 'H');
  const words = l.name.replace(/\(.*\)/, '').trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0,2)).toUpperCase();
};
LANDMARKS.forEach(l => {
  const cls = 'pin ' + l.cat + (l.star ? ' star' : '');
  const m = L.marker([l.lat, l.lng], {
    icon: L.divIcon({ className:'', html:`<div class="${cls}">${initials(l)}</div>`,
                      iconSize:[l.star?30:26, l.star?30:26],
                      iconAnchor:[l.star?15:13, l.star?15:13] }),
    title: l.name
  });
  m.bindPopup(`<div class="pop-h"><b>${l.name}</b></div>
    <div class="pop-row"><span>Category</span><span>${l.cat}</span></div>
    <div class="pop-row"><span>Coordinates</span><span>${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}</span></div>
    ${l.star ? '<div class="pop-row"><span>Note</span><span>Highlighted</span></div>' : ''}`);
  const target = l.cat === 'hostel' ? layers.hostels
               : l.cat === 'gate'   ? layers.gates
               : layers.academic;
  m.addTo(target);
});

/* ---------------------------------------------------------------------------
   5. VEHICLE FLEET SIMULATION
--------------------------------------------------------------------------- */
const PATROLS = {
  /* Autos work the paying corridors: the gates and the academic area. Buggies
     run the hostel feeders. Each list is a sequence of landmarks; the router
     fills in the roads between them. */
  auto: [
    ['main-gate','h10','kresit','lhc','main-bldg','library'],
    ['main-gate','main-bldg','convo','sac','gymkhana','h11'],
    ['y-point','lhc','kresit','main-bldg','library','sac'],
    ['h16','h15','h1','h2','library','main-bldg','convo'],
    ['h12','h13','h14','h9','h5','h4','h3'],
    ['lakeside','main-gate','h10','kresit','lhc'],
    ['h7','h8','h11','gymkhana','main-bldg','main-gate']
  ],
  buggy: [
    ['h16','h15','h1','gymkhana','library','main-bldg','lhc'],
    ['h12','h14','h9','h5','h4','h3','h2','h1'],
    ['main-gate','h10','kresit','lhc','main-bldg','convo'],
    ['h17','h18','h6','h9','h5','h11','gymkhana','sac']
  ]
};

const STATUSES = ['Available','En Route','Full'];
const rnd  = (a,b) => a + Math.random()*(b-a);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

const fleet = [];

function makeVehicle(type, n){
  const loops = PATROLS[type];
  const pts = routeThrough(loops[n % loops.length]);
  if (pts.length < 2) return null;

  const cap = type === 'buggy' ? 6 : 3;
  const v = {
    id: type === 'auto' ? `IITB Auto #${String(n+1).padStart(2,'0')}`
                        : `Campus Buggy #${String(n+1).padStart(2,'0')}`,
    type, path: pts,
    seg: Math.floor(Math.random()*(pts.length-1)),
    t: Math.random(),
    dir: Math.random() < 0.5 ? 1 : -1,
    speed: type === 'auto' ? rnd(16,26) : rnd(10,16),
    status: pick(STATUSES),
    charge: type === 'buggy' ? rnd(35,100) : rnd(20,95),
    cap, seats: 0,
    marker: null
  };
  v.seats = v.status === 'Full' ? cap
          : v.status === 'En Route' ? Math.max(1, Math.round(rnd(1, cap-1)))
          : Math.round(rnd(0, Math.max(0, cap-2)));

  const pos = lerp(v.path[v.seg], v.path[v.seg+1], v.t);
  v.marker = L.marker(pos, { icon: vehicleIcon(v, 0), zIndexOffset:500, title:v.id });
  v.marker.bindPopup(popupHTML(v), { closeButton:true });
  v.marker.on('popupopen', () => { v.marker.setPopupContent(popupHTML(v)); });
  v.marker.addTo(type === 'auto' ? layers.autos : layers.buggies);
  return v;
}

const GLYPH = {
  auto:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 16V11a5 5 0 0 1 5-5h3l4 5v5" stroke="#fff" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="8" cy="17.5" r="2.2" stroke="#fff" stroke-width="1.8"/>
    <circle cx="16.5" cy="17.5" r="2.2" stroke="#fff" stroke-width="1.8"/></svg>`,
  buggy:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 7h11v8H4z" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/>
    <path d="M15 10h3l2 3v2h-5" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/>
    <circle cx="7.5" cy="17.2" r="1.9" stroke="#fff" stroke-width="1.7"/>
    <circle cx="16.5" cy="17.2" r="1.9" stroke="#fff" stroke-width="1.7"/></svg>`
};

function vehicleIcon(v, hdg, selected){
  return L.divIcon({
    className:'',
    html:`<div class="veh ${v.type}${selected ? ' sel':''}">
            <i class="heading" style="transform:rotate(${hdg}deg)"></i>
            <div class="body">${GLYPH[v.type]}</div>
          </div>`,
    iconSize:[34,34], iconAnchor:[17,17], popupAnchor:[0,-16]
  });
}

function popupHTML(v){
  const cls = v.status.toLowerCase().replace(' ','');
  const col = v.type === 'auto' ? 'var(--auto)' : 'var(--buggy)';
  const lvlLabel = v.type === 'buggy' ? 'Battery' : 'Fuel';
  const lvlCol = v.charge > 50 ? 'var(--ok)' : v.charge > 20 ? 'var(--warn)' : 'var(--bad)';
  return `
    <div class="pop-h"><span class="swatch" style="background:${col}"></span>
      <div><b>${v.id}</b>
        <span class="pop-type">${v.type === 'auto' ? 'Auto-rickshaw · point to point'
                                                   : 'Electric buggy · shared shuttle'}</span></div></div>
    <div class="pop-row"><span>Status</span><span class="badge ${cls}">${v.status}</span></div>
    <div class="pop-row"><span>Speed</span><span>${v.speed.toFixed(0)} km/h</span></div>
    <div class="pop-row"><span>Occupancy</span><span>${v.seats}/${v.cap} seats</span></div>
    <div class="pop-row"><span>${lvlLabel}</span><span>${Math.round(v.charge)}%</span></div>
    <div class="bar"><i style="width:${Math.max(3,v.charge)}%;background:${lvlCol}"></i></div>`;
}

/** Move a vehicle `metres` along its path, bouncing at either end. */
function advance(v, metres){
  let left = metres;
  let guard = 0;
  while (left > 0 && guard++ < 500){
    const a = v.path[v.seg], b = v.path[v.seg+1];
    const segLen = Math.max(0.5, haversine(a,b));
    const remain = v.dir > 0 ? (1 - v.t) * segLen : v.t * segLen;
    if (left < remain){
      v.t += v.dir * (left / segLen);
      left = 0;
    } else {
      left -= remain;
      if (v.dir > 0){
        v.seg++;
        v.t = 0;
        if (v.seg >= v.path.length - 1){ v.seg = v.path.length - 2; v.t = 1; v.dir = -1; }
      } else {
        v.seg--;
        v.t = 1;
        if (v.seg < 0){ v.seg = 0; v.t = 0; v.dir = 1; }
      }
    }
  }
  v.t = Math.min(1, Math.max(0, v.t));
  return lerp(v.path[v.seg], v.path[v.seg+1], v.t);
}

let selectedId = null;
let lastFrame = performance.now();

function animate(now){
  const dt = Math.min(0.25, (now - lastFrame)/1000);
  lastFrame = now;
  fleet.forEach(v => {
    const factor = v.status === 'Full' ? 0.85 : 1;
    const pos = advance(v, (v.speed*1000/3600) * dt * factor);
    v.marker.setLatLng(pos);
    const a = v.path[v.seg], b = v.path[v.seg+1];
    const hdg = v.dir > 0 ? bearing(a,b) : bearing(b,a);
    if (Math.abs((v._hdg ?? -999) - hdg) > 4 || v._sel !== (v.id === selectedId)){
      v._hdg = hdg; v._sel = (v.id === selectedId);
      v.marker.setIcon(vehicleIcon(v, hdg, v._sel));
    }
  });
  requestAnimationFrame(animate);
}

/* telemetry refresh — status, charge and speed drift every 2.5 s */
function telemetryTick(){
  fleet.forEach(v => {
    if (Math.random() < 0.22){
      v.status = pick(STATUSES);
      v.seats = v.status === 'Full' ? v.cap
              : v.status === 'En Route' ? Math.max(1, Math.round(rnd(1, v.cap-1)))
              : Math.round(rnd(0, Math.max(0, v.cap-2)));
    }
    v.charge = Math.max(6, v.charge - rnd(0, 0.35));
    /* campus speed limit is 25 km/h, so autos drift inside 10-24 and buggies,
       which are slower by design, inside 6-16 */
    v.speed  = Math.min(v.type==='auto'?24:16,
               Math.max(v.type==='auto'?10:6, v.speed + rnd(-2.5, 2.5)));
    if (v.marker.isPopupOpen()) v.marker.setPopupContent(popupHTML(v));
  });
  updateCounts();
}

function updateCounts(){
  const a = fleet.filter(v => v.type === 'auto');
  const b = fleet.filter(v => v.type === 'buggy');
  const free = arr => arr.filter(v => v.status === 'Available').length;
  document.getElementById('cAuto').textContent      = a.length;
  document.getElementById('cAutoFree').textContent  = free(a);
  document.getElementById('cBuggy').textContent     = b.length;
  document.getElementById('cBuggyFree').textContent = free(b);
  document.getElementById('nAutos').textContent     = a.length;
  document.getElementById('nBuggies').textContent   = b.length;
}

/* ---------------------------------------------------------------------------
   6. ROUTE PLANNING UI
--------------------------------------------------------------------------- */
const $ = id => document.getElementById(id);
const els = {
  origin:$('origin'), dest:$('dest'), summary:$('summary'),
  sumDist:$('sumDist'), sumTag:$('sumTag'), tWalk:$('tWalk'), tAuto:$('tAuto'),
  tBuggy:$('tBuggy'), tDoor:$('tDoor'), altNote:$('altNote'), altDist:$('altDist'),
  hint:$('hint')
};

/* populate the two dropdowns, grouped by category */
(function fillSelectors(){
  const groups = [
    ['Gates',     'gate'],
    ['Academic',  'academic'],
    ['Facilities','facility'],
    ['Hostels',   'hostel']
  ];
  [els.origin, els.dest].forEach(sel => {
    sel.innerHTML = '<option value="">Select a point…</option>';
    groups.forEach(([label, cat]) => {
      const g = document.createElement('optgroup');
      g.label = label;
      LANDMARKS.filter(l => l.cat === cat).forEach(l => {
        const o = document.createElement('option');
        o.value = l.id; o.textContent = l.name;
        g.appendChild(o);
      });
      sel.appendChild(g);
    });
  });
  els.origin.value = 'h16';
  els.dest.value   = 'lhc';
})();

let mode = 'auto';
let endpoints = { o:null, d:null };     // {pt, label}
let endMarkers = { o:null, d:null };
let pickMode = null;                    // 'o' | 'd' | null

function setEndpoint(which, pt, label){
  endpoints[which] = { pt, label };
  if (endMarkers[which]) layers.markers.removeLayer(endMarkers[which]);
  endMarkers[which] = L.marker(pt, {
    icon: L.divIcon({ className:'',
      html:`<div class="endpin ${which}"></div>`,
      iconSize:[18,18], iconAnchor:[9,9] }),
    title:(which === 'o' ? 'Pickup: ' : 'Drop: ') + label
  }).addTo(layers.markers);
}

function currentEndpoints(){
  const o = els.origin.value, d = els.dest.value;
  if (o) setEndpoint('o', P(o), BY_ID[o].name);
  if (d) setEndpoint('d', P(d), BY_ID[d].name);
  return endpoints.o && endpoints.d ? endpoints : null;
}

function clearRoutes(){ layers.routes.clearLayers(); }

function drawRoute(){
  const ends = currentEndpoints();
  if (!ends){ els.summary.hidden = true; return; }
  clearRoutes();

  const src = nearestNode(ends.o.pt), dst = nearestNode(ends.d.pt);
  const primary = shortestPath(src, dst);
  if (!primary){ els.summary.hidden = true; return; }

  /* The two endpoints are rarely standing on the road itself, so the walk-in
     legs are part of the trip and are counted in every distance below. When
     both endpoints hang off the same road node the legs are the whole trip. */
  const legs = haversine(ends.o.pt, primary.pts[0]) +
               haversine(ends.d.pt, primary.pts.at(-1));
  const primaryDist = primary.dist + legs;

  /* alternative: penalise the primary edges and solve again */
  const alt = shortestPath(src, dst, edgeIds(primary.keys));
  const altDistTotal = alt ? alt.dist + legs : null;
  const altIsDistinct = alt && alt.pts.length > 1 &&
                        Math.abs(alt.dist - primary.dist) > 40;

  if (altIsDistinct){
    L.polyline(alt.pts, { color:'var(--route-alt)', weight:5, opacity:.65,
                          lineCap:'round', lineJoin:'round' })
     .bindTooltip('Alternative · ' + fmtKm(altDistTotal), { sticky:true })
     .addTo(layers.routes);
  }

  /* casing + animated primary line */
  if (primary.pts.length > 1){
    L.polyline(primary.pts, { color:'#fff', weight:10, opacity:.9,
                              lineCap:'round', lineJoin:'round' }).addTo(layers.routes);
    L.polyline(primary.pts, { color:'var(--route)', weight:6, opacity:.95,
                              lineCap:'round', lineJoin:'round',
                              className:'route-anim' })
     .bindTooltip('Optimised route · ' + fmtKm(primaryDist), { sticky:true })
     .addTo(layers.routes);
  }

  /* short connectors from the actual endpoints to the road network */
  [[ends.o.pt, primary.pts[0]], [ends.d.pt, primary.pts.at(-1)]].forEach(pair => {
    if (haversine(pair[0], pair[1]) > 8)
      L.polyline(pair, { color:'var(--route)', weight:3, opacity:.6, dashArray:'2 7' })
       .addTo(layers.routes);
  });

  /* leave room for whichever edge the panel is docked to */
  const narrow = window.innerWidth <= 760;
  map.fitBounds(L.latLngBounds([ends.o.pt, ...primary.pts, ends.d.pt]).pad(0.35),
                narrow ? { paddingTopLeft:[24, 70],
                           paddingBottomRight:[24, Math.round(window.innerHeight*0.5)],
                           maxZoom:17 }
                       : { paddingTopLeft:[360, 40], maxZoom:17 });
  showSummary(primaryDist, altIsDistinct ? altDistTotal : null);
}

function showSummary(dist, altDist){
  const walk  = minutesFor(dist, SPEED.walk);
  const auto  = minutesFor(dist, SPEED.auto);
  const buggy = minutesFor(dist, SPEED.buggy);
  const ride  = mode === 'auto' ? auto : buggy;

  els.summary.hidden = false;
  els.sumDist.textContent = fmtKm(dist);
  els.sumTag.textContent  = mode === 'auto' ? 'Auto · optimised' : 'Buggy · fixed route';
  els.tWalk.textContent   = fmtMin(walk);
  els.tAuto.textContent   = fmtMin(auto);
  els.tBuggy.textContent  = fmtMin(buggy);
  els.tDoor.textContent   = fmtMin(ride + TYPICAL_WAIT_MIN);

  els.altNote.hidden = altDist === null;
  if (altDist !== null) els.altDist.textContent = fmtKm(altDist) + " · " + fmtMin(minutesFor(altDist, SPEED[mode]));

  els.hint.textContent = walk <= ride + TYPICAL_WAIT_MIN
    ? `Walking is faster door to door once the ${TYPICAL_WAIT_MIN} min typical wait is counted.`
    : `Door to door includes the ${TYPICAL_WAIT_MIN} min average wait measured in the campus survey.`;
}

/* ---------------------------------------------------------------------------
   7. NEAREST VEHICLE
--------------------------------------------------------------------------- */
function findNearest(){
  const ends = currentEndpoints();
  const from = ends ? ends.o.pt : CAMPUS_CENTER;
  const pool = fleet.filter(v => v.type === mode && v.status === 'Available');
  if (!pool.length){
    els.summary.hidden = false;
    els.hint.textContent = `No ${mode === 'auto' ? 'auto' : 'buggy'} is free right now. `
                         + `Statuses refresh every few seconds — try again shortly.`;
    return;
  }
  let best = null, bd = Infinity;
  pool.forEach(v => {
    const d = haversine(from, [v.marker.getLatLng().lat, v.marker.getLatLng().lng]);
    if (d < bd){ bd = d; best = v; }
  });
  selectedId = best.id;
  fleet.forEach(v => { v._sel = null; });     // force icon refresh next frame
  map.panTo(best.marker.getLatLng(), { animate:true });
  best.marker.openPopup();

  els.summary.hidden = false;
  els.hint.textContent = `${best.id} is ${fmtKm(bd)} away, about `
    + `${fmtMin(minutesFor(bd, SPEED[mode]))} to reach you.`;
}

/* ---------------------------------------------------------------------------
   8. EVENTS, LAYER TOGGLES, BOOT
--------------------------------------------------------------------------- */
els.origin.addEventListener('change', drawRoute);
els.dest.addEventListener('change', drawRoute);

function setMode(m){
  mode = m;
  $('modeAuto').setAttribute('aria-pressed', String(m === 'auto'));
  $('modeBuggy').setAttribute('aria-pressed', String(m === 'buggy'));
  if (!els.summary.hidden) drawRoute();
}
$('modeAuto').addEventListener('click',  () => setMode('auto'));
$('modeBuggy').addEventListener('click', () => setMode('buggy'));
$('findBtn').addEventListener('click', findNearest);
$('clearBtn').addEventListener('click', () => {
  clearRoutes(); layers.markers.clearLayers();
  endpoints = { o:null, d:null }; endMarkers = { o:null, d:null };
  els.origin.value = ''; els.dest.value = '';
  els.summary.hidden = true; selectedId = null;
  fleet.forEach(v => { v._sel = null; });
});

/* click-to-pick on the map */
function armPick(which, btn){
  pickMode = pickMode === which ? null : which;
  $('pickO').setAttribute('aria-pressed', String(pickMode === 'o'));
  $('pickD').setAttribute('aria-pressed', String(pickMode === 'd'));
  map.getContainer().style.cursor = pickMode ? 'crosshair' : '';
}
$('pickO').addEventListener('click', () => armPick('o'));
$('pickD').addEventListener('click', () => armPick('d'));

map.on('click', e => {
  if (!pickMode) return;
  const pt = [e.latlng.lat, e.latlng.lng];
  const snapped = GRAPH.get(nearestNode(pt)).pt;
  setEndpoint(pickMode, snapped, `Custom point (${snapped[0].toFixed(4)}, ${snapped[1].toFixed(4)})`);
  (pickMode === 'o' ? els.origin : els.dest).value = '';
  armPick(null);
  if (endpoints.o && endpoints.d){
    /* drawRoute() re-reads the selects, so route directly from stored endpoints */
    const primary = shortestPath(nearestNode(endpoints.o.pt), nearestNode(endpoints.d.pt));
    if (primary){
      clearRoutes();
      const alt = shortestPath(nearestNode(endpoints.o.pt), nearestNode(endpoints.d.pt),
                               edgeIds(primary.keys));
      const distinct = alt && Math.abs(alt.dist - primary.dist) > 40;
      if (distinct) L.polyline(alt.pts, { color:'var(--route-alt)', weight:5, opacity:.65 })
                     .addTo(layers.routes);
      L.polyline(primary.pts, { color:'#fff', weight:10, opacity:.9 }).addTo(layers.routes);
      L.polyline(primary.pts, { color:'var(--route)', weight:6, className:'route-anim' })
       .addTo(layers.routes);
      showSummary(primary.dist, distinct ? alt.dist : null);
    }
  }
});

/* layer checkboxes */
const toggle = (box, layer) => {
  box.addEventListener('change', () => {
    if (box.checked) map.addLayer(layer); else map.removeLayer(layer);
  });
};
toggle($('lAutos'),    layers.autos);
toggle($('lBuggies'),  layers.buggies);
toggle($('lHostels'),  layers.hostels);
toggle($('lAcademic'), layers.academic);
toggle($('lRoads'),    layers.roads);

/* build the fleet: 7 autos + 4 buggies = 11 active vehicles */
for (let i = 0; i < 7; i++){ const v = makeVehicle('auto', i);  if (v) fleet.push(v); }
for (let i = 0; i < 4; i++){ const v = makeVehicle('buggy', i); if (v) fleet.push(v); }

$('nHostels').textContent  = LANDMARKS.filter(l => l.cat === 'hostel').length;
$('nAcademic').textContent = LANDMARKS.filter(l => l.cat === 'academic').length;
updateCounts();
setInterval(telemetryTick, 2500);
requestAnimationFrame(animate);
drawRoute();

console.log(`IITB Transit ready — ${GRAPH.size} road nodes, ${fleet.length} vehicles.`);