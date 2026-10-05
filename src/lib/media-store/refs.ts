import path from "node:path";

export type ParsedRef = { kind: "local"; path: string } | { kind: "s3"; bucket: string; key: string };

export function isS3Ref(ref: string): boolean {
  return ref.startsWith("s3://");
}

export function s3Ref(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}

export function parseRef(ref: string): ParsedRef {
  if (isS3Ref(ref)) {
    const rest = ref.slice("s3://".length);
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1) throw new Error(`Invalid s3 reference: ${ref}`);
    return { kind: "s3", bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
  }
  if (!path.isAbsolute(ref)) throw new Error(`Invalid media reference (not an absolute path or s3:// URI): ${ref}`);
  return { kind: "local", path: ref };
}

/** Keys come from code and user file names; reject anything that could escape the storage root. */
export function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.split("/").some(part => part === ".." || part === "" || part === ".")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}
