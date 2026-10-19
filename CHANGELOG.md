# Changelog

This file covers the 2.x line. Up to 2.2.0 it required Node.js >= 22 and the 1.x line
(Node.js >= 18, own changelog on the `1.x` branch) served older Node.js; since 2.3.0
the 2.x line runs on Node.js >= 18.

## 2.3.0 - 2026-10-19

### No dependencies, Node.js 18 and later

- RFC 8785 canonicalization is built in (`src/jcs.js`); the `canonicalize` dependency
  is removed, so the package has no runtime dependencies. The canonical bytes are
  identical to 2.2.0 (checked against `canonicalize` 5.1.0), so signatures do not change.
- Node.js >= 18 is supported again (`engines.node` lowered from `>=22`). The 1.x line is
  no longer needed.

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

## 2.2.0 - 2026-10-16

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

## 2.1.0 - 2026-10-02

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

## 2.0.0 - 2026-09-28

### BREAKING CHANGES

- `canonicalize` dependency bumped 2.1.0 -> 5.1.0. Signing now throws on malformed Unicode
  input (lone surrogates) instead of silently signing non-conformant canonical output, per
  RFC 8785 §3.2.2.2.
- `engines.node` raised from `>=18` to `>=22` (required by `canonicalize` 5.1.0).
- For Node.js 18-21, use the 1.x line: `npm install @wynenterprise/sign-sbom@^1`.

Signature output and `cdx-verify` compatibility are unaffected for well-formed CycloneDX SBOM
data: canonical output is byte-identical to 1.x for typical documents.
