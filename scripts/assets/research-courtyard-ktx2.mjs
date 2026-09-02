import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  researchCourtyardTextureFormat,
  researchCourtyardTextureVersion,
  textureCatalogFromManifest,
} from "./research-courtyard-textures.mjs";
import { resolveInstalledToolCommands } from "./toolchain.mjs";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(thisFile), "../..");
const ktx2Magic = Buffer.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const hashPattern = /^[a-f0-9]{64}$/;

export const researchCourtyardKtx2Format = "graphics-portfolio-research-courtyard-runtime-textures";
export const researchCourtyardKtx2Version = 1;

export class ResearchCourtyardKtx2Error extends Error {
  constructor(pathname, message) {
    super(`${pathname}: ${message}`);
    this.name = "ResearchCourtyardKtx2Error";
    this.path = pathname;
  }
}

function fail(pathname, message) {
  throw new ResearchCourtyardKtx2Error(pathname, message);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileDigest(file) {
  return digest(readFileSync(file));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function canonicalJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function within(parent, candidate) {
  const relation = path.relative(path.resolve(parent), path.resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}

function safeRelative(root, relative, pathname) {
  if (
    typeof relative !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail(pathname, "contains an unsafe path");
  const file = path.resolve(root, relative);
  if (!within(root, file)) fail(pathname, "escaped its root");
  return file;
}

function safeFile(file, receipt, pathname) {
  if (
    !existsSync(file) ||
    !lstatSync(file).isFile() ||
    lstatSync(file).isSymbolicLink() ||
    statSync(file).size !== receipt.bytes ||
    fileDigest(file) !== receipt.sha256
  )
    fail(pathname, "does not match its candidate receipt");
}

function mapRecords(manifest) {
  const records = [];
  for (const material of [...manifest.materials, ...manifest.modelMaterials])
    for (const map of material.maps) {
      const id = `${material.id}-${map.id}`;
      if (
        map.transcode?.tool !== "toktx" ||
        map.transcode.version !== "4.4.2" ||
        map.transcode.execution !== "not-executed" ||
        map.transcode.id !== id ||
        map.transcode.outputPath !== `ktx2/${id}.ktx2` ||
        map.transcode.inputPath !== `intermediate/${id}.png` ||
        !Array.isArray(map.transcode.args)
      )
        fail(id, "has an invalid locked toktx descriptor");
      records.push({ id, map });
    }
  records.sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(records.map((record) => record.id)).size !== records.length)
    fail("textureCandidate", "contains duplicate runtime texture IDs");
  return records;
}

export function loadResearchCourtyardTextureCandidate(candidateDirectory) {
  candidateDirectory = path.resolve(candidateDirectory);
  if (
    !existsSync(candidateDirectory) ||
    !lstatSync(candidateDirectory).isDirectory() ||
    lstatSync(candidateDirectory).isSymbolicLink()
  )
    fail("textureCandidate", "directory is missing or unsafe");
  const manifestPath = path.join(candidateDirectory, "texture-candidate.manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail("textureCandidate.manifest", error instanceof Error ? error.message : "invalid JSON");
  }
  if (
    manifest.format !== researchCourtyardTextureFormat ||
    manifest.version !== researchCourtyardTextureVersion ||
    manifest.status !== "candidate" ||
    manifest.publishable !== false ||
    !hashPattern.test(manifest.sourceSetSha256 ?? "") ||
    !hashPattern.test(manifest.sourceLockSha256 ?? "") ||
    !hashPattern.test(manifest.recipeSha256 ?? "") ||
    !Array.isArray(manifest.materials) ||
    !Array.isArray(manifest.modelMaterials)
  )
    fail("textureCandidate.manifest", "identity or candidate status mismatch");
  const records = mapRecords(manifest);
  for (const { id, map } of records) {
    const intermediate = safeRelative(candidateDirectory, map.intermediate.path, id);
    const fallback = safeRelative(candidateDirectory, map.fallback.path, id);
    safeFile(intermediate, map.intermediate, `${id}.intermediate`);
    safeFile(fallback, map.fallback, `${id}.fallback`);
  }
  return {
    directory: candidateDirectory,
    manifestPath,
    manifest,
    manifestSha256: fileDigest(manifestPath),
    records,
    catalog: textureCatalogFromManifest(manifest),
  };
}

function execute(command, argumentsList, cwd, metadata) {
  void metadata;
  const result = spawnSync(command, argumentsList, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} exited ${String(result.status)}: ${(
        result.stderr ||
        result.stdout ||
        "no output"
      ).trim()}`,
    );
}

export function buildToktxInvocation(tool, record, input, output) {
  if (
    tool?.id !== "ktx-software-toktx" ||
    tool.version !== "4.4.2" ||
    typeof tool.commandPath !== "string" ||
    !Array.isArray(tool.commandArgs)
  )
    fail("toolchain.toktx", "requires the verified KTX-Software 4.4.2 command");
  const descriptor = record.map.transcode;
  const args = descriptor.args;
  if (
    args.length < 3 ||
    args.at(-2) !== descriptor.outputPath ||
    args.at(-1) !== descriptor.inputPath
  )
    fail(record.id, "toktx path arguments are not the final locked arguments");
  return {
    command: tool.commandPath,
    arguments: [...tool.commandArgs, ...args.slice(0, -2), output, input],
  };
}

function outputReceipt(root, file) {
  if (
    !existsSync(file) ||
    !lstatSync(file).isFile() ||
    lstatSync(file).isSymbolicLink() ||
    statSync(file).size === 0
  )
    fail("output", `${file}: missing or unsafe`);
  return {
    path: path.relative(root, file).replaceAll("\\", "/"),
    bytes: statSync(file).size,
    sha256: fileDigest(file),
  };
}

function assertKtx2(file, id) {
  const bytes = readFileSync(file);
  if (bytes.length < ktx2Magic.length || !bytes.subarray(0, ktx2Magic.length).equals(ktx2Magic))
    fail(id, "toktx output does not contain the KTX2 identifier");
}

function safeOutputRoot(root, outputRoot) {
  const cacheRoot = path.resolve(root, ".cache");
  outputRoot = path.resolve(outputRoot);
  if (!within(cacheRoot, outputRoot))
    fail("outputRoot", "must remain inside the ignored .cache directory");
  mkdirSync(outputRoot, { recursive: true });
  if (!lstatSync(outputRoot).isDirectory() || lstatSync(outputRoot).isSymbolicLink())
    fail("outputRoot", "must be a real directory");
  return outputRoot;
}

export function textureCatalogFromRuntimeManifest(manifest) {
  if (
    manifest?.format !== researchCourtyardKtx2Format ||
    manifest.version !== researchCourtyardKtx2Version ||
    manifest.status !== "candidate" ||
    manifest.publishable !== false ||
    !Array.isArray(manifest.textures) ||
    !manifest.materials
  )
    fail("runtime-textures", "requires a candidate runtime texture manifest");
  return Object.freeze({
    textures: Object.freeze(
      manifest.textures.map((texture) =>
        Object.freeze({
          id: texture.id,
          colorSpace: texture.colorSpace,
          ktx2: texture.ktx2.path,
          webp: texture.webp.path,
        }),
      ),
    ),
    materials: Object.freeze(
      Object.fromEntries(
        Object.entries(manifest.materials).map(([key, value]) => [
          key,
          Object.freeze({ ...value }),
        ]),
      ),
    ),
  });
}

export function loadResearchCourtyardRuntimeTextures(directory) {
  directory = path.resolve(directory);
  if (
    !existsSync(directory) ||
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  )
    fail("runtime-textures", "directory is missing or unsafe");
  const manifestPath = path.join(directory, "runtime-textures.manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail("runtime-textures.manifest", error instanceof Error ? error.message : "invalid JSON");
  }
  const catalog = textureCatalogFromRuntimeManifest(manifest);
  if (
    !hashPattern.test(manifest.sourceSetSha256 ?? "") ||
    !hashPattern.test(manifest.sourceLockSha256 ?? "") ||
    !hashPattern.test(manifest.recipeSha256 ?? "") ||
    !hashPattern.test(manifest.toolchainLockSha256 ?? "") ||
    !hashPattern.test(manifest.candidateArtifactsSha256 ?? "") ||
    manifest.textures.length !== catalog.textures.length
  )
    fail("runtime-textures.manifest", "contains incomplete identity fields");
  const artifacts = [];
  for (const texture of manifest.textures) {
    for (const role of ["ktx2", "webp"]) {
      const receipt = texture[role];
      const file = safeRelative(directory, receipt.path, `${texture.id}.${role}`);
      safeFile(file, receipt, `${texture.id}.${role}`);
      if (role === "ktx2") assertKtx2(file, texture.id);
      artifacts.push({ id: texture.id, role, ...receipt });
    }
  }
  const totals = {
    ktx2Bytes: manifest.textures.reduce((sum, texture) => sum + texture.ktx2.bytes, 0),
    webpBytes: manifest.textures.reduce((sum, texture) => sum + texture.webp.bytes, 0),
    textureCount: manifest.textures.length,
  };
  if (
    totals.ktx2Bytes !== manifest.totals?.ktx2Bytes ||
    totals.webpBytes !== manifest.totals?.webpBytes ||
    totals.textureCount !== manifest.totals?.textureCount ||
    digest(canonicalJson(artifacts)) !== manifest.candidateArtifactsSha256
  )
    fail("runtime-textures.manifest", "budget totals or artifact digest mismatch");
  return {
    directory,
    manifestPath,
    manifestSha256: fileDigest(manifestPath),
    manifest,
    catalog,
  };
}

export async function transcodeResearchCourtyardKtx2({
  root = projectRoot,
  textureCandidateDir,
  candidateId = `candidate-${randomUUID()}`,
  outputRoot = path.join(root, ".cache/rendering-builds/research-courtyard-runtime-textures"),
  run = execute,
  toolchain,
}) {
  root = path.resolve(root);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(candidateId))
    fail("candidateId", "must be a safe path segment");
  if (typeof run !== "function") fail("run", "must be a function");
  const source = loadResearchCourtyardTextureCandidate(textureCandidateDir);
  const resolvedToolchain = toolchain ?? resolveInstalledToolCommands(root);
  const tool = resolvedToolchain.commands?.["ktx-software-toktx"];
  const targetRoot = safeOutputRoot(root, outputRoot);
  const output = path.join(targetRoot, candidateId);
  const staging = path.join(targetRoot, `.staging-${candidateId}-${randomUUID()}`);
  if (existsSync(output)) fail("candidateId", "candidate already exists");
  let committed = false;
  try {
    mkdirSync(staging, { recursive: false });
    const textures = [];
    const catalogById = new Map(source.catalog.textures.map((texture) => [texture.id, texture]));
    for (const record of source.records) {
      const catalog = catalogById.get(record.id);
      if (!catalog) fail(record.id, "is absent from the runtime texture catalog");
      const input = safeRelative(
        source.directory,
        record.map.intermediate.path,
        `${record.id}.intermediate`,
      );
      const sourceFallback = safeRelative(
        source.directory,
        record.map.fallback.path,
        `${record.id}.fallback`,
      );
      const ktx2 = path.join(staging, "textures", `${record.id}.ktx2`);
      const webp = path.join(staging, "textures", `${record.id}.webp`);
      mkdirSync(path.dirname(ktx2), { recursive: true });
      const invocation = buildToktxInvocation(tool, record, input, ktx2);
      await run(invocation.command, invocation.arguments, root, {
        id: record.id,
        output: ktx2,
      });
      assertKtx2(ktx2, record.id);
      copyFileSync(sourceFallback, webp);
      textures.push({
        id: record.id,
        colorSpace: catalog.colorSpace,
        ktx2: outputReceipt(staging, ktx2),
        webp: outputReceipt(staging, webp),
      });
    }
    textures.sort((left, right) => left.id.localeCompare(right.id));
    const totals = {
      ktx2Bytes: textures.reduce((sum, texture) => sum + texture.ktx2.bytes, 0),
      webpBytes: textures.reduce((sum, texture) => sum + texture.webp.bytes, 0),
      textureCount: textures.length,
    };
    if (totals.ktx2Bytes > 5 * 1024 * 1024)
      fail("budget", `KTX2 total ${totals.ktx2Bytes} exceeds 5 MiB`);
    if (totals.webpBytes > 3 * 1024 * 1024)
      fail("budget", `WebP total ${totals.webpBytes} exceeds 3 MiB`);
    const manifest = {
      format: researchCourtyardKtx2Format,
      version: researchCourtyardKtx2Version,
      status: "candidate",
      publishable: false,
      sourceSetSha256: source.manifest.sourceSetSha256,
      sourceLockSha256: source.manifest.sourceLockSha256,
      recipeSha256: source.manifest.recipeSha256,
      textureCandidateManifestSha256: source.manifestSha256,
      toolchainLockSha256: resolvedToolchain.lockSha256,
      tool: {
        id: tool.id,
        version: tool.version,
        executableSha256: tool.executableSha256,
      },
      totals,
      textures,
      materials: source.catalog.materials,
      candidateArtifactsSha256: digest(
        canonicalJson(
          textures.flatMap((texture) => [
            { id: texture.id, role: "ktx2", ...texture.ktx2 },
            { id: texture.id, role: "webp", ...texture.webp },
          ]),
        ),
      ),
      currentLimit:
        "KTX2 contains ETC1S or UASTC-RDO payloads for runtime transcoding; WebP is the verified RGBA8 fallback. The fixed budget does not include the ignored PNG intermediates.",
    };
    writeFileSync(path.join(staging, "runtime-textures.manifest.json"), canonicalJson(manifest));
    if (existsSync(output)) fail("candidateId", "candidate appeared during staging");
    renameSync(staging, output);
    committed = true;
    return {
      outputDir: output,
      manifestPath: path.join(output, "runtime-textures.manifest.json"),
      manifest,
    };
  } catch (error) {
    if (!committed && existsSync(staging))
      try {
        rmSync(staging, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "KTX2 transcoding failed and staging cleanup also failed.",
          { cause: cleanupError },
        );
      }
    throw error;
  }
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (
      !["--input", "--candidate-id"].includes(flag) ||
      typeof value !== "string" ||
      values.has(flag)
    )
      fail("arguments", "usage: research-courtyard-ktx2.mjs --input DIR [--candidate-id ID]");
    values.set(flag, value);
  }
  if (!values.has("--input")) fail("arguments", "--input is required");
  return {
    textureCandidateDir: path.resolve(values.get("--input")),
    candidateId: values.get("--candidate-id") ?? "candidate",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  try {
    const result = await transcodeResearchCourtyardKtx2(parseArguments(process.argv.slice(2)));
    console.log(
      canonicalJson({
        outputDir: result.outputDir,
        manifestPath: result.manifestPath,
        totals: result.manifest.totals,
        candidateArtifactsSha256: result.manifest.candidateArtifactsSha256,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
