// Generated from the Boring Golf app (src/lib/geo.ts) by scripts/export-course-check.mjs. Don't edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AT_COURSE_METERS = exports.PIN_RADIUS_YARDS = exports.unitLabel = exports.metersToYards = void 0;
exports.distanceMeters = distanceMeters;
exports.distanceYards = distanceYards;
exports.formatDistance = formatDistance;
exports.centroid = centroid;
exports.greenDistances = greenDistances;
exports.greenOnOutline = greenOnOutline;
exports.insideRing = insideRing;
exports.onGreen = onGreen;
exports.clampToGreen = clampToGreen;
exports.atCourse = atCourse;
exports.bearing = bearing;
exports.teeAtYardage = teeAtYardage;
exports.projectOnPath = projectOnPath;
exports.teeForYardage = teeForYardage;
exports.snapToTeeBox = snapToTeeBox;
exports.assignTeeBoxes = assignTeeBoxes;
exports.toLocal = toLocal;
exports.fromLocal = fromLocal;
exports.midpoint = midpoint;
exports.regionFor = regionFor;
const EARTH_RADIUS_M = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
function distanceMeters(a, b) {
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
const metersToYards = (m) => m * 1.0936133;
exports.metersToYards = metersToYards;
function distanceYards(a, b) {
    return (0, exports.metersToYards)(distanceMeters(a, b));
}
/** Formats a yardage in the user's units, e.g. "152". */
function formatDistance(yards, units) {
    if (yards === undefined || !isFinite(yards))
        return '—';
    const v = units === 'meters' ? yards / 1.0936133 : yards;
    return String(Math.round(v));
}
const unitLabel = (units) => (units === 'meters' ? 'm' : 'yd');
exports.unitLabel = unitLabel;
function centroid(points) {
    let lat = 0;
    let lon = 0;
    for (const p of points) {
        lat += p.latitude;
        lon += p.longitude;
    }
    return { latitude: lat / points.length, longitude: lon / points.length };
}
/** Front, center and back of the green, measured from `from`. */
function greenDistances(from, center, outline) {
    if (!center)
        return {};
    const c = distanceYards(from, center);
    if (!outline || outline.length < 3)
        return { center: c };
    let min = Infinity;
    let max = -Infinity;
    for (const p of outline) {
        const d = distanceYards(from, p);
        if (d < min)
            min = d;
        if (d > max)
            max = d;
    }
    return { front: min, center: c, back: max };
}
/**
 * A green's middle that sits off its own outline (a horseshoe or crescent green, or a double
 * green shared by two holes) moves onto the green: the hole line's end if that's on it, else a
 * spot just inside the outline toward the old middle. With no such spot the outline is dropped.
 */
function greenOnOutline(geo) {
    const { green, greenOutline: ring } = geo;
    if (!green || !ring || ring.length < 3 || insideRing(green, ring))
        return geo;
    const end = geo.path?.[geo.path.length - 1];
    if (end && insideRing(end, ring))
        return { ...geo, green: end };
    for (const f of [0.25, 0.1, 0.5]) {
        for (const p of ring) {
            const q = { latitude: p.latitude + (green.latitude - p.latitude) * f, longitude: p.longitude + (green.longitude - p.longitude) * f };
            if (insideRing(q, ring))
                return { ...geo, green: q };
        }
    }
    return { ...geo, greenOutline: undefined };
}
function insideRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (a.latitude > p.latitude !== b.latitude > p.latitude &&
            p.longitude < ((b.longitude - a.longitude) * (p.latitude - a.latitude)) / (b.latitude - a.latitude) + a.longitude) {
            inside = !inside;
        }
    }
    return inside;
}
/** On the green: inside its mapped outline, or within 12 yards of the pin when there's no outline. */
function onGreen(p, pin, outline) {
    if (outline && outline.length > 2)
        return insideRing(p, outline);
    return distanceYards(p, pin) <= 12;
}
/** How far the pin can sit from the green's middle when the green has no mapped outline. */
exports.PIN_RADIUS_YARDS = 15;
/**
 * Keeps a pin on the green: a spot outside the mapped outline moves to the nearest point just
 * inside its edge. With no outline, the pin stays within PIN_RADIUS_YARDS of the green's middle.
 */
function clampToGreen(p, center, outline) {
    if (outline && outline.length > 2) {
        if (insideRing(p, outline))
            return p;
        const origin = center ?? centroid(outline);
        const q = toLocal(origin, p);
        const pts = outline.map((o) => toLocal(origin, o));
        let best = { e: pts[0].e, n: pts[0].n, d: Infinity };
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const de = b.e - a.e;
            const dn = b.n - a.n;
            const len2 = de * de + dn * dn;
            const t = len2 ? Math.max(0, Math.min(1, ((q.e - a.e) * de + (q.n - a.n) * dn) / len2)) : 0;
            const e = a.e + t * de;
            const n = a.n + t * dn;
            const d = (q.e - e) ** 2 + (q.n - n) ** 2;
            if (d < best.d)
                best = { e, n, d };
        }
        // A metre in from the edge, toward the middle, so it reads as on the green.
        const c = toLocal(origin, centroid(outline));
        const ce = c.e - best.e;
        const cn = c.n - best.n;
        const cl = Math.hypot(ce, cn) || 1;
        const step = Math.min(1, cl);
        const inner = fromLocal(origin, best.e + (ce / cl) * step, best.n + (cn / cl) * step);
        return insideRing(inner, outline) ? inner : fromLocal(origin, best.e, best.n);
    }
    if (!center)
        return p;
    const d = distanceYards(center, p);
    if (d <= exports.PIN_RADIUS_YARDS)
        return p;
    const { e, n } = toLocal(center, p);
    const k = exports.PIN_RADIUS_YARDS / d;
    return fromLocal(center, e * k, n * k);
}
/** GPS farther than this from every mapped part of the course means you aren't at the course. */
exports.AT_COURSE_METERS = 1000;
/**
 * Whether `p` is at the course: within AT_COURSE_METERS of its location or any mapped tee,
 * green or hole line. A course with nothing mapped counts as near, so GPS still works there.
 */
function atCourse(p, spots) {
    return !spots.length || spots.some((s) => distanceMeters(p, s) <= exports.AT_COURSE_METERS);
}
/** Compass bearing from a to b, in degrees (0 = north). */
function bearing(a, b) {
    const φ1 = toRad(a.latitude);
    const φ2 = toRad(b.latitude);
    const Δλ = toRad(b.longitude - a.longitude);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
/**
 * Where a set of tees sits on a hole: walks back from the green along the mapped hole line
 * until the remaining distance equals the scorecard `yards`. Mapped hole lines start at the
 * back tee, so shorter tees end up partway along. Returns the tee spot and the line from it.
 */
function teeAtYardage(path, yards) {
    const seg = path.slice(1).map((p, i) => distanceYards(path[i], p));
    const total = seg.reduce((a, b) => a + b, 0);
    // Within a few yards of the full length (or longer): it's the back tee.
    if (path.length < 2 || yards >= total - 3)
        return { tee: path[0], path };
    let skip = total - Math.max(0, yards);
    for (let i = 0; i < seg.length; i++) {
        if (skip <= seg[i]) {
            const t = seg[i] ? skip / seg[i] : 0;
            const a = path[i];
            const b = path[i + 1];
            const tee = { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
            return { tee, path: [tee, ...path.slice(i + 1)] };
        }
        skip -= seg[i];
    }
    return { tee: path[path.length - 1], path: [path[path.length - 1]] };
}
/**
 * Where `p` sits against a hole line: yards along the line to the closest point on it, yards
 * off the line, and the line's whole length.
 */
function projectOnPath(path, p) {
    let walked = 0;
    let best = { along: 0, off: Infinity };
    for (let i = 1; i < path.length; i++) {
        const a = toLocal(p, path[i - 1]);
        const b = toLocal(p, path[i]);
        const dx = b.e - a.e;
        const dy = b.n - a.n;
        const len2 = dx * dx + dy * dy;
        // Fraction along this segment of the point nearest p (p is the origin here).
        const t = len2 ? Math.max(0, Math.min(1, -(a.e * dx + a.n * dy) / len2)) : 0;
        const off = Math.hypot(a.e + dx * t, a.n + dy * t) / 0.9144;
        const segYards = Math.sqrt(len2) / 0.9144;
        if (off < best.off)
            best = { along: walked + segYards * t, off };
        walked += segYards;
    }
    return { ...best, total: walked };
}
/**
 * The tee spot for a set of tees: the mapped tee box whose distance to the green (to the hole
 * line, then along it) best matches the scorecard `yards`, when one is within 20 yards of it.
 * Otherwise the spot that far back along the hole line. Returns the spot and the line from it.
 */
function teeForYardage(path, yards, boxes = [], green) {
    // Scorecards measure to the middle of the green; the hole line often runs on past it.
    const target = green ?? path[path.length - 1];
    const end = projectOnPath(path, target).along;
    // Yards along the line to each point of it.
    const at = [0];
    for (let i = 1; i < path.length; i++)
        at.push(at[i - 1] + distanceYards(path[i - 1], path[i]));
    /**
     * A box's yardage the way a scorecard measures it: straight from the box to the line's next
     * bend, then along the line to the middle of the green (straight to the green if no bend is left).
     */
    const yardageOf = (box, along) => {
        const next = at.findIndex((a, i) => a > along + 1 && a < end - 1 && i < path.length - 1);
        return next < 0 ? distanceYards(box, target) : distanceYards(box, path[next]) + (end - at[next]);
    };
    let best;
    for (const box of boxes) {
        const { along } = projectOnPath(path, box);
        const diff = Math.abs(yardageOf(box, along) - yards);
        if (diff <= 20 && (!best || diff < best.diff))
            best = { box, along, diff };
    }
    if (!best) {
        const spot = teeAtYardage(path, yards);
        return snapToTeeBox(spot.tee, path, boxes) ?? spot;
    }
    return startAt(best.box, best.along, path);
}
/** The hole line starting from a tee box `along` yards down it: the box, then the line past it. */
function startAt(box, along, path) {
    let walked = 0;
    const ahead = [];
    for (let i = 1; i < path.length; i++) {
        walked += distanceYards(path[i - 1], path[i]);
        if (walked > along + 1)
            ahead.push(path[i]);
    }
    return { tee: box, path: [box, ...ahead] };
}
/**
 * Moves a tee spot onto the nearest mapped tee box within 25 yards (hole lines often start
 * beside the box, on a cart path), with the hole line starting from it. None close: undefined.
 */
function snapToTeeBox(spot, path, boxes = []) {
    let best;
    let bestD = 25;
    for (const box of boxes) {
        const d = distanceYards(spot, box);
        if (d < bestD) {
            best = box;
            bestD = d;
        }
    }
    return best ? startAt(best, projectOnPath(path, best).along, path) : undefined;
}
/**
 * Splits a course's mapped tee boxes among its holes: each box goes to the hole line it sits
 * closest to (within 50 yards), as long as it's in the first 60% of that hole, where tees are.
 */
function assignTeeBoxes(holes, boxes) {
    const lists = holes.map(() => []);
    for (const box of boxes) {
        let bestHole = -1;
        let bestOff = 50;
        holes.forEach((h, i) => {
            const path = h.geo?.path;
            if (!path || path.length < 2)
                return;
            const { along, off, total } = projectOnPath(path, box);
            if (off < bestOff && along <= total * 0.6) {
                bestOff = off;
                bestHole = i;
            }
        });
        if (bestHole >= 0)
            lists[bestHole].push(box);
    }
    return holes.map((h, i) => (lists[i].length && h.geo ? { ...h, geo: { ...h.geo, tees: lists[i] } } : h));
}
/** Meters east and north of `origin` (flat-earth; fine over a golf hole). */
function toLocal(origin, p) {
    const cosLat = Math.cos(toRad(origin.latitude));
    return {
        e: toRad(p.longitude - origin.longitude) * EARTH_RADIUS_M * cosLat,
        n: toRad(p.latitude - origin.latitude) * EARTH_RADIUS_M,
    };
}
function fromLocal(origin, e, n) {
    const cosLat = Math.cos(toRad(origin.latitude));
    return {
        latitude: origin.latitude + (n / EARTH_RADIUS_M) * (180 / Math.PI),
        longitude: origin.longitude + (e / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI),
    };
}
function midpoint(a, b) {
    return { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 };
}
function regionFor(points, padding = 1.35) {
    const lats = points.map((p) => p.latitude);
    const lons = points.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLon + maxLon) / 2,
        latitudeDelta: Math.max((maxLat - minLat) * padding, 0.0015),
        longitudeDelta: Math.max((maxLon - minLon) * padding, 0.0015),
    };
}
