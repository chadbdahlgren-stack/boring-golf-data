// Builds Boring Golf's course files from OpenStreetMap golf features.
//
//   node build.mjs <golf.geojsonseq> <output folder>
//
// Input is `osmium export -f geojsonseq -a type,id` of a file that holds only
// leisure=golf_course areas and golf=hole / golf=green / golf=tee ways (see the workflow).
// Output: one small JSON file per course that has mapped holes, at
//   <out>/c/w<way id>.json  or  <out>/c/r<relation id>.json
// plus <out>/index.json with counts. Map data © OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const [, , input, outDir] = process.argv;
if (!input || !outDir) {
  console.error('usage: node build.mjs <golf.geojsonseq> <output folder>');
  process.exit(1);
}

const GRID = 0.05; // degrees per spatial-index cell
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

function meters(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round = (p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
// GeoJSON is [lon, lat]; we store [lat, lon] like the app.
const latLon = (c) => [c[1], c[0]];

function centroid(ring) {
  let la = 0;
  let lo = 0;
  for (const p of ring) {
    la += p[0];
    lo += p[1];
  }
  return [la / ring.length, lo / ring.length];
}

function inside(p, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[0] > p[0] !== b[0] > p[0] && p[1] < ((b[1] - a[1]) * (p[0] - a[0])) / (b[0] - a[0]) + a[1]) ins = !ins;
  }
  return ins;
}

function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][1] + ring[i][1]) * (ring[j][0] - ring[i][0]);
  return Math.abs(s / 2);
}

/** Outer rings of a Polygon / MultiPolygon, or a closed LineString, as [lat, lon] arrays. */
function outerRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0].map(latLon)];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((poly) => poly[0].map(latLon));
  if (geom.type === 'LineString') {
    const c = geom.coordinates;
    const closed = c.length > 3 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
    return closed ? [c.map(latLon)] : [];
  }
  return [];
}

const courses = new Map(); // key -> { key, name, rings, area, holes: [], greens: [] }
const grid = new Map(); // "x:y" -> course keys
const holeLines = [];
const greens = [];
const tees = [];
const areas = [];

/** Matches areaKind in the app (src/lib/osm.ts). */
function areaKind(p) {
  const g = p.golf;
  if (['fairway', 'rough', 'bunker', 'green', 'tee'].includes(g)) return g;
  if (g === 'water_hazard' || g === 'lateral_water_hazard' || p.natural === 'water') return 'water';
  if (g === 'cartpath' || g === 'path') return 'cartpath';
  return undefined;
}

const cell = (lat, lon) => `${Math.floor(lat / GRID)}:${Math.floor(lon / GRID)}`;

function indexCourse(c) {
  const lats = c.rings.flat().map((p) => p[0]);
  const lons = c.rings.flat().map((p) => p[1]);
  for (let y = Math.floor(Math.min(...lats) / GRID); y <= Math.floor(Math.max(...lats) / GRID); y++) {
    for (let x = Math.floor(Math.min(...lons) / GRID); x <= Math.floor(Math.max(...lons) / GRID); x++) {
      const k = `${y}:${x}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c.key);
    }
  }
}

/** The smallest course whose outline contains the point (handles courses inside resorts). */
function courseAt(p) {
  let best;
  for (const key of grid.get(cell(p[0], p[1])) ?? []) {
    const c = courses.get(key);
    if (c.rings.some((r) => inside(p, r)) && (!best || c.area < best.area)) best = c;
  }
  return best;
}

const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
let lines = 0;
for await (let line of rl) {
  line = line.replace(/^\x1e/, '').trim();
  if (!line) continue;
  lines++;
  const f = JSON.parse(line);
  const p = f.properties ?? {};
  const type = p['@type'];
  const id = p['@id'];
  if (p.leisure === 'golf_course' && (type === 'way' || type === 'relation')) {
    const rings = outerRings(f.geometry);
    if (!rings.length) continue;
    const key = `${type === 'way' ? 'w' : 'r'}${id}`;
    const c = { key, name: p.name ?? '', rings, area: rings.reduce((s, r) => s + ringArea(r), 0), holes: [], greens: [] };
    courses.set(key, c);
    indexCourse(c);
  } else if (p.golf === 'hole' && f.geometry?.type === 'LineString') {
    holeLines.push({ path: f.geometry.coordinates.map(latLon), tags: p });
  } else if (p.golf === 'green') {
    const [ring] = outerRings(f.geometry);
    if (ring) greens.push({ outline: ring, center: centroid(ring) });
  }
  if (p.golf === 'tee') {
    // Tee boxes: just the middle of each. The app works out which hole and tees each one is.
    const [ring] = outerRings(f.geometry);
    if (ring) tees.push(centroid(ring));
  }
  // Course features the app paints in color (greens and tees too, as shapes).
  const kind = areaKind(p);
  if (kind) {
    const pts =
      kind === 'cartpath' && f.geometry?.type === 'LineString' ? f.geometry.coordinates.map(latLon) : outerRings(f.geometry)[0];
    if (pts && pts.length >= 2) areas.push({ k: kind, p: pts });
  }
}

for (const h of holeLines) courseAt(h.path[Math.floor(h.path.length / 2)])?.holes.push(h);
for (const g of greens) courseAt(g.center)?.greens.push(g);
for (const t of tees) {
  const c = courseAt(t);
  if (c) (c.tees ??= []).push(t);
}
for (const a of areas) {
  const c = courseAt(a.p[Math.floor(a.p.length / 2)]);
  if (c) (c.areas ??= []).push({ k: a.k, p: a.p.map(round) });
}

fs.mkdirSync(path.join(outDir, 'c'), { recursive: true });
let written = 0;
let holeCount = 0;
for (const c of courses.values()) {
  const byNumber = new Map();
  for (const h of c.holes) {
    const n = parseInt(h.tags.ref ?? '', 10);
    if (!n || n < 1 || n > 36 || byNumber.has(n)) continue;
    const end = h.path[h.path.length - 1];
    let green = end;
    let outline;
    let bestD = 70; // meters: snap the hole's end to the nearest mapped green
    for (const g of c.greens) {
      const d = meters(end, g.center);
      if (d < bestD) {
        bestD = d;
        green = g.center;
        outline = g.outline;
      }
    }
    const par = parseInt(h.tags.par ?? '', 10);
    const hcp = parseInt(h.tags.handicap ?? '', 10);
    const dist = parseFloat(h.tags.dist ?? '');
    byNumber.set(n, {
      n,
      par: par >= 3 && par <= 6 ? par : 0,
      ...(hcp > 0 ? { hcp } : {}),
      ...(dist > 0 ? { yd: Math.round(dist * 1.0936133) } : {}),
      path: h.path.map(round),
      green: round(green),
      ...(outline ? { outline: outline.map(round) } : {}),
    });
  }
  if (!byNumber.size) continue;
  const holes = [...byNumber.values()].sort((a, b) => a.n - b.n);
  fs.writeFileSync(
    path.join(outDir, 'c', `${c.key}.json`),
    JSON.stringify({
      v: 1,
      key: c.key,
      name: c.name,
      holes,
      ...(c.tees ? { tees: c.tees.map(round) } : {}),
      ...(c.areas ? { areas: c.areas } : {}),
    }),
  );
  written++;
  holeCount += holes.length;
}

fs.writeFileSync(
  path.join(outDir, 'index.json'),
  JSON.stringify({ v: 1, generated: new Date().toISOString(), courses: written, holes: holeCount, source: 'OpenStreetMap contributors (ODbL)' }),
);
fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
// Static pages served alongside the data (e.g. plan.html, which opens shared practice plans).
const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
if (fs.existsSync(staticDir)) fs.cpSync(staticDir, outDir, { recursive: true });
console.log(`read ${lines} features: ${courses.size} courses, ${holeLines.length} holes, ${greens.length} greens, ${tees.length} tee boxes`);
console.log(`wrote ${written} course files with ${holeCount} holes to ${outDir}`);
