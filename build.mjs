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
import { createRequire } from 'node:module';
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

// ---- Course check: fixes, then the app's own check (appcheck/, copied from the app) ----

const require = createRequire(import.meta.url);
const { checkCourse } = require('./appcheck/courseCheck.js');
const { parseCourseFile } = require('./appcheck/courseData.js');

// The par the app assumes for a hole with none (as the app's course loading does).
const DEFAULT_PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];

const pathYards = (pts) => pts.slice(1).reduce((s, p, i) => s + meters(pts[i], p), 0) * 1.0936133;

/** The par a hole's length says it is (from its longest tees). */
const parForYards = (yd) => (yd <= 250 ? 3 : yd <= 490 ? 4 : yd <= 650 ? 5 : 6);

/** Whether a mapped par is clearly wrong for the hole's length. */
function parMisfits(par, yd) {
  if (par === 3) return yd > 290;
  if (par === 4) return yd < 190 || yd > 560;
  if (par === 5) return yd < 380;
  if (par === 6) return yd < 560;
  return true;
}

/** The nearest mapped green to a point, within 70 m. */
function nearestGreen(greens, p) {
  let best;
  let bestD = 70;
  for (const g of greens) {
    const d = meters(p, g.center);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best && { green: best, d: bestD };
}

/**
 * A spot inside a green's outline for the green's middle: the outline's centre if it's inside
 * (it isn't, for a kidney-shaped green), else where the hole's line ends, else a point
 * nudged in from the edge.
 */
function insideSpot(outline, center, end) {
  if (inside(center, outline)) return center;
  if (inside(end, outline)) return end;
  for (const p of outline) {
    const q = [p[0] + (center[0] - p[0]) * 0.25, p[1] + (center[1] - p[1]) * 0.25];
    if (inside(q, outline)) return q;
  }
  return undefined;
}

/** The app's check on a course file, building the course the way the app does. */
function appCheck(file) {
  const mapped = parseCourseFile(file);
  const count = mapped.length >= 10 || mapped.some((h) => h.number > 9) ? 18 : 9;
  const holes = Array.from({ length: count }, (_, i) => {
    const m = mapped.find((h) => h.number === i + 1);
    return { number: i + 1, par: m?.par || DEFAULT_PARS[i], yards: m?.yards, geo: m?.geo };
  });
  return checkCourse(holes);
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

// Every green by grid cell, to find the greens near a point whatever course they're filed under.
const greenGrid = new Map();
for (const g of greens) {
  const k = cell(g.center[0], g.center[1]);
  if (!greenGrid.has(k)) greenGrid.set(k, []);
  greenGrid.get(k).push(g);
}
function greensNear(p) {
  const y = Math.floor(p[0] / GRID);
  const x = Math.floor(p[1] / GRID);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(...(greenGrid.get(`${y + dy}:${x + dx}`) ?? []));
  return out;
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
const report = { passed: 0, fixed: [], unavailable: [] };
for (const c of courses.values()) {
  const byNumber = new Map();
  const fixes = [];
  for (const h of c.holes) {
    const n = parseInt(h.tags.ref ?? '', 10);
    if (!n || n < 1 || n > 36 || byNumber.has(n)) continue;
    // Fix: a hole drawn from the green back to the tee (its line starts at a green and ends
    // away from one) is turned around.
    // Only when the line starts right on a green and no green at all (this course's or a
    // neighbour's) is near its end: a tee often sits just past the last hole's green.
    let line = h.path;
    const atStart = nearestGreen(greensNear(line[0]), line[0]);
    const atEnd = nearestGreen(greensNear(line[line.length - 1]), line[line.length - 1]);
    if (line.length >= 2 && atStart && atStart.d <= 25 && !atEnd) {
      line = [...line].reverse();
      fixes.push(`hole ${n}: line turned around (it ran green to tee)`);
    }
    const end = line[line.length - 1];
    let green = end;
    let outline;
    // Snap the hole's end to the nearest mapped green (filed under this course or a neighbour).
    const near = nearestGreen(greensNear(end), end);
    if (near) {
      green = near.green.center;
      outline = near.green.outline;
      // Fix: the green's middle has to be on the green.
      if (!inside(green, outline)) {
        const spot = insideSpot(outline, green, end);
        if (spot) {
          green = spot;
          fixes.push(`hole ${n}: green's middle moved onto the green`);
        } else {
          outline = undefined;
          fixes.push(`hole ${n}: green outline dropped (its middle wasn't on it)`);
        }
      }
    }
    let par = parseInt(h.tags.par ?? '', 10);
    // Fix: no par, or one that can't be right for the hole's length, comes from the length.
    // (A scorecard's par still wins in the app.)
    const yd = pathYards([...line.slice(0, -1), green]);
    if (!(par >= 3 && par <= 6) || parMisfits(par, yd)) {
      const was = par >= 3 && par <= 6 ? `par ${par}` : 'no par';
      par = parForYards(yd);
      fixes.push(`hole ${n}: ${was} → par ${par} (${Math.round(yd)} yds)`);
    }
    const hcp = parseInt(h.tags.handicap ?? '', 10);
    const dist = parseFloat(h.tags.dist ?? '');
    byNumber.set(n, {
      n,
      par,
      ...(hcp > 0 ? { hcp } : {}),
      ...(dist > 0 ? { yd: Math.round(dist * 1.0936133) } : {}),
      path: line.map(round),
      green: round(green),
      ...(outline ? { outline: outline.map(round) } : {}),
    });
  }
  c.numbers = [...byNumber.keys()];
  if (!byNumber.size) continue;
  const holes = [...byNumber.values()].sort((a, b) => a.n - b.n);
  const file = { v: 1, key: c.key, name: c.name, holes, ...(c.tees ? { tees: c.tees.map(round) } : {}) };
  // The app's check, on the fixed course. One that still fails is published as not available,
  // so the app says sorry instead of starting a round on maps that don't work.
  const check = appCheck(file);
  if (check.ok) {
    fs.writeFileSync(path.join(outDir, 'c', `${c.key}.json`), JSON.stringify(file));
    if (fixes.length) report.fixed.push({ key: c.key, name: c.name, fixes });
    else report.passed++;
    written++;
    holeCount += holes.length;
  } else {
    fs.writeFileSync(
      path.join(outDir, 'c', `${c.key}.json`),
      JSON.stringify({ v: 1, key: c.key, name: c.name, unavailable: true, problems: check.problems }),
    );
    report.unavailable.push({ key: c.key, name: c.name, problems: check.problems, ...(fixes.length ? { fixes } : {}) });
  }
}

// What the check found, for a look each week: which courses were fixed and how, and which
// are not available and why.
const byName = (a, b) => a.name.localeCompare(b.name);
report.fixed.sort(byName);
report.unavailable.sort(byName);
fs.writeFileSync(
  path.join(outDir, 'course-check.json'),
  JSON.stringify({
    v: 1,
    generated: new Date().toISOString(),
    checked: report.passed + report.fixed.length + report.unavailable.length,
    passed: report.passed,
    fixed: report.fixed.length,
    unavailable: report.unavailable.length,
    fixedCourses: report.fixed,
    unavailableCourses: report.unavailable,
  }),
);
const csvCell = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
fs.writeFileSync(
  path.join(outDir, 'course-check.csv'),
  [
    'Result,Course,What,OpenStreetMap',
    ...[
      ...report.unavailable.map((x) => ['Not available', x.name, x.problems.join('; '), x.key]),
      ...report.fixed.map((x) => ['Fixed', x.name, x.fixes.join('; '), x.key]),
    ].map(([r, n, w, k]) =>
      [r, csvCell(n), csvCell(w), `https://www.openstreetmap.org/${k[0] === 'w' ? 'way' : 'relation'}/${k.slice(1)}`].join(','),
    ),
  ].join('\n'),
);

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
console.log(`course check: ${report.passed} passed, ${report.fixed.length} fixed, ${report.unavailable.length} not available (see course-check.csv)`);
console.log(`wrote ${written} course files with ${holeCount} holes to ${outDir}`);
console.log(`${complete} courses fully mapped; ${named.length} named courses without a proper map (${states.length} state outlines)`);
