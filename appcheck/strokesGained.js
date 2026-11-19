// Generated from the Boring Golf app (src/lib/strokesGained.ts) by scripts/export-course-check.mjs. Don't edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEE_TO_GREEN = exports.SG_LABEL = exports.SG_CATS = exports.BASELINE_LABEL = void 0;
exports.expectedPutts = expectedPutts;
exports.expectedStrokes = expectedStrokes;
exports.holeStrokesGained = holeStrokesGained;
// Strokes gained, Boring Golf's own baseline model.
//
// Expected strokes to hole out from a distance and lie. The scratch tables
// below are Boring Golf's own estimates for a scratch amateur (rounded,
// smoothed, interpolated linearly). The 10 and 20 handicap baselines scale each
// shot's expectation above one stroke, so a higher-handicap baseline is easier
// to beat. Replace these tables with values fitted to your own users' rounds
// once you have enough data.
const geo_1 = require("./geo");
// Putting: distance in feet → expected putts.
const PUTT = [
    [1, 1.0], [2, 1.01], [3, 1.05], [4, 1.12], [5, 1.2], [6, 1.29], [8, 1.44], [10, 1.55],
    [12, 1.63], [15, 1.73], [20, 1.84], [25, 1.92], [30, 1.98], [40, 2.08], [50, 2.17],
    [60, 2.25], [80, 2.38], [100, 2.5],
];
// Yards → expected strokes.
const TEE = [
    [100, 2.95], [150, 3.05], [175, 3.13], [200, 3.22], [225, 3.35], [250, 3.55], [300, 3.85],
    [350, 3.98], [400, 4.1], [450, 4.25], [500, 4.55], [550, 4.75], [600, 4.95], [650, 5.15],
];
const FAIRWAY = [
    [5, 2.15], [10, 2.25], [20, 2.42], [30, 2.52], [40, 2.6], [50, 2.66], [60, 2.71], [80, 2.78],
    [100, 2.84], [120, 2.91], [140, 2.98], [160, 3.07], [180, 3.17], [200, 3.28], [220, 3.4],
    [240, 3.52], [260, 3.64], [300, 3.85], [350, 4.02], [400, 4.15], [500, 4.5], [600, 4.9],
];
const ROUGH_EXTRA = [
    [5, 0.08], [10, 0.12], [50, 0.15], [100, 0.18], [150, 0.22], [200, 0.24], [300, 0.2], [600, 0.2],
];
const SAND = [
    [5, 2.45], [10, 2.5], [20, 2.55], [30, 2.65], [40, 2.78], [50, 2.9], [75, 3.05], [100, 3.15],
    [150, 3.3], [200, 3.5], [250, 3.7], [300, 3.9],
];
const RECOVERY_EXTRA = 0.65;
// How much harder each level finds a shot than a scratch golfer: the expected strokes
// above one are scaled by this. 1.25% per handicap stroke; a tour pro is ~4% better
// than scratch. These are Boring Golf's own estimates, not any tour's measured data.
const BASELINE_FACTOR = {
    tour: 0.96,
    scratch: 1,
    hcp5: 1.0625,
    hcp10: 1.125,
    hcp15: 1.1875,
    hcp20: 1.25,
};
/** In the order they're offered in Settings. */
exports.BASELINE_LABEL = {
    tour: 'Tour Pro',
    scratch: 'Scratch',
    hcp5: '5 handicap',
    hcp10: '10 handicap',
    hcp15: '15 handicap',
    hcp20: '20 handicap',
};
function interp(table, x) {
    if (x <= table[0][0])
        return table[0][1];
    for (let i = 1; i < table.length; i++) {
        const [x1, y1] = table[i];
        if (x <= x1) {
            const [x0, y0] = table[i - 1];
            return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
        }
    }
    // Beyond the table: extend with the last segment's slope.
    const [xa, ya] = table[table.length - 2];
    const [xb, yb] = table[table.length - 1];
    return yb + ((yb - ya) * (x - xb)) / (xb - xa);
}
function scale(e, baseline) {
    return 1 + (e - 1) * BASELINE_FACTOR[baseline];
}
function expectedPutts(feet, baseline = 'scratch') {
    if (feet <= 0)
        return 0;
    return scale(interp(PUTT, feet), baseline);
}
function expectedStrokes(lie, yards, baseline = 'scratch') {
    if (yards <= 0)
        return 0;
    let e;
    switch (lie) {
        case 'green':
            return expectedPutts(yards * 3, baseline);
        case 'tee':
            e = yards < 100 ? interp(FAIRWAY, yards) : interp(TEE, yards);
            break;
        case 'fairway':
            e = interp(FAIRWAY, yards);
            break;
        case 'rough':
            e = interp(FAIRWAY, yards) + interp(ROUGH_EXTRA, yards);
            break;
        case 'sand':
            e = interp(SAND, yards);
            break;
        case 'recovery':
            e = interp(FAIRWAY, yards) + RECOVERY_EXTRA;
            break;
    }
    return scale(e, baseline);
}
exports.SG_CATS = ['ott', 'app', 'wedge', 'arg', 'sand', 'putt'];
exports.SG_LABEL = {
    ott: 'Tee',
    app: 'Approach',
    wedge: 'Wedge',
    arg: 'Around green',
    sand: 'Sand',
    putt: 'Putting',
};
/** Every category but putting: Tee to Green. */
exports.TEE_TO_GREEN = ['ott', 'app', 'wedge', 'arg', 'sand'];
const AROUND_GREEN_YARDS = 50;
const WEDGE_YARDS = 100;
/**
 * Strokes gained for one hole.
 *
 * Each tracked shot gains (expected before) − (expected after) − 1 − penalties.
 * Putting gains expected putts from the first putt's distance minus putts taken.
 * When the hole wasn't fully tracked, only the parts that can be measured are returned.
 */
function holeStrokesGained(hole, pinOrGreen, baseline = 'scratch') {
    const out = { complete: false };
    const hasPutting = hole.putts !== undefined && (hole.putts === 0 || (hole.firstPuttFeet ?? 0) > 0);
    if (hasPutting && hole.putts > 0) {
        out.putt = expectedPutts(hole.firstPuttFeet, baseline) - hole.putts;
    }
    else if (hole.putts === 0) {
        out.putt = 0;
    }
    if (hole.strokes !== undefined && hole.yards) {
        out.total = expectedStrokes('tee', hole.yards, baseline) - hole.strokes;
    }
    const shots = hole.shots;
    if (!pinOrGreen || shots.length === 0 || !hasPutting)
        return out;
    // Penalties added with the hole's counter (not on a shot) count in the total, not a category.
    const tracked = shots.length + shots.reduce((s, x) => s + x.penalty, 0) + (hole.penalties ?? 0) + hole.putts;
    if (hole.strokes !== undefined && hole.strokes !== tracked)
        return out;
    // Strokes gained by each category the hole's shots fell in (putting is already in `out`).
    const add = (k, v) => {
        out[k] = (out[k] ?? 0) + v;
    };
    for (let i = 0; i < shots.length; i++) {
        const s = shots[i];
        // The scorecard yardage is only right if the player used the mapped tee box.
        const yards = i === 0 && s.lie === 'tee' && hole.yards && !hole.tee ? hole.yards : (0, geo_1.distanceYards)(s.at, pinOrGreen);
        const before = expectedStrokes(s.lie, yards, baseline);
        let after;
        if (i + 1 < shots.length) {
            const n = shots[i + 1];
            after = expectedStrokes(n.lie, (0, geo_1.distanceYards)(n.at, pinOrGreen), baseline);
        }
        else {
            after = hole.putts === 0 ? 0 : expectedPutts(hole.firstPuttFeet, baseline);
        }
        const gained = before - after - 1 - s.penalty;
        if (s.lie === 'tee' && hole.par >= 4)
            add('ott', gained);
        else if (s.lie === 'green')
            out.putt = (out.putt ?? 0) + gained;
        else if (yards > WEDGE_YARDS || s.lie === 'tee')
            add('app', gained);
        else if (yards > AROUND_GREEN_YARDS)
            add('wedge', gained);
        else if (s.lie === 'sand')
            add('sand', gained);
        else
            add('arg', gained);
    }
    const first = shots[0];
    const startYards = first.lie === 'tee' && hole.yards && !hole.tee ? hole.yards : (0, geo_1.distanceYards)(first.at, pinOrGreen);
    out.total = expectedStrokes(first.lie, startYards, baseline) - tracked;
    out.complete = true;
    return out;
}
