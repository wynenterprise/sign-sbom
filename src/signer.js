import canonicalize from "canonicalize";
import { sha256, toBase64Url, stdToBase64Url } from "./crypto.js";
import { getToken, getCertInfo, kvSign } from "./keyvault.js";

// Produce a signed copy of the SBOM object with an embedded CycloneDX signature.
// Algorithm matches cdxgen (lib/helpers/bomSigner.js):
//   strip signature -> RFC 8785 canonicalize -> SHA-256 -> RS256 sign -> base64url value.
// certificatePath always contains the leaf certificate only.
export async function signSbom(bom, env) {
  const token = await getToken(env);
  const { kid, cer } = await getCertInfo({ ...env, token });
  const certificatePath = [stdToBase64Url(cer)];

  // Exclude any existing signature before canonicalizing (no duplicate on re-sign).
  const { signature: _existing, ...dataToSign } = bom;

  const canonical = canonicalize(dataToSign);
  const digest = sha256(Buffer.from(canonical, "utf8"));
  const value = await kvSign({ kid, token, digestB64Url: toBase64Url(digest) });

  return {
    ...dataToSign,
    signature: { algorithm: "RS256", keyId: kid, value, certificatePath },
  };
}
