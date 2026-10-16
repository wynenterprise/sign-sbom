import canonicalize from "canonicalize";
import { sha256, toBase64Url, stdToBase64Url } from "./crypto.js";
import { getToken, getCertInfo, kvSign } from "./keyvault.js";

// Fetch the token and certificate once and return a signer reusable for many SBOMs.
// sign(bom, { single }) produces a signed copy of the SBOM object with an embedded
// CycloneDX signature. certificatePath always contains the leaf certificate only.
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
export async function createSigner(env) {
  let token = await getToken(env);
  const { kid, cer } = await getCertInfo({ ...env, token });
  const certificatePath = [stdToBase64Url(cer)];
  const meta = { algorithm: "RS256", keyId: kid, certificatePath };

  // One refresh at a time: concurrent 401s share a single token request.
  let refreshing = null;
  const refreshToken = (stale) => {
    if (token !== stale) return Promise.resolve();
    refreshing ??= getToken(env)
      .then((t) => {
        token = t;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  const signDigest = async (digestB64Url) => {
    const used = token;
    try {
      return await kvSign({ kid, token: used, digestB64Url });
    } catch (e) {
      if (e.status !== 401) throw e;
      await refreshToken(used);
      return kvSign({ kid, token, digestB64Url });
    }
  };

  const signView = (view) => {
    const canonical = canonicalize(view);
    const digest = sha256(Buffer.from(canonical, "utf8"));
    return signDigest(toBase64Url(digest));
  };

  const sign = async (bom, { single = false } = {}) => {
    // Exclude any existing signature before canonicalizing (no duplicate on re-sign).
    const { signature: _existing, ...dataToSign } = bom;

    if (single) {
      const value = await signView(dataToSign);
      return { ...dataToSign, signature: { ...meta, value } };
    }

    const [legacyValue, currentValue] = await Promise.all([
      signView(dataToSign),
      signView({ ...dataToSign, signature: { signers: [meta] } }),
    ]);

    return {
      ...dataToSign,
      signature: {
        signers: [
          { ...meta, value: legacyValue },
          { ...meta, value: currentValue },
        ],
      },
    };
  };

  return { keyId: kid, sign };
}

// One-shot helper kept for programmatic callers: fetches token and certificate per call.
export async function signSbom(bom, env, opts) {
  const signer = await createSigner(env);
  return signer.sign(bom, opts);
}
