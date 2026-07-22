import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { compareUtf16Strings, isLowercaseUuidText } from "@flarex/utils/strings";
import { Data, Effect, Result, Semaphore } from "effect";
import {
  encodeCanonicalJson,
  type Json,
} from "flarex-protocol/json";
import type {
  SourceArtifactV2Attempt,
  SourceArtifactV2AttemptStore,
  SourceArtifactV2AttemptStoreError,
  SourceArtifactV2CurrentModule,
  SourceArtifactV2PendingCommand,
  SourceArtifactV2ResourceBudget,
  SourceArtifactV2StreamProgress,
  SourceArtifactV2TreeFrontierEntry,
} from "./AttemptStore";
import { sourceArtifactV2CanonicalJsonUtf8ByteLength } from "./CanonicalJson";
import { sourceArtifactV2DigestBytesFromLowerHex } from "./Digest";
import {
  SOURCE_ARTIFACT_V2_ROLE_AUTH,
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_ROLE_MASK,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
  sourceArtifactV2BlockFrame,
  sourceArtifactV2BlockFrameProjection,
  sourceArtifactV2CompletedRootFrame,
  sourceArtifactV2ModuleFrame,
  sourceArtifactV2TreeNodeFrame,
  sourceArtifactV2UploadSelectorFrame,
  type SourceArtifactV2FrameError,
  type SourceArtifactV2FrameProjection,
  type SourceArtifactV2OwnedFrame,
  type SourceArtifactV2TreeKind,
} from "./Framing";
import type {
  SourceArtifactV2ObjectKind,
  SourceArtifactV2R2Error,
  SourceArtifactV2R2Store,
} from "./R2Store";
import type {
  SourceArtifactV2Sha256,
  SourceArtifactV2Sha256Error,
} from "./Sha256";

const UTF8_ENCODER = new TextEncoder();
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const COMMAND_DOMAIN = "flarex.source-artifact-v2.command.v1\0";
const PERSISTENCE_MULTIPLIER = 4;
const UNPREPARED_COMMAND_DIGEST = "0".repeat(64);
const ZERO_SHA256 = new Uint8Array(32);

export interface SourceArtifactV2UploadReceipt {
  readonly uploadId: string;
  readonly generation: number;
  readonly mutationFence: number;
  readonly state: SourceArtifactV2Attempt["state"];
  readonly nextModuleOrdinal: number;
  readonly currentModulePath: string | null;
  readonly completedRootDigest: string | null;
  readonly completedSelectorDigest: string | null;
}

export interface SourceArtifactV2BeginUploadInput {
  readonly uploadId: unknown;
  readonly commandId: unknown;
  readonly ceilings: unknown;
  readonly admission: unknown;
}

export interface SourceArtifactV2AttemptCommandInput {
  readonly uploadId: unknown;
  readonly generation: unknown;
  readonly expectedFence: unknown;
  readonly commandId: unknown;
  readonly admission: unknown;
}

export interface SourceArtifactV2BeginModuleInput extends SourceArtifactV2AttemptCommandInput {
  readonly path: unknown;
  readonly roles: unknown;
  readonly environment: unknown;
}

export interface SourceArtifactV2AppendBlockInput extends SourceArtifactV2AttemptCommandInput {
  readonly kind: unknown;
  readonly blockIndex: unknown;
  readonly bytes: unknown;
}

export class SourceArtifactV2UploadInputError extends Data.TaggedError(
  "SourceArtifactV2UploadInputError",
)<{
  readonly operation:
    | "beginUpload"
    | "beginModule"
    | "appendBlock"
    | "closeModule"
    | "finalize"
    | "reopen"
    | "abandon";
  readonly field: string;
  readonly reason:
    | "invalidCommand"
    | "invalidSelector"
    | "invalidBudget"
    | "invalidPath"
    | "invalidRoles"
    | "invalidEnvironment"
    | "invalidBlock";
}> {}

export class SourceArtifactV2UploadBudgetError extends Data.TaggedError(
  "SourceArtifactV2UploadBudgetError",
)<{
  readonly operation: SourceArtifactV2UploadInputError["operation"];
  readonly resource: keyof SourceArtifactV2ResourceBudget;
  readonly requested: number;
  readonly remaining: number;
}> {}

export class SourceArtifactV2UploadStateError extends Data.TaggedError(
  "SourceArtifactV2UploadStateError",
)<{
  readonly uploadId: string;
  readonly operation: SourceArtifactV2UploadInputError["operation"];
  readonly reason:
    | "invalidLifecycle"
    | "moduleAlreadyOpen"
    | "moduleNotOpen"
    | "pathOrder"
    | "blockGap"
    | "sourceAfterSourceMap"
    | "missingSource"
    | "missingExecution"
    | "duplicateRole"
    | "pendingCommand"
    | "conflictingReplay"
    | "generationMismatch"
    | "fenceExhausted";
}> {}

export type SourceArtifactV2UploadError =
  | SourceArtifactV2UploadInputError
  | SourceArtifactV2UploadBudgetError
  | SourceArtifactV2UploadStateError
  | SourceArtifactV2AttemptStoreError
  | SourceArtifactV2FrameError
  | SourceArtifactV2Sha256Error
  | SourceArtifactV2R2Error;

export interface SourceArtifactV2UploadCore {
  readonly beginUpload: (
    input: SourceArtifactV2BeginUploadInput,
  ) => Effect.Effect<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError>;
  readonly beginModule: (
    input: SourceArtifactV2BeginModuleInput,
  ) => Effect.Effect<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError>;
  readonly appendBlock: (
    input: SourceArtifactV2AppendBlockInput,
  ) => Effect.Effect<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError>;
  readonly closeModule: (
    input: SourceArtifactV2AttemptCommandInput,
  ) => Effect.Effect<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError>;
  readonly finalize: (
    input: SourceArtifactV2AttemptCommandInput,
  ) => Effect.Effect<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError>;
  readonly reopen: (
    input: SourceArtifactV2AttemptCommandInput,
  ) => Effect.Effect<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError>;
  readonly abandon: (
    input: SourceArtifactV2AttemptCommandInput,
  ) => Effect.Effect<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError>;
}

export interface SourceArtifactV2UploadCoreOptions {
  readonly deploymentId: string;
  readonly attempts: SourceArtifactV2AttemptStore;
  readonly objects: SourceArtifactV2R2Store;
  readonly sha256: SourceArtifactV2Sha256;
}

export function makeSourceArtifactV2UploadCore(
  options: SourceArtifactV2UploadCoreOptions,
): SourceArtifactV2UploadCore {
  if (options.deploymentId.length === 0) {
    throw new Error("Source-artifact upload core requires an exact deployment id.");
  }

  const beginUpload = Effect.fn("SourceArtifactV2Upload.beginUpload")(
    function* (
      input: SourceArtifactV2BeginUploadInput,
    ): Effect.fn.Return<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError> {
      const operation = "beginUpload" as const;
      const commandId = yield* decodeCommandId(operation, input.commandId);
      if (typeof input.uploadId !== "string" || !isLowercaseUuidText(input.uploadId)) {
        return yield* Effect.fail(inputFailure(operation, "uploadId", "invalidSelector"));
      }
      const uploadId = input.uploadId;
      const ceilings = yield* decodeResourceBudget(operation, "ceilings", input.ceilings, true);
      const admission = yield* decodeResourceBudget(operation, "admission", input.admission, false);
      yield* ensureAdmission(operation, zeroBudget(), ceilings, admission);
      const commandEvidence: Json = {
        deploymentId: options.deploymentId,
        uploadId,
        generation: 1,
        ceilings: budgetJson(ceilings),
        admission: budgetJson(admission),
      };
      const beginPreflight = yield* startTracker(operation, admission);
      yield* consumeCommandHashBudget(
        beginPreflight,
        commandEnvelope(operation, commandId, commandEvidence),
        0,
      );
      const existing = yield* options.attempts.read(uploadId);
      if (existing !== null) {
        if (!isExactReservedBegin(existing, commandId, ceilings, admission)) {
          const existingDigest = yield* hashCommand(
            operation,
            commandId,
            commandEvidence,
            admission,
            options.sha256,
          );
          const replay = yield* completedReplay(existing, {
            uploadId,
            generation: 1,
            expectedFence: 0,
            commandId,
            admission,
          }, existingDigest, operation);
          if (replay !== null) return replay;
          return yield* Effect.fail(stateFailure(uploadId, operation, "conflictingReplay"));
        }
        const existingDigest = yield* hashCommand(
          operation,
          commandId,
          commandEvidence,
          admission,
          options.sha256,
        );
        const completed = yield* completeReservedCommand(options.attempts, existing, {
          uploadId,
          generation: 1,
          expectedFence: 0,
          commandId,
          admission,
        }, existingDigest, {
          pendingCommand: null,
          lastReceipt: Object.freeze({ kind: operation }),
        });
        return receipt(completed);
      }
      const reserved: SourceArtifactV2Attempt = Object.freeze({
        uploadId,
        generation: 1,
        mutationFence: 1,
        state: "open",
        nextModuleOrdinal: 0,
        lastModulePath: null,
        currentModule: null,
        moduleFrontier: Object.freeze([]),
        counters: emptyCounters(),
        ceilings,
        usage: addBudgets(zeroBudget(), admission),
        pendingCommand: Object.freeze({
          kind: operation,
          commandId,
          commandDigest: null,
          admission,
        }),
        lastCommandId: `${commandId}:reserved`,
        lastCommandDigest: UNPREPARED_COMMAND_DIGEST,
        lastReceipt: Object.freeze({ kind: "reserved", command: operation }),
        completedRootDigest: null,
        completedSelectorDigest: null,
      });
      const admitted = yield* options.attempts.write({
        uploadId,
        commandId: `${commandId}:reserved`,
        commandDigest: UNPREPARED_COMMAND_DIGEST,
        expectedFence: null,
        next: reserved,
      });
      const digest = yield* hashCommand(
        operation,
        commandId,
        commandEvidence,
        admission,
        options.sha256,
      );
      const completed = yield* completeReservedCommand(options.attempts, admitted, {
        uploadId,
        generation: 1,
        expectedFence: 0,
        commandId,
        admission,
      }, digest, {
        pendingCommand: null,
        lastReceipt: Object.freeze({ kind: operation }),
      });
      return receipt(completed);
    },
  );

  const beginModule = Effect.fn("SourceArtifactV2Upload.beginModule")(
    function* (
      input: SourceArtifactV2BeginModuleInput,
    ): Effect.fn.Return<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError> {
      const operation = "beginModule" as const;
      const command = yield* decodeAttemptCommand(operation, input);
      if (typeof input.path !== "string" || input.path.length === 0) {
        return yield* Effect.fail(inputFailure(operation, "path", "invalidPath"));
      }
      if (input.environment !== "isolate") {
        return yield* Effect.fail(inputFailure(operation, "environment", "invalidEnvironment"));
      }
      if (
        typeof input.roles !== "number" || !Number.isSafeInteger(input.roles) ||
        input.roles <= 0 || (input.roles & ~SOURCE_ARTIFACT_V2_ROLE_MASK) !== 0
      ) return yield* Effect.fail(inputFailure(operation, "roles", "invalidRoles"));
      const current = yield* requireAttempt(options.attempts, command, operation);
      const commandEvidence: Json = {
        uploadId: current.uploadId,
        generation: current.generation,
        expectedFence: command.expectedFence,
        path: input.path,
        roles: input.roles,
        environment: "isolate",
        admission: budgetJson(command.admission),
      };
      if (current.lastCommandId === command.commandId) {
        const replayDigest = yield* hashCommand(
          operation, command.commandId, commandEvidence, command.admission, options.sha256,
        );
        const replay = yield* completedReplay(current, command, replayDigest, operation);
        if (replay !== null) return replay;
      }
      if (current.pendingCommand === null) {
        yield* requireOpen(current, operation);
        if (current.currentModule !== null) {
          return yield* Effect.fail(stateFailure(current.uploadId, operation, "moduleAlreadyOpen"));
        }
        if (
          current.lastModulePath !== null &&
          compareUtf16Strings(current.lastModulePath, input.path) >= 0
        ) return yield* Effect.fail(stateFailure(current.uploadId, operation, "pathOrder"));
      }
      const preflight = yield* startTracker(operation, command.admission);
      yield* preflight.consume("modules", 1);
      yield* consumeCommandHashBudget(
        preflight,
        commandEnvelope(operation, command.commandId, commandEvidence),
        0,
      );
      yield* ensureFenceHeadroom(
        current,
        operation,
        remainingCommandWrites(current, 2, false),
      );
      const admitted = yield* reserveCommand(options.attempts, current, operation, command);
      const tracker = yield* startTracker(operation, command.admission);
      yield* tracker.consume("modules", 1);
      const digest = yield* hashCommand(
        operation, command.commandId, commandEvidence, command.admission, options.sha256, tracker,
      );
      const next = yield* completeReservedCommand(options.attempts, admitted, command, digest, {
        currentModule: Object.freeze({
          path: input.path,
          roles: input.roles,
          source: emptyStreamProgress(),
          sourceMap: emptyStreamProgress(),
          sourceMapStarted: false,
        }),
        lastReceipt: Object.freeze({ kind: operation, path: input.path }),
      });
      return receipt(next);
    },
  );

  const appendBlock = Effect.fn("SourceArtifactV2Upload.appendBlock")(
    function* (
      input: SourceArtifactV2AppendBlockInput,
    ): Effect.fn.Return<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError> {
      const operation = "appendBlock" as const;
      const command = yield* decodeAttemptCommand(operation, input);
      if (!(input.kind === "source" || input.kind === "sourceMap")) {
        return yield* Effect.fail(inputFailure(operation, "kind", "invalidBlock"));
      }
      if (typeof input.blockIndex !== "number" || !nonNegativeSafe(input.blockIndex)) {
        return yield* Effect.fail(inputFailure(operation, "blockIndex", "invalidBlock"));
      }
      const current = yield* requireAttempt(options.attempts, command, operation);
      if (current.pendingCommand === null && current.lastCommandId !== command.commandId) {
        yield* ensureAdmission(operation, current.usage, current.ceilings, command.admission);
      } else if (
        current.pendingCommand !== null &&
        (
          current.pendingCommand.kind !== operation ||
          current.pendingCommand.commandId !== command.commandId ||
          !budgetsEqual(current.pendingCommand.admission, command.admission)
        )
      ) {
        return yield* Effect.fail(stateFailure(current.uploadId, operation, "pendingCommand"));
      }
      const owned = yield* captureOwnedBytes(
        operation,
        input.bytes,
        Math.min(command.admission.blockBytes, current.ceilings.blockBytes),
      );
      const blockByteLength = owned.byteLength;
      if (current.lastCommandId === command.commandId) {
        const replayTracker = yield* startTracker(operation, command.admission);
        yield* replayTracker.consume("blockBytes", owned.byteLength);
        const replayDigest = yield* hashCommand(operation, command.commandId, {
          uploadId: current.uploadId,
          generation: current.generation,
          expectedFence: command.expectedFence,
          kind: input.kind,
          blockIndex: input.blockIndex,
          byteLength: owned.byteLength,
          admission: budgetJson(command.admission),
        }, command.admission, options.sha256, replayTracker, owned);
        const replay = yield* completedReplay(current, command, replayDigest, operation);
        if (replay !== null) return replay;
      }
      yield* requireOpen(current, operation);
      const pending = current.pendingCommand;
      if (pending === null) {
        const module = current.currentModule;
        if (module === null) {
          return yield* Effect.fail(stateFailure(current.uploadId, operation, "moduleNotOpen"));
        }
        const progress = input.kind === "source" ? module.source : module.sourceMap;
        if (progress.blockCount !== input.blockIndex) {
          return yield* Effect.fail(stateFailure(current.uploadId, operation, "blockGap"));
        }
        if (input.kind === "source" && module.sourceMapStarted) {
          return yield* Effect.fail(stateFailure(current.uploadId, operation, "sourceAfterSourceMap"));
        }
      }
      const plannedModule = current.currentModule;
      if (plannedModule === null) {
        return yield* Effect.fail(stateFailure(current.uploadId, operation, "moduleNotOpen"));
      }
      const plannedProgress = input.kind === "source"
        ? plannedModule.source
        : plannedModule.sourceMap;
      const preflight = yield* startTracker(operation, command.admission);
      yield* preflight.consume("blockBytes", blockByteLength);
      if (input.kind === "sourceMap" && !plannedModule.sourceMapStarted) {
        yield* preflight.consume("sourceMaps", 1);
      }
      const commandEvidence: Json = {
        uploadId: current.uploadId,
        generation: current.generation,
        expectedFence: command.expectedFence,
        kind: input.kind,
        blockIndex: input.blockIndex,
        byteLength: blockByteLength,
        admission: budgetJson(command.admission),
      };
      yield* consumeCommandHashBudget(
        preflight,
        commandEnvelope(operation, command.commandId, commandEvidence),
        blockByteLength,
      );
      const projectedBlockFrame = yield* frameResult(sourceArtifactV2BlockFrameProjection(
        input.kind,
        BigInt(input.blockIndex),
        blockByteLength,
        { maximumFrameBytesMaterialized: preflight.remaining("frameBytes") },
      ));
      yield* consumePersistedFrameBudget(preflight, projectedBlockFrame);
      yield* preflightAppendTreeReference(input.kind, plannedProgress.frontier, Object.freeze({
        firstOrdinal: input.blockIndex,
        count: 1,
        digest: encodeBytesToLowercaseHex(ZERO_SHA256),
      }), preflight);
      yield* ensureFenceHeadroom(
        current,
        operation,
        remainingCommandWrites(current, 3, true),
      );
      const reserved = yield* reserveCommand(options.attempts, current, operation, command);
      const tracker = yield* startTracker(operation, command.admission);
      yield* tracker.consume("blockBytes", owned.byteLength);
      const currentModule = reserved.currentModule;
      if (
        input.kind === "sourceMap" && currentModule !== null &&
        !currentModule.sourceMapStarted
      ) yield* tracker.consume("sourceMaps", 1);
      const computedDigest = yield* hashCommand(
        operation,
        command.commandId,
        commandEvidence,
        command.admission,
        options.sha256,
        tracker,
        owned,
      );
      const admitted = yield* prepareForeignCommand(
        options.attempts, reserved, operation, command, computedDigest,
      );
      const digest = computedDigest;
      const module = admitted.currentModule;
      if (module === null) {
        return yield* Effect.fail(stateFailure(admitted.uploadId, operation, "moduleNotOpen"));
      }
      const progress = input.kind === "source" ? module.source : module.sourceMap;
      if (progress.blockCount !== input.blockIndex) {
        return yield* Effect.fail(stateFailure(admitted.uploadId, operation, "blockGap"));
      }
      const blockFrame = yield* frameResult(sourceArtifactV2BlockFrame(
        input.kind,
        BigInt(input.blockIndex),
        owned,
        { maximumFrameBytesMaterialized: tracker.remaining("frameBytes") },
      ));
      const blockReference = yield* persistFrame(
        input.kind === "source" ? "source-block" : "source-map-block",
        input.kind,
        input.blockIndex,
        blockFrame,
        tracker,
        options,
      );
      const nextFrontier = yield* appendTreeReference(
        input.kind,
        progress.frontier,
        blockReference,
        tracker,
        options,
      );
      const nextProgress: SourceArtifactV2StreamProgress = Object.freeze({
        blockCount: checkedIncrement(progress.blockCount, admitted.uploadId, operation),
        byteLength: checkedAdd(progress.byteLength, owned.byteLength, admitted.uploadId, operation),
        frontier: nextFrontier,
      });
      const nextModule: SourceArtifactV2CurrentModule = Object.freeze({
        ...module,
        ...(input.kind === "source" ? { source: nextProgress } : { sourceMap: nextProgress }),
        sourceMapStarted: module.sourceMapStarted || input.kind === "sourceMap",
      });
      const next = completePendingAttempt(admitted, command, digest, {
        currentModule: nextModule,
        lastReceipt: Object.freeze({
          kind: operation,
          blockKind: input.kind,
          blockIndex: input.blockIndex,
          objectDigest: blockReference.digest,
        }),
      });
      return receipt(yield* writeNext(
        options.attempts,
        admitted,
        command.commandId,
        digest,
        next,
      ));
    },
  );

  const closeModule = Effect.fn("SourceArtifactV2Upload.closeModule")(
    function* (
      input: SourceArtifactV2AttemptCommandInput,
    ): Effect.fn.Return<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError> {
      const operation = "closeModule" as const;
      const command = yield* decodeAttemptCommand(operation, input);
      const current = yield* requireAttempt(options.attempts, command, operation);
      const commandEvidence: Json = {
        uploadId: current.uploadId,
        generation: current.generation,
        expectedFence: command.expectedFence,
        admission: budgetJson(command.admission),
      };
      if (current.lastCommandId === command.commandId) {
        const replayDigest = yield* hashCommand(
          operation, command.commandId, commandEvidence, command.admission, options.sha256,
        );
        const replay = yield* completedReplay(current, command, replayDigest, operation);
        if (replay !== null) return replay;
      }
      yield* requireOpen(current, operation);
      if (current.pendingCommand === null) {
        const module = current.currentModule;
        if (module === null) return yield* Effect.fail(stateFailure(current.uploadId, operation, "moduleNotOpen"));
        if (module.source.blockCount === 0 || module.source.byteLength === 0) {
          return yield* Effect.fail(stateFailure(current.uploadId, operation, "missingSource"));
        }
      }
      const plannedModule = current.currentModule;
      if (plannedModule === null) {
        return yield* Effect.fail(stateFailure(current.uploadId, operation, "moduleNotOpen"));
      }
      const plannedCounters = yield* applyModuleRoles(current, plannedModule);
      const preflight = yield* startTracker(operation, command.admission);
      yield* consumeCommandHashBudget(
        preflight,
        commandEnvelope(operation, command.commandId, commandEvidence),
        0,
      );
      const projectedSourceRoot = yield* preflightFoldFrontier(
        "source",
        plannedModule.source.frontier,
        preflight,
      );
      const projectedSourceMapRoot = plannedModule.sourceMap.blockCount === 0
        ? null
        : yield* preflightFoldFrontier(
          "sourceMap",
          plannedModule.sourceMap.frontier,
          preflight,
        );
      const projectedModuleFrame = yield* frameResult(sourceArtifactV2ModuleFrame({
        ordinal: BigInt(current.nextModuleOrdinal),
        path: plannedModule.path,
        roles: plannedModule.roles,
        sourceByteLength: BigInt(plannedModule.source.byteLength),
        sourceBlockCount: BigInt(plannedModule.source.blockCount),
        sourceTreeDigest: sourceArtifactV2DigestBytesFromLowerHex(projectedSourceRoot.digest),
        sourceMapByteLength: BigInt(plannedModule.sourceMap.byteLength),
        sourceMapBlockCount: BigInt(plannedModule.sourceMap.blockCount),
        sourceMapTreeDigest: projectedSourceMapRoot === null
          ? null
          : sourceArtifactV2DigestBytesFromLowerHex(projectedSourceMapRoot.digest),
      }, { maximumFrameBytesMaterialized: preflight.remaining("frameBytes") }));
      yield* consumePersistedFrameBudget(preflight, projectedModuleFrame);
      yield* preflightAppendTreeReference("module", current.moduleFrontier, Object.freeze({
        firstOrdinal: current.nextModuleOrdinal,
        count: 1,
        digest: encodeBytesToLowercaseHex(ZERO_SHA256),
      }), preflight);
      yield* ensureFenceHeadroom(
        current,
        operation,
        remainingCommandWrites(current, 3, true),
      );
      const reserved = yield* reserveCommand(options.attempts, current, operation, command);
      const computedDigest = yield* hashCommand(operation, command.commandId, {
        uploadId: reserved.uploadId,
        generation: reserved.generation,
        expectedFence: command.expectedFence,
        admission: budgetJson(command.admission),
      }, command.admission, options.sha256);
      const admitted = yield* prepareForeignCommand(
        options.attempts, reserved, operation, command, computedDigest,
      );
      const digest = computedDigest;
      const module = admitted.currentModule;
      if (module === null) return yield* Effect.fail(stateFailure(admitted.uploadId, operation, "moduleNotOpen"));
      const tracker = yield* startTracker(operation, command.admission);
      const sourceRoot = yield* foldFrontier(
        "source",
        module.source.frontier,
        tracker,
        options,
      );
      const sourceMapRoot = module.sourceMap.blockCount === 0
        ? null
        : yield* foldFrontier("sourceMap", module.sourceMap.frontier, tracker, options);
      const moduleFrame = yield* frameResult(sourceArtifactV2ModuleFrame({
        ordinal: BigInt(admitted.nextModuleOrdinal),
        path: module.path,
        roles: module.roles,
        sourceByteLength: BigInt(module.source.byteLength),
        sourceBlockCount: BigInt(module.source.blockCount),
        sourceTreeDigest: sourceArtifactV2DigestBytesFromLowerHex(sourceRoot.digest),
        sourceMapByteLength: BigInt(module.sourceMap.byteLength),
        sourceMapBlockCount: BigInt(module.sourceMap.blockCount),
        sourceMapTreeDigest: sourceMapRoot === null
          ? null
          : sourceArtifactV2DigestBytesFromLowerHex(sourceMapRoot.digest),
      }, { maximumFrameBytesMaterialized: tracker.remaining("frameBytes") }));
      const moduleReference = yield* persistFrame(
        "module",
        "module",
        admitted.nextModuleOrdinal,
        moduleFrame,
        tracker,
        options,
      );
      const moduleFrontier = yield* appendTreeReference(
        "module",
        admitted.moduleFrontier,
        moduleReference,
        tracker,
        options,
      );
      const counters = plannedCounters;
      const next = completePendingAttempt(admitted, command, digest, {
        currentModule: null,
        lastModulePath: module.path,
        nextModuleOrdinal: checkedIncrement(admitted.nextModuleOrdinal, admitted.uploadId, operation),
        moduleFrontier,
        counters: Object.freeze({
          ...counters,
          moduleCount: checkedIncrement(counters.moduleCount, admitted.uploadId, operation),
          sourceByteLength: checkedAdd(
            counters.sourceByteLength,
            module.source.byteLength,
            admitted.uploadId,
            operation,
          ),
          sourceMapByteLength: checkedAdd(
            counters.sourceMapByteLength,
            module.sourceMap.byteLength,
            admitted.uploadId,
            operation,
          ),
        }),
        lastReceipt: Object.freeze({
          kind: operation,
          path: module.path,
          ordinal: admitted.nextModuleOrdinal,
          objectDigest: moduleReference.digest,
        }),
      });
      return receipt(yield* writeNext(options.attempts, admitted, command.commandId, digest, next));
    },
  );

  const finalize = Effect.fn("SourceArtifactV2Upload.finalize")(
    function* (
      input: SourceArtifactV2AttemptCommandInput,
    ): Effect.fn.Return<SourceArtifactV2UploadReceipt, SourceArtifactV2UploadError> {
      const operation = "finalize" as const;
      const command = yield* decodeAttemptCommand(operation, input);
      let current = yield* requireAttempt(options.attempts, command, operation);
      let budgetPreflightComplete = false;
      const commandEvidence: Json = {
        uploadId: current.uploadId,
        generation: current.generation,
        expectedFence: command.expectedFence,
        admission: budgetJson(command.admission),
      };
      if (current.lastCommandId === command.commandId) {
        const replayDigest = yield* hashCommand(
          operation, command.commandId, commandEvidence, command.admission, options.sha256,
        );
        const replay = yield* completedReplay(current, command, replayDigest, operation);
        if (replay !== null) return replay;
      }
      if (current.state === "open") {
        if (current.pendingCommand !== null && current.pendingCommand.commandId !== command.commandId) {
          return yield* Effect.fail(stateFailure(current.uploadId, operation, "pendingCommand"));
        }
        if (current.currentModule !== null) {
          return yield* Effect.fail(stateFailure(current.uploadId, operation, "moduleAlreadyOpen"));
        }
        if (current.counters.executionPath === null || current.counters.moduleCount === 0) {
          return yield* Effect.fail(stateFailure(current.uploadId, operation, "missingExecution"));
        }
        yield* preflightFinalizeAttempt(current, command, commandEvidence, options.deploymentId);
        yield* ensureFenceHeadroom(current, operation, 3);
        budgetPreflightComplete = true;
        current = yield* reserveCommand(
          options.attempts,
          current,
          operation,
          command,
          { state: "closing" },
        );
      }
      if (current.state !== "closing" || current.pendingCommand?.kind !== "finalize") {
        return yield* Effect.fail(stateFailure(current.uploadId, operation, "invalidLifecycle"));
      }
      if (!budgetPreflightComplete) {
        yield* preflightFinalizeAttempt(current, command, commandEvidence, options.deploymentId);
        yield* ensureFenceHeadroom(
          current,
          operation,
          remainingCommandWrites(current, 2, true),
        );
      }
      const computedDigest = yield* hashCommand(
        operation, command.commandId, commandEvidence, command.admission, options.sha256,
      );
      current = yield* prepareForeignCommand(
        options.attempts, current, operation, command, computedDigest,
      );
      const digest = computedDigest;
      const tracker = yield* startTracker(operation, command.admission);
      const moduleRoot = yield* foldFrontier("module", current.moduleFrontier, tracker, options);
      const rootFrame = yield* frameResult(sourceArtifactV2CompletedRootFrame({
        moduleCount: BigInt(current.counters.moduleCount),
        functionModuleCount: BigInt(current.counters.functionModuleCount),
        totalSourceBytes: BigInt(current.counters.sourceByteLength),
        totalSourceMapBytes: BigInt(current.counters.sourceMapByteLength),
        moduleTreeDigest: sourceArtifactV2DigestBytesFromLowerHex(moduleRoot.digest),
        executionPath: current.counters.executionPath,
        schemaPath: current.counters.schemaPath,
        authPath: current.counters.authPath,
      }, { maximumFrameBytesMaterialized: tracker.remaining("frameBytes") }));
      const rootReference = yield* persistFrame(
        "completed-root",
        "module",
        0,
        rootFrame,
        tracker,
        options,
      );
      const selectorFrame = yield* frameResult(sourceArtifactV2UploadSelectorFrame({
        deploymentId: options.deploymentId,
        uploadId: current.uploadId,
        generation: BigInt(current.generation),
        rootDigest: sourceArtifactV2DigestBytesFromLowerHex(rootReference.digest),
      }, { maximumFrameBytesMaterialized: tracker.remaining("frameBytes") }));
      const selectorDigest = yield* hashFrameOnly(selectorFrame, tracker, options.sha256);
      const next = completePendingAttempt(current, command, digest, {
        state: "finalized",
        completedRootDigest: rootReference.digest,
        completedSelectorDigest: selectorDigest,
        lastReceipt: Object.freeze({
          kind: operation,
          rootDigest: rootReference.digest,
          selectorDigest,
        }),
      });
      return receipt(yield* writeNext(options.attempts, current, command.commandId, digest, next));
    },
  );

  const reopen = simpleMutation("reopen", (current, command) => {
    if (
      current.pendingCommand !== null &&
      current.pendingCommand.commandId !== command.commandId
    ) {
      return Result.fail(stateFailure(current.uploadId, "reopen", "pendingCommand"));
    }
    return Result.succeed({ lastReceipt: Object.freeze({ kind: "reopen" }) });
  });

  const abandon = simpleMutation("abandon", (current, _command) => {
    if (current.state === "finalized" || current.state === "abandoned") {
      return Result.fail(stateFailure(current.uploadId, "abandon", "invalidLifecycle"));
    }
    return Result.succeed({
      state: "abandoned" as const,
      pendingCommand: null,
      lastReceipt: Object.freeze({ kind: "abandon" }),
    });
  });

  function simpleMutation(
    operation: "reopen" | "abandon",
    project: (
      current: SourceArtifactV2Attempt,
      command: DecodedAttemptCommand,
    ) => Result.Result<Partial<SourceArtifactV2Attempt>, SourceArtifactV2UploadStateError>,
  ): SourceArtifactV2UploadCore[typeof operation] {
    return Effect.fn(`SourceArtifactV2Upload.${operation}`)(function* (
      input: SourceArtifactV2AttemptCommandInput,
    ) {
      const command = yield* decodeAttemptCommand(operation, input);
      const current = yield* requireAttempt(options.attempts, command, operation);
      const commandEvidence: Json = {
        uploadId: current.uploadId,
        generation: current.generation,
        expectedFence: command.expectedFence,
        admission: budgetJson(command.admission),
      };
      if (current.lastCommandId === command.commandId) {
        const replayDigest = yield* hashCommand(
          operation, command.commandId, commandEvidence, command.admission, options.sha256,
        );
        const replay = yield* completedReplay(current, command, replayDigest, operation);
        if (replay !== null) return replay;
      }
      const projected = project(current, command);
      if (Result.isFailure(projected)) return yield* Effect.fail(projected.failure);
      const preflight = yield* startTracker(operation, command.admission);
      yield* consumeCommandHashBudget(
        preflight,
        commandEnvelope(operation, command.commandId, commandEvidence),
        0,
      );
      yield* ensureFenceHeadroom(
        current,
        operation,
        remainingCommandWrites(current, 2, false),
      );
      const reserved = yield* reserveCommand(options.attempts, current, operation, command);
      const digest = yield* hashCommand(
        operation, command.commandId, commandEvidence, command.admission, options.sha256,
      );
      const next = yield* completeReservedCommand(
        options.attempts, reserved, command, digest, projected.success,
      );
      return receipt(next);
    });
  }

  const uploadGates = new Map<string, UploadOperationGate>();
  return Object.freeze({
    beginUpload: serializeUploadOperation("beginUpload", uploadGates, beginUpload),
    beginModule: serializeUploadOperation("beginModule", uploadGates, beginModule),
    appendBlock: serializeUploadOperation("appendBlock", uploadGates, appendBlock),
    closeModule: serializeUploadOperation("closeModule", uploadGates, closeModule),
    finalize: serializeUploadOperation("finalize", uploadGates, finalize),
    reopen: serializeUploadOperation("reopen", uploadGates, reopen),
    abandon: serializeUploadOperation("abandon", uploadGates, abandon),
  });
}

type UploadOperationGate = {
  readonly semaphore: Semaphore.Semaphore;
  users: number;
};

function serializeUploadOperation<
  Input extends { readonly uploadId: unknown },
  Success,
  Failure,
>(
  operation: SourceArtifactV2UploadInputError["operation"],
  gates: Map<string, UploadOperationGate>,
  execute: (input: Input) => Effect.Effect<Success, Failure>,
): (input: Input) => Effect.Effect<Success, Failure | SourceArtifactV2UploadInputError> {
  return Effect.fn(`SourceArtifactV2Upload.${operation}.serialized`)(function* (input: Input) {
    if (typeof input.uploadId !== "string" || !isLowercaseUuidText(input.uploadId)) {
      return yield* Effect.fail(inputFailure(operation, "uploadId", "invalidSelector"));
    }
    const uploadId = input.uploadId;
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const existing = gates.get(uploadId);
        const gate = existing ?? {
          semaphore: Semaphore.makeUnsafe(1),
          users: 0,
        };
        gate.users += 1;
        if (existing === undefined) gates.set(uploadId, gate);
        return gate;
      }),
      gate => gate.semaphore.withPermit(execute(input)),
      gate => Effect.sync(() => {
        gate.users -= 1;
        if (gate.users === 0 && gates.get(uploadId) === gate) gates.delete(uploadId);
      }),
    );
  });
}

type DecodedAttemptCommand = Readonly<{
  uploadId: string;
  generation: number;
  expectedFence: number;
  commandId: string;
  admission: SourceArtifactV2ResourceBudget;
}>;

type BudgetTracker = {
  readonly consume: (
    resource: keyof SourceArtifactV2ResourceBudget,
    amount: number,
  ) => Effect.Effect<void, SourceArtifactV2UploadBudgetError>;
  readonly remaining: (resource: keyof SourceArtifactV2ResourceBudget) => number;
  readonly checkTime: Effect.Effect<void, SourceArtifactV2UploadBudgetError>;
};

function decodeAttemptCommand(
  operation: SourceArtifactV2UploadInputError["operation"],
  input: SourceArtifactV2AttemptCommandInput,
): Effect.Effect<DecodedAttemptCommand, SourceArtifactV2UploadInputError> {
  if (
    typeof input.uploadId !== "string" || !isLowercaseUuidText(input.uploadId) ||
    typeof input.generation !== "number" || !positiveSafe(input.generation) ||
    typeof input.expectedFence !== "number" || !positiveSafe(input.expectedFence)
  ) return Effect.fail(inputFailure(operation, "selector", "invalidSelector"));
  const uploadId = input.uploadId;
  const generation = input.generation;
  const expectedFence = input.expectedFence;
  return Effect.gen(function* () {
    const commandId = yield* decodeCommandId(operation, input.commandId);
    const admission = yield* decodeResourceBudget(operation, "admission", input.admission, false);
    return Object.freeze({
      uploadId,
      generation,
      expectedFence,
      commandId,
      admission,
    });
  });
}

function decodeCommandId(
  operation: SourceArtifactV2UploadInputError["operation"],
  value: unknown,
): Effect.Effect<string, SourceArtifactV2UploadInputError> {
  return typeof value === "string" && value.length > 0
    ? Effect.succeed(value)
    : Effect.fail(inputFailure(operation, "commandId", "invalidCommand"));
}

function decodeResourceBudget(
  operation: SourceArtifactV2UploadInputError["operation"],
  field: string,
  value: unknown,
  ceiling: boolean,
): Effect.Effect<SourceArtifactV2ResourceBudget, SourceArtifactV2UploadInputError> {
  if (!isNonArrayRecord(value)) {
    return Effect.fail(inputFailure(operation, field, "invalidBudget"));
  }
  if (
    !nonNegativeSafe(value.calls) || !nonNegativeSafe(value.blockBytes) ||
    !nonNegativeSafe(value.modules) || !nonNegativeSafe(value.sourceMaps) ||
    !nonNegativeSafe(value.canonicalBytes) || !nonNegativeSafe(value.frameBytes) ||
    !nonNegativeSafe(value.hashBytes) || !nonNegativeSafe(value.timeMilliseconds)
  ) return Effect.fail(inputFailure(operation, field, "invalidBudget"));
  const calls = value.calls;
  const blockBytes = value.blockBytes;
  const modules = value.modules;
  const sourceMaps = value.sourceMaps;
  const canonicalBytes = value.canonicalBytes;
  const frameBytes = value.frameBytes;
  const hashBytes = value.hashBytes;
  const timeMilliseconds = value.timeMilliseconds;
  if (
    calls < 1 || blockBytes < 1 || modules < 1 ||
    canonicalBytes < 1 || frameBytes < 1 || hashBytes < 1 ||
    timeMilliseconds < 1 || (!ceiling && calls !== 1)
  ) return Effect.fail(inputFailure(operation, field, "invalidBudget"));
  return Effect.succeed(Object.freeze({
    calls,
    blockBytes,
    modules,
    sourceMaps,
    canonicalBytes,
    frameBytes,
    hashBytes,
    timeMilliseconds,
  }));
}

function budgetJson(value: SourceArtifactV2ResourceBudget): Json {
  return {
    calls: value.calls,
    blockBytes: value.blockBytes,
    modules: value.modules,
    sourceMaps: value.sourceMaps,
    canonicalBytes: value.canonicalBytes,
    frameBytes: value.frameBytes,
    hashBytes: value.hashBytes,
    timeMilliseconds: value.timeMilliseconds,
  };
}

function ensureAdmission(
  operation: SourceArtifactV2UploadInputError["operation"],
  usage: SourceArtifactV2ResourceBudget,
  ceilings: SourceArtifactV2ResourceBudget,
  admission: SourceArtifactV2ResourceBudget,
): Effect.Effect<void, SourceArtifactV2UploadBudgetError> {
  for (const resource of budgetNames()) {
    const remaining = ceilings[resource] - usage[resource];
    if (admission[resource] > remaining) {
      return Effect.fail(new SourceArtifactV2UploadBudgetError({
        operation,
        resource,
        requested: admission[resource],
        remaining,
      }));
    }
  }
  return Effect.void;
}

function startTracker(
  operation: SourceArtifactV2UploadInputError["operation"],
  maximum: SourceArtifactV2ResourceBudget,
): Effect.Effect<BudgetTracker> {
  return Effect.sync(() => {
  const used: Record<keyof SourceArtifactV2ResourceBudget, number> = {
    calls: 0,
    blockBytes: 0,
    modules: 0,
    sourceMaps: 0,
    canonicalBytes: 0,
    frameBytes: 0,
    hashBytes: 0,
    timeMilliseconds: 0,
  };
  // Time is a conservative durable admission reservation. It is not a host
  // timeout: foreign settlement may outlive caller interruption and must still
  // reconcile before this command can yield a result.
  const checkTime = Effect.void;
  return {
    consume(resource, amount) {
      if (!nonNegativeSafe(amount)) {
        return Effect.die(new Error("Source-artifact budget charge is invalid."));
      }
      const next = used[resource] + amount;
      if (!Number.isSafeInteger(next) || next > maximum[resource]) {
        return Effect.fail(new SourceArtifactV2UploadBudgetError({
          operation,
          resource,
          requested: next,
          remaining: maximum[resource],
        }));
      }
      used[resource] = next;
      return Effect.void;
    },
    remaining(resource) {
      return maximum[resource] - used[resource];
    },
    checkTime,
  };
  });
}

function hashCommand(
  operation: SourceArtifactV2UploadInputError["operation"],
  commandId: string,
  value: Json,
  admission: SourceArtifactV2ResourceBudget,
  sha256: SourceArtifactV2Sha256,
  tracker?: BudgetTracker,
  bytes?: Uint8Array,
): Effect.Effect<string, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    const activeTracker = tracker ?? (yield* startTracker(operation, admission));
    const envelope: Json = { domain: COMMAND_DOMAIN, operation, commandId, value };
    const projectedCanonicalBytes = yield* consumeCommandHashBudget(
      activeTracker,
      envelope,
      bytes?.byteLength ?? 0,
    );
    yield* activeTracker.checkTime;
    const canonical = UTF8_ENCODER.encode(encodeCanonicalJson(
      envelope,
      canonicalInvariantDefect,
    ));
    if (canonical.byteLength !== projectedCanonicalBytes) {
      return yield* Effect.die(new Error("Canonical JSON byte preflight disagreed with its owner."));
    }
    const input = new Uint8Array(canonical.byteLength + (bytes?.byteLength ?? 0));
    input.set(canonical, 0);
    if (bytes !== undefined) input.set(bytes, canonical.byteLength);
    const digest = yield* sha256(input, {
      maximumInputBytes: activeTracker.remaining("hashBytes") + input.byteLength,
    });
    yield* activeTracker.checkTime;
    return encodeBytesToLowercaseHex(digest);
  });
}

const consumeCommandHashBudget = Effect.fn("SourceArtifactV2Upload.consumeCommandHashBudget")(
  function* (
    tracker: BudgetTracker,
    envelope: Json,
    additionalBytes: number,
  ) {
    const projectedCanonicalBytes = sourceArtifactV2CanonicalJsonUtf8ByteLength(envelope, {
      invalidMembership: canonicalInvariantDefect,
      overflow: canonicalLengthOverflowDefect,
    });
    yield* tracker.consume("canonicalBytes", projectedCanonicalBytes);
    yield* tracker.consume("hashBytes", checkedCanonicalLength(
      projectedCanonicalBytes,
      additionalBytes,
    ));
    return projectedCanonicalBytes;
  },
);

function commandEnvelope(
  operation: SourceArtifactV2UploadInputError["operation"],
  commandId: string,
  value: Json,
): Json {
  return { domain: COMMAND_DOMAIN, operation, commandId, value };
}

function checkedCanonicalLength(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new Error("Canonical JSON byte preflight overflowed.");
  }
  return sum;
}

function canonicalLengthOverflowDefect(): never {
  throw new Error("Canonical JSON byte preflight overflowed.");
}

function requireAttempt(
  store: SourceArtifactV2AttemptStore,
  command: DecodedAttemptCommand,
  operation: SourceArtifactV2UploadInputError["operation"],
): Effect.Effect<SourceArtifactV2Attempt, SourceArtifactV2UploadError> {
  return store.read(command.uploadId).pipe(
    Effect.flatMap(attempt => {
      if (attempt === null) {
        return Effect.fail(stateFailure(command.uploadId, operation, "invalidLifecycle"));
      }
      if (attempt.generation !== command.generation) {
        return Effect.fail(stateFailure(command.uploadId, operation, "generationMismatch"));
      }
      const pendingSame = attempt.pendingCommand?.commandId === command.commandId;
      const completedSame = attempt.lastCommandId === command.commandId;
      if (
        attempt.mutationFence !== command.expectedFence &&
        !(pendingSame || completedSame)
      ) {
        return Effect.fail(stateFailure(command.uploadId, operation, "invalidLifecycle"));
      }
      return Effect.succeed(attempt);
    }),
  );
}

function completedReplay(
  attempt: SourceArtifactV2Attempt,
  command: DecodedAttemptCommand,
  digest: string,
  operation: SourceArtifactV2UploadInputError["operation"],
): Effect.Effect<SourceArtifactV2UploadReceipt | null, SourceArtifactV2UploadStateError> {
  if (attempt.lastCommandId !== command.commandId) return Effect.succeed(null);
  return attempt.lastCommandDigest === digest
    ? Effect.succeed(receipt(attempt))
    : Effect.fail(stateFailure(attempt.uploadId, operation, "conflictingReplay"));
}

function ensureFenceHeadroom(
  attempt: SourceArtifactV2Attempt,
  operation: SourceArtifactV2UploadInputError["operation"],
  writes: 1 | 2 | 3,
): Effect.Effect<void, SourceArtifactV2UploadStateError> {
  return attempt.mutationFence <= Number.MAX_SAFE_INTEGER - writes
    ? Effect.void
    : Effect.fail(stateFailure(attempt.uploadId, operation, "fenceExhausted"));
}

function remainingCommandWrites(
  attempt: SourceArtifactV2Attempt,
  freshWrites: 2 | 3,
  hasPreparePhase: boolean,
): 1 | 2 | 3 {
  if (attempt.pendingCommand === null) return freshWrites;
  return hasPreparePhase && attempt.pendingCommand.commandDigest === null ? 2 : 1;
}

function requireOpen(
  attempt: SourceArtifactV2Attempt,
  operation: SourceArtifactV2UploadInputError["operation"],
): Effect.Effect<void, SourceArtifactV2UploadStateError> {
  return attempt.state === "open"
    ? Effect.void
    : Effect.fail(stateFailure(attempt.uploadId, operation, "invalidLifecycle"));
}

function isExactReservedBegin(
  attempt: SourceArtifactV2Attempt,
  commandId: string,
  ceilings: SourceArtifactV2ResourceBudget,
  admission: SourceArtifactV2ResourceBudget,
): boolean {
  const pending = attempt.pendingCommand;
  const counters = attempt.counters;
  return attempt.generation === 1 &&
    attempt.mutationFence === 1 &&
    attempt.state === "open" &&
    attempt.nextModuleOrdinal === 0 &&
    attempt.lastModulePath === null &&
    attempt.currentModule === null &&
    attempt.moduleFrontier.length === 0 &&
    counters.moduleCount === 0 &&
    counters.functionModuleCount === 0 &&
    counters.sourceByteLength === 0 &&
    counters.sourceMapByteLength === 0 &&
    counters.executionPath === null &&
    counters.schemaPath === null &&
    counters.authPath === null &&
    budgetsEqual(attempt.ceilings, ceilings) &&
    budgetsEqual(attempt.usage, admission) &&
    pending?.kind === "beginUpload" &&
    pending.commandId === commandId &&
    pending.commandDigest === null &&
    budgetsEqual(pending.admission, admission) &&
    attempt.lastCommandId === `${commandId}:reserved` &&
    attempt.lastCommandDigest === UNPREPARED_COMMAND_DIGEST &&
    attempt.lastReceipt.kind === "reserved" &&
    attempt.lastReceipt.command === "beginUpload" &&
    attempt.completedRootDigest === null &&
    attempt.completedSelectorDigest === null;
}

function reserveCommand(
  store: SourceArtifactV2AttemptStore,
  current: SourceArtifactV2Attempt,
  kind: SourceArtifactV2PendingCommand["kind"],
  command: DecodedAttemptCommand,
  patch: Partial<SourceArtifactV2Attempt> = {},
): Effect.Effect<
  SourceArtifactV2Attempt,
  SourceArtifactV2AttemptStoreError | SourceArtifactV2UploadStateError | SourceArtifactV2UploadBudgetError
> {
  const existing = current.pendingCommand;
  if (existing !== null) {
    if (
      existing.kind !== kind || existing.commandId !== command.commandId ||
      !budgetsEqual(existing.admission, command.admission)
    ) return Effect.fail(stateFailure(current.uploadId, kind, "pendingCommand"));
    return Effect.succeed(current);
  }
  return Effect.gen(function* () {
  yield* ensureFenceHeadroom(current, kind, 1);
  yield* ensureAdmission(kind, current.usage, current.ceilings, command.admission);
  const pending: SourceArtifactV2PendingCommand = Object.freeze({
    kind,
    commandId: command.commandId,
    commandDigest: null,
    admission: command.admission,
  });
  const next: SourceArtifactV2Attempt = Object.freeze({
    ...current,
    ...patch,
    mutationFence: nextFence(current, kind),
    usage: addBudgets(current.usage, command.admission),
    pendingCommand: pending,
    lastCommandId: `${command.commandId}:reserved`,
    lastCommandDigest: UNPREPARED_COMMAND_DIGEST,
    lastReceipt: Object.freeze({ kind: "reserved", command: kind }),
  });
  return yield* writeNext(
    store,
    current,
    `${command.commandId}:reserved`,
    UNPREPARED_COMMAND_DIGEST,
    next,
  );
  });
}

function prepareForeignCommand(
  store: SourceArtifactV2AttemptStore,
  current: SourceArtifactV2Attempt,
  kind: SourceArtifactV2PendingCommand["kind"],
  command: DecodedAttemptCommand,
  digest: string,
): Effect.Effect<SourceArtifactV2Attempt, SourceArtifactV2AttemptStoreError | SourceArtifactV2UploadStateError> {
  const pending = current.pendingCommand;
  if (
    pending === null || pending.kind !== kind || pending.commandId !== command.commandId ||
    !budgetsEqual(pending.admission, command.admission)
  ) return Effect.fail(stateFailure(current.uploadId, kind, "pendingCommand"));
  if (pending.commandDigest !== null) {
    return pending.commandDigest === digest
      ? Effect.succeed(current)
      : Effect.fail(stateFailure(current.uploadId, kind, "conflictingReplay"));
  }
  return Effect.gen(function* () {
  yield* ensureFenceHeadroom(current, kind, 1);
  const next: SourceArtifactV2Attempt = Object.freeze({
    ...current,
    mutationFence: nextFence(current, kind),
    pendingCommand: Object.freeze({ ...pending, commandDigest: digest }),
    lastCommandId: `${command.commandId}:prepared`,
    lastCommandDigest: digest,
    lastReceipt: Object.freeze({ kind: "prepared", command: kind }),
  });
  return yield* writeNext(store, current, `${command.commandId}:prepared`, digest, next);
  });
}

function completeReservedCommand(
  store: SourceArtifactV2AttemptStore,
  current: SourceArtifactV2Attempt,
  command: DecodedAttemptCommand,
  digest: string,
  patch: Partial<SourceArtifactV2Attempt>,
): Effect.Effect<SourceArtifactV2Attempt, SourceArtifactV2AttemptStoreError | SourceArtifactV2UploadStateError> {
  const pending = current.pendingCommand;
  if (
    pending === null || pending.commandId !== command.commandId ||
    !budgetsEqual(pending.admission, command.admission)
  ) return Effect.fail(stateFailure(current.uploadId, pending?.kind ?? "reopen", "pendingCommand"));
  if (pending.commandDigest !== null && pending.commandDigest !== digest) {
    return Effect.fail(stateFailure(current.uploadId, pending.kind, "conflictingReplay"));
  }
  return Effect.gen(function* () {
  yield* ensureFenceHeadroom(current, pending.kind, 1);
  const next: SourceArtifactV2Attempt = Object.freeze({
    ...current,
    ...patch,
    mutationFence: nextFence(current, pending.kind),
    pendingCommand: null,
    lastCommandId: command.commandId,
    lastCommandDigest: digest,
  });
  return yield* writeNext(store, current, command.commandId, digest, next);
  });
}

function completePendingAttempt(
  current: SourceArtifactV2Attempt,
  command: DecodedAttemptCommand,
  digest: string,
  patch: Partial<SourceArtifactV2Attempt>,
): SourceArtifactV2Attempt {
  return Object.freeze({
    ...current,
    ...patch,
    mutationFence: nextFence(current, "appendBlock"),
    pendingCommand: null,
    lastCommandId: command.commandId,
    lastCommandDigest: digest,
  });
}

function writeNext(
  store: SourceArtifactV2AttemptStore,
  current: SourceArtifactV2Attempt,
  commandId: string,
  commandDigest: string,
  next: SourceArtifactV2Attempt,
): Effect.Effect<SourceArtifactV2Attempt, SourceArtifactV2AttemptStoreError> {
  return store.write({
    uploadId: current.uploadId,
    commandId,
    commandDigest,
    expectedFence: current.mutationFence,
    next,
  });
}

function appendTreeReference(
  kind: SourceArtifactV2TreeKind,
  frontier: ReadonlyArray<SourceArtifactV2TreeFrontierEntry>,
  reference: SourceArtifactV2TreeFrontierEntry,
  tracker: BudgetTracker,
  options: SourceArtifactV2UploadCoreOptions,
): Effect.Effect<ReadonlyArray<SourceArtifactV2TreeFrontierEntry>, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    const next = [...frontier];
    let current = reference;
    while (next.length > 0 && next.at(-1)?.count === current.count) {
      const left = next.pop();
      if (left === undefined) return yield* Effect.die(new Error("Tree frontier lost its left node."));
      current = yield* persistTreeNode(kind, left, current, tracker, options);
    }
    next.push(current);
    if (next.length > 53) {
      return yield* Effect.die(new Error("Tree frontier exceeded its safe-integer depth."));
    }
    return Object.freeze(next);
  });
}

function preflightAppendTreeReference(
  kind: SourceArtifactV2TreeKind,
  frontier: ReadonlyArray<SourceArtifactV2TreeFrontierEntry>,
  reference: SourceArtifactV2TreeFrontierEntry,
  tracker: BudgetTracker,
): Effect.Effect<void, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    const next = [...frontier];
    let current = reference;
    while (next.length > 0 && next.at(-1)?.count === current.count) {
      const left = next.pop();
      if (left === undefined) return yield* Effect.die(new Error("Tree frontier lost its left node."));
      current = yield* preflightTreeNode(kind, left, current, tracker);
    }
  });
}

function preflightFoldFrontier(
  kind: SourceArtifactV2TreeKind,
  frontier: ReadonlyArray<SourceArtifactV2TreeFrontierEntry>,
  tracker: BudgetTracker,
): Effect.Effect<SourceArtifactV2TreeFrontierEntry, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    const first = frontier[0];
    if (first === undefined) return yield* Effect.die(new Error("Cannot preflight an empty source-artifact frontier."));
    let current = first;
    for (let index = 1; index < frontier.length; index += 1) {
      const right = frontier[index];
      if (right === undefined) return yield* Effect.die(new Error("Tree frontier lost an entry."));
      current = yield* preflightTreeNode(kind, current, right, tracker);
    }
    return current;
  });
}

function preflightTreeNode(
  kind: SourceArtifactV2TreeKind,
  left: SourceArtifactV2TreeFrontierEntry,
  right: SourceArtifactV2TreeFrontierEntry,
  tracker: BudgetTracker,
): Effect.Effect<SourceArtifactV2TreeFrontierEntry, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    const frame = yield* frameResult(sourceArtifactV2TreeNodeFrame(
      kind,
      treeReferenceInput(left),
      treeReferenceInput(right),
      { maximumFrameBytesMaterialized: tracker.remaining("frameBytes") },
    ));
    yield* consumePersistedFrameBudget(tracker, frame);
    return Object.freeze({
      firstOrdinal: left.firstOrdinal,
      count: checkedAdd(left.count, right.count, "tree", "appendBlock"),
      digest: encodeBytesToLowercaseHex(ZERO_SHA256),
    });
  });
}

function preflightFinalizeAttempt(
  attempt: SourceArtifactV2Attempt,
  command: DecodedAttemptCommand,
  commandEvidence: Json,
  deploymentId: string,
): Effect.Effect<void, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    const tracker = yield* startTracker("finalize", command.admission);
    yield* consumeCommandHashBudget(
      tracker,
      commandEnvelope("finalize", command.commandId, commandEvidence),
      0,
    );
    const moduleRoot = yield* preflightFoldFrontier(
      "module",
      attempt.moduleFrontier,
      tracker,
    );
    const executionPath = attempt.counters.executionPath;
    if (executionPath === null) {
      return yield* Effect.fail(stateFailure(attempt.uploadId, "finalize", "missingExecution"));
    }
    const rootFrame = yield* frameResult(sourceArtifactV2CompletedRootFrame({
      moduleCount: BigInt(attempt.counters.moduleCount),
      functionModuleCount: BigInt(attempt.counters.functionModuleCount),
      totalSourceBytes: BigInt(attempt.counters.sourceByteLength),
      totalSourceMapBytes: BigInt(attempt.counters.sourceMapByteLength),
      moduleTreeDigest: sourceArtifactV2DigestBytesFromLowerHex(moduleRoot.digest),
      executionPath,
      schemaPath: attempt.counters.schemaPath,
      authPath: attempt.counters.authPath,
    }, { maximumFrameBytesMaterialized: tracker.remaining("frameBytes") }));
    yield* consumePersistedFrameBudget(tracker, rootFrame);
    const selectorFrame = yield* frameResult(sourceArtifactV2UploadSelectorFrame({
      deploymentId,
      uploadId: attempt.uploadId,
      generation: BigInt(attempt.generation),
      rootDigest: ZERO_SHA256,
    }, { maximumFrameBytesMaterialized: tracker.remaining("frameBytes") }));
    yield* consumeHashOnlyFrameBudget(tracker, selectorFrame);
  });
}

function foldFrontier(
  kind: SourceArtifactV2TreeKind,
  frontier: ReadonlyArray<SourceArtifactV2TreeFrontierEntry>,
  tracker: BudgetTracker,
  options: SourceArtifactV2UploadCoreOptions,
): Effect.Effect<SourceArtifactV2TreeFrontierEntry, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    const first = frontier[0];
    if (first === undefined) return yield* Effect.die(new Error("Cannot fold an empty source-artifact frontier."));
    let current = first;
    for (let index = 1; index < frontier.length; index += 1) {
      const right = frontier[index];
      if (right === undefined) return yield* Effect.die(new Error("Tree frontier lost an entry."));
      current = yield* persistTreeNode(kind, current, right, tracker, options);
    }
    return current;
  });
}

function persistTreeNode(
  kind: SourceArtifactV2TreeKind,
  left: SourceArtifactV2TreeFrontierEntry,
  right: SourceArtifactV2TreeFrontierEntry,
  tracker: BudgetTracker,
  options: SourceArtifactV2UploadCoreOptions,
): Effect.Effect<SourceArtifactV2TreeFrontierEntry, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    const frame = yield* frameResult(sourceArtifactV2TreeNodeFrame(
      kind,
      treeReferenceInput(left),
      treeReferenceInput(right),
      { maximumFrameBytesMaterialized: tracker.remaining("frameBytes") },
    ));
    return yield* persistFrame(
      "tree-node",
      kind,
      left.firstOrdinal,
      frame,
      tracker,
      options,
      checkedAdd(left.count, right.count, "tree", "appendBlock"),
    );
  });
}

function persistFrame(
  objectKind: SourceArtifactV2ObjectKind,
  _treeKind: SourceArtifactV2TreeKind,
  firstOrdinal: number,
  frame: SourceArtifactV2OwnedFrame,
  tracker: BudgetTracker,
  options: SourceArtifactV2UploadCoreOptions,
  count = 1,
): Effect.Effect<SourceArtifactV2TreeFrontierEntry, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    yield* consumePersistedFrameBudget(tracker, frame);
    yield* tracker.checkTime;
    const digest = yield* options.sha256(frame.bytes, {
      maximumInputBytes: frame.bytes.byteLength,
    });
    yield* tracker.checkTime;
    yield* options.objects.putImmutable(objectKind, digest, frame.bytes, {
      maximumBodyBytes: frame.bytes.byteLength,
      maximumHashBytes: frame.bytes.byteLength,
    });
    yield* tracker.checkTime;
    return Object.freeze({
      firstOrdinal,
      count,
      digest: encodeBytesToLowercaseHex(digest),
    });
  });
}

function hashFrameOnly(
  frame: SourceArtifactV2OwnedFrame,
  tracker: BudgetTracker,
  sha256: SourceArtifactV2Sha256,
): Effect.Effect<string, SourceArtifactV2UploadError> {
  return Effect.gen(function* () {
    yield* consumeHashOnlyFrameBudget(tracker, frame);
    yield* tracker.checkTime;
    const digest = yield* sha256(frame.bytes, {
      maximumInputBytes: frame.bytes.byteLength,
    });
    yield* tracker.checkTime;
    return encodeBytesToLowercaseHex(digest);
  });
}

const consumePersistedFrameBudget = Effect.fn(
  "SourceArtifactV2Upload.consumePersistedFrameBudget",
)(function* (tracker: BudgetTracker, frame: SourceArtifactV2FrameProjection) {
  yield* tracker.consume("canonicalBytes", frame.canonicalBytesMaterialized);
  yield* tracker.consume(
    "frameBytes",
    multiplySafe(frame.frameBytesMaterialized, PERSISTENCE_MULTIPLIER),
  );
  yield* tracker.consume(
    "hashBytes",
    multiplySafe(frame.frameBytesMaterialized, PERSISTENCE_MULTIPLIER),
  );
});

const consumeHashOnlyFrameBudget = Effect.fn(
  "SourceArtifactV2Upload.consumeHashOnlyFrameBudget",
)(function* (tracker: BudgetTracker, frame: SourceArtifactV2OwnedFrame) {
  yield* tracker.consume("canonicalBytes", frame.canonicalBytesMaterialized);
  yield* tracker.consume("frameBytes", frame.frameBytesMaterialized);
  yield* tracker.consume("hashBytes", frame.frameBytesMaterialized);
});

function frameResult<Success, Failure>(
  value: Result.Result<Success, Failure>,
): Effect.Effect<Success, Failure> {
  return Effect.fromResult(value);
}

function applyModuleRoles(
  attempt: SourceArtifactV2Attempt,
  module: SourceArtifactV2CurrentModule,
): Effect.Effect<SourceArtifactV2Attempt["counters"], SourceArtifactV2UploadStateError> {
  let executionPath = attempt.counters.executionPath;
  let schemaPath = attempt.counters.schemaPath;
  let authPath = attempt.counters.authPath;
  let functionModuleCount = attempt.counters.functionModuleCount;
  if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_EXECUTION) !== 0) {
    if (executionPath !== null) return Effect.fail(stateFailure(attempt.uploadId, "closeModule", "duplicateRole"));
    executionPath = module.path;
  }
  if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_SCHEMA) !== 0) {
    if (schemaPath !== null) return Effect.fail(stateFailure(attempt.uploadId, "closeModule", "duplicateRole"));
    schemaPath = module.path;
  }
  if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_AUTH) !== 0) {
    if (authPath !== null) return Effect.fail(stateFailure(attempt.uploadId, "closeModule", "duplicateRole"));
    authPath = module.path;
  }
  if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_FUNCTION) !== 0) {
    functionModuleCount = checkedIncrement(functionModuleCount, attempt.uploadId, "closeModule");
  }
  return Effect.succeed(Object.freeze({
    ...attempt.counters,
    executionPath,
    schemaPath,
    authPath,
    functionModuleCount,
  }));
}

function receipt(attempt: SourceArtifactV2Attempt): SourceArtifactV2UploadReceipt {
  return Object.freeze({
    uploadId: attempt.uploadId,
    generation: attempt.generation,
    mutationFence: attempt.mutationFence,
    state: attempt.state,
    nextModuleOrdinal: attempt.nextModuleOrdinal,
    currentModulePath: attempt.currentModule?.path ?? null,
    completedRootDigest: attempt.completedRootDigest,
    completedSelectorDigest: attempt.completedSelectorDigest,
  });
}

function emptyCounters(): SourceArtifactV2Attempt["counters"] {
  return Object.freeze({
    moduleCount: 0,
    functionModuleCount: 0,
    sourceByteLength: 0,
    sourceMapByteLength: 0,
    executionPath: null,
    schemaPath: null,
    authPath: null,
  });
}

function emptyStreamProgress(): SourceArtifactV2StreamProgress {
  return Object.freeze({ blockCount: 0, byteLength: 0, frontier: Object.freeze([]) });
}

function zeroBudget(): SourceArtifactV2ResourceBudget {
  return Object.freeze({
    calls: 0,
    blockBytes: 0,
    modules: 0,
    sourceMaps: 0,
    canonicalBytes: 0,
    frameBytes: 0,
    hashBytes: 0,
    timeMilliseconds: 0,
  });
}

function addBudgets(
  left: SourceArtifactV2ResourceBudget,
  right: SourceArtifactV2ResourceBudget,
): SourceArtifactV2ResourceBudget {
  return Object.freeze({
    calls: safeSum(left.calls, right.calls),
    blockBytes: safeSum(left.blockBytes, right.blockBytes),
    modules: safeSum(left.modules, right.modules),
    sourceMaps: safeSum(left.sourceMaps, right.sourceMaps),
    canonicalBytes: safeSum(left.canonicalBytes, right.canonicalBytes),
    frameBytes: safeSum(left.frameBytes, right.frameBytes),
    hashBytes: safeSum(left.hashBytes, right.hashBytes),
    timeMilliseconds: safeSum(left.timeMilliseconds, right.timeMilliseconds),
  });
}

function budgetsEqual(
  left: SourceArtifactV2ResourceBudget,
  right: SourceArtifactV2ResourceBudget,
): boolean {
  return budgetNames().every(name => left[name] === right[name]);
}

function budgetNames(): readonly (keyof SourceArtifactV2ResourceBudget)[] {
  return [
    "calls", "blockBytes", "modules", "sourceMaps", "canonicalBytes",
    "frameBytes", "hashBytes", "timeMilliseconds",
  ];
}

function treeReferenceInput(reference: SourceArtifactV2TreeFrontierEntry): Readonly<{
  firstOrdinal: bigint;
  count: bigint;
  digest: Uint8Array;
}> {
  return Object.freeze({
    firstOrdinal: BigInt(reference.firstOrdinal),
    count: BigInt(reference.count),
    digest: sourceArtifactV2DigestBytesFromLowerHex(reference.digest),
  });
}

function captureOwnedBytes(
  operation: SourceArtifactV2UploadInputError["operation"],
  value: unknown,
  maximum: number,
): Effect.Effect<Uint8Array, SourceArtifactV2UploadInputError | SourceArtifactV2UploadBudgetError> {
  return validateBlockByteLength(operation, value, maximum).pipe(
    Effect.flatMap(() => Effect.try({
      try: () => copyBytes(value as Uint8Array),
      catch: () => inputFailure(operation, "bytes", "invalidBlock"),
    })),
  );
}

function validateBlockByteLength(
  operation: SourceArtifactV2UploadInputError["operation"],
  value: unknown,
  maximum: number,
): Effect.Effect<number, SourceArtifactV2UploadInputError | SourceArtifactV2UploadBudgetError> {
  const byteLength = intrinsicUint8ArrayByteLength(value);
  if (byteLength === undefined || byteLength === 0) {
    return Effect.fail(inputFailure(operation, "bytes", "invalidBlock"));
  }
  return byteLength <= maximum
    ? Effect.succeed(byteLength)
    : Effect.fail(new SourceArtifactV2UploadBudgetError({
      operation,
      resource: "blockBytes",
      requested: byteLength,
      remaining: maximum,
    }));
}

function intrinsicUint8ArrayByteLength(value: unknown): number | undefined {
  if (!isUint8Array(value) || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    const byteLength: unknown = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
    return typeof byteLength === "number" ? byteLength : undefined;
  } catch {
    return undefined;
  }
}

function nextFence(
  attempt: SourceArtifactV2Attempt,
  operation: SourceArtifactV2UploadInputError["operation"],
): number {
  if (attempt.mutationFence >= Number.MAX_SAFE_INTEGER) {
    throw stateFailure(attempt.uploadId, operation, "fenceExhausted");
  }
  return attempt.mutationFence + 1;
}

function checkedIncrement(
  value: number,
  uploadId: string,
  operation: SourceArtifactV2UploadInputError["operation"],
): number {
  return checkedAdd(value, 1, uploadId, operation);
}

function checkedAdd(
  left: number,
  right: number,
  uploadId: string,
  operation: SourceArtifactV2UploadInputError["operation"],
): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw stateFailure(uploadId, operation, "fenceExhausted");
  return sum;
}

function safeSum(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error("Source-artifact budget sum overflowed.");
  return sum;
}

function multiplySafe(value: number, multiplier: number): number {
  const result = value * multiplier;
  if (!Number.isSafeInteger(result)) throw new Error("Source-artifact resource reservation overflowed.");
  return result;
}

function nonNegativeSafe(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafe(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function inputFailure(
  operation: SourceArtifactV2UploadInputError["operation"],
  field: string,
  reason: SourceArtifactV2UploadInputError["reason"],
): SourceArtifactV2UploadInputError {
  return new SourceArtifactV2UploadInputError({ operation, field, reason });
}

function stateFailure(
  uploadId: string,
  operation: SourceArtifactV2UploadInputError["operation"],
  reason: SourceArtifactV2UploadStateError["reason"],
): SourceArtifactV2UploadStateError {
  return new SourceArtifactV2UploadStateError({ uploadId, operation, reason });
}

function canonicalInvariantDefect(): never {
  throw new Error("Source-artifact command lost canonical JSON membership.");
}
