import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const baseUrl = "http://127.0.0.1:4321/graphics-portfolio/";
const cliArguments = process.argv.slice(2);
if (cliArguments[0] === "--") cliArguments.shift();
const server = spawn(process.execPath, [path.join(root, "scripts", "serve-dist.mjs")], {
  cwd: root,
  env: process.env,
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
    { cwd: root, env: process.env, stdio: "inherit" },
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
      if (response.ok) return;
    } catch {
      // The foreground server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Static server did not become ready at ${baseUrl}.`);
}
