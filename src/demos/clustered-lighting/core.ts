export const LIGHTING_MODES = ["naive", "deferred", "clustered"] as const;
export type LightingMode = (typeof LIGHTING_MODES)[number];
export const CLUSTER_VIEWS = ["final", "gbuffer", "depth-slice", "cluster-heatmap"] as const;
export type ClusterView = (typeof CLUSTER_VIEWS)[number];
export const CLUSTER_LIGHT_COUNTS = [64, 256, 512] as const;

export type ClusteredPass =
  "forward-final" | "cluster-assign" | "gbuffer" | "deferred-fullscreen" | "clustered-fullscreen";

/**
 * The public mode is an execution contract, not just a shader uniform.
 */
export function clusteredPipelinePlan(
  mode: LightingMode,
  view: ClusterView,
): readonly ClusteredPass[] {
  if (view === "cluster-heatmap") {
    return ["cluster-assign", "gbuffer", "clustered-fullscreen"];
  }
  if (mode === "naive" && view === "final") return ["forward-final"];
  if (mode === "deferred") return ["gbuffer", "deferred-fullscreen"];
  if (mode === "clustered") return ["cluster-assign", "gbuffer", "clustered-fullscreen"];
  // Naive diagnostic views need an inspection prepass; Naive Final stays
  // direct forward and never samples a GBuffer.
  return ["gbuffer", "deferred-fullscreen"];
}

export interface ClusterGrid {
  x: number;
  y: number;
  z: number;
  near: number;
  far: number;
  maxLightsPerCluster: number;
}

export const DEFAULT_CLUSTER_GRID: Readonly<ClusterGrid> = {
  x: 12,
  y: 7,
  z: 12,
  near: 0.4,
  far: 14,
  maxLightsPerCluster: 32,
};

export interface DynamicLight {
  id: number;
  position: readonly [number, number, number];
  radius: number;
  color: readonly [number, number, number];
  intensity: number;
}

export interface ClusterBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export interface ClusterHeader {
  offset: number;
  count: number;
}

export interface ClusterBuildResult {
  grid: ClusterGrid;
  headers: ClusterHeader[];
  candidateCounts: Uint32Array;
  indices: Uint32Array;
  candidateAssignments: number;
  storedAssignments: number;
  overflow: number;
  maxLightsInCluster: number;
  averageLightsInCluster: number;
}

export interface ClusterAssignmentVerification {
  valid: boolean;
  invalidEntries: number;
  duplicateEntries: number;
  expectedCandidateAssignments: number;
}

export interface FixedGpuClusterReadback {
  headers: Uint32Array;
  indices: Uint32Array;
  overflow: number;
}

export interface GpuReferenceComparison {
  valid: boolean;
  comparedClusters: number;
  mismatchClusters: number;
  overflowMatches: boolean;
  candidateCountMatches: boolean;
}

export function clusterCount(grid: ClusterGrid = DEFAULT_CLUSTER_GRID): number {
  return grid.x * grid.y * grid.z;
}

export function validateClusterGrid(grid: ClusterGrid): ClusterGrid {
  if (Number.isInteger(grid.x) === false || grid.x < 1) throw new Error("Invalid cluster x.");
  if (Number.isInteger(grid.y) === false || grid.y < 1) throw new Error("Invalid cluster y.");
  if (Number.isInteger(grid.z) === false || grid.z < 1) throw new Error("Invalid cluster z.");
  if (Number.isInteger(grid.maxLightsPerCluster) === false || grid.maxLightsPerCluster < 1) {
    throw new Error("Invalid cluster capacity.");
  }
  if (grid.near <= 0 || grid.far <= grid.near) throw new Error("Invalid cluster depth range.");
  return grid;
}

export function depthSliceForViewDepth(
  depth: number,
  grid: ClusterGrid = DEFAULT_CLUSTER_GRID,
): number {
  validateClusterGrid(grid);
  const clamped = Math.max(grid.near, Math.min(grid.far, depth));
  const normalized = Math.log(clamped / grid.near) / Math.log(grid.far / grid.near);
  return Math.min(grid.z - 1, Math.max(0, Math.floor(normalized * grid.z)));
}

export function viewDepthForSlice(slice: number, grid: ClusterGrid = DEFAULT_CLUSTER_GRID): number {
  validateClusterGrid(grid);
  const normalized = (Math.min(grid.z - 1, Math.max(0, slice)) + 0.5) / grid.z;
  return grid.near * Math.pow(grid.far / grid.near, normalized);
}

export function clusterIndexForSample(
  u: number,
  v: number,
  depth: number,
  grid: ClusterGrid = DEFAULT_CLUSTER_GRID,
): number {
  validateClusterGrid(grid);
  const x = Math.min(grid.x - 1, Math.max(0, Math.floor(u * grid.x)));
  const y = Math.min(grid.y - 1, Math.max(0, Math.floor(v * grid.y)));
  return depthSliceForViewDepth(depth, grid) * grid.x * grid.y + y * grid.x + x;
}

export function clusterBounds(
  index: number,
  grid: ClusterGrid = DEFAULT_CLUSTER_GRID,
): ClusterBounds {
  validateClusterGrid(grid);
  if (Number.isInteger(index) === false || index < 0 || index >= clusterCount(grid)) {
    throw new Error("Cluster index out of range.");
  }
  const layer = grid.x * grid.y;
  const z = Math.floor(index / layer);
  const local = index % layer;
  const y = Math.floor(local / grid.x);
  const x = local % grid.x;
  const zMin = grid.near * Math.pow(grid.far / grid.near, z / grid.z);
  const zMax = grid.near * Math.pow(grid.far / grid.near, (z + 1) / grid.z);
  return {
    xMin: (x / grid.x) * 2 - 1,
    xMax: ((x + 1) / grid.x) * 2 - 1,
    yMin: (y / grid.y) * 2 - 1,
    yMax: ((y + 1) / grid.y) * 2 - 1,
    zMin,
    zMax,
  };
}

export function lightIntersectsCluster(light: DynamicLight, bounds: ClusterBounds): boolean {
  const [x, y, z] = light.position;
  if (Number.isFinite(x + y + z + light.radius) === false || light.radius <= 0) return false;
  const nearX = Math.min(bounds.xMax, Math.max(bounds.xMin, x));
  const nearY = Math.min(bounds.yMax, Math.max(bounds.yMin, y));
  const nearZ = Math.min(bounds.zMax, Math.max(bounds.zMin, z));
  const dx = x - nearX;
  const dy = y - nearY;
  const dz = z - nearZ;
  return dx * dx + dy * dy + dz * dz <= light.radius * light.radius;
}

/** CPU reference for the exact list packed for WebGPU; overflow is counted. */
export function buildClusteredLightAssignments(
  lights: readonly DynamicLight[],
  grid: ClusterGrid = DEFAULT_CLUSTER_GRID,
): ClusterBuildResult {
  validateClusterGrid(grid);
  const buckets = Array.from({ length: clusterCount(grid) }, () => [] as number[]);
  const candidateCounts = new Uint32Array(buckets.length);
  let candidateAssignments = 0;
  let overflow = 0;
  let maxLightsInCluster = 0;
  for (let cluster = 0; cluster < buckets.length; cluster += 1) {
    const bucket = buckets[cluster];
    const bounds = clusterBounds(cluster, grid);
    let clusterCandidates = 0;
    for (const light of lights) {
      if (lightIntersectsCluster(light, bounds) === false) continue;
      candidateAssignments += 1;
      clusterCandidates += 1;
      if (bucket.length < grid.maxLightsPerCluster) bucket.push(light.id);
      else overflow += 1;
    }
    candidateCounts[cluster] = clusterCandidates;
    maxLightsInCluster = Math.max(maxLightsInCluster, bucket.length);
  }
  const headers: ClusterHeader[] = [];
  const flattened: number[] = [];
  for (const bucket of buckets) {
    headers.push({ offset: flattened.length, count: bucket.length });
    flattened.push(...bucket);
  }
  return {
    grid: { ...grid },
    headers,
    candidateCounts,
    indices: new Uint32Array(flattened),
    candidateAssignments,
    storedAssignments: flattened.length,
    overflow,
    maxLightsInCluster,
    averageLightsInCluster: flattened.length / buckets.length,
  };
}

export function verifyClusteredLightAssignments(
  lights: readonly DynamicLight[],
  result: ClusterBuildResult,
): ClusterAssignmentVerification {
  const byId = new Map(lights.map((light) => [light.id, light]));
  let invalidEntries = 0;
  let duplicateEntries = 0;
  let expectedCandidateAssignments = 0;
  for (let cluster = 0; cluster < result.headers.length; cluster += 1) {
    const header = result.headers[cluster];
    const bounds = clusterBounds(cluster, result.grid);
    const seen = new Set<number>();
    for (const light of lights) {
      if (lightIntersectsCluster(light, bounds)) expectedCandidateAssignments += 1;
    }
    for (let entry = 0; entry < header.count; entry += 1) {
      const id = result.indices[header.offset + entry];
      const light = byId.get(id);
      if (light === undefined || lightIntersectsCluster(light, bounds) === false)
        invalidEntries += 1;
      if (seen.has(id)) duplicateEntries += 1;
      seen.add(id);
    }
  }
  return {
    valid:
      invalidEntries === 0 &&
      duplicateEntries === 0 &&
      expectedCandidateAssignments === result.candidateAssignments &&
      result.headers.every((header) => header.count <= result.grid.maxLightsPerCluster),
    invalidEntries,
    duplicateEntries,
    expectedCandidateAssignments,
  };
}

export function packClusterHeaders(headers: readonly ClusterHeader[]): Uint32Array {
  const packed = new Uint32Array(Math.max(1, headers.length * 2));
  headers.forEach((header, index) => {
    packed[index * 2] = header.offset;
    packed[index * 2 + 1] = header.count;
  });
  return packed;
}

/**
 * Compares a fixed-offset GPU list against the CPU reference. GPU writes one
 * contiguous capacity-sized region per cluster, so insertion order is ignored.
 */
export function compareFixedGpuClusterReadback(
  reference: ClusterBuildResult,
  gpu: FixedGpuClusterReadback,
): GpuReferenceComparison {
  const capacity = reference.grid.maxLightsPerCluster;
  let comparedClusters = 0;
  let mismatchClusters = 0;
  let gpuCandidates = 0;
  for (let cluster = 0; cluster < reference.headers.length; cluster += 1) {
    const headerOffset = cluster * 2;
    const gpuOffset = gpu.headers[headerOffset];
    const gpuCount = gpu.headers[headerOffset + 1];
    const expectedCandidates = reference.candidateCounts[cluster];
    gpuCandidates += gpuCount;
    if (gpuOffset !== cluster * capacity || gpuCount !== expectedCandidates) {
      mismatchClusters += 1;
      continue;
    }
    if (expectedCandidates > capacity) continue;
    comparedClusters += 1;
    const expectedHeader = reference.headers[cluster];
    const expected = new Set<number>(
      reference.indices.slice(expectedHeader.offset, expectedHeader.offset + expectedHeader.count),
    );
    const actual = new Set<number>(
      gpu.indices.slice(cluster * capacity, cluster * capacity + gpuCount),
    );
    if (
      expected.size !== actual.size ||
      [...expected].some((lightId) => actual.has(lightId) === false)
    ) {
      mismatchClusters += 1;
    }
  }
  return {
    valid:
      mismatchClusters === 0 &&
      gpuCandidates === reference.candidateAssignments &&
      gpu.overflow === reference.overflow,
    comparedClusters,
    mismatchClusters,
    overflowMatches: gpu.overflow === reference.overflow,
    candidateCountMatches: gpuCandidates === reference.candidateAssignments,
  };
}

export function packDynamicLights(lights: readonly DynamicLight[]): Float32Array {
  const packed = new Float32Array(Math.max(8, lights.length * 8));
  lights.forEach((light, index) => {
    packed.set([...light.position, light.radius, ...light.color, light.intensity], index * 8);
  });
  return packed;
}

export function buildDynamicLights(count: number, timeSeconds: number): DynamicLight[] {
  if (CLUSTER_LIGHT_COUNTS.includes(count as (typeof CLUSTER_LIGHT_COUNTS)[number]) === false) {
    throw new Error("Use the published 64, 256, or 512 light presets.");
  }
  const lights: DynamicLight[] = [];
  for (let id = 0; id < count; id += 1) {
    const seed = hash01(id * 17.17 + 3.1);
    const orbit = timeSeconds * (0.32 + hash01(id + 9) * 0.48) + seed * Math.PI * 2;
    const hue = hash01(id * 11.3);
    lights.push({
      id,
      position: [
        Math.sin(orbit * 1.13 + id * 0.17) * (0.18 + hash01(id * 2.3) * 0.76),
        Math.cos(orbit * 0.83 + id * 0.11) * (0.12 + hash01(id * 8.1) * 0.62),
        1.2 + hash01(id * 3.7) * 11.7,
      ],
      radius: 0.28 + hash01(id * 13.4) * 1.18,
      color: [0.35 + hue * 0.65, 0.28 + hash01(id * 5.4) * 0.72, 0.3 + hash01(id * 7.8) * 0.7],
      intensity: 0.5 + hash01(id * 19.2) * 2.4,
    });
  }
  return lights;
}

function hash01(value: number): number {
  const sine = Math.sin(value * 12.9898) * 43758.5453;
  return sine - Math.floor(sine);
}
