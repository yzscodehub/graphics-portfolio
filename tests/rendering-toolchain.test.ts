import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installRenderingToolchain,
  loadToolchainLock,
  projectRoot,
  validateToolchainLock,
  verifyInstalledToolchain,
  verifyRuntimeVersions,
} from "../scripts/assets/toolchain.mjs";

const roots: string[] = [];
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rendering-toolchain-"));
  roots.push(root);
  const sharpDirectory = path.join(root, "node_modules", "sharp");
  mkdirSync(sharpDirectory, { recursive: true });
  const sharpManifest = Buffer.from(JSON.stringify({ name: "sharp", version: "0.35.4" }));
  writeFileSync(path.join(sharpDirectory, "package.json"), sharpManifest);
  const integrity = "sha512-fixture-integrity";
  writeFileSync(
    path.join(root, "pnpm-lock.yaml"),
    `sharp@0.35.4:\n  resolution: {integrity: ${integrity}}\n`,
  );

  const artifacts: Record<string, Buffer> = {
    "gltf-transform-cli": Buffer.from("verified gltf transform archive"),
    gltfpack: Buffer.from("verified gltfpack archive"),
    "ktx-software-toktx": Buffer.from("verified ktx archive"),
    "libktx-web": Buffer.from("verified libktx web archive"),
    "libktx-read-web": Buffer.from("verified libktx read archive"),
  };
  const tool = (
    id: string,
    version: string,
    archive: "npm-tgz" | "zip" | "nsis",
    entry: string,
  ) => ({
    id,
    displayName: id,
    version,
    command: id,
    versionArgs: ["--version"],
    versionPattern: version.replaceAll(".", "\\."),
    source: { publisher: "fixture", url: "https://example.com/source" },
    artifacts: [
      {
        platform: "win32-x64",
        url: `https://example.com/${id}`,
        archive,
        bytes: artifacts[id].length,
        sha256: sha256(artifacts[id]),
        entry,
      },
    ],
  });
  const lock = {
    version: 2,
    policy: {
      installRoot: ".tools/rendering",
      localManifest: ".tools/rendering/toolchain.local.json",
      ciVerification: "schema-only",
      installation: "explicit-local-command-only",
    },
    node: { version: "24" },
    pnpm: { version: "11" },
    tools: [
      tool("gltf-transform-cli", "4.4.2", "npm-tgz", "gltf-transform"),
      tool("gltfpack", "1.1", "zip", "gltfpack.exe"),
      {
        ...tool("ktx-software-toktx", "4.4.2", "nsis", "bin/toktx.exe"),
        supportArtifacts: ["libktx-web", "libktx-read-web"].map((id) => ({
          id,
          url: `https://example.com/${id}`,
          archive: "zip",
          bytes: artifacts[id].length,
          sha256: sha256(artifacts[id]),
        })),
      },
    ],
    nodeLibraries: [
      {
        package: "@gltf-transform/core",
        version: "4.4.2",
        registry: "https://registry.npmjs.org/@gltf-transform/core",
      },
      {
        package: "@gltf-transform/extensions",
        version: "4.4.2",
        registry: "https://registry.npmjs.org/@gltf-transform/extensions",
      },
      {
        package: "@gltf-transform/functions",
        version: "4.4.2",
        registry: "https://registry.npmjs.org/@gltf-transform/functions",
      },
    ],
    sharp: {
      package: "sharp",
      version: "0.35.4",
      packageLockIntegrity: integrity,
      artifact: {
        file: "node_modules/sharp/package.json",
        bytes: sharpManifest.length,
        sha256: sha256(sharpManifest),
      },
    },
  };

  const versionProbe = (commandPath: string, args: string[]) => {
    const identity = [commandPath, ...args].join("/");
    return identity.includes("gltfpack")
      ? "gltfpack 1.1"
      : identity.includes("toktx")
        ? "toktx 4.4.2"
        : "gltf-transform 4.4.2";
  };
  const fetchArtifact = async (
    _url: string,
    target: string,
    context: { tool: { id: string }; artifact: { id?: string } },
  ) => {
    writeFileSync(target, artifacts[context.artifact.id ?? context.tool.id]);
  };
  const extractArtifact = (_archive: string, artifact: { entry: string }, target: string) => {
    const executable = path.join(target, ...artifact.entry.split("/"));
    mkdirSync(path.dirname(executable), { recursive: true });
    writeFileSync(executable, `fixture executable for ${artifact.entry}`);
    return executable;
  };
  const receivedNpmArchives: Buffer[] = [];
  const extractSupportArtifact = (_archive: string, artifact: { id: string }, target: string) => {
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, `${artifact.id}.js`), `fixture ${artifact.id}`);
    return target;
  };
  const installNpmTool = (target: string, _tool: unknown, _artifact: unknown, archive: string) => {
    receivedNpmArchives.push(readFileSync(archive));
    const executable = path.join(target, "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
    const lockfile = path.join(target, "pnpm-lock.yaml");
    mkdirSync(path.dirname(executable), { recursive: true });
    writeFileSync(executable, "fixture gltf-transform cli");
    writeFileSync(lockfile, "lockfileVersion: '9.0'\n");
    return {
      commandPath: process.execPath,
      commandArgs: [executable],
      executable,
      lockfile,
    };
  };

  return {
    root,
    lock,
    artifacts,
    versionProbe,
    fetchArtifact,
    extractArtifact,
    extractSupportArtifact,
    installNpmTool,
    receivedNpmArchives,
  };
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("rendering toolchain lock", () => {
  it("accepts the tracked lock and binds KTX to the Windows NSIS artifact", () => {
    const lock = loadToolchainLock(projectRoot);
    expect(validateToolchainLock(lock)).toEqual([]);
    const artifacts = Object.fromEntries(
      lock.tools.map((tool: { id: string; artifacts: unknown[] }) => [tool.id, tool.artifacts[0]]),
    );
    expect(artifacts["gltf-transform-cli"]).toMatchObject({
      archive: "npm-tgz",
      bytes: 66_611,
      sha256: "0d8476b5a6abf1454c1ec670f745628147300b4756efdd12de599c0689fd0b82",
    });
    expect(artifacts.gltfpack).toMatchObject({
      archive: "zip",
      bytes: 1_457_402,
      sha256: "13e1b00299f9796613adddc6eb21d47b466333ba4d79658f2f98079f2f30fc56",
    });
    const ktx = lock.tools.find((tool: { id: string }) => tool.id === "ktx-software-toktx");
    expect(ktx.artifacts[0]).toMatchObject({
      archive: "nsis",
      entry: "bin/toktx.exe",
      sha256: "1f323b0fec19794f5e6c0425a61d4b1da396872a10be862d105f4f4b2d2957fe",
    });
    expect(ktx.supportArtifacts).toEqual([
      expect.objectContaining({
        id: "libktx-web",
        bytes: 707_220,
        sha256: "1d4598a290ccb654d6a33c074c4ca96f0c5ccef99e042323eaa4d1230d4de63d",
      }),
      expect.objectContaining({
        id: "libktx-read-web",
        bytes: 383_090,
        sha256: "dbade8edfbbae4a8aa432d98a61b374c906fe062545c43f95ccace78e9af0465",
      }),
    ]);
  });

  it("rejects a malformed artifact hash and the wrong runtime major", () => {
    const { lock } = fixture();
    lock.tools[0].artifacts[0].sha256 = "0".repeat(63);
    expect(validateToolchainLock(lock)).toEqual([
      expect.stringContaining("sha256 must be lowercase SHA-256"),
    ]);
    expect(verifyRuntimeVersions(lock, { nodeVersion: "25.0.0", pnpmVersion: "10.0.0" })).toEqual([
      expect.stringContaining("Node 24.x"),
      expect.stringContaining("pnpm 11.x"),
    ]);
  });
});

describe("transactional local rendering toolchain", () => {
  it("installs verified inputs, consumes the locked npm archive, and verifies its receipt", async () => {
    const value = fixture();
    const lockSha256 = "a".repeat(64);
    await installRenderingToolchain(value.root, {
      lock: value.lock,
      lockSha256,
      platform: "win32-x64",
      runtimeVersions: { nodeVersion: "24.0.0", pnpmVersion: "11.0.0" },
      fetchArtifact: value.fetchArtifact,
      extractArtifact: value.extractArtifact,
      extractSupportArtifact: value.extractSupportArtifact,
      installNpmTool: value.installNpmTool,
      versionProbe: value.versionProbe,
    });

    expect(value.receivedNpmArchives).toHaveLength(1);
    expect(value.receivedNpmArchives[0]).toEqual(value.artifacts["gltf-transform-cli"]);
    const local = JSON.parse(
      readFileSync(path.join(value.root, ".tools", "rendering", "toolchain.local.json"), "utf8"),
    );
    const npmTool = local.tools.find((tool: { id: string }) => tool.id === "gltf-transform-cli");
    expect(npmTool.commandPath).toBe(process.execPath);
    expect(npmTool.commandArgs).toEqual([npmTool.executablePath]);
    expect(npmTool.dependencyLockSha256).toMatch(/^[a-f0-9]{64}$/);
    const ktxTool = local.tools.find((tool: { id: string }) => tool.id === "ktx-software-toktx");
    expect(ktxTool.supportArtifacts.map((support: { id: string }) => support.id)).toEqual([
      "libktx-web",
      "libktx-read-web",
    ]);
    expect(
      verifyInstalledToolchain(value.root, {
        lock: value.lock,
        lockSha256,
        platform: "win32-x64",
        runtimeVersions: { nodeVersion: "24.0.0", pnpmVersion: "11.0.0" },
        versionProbe: value.versionProbe,
      }),
    ).toEqual([]);

    const support = ktxTool.supportArtifacts[0];
    writeFileSync(path.join(support.rootPath, support.files[0].path), "tampered support module");
    expect(
      verifyInstalledToolchain(value.root, {
        lock: value.lock,
        lockSha256,
        platform: "win32-x64",
        runtimeVersions: { nodeVersion: "24.0.0", pnpmVersion: "11.0.0" },
        versionProbe: value.versionProbe,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("libktx-web extracted support files changed"),
      ]),
    );
  });

  it("keeps the previous installation when an archive fails verification", async () => {
    const value = fixture();
    const installRoot = path.join(value.root, ".tools", "rendering");
    mkdirSync(installRoot, { recursive: true });
    writeFileSync(path.join(installRoot, "sentinel.txt"), "previous install");

    await expect(
      installRenderingToolchain(value.root, {
        lock: value.lock,
        lockSha256: "b".repeat(64),
        platform: "win32-x64",
        runtimeVersions: { nodeVersion: "24.0.0", pnpmVersion: "11.0.0" },
        fetchArtifact: async (_url: string, target: string, context: { tool: { id: string } }) => {
          const bytes =
            context.tool.id === "gltfpack"
              ? Buffer.from("tampered")
              : value.artifacts[context.tool.id];
          writeFileSync(target, bytes);
        },
        extractArtifact: value.extractArtifact,
        extractSupportArtifact: value.extractSupportArtifact,
        installNpmTool: value.installNpmTool,
        versionProbe: value.versionProbe,
      }),
    ).rejects.toThrow(/archive failed byte\/SHA-256 verification/);

    expect(readFileSync(path.join(installRoot, "sentinel.txt"), "utf8")).toBe("previous install");
    expect(
      readdirSync(path.dirname(installRoot)).some((entry) =>
        entry.startsWith("rendering.staging-"),
      ),
    ).toBe(false);
  });

  it("restores the previous installation when post-commit verification fails", async () => {
    const value = fixture();
    const installRoot = path.join(value.root, ".tools", "rendering");
    mkdirSync(installRoot, { recursive: true });
    writeFileSync(path.join(installRoot, "sentinel.txt"), "previous verified install");
    let probes = 0;

    await expect(
      installRenderingToolchain(value.root, {
        lock: value.lock,
        lockSha256: "d".repeat(64),
        platform: "win32-x64",
        runtimeVersions: { nodeVersion: "24.0.0", pnpmVersion: "11.0.0" },
        fetchArtifact: value.fetchArtifact,
        extractArtifact: value.extractArtifact,
        extractSupportArtifact: value.extractSupportArtifact,
        installNpmTool: value.installNpmTool,
        versionProbe: (commandPath: string, args: string[]) => {
          probes += 1;
          return probes <= 3 ? value.versionProbe(commandPath, args) : "";
        },
      }),
    ).rejects.toThrow(/Committed toolchain verification failed/);

    expect(readFileSync(path.join(installRoot, "sentinel.txt"), "utf8")).toBe(
      "previous verified install",
    );
    expect(
      readdirSync(path.dirname(installRoot)).some((entry) => entry.startsWith("rendering.backup-")),
    ).toBe(false);
  });

  it("detects changed executable bytes and refuses an unbound native command", async () => {
    const value = fixture();
    const lockSha256 = "c".repeat(64);
    const options = {
      lock: value.lock,
      lockSha256,
      platform: "win32-x64",
      runtimeVersions: { nodeVersion: "24.0.0", pnpmVersion: "11.0.0" },
      fetchArtifact: value.fetchArtifact,
      extractArtifact: value.extractArtifact,
      extractSupportArtifact: value.extractSupportArtifact,
      installNpmTool: value.installNpmTool,
      versionProbe: value.versionProbe,
    };
    await installRenderingToolchain(value.root, options);
    const manifestFile = path.join(value.root, ".tools", "rendering", "toolchain.local.json");
    const local = JSON.parse(readFileSync(manifestFile, "utf8"));
    const native = local.tools.find((tool: { id: string }) => tool.id === "gltfpack");
    writeFileSync(native.executablePath, "changed executable");
    expect(verifyInstalledToolchain(value.root, options)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("gltfpack executable byte/SHA-256 mismatch"),
        expect.stringContaining("gltfpack command byte/SHA-256 mismatch"),
      ]),
    );

    native.commandPath = process.execPath;
    native.commandArgs = [];
    writeFileSync(manifestFile, `${JSON.stringify(local, null, 2)}\n`);
    expect(verifyInstalledToolchain(value.root, options)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("gltfpack command path or arguments are not bound"),
      ]),
    );
  });
});
