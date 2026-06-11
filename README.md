# @wynenterprise/sign-sbom

Sign a [CycloneDX](https://cyclonedx.org/) SBOM JSON file with an **embedded
signature** using a private key held in **Azure Key Vault**. The key never leaves
the vault — signing is performed by the Key Vault REST API.

The signature format and algorithm are byte-compatible with cdxgen `cdx-verify`:

1. Strip any existing `signature` property from the document.
2. Canonicalize the JSON per [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785).
3. SHA-256 the canonical bytes.
4. Sign the digest with **RS256** (RSASSA-PKCS1-v1.5) via Azure Key Vault.
5. Embed the base64url result as `signature.value`, together with the signing
   `keyId` and the leaf certificate in `signature.certificatePath`.

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

- **Node.js >= 18** — uses the global `fetch` API (no extra HTTP dependency).
- An **Azure service principal** with the Key Vault **`keys/sign`** permission on
  the target certificate's key.
- A certificate (with an RSA key) stored in Azure Key Vault.

The only runtime dependency is [`canonicalize`](https://www.npmjs.com/package/canonicalize)
(RFC 8785 implementation, zero transitive dependencies).

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
sign-sbom <file.json> [signedfile.json]
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

The tool adds a `signature` object to the document:

```json
"signature": {
  "algorithm": "RS256",
  "keyId": "https://<vault>/keys/<name>/<version>",
  "value": "<base64url RSA signature>",
  "certificatePath": ["<base64url DER leaf certificate>"]
}
```

Re-signing an already-signed document strips the existing `signature` first, so
the property is never duplicated and the signature always covers the same
canonical content.

## Export the public key

Extract the public key (leaf certificate) from a signed SBOM into a file for use
with `cdx-verify`. **No Azure credentials are needed** — the certificate is read
straight from `signature.certificatePath`.

```bash
sign-sbom signed.json --export-key public.key
```

It prints the certificate subject, issuer, and expiry, then writes the PEM to
`public.key` (or the path you pass as `[output]`).

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

This proves the canonical SBOM bytes match `signature.value` for the public key
embedded in the certificate — but it says nothing about whether that certificate
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

## How it works

- `src/keyvault.js` — minimal Azure Key Vault REST client (client-credentials
  OAuth flow, get certificate, sign digest).
- `src/signer.js` — strips the old signature, canonicalizes (RFC 8785), hashes,
  requests the RS256 signature, and assembles the `signature` object.
- `src/crypto.js` — SHA-256 and base64url helpers.
- `src/exporter.js` — reads `certificatePath` and emits the PEM public key.

## License

[MIT](./LICENSE)
