# Building the Testing Portal

Needs Node.js 18 or newer. Nothing is downloaded: the build tools are in `tools/vendor/`.

```
node tools/build.js             # compile rules, run tests, build dist/
node tools/build.js --no-tests  # the same without the tests
node tests/run-tests.js         # only the tests (needs a build first)
node tools/update-catalogue.js  # Catalogue page: docs/reference/validation-catalogue.md → config/catalogue-doc.json
```

**A new version of the catalogue document:** export it as Markdown (the document's Export menu), save it as `docs/reference/validation-catalogue.md`, run `node tools/update-catalogue.js`, then build. The tests fail if `config/catalogue-doc.json` is not the current conversion or if its checks differ from `config/catalogue.json`.

Output:
- `dist/site/` – the separate files, for GitHub Pages later or `python -m http.server`.
- `dist/testing-portal.html` – the same app as one file, for offline use.

The build stops with an error if a test fails.

## Publishing on GitHub Pages

`.github/workflows/build-and-deploy.yml` runs the same build on every push to `main` and publishes `dist/site/` to GitHub Pages if the tests pass (about 5 minutes).

1. Repository `testing-portal` in the organisation, **private** (only the people given access can open the site) or internal (everyone in the enterprise).
2. Push the source folder to `main` (`.gitattributes` keeps every file as it is; `.gitignore` keeps `dist/` and `tests/files/bank/` out). Check that `tools/vendor/node_modules` is committed (about 640 files): a global gitignore can leave it out, then `git add -f tools/vendor/node_modules`.
3. Settings › Pages: Source **GitHub Actions**, visibility **Private**. Then Settings › Secrets and variables › Actions › Variables: add `DEPLOY_PAGES` = `true`, and Actions › Build and deploy › Run workflow. Without the variable every push still builds and tests, and the offline file can be downloaded from the run (Artifacts: `testing-portal-offline`), but nothing is published.
4. Open the address shown under Settings › Pages, then About › Technical check: "Runs as: Web server", 10 of 10 checks.
5. Access: give the service desk team Read access to the repository.

**An update:** delete everything in the folder except `.git`, unzip the new source zip into it, then `git add -A`, `git commit`, `git push`.

**Updating a third-party library** (rare): `lib/libxml2/libxml2-wasm.esm.js` and `lib/saxes/saxes.bundle.js` were made with esbuild from the npm packages in `tools/vendor/node_modules`; `lib/saxon/SaxonJS2N.js` is a copy of the npm package `saxon-js` 2.7.0, unchanged. See `docs/ARCHITECTURE.md`, section 8.
