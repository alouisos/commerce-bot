// Credentials we must keep (a shop's API secret) are stored encrypted: AES-256-GCM with a key derived
// from the app secret. A copy of the database alone can't read them.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const VERSION = "v1";

function key(): Buffer {
  return Buffer.from(hkdfSync("sha256", env.BETTER_AUTH_SECRET, "concierge", "store-credentials", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(enc: string): string {
  try {
    const [version, iv, tag, ct] = enc.split(".");
    if (version !== VERSION || !iv || !tag || !ct) throw new Error("bad format");
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Can't read a stored credential");
  }
}
