import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { assertExactSourceCachePath, calculateSourceSetSha256 } from "./manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const width = 1024;
const height = 512;
const fourPi = 4 * Math.PI;
const roundDigits = 12;
const maxPixels = 64 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;

sharp.cache(false);
sharp.concurrency(1);

export const researchCourtyardHdriFormat = "graphics-portfolio-research-courtyard-hdri";
export const researchCourtyardHdriVersion = 1;
export const requiredSharpVersion = "0.35.4";
export const researchCourtyardHdriContract = Object.freeze({
  width,
  height,
  colorSpace: "linear",
  diffuseShCoefficients: 9,
  shBasis: "real-sh-y-up-v1",
  convolution: "lambertian-cosine-v1",
  specularIbl: false,
  runtimeHdr: false,
  preview: Object.freeze({
    width,
    height,
    format: "webp",
    colorSpace: "srgb",
    toneMap: "aces-fitted-v1",
    quality: 90,
    effort: 4,
    smartSubsample: false,
    hdrRuntime: false,
  }),
});

const order = Object.freeze([
  Object.freeze({ index: 0, l: 0, m: 0 }),
  Object.freeze({ index: 1, l: 1, m: -1 }),
  Object.freeze({ index: 2, l: 1, m: 0 }),
  Object.freeze({ index: 3, l: 1, m: 1 }),
  Object.freeze({ index: 4, l: 2, m: -2 }),
  Object.freeze({ index: 5, l: 2, m: -1 }),
  Object.freeze({ index: 6, l: 2, m: 0 }),
  Object.freeze({ index: 7, l: 2, m: 1 }),
  Object.freeze({ index: 8, l: 2, m: 2 }),
]);
const lambertianBandFactors = Object.freeze([Math.PI, (2 * Math.PI) / 3, Math.PI / 4]);

export class ResearchCourtyardHdriError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ResearchCourtyardHdriError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ResearchCourtyardHdriError(code, message);
}

function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function portable(value) {
  return value.replaceAll(path.sep, "/");
}

function within(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safePortable(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value.split("/").some((part) => !part || part === "." || part === "..")
  );
}

function existingDirectory(value, label) {
  const resolved = path.resolve(value);
  if (!existsSync(resolved) || !lstatSync(resolved).isDirectory())
    fail("directory", `${label} is missing`);
  if (lstatSync(resolved).isSymbolicLink()) fail("symlink", `${label} is a symlink`);
  return resolved;
}

function noSymlinkSegments(parent, candidate, label) {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  if (!within(resolvedParent, resolvedCandidate)) fail("path-escape", `${label} escaped root`);
  existingDirectory(resolvedParent, `${label} root`);
  let current = resolvedParent;
  for (const part of path.relative(resolvedParent, resolvedCandidate).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) fail("symlink", `${label} contains a symlink`);
  }
  return resolvedCandidate;
}

function rounded(value) {
  const result = Number(value.toFixed(roundDigits));
  return Object.is(result, -0) ? 0 : result;
}

function line(input, state, label) {
  if (state.offset >= input.length) fail("hdr-truncated", `${label} is truncated`);
  const begin = state.offset;
  let end = begin;
  while (end < input.length && input[end] !== 10) end += 1;
  if (end === input.length) fail("hdr-truncated", `${label} is missing a line ending`);
  if (end - begin > 128 * 1024) fail("hdr-header", "header line is unreasonably large");
  state.offset = end + 1;
  return input
    .subarray(begin, end > begin && input[end - 1] === 13 ? end - 1 : end)
    .toString("ascii");
}

function resolution(value) {
  const match = /^([+-])([XY])\s+([1-9]\d*)\s+([+-])([XY])\s+([1-9]\d*)$/.exec(value);
  if (!match || match[2] === match[5]) fail("hdr-resolution", "expected two distinct signed axes");
  const firstLength = Number(match[3]);
  const secondLength = Number(match[6]);
  if (!Number.isSafeInteger(firstLength) || !Number.isSafeInteger(secondLength))
    fail("hdr-resolution", "dimensions are not safe integers");
  const decodedWidth = match[2] === "X" ? firstLength : secondLength;
  const decodedHeight = match[2] === "Y" ? firstLength : secondLength;
  if (
    decodedWidth <= 0 ||
    decodedHeight <= 0 ||
    decodedWidth > 0x7fffffff ||
    decodedHeight > 0x7fffffff ||
    !Number.isSafeInteger(decodedWidth * decodedHeight) ||
    decodedWidth * decodedHeight > maxPixels
  )
    fail("hdr-resolution", "dimensions exceed the decoder safety limit");
  return {
    width: decodedWidth,
    height: decodedHeight,
    firstAxis: { name: match[2], sign: match[1], length: firstLength },
    secondAxis: { name: match[5], sign: match[4], length: secondLength },
  };
}

function header(input) {
  const state = { offset: 0 };
  const signature = line(input, state, "signature");
  if (signature !== "#?RADIANCE" && signature !== "#?RGBE")
    fail("hdr-header", "missing Radiance RGBE signature");
  let format = null;
  while (true) {
    const value = line(input, state, "header");
    if (!value) break;
    const match = /^FORMAT=(.+)$/.exec(value);
    if (match) {
      if (format !== null) fail("hdr-header", "multiple FORMAT declarations");
      format = match[1];
    }
  }
  if (format !== "32-bit_rle_rgbe") fail("hdr-format", "expected FORMAT=32-bit_rle_rgbe");
  return { ...resolution(line(input, state, "resolution")), offset: state.offset };
}

function isNewRle(input, offset, length) {
  return (
    length >= 8 &&
    length <= 0x7fff &&
    offset + 4 <= input.length &&
    input[offset] === 2 &&
    input[offset + 1] === 2 &&
    (input[offset + 2] & 0x80) === 0 &&
    ((input[offset + 2] << 8) | input[offset + 3]) === length
  );
}

function newRle(input, offset, length) {
  if (!isNewRle(input, offset, length)) fail("hdr-rle", "invalid scanline marker");
  let cursor = offset + 4;
  const channels = Array.from({ length: 4 }, () => new Uint8Array(length));
  for (const channel of channels) {
    let position = 0;
    while (position < length) {
      if (cursor >= input.length) fail("hdr-truncated", "new RLE packet is truncated");
      const code = input[cursor++];
      if (code === 0) fail("hdr-rle", "new RLE packet has zero length");
      if (code > 128) {
        const count = code - 128;
        if (position + count > length) fail("hdr-rle", "new RLE run exceeds scanline");
        if (cursor >= input.length) fail("hdr-truncated", "new RLE run value is truncated");
        channel.fill(input[cursor++], position, position + count);
        position += count;
      } else {
        if (position + code > length) fail("hdr-rle", "new RLE literal exceeds scanline");
        if (cursor + code > input.length) fail("hdr-truncated", "new RLE literal is truncated");
        channel.set(input.subarray(cursor, cursor + code), position);
        cursor += code;
        position += code;
      }
    }
  }
  return { offset: cursor, channels };
}

function oldRle(input, offset, length) {
  const samples = new Uint8Array(length * 4);
  let cursor = offset;
  let position = 0;
  let previous = null;
  let shift = 0;
  while (position < length) {
    if (cursor + 4 > input.length) fail("hdr-truncated", "raw/old RLE payload is truncated");
    const sample = [input[cursor++], input[cursor++], input[cursor++], input[cursor++]];
    if (sample[0] === 1 && sample[1] === 1 && sample[2] === 1) {
      if (!previous) fail("hdr-rle", "old RLE repeat has no previous sample");
      if (shift > 24) fail("hdr-rle", "old RLE repeat shift overflows");
      const count = sample[3] * 2 ** shift;
      if (!Number.isSafeInteger(count) || count <= 0 || position + count > length)
        fail("hdr-rle", "old RLE repeat exceeds scanline");
      for (let index = 0; index < count; index += 1) samples.set(previous, (position + index) * 4);
      position += count;
      shift += 8;
    } else {
      previous = sample;
      samples.set(sample, position * 4);
      position += 1;
      shift = 0;
    }
  }
  return { offset: cursor, samples };
}

function axisCoordinate(axis, index) {
  if (axis.name === "Y") return axis.sign === "-" ? index : axis.length - 1 - index;
  return axis.sign === "+" ? index : axis.length - 1 - index;
}

function writePixel(output, parsed, scanline, pixel, red, green, blue, exponent) {
  const first = axisCoordinate(parsed.firstAxis, scanline);
  const second = axisCoordinate(parsed.secondAxis, pixel);
  const x = parsed.firstAxis.name === "X" ? first : second;
  const y = parsed.firstAxis.name === "Y" ? first : second;
  const target = (y * parsed.width + x) * 3;
  if (exponent === 0) return;
  const scale = 2 ** (exponent - 136);
  output[target] = red * scale;
  output[target + 1] = green * scale;
  output[target + 2] = blue * scale;
}

export function decodeRadianceRgbe(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array))
    fail("hdr-input", "expected Buffer or Uint8Array");
  const bytes = Buffer.from(input);
  const parsed = header(bytes);
  const linearRgb = new Float32Array(parsed.width * parsed.height * 3);
  let cursor = parsed.offset;
  for (let row = 0; row < parsed.firstAxis.length; row += 1) {
    if (isNewRle(bytes, cursor, parsed.secondAxis.length)) {
      const decoded = newRle(bytes, cursor, parsed.secondAxis.length);
      cursor = decoded.offset;
      for (let column = 0; column < parsed.secondAxis.length; column += 1)
        writePixel(
          linearRgb,
          parsed,
          row,
          column,
          decoded.channels[0][column],
          decoded.channels[1][column],
          decoded.channels[2][column],
          decoded.channels[3][column],
        );
    } else {
      const decoded = oldRle(bytes, cursor, parsed.secondAxis.length);
      cursor = decoded.offset;
      for (let column = 0; column < parsed.secondAxis.length; column += 1) {
        const index = column * 4;
        writePixel(
          linearRgb,
          parsed,
          row,
          column,
          decoded.samples[index],
          decoded.samples[index + 1],
          decoded.samples[index + 2],
          decoded.samples[index + 3],
        );
      }
    }
  }
  if (cursor !== bytes.length) fail("hdr-payload", "payload has trailing bytes");
  return Object.freeze({
    width: parsed.width,
    height: parsed.height,
    orientation: `${parsed.firstAxis.sign}${parsed.firstAxis.name} ${parsed.secondAxis.sign}${parsed.secondAxis.name}`,
    linearRgb,
  });
}

class Kahan {
  sum = 0;
  compensation = 0;

  add(value) {
    const adjusted = value - this.compensation;
    const next = this.sum + adjusted;
    this.compensation = next - this.sum - adjusted;
    this.sum = next;
  }
}

function polar(row, imageHeight) {
  const theta0 = (Math.PI * row) / imageHeight;
  const theta1 = (Math.PI * (row + 1)) / imageHeight;
  const sin0 = Math.sin(theta0);
  const sin1 = Math.sin(theta1);
  const cos0 = Math.cos(theta0);
  const cos1 = Math.cos(theta1);
  return {
    solid: cos0 - cos1,
    y: (sin1 * sin1 - sin0 * sin0) / 2,
    sin2: (theta1 - theta0) / 2 - (Math.sin(2 * theta1) - Math.sin(2 * theta0)) / 4,
    sin2Cos: (sin1 ** 3 - sin0 ** 3) / 3,
    l20: cos1 - cos1 ** 3 - (cos0 - cos0 ** 3),
    sin3: -cos1 + cos1 ** 3 / 3 - (-cos0 + cos0 ** 3 / 3),
  };
}

function azimuth(column, imageWidth) {
  const phi0 = 2 * Math.PI * (column / imageWidth - 0.5);
  const phi1 = 2 * Math.PI * ((column + 1) / imageWidth - 0.5);
  const sin0 = Math.sin(phi0);
  const sin1 = Math.sin(phi1);
  return {
    constant: phi1 - phi0,
    sin: Math.cos(phi0) - Math.cos(phi1),
    cos: sin1 - sin0,
    sinCos: (sin1 * sin1 - sin0 * sin0) / 2,
    cos2: (Math.sin(2 * phi1) - Math.sin(2 * phi0)) / 2,
  };
}

export function projectEquirectangularDiffuseSh9({ width, height, linearRgb }) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !linearRgb ||
    linearRgb.length !== width * height * 3
  )
    fail("sh-input", "RGB payload does not match positive dimensions");
  const sums = Array.from({ length: 9 }, () => [new Kahan(), new Kahan(), new Kahan()]);
  const solidAngle = new Kahan();
  const columns = Array.from({ length: width }, (_, column) => azimuth(column, width));
  const c0 = 0.28209479177387814;
  const c1 = 0.4886025119029199;
  const c2 = 1.0925484305920792;
  const c3 = 0.31539156525252005;
  const c4 = 0.5462742152960396;
  for (let row = 0; row < height; row += 1) {
    const p = polar(row, height);
    for (let column = 0; column < width; column += 1) {
      const a = columns[column];
      const basis = [
        c0 * p.solid * a.constant,
        c1 * p.y * a.constant,
        c1 * p.sin2 * a.sin,
        c1 * p.sin2 * a.cos,
        c2 * p.sin2Cos * a.cos,
        c2 * p.sin2Cos * a.sin,
        c3 * p.l20 * a.constant,
        c2 * p.sin3 * a.sinCos,
        c4 * p.sin3 * a.cos2,
      ];
      const source = (row * width + column) * 3;
      const rgb = [linearRgb[source], linearRgb[source + 1], linearRgb[source + 2]];
      if (!rgb.every(Number.isFinite)) fail("sh-input", "linear RGB contains a non-finite value");
      solidAngle.add(p.solid * a.constant);
      for (let coefficient = 0; coefficient < 9; coefficient += 1)
        for (let channel = 0; channel < 3; channel += 1)
          sums[coefficient][channel].add(rgb[channel] * basis[coefficient]);
    }
  }
  if (!Number.isFinite(solidAngle.sum) || solidAngle.sum <= 0)
    fail("sh-weight", "solid angle is invalid");
  const scale = fourPi / solidAngle.sum;
  const radiance = sums.map((channels, index) => ({
    ...order[index],
    rgb: channels.map((channel) => rounded(channel.sum * scale)),
  }));
  const coefficients = radiance.map((coefficient) =>
    Object.freeze({
      ...order[coefficient.index],
      rgb: Object.freeze(
        coefficient.rgb.map((channel) => rounded(channel * lambertianBandFactors[coefficient.l])),
      ),
    }),
  );
  return Object.freeze({
    basis: researchCourtyardHdriContract.shBasis,
    convolution: researchCourtyardHdriContract.convolution,
    coefficientOrder: order,
    normalization: Object.freeze({
      method: "analytic-equirectangular-texel-integrals",
      targetSolidAngle: rounded(fourPi),
      unnormalizedSolidAngle: rounded(solidAngle.sum),
      scale: rounded(scale),
      coefficientRoundingDigits: roundDigits,
      lambertianBandFactors: Object.freeze(lambertianBandFactors.map(rounded)),
    }),
    coefficients: Object.freeze(coefficients),
  });
}

function sharpVersion() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("sharp");
  return JSON.parse(readFileSync(path.resolve(path.dirname(entry), "../package.json"), "utf8"))
    .version;
}

function assertSharp() {
  const actual = sharpVersion();
  if (actual !== requiredSharpVersion)
    fail("sharp-version", `expected ${requiredSharpVersion}, received ${actual}`);
  return actual;
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

function aces(value) {
  value = Math.max(0, value);
  return clamp((value * (2.51 * value + 0.03)) / (value * (2.43 * value + 0.59) + 0.14));
}

function srgb(value) {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

async function preview(linearRgb, output) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 1)
    pixels[index] = Math.round(clamp(srgb(aces(linearRgb[index]))) * 255);
  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .webp({
      quality: researchCourtyardHdriContract.preview.quality,
      effort: researchCourtyardHdriContract.preview.effort,
      smartSubsample: researchCourtyardHdriContract.preview.smartSubsample,
    })
    .toFile(output);
}

function reviewedLock(value) {
  if (
    !value ||
    value.version !== 3 ||
    !["sources-reviewed", "integrated"].includes(value.policy?.stage) ||
    value.policy?.license !== "CC0" ||
    value.policy?.rawCache !== ".cache/rendering-sources" ||
    !value.review ||
    value.sourceSetSha256 !== calculateSourceSetSha256(value.sources)
  )
    fail("source-lock", "a reviewed v3 source lock is required");
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value))
    fail(label, "must be a lowercase SHA-256 digest");
  return value;
}

function hdriInput(sourceLock, recipe, cacheRoot) {
  const environment = recipe?.environment;
  if (
    !environment ||
    environment.width !== width ||
    environment.height !== height ||
    environment.colorSpace !== "linear" ||
    environment.diffuseShCoefficients !== 9 ||
    environment.publishEnvironmentResolution !== width ||
    environment.specularIbl !== false
  )
    fail("recipe", "environment must be 1K linear SH9 without specular IBL");
  const sources = sourceLock.sources.filter(
    (entry) => entry.id === environment.sourceId && entry.kind === "hdri",
  );
  if (sources.length !== 1) fail("source", "expected one HDRI source");
  const files = sources[0].files.filter(
    (entry) =>
      entry.role === "hdr" &&
      entry.status === "reviewed" &&
      entry.cachePath === environment.path &&
      entry.sha256 === environment.sha256,
  );
  if (
    files.length !== 1 ||
    !safePortable(files[0].relativePath) ||
    !safePortable(files[0].cachePath)
  )
    fail("source", "expected one reviewed HDR file");
  const descriptor = files[0];
  requireSha256(descriptor.sha256, "source");
  if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0)
    fail("source", "HDR descriptor byte length is invalid");
  try {
    assertExactSourceCachePath(
      sourceLock.policy.rawCache,
      sources[0].id,
      descriptor.relativePath,
      descriptor.cachePath,
      "HDR cache path",
    );
  } catch (error) {
    fail("source-path", error instanceof Error ? error.message : "invalid HDR cache path");
  }
  const prefix = `${sourceLock.policy.rawCache}/`;
  const file = path.resolve(cacheRoot, descriptor.cachePath.slice(prefix.length));
  noSymlinkSegments(cacheRoot, file, "HDR source");
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
    fail("source-file", "reviewed HDR is missing or unsafe");
  if (statSync(file).size !== descriptor.bytes) fail("source-bytes", "HDR byte length drifted");
  if (digest(file) !== descriptor.sha256) fail("source-hash", "HDR hash drifted");
  return {
    id: sources[0].id,
    path: file,
    cachePath: descriptor.cachePath,
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
  };
}

function candidateDirectory(buildRoot, outputDirectory, cacheRoot) {
  const build = existingDirectory(buildRoot, "buildRoot");
  const output = path.resolve(outputDirectory);
  if (output === build || !within(build, output) || existsSync(output))
    fail("output-path", "output must be a new child of buildRoot");
  noSymlinkSegments(build, output, "output");
  if (
    within(path.join(root, "public"), build) ||
    within(path.join(root, "public"), output) ||
    within(path.join(root, "dist"), build) ||
    within(path.join(root, "dist"), output)
  )
    fail("output-path", "candidate must never write public or dist");
  if (within(root, build) && !within(path.join(root, ".cache"), build))
    fail("output-path", "in-repository candidate must be under ignored .cache");
  if (within(cacheRoot, output) || within(output, cacheRoot))
    fail("output-path", "candidate must not overlap source cache");
  return { build, output };
}

function stagePath(stage, relative) {
  if (!safePortable(relative)) fail("output-path", "unsafe candidate path");
  const file = path.resolve(stage, relative);
  if (!within(stage, file)) fail("output-path", "candidate path escaped staging");
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function outputDescriptor(stage, file) {
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
    fail("output-file", "candidate artifact is missing");
  return Object.freeze({
    path: portable(path.relative(stage, file)),
    bytes: statSync(file).size,
    sha256: digest(file),
    width,
    height,
    colorSpace: "srgb",
  });
}

function artifactDigest(artifacts) {
  return createHash("sha256")
    .update(
      JSON.stringify([...artifacts].sort((left, right) => left.path.localeCompare(right.path))),
    )
    .digest("hex");
}

export async function preprocessResearchCourtyardHdri({
  sourceLock,
  sourceLockSha256,
  recipe,
  recipeSha256,
  cacheRoot,
  buildRoot,
  outputDir,
  generatePreview = true,
}) {
  if (typeof generatePreview !== "boolean") fail("preview", "generatePreview must be boolean");
  const lock = reviewedLock(sourceLock);
  requireSha256(sourceLockSha256, "sourceLockSha256");
  requireSha256(recipeSha256, "recipeSha256");
  const cache = existingDirectory(cacheRoot, "cacheRoot");
  const source = hdriInput(lock, recipe, cache);
  const decoded = decodeRadianceRgbe(readFileSync(source.path));
  if (decoded.width !== width || decoded.height !== height)
    fail(
      "hdr-dimensions",
      `expected ${width}x${height}, received ${decoded.width}x${decoded.height}`,
    );
  const diffuseSh = projectEquirectangularDiffuseSh9(decoded);
  const { build, output } = candidateDirectory(buildRoot, outputDir, cache);
  const stage = mkdtempSync(path.join(build, ".courtyard-hdri-"));
  let committed = false;
  try {
    const sharpVersion = generatePreview ? assertSharp() : null;
    let previewArtifact = null;
    if (generatePreview) {
      const file = stagePath(stage, "preview/courtyard-tonemapped-1k.webp");
      await preview(decoded.linearRgb, file);
      previewArtifact = outputDescriptor(stage, file);
    }
    const artifacts = previewArtifact ? [previewArtifact] : [];
    const manifest = {
      format: researchCourtyardHdriFormat,
      version: researchCourtyardHdriVersion,
      status: "candidate",
      publishable: false,
      sourceSetSha256: lock.sourceSetSha256,
      sourceLockSha256,
      recipeSha256,
      candidateArtifactsSha256: artifactDigest(artifacts),
      source: {
        id: source.id,
        cachePath: source.cachePath,
        bytes: source.bytes,
        sha256: source.sha256,
        encoding: "Radiance RGBE",
      },
      decoded: {
        width: decoded.width,
        height: decoded.height,
        orientation: decoded.orientation,
        colorSpace: "linear",
      },
      diffuseSh,
      specularIbl: false,
      runtimeHdr: false,
      preview: previewArtifact
        ? {
            ...previewArtifact,
            format: researchCourtyardHdriContract.preview.format,
            toneMap: researchCourtyardHdriContract.preview.toneMap,
            purpose: "tonemapped-review-preview-only",
            hdrRuntime: false,
          }
        : null,
      toolchain: { sharp: sharpVersion },
      currentLimit:
        "Diffuse irradiance SH9 and an optional tone-mapped sRGB review preview only. No HDR runtime environment, prefiltered specular IBL, PMREM, or specular substitute is published.",
    };
    writeFileSync(
      stagePath(stage, "hdri-candidate.manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    if (existsSync(output)) fail("output-exists", "output appeared during staging");
    renameSync(stage, output);
    committed = true;
    return Object.freeze({
      outputDir: output,
      manifestPath: path.join(output, "hdri-candidate.manifest.json"),
      manifest,
    });
  } catch (error) {
    if (!committed && existsSync(stage))
      try {
        rmSync(stage, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "HDRI preprocessing failed and staging cleanup also failed.",
          { cause: cleanupError },
        );
      }
    throw error;
  }
}

function json(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail("json", `${label}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

export async function buildReviewedResearchCourtyardHdriCandidate({
  root: repositoryRoot = root,
  candidateId = "candidate",
  generatePreview = true,
} = {}) {
  repositoryRoot = path.resolve(repositoryRoot);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(candidateId))
    fail("candidate-id", "must be a safe path segment");
  const sourceLockPath = path.join(repositoryRoot, "public/assets/rendering/sources.lock.json");
  const recipePath = path.join(repositoryRoot, "scripts/assets/research-courtyard.recipe.json");
  const cacheRoot = path.join(repositoryRoot, ".cache/rendering-sources");
  const buildRoot = path.join(repositoryRoot, ".cache/rendering-builds/research-courtyard-hdri");
  mkdirSync(buildRoot, { recursive: true });
  return preprocessResearchCourtyardHdri({
    sourceLock: json(sourceLockPath, "source lock"),
    sourceLockSha256: digest(sourceLockPath),
    recipe: json(recipePath, "recipe"),
    recipeSha256: digest(recipePath),
    cacheRoot,
    buildRoot,
    outputDir: path.join(buildRoot, candidateId),
    generatePreview,
  });
}

export function parseResearchCourtyardHdriArgs(argumentsList) {
  let candidateId = "candidate";
  let generatePreview = true;
  const seen = new Set();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--no-preview") {
      if (seen.has(argument)) fail("arguments", "duplicate --no-preview");
      seen.add(argument);
      generatePreview = false;
      continue;
    }
    if (argument === "--candidate-id") {
      if (seen.has(argument) || index + 1 >= argumentsList.length)
        fail("arguments", "duplicate or missing --candidate-id");
      seen.add(argument);
      candidateId = argumentsList[++index];
      continue;
    }
    fail("arguments", "usage: research-courtyard-hdri.mjs [--candidate-id ID] [--no-preview]");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(candidateId))
    fail("candidate-id", "must be a safe path segment");
  return Object.freeze({ candidateId, generatePreview });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildReviewedResearchCourtyardHdriCandidate(
      parseResearchCourtyardHdriArgs(process.argv.slice(2)),
    );
    console.log(
      JSON.stringify({
        outputDir: result.outputDir,
        manifestPath: result.manifestPath,
        candidateArtifactsSha256: result.manifest.candidateArtifactsSha256,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
