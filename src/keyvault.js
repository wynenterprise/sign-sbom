// Minimal Azure Key Vault REST client (client-credentials flow).

const API_VERSION = "7.4";
const MAX_ERROR_BODY = 300;

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

// Trim API error bodies so exceptions stay readable and do not dump full responses.
async function errorBody(res) {
  const text = await res.text();
  return text.length > MAX_ERROR_BODY ? `${text.slice(0, MAX_ERROR_BODY)}...` : text;
}

// Retry-After below 30 s is honored with one extra second; a longer one is capped at
// 30 s. Without the header (or without a response, after a timeout or network error)
// the delay is exponential with jitter, so throttled requests do not come back in
// one wave.
function retryDelayMs(res, attempt) {
  const header = res?.headers.get("retry-after") ?? null;
  const seconds = header === null || header.trim() === "" ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min((seconds + 1) * 1000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(500 * 2 ** attempt * (0.5 + Math.random() * 0.5), MAX_RETRY_DELAY_MS);
}

// fetch() that retries throttling (429), transient 5xx responses, timeouts and network
// errors with backoff. Each attempt times out after 30 s, including reading the body.
// All requests here are safe to repeat. Returns the last response (the caller checks
// res.ok); if the last attempt gets no response, throws "<label> failed: <reason>".
async function fetchWithRetry(url, init, label) {
  for (let attempt = 0; ; attempt++) {
    const last = attempt + 1 >= MAX_ATTEMPTS;
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      if (last) {
        const reason =
          e.name === "TimeoutError"
            ? `request timed out after ${REQUEST_TIMEOUT_MS / 1000} s`
            : (e.cause?.message ?? e.message);
        throw new Error(`${label} failed: ${reason}`);
      }
    }
    if (res) {
      if (res.ok || !RETRY_STATUS.has(res.status) || last) return res;
      await res.arrayBuffer(); // drain before retrying
    }
    await new Promise((r) => setTimeout(r, retryDelayMs(res, attempt)));
  }
}

function vaultBaseUri(vaultUri) {
  if (!/^https:\/\//i.test(vaultUri)) {
    throw new Error(`AZURE_VAULT_URI must be an https:// URL, got: ${vaultUri}`);
  }
  return vaultUri.replace(/\/+$/, "");
}

// Acquire an AAD access token for the Key Vault scope (retried like sign requests).
export async function getToken({ tenantId, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://vault.azure.net/.default",
  });
  const res = await fetchWithRetry(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    "Token request",
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
// Retried like sign requests.
export async function getCertInfo({ vaultUri, certName, token }) {
  const uri =
    `${vaultBaseUri(vaultUri)}/certificates/` +
    `${encodeURIComponent(certName)}?api-version=${API_VERSION}`;
  const res = await fetchWithRetry(
    uri,
    { headers: { Authorization: `Bearer ${token}` } },
    "Get certificate",
  );
  if (!res.ok) {
    throw new Error(`Get certificate failed: ${res.status} ${await errorBody(res)}`);
  }
  const json = await res.json();
  if (!json.kid || !json.cer) {
    throw new Error("Certificate response did not contain kid and cer.");
  }
  return { kid: json.kid, cer: json.cer };
}

// Sign a pre-computed SHA-256 digest (base64url) with RS256. Returns base64url signature.
// Throttling (429), transient 5xx, timeouts and network errors are retried with backoff.
// A failed HTTP call throws an Error carrying the HTTP status in `status`.
export async function kvSign({ kid, token, digestB64Url }) {
  const res = await fetchWithRetry(
    `${kid}/sign?api-version=${API_VERSION}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ alg: "RS256", value: digestB64Url }),
    },
    "Key Vault sign",
  );
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
