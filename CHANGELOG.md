# Changelog

## 1.3.0 - 2026-10-19

### Final 1.x release

- This is the last release of the 1.x line, and the line is deprecated. 2.3.0 has the
  same code and features and runs on Node.js >= 18, so move to it:
  `npm install @wynenterprise/sign-sbom@^2.3.0`.

### No dependencies

- RFC 8785 canonicalization is built in (`src/jcs.js`); the `canonicalize` 2.1.0
  dependency is removed, so the package has no runtime dependencies. Valid SBOMs give
  the same canonical bytes as 1.2.0, so signatures do not change.
- Changed: a string with a lone surrogate (malformed Unicode) is now rejected as RFC 8785
  section 3.2.2.2 requires; `canonicalize` 2.1.0 signed such input silently.

### Signing

- Input SBOMs saved as UTF-8 with a byte order mark (BOM) are accepted. The signed file
  is always written without a BOM, because `cdx-verify` cannot parse one.
- The signed file keeps the layout of the input: indentation (spaces or tabs, one-line
  stays one-line), LF/CRLF line endings and the final newline.
- Signing through a symbolic or hard link keeps the link and updates the file it points
  to (with a backup copy restored if the write fails).
- The token and certificate requests are retried on throttling (429) and transient 5xx,
  like sign requests.
- Every request to Azure times out after 30 s; timeouts and network errors are retried
  like transient 5xx. Before, a stalled connection could hang the run indefinitely.
- `Retry-After` below 30 s is honored with one extra second; longer values wait 30 s.

### Changed

- An unknown long option (for example a mistyped `--sngle`) is now an error instead of
  being taken as an input or output path. Short `-x` options are still accepted, for
  argument strings prepared for other tools.

## 1.2.0 - 2026-10-16

### Sign several SBOMs in one run

- `sign-sbom` accepts several inputs: plain paths, glob masks (`*`, `?`, `**`, `[abc]`,
  `{a,b}`), `@list.txt` file lists and `!exclusions`. The token and certificate are
  fetched once per run.
- New options: `--out-dir <dir>`, `--fail-fast`, `--concurrency <n>` (default 16, no
  upper limit). If Key Vault throttles (429) and a file fails after the retries, the
  error suggests lowering `--concurrency`.
- A failing file no longer aborts the others; the run ends with a summary and exit code 1.
- Key Vault sign requests are retried on 429 and transient 5xx with randomized backoff
  (honoring `Retry-After`); a 401 refreshes the token once.
- Output files are written atomically (temporary file + rename).
- `createSigner(env)` is available in `src/signer.js`; `signSbom` keeps its signature.
- Unchanged: one input signs in place, exactly two plain paths mean `input output`.
- Changed: with three or more positional arguments, earlier releases silently ignored
  everything after the second one; now every argument is an input and, without
  `--out-dir`, is signed in place.
- Changed: an argument that contains `*`, `?`, `[` or `{`, or starts with `@` or `!`,
  is treated as a mask, a file list or an exclusion. A mask-like name that exists as a
  file is still used as a plain path; `@` and `!` are always special.

## 1.1.0 - 2026-10-02

### Compatible with both `cdx-verify` generations

- A signed SBOM now verifies with **both** `cdx-verify` <= 12.8.4 and
  `cdx-verify` >= 12.8.5. Tested with `cdx-verify` 12.8.4 and 12.8.5 against a
  certificate in Azure Key Vault. cdxgen changed the signed content in 12.8.5
  (GHSA-7m2v-pj5r-fjww), so earlier sign-sbom releases produced signatures that
  `cdx-verify` >= 12.8.5 reported as invalid.
- Signed documents now carry two signatures in `signature.signers` (same key and
  certificate): one over the content without the `signature` property (accepted by
  `cdx-verify` <= 12.8.4) and one over the content with the signature metadata
  (accepted by `cdx-verify` >= 12.8.5). Each version accepts the signature that
  matches its rules.
- The output shape changed: code that reads `signature.value` directly must read
  `signature.signers[]`.
- New `--single` flag emits the previous single `signature` object (verifies on
  `cdx-verify` <= 12.8.4 only).
- `--export-key` reads `certificatePath` from `signature.signers` as well.
- Same change as 2.1.0 on the 2.x line; this line stays on Node.js >= 18.

## 1.0.5 - 2026-10-01

- No functional changes. CI: `publish.yml` now selects the npm dist-tag by major version
  (`legacy-1x` for 1.x releases, `latest` otherwise), so publishing a 1.x patch after a 2.x
  release no longer overwrites `latest` on npm.
- This is the maintenance line for Node.js 18-21. For Node.js >= 22, see the 2.x line.

## 1.0.4 - 2026-06-12

- No code changes; package contents are identical to 1.0.3.
- README: new "Without sign-sbom" section — extract the leaf certificate from a
  signed SBOM with standard Unix tools (`jq`, `tr`, `awk`, `fold`).
- Publishing switched to npm trusted publishing (OIDC): no npm token in CI,
  provenance attached automatically.

## 1.0.3 - 2026-06-11

- Sign CycloneDX SBOM JSON with an embedded signature (RS256) via Azure Key Vault.
- Export the signing certificate from a signed SBOM (`--export-key`) for use with `cdx-verify`.
- `signature.certificatePath` always contains the leaf certificate only.
- Clear, actionable error messages for missing files, invalid JSON, missing flag values, and Azure Key Vault API failures.
- Exact pin of the `canonicalize` dependency to keep signatures stable across installs.
