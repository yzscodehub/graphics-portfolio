const FULLSCREEN_VERTEX = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  var output: VertexOutput;
  let position = positions[index];
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * 0.5 + vec2f(0.5);
  return output;
}
`;

const PARAMS = /* wgsl */ `
struct Params {
  resolutionTime: vec4f,
  jitterPrevious: vec4f,
  modesFrame: vec4f,
  display: vec4f,
}
@group(0) @binding(0) var<uniform> params: Params;
`;

export const GBUFFER_WGSL = /* wgsl */ `
${FULLSCREEN_VERTEX}
${PARAMS}

struct GBufferOutput {
  @location(0) albedoMetalness: vec4f,
  @location(1) normalRoughness: vec4f,
  @location(2) velocity: vec2f,
  @location(3) linearDepth: f32,
  @builtin(frag_depth) deviceDepth: f32,
}

fn sphereHit(origin: vec3f, direction: vec3f, center: vec3f, radius: f32) -> f32 {
  let oc = origin - center;
  let b = dot(oc, direction);
  let c = dot(oc, oc) - radius * radius;
  let discriminant = b * b - c;
  if (discriminant < 0.0) { return -1.0; }
  return -b - sqrt(discriminant);
}

@fragment fn fs(input: VertexOutput) -> GBufferOutput {
  let resolution = params.resolutionTime.xy;
  let time = params.resolutionTime.z;
  let previousTime = params.resolutionTime.w;
  let jitter = params.jitterPrevious.xy;
  let previousJitter = params.jitterPrevious.zw;
  let uv = clamp(input.uv + jitter, vec2f(0.0), vec2f(0.99999));
  let aspect = resolution.x / max(resolution.y, 1.0);
  let screen = (uv * 2.0 - 1.0) * vec2f(aspect, 1.0);
  let origin = vec3f(0.0, 0.35, -4.4);
  let direction = normalize(vec3f(screen.x, -screen.y, 1.8));

  let movingCenter = vec3f(sin(time * 0.7) * 0.38 - 0.55, -0.26, 0.52);
  let previousCenter = vec3f(sin(previousTime * 0.7) * 0.38 - 0.55, -0.26, 0.52);
  let staticCenter = vec3f(0.92, -0.48, 1.08);
  let movingT = sphereHit(origin, direction, movingCenter, 0.72);
  let staticT = sphereHit(origin, direction, staticCenter, 0.51);
  let planeT = select(-1.0, (-1.0 - origin.y) / direction.y, abs(direction.y) > 0.0001);

  var distance = 1e6;
  var normal = vec3f(0.0, 1.0, 0.0);
  var albedo = vec3f(0.17, 0.2, 0.19);
  var roughness = 0.82;
  var metalness = 0.04;
  var velocity = jitter - previousJitter;

  if (planeT > 0.001 && planeT < distance) {
    distance = planeT;
    let point = origin + direction * distance;
    let checker = f32((i32(floor(point.x * 1.5)) + i32(floor(point.z * 1.5))) & 1);
    albedo = mix(vec3f(0.11, 0.16, 0.15), vec3f(0.2, 0.25, 0.22), checker);
  }
  if (movingT > 0.001 && movingT < distance) {
    distance = movingT;
    normal = normalize(origin + direction * movingT - movingCenter);
    albedo = vec3f(0.08, 0.76, 0.61);
    roughness = 0.28;
    metalness = 0.72;
    velocity += vec2f((movingCenter.x - previousCenter.x) * 0.08, 0.0);
  }
  if (staticT > 0.001 && staticT < distance) {
    distance = staticT;
    normal = normalize(origin + direction * staticT - staticCenter);
    albedo = vec3f(0.92, 0.48, 0.12);
    roughness = 0.6;
    metalness = 0.05;
  }
  if (distance > 99999.0) { discard; }

  var output: GBufferOutput;
  output.albedoMetalness = vec4f(albedo, metalness);
  output.normalRoughness = vec4f(normal * 0.5 + 0.5, roughness);
  output.velocity = velocity;
  output.linearDepth = clamp(distance / 12.0, 0.0, 1.0);
  output.deviceDepth = clamp(distance / 12.0, 0.0001, 0.9999);
  return output;
}
`;

export const SHADOW_MAP_WGSL = /* wgsl */ `
${FULLSCREEN_VERTEX}
${PARAMS}

fn sphereTop(position: vec2f, center: vec3f, radius: f32) -> f32 {
  let offset = position - center.xz;
  let distanceSquared = dot(offset, offset);
  if (distanceSquared >= radius * radius) { return -1.0; }
  return center.y + sqrt(radius * radius - distanceSquared);
}

@fragment fn fs(input: VertexOutput) -> @location(0) f32 {
  let time = params.resolutionTime.z;
  let worldXZ = (clamp(input.uv, vec2f(0.0), vec2f(1.0)) * 2.0 - 1.0) * 3.2;
  let movingCenter = vec3f(sin(time * 0.7) * 0.38 - 0.55, -0.26, 0.52);
  let staticCenter = vec3f(0.92, -0.48, 1.08);
  var height = -1.0;
  height = max(height, sphereTop(worldXZ, movingCenter, 0.72));
  height = max(height, sphereTop(worldXZ, staticCenter, 0.51));
  return clamp((6.0 - height) / 8.0, 0.0, 1.0);
}
`;

export const LIGHTING_WGSL = /* wgsl */ `
${FULLSCREEN_VERTEX}
struct Params {
  resolutionTime: vec4f,
  jitterPrevious: vec4f,
  modesFrame: vec4f,
  display: vec4f,
}
@group(0) @binding(0) var albedoMetalnessTexture: texture_2d<f32>;
@group(0) @binding(1) var normalRoughnessTexture: texture_2d<f32>;
@group(0) @binding(2) var linearDepthTexture: texture_2d<f32>;
@group(0) @binding(3) var shadowDepthTexture: texture_2d<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn shadowSample(worldPosition: vec3f) -> f32 {
  let dimensions = vec2i(textureDimensions(shadowDepthTexture));
  let uv = worldPosition.xz / 6.4 + vec2f(0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let center = vec2i(uv * vec2f(dimensions));
  let receiverDepth = (6.0 - worldPosition.y) / 8.0 - 0.0025;
  let mode = i32(params.modesFrame.x + 0.5);
  if (mode == 0) {
    let stored = textureLoad(shadowDepthTexture, clamp(center, vec2i(0), dimensions - 1), 0).x;
    return select(0.0, 1.0, receiverDepth <= stored);
  }

  var radius = 1;
  if (mode == 2) {
    var blockerDepth = 0.0;
    var blockerCount = 0.0;
    for (var y = -3; y <= 3; y = y + 1) {
      for (var x = -3; x <= 3; x = x + 1) {
        let sampleDepth = textureLoad(
          shadowDepthTexture,
          clamp(center + vec2i(x, y), vec2i(0), dimensions - 1),
          0
        ).x;
        if (sampleDepth < receiverDepth) {
          blockerDepth += sampleDepth;
          blockerCount += 1.0;
        }
      }
    }
    if (blockerCount > 0.0) {
      let averageBlocker = blockerDepth / blockerCount;
      radius = clamp(i32(1.0 + (receiverDepth - averageBlocker) * 180.0), 1, 4);
    }
  }

  var visible = 0.0;
  var sampleCount = 0.0;
  for (var y = -4; y <= 4; y = y + 1) {
    for (var x = -4; x <= 4; x = x + 1) {
      if (abs(x) <= radius && abs(y) <= radius) {
        let stored = textureLoad(
          shadowDepthTexture,
          clamp(center + vec2i(x, y), vec2i(0), dimensions - 1),
          0
        ).x;
        visible += select(0.0, 1.0, receiverDepth <= stored);
        sampleCount += 1.0;
      }
    }
  }
  return visible / max(sampleCount, 1.0);
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(albedoMetalnessTexture));
  let coordinate = clamp(vec2i(input.uv * vec2f(dimensions)), vec2i(0), dimensions - 1);
  let albedoMetalness = textureLoad(albedoMetalnessTexture, coordinate, 0);
  let normalRoughness = textureLoad(normalRoughnessTexture, coordinate, 0);
  let depth = textureLoad(linearDepthTexture, coordinate, 0).x;
  if (depth >= 0.9999) { return vec4f(0.015, 0.025, 0.028, 1.0); }

  let resolution = params.resolutionTime.xy;
  let uv = clamp(input.uv + params.jitterPrevious.xy, vec2f(0.0), vec2f(0.9999));
  let aspect = resolution.x / max(resolution.y, 1.0);
  let screen = (uv * 2.0 - 1.0) * vec2f(aspect, 1.0);
  let origin = vec3f(0.0, 0.35, -4.4);
  let direction = normalize(vec3f(screen.x, -screen.y, 1.8));
  let worldPosition = origin + direction * depth * 12.0;
  let normal = normalize(normalRoughness.xyz * 2.0 - 1.0);
  let roughness = normalRoughness.w;
  let metalness = albedoMetalness.w;
  let albedo = albedoMetalness.xyz;
  let lightPosition = vec3f(0.0, 6.0, 0.0);
  let lightDirection = normalize(lightPosition - worldPosition);
  let viewDirection = normalize(origin - worldPosition);
  let halfDirection = normalize(lightDirection + viewDirection);
  let nDotL = max(dot(normal, lightDirection), 0.0);
  let specularPower = mix(96.0, 8.0, roughness);
  let specular = pow(max(dot(normal, halfDirection), 0.0), specularPower);
  let visibility = shadowSample(worldPosition);
  let diffuse = albedo * nDotL * visibility * (1.0 - metalness * 0.58);
  let reflected = mix(vec3f(0.04), albedo, metalness) * specular * visibility;
  let environment = albedo * (0.06 + 0.08 * max(normal.y, 0.0));
  return vec4f(environment + diffuse * 3.1 + reflected * 2.2, 1.0);
}
`;

export const SSAO_WGSL = /* wgsl */ `
${FULLSCREEN_VERTEX}
@group(0) @binding(0) var depthTexture: texture_2d<f32>;
@group(0) @binding(1) var normalTexture: texture_2d<f32>;

@fragment fn fs(input: VertexOutput) -> @location(0) f32 {
  let dimensions = vec2i(textureDimensions(depthTexture));
  let coordinate = clamp(vec2i(input.uv * vec2f(dimensions)), vec2i(0), dimensions - 1);
  let centerDepth = textureLoad(depthTexture, coordinate, 0).x;
  if (centerDepth >= 0.9999) { return 1.0; }
  let normal = normalize(textureLoad(normalTexture, coordinate, 0).xyz * 2.0 - 1.0);
  var occlusion = 0.0;
  var samples = 0.0;
  for (var y = -2; y <= 2; y = y + 2) {
    for (var x = -2; x <= 2; x = x + 2) {
      if (x != 0 || y != 0) {
        let sampleDepth = textureLoad(depthTexture, clamp(coordinate + vec2i(x, y), vec2i(0), dimensions - 1), 0).x;
        let delta = centerDepth - sampleDepth;
        occlusion += smoothstep(0.002, 0.045, delta) * (0.65 + 0.35 * (1.0 - abs(normal.z)));
        samples += 1.0;
      }
    }
  }
  return clamp(1.0 - occlusion / max(samples, 1.0), 0.25, 1.0);
}
`;

export const RESOLVE_WGSL = /* wgsl */ `
${FULLSCREEN_VERTEX}
struct Params {
  resolutionTime: vec4f,
  jitterPrevious: vec4f,
  modesFrame: vec4f,
  display: vec4f,
}
@group(0) @binding(0) var lightingTexture: texture_2d<f32>;
@group(0) @binding(1) var velocityTexture: texture_2d<f32>;
@group(0) @binding(2) var currentDepthTexture: texture_2d<f32>;
@group(0) @binding(3) var historyTexture: texture_2d<f32>;
@group(0) @binding(4) var historyDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;
@group(0) @binding(6) var<uniform> params: Params;

struct ResolveOutput {
  @location(0) color: vec4f,
  @location(1) depth: f32,
}

fn fxaa(uv: vec2f, texel: vec2f) -> vec3f {
  let center = textureSampleLevel(lightingTexture, linearSampler, uv, 0.0).rgb;
  let north = textureSampleLevel(lightingTexture, linearSampler, uv + vec2f(0.0, -texel.y), 0.0).rgb;
  let south = textureSampleLevel(lightingTexture, linearSampler, uv + vec2f(0.0, texel.y), 0.0).rgb;
  let east = textureSampleLevel(lightingTexture, linearSampler, uv + vec2f(texel.x, 0.0), 0.0).rgb;
  let west = textureSampleLevel(lightingTexture, linearSampler, uv + vec2f(-texel.x, 0.0), 0.0).rgb;
  let average = (north + south + east + west) * 0.25;
  let centerLuma = dot(center, vec3f(0.299, 0.587, 0.114));
  let averageLuma = dot(average, vec3f(0.299, 0.587, 0.114));
  let blend = smoothstep(0.025, 0.16, abs(centerLuma - averageLuma));
  return mix(center, average, blend * 0.72);
}

@fragment fn fs(input: VertexOutput) -> ResolveOutput {
  let dimensions = vec2i(textureDimensions(lightingTexture));
  let texel = 1.0 / vec2f(dimensions);
  let coordinate = clamp(vec2i(input.uv * vec2f(dimensions)), vec2i(0), dimensions - 1);
  let currentDepth = textureLoad(currentDepthTexture, coordinate, 0).x;
  let aaMode = i32(params.modesFrame.y + 0.5);
  var current = textureLoad(lightingTexture, coordinate, 0).rgb;
  if (aaMode == 1) { current = fxaa(input.uv, texel); }

  if (aaMode == 2 && params.modesFrame.w > 0.5) {
    let velocity = textureLoad(velocityTexture, coordinate, 0).xy;
    let previousUV = clamp(input.uv - velocity, vec2f(0.0), vec2f(0.9999));
    let previousCoordinate = clamp(vec2i(previousUV * vec2f(dimensions)), vec2i(0), dimensions - 1);
    let previousDepth = textureLoad(historyDepthTexture, previousCoordinate, 0).x;
    var history = textureSampleLevel(historyTexture, linearSampler, previousUV, 0.0).rgb;
    var neighborhoodMin = current;
    var neighborhoodMax = current;
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let sampleColor = textureLoad(lightingTexture, clamp(coordinate + vec2i(x, y), vec2i(0), dimensions - 1), 0).rgb;
        neighborhoodMin = min(neighborhoodMin, sampleColor);
        neighborhoodMax = max(neighborhoodMax, sampleColor);
      }
    }
    history = clamp(history, neighborhoodMin, neighborhoodMax);
    let depthValid = abs(currentDepth - previousDepth) < 0.025;
    current = mix(current, history, select(0.0, 0.9, depthValid));
  }

  var output: ResolveOutput;
  output.color = vec4f(current, 1.0);
  output.depth = currentDepth;
  return output;
}
`;

export const DISPLAY_WGSL = /* wgsl */ `
${FULLSCREEN_VERTEX}
struct Params {
  resolutionTime: vec4f,
  jitterPrevious: vec4f,
  modesFrame: vec4f,
  display: vec4f,
}
@group(0) @binding(0) var albedoTexture: texture_2d<f32>;
@group(0) @binding(1) var normalTexture: texture_2d<f32>;
@group(0) @binding(2) var depthTexture: texture_2d<f32>;
@group(0) @binding(3) var velocityTexture: texture_2d<f32>;
@group(0) @binding(4) var lightingTexture: texture_2d<f32>;
@group(0) @binding(5) var ssaoTexture: texture_2d<f32>;
@group(0) @binding(6) var resolvedTexture: texture_2d<f32>;
@group(0) @binding(7) var linearSampler: sampler;
@group(0) @binding(8) var<uniform> params: Params;

fn aces(color: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(albedoTexture));
  let coordinate = clamp(vec2i(input.uv * vec2f(dimensions)), vec2i(0), dimensions - 1);
  let view = i32(params.display.x + 0.5);
  var color = vec3f(0.0);
  if (view == 1) {
    let albedoMetalness = textureLoad(albedoTexture, coordinate, 0);
    let metalnessRamp = mix(vec3f(0.02, 0.05, 0.06), vec3f(1.0, 0.64, 0.12), albedoMetalness.w);
    // The right-hand strip is alpha (metalness), so the packed channel is
    // inspectable without hiding the RGB albedo field.
    color = select(albedoMetalness.rgb, metalnessRamp, input.uv.x >= 0.72);
  } else if (view == 2) {
    let normalRoughness = textureLoad(normalTexture, coordinate, 0);
    let roughnessRamp = mix(vec3f(0.03, 0.05, 0.07), vec3f(0.92, 0.93, 0.9), normalRoughness.w);
    // The right-hand strip is alpha (roughness); RGB remains the encoded
    // normal field across the rest of the attachment.
    color = select(normalRoughness.rgb, roughnessRamp, input.uv.x >= 0.72);
  } else if (view == 3) {
    color = vec3f(textureLoad(depthTexture, coordinate, 0).x);
  } else if (view == 4) {
    color = vec3f(0.5 + textureLoad(velocityTexture, coordinate, 0).xy * 12.0, 0.5);
  } else if (view == 5) {
    color = aces(textureLoad(lightingTexture, coordinate, 0).rgb);
  } else if (view == 6) {
    color = vec3f(textureLoad(ssaoTexture, coordinate, 0).x);
  } else if (view == 7) {
    // History is the resolved linear HDR attachment itself, without the Final
    // view's SSAO display modulation. This makes Frame Inspector provenance
    // match the Temporal Resolve writer reported in the UI.
    color = pow(aces(textureSampleLevel(resolvedTexture, linearSampler, input.uv, 0.0).rgb), vec3f(1.0 / 2.2));
  } else {
    let resolved = textureSampleLevel(resolvedTexture, linearSampler, input.uv, 0.0).rgb;
    let ao = textureLoad(ssaoTexture, coordinate, 0).x;
    color = pow(aces(resolved * mix(0.55, 1.0, ao)), vec3f(1.0 / 2.2));
  }
  return vec4f(color, 1.0);
}
`;
