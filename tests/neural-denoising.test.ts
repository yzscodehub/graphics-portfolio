import { describe, expect, it } from "vitest";
import { makeDenoisingView, type DenoisingFrames } from "../src/demos/neural-denoising";

describe("Neural Denoising views", () => {
  const frames: DenoisingFrames = {
    size: 2,
    reference: new Uint8ClampedArray([
      40, 80, 120, 255, 10, 20, 30, 255, 50, 60, 70, 255, 90, 100, 110, 255,
    ]),
    noisy: new Uint8ClampedArray([
      20, 40, 60, 255, 30, 40, 50, 255, 70, 80, 90, 255, 100, 110, 120, 255,
    ]),
  };

  it("uses the ONNX pixels, rather than the box-filter fallback, for the ERROR view", () => {
    const onnxDenoised = new Uint8ClampedArray([
      30, 70, 100, 255, 10, 20, 30, 255, 45, 55, 65, 255, 95, 105, 115, 255,
    ]);

    expect(Array.from(makeDenoisingView("error", frames, onnxDenoised))).toEqual([
      40, 40, 80, 255, 0, 0, 0, 255, 20, 20, 20, 255, 20, 20, 20, 255,
    ]);
  });

  it("retains the deterministic fallback only when ONNX pixels are unavailable", () => {
    const onnxError = makeDenoisingView(
      "error",
      frames,
      new Uint8ClampedArray([
        30, 70, 100, 255, 10, 20, 30, 255, 45, 55, 65, 255, 95, 105, 115, 255,
      ]),
    );

    expect(Array.from(makeDenoisingView("error", frames))).not.toEqual(Array.from(onnxError));
  });
});
