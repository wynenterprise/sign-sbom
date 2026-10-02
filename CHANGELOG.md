# Changelog

This file covers the 2.x line (Node.js >= 22). The 1.x line (Node.js >= 18) keeps its
own changelog on the `1.x` branch.

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
