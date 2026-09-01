/* eslint-disable @typescript-eslint/consistent-type-imports -- Three.js remains lazy-loaded with its renderer-specific entry points. */
import {
  clearElement,
  createMetricReporter,
  drawStageBackdrop,
  makeButton,
  makeRange,
} from "./core/canvas";
import { OneAttemptDeviceRecoveryGate } from "./core/runtime";
import type { DemoContext, DemoController } from "./core/types";
import { CanvasFallbackSurface } from "./reference-frame/fallback-surface";
import type { BufferGeometry, Material, Object3D } from "three";

type DebugView = "final" | "normal" | "roughness" | "metalness" | "direct" | "indirect";
type ToneMappingMode = "aces" | "agx" | "linear";
type Vec3 = [number, number, number];
export type MaterialPresetId = "dielectric" | "metal" | "rough" | "clearcoat";

export interface MaterialPreset {
  baseColor: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

export interface CalibrationRigContract {
  format: "graphics-portfolio-scene-contract";
  version: 1;
  assetId: "calibration-rig";
  geometry: string[];
  materials: string[];
  debugAttachments: string[];
  externalAssets: false;
}

export const MATERIAL_PRESETS: Readonly<Record<MaterialPresetId, MaterialPreset>> = {
  dielectric: {
    baseColor: "#d8e1df",
    metalness: 0,
    roughness: 0.22,
    clearcoat: 0.1,
    clearcoatRoughness: 0.18,
  },
  metal: {
    baseColor: "#b98248",
    metalness: 1,
    roughness: 0.2,
    clearcoat: 0,
    clearcoatRoughness: 0.2,
  },
  rough: {
    baseColor: "#707a72",
    metalness: 0.05,
    roughness: 0.82,
    clearcoat: 0,
    clearcoatRoughness: 0.7,
  },
  clearcoat: {
    baseColor: "#2bd8b7",
    metalness: 0.25,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  },
};

const INITIAL_MATERIAL_PRESET: MaterialPresetId = "clearcoat";

const DEBUG_VIEWS: DebugView[] = [
  "final",
  "normal",
  "roughness",
  "metalness",
  "direct",
  "indirect",
];

const TONE_MAPPING_LABELS: Record<ToneMappingMode, string> = {
  aces: "ACES",
  agx: "AgX",
  linear: "LINEAR",
};

const DEBUG_VIEW_LABELS: Record<DebugView, string> = {
  final: "FINAL",
  normal: "NORMAL",
  roughness: "ROUGHNESS",
  metalness: "METALNESS",
  direct: "DIRECT ISOLATION",
  indirect: "IBL ISOLATION",
};

export function materialPreset(id: MaterialPresetId): MaterialPreset {
  return { ...MATERIAL_PRESETS[id] };
}

export function isCalibrationRigContract(value: unknown): value is CalibrationRigContract {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<CalibrationRigContract>;
  return (
    candidate.format === "graphics-portfolio-scene-contract" &&
    candidate.version === 1 &&
    candidate.assetId === "calibration-rig" &&
    candidate.externalAssets === false &&
    Array.isArray(candidate.geometry) &&
    candidate.geometry.length >= 6 &&
    Array.isArray(candidate.materials) &&
    Array.isArray(candidate.debugAttachments)
  );
}

async function loadCalibrationRigContract(signal: AbortSignal): Promise<CalibrationRigContract> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const response = await fetch(`${base}/assets/rendering/contracts/calibration-rig.contract.json`, {
    signal,
  });
  if (!response.ok) throw new Error(`Calibration Rig contract HTTP ${response.status}`);
  const contract: unknown = await response.json();
  if (!isCalibrationRigContract(contract))
    throw new Error("Calibration Rig contract failed runtime validation.");
  return contract;
}

/**
 * r185's multi-backend renderer initializes WebGPU first and falls back to WebGL2 internally.
 * The same TSL node-material graph stays active on both paths.
 */
export function createDemo(): DemoController {
  let active: DemoController | undefined;
  let context: DemoContext | undefined;
  let generation = 0;
  let fallbackTransition = false;
  let rebuilding = false;
  const deviceRecovery = new OneAttemptDeviceRecoveryGate();
  let rigContract: CalibrationRigContract | undefined;

  const useCanvasFallback = async (reason: string, expectedGeneration: number) => {
    if (!context || fallbackTransition || expectedGeneration !== generation) return false;
    fallbackTransition = true;
    const previous = active;
    active = undefined;
    try {
      await previous?.dispose();
      const fallback = createCanvasFallback(rigContract);
      await fallback.init(context);
      if (expectedGeneration !== generation) {
        await fallback.dispose();
        return false;
      }
      active = fallback;
      context.setRuntimeState?.("fallback");
      context.setStatus(`${reason} Canvas material approximation is active.`, "warning");
      return true;
    } catch (error) {
      context.setStatus(
        `${reason} ${error instanceof Error ? error.message : "Canvas fallback unavailable."}`,
        "error",
      );
      return false;
    } finally {
      fallbackTransition = false;
    }
  };

  const setupThree = async (recoveryReason?: string): Promise<boolean> => {
    if (!context || rebuilding) return false;
    rebuilding = true;
    const currentGeneration = ++generation;
    const previous = active;
    active = undefined;
    await previous?.dispose();
    let renderer: DemoController | undefined;
    try {
      rigContract ??= await loadCalibrationRigContract(context.signal);
      renderer = createThreeMaterialDemo((reason) => {
        if (generation !== currentGeneration) return;
        if (deviceRecovery.takeAttempt()) {
          context?.setStatus(`${reason} Reinitializing the Three.js renderer once…`, "warning");
          void setupThree(reason).finally(() => deviceRecovery.finishAttempt());
          return;
        }
        const fallbackGeneration = ++generation;
        void useCanvasFallback(reason, fallbackGeneration);
      }, rigContract);
      await renderer.init(context);
      if (currentGeneration !== generation) {
        await renderer.dispose();
        return false;
      }
      active = renderer;
      context.setRuntimeState?.("running");
      if (recoveryReason)
        context.setStatus(
          "Three.js renderer reinitialized after device/context loss; scene state restarted.",
          "success",
        );
      return true;
    } catch (error) {
      await renderer?.dispose();
      const reason = error instanceof Error ? error.message : "Three.js renderer is unavailable.";
      if (!(await useCanvasFallback(reason, currentGeneration))) throw error;
      return false;
    } finally {
      rebuilding = false;
    }
  };

  return {
    async init(next) {
      context = next;
      await setupThree();
    },
    resize(width, height) {
      try {
        active?.resize(width, height);
      } catch (error) {
        const fallbackGeneration = ++generation;
        void useCanvasFallback(
          error instanceof Error ? error.message : "Material renderer resize failed.",
          fallbackGeneration,
        );
      }
    },
    pause() {
      active?.pause();
    },
    resume() {
      active?.resume();
    },
    dispose() {
      generation += 1;
      const previous = active;
      active = undefined;
      return previous?.dispose();
    },
  };
}

function createThreeMaterialDemo(
  onDeviceLost: (message: string) => void,
  rigContract: CalibrationRigContract,
): DemoController {
  let context: DemoContext;
  let three: typeof import("three/webgpu");
  let tsl: typeof import("three/tsl");
  let renderer: import("three/webgpu").WebGPURenderer | undefined;
  let scene: import("three/webgpu").Scene | undefined;
  let camera: import("three/webgpu").PerspectiveCamera | undefined;
  let controls:
    | {
        update(): void;
        dispose(): void;
        enableDamping: boolean;
        minDistance: number;
        maxDistance: number;
        target: import("three/webgpu").Vector3;
      }
    | undefined;
  let sphere: import("three/webgpu").Mesh | undefined;
  let calibrationMeshes: import("three/webgpu").Mesh[] = [];
  let material: import("three/webgpu").MeshPhysicalNodeMaterial | undefined;
  let normalMaterial: import("three/webgpu").MeshBasicNodeMaterial | undefined;
  let roughnessMaterial: import("three/webgpu").MeshBasicNodeMaterial | undefined;
  let metalnessMaterial: import("three/webgpu").MeshBasicNodeMaterial | undefined;
  let environmentTarget: import("three/webgpu").RenderTarget | undefined;
  let pmrem: import("three/webgpu").PMREMGenerator | undefined;
  let environmentTexture: import("three/webgpu").Texture | null = null;
  let raf = 0;
  let running = false;
  let width = 1;
  let height = 1;
  let activePreset: MaterialPresetId | "custom" = INITIAL_MATERIAL_PRESET;
  let baseColor = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].baseColor;
  let roughness = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].roughness;
  let metalness = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].metalness;
  let clearcoat = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].clearcoat;
  let clearcoatRoughness = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].clearcoatRoughness;
  let exposure = 1.1;
  let toneMapping: ToneMappingMode = "aces";
  let debug: DebugView = "final";
  let roughnessNode: import("three/webgpu").UniformNode<"float", number> | undefined;
  let metalnessNode: import("three/webgpu").UniformNode<"float", number> | undefined;
  let directLights: Array<import("three/webgpu").Object3D & { visible: boolean }> = [];
  let report: ReturnType<typeof createMetricReporter> | undefined;

  const backendLabel = () => {
    const backend = renderer?.backend as
      { isWebGPUBackend?: boolean; isWebGLBackend?: boolean } | undefined;
    if (backend?.isWebGPUBackend) return "Three.js WebGPURenderer / WebGPU";
    if (backend?.isWebGLBackend) return "Three.js WebGPURenderer / WebGL2 fallback";
    return "Three.js WebGPURenderer";
  };

  const updateMetrics = () => {
    report?.({
      backend: backendLabel(),
      status: `PBR / ${activePreset.toUpperCase()} / ${DEBUG_VIEW_LABELS[debug]}`,
    });
  };

  const applyToneMapping = () => {
    if (!renderer || !three) return;
    renderer.toneMapping =
      toneMapping === "agx"
        ? three.AgXToneMapping
        : toneMapping === "linear"
          ? three.LinearToneMapping
          : three.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;
  };

  const applyDebugView = () => {
    if (
      !scene ||
      !sphere ||
      !material ||
      !normalMaterial ||
      !roughnessMaterial ||
      !metalnessMaterial
    )
      return;

    const activeMaterial =
      debug === "normal"
        ? normalMaterial
        : debug === "roughness"
          ? roughnessMaterial
          : debug === "metalness"
            ? metalnessMaterial
            : material;
    calibrationMeshes.forEach((mesh) => {
      mesh.material = activeMaterial;
    });
    scene.environment = debug === "direct" ? null : environmentTexture;
    directLights.forEach((light) => {
      light.visible = debug !== "indirect";
    });
    updateMetrics();
  };

  const render = (time: number) => {
    if (!running || !renderer || !scene || !camera) return;
    const orbitLight = directLights[0] as import("three/webgpu").DirectionalLight | undefined;
    if (orbitLight?.position) {
      orbitLight.position.set(
        Math.cos(time * 0.00042) * 3.1,
        3.4,
        Math.sin(time * 0.00042) * 2.6 + 2.4,
      );
    }
    controls?.update();
    renderer.render(scene, camera);
    updateMetrics();
    raf = requestAnimationFrame(render);
  };

  const configureControls = () => {
    if (!material || !renderer) return;
    clearElement(context.controls);
    const presetControl = document.createElement("div");
    presetControl.className = "demo-range";
    presetControl.setAttribute("aria-label", "Material Preset");
    const presetLabel = document.createElement("span");
    presetLabel.textContent = "Material Preset";
    const presetIds = Object.keys(MATERIAL_PRESETS) as MaterialPresetId[];
    const presetButtons = presetIds.map((id) => makeButton(id.toUpperCase(), id === activePreset));
    presetControl.append(presetLabel, ...presetButtons);
    const baseColorControl = makeColorControl("Base Color", baseColor);
    const metalnessControl = makeRange("Metalness", metalness, 0, 1, 0.01);
    const roughnessControl = makeRange("Roughness", roughness, 0.05, 0.95, 0.01);
    const clearcoatControl = makeRange("Clearcoat", clearcoat, 0, 1, 0.01);
    const clearcoatRoughnessControl = makeRange(
      "Clearcoat Roughness",
      clearcoatRoughness,
      0.02,
      0.9,
      0.01,
    );
    const exposureControl = makeRange("Exposure", exposure, 0.5, 1.8, 0.05);
    const toneMappingControl = document.createElement("div");
    toneMappingControl.className = "demo-range";
    toneMappingControl.setAttribute("aria-label", "Tone Mapping");
    const toneMappingLabel = document.createElement("span");
    toneMappingLabel.textContent = "Tone Mapping";
    const toneButtons = (Object.keys(TONE_MAPPING_LABELS) as ToneMappingMode[]).map((mode) =>
      makeButton(TONE_MAPPING_LABELS[mode], mode === toneMapping),
    );
    toneMappingControl.append(toneMappingLabel, ...toneButtons);
    const viewButtons = DEBUG_VIEWS.map((view) =>
      makeButton(DEBUG_VIEW_LABELS[view], view === debug),
    );
    context.controls.append(
      presetControl,
      baseColorControl.wrapper,
      metalnessControl.parentElement!,
      roughnessControl.parentElement!,
      clearcoatControl.parentElement!,
      clearcoatRoughnessControl.parentElement!,
      exposureControl.parentElement!,
      toneMappingControl,
      ...viewButtons,
    );

    const markCustom = () => {
      activePreset = "custom";
      presetButtons.forEach((entry) => entry.setAttribute("aria-pressed", "false"));
      updateMetrics();
    };
    const syncMaterial = () => {
      material!.color.set(baseColor);
      material!.metalness = metalness;
      material!.roughness = roughness;
      material!.clearcoat = clearcoat;
      material!.clearcoatRoughness = clearcoatRoughness;
      if (metalnessNode) metalnessNode.value = metalness;
      if (roughnessNode) roughnessNode.value = roughness;
    };
    const applyPreset = (id: MaterialPresetId) => {
      const preset = materialPreset(id);
      activePreset = id;
      baseColor = preset.baseColor;
      metalness = preset.metalness;
      roughness = preset.roughness;
      clearcoat = preset.clearcoat;
      clearcoatRoughness = preset.clearcoatRoughness;
      baseColorControl.input.value = baseColor;
      metalnessControl.value = String(metalness);
      roughnessControl.value = String(roughness);
      clearcoatControl.value = String(clearcoat);
      clearcoatRoughnessControl.value = String(clearcoatRoughness);
      presetButtons.forEach((entry, index) =>
        entry.setAttribute("aria-pressed", String(presetIds[index] === id)),
      );
      syncMaterial();
      applyDebugView();
      context.setStatus(
        `${id.toUpperCase()} preset applied: M ${metalness.toFixed(2)} / R ${roughness.toFixed(2)} / C ${clearcoat.toFixed(2)}.`,
        "success",
      );
    };
    presetButtons.forEach((button, index) =>
      button.addEventListener("click", () => applyPreset(presetIds[index]!), {
        signal: context.signal,
      }),
    );

    baseColorControl.input.addEventListener(
      "input",
      () => {
        baseColor = baseColorControl.input.value;
        syncMaterial();
        markCustom();
      },
      { signal: context.signal },
    );
    metalnessControl.addEventListener(
      "input",
      () => {
        metalness = Number(metalnessControl.value);
        syncMaterial();
        markCustom();
      },
      { signal: context.signal },
    );
    roughnessControl.addEventListener(
      "input",
      () => {
        roughness = Number(roughnessControl.value);
        syncMaterial();
        markCustom();
      },
      { signal: context.signal },
    );
    clearcoatControl.addEventListener(
      "input",
      () => {
        clearcoat = Number(clearcoatControl.value);
        syncMaterial();
        markCustom();
      },
      { signal: context.signal },
    );
    clearcoatRoughnessControl.addEventListener(
      "input",
      () => {
        clearcoatRoughness = Number(clearcoatRoughnessControl.value);
        syncMaterial();
        markCustom();
      },
      { signal: context.signal },
    );
    exposureControl.addEventListener(
      "input",
      () => {
        exposure = Number(exposureControl.value);
        applyToneMapping();
      },
      { signal: context.signal },
    );
    toneButtons.forEach((button, index) =>
      button.addEventListener(
        "click",
        () => {
          toneMapping = (Object.keys(TONE_MAPPING_LABELS) as ToneMappingMode[])[index]!;
          toneButtons.forEach((entry) =>
            entry.setAttribute("aria-pressed", String(entry === button)),
          );
          applyToneMapping();
        },
        { signal: context.signal },
      ),
    );
    viewButtons.forEach((button, index) =>
      button.addEventListener(
        "click",
        () => {
          debug = DEBUG_VIEWS[index]!;
          viewButtons.forEach((entry) =>
            entry.setAttribute("aria-pressed", String(entry === button)),
          );
          applyDebugView();
          context.setStatus(
            debug === "direct"
              ? "Direct isolation: PMREM environment contribution is disabled."
              : debug === "indirect"
                ? "IBL isolation: direct lights are disabled; PMREM remains active."
                : `TSL debug view: ${DEBUG_VIEW_LABELS[debug]}.`,
            "success",
          );
        },
        { signal: context.signal },
      ),
    );
  };

  return {
    async init(next) {
      context = next;
      [three, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
      const [{ OrbitControls }, { RoomEnvironment }, { RoundedBoxGeometry }] = await Promise.all([
        import("three/addons/controls/OrbitControls.js"),
        import("three/addons/environments/RoomEnvironment.js"),
        import("three/addons/geometries/RoundedBoxGeometry.js"),
      ]);

      renderer = new three.WebGPURenderer({
        canvas: context.canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      await renderer.init();
      const backend = renderer.backend as { device?: GPUDevice } | undefined;
      if (backend?.device && context.onDeviceLost) {
        context.onDeviceLost(backend.device, (reason) => {
          const detail = reason as { reason?: string; message?: string } | undefined;
          onDeviceLost(
            `Three.js WebGPU device lost (${detail?.reason ?? "unknown"}): ${detail?.message || "recovery required"}`,
          );
        });
      }
      context.canvas.addEventListener(
        "webglcontextlost",
        (event) => {
          event.preventDefault();
          onDeviceLost("Three.js WebGL context lost; recovery required.");
        },
        { signal: context.signal },
      );
      renderer.setClearColor(0x071011, 1);
      renderer.outputColorSpace = three.SRGBColorSpace;
      applyToneMapping();

      scene = new three.Scene();
      camera = new three.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(4.7, 2.5, 6.4);
      controls = new OrbitControls(camera, context.canvas);
      controls.enableDamping = true;
      controls.minDistance = 2.9;
      controls.maxDistance = 7.4;
      controls.target.set(0, 0.15, 0);

      pmrem = new three.PMREMGenerator(renderer);
      const roomEnvironment = new RoomEnvironment();
      environmentTarget = pmrem.fromScene(roomEnvironment, 0.035);
      roomEnvironment.dispose();
      environmentTexture = environmentTarget.texture;
      scene.environment = environmentTexture;

      material = new three.MeshPhysicalNodeMaterial({
        color: baseColor,
        metalness,
        roughness,
        clearcoat,
        clearcoatRoughness,
      });
      normalMaterial = new three.MeshBasicNodeMaterial();
      normalMaterial.colorNode = tsl.normalView.normalize().mul(0.5).add(0.5);
      roughnessNode = tsl.uniform(roughness);
      roughnessMaterial = new three.MeshBasicNodeMaterial();
      roughnessMaterial.colorNode = tsl.vec3(roughnessNode);
      metalnessNode = tsl.uniform(metalness);
      metalnessMaterial = new three.MeshBasicNodeMaterial();
      metalnessMaterial.colorNode = tsl.vec3(metalnessNode);

      const geometry = new three.SphereGeometry(
        1.2,
        context.quality === "low" ? 32 : 64,
        context.quality === "low" ? 20 : 48,
      );
      sphere = new three.Mesh(geometry, material);
      scene.add(sphere);
      calibrationMeshes = [sphere];

      const addRigMesh = (
        id: string,
        geometry: BufferGeometry,
        position: [number, number, number],
        rotation: [number, number, number] = [0, 0, 0],
      ) => {
        if (!rigContract.geometry.includes(id)) {
          geometry.dispose();
          return;
        }
        const mesh = new three.Mesh(geometry, material);
        mesh.position.set(...position);
        mesh.rotation.set(...rotation);
        calibrationMeshes.push(mesh);
        scene!.add(mesh);
      };
      addRigMesh(
        "beveled-cube",
        new RoundedBoxGeometry(1.05, 1.05, 1.05, 5, 0.12),
        [-2.05, -0.56, -0.2],
        [0.12, 0.42, 0],
      );
      addRigMesh(
        "metal-ring",
        new three.TorusGeometry(0.55, 0.16, 24, 64),
        [2.05, -0.48, -0.05],
        [1.16, 0.16, 0.24],
      );
      addRigMesh(
        "thin-sheet",
        new three.PlaneGeometry(1.2, 1.2, 8, 8),
        [-2.0, 0.9, -0.55],
        [0.06, 0.58, 0],
      );
      addRigMesh(
        "normal-groove",
        new three.TorusKnotGeometry(0.42, 0.085, 96, 12, 2, 3),
        [2.0, 0.88, -0.55],
        [0.2, 0.4, 0],
      );

      const floorMaterial = new three.MeshStandardNodeMaterial({
        color: 0x132321,
        metalness: 0.15,
        roughness: 0.78,
      });
      const floor = new three.Mesh(new three.CircleGeometry(3.6, 64), floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.24;
      scene.add(floor);
      const grid = new three.GridHelper(7, 18, 0x2f6860, 0x183833);
      grid.position.y = -1.23;
      scene.add(grid);

      const keyLight = new three.DirectionalLight(0xffefc4, 4.2);
      keyLight.position.set(3.1, 3.4, 2.4);
      const fillLight = new three.HemisphereLight(0xa6d8d4, 0x182420, 1.25);
      const rimLight = new three.PointLight(0x57e3c2, 20, 7, 2);
      rimLight.position.set(-2.2, 1.5, -1.8);
      directLights = [keyLight, fillLight, rimLight];
      scene.add(...directLights);

      report = createMetricReporter(context);
      configureControls();
      applyDebugView();
      context.setStatus(
        `${backendLabel()} loaded the audited ${rigContract.assetId} contract (${calibrationMeshes.length + 1} rendered elements including the roughness plane) with a procedural PMREM room.`,
        "success",
      );
      updateMetrics();
    },
    resize(nextWidth, nextHeight) {
      if (!renderer || !camera) return;
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    pause() {
      running = false;
      cancelAnimationFrame(raf);
    },
    resume() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(render);
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      controls?.dispose();
      if (scene && three) {
        const geometries = new Set<BufferGeometry>();
        const materials = new Set<Material>();
        scene.traverse((object) => {
          const renderable = object as Object3D & {
            geometry?: BufferGeometry;
            material?: Material | Material[];
          };
          if (renderable.geometry) geometries.add(renderable.geometry);
          if (renderable.material) {
            const entries = Array.isArray(renderable.material)
              ? renderable.material
              : [renderable.material];
            entries.forEach((entry) => materials.add(entry));
          }
        });
        [normalMaterial, roughnessMaterial, metalnessMaterial, material].forEach((entry) => {
          if (entry) materials.add(entry);
        });
        geometries.forEach((entry) => entry.dispose());
        materials.forEach((entry) => entry.dispose());
      }
      environmentTarget?.dispose();
      pmrem?.dispose();
      renderer?.dispose();
    },
  };
}

function createCanvasFallback(rigContract?: CalibrationRigContract): DemoController {
  let context: DemoContext;
  let surface: CanvasFallbackSurface | undefined;
  let ctx: CanvasRenderingContext2D;
  let width = 1;
  let height = 1;
  let raf = 0;
  let running = false;
  let activePreset: MaterialPresetId | "custom" = INITIAL_MATERIAL_PRESET;
  let baseColor = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].baseColor;
  let roughness = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].roughness;
  let metalness = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].metalness;
  let clearcoat = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].clearcoat;
  let clearcoatRoughness = MATERIAL_PRESETS[INITIAL_MATERIAL_PRESET].clearcoatRoughness;
  let exposure = 1.1;
  let toneMapping: ToneMappingMode = "aces";
  let debug: DebugView = "final";
  let report: ReturnType<typeof createMetricReporter>;

  const render = (time: number) => {
    if (!running) return;
    drawStageBackdrop(ctx, width, height);
    const centerX = width * 0.52;
    const centerY = height * 0.49;
    const radius = Math.min(width, height) * 0.29;
    const lightX = centerX + Math.cos(time * 0.00045) * radius * 1.35;
    const lightY = centerY - radius * 0.82;
    const image = ctx.createImageData(
      Math.max(1, Math.floor(radius * 2)),
      Math.max(1, Math.floor(radius * 2)),
    );
    const size = image.width;
    const light = normalize([(lightX - centerX) / radius, (lightY - centerY) / radius, 1.4]);
    const view: Vec3 = [0, 0, 1];
    const color = hexToRgb(baseColor);
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        const nx = (x / (size - 1)) * 2 - 1;
        const ny = (y / (size - 1)) * 2 - 1;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const normal: Vec3 = [nx, -ny, Math.sqrt(1 - d2)];
        const ndotl = Math.max(0, dot(normal, light));
        const half = normalize([light[0] + view[0], light[1] + view[1], light[2] + view[2]]);
        const specular = Math.pow(Math.max(0, dot(normal, half)), 5 + (1 - roughness) * 120);
        const clearcoatSpecular =
          Math.pow(Math.max(0, dot(normal, half)), 8 + (1 - clearcoatRoughness) * 180) *
          clearcoat *
          0.38;
        const indirect = 0.16 + 0.24 * Math.max(0, normal[1]);
        const direct = ndotl * 1.2 + specular + clearcoatSpecular;
        const index = (y * size + x) * 4;
        const shaded = [
          color[0] * (indirect + ndotl * 1.2) * (1 - metalness * 0.45) +
            specular +
            clearcoatSpecular,
          color[1] * (indirect + ndotl * 1.2) * (1 - metalness * 0.45) +
            specular +
            clearcoatSpecular,
          color[2] * (indirect + ndotl * 1.2) * (1 - metalness * 0.45) +
            specular +
            clearcoatSpecular,
        ] as Vec3;
        const debugColor: Vec3 =
          debug === "normal"
            ? [(normal[0] + 1) * 0.5, (normal[1] + 1) * 0.5, (normal[2] + 1) * 0.5]
            : debug === "roughness"
              ? [roughness, roughness, roughness]
              : debug === "metalness"
                ? [metalness, metalness, metalness]
                : debug === "direct"
                  ? [
                      color[0] * direct * (1 - metalness * 0.45),
                      color[1] * direct * (1 - metalness * 0.45),
                      color[2] * direct * (1 - metalness * 0.45),
                    ]
                  : debug === "indirect"
                    ? [color[0] * indirect, color[1] * indirect, color[2] * indirect]
                    : shaded;
        image.data[index] = Math.round(255 * canvasToneMap(debugColor[0] * exposure, toneMapping));
        image.data[index + 1] = Math.round(
          255 * canvasToneMap(debugColor[1] * exposure, toneMapping),
        );
        image.data[index + 2] = Math.round(
          255 * canvasToneMap(debugColor[2] * exposure, toneMapping),
        );
        image.data[index + 3] = 255;
      }
    ctx.putImageData(image, centerX - size / 2, centerY - size / 2);
    ctx.fillStyle = "#e8e6dc";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(
      `CANVAS PBR / ${activePreset.toUpperCase()} / ${DEBUG_VIEW_LABELS[debug]} / ${toneMapping.toUpperCase()}`,
      16,
      24,
    );
    report({
      backend: "Canvas fallback",
      status: `PBR approximation / ${rigContract?.geometry.length ?? 0} contract elements / ${activePreset.toUpperCase()} / ${DEBUG_VIEW_LABELS[debug]}`,
    });
    raf = requestAnimationFrame(render);
  };

  return {
    async init(next) {
      context = next;
      surface = new CanvasFallbackSurface(context, "Canvas material and lighting approximation");
      ctx = surface.resize(width, height);
      report = createMetricReporter(context);
      clearElement(context.controls);
      const presetControl = document.createElement("div");
      presetControl.className = "demo-range";
      presetControl.setAttribute("aria-label", "Material Preset");
      const presetLabel = document.createElement("span");
      presetLabel.textContent = "Material Preset";
      const presetIds = Object.keys(MATERIAL_PRESETS) as MaterialPresetId[];
      const presetButtons = presetIds.map((id) =>
        makeButton(id.toUpperCase(), id === activePreset),
      );
      presetControl.append(presetLabel, ...presetButtons);
      const baseColorControl = makeColorControl("Base Color", baseColor);
      const metalnessControl = makeRange("Metalness", metalness, 0, 1, 0.01);
      const roughnessControl = makeRange("Roughness", roughness, 0.05, 0.95, 0.01);
      const clearcoatControl = makeRange("Clearcoat", clearcoat, 0, 1, 0.01);
      const clearcoatRoughnessControl = makeRange(
        "Clearcoat Roughness",
        clearcoatRoughness,
        0.02,
        0.9,
        0.01,
      );
      const exposureControl = makeRange("Exposure", exposure, 0.5, 1.8, 0.05);
      const toneMappingControl = document.createElement("div");
      toneMappingControl.className = "demo-range";
      toneMappingControl.setAttribute("aria-label", "Tone Mapping approximation");
      const toneMappingLabel = document.createElement("span");
      toneMappingLabel.textContent = "Tone Mapping";
      const toneButtons = (Object.keys(TONE_MAPPING_LABELS) as ToneMappingMode[]).map((mode) =>
        makeButton(TONE_MAPPING_LABELS[mode], mode === toneMapping),
      );
      toneMappingControl.append(toneMappingLabel, ...toneButtons);
      const viewButtons = DEBUG_VIEWS.map((view) =>
        makeButton(DEBUG_VIEW_LABELS[view], view === debug),
      );
      context.controls.append(
        presetControl,
        baseColorControl.wrapper,
        metalnessControl.parentElement!,
        roughnessControl.parentElement!,
        clearcoatControl.parentElement!,
        clearcoatRoughnessControl.parentElement!,
        exposureControl.parentElement!,
        toneMappingControl,
        ...viewButtons,
      );
      const markCustom = () => {
        activePreset = "custom";
        presetButtons.forEach((entry) => entry.setAttribute("aria-pressed", "false"));
      };
      const applyPreset = (id: MaterialPresetId) => {
        const preset = materialPreset(id);
        activePreset = id;
        baseColor = preset.baseColor;
        metalness = preset.metalness;
        roughness = preset.roughness;
        clearcoat = preset.clearcoat;
        clearcoatRoughness = preset.clearcoatRoughness;
        baseColorControl.input.value = baseColor;
        metalnessControl.value = String(metalness);
        roughnessControl.value = String(roughness);
        clearcoatControl.value = String(clearcoat);
        clearcoatRoughnessControl.value = String(clearcoatRoughness);
        presetButtons.forEach((entry, index) =>
          entry.setAttribute("aria-pressed", String(presetIds[index] === id)),
        );
        context.setStatus(
          `Canvas ${id.toUpperCase()} preset approximation; not a Three.js buffer capture.`,
          "warning",
        );
      };
      presetButtons.forEach((button, index) =>
        button.addEventListener("click", () => applyPreset(presetIds[index]!), {
          signal: context.signal,
        }),
      );
      baseColorControl.input.addEventListener(
        "input",
        () => {
          baseColor = baseColorControl.input.value;
          markCustom();
        },
        { signal: context.signal },
      );
      metalnessControl.addEventListener(
        "input",
        () => {
          metalness = Number(metalnessControl.value);
          markCustom();
        },
        { signal: context.signal },
      );
      roughnessControl.addEventListener(
        "input",
        () => {
          roughness = Number(roughnessControl.value);
          markCustom();
        },
        { signal: context.signal },
      );
      clearcoatControl.addEventListener(
        "input",
        () => {
          clearcoat = Number(clearcoatControl.value);
          markCustom();
        },
        { signal: context.signal },
      );
      clearcoatRoughnessControl.addEventListener(
        "input",
        () => {
          clearcoatRoughness = Number(clearcoatRoughnessControl.value);
          markCustom();
        },
        { signal: context.signal },
      );
      exposureControl.addEventListener(
        "input",
        () => {
          exposure = Number(exposureControl.value);
        },
        { signal: context.signal },
      );
      toneButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          () => {
            toneMapping = (Object.keys(TONE_MAPPING_LABELS) as ToneMappingMode[])[index]!;
            toneButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
          },
          { signal: context.signal },
        ),
      );
      viewButtons.forEach((button, index) =>
        button.addEventListener(
          "click",
          () => {
            debug = DEBUG_VIEWS[index]!;
            viewButtons.forEach((entry) =>
              entry.setAttribute("aria-pressed", String(entry === button)),
            );
            context.setStatus(
              `Canvas approximation view: ${DEBUG_VIEW_LABELS[debug]}; not a Three.js buffer capture.`,
              "warning",
            );
          },
          { signal: context.signal },
        ),
      );
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      ctx = surface?.resize(width, height) ?? ctx;
    },
    pause() {
      running = false;
      cancelAnimationFrame(raf);
    },
    resume() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(render);
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      surface?.dispose();
      surface = undefined;
    },
  };
}

function makeColorControl(
  label: string,
  value: string,
): {
  wrapper: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const wrapper = document.createElement("label");
  wrapper.className = "demo-range demo-color";
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  input.setAttribute("aria-label", label);
  wrapper.append(input);
  return { wrapper, input };
}

function hexToRgb(value: string): Vec3 {
  const hex = value.replace("#", "");
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as Vec3;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

function canvasToneMap(value: number, mode: ToneMappingMode): number {
  const linear = Math.max(0, value);
  if (mode === "linear") return Math.min(1, linear);
  const mapped =
    mode === "agx"
      ? Math.pow(linear / (1 + linear), 0.82)
      : (linear * (2.51 * linear + 0.03)) / (linear * (2.43 * linear + 0.59) + 0.14);
  return Math.min(1, Math.max(0, Math.pow(mapped, 1 / 2.2)));
}
