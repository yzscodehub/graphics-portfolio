import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const host = process.env.GRAPHICS_PORTFOLIO_E2E_HOST ?? "127.0.0.1";
const requestedPort = parsePort(process.env.GRAPHICS_PORTFOLIO_E2E_PORT ?? "0");
const runToken = randomBytes(32).toString("hex");
const serverEnvironment = {
  ...process.env,
  GRAPHICS_PORTFOLIO_E2E_HOST: host,
  GRAPHICS_PORTFOLIO_E2E_PORT: String(requestedPort),
  GRAPHICS_PORTFOLIO_E2E_RUN_TOKEN: runToken,
};
const cliArguments = process.argv.slice(2);
if (cliArguments[0] === "--") cliArguments.shift();
const server = spawn(process.execPath, [path.join(root, "scripts", "serve-dist.mjs")], {
  cwd: root,
  env: serverEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
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
  const handshake = await waitForHandshake();
  if (handshake.runToken !== runToken) {
    throw new Error("Static server handshake token did not match the child process token.");
  }
  await waitForServer(handshake);
  const e2eEnvironment = {
    ...serverEnvironment,
    GRAPHICS_PORTFOLIO_E2E_PORT: String(new URL(handshake.baseUrl).port),
    GRAPHICS_PORTFOLIO_E2E_BASE_URL: handshake.baseUrl,
    GRAPHICS_PORTFOLIO_E2E_RUN_TOKEN: handshake.runToken,
    GRAPHICS_PORTFOLIO_E2E_BUILD_DIGEST: handshake.buildDigest,
  };
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

function waitForHandshake() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffered = "";
    const timer = setTimeout(
      () => fail(new Error("Static server did not emit an E2E handshake within 30 seconds.")),
      30_000,
    );
    timer.unref();
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const succeed = (handshake) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(handshake);
    };
    server.once("error", fail);
    server.once("exit", (code, signal) => {
      fail(new Error(`Static server exited before E2E started (code=${code}, signal=${signal}).`));
    });
    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("GRAPHICS_PORTFOLIO_STATIC_SERVER_READY ")) continue;
        try {
          succeed(parseHandshake(line.slice("GRAPHICS_PORTFOLIO_STATIC_SERVER_READY ".length)));
        } catch (error) {
          fail(error);
        }
      }
    });
    server.stderr.setEncoding("utf8");
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  });
}

function parseHandshake(raw) {
  let handshake;
  try {
    handshake = JSON.parse(raw);
  } catch {
    throw new Error("Static server emitted invalid E2E handshake JSON.");
  }
  if (
    handshake?.version !== 1 ||
    typeof handshake.baseUrl !== "string" ||
    !/^[a-f0-9]{64}$/i.test(handshake.runToken ?? "") ||
    !/^[a-f0-9]{64}$/i.test(handshake.buildDigest ?? "")
  ) {
    throw new Error("Static server emitted an incomplete E2E handshake.");
  }
  const parsed = new URL(handshake.baseUrl);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== host ||
    parsed.pathname !== "/graphics-portfolio/" ||
    !/^\d+$/.test(parsed.port)
  ) {
    throw new Error(`Static server emitted an unexpected E2E base URL: ${handshake.baseUrl}`);
  }
  return Object.freeze({
    baseUrl: parsed.href,
    runToken: handshake.runToken.toLowerCase(),
    buildDigest: handshake.buildDigest.toLowerCase(),
  });
}

async function waitForServer(handshake) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Static server exited before E2E started (${server.exitCode}).`);
    }
    try {
      const response = await globalThis.fetch(handshake.baseUrl);
      if (
        response.ok &&
        response.headers.get("x-graphics-portfolio-preview") === "1" &&
        response.headers.get("x-graphics-portfolio-run-token") === handshake.runToken &&
        response.headers.get("x-graphics-portfolio-build-digest") === handshake.buildDigest
      ) {
        const manifestResponse = await globalThis.fetch(
          new URL("build-manifest.json", handshake.baseUrl),
        );
        const manifest = await manifestResponse.json();
        if (
          manifestResponse.ok &&
          manifest?.version === 1 &&
          manifest?.dist?.sha256 === handshake.buildDigest
        ) {
          return;
        }
      }
    } catch {
      // The foreground server is still starting.
    }
    await delay(100);
  }
  throw new Error(
    `Static server did not complete an identity-verified handshake at ${handshake.baseUrl}.`,
  );
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid GRAPHICS_PORTFOLIO_E2E_PORT: ${value}`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid GRAPHICS_PORTFOLIO_E2E_PORT: ${value}`);
  }
  return parsed;
}
