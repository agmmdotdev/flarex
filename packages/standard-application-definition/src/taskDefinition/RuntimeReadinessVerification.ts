import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Effect, Result } from "effect";

import { decodeTaskRuntimeEntryPreimageV1 } from "./Canonical.js";
import {
  hashApplicationRevisionTaskBinding,
  hashCanonicalTaskCatalogV1,
} from "./Digest.js";
import type {
  InvalidStandardApplicationTaskDefinitionV1Error,
  StandardApplicationTaskSha256V1Error,
} from "./Errors.js";
import {
  MAX_TASK_CATALOG_ENTRIES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1,
  MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  TASK_RUNTIME_ENTRY_CODEC_V1,
  TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1,
  TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  TASK_RUNTIME_PROJECTION_CODEC_V1,
  TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1,
  taskRuntimeObjectKeyV1,
  type ApplicationRevisionTaskBinding,
  type HashedCanonicalTaskCatalogV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeEntryFrameV1,
  type TaskRuntimeGroupManifestFrameV1,
  type TaskRuntimeMaterializationSpecV1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
  type TaskRuntimeProjectionFrameV1,
  type TaskRuntimeProjectionModuleFrameV1,
} from "./Model.js";
import {
  MAX_TASK_RUNTIME_READINESS_BASIS_CANONICAL_BYTES_V1,
  copyTaskRuntimeReadinessBasisV1,
  encodeTaskRuntimeReadinessBasisPreimageV1,
} from "./RuntimeReadinessBasis.js";
import { isTaskRuntimeReadinessIdentity as validIdentity } from
  "./RuntimeReadinessIdentity.js";
import {
  InvalidTaskRuntimeReadinessV1Error,
  invalidTaskRuntimeReadiness as readinessInvalid,
  type CompleteTaskRuntimeReadinessVerificationError,
  type PreparedTaskRuntimeReadinessVerification,
  type PreparedTaskRuntimeReadinessBasisV1,
  type PrepareTaskRuntimeReadinessVerificationError,
  type TaskRuntimeReadinessBasisV1,
  type TaskRuntimeReadinessCompletionInput,
  type TaskRuntimeReadinessExpectedEvidence,
  type TaskRuntimeReadinessObject,
  type TaskRuntimeReadinessOperationV1,
  type TaskRuntimeReadinessPreparationInput,
  type TaskRuntimeReadinessReasonV1,
  type TaskRuntimeReadinessVerificationInput,
  type VerifyTaskRuntimeReadinessError,
} from "./RuntimeReadinessModel.js";
import {
  decodeTaskRuntimeGroupManifestPreimageV1,
  decodeTaskRuntimeMaterializationSpecPreimageV1,
  decodeTaskRuntimeProjectionModulePreimageV1,
  decodeTaskRuntimeProjectionPreimageV1,
} from "./RuntimePublicationCanonical.js";
import {
  hashTaskRuntimeEntryRootV1,
  hashTaskRuntimeGroupManifestFrameV1,
  hashTaskRuntimeMaterializationSpecV1,
  verifyTaskRuntimeProjectionV1,
} from "./RuntimePublicationDigest.js";
import type { InvalidTaskRuntimePublicationError } from
  "./RuntimePublicationErrors.js";
import type { TaskRuntimePublicationReceipt } from
  "./RuntimePublicationPreparation.js";
import { decodeTaskRuntimePublicationReceipt } from
  "./RuntimePublicationReceipt.js";
import { decodeTaskRuntimeMaterializationSpecV1 } from
  "./RuntimePublicationSchema.js";
import { decodeCanonicalTaskManifestV1 } from "./Schema.js";
import type { StandardApplicationTaskSha256V1 } from "./Sha256.js";

type CapturedPreparationInput = Readonly<{
  receiptCanonicalBytes: Uint8Array;
  receiptSha256: TaskDefinitionSha256V1;
  expected: TaskRuntimeReadinessExpectedEvidence;
}>;

type CapturedRuntimeObjects = Readonly<{
  runtimeObjects: ReadonlyArray<TaskRuntimeReadinessObject>;
  canonicalObjectByteLength: number;
}>;

type CapturedVerificationInput = CapturedPreparationInput &
  CapturedRuntimeObjects;

type PreparedReadinessState = Readonly<{
  receipt: TaskRuntimePublicationReceipt;
  receiptSha256: TaskDefinitionSha256V1;
  expected: TaskRuntimeReadinessExpectedEvidence;
  sha256: StandardApplicationTaskSha256V1;
}>;

type DecodedObjects = Readonly<{
  modules: ReadonlyArray<TaskRuntimeProjectionModuleFrameV1>;
  projection: TaskRuntimeProjectionFrameV1;
  entries: ReadonlyArray<TaskRuntimeEntryFrameV1>;
  groupManifest: TaskRuntimeGroupManifestFrameV1;
  materialization: TaskRuntimeMaterializationSpecV1;
}>;

const preparedReadinessStates = new WeakMap<object, PreparedReadinessState>();

export const prepareTaskRuntimeReadinessVerification = Effect.fn(
  "StandardApplicationTask.prepareRuntimeReadinessVerification",
)(function* (
  input: TaskRuntimeReadinessPreparationInput,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  PreparedTaskRuntimeReadinessVerification,
  PrepareTaskRuntimeReadinessVerificationError
> {
  const captured = yield* Effect.fromResult(capturePreparationInput(input));
  return yield* prepareCapturedReadiness(captured, sha256);
});

export const completeTaskRuntimeReadinessVerification = Effect.fn(
  "StandardApplicationTask.completeRuntimeReadinessVerification",
)(function* (
  input: TaskRuntimeReadinessCompletionInput,
): Effect.fn.Return<
  PreparedTaskRuntimeReadinessBasisV1,
  CompleteTaskRuntimeReadinessVerificationError
> {
  const captured = yield* Effect.fromResult(captureCompletionInput(input));
  return yield* completeCapturedReadiness(
    captured.state,
    captured.runtimeObjects,
  );
});

export const verifyTaskRuntimeReadiness = Effect.fn(
  "StandardApplicationTask.verifyRuntimeReadiness",
)(function* (
  input: TaskRuntimeReadinessVerificationInput,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  PreparedTaskRuntimeReadinessBasisV1,
  VerifyTaskRuntimeReadinessError
> {
  const captured = yield* Effect.fromResult(captureVerificationInput(input));
  const prepared = yield* prepareCapturedReadiness(captured, sha256);
  const state = preparedReadinessStates.get(prepared);
  if (state === undefined) {
    return yield* readinessFailure("invalid_input", "prepared");
  }
  return yield* completeCapturedReadiness(state, captured);
});

const prepareCapturedReadiness = Effect.fn(
  "StandardApplicationTask.prepareCapturedRuntimeReadiness",
)(function* (
  captured: CapturedPreparationInput,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<
  PreparedTaskRuntimeReadinessVerification,
  PrepareTaskRuntimeReadinessVerificationError
> {
  const receipt = yield* Effect.fromResult(
    decodeTaskRuntimePublicationReceipt(
      captured.receiptCanonicalBytes,
    ).pipe(Result.mapError(cause => readinessInvalid(
      "verify_readiness",
      "invalid_receipt",
      "receiptCanonicalBytes",
      cause,
    ))),
  );
  const receiptSha256 = yield* digest(
    captured.receiptCanonicalBytes,
    MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1,
    sha256,
  );
  if (!bytesEqualFullScan(receiptSha256, captured.receiptSha256)) {
    return yield* readinessFailure(
      "receipt_digest_mismatch",
      "receiptSha256",
    );
  }
  if (!authoritativeEvidenceMatches(receipt, captured.expected)) {
    return yield* readinessFailure("authoritative_evidence_mismatch");
  }

  const rehashedCatalog = yield* hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: captured.expected.taskCatalog.entries.map(entry => entry.manifest),
  }, sha256).pipe(
    Effect.catchTag(
      "InvalidStandardApplicationTaskDefinitionV1Error",
      cause => readinessFailure(
        "authoritative_evidence_mismatch",
        "expected.taskCatalog",
        cause,
      ),
    ),
  );
  if (!catalogsEqual(rehashedCatalog, captured.expected.taskCatalog)) {
    return yield* readinessFailure(
      "authoritative_evidence_mismatch",
      "expected.taskCatalog",
    );
  }
  const receiptTaskCount = receipt.runtimeObjects.filter(
    membership => membership.reference.role === "task_runtime_entry",
  ).length;
  if (receiptTaskCount !== captured.expected.taskCatalog.entries.length) {
    return yield* readinessFailure(
      "authoritative_evidence_mismatch",
      "expected.taskCatalog.entries",
    );
  }

  if (receipt.runtimeObjects.length > 0) {
    const expectedPolicySha256 = yield* hashTaskRuntimeMaterializationSpecV1(
      captured.expected.materializationPolicy,
      sha256,
    ).pipe(Effect.catchTag(
      "InvalidTaskRuntimePublicationError",
      cause => readinessFailure(
        "runtime_policy_unsupported",
        "expected.materializationPolicy",
        cause,
      ),
    ));
    if (
      receipt.taskRuntimeMaterializationSpecSha256 === null ||
      !bytesEqualFullScan(
        expectedPolicySha256,
        receipt.taskRuntimeMaterializationSpecSha256,
      )
    ) return yield* readinessFailure(
      "runtime_policy_unsupported",
      "expected.materializationPolicy",
    );
  }

  const applicationBindingSha256 = yield* hashApplicationRevisionTaskBinding(
    applicationRevisionTaskBinding(receipt),
    sha256,
  ).pipe(
    Effect.catchTag(
      "InvalidStandardApplicationTaskDefinitionV1Error",
      cause => readinessFailure(
        "runtime_root_mismatch",
        "applicationRevisionTaskBindingSha256",
        cause,
      ),
    ),
  );
  if (!bytesEqualFullScan(
    applicationBindingSha256,
    receipt.applicationRevisionTaskBindingSha256,
  )) return yield* readinessFailure(
    "runtime_root_mismatch",
    "applicationRevisionTaskBindingSha256",
  );

  const ownedReferences = Object.freeze(receipt.runtimeObjects.map(
    membership => copyReference(membership.reference),
  ));
  const prepared = Object.freeze({
    readRuntimeObjectReferences: () => Object.freeze(
      ownedReferences.map(copyReference),
    ),
  });
  preparedReadinessStates.set(prepared, Object.freeze({
    receipt,
    receiptSha256: copyDigest(captured.receiptSha256),
    expected: captured.expected,
    sha256,
  }));
  return prepared;
});

const completeCapturedReadiness = Effect.fn(
  "StandardApplicationTask.completeCapturedRuntimeReadiness",
)(function* (
  state: PreparedReadinessState,
  captured: CapturedRuntimeObjects,
): Effect.fn.Return<
  PreparedTaskRuntimeReadinessBasisV1,
  CompleteTaskRuntimeReadinessVerificationError
> {
  const { expected, receipt, sha256 } = state;

  const taskEntryRootSha256 = captured.runtimeObjects.length === 0
    ? yield* hashEntryRoot([], sha256)
    : undefined;
  let materialization = expected.materializationPolicy;
  if (captured.runtimeObjects.length === 0) {
    if (
      expected.taskCatalog.entries.length !== 0 ||
      receipt.runtimeObjects.length !== 0 ||
      taskEntryRootSha256 === undefined ||
      !bytesEqualFullScan(taskEntryRootSha256, receipt.taskEntryRootSha256)
    ) {
      return yield* readinessFailure("runtime_root_mismatch", "empty");
    }
  } else {
    const decoded = yield* decodeAndVerifyObjects(captured, receipt, sha256);
    materialization = decoded.materialization;
    yield* verifyPopulatedGraph(
      decoded,
      receipt,
      expected,
      sha256,
    );
  }

  const basis = makeBasis(
    receipt,
    state.receiptSha256,
    materialization,
    captured.canonicalObjectByteLength,
  );
  const canonicalBytes = yield* Effect.fromResult(
    encodeTaskRuntimeReadinessBasisPreimageV1(basis).pipe(
      Result.mapError(failure => readinessInvalid(
        "verify_readiness",
        failure.reason,
        failure.path,
      )),
    ),
  );
  const basisSha256 = yield* digest(
    canonicalBytes,
    MAX_TASK_RUNTIME_READINESS_BASIS_CANONICAL_BYTES_V1,
    sha256,
  );
  const ownedBasis = copyTaskRuntimeReadinessBasisV1(basis);
  const ownedCanonicalBytes = copyBytes(canonicalBytes);
  const ownedSha256 = copyDigest(basisSha256);
  return Object.freeze({
    version: 1 as const,
    readBasis: () => copyTaskRuntimeReadinessBasisV1(ownedBasis),
    readCanonicalBytes: () => copyBytes(ownedCanonicalBytes),
    readSha256: () => copyDigest(ownedSha256),
  });
});


function authoritativeEvidenceMatches(
  receipt: TaskRuntimePublicationReceipt,
  expected: TaskRuntimeReadinessExpectedEvidence,
): boolean {
  return !(
    receipt.scopeId !== expected.scopeId ||
    receipt.candidateId !== expected.candidateId ||
    receipt.analysisId !== expected.analysisId ||
    receipt.applicationRevisionId !== expected.applicationRevisionId ||
    !bytesEqualFullScan(
      receipt.applicationPublicationSha256,
      expected.applicationPublicationSha256,
    ) ||
    !bytesEqualFullScan(
      receipt.sourceArtifactRootSha256,
      expected.sourceArtifactRootSha256,
    ) ||
    !bytesEqualFullScan(
      receipt.applicationTaskCatalogBindingSha256,
      expected.applicationTaskCatalogBindingSha256,
    ) ||
    !bytesEqualFullScan(
      receipt.taskCatalogSha256,
      expected.taskCatalog.taskCatalogSha256,
    )
  );
}

const decodeAndVerifyObjects = Effect.fn(
  "StandardApplicationTask.decodeRuntimeReadinessObjects",
)(function* (
  input: CapturedRuntimeObjects,
  receipt: TaskRuntimePublicationReceipt,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<DecodedObjects, VerifyTaskRuntimeReadinessError> {
  if (input.runtimeObjects.length !== receipt.runtimeObjects.length) {
    return yield* readinessFailure("runtime_object_mismatch", "runtimeObjects");
  }
  const modules: TaskRuntimeProjectionModuleFrameV1[] = [];
  const entries: TaskRuntimeEntryFrameV1[] = [];
  let projection: TaskRuntimeProjectionFrameV1 | undefined;
  let groupManifest: TaskRuntimeGroupManifestFrameV1 | undefined;
  let materialization: TaskRuntimeMaterializationSpecV1 | undefined;
  for (let index = 0; index < receipt.runtimeObjects.length; index += 1) {
    const membership = receipt.runtimeObjects[index]!;
    const object = input.runtimeObjects[index]!;
    const path = `runtimeObjects[${index}]`;
    if (!referencesEqual(object.reference, membership.reference)) {
      return yield* readinessFailure("runtime_object_mismatch", `${path}.reference`);
    }
    if (BigInt(object.canonicalBytes.byteLength) !== membership.reference.byteLength) {
      return yield* readinessFailure("runtime_object_mismatch", `${path}.byteLength`);
    }
    const bodySha256 = yield* digest(
      object.canonicalBytes,
      Number(membership.reference.byteLength),
      sha256,
    );
    if (!bytesEqualFullScan(bodySha256, membership.reference.sha256)) {
      return yield* readinessFailure("runtime_object_mismatch", `${path}.sha256`);
    }
    switch (membership.reference.role) {
      case "runtime_projection_module": {
        const frame = yield* decodeRuntimeObject(
          decodeTaskRuntimeProjectionModulePreimageV1(object.canonicalBytes),
          path,
        );
        if (frame.moduleOrdinal !== membership.ordinal) {
          return yield* readinessFailure("runtime_object_mismatch", `${path}.ordinal`);
        }
        modules.push(frame);
        break;
      }
      case "task_runtime_projection":
        projection = yield* decodeRuntimeObject(
          decodeTaskRuntimeProjectionPreimageV1(object.canonicalBytes),
          path,
        );
        break;
      case "task_runtime_entry": {
        const entry = yield* decodeRuntimeObject(
          decodeTaskRuntimeEntryPreimageV1(object.canonicalBytes),
          path,
        );
        if (entry.taskOrdinal !== membership.ordinal) {
          return yield* readinessFailure("runtime_object_mismatch", `${path}.ordinal`);
        }
        entries.push(entry);
        break;
      }
      case "task_runtime_group_manifest":
        groupManifest = yield* decodeRuntimeObject(
          decodeTaskRuntimeGroupManifestPreimageV1(object.canonicalBytes),
          path,
        );
        break;
      case "task_runtime_materialization_spec":
        materialization = yield* decodeRuntimeObject(
          decodeTaskRuntimeMaterializationSpecPreimageV1(object.canonicalBytes),
          path,
        );
        break;
    }
  }
  if (
    modules.length === 0 || entries.length === 0 || projection === undefined ||
    groupManifest === undefined || materialization === undefined
  ) return yield* readinessFailure("runtime_object_invalid", "runtimeObjects");
  return Object.freeze({
    modules: Object.freeze(modules),
    projection,
    entries: Object.freeze(entries),
    groupManifest,
    materialization,
  });
});

const verifyPopulatedGraph = Effect.fn(
  "StandardApplicationTask.verifyRuntimeReadinessGraph",
)(function* (
  decoded: DecodedObjects,
  receipt: TaskRuntimePublicationReceipt,
  expected: TaskRuntimeReadinessExpectedEvidence,
  sha256: StandardApplicationTaskSha256V1,
): Effect.fn.Return<void, VerifyTaskRuntimeReadinessError> {
  const projection = yield* verifyTaskRuntimeProjectionV1(
    decoded.projection,
    decoded.modules,
    sha256,
  ).pipe(Effect.catchTag(
    "InvalidTaskRuntimePublicationError",
    cause => readinessFailure(
      "runtime_root_mismatch",
      "taskRuntimeProjectionSha256",
      cause,
    ),
  ));
  const entryRootSha256 = yield* hashEntryRoot(decoded.entries, sha256);
  const groupManifestSha256 = yield* hashTaskRuntimeGroupManifestFrameV1(
    decoded.groupManifest,
    sha256,
  ).pipe(Effect.catchTag(
    "InvalidTaskRuntimePublicationError",
    cause => readinessFailure(
      "runtime_root_mismatch",
      "taskRuntimeGroupManifestSha256",
      cause,
    ),
  ));
  const materializationSha256 = yield* hashTaskRuntimeMaterializationSpecV1(
    decoded.materialization,
    sha256,
  ).pipe(Effect.catchTag(
    "InvalidTaskRuntimePublicationError",
    cause => readinessFailure(
      "runtime_root_mismatch",
      "taskRuntimeMaterializationSpecSha256",
      cause,
    ),
  ));
  const receiptProjectionSha256 = receipt.taskRuntimeProjectionSha256;
  const receiptGroupManifestSha256 = receipt.taskRuntimeGroupManifestSha256;
  const receiptMaterializationSha256 =
    receipt.taskRuntimeMaterializationSpecSha256;
  if (
    receiptProjectionSha256 === null || receiptGroupManifestSha256 === null ||
    receiptMaterializationSha256 === null ||
    !bytesEqualFullScan(
      projection.projectionSha256,
      receiptProjectionSha256,
    ) ||
    !bytesEqualFullScan(entryRootSha256, receipt.taskEntryRootSha256) ||
    !bytesEqualFullScan(groupManifestSha256, receiptGroupManifestSha256) ||
    !bytesEqualFullScan(materializationSha256, receiptMaterializationSha256)
  ) return yield* readinessFailure("runtime_root_mismatch");

  if (
    decoded.entries.length !== expected.taskCatalog.entries.length ||
    decoded.groupManifest.taskCount !== BigInt(decoded.entries.length) ||
    !bytesEqualFullScan(
      decoded.groupManifest.taskCatalogSha256,
      expected.taskCatalog.taskCatalogSha256,
    ) ||
    !bytesEqualFullScan(
      decoded.groupManifest.taskEntryRootSha256,
      entryRootSha256,
    ) ||
    !bytesEqualFullScan(
      decoded.groupManifest.taskRuntimeProjectionSha256,
      projection.projectionSha256,
    ) ||
    !bytesEqualFullScan(
      decoded.groupManifest.taskRuntimeMaterializationSpecSha256,
      materializationSha256,
    )
  ) return yield* readinessFailure("runtime_root_mismatch", "groupManifest");

  const modulesByPath = new Map(decoded.modules.map(module => [
    module.artifactModulePath,
    module,
  ] as const));
  for (let index = 0; index < decoded.entries.length; index += 1) {
    const entry = decoded.entries[index]!;
    const catalogEntry = expected.taskCatalog.entries[index];
    if (
      catalogEntry === undefined || entry.taskId !== catalogEntry.taskId ||
      !bytesEqualFullScan(
        entry.canonicalTaskManifestSha256,
        catalogEntry.canonicalTaskManifestSha256,
      ) ||
      entry.logicalExecutionModule !==
        catalogEntry.manifest.handler.logicalModulePath ||
      entry.artifactExecutionModule !==
        catalogEntry.manifest.handler.artifactModulePath ||
      entry.exportName !== catalogEntry.manifest.handler.exportName ||
      !bytesEqualFullScan(entry.projectionSha256, projection.projectionSha256) ||
      ((modulesByPath.get(entry.artifactExecutionModule)?.sourceRoles ?? 0) &
        SOURCE_ARTIFACT_V2_ROLE_FUNCTION) === 0
    ) return yield* readinessFailure(
      "authoritative_evidence_mismatch",
      `entries[${index}]`,
    );
  }
  if (!materializationPoliciesEqual(
    decoded.materialization,
    expected.materializationPolicy,
  )) return yield* readinessFailure(
    "runtime_policy_unsupported",
    "materializationPolicy",
  );
});


function captureVerificationInput(
  input: unknown,
): Result.Result<
  CapturedVerificationInput,
  InvalidTaskRuntimeReadinessV1Error<"verify_readiness">
> {
  const operation = "verify_readiness" as const;
  return Result.gen(function* () {
    const outer = exactDataRecord(input, [
      "expected",
      "receiptCanonicalBytes",
      "receiptSha256",
      "runtimeObjects",
    ]);
    if (outer === undefined) {
      return yield* Result.fail(readinessInvalid(operation, "invalid_input"));
    }
    const preparation = yield* capturePreparationFields(outer);
    const runtime = yield* captureRuntimeObjects(outer.runtimeObjects);
    return Object.freeze({
      ...preparation,
      ...runtime,
    });
  });
}

function capturePreparationInput(
  input: unknown,
): Result.Result<
  CapturedPreparationInput,
  InvalidTaskRuntimeReadinessV1Error<"verify_readiness">
> {
  const outer = exactDataRecord(input, [
    "expected",
    "receiptCanonicalBytes",
    "receiptSha256",
  ]);
  return outer === undefined
    ? Result.fail(readinessInvalid("verify_readiness", "invalid_input"))
    : capturePreparationFields(outer);
}

function capturePreparationFields(
  outer: Readonly<Record<string, unknown>>,
): Result.Result<
  CapturedPreparationInput,
  InvalidTaskRuntimeReadinessV1Error<"verify_readiness">
> {
  const operation = "verify_readiness" as const;
  return Result.gen(function* () {
    const receiptCanonicalBytes = yield* captureBytes(
      outer.receiptCanonicalBytes,
      MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1,
      operation,
      "receiptCanonicalBytes",
    );
    const receiptSha256 = yield* captureDigest(
      outer.receiptSha256,
      operation,
      "receiptSha256",
    );
    const expected = yield* captureExpectedEvidence(outer.expected);
    return Object.freeze({ receiptCanonicalBytes, receiptSha256, expected });
  });
}

function captureCompletionInput(
  input: unknown,
): Result.Result<
  Readonly<{
    state: PreparedReadinessState;
    runtimeObjects: CapturedRuntimeObjects;
  }>,
  InvalidTaskRuntimeReadinessV1Error<"verify_readiness">
> {
  const outer = exactDataRecord(input, ["prepared", "runtimeObjects"]);
  if (outer === undefined || typeof outer.prepared !== "object" ||
    outer.prepared === null) {
    return Result.fail(readinessInvalid(
      "verify_readiness",
      "invalid_input",
      "prepared",
    ));
  }
  const state = preparedReadinessStates.get(outer.prepared);
  if (state === undefined) {
    return Result.fail(readinessInvalid(
      "verify_readiness",
      "invalid_input",
      "prepared",
    ));
  }
  return captureRuntimeObjects(outer.runtimeObjects).pipe(
    Result.map(runtimeObjects => Object.freeze({ state, runtimeObjects })),
  );
}

function captureRuntimeObjects(
  input: unknown,
): Result.Result<
  CapturedRuntimeObjects,
  InvalidTaskRuntimeReadinessV1Error<"verify_readiness">
> {
  const operation = "verify_readiness" as const;
  const rawObjects = denseDataArray(
    input,
    MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1,
  );
  if (rawObjects === undefined) {
    return Result.fail(readinessInvalid(
      operation,
      "invalid_input",
      "runtimeObjects",
    ));
  }
  return Result.gen(function* () {
    const runtimeObjects: TaskRuntimeReadinessObject[] = [];
    let canonicalObjectByteLength = 0;
    for (let index = 0; index < rawObjects.length; index += 1) {
      const item = exactDataRecord(rawObjects[index], [
        "canonicalBytes",
        "reference",
      ]);
      const path = `runtimeObjects[${index}]`;
      if (item === undefined) {
        return yield* Result.fail(readinessInvalid(
          operation,
          "invalid_input",
          path,
        ));
      }
      const reference = yield* captureReference(item.reference, path);
      const canonicalBytes = yield* captureBytes(
        item.canonicalBytes,
        MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
        operation,
        `${path}.canonicalBytes`,
      );
      canonicalObjectByteLength += canonicalBytes.byteLength;
      if (
        !Number.isSafeInteger(canonicalObjectByteLength) ||
        canonicalObjectByteLength >
          MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1
      ) return yield* Result.fail(readinessInvalid(
        operation,
        "canonical_bytes_exceeded",
        "runtimeObjects",
        undefined,
        canonicalObjectByteLength,
        MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
      ));
      runtimeObjects.push(Object.freeze({ reference, canonicalBytes }));
    }
    return Object.freeze({
      runtimeObjects: Object.freeze(runtimeObjects),
      canonicalObjectByteLength,
    });
  });
}

function captureExpectedEvidence(
  input: unknown,
): Result.Result<
  TaskRuntimeReadinessExpectedEvidence,
  InvalidTaskRuntimeReadinessV1Error<"verify_readiness">
> {
  const operation = "verify_readiness" as const;
  const outer = exactDataRecord(input, [
    "analysisId",
    "applicationPublicationSha256",
    "applicationRevisionId",
    "applicationTaskCatalogBindingSha256",
    "candidateId",
    "materializationPolicy",
    "scopeId",
    "sourceArtifactRootSha256",
    "taskCatalog",
  ]);
  if (
    outer === undefined || !validIdentity(outer.scopeId) ||
    !validIdentity(outer.candidateId) ||
    !validIdentity(outer.analysisId) ||
    !validIdentity(outer.applicationRevisionId)
  ) return Result.fail(readinessInvalid(operation, "invalid_input", "expected"));
  return Result.gen(function* () {
    const taskCatalog = yield* captureTaskCatalog(outer.taskCatalog);
    const materializationPolicy = yield*
      decodeTaskRuntimeMaterializationSpecV1(outer.materializationPolicy).pipe(
        Result.mapError(cause => readinessInvalid(
          operation,
          "invalid_input",
          "expected.materializationPolicy",
          cause,
        )),
      );
    return Object.freeze({
      scopeId: outer.scopeId as string,
      candidateId: outer.candidateId as string,
      analysisId: outer.analysisId as string,
      applicationRevisionId: outer.applicationRevisionId as string,
      applicationPublicationSha256: yield* captureDigest(
        outer.applicationPublicationSha256,
        operation,
        "expected.applicationPublicationSha256",
      ),
      sourceArtifactRootSha256: yield* captureDigest(
        outer.sourceArtifactRootSha256,
        operation,
        "expected.sourceArtifactRootSha256",
      ),
      applicationTaskCatalogBindingSha256: yield* captureDigest(
        outer.applicationTaskCatalogBindingSha256,
        operation,
        "expected.applicationTaskCatalogBindingSha256",
      ),
      taskCatalog,
      materializationPolicy,
    });
  });
}

function captureTaskCatalog(
  input: unknown,
): Result.Result<
  HashedCanonicalTaskCatalogV1,
  InvalidTaskRuntimeReadinessV1Error<"verify_readiness">
> {
  const operation = "verify_readiness" as const;
  const outer = exactDataRecord(input, ["entries", "taskCatalogSha256", "version"]);
  const rawEntries = outer === undefined
    ? undefined
    : denseDataArray(outer.entries, MAX_TASK_CATALOG_ENTRIES_V1);
  if (outer === undefined || outer.version !== 1 || rawEntries === undefined) {
    return Result.fail(readinessInvalid(
      operation,
      "invalid_input",
      "expected.taskCatalog",
    ));
  }
  return Result.gen(function* () {
    const entries: HashedCanonicalTaskCatalogV1["entries"][number][] = [];
    for (let index = 0; index < rawEntries.length; index += 1) {
      const item = exactDataRecord(rawEntries[index], [
        "canonicalTaskManifestSha256",
        "manifest",
        "taskId",
      ]);
      if (item === undefined) return yield* Result.fail(readinessInvalid(
        operation,
        "invalid_input",
        `expected.taskCatalog.entries[${index}]`,
      ));
      const manifest = yield* decodeCanonicalTaskManifestV1(item.manifest).pipe(
        Result.mapError(cause => readinessInvalid(
          operation,
          "invalid_input",
          `expected.taskCatalog.entries[${index}].manifest`,
          cause,
        )),
      );
      if (item.taskId !== manifest.taskId) {
        return yield* Result.fail(readinessInvalid(
          operation,
          "invalid_input",
          `expected.taskCatalog.entries[${index}].taskId`,
        ));
      }
      entries.push(Object.freeze({
        taskId: manifest.taskId,
        manifest,
        canonicalTaskManifestSha256: yield* captureDigest(
          item.canonicalTaskManifestSha256,
          operation,
          `expected.taskCatalog.entries[${index}].canonicalTaskManifestSha256`,
        ),
      }));
    }
    return Object.freeze({
      version: 1 as const,
      entries: Object.freeze(entries),
      taskCatalogSha256: yield* captureDigest(
        outer.taskCatalogSha256,
        operation,
        "expected.taskCatalog.taskCatalogSha256",
      ),
    });
  });
}

function captureReference(
  input: unknown,
  path: string,
): Result.Result<
  TaskRuntimeObjectReferenceV1,
  InvalidTaskRuntimeReadinessV1Error<"verify_readiness">
> {
  const operation = "verify_readiness" as const;
  const outer = exactDataRecord(input, [
    "byteLength",
    "objectKey",
    "role",
    "sha256",
    "storeIdentity",
  ]);
  if (
    outer === undefined || outer.storeIdentity !== TASK_RUNTIME_OBJECT_STORE_V1 ||
    !isRuntimeObjectRole(outer.role) || typeof outer.objectKey !== "string" ||
    typeof outer.byteLength !== "bigint" || outer.byteLength < 1n ||
    outer.byteLength > BigInt(MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1)
  ) return Result.fail(readinessInvalid(operation, "invalid_input", path));
  return captureDigest(outer.sha256, operation, `${path}.sha256`).pipe(
    Result.map(sha256 => Object.freeze({
      storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
      role: outer.role as TaskRuntimeObjectRoleV1,
      objectKey: outer.objectKey as string,
      byteLength: outer.byteLength as bigint,
      sha256,
    })),
  );
}


function makeBasis(
  receipt: TaskRuntimePublicationReceipt,
  receiptSha256: TaskDefinitionSha256V1,
  policy: TaskRuntimeMaterializationSpecV1,
  canonicalObjectByteLength: number,
): TaskRuntimeReadinessBasisV1 {
  return copyTaskRuntimeReadinessBasisV1({
    version: 1,
    kind: receipt.runtimeObjects.length === 0 ? "empty" : "populated",
    scopeId: receipt.scopeId,
    candidateId: receipt.candidateId,
    analysisId: receipt.analysisId,
    applicationRevisionId: receipt.applicationRevisionId,
    publicationReceiptSha256: receiptSha256,
    applicationPublicationSha256: receipt.applicationPublicationSha256,
    sourceArtifactRootSha256: receipt.sourceArtifactRootSha256,
    applicationTaskCatalogBindingSha256:
      receipt.applicationTaskCatalogBindingSha256,
    applicationRevisionTaskBindingSha256:
      receipt.applicationRevisionTaskBindingSha256,
    taskCatalogSha256: receipt.taskCatalogSha256,
    taskCount: BigInt(receipt.runtimeObjects.filter(
      item => item.reference.role === "task_runtime_entry",
    ).length),
    taskEntryRootSha256: receipt.taskEntryRootSha256,
    taskRuntimeProjectionSha256: receipt.taskRuntimeProjectionSha256,
    taskRuntimeGroupManifestSha256:
      receipt.taskRuntimeGroupManifestSha256,
    taskRuntimeMaterializationSpecSha256:
      receipt.taskRuntimeMaterializationSpecSha256,
    runtimeContractIdentity: policy.runtimeContractIdentity,
    bridgeAbiIdentity: policy.bridgeAbiIdentity,
    compatibilityDate: policy.compatibilityDate,
    compatibilityFlags: policy.compatibilityFlags,
    runtimeProfileIdentity: policy.runtimeProfileIdentity,
    runtimeImplementationVersion: policy.runtimeImplementationVersion,
    supportedComputeProfiles: policy.supportedComputeProfiles,
    moduleEntryPolicyIdentity: policy.moduleEntryPolicyIdentity,
    objectCount: BigInt(receipt.runtimeObjects.length),
    canonicalObjectByteLength: BigInt(canonicalObjectByteLength),
  });
}


function applicationRevisionTaskBinding(
  receipt: TaskRuntimePublicationReceipt,
): ApplicationRevisionTaskBinding {
  return Object.freeze({
    kind: "application_revision_task_binding" as const,
    applicationTaskCatalogBindingSha256:
      copyDigest(receipt.applicationTaskCatalogBindingSha256),
    taskCatalogSha256: copyDigest(receipt.taskCatalogSha256),
    taskCount: BigInt(receipt.runtimeObjects.filter(
      item => item.reference.role === "task_runtime_entry",
    ).length),
    taskEntryRootSha256: copyDigest(receipt.taskEntryRootSha256),
    taskRuntimeProjectionSha256:
      copyNullableDigest(receipt.taskRuntimeProjectionSha256),
    taskRuntimeGroupManifestSha256:
      copyNullableDigest(receipt.taskRuntimeGroupManifestSha256),
    taskRuntimeMaterializationSpecSha256:
      copyNullableDigest(receipt.taskRuntimeMaterializationSpecSha256),
  });
}

function hashEntryRoot(
  entries: ReadonlyArray<TaskRuntimeEntryFrameV1>,
  sha256: StandardApplicationTaskSha256V1,
): Effect.Effect<TaskDefinitionSha256V1, VerifyTaskRuntimeReadinessError> {
  return hashTaskRuntimeEntryRootV1(entries, sha256).pipe(
    Effect.catchTag(
      "InvalidTaskRuntimePublicationError",
      cause => readinessFailure(
        "runtime_root_mismatch",
        "taskEntryRootSha256",
        cause,
      ),
    ),
  );
}

function decodeRuntimeObject<Success>(
  result: Result.Result<
    Success,
    InvalidTaskRuntimePublicationError | InvalidStandardApplicationTaskDefinitionV1Error
  >,
  path: string,
): Effect.Effect<Success, InvalidTaskRuntimeReadinessV1Error<"verify_readiness">> {
  return Effect.fromResult(result.pipe(Result.mapError(cause => readinessInvalid(
    "verify_readiness",
    "runtime_object_invalid",
    path,
    cause,
  ))));
}

function captureBytes<Operation extends TaskRuntimeReadinessOperationV1>(
  input: unknown,
  maximum: number,
  operation: Operation,
  path: string,
): Result.Result<Uint8Array, InvalidTaskRuntimeReadinessV1Error<Operation>> {
  const byteLength = uint8ArrayByteLength(input);
  if (byteLength === undefined || byteLength < 1 || byteLength > maximum) {
    return Result.fail(readinessInvalid(
      operation,
      "invalid_input",
      path,
      undefined,
      byteLength,
      maximum,
    ));
  }
  return Result.try({
    try: () => copyBytes(input as Uint8Array),
    catch: () => readinessInvalid(operation, "invalid_input", path),
  });
}

function captureDigest<Operation extends TaskRuntimeReadinessOperationV1>(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<
  TaskDefinitionSha256V1,
  InvalidTaskRuntimeReadinessV1Error<Operation>
> {
  if (!isUint8ArrayWithByteLength(input, 32)) {
    return Result.fail(readinessInvalid(operation, "invalid_input", path));
  }
  return Result.try({
    try: () => copyDigest(input),
    catch: () => readinessInvalid(operation, "invalid_input", path),
  });
}


function digest(
  bytes: Uint8Array,
  maximumInputBytes: number,
  sha256: StandardApplicationTaskSha256V1,
): Effect.Effect<TaskDefinitionSha256V1, StandardApplicationTaskSha256V1Error> {
  return sha256(bytes, { maximumInputBytes }).pipe(
    Effect.map(value => copyDigest(value)),
  );
}

function materializationPoliciesEqual(
  left: TaskRuntimeMaterializationSpecV1,
  right: TaskRuntimeMaterializationSpecV1,
): boolean {
  return left.runtimeContractIdentity === right.runtimeContractIdentity &&
    left.bridgeAbiIdentity === right.bridgeAbiIdentity &&
    left.compatibilityDate === right.compatibilityDate &&
    arraysEqual(left.compatibilityFlags, right.compatibilityFlags) &&
    left.runtimeProfileIdentity === right.runtimeProfileIdentity &&
    left.runtimeImplementationVersion === right.runtimeImplementationVersion &&
    arraysEqual(left.supportedComputeProfiles, right.supportedComputeProfiles) &&
    left.moduleEntryPolicyIdentity === right.moduleEntryPolicyIdentity;
}

function catalogsEqual(
  left: HashedCanonicalTaskCatalogV1,
  right: HashedCanonicalTaskCatalogV1,
): boolean {
  return left.entries.length === right.entries.length &&
    bytesEqualFullScan(left.taskCatalogSha256, right.taskCatalogSha256) &&
    left.entries.every((entry, index) => {
      const other = right.entries[index];
      return other !== undefined && entry.taskId === other.taskId &&
        bytesEqualFullScan(
          entry.canonicalTaskManifestSha256,
          other.canonicalTaskManifestSha256,
        );
    });
}

function referencesEqual(
  left: TaskRuntimeObjectReferenceV1,
  right: TaskRuntimeObjectReferenceV1,
): boolean {
  return left.storeIdentity === right.storeIdentity && left.role === right.role &&
    left.objectKey === right.objectKey && left.byteLength === right.byteLength &&
    bytesEqualFullScan(left.sha256, right.sha256) &&
    left.objectKey === taskRuntimeObjectKeyV1(
      left.role,
      encodeBytesToLowercaseHex(left.sha256),
    );
}

function arraysEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}


function exactDataRecord(
  input: unknown,
  keys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some(key => typeof key !== "string" || !keys.includes(key))
    ) return undefined;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return undefined;
      Object.defineProperty(output, key, {
        enumerable: true,
        value: descriptor.value,
      });
    }
    return output;
  } catch {
    return undefined;
  }
}

function denseDataArray(
  input: unknown,
  maximum: number,
): ReadonlyArray<unknown> | undefined {
  try {
    if (!Array.isArray(input) || input.length > maximum) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const output: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return undefined;
      output.push(descriptor.value);
    }
    return Reflect.ownKeys(descriptors).every(key =>
      key === "length" || (
        typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key) &&
        Number(key) < input.length
      )
    ) ? output : undefined;
  } catch {
    return undefined;
  }
}


function isRuntimeObjectRole(value: unknown): value is TaskRuntimeObjectRoleV1 {
  return value === "runtime_projection_module" ||
    value === "task_runtime_projection" ||
    value === "task_runtime_entry" ||
    value === "task_runtime_group_manifest" ||
    value === "task_runtime_materialization_spec";
}

function hasExactKeys(
  input: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string>,
): boolean {
  const actual = Reflect.ownKeys(input);
  return actual.length === keys.length && actual.every(key =>
    typeof key === "string" && keys.includes(key)
  );
}


function copyDigest(value: Uint8Array): TaskDefinitionSha256V1 {
  return copyBytes(value) as TaskDefinitionSha256V1;
}

function copyNullableDigest(
  value: TaskDefinitionSha256V1 | null,
): TaskDefinitionSha256V1 | null {
  return value === null ? null : copyDigest(value);
}

function copyReference(
  reference: TaskRuntimeObjectReferenceV1,
): TaskRuntimeObjectReferenceV1 {
  return Object.freeze({
    storeIdentity: reference.storeIdentity,
    role: reference.role,
    objectKey: reference.objectKey,
    byteLength: reference.byteLength,
    sha256: copyDigest(reference.sha256),
  });
}

function readinessFailure(
  reason: TaskRuntimeReadinessReasonV1,
  path?: string,
  cause?:
    | InvalidTaskRuntimePublicationError
    | InvalidStandardApplicationTaskDefinitionV1Error,
): Effect.Effect<never, InvalidTaskRuntimeReadinessV1Error<"verify_readiness">> {
  return Effect.fail(readinessInvalid(
    "verify_readiness",
    reason,
    path,
    cause,
  ));
}
