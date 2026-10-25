// Makes test/pinehurst.geojsonseq from live OpenStreetMap data, shaped like
// `osmium export -f geojsonseq -a type,id` output. Run once: node test/make-fixture.mjs
import fs from 'node:fs';

const UA = { 'User-Agent': 'BoringGolf/0.2 course-data test fixture' };
// Pinehurst No. 2, 3, 4, 5 and neighbours: several courses side by side.
const bbox = '-79.478,35.180,-79.445,35.200';
const res = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`, { headers: UA });
if (!res.ok) throw new Error(`OSM API ${res.status}`);
const { elements } = await res.json();

const nodes = new Map(elements.filter((e) => e.type === 'node').map((n) => [n.id, [n.lon, n.lat]]));
const ways = new Map(elements.filter((e) => e.type === 'way').map((w) => [w.id, w]));
const coords = (w) => w.nodes.map((id) => nodes.get(id)).filter(Boolean);
const closed = (c) => c.length > 3 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];

const out = [];
const emit = (type, id, tags, geometry) =>
  out.push('\x1e' + JSON.stringify({ type: 'Feature', geometry, properties: { '@type': type, '@id': id, ...tags } }));

for (const w of ways.values()) {
  const t = w.tags ?? {};
  const c = coords(w);
  if (t.leisure === 'golf_course' || t.golf === 'green') {
    if (closed(c)) emit('way', w.id, t, { type: 'Polygon', coordinates: [c] });
  } else if (t.golf === 'hole' && c.length >= 2) {
    emit('way', w.id, t, { type: 'LineString', coordinates: c });
  }
}
for (const r of elements.filter((e) => e.type === 'relation' && e.tags?.leisure === 'golf_course')) {
  const polys = r.members
    .filter((m) => m.type === 'way' && m.role !== 'inner' && ways.has(m.ref))
    .map((m) => coords(ways.get(m.ref)))
    .filter(closed)
    .map((c) => [c]);
  if (polys.length) emit('relation', r.id, r.tags, { type: 'MultiPolygon', coordinates: polys });
}

fs.writeFileSync(new URL('./pinehurst.geojsonseq', import.meta.url), out.join('\n') + '\n');
console.log(`wrote ${out.length} features`);
