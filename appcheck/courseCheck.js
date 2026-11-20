// Generated from the Boring Golf app (src/lib/courseCheck.ts) by scripts/export-course-check.mjs. Don't edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COURSE_NOT_AVAILABLE = void 0;
exports.checkHole = checkHole;
exports.checkCourse = checkCourse;
// Checks that a mapped course really works for strokes gained before anyone starts a round on
// it: every hole is there, each has a tee and a green at a sensible distance, and a simulated
// round (birdie, par, bogey and double on every hole, the shots placed the way the app places
// them after a hole) lands on the green and gives a strokes gained number. A course that fails
// is "not yet available". Pure, so the self-test runs it on real map data.
//
// The weekly course-data build (course-data/build.mjs) fixes what it can first (pars that don't
// fit the hole's length, holes drawn backwards, greens off their outline) and marks the courses
// it can't fix; this catches the rest, and courses that come straight from live OpenStreetMap.
const autoShots_1 = require("./autoShots");
const geo_1 = require("./geo");
const pattern_1 = require("./pattern");
const strokesGained_1 = require("./strokesGained");
exports.COURSE_NOT_AVAILABLE = 'Sorry, this course is not yet available.';
/** Shortest and longest believable holes, tee to green along the hole's line. */
const MIN_HOLE_YARDS = 20; // pitch-and-putt courses have 20-something-yard holes
const MAX_HOLE_YARDS = 1000; // a few real par 6s run past 800
/** Farthest the first putt's spot can be from the green's middle (a big green, a long putt). */
const GREEN_AT_MAX_YARDS = 25;
const finite = (p) => !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
/** What's wrong with one mapped hole, if anything. */
function checkHole(h) {
    const g = h.geo;
    const at = `Hole ${h.number}`;
    if (!g?.green || !finite(g.green))
        return [`${at}: no green`];
    if (!g.tee || !finite(g.tee))
        return [`${at}: no tee`];
    if (!(h.par >= 3 && h.par <= 6))
        return [`${at}: par ${h.par}`];
    const yards = (0, pattern_1.holeLineYards)(g.tee, g.path, g.green);
    if (!Number.isFinite(yards) || yards < MIN_HOLE_YARDS || yards > MAX_HOLE_YARDS)
        return [`${at}: ${Math.round(yards)} yds long`];
    if (g.greenOutline && g.greenOutline.length >= 3 && !(0, geo_1.insideRing)(g.green, g.greenOutline))
        return [`${at}: green off its outline`];
    // The simulated round: birdie, par, bogey and double, 2 putts (1 on a birdie), no GPS stops,
    // so every ball is placed by guess along the hole the way it is after a real hole.
    const problems = [];
    let id = 0;
    const newId = () => `s${id++}`;
    const green = (p) => (0, geo_1.onGreen)(p, g.green, g.greenOutline);
    for (const over of [-1, 0, 1, 2]) {
        const strokes = h.par + over;
        const putts = over < 0 ? 1 : 2;
        const shots = strokes - putts;
        const placed = (0, autoShots_1.autoPlaceShots)({
            shots,
            putts,
            tee: g.tee,
            center: g.green,
            pin: g.green,
            path: g.path,
            stops: [],
            newId,
            par: h.par,
            onGreen: green,
        });
        const what = `${at}, a ${strokes}`;
        if (placed.shots.length !== shots) {
            problems.push(`${what}: ${placed.shots.length} shots placed, not ${shots}`);
            continue;
        }
        if (!placed.shots.every((s) => finite(s.at)) || !finite(placed.greenAt)) {
            problems.push(`${what}: a ball has no spot`);
            continue;
        }
        // Every ball after the tee shot is nearer the green than the tee is.
        const fromTee = (0, geo_1.distanceYards)(g.tee, g.green);
        if (placed.shots.slice(1).some((s) => (0, geo_1.distanceYards)(s.at, g.green) >= fromTee)) {
            problems.push(`${what}: a ball went away from the green`);
            continue;
        }
        // The first putt starts near the green. (Not "on its outline": the pin here is the green's
        // middle, which on a lopsided green sits a couple of yards from an edge, so a 20 ft putt from
        // it can start on the fringe. In a real round the pin and putt length are yours.)
        if ((0, geo_1.distanceYards)(placed.greenAt, g.green) > GREEN_AT_MAX_YARDS) {
            problems.push(`${what}: the ball on the green isn't near it`);
            continue;
        }
        const hole = {
            number: h.number,
            par: h.par,
            strokes,
            putts,
            penalties: 0,
            shots: placed.shots,
            greenAt: placed.greenAt,
            firstPuttFeet: placed.firstPuttFeet,
        };
        const sg = (0, strokesGained_1.holeStrokesGained)(hole, g.green).total;
        if (sg === undefined || !Number.isFinite(sg))
            problems.push(`${what}: no strokes gained`);
    }
    return problems;
}
/**
 * Checks a course's mapped holes. Courses with no maps at all aren't checked: they work as a
 * scorecard and already say their map isn't available. On a mapped course no two holes may be
 * the same and every mapped hole must pass checkHole; holes without a map are played without one.
 */
function checkCourse(holes) {
    const mapped = holes.filter((h) => h.geo?.green);
    if (!mapped.length)
        return { ok: true, problems: [] };
    // Holes with no map don't block the course: they're scored without one, as before.
    const problems = [];
    for (let i = 0; i < mapped.length; i++) {
        for (let j = i + 1; j < mapped.length; j++) {
            // A 9-hole course played twice: hole 17 is hole 8 again, from about the same tee.
            if (Math.abs(mapped[i].number - mapped[j].number) === 9)
                continue;
            const a = mapped[i].geo;
            const b = mapped[j].geo;
            if (a.tee && b.tee && (0, geo_1.distanceYards)(a.tee, b.tee) < 10 && (0, geo_1.distanceYards)(a.green, b.green) < 10) {
                problems.push(`Holes ${mapped[i].number} and ${mapped[j].number} are the same hole`);
            }
        }
    }
    for (const h of mapped)
        problems.push(...checkHole(h));
    return { ok: problems.length === 0, problems };
}
