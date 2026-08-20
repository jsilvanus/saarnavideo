import { z } from "zod";

/**
 * Resource limits for job processing.
 * These prevent runaway jobs and protect system resources.
 */
export const resourceLimitsSchema = z.object({
  maxSourceFileSizeBytes: z.number().int().positive().describe("Max uploaded/downloaded source size").default(50 * 1024 * 1024 * 1024), // 50 GB
  maxOutputFileSizeBytes: z.number().int().positive().describe("Max output video size").default(100 * 1024 * 1024 * 1024), // 100 GB
  maxDurationSeconds: z.number().int().positive().describe("Max video duration").default(12 * 60 * 60), // 12 hours
  maxConcurrentJobs: z.number().int().positive().describe("Max jobs running at once").default(2),
  requestTimeoutSeconds: z.number().int().positive().describe("FFmpeg process timeout").default(60 * 60), // 1 hour
});

export type ResourceLimits = z.infer<typeof resourceLimitsSchema>;

/**
 * Validation result from resource limit checking.
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a source file against resource limits.
 */
export function validateSourceFile(
  sizeBytes: number,
  limits: Partial<ResourceLimits> = {}
): ValidationResult {
  const resolvedLimits = resourceLimitsSchema.parse(limits);

  if (sizeBytes <= 0) {
    return { valid: false, reason: "Source file is empty" };
  }

  if (sizeBytes > resolvedLimits.maxSourceFileSizeBytes) {
    return {
      valid: false,
      reason: `Source file exceeds maximum size of ${formatBytes(resolvedLimits.maxSourceFileSizeBytes)}. File size: ${formatBytes(sizeBytes)}`,
    };
  }

  return { valid: true };
}

/**
 * Validate a video duration against resource limits.
 */
export function validateDuration(
  durationSeconds: number,
  limits: Partial<ResourceLimits> = {}
): ValidationResult {
  const resolvedLimits = resourceLimitsSchema.parse(limits);

  if (durationSeconds <= 0) {
    return { valid: false, reason: "Video duration must be positive" };
  }

  if (durationSeconds > resolvedLimits.maxDurationSeconds) {
    return {
      valid: false,
      reason: `Video exceeds maximum duration of ${formatDuration(resolvedLimits.maxDurationSeconds)}. Duration: ${formatDuration(durationSeconds)}`,
    };
  }

  return { valid: true };
}

/**
 * Validate a composition timeline against resource constraints.
 */
export interface CompositionValidation {
  valid: boolean;
  totalDurationSeconds: number;
  errors: string[];
}

export function validateCompositionDuration(
  durationSeconds: number,
  limits: Partial<ResourceLimits> = {}
): CompositionValidation {
  const resolvedLimits = resourceLimitsSchema.parse(limits);
  const errors: string[] = [];

  if (durationSeconds <= 0) {
    errors.push("Composition has no duration");
  }

  if (durationSeconds > resolvedLimits.maxDurationSeconds) {
    errors.push(
      `Composition exceeds maximum duration. Max: ${formatDuration(resolvedLimits.maxDurationSeconds)}, Actual: ${formatDuration(durationSeconds)}`
    );
  }

  return {
    valid: errors.length === 0,
    totalDurationSeconds: durationSeconds,
    errors,
  };
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Format duration in seconds to HH:MM:SS string.
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Job logging interface for structured logging.
 */
export interface JobLogger {
  debug(message: string, data?: Record<string, unknown>): Promise<void>;
  info(message: string, data?: Record<string, unknown>): Promise<void>;
  warn(message: string, data?: Record<string, unknown>): Promise<void>;
  error(message: string, data?: Record<string, unknown>): Promise<void>;
}

/**
 * In-memory job logger (for testing or simple deployments).
 */
export class MemoryJobLogger implements JobLogger {
  private logs: Array<{ level: string; message: string; data?: Record<string, unknown>; timestamp: Date }> = [];

  async debug(message: string, data?: Record<string, unknown>): Promise<void> {
    this.logs.push({ level: "DEBUG", message, data, timestamp: new Date() });
  }

  async info(message: string, data?: Record<string, unknown>): Promise<void> {
    this.logs.push({ level: "INFO", message, data, timestamp: new Date() });
  }

  async warn(message: string, data?: Record<string, unknown>): Promise<void> {
    this.logs.push({ level: "WARN", message, data, timestamp: new Date() });
  }

  async error(message: string, data?: Record<string, unknown>): Promise<void> {
    this.logs.push({ level: "ERROR", message, data, timestamp: new Date() });
  }

  getLogs() {
    return this.logs;
  }

  clear() {
    this.logs = [];
  }
}

/**
 * Resource usage tracking.
 */
export interface ResourceMetrics {
  peakMemoryMB?: number;
  elapsedSeconds?: number;
  ffmpegCpuPercent?: number;
  networkBytesDownloaded?: number;
  inputFileSizeBytes?: number;
  outputFileSizeBytes?: number;
}
