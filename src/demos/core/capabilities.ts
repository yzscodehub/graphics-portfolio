import type { DemoCapability } from "./types";

interface WebGpuAdapterLike {
  requestDevice?: () => Promise<unknown>;
}

interface WebGpuLike {
  requestAdapter(): Promise<WebGpuAdapterLike | null>;
}

export interface CapabilityProbe {
  coarsePointer?: boolean;
  reducedMotion?: boolean;
  wasm?: boolean;
  webgl2?: boolean;
  webgpu?: WebGpuLike;
}

export interface CapabilitySnapshot {
  webgpu: boolean;
  webgpuAdapter: boolean;
  webgl2: boolean;
  wasm: boolean;
  reducedMotion: boolean;
  coarsePointer: boolean;
}

export function getCapabilities(probe = getBrowserProbe()): CapabilitySnapshot {
  return {
    webgpu: Boolean(probe.webgpu),
    webgpuAdapter: false,
    webgl2: Boolean(probe.webgl2),
    wasm: probe.wasm ?? false,
    reducedMotion: probe.reducedMotion ?? false,
    coarsePointer: probe.coarsePointer ?? false,
  };
}

/**
 * Confirms that the browser can return a WebGPU adapter. Device creation remains
 * the responsibility of the individual renderer so the runtime does not allocate
 * an unused device merely for capability reporting.
 */
export async function measureCapabilities(probe = getBrowserProbe()): Promise<CapabilitySnapshot> {
  const snapshot = getCapabilities(probe);
  if (!probe.webgpu) return snapshot;
  try {
    const adapter = await probe.webgpu.requestAdapter();
    return { ...snapshot, webgpu: Boolean(adapter), webgpuAdapter: Boolean(adapter) };
  } catch {
    return { ...snapshot, webgpu: false, webgpuAdapter: false };
  }
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

function getBrowserProbe(): CapabilityProbe {
  if (typeof window === "undefined" || typeof document === "undefined") return {};
  const navigatorGpu = (navigator as Navigator & { gpu?: WebGpuLike }).gpu;
  const canvas = document.createElement("canvas");
  return {
    webgpu: navigatorGpu,
    webgl2: Boolean(canvas.getContext("webgl2")),
    wasm: typeof WebAssembly !== "undefined",
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
  };
}
