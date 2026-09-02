import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateSourceSetSha256,
  isSafePortableRelativePath,
  loadRenderingSourceLock,
  projectRoot,
  resolvePortablePathWithinRoot,
} from "./manifest.mjs";

export const researchCourtyardRecipeRelativePath = "scripts/assets/research-courtyard.recipe.json";
export const RESEARCH_COURTYARD_RECIPE_FORMAT = "graphics-portfolio-research-courtyard-recipe";
export const RESEARCH_COURTYARD_RECIPE_VERSION = 1;

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const EXPECTED_MESH_SOURCES = [
  "concrete-road-barrier",
  "fire-hydrant",
  "plastic-crate-02",
  "street-lamp-02",
  "modular-chainlink-fence",
  "concrete-cat-statue",
];
const EXPECTED_MATERIAL_SOURCES = [
  "concrete-floor-worn-001",
  "concrete-wall-007",
  "rusty-metal",
  "brick-floor-003",
];
const EXPECTED_BUDGETS = Object.freeze({
  publicRenderingBytes: 20 * 1024 * 1024,
  courtyardGeometryBytes: 3.5 * 1024 * 1024,
  ktx2Bytes: 5 * 1024 * 1024,
  webpFallbackBytes: 3 * 1024 * 1024,
  demoInitialBytes: 10 * 1024 * 1024,
  heroBytes: 2 * 1024 * 1024,
});
const EXPECTED_TOP_LEVEL_KEYS = [
  "architecture",
  "budgets",
  "camera",
  "coordinateSystem",
  "currentLimits",
  "determinism",
  "environment",
  "format",
  "instances",
  "materialSources",
  "meshSources",
  "publication",
  "sourceSetSha256",
  "version",
];

export class ResearchCourtyardRecipeError extends Error {
  constructor(readonlyPath, message) {
    super(readonlyPath + ": " + message);
    this.name = "ResearchCourtyardRecipeError";
    this.path = readonlyPath;
  }
}

function fail(pathname, message) {
  throw new ResearchCourtyardRecipeError(pathname, message);
}

function object(value, pathname) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(pathname, "must be an object");
  return value;
}

function array(value, pathname) {
  if (!Array.isArray(value)) fail(pathname, "must be an array");
  return value;
}

function text(value, pathname) {
  if (typeof value !== "string" || value.length === 0) fail(pathname, "must be a non-empty string");
  return value;
}

function finite(value, pathname) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(pathname, "must be finite");
  return value;
}

function tuple(value, length, pathname, positive = false) {
  const values = array(value, pathname);
  if (values.length !== length) fail(pathname, "must contain exactly " + length + " values");
  return values.map((entry, index) => {
    const result = finite(entry, pathname + "[" + index + "]");
    if (positive && result <= 0) fail(pathname + "[" + index + "]", "must be > 0");
    return result;
  });
}

function exactIds(values, expected, pathname, key) {
  const ids = values.map((value) => text(value?.[key], pathname + "." + key));
  if (
    ids.length !== expected.length ||
    new Set(ids).size !== ids.length ||
    expected.some((id) => !ids.includes(id))
  )
    fail(pathname, "must contain exactly " + expected.join(", "));
}

function strictKeys(value, expected, pathname) {
  const keys = Object.keys(object(value, pathname)).sort();
  const sorted = [...expected].sort();
  if (keys.length !== sorted.length || keys.some((key, index) => key !== sorted[index]))
    fail(pathname, "contains unknown or missing keys");
}

function sourceById(sourceLock, sourceId, kind) {
  const source = sourceLock.sources.find((entry) => entry.id === sourceId);
  if (!source || source.kind !== kind) fail("source:" + sourceId, "is not in the reviewed lock");
  return source;
}

function checkedSourceFile(root, source, descriptor, expectedRole, pathname, verifyFiles) {
  const record = object(descriptor, pathname);
  const relative = text(record.path, pathname + ".path");
  const sha256 = text(record.sha256, pathname + ".sha256");
  if (!isSafePortableRelativePath(relative) || !SHA.test(sha256))
    fail(pathname, "requires a safe path and lowercase SHA-256");
  const sourceFile = source.files.find(
    (file) =>
      file.role === expectedRole &&
      file.cachePath === relative &&
      file.sha256 === sha256 &&
      file.status === "reviewed",
  );
  if (!sourceFile) fail(pathname, "does not match the reviewed source-lock record");
  if (verifyFiles) {
    const file = resolvePortablePathWithinRoot(root, relative, pathname);
    if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
      fail(pathname, "reviewed source file is missing or unsafe");
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== sha256) fail(pathname, "reviewed source bytes changed");
  }
  return sourceFile;
}

function validateSourceLock(sourceLock) {
  if (
    sourceLock?.version !== 3 ||
    !["sources-reviewed", "integrated"].includes(sourceLock.policy?.stage) ||
    sourceLock.sourceSetSha256 !== calculateSourceSetSha256(sourceLock.sources) ||
    !sourceLock.review
  )
    fail("sourceLock", "requires a reviewed v3 source-set receipt");
}

function validateBudgets(recipe) {
  strictKeys(recipe.budgets, Object.keys(EXPECTED_BUDGETS), "budgets");
  for (const [key, expected] of Object.entries(EXPECTED_BUDGETS)) {
    const value = recipe.budgets[key];
    if (!Number.isSafeInteger(value) || value !== expected)
      fail("budgets." + key, "must equal " + expected);
  }
}

function validateMeshSources(root, recipe, sourceLock, verifyFiles) {
  const meshSources = array(recipe.meshSources, "meshSources");
  exactIds(meshSources, EXPECTED_MESH_SOURCES, "meshSources", "sourceId");
  const partsBySource = new Map();
  for (const [sourceIndex, mesh] of meshSources.entries()) {
    const pathname = "meshSources[" + sourceIndex + "]";
    const sourceId = text(mesh.sourceId, pathname + ".sourceId");
    const source = sourceById(sourceLock, sourceId, "mesh");
    checkedSourceFile(root, source, mesh.gltf, "gltf", pathname + ".gltf", verifyFiles);
    if (mesh.normalization !== "ground-center")
      fail(pathname + ".normalization", "must be ground-center");
    const parts = array(mesh.parts, pathname + ".parts");
    if (parts.length === 0) fail(pathname + ".parts", "must not be empty");
    const partIds = new Set();
    const nodeNames = new Set();
    for (const [partIndex, part] of parts.entries()) {
      const partPath = pathname + ".parts[" + partIndex + "]";
      const partId = text(part.partId, partPath + ".partId");
      if (!ID.test(partId) || partIds.has(partId))
        fail(partPath + ".partId", "must be safe and unique");
      partIds.add(partId);
      const nodes = array(part.nodeNames, partPath + ".nodeNames");
      if (nodes.length === 0 || nodes.some((node) => typeof node !== "string" || !node))
        fail(partPath + ".nodeNames", "must list selected node names");
      for (const nodeName of nodes) {
        if (nodeNames.has(nodeName)) fail(partPath + ".nodeNames", "must not reuse a node");
        nodeNames.add(nodeName);
      }
    }
    partsBySource.set(sourceId, partIds);
    if (verifyFiles) {
      const gltfPath = resolvePortablePathWithinRoot(root, mesh.gltf.path, pathname + ".gltf");
      const gltf = JSON.parse(readFileSync(gltfPath, "utf8"));
      const availableNodes = new Set(
        (gltf.nodes ?? []).map((node) => node?.name).filter((name) => typeof name === "string"),
      );
      for (const nodeName of nodeNames)
        if (!availableNodes.has(nodeName))
          fail(pathname + ".parts", "selected node is absent from reviewed glTF: " + nodeName);
    }
    const lod = object(mesh.lod, pathname + ".lod");
    const ratios = tuple(lod.ratios, 3, pathname + ".lod.ratios");
    const errors = tuple(lod.maxErrors, 3, pathname + ".lod.maxErrors");
    if (
      ratios[0] !== 1 ||
      !(ratios[0] > ratios[1] && ratios[1] > ratios[2] && ratios[2] > 0) ||
      errors[0] !== 0 ||
      !(errors[0] <= errors[1] && errors[1] <= errors[2]) ||
      lod.requireStrictDecrease !== true
    )
      fail(pathname + ".lod", "must define strict LOD0/1/2 ratios and monotonic errors");
    if (!Array.isArray(mesh.materialOverrides))
      fail(pathname + ".materialOverrides", "must be an array");
  }
  return partsBySource;
}

function validateMaterialSources(root, recipe, sourceLock, verifyFiles) {
  const materials = array(recipe.materialSources, "materialSources");
  exactIds(materials, EXPECTED_MATERIAL_SOURCES, "materialSources", "materialId");
  const materialIds = new Set();
  for (const [index, material] of materials.entries()) {
    const pathname = "materialSources[" + index + "]";
    const materialId = text(material.materialId, pathname + ".materialId");
    if (material.sourceId !== materialId) fail(pathname + ".sourceId", "must equal materialId");
    const source = sourceById(sourceLock, material.sourceId, "texture");
    const metallic = finite(material.metallicFactor, pathname + ".metallicFactor");
    if (metallic < 0 || metallic > 1) fail(pathname + ".metallicFactor", "must be in [0,1]");
    const maps = object(material.maps, pathname + ".maps");
    strictKeys(maps, ["baseColor", "normal", "roughness"], pathname + ".maps");
    for (const [role, expected] of Object.entries({
      baseColor: ["base-color", "srgb", "etc1s"],
      normal: ["normal", "linear", "uastc"],
      roughness: ["roughness", "linear", "etc1s"],
    })) {
      const map = object(maps[role], pathname + ".maps." + role);
      checkedSourceFile(root, source, map, expected[0], pathname + ".maps." + role, verifyFiles);
      if (map.colorSpace !== expected[1] || map.encoding !== expected[2])
        fail(pathname + ".maps." + role, "color space or KTX2 encoding mismatch");
      if (role === "normal" && map.normalConvention !== "opengl-positive-y")
        fail(pathname + ".maps.normal.normalConvention", "must preserve OpenGL +Y");
    }
    const orm = object(material.orm, pathname + ".orm");
    if (
      orm.occlusionConstant !== 1 ||
      orm.roughnessSource !== "roughness" ||
      orm.metallicSource !== "metallicFactor"
    )
      fail(pathname + ".orm", "must declare constant AO, roughness map, and recipe metallic");
    materialIds.add(materialId);
  }
  return materialIds;
}

function validateFenceAndNormalization(recipe) {
  const meshSources = recipe.meshSources;
  const fence = meshSources.find((source) => source.sourceId === "modular-chainlink-fence");
  const overrides = new Map(
    fence.materialOverrides.map((material) => [material.materialName, material]),
  );
  for (const name of ["modular_chainlink_fence_posts", "modular_chainlink_fence_wire"]) {
    const material = overrides.get(name);
    if (
      !material ||
      material.alphaMode !== "MASK" ||
      material.alphaCutoff !== 0.5 ||
      material.doubleSided !== true ||
      material.renderPass !== "alpha-mask-forward"
    )
      fail(
        "meshSources.modular-chainlink-fence",
        "all fence materials must be MASK/0.5/double-sided/forward",
      );
  }
  const posts = overrides.get("modular_chainlink_fence_posts");
  if (posts.alphaSource?.kind !== "constant" || posts.alphaSource?.value !== 1)
    fail("meshSources.modular-chainlink-fence.posts", "posts must use constant alpha one");
  const wire = overrides.get("modular_chainlink_fence_wire");
  if (
    wire.sourceAlphaMode !== "BLEND" ||
    wire.alphaSource?.kind !== "max-rgb" ||
    wire.alphaSource?.threshold !== 0.5 ||
    wire.alphaSource?.sourceRole !== "base-color" ||
    wire.textureTransform?.bakeIntoUv !== true
  )
    fail(
      "meshSources.modular-chainlink-fence.wire",
      "wire must derive deterministic max-RGB alpha and bake UV transform",
    );
  tuple(wire.textureTransform.offset, 2, "fence.textureTransform.offset");
  tuple(wire.textureTransform.scale, 2, "fence.textureTransform.scale", true);
  finite(wire.textureTransform.rotation, "fence.textureTransform.rotation");

  const crate = meshSources
    .find((source) => source.sourceId === "plastic-crate-02")
    .materialOverrides.find((material) => material.materialName === "plastic_crate_02");
  if (
    crate?.sourceAlphaMode !== "BLEND" ||
    crate.alphaMode !== "OPAQUE" ||
    crate.renderPass !== "deferred-opaque"
  )
    fail("meshSources.plastic-crate-02", "crate BLEND must be normalized to opaque");
  const glass = meshSources
    .find((source) => source.sourceId === "street-lamp-02")
    .materialOverrides.find((material) => material.materialName === "street_lamp_02_glass");
  if (glass?.sourceAlphaMode !== "BLEND" || glass.alphaMode !== "OPAQUE")
    fail("meshSources.street-lamp-02", "glass must remain an explicit opaque limitation");
}

function validateInstances(recipe, partsBySource) {
  const instances = array(recipe.instances, "instances");
  if (instances.length === 0) fail("instances", "must not be empty");
  const ids = new Set();
  const representedSources = new Set();
  let animatedCrates = 0;
  for (const [index, instance] of instances.entries()) {
    const pathname = "instances[" + index + "]";
    const instanceId = text(instance.instanceId, pathname + ".instanceId");
    if (!ID.test(instanceId) || ids.has(instanceId))
      fail(pathname + ".instanceId", "must be safe and unique");
    ids.add(instanceId);
    const sourceId = text(instance.sourceId, pathname + ".sourceId");
    const partId = text(instance.partId, pathname + ".partId");
    if (!partsBySource.get(sourceId)?.has(partId))
      fail(pathname, "references an unknown source part");
    representedSources.add(sourceId);
    tuple(instance.translation, 3, pathname + ".translation");
    tuple(instance.scale, 3, pathname + ".scale", true);
    finite(instance.rotationYDegrees, pathname + ".rotationYDegrees");
    if (instance.animation !== undefined) {
      const animation = object(instance.animation, pathname + ".animation");
      if (
        instanceId !== "crate-animated" ||
        sourceId !== "plastic-crate-02" ||
        animation.kind !== "spin-y" ||
        finite(animation.radiansPerSecond, pathname + ".animation.radiansPerSecond") === 0 ||
        !Number.isFinite(animation.phaseRadians) ||
        animation.writesPreviousTransform !== true
      )
        fail(
          pathname + ".animation",
          "only crate-animated may spin and must write previous transform",
        );
      animatedCrates += 1;
    }
  }
  if (EXPECTED_MESH_SOURCES.some((sourceId) => !representedSources.has(sourceId)))
    fail("instances", "must instantiate every reviewed mesh source");
  if (animatedCrates !== 1) fail("instances", "must contain exactly one animated crate");
}

export function assertResearchCourtyardRecipe(recipe, sourceLock, options = {}) {
  const root = path.resolve(options.root ?? projectRoot);
  const verifyFiles = options.verifyFiles !== false;
  validateSourceLock(sourceLock);
  strictKeys(recipe, EXPECTED_TOP_LEVEL_KEYS, "recipe");
  if (
    recipe.format !== RESEARCH_COURTYARD_RECIPE_FORMAT ||
    recipe.version !== RESEARCH_COURTYARD_RECIPE_VERSION ||
    recipe.sourceSetSha256 !== sourceLock.sourceSetSha256
  )
    fail("recipe", "format/version/sourceSetSha256 mismatch");
  const coordinates = object(recipe.coordinateSystem, "coordinateSystem");
  if (
    coordinates.handedness !== "right" ||
    coordinates.upAxis !== "Y" ||
    coordinates.units !== "meters"
  )
    fail("coordinateSystem", "must be right-handed Y-up meters");
  const determinism = object(recipe.determinism, "determinism");
  if (
    !Number.isSafeInteger(determinism.seed) ||
    determinism.floatRoundingDigits !== 7 ||
    determinism.cleanBuildsRequired !== 2 ||
    JSON.stringify(determinism.sortOrder) !==
      JSON.stringify(["sourceId", "partId", "primitiveIndex", "instanceId"])
  )
    fail("determinism", "fixed seed, rounding, two clean builds, and sort order are required");
  validateBudgets(recipe);
  const camera = object(recipe.camera, "camera");
  tuple(camera.position, 3, "camera.position");
  tuple(camera.target, 3, "camera.target");
  if (
    finite(camera.verticalFovDegrees, "camera.verticalFovDegrees") <= 0 ||
    finite(camera.near, "camera.near") <= 0 ||
    finite(camera.far, "camera.far") <= camera.near
  )
    fail("camera", "contains an invalid projection");
  const materialIds = validateMaterialSources(root, recipe, sourceLock, verifyFiles);
  const architecture = array(recipe.architecture, "architecture");
  if (architecture.length === 0) fail("architecture", "must not be empty");
  const architectureIds = new Set();
  for (const [index, module] of architecture.entries()) {
    const pathname = "architecture[" + index + "]";
    const id = text(module.id, pathname + ".id");
    if (!ID.test(id) || architectureIds.has(id)) fail(pathname + ".id", "must be safe and unique");
    architectureIds.add(id);
    if (module.primitive !== "box" || !materialIds.has(module.materialId))
      fail(pathname, "must be a box using a reviewed material");
    tuple(module.center, 3, pathname + ".center");
    tuple(module.size, 3, pathname + ".size", true);
    if (finite(module.uvMetersPerRepeat, pathname + ".uvMetersPerRepeat") <= 0)
      fail(pathname + ".uvMetersPerRepeat", "must be > 0");
  }
  const partsBySource = validateMeshSources(root, recipe, sourceLock, verifyFiles);
  validateFenceAndNormalization(recipe);
  validateInstances(recipe, partsBySource);
  const environment = object(recipe.environment, "environment");
  const hdri = sourceById(sourceLock, environment.sourceId, "hdri");
  checkedSourceFile(root, hdri, environment, "hdr", "environment", verifyFiles);
  if (
    environment.width !== 1024 ||
    environment.height !== 512 ||
    environment.colorSpace !== "linear" ||
    environment.diffuseShCoefficients !== 9 ||
    environment.publishEnvironmentResolution !== 1024 ||
    environment.specularIbl !== false
  )
    fail("environment", "must be 1K linear HDR, SH9, and no specular IBL claim");
  const publication = object(recipe.publication, "publication");
  if (
    publication.heroEligible !== false ||
    publication.requiresVisualReview !== true ||
    publication.requiresTwoCleanBuilds !== true ||
    publication.allowProceduralFallbackAfterReviewedManifestFailure !== false
  )
    fail("publication", "must preserve review, hero, and fail-closed boundaries");
  if (
    !Array.isArray(recipe.currentLimits) ||
    recipe.currentLimits.length < 3 ||
    recipe.currentLimits.some((entry) => typeof entry !== "string" || !entry.trim())
  )
    fail("currentLimits", "must record explicit non-empty limitations");
  return recipe;
}

export function validateResearchCourtyardRecipe(recipe, sourceLock, options = {}) {
  try {
    assertResearchCourtyardRecipe(recipe, sourceLock, options);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "Research Courtyard recipe validation failed"];
  }
}

export function loadResearchCourtyardRecipe(root = projectRoot, options = {}) {
  const file = resolvePortablePathWithinRoot(
    root,
    researchCourtyardRecipeRelativePath,
    "Research Courtyard recipe",
  );
  const recipe = JSON.parse(readFileSync(file, "utf8"));
  return assertResearchCourtyardRecipe(recipe, loadRenderingSourceLock(root), {
    root,
    verifyFiles: options.verifyFiles,
  });
}

export function researchCourtyardRecipeSha256(root = projectRoot) {
  const file = resolvePortablePathWithinRoot(
    root,
    researchCourtyardRecipeRelativePath,
    "Research Courtyard recipe",
  );
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((argument) => argument !== "--metadata-only"))
      throw new Error("Usage: research-courtyard-recipe.mjs [--metadata-only]");
    const metadataOnly = args.includes("--metadata-only");
    loadResearchCourtyardRecipe(projectRoot, {
      verifyFiles: !metadataOnly,
    });
    console.log(
      `Research Courtyard recipe passed reviewed source, layout, alpha, and budget validation${metadataOnly ? " (metadata-only)." : "."}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
