/* eslint-disable @typescript-eslint/consistent-type-imports -- Runtime Three.js stays lazy; these annotations intentionally use import() types. */
import {
  clearElement,
  createMetricReporter,
  drawStageBackdrop,
  makeButton,
  makeRange,
  resizeCanvas,
} from "./core/canvas";
import type { DemoContext, DemoController } from "./core/types";

type DebugView = "final" | "normal" | "roughness";

/**
 * The primary path is an actual Three.js WebGL PBR scene. The Canvas implementation
 * below remains intentionally small and is only selected if WebGL cannot be created.
 */
export function createDemo(): DemoController {
  let active: DemoController | undefined;
  return {
    async init(context) {
      const webgl = createThreeMaterialDemo();
      try {
        await webgl.init(context);
        active = webgl;
      } catch (error) {
        await webgl.dispose();
        const fallback = createCanvasFallback();
        await fallback.init(context);
        active = fallback;
        const reason = error instanceof Error ? error.message : "WebGL is unavailable.";
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
  let three: typeof import("three");
  let renderer: import("three").WebGLRenderer;
  let scene: import("three").Scene;
  let camera: import("three").PerspectiveCamera;
  let controls:
    | {
        update(): void;
        dispose(): void;
        enableDamping: boolean;
        minDistance: number;
        maxDistance: number;
        target: import("three").Vector3;
      }
    | undefined;
  let standardSphere: import("three").Mesh;
  let normalSphere: import("three").Mesh;
  let roughnessSphere: import("three").Mesh;
  let material: import("three").MeshStandardMaterial;
  let keyLight: import("three").DirectionalLight;
  let environmentTarget: import("three").WebGLRenderTarget | undefined;
  let pmrem: import("three").PMREMGenerator | undefined;
  let raf = 0;
  let running = false;
  let width = 1;
  let height = 1;
  let roughness = 0.34;
  let metallic = 0.72;
  let exposure = 1.1;
  let debug: DebugView = "final";
  let report: ReturnType<typeof createMetricReporter>;

  const applyDebugView = () => {
    standardSphere.visible = debug === "final";
    normalSphere.visible = debug === "normal";
    roughnessSphere.visible = debug === "roughness";
    const grayscale = Math.round(roughness * 255);
    (roughnessSphere.material as import("three").MeshBasicMaterial).color.setRGB(
      grayscale / 255,
      grayscale / 255,
      grayscale / 255,
    );
  };
  const render = (time: number) => {
    if (!running) return;
    keyLight.position.set(
      Math.cos(time * 0.00042) * 3.1,
      3.4,
      Math.sin(time * 0.00042) * 2.6 + 2.4,
    );
    controls?.update();
    renderer.render(scene, camera);
    report({ backend: "Three.js WebGLRenderer", status: `PBR / ${debug.toUpperCase()}` });
    raf = requestAnimationFrame(render);
  };
  const configureControls = () => {
    clearElement(context.controls);
    const metallicControl = makeRange("Metallic", metallic, 0, 1, 0.01);
    const roughnessControl = makeRange("Roughness", roughness, 0.05, 0.95, 0.01);
    const exposureControl = makeRange("Exposure", exposure, 0.5, 1.8, 0.05);
    const viewButtons = (["final", "normal", "roughness"] as DebugView[]).map((view) =>
      makeButton(view.toUpperCase(), view === debug),
    );
    context.controls.append(
      metallicControl.parentElement!,
      roughnessControl.parentElement!,
      exposureControl.parentElement!,
      ...viewButtons,
    );
    metallicControl.addEventListener(
      "input",
      () => {
        metallic = Number(metallicControl.value);
        material.metalness = metallic;
      },
      { signal: context.signal },
    );
    roughnessControl.addEventListener(
      "input",
      () => {
        roughness = Number(roughnessControl.value);
        material.roughness = roughness;
        applyDebugView();
      },
      { signal: context.signal },
    );
    exposureControl.addEventListener(
      "input",
      () => {
        exposure = Number(exposureControl.value);
        renderer.toneMappingExposure = exposure;
      },
      { signal: context.signal },
    );
    viewButtons.forEach((button, index) =>
      button.addEventListener(
        "click",
        () => {
          debug = (["final", "normal", "roughness"] as DebugView[])[index];
          viewButtons.forEach((entry) =>
            entry.setAttribute("aria-pressed", String(entry === button)),
          );
          applyDebugView();
          context.setMetrics({
            backend: "Three.js WebGLRenderer",
            status: `PBR / ${debug.toUpperCase()}`,
          });
        },
        { signal: context.signal },
      ),
    );
  };

  return {
    async init(next) {
      context = next;
      three = await import("three");
      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
      renderer = new three.WebGLRenderer({
        canvas: context.canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setClearColor(0x071011, 1);
      renderer.outputColorSpace = three.SRGBColorSpace;
      renderer.toneMapping = three.ACESFilmicToneMapping;
      renderer.toneMappingExposure = exposure;
      scene = new three.Scene();
      camera = new three.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(3.1, 1.7, 4.3);
      controls = new OrbitControls(camera, context.canvas);
      controls.enableDamping = true;
      controls.minDistance = 2.9;
      controls.maxDistance = 7.4;
      controls.target.set(0, 0.15, 0);

      pmrem = new three.PMREMGenerator(renderer);
      environmentTarget = pmrem.fromScene(new RoomEnvironment(), 0.035);
      scene.environment = environmentTarget.texture;
      scene.add(new three.HemisphereLight(0xa6d8d4, 0x182420, 1.25));
      keyLight = new three.DirectionalLight(0xffefc4, 4.2);
      keyLight.castShadow = false;
      scene.add(keyLight);
      const rim = new three.PointLight(0x57e3c2, 20, 7, 2);
      rim.position.set(-2.2, 1.5, -1.8);
      scene.add(rim);

      const geometry = new three.SphereGeometry(
        1.2,
        context.quality === "low" ? 32 : 64,
        context.quality === "low" ? 20 : 48,
      );
      material = new three.MeshStandardMaterial({
        color: 0x2bd8b7,
        metalness: metallic,
        roughness,
      });
      standardSphere = new three.Mesh(geometry, material);
      normalSphere = new three.Mesh(geometry, new three.MeshNormalMaterial());
      roughnessSphere = new three.Mesh(geometry, new three.MeshBasicMaterial({ color: 0x575757 }));
      normalSphere.visible = false;
      roughnessSphere.visible = false;
      scene.add(standardSphere, normalSphere, roughnessSphere);
      const floor = new three.Mesh(
        new three.CircleGeometry(3.6, 64),
        new three.MeshStandardMaterial({ color: 0x132321, metalness: 0.15, roughness: 0.78 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.24;
      scene.add(floor);
      const grid = new three.GridHelper(7, 18, 0x2f6860, 0x183833);
      grid.position.y = -1.23;
      scene.add(grid);
      report = createMetricReporter(context);
      configureControls();
      context.setStatus(
        "Three.js WebGL PBR renderer with PMREM room environment; no texture asset was loaded.",
        "success",
      );
      context.setMetrics({ backend: "Three.js WebGLRenderer", status: "PBR / FINAL" });
    },
    resize(nextWidth, nextHeight) {
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
      cancelAnimationFrame(raf);
      controls?.dispose();
      if (scene && three) {
        scene.traverse((object) => {
          if (object instanceof three.Mesh) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((entry) => entry.dispose());
          }
        });
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
  let roughness = 0.34;
  let metallic = 0.72;
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
        const output: Vec3 = [
          (0.16 * (indirect + ndotl * 1.2) * (1 - metallic * 0.45) +
            specular * (0.35 + metallic * 0.65)) *
            exposure,
          (0.86 * (indirect + ndotl * 1.2) * (1 - metallic * 0.45) +
            specular * (0.4 + metallic * 0.6)) *
            exposure,
          (0.66 * (indirect + ndotl * 1.2) * (1 - metallic * 0.45) +
            specular * (0.5 + metallic * 0.5)) *
            exposure,
        ];
        image.data[index] = Math.round(255 * toneMap(output[0]));
        image.data[index + 1] = Math.round(255 * toneMap(output[1]));
        image.data[index + 2] = Math.round(255 * toneMap(output[2]));
        image.data[index + 3] = 255;
      }
    ctx.putImageData(image, centerX - size / 2, centerY - size / 2);
    ctx.fillStyle = "#e8e6dc";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText("CANVAS PBR PREVIEW / WEBGL UNAVAILABLE", 16, 24);
    report({ backend: "Canvas fallback", status: "PBR approximation" });
    raf = requestAnimationFrame(render);
  };
  return {
    async init(next) {
      context = next;
      ctx = resizeCanvas(context.canvas, width, height);
      report = createMetricReporter(context);
      clearElement(context.controls);
      const metallicControl = makeRange("Metallic", metallic, 0, 1, 0.01);
      const roughnessControl = makeRange("Roughness", roughness, 0.05, 0.95, 0.01);
      const exposureControl = makeRange("Exposure", exposure, 0.5, 1.8, 0.05);
      context.controls.append(
        metallicControl.parentElement!,
        roughnessControl.parentElement!,
        exposureControl.parentElement!,
      );
      metallicControl.addEventListener(
        "input",
        () => {
          metallic = Number(metallicControl.value);
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
      cancelAnimationFrame(raf);
    },
  };
}

type Vec3 = [number, number, number];
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
