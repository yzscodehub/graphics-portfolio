import { describe, expect, it } from "vitest";
import { decodeFloat16LittleEndian } from "../src/demos/neural-denoising";

describe("Neural Float16 held-out packs", () => {
  it("decodes IEEE-754 half values into Float32 without byte reinterpretation", () => {
    const packed = new Uint16Array([0x0000, 0x3c00, 0xc000, 0x0001, 0x7c00, 0x7e00]);
    const decoded = decodeFloat16LittleEndian(packed.buffer);

    expect(decoded[0]).toBe(0);
    expect(decoded[1]).toBe(1);
    expect(decoded[2]).toBe(-2);
    expect(decoded[3]).toBeCloseTo(2 ** -24);
    expect(decoded[4]).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(decoded[5])).toBe(true);
  });

  it("rejects invalid Float16 byte lengths", () => {
    expect(() => decodeFloat16LittleEndian(new ArrayBuffer(3))).toThrow("multiple of two");
  });
});
