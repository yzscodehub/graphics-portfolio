import type {
  Cleanup,
  DemoContext,
  DemoController,
  DemoMetrics,
  DemoResourceScope,
  DeviceLostLike,
  GpuResourceLike,
  InferenceSessionLike,
  MetricSource,
} from "./types";

interface AnimationScheduler {
  cancel(handle: number): void;
  request(callback: FrameRequestCallback): number;
}

interface CleanupEntry {
  active: boolean;
  cleanup: Cleanup;
}

export class ResourceScope implements DemoResourceScope {
  private readonly abortController = new AbortController();
  private readonly entries: CleanupEntry[] = [];
  private readonly frameHandles = new Set<number>();
  private readonly scheduler?: AnimationScheduler;
  private disposed = false;
  private disposePromise: Promise<void> | undefined;

  constructor(parentSignal?: AbortSignal, scheduler = getAnimationScheduler()) {
    this.scheduler = scheduler;
    if (parentSignal?.aborted) this.abortController.abort();
    else if (parentSignal) {
      const abort = () => this.abort();
      parentSignal.addEventListener("abort", abort, { once: true });
      this.add(() => parentSignal.removeEventListener("abort", abort));
    }
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  add(cleanup: Cleanup): () => void {
    if (this.disposed) {
      void Promise.resolve(cleanup()).catch(() => undefined);
      return () => undefined;
    }
    const entry: CleanupEntry = { active: true, cleanup };
    this.entries.push(entry);
    return () => {
      entry.active = false;
    };
  }

  on(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): () => void {
    target.addEventListener(type, listener, options);
    return this.add(() => target.removeEventListener(type, listener, options));
  }

  requestAnimationFrame(callback: FrameRequestCallback): number | undefined {
    if (!this.scheduler || this.disposed) return undefined;
    let handle = 0;
    handle = this.scheduler.request((time) => {
      this.frameHandles.delete(handle);
      if (!this.disposed && !this.signal.aborted) callback(time);
    });
    this.frameHandles.add(handle);
    return handle;
  }

  trackAnimationFrame(handle: number): number {
    if (this.disposed) this.scheduler?.cancel(handle);
    else this.frameHandles.add(handle);
    return handle;
  }

  trackGpuResource<T extends GpuResourceLike>(resource: T): T {
    this.add(() => resource.destroy?.());
    return resource;
  }

  trackInferenceSession<T extends InferenceSessionLike>(session: T): T {
    this.add(() => session.release());
    return session;
  }

  onDeviceLost(device: DeviceLostLike, recover: (reason: unknown) => void | Promise<void>): void {
    if (!device.lost) return;
    void device.lost
      .then(async (reason) => {
        if (!this.disposed && !this.signal.aborted) await recover(reason);
      })
      .catch(() => undefined);
  }

  abort(): void {
    if (!this.signal.aborted) this.abortController.abort();
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.disposeInternal();
    return this.disposePromise;
  }

  private async disposeInternal(): Promise<void> {
    this.disposed = true;
    this.abort();
    this.frameHandles.forEach((handle) => this.scheduler?.cancel(handle));
    this.frameHandles.clear();
    const errors: unknown[] = [];
    for (const entry of this.entries.splice(0).reverse()) {
      if (!entry.active) continue;
      try {
        await entry.cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw errors[0];
  }
}

export class Measurement {
  constructor(readonly source: MetricSource) {}

  start(): number {
    return performance.now();
  }

  elapsed(start: number): number {
    return Math.max(0, performance.now() - start);
  }

  withSource(metrics: DemoMetrics): DemoMetrics {
    return { ...metrics, metricSource: this.source };
  }
}

export type DemoRuntimeContext = Omit<
  DemoContext,
  "signal" | "addCleanup" | "resources" | "generation" | "isCurrent"
>;

interface ActiveDemo {
  controller: DemoController;
  scope: ResourceScope;
}

interface PendingDemo {
  scope: ResourceScope;
  controller?: DemoController;
  cancelled: boolean;
  controllerDisposed: boolean;
}

export class DemoRuntime {
  private active: ActiveDemo | undefined;
  private readonly pending = new Map<number, PendingDemo>();
  private generation = 0;
  private inViewport = false;
  private documentVisible = true;
  private running = false;

  async initialize(
    factory: () => DemoController | Promise<DemoController>,
    context: DemoRuntimeContext,
    parentSignal?: AbortSignal,
  ): Promise<boolean> {
    const generation = ++this.generation;
    await this.disposePendingExcept(generation);
    await this.disposeActive();

    const candidate: PendingDemo = {
      scope: new ResourceScope(parentSignal),
      cancelled: false,
      controllerDisposed: false,
    };
    this.pending.set(generation, candidate);
    try {
      const controller = await factory();
      candidate.controller = controller;
      if (candidate.cancelled || !this.isCurrent(generation)) {
        await this.disposeCandidate(candidate, generation);
        return false;
      }
      await controller.init({
        ...context,
        signal: candidate.scope.signal,
        addCleanup: (cleanup) => candidate.scope.add(cleanup),
        resources: candidate.scope,
        onDeviceLost: (device, recover) => candidate.scope.onDeviceLost(device, recover),
        generation,
        isCurrent: () => this.isCurrent(generation),
      });
      if (candidate.cancelled || !this.isCurrent(generation)) {
        await this.disposeCandidate(candidate, generation);
        return false;
      }
      this.pending.delete(generation);
      this.active = { controller, scope: candidate.scope };
      this.updateActivity();
      return true;
    } catch (error) {
      await this.disposeCandidate(candidate, generation);
      if (!this.isCurrent(generation)) return false;
      throw error;
    }
  }

  setViewport(inViewport: boolean): void {
    this.inViewport = inViewport;
    this.updateActivity();
  }

  setDocumentVisible(documentVisible: boolean): void {
    this.documentVisible = documentVisible;
    this.updateActivity();
  }

  resize(width: number, height: number): void {
    this.active?.controller.resize(width, height);
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  async dispose(): Promise<void> {
    this.generation += 1;
    await this.disposePendingExcept(this.generation);
    await this.disposeActive();
  }

  private async disposePendingExcept(currentGeneration: number): Promise<void> {
    const stale = [...this.pending.entries()].filter(
      ([generation]) => generation !== currentGeneration,
    );
    for (const [generation] of stale) this.pending.delete(generation);
    await Promise.all(stale.map(([, candidate]) => this.disposeCandidate(candidate)));
  }

  private async disposeCandidate(candidate: PendingDemo, generation?: number): Promise<void> {
    candidate.cancelled = true;
    if (generation !== undefined) this.pending.delete(generation);
    try {
      if (candidate.controller && !candidate.controllerDisposed) {
        candidate.controllerDisposed = true;
        await candidate.controller.dispose();
      }
    } finally {
      await candidate.scope.dispose();
    }
  }

  private async disposeActive(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    this.running = false;
    try {
      active.controller.pause();
      await active.controller.dispose();
    } finally {
      await active.scope.dispose();
    }
  }

  private updateActivity(): void {
    if (!this.active) return;
    const shouldRun = this.inViewport && this.documentVisible;
    if (shouldRun === this.running) return;
    this.running = shouldRun;
    if (shouldRun) this.active.controller.resume();
    else this.active.controller.pause();
  }
}

function getAnimationScheduler(): AnimationScheduler | undefined {
  if (typeof requestAnimationFrame !== "function" || typeof cancelAnimationFrame !== "function")
    return undefined;
  return {
    request: requestAnimationFrame,
    cancel: cancelAnimationFrame,
  };
}
