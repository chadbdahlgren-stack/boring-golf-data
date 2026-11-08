// Builds Boring Golf's course files from OpenStreetMap golf features.
//
//   node build.mjs <golf.geojsonseq> <output folder>
//
// Input is `osmium export -f geojsonseq -a type,id` of a file that holds only
// leisure=golf_course areas, golf=hole / golf=green / golf=tee ways and state outlines
// (admin_level=4 boundaries; see the workflow).
// Output: one small JSON file per course that has mapped holes, at
//   <out>/c/w<way id>.json  or  <out>/c/r<relation id>.json
// plus <out>/index.json with counts, and maps-missing.json / .csv: every course without a
// proper map. Map data © OpenStreetMap contributors, ODbL.
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

/** [minLat, minLon, maxLat, maxLon] around some rings. */
function bbox(rings) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) {
    for (const [la, lo] of r) {
      b[0] = Math.min(b[0], la);
      b[1] = Math.min(b[1], lo);
      b[2] = Math.max(b[2], la);
      b[3] = Math.max(b[3], lo);
    }
  }
  return b;
}

/** Keeps at most ~4000 points of a ring: plenty to tell which state a course is in. */
function thin(ring) {
  const step = Math.ceil(ring.length / 4000);
  return step <= 1 ? ring : ring.filter((_, i) => i % step === 0);
}

const states = []; // { name, rings, box }

/** The state a point is in, from the state outlines in the input. */
function stateAt(p) {
  for (const s of states) {
    const [a, b, c, d] = s.box;
    if (p[0] < a || p[0] > c || p[1] < b || p[1] > d) continue;
    if (s.rings.some((r) => inside(p, r))) return s.name;
  }
  return undefined;
}

/**
 * Whether a course's holes make a proper map: all of 1–18, or all of 1–9 with nothing past 9.
 * Otherwise the hole numbers missing from the 9 or 18 it looks like.
 */
function mapGaps(numbers) {
  const has = new Set(numbers);
  const want = numbers.some((n) => n > 9) ? 18 : 9;
  const missing = [];
  for (let n = 1; n <= want; n++) if (!has.has(n)) missing.push(n);
  return missing;
}

const courses = new Map(); // key -> { key, name, rings, area, holes: [], greens: [] }
const grid = new Map(); // "x:y" -> course keys
const holeLines = [];
const greens = [];
const tees = [];

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
  if (p.boundary === 'administrative' && p.admin_level === '4' && p.name) {
    // A state's outline, to say which state each unmapped course is in.
    const rings = outerRings(f.geometry).map(thin);
    if (rings.length) states.push({ name: p.name, rings, box: bbox(rings) });
  } else if (p.leisure === 'golf_course' && (type === 'way' || type === 'relation')) {
    const rings = outerRings(f.geometry);
    if (!rings.length) continue;
    const key = `${type === 'way' ? 'w' : 'r'}${id}`;
    const c = { key, name: p.name ?? '', state: p['addr:state'], rings, area: rings.reduce((s, r) => s + ringArea(r), 0), holes: [], greens: [] };
    courses.set(key, c);
    indexCourse(c);
  } else if (p.golf === 'hole' && f.geometry?.type === 'LineString') {
    holeLines.push({ path: f.geometry.coordinates.map(latLon), tags: p });
  } else if (p.golf === 'green') {
    const [ring] = outerRings(f.geometry);
    if (ring) greens.push({ outline: ring, center: centroid(ring) });
  } else if (p.golf === 'tee') {
    // Tee boxes: just the middle of each. The app works out which hole and tees each one is.
    const [ring] = outerRings(f.geometry);
    if (ring) tees.push(centroid(ring));
  }
}

for (const h of holeLines) courseAt(h.path[Math.floor(h.path.length / 2)])?.holes.push(h);
for (const g of greens) courseAt(g.center)?.greens.push(g);
for (const t of tees) {
  const c = courseAt(t);
  if (c) (c.tees ??= []).push(t);
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
  c.numbers = [...byNumber.keys()];
  if (!byNumber.size) continue;
  const holes = [...byNumber.values()].sort((a, b) => a.n - b.n);
  fs.writeFileSync(
    path.join(outDir, 'c', `${c.key}.json`),
    JSON.stringify({ v: 1, key: c.key, name: c.name, holes, ...(c.tees ? { tees: c.tees.map(round) } : {}) }),
  );
  written++;
  holeCount += holes.length;
}

fs.writeFileSync(
  path.join(outDir, 'index.json'),
  JSON.stringify({ v: 1, generated: new Date().toISOString(), courses: written, holes: holeCount, source: 'OpenStreetMap contributors (ODbL)' }),
);
// Every course without a proper map (no holes, or gaps in its 9 or 18), with its state, so they
// can be listed and fixed. Courses without a name are counted but can't be searched in the app.
const missing = [];
let complete = 0;
for (const c of courses.values()) {
  const numbers = c.numbers ?? [];
  const gaps = numbers.length ? mapGaps(numbers) : [];
  if (numbers.length && !gaps.length) {
    complete++;
    continue;
  }
  const biggest = c.rings.reduce((a, r) => (ringArea(r) > ringArea(a) ? r : a));
  const at = round(centroid(biggest));
  missing.push({
    key: c.key,
    name: c.name,
    state: c.state && c.state.length > 2 ? c.state : (stateAt(at) ?? c.state ?? ''),
    at,
    holes: numbers.length,
    ...(numbers.length ? { missing: gaps } : {}),
  });
}
missing.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
const named = missing.filter((m) => m.name);
fs.writeFileSync(
  path.join(outDir, 'maps-missing.json'),
  JSON.stringify({
    v: 1,
    generated: new Date().toISOString(),
    courses: courses.size,
    complete,
    none: named.filter((m) => !m.holes).length,
    partial: named.filter((m) => m.holes).length,
    unnamed: missing.length - named.length,
    list: named,
  }),
);
const csv = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
fs.writeFileSync(
  path.join(outDir, 'maps-missing.csv'),
  [
    'State,Course,Holes mapped,Missing holes,Latitude,Longitude,OpenStreetMap',
    ...named.map((m) =>
      [
        csv(m.state),
        csv(m.name),
        m.holes,
        csv((m.missing ?? []).join(' ')),
        m.at[0],
        m.at[1],
        `https://www.openstreetmap.org/${m.key[0] === 'w' ? 'way' : 'relation'}/${m.key.slice(1)}`,
      ].join(','),
    ),
  ].join('\n'),
);

fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
// Static pages served alongside the data (e.g. plan.html, which opens shared practice plans).
const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
if (fs.existsSync(staticDir)) fs.cpSync(staticDir, outDir, { recursive: true });
console.log(`read ${lines} features: ${courses.size} courses, ${holeLines.length} holes, ${greens.length} greens, ${tees.length} tee boxes`);
console.log(`wrote ${written} course files with ${holeCount} holes to ${outDir}`);
console.log(`${complete} courses fully mapped; ${named.length} named courses without a proper map (${states.length} state outlines)`);
