# @wynenterprise/sign-sbom

Sign a [CycloneDX](https://cyclonedx.org/) SBOM JSON file with an **embedded
signature** using a private key held in **Azure Key Vault**. The key never leaves
the vault — signing is performed by the Key Vault REST API.

**A signed SBOM verifies with both `cdx-verify` generations:** `<= 12.8.4` and `>= 12.8.5`
(tested with 12.8.4 and 12.8.5). See [Output](#output).

The signature format and algorithm are byte-compatible with cdxgen `cdx-verify`:

1. Strip any existing `signature` property from the document.
2. Canonicalize the JSON per [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785).
3. SHA-256 the canonical bytes.
4. Sign the digest with **RS256** (RSASSA-PKCS1-v1.5) via Azure Key Vault.
5. Embed the base64url result as `value`, together with the signing `keyId` and
   the leaf certificate in `certificatePath`.

cdxgen changed what is signed in 12.8.5, so by default the document gets
**two signatures** (JSF `signature.signers`, same key): one over the content
without the `signature` property (verified by `cdx-verify` <= 12.8.4) and one
over the content with the signature metadata (verified by `cdx-verify` >= 12.8.5).
Each version accepts the signature that matches its rules. See [Output](#output).

The result verifies cleanly with both `cdx-verify` and standard OpenSSL tooling.

## Install

```bash
npm install -g @wynenterprise/sign-sbom
```

This provides the `sign-sbom` command. You can also run it without installing:

```bash
npx @wynenterprise/sign-sbom <file.json>
```

## Requirements

- **Node.js >= 22** — uses the global `fetch` API (no extra HTTP dependency).
- An **Azure service principal** with the Key Vault **`keys/sign`** permission on
  the target certificate's key.
- A certificate (with an RSA key) stored in Azure Key Vault.

The only runtime dependency is [`canonicalize`](https://www.npmjs.com/package/canonicalize)
(RFC 8785 implementation, zero transitive dependencies).

## Compatibility

Version 2.x requires Node.js >= 22 and uses `canonicalize` 5.1.0, which rejects malformed
Unicode input (lone surrogates) per RFC 8785 §3.2.2.2 instead of silently signing
non-conformant canonical output.

For Node.js 18-21, use the 1.x line instead:

```bash
npm install @wynenterprise/sign-sbom@^1
```

## Configuration

Credentials can be supplied through **environment variables** or **CLI flags**.
CLI flags take precedence over environment variables when both are present.

| Environment variable  | CLI flag | Description                                  |
| --------------------- | -------- | -------------------------------------------- |
| `AZURE_TENANT_ID`     | `-kvt`   | AAD tenant id                                |
| `AZURE_CLIENT_ID`     | `-kvi`   | Service principal app id                     |
| `AZURE_CLIENT_SECRET` | `-kvs`   | Service principal secret                     |
| `AZURE_VAULT_URI`     | `-kvu`   | e.g. `https://my-vault.vault.azure.net`      |
| `AZURE_CERT_NAME`     | `-kvc`   | Certificate name in the vault                |

All five values are required for signing. They are **not** needed for exporting
the public key (see below). See [.env.example](./.env.example) for a template.

## Usage

```text
sign-sbom <file.json> [signedfile.json] [--single]
sign-sbom <signedfile.json> --export-key [output]
sign-sbom --help
```

### Sign with environment variables

```bash
export AZURE_TENANT_ID=...
export AZURE_CLIENT_ID=...
export AZURE_CLIENT_SECRET=...
export AZURE_VAULT_URI=https://my-vault.vault.azure.net
export AZURE_CERT_NAME=my-certificate

# Sign in place (no output argument):
sign-sbom bom.json

# Or write the signed copy to a new file:
sign-sbom bom.json signed.json
```

### Sign with CLI flags

Useful in CI or when you do not want credentials in the environment:

```bash
sign-sbom bom.json signed.json \
  -kvt <tenant-id> \
  -kvi <client-id> \
  -kvs <client-secret> \
  -kvu https://my-vault.vault.azure.net \
  -kvc my-certificate
```

On success the command prints the output path and the signing key id:

```text
Signed: signed.json
keyId:  https://my-vault.vault.azure.net/keys/my-certificate/<version>
```

## Output

By default the tool adds a `signature` object with two signers. Both use the same
key and certificate; only the signed content differs:

```json
"signature": {
  "signers": [
    {
      "algorithm": "RS256",
      "keyId": "https://<vault>/keys/<name>/<version>",
      "value": "<base64url RSA signature, content without signature>",
      "certificatePath": ["<base64url DER leaf certificate>"]
    },
    {
      "algorithm": "RS256",
      "keyId": "https://<vault>/keys/<name>/<version>",
      "value": "<base64url RSA signature, content with signature metadata>",
      "certificatePath": ["<base64url DER leaf certificate>"]
    }
  ]
}
```

| `cdx-verify` version | Accepted signer |
| -------------------- | --------------- |
| <= 12.8.4            | first           |
| >= 12.8.5            | second          |

With `--single` the tool emits the previous single object instead (verifies on
`cdx-verify` <= 12.8.4 only; `cdx-verify` >= 12.8.5 reports it as invalid):

```json
"signature": {
  "algorithm": "RS256",
  "keyId": "https://<vault>/keys/<name>/<version>",
  "value": "<base64url RSA signature>",
  "certificatePath": ["<base64url DER leaf certificate>"]
}
```

Code that reads `signature.value` directly must read `signature.signers[]`
instead (or use `--single`).

Re-signing an already-signed document strips the existing `signature` first, so
the property is never duplicated and the signature always covers the same
canonical content.

## Export the public key

Extract the public key (leaf certificate) from a signed SBOM into a file for use
with `cdx-verify`. **No Azure credentials are needed** — the certificate is read
straight from `certificatePath` in the signature (`signature.signers[0]` for
the default two-signer output).

```bash
sign-sbom signed.json --export-key public.key
```

It prints the certificate subject, issuer, and expiry, then writes the PEM to
`public.key` (or the path you pass as `[output]`).

### Without sign-sbom

The leaf certificate can also be extracted with standard Unix tools — `jq`,
`tr`, `awk`, and `fold` — no sign-sbom required. The value is base64url without
padding, so the pipeline converts it to standard base64 and restores the `=`
padding before wrapping it in PEM markers:

```bash
{ printf '%s\n' '-----BEGIN CERTIFICATE-----';
  jq -r '(.signature.certificatePath // .signature.signers[0].certificatePath)[0]' signed.json | tr '_-' '/+' |
  awk '{ while (length($0) % 4) $0 = $0 "="; print }' | fold -w64;
  printf '%s\n' '-----END CERTIFICATE-----'; } > public.key
```

The result is the same PEM certificate as `--export-key` produces and works
with `cdx-verify` and `openssl` alike.

## Verify

Full verification has **two independent parts**:

1. **Signature integrity** — the document was not modified and was signed by the
   key that belongs to this certificate.
2. **Certificate trust** — that certificate really is who it claims to be (valid,
   not expired, issued by a trusted CA, intended for code/document signing).

`cdx-verify` covers part 1 only. Part 2 is a standard X.509 check with OpenSSL.
Both matter: a signature can be cryptographically valid while the certificate is
expired, self-signed, or untrusted.

### 1. Verify the signature

`cdx-verify` checks the cryptographic signature against the exported public key:

```bash
npx -p @cyclonedx/cdxgen cdx-verify -i signed.json --public-key public.key
```

A successful run reports:

```text
✓ Signature is valid! (Matched KeyId: 'https://<vault>/keys/<name>/<version>')
```

This works with any `cdx-verify` version for the default output. This proves the
canonical SBOM bytes match a signature value for the public key embedded in the
certificate — but it says nothing about whether that certificate
is trustworthy.

### 2. Verify the certificate

The exported `public.key` is the **leaf X.509 certificate** in PEM. Inspect its
identity, validity window, and intended usage:

```bash
openssl x509 -in public.key -noout -subject -issuer -dates -purpose
```

Then confirm it chains to a trusted Certificate Authority. The export contains the
leaf certificate only, so supply the issuing CA chain (intermediate + root,
obtained from your CA — e.g. GlobalSign) as a PEM bundle:

```bash
openssl verify -CAfile ca-chain.pem public.key
```

A trusted, in-date certificate reports:

```text
public.key: OK
```

`openssl verify` fails if the certificate is expired, self-signed, or does not
chain to a CA in `ca-chain.pem`.

### End-to-end example

```bash
# 1. Sign
sign-sbom bom.json signed.json

# 2. Export the certificate (public key) from the signed document
sign-sbom signed.json --export-key public.key

# 3. Verify the signature
npx -p @cyclonedx/cdxgen cdx-verify -i signed.json --public-key public.key

# 4. Verify the certificate identity and trust chain
openssl x509 -in public.key -noout -subject -issuer -dates -purpose
openssl verify -CAfile ca-chain.pem public.key
```

## Troubleshooting

| Symptom                              | Cause / fix                                                         |
| ------------------------------------ | ------------------------------------------------------------------- |
| `Missing required parameters: ...`   | One or more credentials are not set. Provide them via env or flags. |
| `Token request failed: 401`          | Wrong tenant/client id or client secret.                            |
| `Key Vault sign failed: 403`         | The service principal lacks the `keys/sign` permission.             |
| `cdx-verify` reports an invalid sig  | The document changed after signing. Re-sign, then re-export the key. |
| `cdx-verify` >= 12.8.5 invalid sig   | Signed with `--single` or with sign-sbom < 1.1.0 / < 2.1.0. Re-sign without `--single`. |

## How it works

- `src/keyvault.js` — minimal Azure Key Vault REST client (client-credentials
  OAuth flow, get certificate, sign digest).
- `src/signer.js` — strips the old signature, canonicalizes (RFC 8785), hashes,
  requests the RS256 signatures (two over different signed content, or one with
  `--single`), and assembles the `signature` object.
- `src/crypto.js` — SHA-256 and base64url helpers.
- `src/exporter.js` — reads `certificatePath` and emits the PEM public key.

## License

[MIT](./LICENSE)
