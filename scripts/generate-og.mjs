import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const outputRoot = path.join(root, "public/og");
const fontRoot = path.join(root, "scripts/assets/fonts");
const [sansFont, monoFont] = await Promise.all([
  readFile(path.join(fontRoot, "IBMPlexSansCondensed-Bold.ttf")),
  readFile(path.join(fontRoot, "IBMPlexMono-Regular.ttf")),
]);
const sansFontData = sansFont.toString("base64");
const monoFontData = monoFont.toString("base64");

const projects = [
  ["engine-systems-explorer", "Engine Systems Explorer", "RENDER GRAPH / FRAME OBSERVABILITY"],
  ["real-time-rendering-lab", "Real-Time Rendering Lab", "WEBGPU / TSL / PBR"],
  ["webgpu-compute-lab", "WebGPU Compute Lab", "COMPUTE / PARTICLES / PATHS"],
  ["neural-graphics-lab", "Neural Graphics Lab", "ONNX / HELD-OUT EVIDENCE"],
];

const demos = [
  ["material-lighting", "Material & Lighting", "WEBGPU / TSL / PBR / IBL"],
  ["clustered-lighting", "Clustered / Deferred Lighting", "GBUFFER / CLUSTER LIGHT LIST"],
  ["render-graph", "Render Graph Explorer", "CULL / LIFETIME / ALIAS"],
  ["gpu-particles", "GPU-Driven Visibility & Compute", "SIMULATION / LOD / INDIRECT"],
  ["shadow-aa", "Shadow & Temporal AA", "PCSS / FXAA / TAA"],
  ["path-tracer", "Progressive Path Tracer", "BVH / WGSL / LINEAR HDR"],
  ["frame-inspector", "Frame Inspector", "GBUFFER / VELOCITY / HISTORY"],
  ["neural-denoising", "Neural Denoising", "WEBGPU / WASM / PSNR"],
];

const articleFiles = (await readdir(path.join(root, "src/content/writing"))).filter((file) =>
  file.endsWith(".md"),
);
const articles = await Promise.all(
  articleFiles.map(async (file) => {
    const source = await readFile(path.join(root, "src/content/writing", file), "utf8");
    const slug = frontmatterScalar(source, "routeSlug");
    const title = frontmatterScalar(source, "englishTitle");
    if (!slug || !title) throw new Error(`Missing routeSlug or englishTitle in ${file}`);
    return [slug, title, "TECHNICAL WRITING / GRAPHICS SYSTEMS"];
  }),
);

const cards = [
  ["default", "Graphics Systems Engineer", "RENDERING / ENGINE / GPU / NEURAL"],
  ...projects.map(([slug, title, subtitle]) => [`projects/${slug}`, title, subtitle]),
  ...demos.map(([slug, title, subtitle]) => [`demos/${slug}`, title, subtitle]),
  ...articles.map(([slug, title, subtitle]) => [`writing/${slug}`, title, subtitle]),
];

const generatedCards = [];
for (const [relative, title, subtitle] of cards) {
  const target = path.join(outputRoot, `${relative}.png`);
  await mkdir(path.dirname(target), { recursive: true });
  const info = await sharp(Buffer.from(svg(title, subtitle)))
    .png({ compressionLevel: 9, palette: true })
    .toFile(target);
  const bytes = await readFile(target);
  generatedCards.push({
    path: `/og/${relative}.png`,
    title,
    width: info.width,
    height: info.height,
    bytes: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

await writeFile(
  path.join(outputRoot, "manifest.json"),
  JSON.stringify(
    {
      version: 2,
      generatedBy: "scripts/generate-og.mjs",
      fontSources: [
        "scripts/assets/fonts/IBMPlexSansCondensed-Bold.ttf",
        "scripts/assets/fonts/IBMPlexMono-Regular.ttf",
      ],
      cards: generatedCards,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
console.log(`Generated ${cards.length} Open Graph PNG cards.`);

function svg(title, subtitle) {
  const safeSubtitle = escapeXml(subtitle);
  const titleLines = wrapTitle(title, 30);
  const titleFontSize = titleLines.length === 1 ? 68 : titleLines.length === 2 ? 54 : 46;
  const titleStartY = titleLines.length === 1 ? 330 : titleLines.length === 2 ? 286 : 250;
  const titleLineHeight = Math.round(titleFontSize * 1.08);
  const subtitleY = titleLines.length === 1 ? 382 : titleLines.length === 2 ? 420 : 438;
  const titleMarkup = titleLines
    .map(
      (line, index) =>
        `<tspan x="92" y="${titleStartY + index * titleLineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <style>
      @font-face { font-family: PlexSans; src: url(data:font/ttf;base64,${sansFontData}); font-weight: 700; }
      @font-face { font-family: PlexMono; src: url(data:font/ttf;base64,${monoFontData}); font-weight: 400; }
    </style>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#31433f" stroke-opacity=".32"/></pattern>
    <radialGradient id="signal"><stop stop-color="#57e3c2" stop-opacity=".28"/><stop offset="1" stop-color="#080b0d" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#080b0d"/><rect width="1200" height="630" fill="url(#grid)"/>
  <circle cx="930" cy="180" r="330" fill="url(#signal)"/><path d="M52 52h1096v526H52zM52 146h1096M870 52v94" fill="none" stroke="#31433f"/>
  <path d="M92 100h38M1070 532h38" stroke="#57e3c2" stroke-width="3"/>
  <text x="92" y="112" fill="#57e3c2" font-family="PlexMono" font-size="20" letter-spacing="4">YZSCODEHUB / GRAPHICS SYSTEMS</text>
  <text x="900" y="110" fill="#f0b84b" font-family="PlexMono" font-size="18">PUBLIC WORKBENCH</text>
  <text fill="#e8e6dc" font-family="PlexSans" font-size="${titleFontSize}" font-weight="700">${titleMarkup}</text>
  <text x="94" y="${subtitleY}" fill="#8fa29f" font-family="PlexMono" font-size="22" letter-spacing="2">${safeSubtitle}</text>
  <g transform="translate(900 300)" fill="none" stroke="#57e3c2"><circle r="92"/><circle r="58" stroke="#f0b84b" stroke-dasharray="4 9"/><path d="M-138 0h276M0-138v276" stroke-opacity=".34"/></g>
  <text x="92" y="540" fill="#8fa29f" font-family="PlexMono" font-size="18">ASTRO / WEBGPU / WGSL / ONNX</text>
  </svg>`;
}

function wrapTitle(value, maxCharacters) {
  const words = value.split(/\s+/);
  const lines = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > maxCharacters) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length <= 3) return lines;
  return [lines[0], lines[1], lines.slice(2).join(" ")];
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function frontmatterScalar(source, field) {
  const value = source.match(new RegExp(`^${field}:\\s*(.+)$`, "m"))?.[1]?.trim();
  if (!value) return undefined;
  const quote = value[0];
  return (quote === '"' || quote === "'") && value.at(-1) === quote ? value.slice(1, -1) : value;
}
