import { describe, expect, it } from "vitest";
import {
  calculateImageMetrics,
  ExplicitRunGate,
  makeDenoisingView,
  percentile,
  SessionLease,
  verifyArtifactBuffer,
  type DenoisingFrames,
} from "../src/demos/neural-denoising";
import { ResourceScope } from "../src/demos/core/runtime";

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

  it("does not invoke the reviewed loader before an explicit request", async () => {
    const gate = new ExplicitRunGate();
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return "reviewed";
    };

    expect(loads).toBe(0);
    expect(gate.inFlight).toBe(false);
    await expect(gate.request(loader)).resolves.toBe("reviewed");
    expect(loads).toBe(1);
    expect(gate.inFlight).toBe(false);
  });

  it("rejects a same-size artifact with an unexpected SHA-256", async () => {
    const bytes = new TextEncoder().encode("model").buffer;
    await expect(
      verifyArtifactBuffer(
        bytes,
        {
          file: "neural-denoiser.onnx",
          bytes: 5,
          sha256: "0".repeat(64),
        },
        "Reviewed ONNX model",
      ),
    ).rejects.toThrow("SHA-256 mismatch");
  });

  it("releases an in-flight session once when the resource scope is disposed", async () => {
    let releases = 0;
    const scope = new ResourceScope();
    const lease = scope.trackInferenceSession(
      new SessionLease({
        release: async () => {
          releases += 1;
        },
      }),
    );

    await scope.dispose();
    await lease.release();
    expect(releases).toBe(1);
  });

  it("waits for an active inference operation before releasing its session", async () => {
    let releases = 0;
    let finish: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const lease = new SessionLease({
      release: async () => {
        releases += 1;
      },
    });

    const running = lease.run(() => operation);
    const releasing = lease.release();
    await Promise.resolve();
    expect(releases).toBe(0);

    finish?.();
    await running;
    await releasing;
    expect(releases).toBe(1);
    await expect(lease.run(async () => undefined)).rejects.toThrow("release is already pending");
  });
});
