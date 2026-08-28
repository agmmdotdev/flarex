import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from
  "@flarex/utils/bytes";
import { Effect, Result } from "effect";

import {
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  type CanonicalTaskManifestV1,
  type TaskDefinitionSha256V1,
} from "./Model.js";
import { encodeCanonicalTaskManifestPreimageV1 } from "./Canonical.js";
import type { StandardApplicationTaskSha256V1Error } from "./Errors.js";
import {
  InvalidTaskRuntimeFamilyV1Error,
  type TaskRuntimeFamilyFailureReasonV1,
  type TaskRuntimeFamilyOperationV1,
} from "./RuntimeFamilyErrors.js";
import {
  NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
  type AdmittedNodeTaskRuntimeArtifactV1,
  type NodeTaskRuntimeArtifactAdmissionInputV1,
  type NodeTaskRuntimeArtifactObjectReferenceV1,
  type NodeTaskRuntimeArtifactV1,
  type TaskRuntimeComputeProfileCatalogV1,
  type TaskRuntimeComputeProfilePolicyV1,
  type TaskRuntimeFamilyAdmissionV1,
  type TaskRuntimeFamilyV1,
} from "./RuntimeFamilyModel.js";
import {
  decodeNodeTaskRuntimeArtifactV1,
  decodeTaskRuntimeComputeProfileCatalogV1,
} from "./RuntimeFamilySchema.js";
import { decodeCanonicalTaskManifestV1 } from "./Schema.js";
import type { StandardApplicationTaskSha256V1 } from "./Sha256.js";
import {
  encodeNodeTaskRuntimeArtifactPreimageV1,
  encodeTaskRuntimeComputeProfileCatalogPreimageV1,
} from "./RuntimeFamilyCanonical.js";

export function admitIsolateTaskRuntimePublicationV1(
  manifestInput: unknown,
  catalogInput: unknown,
  supportedComputeProfiles: ReadonlyArray<TaskComputeProfileRefV1>,
): Result.Result<
  Extract<TaskRuntimeFamilyAdmissionV1, { readonly runtimeFamily: "isolate" }>,
  InvalidTaskRuntimeFamilyV1Error<"admit_isolate_publication">
> {
  const operation = "admit_isolate_publication" as const;
  return Result.gen(function* () {
    const manifest = yield* decodeCanonicalTaskManifestV1(manifestInput).pipe(
      Result.mapError(() => invalid(operation, "manifest_mismatch", "manifest")),
    );
    const catalog = yield* decodeTaskRuntimeComputeProfileCatalogV1(
      catalogInput,
    ).pipe(Result.mapError(error => reoperation(error, operation)));
    const admission = yield* admitManifestProfiles(
      manifest,
      catalog,
      supportedComputeProfiles,
      "isolate",
      operation,
    );
    return admission.runtimeFamily === "isolate"
      ? admission
      : yield* Result.fail(invalid(
        operation,
        "runtime_family_mismatch",
      ));
  });
}

export type AdmitNodeTaskRuntimeArtifactV1Error =
  | InvalidTaskRuntimeFamilyV1Error<"admit_node_artifact">
  | StandardApplicationTaskSha256V1Error;

export const admitNodeTaskRuntimeArtifactV1 = Effect.fn(
  "StandardApplicationTask.admitNodeRuntimeArtifactV1",
)(function* (
  input: NodeTaskRuntimeArtifactAdmissionInputV1,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  AdmittedNodeTaskRuntimeArtifactV1,
  AdmitNodeTaskRuntimeArtifactV1Error
> {
  const operation = "admit_node_artifact" as const;
  const captured = yield* Effect.fromResult(prepareNodeAdmissionInput(input));
  const manifestBytes = yield* Effect.fromResult(
    encodeCanonicalTaskManifestPreimageV1(captured.manifest).pipe(
      Result.mapError(() => invalid(
        operation,
        "manifest_mismatch",
        "manifest",
      )),
    ),
  );
  const authenticatedManifestSha256 = yield* digest(manifestBytes, sha256);
  const catalogBytes = yield* Effect.fromResult(
    encodeTaskRuntimeComputeProfileCatalogPreimageV1(
      captured.catalog,
    ).pipe(Result.mapError(error => reoperation(error, operation))),
  );
  const computeProfileCatalogSha256 = yield* digest(catalogBytes, sha256);
  const artifactBytes = yield* Effect.fromResult(
    encodeNodeTaskRuntimeArtifactPreimageV1(captured.artifact).pipe(
      Result.mapError(error => reoperation(error, operation)),
    ),
  );
  const nodeTaskRuntimeArtifactSha256 = yield* digest(artifactBytes, sha256);
  return yield* Effect.fromResult(admitNodeTaskRuntimeArtifactResult(
    captured,
    authenticatedManifestSha256,
    computeProfileCatalogSha256,
    nodeTaskRuntimeArtifactSha256,
  ));
});

function admitNodeTaskRuntimeArtifactResult(
  captured: PreparedNodeAdmissionInputV1,
  authenticatedManifestSha256: Uint8Array,
  computeProfileCatalogSha256: TaskDefinitionSha256V1,
  nodeTaskRuntimeArtifactSha256: TaskDefinitionSha256V1,
): Result.Result<
  AdmittedNodeTaskRuntimeArtifactV1,
  InvalidTaskRuntimeFamilyV1Error<"admit_node_artifact">
> {
  const operation = "admit_node_artifact" as const;
  return Result.gen(function* () {
    const { artifact, catalog, manifest } = captured;
    if (
      artifact.taskId !== manifest.taskId ||
      artifact.applicationRevisionId !== captured.applicationRevisionId ||
      !bytesEqualFullScan(artifact.candidateSha256, captured.candidateSha256) ||
      artifact.handler.logicalModulePath !== manifest.handler.logicalModulePath ||
      artifact.handler.artifactModulePath !== manifest.handler.artifactModulePath ||
      artifact.handler.exportName !== manifest.handler.exportName ||
      !bytesEqualFullScan(
        artifact.canonicalTaskManifestSha256,
        authenticatedManifestSha256,
      )
    ) {
      return yield* Result.fail(invalid(operation, "manifest_mismatch"));
    }
    if (!bytesEqualFullScan(
      artifact.computeProfileCatalogSha256,
      computeProfileCatalogSha256,
    )) {
      return yield* Result.fail(invalid(operation, "catalog_mismatch"));
    }
    const admission = yield* admitManifestProfiles(
      manifest,
      catalog,
      artifact.supportedComputeProfiles,
      "node",
      operation,
    );
    const nodeAdmission = Object.freeze({
      ...admission,
      runtimeFamily: "node" as const,
      bridgeAbiIdentity: NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
      runtimeProfileIdentity: NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
    });
    return Object.freeze({
      readArtifact: () => copyNodeArtifact(artifact),
      nodeTaskRuntimeArtifactSha256Hex:
        encodeBytesToLowercaseHex(nodeTaskRuntimeArtifactSha256),
      computeProfileCatalogSha256Hex:
        encodeBytesToLowercaseHex(computeProfileCatalogSha256),
      dispatchReadiness: "blocked_provider_disabled" as const,
      admission: nodeAdmission,
    });
  });
}

function admitManifestProfiles<
  Family extends TaskRuntimeFamilyV1,
  Operation extends TaskRuntimeFamilyOperationV1,
>(
  manifest: CanonicalTaskManifestV1,
  catalog: TaskRuntimeComputeProfileCatalogV1,
  supportedComputeProfiles: ReadonlyArray<TaskComputeProfileRefV1>,
  runtimeFamily: Family,
  operation: Operation,
): Result.Result<
  TaskRuntimeFamilyAdmissionV1,
  InvalidTaskRuntimeFamilyV1Error<Operation>
> {
  return Result.gen(function* () {
    const supported = new Set<string>();
    for (let index = 0; index < supportedComputeProfiles.length; index += 1) {
      const computeProfile = supportedComputeProfiles[index];
      if (typeof computeProfile !== "string" || supported.has(computeProfile)) {
        return yield* Result.fail(invalid(
          operation,
          "invalid_compute_profile",
          `supportedComputeProfiles[${index}]`,
        ));
      }
      const policy = findProfile(catalog, computeProfile);
      if (policy === undefined) {
        return yield* Result.fail(invalid(
          operation,
          "profile_not_found",
          `supportedComputeProfiles[${index}]`,
        ));
      }
      yield* admitFamilyIdentity(policy, runtimeFamily, operation);
      supported.add(computeProfile);
    }
    const reachable = reachableProfiles(manifest);
    for (let index = 0; index < reachable.length; index += 1) {
      const computeProfile = reachable[index]!;
      const policy = findProfile(catalog, computeProfile);
      if (policy === undefined || !supported.has(computeProfile)) {
        return yield* Result.fail(invalid(
          operation,
          "profile_not_found",
          `reachableComputeProfiles[${index}]`,
        ));
      }
      yield* admitFamilyIdentity(policy, runtimeFamily, operation);
      if (manifest.maximumDurationInSeconds > policy.maximumDurationInSeconds) {
        return yield* Result.fail(invalid(
          operation,
          "duration_exceeded",
          `reachableComputeProfiles[${index}]`,
          manifest.maximumDurationInSeconds,
          policy.maximumDurationInSeconds,
        ));
      }
    }
    const base = {
      runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
      initialComputeProfile: manifest.computeProfile,
      reachableComputeProfiles: Object.freeze(reachable),
      maximumDurationInSeconds: manifest.maximumDurationInSeconds,
    };
    return runtimeFamily === "isolate"
      ? Object.freeze({
        ...base,
        runtimeFamily: "isolate" as const,
        bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
        runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
      })
      : Object.freeze({
        ...base,
        runtimeFamily: "node" as const,
        bridgeAbiIdentity: NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
        runtimeProfileIdentity: NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
      });
  });
}

function admitFamilyIdentity<
  Operation extends TaskRuntimeFamilyOperationV1,
>(
  policy: TaskRuntimeComputeProfilePolicyV1,
  runtimeFamily: TaskRuntimeFamilyV1,
  operation: Operation,
): Result.Result<void, InvalidTaskRuntimeFamilyV1Error<Operation>> {
  if (policy.runtimeFamily !== runtimeFamily) {
    return Result.fail(invalid(
      operation,
      "runtime_family_mismatch",
      policy.computeProfile,
    ));
  }
  const bridge = runtimeFamily === "isolate"
    ? TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1
    : NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
  const profile = runtimeFamily === "isolate"
    ? TASK_RUNTIME_PROFILE_IDENTITY_V1
    : NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1;
  return policy.runtimeContractIdentity === TASK_RUNTIME_CONTRACT_IDENTITY_V1 &&
      policy.bridgeAbiIdentity === bridge &&
      policy.runtimeProfileIdentity === profile
    ? Result.succeed(undefined)
    : Result.fail(invalid(
      operation,
      "runtime_abi_mismatch",
      policy.computeProfile,
    ));
}

function reachableProfiles(
  manifest: CanonicalTaskManifestV1,
): TaskComputeProfileRefV1[] {
  const profiles = [manifest.computeProfile];
  const outOfMemory = manifest.runAttemptPolicy.outOfMemory;
  if (
    outOfMemory.kind === "escalate_once" &&
    outOfMemory.computeProfile !== manifest.computeProfile
  ) profiles.push(outOfMemory.computeProfile);
  return profiles;
}

function findProfile(
  catalog: TaskRuntimeComputeProfileCatalogV1,
  computeProfile: string,
): TaskRuntimeComputeProfilePolicyV1 | undefined {
  return catalog.profiles.find(
    candidate => candidate.computeProfile === computeProfile,
  );
}

interface PreparedNodeAdmissionInputV1 {
  readonly applicationRevisionId: string;
  readonly candidateSha256: TaskDefinitionSha256V1;
  readonly manifest: CanonicalTaskManifestV1;
  readonly artifact: NodeTaskRuntimeArtifactV1;
  readonly catalog: TaskRuntimeComputeProfileCatalogV1;
}

function prepareNodeAdmissionInput(
  input: NodeTaskRuntimeArtifactAdmissionInputV1,
): Result.Result<
  PreparedNodeAdmissionInputV1,
  InvalidTaskRuntimeFamilyV1Error<"admit_node_artifact">
> {
  const operation = "admit_node_artifact" as const;
  const outer = captureExactDataRecord(input, [
    "applicationRevisionId",
    "candidateSha256",
    "manifest",
    "artifact",
    "computeProfileCatalog",
  ]);
  const applicationRevisionId = outer?.applicationRevisionId;
  const candidateSha256Input = outer?.candidateSha256;
  if (
    outer === undefined || typeof applicationRevisionId !== "string" ||
    applicationRevisionId.length === 0 ||
    !isUint8ArrayWithByteLength(candidateSha256Input, 32)
  ) return Result.fail(invalid(operation, "invalid_shape", "authority"));
  return Result.gen(function* () {
    const manifest = yield* decodeCanonicalTaskManifestV1(outer.manifest).pipe(
      Result.mapError(() => invalid(operation, "manifest_mismatch", "manifest")),
    );
    const artifact = yield* decodeNodeTaskRuntimeArtifactV1(outer.artifact).pipe(
      Result.mapError(error => reoperation(error, operation)),
    );
    const catalog = yield* decodeTaskRuntimeComputeProfileCatalogV1(
      outer.computeProfileCatalog,
    ).pipe(Result.mapError(error => reoperation(error, operation)));
    // SAFETY: the length guard above proves the branded SHA-256 representation.
    const candidateSha256 = copyBytes(
      candidateSha256Input,
    ) as TaskDefinitionSha256V1;
    return Object.freeze({
      applicationRevisionId,
      candidateSha256,
      manifest,
      artifact,
      catalog,
    });
  });
}

function captureExactDataRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return undefined;
    }
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== expectedKeys.length ||
      keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))
    ) return undefined;
    const captured: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return undefined;
      captured[key] = descriptor.value;
    }
    return captured;
  } catch {
    return undefined;
  }
}

function copyNodeArtifact(
  artifact: NodeTaskRuntimeArtifactV1,
): NodeTaskRuntimeArtifactV1 {
  return Object.freeze({
    ...artifact,
    candidateSha256: copyDigest(artifact.candidateSha256),
    canonicalTaskManifestSha256:
      copyDigest(artifact.canonicalTaskManifestSha256),
    computeProfileCatalogSha256:
      copyDigest(artifact.computeProfileCatalogSha256),
    handler: Object.freeze({ ...artifact.handler }),
    modules: Object.freeze(artifact.modules.map(module => Object.freeze({
      ...module,
      sourceSha256: copyDigest(module.sourceSha256),
    }))),
    bundle: copyArtifactReference(artifact.bundle),
    dependencies: artifact.dependencies === null
      ? null
      : copyArtifactReference(artifact.dependencies),
    supportedComputeProfiles: Object.freeze([
      ...artifact.supportedComputeProfiles,
    ]),
  });
}

function copyArtifactReference(
  reference: NodeTaskRuntimeArtifactObjectReferenceV1,
): NodeTaskRuntimeArtifactObjectReferenceV1 {
  return Object.freeze({ ...reference, sha256: copyDigest(reference.sha256) });
}

function copyDigest(digest: TaskDefinitionSha256V1): TaskDefinitionSha256V1 {
  // SAFETY: the input already has the branded SHA-256 representation.
  return copyBytes(digest) as TaskDefinitionSha256V1;
}

function digest(
  bytes: Uint8Array,
  sha256: StandardApplicationTaskSha256V1,
): Effect.Effect<
  TaskDefinitionSha256V1,
  StandardApplicationTaskSha256V1Error
> {
  return sha256(bytes, {
    maximumInputBytes: MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  }).pipe(Effect.map(value => {
    // SAFETY: the Standard Application SHA-256 capability validates 32 bytes.
    return copyBytes(value) as TaskDefinitionSha256V1;
  }));
}

function reoperation<Operation extends TaskRuntimeFamilyOperationV1>(
  error: InvalidTaskRuntimeFamilyV1Error,
  operation: Operation,
): InvalidTaskRuntimeFamilyV1Error<Operation> {
  return invalid(
    operation,
    error.reason,
    error.path,
    error.observed,
    error.maximum,
  );
}

function invalid<Operation extends TaskRuntimeFamilyOperationV1>(
  operation: Operation,
  reason: TaskRuntimeFamilyFailureReasonV1,
  path?: string,
  observed?: number,
  maximum?: number,
): InvalidTaskRuntimeFamilyV1Error<Operation> {
  return new InvalidTaskRuntimeFamilyV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}
