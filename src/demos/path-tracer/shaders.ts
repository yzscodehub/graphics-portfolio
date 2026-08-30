export const PATH_COMPUTE_WGSL = /* wgsl */ `
struct Triangle {
  v0: vec4f,
  v1: vec4f,
  v2: vec4f,
  data: vec4f,
}
struct BvhNode {
  boundsMin: vec4f,
  boundsMax: vec4f,
  meta: vec4u,
}
struct Material {
  colorType: vec4f,
  params: vec4f,
}
struct Params {
  resolutionFrameBounces: vec4f,
  cameraRevision: vec4f,
}
struct Hit {
  distance: f32,
  triangle: i32,
  geometricNormal: vec3f,
}

@group(0) @binding(0) var previousAccumulation: texture_2d<f32>;
@group(0) @binding(1) var outputAccumulation: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(3) var<storage, read> nodes: array<BvhNode>;
@group(0) @binding(4) var<storage, read> materials: array<Material>;
@group(0) @binding(5) var<uniform> params: Params;

fn hash(value: vec3f) -> f32 {
  return fract(sin(dot(value, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
}

fn random2(seed: vec3f) -> vec2f {
  return vec2f(hash(seed), hash(seed.yzx + vec3f(19.19, 3.17, 11.73)));
}

fn intersectTriangle(origin: vec3f, direction: vec3f, triangle: Triangle) -> f32 {
  let edge1 = triangle.v1.xyz - triangle.v0.xyz;
  let edge2 = triangle.v2.xyz - triangle.v0.xyz;
  let p = cross(direction, edge2);
  let determinant = dot(edge1, p);
  if (abs(determinant) < 1e-7) { return -1.0; }
  let inverse = 1.0 / determinant;
  let t = origin - triangle.v0.xyz;
  let u = dot(t, p) * inverse;
  if (u < 0.0 || u > 1.0) { return -1.0; }
  let q = cross(t, edge1);
  let v = dot(direction, q) * inverse;
  if (v < 0.0 || u + v > 1.0) { return -1.0; }
  let distance = dot(edge2, q) * inverse;
  return select(-1.0, distance, distance > 0.0001);
}

fn intersectsBounds(origin: vec3f, inverseDirection: vec3f, minimum: vec3f, maximum: vec3f, limit: f32) -> bool {
  let first = (minimum - origin) * inverseDirection;
  let second = (maximum - origin) * inverseDirection;
  let nearVector = min(first, second);
  let farVector = max(first, second);
  let nearDistance = max(max(nearVector.x, nearVector.y), max(nearVector.z, 0.0));
  let farDistance = min(min(farVector.x, farVector.y), min(farVector.z, limit));
  return farDistance >= nearDistance;
}

fn trace(origin: vec3f, direction: vec3f, maximumDistance: f32) -> Hit {
  var closest = Hit(maximumDistance, -1, vec3f(0.0));
  var stack: array<i32, 64>;
  var stackSize = 1;
  stack[0] = 0;
  let inverseDirection = 1.0 / direction;
  for (var iteration = 0; iteration < 128 && stackSize > 0; iteration = iteration + 1) {
    stackSize = stackSize - 1;
    let nodeIndex = stack[stackSize];
    let node = nodes[nodeIndex];
    if (!intersectsBounds(origin, inverseDirection, node.boundsMin.xyz, node.boundsMax.xyz, closest.distance)) {
      continue;
    }
    if (node.meta.z == 1u) {
      for (var local = 0u; local < node.meta.y; local = local + 1u) {
        let triangleIndex = node.meta.x + local;
        let triangle = triangles[triangleIndex];
        let distance = intersectTriangle(origin, direction, triangle);
        if (distance > 0.0 && distance < closest.distance) {
          let geometricNormal = normalize(cross(triangle.v1.xyz - triangle.v0.xyz, triangle.v2.xyz - triangle.v0.xyz));
          closest = Hit(distance, i32(triangleIndex), geometricNormal);
        }
      }
    } else if (stackSize < 62) {
      stack[stackSize] = i32(node.meta.y);
      stack[stackSize + 1] = i32(node.meta.x);
      stackSize = stackSize + 2;
    }
  }
  return closest;
}

fn cosineHemisphere(normal: vec3f, random: vec2f) -> vec3f {
  let phi = 6.2831853 * random.x;
  let radius = sqrt(random.y);
  let z = sqrt(max(0.0, 1.0 - random.y));
  let tangent = normalize(cross(select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(normal.y) > 0.9), normal));
  let bitangent = cross(normal, tangent);
  return normalize(tangent * cos(phi) * radius + bitangent * sin(phi) * radius + normal * z);
}

fn schlick(cosine: f32, etaIncident: f32, etaTransmitted: f32) -> f32 {
  let r0 = ((etaIncident - etaTransmitted) / (etaIncident + etaTransmitted));
  let r0Squared = r0 * r0;
  return r0Squared + (1.0 - r0Squared) * pow(1.0 - cosine, 5.0);
}

fn directLight(position: vec3f, normal: vec3f, seed: vec3f) -> vec3f {
  let random = random2(seed);
  let lightPosition = vec3f(mix(-0.58, 0.58, random.x), 1.98, mix(1.05, 2.08, random.y));
  let toLight = lightPosition - position;
  let distanceSquared = dot(toLight, toLight);
  let distance = sqrt(distanceSquared);
  let direction = toLight / distance;
  let surfaceCosine = max(dot(normal, direction), 0.0);
  let lightCosine = max(dot(vec3f(0.0, -1.0, 0.0), -direction), 0.0);
  if (surfaceCosine <= 0.0 || lightCosine <= 0.0) { return vec3f(0.0); }
  let blocker = trace(position + normal * 0.002, direction, distance - 0.01);
  if (blocker.triangle >= 0) { return vec3f(0.0); }
  let area = 1.16 * 1.03;
  return vec3f(1.0, 0.92, 0.72) * 12.0 * surfaceCosine * lightCosine * area / max(distanceSquared, 0.01);
}

fn integrate(pixel: vec2u, frame: f32, bounces: i32) -> vec3f {
  let resolution = params.resolutionFrameBounces.xy;
  let random = random2(vec3f(vec2f(pixel), frame));
  let uv = (vec2f(pixel) + random) / resolution;
  let aspect = resolution.x / resolution.y;
  let screen = (uv * 2.0 - 1.0) * vec2f(aspect, 1.0);
  var origin = vec3f(0.0, 0.35, -4.5);
  var direction = normalize(vec3f(screen.x, -screen.y, 1.85));
  var throughput = vec3f(1.0);
  var radiance = vec3f(0.0);
  for (var bounce = 0; bounce < 4; bounce = bounce + 1) {
    if (bounce >= bounces) { break; }
    let hit = trace(origin, direction, 1e6);
    if (hit.triangle < 0) {
      radiance += throughput * vec3f(0.008, 0.012, 0.014);
      break;
    }
    let triangle = triangles[hit.triangle];
    let material = materials[i32(triangle.data.x + 0.5)];
    let materialType = i32(material.colorType.w + 0.5);
    let position = origin + direction * hit.distance;
    let frontFace = dot(direction, hit.geometricNormal) < 0.0;
    let shadingNormal = select(-hit.geometricNormal, hit.geometricNormal, frontFace);
    if (materialType == 3) {
      radiance += throughput * material.colorType.rgb * material.params.y;
      break;
    }
    let seed = vec3f(vec2f(pixel), frame + f32(bounce) * 97.0);
    if (materialType == 0) {
      radiance += throughput * material.colorType.rgb * directLight(position, shadingNormal, seed + 13.0);
      direction = cosineHemisphere(shadingNormal, random2(seed));
      throughput *= material.colorType.rgb;
      origin = position + shadingNormal * 0.002;
    } else if (materialType == 1) {
      let reflected = reflect(direction, shadingNormal);
      let diffuse = cosineHemisphere(shadingNormal, random2(seed));
      direction = normalize(mix(reflected, diffuse, material.params.x * material.params.x));
      throughput *= material.colorType.rgb;
      origin = position + shadingNormal * 0.002;
    } else {
      let etaIncident = select(material.params.z, 1.0, frontFace);
      let etaTransmitted = select(1.0, material.params.z, frontFace);
      let eta = etaIncident / etaTransmitted;
      let orientedNormal = shadingNormal;
      let cosine = clamp(-dot(direction, orientedNormal), 0.0, 1.0);
      let reflected = reflect(direction, orientedNormal);
      let refracted = refract(direction, orientedNormal, eta);
      let reflectProbability = schlick(cosine, etaIncident, etaTransmitted);
      direction = normalize(select(refracted, reflected, hash(seed) < reflectProbability || length(refracted) < 0.001));
      throughput *= material.colorType.rgb;
      origin = position + direction * 0.003;
    }
  }
  return radiance;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let resolution = vec2u(params.resolutionFrameBounces.xy);
  if (id.x >= resolution.x || id.y >= resolution.y) { return; }
  let frame = params.resolutionFrameBounces.z;
  let bounces = i32(params.resolutionFrameBounces.w + 0.5);
  let sample = integrate(id.xy, frame, bounces);
  let previous = textureLoad(previousAccumulation, vec2i(id.xy), 0).rgb;
  let average = mix(previous, sample, 1.0 / (frame + 1.0));
  textureStore(outputAccumulation, vec2i(id.xy), vec4f(average, 1.0));
}
`;

export const PATH_DISPLAY_WGSL = /* wgsl */ `
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@group(0) @binding(0) var accumulation: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;

@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  output.uv = positions[index] * 0.5 + vec2f(0.5);
  return output;
}

fn aces(color: vec3f) -> vec3f {
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let linear = textureSampleLevel(accumulation, linearSampler, input.uv, 0.0).rgb;
  return vec4f(pow(aces(linear), vec3f(1.0 / 2.2)), 1.0);
}
`;
