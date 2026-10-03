# Vendored lab.js 20.2.4 (test fixture)

Unmodified `dist/lab.js` from the `lab.js` 20.2.4 npm package (UMD, defines the
global `lab`; `lab.version` reads `20.2.4`). Its byte size and version string
match the `lib/lab.js` the hosted builder exports (compared by size and version,
not by hash). Used only by tests: `tests/oneliner/labjs-real.test.js` runs the
one-line setup against real lab.js under happy-dom. `lab.css` is not vendored:
no test depends on lab.js's styling.

Source: https://github.com/FelixHenninger/lab.js. License: Apache-2.0 (full text in
LICENSE; third-party notices from the build in LICENSE-third-party.txt), copyright
(c) 2015- Felix Henninger. These files are not shipped in the npm package (`files`
in package.json does not include `tests/`).

Fetched with `npm pack lab.js@20.2.4`; the tarball's sha1 is
`6bab44ae06e7311735ceed3b00b2b5799d36afc4`, the registry's `dist.shasum`.
`LICENSE` is the package's `license` file and `LICENSE-third-party.txt` its
`dist/lab.js.LICENSE.txt`, which the banner of `lab.js` points to.
