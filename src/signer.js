import canonicalize from "canonicalize";
import { sha256, toBase64Url, stdToBase64Url } from "./crypto.js";
import { getToken, getCertInfo, kvSign } from "./keyvault.js";

// Produce a signed copy of the SBOM object with an embedded CycloneDX signature.
// certificatePath always contains the leaf certificate only.
//
// cdxgen changed what is signed in 12.8.5, so one signature cannot satisfy both
// cdx-verify generations. By default the SBOM carries a JSF `signers` array with
// two independent signatures made with the same key:
//   legacy (cdx-verify <= 12.8.4): the whole `signature` property is excluded;
//   current (cdx-verify >= 12.8.5): the entry's own metadata stays in the signed
//     content as {signature: {signers: [entry without value]}}.
// Each verifier accepts the entry that matches its rules. With `single`, only the
// legacy single-object signature is produced (verifies on cdx-verify <= 12.8.4).
// Both: canonicalize (RFC 8785) -> SHA-256 -> RS256 sign -> base64url value.
export async function signSbom(bom, env, { single = false } = {}) {
  const token = await getToken(env);
  const { kid, cer } = await getCertInfo({ ...env, token });
  const certificatePath = [stdToBase64Url(cer)];

  // Exclude any existing signature before canonicalizing (no duplicate on re-sign).
  const { signature: _existing, ...dataToSign } = bom;

  const signView = async (view) => {
    const canonical = canonicalize(view);
    const digest = sha256(Buffer.from(canonical, "utf8"));
    return kvSign({ kid, token, digestB64Url: toBase64Url(digest) });
  };

  const meta = { algorithm: "RS256", keyId: kid, certificatePath };
  const legacyValue = await signView(dataToSign);

  if (single) {
    return { ...dataToSign, signature: { ...meta, value: legacyValue } };
  }

  const currentValue = await signView({
    ...dataToSign,
    signature: { signers: [meta] },
  });

  return {
    ...dataToSign,
    signature: {
      signers: [
        { ...meta, value: legacyValue },
        { ...meta, value: currentValue },
      ],
    },
  };
}
