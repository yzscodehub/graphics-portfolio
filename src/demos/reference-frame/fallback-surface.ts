import { resizeCanvas } from "../core/canvas";
import type { DemoContext } from "../core/types";

/**
 * A WebGPU canvas cannot be repurposed as a 2D canvas after it has acquired a
 * GPU context. Device-loss fallbacks therefore draw into a short-lived sibling
 * surface instead of calling getContext("2d") on the original canvas.
 */
export class CanvasFallbackSurface {
  readonly canvas: HTMLCanvasElement;
  private readonly originalCanvasWasHidden: boolean | "until-found";
  private disposed = false;

  constructor(
    private readonly shell: DemoContext,
    label: string,
  ) {
    this.originalCanvasWasHidden = shell.canvas.hidden;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", label);
    this.canvas.dataset.referenceFallback = "true";
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.zIndex = "1";
    this.canvas.style.display = "block";
    this.shell.canvas.hidden = true;
    this.shell.stage.append(this.canvas);
  }

  resize(width: number, height: number): CanvasRenderingContext2D {
    if (this.disposed) throw new Error("Canvas fallback surface has been disposed.");
    return resizeCanvas(this.canvas, width, height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.remove();
    this.shell.canvas.hidden = this.originalCanvasWasHidden;
  }
}
