import { describe, it, expect } from "vitest";
import {
  CURATED_ONLINE_IMAGES,
  detectCategory,
  getThematicOnlineImage,
} from "../src/curated-images";

describe("curated online images", () => {
  it("provides curated royalty-free images across core presentation categories", () => {
    expect(CURATED_ONLINE_IMAGES.length).toBeGreaterThanOrEqual(16);
    for (const img of CURATED_ONLINE_IMAGES) {
      expect(img.src).toMatch(/^https:\/\/images\.unsplash\.com\//);
      expect(img.caption.length).toBeGreaterThan(0);
      expect(["3d", "ai", "business", "data", "finance", "nature", "creative", "minimal"]).toContain(
        img.category,
      );
    }
  });

  it("detects thematic categories from prompt keywords", () => {
    expect(detectCategory("Futuristic 3D architecture")).toBe("3d");
    expect(detectCategory("AI agent workflows and machine learning")).toBe("ai");
    expect(detectCategory("Q3 financial revenue and ARR growth")).toBe("finance");
    expect(detectCategory("Telemetry dashboard and real-time metrics")).toBe("data");
    expect(detectCategory("Sustainable forest conservation")).toBe("nature");
    expect(detectCategory("Creative branding and design sprint")).toBe("creative");
    expect(detectCategory("General corporate deck")).toBe("business");
  });

  it("returns deterministic high-resolution image blocks", () => {
    const a = getThematicOnlineImage("Next-Gen AI Systems", 0, "behind");
    const b = getThematicOnlineImage("Next-Gen AI Systems", 0, "behind");
    expect(a).toEqual(b);
    expect(a.type).toBe("image");
    expect(a.layout).toBe("behind");
    expect(a.src).toMatch(/^https:\/\/images\.unsplash\.com\//);
  });
});
