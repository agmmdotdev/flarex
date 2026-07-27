import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
} from "@flarex/utils/bytes";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  isLowercaseUuidText,
  isNonEmptyString,
} from "@flarex/utils/strings";
import { Brand, Data, Result } from "effect";

import {
  decodeDeclarativeV2ArtifactModulePathV1,
  type DeclarativeV2ArtifactModulePathV1,
} from "./declarative-v2-artifact-module-path-v1";
import { hasOnlyPairedSurrogates } from "./canonical-utf8";
import {
  isSourceArtifactV2ModuleRolesV1,
  type SourceArtifactV2ModuleRolesV1,
} from "./declarative-v2-source-artifact-v2";
import {
  encodeCanonicalJson,
  type Json,
  type JsonObject,
} from "./json";

export const DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1 = 1 as const;
export const declarativeV2ArtifactUploadCommandMediaTypeV1 =
  "application/vnd.flarex.declarative-v2-artifact-upload-command-v1";
export const declarativeV2ArtifactUploadResponseMediaTypeV1 =
  "application/vnd.flarex.declarative-v2-artifact-upload-response-v1+json";

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const U32_BYTES = 4;
const U32_MAX = 0xffff_ffff;
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;

export type DeclarativeV2ArtifactUploadUuidV1 = Brand.Branded<
  string,
  "Flarex/DeclarativeV2ArtifactUploadUuidV1"
>;

export type DeclarativeV2ArtifactUploadSha256HexV1 = Brand.Branded<
  string,
  "Flarex/DeclarativeV2ArtifactUploadSha256HexV1"
>;

const brandUploadUuidV1 =
  Brand.nominal<DeclarativeV2ArtifactUploadUuidV1>();
const brandSha256HexV1 =
  Brand.nominal<DeclarativeV2ArtifactUploadSha256HexV1>();

export interface DeclarativeV2ArtifactUploadTransportBudgetV1 {
  readonly maximumRequestCalls: number;
  readonly maximumMetadataBytes: number;
  readonly maximumPayloadBytes: number;
  readonly maximumFrameBytes: number;
  readonly maximumResponseBytes: number;
  readonly maximumElapsedMilliseconds: number;
}

export interface DeclarativeV2ArtifactUploadCodecUsageV1 {
  readonly metadataBytes: number;
  readonly payloadBytes: number;
  readonly frameBytes: number;
}

export interface DeclarativeV2SourceUploadBudgetV1 {
  readonly calls: number;
  readonly blockBytes: number;
  readonly modules: number;
  readonly sourceMaps: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly hashBytes: number;
  readonly timeMilliseconds: number;
}

export interface DeclarativeV2SemanticUploadBudgetV1 {
  readonly calls: number;
  readonly blockBytes: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly hashBytes: number;
  readonly timeMilliseconds: number;
}

export interface DeclarativeV2ArtifactUploadObserveBudgetV1 {
  readonly maximumCalls: number;
  readonly maximumStoredBytes: number;
}

export interface DeclarativeV2ArtifactUploadScopeLookupBudgetV1 {
  readonly maximumLookupCalls: number;
  readonly maximumInputBytes: number;
  readonly maximumBodyBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumFrameBytes: number;
  readonly maximumElapsedMilliseconds: number;
}

export interface DeclarativeV2ArtifactUploadFinalizedSourceReadBudgetV1 {
  readonly maximumCalls: number;
  readonly maximumInputBytes: number;
  readonly maximumBodyBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumFrameBytes: number;
  readonly maximumHashBytes: number;
  readonly maximumElapsedMilliseconds: number;
}

export interface DeclarativeV2ArtifactUploadBudgetPairV1<T> {
  readonly cumulative: T;
  readonly command: T;
}

interface CommandBaseV1 {
  readonly codecVersion: typeof DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1;
  readonly deploymentId: string;
  readonly uploadId: DeclarativeV2ArtifactUploadUuidV1;
  readonly commandKey: DeclarativeV2ArtifactUploadUuidV1;
}

interface SourceCommandBaseV1 extends CommandBaseV1 {
  readonly artifactKind: "source";
}

interface SourceAttemptCommandBaseV1 extends SourceCommandBaseV1 {
  readonly generation: number;
  readonly expectedFence: number;
  readonly admission: DeclarativeV2SourceUploadBudgetV1;
}

export interface DeclarativeV2SourceBeginUploadCommandV1
  extends SourceCommandBaseV1 {
  readonly operation: "begin";
  readonly ceilings: DeclarativeV2SourceUploadBudgetV1;
  readonly admission: DeclarativeV2SourceUploadBudgetV1;
}

export interface DeclarativeV2SourceBeginModuleCommandV1
  extends SourceAttemptCommandBaseV1 {
  readonly operation: "beginModule";
  readonly path: DeclarativeV2ArtifactModulePathV1;
  readonly roles: SourceArtifactV2ModuleRolesV1;
  readonly environment: "isolate";
}

export interface DeclarativeV2SourceAppendBlockCommandV1
  extends SourceAttemptCommandBaseV1 {
  readonly operation: "appendBlock";
  readonly stream: "source" | "sourceMap";
  readonly blockIndex: number;
  readonly payloadBytes: Uint8Array;
}

export interface DeclarativeV2SourceCloseModuleCommandV1
  extends SourceAttemptCommandBaseV1 {
  readonly operation: "closeModule";
}

export interface DeclarativeV2SourceFinalizeCommandV1
  extends SourceAttemptCommandBaseV1 {
  readonly operation: "finalize";
}

export interface DeclarativeV2SourceAbandonCommandV1
  extends SourceAttemptCommandBaseV1 {
  readonly operation: "abandon";
}

export interface DeclarativeV2SourceObserveCommandV1
  extends SourceCommandBaseV1 {
  readonly operation: "observe";
  readonly budget: DeclarativeV2ArtifactUploadObserveBudgetV1;
}

interface SemanticCommandBaseV1 extends CommandBaseV1 {
  readonly artifactKind: "semantic";
}

interface SemanticAttemptCommandBaseV1 extends SemanticCommandBaseV1 {
  readonly generation: number;
  readonly expectedFence: number;
  readonly admission: DeclarativeV2SemanticUploadBudgetV1;
}

export interface DeclarativeV2SemanticBeginUploadCommandV1
  extends SemanticCommandBaseV1 {
  readonly operation: "begin";
  readonly sourceUploadId: DeclarativeV2ArtifactUploadUuidV1;
  readonly sourceGeneration: number;
  readonly sourceMutationFence: number;
  readonly ceilings: DeclarativeV2SemanticUploadBudgetV1;
  readonly admission: DeclarativeV2SemanticUploadBudgetV1;
  readonly authorizationBudget: DeclarativeV2ArtifactUploadBudgetPairV1<
    DeclarativeV2ArtifactUploadScopeLookupBudgetV1
  >;
  readonly finalizedSourceReadBudget: DeclarativeV2ArtifactUploadBudgetPairV1<
    DeclarativeV2ArtifactUploadFinalizedSourceReadBudgetV1
  >;
}

export interface DeclarativeV2SemanticAppendCommandV1
  extends SemanticAttemptCommandBaseV1 {
  readonly operation: "append";
  readonly blockOrdinal: number;
  readonly payloadBytes: Uint8Array;
}

export interface DeclarativeV2SemanticFinalizeCommandV1
  extends SemanticAttemptCommandBaseV1 {
  readonly operation: "finalize";
}

export interface DeclarativeV2SemanticAbandonCommandV1
  extends SemanticAttemptCommandBaseV1 {
  readonly operation: "abandon";
}

export interface DeclarativeV2SemanticObserveCommandV1
  extends SemanticCommandBaseV1 {
  readonly operation: "observe";
  readonly budget: DeclarativeV2ArtifactUploadObserveBudgetV1;
}

export type DeclarativeV2ArtifactUploadCommandV1 =
  | DeclarativeV2SourceBeginUploadCommandV1
  | DeclarativeV2SourceBeginModuleCommandV1
  | DeclarativeV2SourceAppendBlockCommandV1
  | DeclarativeV2SourceCloseModuleCommandV1
  | DeclarativeV2SourceFinalizeCommandV1
  | DeclarativeV2SourceAbandonCommandV1
  | DeclarativeV2SourceObserveCommandV1
  | DeclarativeV2SemanticBeginUploadCommandV1
  | DeclarativeV2SemanticAppendCommandV1
  | DeclarativeV2SemanticFinalizeCommandV1
  | DeclarativeV2SemanticAbandonCommandV1
  | DeclarativeV2SemanticObserveCommandV1;

export type DeclarativeV2ArtifactUploadLifecycleV1 =
  | "open"
  | "closing"
  | "finalized"
  | "abandoned";

export interface DeclarativeV2SourceUploadCurrentModuleCheckpointV1 {
  readonly path: DeclarativeV2ArtifactModulePathV1;
  readonly nextSourceBlockIndex: number;
  readonly nextSourceMapBlockIndex: number;
  readonly sourceMapStarted: boolean;
}

export interface DeclarativeV2SourceUploadCompletedCheckpointV1 {
  readonly rootSha256: DeclarativeV2ArtifactUploadSha256HexV1;
  readonly selectorSha256: DeclarativeV2ArtifactUploadSha256HexV1;
}

export interface DeclarativeV2SemanticUploadCompletedCheckpointV1 {
  readonly rootSha256: DeclarativeV2ArtifactUploadSha256HexV1;
  readonly selectorSha256: DeclarativeV2ArtifactUploadSha256HexV1;
  readonly sourceUploadId: DeclarativeV2ArtifactUploadUuidV1;
  readonly sourceGeneration: number;
  readonly sourceMutationFence: number;
  readonly sourceRootSha256: DeclarativeV2ArtifactUploadSha256HexV1;
  readonly sourceSelectorSha256: DeclarativeV2ArtifactUploadSha256HexV1;
}

export interface DeclarativeV2SourceUploadCheckpointV1 {
  readonly artifactKind: "source";
  readonly uploadId: DeclarativeV2ArtifactUploadUuidV1;
  readonly lifecycle: DeclarativeV2ArtifactUploadLifecycleV1;
  readonly generation: number;
  readonly mutationFence: number;
  readonly acceptedCommandKey: DeclarativeV2ArtifactUploadUuidV1;
  readonly nextModuleOrdinal: number;
  readonly currentModule:
    | DeclarativeV2SourceUploadCurrentModuleCheckpointV1
    | null;
  readonly usage: DeclarativeV2SourceUploadBudgetV1;
  readonly completed: DeclarativeV2SourceUploadCompletedCheckpointV1 | null;
}

export interface DeclarativeV2SemanticUploadCheckpointV1 {
  readonly artifactKind: "semantic";
  readonly uploadId: DeclarativeV2ArtifactUploadUuidV1;
  readonly lifecycle: DeclarativeV2ArtifactUploadLifecycleV1;
  readonly generation: number;
  readonly mutationFence: number;
  readonly acceptedCommandKey: DeclarativeV2ArtifactUploadUuidV1;
  readonly nextBlockOrdinal: number;
  readonly usage: DeclarativeV2SemanticUploadBudgetV1;
  readonly completed: DeclarativeV2SemanticUploadCompletedCheckpointV1 | null;
}

export type DeclarativeV2ArtifactUploadCheckpointV1 =
  | DeclarativeV2SourceUploadCheckpointV1
  | DeclarativeV2SemanticUploadCheckpointV1;

export type DeclarativeV2ArtifactUploadOperationV1 =
  | "begin"
  | "beginModule"
  | "appendBlock"
  | "closeModule"
  | "append"
  | "finalize"
  | "observe"
  | "abandon";

export type DeclarativeV2ArtifactUploadRetryDispositionV1 =
  | "never"
  | "exactAfterObserve"
  | "exactNow";

export type DeclarativeV2ArtifactUploadWireErrorV1 =
  | Readonly<{
      readonly class: "invalidCommand";
      readonly reason:
        | "malformedFrame"
        | "unsupportedOperation"
        | "invalidSelector"
        | "invalidCoordinate"
        | "trailingPayload"
        | "missingPayload"
        | "nonCanonicalMetadata";
      readonly retryDisposition: "never";
      readonly artifactKind: "source" | "semantic" | null;
      readonly uploadId: DeclarativeV2ArtifactUploadUuidV1 | null;
    }>
  | Readonly<{
      readonly class: "unauthorized";
      readonly reason: "missingCredential" | "mismatchedCredential";
      readonly retryDisposition: "never";
      readonly artifactKind: "source" | "semantic" | null;
      readonly uploadId: DeclarativeV2ArtifactUploadUuidV1 | null;
    }>
  | Readonly<{
      readonly class: "scopeMismatch";
      readonly reason:
        | "project"
        | "deployment"
        | "incarnation"
        | "source";
      readonly retryDisposition: "never";
      readonly artifactKind: "source" | "semantic" | null;
      readonly uploadId: DeclarativeV2ArtifactUploadUuidV1 | null;
    }>
  | Readonly<{
      readonly class: "notFound";
      readonly reason: "deployment" | "upload";
      readonly retryDisposition: "never";
      readonly artifactKind: "source" | "semantic" | null;
      readonly uploadId: DeclarativeV2ArtifactUploadUuidV1 | null;
    }>
  | Readonly<{
      readonly class: "stateConflict";
      readonly reason:
        | "staleGeneration"
        | "staleFence"
        | "invalidLifecycle"
        | "invalidOrder"
        | "pendingCommand"
        | "conflictingReplay";
      readonly retryDisposition: "never";
      readonly artifactKind: "source" | "semantic";
      readonly uploadId: DeclarativeV2ArtifactUploadUuidV1;
    }>
  | Readonly<{
      readonly class: "payloadTooLarge";
      readonly reason: "metadata" | "payload" | "frame";
      readonly retryDisposition: "never";
      readonly artifactKind: "source" | "semantic" | null;
      readonly uploadId: DeclarativeV2ArtifactUploadUuidV1 | null;
    }>
  | Readonly<{
      readonly class: "budgetExceeded";
      readonly reason: "transport" | "core" | "store";
      readonly retryDisposition: "never";
      readonly artifactKind: "source" | "semantic" | null;
      readonly uploadId: DeclarativeV2ArtifactUploadUuidV1 | null;
    }>
  | Readonly<{
      readonly class: "corruption";
      readonly reason: "protocol" | "durable" | "evidence";
      readonly retryDisposition: "never";
      readonly artifactKind: "source" | "semantic" | null;
      readonly uploadId: DeclarativeV2ArtifactUploadUuidV1 | null;
    }>
  | Readonly<{
      readonly class: "resourceUncertain";
      readonly reason:
        | "confirmedRollback"
        | "resource"
        | "settlement"
        | "timeout";
      readonly retryDisposition: "exactAfterObserve" | "exactNow";
      readonly artifactKind: "source" | "semantic";
      readonly uploadId: DeclarativeV2ArtifactUploadUuidV1;
    }>;

export interface DeclarativeV2ArtifactUploadSuccessResponseV1 {
  readonly codecVersion: typeof DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1;
  readonly kind: "success";
  readonly operation: DeclarativeV2ArtifactUploadOperationV1;
  readonly commandKey: DeclarativeV2ArtifactUploadUuidV1;
  readonly checkpoint: DeclarativeV2ArtifactUploadCheckpointV1;
}

export interface DeclarativeV2ArtifactUploadErrorResponseV1 {
  readonly codecVersion: typeof DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1;
  readonly kind: "error";
  readonly operation: DeclarativeV2ArtifactUploadOperationV1 | null;
  readonly commandKey: DeclarativeV2ArtifactUploadUuidV1 | null;
  readonly error: DeclarativeV2ArtifactUploadWireErrorV1;
}

export type DeclarativeV2ArtifactUploadResponseV1 =
  | DeclarativeV2ArtifactUploadSuccessResponseV1
  | DeclarativeV2ArtifactUploadErrorResponseV1;

export class DeclarativeV2ArtifactUploadCodecV1Error extends Data.TaggedError(
  "DeclarativeV2ArtifactUploadCodecV1Error",
)<{
  readonly operation: "encodeCommand" | "decodeCommand" | "encodeResponse" |
    "decodeResponse";
  readonly reason:
    | "invalidBudget"
    | "invalidInput"
    | "metadataBytesExceeded"
    | "payloadBytesExceeded"
    | "frameBytesExceeded"
    | "responseBytesExceeded"
    | "malformedBytes"
    | "nonCanonicalBytes";
  readonly field?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export interface DeclarativeV2ArtifactUploadEncodedCommandV1 {
  readonly command: DeclarativeV2ArtifactUploadCommandV1;
  readonly canonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2ArtifactUploadCodecUsageV1;
}

export interface DeclarativeV2ArtifactUploadEncodedResponseV1 {
  readonly response: DeclarativeV2ArtifactUploadResponseV1;
  readonly canonicalBytes: Uint8Array;
}

type CodecOperation =
  DeclarativeV2ArtifactUploadCodecV1Error["operation"];
type CodecErrorReason =
  DeclarativeV2ArtifactUploadCodecV1Error["reason"];
type UnknownRecord = Readonly<Record<string, unknown>>;

const sourceBudgetKeys = [
  "calls",
  "blockBytes",
  "modules",
  "sourceMaps",
  "canonicalBytes",
  "frameBytes",
  "hashBytes",
  "timeMilliseconds",
] as const satisfies ReadonlyArray<keyof DeclarativeV2SourceUploadBudgetV1>;

const semanticBudgetKeys = [
  "calls",
  "blockBytes",
  "canonicalBytes",
  "frameBytes",
  "hashBytes",
  "timeMilliseconds",
] as const satisfies ReadonlyArray<keyof DeclarativeV2SemanticUploadBudgetV1>;

const scopeLookupBudgetKeys = [
  "maximumLookupCalls",
  "maximumInputBytes",
  "maximumBodyBytes",
  "maximumCanonicalBytes",
  "maximumFrameBytes",
  "maximumElapsedMilliseconds",
] as const satisfies ReadonlyArray<
  keyof DeclarativeV2ArtifactUploadScopeLookupBudgetV1
>;

const finalizedSourceReadBudgetKeys = [
  "maximumCalls",
  "maximumInputBytes",
  "maximumBodyBytes",
  "maximumCanonicalBytes",
  "maximumFrameBytes",
  "maximumHashBytes",
  "maximumElapsedMilliseconds",
] as const satisfies ReadonlyArray<
  keyof DeclarativeV2ArtifactUploadFinalizedSourceReadBudgetV1
>;

export function encodeDeclarativeV2ArtifactUploadCommandV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadEncodedCommandV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const admitted = yield* captureTransportBudget("encodeCommand", budget);
    const command = yield* captureCommand("encodeCommand", input, true);
    const metadata = commandMetadataJson(command);
    const metadataBytes = UTF8_ENCODER.encode(canonicalJson(metadata));
    const payload = commandPayload(command);
    const payloadByteLength = intrinsicByteLength(payload);
    if (payloadByteLength === undefined) {
      return yield* codecFailure("encodeCommand", "invalidInput", "payloadBytes");
    }
    yield* checkCommandByteBudget(
      "encodeCommand",
      admitted,
      metadataBytes.byteLength,
      payloadByteLength,
    );
    const total = checkedAdd(
      U32_BYTES,
      checkedAdd(metadataBytes.byteLength, payloadByteLength),
    );
    if (total === undefined || metadataBytes.byteLength > U32_MAX) {
      return yield* codecFailure("encodeCommand", "invalidInput", "frame");
    }
    const canonicalBytes = new Uint8Array(total);
    new DataView(canonicalBytes.buffer).setUint32(
      0,
      metadataBytes.byteLength,
      false,
    );
    canonicalBytes.set(metadataBytes, U32_BYTES);
    canonicalBytes.set(payload, U32_BYTES + metadataBytes.byteLength);
    return Object.freeze({
      command: ownCommand(command),
      canonicalBytes: copyBytes(canonicalBytes),
      usage: Object.freeze({
        metadataBytes: metadataBytes.byteLength,
        payloadBytes: payloadByteLength,
        frameBytes: total,
      }),
    });
  });
}

export function decodeDeclarativeV2ArtifactUploadCommandV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadEncodedCommandV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const admitted = yield* captureTransportBudget("decodeCommand", budget);
    const inputByteLength = intrinsicByteLength(input);
    if (inputByteLength === undefined || inputByteLength < U32_BYTES) {
      return yield* codecFailure("decodeCommand", "malformedBytes", "frame");
    }
    if (inputByteLength > admitted.maximumFrameBytes) {
      return yield* exceeded(
        "decodeCommand",
        "frameBytesExceeded",
        inputByteLength,
        admitted.maximumFrameBytes,
      );
    }
    if (!isUint8Array(input)) {
      return yield* codecFailure("decodeCommand", "malformedBytes", "frame");
    }
    const bytes = copyBytes(input);
    const metadataByteLength = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      U32_BYTES,
    ).getUint32(0, false);
    if (metadataByteLength === 0) {
      return yield* codecFailure("decodeCommand", "malformedBytes", "metadata");
    }
    if (metadataByteLength > admitted.maximumMetadataBytes) {
      return yield* exceeded(
        "decodeCommand",
        "metadataBytesExceeded",
        metadataByteLength,
        admitted.maximumMetadataBytes,
      );
    }
    const payloadOffset = checkedAdd(U32_BYTES, metadataByteLength);
    if (payloadOffset === undefined || payloadOffset > inputByteLength) {
      return yield* codecFailure("decodeCommand", "malformedBytes", "metadata");
    }
    const payloadByteLength = inputByteLength - payloadOffset;
    if (payloadByteLength > admitted.maximumPayloadBytes) {
      return yield* exceeded(
        "decodeCommand",
        "payloadBytesExceeded",
        payloadByteLength,
        admitted.maximumPayloadBytes,
      );
    }
    const metadataBytes = bytes.slice(U32_BYTES, payloadOffset);
    const payloadBytes = bytes.slice(payloadOffset);
    const metadataText = yield* decodeUtf8(
      "decodeCommand",
      metadataBytes,
      "metadata",
    );
    const parsed = yield* parseJson(
      "decodeCommand",
      metadataText,
      "metadata",
    );
    const command = yield* captureCommand(
      "decodeCommand",
      parsed,
      false,
      payloadBytes,
    );
    const canonicalMetadata = UTF8_ENCODER.encode(
      canonicalJson(commandMetadataJson(command)),
    );
    if (!bytesEqualFullScan(canonicalMetadata, metadataBytes)) {
      return yield* codecFailure(
        "decodeCommand",
        "nonCanonicalBytes",
        "metadata",
      );
    }
    return Object.freeze({
      command: ownCommand(command),
      canonicalBytes: copyBytes(bytes),
      usage: Object.freeze({
        metadataBytes: metadataByteLength,
        payloadBytes: payloadByteLength,
        frameBytes: inputByteLength,
      }),
    });
  });
}

export function encodeDeclarativeV2ArtifactUploadResponseV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadEncodedResponseV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const admitted = yield* captureTransportBudget("encodeResponse", budget);
    const response = yield* captureResponse("encodeResponse", input);
    const canonicalBytes = UTF8_ENCODER.encode(
      canonicalJson(responseJson(response)),
    );
    if (canonicalBytes.byteLength > admitted.maximumResponseBytes) {
      return yield* exceeded(
        "encodeResponse",
        "responseBytesExceeded",
        canonicalBytes.byteLength,
        admitted.maximumResponseBytes,
      );
    }
    return Object.freeze({
      response: ownResponse(response),
      canonicalBytes: copyBytes(canonicalBytes),
    });
  });
}

export function decodeDeclarativeV2ArtifactUploadResponseV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadEncodedResponseV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const admitted = yield* captureTransportBudget("decodeResponse", budget);
    const byteLength = intrinsicByteLength(input);
    if (byteLength === undefined || byteLength === 0) {
      return yield* codecFailure(
        "decodeResponse",
        "malformedBytes",
        "response",
      );
    }
    if (byteLength > admitted.maximumResponseBytes) {
      return yield* exceeded(
        "decodeResponse",
        "responseBytesExceeded",
        byteLength,
        admitted.maximumResponseBytes,
      );
    }
    if (!isUint8Array(input)) {
      return yield* codecFailure(
        "decodeResponse",
        "malformedBytes",
        "response",
      );
    }
    const bytes = copyBytes(input);
    const text = yield* decodeUtf8(
      "decodeResponse",
      bytes,
      "response",
    );
    const parsed = yield* parseJson(
      "decodeResponse",
      text,
      "response",
    );
    const response = yield* captureResponse("decodeResponse", parsed);
    const canonicalBytes = UTF8_ENCODER.encode(
      canonicalJson(responseJson(response)),
    );
    if (!bytesEqualFullScan(canonicalBytes, bytes)) {
      return yield* codecFailure(
        "decodeResponse",
        "nonCanonicalBytes",
        "response",
      );
    }
    return Object.freeze({
      response: ownResponse(response),
      canonicalBytes: copyBytes(bytes),
    });
  });
}

function captureTransportBudget(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadTransportBudgetV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "maximumElapsedMilliseconds",
      "maximumFrameBytes",
      "maximumMetadataBytes",
      "maximumPayloadBytes",
      "maximumRequestCalls",
      "maximumResponseBytes",
    ], "budget");
    const maximumRequestCalls = yield* positiveInteger(
      operation,
      value.maximumRequestCalls,
      "budget.maximumRequestCalls",
      "invalidBudget",
    );
    const maximumMetadataBytes = yield* positiveInteger(
      operation,
      value.maximumMetadataBytes,
      "budget.maximumMetadataBytes",
      "invalidBudget",
    );
    const maximumPayloadBytes = yield* nonNegativeInteger(
      operation,
      value.maximumPayloadBytes,
      "budget.maximumPayloadBytes",
      "invalidBudget",
    );
    const maximumFrameBytes = yield* positiveInteger(
      operation,
      value.maximumFrameBytes,
      "budget.maximumFrameBytes",
      "invalidBudget",
    );
    const maximumResponseBytes = yield* positiveInteger(
      operation,
      value.maximumResponseBytes,
      "budget.maximumResponseBytes",
      "invalidBudget",
    );
    const maximumElapsedMilliseconds = yield* positiveInteger(
      operation,
      value.maximumElapsedMilliseconds,
      "budget.maximumElapsedMilliseconds",
      "invalidBudget",
    );
    if (
      maximumMetadataBytes > U32_MAX ||
      maximumFrameBytes < U32_BYTES ||
      maximumMetadataBytes > maximumFrameBytes - U32_BYTES ||
      maximumPayloadBytes > maximumFrameBytes - U32_BYTES
    ) {
      return yield* codecFailure(operation, "invalidBudget", "budget");
    }
    return Object.freeze({
      maximumRequestCalls,
      maximumMetadataBytes,
      maximumPayloadBytes,
      maximumFrameBytes,
      maximumResponseBytes,
      maximumElapsedMilliseconds,
    });
  });
}

function captureCommand(
  operation: CodecOperation,
  input: unknown,
  payloadInRecord: boolean,
  decodedPayload?: Uint8Array,
): Result.Result<
  DeclarativeV2ArtifactUploadCommandV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const discriminants = yield* exactDiscriminants(operation, input);
    const { record, artifactKind, commandOperation } = discriminants;
    const command = artifactKind === "source"
      ? yield* captureSourceCommand(
        operation,
        record,
        commandOperation,
        payloadInRecord,
        decodedPayload,
      )
      : yield* captureSemanticCommand(
        operation,
        record,
        commandOperation,
        payloadInRecord,
        decodedPayload,
      );
    if (
      !payloadInRecord &&
      command.operation !== "appendBlock" &&
      command.operation !== "append" &&
      intrinsicByteLength(decodedPayload) !== 0
    ) {
      return yield* codecFailure(
        operation,
        "invalidInput",
        "payloadBytes",
      );
    }
    return command;
  });
}

function exactDiscriminants(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  Readonly<{
    readonly record: UnknownRecord;
    readonly artifactKind: "source" | "semantic";
    readonly commandOperation: string;
  }>,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const record = yield* recordWithDataProperties(
      operation,
      input,
      "command",
      13,
    );
    if (
      record.codecVersion !== DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1
    ) {
      return yield* codecFailure(
        operation,
        "invalidInput",
        "codecVersion",
      );
    }
    if (record.artifactKind !== "source" && record.artifactKind !== "semantic") {
      return yield* codecFailure(
        operation,
        "invalidInput",
        "artifactKind",
      );
    }
    if (!isNonEmptyString(record.operation)) {
      return yield* codecFailure(operation, "invalidInput", "operation");
    }
    return Object.freeze({
      record,
      artifactKind: record.artifactKind,
      commandOperation: record.operation,
    });
  });
}

function captureSourceCommand(
  codecOperation: CodecOperation,
  value: UnknownRecord,
  operation: string,
  payloadInRecord: boolean,
  decodedPayload?: Uint8Array,
): Result.Result<
  DeclarativeV2ArtifactUploadCommandV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  const common = [
    "artifactKind",
    "codecVersion",
    "commandKey",
    "deploymentId",
    "operation",
    "uploadId",
  ] as const;
  switch (operation) {
    case "begin":
      return Result.gen(function* () {
        yield* requireExactKeys(codecOperation, value, [
          ...common,
          "admission",
          "ceilings",
        ], "command");
        const base = yield* sourceBase(codecOperation, value);
        const ceilings = yield* sourceBudget(
          codecOperation,
          value.ceilings,
          "ceilings",
          true,
        );
        const admission = yield* sourceBudget(
          codecOperation,
          value.admission,
          "admission",
          false,
        );
        yield* budgetFits(
          codecOperation,
          admission,
          ceilings,
          sourceBudgetKeys,
          "admission",
        );
        return Object.freeze({
          ...base,
          operation: "begin" as const,
          ceilings,
          admission,
        });
      });
    case "beginModule":
      return Result.gen(function* () {
        yield* requireExactKeys(codecOperation, value, [
          ...common,
          "admission",
          "environment",
          "expectedFence",
          "generation",
          "path",
          "roles",
        ], "command");
        const base = yield* sourceAttemptBase(codecOperation, value);
        const path = yield* Result.mapError(
          decodeDeclarativeV2ArtifactModulePathV1(value.path),
          () => codecError(codecOperation, "invalidInput", "path"),
        );
        if (!isSourceArtifactV2ModuleRolesV1(value.roles)) {
          return yield* codecFailure(
            codecOperation,
            "invalidInput",
            "roles",
          );
        }
        if (value.environment !== "isolate") {
          return yield* codecFailure(
            codecOperation,
            "invalidInput",
            "environment",
          );
        }
        return Object.freeze({
          ...base,
          operation: "beginModule" as const,
          path,
          roles: value.roles,
          environment: "isolate" as const,
        });
      });
      case "appendBlock":
        return Result.gen(function* () {
        yield* requireExactKeys(codecOperation, value, [
          ...common,
          "admission",
          "blockIndex",
          "expectedFence",
          "generation",
          ...(payloadInRecord ? ["payloadBytes"] as const : []),
          "stream",
        ], "command");
        const base = yield* sourceAttemptBase(codecOperation, value);
          if (value.stream !== "source" && value.stream !== "sourceMap") {
          return yield* codecFailure(
            codecOperation,
            "invalidInput",
            "stream",
          );
          }
          const payload = yield* commandPayloadBytes(
            codecOperation,
            payloadInRecord ? value.payloadBytes : decodedPayload,
          );
          yield* payloadFitsAdmission(
            codecOperation,
            payload,
            base.admission.blockBytes,
          );
          return Object.freeze({
          ...base,
          operation: "appendBlock" as const,
          stream: value.stream,
          blockIndex: yield* nonNegativeInteger(
            codecOperation,
            value.blockIndex,
            "blockIndex",
          ),
          payloadBytes: payload,
        });
      });
    case "closeModule":
    case "finalize":
    case "abandon":
      return Result.gen(function* () {
        yield* requireExactKeys(codecOperation, value, [
          ...common,
          "admission",
          "expectedFence",
          "generation",
        ], "command");
        const base = yield* sourceAttemptBase(codecOperation, value);
        return Object.freeze({ ...base, operation });
      });
    case "observe":
      return Result.gen(function* () {
        yield* requireExactKeys(codecOperation, value, [
          ...common,
          "budget",
        ], "command");
        const base = yield* sourceBase(codecOperation, value);
        return Object.freeze({
          ...base,
          operation: "observe" as const,
          budget: yield* observeBudget(codecOperation, value.budget),
        });
      });
    default:
      return codecFailure(codecOperation, "invalidInput", "operation");
  }
}

function captureSemanticCommand(
  codecOperation: CodecOperation,
  value: UnknownRecord,
  operation: string,
  payloadInRecord: boolean,
  decodedPayload?: Uint8Array,
): Result.Result<
  DeclarativeV2ArtifactUploadCommandV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  const common = [
    "artifactKind",
    "codecVersion",
    "commandKey",
    "deploymentId",
    "operation",
    "uploadId",
  ] as const;
  switch (operation) {
    case "begin":
      return Result.gen(function* () {
        yield* requireExactKeys(codecOperation, value, [
          ...common,
          "admission",
          "authorizationBudget",
          "ceilings",
          "finalizedSourceReadBudget",
          "sourceGeneration",
          "sourceMutationFence",
          "sourceUploadId",
        ], "command");
        const base = yield* semanticBase(codecOperation, value);
        const ceilings = yield* semanticBudget(
          codecOperation,
          value.ceilings,
          "ceilings",
        );
        const admission = yield* semanticBudget(
          codecOperation,
          value.admission,
          "admission",
        );
        yield* budgetFits(
          codecOperation,
          admission,
          ceilings,
          semanticBudgetKeys,
          "admission",
        );
        const authorizationBudget = yield* budgetPair(
          codecOperation,
          value.authorizationBudget,
          "authorizationBudget",
          scopeLookupBudget,
        );
        yield* budgetFits(
          codecOperation,
          authorizationBudget.command,
          authorizationBudget.cumulative,
          scopeLookupBudgetKeys,
          "authorizationBudget.command",
        );
        const sourceReadBudgetPair = yield* budgetPair(
          codecOperation,
          value.finalizedSourceReadBudget,
          "finalizedSourceReadBudget",
          finalizedSourceReadBudget,
        );
        yield* budgetFits(
          codecOperation,
          sourceReadBudgetPair.command,
          sourceReadBudgetPair.cumulative,
          finalizedSourceReadBudgetKeys,
          "finalizedSourceReadBudget.command",
        );
        return Object.freeze({
          ...base,
          operation: "begin" as const,
          sourceUploadId: yield* uuid(
            codecOperation,
            value.sourceUploadId,
            "sourceUploadId",
          ),
          sourceGeneration: yield* positiveInteger(
            codecOperation,
            value.sourceGeneration,
            "sourceGeneration",
          ),
          sourceMutationFence: yield* nonNegativeInteger(
            codecOperation,
            value.sourceMutationFence,
            "sourceMutationFence",
          ),
          ceilings,
          admission,
          authorizationBudget,
          finalizedSourceReadBudget: sourceReadBudgetPair,
        });
      });
      case "append":
        return Result.gen(function* () {
        yield* requireExactKeys(codecOperation, value, [
          ...common,
          "admission",
          "blockOrdinal",
          "expectedFence",
          "generation",
          ...(payloadInRecord ? ["payloadBytes"] as const : []),
          ], "command");
          const base = yield* semanticAttemptBase(codecOperation, value);
          const payload = yield* commandPayloadBytes(
            codecOperation,
            payloadInRecord ? value.payloadBytes : decodedPayload,
          );
          yield* payloadFitsAdmission(
            codecOperation,
            payload,
            base.admission.blockBytes,
          );
          return Object.freeze({
          ...base,
          operation: "append" as const,
          blockOrdinal: yield* nonNegativeInteger(
            codecOperation,
            value.blockOrdinal,
            "blockOrdinal",
          ),
          payloadBytes: payload,
        });
      });
    case "finalize":
    case "abandon":
      return Result.gen(function* () {
        yield* requireExactKeys(codecOperation, value, [
          ...common,
          "admission",
          "expectedFence",
          "generation",
        ], "command");
        const base = yield* semanticAttemptBase(codecOperation, value);
        return Object.freeze({ ...base, operation });
      });
    case "observe":
      return Result.gen(function* () {
        yield* requireExactKeys(codecOperation, value, [
          ...common,
          "budget",
        ], "command");
        const base = yield* semanticBase(codecOperation, value);
        return Object.freeze({
          ...base,
          operation: "observe" as const,
          budget: yield* observeBudget(codecOperation, value.budget),
        });
      });
    default:
      return codecFailure(codecOperation, "invalidInput", "operation");
  }
}

function sourceBase(
  operation: CodecOperation,
  value: UnknownRecord,
): Result.Result<
  SourceCommandBaseV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    return Object.freeze({
      codecVersion: DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1,
      artifactKind: "source" as const,
      deploymentId: yield* text(operation, value.deploymentId, "deploymentId"),
      uploadId: yield* uuid(operation, value.uploadId, "uploadId"),
      commandKey: yield* uuid(operation, value.commandKey, "commandKey"),
    });
  });
}

function semanticBase(
  operation: CodecOperation,
  value: UnknownRecord,
): Result.Result<
  SemanticCommandBaseV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    return Object.freeze({
      codecVersion: DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1,
      artifactKind: "semantic" as const,
      deploymentId: yield* text(operation, value.deploymentId, "deploymentId"),
      uploadId: yield* uuid(operation, value.uploadId, "uploadId"),
      commandKey: yield* uuid(operation, value.commandKey, "commandKey"),
    });
  });
}

function sourceAttemptBase(
  operation: CodecOperation,
  value: UnknownRecord,
): Result.Result<
  SourceAttemptCommandBaseV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    return Object.freeze({
      ...yield* sourceBase(operation, value),
      generation: yield* positiveInteger(
        operation,
        value.generation,
        "generation",
      ),
      expectedFence: yield* nonNegativeInteger(
        operation,
        value.expectedFence,
        "expectedFence",
      ),
      admission: yield* sourceBudget(
        operation,
        value.admission,
        "admission",
        false,
      ),
    });
  });
}

function semanticAttemptBase(
  operation: CodecOperation,
  value: UnknownRecord,
): Result.Result<
  SemanticAttemptCommandBaseV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    return Object.freeze({
      ...yield* semanticBase(operation, value),
      generation: yield* positiveInteger(
        operation,
        value.generation,
        "generation",
      ),
      expectedFence: yield* nonNegativeInteger(
        operation,
        value.expectedFence,
        "expectedFence",
      ),
      admission: yield* semanticBudget(
        operation,
        value.admission,
        "admission",
      ),
    });
  });
}

function sourceBudget(
  operation: CodecOperation,
  input: unknown,
  field: string,
  ceiling: boolean,
): Result.Result<
  DeclarativeV2SourceUploadBudgetV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "blockBytes",
      "calls",
      "canonicalBytes",
      "frameBytes",
      "hashBytes",
      "modules",
      "sourceMaps",
      "timeMilliseconds",
    ], field);
    const calls = yield* positiveInteger(
      operation,
      value.calls,
      `${field}.calls`,
    );
    const blockBytes = yield* positiveInteger(
      operation,
      value.blockBytes,
      `${field}.blockBytes`,
    );
    const modules = yield* positiveInteger(
      operation,
      value.modules,
      `${field}.modules`,
    );
    const sourceMaps = yield* nonNegativeInteger(
      operation,
      value.sourceMaps,
      `${field}.sourceMaps`,
    );
    const canonicalBytes = yield* positiveInteger(
      operation,
      value.canonicalBytes,
      `${field}.canonicalBytes`,
    );
    const frameBytes = yield* positiveInteger(
      operation,
      value.frameBytes,
      `${field}.frameBytes`,
    );
    const hashBytes = yield* positiveInteger(
      operation,
      value.hashBytes,
      `${field}.hashBytes`,
    );
    const timeMilliseconds = yield* positiveInteger(
      operation,
      value.timeMilliseconds,
      `${field}.timeMilliseconds`,
    );
    if (!ceiling && calls !== 1) {
      return yield* codecFailure(
        operation,
        "invalidInput",
        `${field}.calls`,
      );
    }
    return Object.freeze({
      calls,
      blockBytes,
      modules,
      sourceMaps,
      canonicalBytes,
      frameBytes,
      hashBytes,
      timeMilliseconds,
    });
  });
}

function semanticBudget(
  operation: CodecOperation,
  input: unknown,
  field: string,
): Result.Result<
  DeclarativeV2SemanticUploadBudgetV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "blockBytes",
      "calls",
      "canonicalBytes",
      "frameBytes",
      "hashBytes",
      "timeMilliseconds",
    ], field);
    return Object.freeze({
      calls: yield* nonNegativeInteger(
        operation,
        value.calls,
        `${field}.calls`,
      ),
      blockBytes: yield* nonNegativeInteger(
        operation,
        value.blockBytes,
        `${field}.blockBytes`,
      ),
      canonicalBytes: yield* nonNegativeInteger(
        operation,
        value.canonicalBytes,
        `${field}.canonicalBytes`,
      ),
      frameBytes: yield* nonNegativeInteger(
        operation,
        value.frameBytes,
        `${field}.frameBytes`,
      ),
      hashBytes: yield* nonNegativeInteger(
        operation,
        value.hashBytes,
        `${field}.hashBytes`,
      ),
      timeMilliseconds: yield* nonNegativeInteger(
        operation,
        value.timeMilliseconds,
        `${field}.timeMilliseconds`,
      ),
    });
  });
}

function observeBudget(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadObserveBudgetV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "maximumCalls",
      "maximumStoredBytes",
    ], "budget");
    return Object.freeze({
      maximumCalls: yield* positiveInteger(
        operation,
        value.maximumCalls,
        "budget.maximumCalls",
      ),
      maximumStoredBytes: yield* positiveInteger(
        operation,
        value.maximumStoredBytes,
        "budget.maximumStoredBytes",
      ),
    });
  });
}

function scopeLookupBudget(
  operation: CodecOperation,
  input: unknown,
  field: string,
): Result.Result<
  DeclarativeV2ArtifactUploadScopeLookupBudgetV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "maximumBodyBytes",
      "maximumCanonicalBytes",
      "maximumElapsedMilliseconds",
      "maximumFrameBytes",
      "maximumInputBytes",
      "maximumLookupCalls",
    ], field);
    return Object.freeze({
      maximumLookupCalls: yield* positiveInteger(
        operation,
        value.maximumLookupCalls,
        `${field}.maximumLookupCalls`,
      ),
      maximumInputBytes: yield* positiveInteger(
        operation,
        value.maximumInputBytes,
        `${field}.maximumInputBytes`,
      ),
      maximumBodyBytes: yield* positiveInteger(
        operation,
        value.maximumBodyBytes,
        `${field}.maximumBodyBytes`,
      ),
      maximumCanonicalBytes: yield* positiveInteger(
        operation,
        value.maximumCanonicalBytes,
        `${field}.maximumCanonicalBytes`,
      ),
      maximumFrameBytes: yield* positiveInteger(
        operation,
        value.maximumFrameBytes,
        `${field}.maximumFrameBytes`,
      ),
      maximumElapsedMilliseconds: yield* positiveInteger(
        operation,
        value.maximumElapsedMilliseconds,
        `${field}.maximumElapsedMilliseconds`,
      ),
    });
  });
}

function finalizedSourceReadBudget(
  operation: CodecOperation,
  input: unknown,
  field: string,
): Result.Result<
  DeclarativeV2ArtifactUploadFinalizedSourceReadBudgetV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "maximumBodyBytes",
      "maximumCalls",
      "maximumCanonicalBytes",
      "maximumElapsedMilliseconds",
      "maximumFrameBytes",
      "maximumHashBytes",
      "maximumInputBytes",
    ], field);
    return Object.freeze({
      maximumCalls: yield* positiveInteger(
        operation,
        value.maximumCalls,
        `${field}.maximumCalls`,
      ),
      maximumInputBytes: yield* positiveInteger(
        operation,
        value.maximumInputBytes,
        `${field}.maximumInputBytes`,
      ),
      maximumBodyBytes: yield* positiveInteger(
        operation,
        value.maximumBodyBytes,
        `${field}.maximumBodyBytes`,
      ),
      maximumCanonicalBytes: yield* positiveInteger(
        operation,
        value.maximumCanonicalBytes,
        `${field}.maximumCanonicalBytes`,
      ),
      maximumFrameBytes: yield* positiveInteger(
        operation,
        value.maximumFrameBytes,
        `${field}.maximumFrameBytes`,
      ),
      maximumHashBytes: yield* positiveInteger(
        operation,
        value.maximumHashBytes,
        `${field}.maximumHashBytes`,
      ),
      maximumElapsedMilliseconds: yield* positiveInteger(
        operation,
        value.maximumElapsedMilliseconds,
        `${field}.maximumElapsedMilliseconds`,
      ),
    });
  });
}

function budgetPair<T>(
  operation: CodecOperation,
  input: unknown,
  field: string,
  capture: (
    operation: CodecOperation,
    input: unknown,
    field: string,
  ) => Result.Result<T, DeclarativeV2ArtifactUploadCodecV1Error>,
): Result.Result<
  DeclarativeV2ArtifactUploadBudgetPairV1<T>,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(
      operation,
      input,
      ["command", "cumulative"],
      field,
    );
    return Object.freeze({
      cumulative: yield* capture(
        operation,
        value.cumulative,
        `${field}.cumulative`,
      ),
      command: yield* capture(
        operation,
        value.command,
        `${field}.command`,
      ),
    });
  });
}

function captureResponse(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadResponseV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* recordWithDataProperties(
      operation,
      input,
      "response",
      5,
    );
    if (
      value.codecVersion !==
        DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1
    ) {
      return yield* codecFailure(
        operation,
        "invalidInput",
        "codecVersion",
      );
    }
    if (value.kind === "success") {
      yield* requireExactKeys(operation, value, [
        "checkpoint",
        "codecVersion",
        "commandKey",
        "kind",
        "operation",
      ], "response");
      const responseOperation = yield* uploadOperation(
        operation,
        value.operation,
      );
      const checkpoint = yield* captureCheckpoint(
        operation,
        value.checkpoint,
      );
      const commandKey = yield* uuid(
        operation,
        value.commandKey,
        "commandKey",
      );
      if (!operationFitsArtifact(responseOperation, checkpoint.artifactKind)) {
        return yield* codecFailure(
          operation,
          "invalidInput",
          "operation",
        );
      }
      if (!operationFitsLifecycle(responseOperation, checkpoint.lifecycle)) {
        return yield* codecFailure(
          operation,
          "invalidInput",
          "checkpoint.lifecycle",
        );
      }
      if (
        checkpoint.artifactKind === "source" &&
        !sourceOperationFitsCurrentModule(
          responseOperation,
          checkpoint.currentModule,
        )
      ) {
        return yield* codecFailure(
          operation,
          "invalidInput",
          "checkpoint.currentModule",
        );
      }
      if (
        responseOperation !== "observe" &&
        commandKey !== checkpoint.acceptedCommandKey
      ) {
        return yield* codecFailure(
          operation,
          "invalidInput",
          "commandKey",
        );
      }
      return Object.freeze({
        codecVersion: DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1,
        kind: "success" as const,
        operation: responseOperation,
        commandKey,
        checkpoint,
      });
    }
    if (value.kind === "error") {
      yield* requireExactKeys(operation, value, [
        "codecVersion",
        "commandKey",
        "error",
        "kind",
        "operation",
      ], "response");
      const responseOperation = value.operation === null
        ? null
        : yield* uploadOperation(operation, value.operation);
      const commandKey = value.commandKey === null
        ? null
        : yield* uuid(operation, value.commandKey, "commandKey");
      const error = yield* captureWireError(operation, value.error);
      if (
        responseOperation !== null &&
        error.artifactKind !== null &&
        !operationFitsArtifact(responseOperation, error.artifactKind)
      ) {
        return yield* codecFailure(
          operation,
          "invalidInput",
          "operation",
        );
      }
      if (
        error.class === "resourceUncertain" &&
        (responseOperation === null || commandKey === null)
      ) {
        return yield* codecFailure(
          operation,
          "invalidInput",
          responseOperation === null ? "operation" : "commandKey",
        );
      }
      if (
        error.class === "resourceUncertain" &&
        error.retryDisposition === "exactNow" &&
        responseOperation === "observe"
      ) {
        return yield* codecFailure(
          operation,
          "invalidInput",
          "error.retryDisposition",
        );
      }
      return Object.freeze({
        codecVersion: DECLARATIVE_V2_ARTIFACT_UPLOAD_CODEC_VERSION_V1,
        kind: "error" as const,
        operation: responseOperation,
        commandKey,
        error,
      });
    }
    return yield* codecFailure(operation, "invalidInput", "kind");
  });
}

function captureCheckpoint(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadCheckpointV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* recordWithDataProperties(
      operation,
      input,
      "checkpoint",
      10,
    );
    if (value.artifactKind === "source") {
      yield* requireExactKeys(operation, value, [
        "acceptedCommandKey",
        "artifactKind",
        "completed",
        "currentModule",
        "generation",
        "lifecycle",
        "mutationFence",
        "nextModuleOrdinal",
        "uploadId",
        "usage",
      ], "checkpoint");
      const lifecycle = yield* lifecycleValue(
        operation,
        value.lifecycle,
      );
      const completed = value.completed === null
        ? null
        : yield* sourceCompleted(operation, value.completed);
      yield* completionFitsLifecycle(operation, lifecycle, completed);
      const capturedCurrentModule = value.currentModule === null
        ? null
        : yield* currentModule(operation, value.currentModule);
      if (
        (lifecycle === "closing" || lifecycle === "finalized") &&
        capturedCurrentModule !== null
      ) {
        return yield* codecFailure(
          operation,
          "invalidInput",
          "checkpoint.currentModule",
        );
      }
      return Object.freeze({
        artifactKind: "source" as const,
        uploadId: yield* uuid(operation, value.uploadId, "checkpoint.uploadId"),
        lifecycle,
        generation: yield* positiveInteger(
          operation,
          value.generation,
          "checkpoint.generation",
        ),
        mutationFence: yield* nonNegativeInteger(
          operation,
          value.mutationFence,
          "checkpoint.mutationFence",
        ),
        acceptedCommandKey: yield* uuid(
          operation,
          value.acceptedCommandKey,
          "checkpoint.acceptedCommandKey",
        ),
        nextModuleOrdinal: yield* nonNegativeInteger(
          operation,
          value.nextModuleOrdinal,
          "checkpoint.nextModuleOrdinal",
        ),
        currentModule: capturedCurrentModule,
        usage: yield* sourceUsage(
          operation,
          value.usage,
          "checkpoint.usage",
        ),
        completed,
      });
    }
    if (value.artifactKind === "semantic") {
      yield* requireExactKeys(operation, value, [
        "acceptedCommandKey",
        "artifactKind",
        "completed",
        "generation",
        "lifecycle",
        "mutationFence",
        "nextBlockOrdinal",
        "uploadId",
        "usage",
      ], "checkpoint");
      const lifecycle = yield* lifecycleValue(
        operation,
        value.lifecycle,
      );
      const completed = value.completed === null
        ? null
        : yield* semanticCompleted(operation, value.completed);
      yield* completionFitsLifecycle(operation, lifecycle, completed);
      return Object.freeze({
        artifactKind: "semantic" as const,
        uploadId: yield* uuid(operation, value.uploadId, "checkpoint.uploadId"),
        lifecycle,
        generation: yield* positiveInteger(
          operation,
          value.generation,
          "checkpoint.generation",
        ),
        mutationFence: yield* nonNegativeInteger(
          operation,
          value.mutationFence,
          "checkpoint.mutationFence",
        ),
        acceptedCommandKey: yield* uuid(
          operation,
          value.acceptedCommandKey,
          "checkpoint.acceptedCommandKey",
        ),
        nextBlockOrdinal: yield* nonNegativeInteger(
          operation,
          value.nextBlockOrdinal,
          "checkpoint.nextBlockOrdinal",
        ),
        usage: yield* semanticBudget(
          operation,
          value.usage,
          "checkpoint.usage",
        ),
        completed,
      });
    }
    return yield* codecFailure(
      operation,
      "invalidInput",
      "checkpoint.artifactKind",
    );
  });
}

function currentModule(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  DeclarativeV2SourceUploadCurrentModuleCheckpointV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "nextSourceBlockIndex",
      "nextSourceMapBlockIndex",
      "path",
      "sourceMapStarted",
    ], "checkpoint.currentModule");
    const path = yield* Result.mapError(
      decodeDeclarativeV2ArtifactModulePathV1(value.path),
      () => codecError(operation, "invalidInput", "checkpoint.currentModule.path"),
    );
    if (typeof value.sourceMapStarted !== "boolean") {
      return yield* codecFailure(
        operation,
        "invalidInput",
        "checkpoint.currentModule.sourceMapStarted",
      );
    }
    const nextSourceMapBlockIndex = yield* nonNegativeInteger(
      operation,
      value.nextSourceMapBlockIndex,
      "checkpoint.currentModule.nextSourceMapBlockIndex",
    );
    if (
      value.sourceMapStarted !== (nextSourceMapBlockIndex > 0)
    ) {
      return yield* codecFailure(
        operation,
        "invalidInput",
        "checkpoint.currentModule.sourceMapStarted",
      );
    }
    return Object.freeze({
      path,
      nextSourceBlockIndex: yield* nonNegativeInteger(
        operation,
        value.nextSourceBlockIndex,
        "checkpoint.currentModule.nextSourceBlockIndex",
      ),
      nextSourceMapBlockIndex,
      sourceMapStarted: value.sourceMapStarted,
    });
  });
}

function sourceCompleted(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  DeclarativeV2SourceUploadCompletedCheckpointV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "rootSha256",
      "selectorSha256",
    ], "checkpoint.completed");
    return Object.freeze({
      rootSha256: yield* sha256Hex(
        operation,
        value.rootSha256,
        "checkpoint.completed.rootSha256",
      ),
      selectorSha256: yield* sha256Hex(
        operation,
        value.selectorSha256,
        "checkpoint.completed.selectorSha256",
      ),
    });
  });
}

function semanticCompleted(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  DeclarativeV2SemanticUploadCompletedCheckpointV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "rootSha256",
      "selectorSha256",
      "sourceGeneration",
      "sourceMutationFence",
      "sourceRootSha256",
      "sourceSelectorSha256",
      "sourceUploadId",
    ], "checkpoint.completed");
    return Object.freeze({
      rootSha256: yield* sha256Hex(
        operation,
        value.rootSha256,
        "checkpoint.completed.rootSha256",
      ),
      selectorSha256: yield* sha256Hex(
        operation,
        value.selectorSha256,
        "checkpoint.completed.selectorSha256",
      ),
      sourceUploadId: yield* uuid(
        operation,
        value.sourceUploadId,
        "checkpoint.completed.sourceUploadId",
      ),
      sourceGeneration: yield* positiveInteger(
        operation,
        value.sourceGeneration,
        "checkpoint.completed.sourceGeneration",
      ),
      sourceMutationFence: yield* nonNegativeInteger(
        operation,
        value.sourceMutationFence,
        "checkpoint.completed.sourceMutationFence",
      ),
      sourceRootSha256: yield* sha256Hex(
        operation,
        value.sourceRootSha256,
        "checkpoint.completed.sourceRootSha256",
      ),
      sourceSelectorSha256: yield* sha256Hex(
        operation,
        value.sourceSelectorSha256,
        "checkpoint.completed.sourceSelectorSha256",
      ),
    });
  });
}

function completionFitsLifecycle(
  operation: CodecOperation,
  lifecycle: DeclarativeV2ArtifactUploadLifecycleV1,
  completed: object | null,
): Result.Result<void, DeclarativeV2ArtifactUploadCodecV1Error> {
  const isFinalized = lifecycle === "finalized";
  return isFinalized === (completed !== null)
    ? Result.succeed(undefined)
    : codecFailure(operation, "invalidInput", "checkpoint.completed");
}

function captureWireError(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadWireErrorV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "artifactKind",
      "class",
      "reason",
      "retryDisposition",
      "uploadId",
    ], "error");
    const artifactKind = yield* nullableArtifactKind(
      operation,
      value.artifactKind,
    );
    const uploadId = value.uploadId === null
      ? null
      : yield* uuid(operation, value.uploadId, "error.uploadId");
    if (artifactKind === null && uploadId !== null) {
      return yield* codecFailure(
        operation,
        "invalidInput",
        "error.artifactKind",
      );
    }
    switch (value.class) {
      case "invalidCommand": {
        const reason = yield* literalMember(operation, value.reason, [
          "malformedFrame",
          "unsupportedOperation",
          "invalidSelector",
          "invalidCoordinate",
          "trailingPayload",
          "missingPayload",
          "nonCanonicalMetadata",
        ], "error.reason");
        yield* exactRetry(operation, value.retryDisposition, "never");
        return Object.freeze({
          class: value.class,
          reason,
          retryDisposition: "never" as const,
          artifactKind,
          uploadId,
        });
      }
      case "unauthorized": {
        const reason = yield* literalMember(operation, value.reason, [
          "missingCredential",
          "mismatchedCredential",
        ], "error.reason");
        yield* exactRetry(operation, value.retryDisposition, "never");
        return Object.freeze({
          class: value.class,
          reason,
          retryDisposition: "never" as const,
          artifactKind,
          uploadId,
        });
      }
      case "scopeMismatch": {
        const reason = yield* literalMember(operation, value.reason, [
          "project",
          "deployment",
          "incarnation",
          "source",
        ], "error.reason");
        yield* exactRetry(operation, value.retryDisposition, "never");
        return Object.freeze({
          class: value.class,
          reason,
          retryDisposition: "never" as const,
          artifactKind,
          uploadId,
        });
      }
      case "notFound": {
        const reason = yield* literalMember(operation, value.reason, [
          "deployment",
          "upload",
        ], "error.reason");
        yield* exactRetry(operation, value.retryDisposition, "never");
        return Object.freeze({
          class: value.class,
          reason,
          retryDisposition: "never" as const,
          artifactKind,
          uploadId,
        });
      }
      case "stateConflict": {
        const required = yield* requiredArtifactIdentity(
          operation,
          artifactKind,
          uploadId,
        );
        const reason = yield* literalMember(operation, value.reason, [
          "staleGeneration",
          "staleFence",
          "invalidLifecycle",
          "invalidOrder",
          "pendingCommand",
          "conflictingReplay",
        ], "error.reason");
        yield* exactRetry(operation, value.retryDisposition, "never");
        return Object.freeze({
          class: value.class,
          reason,
          retryDisposition: "never" as const,
          ...required,
        });
      }
      case "payloadTooLarge": {
        const reason = yield* literalMember(operation, value.reason, [
          "metadata",
          "payload",
          "frame",
        ], "error.reason");
        yield* exactRetry(operation, value.retryDisposition, "never");
        return Object.freeze({
          class: value.class,
          reason,
          retryDisposition: "never" as const,
          artifactKind,
          uploadId,
        });
      }
      case "budgetExceeded": {
        const reason = yield* literalMember(operation, value.reason, [
          "transport",
          "core",
          "store",
        ], "error.reason");
        yield* exactRetry(operation, value.retryDisposition, "never");
        return Object.freeze({
          class: value.class,
          reason,
          retryDisposition: "never" as const,
          artifactKind,
          uploadId,
        });
      }
      case "corruption": {
        const reason = yield* literalMember(operation, value.reason, [
          "protocol",
          "durable",
          "evidence",
        ], "error.reason");
        yield* exactRetry(operation, value.retryDisposition, "never");
        return Object.freeze({
          class: value.class,
          reason,
          retryDisposition: "never" as const,
          artifactKind,
          uploadId,
        });
      }
      case "resourceUncertain": {
        const required = yield* requiredArtifactIdentity(
          operation,
          artifactKind,
          uploadId,
        );
        const reason = yield* literalMember(operation, value.reason, [
          "confirmedRollback",
          "resource",
          "timeout",
          "settlement",
        ], "error.reason");
        if (
          value.retryDisposition !== "exactAfterObserve" &&
          value.retryDisposition !== "exactNow"
        ) {
          return yield* codecFailure(
            operation,
            "invalidInput",
            "error.retryDisposition",
          );
        }
        if (
          (value.retryDisposition === "exactNow") !==
            (reason === "confirmedRollback") ||
          (
            required.artifactKind === "source" &&
            value.retryDisposition === "exactNow"
          )
        ) {
          return yield* codecFailure(
            operation,
            "invalidInput",
            "error.retryDisposition",
          );
        }
        return Object.freeze({
          class: value.class,
          reason,
          retryDisposition: value.retryDisposition,
          ...required,
        });
      }
      default:
        return yield* codecFailure(
          operation,
          "invalidInput",
          "error.class",
        );
    }
  });
}

function commandMetadataJson(
  command: DeclarativeV2ArtifactUploadCommandV1,
): JsonObject {
  const common = {
    artifactKind: command.artifactKind,
    codecVersion: command.codecVersion,
    commandKey: command.commandKey,
    deploymentId: command.deploymentId,
    operation: command.operation,
    uploadId: command.uploadId,
  } satisfies JsonObject;
  if (command.artifactKind === "source") {
    switch (command.operation) {
      case "begin":
        return {
          ...common,
          admission: sourceBudgetJson(command.admission),
          ceilings: sourceBudgetJson(command.ceilings),
        };
      case "beginModule":
        return {
          ...common,
          admission: sourceBudgetJson(command.admission),
          environment: command.environment,
          expectedFence: command.expectedFence,
          generation: command.generation,
          path: command.path,
          roles: command.roles,
        };
      case "appendBlock":
        return {
          ...common,
          admission: sourceBudgetJson(command.admission),
          blockIndex: command.blockIndex,
          expectedFence: command.expectedFence,
          generation: command.generation,
          stream: command.stream,
        };
      case "closeModule":
      case "finalize":
      case "abandon":
        return {
          ...common,
          admission: sourceBudgetJson(command.admission),
          expectedFence: command.expectedFence,
          generation: command.generation,
        };
      case "observe":
        return { ...common, budget: observeBudgetJson(command.budget) };
    }
  }
  switch (command.operation) {
    case "begin":
      return {
        ...common,
        admission: semanticBudgetJson(command.admission),
        authorizationBudget: budgetPairJson(
          command.authorizationBudget,
          scopeLookupBudgetJson,
        ),
        ceilings: semanticBudgetJson(command.ceilings),
        finalizedSourceReadBudget: budgetPairJson(
          command.finalizedSourceReadBudget,
          finalizedSourceReadBudgetJson,
        ),
        sourceGeneration: command.sourceGeneration,
        sourceMutationFence: command.sourceMutationFence,
        sourceUploadId: command.sourceUploadId,
      };
    case "append":
      return {
        ...common,
        admission: semanticBudgetJson(command.admission),
        blockOrdinal: command.blockOrdinal,
        expectedFence: command.expectedFence,
        generation: command.generation,
      };
    case "finalize":
    case "abandon":
      return {
        ...common,
        admission: semanticBudgetJson(command.admission),
        expectedFence: command.expectedFence,
        generation: command.generation,
      };
    case "observe":
      return { ...common, budget: observeBudgetJson(command.budget) };
  }
}

function responseJson(
  response: DeclarativeV2ArtifactUploadResponseV1,
): JsonObject {
  return response.kind === "success"
    ? {
        checkpoint: checkpointJson(response.checkpoint),
        codecVersion: response.codecVersion,
        commandKey: response.commandKey,
        kind: response.kind,
        operation: response.operation,
      }
    : {
        codecVersion: response.codecVersion,
        commandKey: response.commandKey,
        error: wireErrorJson(response.error),
        kind: response.kind,
        operation: response.operation,
      };
}

function checkpointJson(
  checkpoint: DeclarativeV2ArtifactUploadCheckpointV1,
): JsonObject {
  if (checkpoint.artifactKind === "source") {
    return {
      acceptedCommandKey: checkpoint.acceptedCommandKey,
      artifactKind: checkpoint.artifactKind,
      completed: checkpoint.completed === null
        ? null
        : {
            rootSha256: checkpoint.completed.rootSha256,
            selectorSha256: checkpoint.completed.selectorSha256,
          },
      currentModule: checkpoint.currentModule === null
        ? null
        : {
            nextSourceBlockIndex:
              checkpoint.currentModule.nextSourceBlockIndex,
            nextSourceMapBlockIndex:
              checkpoint.currentModule.nextSourceMapBlockIndex,
            path: checkpoint.currentModule.path,
            sourceMapStarted: checkpoint.currentModule.sourceMapStarted,
          },
      generation: checkpoint.generation,
      lifecycle: checkpoint.lifecycle,
      mutationFence: checkpoint.mutationFence,
      nextModuleOrdinal: checkpoint.nextModuleOrdinal,
      uploadId: checkpoint.uploadId,
      usage: sourceBudgetJson(checkpoint.usage),
    };
  }
  return {
    acceptedCommandKey: checkpoint.acceptedCommandKey,
    artifactKind: checkpoint.artifactKind,
    completed: checkpoint.completed === null
      ? null
      : {
          rootSha256: checkpoint.completed.rootSha256,
          selectorSha256: checkpoint.completed.selectorSha256,
          sourceGeneration: checkpoint.completed.sourceGeneration,
          sourceMutationFence: checkpoint.completed.sourceMutationFence,
          sourceRootSha256: checkpoint.completed.sourceRootSha256,
          sourceSelectorSha256: checkpoint.completed.sourceSelectorSha256,
          sourceUploadId: checkpoint.completed.sourceUploadId,
        },
    generation: checkpoint.generation,
    lifecycle: checkpoint.lifecycle,
    mutationFence: checkpoint.mutationFence,
    nextBlockOrdinal: checkpoint.nextBlockOrdinal,
    uploadId: checkpoint.uploadId,
    usage: semanticBudgetJson(checkpoint.usage),
  };
}

function wireErrorJson(
  error: DeclarativeV2ArtifactUploadWireErrorV1,
): JsonObject {
  return {
    artifactKind: error.artifactKind,
    class: error.class,
    reason: error.reason,
    retryDisposition: error.retryDisposition,
    uploadId: error.uploadId,
  };
}

function sourceBudgetJson(
  budget: DeclarativeV2SourceUploadBudgetV1,
): JsonObject {
  return {
    blockBytes: budget.blockBytes,
    calls: budget.calls,
    canonicalBytes: budget.canonicalBytes,
    frameBytes: budget.frameBytes,
    hashBytes: budget.hashBytes,
    modules: budget.modules,
    sourceMaps: budget.sourceMaps,
    timeMilliseconds: budget.timeMilliseconds,
  };
}

function semanticBudgetJson(
  budget: DeclarativeV2SemanticUploadBudgetV1,
): JsonObject {
  return {
    blockBytes: budget.blockBytes,
    calls: budget.calls,
    canonicalBytes: budget.canonicalBytes,
    frameBytes: budget.frameBytes,
    hashBytes: budget.hashBytes,
    timeMilliseconds: budget.timeMilliseconds,
  };
}

function observeBudgetJson(
  budget: DeclarativeV2ArtifactUploadObserveBudgetV1,
): JsonObject {
  return {
    maximumCalls: budget.maximumCalls,
    maximumStoredBytes: budget.maximumStoredBytes,
  };
}

function scopeLookupBudgetJson(
  budget: DeclarativeV2ArtifactUploadScopeLookupBudgetV1,
): JsonObject {
  return {
    maximumBodyBytes: budget.maximumBodyBytes,
    maximumCanonicalBytes: budget.maximumCanonicalBytes,
    maximumElapsedMilliseconds: budget.maximumElapsedMilliseconds,
    maximumFrameBytes: budget.maximumFrameBytes,
    maximumInputBytes: budget.maximumInputBytes,
    maximumLookupCalls: budget.maximumLookupCalls,
  };
}

function finalizedSourceReadBudgetJson(
  budget: DeclarativeV2ArtifactUploadFinalizedSourceReadBudgetV1,
): JsonObject {
  return {
    maximumBodyBytes: budget.maximumBodyBytes,
    maximumCalls: budget.maximumCalls,
    maximumCanonicalBytes: budget.maximumCanonicalBytes,
    maximumElapsedMilliseconds: budget.maximumElapsedMilliseconds,
    maximumFrameBytes: budget.maximumFrameBytes,
    maximumHashBytes: budget.maximumHashBytes,
    maximumInputBytes: budget.maximumInputBytes,
  };
}

function budgetPairJson<T>(
  pair: DeclarativeV2ArtifactUploadBudgetPairV1<T>,
  encode: (value: T) => JsonObject,
): JsonObject {
  return {
    command: encode(pair.command),
    cumulative: encode(pair.cumulative),
  };
}

function commandPayload(
  command: DeclarativeV2ArtifactUploadCommandV1,
): Uint8Array {
  return command.operation === "appendBlock" || command.operation === "append"
    ? command.payloadBytes
    : new Uint8Array(0);
}

function commandPayloadBytes(
  operation: CodecOperation,
  input: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  const byteLength = intrinsicByteLength(input);
  if (byteLength === undefined || byteLength === 0 || !isUint8Array(input)) {
    return codecFailure(operation, "invalidInput", "payloadBytes");
  }
  return Result.succeed(copyBytes(input));
}

function payloadFitsAdmission(
  operation: CodecOperation,
  payload: Uint8Array,
  maximumBlockBytes: number,
): Result.Result<void, DeclarativeV2ArtifactUploadCodecV1Error> {
  const payloadByteLength = intrinsicByteLength(payload);
  return payloadByteLength !== undefined &&
      payloadByteLength <= maximumBlockBytes
    ? Result.succeed(undefined)
    : codecFailure(operation, "invalidInput", "admission.blockBytes");
}

function ownCommand(
  command: DeclarativeV2ArtifactUploadCommandV1,
): DeclarativeV2ArtifactUploadCommandV1 {
  return command.operation === "appendBlock" || command.operation === "append"
    ? Object.freeze({ ...command, payloadBytes: copyBytes(command.payloadBytes) })
    : command;
}

function ownResponse(
  response: DeclarativeV2ArtifactUploadResponseV1,
): DeclarativeV2ArtifactUploadResponseV1 {
  return response;
}

function sourceUsage(
  operation: CodecOperation,
  input: unknown,
  field: string,
): Result.Result<
  DeclarativeV2SourceUploadBudgetV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(operation, input, [
      "blockBytes",
      "calls",
      "canonicalBytes",
      "frameBytes",
      "hashBytes",
      "modules",
      "sourceMaps",
      "timeMilliseconds",
    ], field);
    return Object.freeze({
      calls: yield* nonNegativeInteger(
        operation,
        value.calls,
        `${field}.calls`,
      ),
      blockBytes: yield* nonNegativeInteger(
        operation,
        value.blockBytes,
        `${field}.blockBytes`,
      ),
      modules: yield* nonNegativeInteger(
        operation,
        value.modules,
        `${field}.modules`,
      ),
      sourceMaps: yield* nonNegativeInteger(
        operation,
        value.sourceMaps,
        `${field}.sourceMaps`,
      ),
      canonicalBytes: yield* nonNegativeInteger(
        operation,
        value.canonicalBytes,
        `${field}.canonicalBytes`,
      ),
      frameBytes: yield* nonNegativeInteger(
        operation,
        value.frameBytes,
        `${field}.frameBytes`,
      ),
      hashBytes: yield* nonNegativeInteger(
        operation,
        value.hashBytes,
        `${field}.hashBytes`,
      ),
      timeMilliseconds: yield* nonNegativeInteger(
        operation,
        value.timeMilliseconds,
        `${field}.timeMilliseconds`,
      ),
    });
  });
}

function budgetFits<
  Key extends PropertyKey,
  Value extends { readonly [Field in Key]: number },
>(
  operation: CodecOperation,
  command: Value,
  cumulative: Value,
  keys: readonly Key[],
  field: string,
): Result.Result<void, DeclarativeV2ArtifactUploadCodecV1Error> {
  for (const key of keys) {
    if (command[key] > cumulative[key]) {
      return codecFailure(
        operation,
        "invalidInput",
        `${field}.${String(key)}`,
      );
    }
  }
  return Result.succeed(undefined);
}

function checkCommandByteBudget(
  operation: CodecOperation,
  budget: DeclarativeV2ArtifactUploadTransportBudgetV1,
  metadataBytes: number,
  payloadBytes: number,
): Result.Result<void, DeclarativeV2ArtifactUploadCodecV1Error> {
  if (metadataBytes > budget.maximumMetadataBytes) {
    return exceeded(
      operation,
      "metadataBytesExceeded",
      metadataBytes,
      budget.maximumMetadataBytes,
    );
  }
  if (payloadBytes > budget.maximumPayloadBytes) {
    return exceeded(
      operation,
      "payloadBytesExceeded",
      payloadBytes,
      budget.maximumPayloadBytes,
    );
  }
  const frameBytes = checkedAdd(
    U32_BYTES,
    checkedAdd(metadataBytes, payloadBytes),
  );
  return frameBytes === undefined || frameBytes > budget.maximumFrameBytes
    ? exceeded(
        operation,
        "frameBytesExceeded",
        frameBytes ?? Number.MAX_SAFE_INTEGER,
        budget.maximumFrameBytes,
      )
    : Result.succeed(undefined);
}

function exactRecord(
  operation: CodecOperation,
  input: unknown,
  keys: readonly string[],
  field: string,
): Result.Result<
  UnknownRecord,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return Result.gen(function* () {
    const value = yield* recordWithDataProperties(
      operation,
      input,
      field,
      keys.length,
    );
    yield* requireExactKeys(operation, value, keys, field);
    return value;
  });
}

function recordWithDataProperties(
  operation: CodecOperation,
  input: unknown,
  field: string,
  maximumKeys: number,
): Result.Result<
  UnknownRecord,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  try {
    if (!isNonArrayRecord(input)) {
      return codecFailure(operation, "invalidInput", field);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return codecFailure(operation, "invalidInput", field);
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length > maximumKeys) {
      return codecFailure(operation, "invalidInput", field);
    }
    const captured: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") {
        return codecFailure(operation, "invalidInput", field);
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return codecFailure(operation, "invalidInput", field);
      }
      Object.defineProperty(captured, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Result.succeed(Object.freeze(captured));
  } catch {
    return codecFailure(operation, "invalidInput", field);
  }
}

function requireExactKeys(
  operation: CodecOperation,
  value: UnknownRecord,
  keys: readonly string[],
  field: string,
): Result.Result<void, DeclarativeV2ArtifactUploadCodecV1Error> {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return codecFailure(operation, "invalidInput", field);
  }
  return Result.succeed(undefined);
}

function text(
  operation: CodecOperation,
  value: unknown,
  field: string,
): Result.Result<string, DeclarativeV2ArtifactUploadCodecV1Error> {
  return isNonEmptyString(value) && hasOnlyPairedSurrogates(value)
    ? Result.succeed(value)
    : codecFailure(operation, "invalidInput", field);
}

function uuid(
  operation: CodecOperation,
  value: unknown,
  field: string,
): Result.Result<
  DeclarativeV2ArtifactUploadUuidV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return typeof value === "string" && isLowercaseUuidText(value)
    ? Result.succeed(brandUploadUuidV1(value))
    : codecFailure(operation, "invalidInput", field);
}

function sha256Hex(
  operation: CodecOperation,
  value: unknown,
  field: string,
): Result.Result<
  DeclarativeV2ArtifactUploadSha256HexV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
    ? Result.succeed(brandSha256HexV1(value))
    : codecFailure(operation, "invalidInput", field);
}

function positiveInteger(
  operation: CodecOperation,
  value: unknown,
  field: string,
  reason: CodecErrorReason = "invalidInput",
): Result.Result<number, DeclarativeV2ArtifactUploadCodecV1Error> {
  return isPositiveSafeInteger(value)
    ? Result.succeed(value)
    : codecFailure(operation, reason, field);
}

function nonNegativeInteger(
  operation: CodecOperation,
  value: unknown,
  field: string,
  reason: CodecErrorReason = "invalidInput",
): Result.Result<number, DeclarativeV2ArtifactUploadCodecV1Error> {
  return isNonNegativeSafeInteger(value)
    ? Result.succeed(value === 0 ? 0 : value)
    : codecFailure(operation, reason, field);
}

function uploadOperation(
  operation: CodecOperation,
  value: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadOperationV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return literalMember(operation, value, [
    "begin",
    "beginModule",
    "appendBlock",
    "closeModule",
    "append",
    "finalize",
    "observe",
    "abandon",
  ], "operation");
}

function lifecycleValue(
  operation: CodecOperation,
  value: unknown,
): Result.Result<
  DeclarativeV2ArtifactUploadLifecycleV1,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return literalMember(operation, value, [
    "open",
    "closing",
    "finalized",
    "abandoned",
  ], "checkpoint.lifecycle");
}

function nullableArtifactKind(
  operation: CodecOperation,
  value: unknown,
): Result.Result<
  "source" | "semantic" | null,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return value === null || value === "source" || value === "semantic"
    ? Result.succeed(value)
    : codecFailure(operation, "invalidInput", "error.artifactKind");
}

function requiredArtifactIdentity(
  operation: CodecOperation,
  artifactKind: "source" | "semantic" | null,
  uploadId: DeclarativeV2ArtifactUploadUuidV1 | null,
): Result.Result<
  Readonly<{
    readonly artifactKind: "source" | "semantic";
    readonly uploadId: DeclarativeV2ArtifactUploadUuidV1;
  }>,
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  return artifactKind !== null && uploadId !== null
    ? Result.succeed(Object.freeze({ artifactKind, uploadId }))
    : codecFailure(operation, "invalidInput", "error.uploadId");
}

function exactRetry(
  operation: CodecOperation,
  actual: unknown,
  expected: "never",
): Result.Result<void, DeclarativeV2ArtifactUploadCodecV1Error> {
  return actual === expected
    ? Result.succeed(undefined)
    : codecFailure(operation, "invalidInput", "error.retryDisposition");
}

function literalMember<const Values extends readonly string[]>(
  operation: CodecOperation,
  value: unknown,
  values: Values,
  field: string,
): Result.Result<
  Values[number],
  DeclarativeV2ArtifactUploadCodecV1Error
> {
  for (const candidate of values) {
    if (value === candidate) return Result.succeed(candidate);
  }
  return codecFailure(operation, "invalidInput", field);
}

function operationFitsArtifact(
  operation: DeclarativeV2ArtifactUploadOperationV1,
  artifactKind: "source" | "semantic",
): boolean {
  if (operation === "begin" || operation === "finalize" ||
    operation === "observe" || operation === "abandon") return true;
  return artifactKind === "source"
    ? operation === "beginModule" || operation === "appendBlock" ||
      operation === "closeModule"
    : operation === "append";
}

function operationFitsLifecycle(
  operation: DeclarativeV2ArtifactUploadOperationV1,
  lifecycle: DeclarativeV2ArtifactUploadLifecycleV1,
): boolean {
  switch (operation) {
    case "observe":
      return true;
    case "finalize":
      return lifecycle === "finalized";
    case "abandon":
      return lifecycle === "abandoned";
    case "begin":
    case "beginModule":
    case "appendBlock":
    case "closeModule":
    case "append":
      return lifecycle === "open";
  }
}

function sourceOperationFitsCurrentModule(
  operation: DeclarativeV2ArtifactUploadOperationV1,
  currentModule: DeclarativeV2SourceUploadCurrentModuleCheckpointV1 | null,
): boolean {
  switch (operation) {
    case "begin":
    case "closeModule":
    case "finalize":
      return currentModule === null;
    case "beginModule":
    case "appendBlock":
      return currentModule !== null;
    case "observe":
    case "abandon":
      return true;
    case "append":
      return false;
  }
}

function decodeUtf8(
  operation: CodecOperation,
  bytes: Uint8Array,
  field: string,
): Result.Result<string, DeclarativeV2ArtifactUploadCodecV1Error> {
  try {
    return Result.succeed(FATAL_UTF8_DECODER.decode(bytes));
  } catch {
    return codecFailure(operation, "malformedBytes", field);
  }
}

function parseJson(
  operation: CodecOperation,
  textValue: string,
  field: string,
): Result.Result<unknown, DeclarativeV2ArtifactUploadCodecV1Error> {
  try {
    const parsed: unknown = JSON.parse(textValue);
    return Result.succeed(parsed);
  } catch {
    return codecFailure(operation, "malformedBytes", field);
  }
}

function canonicalJson(value: Json): string {
  return encodeCanonicalJson(value, () => {
    throw new DeclarativeV2ArtifactUploadInvariantDefect({
      reason: "canonicalEncodingFailed",
    });
  });
}

class DeclarativeV2ArtifactUploadInvariantDefect extends Data.TaggedError(
  "DeclarativeV2ArtifactUploadInvariantDefect",
)<{ readonly reason: "canonicalEncodingFailed" }> {}

function intrinsicByteLength(value: unknown): number | undefined {
  if (!isUint8Array(value)) return undefined;
  try {
    const length: unknown = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(value);
    return typeof length === "number" ? length : undefined;
  } catch {
    return undefined;
  }
}

function checkedAdd(
  left: number,
  right: number | undefined,
): number | undefined {
  if (right === undefined || left > Number.MAX_SAFE_INTEGER - right) {
    return undefined;
  }
  return left + right;
}

function codecError(
  operation: CodecOperation,
  reason: CodecErrorReason,
  field?: string,
  observed?: number,
  maximum?: number,
): DeclarativeV2ArtifactUploadCodecV1Error {
  return new DeclarativeV2ArtifactUploadCodecV1Error({
    operation,
    reason,
    ...(field === undefined ? {} : { field }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

function codecFailure(
  operation: CodecOperation,
  reason: CodecErrorReason,
  field?: string,
): Result.Result<never, DeclarativeV2ArtifactUploadCodecV1Error> {
  return Result.fail(codecError(operation, reason, field));
}

function exceeded(
  operation: CodecOperation,
  reason: Extract<
    CodecErrorReason,
    | "metadataBytesExceeded"
    | "payloadBytesExceeded"
    | "frameBytesExceeded"
    | "responseBytesExceeded"
  >,
  observed: number,
  maximum: number,
): Result.Result<never, DeclarativeV2ArtifactUploadCodecV1Error> {
  return Result.fail(codecError(
    operation,
    reason,
    undefined,
    observed,
    maximum,
  ));
}
