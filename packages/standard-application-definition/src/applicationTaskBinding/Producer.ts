import { Effect, Result } from "effect";

import type { PreparedStandardApplicationDefinitionV1 } from "../v1.js";
import {
  encodeCanonicalTaskManifestPreimageV1,
} from "../taskDefinition/Canonical.js";
import {
  hashCanonicalTaskCatalogV1,
} from "../taskDefinition/Digest.js";
import type {
  InvalidStandardApplicationTaskDefinitionV1Error,
  StandardApplicationTaskSha256ResourceV1Error,
} from "../taskDefinition/Errors.js";
import type {
  HashedCanonicalTaskCatalogV1,
} from "../taskDefinition/Model.js";
import type {
  StandardApplicationTaskSha256V1,
} from "../taskDefinition/Sha256.js";
import {
  decodeApplicationTaskCatalogBindingV1,
  decodeApplicationTaskDefinitionBindingV1,
  encodeApplicationTaskCatalogBindingPreimageV1,
  encodeApplicationTaskDefinitionBindingPreimageV1,
} from "./Canonical.js";
import {
  hashApplicationTaskCatalogBindingV1,
  hashApplicationTaskDefinitionBindingV1,
} from "./Digest.js";
import {
  ApplicationTaskBindingSha256InvariantV1Defect,
  InvalidApplicationTaskBindingV1Error,
  type ApplicationTaskBindingReasonV1,
} from "./Errors.js";
import type {
  ApplicationTaskBindingAuthorityV1,
  ApplicationTaskRuntimeHostPolicyV1,
  PreparedApplicationTaskBindingsV1,
} from "./Model.js";

export type ProduceApplicationTaskBindingsV1Error =
  | InvalidApplicationTaskBindingV1Error
  | InvalidStandardApplicationTaskDefinitionV1Error
  | StandardApplicationTaskSha256ResourceV1Error;

export const produceApplicationTaskBindingsV1 = Effect.fn(
  "ApplicationTaskBinding.produceV1",
)(function* (
  input: Readonly<{
    readonly definition: PreparedStandardApplicationDefinitionV1;
    readonly catalog: HashedCanonicalTaskCatalogV1;
    readonly authority: ApplicationTaskBindingAuthorityV1;
    readonly runtimePolicy: ApplicationTaskRuntimeHostPolicyV1;
  }>,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  PreparedApplicationTaskBindingsV1,
  ProduceApplicationTaskBindingsV1Error
> {
  const rehashedCatalog = yield* hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: input.catalog.entries.map(entry => entry.manifest),
  }, sha256).pipe(
    Effect.catchTag("StandardApplicationTaskSha256InputV1Error", error =>
      Effect.die(new ApplicationTaskBindingSha256InvariantV1Defect({
        operation: "produce",
        reason: error.reason,
      }))
    ),
  );
  if (!catalogsEqual(input.catalog, rehashedCatalog)) {
    return yield* invalid("catalogDigestMismatch", "catalog");
  }

  const catalogBinding = yield* Effect.fromResult(
    decodeApplicationTaskCatalogBindingV1({
      version: 1,
      ...input.authority,
      ...input.runtimePolicy,
      taskCatalogSha256: rehashedCatalog.taskCatalogSha256,
      taskCount: rehashedCatalog.entries.length,
    }).pipe(Result.mapError(error => reoperation(error))),
  );
  const catalogCanonicalBytes = yield* Effect.fromResult(
    encodeApplicationTaskCatalogBindingPreimageV1(catalogBinding).pipe(
      Result.mapError(error => reoperation(error)),
    ),
  );
  const catalogBindingSha256 = yield* hashApplicationTaskCatalogBindingV1(
    catalogBinding,
    sha256,
  );

  const sourceEntries = new Map<string, string>(
    input.definition.artifactIngressPlan.source.functionEntries.map(entry => [
      entry.logicalModulePath,
      entry.artifactModulePath,
    ] as const),
  );
  const sourcePaths = new Set<string>(
    input.definition.artifactIngressPlan.source.modules.map(module => module.path),
  );
  const definitions: PreparedApplicationTaskBindingsV1["definitions"][number][] = [];
  for (const entry of rehashedCatalog.entries) {
    const expectedSourcePath = sourceEntries.get(
      entry.manifest.handler.logicalModulePath,
    );
    if (expectedSourcePath === undefined) {
      return yield* invalid(
        "handlerMappingMissing",
        `tasks[${entry.taskId}].handler.logicalModulePath`,
      );
    }
    if (expectedSourcePath !== entry.manifest.handler.artifactModulePath) {
      return yield* invalid(
        "handlerMappingMismatch",
        `tasks[${entry.taskId}].handler.sourceModulePath`,
      );
    }
    if (!sourcePaths.has(expectedSourcePath)) {
      return yield* invalid(
        "sourceModuleMissing",
        `tasks[${entry.taskId}].handler.sourceModulePath`,
      );
    }
    const binding = yield* Effect.fromResult(
      decodeApplicationTaskDefinitionBindingV1({
        version: 1,
        applicationTaskCatalogBindingSha256: catalogBindingSha256,
        taskId: entry.taskId,
        canonicalTaskManifestSha256: entry.canonicalTaskManifestSha256,
        handler: {
          logicalModulePath: entry.manifest.handler.logicalModulePath,
          sourceModulePath: expectedSourcePath,
          exportName: entry.manifest.handler.exportName,
        },
      }).pipe(Result.mapError(error => reoperation(error))),
    );
    const canonicalBytes = yield* Effect.fromResult(
      encodeApplicationTaskDefinitionBindingPreimageV1(binding).pipe(
        Result.mapError(error => reoperation(error)),
      ),
    );
    const bindingSha256 = yield* hashApplicationTaskDefinitionBindingV1(
      binding,
      sha256,
    );
    const canonicalManifestBytes = yield* Effect.fromResult(
      encodeCanonicalTaskManifestPreimageV1(entry.manifest),
    );
    definitions.push(Object.freeze({
      binding,
      canonicalBytes,
      sha256: bindingSha256,
      manifest: entry.manifest,
      canonicalManifestBytes,
    }));
  }

  return Object.freeze({
    catalog: Object.freeze({
      binding: catalogBinding,
      canonicalBytes: catalogCanonicalBytes,
      sha256: catalogBindingSha256,
    }),
    definitions: Object.freeze(definitions),
  });
});

function catalogsEqual(
  left: HashedCanonicalTaskCatalogV1,
  right: HashedCanonicalTaskCatalogV1,
): boolean {
  if (
    left.version !== right.version || left.entries.length !== right.entries.length ||
    !bytesEqual(left.taskCatalogSha256, right.taskCatalogSha256)
  ) return false;
  for (let index = 0; index < left.entries.length; index += 1) {
    const leftEntry = left.entries[index];
    const rightEntry = right.entries[index];
    if (
      leftEntry === undefined || rightEntry === undefined ||
      leftEntry.taskId !== rightEntry.taskId ||
      !bytesEqual(
        leftEntry.canonicalTaskManifestSha256,
        rightEntry.canonicalTaskManifestSha256,
      )
    ) return false;
  }
  return true;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function invalid(
  reason: ApplicationTaskBindingReasonV1,
  path?: string,
): Effect.Effect<never, InvalidApplicationTaskBindingV1Error> {
  return Effect.fail(new InvalidApplicationTaskBindingV1Error({
    operation: "produce",
    reason,
    ...(path === undefined ? {} : { path }),
  }));
}

function reoperation(
  error: InvalidApplicationTaskBindingV1Error,
): InvalidApplicationTaskBindingV1Error {
  return new InvalidApplicationTaskBindingV1Error({
    operation: "produce",
    reason: error.reason,
    ...(error.path === undefined ? {} : { path: error.path }),
  });
}
