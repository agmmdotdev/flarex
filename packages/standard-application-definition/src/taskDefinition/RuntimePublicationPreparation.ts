import type {
  PreparedApplicationTaskBindingsV1,
} from "../applicationTaskBinding/Model.js";
import {
  hashApplicationTaskCatalogBindingV1,
  hashApplicationTaskDefinitionBindingV1,
} from "../applicationTaskBinding/Digest.js";
import type {
  InvalidApplicationTaskBindingV1Error,
} from "../applicationTaskBinding/Errors.js";
import type {
  TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type { StandardApplicationSource } from "../applicationSource.js";
import {
  hashApplicationRevisionTaskBindingFrameV1,
  hashCanonicalTaskCatalogV1,
} from "./Digest.js";
import type {
  StandardApplicationTaskSha256V1Error,
  StandardApplicationTaskSha256ResourceV1Error,
} from "./Errors.js";
import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import { encodeTaskRuntimeEntryPreimageV1 } from "./Canonical.js";
import {
  MAX_TASK_CATALOG_ENTRIES_V1,
  MAX_TASK_RUNTIME_COMPATIBILITY_FLAGS_V1,
  MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_MODULES_V1,
  MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1,
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  TASK_RUNTIME_ENTRY_CODEC_V1,
  TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1,
  TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  TASK_RUNTIME_PROJECTION_CODEC_V1,
  TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1,
  taskRuntimeObjectKeyV1,
  type ApplicationRevisionTaskBindingFrameV1,
  type HashedCanonicalTaskCatalogV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeEntryFrameV1,
  type TaskRuntimeGroupManifestFrameV1,
  type TaskRuntimeMaterializationSpecV1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
  type TaskRuntimeProjectionFrameV1,
  type TaskRuntimeProjectionModuleFrameV1,
  type SourceArtifactV2ModuleRolesV1,
  isSourceArtifactV2ModuleRolesV1,
} from "./Model.js";
import {
  encodeTaskRuntimeGroupManifestPreimageV1,
  encodeTaskRuntimeMaterializationSpecPreimageV1,
  encodeTaskRuntimeProjectionModulePreimageV1,
  encodeTaskRuntimeProjectionPreimageV1,
} from "./RuntimePublicationCanonical.js";
import {
  hashTaskRuntimeEntryRootV1,
  hashTaskRuntimeGroupManifestFrameV1,
  hashTaskRuntimeMaterializationSpecV1,
  hashTaskRuntimeProjectionModuleFrameV1,
  hashTaskRuntimeProjectionModuleRootV1,
  hashTaskRuntimeProjectionFrameV1,
} from "./RuntimePublicationDigest.js";
import {
  InvalidTaskRuntimePublicationV1Error,
} from "./RuntimePublicationErrors.js";
import {
  compareTaskRuntimeUtf8V1,
  decodeTaskRuntimeMaterializationSpecV1,
} from "./RuntimePublicationSchema.js";
import type { StandardApplicationTaskSha256V1 } from "./Sha256.js";

export interface AuthenticatedTaskRuntimeSourceModuleV1 {
  readonly ordinal: number;
  readonly artifactModulePath: string;
  readonly roles: SourceArtifactV2ModuleRolesV1;
  readonly sourceByteLength: number;
  readonly sourceSha256: TaskDefinitionSha256V1;
}

export interface TaskRuntimePublicationAuthorityV1 {
  readonly candidateId: string;
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly candidateSha256: TaskDefinitionSha256V1;
  readonly applicationRevisionId: string;
  readonly authenticatedModules:
    ReadonlyArray<AuthenticatedTaskRuntimeSourceModuleV1>;
}

export interface TaskRuntimePublicationPolicyV1 {
  readonly materialization: TaskRuntimeMaterializationSpecV1;
  readonly admittedCompatibilityDate: string;
  readonly admittedCompatibilityFlags: ReadonlyArray<string>;
  readonly admittedRuntimeImplementationVersion: string;
  readonly admittedComputeProfiles: ReadonlyArray<TaskComputeProfileRefV1>;
}

export interface TaskRuntimePublicationPreparationInputV1 {
  readonly source: StandardApplicationSource;
  readonly catalog: HashedCanonicalTaskCatalogV1;
  readonly taskBindings: PreparedApplicationTaskBindingsV1;
  readonly authority: TaskRuntimePublicationAuthorityV1;
  readonly policy: TaskRuntimePublicationPolicyV1;
}

export interface PreparedTaskRuntimeObjectV1 {
  readonly role: TaskRuntimeObjectRoleV1;
  readonly codecIdentity: string;
  readonly ordinal: bigint;
  readonly readCanonicalBytes: () => Uint8Array;
  readonly readReference: () => TaskRuntimeObjectReferenceV1;
}

interface PreparedTaskRuntimePublicationBaseV1 {
  readonly version: 1;
  readonly readApplicationRevisionTaskBindingSha256: () => TaskDefinitionSha256V1;
  readonly readApplicationRevisionTaskBinding: () => ApplicationRevisionTaskBindingFrameV1;
  readonly readReceiptPreimage: () => TaskRuntimePublicationReceiptPreimageV1;
  readonly objects: ReadonlyArray<PreparedTaskRuntimeObjectV1>;
  readonly canonicalByteLength: number;
}

export interface TaskRuntimePublicationReceiptPreimageV1 {
  readonly version: 1;
  readonly scopeId: string;
  readonly candidateId: string;
  readonly applicationRevisionId: string;
  readonly candidateSha256: TaskDefinitionSha256V1;
  readonly taskCatalogBindingSha256: TaskDefinitionSha256V1;
  readonly applicationRevisionTaskBindingSha256: TaskDefinitionSha256V1;
  readonly taskCatalogSha256: TaskDefinitionSha256V1;
  readonly taskEntryRootSha256: TaskDefinitionSha256V1;
  readonly taskRuntimeProjectionSha256: TaskDefinitionSha256V1 | null;
  readonly taskRuntimeGroupManifestSha256: TaskDefinitionSha256V1 | null;
  readonly taskRuntimeMaterializationSpecSha256: TaskDefinitionSha256V1 | null;
  readonly packageSha256: TaskDefinitionSha256V1;
  readonly artifactSha256: TaskDefinitionSha256V1;
  readonly sourceRootSha256: TaskDefinitionSha256V1;
  readonly semanticRootSha256: TaskDefinitionSha256V1;
  readonly runtimeObjects:
    ReadonlyArray<TaskRuntimePublicationReceiptObjectPreimageV1>;
}

export interface TaskRuntimePublicationReceiptObjectPreimageV1 {
  readonly ordinal: bigint;
  readonly codecIdentity: string;
  readonly reference: TaskRuntimeObjectReferenceV1;
}

export interface PreparedEmptyTaskRuntimePublicationV1
  extends PreparedTaskRuntimePublicationBaseV1 {
  readonly kind: "empty_catalog";
  readonly objects: readonly [];
  readonly canonicalByteLength: 0;
}

export interface PreparedPopulatedTaskRuntimePublicationV1
  extends PreparedTaskRuntimePublicationBaseV1 {
  readonly kind: "populated_catalog";
}

export type PreparedTaskRuntimePublicationV1 =
  | PreparedEmptyTaskRuntimePublicationV1
  | PreparedPopulatedTaskRuntimePublicationV1;

export interface CapturedPreparedTaskRuntimeObjectV1 {
  readonly role: TaskRuntimeObjectRoleV1;
  readonly codecIdentity: string;
  readonly ordinal: bigint;
  readonly canonicalBytes: Uint8Array;
  readonly reference: TaskRuntimeObjectReferenceV1;
}

export interface CapturedPreparedTaskRuntimePublicationV1 {
  readonly receipt: TaskRuntimePublicationReceiptPreimageV1;
  readonly objects: ReadonlyArray<PreparedTaskRuntimeObjectV1>;
}

const preparedObjectStates = new WeakMap<object, CapturedPreparedTaskRuntimeObjectV1>();
const preparedPublicationStates = new WeakMap<object, CapturedPreparedTaskRuntimePublicationV1>();

export function capturePreparedTaskRuntimeObjectV1(
  input: unknown,
): CapturedPreparedTaskRuntimeObjectV1 | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const state = preparedObjectStates.get(input);
  return state === undefined ? undefined : Object.freeze({
    role: state.role,
    codecIdentity: state.codecIdentity,
    ordinal: state.ordinal,
    canonicalBytes: copyBytes(state.canonicalBytes),
    reference: copyReference(state.reference),
  });
}

export function capturePreparedTaskRuntimePublicationV1(
  input: unknown,
): CapturedPreparedTaskRuntimePublicationV1 | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const state = preparedPublicationStates.get(input);
  return state === undefined ? undefined : Object.freeze({
    receipt: copyReceiptPreimage(state.receipt),
    objects: state.objects,
  });
}

export type PrepareTaskRuntimePublicationV1Error =
  | InvalidTaskRuntimePublicationV1Error<"prepare_publication">
  | StandardApplicationTaskSha256ResourceV1Error;

export class TaskRuntimePublicationPreparationInvariantV1Defect
  extends Data.TaggedError("TaskRuntimePublicationPreparationInvariantV1Defect")<{
    readonly reason: "invalid_hash_input";
  }> {}

/**
 * Builds a completely owned, immutable publication plan from already
 * authenticated Standard Application evidence. It performs no I/O.
 */
export const prepareTaskRuntimePublicationV1 = Effect.fn(
  "StandardApplicationTask.prepareRuntimePublicationV1",
)(function* (
  input: TaskRuntimePublicationPreparationInputV1,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  PreparedTaskRuntimePublicationV1,
  PrepareTaskRuntimePublicationV1Error
> {
  const captured = yield* Effect.fromResult(captureInput(input));
  const encodedCandidate = yield* Effect.fromResult(
    encodeDeclarativeV2PhysicalFrameV1(captured.authority.candidate, {
      maximumFrameBytes: 1_024 * 1_024,
      maximumCanonicalBytes: 1_024 * 1_024,
    }).pipe(Result.mapError(() => new InvalidTaskRuntimePublicationV1Error({
      operation: "prepare_publication",
      reason: "authenticated_evidence_mismatch",
      path: "authority.candidate",
    }))),
  );
  const candidateSha256 = yield* digestBytes(encodedCandidate.canonicalBytes, sha256);
  if (!bytesEqualFullScan(candidateSha256, captured.authority.candidateSha256)) {
    return yield* invalid(
      "authenticated_evidence_mismatch",
      "authority.candidateSha256",
    );
  }
  const rehashedCatalog = yield* hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: captured.catalog.entries.map(entry => entry.manifest),
  }, sha256).pipe(
    Effect.catchTag("StandardApplicationTaskSha256InputV1Error", error =>
      Effect.die(new TaskRuntimePublicationPreparationInvariantV1Defect({
        reason: error.reason === "invalidBudget"
          ? "invalid_hash_input"
          : "invalid_hash_input",
      }))
    ),
    Effect.catchTag("InvalidStandardApplicationTaskDefinitionV1Error", () =>
      invalid("task_binding_mismatch", "catalog")
    ),
  );
  if (!catalogsEqual(captured.catalog, rehashedCatalog)) {
    return yield* invalid("task_binding_mismatch", "catalog");
  }
  yield* correlateCatalogAndBindings(captured, sha256);

  if (captured.catalog.entries.length === 0) {
    const taskEntryRootSha256 = yield* prepareDigest(
      hashTaskRuntimeEntryRootV1([], sha256),
    );
    const applicationRevisionTaskBinding = makeApplicationRevisionTaskBinding(
      captured,
      taskEntryRootSha256,
      null,
      null,
      null,
    );
    const applicationRevisionTaskBindingSha256 = yield* hashApplicationBinding(
      applicationRevisionTaskBinding,
      sha256,
    );
    const publication = Object.freeze({
      kind: "empty_catalog" as const,
      version: 1 as const,
      readApplicationRevisionTaskBindingSha256: () =>
        copyDigest(applicationRevisionTaskBindingSha256),
      readApplicationRevisionTaskBinding: () =>
        copyApplicationRevisionTaskBinding(applicationRevisionTaskBinding),
      readReceiptPreimage: () => makeReceiptPreimage(
        captured,
        applicationRevisionTaskBinding,
        applicationRevisionTaskBindingSha256,
        [],
      ),
      objects: Object.freeze([]) as readonly [],
      canonicalByteLength: 0 as const,
    });
    preparedPublicationStates.set(publication, {
      receipt: publication.readReceiptPreimage(),
      objects: publication.objects,
    });
    return publication;
  }

  const materialization = yield* Effect.fromResult(
    decodeTaskRuntimeMaterializationSpecV1(captured.policy.materialization).pipe(
      Result.mapError(error => reoperation(error)),
    ),
  );
  if (
    captured.taskBindings.catalog.binding.compatibilityDate !==
      materialization.compatibilityDate ||
    materialization.compatibilityDate !==
      captured.policy.admittedCompatibilityDate ||
    materialization.runtimeImplementationVersion !==
      captured.policy.admittedRuntimeImplementationVersion ||
    !stringArraysEqual(
      materialization.compatibilityFlags,
      captured.policy.admittedCompatibilityFlags,
    ) ||
    !stringArraysEqual(
      materialization.supportedComputeProfiles,
      captured.policy.admittedComputeProfiles,
    ) ||
    captured.catalog.entries.some(entry =>
      !materialization.supportedComputeProfiles.includes(
        entry.manifest.computeProfile,
      )
    )
  ) {
    return yield* invalid("unsupported_materialization_policy", "policy");
  }
  const modules = yield* correlateAndBuildModules(captured, sha256);
  const moduleRoot = yield* prepareDigest(
    hashTaskRuntimeProjectionModuleRootV1(modules, sha256),
  );
  const executionModule = captured.source.executionPath;
  const projection = Object.freeze({
    kind: "task_runtime_projection" as const,
    group: "durable_task" as const,
    executionModule,
    moduleCount: BigInt(modules.length),
    rawByteLength: moduleRoot.rawByteLength,
    moduleRootSha256: copyDigest(moduleRoot.moduleRootSha256),
  });
  const projectionSha256 = yield* prepareDigest(
    hashTaskRuntimeProjectionFrameV1(projection, sha256),
  );

  const entries: TaskRuntimeEntryFrameV1[] = [];
  for (let index = 0; index < captured.catalog.entries.length; index += 1) {
    const catalogEntry = captured.catalog.entries[index]!;
    const definitionBinding = captured.taskBindings.definitions[index]!;
    entries.push(Object.freeze({
      kind: "task_runtime_entry" as const,
      taskOrdinal: BigInt(index),
      taskId: catalogEntry.taskId,
      canonicalTaskManifestSha256:
        copyDigest(catalogEntry.canonicalTaskManifestSha256),
      logicalExecutionModule: catalogEntry.manifest.handler.logicalModulePath,
      artifactExecutionModule: catalogEntry.manifest.handler.artifactModulePath,
      exportName: catalogEntry.manifest.handler.exportName,
      group: "durable_task" as const,
      projectionSha256: copyDigest(projectionSha256),
    }));
    if (
      definitionBinding.binding.taskId !== catalogEntry.taskId ||
      !bytesEqualFullScan(
        definitionBinding.binding.applicationTaskCatalogBindingSha256,
        captured.taskBindings.catalog.sha256,
      ) ||
      definitionBinding.binding.handler.logicalModulePath !==
        catalogEntry.manifest.handler.logicalModulePath ||
      definitionBinding.binding.handler.sourceModulePath !==
        catalogEntry.manifest.handler.artifactModulePath ||
      definitionBinding.binding.handler.exportName !==
        catalogEntry.manifest.handler.exportName ||
      !bytesEqualFullScan(
        definitionBinding.binding.canonicalTaskManifestSha256,
        catalogEntry.canonicalTaskManifestSha256,
      )
    ) {
      return yield* invalid(
        "task_binding_mismatch",
        `taskBindings.definitions[${index}]`,
      );
    }
  }

  const taskEntryRootSha256 = yield* prepareDigest(
    hashTaskRuntimeEntryRootV1(entries, sha256),
  );
  const materializationSha256 = yield* prepareDigest(
    hashTaskRuntimeMaterializationSpecV1(materialization, sha256),
  );
  const groupManifest = Object.freeze({
    kind: "task_runtime_group_manifest" as const,
    taskCatalogSha256: copyDigest(captured.catalog.taskCatalogSha256),
    taskCount: BigInt(entries.length),
    taskEntryRootSha256: copyDigest(taskEntryRootSha256),
    taskRuntimeProjectionSha256: copyDigest(projectionSha256),
    taskRuntimeMaterializationSpecSha256: copyDigest(materializationSha256),
  });
  const groupManifestSha256 = yield* prepareDigest(
    hashTaskRuntimeGroupManifestFrameV1(groupManifest, sha256),
  );

  const objects: PreparedTaskRuntimeObjectV1[] = [];
  for (let index = 0; index < modules.length; index += 1) {
    const frame = modules[index]!;
    const canonicalBytes = yield* Effect.fromResult(
      encodeTaskRuntimeProjectionModulePreimageV1(frame).pipe(
        Result.mapError(error => reoperation(error)),
      ),
    );
    const digest = yield* prepareDigest(
      hashTaskRuntimeProjectionModuleFrameV1(frame, sha256),
    );
    objects.push(object("runtime_projection_module", BigInt(index), canonicalBytes, digest));
  }
  const projectionBytes = yield* canonicalPublication(
    encodeTaskRuntimeProjectionPreimageV1(projection),
  );
  objects.push(object(
    "task_runtime_projection",
    0n,
    projectionBytes,
    projectionSha256,
  ));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const canonicalBytes = yield* Effect.fromResult(
      encodeTaskRuntimeEntryPreimageV1(entry).pipe(
        Result.mapError(() => new InvalidTaskRuntimePublicationV1Error({
          operation: "prepare_publication",
          reason: "task_binding_mismatch",
          path: `entries[${index}]`,
        })),
      ),
    );
    const digest = yield* digestBytes(canonicalBytes, sha256);
    objects.push(object("task_runtime_entry", BigInt(index), canonicalBytes, digest));
  }
  const manifestBytes = yield* canonicalPublication(
    encodeTaskRuntimeGroupManifestPreimageV1(groupManifest),
  );
  objects.push(object(
    "task_runtime_group_manifest",
    0n,
    manifestBytes,
    groupManifestSha256,
  ));
  const materializationBytes = yield* canonicalPublication(
    encodeTaskRuntimeMaterializationSpecPreimageV1(materialization),
  );
  objects.push(object(
    "task_runtime_materialization_spec",
    0n,
    materializationBytes,
    materializationSha256,
  ));
  if (objects.length > MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1) {
    return yield* invalid("publication_budget_exceeded", "objects");
  }
  let canonicalByteLength = 0;
  const keys = new Set<string>();
  for (const item of objects) {
    const canonicalBytes = item.readCanonicalBytes();
    const reference = item.readReference();
    canonicalByteLength += canonicalBytes.byteLength;
    if (
      !Number.isSafeInteger(canonicalByteLength) ||
      canonicalByteLength > MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1
    ) {
      return yield* invalid("publication_budget_exceeded", "canonicalBytes");
    }
    if (keys.has(reference.objectKey)) {
      return yield* invalid("module_collision", "objects.objectKey");
    }
    keys.add(reference.objectKey);
  }

  const applicationRevisionTaskBinding = makeApplicationRevisionTaskBinding(
    captured,
    taskEntryRootSha256,
    projectionSha256,
    groupManifestSha256,
    materializationSha256,
  );
  const applicationRevisionTaskBindingSha256 = yield* hashApplicationBinding(
    applicationRevisionTaskBinding,
    sha256,
  );
  const publication = Object.freeze({
    kind: "populated_catalog" as const,
    version: 1 as const,
    readApplicationRevisionTaskBindingSha256: () =>
      copyDigest(applicationRevisionTaskBindingSha256),
    readApplicationRevisionTaskBinding: () =>
      copyApplicationRevisionTaskBinding(applicationRevisionTaskBinding),
    readReceiptPreimage: () => makeReceiptPreimage(
      captured,
      applicationRevisionTaskBinding,
      applicationRevisionTaskBindingSha256,
      objects,
    ),
    objects: Object.freeze(objects),
    canonicalByteLength,
  });
  preparedPublicationStates.set(publication, {
    receipt: publication.readReceiptPreimage(),
    objects: publication.objects,
  });
  return publication;
});

function captureInput(
  input: TaskRuntimePublicationPreparationInputV1,
): Result.Result<
  TaskRuntimePublicationPreparationInputV1,
  InvalidTaskRuntimePublicationV1Error<"prepare_publication">
> {
  return Result.gen(function* () {
    yield* admitInput(input);
    const cloned = yield* Result.try({
      try: () => Object.freeze({
        source: structuredClone(input.source),
        catalog: structuredClone(input.catalog),
        taskBindings: structuredClone(input.taskBindings),
        materialization: structuredClone(input.policy.materialization),
        candidate: structuredClone(input.authority.candidate),
      }),
      catch: invalidPreparationInput,
    });
    const modules: AuthenticatedTaskRuntimeSourceModuleV1[] = [];
    for (const module of input.authority.authenticatedModules) {
        if (
          !Number.isSafeInteger(module.ordinal) || module.ordinal < 0 ||
          typeof module.artifactModulePath !== "string" ||
          !isSourceArtifactV2ModuleRolesV1(module.roles) ||
          !Number.isSafeInteger(module.sourceByteLength) ||
          module.sourceByteLength < 0 ||
          !isUint8ArrayWithByteLength(module.sourceSha256, 32)
        ) return yield* Result.fail(invalidPreparationInput());
        modules.push(Object.freeze({
          ordinal: module.ordinal,
          artifactModulePath: module.artifactModulePath,
          roles: module.roles,
          sourceByteLength: module.sourceByteLength,
          sourceSha256: copyDigest(module.sourceSha256),
        }));
    }
    const candidateId = input.authority.candidateId;
    const applicationRevisionId = input.authority.applicationRevisionId;
    if (
      typeof candidateId !== "string" || candidateId.length === 0 ||
      typeof applicationRevisionId !== "string" ||
      applicationRevisionId.length === 0 ||
      !isUint8ArrayWithByteLength(input.authority.candidateSha256, 32)
    ) return yield* Result.fail(invalidPreparationInput());
    return Object.freeze({
        source: cloned.source,
        catalog: cloned.catalog,
        taskBindings: cloned.taskBindings,
        authority: Object.freeze({
          candidateId,
          candidate: cloned.candidate,
          candidateSha256: copyDigest(input.authority.candidateSha256),
          applicationRevisionId,
          authenticatedModules: Object.freeze(modules),
        }),
        policy: Object.freeze({
          materialization: cloned.materialization,
          admittedCompatibilityDate: input.policy.admittedCompatibilityDate,
          admittedCompatibilityFlags: Object.freeze([
            ...input.policy.admittedCompatibilityFlags,
          ]),
          admittedRuntimeImplementationVersion:
            input.policy.admittedRuntimeImplementationVersion,
          admittedComputeProfiles: Object.freeze([
            ...input.policy.admittedComputeProfiles,
          ]),
        }),
      });
  });
}

function invalidPreparationInput(): InvalidTaskRuntimePublicationV1Error<
  "prepare_publication"
> {
  return new InvalidTaskRuntimePublicationV1Error({
    operation: "prepare_publication",
    reason: "invalid_preparation_input",
  });
}

function admitInput(
  input: TaskRuntimePublicationPreparationInputV1,
): Result.Result<
  void,
  InvalidTaskRuntimePublicationV1Error<"prepare_publication">
> {
  return Result.gen(function* () {
    const captured = yield* Result.try({
      try: () => ({
        sourceModules: input.source.modules,
        authenticatedModules: input.authority.authenticatedModules,
        catalogEntries: input.catalog.entries,
        definitions: input.taskBindings.definitions,
        compatibilityFlags: input.policy.admittedCompatibilityFlags,
        computeProfiles: input.policy.admittedComputeProfiles,
      }),
      catch: invalidPreparationInput,
    });
      const { sourceModules, authenticatedModules, catalogEntries, definitions,
        compatibilityFlags, computeProfiles } = captured;
      if (
        sourceModules.length > MAX_TASK_RUNTIME_PUBLICATION_MODULES_V1 ||
        authenticatedModules.length > MAX_TASK_RUNTIME_PUBLICATION_MODULES_V1 ||
        catalogEntries.length > MAX_TASK_CATALOG_ENTRIES_V1 ||
        definitions.length > MAX_TASK_CATALOG_ENTRIES_V1 ||
        compatibilityFlags.length > MAX_TASK_RUNTIME_COMPATIBILITY_FLAGS_V1 ||
        computeProfiles.length > MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1
      ) return yield* Result.fail(publicationBudgetInputFailure());
      let sourceBytes = 0;
      let sourceMapBytes = 0;
      for (const module of sourceModules) {
        sourceBytes += module.sourceBytes.byteLength;
        if (module.sourceMapBytes !== null) {
          sourceMapBytes += module.sourceMapBytes.byteLength;
        }
        if (
          !Number.isSafeInteger(sourceBytes) ||
          sourceBytes > MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1 ||
          !Number.isSafeInteger(sourceMapBytes) ||
          sourceMapBytes > MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1
        ) return yield* Result.fail(publicationBudgetInputFailure());
      }
  });
}

function publicationBudgetInputFailure(): InvalidTaskRuntimePublicationV1Error<
  "prepare_publication"
> {
  return new InvalidTaskRuntimePublicationV1Error({
      operation: "prepare_publication",
      reason: "publication_budget_exceeded",
      path: "input",
  });
}

const correlateCatalogAndBindings = Effect.fn(
  "StandardApplicationTask.correlateRuntimePublicationBindingsV1",
)(function* (
  input: TaskRuntimePublicationPreparationInputV1,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  void,
  | InvalidTaskRuntimePublicationV1Error<"prepare_publication">
  | StandardApplicationTaskSha256ResourceV1Error
> {
  if (
    input.catalog.entries.length !== input.taskBindings.definitions.length ||
    input.taskBindings.catalog.binding.taskCount !== input.catalog.entries.length ||
    input.taskBindings.catalog.binding.scopeId !== input.authority.candidate.scopeId ||
    input.taskBindings.catalog.binding.candidateId !== input.authority.candidateId ||
    input.taskBindings.catalog.binding.revisionId !==
      input.authority.applicationRevisionId ||
    input.taskBindings.catalog.binding.sourceArtifactRootSha256 !==
      encodeBytesToLowercaseHex(input.authority.candidate.sourceRootSha256) ||
    input.authority.candidate.scopeId !== input.taskBindings.catalog.binding.scopeId ||
    !bytesEqualFullScan(
      input.taskBindings.catalog.binding.taskCatalogSha256,
      input.catalog.taskCatalogSha256,
    )
  ) return yield* invalid("task_binding_mismatch", "taskBindings");
  for (let index = 1; index < input.catalog.entries.length; index += 1) {
    if (
      compareTaskRuntimeUtf8V1(
        input.catalog.entries[index - 1]!.taskId,
        input.catalog.entries[index]!.taskId,
      ) >= 0
    ) return yield* invalid("task_binding_mismatch", `catalog.entries[${index}]`);
  }
    const catalogDigest = yield* hashApplicationTaskCatalogBindingV1(
      input.taskBindings.catalog.binding,
      sha256,
    ).pipe(Effect.catchTag("InvalidApplicationTaskBindingV1Error", bindingFailure));
    if (!bytesEqualFullScan(catalogDigest, input.taskBindings.catalog.sha256)) {
      return yield* invalid("task_binding_mismatch", "taskBindings.catalog.sha256");
    }
    for (let index = 0; index < input.taskBindings.definitions.length; index += 1) {
      const definition = input.taskBindings.definitions[index]!;
      const digest = yield* hashApplicationTaskDefinitionBindingV1(
        definition.binding,
        sha256,
      ).pipe(Effect.catchTag("InvalidApplicationTaskBindingV1Error", bindingFailure));
      if (!bytesEqualFullScan(digest, definition.sha256)) {
        return yield* invalid(
          "task_binding_mismatch",
          `taskBindings.definitions[${index}].sha256`,
        );
      }
    }
});

function bindingFailure(
  _error: InvalidApplicationTaskBindingV1Error,
): Effect.Effect<never, InvalidTaskRuntimePublicationV1Error<"prepare_publication">> {
  return invalid("task_binding_mismatch", "taskBindings");
}

const correlateAndBuildModules = Effect.fn(
  "StandardApplicationTask.correlateRuntimePublicationModulesV1",
)(function* (
  input: TaskRuntimePublicationPreparationInputV1,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  ReadonlyArray<TaskRuntimeProjectionModuleFrameV1>,
  PrepareTaskRuntimePublicationV1Error
> {
    const sourceModules = input.source.modules;
    if (
      sourceModules.length === 0 ||
      sourceModules.length > MAX_TASK_RUNTIME_PUBLICATION_MODULES_V1 ||
      sourceModules.length !== input.authority.authenticatedModules.length
    ) return yield* invalid("authenticated_evidence_mismatch", "modules");
    for (let index = 0; index < sourceModules.length; index += 1) {
      const source = sourceModules[index]!;
      const evidence = input.authority.authenticatedModules[index]!;
      if (
        evidence.ordinal !== index ||
        evidence.artifactModulePath !== source.path ||
        evidence.roles !== source.roles ||
        evidence.sourceByteLength !== source.sourceBytes.byteLength
      ) return yield* invalid(
        "authenticated_evidence_mismatch",
        `authority.authenticatedModules[${index}]`,
      );
    }
    const ordered = [...sourceModules].sort((left, right) =>
      compareTaskRuntimeUtf8V1(left.path, right.path)
    );
    const evidenceByPath = new Map(
      input.authority.authenticatedModules.map(evidence => [
        evidence.artifactModulePath,
        evidence,
      ] as const),
    );
    const seen = new Set<string>();
    const modules: TaskRuntimeProjectionModuleFrameV1[] = [];
    let rawByteLength = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      const source = ordered[index]!;
      const evidence = evidenceByPath.get(source.path);
      if (
        evidence === undefined || seen.has(source.path) ||
        evidence.roles !== source.roles ||
        evidence.sourceByteLength !== source.sourceBytes.byteLength
      ) return yield* invalid(
        seen.has(source.path) ? "module_collision" : "authenticated_evidence_mismatch",
        `modules[${index}]`,
      );
      seen.add(source.path);
      const sourceSha256 = yield* digestBytes(source.sourceBytes, sha256);
      if (!bytesEqualFullScan(sourceSha256, evidence.sourceSha256)) {
        return yield* invalid(
          "authenticated_evidence_mismatch",
          `modules[${index}].sourceSha256`,
        );
      }
      rawByteLength += source.sourceBytes.byteLength;
      if (
        !Number.isSafeInteger(rawByteLength) ||
        rawByteLength > MAX_TASK_RUNTIME_PROJECTION_RAW_BYTES_V1
      ) return yield* invalid("publication_budget_exceeded", "modules.rawByteLength");
      modules.push(Object.freeze({
        kind: "runtime_projection_module" as const,
        group: "durable_task" as const,
        moduleOrdinal: BigInt(index),
        artifactModulePath: source.path,
        sourceRoles: source.roles,
        sourceEnvironment: "isolate" as const,
        moduleFormat: "es_module" as const,
        rawByteLength: BigInt(source.sourceBytes.byteLength),
        sourceSha256: copyDigest(sourceSha256),
        sourceBytes: copyBytes(source.sourceBytes),
      }));
    }
    const modulesByPath = new Map(
      modules.map(module => [module.artifactModulePath, module] as const),
    );
    const execution = modulesByPath.get(input.source.executionPath);
    if (
      execution === undefined ||
      (execution.sourceRoles & SOURCE_ARTIFACT_V2_ROLE_EXECUTION) === 0
    ) return yield* invalid("authenticated_evidence_mismatch", "executionModule");
    for (const task of input.catalog.entries) {
      const module = modulesByPath.get(task.manifest.handler.artifactModulePath);
      if (
        module === undefined ||
        (module.sourceRoles & SOURCE_ARTIFACT_V2_ROLE_FUNCTION) === 0
      ) return yield* invalid(
        "task_binding_mismatch",
        `tasks[${task.taskId}].handler`,
      );
    }
    return Object.freeze(modules);
});

function object(
  role: TaskRuntimeObjectRoleV1,
  ordinal: bigint,
  canonicalBytes: Uint8Array,
  sha256: TaskDefinitionSha256V1,
): PreparedTaskRuntimeObjectV1 {
  const digest = copyDigest(sha256);
  const ownedCanonicalBytes = copyBytes(canonicalBytes);
  const reference = Object.freeze({
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role,
    objectKey: taskRuntimeObjectKeyV1(
      role,
      encodeBytesToLowercaseHex(digest),
    ),
    byteLength: BigInt(canonicalBytes.byteLength),
    sha256: digest,
  });
  const prepared = Object.freeze({
    role,
    codecIdentity: codecIdentityForRole(role),
    ordinal,
    readCanonicalBytes: () => copyBytes(ownedCanonicalBytes),
    readReference: () => copyReference(reference),
  });
  preparedObjectStates.set(prepared, {
    role,
    codecIdentity: prepared.codecIdentity,
    ordinal,
    canonicalBytes: ownedCanonicalBytes,
    reference,
  });
  return prepared;
}

function copyReceiptPreimage(
  receipt: TaskRuntimePublicationReceiptPreimageV1,
): TaskRuntimePublicationReceiptPreimageV1 {
  return Object.freeze({
    ...receipt,
    candidateSha256: copyDigest(receipt.candidateSha256),
    taskCatalogBindingSha256: copyDigest(receipt.taskCatalogBindingSha256),
    applicationRevisionTaskBindingSha256:
      copyDigest(receipt.applicationRevisionTaskBindingSha256),
    taskCatalogSha256: copyDigest(receipt.taskCatalogSha256),
    taskEntryRootSha256: copyDigest(receipt.taskEntryRootSha256),
    taskRuntimeProjectionSha256: receipt.taskRuntimeProjectionSha256 === null
      ? null
      : copyDigest(receipt.taskRuntimeProjectionSha256),
    taskRuntimeGroupManifestSha256:
      receipt.taskRuntimeGroupManifestSha256 === null
        ? null
        : copyDigest(receipt.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256:
      receipt.taskRuntimeMaterializationSpecSha256 === null
        ? null
        : copyDigest(receipt.taskRuntimeMaterializationSpecSha256),
    packageSha256: copyDigest(receipt.packageSha256),
    artifactSha256: copyDigest(receipt.artifactSha256),
    sourceRootSha256: copyDigest(receipt.sourceRootSha256),
    semanticRootSha256: copyDigest(receipt.semanticRootSha256),
    runtimeObjects: Object.freeze(receipt.runtimeObjects.map(item =>
      Object.freeze({
        ordinal: item.ordinal,
        codecIdentity: item.codecIdentity,
        reference: copyReference(item.reference),
      })
    )),
  });
}

function canonicalPublication(
  value: Result.Result<Uint8Array, InvalidTaskRuntimePublicationV1Error>,
): Effect.Effect<
  Uint8Array,
  InvalidTaskRuntimePublicationV1Error<"prepare_publication">
> {
  return Effect.fromResult(value.pipe(Result.mapError(reoperation)));
}

function catalogsEqual(
  left: HashedCanonicalTaskCatalogV1,
  right: HashedCanonicalTaskCatalogV1,
): boolean {
  if (
    left.version !== right.version ||
    left.entries.length !== right.entries.length ||
    !bytesEqualFullScan(left.taskCatalogSha256, right.taskCatalogSha256)
  ) return false;
  for (let index = 0; index < left.entries.length; index += 1) {
    const leftEntry = left.entries[index];
    const rightEntry = right.entries[index];
    if (
      leftEntry === undefined || rightEntry === undefined ||
      leftEntry.taskId !== rightEntry.taskId ||
      !bytesEqualFullScan(
        leftEntry.canonicalTaskManifestSha256,
        rightEntry.canonicalTaskManifestSha256,
      )
    ) return false;
  }
  return true;
}

function makeApplicationRevisionTaskBinding(
  input: TaskRuntimePublicationPreparationInputV1,
  taskEntryRootSha256: TaskDefinitionSha256V1,
  projectionSha256: TaskDefinitionSha256V1 | null,
  groupManifestSha256: TaskDefinitionSha256V1 | null,
  materializationSha256: TaskDefinitionSha256V1 | null,
): ApplicationRevisionTaskBindingFrameV1 {
  return Object.freeze({
    kind: "application_revision_task_binding" as const,
    candidateSha256: copyDigest(input.authority.candidateSha256),
    taskCatalogSha256: copyDigest(input.catalog.taskCatalogSha256),
    taskCount: BigInt(input.catalog.entries.length),
    taskEntryRootSha256: copyDigest(taskEntryRootSha256),
    taskRuntimeProjectionSha256: projectionSha256 === null
      ? null
      : copyDigest(projectionSha256),
    taskRuntimeGroupManifestSha256: groupManifestSha256 === null
      ? null
      : copyDigest(groupManifestSha256),
    taskRuntimeMaterializationSpecSha256: materializationSha256 === null
      ? null
      : copyDigest(materializationSha256),
  });
}

function hashApplicationBinding(
  binding: ApplicationRevisionTaskBindingFrameV1,
  sha256: StandardApplicationTaskSha256V1,
): Effect.Effect<
  TaskDefinitionSha256V1,
  | InvalidTaskRuntimePublicationV1Error<"prepare_publication">
  | StandardApplicationTaskSha256ResourceV1Error
> {
  return hashApplicationRevisionTaskBindingFrameV1(binding, sha256).pipe(
    Effect.catchTag("InvalidStandardApplicationTaskDefinitionV1Error", () =>
      invalid("task_binding_mismatch", "applicationRevisionTaskBinding")
    ),
    Effect.catchTag("StandardApplicationTaskSha256InputV1Error", error =>
      Effect.die(new TaskRuntimePublicationPreparationInvariantV1Defect({
        reason: "invalid_hash_input",
      }))
    ),
    Effect.map(copyDigest),
  );
}

function makeReceiptPreimage(
  input: TaskRuntimePublicationPreparationInputV1,
  binding: ApplicationRevisionTaskBindingFrameV1,
  applicationRevisionTaskBindingSha256: TaskDefinitionSha256V1,
  objects: ReadonlyArray<PreparedTaskRuntimeObjectV1>,
): TaskRuntimePublicationReceiptPreimageV1 {
  return Object.freeze({
    version: 1 as const,
    scopeId: input.authority.candidate.scopeId,
    candidateId: input.authority.candidateId,
    applicationRevisionId: input.authority.applicationRevisionId,
    candidateSha256: copyDigest(input.authority.candidateSha256),
    taskCatalogBindingSha256: copyDigest(input.taskBindings.catalog.sha256),
    applicationRevisionTaskBindingSha256:
      copyDigest(applicationRevisionTaskBindingSha256),
    taskCatalogSha256: copyDigest(binding.taskCatalogSha256),
    taskEntryRootSha256: copyDigest(binding.taskEntryRootSha256),
    taskRuntimeProjectionSha256: binding.taskRuntimeProjectionSha256 === null
      ? null
      : copyDigest(binding.taskRuntimeProjectionSha256),
    taskRuntimeGroupManifestSha256:
      binding.taskRuntimeGroupManifestSha256 === null
        ? null
        : copyDigest(binding.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256:
      binding.taskRuntimeMaterializationSpecSha256 === null
        ? null
        : copyDigest(binding.taskRuntimeMaterializationSpecSha256),
    packageSha256: copyDigest(input.authority.candidate.packageSha256),
    artifactSha256: copyDigest(input.authority.candidate.artifactSha256),
    sourceRootSha256: copyDigest(input.authority.candidate.sourceRootSha256),
    semanticRootSha256: copyDigest(input.authority.candidate.semanticRootSha256),
    runtimeObjects: Object.freeze(objects.map(item => Object.freeze({
      ordinal: item.ordinal,
      codecIdentity: item.codecIdentity,
      reference: item.readReference(),
    }))),
  });
}

function copyReference(
  reference: TaskRuntimeObjectReferenceV1,
): TaskRuntimeObjectReferenceV1 {
  return Object.freeze({
    ...reference,
    sha256: copyDigest(reference.sha256),
  });
}

function copyApplicationRevisionTaskBinding(
  binding: ApplicationRevisionTaskBindingFrameV1,
): ApplicationRevisionTaskBindingFrameV1 {
  return Object.freeze({
    ...binding,
    candidateSha256: copyDigest(binding.candidateSha256),
    taskCatalogSha256: copyDigest(binding.taskCatalogSha256),
    taskEntryRootSha256: copyDigest(binding.taskEntryRootSha256),
    taskRuntimeProjectionSha256: binding.taskRuntimeProjectionSha256 === null
      ? null
      : copyDigest(binding.taskRuntimeProjectionSha256),
    taskRuntimeGroupManifestSha256:
      binding.taskRuntimeGroupManifestSha256 === null
        ? null
        : copyDigest(binding.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256:
      binding.taskRuntimeMaterializationSpecSha256 === null
        ? null
        : copyDigest(binding.taskRuntimeMaterializationSpecSha256),
  });
}

function codecIdentityForRole(role: TaskRuntimeObjectRoleV1): string {
  switch (role) {
    case "runtime_projection_module":
      return TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1;
    case "task_runtime_projection":
      return TASK_RUNTIME_PROJECTION_CODEC_V1;
    case "task_runtime_entry":
      return TASK_RUNTIME_ENTRY_CODEC_V1;
    case "task_runtime_group_manifest":
      return TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1;
    case "task_runtime_materialization_spec":
      return TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1;
  }
}

function stringArraysEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function digestBytes(
  bytes: Uint8Array,
  sha256: StandardApplicationTaskSha256V1,
): Effect.Effect<
  TaskDefinitionSha256V1,
  StandardApplicationTaskSha256ResourceV1Error
> {
  return sha256(bytes, { maximumInputBytes: bytes.byteLength }).pipe(
    Effect.catchTag("StandardApplicationTaskSha256InputV1Error", error =>
      Effect.die(new TaskRuntimePublicationPreparationInvariantV1Defect({
        reason: "invalid_hash_input",
      }))
    ),
    Effect.map(copyDigest),
  );
}

function prepareDigest<A>(
  effect: Effect.Effect<
    A,
    InvalidTaskRuntimePublicationV1Error | StandardApplicationTaskSha256V1Error
  >,
): Effect.Effect<
  A,
  | InvalidTaskRuntimePublicationV1Error<"prepare_publication">
  | StandardApplicationTaskSha256ResourceV1Error
> {
  return effect.pipe(
    Effect.catchTag("InvalidTaskRuntimePublicationV1Error", error =>
      Effect.fail(reoperation(error))
    ),
    Effect.catchTag("StandardApplicationTaskSha256InputV1Error", error =>
      Effect.die(new TaskRuntimePublicationPreparationInvariantV1Defect({
        reason: "invalid_hash_input",
      }))
    ),
  );
}

function requireDigest(value: Uint8Array): TaskDefinitionSha256V1 {
  if (!isUint8ArrayWithByteLength(value, 32)) throw new Error("invalid digest");
  return copyDigest(value);
}

function requireNonemptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid nonempty string");
  }
  return value;
}

function copyDigest(value: Uint8Array): TaskDefinitionSha256V1 {
  return copyBytes(value) as TaskDefinitionSha256V1;
}

function reoperation(
  error: InvalidTaskRuntimePublicationV1Error,
): InvalidTaskRuntimePublicationV1Error<"prepare_publication"> {
  return new InvalidTaskRuntimePublicationV1Error({
    operation: "prepare_publication",
    reason: error.reason,
    ...(error.path === undefined ? {} : { path: error.path }),
    ...(error.observed === undefined ? {} : { observed: error.observed }),
    ...(error.maximum === undefined ? {} : { maximum: error.maximum }),
  });
}

function invalid(
  reason: InvalidTaskRuntimePublicationV1Error["reason"],
  path?: string,
): Effect.Effect<never, InvalidTaskRuntimePublicationV1Error<"prepare_publication">> {
  return Effect.fail(new InvalidTaskRuntimePublicationV1Error({
    operation: "prepare_publication",
    reason,
    ...(path === undefined ? {} : { path }),
  }));
}
