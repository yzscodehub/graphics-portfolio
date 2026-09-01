export const GBUFFER_WGSL = /* wgsl */ `
struct Frame {
  resolutionTime: vec4f,
  modeViewCounts: vec4f,
  depthGridScene: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct Surface {
  albedo: vec3f,
  normal: vec3f,
  depth: f32,
};

struct GBufferOutput {
  @location(0) albedo: vec4f,
  @location(1) normalDepth: vec4f,
};

@group(0) @binding(0) var<uniform> frame: Frame;

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  output.uv = positions[index] * 0.5 + vec2f(0.5);
  return output;
}

fn courtyardSurface(uv: vec2f) -> Surface {
  let p = uv * 2.0 - vec2f(1.0);
  var albedo = vec3f(0.16, 0.19, 0.18);
  var normal = normalize(vec3f(-p.x * 0.12, 0.64, 0.74));
  var depth = 5.8 + p.y * 2.2;
  let floorBands = fract((p.x + p.y * 0.45) * 11.0);
  if (floorBands < 0.035) { albedo = albedo * 0.52; }
  if (abs(p.x) > 0.73 - p.y * 0.09) {
    albedo = vec3f(0.095, 0.12, 0.115);
    normal = normalize(vec3f(-sign(p.x), 0.08, 0.72));
    depth = 8.8;
  }
  if (abs(p.x) < 0.16 && p.y > -0.12 && p.y < 0.42) {
    albedo = vec3f(0.28, 0.08, 0.035);
    normal = normalize(vec3f(p.x * 0.15, 0.34, 0.92));
    depth = 3.8;
  }
  if (abs(abs(p.x) - 0.42) < 0.042 && p.y > -0.36 && p.y < 0.34) {
    albedo = vec3f(0.95, 0.34, 0.045);
    normal = normalize(vec3f(p.x * 0.75, 0.15, 0.62));
    depth = 4.5;
  }
  if (abs(p.x) < 0.29 && p.y > 0.26) {
    albedo = vec3f(0.045, 0.48, 0.39);
    normal = vec3f(0.0, 0.0, 1.0);
    depth = 9.9;
  }
  return Surface(albedo, normal, max(0.45, depth));
}

@fragment
fn fragment(input: VertexOutput) -> GBufferOutput {
  let surface = courtyardSurface(input.uv);
  var output: GBufferOutput;
  output.albedo = vec4f(surface.albedo, 1.0);
  output.normalDepth = vec4f(surface.normal, surface.depth);
  return output;
}
`;

export const CLUSTER_ASSIGN_WGSL = /* wgsl */ `
struct Frame {
  resolutionTime: vec4f,
  modeViewCounts: vec4f,
  depthGridScene: vec4f,
};
struct Light { positionRadius: vec4f, colorIntensity: vec4f, };

@group(0) @binding(0) var<storage, read> lights: array<Light>;
@group(0) @binding(1) var<storage, read_write> headers: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> overflow: array<atomic<u32>>;
@group(0) @binding(4) var<uniform> frame: Frame;

fn depthAt(slice: u32) -> f32 {
  let nearDepth = frame.depthGridScene.x;
  let farDepth = frame.depthGridScene.y;
  let zCount = u32(frame.depthGridScene.z);
  return nearDepth * pow(farDepth / nearDepth, f32(slice) / f32(zCount));
}

fn lightIntersectsCluster(light: Light, cluster: u32) -> bool {
  let xCount = u32(frame.modeViewCounts.z);
  let yCount = u32(frame.modeViewCounts.w);
  let layer = xCount * yCount;
  let z = cluster / layer;
  let local = cluster % layer;
  let y = local / xCount;
  let x = local % xCount;
  let xMin = f32(x) / f32(xCount) * 2.0 - 1.0;
  let xMax = f32(x + 1u) / f32(xCount) * 2.0 - 1.0;
  let yMin = f32(y) / f32(yCount) * 2.0 - 1.0;
  let yMax = f32(y + 1u) / f32(yCount) * 2.0 - 1.0;
  let zMin = depthAt(z);
  let zMax = depthAt(z + 1u);
  let point = light.positionRadius.xyz;
  let nearest = vec3f(
    clamp(point.x, xMin, xMax),
    clamp(point.y, yMin, yMax),
    clamp(point.z, zMin, zMax),
  );
  let delta = point - nearest;
  return dot(delta, delta) <= light.positionRadius.w * light.positionRadius.w;
}

@compute @workgroup_size(64)
fn assign(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_id) local: vec3u) {
  let xCount = u32(frame.modeViewCounts.z);
  let yCount = u32(frame.modeViewCounts.w);
  let zCount = u32(frame.depthGridScene.z);
  let cluster = group.x;
  let totalClusters = xCount * yCount * zCount;
  let capacity = u32(frame.depthGridScene.w);
  if (cluster >= totalClusters) { return; }
  let header = cluster * 2u;
  if (local.x == 0u) {
    atomicStore(&headers[header], cluster * capacity);
    atomicStore(&headers[header + 1u], 0u);
  }
  workgroupBarrier();
  let lightCount = u32(frame.resolutionTime.w);
  var lightIndex = local.x;
  loop {
    if (lightIndex >= lightCount) { break; }
    if (lightIntersectsCluster(lights[lightIndex], cluster)) {
      let slot = atomicAdd(&headers[header + 1u], 1u);
      if (slot < capacity) {
        indices[cluster * capacity + slot] = lightIndex;
      } else {
        atomicAdd(&overflow[0], 1u);
      }
    }
    lightIndex += 64u;
  }
}
`;

export const LIGHTING_WGSL = /* wgsl */ `
struct Frame {
  resolutionTime: vec4f,
  modeViewCounts: vec4f,
  depthGridScene: vec4f,
};
struct Light { positionRadius: vec4f, colorIntensity: vec4f, };
struct Header { offset: u32, count: u32, };
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f, };

@group(0) @binding(0) var albedoTexture: texture_2d<f32>;
@group(0) @binding(1) var normalDepthTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> lights: array<Light>;
@group(0) @binding(3) var<storage, read> headers: array<Header>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
@group(0) @binding(5) var<uniform> frame: Frame;

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  output.uv = positions[index] * 0.5 + vec2f(0.5);
  return output;
}

fn depthSlice(depth: f32) -> u32 {
  let nearDepth = frame.depthGridScene.x;
  let farDepth = frame.depthGridScene.y;
  let zCount = u32(frame.depthGridScene.z);
  let normalized = log(clamp(depth, nearDepth, farDepth) / nearDepth) / log(farDepth / nearDepth);
  return min(zCount - 1u, u32(floor(normalized * f32(zCount))));
}

fn clusterIndex(uv: vec2f, depth: f32) -> u32 {
  let xCount = u32(frame.modeViewCounts.z);
  let yCount = u32(frame.modeViewCounts.w);
  let x = min(xCount - 1u, u32(floor(clamp(uv.x, 0.0, 0.99999) * f32(xCount))));
  let y = min(yCount - 1u, u32(floor(clamp(uv.y, 0.0, 0.99999) * f32(yCount))));
  return depthSlice(depth) * xCount * yCount + y * xCount + x;
}

fn shade(light: Light, normal: vec3f, depth: f32, uv: vec2f) -> vec3f {
  let position = vec3f(uv * 2.0 - vec2f(1.0), depth);
  let delta = light.positionRadius.xyz - position;
  let distance = length(delta);
  let direction = delta / max(distance, 0.0001);
  let attenuation = max(0.0, 1.0 - distance / light.positionRadius.w);
  let energy = attenuation * attenuation * max(0.0, dot(normal, direction));
  return light.colorIntensity.xyz * light.colorIntensity.w * energy;
}

fn palette(value: f32) -> vec3f {
  let t = clamp(value, 0.0, 1.0);
  return mix(vec3f(0.02, 0.08, 0.09), vec3f(0.98, 0.54, 0.08), t);
}

fn toneMap(color: vec3f) -> vec3f {
  let mapped = color / (color + vec3f(1.0));
  return pow(mapped, vec3f(1.0 / 2.2));
}

@fragment
fn fragment(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = textureDimensions(albedoTexture);
  let maxX = i32(dimensions.x) - 1;
  let maxY = i32(dimensions.y) - 1;
  let x = min(maxX, i32(floor(input.uv.x * f32(dimensions.x))));
  let y = min(maxY, i32(floor(input.uv.y * f32(dimensions.y))));
  let pixel = vec2i(max(0, x), max(0, y));
  let albedo = textureLoad(albedoTexture, pixel, 0).rgb;
  let normalDepth = textureLoad(normalDepthTexture, pixel, 0);
  let normal = normalize(normalDepth.rgb);
  let depth = normalDepth.a;
  let mode = u32(frame.modeViewCounts.x);
  let view = u32(frame.modeViewCounts.y);
  let count = u32(frame.resolutionTime.w);
  let cluster = clusterIndex(input.uv, depth);
  if (view == 1u) return vec4f(mix(albedo, normal * 0.5 + vec3f(0.5), 0.36), 1.0);
  if (view == 2u) return vec4f(palette(f32(depthSlice(depth)) / max(1.0, frame.depthGridScene.z - 1.0)), 1.0);
  if (view == 3u) {
    let heat = f32(min(headers[cluster].count, u32(frame.depthGridScene.w))) / max(1.0, frame.depthGridScene.w);
    return vec4f(palette(heat), 1.0);
  }
  var lighting = vec3f(0.018, 0.025, 0.023);
  if (mode < 2u) {
    for (var index = 0u; index < count; index += 1u) {
      lighting += shade(lights[index], normal, depth, input.uv);
    }
  } else {
    let header = headers[cluster];
    let safeCount = min(header.count, u32(frame.depthGridScene.w));
    for (var entry = 0u; entry < safeCount; entry += 1u) {
      lighting += shade(lights[indices[header.offset + entry]], normal, depth, input.uv);
    }
  }
  return vec4f(toneMap(lighting * albedo), 1.0);
}
`;
