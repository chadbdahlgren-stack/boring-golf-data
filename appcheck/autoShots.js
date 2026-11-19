// Generated from the Boring Golf app (src/lib/autoShots.ts) by scripts/export-course-check.mjs. Don't edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoPlaceShots = autoPlaceShots;
// Strokes gained after the hole: places the hole's shots from where the GPS saw the golfer
// stop, so they only need fixing, not marking from scratch.
const geo_1 = require("./geo");
const pattern_1 = require("./pattern");
const stops_1 = require("./stops");
/** A guessed ball left near the green (a chip or pitch) is about this far from the middle. */
const NEAR_GREEN = 15;
/** A guessed last ball before the putts sits this far short of the green's edge. */
const OFF_GREEN = 15;
/** Guessed shots after the tee shot are at least this long. */
const MIN_SHOT = 25;
/**
 * Stops closer than this to the tee are left out: they're the cart parked or waiting to hit,
 * not where a tee shot finished. A guess at a full tee shot is closer to the truth.
 */
const NEAR_TEE = 60;
/**
 * Lengths of the `m + 1` shots that cover `len` yards. From the tee, the first is a full tee
 * shot (or, on a par 3, finishes just off the green); the rest get shorter toward the green,
 * like a layup and then an approach: 3 shots split about 44%, 33%, 22%.
 */
function splitGap(len, m, teeShot, par) {
    const segs = [];
    let rest = len;
    if (teeShot !== undefined && m > 0) {
        const first = par >= 4 ? Math.min(teeShot, len - MIN_SHOT * m) : len - NEAR_GREEN * m;
        if (first >= len * 0.3) {
            segs.push(first);
            rest -= first;
        }
    }
    const k = m + 1 - segs.length;
    const w = Array.from({ length: k }, (_, j) => 1 + 0.5 * (k - 1 - j));
    const sum = w.reduce((a, b) => a + b, 0);
    return [...segs, ...w.map((x) => (rest * x) / sum)];
}
/**
 * Ball 1 is the tee. The next balls are stops on this hole (off the tee and off the green),
 * the longest stops if there are more than needed, in the order they happened. Missing balls
 * are guessed along the hole's line the way holes are played (a full tee shot, then shorter
 * shots toward the green) and marked as guesses. The ball on the green sits short of the pin
 * by the first putt.
 */
function autoPlaceShots(o) {
    const line = (0, pattern_1.holeLine)(o.tee, o.path, o.center);
    const total = (0, pattern_1.holeLineYards)(o.tee, o.path, o.center);
    const need = Math.max(0, o.shots - 1);
    const onHole = o.stops.filter((s) => (0, stops_1.distanceToPath)(s.at, line) <= 45 && (0, geo_1.distanceYards)(s.at, o.tee) >= NEAR_TEE && (0, geo_1.distanceYards)(s.at, o.center) > 20);
    const chosen = [...onHole]
        .sort((a, b) => b.end - b.start - (a.end - a.start))
        .slice(0, need)
        .sort((a, b) => a.start - b.start);
    const spots = chosen.map((s) => ({ at: s.at, along: (0, geo_1.projectOnPath)(line, s.at).along, fromStop: true, guessed: false }));
    // Keep them moving toward the green, in case the order of stops was odd.
    spots.sort((a, b) => a.along - b.along);
    // Not enough stops: guess the rest the way a hole is really played, not evenly spaced.
    const par = o.par ?? 4;
    const teeShot = par >= 4 ? (o.driveYards ?? 250) : total - NEAR_GREEN;
    const marks = [0, ...spots.map((s) => s.along), total];
    const per = marks.slice(1).map(() => 0);
    for (let g = need - spots.length; g > 0; g--) {
        // Each guess goes where it shortens the longest shots most. From the tee, a stop within
        // a tee shot's reach is the tee shot, so only the stretch beyond it counts.
        let best = 0;
        let bestScore = -1;
        for (let i = 0; i < per.length; i++) {
            const len = marks[i + 1] - marks[i];
            const score = (i === 0 ? Math.max(0, len - teeShot) : len) / (per[i] + 1);
            if (score > bestScore) {
                best = i;
                bestScore = score;
            }
        }
        per[best]++;
    }
    const guesses = [];
    per.forEach((m, i) => {
        if (!m)
            return;
        const segs = splitGap(marks[i + 1] - marks[i], m, i === 0 ? teeShot : undefined, par);
        let along = marks[i];
        for (const s of segs.slice(0, m)) {
            along += s;
            guesses.push({ at: (0, pattern_1.pointAlongHole)(o.tee, o.path, o.center, along), along, fromStop: false, guessed: true });
        }
    });
    spots.push(...guesses);
    spots.sort((a, b) => a.along - b.along);
    const shots = [
        { id: o.newId(), at: o.tee, lie: 'tee', penalty: 0 },
        ...spots.map((s) => ({
            id: o.newId(),
            at: s.at,
            lie: 'fairway',
            penalty: 0,
            ...(s.fromStop ? { fromStop: true } : {}),
            ...(s.guessed ? { guessed: true } : {}),
        })),
    ].slice(0, Math.max(1, o.shots));
    // A guessed last ball is short of the green, on the line in to the pin: a chip, pitch or
    // putt from off the green is still to come (a par with 1 putt on a par 3), so it can't be on
    // the green, where it would sit on top of the putts. It's a guess, well clear of the green
    // so it's easy to drag to where the ball really was.
    const k = shots.length - 1;
    if (k > 0 && shots[k].guessed) {
        const prev = shots[k - 1].at;
        const room = (0, geo_1.distanceYards)(prev, o.pin) - 5;
        const at = (back) => (0, pattern_1.pointFrom)(prev, o.pin, 0, -back);
        let back;
        if (o.onGreen && o.onGreen(o.pin)) {
            let b = 1;
            while (b < 45 && o.onGreen(at(b)))
                b++;
            back = b + OFF_GREEN;
        }
        else if ((0, geo_1.distanceYards)(shots[k].at, o.center) < NEAR_GREEN + OFF_GREEN) {
            back = NEAR_GREEN + OFF_GREEN;
        }
        if (back !== undefined && back < room)
            shots[k] = { ...shots[k], at: at(back) };
    }
    if (o.putts === 0 || !shots.length)
        return { shots };
    const feet = o.firstPuttFeet ?? (o.putts === 1 ? 8 : 20);
    // On the green, short of the pin on the line from the last ball.
    const greenAt = (0, pattern_1.pointFrom)(shots[shots.length - 1].at, o.pin, 0, -feet / 3);
    return { shots, greenAt, firstPuttFeet: feet };
}
