// Generated from the Boring Golf app (src/lib/pattern.ts) by scripts/export-course-check.mjs. Don't edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ON_TEE_YARDS = exports.DEFAULT_DRIVE_YARDS = exports.PATTERN_SHARE = exports.MIN_APPROACH_YARDS = void 0;
exports.aimTarget = aimTarget;
exports.relativeTo = relativeTo;
exports.pointFrom = pointFrom;
exports.approachShots = approachShots;
exports.holeLine = holeLine;
exports.holeLineYards = holeLineYards;
exports.pointAlongHole = pointAlongHole;
exports.teeShots = teeShots;
exports.withoutOutliers = withoutOutliers;
exports.drivePattern = drivePattern;
exports.patternStats = patternStats;
exports.ovalSize = ovalSize;
exports.ovalPoints = ovalPoints;
exports.filterApproaches = filterApproaches;
exports.onTeeBox = onTeeBox;
exports.preferCourse = preferCourse;
exports.teeAimYards = teeAimYards;
exports.approachesNear = approachesNear;
exports.describeMiss = describeMiss;
// Shot patterns: where approach shots finish relative to the target, and the
// oval that holds most of them. Built from the shots marked in Strokes gained rounds.
const geo_1 = require("./geo");
/**
 * What the shot was aimed at: the middle of the green (most players aim there, not at the pin),
 * else the pin when the green isn't mapped. Strokes gained still measures from the pin.
 */
function aimTarget(round, hole) {
    return round.course.holes[hole.number - 1]?.geo?.green ?? hole.pin;
}
const YD = 0.9144; // meters per yard
/** Shots this far or farther from the target count as approaches (closer ones are short game). */
exports.MIN_APPROACH_YARDS = 40;
/** Shots finishing farther than this from the target are treated as layups, not approaches. */
const MAX_FINISH_YARDS = 60;
/** Splits `p − target` into right/left and long/short of the line from `from` to `target`. */
function relativeTo(from, target, p) {
    const d = (0, geo_1.toLocal)(target, from);
    const len = Math.hypot(d.e, d.n) || 1;
    // Unit vector pointing from the player toward the target.
    const fe = -d.e / len;
    const fn = -d.n / len;
    const v = (0, geo_1.toLocal)(target, p);
    return {
        along: (0, geo_1.metersToYards)(v.e * fe + v.n * fn),
        // Right of the line, facing the target: (fn, −fe).
        side: (0, geo_1.metersToYards)(v.e * fn - v.n * fe),
    };
}
/** Inverse of relativeTo: the point `side`/`along` yards from `target` in the shot's frame. */
function pointFrom(from, target, side, along) {
    const d = (0, geo_1.toLocal)(target, from);
    const len = Math.hypot(d.e, d.n) || 1;
    const fe = -d.e / len;
    const fn = -d.n / len;
    const a = along * YD;
    const s = side * YD;
    return (0, geo_1.fromLocal)(target, a * fe + s * fn, a * fn - s * fe);
}
/** Every approach shot marked in these rounds. */
function approachShots(rounds) {
    const out = [];
    for (const r of rounds) {
        for (const h of r.holes) {
            const target = aimTarget(r, h);
            // Voice-entered balls sit on the hole's line, not where they really finished.
            if (!target || h.voice)
                continue;
            h.shots.forEach((s, i) => {
                // A guessed ball isn't where the ball really was.
                if (s.penalty > 0 || s.guessed || h.shots[i + 1]?.guessed)
                    return;
                // A tee shot on a par 4 or 5 is aimed down the fairway, not at the green, even on a short
                // hole where it finishes near it; those are drives (see teeShots). Par 3 tee shots count.
                if (i === 0 && h.par >= 4)
                    return;
                const finish = h.shots[i + 1]?.at ?? (i === h.shots.length - 1 ? h.greenAt : undefined);
                if (!finish)
                    return;
                const distance = (0, geo_1.distanceYards)(s.at, target);
                if (distance < exports.MIN_APPROACH_YARDS)
                    return;
                if ((0, geo_1.distanceYards)(finish, target) > MAX_FINISH_YARDS)
                    return;
                out.push({ club: s.club, distance, ...relativeTo(s.at, target, finish), date: r.date, course: r.course.name, courseKey: r.course.key, hole: h.number });
            });
        }
    }
    return out.sort((a, b) => b.date - a.date);
}
/** The hole's line from this tee to the green: the mapped path's points between them. */
function holeLine(tee, path, green) {
    const toGreen = (0, geo_1.distanceYards)(tee, green);
    // The mapped line may start at a different tee box, so keep only points ahead of this one.
    const mids = (path ?? []).filter((p) => {
        const d = (0, geo_1.distanceYards)(p, green);
        return d < toGreen - 5 && d > 5;
    });
    return [tee, ...mids, green];
}
/** Yards from the tee to the green, following the hole's line. */
function holeLineYards(tee, path, green) {
    const pts = holeLine(tee, path, green);
    return pts.slice(1).reduce((s, p, i) => s + (0, geo_1.distanceYards)(pts[i], p), 0);
}
/**
 * The point `yards` along the hole from `tee`, following the mapped hole line (tee, dogleg,
 * green) so a drive on a dogleg is judged against the fairway, not a straight line to the pin.
 */
function pointAlongHole(tee, path, green, yards) {
    const pts = holeLine(tee, path, green);
    let left = yards;
    for (let i = 1; i < pts.length; i++) {
        const seg = (0, geo_1.distanceYards)(pts[i - 1], pts[i]);
        if (left <= seg)
            return pointFrom(pts[i - 1], pts[i], 0, left - seg);
        left -= seg;
    }
    // Past the green: keep going the way the last stretch of the hole runs.
    return pointFrom(pts[pts.length - 2], pts[pts.length - 1], 0, left);
}
/** Every tee shot on a par 4 or 5 marked in these rounds (penalized ones have no real finish). */
function teeShots(rounds) {
    const out = [];
    for (const r of rounds) {
        for (const h of r.holes) {
            const s = h.shots[0];
            const green = aimTarget(r, h);
            if (h.par < 4 || h.voice || !s || s.lie !== 'tee' || s.penalty > 0 || h.shots[1]?.guessed || !green)
                continue;
            const finish = h.shots[1]?.at ?? (h.shots.length === 1 ? h.greenAt : undefined);
            if (!finish)
                continue;
            const distance = (0, geo_1.distanceYards)(s.at, finish);
            if (distance < 30)
                continue;
            const aim = pointAlongHole(s.at, r.course.holes[h.number - 1]?.geo?.path, green, distance);
            out.push({ club: s.club, distance, side: relativeTo(s.at, aim, finish).side, date: r.date, course: r.course.name, courseKey: r.course.key, hole: h.number });
        }
    }
    return out.sort((a, b) => b.date - a.date);
}
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/**
 * Leaves out shanks and other wild shots: any shot far outside the usual spread, left/right
 * or long/short. "Far" is more than 3.5 times the typical miss from the middle, measured with
 * medians so the wild shots themselves don't widen it. Needs 5 shots to judge.
 */
function withoutOutliers(shots) {
    if (shots.length < 5)
        return { kept: shots, dropped: 0 };
    const far = (vals) => {
        const mid = median(vals);
        // Typical miss (median absolute deviation, scaled to a standard deviation), at least 4 yards.
        const spread = Math.max(4, 1.4826 * median(vals.map((v) => Math.abs(v - mid))));
        return vals.map((v) => Math.abs(v - mid) / spread > 3.5);
    };
    const wideSide = far(shots.map((s) => s.side));
    const wideAlong = far(shots.map((s) => s.along));
    const kept = shots.filter((_, i) => !wideSide[i] && !wideAlong[i]);
    return { kept, dropped: shots.length - kept.length };
}
/** Drives as pattern points: left/right of the line, and longer/shorter than their average. Wild ones left out. */
function drivePattern(drives) {
    const { kept, dropped } = withoutOutliers(drives.map((d) => ({ ...d, along: d.distance })));
    const avg = kept.length ? kept.reduce((s, d) => s + d.distance, 0) / kept.length : 0;
    const points = kept.map((d) => ({ side: d.side, along: d.distance - avg }));
    return { avg, points, stats: patternStats(points), dropped };
}
// 2-D normal: an ellipse at k standard deviations holds 1 − e^(−k²/2) of shots; k = 1.48 → ~2/3.
const K = 1.48;
exports.PATTERN_SHARE = '2 of 3';
function patternStats(shots) {
    const n = shots.length;
    if (n < 3)
        return undefined;
    const mx = shots.reduce((s, x) => s + x.side, 0) / n;
    const my = shots.reduce((s, x) => s + x.along, 0) / n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const s of shots) {
        sxx += (s.side - mx) ** 2;
        syy += (s.along - my) ** 2;
        sxy += (s.side - mx) * (s.along - my);
    }
    sxx /= n - 1;
    syy /= n - 1;
    sxy /= n - 1;
    // Eigenvalues of the 2×2 covariance matrix give the oval's axes.
    const tr = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(0, tr / 2 - disc);
    const angle = Math.abs(sxy) < 1e-9 ? (sxx >= syy ? 0 : Math.PI / 2) : Math.atan2(l1 - sxx, sxy);
    // A floor of 2 yd keeps a tiny sample from drawing a hairline.
    return { count: n, meanSide: mx, meanAlong: my, radius1: Math.max(2, K * Math.sqrt(l1)), radius2: Math.max(2, K * Math.sqrt(l2)), angle };
}
/** The oval's full width (left to right) and depth (short to long), in yards. */
function ovalSize(p) {
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    return {
        wide: 2 * Math.hypot(p.radius1 * c, p.radius2 * s),
        deep: 2 * Math.hypot(p.radius1 * s, p.radius2 * c),
    };
}
/** Points around the pattern oval, in yards (side, along) relative to the aim point. */
function ovalPoints(p, steps = 48) {
    const pts = [];
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const x = p.radius1 * Math.cos(t);
        const y = p.radius2 * Math.sin(t);
        pts.push({ side: p.meanSide + x * c - y * s, along: p.meanAlong + x * s + y * c });
    }
    return pts;
}
function filterApproaches(all, f) {
    return all.filter((a) => (!f.club || a.club === f.club) &&
        (f.minYards === undefined || a.distance >= f.minYards) &&
        (f.maxYards === undefined || a.distance < f.maxYards));
}
/** Off the tee with no tee shots marked yet: aim this far down the middle of the hole. */
exports.DEFAULT_DRIVE_YARDS = 250;
/** Standing within this many yards of a tee box counts as being on the tee. */
exports.ON_TEE_YARDS = 40;
/** Whether this spot (your GPS) is on one of the hole's tee boxes. */
function onTeeBox(at, tees) {
    return tees.some((t) => (0, geo_1.distanceYards)(at, t) <= exports.ON_TEE_YARDS);
}
/** Your shots on this course when there are at least `min` of them, else every course's. */
function preferCourse(all, courseKey, min = 3) {
    const here = all.filter((s) => s.courseKey === courseKey);
    return here.length >= min ? { shots: here, here: true } : { shots: all, here: false };
}
/**
 * How far down the hole's line to aim off the tee: your average drive (this course's when you
 * have 3 there, else every course's), or 250 yards with none marked. Never past 20 yards short
 * of the green.
 */
function teeAimYards(avgDrive, holeYards) {
    return Math.max(0, Math.min(avgDrive ?? exports.DEFAULT_DRIVE_YARDS, holeYards - 20));
}
/** Shots from about this distance (±15 yd), widening the window if there are too few. */
function approachesNear(all, yards, club) {
    for (const pad of [15, 25, 40]) {
        const list = filterApproaches(all, { club, minYards: yards - pad, maxYards: yards + pad });
        if (list.length >= 5 || pad === 40)
            return list;
    }
    return [];
}
/** "6 yd right, 4 yd short" (or "dead center"). */
function describeMiss(side, along) {
    const parts = [];
    if (Math.abs(side) >= 1)
        parts.push(`${Math.round(Math.abs(side))} yd ${side > 0 ? 'right' : 'left'}`);
    if (Math.abs(along) >= 1)
        parts.push(`${Math.round(Math.abs(along))} yd ${along > 0 ? 'long' : 'short'}`);
    return parts.join(', ') || 'dead center';
}
