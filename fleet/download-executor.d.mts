export type DownloadRuntime = {
  workDir: string;
  signal: AbortSignal;
  setState(state: string, extra?: object): void;
  progress(progress: { pct: number | null; outTimeMs: number | null; speed: number | null; fps: number | null; frame: number | null }): void;
  s3?: { getFile(bucket: string, key: string, path: string, opts?: object): Promise<void>; putFile(bucket: string, key: string, path: string, opts?: object): Promise<number> } | null;
  fetch?: typeof fetch;
};
export type DownloadSpec = { id?: string; inputs?: { name: string; uri: string }[]; outputs?: { name: string; uri: string }[]; download?: { url: string; format?: string; extraArgs?: string[] } };
export function readPayload(spec: DownloadSpec): { url: string; format: string; extraArgs: string[] };
export function scrub(text: string, opts: { cookiePath?: string; secrets?: string[] }): string;
export function runDownload(spec: DownloadSpec, rt: DownloadRuntime): Promise<{ exitCode: number; outputs: { name: string; uri: string; bytes: number }[]; stderrTail: string | null }>;
declare const executor: { type: "download"; run: typeof runDownload };
export default executor;
