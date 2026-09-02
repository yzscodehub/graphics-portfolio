import { describe, expect, it } from "vitest";

import {
  compressResearchCourtyardBuffers,
  decodeResearchCourtyardMeshoptBuffer,
  ResearchCourtyardMeshoptError,
} from "../scripts/assets/research-courtyard-meshopt.mjs";

function bytes(length: number, seed: number) {
  return Uint8Array.from({ length }, (_, index) => (index * 17 + seed) & 0xff);
}

function fixture() {
  return {
    vertices: bytes(32 * 12, 1),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]).buffer,
    materials: bytes(64 * 2, 2),
    instances: bytes(128 * 3, 3),
    indirect: bytes(32 * 3, 4),
  };
}

describe("Research Courtyard Meshopt transport", () => {
  it("pins v1 codecs and round-trips every buffer byte exactly", async () => {
    const result = await compressResearchCourtyardBuffers(fixture());
    expect(result.manifest).toMatchObject({
      packageVersion: "1.1.1",
      codecVersion: 1,
      budgetBytes: 3.5 * 1024 * 1024,
    });
    const compressed = result.buffers as Record<string, Uint8Array>;
    for (const [name, record] of Object.entries(result.manifest.records)) {
      const decoded = decodeResearchCourtyardMeshoptBuffer(compressed[name], record);
      expect(decoded).toEqual(
        new Uint8Array(fixture()[name as keyof ReturnType<typeof fixture>] as ArrayBuffer),
      );
    }
  });

  it("is deterministic across repeated encodes", async () => {
    const first = await compressResearchCourtyardBuffers(fixture());
    const second = await compressResearchCourtyardBuffers(fixture());
    expect(first.manifest).toEqual(second.manifest);
    const firstBuffers = first.buffers as Record<string, Uint8Array>;
    const secondBuffers = second.buffers as Record<string, Uint8Array>;
    for (const name of Object.keys(firstBuffers))
      expect(firstBuffers[name]).toEqual(secondBuffers[name]);
  });

  it("fails closed on missing or misaligned buffers", async () => {
    const missing = fixture();
    delete (missing as Partial<typeof missing>).indirect;
    await expect(compressResearchCourtyardBuffers(missing)).rejects.toBeInstanceOf(
      ResearchCourtyardMeshoptError,
    );
    const misaligned = fixture();
    misaligned.vertices = new Uint8Array(31);
    await expect(compressResearchCourtyardBuffers(misaligned)).rejects.toThrow(/aligned/);
  });
});
