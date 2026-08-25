import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function key() {
  const raw = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY is required for YouTube token storage");
  const value = Buffer.from(raw, "hex");
  if (value.length !== 32) throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY must be a 64-character hex string");
  return value;
}

export function encryptYouTubeToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptYouTubeToken(value: string) {
  // Permit existing development records to continue working; all newly stored
  // credentials are encrypted. Production deployments should rotate/reconnect
  // any legacy plaintext record.
  if (!value.startsWith(PREFIX)) return value;
  const [ivText, tagText, ciphertextText] = value.slice(PREFIX.length).split(".");
  if (!ivText || !tagText || !ciphertextText) throw new Error("Invalid encrypted YouTube token");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}
