import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { clearInterval, setInterval, setTimeout } from "node:timers";

const root = process.cwd();
const distRoot = path.resolve(root, "dist");
const basePath = "/graphics-portfolio/";
const host = "127.0.0.1";
const port = 4321;

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

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${host}`).pathname);
    if (pathname === basePath.slice(0, -1)) {
      response.writeHead(308, { Location: basePath });
      response.end();
      return;
    }

    const relative = pathname.startsWith(basePath)
      ? pathname.slice(basePath.length)
      : "__outside_base__";
    let target = path.resolve(distRoot, relative || "index.html");
    if (!target.startsWith(`${distRoot}${path.sep}`) && target !== distRoot) {
      response.writeHead(403);
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
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(target).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Static server failure");
  }
});

server.listen(port, host, () => {
  console.log(`Static preview listening on http://${host}:${port}${basePath}`);
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
