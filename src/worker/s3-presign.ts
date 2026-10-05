import { createHash, createHmac } from "node:crypto";
import type { S3Config } from "fffleet";

const rfc3986 = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/**
 * A time-limited GET URL for an S3 object (SigV4 query authentication), so another service can fetch it without credentials.
 * Same addressing as fffleet's S3 client: path style when an endpoint is configured (or `pathStyle`), virtual-hosted otherwise.
 */
export function presignGetUrl(config: S3Config, bucket: string, key: string, { expiresSeconds = 3600, now = new Date() }: { expiresSeconds?: number; now?: Date } = {}): string {
  const region = config.region ?? "us-east-1";
  const endpoint = new URL(config.endpoint ?? `https://s3.${region}.amazonaws.com`);
  const pathStyle = config.pathStyle ?? !!config.endpoint;
  const base = endpoint.pathname.replace(/\/+$/, "");
  const encodedKey = key.split("/").map(rfc3986).join("/");
  const host = pathStyle ? endpoint.host : `${bucket}.${endpoint.host}`;
  const pathname = pathStyle ? `${base}/${rfc3986(bucket)}/${encodedKey}` : `${base}/${encodedKey}`;

  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
    ...(config.sessionToken ? { "X-Amz-Security-Token": config.sessionToken } : {}),
  };
  const canonicalQuery = Object.keys(query).sort().map(k => `${rfc3986(k)}=${rfc3986(query[k])}`).join("&");
  const canonicalRequest = ["GET", pathname, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return `${endpoint.protocol}//${host}${pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
