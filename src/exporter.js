import { X509Certificate } from "node:crypto";

// Build the verification artifact from a signature.certificatePath array.
// This tool always writes a single leaf certificate, but certificatePath is an
// array per the CycloneDX spec, so SBOMs signed by other tools may contain more
// entries; all of them are emitted as PEM (leaf first), plus per-cert info.
//
// The output works for both verifiers:
//   - cdx-verify: Node's crypto extracts the public key from the first (leaf) certificate.
//   - openssl verify: a standard PEM certificate file.
export function exportChain(certificatePath) {
  if (!Array.isArray(certificatePath) || certificatePath.length === 0) {
    throw new Error("signature.certificatePath is missing or empty.");
  }

  const certs = certificatePath.map(
    (entry) => new X509Certificate(Buffer.from(entry, "base64url")),
  );

  const info = certs.map((c) => ({
    subject: c.subject,
    issuer: c.issuer,
    validTo: c.validTo,
  }));

  const chainPem = `${certs.map((c) => c.toString().trim()).join("\n")}\n`;

  return { chainPem, info };
}
