import type { DemoCapability } from "./types";

export interface CapabilitySnapshot {
  webgpu: boolean;
  webgl2: boolean;
  wasm: boolean;
  reducedMotion: boolean;
  coarsePointer: boolean;
}

export function getCapabilities(): CapabilitySnapshot {
  if (typeof window === "undefined") {
    return {
      webgpu: false,
      webgl2: false,
      wasm: false,
      reducedMotion: false,
      coarsePointer: false,
    };
  }

  const probe = document.createElement("canvas");
  return {
    webgpu: Boolean((navigator as Navigator & { gpu?: unknown }).gpu),
    webgl2: Boolean(probe.getContext("webgl2")),
    wasm: typeof WebAssembly !== "undefined",
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
  };
}

export function hasCapabilities(
  required: DemoCapability[],
  available = getCapabilities(),
): boolean {
  return required.every((capability) => available[capability]);
}

export function shouldUseStaticFallback(
  forceLive: boolean,
  capabilities = getCapabilities(),
): boolean {
  return !forceLive && (capabilities.coarsePointer || capabilities.reducedMotion);
}
