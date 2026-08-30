import type { AaTechnique } from "./types";

export function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1;
  let value = Math.max(0, Math.floor(index));
  while (value > 0) {
    fraction /= base;
    result += fraction * (value % base);
    value = Math.floor(value / base);
  }
  return result;
}

export function taaJitter(frameIndex: number, width: number, height: number): [number, number] {
  if (width <= 0 || height <= 0) return [0, 0];
  const sequenceIndex = (Math.max(0, Math.floor(frameIndex)) % 8) + 1;
  return [(halton(sequenceIndex, 2) - 0.5) / width, (halton(sequenceIndex, 3) - 0.5) / height];
}

export interface HistoryState {
  width: number;
  height: number;
  aa: AaTechnique;
  shadow: string;
  sceneRevision: number;
}

export function shouldResetHistory(
  previous: HistoryState | undefined,
  next: HistoryState,
): boolean {
  if (!previous) return true;
  return (
    previous.width !== next.width ||
    previous.height !== next.height ||
    previous.aa !== next.aa ||
    previous.shadow !== next.shadow ||
    previous.sceneRevision !== next.sceneRevision
  );
}
