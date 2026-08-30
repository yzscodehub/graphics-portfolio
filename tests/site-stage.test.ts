import { describe, expect, it } from "vitest";
import {
  resolveSiteFeatures,
  resolveSiteStage,
  supportedSiteStages,
} from "../src/data/site-stage.mjs";

describe("site stage resolution", () => {
  it("defaults every local build to the safe preview stage", () => {
    expect(resolveSiteStage(undefined)).toBe("preview");
    expect(resolveSiteFeatures(undefined)).toEqual({
      stage: "preview",
      indexing: false,
      resume: false,
      emailContact: false,
      rss: true,
      sitemap: false,
    });
  });

  it("enables only indexing, RSS, and sitemap at the current release stage", () => {
    expect(resolveSiteFeatures("release")).toEqual({
      stage: "release",
      indexing: true,
      resume: false,
      emailContact: false,
      rss: true,
      sitemap: true,
    });
  });

  it("rejects unknown stage names", () => {
    expect(supportedSiteStages).toEqual(["preview", "release"]);
    expect(() => resolveSiteStage("production")).toThrow(/SITE_STAGE/);
  });
});
