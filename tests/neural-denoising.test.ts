import { describe, expect, it } from "vitest";
import {
  calculateImageMetrics,
  makeDenoisingView,
  percentile,
  type DenoisingFrames,
} from "../src/demos/neural-denoising";

describe("Neural Denoising views", () => {
  const frames: DenoisingFrames = {
    size: 2,
    reference: new Float32Array([0.4, 0.1, 0.5, 0.9, 0.8, 0.2, 0.6, 1, 0.3, 0.7, 0.2, 0.8]),
    noisy: new Float32Array([0.2, 0.3, 0.7, 1, 0.4, 0.4, 0.8, 1, 0.6, 0.5, 0.4, 0.9]),
  };

  it("uses ONNX pixels for the ERROR view", () => {
    const onnx = new Float32Array([0.3, 0.1, 0.45, 0.95, 0.7, 0.2, 0.55, 1, 0.4, 0.7, 0.25, 0.85]);
    const error = makeDenoisingView("error", frames, onnx);
    const expected = [0.4, 0, 0.2, 0.2, 0.4, 0, 0.2, 0, 0.4, 0, 0.2, 0.2];
    expected.forEach((value, index) => expect(error[index]).toBeCloseTo(value));
  });

  it("computes current-pair L1, MSE, PSNR and percentile timing", () => {
    const perfect = calculateImageMetrics(frames.reference, frames.reference);
    expect(perfect).toEqual({ l1: 0, mse: 0, psnrDb: Number.POSITIVE_INFINITY });
    const noisy = calculateImageMetrics(frames.noisy, frames.reference);
    expect(noisy.l1).toBeGreaterThan(0);
    expect(noisy.psnrDb).toBeGreaterThan(0);
    expect(percentile([9, 1, 7, 3, 5], 0.5)).toBe(5);
    expect(percentile([9, 1, 7, 3, 5], 0.95)).toBe(9);
  });
});
