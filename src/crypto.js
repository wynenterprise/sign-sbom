import { createHash } from "node:crypto";

// SHA-256 digest of the given bytes. Returns a Buffer (32 bytes).
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest();
}

// Standard base64 of a Buffer/bytes converted to base64url (no padding).
export function toBase64Url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Convert an existing standard-base64 string to base64url (no padding).
export function stdToBase64Url(b64) {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
