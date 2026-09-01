import { describe, expect, it } from "vitest";
import {
  buildVisibilityReference,
  createLodIndirectCommands,
  createIndexedIndirectCommand,
  createVisibilityInstanceData,
  DEFAULT_VISIBILITY_FRUSTUM,
  frustumForCamera,
  INDEXED_INDIRECT_STRIDE_BYTES,
  isInstanceVisible,
  lodForInstance,
  packLodIndirectCommands,
  validateVisibilityCommandReadback,
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
    expect(Array.from(reference.lodIndices[0])).toEqual([7, 19]);
    expect(Array.from(reference.lodIndices[1])).toEqual([]);
    expect(Array.from(reference.lodIndices[2])).toEqual([24]);
    expect(reference.indirectCommands.map((command) => command[1])).toEqual([2, 0, 1]);
    expect(lodForInstance(items[0])).toBe(0);
    expect(lodForInstance(items[2])).toBe(2);
  });

  it("writes three 32-byte LOD indirect commands with distinct index ranges and firstInstance zero", () => {
    const command = createIndexedIndirectCommand(6, 42);
    expect(command.byteLength).toBe(INDEXED_INDIRECT_STRIDE_BYTES);
    expect(Array.from(command.slice(0, 5))).toEqual([6, 42, 0, 0, 0]);
    expect(Array.from(command.slice(5))).toEqual([0, 0, 0]);
    const commands = createLodIndirectCommands([4, 5, 6]);
    expect(commands.map((entry) => Array.from(entry.slice(0, 5)))).toEqual([
      [18, 4, 0, 0, 0],
      [12, 5, 18, 0, 0],
      [6, 6, 30, 0, 0],
    ]);
  });

  it("validates readback for all three command slices and the LOD distribution", () => {
    const values = new Uint32Array(3 * 8 + 5);
    values.set(packLodIndirectCommands([3, 2, 1]));
    values.set([32, 6, 3, 2, 1], 3 * 8);
    expect(validateVisibilityCommandReadback(values, 32)).toMatchObject({
      tested: 32,
      visible: 6,
      lodCounts: [3, 2, 1],
      valid: true,
    });
    values[4] = 1;
    expect(validateVisibilityCommandReadback(values, 32).valid).toBe(false);
  });

  it("moves the shared frustum when the observable camera state changes", () => {
    const shifted = frustumForCamera(3);
    expect(shifted.left).toBe(DEFAULT_VISIBILITY_FRUSTUM.left + 3);
    expect(shifted.right).toBe(DEFAULT_VISIBILITY_FRUSTUM.right + 3);
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
