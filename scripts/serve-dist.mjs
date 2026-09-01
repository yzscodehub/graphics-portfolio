import { randomBytes } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { clearInterval, setInterval, setTimeout } from "node:timers";
import { buildManifestFileName, describeDist } from "./write-build-manifest.mjs";

const root = process.cwd();
const distRoot = path.resolve(root, "dist");
const basePath = "/graphics-portfolio/";
const host = process.env.GRAPHICS_PORTFOLIO_E2E_HOST ?? "127.0.0.1";
const port = parsePort(process.env.GRAPHICS_PORTFOLIO_E2E_PORT ?? "4173");
const runToken = resolveRunToken(process.env.GRAPHICS_PORTFOLIO_E2E_RUN_TOKEN);
const buildManifest = readAndVerifyBuildManifest();
const buildDigest = buildManifest.dist.sha256;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".f32", "application/octet-stream"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".onnx", "application/octet-stream"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

const identityHeaders = Object.freeze({
  "X-Graphics-Portfolio-Preview": "1",
  "X-Graphics-Portfolio-Run-Token": runToken,
  "X-Graphics-Portfolio-Build-Digest": buildDigest,
});

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${host}`).pathname);
    if (pathname === basePath.slice(0, -1)) {
      response.writeHead(308, { ...identityHeaders, Location: basePath });
      response.end();
      return;
    }

    const relative = pathname.startsWith(basePath)
      ? pathname.slice(basePath.length)
      : "__outside_base__";
    let target = path.resolve(distRoot, relative || "index.html");
    if (!target.startsWith(`${distRoot}${path.sep}`) && target !== distRoot) {
      response.writeHead(403, identityHeaders);
      response.end("Forbidden");
      return;
    }

    let targetStat = await stat(target).catch(() => undefined);
    if (targetStat?.isDirectory()) {
      target = path.join(target, "index.html");
      targetStat = await stat(target).catch(() => undefined);
    }

    let status = 200;
    if (!targetStat?.isFile()) {
      target = path.join(distRoot, "404.html");
      targetStat = await stat(target);
      status = 404;
    }

    response.writeHead(status, {
      "Content-Type":
        contentTypes.get(path.extname(target).toLowerCase()) ?? "application/octet-stream",
      "Content-Length": targetStat.size,
      "Cache-Control": "no-store",
      ...identityHeaders,
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(target).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", ...identityHeaders });
    response.end(error instanceof Error ? error.message : "Static server failure");
  }
});

server.listen(port, host, () => {
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Static preview did not resolve a TCP address.");
  const baseUrl = `http://${host}:${address.port}${basePath}`;
  console.log(
    `GRAPHICS_PORTFOLIO_STATIC_SERVER_READY ${JSON.stringify({ version: 1, baseUrl, runToken, buildDigest })}`,
  );
});

server.on("error", (error) => {
  console.error(`Static preview failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});

const parentPid = process.ppid;
const shutdown = () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, shutdown);
}

const parentMonitor = setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch {
    clearInterval(parentMonitor);
    shutdown();
  }
}, 500);
parentMonitor.unref();

function readAndVerifyBuildManifest() {
  const manifestPath = path.join(distRoot, buildManifestFileName);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Static preview requires a valid dist/${buildManifestFileName}: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(manifest?.dist?.sha256 ?? "")) {
    throw new Error("Static preview requires a build manifest with a SHA-256 dist digest.");
  }
  if (manifest.dist.sha256 !== describeDist(root).sha256) {
    throw new Error("Static preview build manifest does not match the current dist output.");
  }
  return manifest;
}

function resolveRunToken(value) {
  const token = value ?? randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error("GRAPHICS_PORTFOLIO_E2E_RUN_TOKEN must be a 32-byte hexadecimal token.");
  }
  return token.toLowerCase();
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid GRAPHICS_PORTFOLIO_E2E_PORT: ${value}`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid GRAPHICS_PORTFOLIO_E2E_PORT: ${value}`);
  }
  return parsed;
}
