import { canonicalizeApplicationManifestWire } from "@flarex/analysis/application-analysis";
import { Data, Effect, Result } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import type { CoreApplicationCandidate, CoreApplicationCoreProfile } from "flarex-protocol/internal/core-application";
import type { CoreActiveDeploymentStatus } from "flarex-protocol/deployment";
import type { DeploymentAnalysis, DeploymentCodegenAnalysis, DeploymentCodegenModule, PushSourcePackage, PushState, PushStatus } from "./types";

export class BackendCoreApplicationMetadataError extends Data.TaggedError("BackendCoreApplicationMetadataError")<{
  readonly reason: "invalidManifest" | "unsupportedManifest" | "sourceMismatch";
  readonly cause?: unknown;
}> {}

const invalidManifest = (cause: unknown) => new BackendCoreApplicationMetadataError({ reason: "invalidManifest", cause });

/** Public presentation derives from the same authenticated candidate used by Core. */
export const projectBackendCoreApplicationCandidate = Effect.fn("BackendCoreApplication.projectCandidate")(function* (
  candidate: CoreApplicationCandidate,
) {
  const wire = yield* Effect.fromResult(Result.try({
    try: (): unknown => JSON.parse(candidate.canonicalManifest), catch: invalidManifest,
  }));
  const canonical = yield* Effect.fromResult(canonicalizeApplicationManifestWire(wire).pipe(Result.mapError(invalidManifest)));
  if (canonical.canonicalText !== candidate.canonicalManifest)
    return yield* new BackendCoreApplicationMetadataError({ reason: "invalidManifest" });
  const manifest = canonical.manifest;
  if (manifest.version !== 1 || manifest.functions.some(fn => fn.kind !== "query" && fn.kind !== "mutation"
    || fn.partition !== null) || manifest.schema.tables.some(table => table.placement.kind !== "global"))
    return yield* new BackendCoreApplicationMetadataError({ reason: "unsupportedManifest" });
  if (manifest.sourceArtifact.rootSha256 !== candidate.sourceArtifactRootSha256
    || manifest.sourceArtifact.executionModulePath !== candidate.sourcePackage.execution
    || manifest.sourceArtifact.schemaModulePath !== (candidate.sourcePackage.schema ?? null)
    || candidate.sourcePackage.authConfigModule !== undefined)
    return yield* new BackendCoreApplicationMetadataError({ reason: "sourceMismatch" });

  const sourcePackage: PushSourcePackage = {
    modules: candidate.sourcePackage.modules.map(module => ({ path: module.path, environment: module.environment, sha256: module.sha256,
      ...(module.source === undefined ? {} : { source: module.source }),
      ...(module.sourceMap === undefined ? {} : { sourceMap: module.sourceMap }),
    })),
    functions: [...candidate.sourcePackage.functions],
    execution: candidate.sourcePackage.execution,
    ...(candidate.sourcePackage.sourceModuleDigestFormat === undefined ? {} : { sourceModuleDigestFormat: candidate.sourcePackage.sourceModuleDigestFormat }),
    ...(candidate.sourcePackage.schema === undefined ? {} : { schema: candidate.sourcePackage.schema }),
    ...(candidate.sourcePackage.authConfig === undefined ? {} : { authConfig: candidate.sourcePackage.authConfig }),
  };
  // Reuse the package digest owner; a finalized R2 root is a distinct identity.
  const reference = yield* Effect.tryPromise({ try: () => executionArtifactRefForSourcePackage(sourcePackage),
    catch: cause => new BackendCoreApplicationMetadataError({ reason: "sourceMismatch", cause }) });
  if (reference.sourcePackageHash !== candidate.sourcePackageHash)
    return yield* new BackendCoreApplicationMetadataError({ reason: "sourceMismatch" });

  // These are authenticated declaration identities for public analysis/codegen.
  // Kernel table numbers and binary index identities remain at Core execution.
  const schema = { version: manifest.schema.version,
    tables: manifest.schema.tables.map(table => ({ ...table })),
    indexes: manifest.schema.indexes.map(index => ({ indexId: index.indexId, tableId: index.tableId, name: index.name, fields: [...index.fields],
      ...(index.decimalFields === undefined ? {} : { decimalFields: [...index.decimalFields] }) })),
  };
  const analysis: DeploymentAnalysis = { schema, functions: { functions: manifest.functions.map(fn => ({
    path: fn.path, kind: fn.kind, visibility: fn.visibility, args: fn.args, returns: fn.returns,
  })) } };
  const modules = new Map<string, DeploymentCodegenModule>();
  for (const fn of manifest.functions) {
    let module = modules.get(fn.moduleName);
    if (module === undefined) {
      module = { moduleName: fn.moduleName, functions: [] };
      modules.set(fn.moduleName, module);
    }
    module.functions.push({ moduleName: fn.moduleName, exportName: fn.exportName,
      kind: fn.kind, visibility: fn.visibility, args: fn.args, returns: fn.returns });
  }
  const codegenAnalysis: DeploymentCodegenAnalysis = { schema, functions: [...modules.values()] };
  const push: PushStatus = { storageProfile: "core_application", pushId: candidate.pushId, state: publicPushState(candidate.state),
    sourcePackage, analysis, codegenAnalysis, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt,
    indexesReady: candidate.indexesReady,
    ...(candidate.error === undefined ? {} : { error: candidate.error }),
  };
  const profile: CoreApplicationCoreProfile = { format: "flarex.core-application.profile", version: 1, kind: "core",
    route: candidate.route, sourceArtifactRootSha256: candidate.sourceArtifactRootSha256,
    sourcePackageHash: candidate.sourcePackageHash };
  const active: CoreActiveDeploymentStatus = { storageProfile: "core_application", activePushId: candidate.pushId,
    activatedAt: candidate.updatedAt, schemaVersion: schema.version, sourceArtifactRootSha256: candidate.sourceArtifactRootSha256,
    sourcePackageHash: candidate.sourcePackageHash, sourcePackage, analysis, codegenAnalysis };
  return { push, profile, active };
});

function publicPushState(state: CoreApplicationCandidate["state"]): PushState {
  switch (state) {
    case "pending": case "validated": return "analyzed";
    case "active": return "activated";
    case "failed": return "failed";
    case "abandoned": return "abandoned";
    case "superseded": return "superseded";
  }
}
