// Generated from the Boring Golf app (src/lib/stops.ts) by scripts/export-course-check.mjs. Don't edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectStops = detectStops;
exports.distanceToPath = distanceToPath;
exports.stopsForHole = stopsForHole;
// Where the golfer stood still during a round: likely spots where a ball was hit.
const geo_1 = require("./geo");
const pt = (f) => ({ latitude: f.lat, longitude: f.lon });
function centroid(fixes) {
    let la = 0;
    let lo = 0;
    for (const f of fixes) {
        la += f.lat;
        lo += f.lon;
    }
    return { latitude: la / fixes.length, longitude: lo / fixes.length };
}
/**
 * Finds places where the phone stayed within `radiusM` meters for at least `minMs`.
 * Readings arrive every few seconds; a stop ends as soon as one strays outside the radius.
 */
function detectStops(track, radiusM = 10, minMs = 20000) {
    const stops = [];
    let cluster = [];
    const close = () => {
        if (cluster.length >= 2 && cluster[cluster.length - 1].t - cluster[0].t >= minMs) {
            stops.push({ at: centroid(cluster), start: cluster[0].t, end: cluster[cluster.length - 1].t });
        }
    };
    for (const f of track) {
        if (cluster.length && (0, geo_1.distanceMeters)(centroid(cluster), pt(f)) > radiusM) {
            close();
            cluster = [];
        }
        cluster.push(f);
    }
    close();
    // GPS jitter can split one stop in two; join stops that are close in place and time.
    const merged = [];
    for (const s of stops) {
        const prev = merged[merged.length - 1];
        if (prev && (0, geo_1.distanceMeters)(prev.at, s.at) < radiusM && s.start - prev.end < 60000) {
            prev.end = s.end;
        }
        else {
            merged.push({ ...s });
        }
    }
    return merged;
}
/** Meters from `p` to the nearest point on a line through `path`. */
function distanceToPath(p, path) {
    if (!path.length)
        return Infinity;
    if (path.length === 1)
        return (0, geo_1.distanceMeters)(p, path[0]);
    let best = Infinity;
    for (let i = 1; i < path.length; i++) {
        const a = (0, geo_1.toLocal)(p, path[i - 1]);
        const b = (0, geo_1.toLocal)(p, path[i]);
        // p is the origin; find the closest point to it on segment a→b.
        const dx = b.e - a.e;
        const dy = b.n - a.n;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, -(a.e * dx + a.n * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(a.e + t * dx, a.n + t * dy));
    }
    return best;
}
/** Stops on this hole (near its line or green) that aren't already marked as a ball. */
function stopsForHole(stops, holePath, marked, nearM = 45) {
    return stops.filter((s) => distanceToPath(s.at, holePath) <= nearM && !marked.some((m) => (0, geo_1.distanceMeters)(m, s.at) < 8));
}
