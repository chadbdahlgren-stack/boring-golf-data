// Generated from the Boring Golf app (src/lib/courseData.ts) by scripts/export-course-check.mjs. Don't edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.courseDataHoles = courseDataHoles;
exports.parseCourseFile = parseCourseFile;
// Boring Golf's own course files, built monthly from OpenStreetMap (see course-data/).
const geo_1 = require("./geo");
const pt = ([latitude, longitude]) => ({ latitude, longitude });
let siteLive;
/** Whether the data site is published (its index.json loads). Checked once per app launch. */
function dataSiteLive(base) {
    siteLive ??= fetch(`${base}/index.json`)
        .then((r) => r.ok)
        .catch(() => {
        siteLive = undefined; // try again next time
        return false;
    });
    return siteLive;
}
/**
 * Hole maps for a course from the Boring Golf data server.
 * Returns no holes when the course has no mapped holes (the file doesn't exist),
 * and throws when the server can't be reached, so callers can try another source.
 */
async function courseDataHoles(baseUrl, osmType, osmId) {
    const base = baseUrl.replace(/\/$/, '');
    const url = `${base}/c/${osmType === 'way' ? 'w' : 'r'}${osmId}.json`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
        const res = await fetch(url, { signal: ctl.signal });
        if (res.status === 404) {
            // Only a missing file on a live site means "no mapped holes"; otherwise use another source.
            if (await dataSiteLive(base))
                return { holes: [] };
            throw new Error('course data site not published');
        }
        if (!res.ok)
            throw new Error(`course data ${res.status}`);
        const data = await res.json();
        // The weekly build checks every course and marks the ones whose maps it couldn't fix.
        // (Those files carry the problems found instead of holes.)
        if (data.unavailable)
            return { holes: [], unavailable: true };
        return { holes: parseCourseFile(data) };
    }
    finally {
        clearTimeout(timer);
    }
}
/** Turns a course file (as published by course-data/build.mjs) into the app's holes. */
function parseCourseFile(data) {
    const holes = data.holes.map((h) => {
        const path = h.path.map(pt);
        return {
            number: h.n,
            par: h.par,
            handicap: h.hcp,
            yards: h.yd,
            geo: { tee: path[0], green: pt(h.green), greenOutline: h.outline?.map(pt), path },
        };
    });
    // Files built since tee boxes were added list them for the whole course.
    return (0, geo_1.assignTeeBoxes)(holes, (data.tees ?? []).map(pt));
}
