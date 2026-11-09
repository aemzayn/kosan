import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { Cipher } from "@kosan/core";

/**
 * AES-256-GCM for tenant DB passwords stored in the master table.
 *
 * Set KOSAN_SECRET_KEY (64 hex chars) in real deployments, or swap this for
 * a KMS-backed Cipher — see docs/guides/credential-encryption.md.
 */
function loadKey(): Buffer {
  const hex = process.env.KOSAN_SECRET_KEY;
  if (hex !== undefined) {
    const key = Buffer.from(hex, "hex");
    if (key.length !== 32) throw new Error("KOSAN_SECRET_KEY must be 64 hex characters");
    return key;
  }
  // Demo-only fallback so the example runs without setup. Never do this in production.
  return scryptSync("kosan-multi-region-demo", "demo-salt", 32);
}

const key = loadKey();

export const cipher: Cipher = {
  async encrypt(plain) {
    const iv = randomBytes(12);
    const aes = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([aes.update(plain, "utf8"), aes.final()]);
    return Buffer.concat([iv, aes.getAuthTag(), data]).toString("base64");
  },
  async decrypt(stored) {
    const raw = Buffer.from(stored, "base64");
    const aes = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    aes.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([aes.update(raw.subarray(28)), aes.final()]).toString("utf8");
  },
};
