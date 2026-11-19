# Boring Golf course data

Builds the hole maps the Boring Golf app downloads: one small JSON file per US golf course
that has holes mapped in OpenStreetMap.

- **Where it runs:** GitHub Actions, every Monday (or on demand from the Actions tab).
- **What it does:** downloads the US map extract from Geofabrik, keeps only golf courses, holes
  and greens (`osmium`), and turns them into course files (`build.mjs`).
- **Where the files go:** GitHub Pages, at `https://<your-github-name>.github.io/boring-golf-data/c/w<way id>.json`
  (or `r<relation id>.json`). The app's `extra.courseDataUrl` in `app.json` points at this.
- **Cost:** free on a public repository.

## Course check

Every build runs each course through the app's own check (`appcheck/`, copied from the app with
`npm run export-course-check` there): every hole of its 9 or 18 mapped, each with a tee, a green and
a believable length, and a simulated strokes gained round (birdie, par, bogey and double on every
hole) that places the shots, lands on the green and scores. First it fixes what it can:

- no par, or a par that can't be right for the hole's length: the par comes from the length
- a hole drawn from the green back to the tee: turned around
- a green whose middle isn't on its outline: the middle moved onto the green

A course that still fails is published as `{ "unavailable": true, "problems": [...] }`, and the app
says "Sorry, this course is not yet available." `course-check.json` and `course-check.csv` list the
fixed and unavailable courses each week.

## License

The course files are derived from OpenStreetMap data, © OpenStreetMap contributors, available under
the Open Database License (ODbL 1.0). The published files must stay available under the ODbL with
that attribution; this repository being public covers that.

## Test locally

```
node test/test.mjs
```

`test/pinehurst.geojsonseq` is real OpenStreetMap data around Pinehurst, NC. Regenerate it with
`node test/make-fixture.mjs`.
