import {
  DECLARATIVE_V2_SEMANTIC_ARTIFACT_BLOCK_FRAME_OVERHEAD_BYTES_V1,
  DECLARATIVE_V2_SEMANTIC_ARTIFACT_CODEC_VERSION_V1,
  decodeDeclarativeV2SemanticArtifactFrameV1,
  declarativeV2SemanticArtifactEmptyTreePreimageV1,
  encodeDeclarativeV2SemanticArtifactFrameV1,
  measureDeclarativeV2SemanticArtifactRootOrSelectorFrameV1,
  type DeclarativeV2SemanticArtifactCodecV1Error,
  type DeclarativeV2SemanticArtifactRootFrameV1,
  type DeclarativeV2SemanticArtifactTreeChildV1,
} from "flarex-protocol/internal/declarative-v2-semantic-artifact-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import { sourceArtifactV2DigestBytesFromLowerHex } from "../sourceArtifactV2/Digest";
import {
  type SemanticArtifactV1Attempt,
  type SemanticArtifactV1AttemptStore,
  type SemanticArtifactV1AttemptStoreError,
  type SemanticArtifactV1Budget,
  type SemanticArtifactV1FrontierEntry,
} from "./AttemptStore";
import { semanticArtifactV1IntrinsicByteLength } from "./Bytes";
import {
  type SemanticArtifactV1ClaimedFinalizedSource,
  type SemanticArtifactV1FinalizedSourceProof,
  type SemanticArtifactV1FinalizedSourceProofClaimError,
  type SemanticArtifactV1FinalizedSourceProofFactory,
} from "./FinalizedSourceProof";
import {
  type SemanticArtifactV1R2Error,
  type SemanticArtifactV1R2Receipt,
  type SemanticArtifactV1R2Store,
} from "./R2Store";
import type {
  SemanticArtifactV1Sha256,
  SemanticArtifactV1Sha256Error,
} from "./Sha256";
import type {
  SemanticArtifactV1SourceCorrelationReader,
  SemanticArtifactV1SourceCorrelationBudgetError,
  SemanticArtifactV1SourceCorrelationCorruptionError,
  SemanticArtifactV1SourceCorrelationResourceError,
} from "./SourceCorrelationReader";

const UTF8_ENCODER = new TextEncoder();
// Pinned by the protocol golden for two fixed-width tree children.
const SEMANTIC_TREE_FRAME_BYTES_V1 = 204;
// Pinned by the protocol golden for the versioned zero-child tree preimage.
const SEMANTIC_EMPTY_TREE_PREIMAGE_BYTES_V1 = 60;

export interface SemanticArtifactV1RootConfiguration {
  readonly semanticModelIdentity: string;
  readonly semanticCodecIdentity: string;
  readonly semanticPolicyIdentity: string;
  readonly coreLanguageIdentity: string;
  readonly abiIdentity: string;
  readonly grammarIdentity: string;
  readonly unicodeIdentity: string;
  readonly parserTableIdentity: string;
  readonly trustedToolingIdentity: string;
  readonly ingressProtocolIdentity: string;
  readonly ingressConfigurationIdentity: string;
}

export interface SemanticArtifactV1Admission {
  readonly calls: number;
  readonly blockBytes: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly hashBytes: number;
  readonly timeMilliseconds: number;
}

export interface SemanticArtifactV1BeginInput {
  readonly request: Request;
  readonly proof: SemanticArtifactV1FinalizedSourceProof;
  readonly deploymentId: string;
  readonly commandId: string;
  readonly ceilings: SemanticArtifactV1Budget;
  readonly admission: SemanticArtifactV1Admission;
}

export interface SemanticArtifactV1CommandInput {
  readonly semanticUploadId: string;
  readonly deploymentId: string;
  readonly expectedGeneration: number;
  readonly expectedMutationFence: number;
  readonly commandId: string;
  readonly admission: SemanticArtifactV1Admission;
}

export interface SemanticArtifactV1AppendInput extends SemanticArtifactV1CommandInput {
  readonly blockOrdinal: number;
  readonly bytes: Uint8Array;
}

export interface SemanticArtifactV1Receipt {
  readonly semanticUploadId: string;
  readonly generation: number;
  readonly mutationFence: number;
  readonly state: "open" | "closing" | "finalized" | "abandoned";
  readonly commandId: string;
  readonly commandDigest: string;
  readonly usage: SemanticArtifactV1Budget;
  readonly completedRootSha256: Uint8Array | null;
  readonly completedSelectorSha256: Uint8Array | null;
}

export interface SemanticArtifactV1FinalizedEvidence {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly semanticUploadId: string;
  readonly semanticGeneration: number;
  readonly semanticMutationFence: number;
  readonly sourceUploadId: string;
  readonly sourceGeneration: number;
  readonly sourceMutationFence: number;
  readonly sourceRootSha256: Uint8Array;
  readonly sourceSelectorSha256: Uint8Array;
  readonly semanticRootSha256: Uint8Array;
  readonly semanticSelectorSha256: Uint8Array;
  readonly semanticAttemptIdentitySha256: Uint8Array;
  readonly usage: SemanticArtifactV1Budget;
}

export class SemanticArtifactV1InputError extends Data.TaggedError(
  "SemanticArtifactV1InputError",
)<{
  readonly operation: "begin" | "append" | "finalize" | "reopen" | "abandon" | "readFinalized";
  readonly field: string;
}> {}

export class SemanticArtifactV1BudgetError extends Data.TaggedError(
  "SemanticArtifactV1BudgetError",
)<{
  readonly operation: "begin" | "append" | "finalize" | "reopen" | "abandon" | "readFinalized";
  readonly dimension: keyof SemanticArtifactV1Budget;
  readonly observed: number;
  readonly maximum: number;
}> {}

export class SemanticArtifactV1StateError extends Data.TaggedError(
  "SemanticArtifactV1StateError",
)<{
  readonly semanticUploadId: string;
  readonly reason:
    | "notFound"
    | "staleGeneration"
    | "staleFence"
    | "deploymentMismatch"
    | "invalidLifecycle"
    | "invalidOrdinal"
    | "missingFinalLf"
    | "conflictingReplay";
}> {}

export class SemanticArtifactV1SourceDriftError extends Data.TaggedError(
  "SemanticArtifactV1SourceDriftError",
)<{ readonly sourceUploadId: string }> {}

export class SemanticArtifactV1CorruptionError extends Data.TaggedError(
  "SemanticArtifactV1CorruptionError",
)<{
  readonly semanticUploadId: string;
  readonly reason: "attemptDigestMismatch" | "rootMismatch" | "selectorMismatch";
}> {}

export type SemanticArtifactV1UploadError =
  | SemanticArtifactV1InputError
  | SemanticArtifactV1BudgetError
  | SemanticArtifactV1StateError
  | SemanticArtifactV1SourceDriftError
  | SemanticArtifactV1CorruptionError
  | SemanticArtifactV1FinalizedSourceProofClaimError
  | SemanticArtifactV1AttemptStoreError
  | SemanticArtifactV1SourceCorrelationBudgetError
  | SemanticArtifactV1SourceCorrelationCorruptionError
  | SemanticArtifactV1SourceCorrelationResourceError
  | SemanticArtifactV1R2Error
  | SemanticArtifactV1Sha256Error;

export interface SemanticArtifactV1UploadCore {
  readonly begin: (
    input: SemanticArtifactV1BeginInput,
  ) => Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError>;
  readonly append: (
    input: SemanticArtifactV1AppendInput,
  ) => Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError>;
  readonly finalize: (
    input: SemanticArtifactV1CommandInput,
  ) => Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError>;
  readonly reopen: (
    request: Request,
    proof: SemanticArtifactV1FinalizedSourceProof,
    input: SemanticArtifactV1CommandInput,
  ) => Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError>;
  readonly abandon: (
    input: SemanticArtifactV1CommandInput,
  ) => Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError>;
  readonly readFinalized: (
    request: Request,
    proof: SemanticArtifactV1FinalizedSourceProof,
    input: SemanticArtifactV1CommandInput,
  ) => Effect.Effect<SemanticArtifactV1FinalizedEvidence, SemanticArtifactV1UploadError>;
}

export function makeSemanticArtifactV1UploadCore(options: {
  readonly proofFactory: SemanticArtifactV1FinalizedSourceProofFactory;
  readonly sourceAttemptReader: SemanticArtifactV1SourceCorrelationReader;
  readonly attemptStore: SemanticArtifactV1AttemptStore;
  readonly r2: SemanticArtifactV1R2Store;
  readonly sha256: SemanticArtifactV1Sha256;
  readonly rootConfiguration: SemanticArtifactV1RootConfiguration;
  readonly makeUploadId: () => string;
}): Result.Result<SemanticArtifactV1UploadCore, SemanticArtifactV1InputError> {
  const config = captureRootConfiguration(options.rootConfiguration);
  if (Result.isFailure(config)) return Result.fail(config.failure);

  const begin = Effect.fn("SemanticArtifactV1Upload.begin")(
    (input: SemanticArtifactV1BeginInput): Effect.Effect<
      SemanticArtifactV1Receipt,
      SemanticArtifactV1UploadError
    > => Effect.suspend(() => {
      const claim = options.proofFactory.claim(input.proof, input.request, input.deploymentId);
      if (Result.isFailure(claim)) return Effect.fail(claim.failure);
      return executeBegin(claim.success, input, config.success, options);
    }),
  );

  const append = Effect.fn("SemanticArtifactV1Upload.append")(
    (input: SemanticArtifactV1AppendInput) => executeAppend(input, options),
  );
  const finalize = Effect.fn("SemanticArtifactV1Upload.finalize")(
    (input: SemanticArtifactV1CommandInput) => executeFinalize(input, config.success, options),
  );
  const reopen = Effect.fn("SemanticArtifactV1Upload.reopen")(
    (
      request: Request,
      proof: SemanticArtifactV1FinalizedSourceProof,
      input: SemanticArtifactV1CommandInput,
    ) => Effect.suspend(() => {
      const claim = options.proofFactory.claim(proof, request, input.deploymentId);
      if (Result.isFailure(claim)) return Effect.fail(claim.failure);
      return executeReopen(claim.success, input, options);
    }),
  );
  const abandon = Effect.fn("SemanticArtifactV1Upload.abandon")(
    (input: SemanticArtifactV1CommandInput) => executeAbandon(input, options),
  );
  const readFinalized = Effect.fn("SemanticArtifactV1Upload.readFinalized")(
    (
      request: Request,
      proof: SemanticArtifactV1FinalizedSourceProof,
      input: SemanticArtifactV1CommandInput,
    ) => Effect.suspend(() => {
      const claim = options.proofFactory.claim(proof, request, input.deploymentId);
      if (Result.isFailure(claim)) return Effect.fail(claim.failure);
      return executeReadFinalized(claim.success, input, config.success, options);
    }),
  );
  return Result.succeed(Object.freeze({
    begin,
    append,
    finalize,
    reopen,
    abandon,
    readFinalized,
  }));
}

function executeBegin(
  source: SemanticArtifactV1ClaimedFinalizedSource,
  input: SemanticArtifactV1BeginInput,
  config: SemanticArtifactV1RootConfiguration,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const operation = "begin" as const;
    const ceilings = yield* Effect.fromResult(captureBudget(operation, input.ceilings, "ceilings"));
    const admission = yield* Effect.fromResult(captureBudget(operation, input.admission, "admission"));
    yield* Effect.fromResult(ensureFits(operation, admission, ceilings));
    yield* ensureCharge(operation, admission, zeroCharge({ calls: 10 }));
    if (!isNonEmptyString(input.commandId)) return yield* inputFailure(operation, "commandId");
    const sourceAttempt = yield* options.sourceAttemptReader.read(
      source.sourceUploadId,
      attemptReadBudget(admission),
    );
    if (
      sourceAttempt === null || sourceAttempt.state !== "finalized" ||
      sourceAttempt.generation !== source.sourceGeneration ||
      sourceAttempt.mutationFence !== source.sourceMutationFence ||
      sourceAttempt.completedRootDigest !== encodeBytesToLowercaseHex(source.sourceRootSha256) ||
      sourceAttempt.completedSelectorDigest !==
        encodeBytesToLowercaseHex(source.sourceSelectorSha256)
    ) {
      return yield* sourceDriftFailure(source.sourceUploadId);
    }
    const semanticUploadId = options.makeUploadId();
    if (!isNonEmptyString(semanticUploadId)) {
      return yield* Effect.die(new Error("Semantic upload ID factory returned invalid data."));
    }
    const ceilingsByteLength = budgetCanonicalByteLength(ceilings);
    yield* ensureCharge(operation, admission, {
      calls: 10,
      blockBytes: 0,
      canonicalBytes: ceilingsByteLength,
      frameBytes: 0,
      hashBytes: ceilingsByteLength,
      timeMilliseconds: admission.timeMilliseconds,
    });
    const ceilingsBytes = UTF8_ENCODER.encode(JSON.stringify(ceilings));
    if (ceilingsBytes.byteLength !== ceilingsByteLength) {
      return yield* Effect.die(
        new Error("Semantic artifact budget canonical byte measurement drifted."),
      );
    }
    const ceilingsSha256 = yield* options.sha256(ceilingsBytes, {
      maximumInputBytes: admission.hashBytes,
    });
    const encoded = encodeDeclarativeV2SemanticArtifactFrameV1({
      kind: "semantic_attempt",
      projectId: source.projectId,
      deploymentId: source.deploymentId,
      deploymentCreatedAt: source.deploymentCreatedAt,
      semanticUploadId,
      sourceArtifactCodecVersion: 1,
      sourceUploadId: source.sourceUploadId,
      sourceGeneration: BigInt(source.sourceGeneration),
      sourceMutationFence: BigInt(source.sourceMutationFence),
      sourceRootSha256: source.sourceRootSha256,
      sourceSelectorSha256: source.sourceSelectorSha256,
      semanticArtifactCodecVersion: DECLARATIVE_V2_SEMANTIC_ARTIFACT_CODEC_VERSION_V1,
      semanticGeneration: 1n,
      semanticMutationFence: 0n,
      semanticModelIdentity: config.semanticModelIdentity,
      semanticCodecIdentity: config.semanticCodecIdentity,
      semanticPolicyIdentity: config.semanticPolicyIdentity,
      semanticIngressProtocolIdentity: config.ingressProtocolIdentity,
      semanticIngressConfigurationIdentity: config.ingressConfigurationIdentity,
      ceilingsSha256,
    }, {
      maximumFrameBytes: admission.frameBytes,
      maximumCanonicalBytes: admission.canonicalBytes,
    });
    if (Result.isFailure(encoded)) {
      return yield* projectCodecFailure(operation, "attemptFrame", encoded.failure);
    }
    const attemptDigest = yield* options.sha256(encoded.success.canonicalBytes, {
      maximumInputBytes: admission.hashBytes,
    });
    const digestHex = encodeBytesToLowercaseHex(attemptDigest);
    const usage = Object.freeze({
      calls: 10,
      blockBytes: 0,
      canonicalBytes: checkedAdd(
        ceilingsBytes.byteLength,
        encoded.success.usage.canonicalBytes,
      ),
      frameBytes: encoded.success.usage.frameBytes,
      hashBytes: checkedAdd(
        ceilingsBytes.byteLength,
        encoded.success.canonicalBytes.byteLength,
      ),
      timeMilliseconds: admission.timeMilliseconds,
    });
    yield* ensureCharge(operation, admission, usage);
    const next: SemanticArtifactV1Attempt = Object.freeze({
      semanticUploadId,
      generation: 1,
      mutationFence: 0,
      state: "open",
      attemptFrameBytes: copyBytes(encoded.success.canonicalBytes),
      attemptCanonicalByteLength: encoded.success.usage.canonicalBytes,
      attemptSha256: digestHex,
      projectId: source.projectId,
      deploymentId: source.deploymentId,
      deploymentCreatedAt: source.deploymentCreatedAt,
      sourceUploadId: source.sourceUploadId,
      sourceGeneration: source.sourceGeneration,
      sourceMutationFence: source.sourceMutationFence,
      sourceRootSha256: encodeBytesToLowercaseHex(source.sourceRootSha256),
      sourceSelectorSha256: encodeBytesToLowercaseHex(source.sourceSelectorSha256),
      nextBlockOrdinal: 0,
      streamByteLength: 0,
      lineFeedCount: 0,
      lastBlockDigest: null,
      lastBlockFrameByteLength: null,
      frontier: Object.freeze([]),
      ceilings,
      usage,
      pendingCommand: null,
      lastCommandId: input.commandId,
      lastCommandDigest: digestHex,
      lastReceipt: Object.freeze({ operation, semanticUploadId, generation: 1 }),
      completedRootDigest: null,
      completedSelectorDigest: null,
    });
    const settled = yield* options.attemptStore.write({
      semanticUploadId,
      commandId: input.commandId,
      commandDigest: digestHex,
      expectedFence: null,
      readBudget: attemptWriteBudget(admission, null),
      next,
    });
    return receipt(settled);
  });
}

function executeAppend(
  input: SemanticArtifactV1AppendInput,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const operation = "append" as const;
    const captured = yield* captureCommand(operation, input);
    yield* ensureCharge(operation, captured.admission, zeroCharge({ calls: 2 }));
    if (!isNonNegativeSafeInteger(input.blockOrdinal)) {
      return yield* inputFailure(operation, "blockOrdinal");
    }
    const inputByteLength = semanticArtifactV1IntrinsicByteLength(input.bytes);
    if (inputByteLength === undefined || inputByteLength === 0) {
      return yield* inputFailure(operation, "bytes");
    }
    if (inputByteLength > captured.admission.blockBytes) {
      return yield* Effect.fail(new SemanticArtifactV1BudgetError({
        operation,
        dimension: "blockBytes",
        observed: inputByteLength,
        maximum: captured.admission.blockBytes,
      }));
    }
    const current = yield* readAttemptRow(captured, options);
    yield* ensureCharge(operation, captured.admission, zeroCharge({
      calls: 4,
      hashBytes: checkedAdd(current.attemptFrameBytes.byteLength, inputByteLength),
    }));
    yield* verifyAttemptDigest(current, captured.admission, options);
    if (
      current.pendingCommand === null &&
      current.lastCommandId === captured.commandId
    ) {
      const bytes = copyBytes(input.bytes as Uint8Array);
      const bodySha256 = yield* options.sha256(bytes, {
        maximumInputBytes: captured.admission.hashBytes,
      });
      const bodyDigest = encodeBytesToLowercaseHex(bodySha256);
      if (
        current.lastReceipt.operation !== "append" ||
        current.lastReceipt.blockOrdinal !== input.blockOrdinal ||
        current.lastReceipt.bodySha256 !== bodyDigest
      ) return yield* stateFailure(current.semanticUploadId, "conflictingReplay");
      return receipt(current);
    }
    if (current.state !== "open") return yield* stateFailure(current.semanticUploadId, "invalidLifecycle");
    if (
      current.pendingCommand !== null &&
      (
        current.pendingCommand.kind !== "append" ||
        current.pendingCommand.commandId !== captured.commandId ||
        !budgetEqual(current.pendingCommand.admission, captured.admission)
      )
    ) return yield* stateFailure(current.semanticUploadId, "conflictingReplay");
    if (current.pendingCommand === null) {
      yield* requireExpectedFence(current, captured.expectedMutationFence);
    } else if (
      captured.expectedMutationFence !== current.mutationFence - 1
    ) {
      return yield* stateFailure(current.semanticUploadId, "staleFence");
    }
    if (current.nextBlockOrdinal !== input.blockOrdinal) {
      return yield* stateFailure(current.semanticUploadId, "invalidOrdinal");
    }
    const mergeCount = equalFrontierMergeCount(current.frontier);
    const treeFrameBytes = checkedMultiply(mergeCount, SEMANTIC_TREE_FRAME_BYTES_V1);
    const blockFrameBytes = checkedAdd(
      DECLARATIVE_V2_SEMANTIC_ARTIFACT_BLOCK_FRAME_OVERHEAD_BYTES_V1,
      inputByteLength,
    );
    const appendCharge = {
      calls: checkedAdd(27, checkedMultiply(mergeCount, 7)),
      blockBytes: inputByteLength,
      canonicalBytes: checkedMultiply(current.attemptCanonicalByteLength, 3),
      frameBytes: checkedAdd(
        checkedMultiply(current.attemptFrameBytes.byteLength, 3),
        checkedAdd(
          checkedMultiply(blockFrameBytes, 6),
          checkedMultiply(treeFrameBytes, 6),
        ),
      ),
      hashBytes: checkedAdd(
        checkedAdd(
          current.attemptFrameBytes.byteLength,
          inputByteLength,
        ),
        checkedAdd(
          checkedMultiply(blockFrameBytes, 3),
          checkedAdd(
            checkedMultiply(treeFrameBytes, 3),
            checkedMultiply(current.attemptFrameBytes.byteLength, 2),
          ),
        ),
      ),
      timeMilliseconds: captured.admission.timeMilliseconds,
    } satisfies SemanticArtifactV1Budget;
    yield* ensureCharge(operation, captured.admission, appendCharge);
    const nextUsage = current.pendingCommand === null
      ? yield* chargeCumulative(
        operation,
        current,
        captured.admission,
        appendCharge,
      )
      : current.usage;
    const bytes = copyBytes(input.bytes as Uint8Array);
    const encoded = encodeDeclarativeV2SemanticArtifactFrameV1({
      kind: "semantic_block",
      blockOrdinal: BigInt(input.blockOrdinal),
      firstByteOffset: BigInt(current.streamByteLength),
      bodyBytes: bytes,
      lineFeedCount: countLineFeeds(bytes),
    }, {
      maximumFrameBytes: captured.admission.frameBytes,
      maximumCanonicalBytes: captured.admission.canonicalBytes,
    });
    if (Result.isFailure(encoded)) {
      return yield* projectCodecFailure(operation, "blockFrame", encoded.failure);
    }
    if (encoded.success.usage.frameBytes !== blockFrameBytes) {
      return yield* Effect.die(new Error("Semantic block measurement changed during encoding."));
    }
    const bodySha256 = yield* options.sha256(bytes, {
      maximumInputBytes: captured.admission.hashBytes,
    });
    const bodyDigest = encodeBytesToLowercaseHex(bodySha256);
    const digest = yield* options.sha256(encoded.success.canonicalBytes, {
      maximumInputBytes: captured.admission.hashBytes,
    });
    const commandDigest = encodeBytesToLowercaseHex(digest);
    if (
      current.pendingCommand !== null &&
      current.pendingCommand.commandDigest !== commandDigest
    ) return yield* stateFailure(current.semanticUploadId, "conflictingReplay");
    const reservedFence = current.pendingCommand === null
      ? checkedIncrement(current.mutationFence)
      : current.mutationFence;
    const reservedIdentity = current.pendingCommand === null
      ? yield* refreshAttemptIdentity(
        operation,
        current,
        reservedFence,
        captured.admission,
        options,
      )
      : null;
    const reservationCommandId =
      `semantic-artifact-v1:append-reservation:${JSON.stringify(captured.commandId)}`;
    const reserved = current.pendingCommand === null
      ? yield* options.attemptStore.write({
        semanticUploadId: current.semanticUploadId,
        commandId: reservationCommandId,
        commandDigest,
        expectedFence: current.mutationFence,
        readBudget: attemptWriteBudget(captured.admission, current.mutationFence),
        next: Object.freeze({
          ...current,
          ...reservedIdentity,
          mutationFence: reservedFence,
          usage: nextUsage,
          pendingCommand: Object.freeze({
            kind: "append" as const,
            commandId: captured.commandId,
            commandDigest,
            admission: captured.admission,
          }),
          lastCommandId: reservationCommandId,
          lastCommandDigest: commandDigest,
          lastReceipt: Object.freeze({
            operation,
            stage: "reserved",
            blockOrdinal: input.blockOrdinal,
            bodySha256: bodyDigest,
          }),
        }),
      })
      : current;
    if (
      reserved.pendingCommand?.kind !== "append" ||
      reserved.pendingCommand.commandId !== captured.commandId ||
      reserved.pendingCommand.commandDigest !== commandDigest ||
      !budgetEqual(reserved.pendingCommand.admission, captured.admission) ||
      !budgetEqual(reserved.usage, nextUsage) ||
      reserved.lastReceipt.operation !== operation ||
      reserved.lastReceipt.stage !== "reserved" ||
      reserved.lastReceipt.blockOrdinal !== input.blockOrdinal ||
      reserved.lastReceipt.bodySha256 !== bodyDigest
    ) return yield* stateFailure(current.semanticUploadId, "conflictingReplay");
    const blockStored = yield* options.r2.putImmutable(
      "block",
      digest,
      encoded.success.canonicalBytes,
      {
      maximumCalls: 6,
      maximumBodyBytes: checkedMultiply(encoded.success.canonicalBytes.byteLength, 5),
      maximumHashBytes: checkedMultiply(encoded.success.canonicalBytes.byteLength, 2),
      },
    );
    yield* verifyPutReceipt(blockStored, encoded.success.canonicalBytes.byteLength);
    const blockEntry: SemanticArtifactV1FrontierEntry = Object.freeze({
      firstBlockOrdinal: input.blockOrdinal,
      blockCount: 1,
      firstByteOffset: current.streamByteLength,
      byteLength: bytes.byteLength,
      lineFeedCount: Number(countLineFeeds(bytes)),
      digest: encodeBytesToLowercaseHex(digest),
    });
    const folded = yield* foldEqualFrontier(
      current.frontier,
      blockEntry,
      captured.admission,
      options,
    );
    const nextFence = checkedIncrement(reserved.mutationFence);
    const refreshedIdentity = yield* refreshAttemptIdentity(
      operation,
      reserved,
      nextFence,
      captured.admission,
      options,
    );
    const next: SemanticArtifactV1Attempt = Object.freeze({
      ...reserved,
      ...refreshedIdentity,
      mutationFence: nextFence,
      nextBlockOrdinal: checkedIncrement(current.nextBlockOrdinal),
      streamByteLength: checkedAdd(current.streamByteLength, bytes.byteLength),
      lineFeedCount: checkedAdd(current.lineFeedCount, Number(countLineFeeds(bytes))),
      lastBlockDigest: commandDigest,
      lastBlockFrameByteLength: encoded.success.canonicalBytes.byteLength,
      frontier: folded,
      usage: nextUsage,
      pendingCommand: null,
      lastCommandId: captured.commandId,
      lastCommandDigest: commandDigest,
      lastReceipt: Object.freeze({
        operation,
        blockOrdinal: input.blockOrdinal,
        blockSha256: commandDigest,
        bodySha256: bodyDigest,
      }),
    });
    return receipt(yield* options.attemptStore.write({
      semanticUploadId: current.semanticUploadId,
      commandId: captured.commandId,
      commandDigest,
      expectedFence: reserved.mutationFence,
      readBudget: attemptWriteBudget(captured.admission, reserved.mutationFence),
      next,
    }));
  });
}

function executeFinalize(
  input: SemanticArtifactV1CommandInput,
  config: SemanticArtifactV1RootConfiguration,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const operation = "finalize" as const;
    const captured = yield* captureCommand(operation, input);
    yield* ensureCharge(operation, captured.admission, zeroCharge({ calls: 3 }));
    const current = yield* readVerifiedAttempt(captured, options);
    const replay = replayReceipt(current, captured.commandId);
    if (replay !== null) return replay;
    if (current.state !== "open" && current.state !== "closing") {
      return yield* stateFailure(current.semanticUploadId, "invalidLifecycle");
    }
    if (
      current.state === "open" &&
      current.pendingCommand !== null
    ) return yield* stateFailure(current.semanticUploadId, "invalidLifecycle");
    if (
      current.state === "closing" &&
      (
        current.pendingCommand?.kind !== "finalize" ||
        current.pendingCommand.commandId !== captured.commandId ||
        !budgetEqual(current.pendingCommand.admission, captured.admission)
      )
    ) return yield* stateFailure(current.semanticUploadId, "conflictingReplay");
    if (current.state !== "closing") {
      yield* requireExpectedFence(current, captured.expectedMutationFence);
    }
    const rootMeasurement = measureDeclarativeV2SemanticArtifactRootOrSelectorFrameV1(
      makeRootFrame(current, config, new Uint8Array(32)),
      {
        maximumFrameBytes: captured.admission.frameBytes,
        maximumCanonicalBytes: captured.admission.canonicalBytes,
      },
    );
    const selectorMeasurement = measureDeclarativeV2SemanticArtifactRootOrSelectorFrameV1({
      kind: "semantic_selector",
      semanticArtifactCodecVersion: DECLARATIVE_V2_SEMANTIC_ARTIFACT_CODEC_VERSION_V1,
      attemptIdentitySha256: new Uint8Array(32),
      semanticRootSha256: new Uint8Array(32),
    }, {
      maximumFrameBytes: captured.admission.frameBytes,
      maximumCanonicalBytes: captured.admission.canonicalBytes,
    });
    const decodedAttempt = decodeDeclarativeV2SemanticArtifactFrameV1(
      current.attemptFrameBytes,
      {
        maximumFrameBytes: captured.admission.frameBytes,
        maximumCanonicalBytes: captured.admission.canonicalBytes,
      },
    );
    if (Result.isFailure(rootMeasurement)) {
      return yield* projectCodecFailure(operation, "rootFrame", rootMeasurement.failure);
    }
    if (Result.isFailure(selectorMeasurement)) {
      return yield* projectCodecFailure(
        operation,
        "selectorFrame",
        selectorMeasurement.failure,
      );
    }
    if (Result.isFailure(decodedAttempt)) {
      return yield* Effect.fail(new SemanticArtifactV1CorruptionError({
        semanticUploadId: current.semanticUploadId,
        reason: "attemptDigestMismatch",
      }));
    }
    const mergeCount = Math.max(0, current.frontier.length - 1);
    const identityRefreshCount = current.state === "open" ? 2 : 1;
    const treeBytes = checkedMultiply(mergeCount, SEMANTIC_TREE_FRAME_BYTES_V1);
    const finalizationCharge: SemanticArtifactV1Budget = {
      calls: checkedAdd(
        current.state === "open"
          ? current.nextBlockOrdinal === 0 ? 28 : 29
          : current.nextBlockOrdinal === 0 ? 20 : 21,
        checkedMultiply(mergeCount, 7),
      ),
      blockBytes: 0,
      canonicalBytes: checkedAdd(
        checkedMultiply(
          decodedAttempt.success.usage.canonicalBytes,
          identityRefreshCount + 1,
        ),
        checkedAdd(
          checkedMultiply(rootMeasurement.success.canonicalBytes, 2),
          checkedMultiply(selectorMeasurement.success.canonicalBytes, 2),
        ),
      ),
      frameBytes: checkedAdd(
        checkedMultiply(
          current.attemptFrameBytes.byteLength,
          identityRefreshCount + 1,
        ),
        checkedAdd(
          checkedMultiply(treeBytes, 6),
          checkedAdd(
            current.nextBlockOrdinal === 0
              ? checkedMultiply(SEMANTIC_EMPTY_TREE_PREIMAGE_BYTES_V1, 3)
              : 0,
            checkedAdd(
              checkedMultiply(rootMeasurement.success.frameBytes, 6),
              checkedAdd(
                selectorMeasurement.success.frameBytes,
                current.nextBlockOrdinal === 0
                  ? 0
                  : checkedMultiply(current.lastBlockFrameByteLength ?? 0, 3),
              ),
            ),
          ),
        ),
      ),
      hashBytes: checkedAdd(
        checkedAdd(
          current.attemptFrameBytes.byteLength,
          current.nextBlockOrdinal === 0
            ? 60
            : current.lastBlockFrameByteLength ?? 0,
        ),
        checkedAdd(
              checkedMultiply(treeBytes, 3),
              checkedAdd(
            checkedMultiply(rootMeasurement.success.frameBytes, 3),
            checkedAdd(
              checkedMultiply(
                current.attemptFrameBytes.byteLength,
                identityRefreshCount,
              ),
              selectorMeasurement.success.frameBytes,
            ),
          ),
        ),
      ),
      timeMilliseconds: captured.admission.timeMilliseconds,
    };
    const reservedUsage = current.state === "open"
      ? yield* chargeCumulative(
        operation,
        current,
        captured.admission,
        finalizationCharge,
      )
      : current.usage;
    const closingFence = checkedIncrement(current.mutationFence);
    const closingIdentity = current.state === "closing"
      ? null
      : yield* refreshAttemptIdentity(
        operation,
        current,
        closingFence,
        captured.admission,
        options,
      );
    const closing = current.state === "closing" ? current : yield* options.attemptStore.write({
      semanticUploadId: current.semanticUploadId,
      commandId: `${captured.commandId}:closing`,
      commandDigest: closingIdentity!.attemptSha256,
      expectedFence: current.mutationFence,
      readBudget: attemptWriteBudget(captured.admission, current.mutationFence),
      next: Object.freeze({
        ...current,
        ...closingIdentity,
        state: "closing" as const,
        mutationFence: closingFence,
        pendingCommand: Object.freeze({
          kind: "finalize" as const,
          commandId: captured.commandId,
          commandDigest: closingIdentity!.attemptSha256,
          admission: captured.admission,
        }),
        usage: reservedUsage,
        lastCommandId: `${captured.commandId}:closing`,
        lastCommandDigest: closingIdentity!.attemptSha256,
        lastReceipt: Object.freeze({ operation, stage: "closing" }),
      }),
    });
    if (closing.nextBlockOrdinal > 0) {
      if (closing.lastBlockDigest === null) {
        return yield* Effect.fail(new SemanticArtifactV1CorruptionError({
          semanticUploadId: closing.semanticUploadId,
          reason: "rootMismatch",
        }));
      }
      const last = yield* options.r2.readImmutable(
        "block",
        sourceArtifactV2DigestBytesFromLowerHex(closing.lastBlockDigest),
        {
          maximumCalls: 2,
          maximumBodyBytes: checkedMultiply(
            closing.lastBlockFrameByteLength ?? 0,
            2,
          ),
          maximumHashBytes: closing.lastBlockFrameByteLength ?? 0,
        },
      );
      yield* verifyReadReceipt(last, closing.lastBlockFrameByteLength ?? 0);
      const decodedLast = decodeDeclarativeV2SemanticArtifactFrameV1(last.bytes, {
        maximumFrameBytes: captured.admission.frameBytes,
        maximumCanonicalBytes: captured.admission.canonicalBytes,
      });
      if (
        Result.isFailure(decodedLast) ||
        decodedLast.success.value.kind !== "semantic_block" ||
        decodedLast.success.value.bodyBytes[
            decodedLast.success.value.bodyBytes.byteLength - 1
          ] !== 0x0a
      ) {
        return yield* stateFailure(closing.semanticUploadId, "missingFinalLf");
      }
    }
    const tree = yield* collapseFrontier(closing.frontier, captured.admission, options);
    const treeRoot = tree === null
      ? yield* hashEmptyTree(captured.admission, options.sha256)
      : sourceArtifactV2DigestBytesFromLowerHex(tree.digest);
    const rootFrame = makeRootFrame(closing, config, treeRoot);
    const encodedRoot = encodeDeclarativeV2SemanticArtifactFrameV1(rootFrame, {
      maximumFrameBytes: captured.admission.frameBytes,
      maximumCanonicalBytes: captured.admission.canonicalBytes,
    });
    if (Result.isFailure(encodedRoot)) {
      return yield* projectCodecFailure(operation, "rootFrame", encodedRoot.failure);
    }
    const rootDigest = yield* options.sha256(encodedRoot.success.canonicalBytes, {
      maximumInputBytes: captured.admission.hashBytes,
    });
    const rootStored = yield* options.r2.putImmutable(
      "root",
      rootDigest,
      encodedRoot.success.canonicalBytes,
      {
        maximumCalls: 6,
        maximumBodyBytes: checkedMultiply(encodedRoot.success.canonicalBytes.byteLength, 5),
        maximumHashBytes: checkedMultiply(encodedRoot.success.canonicalBytes.byteLength, 2),
      },
    );
    yield* verifyPutReceipt(rootStored, encodedRoot.success.canonicalBytes.byteLength);
    const finalizedFence = checkedIncrement(closing.mutationFence);
    const finalizedIdentity = yield* refreshAttemptIdentity(
      operation,
      closing,
      finalizedFence,
      captured.admission,
      options,
    );
    const selector = encodeDeclarativeV2SemanticArtifactFrameV1({
      kind: "semantic_selector",
      semanticArtifactCodecVersion: DECLARATIVE_V2_SEMANTIC_ARTIFACT_CODEC_VERSION_V1,
      attemptIdentitySha256: sourceArtifactV2DigestBytesFromLowerHex(
        finalizedIdentity.attemptSha256,
      ),
      semanticRootSha256: rootDigest,
    }, {
      maximumFrameBytes: captured.admission.frameBytes,
      maximumCanonicalBytes: captured.admission.canonicalBytes,
    });
    if (Result.isFailure(selector)) {
      return yield* projectCodecFailure(operation, "selectorFrame", selector.failure);
    }
    const selectorDigest = yield* options.sha256(selector.success.canonicalBytes, {
      maximumInputBytes: captured.admission.hashBytes,
    });
    const commandDigest = encodeBytesToLowercaseHex(selectorDigest);
    const finalized: SemanticArtifactV1Attempt = Object.freeze({
      ...closing,
      ...finalizedIdentity,
      mutationFence: finalizedFence,
      state: "finalized",
      pendingCommand: null,
      frontier: tree === null ? Object.freeze([]) : Object.freeze([tree]),
      lastCommandId: captured.commandId,
      lastCommandDigest: commandDigest,
      lastReceipt: Object.freeze({
        operation,
        rootSha256: encodeBytesToLowercaseHex(rootDigest),
        selectorSha256: commandDigest,
      }),
      completedRootDigest: encodeBytesToLowercaseHex(rootDigest),
      completedSelectorDigest: commandDigest,
    });
    return receipt(yield* options.attemptStore.write({
      semanticUploadId: closing.semanticUploadId,
      commandId: captured.commandId,
      commandDigest,
      expectedFence: closing.mutationFence,
      readBudget: attemptWriteBudget(captured.admission, closing.mutationFence),
      next: finalized,
    }));
  });
}

function executeReopen(
  source: SemanticArtifactV1ClaimedFinalizedSource,
  input: SemanticArtifactV1CommandInput,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const captured = yield* captureCommand("reopen", input);
    yield* ensureCharge("reopen", captured.admission, zeroCharge({ calls: 3 }));
    const current = yield* readVerifiedAttempt(captured, options);
    yield* compareSource(current, source);
    if (current.state === "abandoned") return yield* stateFailure(current.semanticUploadId, "invalidLifecycle");
    if (
      current.state === "open" &&
      current.pendingCommand !== null
    ) return yield* stateFailure(current.semanticUploadId, "invalidLifecycle");
    const replay = replayReceipt(current, captured.commandId);
    if (replay !== null) return replay;
    if (
      current.state === "closing" &&
      current.mutationFence === checkedIncrement(captured.expectedMutationFence)
    ) {
      // The caller may know only the pre-reservation fence after a lost or
      // rejected finalization response.
    } else {
      yield* requireExpectedFence(current, captured.expectedMutationFence);
    }
    if (current.state === "finalized") return receipt(current);
    const usage = yield* chargeIdentityMutation(
      "reopen",
      current,
      captured.admission,
    );
    const nextFence = checkedIncrement(current.mutationFence);
    const refreshed = yield* refreshAttemptIdentity(
      "reopen",
      current,
      nextFence,
      captured.admission,
      options,
    );
    const reopened: SemanticArtifactV1Attempt = Object.freeze({
      ...current,
      ...refreshed,
      state: "open",
      mutationFence: nextFence,
      usage,
      pendingCommand: null,
      lastCommandId: captured.commandId,
      lastCommandDigest: refreshed.attemptSha256,
      lastReceipt: Object.freeze({ operation: "reopen" }),
    });
    return receipt(yield* options.attemptStore.write({
      semanticUploadId: current.semanticUploadId,
      commandId: captured.commandId,
      commandDigest: refreshed.attemptSha256,
      expectedFence: current.mutationFence,
      readBudget: attemptWriteBudget(captured.admission, current.mutationFence),
      next: reopened,
    }));
  });
}

function executeAbandon(
  input: SemanticArtifactV1CommandInput,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1Receipt, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const captured = yield* captureCommand("abandon", input);
    yield* ensureCharge("abandon", captured.admission, zeroCharge({ calls: 3 }));
    const current = yield* readVerifiedAttempt(captured, options);
    const replay = replayReceipt(current, captured.commandId);
    if (replay !== null) return replay;
    if (
      current.pendingCommand?.kind === "append" &&
      current.mutationFence === checkedIncrement(captured.expectedMutationFence)
    ) {
      // Abandon may explicitly terminate a digest-bound append reservation
      // after the caller observed only its pre-reservation fence.
    } else {
      yield* requireExpectedFence(current, captured.expectedMutationFence);
    }
    if (current.state === "finalized" || current.state === "abandoned") {
      return yield* stateFailure(current.semanticUploadId, "invalidLifecycle");
    }
    const usage = yield* chargeIdentityMutation(
      "abandon",
      current,
      captured.admission,
    );
    const abandonedFence = checkedIncrement(current.mutationFence);
    const abandonedIdentity = yield* refreshAttemptIdentity(
      "abandon",
      current,
      abandonedFence,
      captured.admission,
      options,
    );
    const commandDigest = abandonedIdentity.attemptSha256;
    const abandoned: SemanticArtifactV1Attempt = Object.freeze({
      ...current,
      ...abandonedIdentity,
      state: "abandoned",
      mutationFence: abandonedFence,
      usage,
      pendingCommand: null,
      lastCommandId: captured.commandId,
      lastCommandDigest: commandDigest,
      lastReceipt: Object.freeze({ operation: "abandon" }),
    });
    return receipt(yield* options.attemptStore.write({
      semanticUploadId: current.semanticUploadId,
      commandId: captured.commandId,
      commandDigest,
      expectedFence: current.mutationFence,
      readBudget: attemptWriteBudget(captured.admission, current.mutationFence),
      next: abandoned,
    }));
  });
}

function executeReadFinalized(
  source: SemanticArtifactV1ClaimedFinalizedSource,
  input: SemanticArtifactV1CommandInput,
  config: SemanticArtifactV1RootConfiguration,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1FinalizedEvidence, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const captured = yield* captureCommand("readFinalized", input);
    yield* ensureCharge("readFinalized", captured.admission, zeroCharge({ calls: 2 }));
    const current = yield* readAttemptRow(captured, options);
    yield* requireExpectedFence(current, captured.expectedMutationFence);
    yield* compareSource(current, source);
    if (
      current.state !== "finalized" || current.completedRootDigest === null ||
      current.completedSelectorDigest === null
    ) return yield* stateFailure(current.semanticUploadId, "invalidLifecycle");
    const rootDigest = sourceArtifactV2DigestBytesFromLowerHex(current.completedRootDigest);
    if (current.frontier.length > 1) {
      return yield* Effect.fail(new SemanticArtifactV1CorruptionError({
        semanticUploadId: current.semanticUploadId,
        reason: "rootMismatch",
      }));
    }
    const hasEmptyTree = current.frontier.length === 0;
    const treeRootPreview = hasEmptyTree
      ? new Uint8Array(32)
      : sourceArtifactV2DigestBytesFromLowerHex(current.frontier[0]!.digest);
    const rootMeasurement =
      measureDeclarativeV2SemanticArtifactRootOrSelectorFrameV1(makeRootFrame(
      current,
      config,
      treeRootPreview,
    ), {
      maximumFrameBytes: captured.admission.frameBytes,
      maximumCanonicalBytes: captured.admission.canonicalBytes,
    });
    if (Result.isFailure(rootMeasurement)) {
      return yield* projectCodecFailure(
        "readFinalized",
        "rootFrame",
        rootMeasurement.failure,
      );
    }
    const selectorMeasurement =
      measureDeclarativeV2SemanticArtifactRootOrSelectorFrameV1({
      kind: "semantic_selector",
      semanticArtifactCodecVersion: DECLARATIVE_V2_SEMANTIC_ARTIFACT_CODEC_VERSION_V1,
      attemptIdentitySha256: sourceArtifactV2DigestBytesFromLowerHex(current.attemptSha256),
      semanticRootSha256: rootDigest,
    }, {
      maximumFrameBytes: captured.admission.frameBytes,
      maximumCanonicalBytes: captured.admission.canonicalBytes,
    });
    if (Result.isFailure(selectorMeasurement)) {
      return yield* projectCodecFailure(
        "readFinalized",
        "selectorFrame",
        selectorMeasurement.failure,
      );
    }
    const rootFrameByteLength = rootMeasurement.success.frameBytes;
    const selectorFrameByteLength = selectorMeasurement.success.frameBytes;
    const emptyTreeByteLength = hasEmptyTree
      ? checkedMultiply(SEMANTIC_EMPTY_TREE_PREIMAGE_BYTES_V1, 3)
      : 0;
    const operationUsage = zeroCharge({
      calls: current.frontier.length === 0 ? 7 : 6,
      canonicalBytes: checkedAdd(
        checkedMultiply(rootMeasurement.success.canonicalBytes, 2),
        selectorMeasurement.success.canonicalBytes,
      ),
      frameBytes: checkedAdd(
        emptyTreeByteLength,
        checkedAdd(
          checkedMultiply(rootFrameByteLength, 3),
          selectorFrameByteLength,
        ),
      ),
      hashBytes: checkedAdd(
        checkedAdd(current.attemptFrameBytes.byteLength, rootFrameByteLength),
        checkedAdd(emptyTreeByteLength, selectorFrameByteLength),
      ),
      timeMilliseconds: captured.admission.timeMilliseconds,
    });
    yield* ensureCharge("readFinalized", captured.admission, operationUsage);
    yield* verifyAttemptDigest(current, captured.admission, options);
    const semanticAttemptIdentitySha256 =
      sourceArtifactV2DigestBytesFromLowerHex(current.attemptSha256);
    const selector = encodeDeclarativeV2SemanticArtifactFrameV1({
      kind: "semantic_selector",
      semanticArtifactCodecVersion: DECLARATIVE_V2_SEMANTIC_ARTIFACT_CODEC_VERSION_V1,
      attemptIdentitySha256: semanticAttemptIdentitySha256,
      semanticRootSha256: rootDigest,
    }, {
      maximumFrameBytes: selectorFrameByteLength,
      maximumCanonicalBytes: selectorMeasurement.success.canonicalBytes,
    });
    if (Result.isFailure(selector)) {
      return yield* Effect.die(
        new Error("Semantic selector measurement changed during encoding."),
      );
    }
    const emptyTree = hasEmptyTree
      ? declarativeV2SemanticArtifactEmptyTreePreimageV1({
        maximumFrameBytes: SEMANTIC_EMPTY_TREE_PREIMAGE_BYTES_V1,
        maximumCanonicalBytes: 0,
      })
      : null;
    if (emptyTree !== null && Result.isFailure(emptyTree)) {
      return yield* Effect.die(
        new Error("Semantic empty-tree measurement changed during encoding."),
      );
    }
    const treeRoot = emptyTree === null
      ? treeRootPreview
      : yield* options.sha256(emptyTree.success.canonicalBytes, {
        maximumInputBytes: emptyTree.success.canonicalBytes.byteLength,
      });
    const expectedRoot = encodeDeclarativeV2SemanticArtifactFrameV1(
      makeRootFrame(current, config, treeRoot),
      {
        maximumFrameBytes: rootFrameByteLength,
        maximumCanonicalBytes: rootMeasurement.success.canonicalBytes,
      },
    );
    if (Result.isFailure(expectedRoot)) {
      return yield* Effect.die(new Error("Semantic root preview changed during encoding."));
    }
    const stored = yield* options.r2.readImmutable("root", rootDigest, {
      maximumCalls: 2,
      maximumBodyBytes: checkedMultiply(rootFrameByteLength, 2),
      maximumHashBytes: rootFrameByteLength,
    });
    yield* verifyReadReceipt(stored, rootFrameByteLength);
    if (!bytesEqualFullScan(stored.bytes, expectedRoot.success.canonicalBytes)) {
      return yield* Effect.fail(new SemanticArtifactV1CorruptionError({
        semanticUploadId: current.semanticUploadId,
        reason: "rootMismatch",
      }));
    }
    const selectorDigest = yield* options.sha256(
      selector.success.canonicalBytes,
      { maximumInputBytes: selectorFrameByteLength },
    );
    if (
      !bytesEqualFullScan(
        selectorDigest,
        sourceArtifactV2DigestBytesFromLowerHex(current.completedSelectorDigest),
      )
    ) {
      return yield* Effect.fail(new SemanticArtifactV1CorruptionError({
        semanticUploadId: current.semanticUploadId,
        reason: "selectorMismatch",
      }));
    }
    return Object.freeze({
      projectId: current.projectId,
      deploymentId: current.deploymentId,
      deploymentCreatedAt: current.deploymentCreatedAt,
      semanticUploadId: current.semanticUploadId,
      semanticGeneration: current.generation,
      semanticMutationFence: current.mutationFence,
      sourceUploadId: current.sourceUploadId,
      sourceGeneration: current.sourceGeneration,
      sourceMutationFence: current.sourceMutationFence,
      sourceRootSha256: copyBytes(source.sourceRootSha256),
      sourceSelectorSha256: copyBytes(source.sourceSelectorSha256),
      semanticRootSha256: copyBytes(rootDigest),
      semanticSelectorSha256: copyBytes(selectorDigest),
      semanticAttemptIdentitySha256: copyBytes(
        semanticAttemptIdentitySha256,
      ),
      usage: operationUsage,
    });
  });
}

function readVerifiedAttempt(
  input: Readonly<SemanticArtifactV1CommandInput>,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1Attempt, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const attempt = yield* readAttemptRow(input, options);
    yield* verifyAttemptDigest(attempt, input.admission, options);
    return attempt;
  });
}

function readAttemptRow(
  input: Readonly<SemanticArtifactV1CommandInput>,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1Attempt, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const attempt = yield* options.attemptStore.read(
      input.semanticUploadId,
      attemptReadBudget(input.admission),
    );
    if (attempt === null) return yield* stateFailure(input.semanticUploadId, "notFound");
    if (attempt.deploymentId !== input.deploymentId) {
      return yield* stateFailure(input.semanticUploadId, "deploymentMismatch");
    }
    if (attempt.generation !== input.expectedGeneration) {
      return yield* stateFailure(input.semanticUploadId, "staleGeneration");
    }
    return attempt;
  });
}

function verifyAttemptDigest(
  attempt: SemanticArtifactV1Attempt,
  admission: SemanticArtifactV1Budget,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<void, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const digest = yield* options.sha256(attempt.attemptFrameBytes, {
      maximumInputBytes: admission.hashBytes,
    });
    if (
      !bytesEqualFullScan(
        digest,
        sourceArtifactV2DigestBytesFromLowerHex(attempt.attemptSha256),
      )
    ) {
      return yield* Effect.fail(new SemanticArtifactV1CorruptionError({
        semanticUploadId: attempt.semanticUploadId,
        reason: "attemptDigestMismatch",
      }));
    }
    return;
  });
}

function requireExpectedFence(
  attempt: SemanticArtifactV1Attempt,
  expectedMutationFence: number,
): Effect.Effect<void, SemanticArtifactV1StateError> {
  return attempt.mutationFence === expectedMutationFence
    ? Effect.void
    : stateFailure(attempt.semanticUploadId, "staleFence");
}

function refreshAttemptIdentity(
  operation: SemanticArtifactV1InputError["operation"],
  attempt: SemanticArtifactV1Attempt,
  mutationFence: number,
  admission: SemanticArtifactV1Budget,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<
  Pick<SemanticArtifactV1Attempt, "attemptFrameBytes" | "attemptSha256">,
  SemanticArtifactV1UploadError
> {
  return Effect.gen(function* () {
    const decoded = decodeDeclarativeV2SemanticArtifactFrameV1(
      attempt.attemptFrameBytes,
      {
        maximumFrameBytes: admission.frameBytes,
        maximumCanonicalBytes: admission.canonicalBytes,
      },
    );
    if (Result.isFailure(decoded) || decoded.success.value.kind !== "semantic_attempt") {
      return yield* Effect.fail(new SemanticArtifactV1CorruptionError({
        semanticUploadId: attempt.semanticUploadId,
        reason: "attemptDigestMismatch",
      }));
    }
    const encoded = encodeDeclarativeV2SemanticArtifactFrameV1({
      ...decoded.success.value,
      semanticMutationFence: BigInt(mutationFence),
    }, {
      maximumFrameBytes: admission.frameBytes,
      maximumCanonicalBytes: admission.canonicalBytes,
    });
    if (Result.isFailure(encoded)) {
      return yield* projectCodecFailure(operation, "attemptFrame", encoded.failure);
    }
    const digest = yield* options.sha256(encoded.success.canonicalBytes, {
      maximumInputBytes: admission.hashBytes,
    });
    return Object.freeze({
      attemptFrameBytes: copyBytes(encoded.success.canonicalBytes),
      attemptSha256: encodeBytesToLowercaseHex(digest),
    });
  });
}

function captureCommand(
  operation: SemanticArtifactV1InputError["operation"],
  input: SemanticArtifactV1CommandInput,
): Effect.Effect<
  Readonly<SemanticArtifactV1CommandInput>,
  SemanticArtifactV1InputError
> {
  const admission = captureBudget(operation, input.admission, "admission");
  if (
    !isNonEmptyString(input.semanticUploadId) ||
    !isNonEmptyString(input.deploymentId) ||
    !isNonEmptyString(input.commandId) ||
    !isNonNegativeSafeInteger(input.expectedGeneration) ||
    !isNonNegativeSafeInteger(input.expectedMutationFence) ||
    Result.isFailure(admission)
  ) return inputFailure(operation, "input");
  return Effect.succeed(Object.freeze({ ...input, admission: admission.success }));
}

function captureBudget(
  operation: SemanticArtifactV1InputError["operation"],
  input: unknown,
  field: string,
): Result.Result<SemanticArtifactV1Budget, SemanticArtifactV1InputError> {
  if (
    !isNonArrayRecord(input) ||
    !isNonNegativeSafeInteger(input.calls) ||
    !isNonNegativeSafeInteger(input.blockBytes) ||
    !isNonNegativeSafeInteger(input.canonicalBytes) ||
    !isNonNegativeSafeInteger(input.frameBytes) ||
    !isNonNegativeSafeInteger(input.hashBytes) ||
    !isNonNegativeSafeInteger(input.timeMilliseconds)
  ) {
    return Result.fail(new SemanticArtifactV1InputError({ operation, field }));
  }
  return Result.succeed(Object.freeze({
    calls: input.calls,
    blockBytes: input.blockBytes,
    canonicalBytes: input.canonicalBytes,
    frameBytes: input.frameBytes,
    hashBytes: input.hashBytes,
    timeMilliseconds: input.timeMilliseconds,
  }));
}

function ensureFits(
  operation: SemanticArtifactV1InputError["operation"],
  command: SemanticArtifactV1Budget,
  cumulative: SemanticArtifactV1Budget,
): Result.Result<void, SemanticArtifactV1BudgetError> {
  for (const key of budgetKeys) {
    if (command[key] > cumulative[key]) {
      return Result.fail(new SemanticArtifactV1BudgetError({
        operation,
        dimension: key,
        observed: command[key],
        maximum: cumulative[key],
      }));
    }
  }
  return Result.succeed(undefined);
}

function ensureCharge(
  operation: SemanticArtifactV1InputError["operation"],
  maximum: SemanticArtifactV1Budget,
  observed: SemanticArtifactV1Budget,
): Effect.Effect<void, SemanticArtifactV1BudgetError> {
  for (const key of budgetKeys) {
    if (observed[key] > maximum[key]) {
      return Effect.fail(new SemanticArtifactV1BudgetError({
        operation,
        dimension: key,
        observed: observed[key],
        maximum: maximum[key],
      }));
    }
  }
  return Effect.void;
}

function chargeCumulative(
  operation: SemanticArtifactV1InputError["operation"],
  attempt: SemanticArtifactV1Attempt,
  admission: SemanticArtifactV1Budget,
  charge: SemanticArtifactV1Budget,
): Effect.Effect<SemanticArtifactV1Budget, SemanticArtifactV1BudgetError> {
  return Effect.gen(function* () {
    yield* ensureCharge(operation, admission, charge);
    const next = Object.freeze({
      calls: checkedAdd(attempt.usage.calls, charge.calls),
      blockBytes: checkedAdd(attempt.usage.blockBytes, charge.blockBytes),
      canonicalBytes: checkedAdd(attempt.usage.canonicalBytes, charge.canonicalBytes),
      frameBytes: checkedAdd(attempt.usage.frameBytes, charge.frameBytes),
      hashBytes: checkedAdd(attempt.usage.hashBytes, charge.hashBytes),
      timeMilliseconds: checkedAdd(
        attempt.usage.timeMilliseconds,
        charge.timeMilliseconds,
      ),
    });
    yield* Effect.fromResult(ensureFits(operation, next, attempt.ceilings));
    return next;
  });
}

function chargeIdentityMutation(
  operation: "reopen" | "abandon",
  attempt: SemanticArtifactV1Attempt,
  admission: SemanticArtifactV1Budget,
): Effect.Effect<SemanticArtifactV1Budget, SemanticArtifactV1UploadError> {
  const decoded = decodeDeclarativeV2SemanticArtifactFrameV1(
    attempt.attemptFrameBytes,
    {
      maximumFrameBytes: admission.frameBytes,
      maximumCanonicalBytes: admission.canonicalBytes,
    },
  );
  if (Result.isFailure(decoded)) {
    return Effect.fail(new SemanticArtifactV1CorruptionError({
      semanticUploadId: attempt.semanticUploadId,
      reason: "attemptDigestMismatch",
    }));
  }
  return chargeCumulative(operation, attempt, admission, {
    calls: 11,
    blockBytes: 0,
    canonicalBytes: checkedMultiply(decoded.success.usage.canonicalBytes, 2),
    frameBytes: checkedMultiply(attempt.attemptFrameBytes.byteLength, 2),
    hashBytes: checkedMultiply(attempt.attemptFrameBytes.byteLength, 2),
    timeMilliseconds: admission.timeMilliseconds,
  });
}

function captureRootConfiguration(
  input: SemanticArtifactV1RootConfiguration,
): Result.Result<SemanticArtifactV1RootConfiguration, SemanticArtifactV1InputError> {
  if (!isNonArrayRecord(input)) {
    return Result.fail(new SemanticArtifactV1InputError({
      operation: "begin",
      field: "rootConfiguration",
    }));
  }
  const captured = {
    semanticModelIdentity: input.semanticModelIdentity,
    semanticCodecIdentity: input.semanticCodecIdentity,
    semanticPolicyIdentity: input.semanticPolicyIdentity,
    coreLanguageIdentity: input.coreLanguageIdentity,
    abiIdentity: input.abiIdentity,
    grammarIdentity: input.grammarIdentity,
    unicodeIdentity: input.unicodeIdentity,
    parserTableIdentity: input.parserTableIdentity,
    trustedToolingIdentity: input.trustedToolingIdentity,
    ingressProtocolIdentity: input.ingressProtocolIdentity,
    ingressConfigurationIdentity: input.ingressConfigurationIdentity,
  };
  for (const key of rootConfigurationKeys) {
    if (!isNonEmptyString(captured[key])) {
      return Result.fail(new SemanticArtifactV1InputError({
        operation: "begin",
        field: key,
      }));
    }
  }
  return Result.succeed(Object.freeze(captured) as SemanticArtifactV1RootConfiguration);
}

function foldEqualFrontier(
  frontierInput: readonly SemanticArtifactV1FrontierEntry[],
  entryInput: SemanticArtifactV1FrontierEntry,
  admission: SemanticArtifactV1Budget,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<readonly SemanticArtifactV1FrontierEntry[], SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const frontier = [...frontierInput];
    let entry = entryInput;
    while (
      frontier.length > 0 &&
      frontier[frontier.length - 1]!.blockCount === entry.blockCount
    ) {
      const left = frontier.pop()!;
      entry = yield* mergeEntries("append", left, entry, admission, options);
    }
    frontier.push(entry);
    return Object.freeze(frontier);
  });
}

function collapseFrontier(
  frontierInput: readonly SemanticArtifactV1FrontierEntry[],
  admission: SemanticArtifactV1Budget,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1FrontierEntry | null, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    if (frontierInput.length === 0) return null;
    let current = frontierInput[0]!;
    for (let index = 1; index < frontierInput.length; index += 1) {
      current = yield* mergeEntries(
        "finalize",
        current,
        frontierInput[index]!,
        admission,
        options,
      );
    }
    return current;
  });
}

function mergeEntries(
  operation: "append" | "finalize",
  left: SemanticArtifactV1FrontierEntry,
  right: SemanticArtifactV1FrontierEntry,
  admission: SemanticArtifactV1Budget,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<SemanticArtifactV1FrontierEntry, SemanticArtifactV1UploadError> {
  return Effect.gen(function* () {
    const encoded = encodeDeclarativeV2SemanticArtifactFrameV1({
      kind: "semantic_tree",
      children: [
        treeChild(left),
        treeChild(right),
      ],
    }, {
      maximumFrameBytes: admission.frameBytes,
      maximumCanonicalBytes: admission.canonicalBytes,
    });
    if (Result.isFailure(encoded)) {
      return yield* projectCodecFailure(operation, "treeFrame", encoded.failure);
    }
    const digest = yield* options.sha256(encoded.success.canonicalBytes, {
      maximumInputBytes: admission.hashBytes,
    });
    const stored = yield* options.r2.putImmutable(
      "tree",
      digest,
      encoded.success.canonicalBytes,
      {
        maximumCalls: 6,
        maximumBodyBytes: checkedMultiply(encoded.success.canonicalBytes.byteLength, 5),
        maximumHashBytes: checkedMultiply(encoded.success.canonicalBytes.byteLength, 2),
      },
    );
    yield* verifyPutReceipt(stored, encoded.success.canonicalBytes.byteLength);
    return Object.freeze({
      firstBlockOrdinal: left.firstBlockOrdinal,
      blockCount: checkedAdd(left.blockCount, right.blockCount),
      firstByteOffset: left.firstByteOffset,
      byteLength: checkedAdd(left.byteLength, right.byteLength),
      lineFeedCount: checkedAdd(left.lineFeedCount, right.lineFeedCount),
      digest: encodeBytesToLowercaseHex(digest),
    });
  });
}

function treeChild(entry: SemanticArtifactV1FrontierEntry): DeclarativeV2SemanticArtifactTreeChildV1 {
  return {
    firstBlockOrdinal: BigInt(entry.firstBlockOrdinal),
    blockCount: BigInt(entry.blockCount),
    firstByteOffset: BigInt(entry.firstByteOffset),
    byteLength: BigInt(entry.byteLength),
    lineFeedCount: BigInt(entry.lineFeedCount),
    sha256: sourceArtifactV2DigestBytesFromLowerHex(entry.digest),
  };
}

function makeRootFrame(
  attempt: SemanticArtifactV1Attempt,
  config: SemanticArtifactV1RootConfiguration,
  treeRootSha256: Uint8Array,
): DeclarativeV2SemanticArtifactRootFrameV1 {
  return {
    kind: "semantic_root",
    sourceArtifactCodecVersion: 1,
    sourceRootSha256: sourceArtifactV2DigestBytesFromLowerHex(attempt.sourceRootSha256),
    semanticModelIdentity: config.semanticModelIdentity,
    semanticCodecIdentity: config.semanticCodecIdentity,
    semanticPolicyIdentity: config.semanticPolicyIdentity,
    coreLanguageIdentity: config.coreLanguageIdentity,
    abiIdentity: config.abiIdentity,
    grammarIdentity: config.grammarIdentity,
    unicodeIdentity: config.unicodeIdentity,
    parserTableIdentity: config.parserTableIdentity,
    trustedToolingIdentity: config.trustedToolingIdentity,
    ingressProtocolIdentity: config.ingressProtocolIdentity,
    ingressConfigurationIdentity: config.ingressConfigurationIdentity,
    blockCount: BigInt(attempt.nextBlockOrdinal),
    streamByteLength: BigInt(attempt.streamByteLength),
    recordCount: BigInt(attempt.lineFeedCount),
    treeRootSha256,
  };
}

function budgetEqual(
  left: SemanticArtifactV1Budget,
  right: SemanticArtifactV1Budget,
): boolean {
  return budgetKeys.every(key => left[key] === right[key]);
}

function zeroCharge(
  overrides: Partial<SemanticArtifactV1Budget>,
): SemanticArtifactV1Budget {
  return {
    calls: overrides.calls ?? 0,
    blockBytes: overrides.blockBytes ?? 0,
    canonicalBytes: overrides.canonicalBytes ?? 0,
    frameBytes: overrides.frameBytes ?? 0,
    hashBytes: overrides.hashBytes ?? 0,
    timeMilliseconds: overrides.timeMilliseconds ?? 0,
  };
}

function budgetCanonicalByteLength(budget: SemanticArtifactV1Budget): number {
  let total = 2;
  for (let index = 0; index < budgetKeys.length; index += 1) {
    const key = budgetKeys[index]!;
    if (index > 0) total = checkedAdd(total, 1);
    total = checkedAdd(total, key.length + 3);
    total = checkedAdd(total, String(budget[key]).length);
  }
  return total;
}

function attemptReadBudget(admission: SemanticArtifactV1Budget) {
  return Object.freeze({
    maximumCalls: 2,
    maximumStoredBytes: checkedAdd(
      checkedMultiply(admission.frameBytes, 2),
      admission.canonicalBytes,
    ),
  });
}

function attemptWriteBudget(
  admission: SemanticArtifactV1Budget,
  expectedFence: number | null,
) {
  return Object.freeze({
    maximumCalls: expectedFence === null ? 6 : 7,
    maximumStoredBytes: checkedAdd(
      checkedMultiply(admission.frameBytes, 2),
      admission.canonicalBytes,
    ),
  });
}

function verifyPutReceipt(
  receiptValue: SemanticArtifactV1R2Receipt,
  frameByteLength: number,
): Effect.Effect<void> {
  const immediate = receiptValue.usage.calls === 4 &&
    receiptValue.usage.bodyBytes === checkedMultiply(frameByteLength, 4);
  const repeated = receiptValue.usage.calls === 6 &&
    receiptValue.usage.bodyBytes === checkedMultiply(frameByteLength, 5);
  return (immediate || repeated) &&
      receiptValue.usage.hashBytes === checkedMultiply(frameByteLength, 2)
    ? Effect.void
    : Effect.die(new Error("Semantic artifact R2 put usage exceeded its reservation."));
}

function verifyReadReceipt(
  receiptValue: SemanticArtifactV1R2Receipt,
  frameByteLength: number,
): Effect.Effect<void> {
  return receiptValue.usage.calls === 2 &&
      receiptValue.usage.bodyBytes === checkedMultiply(frameByteLength, 2) &&
      receiptValue.usage.hashBytes === frameByteLength
    ? Effect.void
    : Effect.die(new Error("Semantic artifact R2 read usage disagreed with its reservation."));
}

function hashEmptyTree(
  admission: SemanticArtifactV1Budget,
  sha256: SemanticArtifactV1Sha256,
): Effect.Effect<Uint8Array, SemanticArtifactV1UploadError> {
  const empty = declarativeV2SemanticArtifactEmptyTreePreimageV1({
    maximumFrameBytes: admission.frameBytes,
    maximumCanonicalBytes: admission.canonicalBytes,
  });
  return Result.isFailure(empty)
    ? projectCodecFailure("finalize", "emptyTree", empty.failure)
    : sha256(empty.success.canonicalBytes, { maximumInputBytes: admission.hashBytes });
}

function rootDigestFromFrontier(
  attempt: SemanticArtifactV1Attempt,
  admission: SemanticArtifactV1Budget,
  options: Parameters<typeof makeSemanticArtifactV1UploadCore>[0],
): Effect.Effect<Uint8Array, SemanticArtifactV1UploadError> {
  if (attempt.frontier.length === 0) return hashEmptyTree(admission, options.sha256);
  if (attempt.frontier.length !== 1) {
    return Effect.fail(new SemanticArtifactV1CorruptionError({
      semanticUploadId: attempt.semanticUploadId,
      reason: "rootMismatch",
    }));
  }
  return Effect.succeed(
    sourceArtifactV2DigestBytesFromLowerHex(attempt.frontier[0]!.digest),
  );
}

function compareSource(
  attempt: SemanticArtifactV1Attempt,
  source: SemanticArtifactV1ClaimedFinalizedSource,
): Effect.Effect<void, SemanticArtifactV1SourceDriftError> {
  return attempt.projectId === source.projectId &&
      attempt.deploymentId === source.deploymentId &&
      attempt.deploymentCreatedAt === source.deploymentCreatedAt &&
      attempt.sourceUploadId === source.sourceUploadId &&
      attempt.sourceGeneration === source.sourceGeneration &&
      attempt.sourceMutationFence === source.sourceMutationFence &&
      attempt.sourceRootSha256 === encodeBytesToLowercaseHex(source.sourceRootSha256) &&
      attempt.sourceSelectorSha256 === encodeBytesToLowercaseHex(source.sourceSelectorSha256)
    ? Effect.void
    : sourceDriftFailure(attempt.sourceUploadId);
}

function replayReceipt(
  attempt: SemanticArtifactV1Attempt,
  commandId: string,
): SemanticArtifactV1Receipt | null {
  return attempt.lastCommandId === commandId ? receipt(attempt) : null;
}

function receipt(attempt: SemanticArtifactV1Attempt): SemanticArtifactV1Receipt {
  return Object.freeze({
    semanticUploadId: attempt.semanticUploadId,
    generation: attempt.generation,
    mutationFence: attempt.mutationFence,
    state: attempt.state,
    commandId: attempt.lastCommandId,
    commandDigest: attempt.lastCommandDigest,
    usage: attempt.usage,
    completedRootSha256: attempt.completedRootDigest === null
      ? null
      : sourceArtifactV2DigestBytesFromLowerHex(attempt.completedRootDigest),
    completedSelectorSha256: attempt.completedSelectorDigest === null
      ? null
      : sourceArtifactV2DigestBytesFromLowerHex(attempt.completedSelectorDigest),
  });
}

function inputFailure(
  operation: SemanticArtifactV1InputError["operation"],
  field: string,
): Effect.Effect<never, SemanticArtifactV1InputError> {
  return Effect.fail(new SemanticArtifactV1InputError({ operation, field }));
}

function projectCodecFailure(
  operation: SemanticArtifactV1InputError["operation"],
  field: string,
  failure: DeclarativeV2SemanticArtifactCodecV1Error,
): Effect.Effect<never, SemanticArtifactV1InputError | SemanticArtifactV1BudgetError> {
  if (
    failure.reason === "frameBytesExceeded" ||
    failure.reason === "canonicalBytesExceeded"
  ) {
    return Effect.fail(new SemanticArtifactV1BudgetError({
      operation,
      dimension: failure.reason === "frameBytesExceeded"
        ? "frameBytes"
        : "canonicalBytes",
      observed: failure.observed ?? 0,
      maximum: failure.maximum ?? 0,
    }));
  }
  return inputFailure(operation, field);
}

function stateFailure(
  semanticUploadId: string,
  reason: SemanticArtifactV1StateError["reason"],
): Effect.Effect<never, SemanticArtifactV1StateError> {
  return Effect.fail(new SemanticArtifactV1StateError({ semanticUploadId, reason }));
}

function sourceDriftFailure(
  sourceUploadId: string,
): Effect.Effect<never, SemanticArtifactV1SourceDriftError> {
  return Effect.fail(new SemanticArtifactV1SourceDriftError({ sourceUploadId }));
}

function countLineFeeds(bytes: Uint8Array): bigint {
  let count = 0n;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x0a) count += 1n;
  }
  return count;
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Semantic artifact counter overflow.");
  return result;
}

function checkedIncrement(value: number): number {
  return checkedAdd(value, 1);
}

function checkedMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new Error("Semantic artifact counter overflow.");
  return result;
}

function equalFrontierMergeCount(
  frontier: readonly SemanticArtifactV1FrontierEntry[],
): number {
  let count = 0;
  let blockCount = 1;
  for (let index = frontier.length - 1; index >= 0; index -= 1) {
    if (frontier[index]!.blockCount !== blockCount) break;
    count += 1;
    blockCount = checkedMultiply(blockCount, 2);
  }
  return count;
}

const budgetKeys = Object.freeze([
  "calls",
  "blockBytes",
  "canonicalBytes",
  "frameBytes",
  "hashBytes",
  "timeMilliseconds",
] as const);

const rootConfigurationKeys = Object.freeze([
  "semanticModelIdentity",
  "semanticCodecIdentity",
  "semanticPolicyIdentity",
  "coreLanguageIdentity",
  "abiIdentity",
  "grammarIdentity",
  "unicodeIdentity",
  "parserTableIdentity",
  "trustedToolingIdentity",
  "ingressProtocolIdentity",
  "ingressConfigurationIdentity",
] as const);
