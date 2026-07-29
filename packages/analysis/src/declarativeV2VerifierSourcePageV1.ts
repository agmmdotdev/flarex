import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  makeDeclarativeV2VerifierProgressFrameEncoderFactoryV2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierFrameBudgetV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
  type DeclarativeV2VerifierProgressFrameEncoderCursorV2,
  type DeclarativeV2VerifierProgressFrameEncoderFactoryV2,
  type DeclarativeV2VerifierProgressFrameEncodingPlanV2,
  type DeclarativeV2VerifierProgressFrameWorkV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  isSourceArtifactV2ModuleRolesV1,
  type SourceArtifactV2ModuleRolesV1,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";

import {
  makeDeclarativeV2ArtifactModulePathFactoryV1,
  type DeclarativeV2ArtifactModulePathFactoryV1,
  type DeclarativeV2ArtifactModulePathHandleV1,
  type DeclarativeV2ArtifactModulePathValidatorV1,
} from "./declarativeV2ArtifactModulePathV1";
import {
  createDeclarativeV2VerifierRuntimeArenaV1,
  createDeclarativeV2VerifierRuntimeSha256V1,
  finishDeclarativeV2VerifierRuntimeSha256V1,
  revokeDeclarativeV2VerifierRuntimeArenaV1,
  stepDeclarativeV2VerifierRuntimeSha256V1,
  type DeclarativeV2VerifierRuntimeArenaHandleV1,
  type DeclarativeV2VerifierRuntimeSha256V1,
} from "./declarativeV2VerifierRuntimeArenaV1";
import {
  planDeclarativeV2VerifierSha256WorkV1,
  type DeclarativeV2VerifierSha256WorkV1,
} from "./declarativeV2VerifierSizingV1";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_U32 = 0xffff_ffffn;
const SHA256_BYTES = 32;
const MODULE_FIXED_TABLE_BYTES = 88n;
const MODULE_FIXED_DRIVER_TRANSITIONS = 73n;
const SEAL_DRIVER_TRANSITIONS = 10n;
const ADMISSION_DRIVER_TRANSITIONS = 3n;
const FINISH_FIXED_DRIVER_TRANSITIONS = 6n;
const MAXIMUM_MODULES = 1_024;
const MAXIMUM_MODULE_PATH_BYTES = 65_536;
const FRAME_BUDGET: DeclarativeV2VerifierFrameBudgetV2 = Object.freeze({
  maximumFrameBytes: 65_536,
  maximumCanonicalBytes: 65_536,
});
const DOMAIN_BYTES = new TextEncoder().encode(
  "flarex.analysis/declarative-v2/source-page-evidence/v1\0",
);
const UINT8_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  "byteLength",
)?.get;
const UINT8_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  "buffer",
)?.get;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      "byteLength",
    )?.get;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;

export const DECLARATIVE_V2_VERIFIER_SOURCE_PAGE_TRANSITION_QUANTUM_V1 = 1_024;

export interface DeclarativeV2VerifierSourcePageBindingsV1 {
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly reservationSha256: Uint8Array;
  readonly authenticatedInputSha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

export interface DeclarativeV2VerifierSourcePageRangeV1 {
  readonly kind: "source_page";
  readonly firstModuleOrdinal: bigint;
  readonly moduleCount: bigint;
  readonly totalModuleCount: bigint;
  readonly sourceByteLength: bigint;
  readonly semanticByteLength: 0n;
}

export interface DeclarativeV2VerifierSourcePageModuleMetadataV1 {
  readonly moduleOrdinal: bigint;
  readonly roles: SourceArtifactV2ModuleRolesV1;
  readonly modulePathBytes: Uint8Array;
  readonly frameSha256: Uint8Array;
  readonly sourceSha256: Uint8Array;
  readonly sourceByteLength: bigint;
}

export interface DeclarativeV2VerifierSourcePageInputV1 {
  readonly bindings: DeclarativeV2VerifierSourcePageBindingsV1;
  readonly commandKind: "source_page";
  readonly sequence: bigint;
  readonly currentProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly predecessorReceiptSha256: Uint8Array | null;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
  readonly range: DeclarativeV2VerifierSourcePageRangeV1;
  readonly modules: readonly DeclarativeV2VerifierSourcePageModuleMetadataV1[];
}

export interface DeclarativeV2VerifierSourcePageDriverV1 {
  readonly _tag: "DeclarativeV2VerifierSourcePageDriverV1";
}

export interface DeclarativeV2VerifierSourcePageDriverReceiptV1 {
  readonly deltaTransitions: number;
  readonly aggregateTransitions: bigint;
}

export interface DeclarativeV2VerifierSourcePagePendingV1 {
  readonly status: "pending";
  readonly receipt: DeclarativeV2VerifierSourcePageDriverReceiptV1;
}

export interface DeclarativeV2VerifierSourcePageReadyV1 {
  readonly status: "ready";
  readonly receipt: DeclarativeV2VerifierSourcePageDriverReceiptV1;
}

export interface DeclarativeV2VerifierSourcePageCompleteV1 {
  readonly status: "complete";
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
  readonly actual: DeclarativeV2VerifierBudgetFrameV2;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly nextProgressBytes: Uint8Array;
  readonly outputManifest: DeclarativeV2VerifierCommandOutputManifestFrameV2;
  readonly outputManifestBytes: Uint8Array;
  readonly evidenceBytes: Uint8Array;
  readonly diagnosticBytes: Uint8Array;
  readonly evidenceRootSha256: Uint8Array;
  readonly diagnosticsRootSha256: Uint8Array;
  readonly receipt: DeclarativeV2VerifierSourcePageDriverReceiptV1;
}

export class DeclarativeV2VerifierSourcePageV1Error extends Data.TaggedError(
  "DeclarativeV2VerifierSourcePageV1Error",
)<{
  readonly operation: "create" | "step" | "finish" | "close";
  readonly reason:
    | "invalidInput"
    | "identityMismatch"
    | "invalidTransition"
    | "rangeMismatch"
    | "budgetExceeded"
    | "addressabilityExceeded"
    | "overflow"
    | "staleHandle"
    | "closed";
  readonly path?: string;
  readonly observed?: bigint;
  readonly maximum?: bigint;
}> {}

export interface DeclarativeV2VerifierSourcePageFactoryV1 {
  readonly create: (
    input: unknown,
    expectedBindings: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierSourcePageDriverV1,
    DeclarativeV2VerifierSourcePageV1Error
  >;
  readonly step: (
    driver: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierSourcePagePendingV1 |
      DeclarativeV2VerifierSourcePageReadyV1,
    DeclarativeV2VerifierSourcePageV1Error
  >;
  readonly finish: (
    driver: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierSourcePagePendingV1 |
      DeclarativeV2VerifierSourcePageCompleteV1,
    DeclarativeV2VerifierSourcePageV1Error
  >;
  readonly close: (
    driver: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierSourcePageV1Error>;
}

interface OwnedModule {
  readonly moduleOrdinal: bigint;
  readonly roles: SourceArtifactV2ModuleRolesV1;
  readonly modulePathByteLength: number;
  readonly modulePath: DeclarativeV2ArtifactModulePathHandleV1;
  readonly frameSha256: Uint8Array;
  readonly sourceSha256: Uint8Array;
  readonly sourceByteLength: bigint;
}

interface PendingModule {
  readonly moduleOrdinal: bigint;
  readonly roles: SourceArtifactV2ModuleRolesV1;
  borrowedPath: Uint8Array | undefined;
  readonly modulePathByteLength: number;
  rawFrameSha256: unknown;
  rawSourceSha256: unknown;
  readonly rawSourceByteLength: unknown;
  pathValidator: DeclarativeV2ArtifactModulePathValidatorV1 | undefined;
  modulePath: DeclarativeV2ArtifactModulePathHandleV1 | undefined;
  frameSha256: Uint8Array | undefined;
  sourceSha256: Uint8Array | undefined;
  sourceByteLength: bigint | undefined;
  copyOffset: number;
  copyStage:
    | "start"
    | "createPath"
    | "copyPath"
    | "finishPath"
    | "allocateFrameDigest"
    | "copyFrameDigest"
    | "allocateSourceDigest"
    | "copySourceDigest"
    | "finish";
}

interface MeasuredFrame {
  readonly canonicalByteLength: number;
  readonly successfulWork: DeclarativeV2VerifierProgressFrameWorkV2;
}

interface MutableUsage extends Record<
  DeclarativeV2VerifierBudgetDimensionV2,
  bigint
> {
}

interface HashState {
  readonly bytes: Uint8Array;
  readonly hash: DeclarativeV2VerifierRuntimeSha256V1;
  offset: number;
  finishing: boolean;
}

interface CapturedModuleArray {
  readonly values: readonly unknown[];
  readonly length: number;
}

type ProtocolFrameRole =
  | "currentProgress"
  | "nextProgress"
  | "outputManifest";

interface ActiveProtocolFrame {
  readonly role: ProtocolFrameRole;
  readonly cursor: DeclarativeV2VerifierProgressFrameEncoderCursorV2;
  phase: "created" | "admitted";
  destination: Uint8Array | undefined;
  byteOffset: number | undefined;
  byteLength: number | undefined;
}

interface DriverState {
  input: CapturedInput | undefined;
  borrowedModules: CapturedModuleArray | undefined;
  readonly capturedModules: PendingModule[];
  pathFactory: DeclarativeV2ArtifactModulePathFactoryV1 | undefined;
  frameEncoderFactory:
    | DeclarativeV2VerifierProgressFrameEncoderFactoryV2
    | undefined;
  activeProtocolFrame: ActiveProtocolFrame | undefined;
  preparedCurrentProgressCursor:
    | DeclarativeV2VerifierProgressFrameEncoderCursorV2
    | undefined;
  preparedNextProgressCursor:
    | DeclarativeV2VerifierProgressFrameEncoderCursorV2
    | undefined;
  outputManifestPlanningCursor:
    | DeclarativeV2VerifierProgressFrameEncoderCursorV2
    | undefined;
  readonly modules: OwnedModule[];
  pendingModule: PendingModule | undefined;
  moduleIndex: number;
  accumulationStage: "sizing" | "sealing" | "copying" | "admitting";
  sealStage:
    | "deriveNextProgress"
    | "createCurrentProgress"
    | "createNextProgress"
    | "createOutputManifestPlan"
    | "closeOutputManifestPlan"
    | "planEvidence"
    | "planEvidenceHash"
    | "planDiagnosticsHash"
    | "planNextProgressHash"
    | "assembleRequired"
    | "complete";
  admissionStage:
    | "validateSourceTotal"
    | "validatePlan"
    | "createArena"
    | "complete";
  terminal: "accumulating" | "ready" | "finishing" | "complete" | "closed";
  aggregateTransitions: bigint;
  totalPathBytes: bigint;
  totalDeclaredSourceBytes: bigint;
  required: DeclarativeV2VerifierBudgetFrameV2 | undefined;
  actual: MutableUsage;
  nextProgress: DeclarativeV2VerifierProgressCursorFrameV2 | undefined;
  outputManifest: DeclarativeV2VerifierCommandOutputManifestFrameV2 | undefined;
  currentProgressPlan: MeasuredFrame | undefined;
  nextProgressPlan: MeasuredFrame | undefined;
  outputManifestPlan: MeasuredFrame | undefined;
  evidenceByteLength: number | undefined;
  evidenceHashPlan: DeclarativeV2VerifierSha256WorkV1 | undefined;
  diagnosticsHashPlan: DeclarativeV2VerifierSha256WorkV1 | undefined;
  nextProgressHashPlan: DeclarativeV2VerifierSha256WorkV1 | undefined;
  evidenceBytes: Uint8Array | undefined;
  nextProgressBytes: Uint8Array | undefined;
  nextProgressSha256: Uint8Array | undefined;
  outputManifestBytes: Uint8Array | undefined;
  evidenceRootSha256: Uint8Array | undefined;
  diagnosticsRootSha256: Uint8Array | undefined;
  hashState: HashState | undefined;
  arena: DeclarativeV2VerifierRuntimeArenaHandleV1 | undefined;
  finishStage:
    | "allocateEvidence"
    | "emitEvidence"
    | "hashEvidence"
    | "hashDiagnostics"
    | "encodeNextProgress"
    | "hashNextProgress"
    | "encodeManifest"
    | "publish";
  evidenceOffset: number;
  evidencePart: number;
  evidencePartOffset: number;
  evidenceParts: ReadonlyArray<EvidencePart> | undefined;
}

type EvidencePart =
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  | { readonly kind: "progress" }
  | { readonly kind: "byte"; readonly value: number }
  | { readonly kind: "u32"; readonly value: number }
  | { readonly kind: "u64"; readonly value: bigint }
  | {
    readonly kind: "path";
    readonly factory: DeclarativeV2ArtifactModulePathFactoryV1;
    readonly handle: DeclarativeV2ArtifactModulePathHandleV1;
    readonly byteLength: number;
  };

interface CapturedInput {
  readonly bindings: DeclarativeV2VerifierSourcePageBindingsV1;
  readonly sequence: bigint;
  readonly currentProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly predecessorReceiptSha256: Uint8Array | null;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
  readonly range: DeclarativeV2VerifierSourcePageRangeV1;
}

const issue = (
  operation: DeclarativeV2VerifierSourcePageV1Error["operation"],
  reason: DeclarativeV2VerifierSourcePageV1Error["reason"],
  path?: string,
  observed?: bigint,
  maximum?: bigint,
): DeclarativeV2VerifierSourcePageV1Error =>
  new DeclarativeV2VerifierSourcePageV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });

export function makeDeclarativeV2VerifierSourcePageFactoryV1():
  DeclarativeV2VerifierSourcePageFactoryV1 {
  const owned = new WeakMap<object, DriverState>();
  const frameEncoderFactory =
    makeDeclarativeV2VerifierProgressFrameEncoderFactoryV2();

  const create = (
    rawInput: unknown,
    rawExpectedBindings: unknown,
  ): Result.Result<
    DeclarativeV2VerifierSourcePageDriverV1,
    DeclarativeV2VerifierSourcePageV1Error
  > => Result.gen(function*() {
    const captured = yield* captureInput(rawInput, rawExpectedBindings);
    const moduleCount = Number(captured.input.range.moduleCount);
    if (
      !Number.isSafeInteger(moduleCount) ||
      moduleCount < 1 ||
      moduleCount > MAXIMUM_MODULES ||
      captured.modules.length !== moduleCount
    ) {
      const exceedsMaximum = moduleCount > MAXIMUM_MODULES;
      return yield* Result.fail(issue(
        "create",
        exceedsMaximum
          ? "addressabilityExceeded"
          : "rangeMismatch",
        "modules.length",
        exceedsMaximum
          ? captured.input.range.moduleCount
          : BigInt(captured.modules.length),
        exceedsMaximum
          ? BigInt(MAXIMUM_MODULES)
          : captured.input.range.moduleCount,
      ));
    }
    const handle = Object.freeze({
      _tag: "DeclarativeV2VerifierSourcePageDriverV1",
    }) satisfies DeclarativeV2VerifierSourcePageDriverV1;
    owned.set(handle, {
      input: captured.input,
      borrowedModules: captured.modules,
      capturedModules: [],
      pathFactory: makeDeclarativeV2ArtifactModulePathFactoryV1(),
      frameEncoderFactory,
      activeProtocolFrame: undefined,
      preparedCurrentProgressCursor: undefined,
      preparedNextProgressCursor: undefined,
      outputManifestPlanningCursor: undefined,
      modules: [],
      pendingModule: undefined,
      moduleIndex: 0,
      accumulationStage: "sizing",
      sealStage: "deriveNextProgress",
      admissionStage: "validateSourceTotal",
      terminal: "accumulating",
      aggregateTransitions: 0n,
      totalPathBytes: 0n,
      totalDeclaredSourceBytes: 0n,
      required: undefined,
      actual: mutableZeroUsage(),
      nextProgress: undefined,
      outputManifest: undefined,
      currentProgressPlan: undefined,
      nextProgressPlan: undefined,
      outputManifestPlan: undefined,
      evidenceByteLength: undefined,
      evidenceHashPlan: undefined,
      diagnosticsHashPlan: undefined,
      nextProgressHashPlan: undefined,
      evidenceBytes: undefined,
      nextProgressBytes: undefined,
      nextProgressSha256: undefined,
      outputManifestBytes: undefined,
      evidenceRootSha256: undefined,
      diagnosticsRootSha256: undefined,
      hashState: undefined,
      arena: undefined,
      finishStage: "allocateEvidence",
      evidenceOffset: 0,
      evidencePart: 0,
      evidencePartOffset: 0,
      evidenceParts: undefined,
    });
    return handle;
  });

  const step = (
    rawDriver: unknown,
    rawAllowance: unknown,
  ): Result.Result<
    DeclarativeV2VerifierSourcePagePendingV1 |
      DeclarativeV2VerifierSourcePageReadyV1,
    DeclarativeV2VerifierSourcePageV1Error
  > => {
    const stateResult = driverState(owned, rawDriver, "step");
    if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
    const state = stateResult.success;
    const allowance = captureAllowance(rawAllowance, state, "step");
    if (Result.isFailure(allowance)) return Result.fail(allowance.failure);
    if (state.terminal !== "accumulating") {
      return state.terminal === "ready"
        ? Result.succeed(readyReceipt(state, 0))
        : failTerminal(state, issue("step", "closed"));
    }
    let remaining = allowance.success;
    const before = state.aggregateTransitions;
    while (remaining > 0) {
      let advanced: Result.Result<
        void,
        DeclarativeV2VerifierSourcePageV1Error
      >;
      try {
        advanced = state.accumulationStage === "sizing"
          ? advanceSizing(state)
          : state.accumulationStage === "sealing"
          ? advanceSeal(state)
          : state.accumulationStage === "copying"
          ? advanceModule(state)
          : advanceAdmission(state);
      } catch (defect) {
        state.terminal = "closed";
        releaseInternalAuthority(state);
        throw defect;
      }
      if (Result.isFailure(advanced)) {
        return failTerminal(state, advanced.failure);
      }
      remaining -= 1;
      state.aggregateTransitions += 1n;
      if (
        state.accumulationStage === "sizing" &&
        state.moduleIndex === requiredBorrowedModules(state).length
      ) {
        state.borrowedModules = undefined;
        state.accumulationStage = "sealing";
        state.moduleIndex = 0;
        continue;
      }
      if (
        state.accumulationStage === "sealing" &&
        state.sealStage === "complete"
      ) {
        state.accumulationStage = "copying";
        state.moduleIndex = 0;
        continue;
      }
      if (
        state.accumulationStage === "copying" &&
        state.moduleIndex === state.capturedModules.length &&
        state.pendingModule === undefined
      ) {
        state.accumulationStage = "admitting";
        continue;
      }
      if (
        state.accumulationStage === "admitting" &&
        state.admissionStage === "complete"
      ) {
        state.capturedModules.length = 0;
        state.terminal = "ready";
        return Result.succeed(
          readyReceipt(state, Number(state.aggregateTransitions - before)),
        );
      }
    }
    return Result.succeed(
      pendingReceipt(state, Number(state.aggregateTransitions - before)),
    );
  };

  const finish = (
    rawDriver: unknown,
    rawAllowance: unknown,
  ): Result.Result<
    DeclarativeV2VerifierSourcePagePendingV1 |
      DeclarativeV2VerifierSourcePageCompleteV1,
    DeclarativeV2VerifierSourcePageV1Error
  > => {
    const stateResult = driverState(owned, rawDriver, "finish");
    if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
    const state = stateResult.success;
    const allowance = captureAllowance(rawAllowance, state, "finish");
    if (Result.isFailure(allowance)) return Result.fail(allowance.failure);
    if (state.terminal === "accumulating") {
      return failTerminal(state, issue(
        "finish",
        "invalidTransition",
        "driver.notReady",
      ));
    }
    if (state.terminal !== "ready" && state.terminal !== "finishing") {
      return failTerminal(state, issue("finish", "closed"));
    }
    state.terminal = "finishing";
    let remaining = allowance.success;
    const before = state.aggregateTransitions;
    while (remaining > 0) {
      let advanced: ReturnType<typeof advanceFinish>;
      try {
        advanced = advanceFinish(state, remaining);
      } catch (defect) {
        state.terminal = "closed";
        releaseInternalAuthority(state);
        throw defect;
      }
      if (Result.isFailure(advanced)) {
        return failTerminal(state, advanced.failure);
      }
      if ("complete" in advanced.success) {
        state.terminal = "complete";
        releaseInternalAuthority(state);
        return Result.succeed(Object.freeze({
          ...advanced.success.complete,
          receipt: Object.freeze({
            deltaTransitions: Number(state.aggregateTransitions - before),
            aggregateTransitions: state.aggregateTransitions,
          }),
        }));
      }
      if (advanced.success.used === 0) break;
      remaining -= advanced.success.used;
      state.aggregateTransitions += BigInt(advanced.success.used);
    }
    return Result.succeed(
      pendingReceipt(state, Number(state.aggregateTransitions - before)),
    );
  };

  const close = (
    rawDriver: unknown,
  ): Result.Result<void, DeclarativeV2VerifierSourcePageV1Error> => {
    const stateResult = driverState(owned, rawDriver, "close");
    if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
    const state = stateResult.success;
    if (state.terminal === "closed" || state.terminal === "complete") {
      return Result.fail(issue("close", "closed"));
    }
    state.terminal = "closed";
    releaseInternalAuthority(state);
    return Result.succeed(undefined);
  };

  return Object.freeze({ create, step, finish, close });
}

function advanceSizing(
  state: DriverState,
): Result.Result<void, DeclarativeV2VerifierSourcePageV1Error> {
  return Result.gen(function*() {
    chargeCall(state);
    const input = requiredInput(state);
    const captured = yield* captureModule(
      borrowedModuleAt(requiredBorrowedModules(state), state.moduleIndex),
      state.moduleIndex,
      input.range.firstModuleOrdinal,
    );
    const totalPathBytes = checkedAdd(
      state.totalPathBytes,
      BigInt(captured.modulePathByteLength),
    );
    if (totalPathBytes === undefined) {
      return yield* Result.fail(
        issue("step", "overflow", "modules.modulePathBytes"),
      );
    }
    state.totalPathBytes = totalPathBytes;
    state.capturedModules.push(captured);
    state.moduleIndex += 1;
  });
}

function advanceModule(
  state: DriverState,
): Result.Result<void, DeclarativeV2VerifierSourcePageV1Error> {
  chargeCall(state);
  if (state.pendingModule === undefined) {
    state.pendingModule = state.capturedModules[state.moduleIndex];
    if (state.pendingModule === undefined) {
      throw new Error("Admitted source-page module plan lost its metadata.");
    }
  }
  const pending = state.pendingModule;
  const pathLength = pending.modulePathByteLength;
  const pathFactory = requiredPathFactory(state);
  switch (pending.copyStage) {
    case "start":
      pending.copyStage = "createPath";
      return Result.succeed(undefined);
    case "createPath": {
      const validator = pathFactory.create(
        pathLength + 2,
        pathLength,
        pathLength,
      );
      if (Result.isFailure(validator)) {
        return Result.fail(issue(
          "step",
          validator.failure.reason === "addressabilityExceeded"
            ? "addressabilityExceeded"
            : "invalidInput",
          `modules.${state.moduleIndex}.modulePathBytes`,
        ));
      }
      pending.pathValidator = validator.success;
      pending.copyStage = "copyPath";
      return Result.succeed(undefined);
    }
    case "copyPath": {
      if (pending.copyOffset === pathLength) {
        pending.copyOffset = 0;
        pending.copyStage = "finishPath";
        return Result.succeed(undefined);
      }
      const byte = borrowedByteSlice(
        pending.borrowedPath,
        pending.copyOffset,
        pathLength,
      );
      if (byte === undefined) {
        return Result.fail(issue(
          "step",
          "invalidInput",
          `modules.${state.moduleIndex}.modulePathBytes`,
        ));
      }
      const stepped = pathFactory.step(
        pending.pathValidator,
        byte,
        1,
      );
      if (Result.isFailure(stepped)) {
        return Result.fail(issue(
          "step",
          "invalidInput",
          `modules.${state.moduleIndex}.modulePathBytes`,
        ));
      }
      if (
        stepped.success.consumedBytes !== 1 ||
        stepped.success.transitionCount !== 1
      ) {
        throw new Error("Accepted module-path validator made no progress.");
      }
      pending.copyOffset += 1;
      return Result.succeed(undefined);
    }
    case "finishPath": {
      const finished = pathFactory.finish(pending.pathValidator, 1);
      if (Result.isFailure(finished) || "status" in finished.success) {
        return Result.fail(issue(
          "step",
          "invalidInput",
          `modules.${state.moduleIndex}.modulePathBytes`,
        ));
      }
      pending.modulePath = finished.success;
      pending.copyStage = "allocateFrameDigest";
      return Result.succeed(undefined);
    }
    case "allocateFrameDigest": {
      const borrowed = captureDigestView(pending.rawFrameSha256);
      if (borrowed === undefined) {
        return Result.fail(issue(
          "step",
          "invalidInput",
          `modules.${state.moduleIndex}.frameSha256`,
        ));
      }
      pending.rawFrameSha256 = borrowed;
      pending.frameSha256 = new Uint8Array(SHA256_BYTES);
      pending.copyStage = "copyFrameDigest";
      return Result.succeed(undefined);
    }
    case "copyFrameDigest": {
      if (pending.copyOffset === SHA256_BYTES) {
        pending.copyOffset = 0;
        pending.rawFrameSha256 = undefined;
        pending.copyStage = "allocateSourceDigest";
        return Result.succeed(undefined);
      }
      const byte = borrowedByteAt(
        pending.rawFrameSha256,
        pending.copyOffset,
        SHA256_BYTES,
      );
      if (byte === undefined) {
        return Result.fail(issue(
          "step",
          "invalidInput",
          `modules.${state.moduleIndex}.frameSha256`,
        ));
      }
      pending.frameSha256![pending.copyOffset] = byte;
      pending.copyOffset += 1;
      return Result.succeed(undefined);
    }
    case "allocateSourceDigest": {
      const borrowed = captureDigestView(pending.rawSourceSha256);
      if (borrowed === undefined) {
        return Result.fail(issue(
          "step",
          "invalidInput",
          `modules.${state.moduleIndex}.sourceSha256`,
        ));
      }
      pending.rawSourceSha256 = borrowed;
      pending.sourceSha256 = new Uint8Array(SHA256_BYTES);
      pending.copyStage = "copySourceDigest";
      return Result.succeed(undefined);
    }
    case "copySourceDigest": {
      if (pending.copyOffset === SHA256_BYTES) {
        pending.copyOffset = 0;
        pending.rawSourceSha256 = undefined;
        pending.copyStage = "finish";
        return Result.succeed(undefined);
      }
      const byte = borrowedByteAt(
        pending.rawSourceSha256,
        pending.copyOffset,
        SHA256_BYTES,
      );
      if (byte === undefined) {
        return Result.fail(issue(
          "step",
          "invalidInput",
          `modules.${state.moduleIndex}.sourceSha256`,
        ));
      }
      pending.sourceSha256![pending.copyOffset] = byte;
      pending.copyOffset += 1;
      return Result.succeed(undefined);
    }
    case "finish": {
      const sourceByteLength = signedInt64(
        pending.rawSourceByteLength,
        `modules.${state.moduleIndex}.sourceByteLength`,
        true,
        "step",
      );
      if (Result.isFailure(sourceByteLength)) {
        return Result.fail(sourceByteLength.failure);
      }
      const totalSourceBytes = checkedAdd(
        state.totalDeclaredSourceBytes,
        sourceByteLength.success,
      );
      if (totalSourceBytes === undefined) {
        return Result.fail(issue(
          "step",
          "overflow",
          "range.sourceByteLength",
        ));
      }
      state.totalDeclaredSourceBytes = totalSourceBytes;
      state.actual.tableBytes +=
        MODULE_FIXED_TABLE_BYTES + BigInt(pathLength);
      state.actual.stringBytes += BigInt(pathLength);
      state.actual.modules += 1n;
      state.actual.graphNodes += 1n;
      state.actual.frontierEntries = 1n;
      state.modules.push(Object.freeze({
        moduleOrdinal: pending.moduleOrdinal,
        roles: pending.roles,
        modulePathByteLength: pathLength,
        modulePath: pending.modulePath!,
        frameSha256: pending.frameSha256!,
        sourceSha256: pending.sourceSha256!,
        sourceByteLength: sourceByteLength.success,
      }));
      pending.borrowedPath = undefined;
      pending.rawFrameSha256 = undefined;
      pending.rawSourceSha256 = undefined;
      pending.pathValidator = undefined;
      pending.modulePath = undefined;
      pending.frameSha256 = undefined;
      pending.sourceSha256 = undefined;
      state.pendingModule = undefined;
      state.moduleIndex += 1;
      return Result.succeed(undefined);
    }
  }
}

function advanceSeal(
  state: DriverState,
): Result.Result<void, DeclarativeV2VerifierSourcePageV1Error> {
  chargeCall(state);
  const input = requiredInput(state);
  const frameEncoderFactory = requiredFrameEncoderFactory(state);
  switch (state.sealStage) {
    case "deriveNextProgress":
      return deriveNextProgress(input).pipe(Result.map(nextProgress => {
        state.nextProgress = nextProgress;
        state.sealStage = "createCurrentProgress";
      }));
    case "createCurrentProgress": {
      const prepared = prepareFrame(
        frameEncoderFactory,
        input.currentProgress,
      );
      state.currentProgressPlan = prepared.plan;
      state.preparedCurrentProgressCursor = prepared.cursor;
      state.sealStage = "createNextProgress";
      return Result.succeed(undefined);
    }
    case "createNextProgress": {
      const prepared = prepareFrame(
        frameEncoderFactory,
        state.nextProgress,
      );
      state.nextProgressPlan = prepared.plan;
      state.preparedNextProgressCursor = prepared.cursor;
      state.sealStage = "createOutputManifestPlan";
      return Result.succeed(undefined);
    }
    case "createOutputManifestPlan": {
      const dummyDigest = new Uint8Array(SHA256_BYTES);
      const dummyManifest = Object.freeze({
        kind: "command_output_manifest",
        reservationSha256: input.bindings.reservationSha256,
        commandKind: "source_page",
        sequence: input.sequence,
        evidenceRootSha256: dummyDigest,
        evidenceCount: input.range.moduleCount,
        diagnosticsRootSha256: dummyDigest,
        diagnosticCount: 0n,
        nextProgressSha256: dummyDigest,
      }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
      const prepared = prepareFrame(frameEncoderFactory, dummyManifest);
      state.outputManifestPlan = prepared.plan;
      state.outputManifestPlanningCursor = prepared.cursor;
      state.sealStage = "closeOutputManifestPlan";
      return Result.succeed(undefined);
    }
    case "closeOutputManifestPlan": {
      const cursor = state.outputManifestPlanningCursor;
      if (cursor === undefined) {
        throw new Error("Source-page output-manifest plan cursor was lost.");
      }
      const closed = frameEncoderFactory.close(cursor);
      if (Result.isFailure(closed)) {
        throw new Error("Source-page output-manifest plan could not close.");
      }
      state.outputManifestPlanningCursor = undefined;
      state.sealStage = "planEvidence";
      return Result.succeed(undefined);
    }
    case "planEvidence":
      return checkedEvidenceLength(
        state.totalPathBytes,
        input.range.moduleCount,
        state.currentProgressPlan!.canonicalByteLength,
        input.predecessorReceiptSha256 !== null,
      ).pipe(Result.map(evidenceByteLength => {
        state.evidenceByteLength = evidenceByteLength;
        state.sealStage = "planEvidenceHash";
      }));
    case "planEvidenceHash":
      return mapShaPlan(
        requiredEvidenceByteLength(state),
        "evidenceBytes",
      ).pipe(Result.map(plan => {
        state.evidenceHashPlan = plan;
        state.sealStage = "planDiagnosticsHash";
      }));
    case "planDiagnosticsHash":
      return mapShaPlan(0, "diagnosticBytes").pipe(Result.map(plan => {
        state.diagnosticsHashPlan = plan;
        state.sealStage = "planNextProgressHash";
      }));
    case "planNextProgressHash":
      return mapShaPlan(
        state.nextProgressPlan!.canonicalByteLength,
        "nextProgress",
      ).pipe(Result.map(plan => {
        state.nextProgressHashPlan = plan;
        state.sealStage = "assembleRequired";
      }));
    case "assembleRequired": {
      const evidenceLength = requiredEvidenceByteLength(state);
      const currentProgressPlan = state.currentProgressPlan!;
      const nextProgressPlan = state.nextProgressPlan!;
      const outputManifestPlan = state.outputManifestPlan!;
      const evidenceHash = requiredEvidenceHashPlan(state);
      const diagnosticsHash = requiredDiagnosticsHashPlan(state);
      const nextProgressHash = requiredNextProgressHashPlan(state);
      const evidenceCustomWrites =
        evidenceLength - currentProgressPlan.canonicalByteLength;
      const copyCalls = checkedAdd(
        state.totalPathBytes,
        input.range.moduleCount * MODULE_FIXED_DRIVER_TRANSITIONS,
      );
      const calls = copyCalls === undefined ? undefined : checkedSum([
        input.range.moduleCount,
        SEAL_DRIVER_TRANSITIONS,
        ADMISSION_DRIVER_TRANSITIONS,
        copyCalls,
        FINISH_FIXED_DRIVER_TRANSITIONS,
        BigInt(evidenceCustomWrites),
        BigInt(currentProgressPlan.successfulWork.primitiveTransitions),
        evidenceHash.transitions,
        diagnosticsHash.transitions,
        BigInt(nextProgressPlan.successfulWork.primitiveTransitions),
        nextProgressHash.transitions,
        BigInt(outputManifestPlan.successfulWork.primitiveTransitions),
      ]);
      const canonicalBytes = checkedSum([
        BigInt(evidenceLength),
        BigInt(nextProgressPlan.canonicalByteLength),
        BigInt(outputManifestPlan.canonicalByteLength),
      ]);
      const frameBytes = [
        BigInt(evidenceLength),
        BigInt(nextProgressPlan.canonicalByteLength),
        BigInt(outputManifestPlan.canonicalByteLength),
      ].reduce((maximum, value) => value > maximum ? value : maximum, 0n);
      const hashBytes = checkedSum([
        evidenceHash.hashBytes,
        diagnosticsHash.hashBytes,
        nextProgressHash.hashBytes,
      ]);
      if (
        calls === undefined ||
        canonicalBytes === undefined ||
        hashBytes === undefined
      ) {
        return Result.fail(issue("step", "overflow", "required"));
      }
      const tableBytes = checkedAdd(
        state.totalPathBytes,
        input.range.moduleCount * MODULE_FIXED_TABLE_BYTES,
      );
      if (tableBytes === undefined) {
        return Result.fail(issue("step", "overflow", "tableBytes"));
      }
      state.required = Object.freeze({
        kind: "attempt_usage",
        calls,
        objectCalls: 0n,
        objectBodyBytes: 0n,
        sourceBytes: 0n,
        sourceMapBytes: 0n,
        semanticBytes: 0n,
        modules: input.range.moduleCount,
        importEdges: 0n,
        exports: 0n,
        functions: 0n,
        tokens: 0n,
        tokenBytes: 0n,
        parserStates: 0n,
        nestingDepth: 0n,
        schemaNodes: 0n,
        validatorNodes: 0n,
        graphNodes: input.range.moduleCount,
        frontierEntries: 1n,
        stringBytes: state.totalPathBytes,
        tableBytes,
        canonicalBytes,
        frameBytes,
        hashBytes,
        diagnosticBytes: 0n,
        outputBytes: canonicalBytes,
        elapsedMilliseconds: 0n,
      });
      state.sealStage = "complete";
      return Result.succeed(undefined);
    }
    case "complete":
      throw new Error("Source-page seal completed twice.");
  }
}

function advanceAdmission(
  state: DriverState,
): Result.Result<void, DeclarativeV2VerifierSourcePageV1Error> {
  chargeCall(state);
  const input = requiredInput(state);
  const required = requiredState(state);
  switch (state.admissionStage) {
    case "validateSourceTotal":
      if (state.totalDeclaredSourceBytes !== input.range.sourceByteLength) {
        return Result.fail(issue(
          "step",
          "rangeMismatch",
          "range.sourceByteLength",
          state.totalDeclaredSourceBytes,
          input.range.sourceByteLength,
        ));
      }
      state.admissionStage = "validatePlan";
      return Result.succeed(undefined);
    case "validatePlan":
      if (
        required.canonicalBytes > MAX_U32 ||
        required.tableBytes > MAX_U32 ||
        required.frameBytes > MAX_U32
      ) {
        return Result.fail(issue(
          "step",
          "addressabilityExceeded",
          "requiredBytes",
        ));
      }
      for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
        if (required[dimension] > input.commandBudget[dimension]) {
          return Result.fail(issue(
            "step",
            "budgetExceeded",
            dimension,
            required[dimension],
            input.commandBudget[dimension],
          ));
        }
      }
      state.admissionStage = "createArena";
      return Result.succeed(undefined);
    case "createArena": {
      const arena = createDeclarativeV2VerifierRuntimeArenaV1({
        requiredBytes: 0,
        regions: Object.freeze([]),
        usage: required,
      });
      if (Result.isFailure(arena)) {
        return Result.fail(issue(
          "step",
          arena.failure.reason === "addressabilityExceeded"
            ? "addressabilityExceeded"
            : "invalidInput",
          "arena",
        ));
      }
      state.arena = arena.success;
      state.admissionStage = "complete";
      return Result.succeed(undefined);
    }
    case "complete":
      throw new Error("Source-page admission completed twice.");
  }
}

function advanceFinish(
  state: DriverState,
  allowance: number,
): Result.Result<
  { readonly used: number } | {
    readonly complete: Omit<
      DeclarativeV2VerifierSourcePageCompleteV1,
      "receipt"
    >;
  },
  DeclarativeV2VerifierSourcePageV1Error
> {
  const required = requiredState(state);
  switch (state.finishStage) {
    case "allocateEvidence": {
      if (allowance < 1) return Result.succeed({ used: 0 });
      const byteLength = Number(
        required.canonicalBytes -
          BigInt(state.nextProgressPlan!.canonicalByteLength) -
          BigInt(state.outputManifestPlan!.canonicalByteLength),
      );
      try {
        state.evidenceBytes = new Uint8Array(byteLength);
        state.evidenceParts = evidenceParts(state);
      } catch {
        return Result.fail(issue(
          "finish",
          "addressabilityExceeded",
          "evidenceBytes",
        ));
      }
      state.finishStage = "emitEvidence";
      chargeCall(state);
      return Result.succeed({ used: 1 });
    }
    case "emitEvidence":
      return emitEvidence(state, allowance);
    case "hashEvidence":
      return advanceHashStage(state, "evidence", allowance);
    case "hashDiagnostics":
      return advanceHashStage(state, "diagnostics", allowance);
    case "encodeNextProgress":
      return encodeNextProgress(state, allowance);
    case "hashNextProgress":
      return advanceHashStage(state, "nextProgress", allowance);
    case "encodeManifest":
      return encodeManifest(state, allowance);
    case "publish": {
      if (allowance < 1) return Result.succeed({ used: 0 });
      chargeCall(state);
      state.aggregateTransitions += 1n;
      if (!usageEquals(state.actual, required)) {
        throw new Error(
          "Accepted source-page driver usage disagreed with its exact plan.",
        );
      }
      if (
        state.nextProgress === undefined ||
        state.nextProgressBytes === undefined ||
        state.outputManifest === undefined ||
        state.outputManifestBytes === undefined ||
        state.evidenceBytes === undefined ||
        state.evidenceRootSha256 === undefined ||
        state.diagnosticsRootSha256 === undefined
      ) {
        throw new Error("Accepted source-page driver reached an incomplete terminal.");
      }
      return Result.succeed({
        complete: Object.freeze({
          status: "complete",
          required,
          actual: frozenUsage(state.actual),
          nextProgress: state.nextProgress,
          nextProgressBytes: state.nextProgressBytes,
          outputManifest: state.outputManifest,
          outputManifestBytes: state.outputManifestBytes,
          evidenceBytes: state.evidenceBytes,
          diagnosticBytes: new Uint8Array(0),
          evidenceRootSha256: state.evidenceRootSha256,
          diagnosticsRootSha256: state.diagnosticsRootSha256,
        }),
      });
    }
  }
}

function emitEvidence(
  state: DriverState,
  allowance: number,
): Result.Result<
  { readonly used: number },
  DeclarativeV2VerifierSourcePageV1Error
> {
  const output = state.evidenceBytes!;
  const parts = state.evidenceParts!;
  let used = 0;
  while (used < allowance && state.evidencePart < parts.length) {
    const part = parts[state.evidencePart]!;
    if (part.kind === "progress") {
      const encoded = advanceProtocolFrame(
        state,
        "currentProgress",
        requiredInput(state).currentProgress,
        state.currentProgressPlan!,
        allowance - used,
        plan => Result.succeed(Object.freeze({
          bytes: output,
          byteOffset: state.evidenceOffset,
          byteLength: plan.canonicalByteLength,
        })),
      );
      if (Result.isFailure(encoded)) return Result.fail(encoded.failure);
      used += encoded.success.used;
      if (encoded.success.destination === undefined) break;
      state.evidenceOffset += encoded.success.byteLength!;
      state.evidencePart += 1;
      state.evidencePartOffset = 0;
      continue;
    }
    output[state.evidenceOffset] = evidencePartByteAt(
      part,
      state.evidencePartOffset,
    );
    state.evidenceOffset += 1;
    state.evidencePartOffset += 1;
    used += 1;
    chargeCall(state);
    if (state.evidencePartOffset === evidencePartByteLength(part)) {
      state.evidencePart += 1;
      state.evidencePartOffset = 0;
    }
  }
  if (state.evidencePart === parts.length) {
    if (state.evidenceOffset !== output.byteLength) {
      throw new Error("Accepted source-page evidence length disagreed with its plan.");
    }
    state.actual.canonicalBytes += BigInt(output.byteLength);
    state.actual.frameBytes = maximumBigInt(
      state.actual.frameBytes,
      BigInt(output.byteLength),
    );
    state.actual.outputBytes += BigInt(output.byteLength);
    state.finishStage = "hashEvidence";
  }
  return Result.succeed({ used });
}

function advanceHashStage(
  state: DriverState,
  role: "evidence" | "diagnostics" | "nextProgress",
  allowance: number,
): Result.Result<{ readonly used: number }, DeclarativeV2VerifierSourcePageV1Error> {
  const bytes = role === "evidence"
    ? state.evidenceBytes!
    : role === "diagnostics"
    ? EMPTY_BYTES
    : state.nextProgressBytes!;
  if (state.hashState === undefined) {
    const hash = createDeclarativeV2VerifierRuntimeSha256V1(state.arena);
    if (Result.isFailure(hash)) {
      throw new Error("Accepted source-page hash arena rejected a hash handle.");
    }
    state.hashState = {
      bytes,
      hash: hash.success,
      offset: 0,
      finishing: bytes.byteLength === 0,
    };
  }
  const hashState = state.hashState;
  let used = 0;
  let completed: Uint8Array | undefined;
  if (!hashState.finishing) {
    const suffix = Reflect.apply(
      UINT8_ARRAY_SUBARRAY,
      hashState.bytes,
      [hashState.offset, hashState.bytes.byteLength],
    ) as Uint8Array;
    const stepped = stepDeclarativeV2VerifierRuntimeSha256V1(
      hashState.hash,
      suffix,
      allowance,
    );
    if (Result.isFailure(stepped)) {
      throw new Error("Accepted source-page hash input contradicted its plan.");
    }
    const consumed = Number(stepped.success.receipt.delta.consumedBytes);
    const transitions = Number(stepped.success.receipt.delta.transitions);
    hashState.offset += consumed;
    state.actual.calls += BigInt(transitions);
    used += transitions;
    if (hashState.offset === hashState.bytes.byteLength) {
      hashState.finishing = true;
    }
  } else {
    const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
      hashState.hash,
      allowance,
    );
    if (Result.isFailure(finished)) {
      throw new Error("Accepted source-page hash terminal contradicted its plan.");
    }
    const transitions = Number(finished.success.receipt.delta.transitions);
    state.actual.calls += BigInt(transitions);
    used += transitions;
    if (finished.success.status === "complete") {
      completed = finished.success.digest;
    }
  }
  if (completed !== undefined) {
    state.actual.hashBytes += BigInt(bytes.byteLength);
    if (role === "evidence") {
      state.evidenceRootSha256 = completed;
      state.finishStage = "hashDiagnostics";
    } else if (role === "diagnostics") {
      state.diagnosticsRootSha256 = completed;
      state.finishStage = "encodeNextProgress";
    } else {
      state.nextProgressSha256 = completed;
      state.finishStage = "encodeManifest";
    }
    state.hashState = undefined;
  }
  return Result.succeed({ used });
}

function encodeNextProgress(
  state: DriverState,
  allowance: number,
): Result.Result<{ readonly used: number }, DeclarativeV2VerifierSourcePageV1Error> {
  const plan = state.nextProgressPlan!;
  const encoded = advanceProtocolFrame(
    state,
    "nextProgress",
    state.nextProgress,
    plan,
    allowance,
    observed => {
      try {
        const bytes = new Uint8Array(observed.canonicalByteLength);
        return Result.succeed(Object.freeze({
          bytes,
          byteOffset: 0,
          byteLength: bytes.byteLength,
        }));
      } catch {
        return Result.fail(issue(
          "finish",
          "addressabilityExceeded",
          "nextProgress",
        ));
      }
    },
  );
  if (Result.isFailure(encoded)) return Result.fail(encoded.failure);
  const bytes = encoded.success.destination;
  if (bytes === undefined) return Result.succeed({ used: encoded.success.used });
  state.nextProgressBytes = bytes;
  state.actual.canonicalBytes += BigInt(bytes.byteLength);
  state.actual.frameBytes = maximumBigInt(
    state.actual.frameBytes,
    BigInt(bytes.byteLength),
  );
  state.actual.outputBytes += BigInt(bytes.byteLength);
  state.finishStage = "hashNextProgress";
  return Result.succeed({ used: encoded.success.used });
}

function encodeManifest(
  state: DriverState,
  allowance: number,
): Result.Result<{ readonly used: number }, DeclarativeV2VerifierSourcePageV1Error> {
  const plan = state.outputManifestPlan!;
  const nextProgressSha256 = state.hashState === undefined
    ? state.nextProgressSha256
    : undefined;
  if (nextProgressSha256 === undefined) {
    throw new Error("Accepted next-progress hash was not retained.");
  }
  const manifest = Object.freeze({
    kind: "command_output_manifest",
    reservationSha256: requiredInput(state).bindings.reservationSha256,
    commandKind: "source_page",
    sequence: requiredInput(state).sequence,
    evidenceRootSha256: state.evidenceRootSha256!,
    evidenceCount: requiredInput(state).range.moduleCount,
    diagnosticsRootSha256: state.diagnosticsRootSha256!,
    diagnosticCount: 0n,
    nextProgressSha256,
  }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
  const encoded = advanceProtocolFrame(
    state,
    "outputManifest",
    manifest,
    plan,
    allowance,
    observed => {
      try {
        const bytes = new Uint8Array(observed.canonicalByteLength);
        return Result.succeed(Object.freeze({
          bytes,
          byteOffset: 0,
          byteLength: bytes.byteLength,
        }));
      } catch {
        return Result.fail(issue(
          "finish",
          "addressabilityExceeded",
          "outputManifest",
        ));
      }
    },
  );
  if (Result.isFailure(encoded)) return Result.fail(encoded.failure);
  const bytes = encoded.success.destination;
  if (bytes === undefined) return Result.succeed({ used: encoded.success.used });
  state.outputManifest = manifest;
  state.outputManifestBytes = bytes;
  state.actual.canonicalBytes += BigInt(bytes.byteLength);
  state.actual.frameBytes = maximumBigInt(
    state.actual.frameBytes,
    BigInt(bytes.byteLength),
  );
  state.actual.outputBytes += BigInt(bytes.byteLength);
  state.finishStage = "publish";
  return Result.succeed({ used: encoded.success.used });
}

function advanceProtocolFrame(
  state: DriverState,
  role: ProtocolFrameRole,
  frame: unknown,
  expectedPlan: MeasuredFrame,
  allowance: number,
  destination: (
    plan: DeclarativeV2VerifierProgressFrameEncodingPlanV2,
  ) => Result.Result<
    Readonly<{
      readonly bytes: Uint8Array;
      readonly byteOffset: number;
      readonly byteLength: number;
    }>,
    DeclarativeV2VerifierSourcePageV1Error
  >,
): Result.Result<
  Readonly<{
    readonly used: number;
    readonly destination?: Uint8Array;
    readonly byteLength?: number;
  }>,
  DeclarativeV2VerifierSourcePageV1Error
> {
  const factory = requiredFrameEncoderFactory(state);
  let active = state.activeProtocolFrame;
  if (active === undefined) {
    const prepared = takePreparedFrameCursor(state, role);
    if (prepared !== undefined) {
      active = {
        role,
        cursor: prepared,
        phase: "created",
        destination: undefined,
        byteOffset: undefined,
        byteLength: undefined,
      };
      state.activeProtocolFrame = active;
    } else {
      const created = factory.create(frame, FRAME_BUDGET);
      if (Result.isFailure(created)) {
        throw new Error("Accepted source-page frame could not be captured.");
      }
      if (!sameMeasuredPlan(created.success.plan, expectedPlan)) {
        const closed = factory.close(created.success.cursor);
        if (Result.isFailure(closed)) {
          throw new Error("Changed source-page frame cursor could not be revoked.");
        }
        throw new Error("Source-page frame changed after exact sizing.");
      }
      active = {
        role,
        cursor: created.success.cursor,
        phase: "created",
        destination: undefined,
        byteOffset: undefined,
        byteLength: undefined,
      };
      state.activeProtocolFrame = active;
      chargeCall(state);
      return Result.succeed(Object.freeze({ used: 1 }));
    }
  } else if (active.role !== role) {
    throw new Error("Source-page protocol cursor role changed while active.");
  }
  if (active.phase === "created") {
    let admittedRange:
      | Readonly<{
        readonly bytes: Uint8Array;
        readonly byteOffset: number;
        readonly byteLength: number;
      }>
      | undefined;
    const admitted = factory.admit(
      active.cursor,
      plan => Result.map(
        destination(plan),
        range => {
          admittedRange = range;
          return range;
        },
      ),
    );
    if (Result.isFailure(admitted)) {
      state.activeProtocolFrame = undefined;
      if (
        admitted.failure instanceof
          DeclarativeV2VerifierSourcePageV1Error
      ) {
        return Result.fail(admitted.failure);
      }
      throw new Error("Accepted source-page frame destination was rejected.");
    }
    if (admittedRange === undefined) {
      throw new Error("Accepted source-page frame destination was not retained.");
    }
    active.phase = "admitted";
    active.destination = admittedRange.bytes;
    active.byteOffset = admittedRange.byteOffset;
    active.byteLength = admittedRange.byteLength;
    chargeCall(state);
    return Result.succeed(Object.freeze({ used: 1 }));
  }
  const stepped = factory.step(active.cursor, allowance);
  if (Result.isFailure(stepped)) {
    state.activeProtocolFrame = undefined;
    throw new Error("Accepted source-page protocol cursor failed.");
  }
  const used = stepped.success.receipt.consumedAllowance;
  if (
    used < 0 ||
    used > allowance ||
    stepped.success.receipt.deltaWork.primitiveTransitions !== used ||
    stepped.success.receipt.deltaWork.byteWriteBytes !== used
  ) {
    throw new Error("Source-page protocol cursor reported invalid progress.");
  }
  state.actual.calls += BigInt(used);
  if (stepped.success.status === "pending") {
    return Result.succeed(Object.freeze({ used }));
  }
  if (
    active.destination === undefined ||
    active.byteOffset === undefined ||
    active.byteLength === undefined ||
    stepped.success.written.range.bytes !== active.destination ||
    stepped.success.written.range.byteOffset !== active.byteOffset ||
    stepped.success.written.range.byteLength !== active.byteLength ||
    !sameProgressWork(
      stepped.success.written.work,
      expectedPlan.successfulWork,
    )
  ) {
    state.activeProtocolFrame = undefined;
    throw new Error("Source-page protocol cursor contradicted its plan.");
  }
  state.activeProtocolFrame = undefined;
  return Result.succeed(Object.freeze({
    used,
    destination: active.destination,
    byteLength: active.byteLength,
  }));
}

const EMPTY_BYTES = new Uint8Array(0);

function evidenceParts(
  state: DriverState,
): ReadonlyArray<EvidencePart> {
  const input = requiredInput(state);
  const pathFactory = requiredPathFactory(state);
  const parts: EvidencePart[] = [
    { kind: "bytes", bytes: DOMAIN_BYTES },
    { kind: "bytes", bytes: input.bindings.attemptSha256 },
    { kind: "bytes", bytes: input.bindings.candidateSha256 },
    { kind: "bytes", bytes: input.bindings.reservationSha256 },
    { kind: "bytes", bytes: input.bindings.authenticatedInputSha256 },
    {
      kind: "bytes",
      bytes: input.bindings.rangeAndPredecessorTailsSha256,
    },
    { kind: "bytes", bytes: input.bindings.analyzerIdentitySha256 },
    { kind: "bytes", bytes: input.bindings.verifierIdentitySha256 },
    { kind: "u64", value: input.sequence },
    {
      kind: "byte",
      value: input.predecessorReceiptSha256 === null ? 0 : 1,
    },
    ...(input.predecessorReceiptSha256 === null
      ? []
      : [{
        kind: "bytes" as const,
        bytes: input.predecessorReceiptSha256,
      }]),
    { kind: "u64", value: input.range.firstModuleOrdinal },
    { kind: "u64", value: input.range.moduleCount },
    { kind: "u64", value: input.range.totalModuleCount },
    { kind: "u64", value: input.range.sourceByteLength },
    { kind: "u64", value: input.range.semanticByteLength },
    {
      kind: "u32",
      value: state.currentProgressPlan!.canonicalByteLength,
    },
    { kind: "progress" },
  ];
  for (const module of state.modules) {
    parts.push(
      { kind: "u64", value: module.moduleOrdinal },
      { kind: "u32", value: module.roles },
      { kind: "u32", value: module.modulePathByteLength },
      { kind: "u64", value: module.sourceByteLength },
      { kind: "bytes", bytes: module.frameSha256 },
      { kind: "bytes", bytes: module.sourceSha256 },
      {
        kind: "path",
        factory: pathFactory,
        handle: module.modulePath,
        byteLength: module.modulePathByteLength,
      },
    );
  }
  return parts;
}

function captureInput(
  rawInput: unknown,
  rawExpectedBindings: unknown,
): Result.Result<
  { readonly input: CapturedInput; readonly modules: CapturedModuleArray },
  DeclarativeV2VerifierSourcePageV1Error
> {
  return Result.gen(function*() {
    const record = yield* exactRecord(rawInput, [
      "bindings",
      "commandKind",
      "sequence",
      "currentProgress",
      "predecessorReceiptSha256",
      "commandBudget",
      "range",
      "modules",
    ], "input", "create");
    const bindings = yield* captureBindings(record.bindings, "bindings");
    const expected = yield* captureBindings(
      rawExpectedBindings,
      "expectedBindings",
    );
    if (!sameBindings(bindings, expected)) {
      return yield* Result.fail(issue(
        "create",
        "identityMismatch",
        "bindings",
      ));
    }
    if (record.commandKind !== "source_page") {
      return yield* Result.fail(issue(
        "create",
        "invalidInput",
        "commandKind",
      ));
    }
    const sequence = yield* signedInt64(
      record.sequence,
      "sequence",
      true,
      "create",
    );
    const currentProgress = yield* captureProgress(record.currentProgress);
    const predecessorReceiptSha256 = yield* optionalDigest(
      record.predecessorReceiptSha256,
      "predecessorReceiptSha256",
    );
    const commandBudget = yield* captureBudget(record.commandBudget);
    const range = yield* captureRange(record.range);
    const modules = captureArray(record.modules);
    if (modules === undefined) {
      return yield* Result.fail(issue(
        "create",
        "invalidInput",
        "modules",
      ));
    }
    const input = Object.freeze({
      bindings,
      sequence,
      currentProgress,
      predecessorReceiptSha256,
      commandBudget,
      range,
    });
    const transition = validateInitialTransition(input);
    if (Result.isFailure(transition)) {
      return yield* Result.fail(transition.failure);
    }
    return Object.freeze({ input, modules });
  });
}

function validateInitialTransition(
  input: CapturedInput,
): Result.Result<void, DeclarativeV2VerifierSourcePageV1Error> {
  const current = input.currentProgress;
  const expectedSequence = checkedAdd(current.settledSequence, 1n);
  if (expectedSequence === undefined) {
    return Result.fail(issue("create", "overflow", "sequence"));
  }
  if (
    current.phase !== "source" ||
    current.edgeOrdinal !== 0n ||
    current.pageOrdinal !== 0n ||
    input.sequence !== expectedSequence ||
    input.range.firstModuleOrdinal !== current.moduleOrdinal ||
    input.range.moduleCount === 0n ||
    !optionalDigestEqual(
      current.previousReceiptSha256,
      input.predecessorReceiptSha256,
    )
  ) {
    return Result.fail(issue(
      "create",
      "invalidTransition",
      "currentProgress",
    ));
  }
  const end = checkedAdd(
    input.range.firstModuleOrdinal,
    input.range.moduleCount,
  );
  if (end === undefined) {
    return Result.fail(issue("create", "overflow", "range.moduleOrdinal"));
  }
  if (end > input.range.totalModuleCount) {
    return Result.fail(issue(
      "create",
      "rangeMismatch",
      "range.totalModuleCount",
      end,
      input.range.totalModuleCount,
    ));
  }
  return Result.succeed(undefined);
}

function deriveNextProgress(
  input: CapturedInput,
): Result.Result<
  DeclarativeV2VerifierProgressCursorFrameV2,
  DeclarativeV2VerifierSourcePageV1Error
> {
  const end = checkedAdd(
    input.range.firstModuleOrdinal,
    input.range.moduleCount,
  );
  if (end === undefined) {
    return Result.fail(issue("step", "overflow", "nextProgress.moduleOrdinal"));
  }
  const phase = end === input.range.totalModuleCount ? "parse" : "source";
  return Result.succeed(Object.freeze({
    kind: "progress_cursor",
    phase,
    settledSequence: input.sequence,
    moduleOrdinal: phase === "source" ? end : 0n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: input.predecessorReceiptSha256 === null
      ? null
      : new Uint8Array(input.predecessorReceiptSha256),
  }));
}

function captureModule(
  rawValue: unknown,
  index: number,
  firstModuleOrdinal: bigint,
): Result.Result<PendingModule, DeclarativeV2VerifierSourcePageV1Error> {
  return Result.gen(function*() {
    const record = yield* exactRecord(rawValue, [
      "moduleOrdinal",
      "roles",
      "modulePathBytes",
      "frameSha256",
      "sourceSha256",
      "sourceByteLength",
    ], `modules.${index}`, "step");
    const moduleOrdinal = yield* signedInt64(
      record.moduleOrdinal,
      `modules.${index}.moduleOrdinal`,
      false,
      "step",
    );
    const expectedOrdinal = checkedAdd(firstModuleOrdinal, BigInt(index));
    if (expectedOrdinal === undefined) {
      return yield* Result.fail(issue(
        "step",
        "overflow",
        `modules.${index}.moduleOrdinal`,
      ));
    }
    if (moduleOrdinal !== expectedOrdinal) {
      return yield* Result.fail(issue(
        "step",
        "rangeMismatch",
        `modules.${index}.moduleOrdinal`,
        moduleOrdinal,
        expectedOrdinal,
      ));
    }
    if (!isSourceArtifactV2ModuleRolesV1(record.roles)) {
      return yield* Result.fail(issue(
        "step",
        "invalidInput",
        `modules.${index}.roles`,
      ));
    }
    const path = captureByteView(record.modulePathBytes);
    if (
      path === undefined ||
      path.byteLength < 1 ||
      path.byteLength > MAXIMUM_MODULE_PATH_BYTES
    ) {
      return yield* Result.fail(issue(
        "step",
        path !== undefined && path.byteLength > MAXIMUM_MODULE_PATH_BYTES
          ? "addressabilityExceeded"
          : "invalidInput",
        `modules.${index}.modulePathBytes`,
      ));
    }
    return {
      moduleOrdinal,
      roles: record.roles,
      borrowedPath: path,
      modulePathByteLength: path.byteLength,
      rawFrameSha256: record.frameSha256,
      rawSourceSha256: record.sourceSha256,
      rawSourceByteLength: record.sourceByteLength,
      pathValidator: undefined,
      modulePath: undefined,
      frameSha256: undefined,
      sourceSha256: undefined,
      sourceByteLength: undefined,
      copyOffset: 0,
      copyStage: "start",
    };
  });
}

function captureBindings(
  value: unknown,
  path: string,
): Result.Result<
  DeclarativeV2VerifierSourcePageBindingsV1,
  DeclarativeV2VerifierSourcePageV1Error
> {
  return Result.gen(function*() {
    const record = yield* exactRecord(value, [
      "attemptSha256",
      "candidateSha256",
      "reservationSha256",
      "authenticatedInputSha256",
      "rangeAndPredecessorTailsSha256",
      "analyzerIdentitySha256",
      "verifierIdentitySha256",
    ], path, "create");
    return Object.freeze({
      attemptSha256: yield* digest(record.attemptSha256, `${path}.attemptSha256`),
      candidateSha256: yield* digest(
        record.candidateSha256,
        `${path}.candidateSha256`,
      ),
      reservationSha256: yield* digest(
        record.reservationSha256,
        `${path}.reservationSha256`,
      ),
      authenticatedInputSha256: yield* digest(
        record.authenticatedInputSha256,
        `${path}.authenticatedInputSha256`,
      ),
      rangeAndPredecessorTailsSha256: yield* digest(
        record.rangeAndPredecessorTailsSha256,
        `${path}.rangeAndPredecessorTailsSha256`,
      ),
      analyzerIdentitySha256: yield* digest(
        record.analyzerIdentitySha256,
        `${path}.analyzerIdentitySha256`,
      ),
      verifierIdentitySha256: yield* digest(
        record.verifierIdentitySha256,
        `${path}.verifierIdentitySha256`,
      ),
    });
  });
}

function captureProgress(
  value: unknown,
): Result.Result<
  DeclarativeV2VerifierProgressCursorFrameV2,
  DeclarativeV2VerifierSourcePageV1Error
> {
  return Result.gen(function*() {
    const record = yield* exactRecord(value, [
      "kind",
      "phase",
      "settledSequence",
      "moduleOrdinal",
      "edgeOrdinal",
      "pageOrdinal",
      "previousReceiptSha256",
    ], "currentProgress", "create");
    if (record.kind !== "progress_cursor" || record.phase !== "source") {
      return yield* Result.fail(issue(
        "create",
        "invalidInput",
        "currentProgress",
      ));
    }
    return Object.freeze({
      kind: "progress_cursor",
      phase: "source",
      settledSequence: yield* signedInt64(
        record.settledSequence,
        "currentProgress.settledSequence",
        false,
        "create",
      ),
      moduleOrdinal: yield* signedInt64(
        record.moduleOrdinal,
        "currentProgress.moduleOrdinal",
        false,
        "create",
      ),
      edgeOrdinal: yield* signedInt64(
        record.edgeOrdinal,
        "currentProgress.edgeOrdinal",
        false,
        "create",
      ),
      pageOrdinal: yield* signedInt64(
        record.pageOrdinal,
        "currentProgress.pageOrdinal",
        false,
        "create",
      ),
      previousReceiptSha256: yield* optionalDigest(
        record.previousReceiptSha256,
        "currentProgress.previousReceiptSha256",
      ),
    });
  });
}

function captureBudget(
  value: unknown,
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierSourcePageV1Error
> {
  return Result.gen(function*() {
    const record = yield* exactRecord(
      value,
      ["kind", ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2],
      "commandBudget",
      "create",
    );
    if (record.kind !== "command_budget") {
      return yield* Result.fail(issue(
        "create",
        "invalidInput",
        "commandBudget.kind",
      ));
    }
    const captured: Record<string, string | bigint> = {
      kind: "command_budget",
    };
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      captured[dimension] = yield* signedInt64(
        record[dimension],
        `commandBudget.${dimension}`,
        false,
        "create",
      );
    }
    return Object.freeze(captured) as DeclarativeV2VerifierBudgetFrameV2;
  });
}

function captureRange(
  value: unknown,
): Result.Result<
  DeclarativeV2VerifierSourcePageRangeV1,
  DeclarativeV2VerifierSourcePageV1Error
> {
  return Result.gen(function*() {
    const record = yield* exactRecord(value, [
      "kind",
      "firstModuleOrdinal",
      "moduleCount",
      "totalModuleCount",
      "sourceByteLength",
      "semanticByteLength",
    ], "range", "create");
    if (record.kind !== "source_page" || record.semanticByteLength !== 0n) {
      return yield* Result.fail(issue("create", "invalidInput", "range"));
    }
    return Object.freeze({
      kind: "source_page",
      firstModuleOrdinal: yield* signedInt64(
        record.firstModuleOrdinal,
        "range.firstModuleOrdinal",
        false,
        "create",
      ),
      moduleCount: yield* signedInt64(
        record.moduleCount,
        "range.moduleCount",
        true,
        "create",
      ),
      totalModuleCount: yield* signedInt64(
        record.totalModuleCount,
        "range.totalModuleCount",
        true,
        "create",
      ),
      sourceByteLength: yield* signedInt64(
        record.sourceByteLength,
        "range.sourceByteLength",
        false,
        "create",
      ),
      semanticByteLength: 0n,
    });
  });
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  path: string,
  operation: DeclarativeV2VerifierSourcePageV1Error["operation"],
): Result.Result<
  Readonly<Record<Keys[number], unknown>>,
  DeclarativeV2VerifierSourcePageV1Error
> {
  if (value === null || typeof value !== "object") {
    return Result.fail(issue(operation, "invalidInput", path));
  }
  const captured = Object.create(null) as Record<string, unknown>;
  try {
    if (Array.isArray(value)) {
      return Result.fail(issue(operation, "invalidInput", path));
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some(key => typeof key !== "string" || !keys.includes(key))
    ) {
      return Result.fail(issue(operation, "invalidInput", path));
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return Result.fail(issue(
          operation,
          "invalidInput",
          `${path}.${key}`,
        ));
      }
      captured[key] = descriptor.value;
    }
  } catch {
    return Result.fail(issue(operation, "invalidInput", path));
  }
  return Result.succeed(
    Object.freeze(captured) as Readonly<Record<Keys[number], unknown>>,
  );
}

function captureArray(value: unknown): CapturedModuleArray | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return undefined;
    }
    return Object.freeze({
      values: value,
      length: lengthDescriptor.value,
    });
  } catch {
    return undefined;
  }
}

function borrowedModuleAt(
  modules: CapturedModuleArray,
  index: number,
): unknown {
  try {
    if (index < 0 || index >= modules.length) return INVALID_MODULE;
    const descriptor = Object.getOwnPropertyDescriptor(
      modules.values,
      String(index),
    );
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : INVALID_MODULE;
  } catch {
    return INVALID_MODULE;
  }
}

const INVALID_MODULE = Object.freeze({});

function captureByteView(value: unknown): Uint8Array | undefined {
  if (
    UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined ||
    UINT8_ARRAY_BUFFER_GETTER === undefined
  ) {
    return undefined;
  }
  try {
    if (!isUint8Array(value)) return undefined;
    const buffer = Reflect.apply(
      UINT8_ARRAY_BUFFER_GETTER,
      value,
      [],
    ) as ArrayBufferLike;
    if (isSharedArrayBuffer(buffer)) {
      return undefined;
    }
    const length = Reflect.apply(
      UINT8_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    ) as number;
    return Reflect.apply(UINT8_ARRAY_SUBARRAY, value, [0, length]) as Uint8Array;
  } catch {
    return undefined;
  }
}

function isSharedArrayBuffer(value: unknown): boolean {
  if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) return false;
  try {
    Reflect.apply(SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []);
    return true;
  } catch {
    return false;
  }
}

function captureDigestView(value: unknown): Uint8Array | undefined {
  return isUint8ArrayWithByteLength(value, SHA256_BYTES)
    ? captureByteView(value)
    : undefined;
}

function borrowedByteSlice(
  value: unknown,
  offset: number,
  expectedByteLength: number,
): Uint8Array | undefined {
  if (
    UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined ||
    !isUint8Array(value)
  ) {
    return undefined;
  }
  try {
    const byteLength = Reflect.apply(
      UINT8_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    ) as number;
    if (
      byteLength !== expectedByteLength ||
      offset < 0 ||
      offset >= byteLength
    ) {
      return undefined;
    }
    return Reflect.apply(
      UINT8_ARRAY_SUBARRAY,
      value,
      [offset, offset + 1],
    ) as Uint8Array;
  } catch {
    return undefined;
  }
}

function borrowedByteAt(
  value: unknown,
  offset: number,
  expectedByteLength: number,
): number | undefined {
  const byte = borrowedByteSlice(value, offset, expectedByteLength);
  return byte === undefined ? undefined : byte[0];
}

function digest(
  value: unknown,
  path: string,
): Result.Result<Uint8Array, DeclarativeV2VerifierSourcePageV1Error> {
  const view = captureDigestView(value);
  if (view === undefined) {
    return Result.fail(issue("create", "invalidInput", path));
  }
  try {
    return Result.succeed(new Uint8Array(view));
  } catch {
    return Result.fail(issue("create", "invalidInput", path));
  }
}

function optionalDigest(
  value: unknown,
  path: string,
): Result.Result<Uint8Array | null, DeclarativeV2VerifierSourcePageV1Error> {
  return value === null ? Result.succeed(null) : digest(value, path);
}

function signedInt64(
  value: unknown,
  path: string,
  positive: boolean,
  operation: DeclarativeV2VerifierSourcePageV1Error["operation"],
): Result.Result<bigint, DeclarativeV2VerifierSourcePageV1Error> {
  if (
    typeof value !== "bigint" ||
    value < (positive ? 1n : 0n) ||
    value > MAX_SIGNED_INT64
  ) {
    return Result.fail(issue(operation, "invalidInput", path));
  }
  return Result.succeed(value);
}

const sameBindings = (
  left: DeclarativeV2VerifierSourcePageBindingsV1,
  right: DeclarativeV2VerifierSourcePageBindingsV1,
): boolean =>
  bytesEqualFullScan(left.attemptSha256, right.attemptSha256) &&
  bytesEqualFullScan(left.candidateSha256, right.candidateSha256) &&
  bytesEqualFullScan(left.reservationSha256, right.reservationSha256) &&
  bytesEqualFullScan(
    left.authenticatedInputSha256,
    right.authenticatedInputSha256,
  ) &&
  bytesEqualFullScan(
    left.rangeAndPredecessorTailsSha256,
    right.rangeAndPredecessorTailsSha256,
  ) &&
  bytesEqualFullScan(
    left.analyzerIdentitySha256,
    right.analyzerIdentitySha256,
  ) &&
  bytesEqualFullScan(
    left.verifierIdentitySha256,
    right.verifierIdentitySha256,
  );

const optionalDigestEqual = (
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean =>
  left === null || right === null
    ? left === right
    : bytesEqualFullScan(left, right);

function captureAllowance(
  value: unknown,
  state: DriverState,
  operation: "step" | "finish",
): Result.Result<number, DeclarativeV2VerifierSourcePageV1Error> {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > DECLARATIVE_V2_VERIFIER_SOURCE_PAGE_TRANSITION_QUANTUM_V1
  ) {
    state.terminal = "closed";
    releaseInternalAuthority(state);
    return Result.fail(issue(operation, "invalidInput", "allowance"));
  }
  return Result.succeed(value);
}

function driverState(
  owned: WeakMap<object, DriverState>,
  value: unknown,
  operation: DeclarativeV2VerifierSourcePageV1Error["operation"],
): Result.Result<DriverState, DeclarativeV2VerifierSourcePageV1Error> {
  if (value === null || typeof value !== "object") {
    return Result.fail(issue(operation, "staleHandle"));
  }
  const state = owned.get(value);
  return state === undefined
    ? Result.fail(issue(operation, "staleHandle"))
    : Result.succeed(state);
}

function failTerminal<T>(
  state: DriverState,
  error: DeclarativeV2VerifierSourcePageV1Error,
): Result.Result<T, DeclarativeV2VerifierSourcePageV1Error> {
  state.terminal = "closed";
  releaseInternalAuthority(state);
  return Result.fail(error);
}

function releaseInternalAuthority(state: DriverState): void {
  const frameEncoderFactory = state.frameEncoderFactory;
  if (
    state.activeProtocolFrame !== undefined &&
    frameEncoderFactory !== undefined
  ) {
    const closed = frameEncoderFactory.close(
      state.activeProtocolFrame.cursor,
    );
    if (Result.isFailure(closed)) {
      throw new Error("Accepted source-page protocol cursor could not be revoked.");
    }
  }
  if (frameEncoderFactory !== undefined) {
    for (const cursor of [
      state.preparedCurrentProgressCursor,
      state.preparedNextProgressCursor,
      state.outputManifestPlanningCursor,
    ]) {
      if (cursor === undefined) continue;
      const closed = frameEncoderFactory.close(cursor);
      if (Result.isFailure(closed)) {
        throw new Error("Prepared source-page protocol cursor could not be revoked.");
      }
    }
  }
  if (state.arena !== undefined) {
    const revoked = revokeDeclarativeV2VerifierRuntimeArenaV1(state.arena);
    if (Result.isFailure(revoked) && revoked.failure.reason !== "closed") {
      throw new Error("Accepted source-page arena could not be revoked.");
    }
  }
  const pathFactory = state.pathFactory;
  for (const module of state.modules) {
    if (pathFactory === undefined) {
      throw new Error("Accepted source-page path factory was released early.");
    }
    const revoked = pathFactory.revoke(module.modulePath);
    if (Result.isFailure(revoked) && revoked.failure.reason !== "closed") {
      throw new Error("Accepted module-path authority could not be revoked.");
    }
  }
  if (
    state.pendingModule?.modulePath !== undefined &&
    pathFactory !== undefined
  ) {
    pathFactory.revoke(state.pendingModule.modulePath);
  }
  if (state.pendingModule !== undefined) {
    state.pendingModule.borrowedPath = undefined;
    state.pendingModule.rawFrameSha256 = undefined;
    state.pendingModule.rawSourceSha256 = undefined;
    state.pendingModule.pathValidator = undefined;
    state.pendingModule.modulePath = undefined;
    state.pendingModule.frameSha256 = undefined;
    state.pendingModule.sourceSha256 = undefined;
  }
  for (const captured of state.capturedModules) {
    captured.borrowedPath = undefined;
    captured.rawFrameSha256 = undefined;
    captured.rawSourceSha256 = undefined;
    captured.pathValidator = undefined;
    captured.modulePath = undefined;
    captured.frameSha256 = undefined;
    captured.sourceSha256 = undefined;
  }
  state.pendingModule = undefined;
  state.input = undefined;
  state.borrowedModules = undefined;
  state.capturedModules.length = 0;
  state.modules.length = 0;
  state.activeProtocolFrame = undefined;
  state.preparedCurrentProgressCursor = undefined;
  state.preparedNextProgressCursor = undefined;
  state.outputManifestPlanningCursor = undefined;
  state.frameEncoderFactory = undefined;
  state.pathFactory = undefined;
  state.required = undefined;
  state.nextProgress = undefined;
  state.outputManifest = undefined;
  state.currentProgressPlan = undefined;
  state.nextProgressPlan = undefined;
  state.outputManifestPlan = undefined;
  state.evidenceByteLength = undefined;
  state.evidenceHashPlan = undefined;
  state.diagnosticsHashPlan = undefined;
  state.nextProgressHashPlan = undefined;
  state.evidenceParts = undefined;
  state.hashState = undefined;
  state.arena = undefined;
  state.evidenceBytes = undefined;
  state.nextProgressBytes = undefined;
  state.nextProgressSha256 = undefined;
  state.outputManifestBytes = undefined;
  state.evidenceRootSha256 = undefined;
  state.diagnosticsRootSha256 = undefined;
}

function prepareFrame(
  factory: DeclarativeV2VerifierProgressFrameEncoderFactoryV2,
  frame: unknown,
): Readonly<{
  readonly plan: MeasuredFrame;
  readonly cursor: DeclarativeV2VerifierProgressFrameEncoderCursorV2;
}> {
  const created = factory.create(frame, FRAME_BUDGET);
  if (Result.isFailure(created)) {
    throw new Error("Accepted source-page frame contradicted its protocol.");
  }
  return Object.freeze({
    cursor: created.success.cursor,
    plan: Object.freeze({
      canonicalByteLength: created.success.plan.canonicalByteLength,
      successfulWork: Object.freeze({
        ...created.success.plan.successfulWork,
      }),
    }),
  });
}

function mapShaPlan(
  byteLength: number,
  path: string,
): Result.Result<
  DeclarativeV2VerifierSha256WorkV1,
  DeclarativeV2VerifierSourcePageV1Error
> {
  const planned = planDeclarativeV2VerifierSha256WorkV1(BigInt(byteLength));
  return planned.pipe(Result.mapError(failure =>
    issue(
      "step",
      failure.reason === "overflow"
        ? "overflow"
        : "invalidInput",
      path,
    )
  ));
}

function checkedEvidenceLength(
  totalPathBytes: bigint,
  moduleCount: bigint,
  currentProgressLength: number,
  hasPredecessor: boolean,
): Result.Result<number, DeclarativeV2VerifierSourcePageV1Error> {
  const length = BigInt(DOMAIN_BYTES.byteLength) + 7n * 32n + 8n +
    BigInt(hasPredecessor ? 33 : 1) + 5n * 8n + 4n +
    BigInt(currentProgressLength) +
    moduleCount * MODULE_FIXED_TABLE_BYTES +
    totalPathBytes;
  if (length > MAX_U32) {
    return Result.fail(issue(
      "step",
      "addressabilityExceeded",
      "evidenceBytes",
      length,
      MAX_U32,
    ));
  }
  return Result.succeed(Number(length));
}

const sameMeasuredPlan = (
  left: DeclarativeV2VerifierProgressFrameEncodingPlanV2,
  right: MeasuredFrame,
): boolean =>
  left.canonicalByteLength === right.canonicalByteLength &&
  left.successfulWork.byteStorageAllocationBytes ===
    right.successfulWork.byteStorageAllocationBytes &&
  left.successfulWork.byteCopyBytes === right.successfulWork.byteCopyBytes &&
  left.successfulWork.byteWriteBytes === right.successfulWork.byteWriteBytes &&
  left.successfulWork.byteScanBytes === right.successfulWork.byteScanBytes &&
  left.successfulWork.primitiveTransitions ===
    right.successfulWork.primitiveTransitions;

const sameProgressWork = (
  left: DeclarativeV2VerifierProgressFrameWorkV2,
  right: DeclarativeV2VerifierProgressFrameWorkV2,
): boolean =>
  left.byteStorageAllocationBytes === right.byteStorageAllocationBytes &&
  left.byteCopyBytes === right.byteCopyBytes &&
  left.byteWriteBytes === right.byteWriteBytes &&
  left.byteScanBytes === right.byteScanBytes &&
  left.primitiveTransitions === right.primitiveTransitions;

function mutableZeroUsage(): MutableUsage {
  return Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      0n,
    ]),
  ) as unknown as MutableUsage;
}

function frozenUsage(
  usage: MutableUsage,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind: "attempt_usage",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        usage[dimension],
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

const usageEquals = (
  usage: MutableUsage,
  required: DeclarativeV2VerifierBudgetFrameV2,
): boolean =>
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.every(
    dimension => usage[dimension] === required[dimension],
  );

function requiredState(state: DriverState): DeclarativeV2VerifierBudgetFrameV2 {
  if (state.required === undefined) {
    throw new Error("Source-page driver entered finish without an admitted plan.");
  }
  return state.required;
}

function requiredInput(state: DriverState): CapturedInput {
  if (state.input === undefined) {
    throw new Error("Source-page input authority was released early.");
  }
  return state.input;
}

function requiredBorrowedModules(state: DriverState): CapturedModuleArray {
  if (state.borrowedModules === undefined) {
    throw new Error("Source-page module authority was released early.");
  }
  return state.borrowedModules;
}

function requiredPathFactory(
  state: DriverState,
): DeclarativeV2ArtifactModulePathFactoryV1 {
  if (state.pathFactory === undefined) {
    throw new Error("Source-page path authority was released early.");
  }
  return state.pathFactory;
}

function requiredFrameEncoderFactory(
  state: DriverState,
): DeclarativeV2VerifierProgressFrameEncoderFactoryV2 {
  if (state.frameEncoderFactory === undefined) {
    throw new Error("Source-page frame authority was released early.");
  }
  return state.frameEncoderFactory;
}

function takePreparedFrameCursor(
  state: DriverState,
  role: ProtocolFrameRole,
): DeclarativeV2VerifierProgressFrameEncoderCursorV2 | undefined {
  if (role === "currentProgress") {
    const cursor = state.preparedCurrentProgressCursor;
    state.preparedCurrentProgressCursor = undefined;
    return cursor;
  }
  if (role === "nextProgress") {
    const cursor = state.preparedNextProgressCursor;
    state.preparedNextProgressCursor = undefined;
    return cursor;
  }
  return undefined;
}

function requiredEvidenceByteLength(state: DriverState): number {
  if (state.evidenceByteLength === undefined) {
    throw new Error("Source-page evidence length was not planned.");
  }
  return state.evidenceByteLength;
}

function requiredEvidenceHashPlan(
  state: DriverState,
): DeclarativeV2VerifierSha256WorkV1 {
  if (state.evidenceHashPlan === undefined) {
    throw new Error("Source-page evidence hash was not planned.");
  }
  return state.evidenceHashPlan;
}

function requiredDiagnosticsHashPlan(
  state: DriverState,
): DeclarativeV2VerifierSha256WorkV1 {
  if (state.diagnosticsHashPlan === undefined) {
    throw new Error("Source-page diagnostics hash was not planned.");
  }
  return state.diagnosticsHashPlan;
}

function requiredNextProgressHashPlan(
  state: DriverState,
): DeclarativeV2VerifierSha256WorkV1 {
  if (state.nextProgressHashPlan === undefined) {
    throw new Error("Source-page next-progress hash was not planned.");
  }
  return state.nextProgressHashPlan;
}

function chargeCall(state: DriverState): void {
  state.actual.calls += 1n;
}

function pendingReceipt(
  state: DriverState,
  deltaTransitions: number,
): DeclarativeV2VerifierSourcePagePendingV1 {
  return Object.freeze({
    status: "pending",
    receipt: Object.freeze({
      deltaTransitions,
      aggregateTransitions: state.aggregateTransitions,
    }),
  });
}

function readyReceipt(
  state: DriverState,
  deltaTransitions: number,
): DeclarativeV2VerifierSourcePageReadyV1 {
  return Object.freeze({
    status: "ready",
    receipt: Object.freeze({
      deltaTransitions,
      aggregateTransitions: state.aggregateTransitions,
    }),
  });
}

function checkedAdd(left: bigint, right: bigint): bigint | undefined {
  const result = left + right;
  return result <= MAX_SIGNED_INT64 ? result : undefined;
}

function checkedSum(values: readonly bigint[]): bigint | undefined {
  let result = 0n;
  for (const value of values) {
    result = checkedAdd(result, value) ?? -1n;
    if (result < 0n) return undefined;
  }
  return result;
}

function maximumBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function evidencePartByteLength(part: EvidencePart): number {
  switch (part.kind) {
    case "bytes":
      return part.bytes.byteLength;
    case "progress":
      throw new Error("Progress frame length is owned by its protocol plan.");
    case "byte":
      return 1;
    case "u32":
      return 4;
    case "u64":
      return 8;
    case "path":
      return part.byteLength;
  }
}

function evidencePartByteAt(part: EvidencePart, offset: number): number {
  switch (part.kind) {
    case "bytes":
      return part.bytes[offset]!;
    case "progress":
      throw new Error("Progress bytes are emitted by the protocol owner.");
    case "byte":
      return part.value;
    case "u32":
      return (part.value >>> ((3 - offset) * 8)) & 0xff;
    case "u64":
      return Number((part.value >> BigInt((7 - offset) * 8)) & 0xffn);
    case "path": {
      const byte = part.factory.byteAt(part.handle, offset);
      if (Result.isFailure(byte) || byte.success === undefined) {
        throw new Error("Accepted module-path authority failed during emission.");
      }
      return byte.success;
    }
  }
}
