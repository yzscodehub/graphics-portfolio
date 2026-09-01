export const demoOrder = [
  "material-lighting",
  "clustered-lighting",
  "render-graph",
  "gpu-particles",
  "shadow-aa",
  "path-tracer",
  "frame-inspector",
  "neural-denoising",
] as const;

export type OrderedDemoSlug = (typeof demoOrder)[number];

const demoOrderIndex = new Map<string, number>(demoOrder.map((slug, index) => [slug, index]));

export function compareDemoSlugs(left: string, right: string): number {
  return (
    (demoOrderIndex.get(left) ?? Number.MAX_SAFE_INTEGER) -
    (demoOrderIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
  );
}
