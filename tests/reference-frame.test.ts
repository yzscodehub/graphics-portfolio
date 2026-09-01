import { describe, expect, it } from "vitest";
import { halton, shouldResetHistory, taaJitter } from "../src/demos/reference-frame/math";
import { decodeReferenceFloat16 } from "../src/demos/reference-frame/renderer";
import { CLUSTER_LIGHT_COUNT_WGSL } from "../src/demos/reference-frame/shaders";
import { REFERENCE_ATTACHMENTS } from "../src/demos/reference-frame/types";

describe("reference frame invariants", () => {
  it("uses a deterministic eight-sample Halton jitter sequence", () => {
    expect(halton(1, 2)).toBe(0.5);
    expect(halton(2, 2)).toBe(0.25);
    expect(taaJitter(0, 100, 200)).toEqual([0, expect.closeTo(-1 / 1200)]);
    expect(taaJitter(8, 100, 200)).toEqual(taaJitter(0, 100, 200));
  });

  it("invalidates temporal history on every projection or pipeline change", () => {
    const base = { width: 640, height: 360, aa: "taa" as const, shadow: "pcf", sceneRevision: 1 };
    expect(shouldResetHistory(undefined, base)).toBe(true);
    expect(shouldResetHistory(base, { ...base })).toBe(false);
    expect(shouldResetHistory(base, { ...base, width: 641 })).toBe(true);
    expect(shouldResetHistory(base, { ...base, aa: "fxaa" })).toBe(true);
    expect(shouldResetHistory(base, { ...base, shadow: "pcss" })).toBe(true);
    expect(shouldResetHistory(base, { ...base, sceneRevision: 2 })).toBe(true);
  });

  it("publishes the real attachment formats and last writers", () => {
    expect(REFERENCE_ATTACHMENTS).toHaveLength(10);
    expect(REFERENCE_ATTACHMENTS.map((entry) => entry.format)).toEqual(
      expect.arrayContaining(["rgba8unorm", "rgba16float", "rg16float", "r32float", "r8unorm"]),
    );
    expect(REFERENCE_ATTACHMENTS.every((entry) => entry.lastWriter.length > 0)).toBe(true);
  });

  it("keeps packed alpha channels and temporal provenance inspectable", () => {
    const albedo = REFERENCE_ATTACHMENTS.find((entry) => entry.view === "albedo");
    const normal = REFERENCE_ATTACHMENTS.find((entry) => entry.view === "normal");
    const history = REFERENCE_ATTACHMENTS.find((entry) => entry.view === "history");

    expect(albedo?.range).toContain("metalness");
    expect(normal?.range).toContain("roughness");
    expect(history).toMatchObject({
      format: "rgba16float",
      lastWriter: "Temporal Resolve",
    });
    expect(history?.range).toContain("latest Temporal Resolve");
  });

  it("publishes and decodes the real Temporal Resolve reject mask", () => {
    const reject = REFERENCE_ATTACHMENTS.find((entry) => entry.view === "history-reject");
    expect(reject).toMatchObject({
      format: "r8unorm",
      lastWriter: "Temporal Resolve / Reject Mask",
    });
    expect(reject?.range).toContain("UV bounds reject");
    expect(decodeReferenceFloat16(0x3c00)).toBe(1);
    expect(decodeReferenceFloat16(0xc000)).toBe(-2);
  });

  it("publishes the Reference Frame-local Cluster Light Count attachment", () => {
    const count = REFERENCE_ATTACHMENTS.find((entry) => entry.view === "cluster-light-count");
    expect(count).toMatchObject({
      format: "r8unorm",
      lastWriter: "ReferenceFrame / Local Cluster Count",
    });
    expect(count?.range).toContain("[0,8]");
    expect(CLUSTER_LIGHT_COUNT_WGSL).toContain("linearDepthTexture");
    expect(CLUSTER_LIGHT_COUNT_WGSL).toContain("return count / 8.0");
  });
});
