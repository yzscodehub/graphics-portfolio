import type { Triangle, Vec3 } from "./bvh";

export interface PathMaterial {
  color: Vec3;
  type: 0 | 1 | 2 | 3;
  roughness: number;
  emission: number;
  ior: number;
}

export interface PathScene {
  triangles: Triangle[];
  materials: PathMaterial[];
}

export function createCornellScene(): PathScene {
  const materials: PathMaterial[] = [
    { color: [0.72, 0.7, 0.64], type: 0, roughness: 0.9, emission: 0, ior: 1 },
    { color: [0.72, 0.08, 0.06], type: 0, roughness: 0.9, emission: 0, ior: 1 },
    { color: [0.08, 0.52, 0.22], type: 0, roughness: 0.9, emission: 0, ior: 1 },
    { color: [0.88, 0.65, 0.28], type: 1, roughness: 0.12, emission: 0, ior: 1 },
    { color: [0.9, 0.96, 1], type: 2, roughness: 0, emission: 0, ior: 1.5 },
    { color: [1, 0.92, 0.72], type: 3, roughness: 0, emission: 12, ior: 1 },
  ];
  const triangles: Triangle[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, material: number) => {
    triangles.push({ v0: a, v1: b, v2: c, material }, { v0: a, v1: c, v2: d, material });
  };
  quad([-1.6, -1, 0], [1.6, -1, 0], [1.6, -1, 3.2], [-1.6, -1, 3.2], 0);
  quad([-1.6, 2, 3.2], [1.6, 2, 3.2], [1.6, 2, 0], [-1.6, 2, 0], 0);
  quad([-1.6, -1, 3.2], [1.6, -1, 3.2], [1.6, 2, 3.2], [-1.6, 2, 3.2], 0);
  quad([-1.6, -1, 0], [-1.6, -1, 3.2], [-1.6, 2, 3.2], [-1.6, 2, 0], 1);
  quad([1.6, -1, 3.2], [1.6, -1, 0], [1.6, 2, 0], [1.6, 2, 3.2], 2);
  addBox(triangles, [-1.15, -1, 0.9], [-0.25, 0.1, 1.85], 3);
  addBox(triangles, [0.32, -1, 1.45], [1.15, 0.55, 2.36], 4);
  quad([-0.58, 1.985, 1.05], [0.58, 1.985, 1.05], [0.58, 1.985, 2.08], [-0.58, 1.985, 2.08], 5);
  return { triangles, materials };
}

export function encodeMaterials(materials: PathMaterial[]): Float32Array {
  const data = new Float32Array(materials.length * 8);
  materials.forEach((material, index) => {
    data.set(
      [...material.color, material.type, material.roughness, material.emission, material.ior, 0],
      index * 8,
    );
  });
  return data;
}

function addBox(triangles: Triangle[], min: Vec3, max: Vec3, material: number): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    triangles.push({ v0: a, v1: b, v2: c, material }, { v0: a, v1: c, v2: d, material });
  };
  quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
  quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]);
  quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]);
  quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
  quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
  quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]);
}
