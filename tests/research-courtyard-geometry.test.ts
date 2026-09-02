import { Document, Primitive } from "@gltf-transform/core";
import { KHRTextureTransform } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";
import { projectRoot } from "../scripts/assets/manifest.mjs";
import { loadResearchCourtyardRecipe } from "../scripts/assets/research-courtyard-recipe.mjs";
import {
  ResearchCourtyardGeometryError,
  normalizeResearchCourtyardMeshDocument,
} from "../scripts/assets/research-courtyard-geometry.mjs";

type MeshSource = {
  sourceId: string;
  parts: Array<{ partId: string; nodeNames: string[] }>;
  materialOverrides?: Array<Record<string, unknown>>;
};

function fixture(
  options: {
    names?: string[];
    materialName?: string;
    transform?: {
      offset: [number, number];
      rotation: number;
      scale: [number, number];
    };
    uvs?: number[];
    mode?: Parameters<Primitive["setMode"]>[0];
    omit?: "POSITION" | "NORMAL" | "TEXCOORD_0";
    parentTranslation?: [number, number, number];
  } = {},
) {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const normals = document
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const uvs = document
    .createAccessor()
    .setType("VEC2")
    .setArray(new Float32Array(options.uvs ?? [0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const indices = document
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const material = document.createMaterial(options.materialName ?? "fixture-material");
  if (options.transform) {
    material.setBaseColorTexture(document.createTexture());
    const extension = document.createExtension(KHRTextureTransform);
    material
      .getBaseColorTextureInfo()!
      .setExtension(
        "KHR_texture_transform",
        extension
          .createTransform()
          .setOffset(options.transform.offset)
          .setRotation(options.transform.rotation)
          .setScale(options.transform.scale),
      );
  }
  const primitive = document
    .createPrimitive()
    .setIndices(indices)
    .setMaterial(material)
    .setMode(options.mode ?? Primitive.Mode.TRIANGLES);
  if (options.omit !== "POSITION") primitive.setAttribute("POSITION", positions);
  if (options.omit !== "NORMAL") primitive.setAttribute("NORMAL", normals);
  if (options.omit !== "TEXCOORD_0") primitive.setAttribute("TEXCOORD_0", uvs);
  const mesh = document.createMesh().addPrimitive(primitive);
  const parent = document
    .createNode("parent")
    .setTranslation(options.parentTranslation ?? [0, 0, 0]);
  for (const name of options.names ?? ["selected-node"])
    parent.addChild(document.createNode(name).setMesh(mesh));
  document.createScene().addChild(parent);
  return { document, primitive };
}

function source(parts: MeshSource["parts"], sourceId = "fixture-source"): MeshSource {
  return { sourceId, parts };
}

describe("Research Courtyard geometry normalization", () => {
  it("applies world transforms, sorts nodes, ground-centers, and uses deterministic tangent fallback", () => {
    const { document } = fixture({
      names: ["z-node", "a-node"],
      parentTranslation: [10, 2, 3],
      uvs: [0, 0, 0, 0, 0, 0],
    });
    const meshSource = source([{ partId: "main", nodeNames: ["z-node", "a-node"] }]);
    const first = normalizeResearchCourtyardMeshDocument(meshSource, document);
    const second = normalizeResearchCourtyardMeshDocument(meshSource, document);
    const part = first.parts[0];
    expect(first).toEqual(second);
    expect(part.primitives.map((primitive: { nodeName: string }) => primitive.nodeName)).toEqual([
      "a-node",
      "z-node",
    ]);
    expect(part.bounds.min[1]).toBe(0);
    expect(part.bounds.center[0]).toBe(0);
    expect(part.bounds.center[2]).toBe(0);
    expect(part.primitives[0].nodeWorldMatrix.slice(12, 15)).toEqual([10, 2, 3]);
    expect(
      part.primitives.every((primitive: { tangentFallback: boolean }) => primitive.tangentFallback),
    ).toBe(true);
  });

  it("bakes fence KHR_texture_transform in scale-rotate-offset order", () => {
    const transform = {
      offset: [1, 2] as [number, number],
      rotation: Math.PI / 2,
      scale: [2, 3] as [number, number],
    };
    const { document } = fixture({
      names: ["modular_chainlink_fence"],
      materialName: "modular_chainlink_fence_wire",
      transform,
    });
    const meshSource: MeshSource = {
      ...source(
        [
          {
            partId: "single",
            nodeNames: ["modular_chainlink_fence"],
          },
        ],
        "modular-chainlink-fence",
      ),
      materialOverrides: [
        {
          materialName: "modular_chainlink_fence_wire",
          textureTransform: { ...transform, bakeIntoUv: true },
        },
      ],
    };
    const primitive = normalizeResearchCourtyardMeshDocument(meshSource, document).parts[0]
      .primitives[0];
    expect(primitive.uvs.slice(2, 4)).toEqual([1, 4]);
    expect(primitive.material.textureTransform).toMatchObject({
      offset: [1, 2],
      scale: [2, 3],
      bakedIntoUv: true,
    });
  });

  it("rejects animation, skin, morph, non-triangles, and missing attributes", () => {
    const selected = source([{ partId: "main", nodeNames: ["selected-node"] }]);
    const animation = fixture();
    animation.document.createAnimation();
    expect(() => normalizeResearchCourtyardMeshDocument(selected, animation.document)).toThrow(
      ResearchCourtyardGeometryError,
    );
    const skin = fixture();
    skin.document.createSkin();
    expect(() => normalizeResearchCourtyardMeshDocument(selected, skin.document)).toThrow(
      ResearchCourtyardGeometryError,
    );
    const morph = fixture();
    morph.primitive.addTarget(morph.document.createPrimitiveTarget());
    expect(() => normalizeResearchCourtyardMeshDocument(selected, morph.document)).toThrow(
      ResearchCourtyardGeometryError,
    );
    const lines = fixture({ mode: Primitive.Mode.LINES });
    expect(() => normalizeResearchCourtyardMeshDocument(selected, lines.document)).toThrow(
      "must be TRIANGLES",
    );
    const missing = fixture({ omit: "NORMAL" });
    expect(() => normalizeResearchCourtyardMeshDocument(selected, missing.document)).toThrow(
      "requires POSITION, NORMAL, and TEXCOORD_0",
    );
  });

  it("uses recipe node selection only, excluding clean hydrant and unused fence kit nodes", () => {
    const recipe = loadResearchCourtyardRecipe(projectRoot, {
      verifyFiles: false,
    }) as { meshSources: MeshSource[] };
    const hydrant = recipe.meshSources.find((entry) => entry.sourceId === "fire-hydrant")!;
    const fence = recipe.meshSources.find((entry) => entry.sourceId === "modular-chainlink-fence")!;
    const hydrantDocument = fixture({
      names: [...hydrant.parts[0].nodeNames, "fire_hydrant"],
    }).document;
    const fenceDocument = fixture({
      names: [
        ...fence.parts.flatMap((part) => part.nodeNames),
        "modular_chainlink_fence_corner_outer",
        "modular_chainlink_post_middle",
      ],
    }).document;
    const hydrantNodes = normalizeResearchCourtyardMeshDocument(
      hydrant,
      hydrantDocument,
    ).parts.flatMap((part: { primitives: Array<{ nodeName: string }> }) =>
      part.primitives.map((primitive) => primitive.nodeName),
    );
    const fenceNodes = normalizeResearchCourtyardMeshDocument(fence, fenceDocument).parts.flatMap(
      (part: { primitives: Array<{ nodeName: string }> }) =>
        part.primitives.map((primitive) => primitive.nodeName),
    );
    expect(hydrantNodes).not.toContain("fire_hydrant");
    expect(hydrantNodes.sort()).toEqual([...hydrant.parts[0].nodeNames].sort());
    expect(fenceNodes).not.toContain("modular_chainlink_fence_corner_outer");
    expect(fenceNodes).not.toContain("modular_chainlink_post_middle");
    expect(fenceNodes.sort()).toEqual(fence.parts.flatMap((part) => part.nodeNames).sort());
  });
});
