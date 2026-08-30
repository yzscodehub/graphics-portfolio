/* eslint-disable @typescript-eslint/consistent-type-imports -- Three.js remains lazy-loaded with its renderer-specific entry points. */
import {
  clearElement,
  createMetricReporter,
  drawStageBackdrop,
  makeButton,
  makeRange,
  resizeCanvas,
} from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";
import type { BufferGeometry, Material, Object3D } from "three";

type DebugView = "final" | "normal" | "roughness" | "metalness" | "direct" | "indirect";
type ToneMappingMode = "aces" | "agx" | "linear";
type Vec3 = [number, number, number];

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

/**
 * r185's multi-backend renderer initializes WebGPU first and falls back to WebGL2 internally.
 * The same TSL node-material graph stays active on both paths.
 */
export function createDemo(): DemoController {
  let active: DemoController | undefined;

  return {
    async init(context) {
      const renderer = createThreeMaterialDemo();
      try {
        await renderer.init(context);
        active = renderer;
      } catch (error) {
        await renderer.dispose();
        const fallback = createCanvasFallback();
        await fallback.init(context);
        active = fallback;
        const reason = error instanceof Error ? error.message : "Three.js renderer is unavailable.";
        context.setStatus(
          `${reason} Showing a clearly labeled Canvas material preview.`,
          "warning",
        );
      }
    },
    resize(width, height) {
      active?.resize(width, height);
    },
    pause() {
      active?.pause();
    },
    resume() {
      active?.resume();
    },
    dispose() {
      return active?.dispose();
    },
  };
}

function createThreeMaterialDemo(): DemoController {
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
  let baseColor = "#2bd8b7";
  let roughness = 0.34;
  let metalness = 0.72;
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
    report?.({ backend: backendLabel(), status: `PBR / ${debug.toUpperCase()}` });
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

    sphere.material =
      debug === "normal"
        ? normalMaterial
        : debug === "roughness"
          ? roughnessMaterial
          : debug === "metalness"
            ? metalnessMaterial
            : material;
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
    const baseColorControl = makeColorControl("Base Color", baseColor);
    const metalnessControl = makeRange("Metalness", metalness, 0, 1, 0.01);
    const roughnessControl = makeRange("Roughness", roughness, 0.05, 0.95, 0.01);
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
    const viewButtons = DEBUG_VIEWS.map((view) => makeButton(view.toUpperCase(), view === debug));
    context.controls.append(
      baseColorControl.wrapper,
      metalnessControl.parentElement!,
      roughnessControl.parentElement!,
      exposureControl.parentElement!,
      toneMappingControl,
      ...viewButtons,
    );

    baseColorControl.input.addEventListener(
      "input",
      () => {
        baseColor = baseColorControl.input.value;
        material?.color.set(baseColor);
      },
      { signal: context.signal },
    );
    metalnessControl.addEventListener(
      "input",
      () => {
        metalness = Number(metalnessControl.value);
        if (material) material.metalness = metalness;
        if (metalnessNode) metalnessNode.value = metalness;
      },
      { signal: context.signal },
    );
    roughnessControl.addEventListener(
      "input",
      () => {
        roughness = Number(roughnessControl.value);
        if (material) material.roughness = roughness;
        if (roughnessNode) roughnessNode.value = roughness;
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
              ? "Direct lighting: PMREM environment contribution is disabled."
              : debug === "indirect"
                ? "Indirect lighting: direct lights are disabled; PMREM remains active."
                : `TSL debug view: ${debug.toUpperCase()}.`,
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
      const [{ OrbitControls }, { RoomEnvironment }] = await Promise.all([
        import("three/addons/controls/OrbitControls.js"),
        import("three/addons/environments/RoomEnvironment.js"),
      ]);

      renderer = new three.WebGPURenderer({
        canvas: context.canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      await renderer.init();
      renderer.setClearColor(0x071011, 1);
      renderer.outputColorSpace = three.SRGBColorSpace;
      applyToneMapping();

      scene = new three.Scene();
      camera = new three.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(3.1, 1.7, 4.3);
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
        clearcoat: 0.16,
        clearcoatRoughness: 0.18,
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
        `${backendLabel()} with TSL node materials and a procedural PMREM room; no HDRI texture was loaded.`,
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

function createCanvasFallback(): DemoController {
  let context: DemoContext;
  let ctx: CanvasRenderingContext2D;
  let width = 1;
  let height = 1;
  let raf = 0;
  let running = false;
  let baseColor = "#2bd8b7";
  let roughness = 0.34;
  let metalness = 0.72;
  let exposure = 1.1;
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
        const indirect = 0.16 + 0.24 * Math.max(0, normal[1]);
        const index = (y * size + x) * 4;
        const illumination = indirect + ndotl * 1.2;
        image.data[index] = Math.round(
          255 * toneMap((color[0] * illumination * (1 - metalness * 0.45) + specular) * exposure),
        );
        image.data[index + 1] = Math.round(
          255 * toneMap((color[1] * illumination * (1 - metalness * 0.45) + specular) * exposure),
        );
        image.data[index + 2] = Math.round(
          255 * toneMap((color[2] * illumination * (1 - metalness * 0.45) + specular) * exposure),
        );
        image.data[index + 3] = 255;
      }
    ctx.putImageData(image, centerX - size / 2, centerY - size / 2);
    ctx.fillStyle = "#e8e6dc";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText("CANVAS PBR PREVIEW / WEBGPU AND WEBGL2 UNAVAILABLE", 16, 24);
    report({ backend: "Canvas fallback", status: "PBR approximation" });
    raf = requestAnimationFrame(render);
  };

  return {
    async init(next) {
      context = next;
      ctx = resizeCanvas(context.canvas, width, height);
      report = createMetricReporter(context);
      clearElement(context.controls);
      const baseColorControl = makeColorControl("Base Color", baseColor);
      const metalnessControl = makeRange("Metalness", metalness, 0, 1, 0.01);
      const roughnessControl = makeRange("Roughness", roughness, 0.05, 0.95, 0.01);
      const exposureControl = makeRange("Exposure", exposure, 0.5, 1.8, 0.05);
      context.controls.append(
        baseColorControl.wrapper,
        metalnessControl.parentElement!,
        roughnessControl.parentElement!,
        exposureControl.parentElement!,
      );
      baseColorControl.input.addEventListener(
        "input",
        () => {
          baseColor = baseColorControl.input.value;
        },
        { signal: context.signal },
      );
      metalnessControl.addEventListener(
        "input",
        () => {
          metalness = Number(metalnessControl.value);
        },
        { signal: context.signal },
      );
      roughnessControl.addEventListener(
        "input",
        () => {
          roughness = Number(roughnessControl.value);
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
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      ctx = resizeCanvas(context.canvas, width, height);
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

function toneMap(value: number): number {
  return Math.min(1, Math.pow(value / (1 + value), 1 / 2.2));
}
