import { describe, expect, it } from "vitest";
import { measureCapabilities } from "../src/demos/core/capabilities";
import { DemoRuntime, ResourceScope, type DemoRuntimeContext } from "../src/demos/core/runtime";
import type { DemoController } from "../src/demos/core/types";

describe("Demo runtime", () => {
  it("cleans event listeners, animation frames, GPU resources, and ONNX sessions in reverse order", async () => {
    const events: string[] = [];
    const cancelled: number[] = [];
    const scope = new ResourceScope(undefined, {
      cancel: (handle) => cancelled.push(handle),
      request: () => 9,
    });
    const target = new EventTarget();
    let received = 0;
    scope.on(target, "demo", () => {
      received += 1;
    });
    scope.add(() => {
      events.push("custom");
    });
    scope.trackGpuResource({
      destroy: () => {
        events.push("gpu");
      },
    });
    scope.trackInferenceSession({
      release: () => {
        events.push("onnx");
      },
    });
    scope.trackAnimationFrame(4);

    target.dispatchEvent(new Event("demo"));
    await scope.dispose();
    target.dispatchEvent(new Event("demo"));

    expect(received).toBe(1);
    expect(events).toEqual(["onnx", "gpu", "custom"]);
    expect(cancelled).toEqual([4]);
  });

  it("rejects stale asynchronous initialization and pauses active demos when hidden", async () => {
    const runtime = new DemoRuntime();
    runtime.setViewport(true);
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = controller("first", events, async () => firstGate);
    const second = controller("second", events);

    const firstRun = runtime.initialize(() => first, context());
    await Promise.resolve();
    const secondRun = runtime.initialize(() => second, context());
    releaseFirst?.();

    await expect(firstRun).resolves.toBe(false);
    await expect(secondRun).resolves.toBe(true);
    runtime.setDocumentVisible(false);
    await runtime.dispose();

    expect(events).toEqual([
      "first:dispose",
      "second:init",
      "second:resume",
      "second:pause",
      "second:pause",
      "second:dispose",
    ]);
  });

  it("uses an adapter request rather than navigator presence as the WebGPU result", async () => {
    await expect(
      measureCapabilities({
        wasm: true,
        webgpu: { requestAdapter: async () => null },
      }),
    ).resolves.toMatchObject({ wasm: true, webgpu: false, webgpuAdapter: false });
  });

  it("runs a device-lost recovery hook only while its resource scope is active", async () => {
    let loseDevice: ((reason: unknown) => void) | undefined;
    const lost = new Promise<unknown>((resolve) => {
      loseDevice = resolve;
    });
    const scope = new ResourceScope();
    let recover: (() => void) | undefined;
    const recovered = new Promise<void>((resolve) => {
      recover = resolve;
    });
    scope.onDeviceLost({ lost }, () => recover?.());

    loseDevice?.("reset");
    await recovered;
    await scope.dispose();

    expect(scope.signal.aborted).toBe(true);
  });

  it("immediately aborts and releases a pending initialization scope on dispose", async () => {
    const runtime = new DemoRuntime();
    let finishInitialization: (() => void) | undefined;
    let initializationStarted: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    const started = new Promise<void>((resolve) => {
      initializationStarted = resolve;
    });
    const events: string[] = [];
    let pendingSignal: AbortSignal | undefined;
    const pending: DemoController = {
      async init(next) {
        pendingSignal = next.signal;
        next.addCleanup(() => events.push("scope:cleanup"));
        initializationStarted?.();
        await gate;
      },
      resize: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      dispose: () => {
        events.push("controller:dispose");
      },
    };

    const initialization = runtime.initialize(() => pending, context());
    await started;
    await runtime.dispose();

    expect(pendingSignal?.aborted).toBe(true);
    expect(events).toEqual(["scope:cleanup"]);

    finishInitialization?.();
    await expect(initialization).resolves.toBe(false);
    expect(events).toEqual(["scope:cleanup", "controller:dispose"]);
  });
});

function context(): DemoRuntimeContext {
  return {
    canvas: {} as HTMLCanvasElement,
    controls: {} as HTMLElement,
    metrics: {} as HTMLElement,
    quality: "auto",
    setMetrics: () => undefined,
    setStatus: () => undefined,
    stage: {} as HTMLElement,
  };
}

function controller(
  name: string,
  events: string[],
  initWait?: () => Promise<void>,
): DemoController {
  return {
    async init() {
      events.push(`${name}:init`);
      await initWait?.();
    },
    resize: () => undefined,
    pause: () => events.push(`${name}:pause`),
    resume: () => events.push(`${name}:resume`),
    dispose: () => {
      events.push(`${name}:dispose`);
    },
  };
}
