# Changelog

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
