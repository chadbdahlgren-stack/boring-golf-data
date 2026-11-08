// Runs build.mjs on the Pinehurst fixture and checks the output. Run: node test/test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-course-data-'));
console.log(execFileSync(process.execPath, [path.join(here, '..', 'build.mjs'), path.join(here, 'pinehurst.geojsonseq'), out]).toString());

const index = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
assert.ok(index.courses >= 2, 'several courses');

// Pinehurst No. 4 (way 845405482) should have all 18 holes, numbered 1-18, each with a green.
const no4 = JSON.parse(fs.readFileSync(path.join(out, 'c', 'w845405482.json'), 'utf8'));
assert.equal(no4.holes.length, 18);
assert.deepEqual(no4.holes.map((h) => h.n), Array.from({ length: 18 }, (_, i) => i + 1));
for (const h of no4.holes) {
  assert.ok(h.path.length >= 2 && h.green.length === 2);
  // 0 means OpenStreetMap has no par for the hole; the app fills it in from the scorecard.
  assert.ok(h.par === 0 || (h.par >= 3 && h.par <= 6), `hole ${h.n} par ${h.par}`);
}
// As of the fixture, OpenStreetMap has pars for 11 of No. 4's holes.
assert.ok(no4.holes.filter((h) => h.par).length >= 10, 'pars that are mapped come through');
assert.ok(no4.holes.filter((h) => h.outline).length >= 16, 'most holes snap to a green outline');

// No course's holes should be duplicated into a neighbour's file.
for (const f of fs.readdirSync(path.join(out, 'c'))) {
  const c = JSON.parse(fs.readFileSync(path.join(out, 'c', f), 'utf8'));
  assert.ok(c.holes.length <= 36);
}
// Courses without a proper map are listed; fully mapped ones (No. 4) aren't.
const gaps = JSON.parse(fs.readFileSync(path.join(out, 'maps-missing.json'), 'utf8'));
assert.equal(gaps.complete + gaps.none + gaps.partial + gaps.unnamed, gaps.courses);
assert.ok(!gaps.list.some((c) => c.key === 'w845405482'), 'No. 4 is fully mapped');
const no9 = gaps.list.find((c) => c.key === 'r6388053');
assert.equal(no9?.holes, 0, 'Course No. 9 has no holes in the fixture');
const no7 = gaps.list.find((c) => c.key === 'w286194275');
assert.ok(no7 && no7.holes > 0 && no7.missing.length > 0, 'a partly mapped course lists its missing holes');
assert.ok(fs.readFileSync(path.join(out, 'maps-missing.csv'), 'utf8').startsWith('State,Course,'));
console.log('course-data checks passed');
