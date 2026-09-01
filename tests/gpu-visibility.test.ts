import { describe, expect, it } from "vitest";
import {
  buildVisibilityReference,
  createIndexedIndirectCommand,
  createVisibilityInstanceData,
  DEFAULT_VISIBILITY_FRUSTUM,
  INDEXED_INDIRECT_STRIDE_BYTES,
  isInstanceVisible,
  lodForInstance,
  VisibilityResourceScope,
  type VisibilityInstance,
} from "../src/demos/gpu-visibility";

const item = (id: number, x: number, y: number, z: number, radius = 0.25): VisibilityInstance => ({
  id,
  position: [x, y, z],
  radius,
  color: [1, 1, 1],
});

describe("GPU-driven visibility CPU reference", () => {
  it("keeps deterministic 32-byte instance data", () => {
    const first = createVisibilityInstanceData(32);
    expect(first).toEqual(createVisibilityInstanceData(32));
    expect(first).toHaveLength(32 * 8);
    expect(Array.from(first).every(Number.isFinite)).toBe(true);
  });

  it("includes tangent frustum spheres and rejects objects outside the plane", () => {
    const boundary = item(1, DEFAULT_VISIBILITY_FRUSTUM.right + 0.25, 0, 4);
    const outside = item(2, DEFAULT_VISIBILITY_FRUSTUM.right + 0.251, 0, 4);
    expect(isInstanceVisible(boundary)).toBe(true);
    expect(isInstanceVisible(outside)).toBe(false);
  });

  it("assigns visible instances to deterministic LOD buckets and compacts their ids", () => {
    const items = [item(7, 0, 0, 1), item(19, 8, 0, 4), item(24, 0, 0, 18), item(99, 99, 0, 1)];
    const reference = buildVisibilityReference(items);
    expect(Array.from(reference.visibleIndices)).toEqual([7, 19, 24]);
    expect(reference.lodCounts.reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(reference.indirect[1]).toBe(3);
    expect(lodForInstance(items[0])).toBe(0);
    expect(lodForInstance(items[2])).toBe(2);
  });

  it("writes a 32-byte indexed indirect command with firstInstance zero", () => {
    const command = createIndexedIndirectCommand(6, 42);
    expect(command.byteLength).toBe(INDEXED_INDIRECT_STRIDE_BYTES);
    expect(Array.from(command.slice(0, 5))).toEqual([6, 42, 0, 0, 0]);
    expect(Array.from(command.slice(5))).toEqual([0, 0, 0]);
  });

  it("destroys tracked GPU-like resources exactly once in reverse ownership order", () => {
    const destroyed: string[] = [];
    const scope = new VisibilityResourceScope();
    scope.track({ destroy: () => destroyed.push("instance") });
    scope.track({ destroy: () => destroyed.push("indirect") });
    scope.dispose();
    scope.dispose();
    scope.track({ destroy: () => destroyed.push("late") });
    expect(destroyed).toEqual(["indirect", "instance", "late"]);
  });
});
