import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type HardwareReviewStatus = "pending" | "passed";
export type RenderingAcceptanceStatus = "pending" | "reviewed";

interface RenderingAcceptanceTarget {
  os: string;
  adapterClass: string;
  browser: string;
  viewportWidth: number;
  viewportHeight: number;
  dpr: number;
}

export interface RenderingDemoAcceptance {
  slug: string;
  status: HardwareReviewStatus;
  required: string[];
}

interface RenderingAcceptanceManifest {
  version: number;
  status: RenderingAcceptanceStatus;
  target: RenderingAcceptanceTarget;
  reviewedRun: null | Record<string, unknown>;
  demos: RenderingDemoAcceptance[];
}

function resolveProjectFile(relativePath: string): string {
  let directory = process.cwd();
  while (true) {
    const candidate = path.resolve(directory, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Unable to resolve project evidence file: ${relativePath}`);
}

export const renderingAcceptance = JSON.parse(
  readFileSync(resolveProjectFile("public/evidence/rendering-v2-acceptance.json"), "utf8"),
) as RenderingAcceptanceManifest;

export function acceptanceFor(slug: string): RenderingDemoAcceptance {
  const entry = renderingAcceptance.demos.find((demo) => demo.slug === slug);
  if (!entry) throw new Error(`Missing rendering acceptance entry: ${slug}`);
  return entry;
}
export function effectiveHardwareReview(slug: string): HardwareReviewStatus {
  const entry = acceptanceFor(slug);
  return entry.status === "passed" &&
    renderingAcceptance.status === "reviewed" &&
    renderingAcceptance.reviewedRun !== null &&
    typeof renderingAcceptance.reviewedRun === "object" &&
    !Array.isArray(renderingAcceptance.reviewedRun)
    ? "passed"
    : "pending";
}

export function referenceTargetLabel(): string {
  const target = renderingAcceptance.target;
  return `${target.os} / ${target.adapterClass} / ${target.browser} / ${target.viewportWidth}x${target.viewportHeight} / DPR ${target.dpr}`;
}
