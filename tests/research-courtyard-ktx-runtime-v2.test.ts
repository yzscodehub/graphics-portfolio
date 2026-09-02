import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  KtxReadModuleLoader,
  loadRuntimeTexture,
  selectKtxTranscodeTarget,
  transcodeKtx2,
  type KtxReadModule,
  type RuntimeTextureFetch,
} from "../src/demos/research-courtyard/ktx-runtime-v2";
import type { ResearchCourtyardRuntimeManifestV2 } from "../src/demos/research-courtyard/runtime-manifest-v2";

const baseUrl = "https://portfolio.test/assets/rendering/research-courtyard/";

function ktx2(width = 8, height = 8, levels = 2) {
  const bytes = new Uint8Array(80);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(20, width, true);
  view.setUint32(24, height, true);
  view.setUint32(28, 0, true);
  view.setUint32(32, 0, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, levels, true);
  return bytes;
}

function fakeModule(options: { result?: number; onDelete?: () => void } = {}) {
  const success = { value: 0 };
  const target = { value: 6 };
  const module: KtxReadModule = {
    ErrorCode: { SUCCESS: success },
    TranscodeTarget: {
      BC7_RGBA: target,
      ETC2_RGBA: { value: 1 },
      ASTC_4x4_RGBA: { value: 10 },
    },
    texture: class {
      baseWidth = 8;
      baseHeight = 8;
      needsTranscoding = true;
      private readonly storage = new Uint8Array(80).fill(7);

      constructor(sourceBytes: Uint8Array) {
        void sourceBytes;
      }

      transcodeBasis(value: { value: number }) {
        expect(value).toBe(target);
        this.needsTranscoding = false;
        return { value: options.result ?? 0 };
      }

      getImage(level: number) {
        const length = level === 0 ? 64 : 16;
        return this.storage.subarray(0, length);
      }

      delete() {
        this.storage.fill(0);
        options.onDelete?.();
      }
    },
  };
  return module;
}

function digest(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function receipt(uri: string, value: Uint8Array) {
  return { uri, bytes: value.byteLength, sha256: digest(value) };
}

function runtimeFixture() {
  const wasm = new Uint8Array([0, 97, 115, 109]);
  const script = new TextEncoder().encode("verified script");
  const ktx = ktx2();
  const webp = new Uint8Array([1, 2, 3, 4]);
  const runtime = {
    transcoders: {
      ktx: {
        version: "4.4.2",
        script: receipt("transcoders/ktx/libktx_read.js", script),
        wasm: receipt("transcoders/ktx/libktx_read.wasm", wasm),
      },
    },
    textures: {
      stone: {
        colorSpace: "srgb",
        ktx2: receipt("textures/stone.ktx2", ktx),
        webp: receipt("textures/stone.webp", webp),
      },
    },
  } as unknown as ResearchCourtyardRuntimeManifestV2;
  const files = new Map([
    [new URL(runtime.transcoders.ktx.wasm.uri, baseUrl).href, wasm],
    [new URL(runtime.textures.stone.ktx2.uri, baseUrl).href, ktx],
    [new URL(runtime.textures.stone.webp.uri, baseUrl).href, webp],
  ]);
  const requests: string[] = [];
  const fetch: RuntimeTextureFetch = async (input) => {
    requests.push(input);
    const value = files.get(input);
    return value
      ? new Response(value.slice(), { status: 200 })
      : new Response("missing", { status: 404 });
  };
  return { runtime, files, requests, fetch };
}

describe("Research Courtyard KTX runtime", () => {
  it("selects BC, ETC2, ASTC, then explicit WebP fallback", () => {
    expect(selectKtxTranscodeTarget(new Set(["texture-compression-bc"]), "srgb")).toMatchObject({
      kind: "bc7",
      format: "bc7-rgba-unorm-srgb",
    });
    expect(selectKtxTranscodeTarget(new Set(["texture-compression-etc2"]), "linear")).toMatchObject(
      { kind: "etc2", format: "etc2-rgba8unorm" },
    );
    expect(selectKtxTranscodeTarget(new Set(["texture-compression-astc"]), "srgb")).toMatchObject({
      kind: "astc",
      format: "astc-4x4-unorm-srgb",
    });
    expect(selectKtxTranscodeTarget(new Set(), "linear")).toBeNull();
  });

  it("transcodes every declared mip and copies WASM-owned image views", () => {
    const onDelete = vi.fn();
    const target = selectKtxTranscodeTarget(new Set(["texture-compression-bc"]), "srgb");
    if (!target) throw new Error("Expected BC target.");
    const result = transcodeKtx2(ktx2().buffer, fakeModule({ onDelete }), target);
    expect(result).toMatchObject({
      kind: "bc7",
      format: "bc7-rgba-unorm-srgb",
      width: 8,
      height: 8,
      mipLevelCount: 2,
    });
    expect(result.levels.map((level) => level.data.byteLength)).toEqual([64, 16]);
    expect(result.levels[0].data[0]).toBe(7);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("deduplicates verified WASM/module initialization", async () => {
    const input = runtimeFixture();
    const create = vi.fn(async () => fakeModule());
    const loadScript = vi.fn(async () => undefined);
    const loader = new KtxReadModuleLoader(loadScript, create);
    const [first, second] = await Promise.all([
      loader.load({
        baseUrl,
        runtime: input.runtime,
        fetch: input.fetch,
      }),
      loader.load({
        baseUrl,
        runtime: input.runtime,
        fetch: input.fetch,
      }),
    ]);
    expect(first).toBe(second);
    expect(create).toHaveBeenCalledOnce();
    expect(loadScript).not.toHaveBeenCalled();
    expect(input.requests).toEqual([new URL("transcoders/ktx/libktx_read.wasm", baseUrl).href]);
  });

  it("loads KTX only when a compressed feature exists and releases mip data", async () => {
    const input = runtimeFixture();
    const loader = new KtxReadModuleLoader(
      async () => undefined,
      async () => fakeModule(),
    );
    const createBitmap = vi.fn() as unknown as typeof globalThis.createImageBitmap;
    const loaded = await loadRuntimeTexture("stone", {
      baseUrl,
      runtime: input.runtime,
      deviceFeatures: new Set(["texture-compression-bc"]),
      fetch: input.fetch,
      moduleLoader: loader,
      createImageBitmap: createBitmap,
    });
    expect(loaded.kind).toBe("ktx2");
    expect(input.requests).toEqual(
      expect.arrayContaining([
        new URL("textures/stone.ktx2", baseUrl).href,
        new URL("transcoders/ktx/libktx_read.wasm", baseUrl).href,
      ]),
    );
    expect(input.requests).not.toContain(new URL("textures/stone.webp", baseUrl).href);
    if (loaded.kind === "ktx2") {
      loaded.dispose();
      expect(loaded.texture.levels.every((level) => level.data.byteLength === 0)).toBe(true);
    }
  });

  it("makes zero KTX/transcoder requests without a GPU compression feature", async () => {
    const input = runtimeFixture();
    const close = vi.fn();
    const createBitmap = vi.fn(async () => ({
      width: 512,
      height: 512,
      close,
    })) as unknown as typeof globalThis.createImageBitmap;
    const loaded = await loadRuntimeTexture("stone", {
      baseUrl,
      runtime: input.runtime,
      deviceFeatures: new Set(),
      fetch: input.fetch,
      moduleLoader: new KtxReadModuleLoader(
        async () => {
          throw new Error("must not load");
        },
        async () => {
          throw new Error("must not create");
        },
      ),
      createImageBitmap: createBitmap,
    });
    expect(loaded.kind).toBe("webp");
    expect(input.requests).toEqual([new URL("textures/stone.webp", baseUrl).href]);
    loaded.dispose();
    expect(close).toHaveBeenCalledOnce();
  });

  it("falls back to verified WebP when libktx transcoding fails", async () => {
    const input = runtimeFixture();
    const createBitmap = vi.fn(async () => ({
      width: 512,
      height: 512,
      close() {},
    })) as unknown as typeof globalThis.createImageBitmap;
    const loaded = await loadRuntimeTexture("stone", {
      baseUrl,
      runtime: input.runtime,
      deviceFeatures: new Set(["texture-compression-bc"]),
      fetch: input.fetch,
      moduleLoader: new KtxReadModuleLoader(
        async () => undefined,
        async () => fakeModule({ result: 14 }),
      ),
      createImageBitmap: createBitmap,
    });
    expect(loaded.kind).toBe("webp");
    expect(input.requests).toContain(new URL("textures/stone.webp", baseUrl).href);
  });
});
