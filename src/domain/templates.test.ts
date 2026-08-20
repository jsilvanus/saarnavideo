import { describe, expect, it, beforeEach } from "vitest";
import {
  getTemplateRegistry,
  initializeDefaultTemplates,
  sermonComposition,
  liturgyComposition,
} from "./templates";
import { validateSourceFile, validateDuration, validateCompositionDuration, formatBytes, formatDuration } from "./validation";

describe("Template System", () => {
  describe("TemplateRegistry", () => {
    it("initializes with default templates", () => {
      const registry = initializeDefaultTemplates();
      expect(registry.listTemplates().length).toBe(3);
      expect(registry.getTemplate("sermon")).toBeDefined();
      expect(registry.getTemplate("liturgy")).toBeDefined();
      expect(registry.getTemplate("vespers")).toBeDefined();
    });

    it("initializes with default theme", () => {
      const registry = initializeDefaultTemplates();
      expect(registry.listThemes().length).toBeGreaterThan(0);
      expect(registry.getTheme("default")).toBeDefined();
    });

    it("validates theme references", () => {
      const registry = initializeDefaultTemplates();
      const validation = registry.validate();
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it("retrieves template details", () => {
      const registry = initializeDefaultTemplates();
      const sermon = registry.getTemplate("sermon");
      expect(sermon?.key).toBe("sermon");
      expect(sermon?.themeKey).toBe("default");
      expect(sermon?.expectedSegments).toContain("gospel");
      expect(sermon?.expectedSegments).toContain("sermon");
    });

    it("retrieves theme details", () => {
      const registry = initializeDefaultTemplates();
      const theme = registry.getTheme("default");
      expect(theme?.key).toBe("default");
      expect(theme?.colors.text).toBe("#ffffff");
      expect(theme?.colors.background).toBe("#000000");
    });
  });

  describe("Composition Factories", () => {
    beforeEach(() => {
      initializeDefaultTemplates();
    });

    it("sermon composition creates opening slate", () => {
      const registry = initializeDefaultTemplates();
      const theme = registry.getTheme("default")!;
      const items = sermonComposition(
        "source-1",
        {
          gospel: { startSeconds: 0, endSeconds: 300 },
          sermon: { startSeconds: 300, endSeconds: 1800 },
        },
        theme
      );

      const opening = items.find((i) => i.type === "slate" && i.data?.title === "Service");
      expect(opening).toBeDefined();
      expect(opening?.type).toBe("slate");
    });

    it("sermon composition includes gospel source clip", () => {
      const registry = initializeDefaultTemplates();
      const theme = registry.getTheme("default")!;
      const items = sermonComposition(
        "source-1",
        {
          gospel: { startSeconds: 0, endSeconds: 300 },
          sermon: { startSeconds: 300, endSeconds: 1800 },
        },
        theme
      );

      const gospelClip = items.find(
        (i) => i.type === "source-clip" && i.startSeconds === 0
      );
      expect(gospelClip).toBeDefined();
    });

    it("sermon composition includes gospel overlay", () => {
      const registry = initializeDefaultTemplates();
      const theme = registry.getTheme("default")!;
      const items = sermonComposition(
        "source-1",
        {
          gospel: { startSeconds: 0, endSeconds: 300 },
          sermon: { startSeconds: 300, endSeconds: 1800 },
        },
        theme
      );

      const overlay = items.find((i) => i.type === "overlay");
      expect(overlay).toBeDefined();
      expect(overlay?.template).toBe("gospel-text");
    });

    it("sermon composition includes sermon source clip", () => {
      const registry = initializeDefaultTemplates();
      const theme = registry.getTheme("default")!;
      const items = sermonComposition(
        "source-1",
        {
          gospel: { startSeconds: 0, endSeconds: 300 },
          sermon: { startSeconds: 300, endSeconds: 1800 },
        },
        theme
      );

      const sermonClip = items.find(
        (i) => i.type === "source-clip" && (i as any).startSeconds === 300
      );
      expect(sermonClip).toBeDefined();
      expect((sermonClip as any).endSeconds).toBe(1800);
    });

    it("sermon composition handles missing gospel", () => {
      const registry = initializeDefaultTemplates();
      const theme = registry.getTheme("default")!;
      const items = sermonComposition(
        "source-1",
        {
          sermon: { startSeconds: 0, endSeconds: 1800 },
        },
        theme
      );

      const overlay = items.find((i) => i.type === "overlay");
      expect(overlay).toBeUndefined();
    });

    it("liturgy composition handles continuous source", () => {
      const registry = initializeDefaultTemplates();
      const theme = registry.getTheme("default")!;
      const items = liturgyComposition(
        "source-1",
        {
          intro: { startSeconds: 0, endSeconds: 600 },
          main: { startSeconds: 600, endSeconds: 3600 },
        },
        theme
      );

      const sourceClip = items.find((i) => i.type === "source-clip");
      expect(sourceClip).toBeDefined();
      expect(sourceClip?.startSeconds).toBe(0);
      expect(sourceClip?.endSeconds).toBe(3600);
    });
  });
});

describe("Resource Validation", () => {
  describe("File Size Validation", () => {
    it("accepts file within limits", () => {
      const result = validateSourceFile(1024 * 1024, {
        maxSourceFileSizeBytes: 50 * 1024 * 1024,
      });
      expect(result.valid).toBe(true);
    });

    it("rejects empty file", () => {
      const result = validateSourceFile(0, {
        maxSourceFileSizeBytes: 50 * 1024 * 1024,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("empty");
    });

    it("rejects oversized file", () => {
      const result = validateSourceFile(100 * 1024 * 1024, {
        maxSourceFileSizeBytes: 50 * 1024 * 1024,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds maximum size");
    });
  });

  describe("Duration Validation", () => {
    it("accepts duration within limits", () => {
      const result = validateDuration(3600, { maxDurationSeconds: 12 * 3600 });
      expect(result.valid).toBe(true);
    });

    it("rejects zero/negative duration", () => {
      const result = validateDuration(0, { maxDurationSeconds: 12 * 3600 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("positive");
    });

    it("rejects excessive duration", () => {
      const result = validateDuration(48 * 3600, { maxDurationSeconds: 12 * 3600 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds maximum");
    });
  });

  describe("Composition Duration Validation", () => {
    it("validates composition within limits", () => {
      const result = validateCompositionDuration(3600, {
        maxDurationSeconds: 12 * 3600,
      });
      expect(result.valid).toBe(true);
      expect(result.totalDurationSeconds).toBe(3600);
    });

    it("reports validation errors", () => {
      const result = validateCompositionDuration(48 * 3600, {
        maxDurationSeconds: 12 * 3600,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Formatting", () => {
    it("formats bytes to human-readable", () => {
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
    });

    it("formats duration to HH:MM:SS", () => {
      expect(formatDuration(3661)).toBe("01:01:01");
      expect(formatDuration(7200)).toBe("02:00:00");
      expect(formatDuration(60)).toBe("00:01:00");
    });
  });
});

describe("Global Template Registry", () => {
  it("returns initialized registry on first access", () => {
    const registry = getTemplateRegistry();
    expect(registry).toBeDefined();
    expect(registry.listTemplates().length).toBe(3);
  });

  it("returns same instance on subsequent access", () => {
    const registry1 = getTemplateRegistry();
    const registry2 = getTemplateRegistry();
    expect(registry1).toBe(registry2);
  });
});
