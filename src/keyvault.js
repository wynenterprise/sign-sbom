// Minimal Azure Key Vault REST client (client-credentials flow).
// Ported 1:1 from lib/KeyVaultClient.ps1.

const API_VERSION = "7.4";
const MAX_ERROR_BODY = 300;

// Trim API error bodies so exceptions stay readable and do not dump full responses.
async function errorBody(res) {
  const text = await res.text();
  return text.length > MAX_ERROR_BODY ? `${text.slice(0, MAX_ERROR_BODY)}...` : text;
}

function vaultBaseUri(vaultUri) {
  if (!/^https:\/\//i.test(vaultUri)) {
    throw new Error(`AZURE_VAULT_URI must be an https:// URL, got: ${vaultUri}`);
  }
  return vaultUri.replace(/\/+$/, "");
}

// Acquire an AAD access token for the Key Vault scope.
export async function getToken({ tenantId, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://vault.azure.net/.default",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await errorBody(res)}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new Error("Token response did not contain access_token.");
  }
  return json.access_token;
}

// Resolve the signing key id (kid) and leaf certificate (cer, std-base64 DER).
export async function getCertInfo({ vaultUri, certName, token }) {
  const uri =
    `${vaultBaseUri(vaultUri)}/certificates/` +
    `${encodeURIComponent(certName)}?api-version=${API_VERSION}`;
  const res = await fetch(uri, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Get certificate failed: ${res.status} ${await errorBody(res)}`);
  }
  const json = await res.json();
  if (!json.kid || !json.cer) {
    throw new Error("Certificate response did not contain kid and cer.");
  }
  return { kid: json.kid, cer: json.cer };
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 30_000;

// Retry-After is a floor (a little jitter is added on top); without it the delay is
// exponential with jitter, so throttled requests do not come back in one wave.
function retryDelayMs(res, attempt) {
  const header = res.headers.get("retry-after");
  const seconds = header === null || header.trim() === "" ? NaN : Number(header);
  const ms =
    Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000 + Math.random() * 500
      : 500 * 2 ** attempt * (0.5 + Math.random() * 0.5);
  return Math.min(ms, MAX_RETRY_DELAY_MS);
}

// Sign a pre-computed SHA-256 digest (base64url) with RS256. Returns base64url signature.
// Throttling (429) and transient 5xx responses are retried with backoff.
// A failed call throws an Error carrying the HTTP status in `status`.
export async function kvSign({ kid, token, digestB64Url }) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${kid}/sign?api-version=${API_VERSION}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ alg: "RS256", value: digestB64Url }),
    });
    if (res.ok || !RETRY_STATUS.has(res.status) || attempt + 1 >= MAX_ATTEMPTS) break;
    await res.arrayBuffer(); // drain before retrying
    await new Promise((r) => setTimeout(r, retryDelayMs(res, attempt)));
  }
  if (!res.ok) {
    const err = new Error(`Key Vault sign failed: ${res.status} ${await errorBody(res)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  if (!json.value) {
    throw new Error("Sign response did not contain a signature value.");
  }
  return json.value;
}
