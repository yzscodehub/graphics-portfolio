import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRenderingSourceLock, projectRoot, sourceLockRelativePath } from "./manifest.mjs";

const API_ROOT = "https://api.polyhaven.com";
const CACHE_ROOT = ".cache/rendering-sources";

function assertFile(file, label) {
  if (!file || typeof file.url !== "string" || !Number.isSafeInteger(file.size) || file.size < 1)
    throw new Error(`${label}: official API did not return a downloadable file descriptor.`);
  return file;
}

function descriptor(role, relativePath, file) {
  const value = assertFile(file, role);
  return {
    role,
    relativePath,
    directUrl: value.url,
    bytes: value.size,
    md5: value.md5,
    sha256: null,
    status: "metadata-locked",
    cachePath: `${CACHE_ROOT}/{id}/${relativePath}`,
  };
}

function modelFiles(tree) {
  const gltf = assertFile(tree?.gltf?.["1k"]?.gltf, "gltf/1k/gltf");
  const includes = Object.entries(gltf.include ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, file]) => descriptor("gltf-include", relativePath, file));
  return [descriptor("gltf", path.basename(new URL(gltf.url).pathname), gltf), ...includes];
}

function textureFiles(tree) {
  const map = [
    ["base-color", tree?.Diffuse?.["1k"]?.jpg],
    ["normal", tree?.nor_gl?.["1k"]?.jpg ?? tree?.nor_dx?.["1k"]?.jpg],
    ["roughness", tree?.Rough?.["1k"]?.jpg],
  ];
  return map.map(([role, file]) => {
    const value = assertFile(file, `texture/${role}/1k/jpg`);
    return descriptor(role, path.basename(new URL(value.url).pathname), value);
  });
}

function hdriFiles(tree) {
  const hdr = assertFile(tree?.hdri?.["1k"]?.hdr, "hdri/1k/hdr");
  return [descriptor("hdr", path.basename(new URL(hdr.url).pathname), hdr)];
}

function selectedFiles(source, files) {
  if (source.kind === "mesh") return modelFiles(files);
  if (source.kind === "texture") return textureFiles(files);
  if (source.kind === "hdri") return hdriFiles(files);
  throw new Error(`${source.id}: unsupported source kind '${source.kind}'.`);
}

async function json(url) {
  const response = await globalThis.fetch(url, {
    headers: { "User-Agent": "graphics-portfolio-source-lock/1.0" },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function refreshPolyHavenSourceLock(sourceLock) {
  const sources = await Promise.all(
    sourceLock.sources.map(async (source) => {
      const infoUrl = `${API_ROOT}/info/${source.page}`;
      const filesUrl = `${API_ROOT}/files/${source.page}`;
      const [info, files] = await Promise.all([json(infoUrl), json(filesUrl)]);
      const selected = selectedFiles(source, files).map((file) => ({
        ...file,
        cachePath: file.cachePath.replace("{id}", source.id),
      }));
      return {
        id: source.id,
        kind: source.kind,
        page: source.page,
        sourceUrl: `https://polyhaven.com/a/${source.page}`,
        license: "CC0",
        authors: Object.keys(info.authors || {}).sort(),
        api: {
          infoUrl,
          filesUrl,
          filesHash: info.files_hash || null,
          queriedAt: new Date().toISOString(),
        },
        selection:
          source.kind === "mesh"
            ? { format: "gltf", resolution: "1k", include: true }
            : source.kind === "texture"
              ? { format: "jpg", resolution: "1k", maps: ["Diffuse", "nor_gl|nor_dx", "Rough"] }
              : { format: "hdr", resolution: "1k" },
        files: selected,
        usedBy: source.usedBy,
      };
    }),
  );
  return { sources };
}

function nextLock(sources) {
  return {
    version: 2,
    policy: {
      license: "CC0",
      downloaded: false,
      rawCache: CACHE_ROOT,
      sourceHashPolicy:
        "Each selected file needs its own reviewed SHA-256 before cache download or conversion.",
      disallowedExtensions: [".zip", ".blend", ".exr", ".psd", ".tif", ".tiff"],
    },
    defaults: { license: "CC0", status: "metadata-locked", sourceUrl: "https://polyhaven.com/a/" },
    sources,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = loadRenderingSourceLock(projectRoot);
  try {
    const result = await refreshPolyHavenSourceLock(current);
    const refreshed = nextLock(result.sources);
    writeFileSync(
      path.join(projectRoot, sourceLockRelativePath),
      JSON.stringify(refreshed, null, 2) + "\n",
    );
    console.log(
      "Locked " + refreshed.sources.length + " Poly Haven source records from the official API.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
