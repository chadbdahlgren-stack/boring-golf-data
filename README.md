# Boring Golf course data

Builds the hole maps the Boring Golf app downloads: one small JSON file per US golf course
that has holes mapped in OpenStreetMap.

- **Where it runs:** GitHub Actions, on the 3rd of every month (or on demand from the Actions tab).
- **What it does:** downloads the US map extract from Geofabrik, keeps only golf courses, holes
  and greens (`osmium`), and turns them into course files (`build.mjs`).
- **Where the files go:** GitHub Pages, at `https://<your-github-name>.github.io/boring-golf-data/c/w<way id>.json`
  (or `r<relation id>.json`). The app's `extra.courseDataUrl` in `app.json` points at this.
- **Cost:** free on a public repository.

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
