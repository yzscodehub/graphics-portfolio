import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const demoRoot = path.join(root, "public/media/demos");
const projectRoot = path.join(root, "public/media/projects");
await mkdir(demoRoot, { recursive: true });
await mkdir(projectRoot, { recursive: true });

const palette = {
  bg: "#080b0d",
  panel: "#10191a",
  line: "#31433f",
  text: "#e8e6dc",
  muted: "#8fa29f",
  mint: "#57e3c2",
  amber: "#f0b84b",
  rust: "#d86652",
  blue: "#76a9fa",
};

const escape = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function frame(title, subtitle, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img" aria-labelledby="title desc">
  <title id="title">${escape(title)}</title><desc id="desc">${escape(subtitle)}</desc>
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${palette.line}" stroke-opacity=".34"/></pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.mint}" stop-opacity=".16"/><stop offset="1" stop-color="${palette.amber}" stop-opacity=".03"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  <rect width="1600" height="900" fill="${palette.bg}"/><rect width="1600" height="900" fill="url(#grid)"/>
  <rect x="52" y="52" width="1496" height="796" rx="4" fill="url(#fade)" stroke="${palette.line}"/>
  <path d="M52 150h1496M1080 52v98" stroke="${palette.line}"/>
  <text x="92" y="112" fill="${palette.mint}" font-family="monospace" font-size="24" letter-spacing="4">GRAPHICS SYSTEMS / VERIFIED STUDY</text>
  <text x="1108" y="104" fill="${palette.amber}" font-family="monospace" font-size="20">1600×900 / LOCAL ASSET</text>
  ${body}
  <text x="92" y="792" fill="${palette.text}" font-family="Arial Narrow, sans-serif" font-weight="700" font-size="64">${escape(title)}</text>
  <text x="94" y="828" fill="${palette.muted}" font-family="monospace" font-size="20">${escape(subtitle)}</text>
  </svg>`.replace(/[ \t]+$/gm, "");
}

const demoBodies = {
  "material-lighting": `
    <circle cx="760" cy="420" r="190" fill="#172522" stroke="${palette.mint}" stroke-width="2"/>
    <circle cx="705" cy="355" r="122" fill="${palette.mint}" opacity=".2" filter="url(#soft)"/>
    <circle cx="708" cy="350" r="38" fill="#f5f1d9"/><path d="M220 650h1080" stroke="${palette.line}"/>
    <path d="M1140 210 905 380M1185 254 930 410M1080 178 875 350" stroke="${palette.amber}" stroke-width="3" stroke-opacity=".65"/>
    <g fill="${palette.muted}" font-family="monospace" font-size="18"><text x="180" y="250">PBR / IBL</text><text x="180" y="282">ROUGHNESS 0.28</text><text x="180" y="314">METALNESS 0.72</text><text x="180" y="346">ACES 1.10 EV</text></g>`,
  "clustered-lighting": `
    <path d="M180 610V250h1240v360M180 250l230-110h780l230 110" fill="${palette.panel}" stroke="${palette.line}" stroke-width="3"/>
    <g fill="none" stroke="${palette.mint}" stroke-opacity=".45">${Array.from({ length: 8 }, (_, x) => `<path d="M${290 + x * 135} 250v360"/>`).join("")}${Array.from({ length: 4 }, (_, y) => `<path d="M180 ${322 + y * 72}h1240"/>`).join("")}</g>
    <g>${Array.from({ length: 54 }, (_, i) => {
      const x = 225 + (i % 9) * 140;
      const y = 285 + Math.floor(i / 9) * 52;
      const colors = [palette.mint, palette.amber, palette.blue, palette.rust];
      return `<circle cx="${x}" cy="${y}" r="${5 + (i % 5) * 2}" fill="${colors[i % colors.length]}" opacity=".72"/>`;
    }).join("")}</g>
    <rect x="230" y="640" width="1140" height="18" fill="${palette.line}"/><rect x="230" y="640" width="760" height="18" fill="${palette.amber}"/>
    <text x="230" y="705" fill="${palette.text}" font-family="monospace" font-size="20">NAIVE / DEFERRED / CLUSTERED</text><text x="1040" y="705" fill="${palette.muted}" font-family="monospace" font-size="18">512 LIGHTS / OVERFLOW 0</text>`,
  "render-graph": `
    <g fill="${palette.panel}" stroke="${palette.mint}" stroke-width="2"><rect x="160" y="280" width="220" height="92"/><rect x="500" y="210" width="220" height="92"/><rect x="500" y="430" width="220" height="92"/><rect x="850" y="300" width="220" height="92"/><rect x="1190" y="300" width="220" height="92"/></g>
    <g stroke="${palette.amber}" stroke-width="4" fill="none"><path d="M380 326C440 326 440 256 500 256"/><path d="M380 326C440 326 440 476 500 476"/><path d="M720 256C790 256 790 346 850 346"/><path d="M720 476C790 476 790 346 850 346"/><path d="M1070 346h120"/></g>
    <g fill="${palette.text}" font-family="monospace" font-size="20" text-anchor="middle"><text x="270" y="334">DEPTH</text><text x="610" y="264">GBUFFER</text><text x="610" y="484">SSAO</text><text x="960" y="354">LIGHTING</text><text x="1300" y="354">PRESENT</text></g>
    <text x="500" y="590" fill="${palette.muted}" font-family="monospace" font-size="18">CULL → TOPOLOGY → LIFETIME → ALIAS → USAGE PLAN</text>`,
  "gpu-particles": `
    <g fill="${palette.mint}" opacity=".75">${Array.from({ length: 180 }, (_, i) => {
      const angle = i * 2.399;
      const radius = 18 + i * 2.2;
      const x = 790 + Math.cos(angle) * radius;
      const y = 395 + Math.sin(angle) * radius * 0.58;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 7 === 0 ? 4 : 2}"/>`;
    }).join("")}</g>
    <circle cx="790" cy="395" r="52" fill="${palette.amber}" opacity=".22"/><path d="M260 250h240v90H260zM1100 250h240v90h-240z" fill="${palette.panel}" stroke="${palette.line}"/>
    <text x="380" y="304" fill="${palette.text}" font-family="monospace" font-size="22" text-anchor="middle">STATE A / READ</text><text x="1220" y="304" fill="${palette.text}" font-family="monospace" font-size="22" text-anchor="middle">STATE B / WRITE</text>
    <path d="M500 295h190M1090 295H900" stroke="${palette.amber}" stroke-width="4"/><text x="690" y="278" fill="${palette.muted}" font-family="monospace" font-size="17">COMPUTE</text>`,
  "shadow-aa": `
    <rect x="190" y="210" width="1220" height="430" fill="${palette.panel}" stroke="${palette.line}"/><circle cx="690" cy="390" r="112" fill="${palette.mint}"/>
    <ellipse cx="890" cy="540" rx="260" ry="54" fill="#000" opacity=".7"/><ellipse cx="890" cy="540" rx="330" ry="82" fill="#000" opacity=".2" filter="url(#soft)"/>
    <path d="M1080 208 780 350" stroke="${palette.amber}" stroke-width="5"/>
    <g fill="${palette.text}" font-family="monospace" font-size="20"><text x="250" y="268">HARD / PCF / PCSS</text><text x="250" y="302">NONE / FXAA / TAA</text><text x="1110" y="600">DEPTH + VELOCITY + HISTORY</text></g>`,
  "path-tracer": `
    <path d="M300 210h1000v430H300z" fill="${palette.panel}" stroke="${palette.line}"/><path d="M300 210 500 350v290M1300 210 1100 350v290" fill="none" stroke="${palette.line}"/>
    <rect x="520" y="430" width="220" height="210" fill="${palette.amber}" opacity=".7"/><rect x="880" y="380" width="190" height="260" fill="${palette.blue}" opacity=".55"/>
    <rect x="680" y="220" width="250" height="18" fill="#fff2b0"/>
    <g stroke="${palette.mint}" stroke-width="2" opacity=".75"><path d="M160 620 690 230 600 500 770 520"/><path d="M160 620 860 230 960 420 720 540"/><path d="M160 620 770 230 1010 510 620 430"/></g>
    <text x="350" y="276" fill="${palette.text}" font-family="monospace" font-size="20">CPU BVH / WGSL TRAVERSAL / LINEAR HDR</text>`,
  "frame-inspector": `
    ${["FINAL", "ALBEDO", "NORMAL", "DEPTH", "VELOCITY", "LIGHTING", "SSAO", "HISTORY"]
      .map((name, i) => {
        const x = 165 + (i % 4) * 320;
        const y = 220 + Math.floor(i / 4) * 205;
        const colors = [
          palette.mint,
          palette.rust,
          palette.blue,
          "#d7d5ca",
          palette.amber,
          "#ffe49a",
          "#777f7c",
          "#5f9db3",
        ];
        return `<rect x="${x}" y="${y}" width="270" height="155" fill="${colors[i]}" fill-opacity=".22" stroke="${i === 0 ? palette.mint : palette.line}"/><text x="${x + 18}" y="${y + 34}" fill="${palette.text}" font-family="monospace" font-size="18">${name}</text><path d="M${x + 18} ${y + 118}h${190 - i * 8}" stroke="${colors[i]}" stroke-width="5"/>`;
      })
      .join("")}`,
  "neural-denoising": `
    <rect x="160" y="220" width="340" height="340" fill="${palette.panel}" stroke="${palette.line}"/><rect x="1100" y="220" width="340" height="340" fill="${palette.panel}" stroke="${palette.mint}"/>
    <g fill="${palette.text}" opacity=".38">${Array.from({ length: 90 }, (_, i) => `<circle cx="${180 + (i % 10) * 31}" cy="${242 + Math.floor(i / 10) * 34}" r="${2 + (i % 4)}"/>`).join("")}</g>
    <circle cx="1270" cy="390" r="112" fill="${palette.mint}" opacity=".5"/><g stroke="${palette.amber}" fill="${palette.panel}">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<circle cx="${610 + i * 58}" cy="${330 + (i % 2) * 120}" r="18"/>`).join("")}</g>
    <path d="M500 390h110M1070 390h30" stroke="${palette.amber}" stroke-width="4"/><text x="160" y="600" fill="${palette.muted}" font-family="monospace" font-size="18">1 SPP / HELD-OUT</text><text x="1100" y="600" fill="${palette.muted}" font-family="monospace" font-size="18">ONNX / ERROR / PSNR</text>`,
};

const demos = [
  ["material-lighting", "Material & Lighting", "WEBGPU / TSL / PBR / IBL"],
  [
    "clustered-lighting",
    "Clustered / Deferred Lighting",
    "GBUFFER / DEPTH SLICES / CLUSTER LIGHT LIST",
  ],
  ["render-graph", "Render Graph Explorer", "CULLING / LIFETIME / ALIAS / USAGE"],
  ["gpu-particles", "GPU-Driven Visibility & Compute", "SIMULATION / CULLING / LOD / INDIRECT"],
  ["shadow-aa", "Shadow & Temporal AA", "PCF / PCSS / FXAA / TAA"],
  ["path-tracer", "Progressive Path Tracer", "CPU BVH / WGSL / LINEAR ACCUMULATION"],
  ["frame-inspector", "Frame Inspector", "GBUFFER / DEPTH / VELOCITY / HISTORY"],
  ["neural-denoising", "Neural Denoising", "HELD-OUT / ONNX / WEBGPU / WASM"],
];

const projectBodies = {
  "engine-systems-explorer":
    demoBodies["render-graph"] +
    `<text x="1120" y="700" fill="${palette.amber}" font-family="monospace" font-size="18">ENGINE / OBSERVABILITY</text>`,
  "real-time-rendering-lab":
    demoBodies["material-lighting"] +
    `<text x="1120" y="700" fill="${palette.amber}" font-family="monospace" font-size="18">RENDERING / CALIBRATION</text>`,
  "webgpu-compute-lab":
    demoBodies["gpu-particles"] +
    `<text x="1120" y="700" fill="${palette.amber}" font-family="monospace" font-size="18">COMPUTE / PATHS</text>`,
  "neural-graphics-lab":
    demoBodies["neural-denoising"] +
    `<text x="1120" y="700" fill="${palette.amber}" font-family="monospace" font-size="18">MODEL / EVIDENCE</text>`,
};

const architectureBodies = {
  "engine-systems-explorer": `
    <g fill="${palette.panel}" stroke="${palette.mint}" stroke-width="2">${["DECLARE", "VALIDATE", "CULL", "TOPOLOGY", "LIFETIME", "ALIAS", "INSPECT"].map((label, index) => `<rect x="${105 + index * 205}" y="320" width="158" height="82"/><text x="${184 + index * 205}" y="369" fill="${palette.text}" stroke="none" text-anchor="middle" font-family="monospace" font-size="18">${label}</text>`).join("")}</g>
    <path d="M263 361h47m158 0h47m158 0h47m158 0h47m158 0h47m158 0h47" stroke="${palette.amber}" stroke-width="4"/>
    <text x="105" y="470" fill="${palette.muted}" font-family="monospace" font-size="20">VERSIONED RESOURCES / ROOT TRACING / TRANSIENT SLOTS / USAGE PLAN</text>`,
  "real-time-rendering-lab": `
    <g fill="${palette.panel}" stroke="${palette.line}" stroke-width="2"><rect x="120" y="245" width="260" height="230"/><rect x="500" y="245" width="260" height="230"/><rect x="880" y="245" width="260" height="230"/><rect x="1260" y="245" width="220" height="230"/></g>
    <g fill="${palette.text}" font-family="monospace" font-size="20"><text x="155" y="292">MATERIAL INPUTS</text><text x="535" y="292">TSL NODE GRAPH</text><text x="915" y="292">WEBGPU RENDERER</text><text x="1295" y="292">OUTPUT</text></g>
    <g fill="${palette.muted}" font-family="monospace" font-size="17"><text x="155" y="342">BASE COLOR</text><text x="155" y="376">METAL / ROUGH</text><text x="155" y="410">EXPOSURE</text><text x="535" y="342">PBR / NORMAL</text><text x="535" y="376">DIRECT / INDIRECT</text><text x="915" y="342">WEBGPU</text><text x="915" y="376">WEBGL2 FALLBACK</text><text x="1295" y="342">ACES / AgX</text><text x="1295" y="376">DEBUG VIEWS</text></g>
    <path d="M380 360h120m260 0h120m260 0h120" stroke="${palette.amber}" stroke-width="4"/>`,
  "webgpu-compute-lab": `
    <g fill="${palette.panel}" stroke="${palette.mint}" stroke-width="2"><rect x="120" y="230" width="250" height="100"/><rect x="500" y="230" width="250" height="100"/><rect x="880" y="230" width="250" height="100"/><rect x="1260" y="230" width="220" height="100"/></g>
    <g fill="${palette.panel}" stroke="${palette.amber}" stroke-width="2"><rect x="120" y="445" width="250" height="100"/><rect x="500" y="445" width="250" height="100"/><rect x="880" y="445" width="250" height="100"/><rect x="1260" y="445" width="220" height="100"/></g>
    <g fill="${palette.text}" font-family="monospace" font-size="18" text-anchor="middle"><text x="245" y="286">PARTICLE BUFFER A</text><text x="625" y="286">COMPUTE / B</text><text x="1005" y="286">RENDER PASS</text><text x="1370" y="286">TIMESTAMP</text><text x="245" y="501">CPU TRIANGLES</text><text x="625" y="501">MEDIAN BVH</text><text x="1005" y="501">WGSL TRACE</text><text x="1370" y="501">HDR ACCUM</text></g>
    <path d="M370 280h130m250 0h130m250 0h130M370 495h130m250 0h130m250 0h130" stroke="${palette.muted}" stroke-width="4"/>`,
  "neural-graphics-lab": `
    <g fill="${palette.panel}" stroke="${palette.line}" stroke-width="2"><rect x="120" y="290" width="250" height="130"/><rect x="480" y="290" width="250" height="130"/><rect x="840" y="290" width="250" height="130"/><rect x="1200" y="290" width="250" height="130"/></g>
    <g fill="${palette.text}" font-family="monospace" font-size="19" text-anchor="middle"><text x="245" y="348">HASHED PAIR</text><text x="245" y="382">1 SPP / 64 SPP</text><text x="605" y="348">8-LAYER CNN</text><text x="605" y="382">ONNX &lt; 5 MB</text><text x="965" y="348">WEBGPU / WASM</text><text x="965" y="382">EXPLICIT RUN</text><text x="1325" y="348">L1 / PSNR</text><text x="1325" y="382">P50 / P95</text></g>
    <path d="M370 355h110m250 0h110m250 0h110" stroke="${palette.amber}" stroke-width="4"/><text x="120" y="505" fill="${palette.muted}" font-family="monospace" font-size="18">FAIL CLOSED TO DETERMINISTIC STATIC EVIDENCE</text>`,
};

const assets = [];
for (const [slug, title, subtitle] of demos) {
  const file = path.join(demoRoot, `${slug}-poster.svg`);
  await writeFile(file, frame(title, subtitle, demoBodies[slug]), "utf8");
  assets.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    role: "demo-poster",
    owner: "yzscodehub",
    license: "self-authored",
    bytes: (await stat(file)).size,
  });
}

for (const [slug, body] of Object.entries(projectBodies)) {
  const title = slug
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
  const file = path.join(projectRoot, `${slug}-cover.svg`);
  await writeFile(file, frame(title, "PERSONAL PROJECT / VERIFIED GRAPHICS SYSTEMS", body), "utf8");
  assets.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    role: "project-cover",
    owner: "yzscodehub",
    license: "self-authored",
    bytes: (await stat(file)).size,
  });
}

for (const [slug, body] of Object.entries(architectureBodies)) {
  const title = `${slug
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")} Architecture`;
  const file = path.join(projectRoot, `${slug}-architecture.svg`);
  await writeFile(file, frame(title, "IMPLEMENTED DATA FLOW / REVIEWED BOUNDARIES", body), "utf8");
  assets.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    role: "project-architecture",
    owner: "yzscodehub",
    license: "self-authored",
    bytes: (await stat(file)).size,
  });
}

const runtimeCaptures = [
  ["engine-systems-explorer", "running", "TypeScript compiler + SVG inspector"],
  ["real-time-rendering-lab", "running", "Three.js WebGL2 fallback + TSL"],
  ["webgpu-compute-lab", "running fallback", "Deterministic Canvas particle fallback"],
  ["neural-graphics-lab", "measured reviewed run", "ONNX Runtime single-thread WASM"],
];
for (const [slug, state, backend] of runtimeCaptures) {
  const file = path.join(root, "public", "media", "runtime", `${slug}-runtime.png`);
  const metadata = await sharp(file).metadata();
  assets.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    role: "demo-runtime-capture",
    owner: "yzscodehub",
    license: "self-authored",
    bytes: (await stat(file)).size,
    width: metadata.width,
    height: metadata.height,
    environment: "playwright-chromium-151-windows",
    state,
    backend,
  });
}

for (const asset of assets) {
  const bytes = await readFile(path.join(root, asset.path));
  asset.sha256 = createHash("sha256").update(bytes).digest("hex");
  asset.width ??= 1600;
  asset.height ??= 900;
  asset.environment ??= "deterministic-local-generator";
}

await writeFile(
  path.join(root, "public/media/assets-manifest.json"),
  JSON.stringify(
    {
      version: 2,
      generatedBy: "scripts/generate-media.mjs",
      environments: [
        {
          id: "deterministic-local-generator",
          kind: "generated-vector",
          measurement: "No runtime metric; deterministic self-authored SVG source.",
        },
        {
          id: "playwright-chromium-151-windows",
          kind: "runtime-capture",
          os: "Windows NT 10.0 x64",
          browser: "Chromium",
          browserVersion: "151.0.7922.34",
          viewport: "1600x1000 CSS px / DPR 1",
          navigatorWebGPU: true,
          adapter: "requestAdapter returned null in the headless capture environment",
          measurement:
            "Visual evidence only. Runtime labels identify WebGL2, SVG, Canvas, or static paths; no cross-device performance claim.",
        },
      ],
      assets,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
console.log(`Generated ${assets.length} self-authored media assets.`);
