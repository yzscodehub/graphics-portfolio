import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const host = process.env.GRAPHICS_PORTFOLIO_E2E_HOST ?? "127.0.0.1";
const port = parsePort(process.env.GRAPHICS_PORTFOLIO_E2E_PORT ?? "4173");
const baseUrl = `http://${host}:${port}/graphics-portfolio/`;
const e2eEnvironment = {
  ...process.env,
  GRAPHICS_PORTFOLIO_E2E_HOST: host,
  GRAPHICS_PORTFOLIO_E2E_PORT: String(port),
  GRAPHICS_PORTFOLIO_E2E_BASE_URL: baseUrl,
};
const cliArguments = process.argv.slice(2);
if (cliArguments[0] === "--") cliArguments.shift();
const server = spawn(process.execPath, [path.join(root, "scripts", "serve-dist.mjs")], {
  cwd: root,
  env: e2eEnvironment,
  stdio: "inherit",
});

let stopping = false;
const stopServer = async () => {
  if (stopping || server.exitCode !== null) return;
  stopping = true;
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.once("exit", resolve)), delay(2_000)]);
  if (server.exitCode === null) server.kill();
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void stopServer());
}

try {
  await waitForServer();
  const playwright = spawn(
    process.execPath,
    [path.join(root, "node_modules", "@playwright", "test", "cli.js"), "test", ...cliArguments],
    { cwd: root, env: e2eEnvironment, stdio: "inherit" },
  );
  const exitCode = await new Promise((resolve) =>
    playwright.once("exit", (code) => resolve(code ?? 1)),
  );
  process.exitCode = exitCode;
} finally {
  await stopServer();
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Static server exited before E2E started (${server.exitCode}).`);
    try {
      const response = await globalThis.fetch(baseUrl);
      if (response.ok && response.headers.get("x-graphics-portfolio-preview") === "1") return;
    } catch {
      // The foreground server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Static server did not become ready at ${baseUrl}.`);
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid GRAPHICS_PORTFOLIO_E2E_PORT: ${value}`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid GRAPHICS_PORTFOLIO_E2E_PORT: ${value}`);
  }
  return parsed;
}
