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
const MIN_HOLE_YARDS = 40;
const MAX_HOLE_YARDS = 800;
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
        if (!green(placed.greenAt)) {
            problems.push(`${what}: the ball on the green isn't on it`);
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
 * scorecard and already say their map isn't available. A mapped course must have every hole
 * of its 9 or 18 mapped, no two holes the same, and every hole must pass checkHole.
 */
function checkCourse(holes) {
    const mapped = holes.filter((h) => h.geo?.green);
    if (!mapped.length)
        return { ok: true, problems: [] };
    const problems = [];
    const missing = holes.filter((h) => !h.geo?.green).map((h) => h.number);
    if (missing.length)
        problems.push(`No map for hole${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);
    for (let i = 0; i < mapped.length; i++) {
        for (let j = i + 1; j < mapped.length; j++) {
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
