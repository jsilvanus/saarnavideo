import { describe, expect, it } from "vitest";
import {
  validateSourceFile,
  validateDuration,
  validateCompositionDuration,
  formatBytes,
  formatDuration,
  resourceLimitsSchema,
} from "./validation";

describe("Validation Module", () => {
  describe("Resource Limits Schema", () => {
    it("parses valid resource limits", () => {
      const limits = resourceLimitsSchema.parse({
        maxSourceFileSizeBytes: 50 * 1024 * 1024,
        maxDurationSeconds: 12 * 3600,
      });
      expect(limits.maxSourceFileSizeBytes).toBe(50 * 1024 * 1024);
      expect(limits.maxDurationSeconds).toBe(12 * 3600);
    });

    it("applies defaults for missing values", () => {
      const limits = resourceLimitsSchema.parse({});
      expect(limits.maxSourceFileSizeBytes).toBe(50 * 1024 * 1024 * 1024);
      expect(limits.maxDurationSeconds).toBe(12 * 3600);
    });
  });

  describe("Source File Validation", () => {
    const limits = {
      maxSourceFileSizeBytes: 50 * 1024 * 1024 * 1024, // 50 GB
    };

    it("accepts valid file size", () => {
      const result = validateSourceFile(1024 * 1024, limits);
      expect(result.valid).toBe(true);
    });

    it("accepts file at exact limit", () => {
      const result = validateSourceFile(50 * 1024 * 1024 * 1024, limits);
      expect(result.valid).toBe(true);
    });

    it("rejects empty file", () => {
      const result = validateSourceFile(0, limits);
      expect(result.valid).toBe(false);
      expect(result.reason?.toLowerCase()).toContain("empty");
    });

    it("rejects negative file size", () => {
      const result = validateSourceFile(-1, limits);
      expect(result.valid).toBe(false);
    });

    it("rejects file exceeding limit", () => {
      const result = validateSourceFile(100 * 1024 * 1024 * 1024, limits);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds maximum size");
    });

    it("includes file size in error message", () => {
      const result = validateSourceFile(100 * 1024 * 1024 * 1024, limits);
      expect(result.reason).toContain("100");
    });
  });

  describe("Duration Validation", () => {
    const limits = {
      maxDurationSeconds: 12 * 3600, // 12 hours
    };

    it("accepts valid duration", () => {
      const result = validateDuration(3600, limits);
      expect(result.valid).toBe(true);
    });

    it("accepts duration at exact limit", () => {
      const result = validateDuration(12 * 3600, limits);
      expect(result.valid).toBe(true);
    });

    it("rejects zero duration", () => {
      const result = validateDuration(0, limits);
      expect(result.valid).toBe(false);
      expect(result.reason?.toLowerCase()).toContain("positive");
    });

    it("rejects negative duration", () => {
      const result = validateDuration(-1, limits);
      expect(result.valid).toBe(false);
    });

    it("rejects duration exceeding limit", () => {
      const result = validateDuration(48 * 3600, limits);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds maximum duration");
    });
  });

  describe("Composition Duration Validation", () => {
    const limits = {
      maxDurationSeconds: 12 * 3600,
    };

    it("returns valid composition", () => {
      const result = validateCompositionDuration(3600, limits);
      expect(result.valid).toBe(true);
      expect(result.totalDurationSeconds).toBe(3600);
      expect(result.errors).toHaveLength(0);
    });

    it("returns invalid composition with errors", () => {
      const result = validateCompositionDuration(48 * 3600, limits);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("includes specific error messages", () => {
      const result = validateCompositionDuration(48 * 3600, limits);
      expect(result.errors[0]).toContain("exceeds maximum duration");
    });

    it("reports no duration", () => {
      const result = validateCompositionDuration(0, limits);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("no duration");
    });
  });

  describe("Byte Formatting", () => {
    it("formats zero bytes", () => {
      expect(formatBytes(0)).toBe("0 Bytes");
    });

    it("formats bytes", () => {
      expect(formatBytes(512)).toBe("512 Bytes");
    });

    it("formats kilobytes", () => {
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1024 * 2.5)).toBe("2.5 KB");
    });

    it("formats megabytes", () => {
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
      expect(formatBytes(1024 * 1024 * 100)).toBe("100 MB");
    });

    it("formats gigabytes", () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
      expect(formatBytes(1024 * 1024 * 1024 * 50)).toBe("50 GB");
    });

    it("formats terabytes", () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1 TB");
    });
  });

  describe("Duration Formatting", () => {
    it("formats seconds only", () => {
      expect(formatDuration(30)).toBe("00:00:30");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(90)).toBe("00:01:30");
      expect(formatDuration(61)).toBe("00:01:01");
    });

    it("formats hours, minutes, seconds", () => {
      expect(formatDuration(3661)).toBe("01:01:01");
      expect(formatDuration(7200)).toBe("02:00:00");
    });

    it("formats large durations", () => {
      // 12 hours
      expect(formatDuration(12 * 3600)).toBe("12:00:00");
      // 24 hours
      expect(formatDuration(24 * 3600)).toBe("24:00:00");
    });

    it("pads with zeros", () => {
      const result = formatDuration(3661);
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });
});
