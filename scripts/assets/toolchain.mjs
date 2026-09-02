import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const toolchainLockRelativePath = "scripts/assets/toolchain.lock.json";
const sha256Pattern = /^[a-f0-9]{64}$/;
const expectedTools = new Set(["gltf-transform-cli", "gltfpack", "ktx-software-toktx"]);
const expectedNodeLibraries = new Set([
  "@gltf-transform/core@4.4.2",
  "@gltf-transform/extensions@4.4.2",
  "@gltf-transform/functions@4.4.2",
]);

const sha256File = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isHttpsUrl = (value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

function isSafePortablePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.split("/").some((part) => !part || part === "." || part === "..")
  );
}

function resolvePortablePath(root, relative, label) {
  if (!isSafePortablePath(relative))
    throw new Error(`${label} must be a safe portable relative path.`);
  const target = path.resolve(root, ...relative.split("/"));
  const relation = path.relative(root, target);
  if (relation.startsWith("..") || path.isAbsolute(relation))
    throw new Error(`${label} escaped root.`);
  return target;
}

function within(root, candidate) {
  const relation = path.relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}

function regularFileWithin(root, candidate) {
  if (
    typeof candidate !== "string" ||
    !existsSync(candidate) ||
    !lstatSync(candidate).isFile() ||
    lstatSync(candidate).isSymbolicLink()
  )
    return false;
  return within(realpathSync(root), realpathSync(candidate));
}

function regularDirectoryWithin(root, candidate) {
  if (
    typeof candidate !== "string" ||
    !existsSync(candidate) ||
    !lstatSync(candidate).isDirectory() ||
    lstatSync(candidate).isSymbolicLink()
  )
    return false;
  return within(realpathSync(root), realpathSync(candidate));
}

function add(issues, message) {
  issues.push(message);
}

export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

export function loadToolchainLock(root = projectRoot) {
  return readJson(path.join(root, toolchainLockRelativePath));
}

export function toolchainLockSha256(root = projectRoot) {
  return sha256File(path.join(root, toolchainLockRelativePath));
}

export function findArtifactForPlatform(tool, platform = platformKey()) {
  return tool.artifacts?.find((entry) => entry.platform === platform || entry.platform === "any");
}

function validateArtifact(artifact, label, issues, hasEntry) {
  if (!isObject(artifact)) return add(issues, `${label} must be an object.`);
  if (!isHttpsUrl(artifact.url)) add(issues, `${label}.url must be HTTPS.`);
  if (!isPositiveInteger(artifact.bytes)) add(issues, `${label}.bytes must be a positive integer.`);
  if (!sha256Pattern.test(artifact.sha256 ?? ""))
    add(issues, `${label}.sha256 must be lowercase SHA-256.`);
  if (!new Set(["raw", "zip", "npm-tgz", "nsis"]).has(artifact.archive))
    add(issues, `${label}.archive is unsupported.`);
  if (hasEntry && !isSafePortablePath(artifact.entry))
    add(issues, `${label}.entry must be a safe portable path.`);
}

export function validateToolchainLock(lock) {
  const issues = [];
  if (!isObject(lock) || lock.version !== 2) return ["toolchain lock must use version 2."];
  const policy = lock.policy;
  if (!isObject(policy)) add(issues, "toolchain policy is required.");
  else {
    if (policy.installRoot !== ".tools/rendering")
      add(issues, "installRoot must be .tools/rendering.");
    if (policy.localManifest !== ".tools/rendering/toolchain.local.json")
      add(issues, "localManifest must be .tools/rendering/toolchain.local.json.");
    if (policy.ciVerification !== "schema-only") add(issues, "CI must be schema-only.");
    if (policy.installation !== "explicit-local-command-only")
      add(issues, "installation must be explicit-local-command-only.");
  }
  if (lock.node?.version !== "24") add(issues, "Node 24 must be locked.");
  if (lock.pnpm?.version !== "11") add(issues, "pnpm 11 must be locked.");
  if (!Array.isArray(lock.tools)) add(issues, "tools must be an array.");
  else {
    const seen = new Set();
    for (const tool of lock.tools) {
      const label = `tool ${tool?.id ?? "unknown"}`;
      if (!isObject(tool) || !expectedTools.has(tool.id)) {
        add(issues, `${label} is not an expected tool.`);
        continue;
      }
      if (seen.has(tool.id)) add(issues, `${label} is duplicated.`);
      seen.add(tool.id);
      if (
        typeof tool.displayName !== "string" ||
        typeof tool.version !== "string" ||
        typeof tool.command !== "string" ||
        !Array.isArray(tool.versionArgs)
      )
        add(issues, `${label} metadata is incomplete.`);
      try {
        new RegExp(tool.versionPattern);
      } catch {
        add(issues, `${label}.versionPattern is invalid.`);
      }
      if (!isObject(tool.source) || !isHttpsUrl(tool.source.url))
        add(issues, `${label}.source.url must be HTTPS.`);
      if (!Array.isArray(tool.artifacts) || tool.artifacts.length === 0)
        add(issues, `${label}.artifacts is required.`);
      else
        tool.artifacts.forEach((artifact, index) => {
          if (typeof artifact?.platform !== "string")
            add(issues, `${label}.artifacts[${index}].platform is required.`);
          validateArtifact(artifact, `${label}.artifacts[${index}]`, issues, true);
        });
      if (tool.supportArtifacts !== undefined) {
        if (!Array.isArray(tool.supportArtifacts))
          add(issues, `${label}.supportArtifacts must be an array.`);
        else {
          const supportIds = new Set();
          tool.supportArtifacts.forEach((artifact, index) => {
            if (!/^[a-z0-9-]+$/.test(artifact?.id ?? "") || supportIds.has(artifact.id))
              add(issues, `${label}.supportArtifacts[${index}].id is unsafe or duplicated.`);
            supportIds.add(artifact?.id);
            validateArtifact(artifact, `${label}.supportArtifacts[${index}]`, issues, false);
          });
        }
      }
    }
    for (const id of expectedTools) if (!seen.has(id)) add(issues, `missing required tool ${id}.`);
  }
  const libraries = new Set(
    Array.isArray(lock.nodeLibraries)
      ? lock.nodeLibraries.map((entry) => `${entry?.package}@${entry?.version}`)
      : [],
  );
  if (
    libraries.size !== expectedNodeLibraries.size ||
    [...expectedNodeLibraries].some((entry) => !libraries.has(entry))
  )
    add(issues, "glTF Transform core, extensions, and functions must all be locked at 4.4.2.");
  if (
    !Array.isArray(lock.nodeLibraries) ||
    lock.nodeLibraries.some((entry) => !isHttpsUrl(entry?.registry))
  )
    add(issues, "each Node library needs an HTTPS registry URL.");
  const sharp = lock.sharp;
  if (!isObject(sharp) || sharp.package !== "sharp" || sharp.version !== "0.35.4")
    add(issues, "Sharp 0.35.4 must be locked.");
  else {
    if (
      typeof sharp.packageLockIntegrity !== "string" ||
      !sharp.packageLockIntegrity.startsWith("sha512-")
    )
      add(issues, "Sharp pnpm integrity is required.");
    if (
      !isObject(sharp.artifact) ||
      !isSafePortablePath(sharp.artifact.file) ||
      !isPositiveInteger(sharp.artifact.bytes) ||
      !sha256Pattern.test(sharp.artifact.sha256 ?? "")
    )
      add(issues, "Sharp manifest path, bytes, and SHA-256 are required.");
  }
  return issues;
}

export function assertToolchainLock(lock) {
  const issues = validateToolchainLock(lock);
  if (issues.length) throw new Error(`Toolchain lock validation failed:\n- ${issues.join("\n- ")}`);
}

export function verifySharpProjectDependency(
  root = projectRoot,
  sharp = loadToolchainLock(root).sharp,
) {
  const issues = [];
  try {
    const manifestFile = resolvePortablePath(root, sharp.artifact.file, "Sharp package manifest");
    if (!existsSync(manifestFile)) add(issues, "Sharp package manifest is missing.");
    else {
      const manifest = readJson(manifestFile);
      if (manifest.version !== sharp.version) add(issues, "Sharp package version mismatch.");
      if (statSync(manifestFile).size !== sharp.artifact.bytes)
        add(issues, "Sharp package manifest byte count mismatch.");
      if (sha256File(manifestFile) !== sharp.artifact.sha256)
        add(issues, "Sharp package manifest SHA-256 mismatch.");
    }
    const pnpm = path.join(root, "pnpm-lock.yaml");
    const pnpmText = existsSync(pnpm) ? readFileSync(pnpm, "utf8") : "";
    if (
      !pnpmText.includes(`sharp@${sharp.version}:`) ||
      !pnpmText.includes(sharp.packageLockIntegrity)
    )
      add(issues, "Sharp pnpm integrity is missing or changed.");
  } catch (error) {
    add(issues, error instanceof Error ? error.message : "Sharp verification failed.");
  }
  return issues;
}

function localManifestPath(root, lock) {
  return resolvePortablePath(root, lock.policy.localManifest, "toolchain local manifest");
}

function defaultVersionProbe(commandPath, commandArgs, versionArgs) {
  const batch =
    process.platform === "win32" &&
    [".cmd", ".bat"].includes(path.extname(commandPath).toLowerCase());
  const result = batch
    ? spawnSync(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", `"${commandPath}" ${[...commandArgs, ...versionArgs].join(" ")}`],
        { encoding: "utf8", shell: false },
      )
    : spawnSync(commandPath, [...commandArgs, ...versionArgs], { encoding: "utf8", shell: false });
  return result.error || result.status !== 0
    ? ""
    : String(result.stdout || result.stderr || "").trim();
}

export function verifyRuntimeVersions(lock, options = {}) {
  const issues = [];
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const userAgentPnpm = /(?:^|\s)pnpm\/([^\s]+)/.exec(process.env.npm_config_user_agent ?? "")?.[1];
  let pnpmVersion = options.pnpmVersion ?? userAgentPnpm;
  if (!pnpmVersion) {
    const fallbackPnpm =
      process.platform === "win32"
        ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pnpm --version"], {
            encoding: "utf8",
            shell: false,
          })
        : spawnSync("pnpm", ["--version"], { encoding: "utf8", shell: false });
    pnpmVersion =
      fallbackPnpm.error || fallbackPnpm.status !== 0
        ? ""
        : String(fallbackPnpm.stdout || fallbackPnpm.stderr || "").trim();
  }
  if (String(nodeVersion).split(".")[0] !== lock.node.version)
    add(issues, `Node ${lock.node.version}.x is required; found ${nodeVersion || "unavailable"}.`);
  if (String(pnpmVersion).split(".")[0] !== lock.pnpm.version)
    add(issues, `pnpm ${lock.pnpm.version}.x is required; found ${pnpmVersion || "unavailable"}.`);
  return issues;
}

export function verifyInstalledToolchain(root = projectRoot, options = {}) {
  const lock = options.lock ?? loadToolchainLock(root);
  const issues = validateToolchainLock(lock);
  if (issues.length) return issues;
  issues.push(...verifyRuntimeVersions(lock, options.runtimeVersions));
  const installRoot = resolvePortablePath(root, lock.policy.installRoot, "toolchain install root");
  const manifestFile = localManifestPath(root, lock);
  if (!existsSync(manifestFile)) {
    add(issues, "Local toolchain manifest is missing. Run pnpm toolchain:install explicitly.");
    issues.push(...verifySharpProjectDependency(root, lock.sharp));
    return issues;
  }
  if (
    !existsSync(installRoot) ||
    !lstatSync(installRoot).isDirectory() ||
    lstatSync(installRoot).isSymbolicLink() ||
    !lstatSync(manifestFile).isFile() ||
    lstatSync(manifestFile).isSymbolicLink()
  ) {
    add(issues, "Local toolchain root or manifest is not a regular local path.");
    return issues;
  }
  let local;
  try {
    local = readJson(manifestFile);
  } catch {
    return ["Local toolchain manifest is not valid JSON."];
  }
  if (local.version !== 1 || local.lockSha256 !== (options.lockSha256 ?? toolchainLockSha256(root)))
    add(issues, "Local toolchain manifest is not bound to this lock.");
  if (!path.isAbsolute(local.installRoot) || local.installRoot !== installRoot)
    add(issues, "Local toolchain install root is not the expected absolute path.");
  const localEntries = Array.isArray(local.tools) ? local.tools : [];
  const validEntries = localEntries.filter((tool) => isObject(tool) && typeof tool.id === "string");
  if (validEntries.length !== localEntries.length)
    add(issues, "Local toolchain manifest contains malformed tool records.");
  const localTools = new Map(validEntries.map((tool) => [tool.id, tool]));
  if (localTools.size !== validEntries.length)
    add(issues, "Local toolchain manifest contains duplicate tool records.");
  for (const id of localTools.keys())
    if (!expectedTools.has(id))
      add(issues, `Local toolchain manifest contains unexpected tool ${id}.`);
  const platform = options.platform ?? platformKey();
  const versionProbe = options.versionProbe ?? defaultVersionProbe;
  for (const tool of lock.tools) {
    const artifact = findArtifactForPlatform(tool, platform);
    if (!artifact) {
      add(issues, `${tool.id} has no locked artifact for ${platform}.`);
      continue;
    }
    const localTool = localTools.get(tool.id);
    if (!isObject(localTool)) {
      add(issues, `${tool.id} is missing from the local manifest.`);
      continue;
    }
    const pathsValid = ["archivePath", "executablePath", "commandPath"].every(
      (field) => typeof localTool[field] === "string" && path.isAbsolute(localTool[field]),
    );
    if (!pathsValid) {
      add(issues, `${tool.id} local paths must be absolute.`);
      continue;
    }
    if (
      !within(installRoot, localTool.archivePath) ||
      !within(installRoot, localTool.executablePath)
    ) {
      add(issues, `${tool.id} archive or executable escaped the toolchain root.`);
      continue;
    }
    const commandArgs = Array.isArray(localTool.commandArgs) ? localTool.commandArgs : [];
    const commandBindingValid =
      artifact.archive === "npm-tgz"
        ? localTool.commandPath === process.execPath &&
          commandArgs.length === 1 &&
          commandArgs[0] === localTool.executablePath
        : within(installRoot, localTool.commandPath) &&
          localTool.commandPath === localTool.executablePath &&
          commandArgs.length === 0;
    if (!commandBindingValid) {
      add(issues, `${tool.id} command path or arguments are not bound to its executable.`);
      continue;
    }
    if (
      !regularFileWithin(installRoot, localTool.archivePath) ||
      sha256File(localTool.archivePath) !== artifact.sha256 ||
      statSync(localTool.archivePath).size !== artifact.bytes
    )
      add(issues, `${tool.id} archive byte/SHA-256 mismatch.`);
    if (
      !regularFileWithin(installRoot, localTool.executablePath) ||
      !sha256Pattern.test(localTool.executableSha256 ?? "") ||
      sha256File(localTool.executablePath) !== localTool.executableSha256 ||
      statSync(localTool.executablePath).size !== localTool.executableBytes
    )
      add(issues, `${tool.id} executable byte/SHA-256 mismatch.`);
    const commandTrusted =
      (artifact.archive === "npm-tgz"
        ? existsSync(localTool.commandPath) &&
          lstatSync(localTool.commandPath).isFile() &&
          !lstatSync(localTool.commandPath).isSymbolicLink()
        : regularFileWithin(installRoot, localTool.commandPath)) &&
      sha256Pattern.test(localTool.commandSha256 ?? "") &&
      sha256File(localTool.commandPath) === localTool.commandSha256 &&
      statSync(localTool.commandPath).size === localTool.commandBytes;
    if (!commandTrusted) {
      add(issues, `${tool.id} command byte/SHA-256 mismatch.`);
    }
    if (artifact.archive === "npm-tgz") {
      const dependencyLockValid =
        typeof localTool.dependencyLockPath === "string" &&
        path.isAbsolute(localTool.dependencyLockPath) &&
        within(installRoot, localTool.dependencyLockPath) &&
        regularFileWithin(installRoot, localTool.dependencyLockPath) &&
        sha256Pattern.test(localTool.dependencyLockSha256 ?? "") &&
        sha256File(localTool.dependencyLockPath) === localTool.dependencyLockSha256;
      if (!dependencyLockValid)
        add(issues, `${tool.id} dependency lock is missing, escaped, or changed.`);
    } else if (
      localTool.dependencyLockPath !== undefined ||
      localTool.dependencyLockSha256 !== undefined
    ) {
      add(issues, `${tool.id} must not declare an npm dependency lock.`);
    }
    const lockedSupport = tool.supportArtifacts ?? [];
    const localSupport = Array.isArray(localTool.supportArtifacts)
      ? localTool.supportArtifacts
      : [];
    const localSupportById = new Map(localSupport.map((support) => [support?.id, support]));
    if (
      localSupport.length !== lockedSupport.length ||
      localSupportById.size !== localSupport.length
    )
      add(issues, `${tool.id} support artifact inventory is missing or duplicated.`);
    for (const support of lockedSupport) {
      const installed = localSupportById.get(support.id);
      if (
        !isObject(installed) ||
        typeof installed.archivePath !== "string" ||
        !path.isAbsolute(installed.archivePath) ||
        typeof installed.rootPath !== "string" ||
        !path.isAbsolute(installed.rootPath) ||
        !within(installRoot, installed.archivePath) ||
        !within(installRoot, installed.rootPath)
      ) {
        add(issues, `${tool.id}/${support.id} support paths are missing or escaped.`);
        continue;
      }
      if (
        !regularFileWithin(installRoot, installed.archivePath) ||
        installed.archiveBytes !== support.bytes ||
        installed.archiveSha256 !== support.sha256 ||
        statSync(installed.archivePath).size !== support.bytes ||
        sha256File(installed.archivePath) !== support.sha256
      )
        add(issues, `${tool.id}/${support.id} support archive byte/SHA-256 mismatch.`);
      if (!regularDirectoryWithin(installRoot, installed.rootPath)) {
        add(issues, `${tool.id}/${support.id} support extraction root is unsafe.`);
        continue;
      }
      let actualFiles;
      try {
        actualFiles = supportFileDescriptors(installed.rootPath);
      } catch (error) {
        add(
          issues,
          error instanceof Error
            ? error.message
            : `${tool.id}/${support.id} support file verification failed.`,
        );
        continue;
      }
      if (
        !Array.isArray(installed.files) ||
        JSON.stringify(actualFiles) !== JSON.stringify(installed.files)
      )
        add(issues, `${tool.id}/${support.id} extracted support files changed.`);
    }
    if (commandTrusted) {
      const output = versionProbe(localTool.commandPath, commandArgs, tool.versionArgs);
      if (!output || !new RegExp(tool.versionPattern).test(output))
        add(issues, `${tool.id} version probe did not match ${tool.version}.`);
    }
  }
  issues.push(...verifySharpProjectDependency(root, lock.sharp));
  return issues;
}

function extension(archive) {
  return archive === "raw" ? "bin" : archive === "zip" ? "zip" : archive === "nsis" ? "exe" : "tgz";
}

function findFile(directory, filename) {
  const matches = [];
  const walk = (current) =>
    readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) walk(item);
      else if (entry.name === filename) matches.push(item);
    });
  walk(directory);
  return matches.length === 1 ? matches[0] : "";
}

function supportFileDescriptors(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Support artifact contains a symbolic link: ${entry.name}.`);
      if (entry.isDirectory()) walk(item);
      else if (entry.isFile()) {
        const relativePath = path.relative(directory, item).replaceAll(path.sep, "/");
        if (!isSafePortablePath(relativePath))
          throw new Error(`Support artifact contains an unsafe path: ${relativePath}.`);
        files.push({
          path: relativePath,
          bytes: statSync(item).size,
          sha256: sha256File(item),
        });
      }
    }
  };
  walk(directory);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function extractSupportArchive(archiveFile, artifact, target) {
  if (artifact.archive !== "zip" && artifact.archive !== "npm-tgz")
    throw new Error(`Unsupported support archive type: ${artifact.archive}.`);
  mkdirSync(target, { recursive: true });
  const args =
    artifact.archive === "zip"
      ? ["-xf", archiveFile, "-C", target]
      : ["-xzf", archiveFile, "-C", target];
  const result = spawnSync("tar", args, { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0)
    throw new Error(`Cannot extract support archive ${artifact.id}.`);
  if (supportFileDescriptors(target).length === 0)
    throw new Error(`Support archive ${artifact.id} extracted no files.`);
  return target;
}

function extract(archiveFile, artifact, target) {
  mkdirSync(target, { recursive: true });
  if (artifact.archive === "nsis") {
    const psLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const script = [
      `$process = Start-Process -FilePath ${psLiteral(archiveFile)} -ArgumentList @('/S', ${psLiteral(`/D=${target}`)}) -Wait -PassThru -WindowStyle Hidden`,
      "exit $process.ExitCode",
    ].join("; ");
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        encoding: "utf8",
        shell: false,
      },
    );
    if (result.error || result.status !== 0) {
      const diagnostics = [
        result.error?.message,
        result.stdout,
        result.stderr,
        result.status === null ? undefined : `exit ${result.status}`,
      ]
        .filter(Boolean)
        .join("\n")
        .trim();
      throw new Error(`Cannot install NSIS package (${diagnostics || "spawn error"}).`);
    }
    const direct = path.join(target, ...artifact.entry.split("/"));
    const executable = existsSync(direct)
      ? direct
      : findFile(target, path.basename(artifact.entry));
    if (!executable) throw new Error(`NSIS package did not install ${artifact.entry}.`);
    return executable;
  }
  if (artifact.archive === "raw") {
    const executable = path.join(target, ...artifact.entry.split("/"));
    mkdirSync(path.dirname(executable), { recursive: true });
    cpSync(archiveFile, executable);
    return executable;
  }
  const result =
    artifact.archive === "zip"
      ? spawnSync("tar", ["-xf", archiveFile, "-C", target], { encoding: "utf8", shell: false })
      : spawnSync("tar", ["-xzf", archiveFile, "-C", target], { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) throw new Error(`Cannot extract ${artifact.archive}.`);
  if (artifact.archive === "npm-tgz") {
    const packageRoot = path.join(target, "package");
    const packageJson = readJson(path.join(packageRoot, "package.json"));
    const bin =
      typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[artifact.entry];
    if (!isSafePortablePath(bin)) throw new Error("npm CLI entry is missing or unsafe.");
    return path.join(packageRoot, ...bin.split("/"));
  }
  const direct = path.join(target, ...artifact.entry.split("/"));
  return existsSync(direct) ? direct : findFile(target, path.basename(artifact.entry));
}

async function download(url, target) {
  let response;
  try {
    response = await globalThis.fetch(url);
  } catch (error) {
    throw new Error(
      `Download failed for ${url} (${error instanceof Error ? error.message : "network error"}).`,
      { cause: error },
    );
  }
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}.`);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

async function acquireLockedArtifact(root, url, target, context) {
  const artifact = context?.artifact;
  if (!artifact || !isPositiveInteger(artifact.bytes) || !sha256Pattern.test(artifact.sha256 ?? ""))
    throw new Error("Locked artifact metadata is missing before download.");
  const cacheRoot = resolvePortablePath(
    root,
    ".cache/rendering-toolchain",
    "rendering toolchain cache",
  );
  mkdirSync(cacheRoot, { recursive: true });
  const cachedCandidates = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => path.join(cacheRoot, entry.name));
  const cached = cachedCandidates.find(
    (file) => statSync(file).size === artifact.bytes && sha256File(file) === artifact.sha256,
  );
  if (cached) {
    cpSync(cached, target);
    return;
  }

  await download(url, target);
  if (
    !existsSync(target) ||
    statSync(target).size !== artifact.bytes ||
    sha256File(target) !== artifact.sha256
  )
    throw new Error("Downloaded artifact did not match its locked bytes and SHA-256.");
  const canonicalCache = path.join(cacheRoot, `${artifact.sha256}.${extension(artifact.archive)}`);
  if (!existsSync(canonicalCache)) {
    const temporary = `${canonicalCache}.tmp-${randomUUID()}`;
    try {
      cpSync(target, temporary, { errorOnExist: true, force: false });
      renameSync(temporary, canonicalCache);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    }
  }
}

function commitInstall(installRoot, stagingRoot, verifyCommitted) {
  const backupRoot = `${installRoot}.backup-${randomUUID()}`;
  let backedUp = false;
  try {
    if (existsSync(installRoot)) {
      renameSync(installRoot, backupRoot);
      backedUp = true;
    }
    renameSync(stagingRoot, installRoot);
    verifyCommitted();
    if (backedUp) rmSync(backupRoot, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(installRoot)) rmSync(installRoot, { recursive: true, force: true });
    if (backedUp && existsSync(backupRoot)) renameSync(backupRoot, installRoot);
    throw error;
  }
}

export async function installRenderingToolchain(root = projectRoot, options = {}) {
  const lock = options.lock ?? loadToolchainLock(root);
  assertToolchainLock(lock);
  const runtimeIssues = verifyRuntimeVersions(lock, options.runtimeVersions);
  if (runtimeIssues.length)
    throw new Error(`Toolchain runtime validation failed:\n- ${runtimeIssues.join("\n- ")}`);
  const platform = options.platform ?? platformKey();
  const installRoot = resolvePortablePath(root, lock.policy.installRoot, "toolchain install root");
  const stagingRoot = `${installRoot}.staging-${randomUUID()}`;
  const fetchArtifact =
    options.fetchArtifact ??
    ((url, target, context) => acquireLockedArtifact(root, url, target, context));
  const versionProbe = options.versionProbe ?? defaultVersionProbe;
  const extractArtifact = options.extractArtifact ?? extract;
  const extractSupportArtifact = options.extractSupportArtifact ?? extractSupportArchive;
  try {
    for (const tool of lock.tools)
      if (!findArtifactForPlatform(tool, platform))
        throw new Error(`${tool.id} has no locked artifact for ${platform}.`);
    rmSync(stagingRoot, { recursive: true, force: true });
    mkdirSync(path.join(stagingRoot, "archives"), { recursive: true });
    const tools = [];
    for (const tool of lock.tools) {
      const artifact = findArtifactForPlatform(tool, platform);
      const archive = path.join(
        stagingRoot,
        "archives",
        `${tool.id}.${extension(artifact.archive)}`,
      );
      await fetchArtifact(artifact.url, archive, { tool, artifact });
      if (
        !existsSync(archive) ||
        statSync(archive).size !== artifact.bytes ||
        sha256File(archive) !== artifact.sha256
      )
        throw new Error(`${tool.id} archive failed byte/SHA-256 verification.`);
      let executable;
      let commandPath;
      let commandArgs;
      let dependencyLock;
      if (artifact.archive === "npm-tgz") {
        const installNpmTool = options.installNpmTool ?? defaultNpmToolInstaller;
        const installed = await installNpmTool(
          path.join(stagingRoot, "tools", tool.id),
          tool,
          artifact,
          archive,
        );
        executable = installed.executable;
        commandPath = installed.commandPath;
        commandArgs = installed.commandArgs ?? [];
        dependencyLock = installed.lockfile;
      } else {
        executable = extractArtifact(archive, artifact, path.join(stagingRoot, "tools", tool.id));
        commandPath = executable;
        commandArgs = [];
      }
      if (!executable || !commandPath || !existsSync(executable) || !existsSync(commandPath))
        throw new Error(`${tool.id} installation did not produce its executable and command.`);
      const output = versionProbe(commandPath, commandArgs, tool.versionArgs);
      if (!output || !new RegExp(tool.versionPattern).test(output))
        throw new Error(`${tool.id} version probe did not match ${tool.version}.`);
      const absolute = (entry) => path.join(installRoot, path.relative(stagingRoot, entry));
      const installedCommandPath =
        artifact.archive === "npm-tgz" ? commandPath : absolute(commandPath);
      const installedCommandArgs = artifact.archive === "npm-tgz" ? [absolute(executable)] : [];
      const localTool = {
        id: tool.id,
        archivePath: absolute(archive),
        executablePath: absolute(executable),
        executableBytes: statSync(executable).size,
        executableSha256: sha256File(executable),
        commandPath: installedCommandPath,
        commandArgs: installedCommandArgs,
        commandBytes: statSync(commandPath).size,
        commandSha256: sha256File(commandPath),
        versionOutput: output,
      };
      if (dependencyLock) {
        localTool.dependencyLockPath = absolute(dependencyLock);
        localTool.dependencyLockSha256 = sha256File(dependencyLock);
      }
      localTool.supportArtifacts = [];
      for (const support of tool.supportArtifacts ?? []) {
        const supportArchive = path.join(
          stagingRoot,
          "archives",
          `${tool.id}-${support.id}.${extension(support.archive)}`,
        );
        await fetchArtifact(support.url, supportArchive, {
          tool,
          artifact: support,
          supportArtifact: true,
        });
        if (
          !existsSync(supportArchive) ||
          statSync(supportArchive).size !== support.bytes ||
          sha256File(supportArchive) !== support.sha256
        )
          throw new Error(
            `${tool.id}/${support.id} support archive failed byte/SHA-256 verification.`,
          );
        const supportRoot = extractSupportArtifact(
          supportArchive,
          support,
          path.join(stagingRoot, "support", tool.id, support.id),
        );
        const files = supportFileDescriptors(supportRoot);
        if (files.length === 0)
          throw new Error(`${tool.id}/${support.id} support archive is empty.`);
        localTool.supportArtifacts.push({
          id: support.id,
          archivePath: absolute(supportArchive),
          archiveBytes: statSync(supportArchive).size,
          archiveSha256: sha256File(supportArchive),
          rootPath: absolute(supportRoot),
          files,
        });
      }
      tools.push(localTool);
    }
    writeFileSync(
      path.join(stagingRoot, "toolchain.local.json"),
      `${JSON.stringify({ version: 1, lockSha256: options.lockSha256 ?? toolchainLockSha256(root), installRoot, tools }, null, 2)}\n`,
    );
    commitInstall(installRoot, stagingRoot, () => {
      const issues = verifyInstalledToolchain(root, {
        lock,
        lockSha256: options.lockSha256 ?? toolchainLockSha256(root),
        platform,
        runtimeVersions: options.runtimeVersions,
        versionProbe,
      });
      if (issues.length)
        throw new Error(`Committed toolchain verification failed:\n- ${issues.join("\n- ")}`);
    });
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}
function defaultNpmToolInstaller(target, tool, _artifact, archiveFile) {
  mkdirSync(target, { recursive: true });
  if (!archiveFile || !existsSync(archiveFile))
    throw new Error(`${tool.id} verified npm archive is missing.`);
  const dependencyPath = path.relative(target, archiveFile).replaceAll("\\", "/");
  writeFileSync(
    path.join(target, "package.json"),
    `${JSON.stringify({ private: true, packageManager: "pnpm@11.19.0", dependencies: { "@gltf-transform/cli": `file:${dependencyPath}` } }, null, 2)}\n`,
  );
  const pnpmArgs = [
    "--dir",
    target,
    "install",
    "--prod",
    "--ignore-workspace",
    "--ignore-scripts",
    "--config.node-linker=hoisted",
    "--config.package-import-method=copy",
    "--config.save-exact=true",
  ];
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pnpm.cmd", ...pnpmArgs], {
          encoding: "utf8",
          shell: false,
        })
      : spawnSync("pnpm", pnpmArgs, { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) {
    const diagnostics = [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(`Cannot install ${tool.id} dependencies (${diagnostics || "failed"}).`);
  }
  const executable = path.join(target, "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
  const lockfile = path.join(target, "pnpm-lock.yaml");
  if (![executable, lockfile].every((file) => existsSync(file)))
    throw new Error(`${tool.id} local pnpm install is incomplete.`);
  return { commandPath: process.execPath, commandArgs: [executable], executable, lockfile };
}
