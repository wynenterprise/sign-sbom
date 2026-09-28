# Changelog

## 2.0.0 - 2026-09-28

### BREAKING CHANGES

- `canonicalize` dependency bumped 2.1.0 -> 5.1.0. Signing now throws on malformed Unicode
  input (lone surrogates) instead of silently signing non-conformant canonical output, per
  RFC 8785 §3.2.2.2.
- `engines.node` raised from `>=18` to `>=22` (required by `canonicalize` 5.1.0).
- For Node.js 18-21, use the 1.x line: `npm install @wynenterprise/sign-sbom@^1`.

Signature output and `cdx-verify` compatibility are unaffected for well-formed CycloneDX SBOM
data: canonical output is byte-identical to 1.x for typical documents.

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
