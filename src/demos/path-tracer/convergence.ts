export interface LowFrequencyConvergencePoint {
  spp: number;
  mse: number;
}

export interface LowFrequencyConvergenceEvidence {
  referenceSamples: number;
  lanes: number;
  points: readonly LowFrequencyConvergencePoint[];
  referenceHash: string;
}

const REFERENCE_SAMPLES = 4096;
const LANES = 16;
const CURVE_SPP = [1, 2, 4, 8, 16, 32, 64] as const;

/**
 * Fixed low-frequency direct-light estimator. It uses the same random-sample
 * pattern idea as the path tracer, but is intentionally small enough to keep
 * a self-made 4096-sample reference in source and tests. It is not image MSE.
 */
function directLightSample(lane: number, sample: number): number {
  const u = uniform(lane * 0x9e3779b1 + sample * 0x85ebca6b);
  const v = uniform(lane * 0xc2b2ae35 + sample * 0x27d4eb2f + 17);
  const cosine = 0.35 + 0.65 * u;
  const inverseDistance = 0.55 + 0.45 * v;
  return cosine * inverseDistance;
}

export function makeLowFrequencyConvergenceEvidence(): LowFrequencyConvergenceEvidence {
  const references = Array.from({ length: LANES }, (_, lane) => {
    let total = 0;
    for (let sample = 0; sample < REFERENCE_SAMPLES; sample += 1)
      total += directLightSample(lane, sample);
    return total / REFERENCE_SAMPLES;
  });

  const points = CURVE_SPP.map((spp) => {
    let squaredError = 0;
    for (let lane = 0; lane < LANES; lane += 1) {
      let total = 0;
      for (let sample = 0; sample < spp; sample += 1) total += directLightSample(lane, sample);
      const delta = total / spp - references[lane];
      squaredError += delta * delta;
    }
    return { spp, mse: squaredError / LANES };
  });

  return {
    referenceSamples: REFERENCE_SAMPLES,
    lanes: LANES,
    points,
    referenceHash: LOW_FREQUENCY_REFERENCE_SHA256,
  };
}

function uniform(seed: number): number {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

export function serializeLowFrequencyConvergence(
  evidence: LowFrequencyConvergenceEvidence,
): string {
  return JSON.stringify({
    lanes: evidence.lanes,
    points: evidence.points.map((point) => [point.spp, Number(point.mse.toPrecision(17))]),
    referenceSamples: evidence.referenceSamples,
  });
}

/** SHA-256 of serializeLowFrequencyConvergence(makeLowFrequencyConvergenceEvidence()). */
export const LOW_FREQUENCY_REFERENCE_SHA256 =
  "160597b8c42bba22e464b5aa7906f1c5af5bba52fa19f093787dfba8acc6c618";
