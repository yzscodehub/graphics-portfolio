export const RESEARCH_COURTYARD_REFERENCE_WGSL = /* wgsl */ `
struct Frame {
  viewProjection: mat4x4f,
  cameraExposure: vec4f,
  sunDirectionIntensity: vec4f,
  sunColor: vec4f,
  diffuseSh: array<vec4f, 9>,
};

struct Draw {
  materialIndex: u32,
  instanceOffset: u32,
  normalEncoding: u32,
  debugMode: u32,
};

struct Material {
  baseColor: vec4f,
  emissive: vec3f,
  metallic: f32,
  roughness: f32,
  alphaCutoff: f32,
  normalScale: f32,
  flags: u32,
  baseColorTexture: u32,
  normalTexture: u32,
  ormTexture: u32,
  padding: u32,
};

struct Instance {
  current0: vec4f,
  current1: vec4f,
  current2: vec4f,
  previous0: vec4f,
  previous1: vec4f,
  previous2: vec4f,
  materialIndex: u32,
  meshIndex: u32,
  flags: u32,
  sphereX: f32,
  sphereY: f32,
  sphereZ: f32,
  sphereRadius: f32,
  padding: u32,
};

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normalOct: vec2f,
  @location(2) tangent: vec4f,
  @location(3) uv: vec2f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) worldTangent: vec4f,
  @location(3) uv: vec2f,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> materials: array<Material>;
@group(0) @binding(2) var<storage, read> instances: array<Instance>;
@group(0) @binding(3) var<uniform> draw: Draw;
@group(0) @binding(4) var baseColorTexture: texture_2d<f32>;
@group(0) @binding(5) var normalTexture: texture_2d<f32>;
@group(0) @binding(6) var ormTexture: texture_2d<f32>;
@group(0) @binding(7) var materialSampler: sampler;

fn decodeOct(value: vec2f) -> vec3f {
  var normal = vec3f(value, 1.0 - abs(value.x) - abs(value.y));
  if (normal.z < 0.0) {
    normal.xy = (vec2f(1.0) - abs(normal.yx)) * sign(normal.xy);
  }
  return normalize(normal);
}

fn transformPoint(instance: Instance, value: vec3f) -> vec3f {
  return vec3f(
    dot(instance.current0.xyz, value) + instance.current0.w,
    dot(instance.current1.xyz, value) + instance.current1.w,
    dot(instance.current2.xyz, value) + instance.current2.w,
  );
}

fn transformDirection(instance: Instance, value: vec3f) -> vec3f {
  return normalize(vec3f(
    dot(instance.current0.xyz, value),
    dot(instance.current1.xyz, value),
    dot(instance.current2.xyz, value),
  ));
}

@vertex
fn vertexMain(input: VertexInput, @builtin(instance_index) localInstance: u32) -> VertexOutput {
  let instance = instances[draw.instanceOffset + localInstance];
  let worldPosition = transformPoint(instance, input.position);
  let normal = transformDirection(instance, decodeOct(input.normalOct));
  let tangent = transformDirection(instance, input.tangent.xyz);
  var output: VertexOutput;
  output.position = frame.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.worldNormal = normal;
  output.worldTangent = vec4f(tangent, input.tangent.w);
  output.uv = input.uv;
  return output;
}

fn evaluateDiffuseSh(normal: vec3f) -> vec3f {
  let x = normal.x;
  let y = normal.y;
  let z = normal.z;
  var result = frame.diffuseSh[0].xyz * 0.2820947918;
  result += frame.diffuseSh[1].xyz * (0.4886025119 * y);
  result += frame.diffuseSh[2].xyz * (0.4886025119 * z);
  result += frame.diffuseSh[3].xyz * (0.4886025119 * x);
  result += frame.diffuseSh[4].xyz * (1.0925484306 * x * y);
  result += frame.diffuseSh[5].xyz * (1.0925484306 * y * z);
  result += frame.diffuseSh[6].xyz * (0.3153915653 * (3.0 * y * y - 1.0));
  result += frame.diffuseSh[7].xyz * (1.0925484306 * x * z);
  result += frame.diffuseSh[8].xyz * (0.5462742153 * (x * x - z * z));
  return max(result, vec3f(0.0));
}

fn distributionGgx(normal: vec3f, halfway: vec3f, roughness: f32) -> f32 {
  let alpha = roughness * roughness;
  let alpha2 = alpha * alpha;
  let ndh = max(dot(normal, halfway), 0.0);
  let denominator = ndh * ndh * (alpha2 - 1.0) + 1.0;
  return alpha2 / max(3.14159265 * denominator * denominator, 0.00001);
}

fn geometrySchlick(value: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return value / max(value * (1.0 - k) + k, 0.00001);
}

fn fresnelSchlick(cosine: f32, f0: vec3f) -> vec3f {
  return f0 + (vec3f(1.0) - f0) * pow(1.0 - cosine, 5.0);
}

fn aces(value: vec3f) -> vec3f {
  return clamp(
    value * (2.51 * value + vec3f(0.03)) /
      (value * (2.43 * value + vec3f(0.59)) + vec3f(0.14)),
    vec3f(0.0),
    vec3f(1.0),
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let material = materials[draw.materialIndex];
  let baseSample = textureSample(baseColorTexture, materialSampler, input.uv);
  let baseColor = baseSample.rgb * material.baseColor.rgb;
  let alpha = baseSample.a * material.baseColor.a;
  if ((material.flags & 1u) != 0u && alpha < material.alphaCutoff) {
    discard;
  }

  let normalSample = textureSample(normalTexture, materialSampler, input.uv);
  var tangentNormal: vec3f;
  if (draw.normalEncoding == 1u) {
    let xy = normalSample.ga * 2.0 - vec2f(1.0);
    tangentNormal = normalize(vec3f(xy, sqrt(max(0.0, 1.0 - dot(xy, xy)))));
  } else {
    tangentNormal = normalize(normalSample.xyz * 2.0 - vec3f(1.0));
  }
  tangentNormal = normalize(vec3f(
    tangentNormal.xy * material.normalScale,
    tangentNormal.z,
  ));
  let geometricNormal = normalize(input.worldNormal);
  let tangent = normalize(input.worldTangent.xyz);
  let bitangent = normalize(cross(geometricNormal, tangent)) * input.worldTangent.w;
  let normal = normalize(
    tangent * tangentNormal.x +
      bitangent * tangentNormal.y +
      geometricNormal * tangentNormal.z,
  );

  let orm = textureSample(ormTexture, materialSampler, input.uv).rgb;
  let roughness = clamp(material.roughness * orm.g, 0.045, 1.0);
  let metallic = clamp(material.metallic * orm.b, 0.0, 1.0);
  let viewDirection = normalize(frame.cameraExposure.xyz - input.worldPosition);
  let lightDirection = normalize(frame.sunDirectionIntensity.xyz);
  let halfway = normalize(viewDirection + lightDirection);
  let ndl = max(dot(normal, lightDirection), 0.0);
  let ndv = max(dot(normal, viewDirection), 0.0);
  let f0 = mix(vec3f(0.04), baseColor, metallic);
  let fresnel = fresnelSchlick(max(dot(halfway, viewDirection), 0.0), f0);
  let distribution = distributionGgx(normal, halfway, roughness);
  let geometry =
    geometrySchlick(ndv, roughness) * geometrySchlick(ndl, roughness);
  let specular =
    (distribution * geometry * fresnel) / max(4.0 * ndv * ndl, 0.0001);
  let diffuse = (vec3f(1.0) - fresnel) * (1.0 - metallic) *
    baseColor / 3.14159265;
  let direct = (diffuse + specular) * frame.sunColor.rgb *
    frame.sunDirectionIntensity.w * ndl;
  let indirect = evaluateDiffuseSh(normal) * baseColor * (1.0 - metallic);
  var color = direct + indirect + material.emissive;

  if (draw.debugMode == 1u) { color = normal * 0.5 + vec3f(0.5); }
  if (draw.debugMode == 2u) { color = vec3f(roughness); }
  if (draw.debugMode == 3u) { color = vec3f(metallic); }

  color = aces(color * frame.cameraExposure.w);
  return vec4f(pow(color, vec3f(1.0 / 2.2)), alpha);
}
`;
