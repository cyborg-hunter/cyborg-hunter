# Vendored lab.js 23.0.0-alpha9 (test fixture)

Unmodified `dist/umd/lab.js` from the `lab.js` 23.0.0-alpha9 npm package (UMD,
defines the global `lab`; `lab.version` reads `23.0.0-alpha9`). It is the
flip-generation line the builder on `main` targets; API not settled. Used only by
tests: `tests/oneliner/labjs-real.test.js` runs the one-line setup against real
lab.js under happy-dom, and the Playwright fixture pages in
`tests/e2e/oneliner/fixtures/labjs-*.html` load it in a real browser. `lab.css`
is not vendored: no test depends on lab.js's styling.

Source: https://github.com/FelixHenninger/lab.js. License: Apache-2.0 (full text in
LICENSE; third-party notices from the build in LICENSE-third-party.txt), copyright
(c) 2015- Felix Henninger. These files are not shipped in the npm package (`files`
in package.json does not include `tests/`).

Fetched with `npm pack lab.js@23.0.0-alpha9`; the tarball's sha1 is
`31be661c2becf1a36eeb8bba2cc30720b9b2f45a`, the registry's `dist.shasum`.
`LICENSE` is the package's `license` file and `LICENSE-third-party.txt` its
`dist/umd/lab.js.LICENSE.txt`, which the banner of `lab.js` points to.
