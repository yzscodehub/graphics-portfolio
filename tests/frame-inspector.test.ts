import { describe, expect, it } from "vitest";
import { bufferViewAtPoint, calculateFrameInspectorLayout } from "../src/demos/frame-inspector";

describe("Frame Inspector layout", () => {
  it("does not create drawable cells for the 1x1 initialization size", () => {
    expect(calculateFrameInspectorLayout(1, 1)).toBeUndefined();
  });

  it("uses four rows below the narrow-layout breakpoint", () => {
    const layout = calculateFrameInspectorLayout(539, 300);

    expect(layout).toMatchObject({ columns: 2, rows: 4 });
  });

  it("uses the same narrow-layout grid for hit testing", () => {
    const layout = calculateFrameInspectorLayout(400, 300);
    expect(layout).toBeDefined();
    if (!layout) return;

    expect(bufferViewAtPoint(layout, 20, 20)).toBe("final");
    expect(
      bufferViewAtPoint(
        layout,
        layout.gap + layout.cellWidth + layout.gap + 20,
        layout.gap + 3 * (layout.cellHeight + layout.gap) + 20,
      ),
    ).toBe("history");
    expect(bufferViewAtPoint(layout, layout.gap + layout.cellWidth + 1, 20)).toBeUndefined();
  });
});
