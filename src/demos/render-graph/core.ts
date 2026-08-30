export type ResourceKind = "buffer" | "texture";
export type ResourceUsage =
  | "copy-dst"
  | "copy-src"
  | "depth-attachment"
  | "present"
  | "render-attachment"
  | "sampled"
  | "storage-read"
  | "storage-write";

export interface ResourceDesc {
  id: string;
  kind: ResourceKind;
  format: string;
  width?: number;
  height?: number;
  size?: number;
  sampleCount?: number;
  external?: boolean;
  persistent?: boolean;
  present?: boolean;
  transient?: boolean;
}

export interface Access {
  resource: string;
  usage: ResourceUsage;
  /** Reads default to the latest version defined before the pass. */
  version?: number;
}

export interface PassDesc {
  id: string;
  label: string;
  enabled?: boolean;
  sideEffect?: boolean;
  reads?: Access[];
  writes?: Access[];
}

export interface RenderGraphDefinition {
  resources: ResourceDesc[];
  passes: PassDesc[];
}

export interface GraphDiagnostic {
  code:
    | "cycle"
    | "duplicate-pass"
    | "duplicate-resource"
    | "invalid-resource"
    | "missing-producer"
    | "no-root-pass"
    | "unknown-resource"
    | "unknown-version";
  message: string;
  passIds?: string[];
  resource?: string;
  severity: "error" | "warning";
}

export interface CompiledAccess extends Access {
  version: number;
  versionId: string;
}

export interface CompiledPass {
  dependencies: string[];
  id: string;
  label: string;
  reads: CompiledAccess[];
  writes: CompiledAccess[];
}

export interface ResourceUse {
  passId: string;
  usage: ResourceUsage;
}

export interface CompiledResourceVersion {
  aliasSlot?: number;
  descriptor: ResourceDesc;
  firstUse: number;
  id: string;
  lastUse: number;
  readers: string[];
  uses: ResourceUse[];
  version: number;
  writer?: string;
}

export interface AliasSlot {
  descriptor: ResourceDesc;
  id: number;
  resourceVersions: string[];
}

/** A logical WebGPU usage transition. The backend may satisfy this implicitly. */
export interface UsageTransition {
  from: ResourceUsage;
  fromPass: string;
  resourceVersion: string;
  to: ResourceUsage;
  toPass: string;
}

export interface RenderGraphPlan {
  aliasSlots: AliasSlot[];
  culledPassIds: string[];
  passes: CompiledPass[];
  resourceVersions: CompiledResourceVersion[];
  usageTransitions: UsageTransition[];
}

export interface RenderGraphCompileResult {
  diagnostics: GraphDiagnostic[];
  plan?: RenderGraphPlan;
}

interface MutableVersion {
  descriptor: ResourceDesc;
  id: string;
  readers: string[];
  uses: ResourceUse[];
  version: number;
  writer?: string;
}

interface MutablePass {
  dependencies: Set<string>;
  declarationIndex: number;
  desc: PassDesc;
  reads: CompiledAccess[];
  writes: CompiledAccess[];
}

export function compileRenderGraph(definition: RenderGraphDefinition): RenderGraphCompileResult {
  const diagnostics: GraphDiagnostic[] = [];
  const resources = new Map<string, ResourceDesc>();
  definition.resources.forEach((resource) => {
    if (!resource.id || resources.has(resource.id)) {
      diagnostics.push({
        code: resources.has(resource.id) ? "duplicate-resource" : "invalid-resource",
        message: `Resource '${resource.id || "(unnamed)"}' is not uniquely named.`,
        resource: resource.id,
        severity: "error",
      });
      return;
    }
    if (!isValidDescriptor(resource)) {
      diagnostics.push({
        code: "invalid-resource",
        message: `Resource '${resource.id}' has an incomplete descriptor.`,
        resource: resource.id,
        severity: "error",
      });
      return;
    }
    resources.set(resource.id, resource);
  });

  const passes = new Map<string, MutablePass>();
  definition.passes.forEach((pass, declarationIndex) => {
    if (!pass.id || passes.has(pass.id)) {
      diagnostics.push({
        code: "duplicate-pass",
        message: `Pass '${pass.id || "(unnamed)"}' is not uniquely named.`,
        passIds: pass.id ? [pass.id] : undefined,
        severity: "error",
      });
      return;
    }
    passes.set(pass.id, {
      declarationIndex,
      dependencies: new Set(),
      desc: pass,
      reads: [],
      writes: [],
    });
  });

  if (hasErrors(diagnostics)) return { diagnostics };

  const versions = new Map<string, MutableVersion>();
  const latestVersions = new Map<string, number>();
  resources.forEach((resource) => {
    if (!resource.external) return;
    latestVersions.set(resource.id, 0);
    versions.set(versionId(resource.id, 0), {
      descriptor: resource,
      id: versionId(resource.id, 0),
      readers: [],
      uses: [],
      version: 0,
    });
  });

  const allPasses = Array.from(passes.values()).sort(
    (left, right) => left.declarationIndex - right.declarationIndex,
  );
  const writesByPass = new Map<string, Map<string, CompiledAccess>>();
  allPasses.forEach((pass) => {
    const writes = new Map<string, CompiledAccess>();
    (pass.desc.writes ?? []).forEach((access) => {
      const resource = resources.get(access.resource);
      if (!resource) {
        diagnostics.push(unknownResourceDiagnostic(pass.desc.id, access.resource));
        return;
      }
      if (writes.has(access.resource)) {
        diagnostics.push({
          code: "invalid-resource",
          message: `Pass '${pass.desc.id}' writes '${access.resource}' more than once.`,
          passIds: [pass.desc.id],
          resource: access.resource,
          severity: "error",
        });
        return;
      }
      const nextVersion = (latestVersions.get(access.resource) ?? 0) + 1;
      latestVersions.set(access.resource, nextVersion);
      const compiled = {
        ...access,
        version: nextVersion,
        versionId: versionId(access.resource, nextVersion),
      };
      writes.set(access.resource, compiled);
      versions.set(compiled.versionId, {
        descriptor: resource,
        id: compiled.versionId,
        readers: [],
        uses: [{ passId: pass.desc.id, usage: access.usage }],
        version: nextVersion,
        writer: pass.desc.id,
      });
    });
    writesByPass.set(pass.desc.id, writes);
  });

  const latestBeforePass = new Map<string, number>();
  resources.forEach((resource) => {
    if (resource.external) latestBeforePass.set(resource.id, 0);
  });
  allPasses.forEach((pass) => {
    (pass.desc.reads ?? []).forEach((access) => {
      const resource = resources.get(access.resource);
      if (!resource) {
        diagnostics.push(unknownResourceDiagnostic(pass.desc.id, access.resource));
        return;
      }
      const resolvedVersion = access.version ?? latestBeforePass.get(access.resource);
      if (resolvedVersion === undefined) {
        diagnostics.push({
          code: "missing-producer",
          message: `Pass '${pass.desc.id}' reads '${access.resource}' before any producer.`,
          passIds: [pass.desc.id],
          resource: access.resource,
          severity: "error",
        });
        return;
      }
      const resolvedId = versionId(access.resource, resolvedVersion);
      const version = versions.get(resolvedId);
      if (!version) {
        diagnostics.push({
          code: "unknown-version",
          message: `Pass '${pass.desc.id}' reads unknown version '${resolvedId}'.`,
          passIds: [pass.desc.id],
          resource: access.resource,
          severity: "error",
        });
        return;
      }
      const compiled = { ...access, version: resolvedVersion, versionId: resolvedId };
      pass.reads.push(compiled);
      version.readers.push(pass.desc.id);
      version.uses.push({ passId: pass.desc.id, usage: access.usage });
      if (version.writer && version.writer !== pass.desc.id) pass.dependencies.add(version.writer);
    });

    const writes = writesByPass.get(pass.desc.id);
    writes?.forEach((access) => {
      pass.writes.push(access);
      const priorVersion = versions.get(versionId(access.resource, access.version - 1));
      if (priorVersion?.writer && priorVersion.writer !== pass.desc.id)
        pass.dependencies.add(priorVersion.writer);
      latestBeforePass.set(access.resource, access.version);
    });
  });

  if (hasErrors(diagnostics)) return { diagnostics };

  const enabledPasses = allPasses.filter((pass) => pass.desc.enabled !== false);
  const enabledIds = new Set(enabledPasses.map((pass) => pass.desc.id));
  enabledPasses.forEach((pass) => {
    pass.dependencies.forEach((dependency) => {
      if (!enabledIds.has(dependency)) {
        diagnostics.push({
          code: "missing-producer",
          message: `Pass '${pass.desc.id}' requires disabled producer '${dependency}'.`,
          passIds: [pass.desc.id, dependency],
          severity: "error",
        });
      }
    });
  });
  if (hasErrors(diagnostics)) return { diagnostics };

  const cycle = findCycle(enabledPasses);
  if (cycle) {
    diagnostics.push({
      code: "cycle",
      message: `Render graph contains a dependency cycle: ${cycle.join(" -> ")}.`,
      passIds: cycle,
      severity: "error",
    });
    return { diagnostics };
  }

  const roots = enabledPasses.filter(
    (pass) =>
      pass.desc.sideEffect ||
      pass.writes.some((access) => resources.get(access.resource)?.present === true),
  );
  if (!roots.length)
    diagnostics.push({
      code: "no-root-pass",
      message: "No enabled Present or side-effect pass anchors the compiled graph.",
      severity: "warning",
    });

  const liveIds = new Set<string>();
  const visitDependencies = (pass: MutablePass): void => {
    if (liveIds.has(pass.desc.id)) return;
    liveIds.add(pass.desc.id);
    pass.dependencies.forEach((dependency) => {
      const producer = passes.get(dependency);
      if (producer) visitDependencies(producer);
    });
  };
  roots.forEach(visitDependencies);
  const livePasses = enabledPasses.filter((pass) => liveIds.has(pass.desc.id));
  const sortedPasses = topologicalSort(livePasses);
  const orderByPass = new Map(sortedPasses.map((pass, index) => [pass.desc.id, index]));
  const compiledPasses = sortedPasses.map<CompiledPass>((pass) => ({
    dependencies: Array.from(pass.dependencies).filter((dependency) => liveIds.has(dependency)),
    id: pass.desc.id,
    label: pass.desc.label,
    reads: pass.reads,
    writes: pass.writes,
  }));
  const resourceVersions = compileResourceVersions(versions, liveIds, orderByPass);
  const aliasSlots = assignAliasSlots(resourceVersions);
  const usageTransitions = buildUsageTransitions(resourceVersions, orderByPass);

  return {
    diagnostics,
    plan: {
      aliasSlots,
      culledPassIds: enabledPasses
        .filter((pass) => !liveIds.has(pass.desc.id))
        .map((pass) => pass.desc.id),
      passes: compiledPasses,
      resourceVersions,
      usageTransitions,
    },
  };
}

export function versionId(resource: string, version: number): string {
  return `${resource}@${version}`;
}

function unknownResourceDiagnostic(passId: string, resource: string): GraphDiagnostic {
  return {
    code: "unknown-resource",
    message: `Pass '${passId}' references unknown resource '${resource}'.`,
    passIds: [passId],
    resource,
    severity: "error",
  };
}

function isValidDescriptor(resource: ResourceDesc): boolean {
  if (!resource.format) return false;
  if (resource.kind === "buffer") return (resource.size ?? 0) > 0;
  return (resource.width ?? 0) > 0 && (resource.height ?? 0) > 0;
}

function hasErrors(diagnostics: GraphDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function findCycle(passes: MutablePass[]): string[] | undefined {
  const passMap = new Map(passes.map((pass) => [pass.desc.id, pass]));
  const colors = new Map<string, "done" | "visiting">();
  const stack: string[] = [];
  const visit = (passId: string): string[] | undefined => {
    const state = colors.get(passId);
    if (state === "visiting") return [...stack.slice(stack.indexOf(passId)), passId];
    if (state === "done") return undefined;
    colors.set(passId, "visiting");
    stack.push(passId);
    const pass = passMap.get(passId);
    for (const dependency of pass?.dependencies ?? []) {
      if (!passMap.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    colors.set(passId, "done");
    return undefined;
  };
  for (const pass of passes) {
    const cycle = visit(pass.desc.id);
    if (cycle) return cycle;
  }
  return undefined;
}

function topologicalSort(passes: MutablePass[]): MutablePass[] {
  const passMap = new Map(passes.map((pass) => [pass.desc.id, pass]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  passes.forEach((pass) => {
    const dependencies = Array.from(pass.dependencies).filter((id) => passMap.has(id));
    indegree.set(pass.desc.id, dependencies.length);
    dependencies.forEach((dependency) => {
      const next = dependents.get(dependency) ?? [];
      next.push(pass.desc.id);
      dependents.set(dependency, next);
    });
  });
  const ready = passes.filter((pass) => indegree.get(pass.desc.id) === 0);
  const sorted: MutablePass[] = [];
  while (ready.length) {
    ready.sort((left, right) => left.declarationIndex - right.declarationIndex);
    const pass = ready.shift()!;
    sorted.push(pass);
    (dependents.get(pass.desc.id) ?? []).forEach((dependent) => {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) ready.push(passMap.get(dependent)!);
    });
  }
  return sorted;
}

function compileResourceVersions(
  versions: Map<string, MutableVersion>,
  liveIds: Set<string>,
  orderByPass: Map<string, number>,
): CompiledResourceVersion[] {
  const compiled: CompiledResourceVersion[] = [];
  for (const resource of versions.values()) {
    const uses = resource.uses.filter((use) => liveIds.has(use.passId));
    const positions = uses
      .map((use) => orderByPass.get(use.passId))
      .filter((position): position is number => position !== undefined);
    if (!positions.length) continue;
    compiled.push({
      descriptor: resource.descriptor,
      firstUse: Math.min(...positions),
      id: resource.id,
      lastUse: Math.max(...positions),
      readers: resource.readers.filter((reader) => liveIds.has(reader)),
      uses,
      version: resource.version,
      ...(resource.writer ? { writer: resource.writer } : {}),
    });
  }
  return compiled.sort(
    (left, right) => left.firstUse - right.firstUse || left.id.localeCompare(right.id),
  );
}

function assignAliasSlots(resourceVersions: CompiledResourceVersion[]): AliasSlot[] {
  interface MutableAliasSlot extends AliasSlot {
    lastUse: number;
  }
  const slots: MutableAliasSlot[] = [];
  resourceVersions.forEach((resource) => {
    if (!isTransient(resource.descriptor)) return;
    const reusable = slots.find(
      (slot) =>
        slot.lastUse < resource.firstUse &&
        descriptorsAreCompatible(slot.descriptor, resource.descriptor),
    );
    const slot =
      reusable ??
      ({
        descriptor: resource.descriptor,
        id: slots.length,
        lastUse: resource.lastUse,
        resourceVersions: [],
      } satisfies MutableAliasSlot);
    if (!reusable) slots.push(slot);
    slot.lastUse = resource.lastUse;
    slot.resourceVersions.push(resource.id);
    resource.aliasSlot = slot.id;
  });
  return slots.map(({ descriptor, id, resourceVersions }) => ({
    descriptor,
    id,
    resourceVersions,
  }));
}

function isTransient(resource: ResourceDesc): boolean {
  return resource.transient ?? !(resource.external || resource.persistent || resource.present);
}

function descriptorsAreCompatible(left: ResourceDesc, right: ResourceDesc): boolean {
  return (
    left.kind === right.kind &&
    left.format === right.format &&
    left.width === right.width &&
    left.height === right.height &&
    left.size === right.size &&
    left.sampleCount === right.sampleCount
  );
}

function buildUsageTransitions(
  resourceVersions: CompiledResourceVersion[],
  orderByPass: Map<string, number>,
): UsageTransition[] {
  const transitions: UsageTransition[] = [];
  resourceVersions.forEach((resource) => {
    const uses = [...resource.uses].sort(
      (left, right) => (orderByPass.get(left.passId) ?? 0) - (orderByPass.get(right.passId) ?? 0),
    );
    for (let index = 1; index < uses.length; index += 1) {
      const previous = uses[index - 1];
      const next = uses[index];
      if (previous.usage === next.usage || previous.passId === next.passId) continue;
      transitions.push({
        from: previous.usage,
        fromPass: previous.passId,
        resourceVersion: resource.id,
        to: next.usage,
        toPass: next.passId,
      });
    }
  });
  return transitions;
}
