import { createHash } from "node:crypto";

// SHA-256 digest of the given bytes. Returns a Buffer (32 bytes).
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest();
}

// Base64url (no padding) of a Buffer/bytes.
export function toBase64Url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// Convert an existing standard-base64 string to base64url (no padding).
export function stdToBase64Url(b64) {
  return Buffer.from(b64, "base64").toString("base64url");
}
