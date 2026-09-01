export type Vec3 = [number, number, number];

export interface Triangle {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  material: number;
}

export interface BvhNode {
  min: Vec3;
  max: Vec3;
  left: number;
  right: number;
  first: number;
  count: number;
  leaf: boolean;
}

export interface BvhBuild {
  nodes: BvhNode[];
  triangles: Triangle[];
}

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

export interface TriangleHit {
  distance: number;
  triangleIndex: number;
}

export interface BvhTraversalCapacity {
  stackCapacity: number;
  maxPendingNodes: number;
  overflowCount: number;
}

const LEAF_TRIANGLES = 4;

export function buildMedianBvh(triangles: Triangle[]): BvhBuild {
  if (!triangles.length) throw new Error("BVH requires at least one triangle.");
  const nodes: BvhNode[] = [];
  const ordered: Triangle[] = [];

  const build = (indices: number[]): number => {
    const nodeIndex = nodes.length;
    const bounds = boundsFor(indices.map((index) => triangles[index]));
    nodes.push({ ...bounds, left: -1, right: -1, first: -1, count: 0, leaf: false });
    if (indices.length <= LEAF_TRIANGLES) {
      const first = ordered.length;
      indices.forEach((index) => ordered.push(triangles[index]));
      nodes[nodeIndex] = {
        ...nodes[nodeIndex],
        first,
        count: indices.length,
        leaf: true,
      };
      return nodeIndex;
    }

    const centroidBounds = boundsForPoints(indices.map((index) => centroid(triangles[index])));
    const extent = subtract(centroidBounds.max, centroidBounds.min);
    const axis =
      extent[0] >= extent[1] && extent[0] >= extent[2] ? 0 : extent[1] >= extent[2] ? 1 : 2;
    indices.sort((a, b) => centroid(triangles[a])[axis] - centroid(triangles[b])[axis]);
    const middle = Math.floor(indices.length / 2);
    const left = build(indices.slice(0, middle));
    const right = build(indices.slice(middle));
    nodes[nodeIndex] = { ...nodes[nodeIndex], left, right };
    return nodeIndex;
  };

  build(triangles.map((_, index) => index));
  return { nodes, triangles: ordered };
}

export function intersectBruteForce(ray: Ray, triangles: Triangle[]): TriangleHit | undefined {
  let closest: TriangleHit | undefined;
  triangles.forEach((triangle, triangleIndex) => {
    const distance = intersectTriangle(ray, triangle);
    if (distance !== undefined && (!closest || distance < closest.distance))
      closest = { distance, triangleIndex };
  });
  return closest;
}

export function intersectBvh(ray: Ray, bvh: BvhBuild): TriangleHit | undefined {
  const stack = [0];
  let closest: TriangleHit | undefined;
  while (stack.length) {
    const nodeIndex = stack.pop()!;
    const node = bvh.nodes[nodeIndex];
    if (!intersectBounds(ray, node.min, node.max, closest?.distance ?? Number.POSITIVE_INFINITY))
      continue;
    if (node.leaf) {
      for (let index = 0; index < node.count; index += 1) {
        const triangleIndex = node.first + index;
        const distance = intersectTriangle(ray, bvh.triangles[triangleIndex]);
        if (distance !== undefined && (!closest || distance < closest.distance))
          closest = { distance, triangleIndex };
      }
    } else {
      stack.push(node.right, node.left);
    }
  }
  return closest;
}

/**
 * Mirrors the bounded DFS stack contract used by PATH_COMPUTE_WGSL. The
 * production shader counts saturation instead of silently dropping children;
 * this CPU analysis proves whether the fixed scene can reach that boundary.
 */
export function analyzeBvhTraversalCapacity(
  bvh: BvhBuild,
  stackCapacity = 64,
): BvhTraversalCapacity {
  if (!Number.isInteger(stackCapacity) || stackCapacity < 2)
    throw new Error("stackCapacity must be an integer of at least two.");
  const stack = [0];
  let maxPendingNodes = stack.length;
  let overflowCount = 0;
  while (stack.length) {
    const node = bvh.nodes[stack.pop()!];
    if (node.leaf) continue;
    if (stack.length + 2 > stackCapacity) {
      overflowCount += 1;
      continue;
    }
    stack.push(node.right, node.left);
    maxPendingNodes = Math.max(maxPendingNodes, stack.length);
  }
  return { stackCapacity, maxPendingNodes, overflowCount };
}

export function intersectTriangle(ray: Ray, triangle: Triangle): number | undefined {
  const edge1 = subtract(triangle.v1, triangle.v0);
  const edge2 = subtract(triangle.v2, triangle.v0);
  const p = cross(ray.direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-8) return undefined;
  const inverse = 1 / determinant;
  const t = subtract(ray.origin, triangle.v0);
  const u = dot(t, p) * inverse;
  if (u < 0 || u > 1) return undefined;
  const q = cross(t, edge1);
  const v = dot(ray.direction, q) * inverse;
  if (v < 0 || u + v > 1) return undefined;
  const distance = dot(edge2, q) * inverse;
  return distance > 1e-5 ? distance : undefined;
}

export function encodeTriangles(triangles: Triangle[]): Float32Array {
  const data = new Float32Array(triangles.length * 16);
  triangles.forEach((triangle, index) => {
    const offset = index * 16;
    data.set(
      [...triangle.v0, 0, ...triangle.v1, 0, ...triangle.v2, 0, triangle.material, 0, 0, 0],
      offset,
    );
  });
  return data;
}

export function encodeBvhNodes(nodes: BvhNode[]): ArrayBuffer {
  const buffer = new ArrayBuffer(nodes.length * 48);
  const floats = new Float32Array(buffer);
  const uints = new Uint32Array(buffer);
  nodes.forEach((node, index) => {
    const floatOffset = index * 12;
    floats.set([...node.min, 0, ...node.max, 0], floatOffset);
    const uintOffset = floatOffset + 8;
    uints[uintOffset] = node.leaf ? node.first : node.left;
    uints[uintOffset + 1] = node.leaf ? node.count : node.right;
    uints[uintOffset + 2] = node.leaf ? 1 : 0;
    uints[uintOffset + 3] = 0;
  });
  return buffer;
}

function boundsFor(triangles: Triangle[]): { min: Vec3; max: Vec3 } {
  return boundsForPoints(triangles.flatMap((triangle) => [triangle.v0, triangle.v1, triangle.v2]));
}

function boundsForPoints(points: Vec3[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  points.forEach((point) => {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  });
  const epsilon = 1e-4;
  return {
    min: [min[0] - epsilon, min[1] - epsilon, min[2] - epsilon],
    max: [max[0] + epsilon, max[1] + epsilon, max[2] + epsilon],
  };
}

function centroid(triangle: Triangle): Vec3 {
  return [
    (triangle.v0[0] + triangle.v1[0] + triangle.v2[0]) / 3,
    (triangle.v0[1] + triangle.v1[1] + triangle.v2[1]) / 3,
    (triangle.v0[2] + triangle.v1[2] + triangle.v2[2]) / 3,
  ];
}

function intersectBounds(ray: Ray, min: Vec3, max: Vec3, maximum: number): boolean {
  let near = 0;
  let far = maximum;
  for (let axis = 0; axis < 3; axis += 1) {
    const inverse = 1 / ray.direction[axis];
    let first = (min[axis] - ray.origin[axis]) * inverse;
    let second = (max[axis] - ray.origin[axis]) * inverse;
    if (inverse < 0) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (far < near) return false;
  }
  return true;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
