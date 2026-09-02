/* global window */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPathWithinRoot,
  isSafePortableRelativePath,
  resolvePortablePathWithinRoot,
} from "./manifest.mjs";

const QUARANTINE = ".cache/rendering-quarantine";
const REVIEW_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SOURCE_ID = /^[a-z0-9-]+$/;
const SHA = /^[a-f0-9]{64}$/;
const MODEL_VIEWPORT = { width: 960, height: 640 };
const HDR_VIEWPORT = { width: 960, height: 480 };
const fail = (message) => {
  throw new Error("Source review renderer: " + message);
};
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const portable = (value) => value.replaceAll(path.sep, "/");

function validReviewId(value) {
  if (!REVIEW_ID.test(value ?? "")) fail("review id must be lowercase alphanumeric/hyphen.");
  return value;
}

function reviewRoot(root, reviewId) {
  return resolvePortablePathWithinRoot(
    root,
    QUARANTINE + "/" + validReviewId(reviewId),
    "review root",
  );
}

function outputDescriptor(stage, output, sourceId, kind, viewport) {
  if (!existsSync(output) || !lstatSync(output).isFile() || lstatSync(output).isSymbolicLink())
    fail(sourceId + ": browser did not create a regular PNG screenshot.");
  const bytes = statSync(output).size;
  if (bytes < 128) fail(sourceId + ": browser screenshot is implausibly small.");
  return {
    sourceId,
    kind,
    path: portable(path.relative(stage, output)),
    bytes,
    sha256: sha256(output),
    width: viewport.width,
    height: viewport.height,
    renderer: "three-webgl-playwright",
  };
}

function checkedAssets(root, reviewId, records) {
  if (!Array.isArray(records) || records.length === 0)
    fail("reviewed source records are required.");
  const quarantine = reviewRoot(root, reviewId);
  const result = new Map();
  for (const record of records) {
    if (
      !SOURCE_ID.test(record?.sourceId ?? "") ||
      !isSafePortableRelativePath(record?.relativePath)
    )
      fail("reviewed source record has an unsafe id or path.");
    const expected = resolvePortablePathWithinRoot(
      quarantine,
      record.sourceId + "/" + record.relativePath,
      record.sourceId + " reviewed source",
    );
    if (path.resolve(record.absolute ?? "") !== expected)
      fail(record.sourceId + ": reviewed source path does not match quarantine inventory.");
    if (
      !existsSync(expected) ||
      !lstatSync(expected).isFile() ||
      lstatSync(expected).isSymbolicLink()
    )
      fail(record.sourceId + ": reviewed source file is missing or unsafe.");
    if (!SHA.test(record.sha256 ?? "") || sha256(expected) !== record.sha256)
      fail(record.sourceId + ": reviewed source hash changed before browser rendering.");
    const url =
      "/asset/" +
      encodeURIComponent(record.sourceId) +
      "/" +
      record.relativePath.split("/").map(encodeURIComponent).join("/");
    if (result.has(url)) fail(record.sourceId + ": duplicate local review asset URL.");
    result.set(url, { absolute: expected, record });
  }
  return result;
}

function contentType(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".gltf":
      return "model/gltf+json; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function viewerHtml(entries) {
  const data = JSON.stringify(entries).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0c1110}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script></head>
<body><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/vendor/examples/loaders/GLTFLoader.js";
import { HDRLoader } from "/vendor/examples/loaders/HDRLoader.js";
const entries = ${data};
const entry = entries.find((candidate) => candidate.id === new URL(location.href).searchParams.get("entry"));
const report = (state, payload = {}) => { window.__sourceReviewResult = { state, ...payload }; };
if (!entry) report("error", { message: "review entry was not found" });
else {
  const size = entry.kind === "hdr" ? { width: ${HDR_VIEWPORT.width}, height: ${HDR_VIEWPORT.height} } : { width: ${MODEL_VIEWPORT.width}, height: ${MODEL_VIEWPORT.height} };
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1); renderer.setSize(size.width, size.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x33403d);
  const camera = new THREE.PerspectiveCamera(38, size.width / size.height, 0.01, 10000);
  const finish = (payload) => { renderer.render(scene, camera); requestAnimationFrame(() => { renderer.render(scene, camera); report("ready", { revision: THREE.REVISION, drawCalls: renderer.info.render.calls, ...payload }); }); };
  const reject = (error) => report("error", { message: error instanceof Error ? error.message : String(error) });
  if (entry.kind === "model") {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x69706d, 3));
    const key = new THREE.DirectionalLight(0xfff1d6, 4.5); key.position.set(5, 7, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xb8e3ff, 3); fill.position.set(-4, 3, 5); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 2.5); rim.position.set(1, 5, -6); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(100, 96), new THREE.MeshStandardMaterial({ color: 0x202a27, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; scene.add(floor);
    new GLTFLoader().load(entry.url, (gltf) => {
      const object = gltf.scene || gltf.scenes?.[0]; if (!object) { reject("glTF did not contain a scene"); return; }
      let meshes = 0; object.traverse((node) => { if (node.isMesh && node.geometry?.getAttribute("position")) meshes += 1; });
      if (meshes === 0) { reject("glTF scene did not contain drawable mesh geometry"); return; }
      scene.add(object); const bounds = new THREE.Box3().setFromObject(object); const extent = bounds.getSize(new THREE.Vector3()); const center = bounds.getCenter(new THREE.Vector3()); const radius = Math.max(extent.x, extent.y, extent.z) * 0.5;
      if (!Number.isFinite(radius) || radius <= 0) { reject("glTF bounds are invalid"); return; }
      object.position.set(-center.x, -bounds.min.y, -center.z); const distance = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.28; const targetY = extent.y * 0.42;
      camera.position.set(distance * 0.72, targetY + distance * 0.34, distance * 0.72); camera.lookAt(0, targetY, 0); camera.near = Math.max(0.001, distance / 100); camera.far = distance * 100; camera.updateProjectionMatrix();
      finish({ entry: entry.id, meshes, bounds: { x: extent.x, y: extent.y, z: extent.z } });
    }, undefined, reject);
  } else {
    new HDRLoader().load(entry.url, (texture) => { texture.mapping = THREE.EquirectangularReflectionMapping; scene.background = texture; camera.position.set(0, 0, 0.001); camera.lookAt(0, 0, -1); finish({ entry: entry.id, decodedHdr: true }); }, undefined, reject);
  }
}
</script></body></html>`;
}

function vendorFile(moduleRoot, pathname) {
  if (pathname.startsWith("/vendor/") && !pathname.startsWith("/vendor/examples/")) {
    let relative;
    try {
      relative = decodeURIComponent(pathname.slice("/vendor/".length));
    } catch {
      return null;
    }
    if (!isSafePortableRelativePath(relative)) return null;
    return resolvePortablePathWithinRoot(
      path.join(moduleRoot, "build"),
      relative,
      "Three.js build module",
    );
  }
  if (!pathname.startsWith("/vendor/examples/")) return null;
  let relative;
  try {
    relative = decodeURIComponent(pathname.slice("/vendor/examples/".length));
  } catch {
    return null;
  }
  if (!isSafePortableRelativePath(relative)) return null;
  return resolvePortablePathWithinRoot(
    path.join(moduleRoot, "examples", "jsm"),
    relative,
    "Three.js module",
  );
}

async function startServer(assets, entries) {
  const moduleRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../node_modules/three",
  );
  const coreModule = vendorFile(moduleRoot, "/vendor/three.module.js");
  if (!coreModule || !existsSync(coreModule) || !lstatSync(coreModule).isFile())
    fail("local Three.js module is unavailable; install workspace dependencies first.");
  const html = viewerHtml(entries);
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405);
        response.end();
        return;
      }
      if (url.pathname === "/viewer.html") {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
        });
        response.end(request.method === "HEAD" ? undefined : html);
        return;
      }
      const file = assets.get(url.pathname)?.absolute ?? vendorFile(moduleRoot, url.pathname);
      if (!file || !existsSync(file) || !lstatSync(file).isFile()) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentType(file),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : readFileSync(file));
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    fail("local review renderer did not receive a loopback port.");
  }
  return {
    origin: "http://127.0.0.1:" + address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function localChromium() {
  let playwright;
  try {
    playwright = await import("@playwright/test");
  } catch (error) {
    fail(
      "local Playwright Chromium package is unavailable; install workspace dependencies before producing authentic model screenshots (" +
        (error instanceof Error ? error.message : "unknown error") +
        ").",
    );
  }
  const executable = playwright.chromium.executablePath();
  if (!executable || !existsSync(executable))
    fail(
      "local Playwright Chromium executable is unavailable at " +
        executable +
        "; install the approved local browser before producing authentic model screenshots.",
    );
  return playwright.chromium;
}

async function capture(browser, origin, entry, output, viewport, diagnostics) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  try {
    await context.route("**/*", async (route) => {
      let url;
      try {
        url = new URL(route.request().url());
      } catch {
        await route.abort();
        return;
      }
      if (url.origin !== origin) {
        diagnostics.push("blocked non-local request: " + url.href);
        await route.abort();
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        diagnostics.push("browser " + message.type() + ": " + message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        diagnostics.push("HTTP " + response.status() + ": " + response.url());
    });
    page.on("pageerror", (error) => diagnostics.push("page error: " + error.message));
    await page.goto(origin + "/viewer.html?entry=" + encodeURIComponent(entry.id), {
      waitUntil: "networkidle",
      timeout: 20_000,
    });
    await page.waitForFunction(
      () => window.__sourceReviewResult && window.__sourceReviewResult.state !== "pending",
      undefined,
      { timeout: 20_000 },
    );
    const result = await page.evaluate(() => window.__sourceReviewResult);
    if (!result || result.state !== "ready")
      fail(
        entry.id +
          ": Three.js review render failed" +
          (result?.message ? " (" + result.message + ")" : "") +
          ".",
      );
    if (entry.kind === "model" && (!Number.isInteger(result.meshes) || result.meshes < 1))
      fail(entry.id + ": renderer did not report drawable mesh geometry.");
    if (entry.kind === "hdr" && result.decodedHdr !== true)
      fail(entry.id + ": HDR loader did not confirm decode.");
    await page.locator("canvas").screenshot({ path: output });
  } finally {
    await context.close();
  }
}

/**
 * Renders reviewed bytes only. All browser requests outside the loopback
 * server are aborted, and output is confined to the caller staging directory.
 */
export async function renderSourceReviewVisuals(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const reviewId = validReviewId(options.reviewId);
  const stage = path.resolve(options.stage ?? "");
  const quarantine = reviewRoot(root, reviewId);
  assertPathWithinRoot(quarantine, stage, "packet staging directory");
  if (stage === quarantine || !existsSync(stage) || !lstatSync(stage).isDirectory())
    fail("packet staging directory is missing or unsafe.");
  const assets = checkedAssets(root, reviewId, options.records);
  const models = [...assets.values()]
    .map(({ record }) => record)
    .filter((record) => record.sourceKind === "mesh" && record.role === "gltf")
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const hdr = [...assets.values()]
    .map(({ record }) => record)
    .find((record) => record.sourceKind === "hdri" && record.role === "hdr");
  if (models.length !== 6) fail("exactly six reviewed mesh glTF files are required.");
  if (!hdr) fail("one reviewed HDR source is required.");
  const localUrl = (record) =>
    "/asset/" +
    encodeURIComponent(record.sourceId) +
    "/" +
    record.relativePath.split("/").map(encodeURIComponent).join("/");
  const entries = [
    ...models.map((record) => ({
      id: "model-" + record.sourceId,
      kind: "model",
      sourceId: record.sourceId,
      url: localUrl(record),
    })),
    { id: "hdr-" + hdr.sourceId, kind: "hdr", sourceId: hdr.sourceId, url: localUrl(hdr) },
  ];
  const visualRoot = assertPathWithinRoot(stage, path.join(stage, "visuals"), "visual root");
  const modelRoot = assertPathWithinRoot(
    visualRoot,
    path.join(visualRoot, "models"),
    "model visual root",
  );
  mkdirSync(modelRoot, { recursive: true });
  const chromium = await (options.loadChromium ?? localChromium)();
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
  });
  let server;
  const diagnostics = [];
  try {
    server = await startServer(assets, entries);
    const views = [];
    for (const entry of entries.filter((candidate) => candidate.kind === "model")) {
      const output = assertPathWithinRoot(
        modelRoot,
        path.join(modelRoot, entry.sourceId + ".png"),
        entry.sourceId + " model view",
      );
      await capture(browser, server.origin, entry, output, MODEL_VIEWPORT, diagnostics);
      views.push(outputDescriptor(stage, output, entry.sourceId, "model", MODEL_VIEWPORT));
    }
    const hdrEntry = entries.find((entry) => entry.kind === "hdr");
    const hdrOutput = assertPathWithinRoot(
      visualRoot,
      path.join(visualRoot, "environment-" + hdrEntry.sourceId + ".png"),
      "HDRI visual",
    );
    await capture(browser, server.origin, hdrEntry, hdrOutput, HDR_VIEWPORT, diagnostics);
    return {
      models: views,
      hdr: outputDescriptor(stage, hdrOutput, hdrEntry.sourceId, "hdri", HDR_VIEWPORT),
      diagnostics: { renderer: "three-webgl-playwright", localOnly: true, console: diagnostics },
    };
  } catch (error) {
    const detail = diagnostics.length ? " Browser diagnostics: " + diagnostics.join(" | ") : "";
    if (String(error?.message ?? "").startsWith("Source review renderer:"))
      throw new Error(error.message + detail, { cause: error });
    throw new Error(
      "Source review renderer: authentic local browser rendering failed (" +
        (error instanceof Error ? error.message : "unknown error") +
        ")." +
        detail,
      { cause: error },
    );
  } finally {
    await Promise.allSettled([browser.close(), server?.close()]);
  }
}
