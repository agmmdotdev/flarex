import {
  bytesEqualFullScan,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Result } from "effect";
import {
  encodeDeclarativeV2VerifierProgressFrameV2,
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import type { DeclarativeV2ArtifactModulePathHandleV1 } from "./declarativeV2ArtifactModulePathV1";
import {
  type DeclarativeV2VerifierAuthenticatedLinkBindingsV1,
  type DeclarativeV2VerifierAuthenticatedLinkDriverV1,
  type DeclarativeV2VerifierAuthenticatedLinkFactoryV1,
  type DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
  type DeclarativeV2VerifierAuthenticatedLinkAccumulatorV1,
  DeclarativeV2VerifierExecutableV1Error,
  type DeclarativeV2VerifierLinkCapacityV1,
  type DeclarativeV2VerifierLinkResultV1,
  type DeclarativeV2VerifierEngineV1,
  type DeclarativeV2VerifierModuleResultV1,
  createDeclarativeV2VerifierEngineV1,
  makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1,
} from "./declarativeV2VerifierExecutableV1";
import {
  type DeclarativeV2VerifierRegistrationCompleteV1,
  type DeclarativeV2VerifierRegistrationDriverV1,
  type DeclarativeV2VerifierRegistrationFactoryV1,
  type DeclarativeV2VerifierRegistrationInputV1,
  type DeclarativeV2VerifierRegistrationV1Error,
  declarativeV2StableLinkContinuityMatchesRegistrationV1,
  makeDeclarativeV2VerifierRegistrationFactoryV1,
} from "./declarativeV2VerifierRegistrationV1";
import {
  type DeclarativeV2VerifierRestartClaimV1,
  type DeclarativeV2VerifierRestartPageSourceV1,
  type DeclarativeV2VerifierRestartProducerStepV1,
  type DeclarativeV2VerifierRestartProducerV1,
  type DeclarativeV2VerifierRestartRehydratorV1,
  type DeclarativeV2VerifierRestartModuleResultSetV1,
  type DeclarativeV2VerifierRestartRuntimeFactoryV1,
  DeclarativeV2VerifierRestartRuntimeV1Error,
  makeDeclarativeV2VerifierRestartRuntimeFactoryV1,
} from "./declarativeV2VerifierRestartRuntimeV1";
import {
  deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1,
} from "./declarativeV2VerifierRestartEvidenceV1";
import {
  type DeclarativeV2VerifierParseCapacityBindingsV1,
  type DeclarativeV2VerifierParseCapacityPlanV1,
  type DeclarativeV2VerifierSizingV1Error,
  closeDeclarativeV2VerifierParseCapacityV1,
  planDeclarativeV2VerifierParseCapacityV1,
} from "./declarativeV2VerifierSizingV1";
import {
  type DeclarativeV2VerifierSourcePageCompleteV1,
  type DeclarativeV2VerifierSourcePageDriverV1,
  type DeclarativeV2VerifierSourcePageFactoryV1,
  type DeclarativeV2VerifierSourcePageInputV1,
  type DeclarativeV2VerifierSourcePageV1Error,
  makeDeclarativeV2VerifierSourcePageFactoryV1,
} from "./declarativeV2VerifierSourcePageV1";

const SHA256_BYTES = 32;
const MAX_ALLOWANCE = 1_024;

export interface DeclarativeV2AnalyzerSessionBindingsV1 {
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly authenticatedInputSha256: Uint8Array;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

export interface DeclarativeV2AnalyzerSessionV1 {
  readonly _tag: "DeclarativeV2AnalyzerSessionV1";
}

export interface DeclarativeV2AnalyzerDriverV1 {
  readonly _tag: "DeclarativeV2AnalyzerDriverV1";
}

export interface DeclarativeV2AnalyzerRestartEvidenceProducerV1 {
  readonly _tag: "DeclarativeV2AnalyzerRestartEvidenceProducerV1";
}

export interface DeclarativeV2AnalyzerParseCommandV1 {
  readonly kind: "parse_module";
  readonly reservationSha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly predecessorReceiptSha256: Uint8Array | null;
  readonly sequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly totalModuleCount: bigint;
  readonly modulePath: DeclarativeV2ArtifactModulePathHandleV1;
  readonly source: Uint8Array;
  readonly sourceSha256: Uint8Array;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
  readonly currentProgress: DeclarativeV2VerifierProgressCursorFrameV2;
}

export interface DeclarativeV2AnalyzerSourceCommandV1 {
  readonly kind: "source_page";
  readonly input: DeclarativeV2VerifierSourcePageInputV1;
}

export interface DeclarativeV2AnalyzerLinkCommandV1 {
  readonly kind: "link_page";
  readonly bindings: DeclarativeV2VerifierAuthenticatedLinkBindingsV1;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
  readonly currentProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly predecessorReceiptSha256: Uint8Array | null;
}

export interface DeclarativeV2AnalyzerRegistrationCommandV1 {
  readonly kind: "registration_page";
  readonly input: Omit<
    DeclarativeV2VerifierRegistrationInputV1,
    "completedLinkResult" | "completedLinkBindings"
  >;
}

export type DeclarativeV2AnalyzerCommandV1 =
  | DeclarativeV2AnalyzerParseCommandV1
  | DeclarativeV2AnalyzerSourceCommandV1
  | DeclarativeV2AnalyzerLinkCommandV1
  | DeclarativeV2AnalyzerRegistrationCommandV1;

export interface DeclarativeV2AnalyzerParseCompleteV1 {
  readonly status: "complete";
  readonly kind: "parse_module";
  readonly sequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly capacity: DeclarativeV2VerifierBudgetFrameV2;
  readonly actual: DeclarativeV2VerifierBudgetFrameV2;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly evidenceSha256: string;
}

export interface DeclarativeV2AnalyzerSourceCompleteV1 {
  readonly status: "complete";
  readonly kind: "source_page";
  readonly result: DeclarativeV2VerifierSourcePageCompleteV1;
}

export interface DeclarativeV2AnalyzerLinkCompleteV1 {
  readonly status: "complete";
  readonly kind: "link_page";
  readonly sequence: bigint;
  readonly capacity: DeclarativeV2VerifierLinkCapacityV1;
  readonly actual: DeclarativeV2VerifierBudgetFrameV2;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly moduleCount: bigint;
  readonly diagnosticCount: bigint;
}

export interface DeclarativeV2AnalyzerRegistrationCompleteV1 {
  readonly status: "complete";
  readonly kind: "registration_page";
  readonly result: DeclarativeV2VerifierRegistrationCompleteV1;
}

export interface DeclarativeV2AnalyzerRehydrateCompleteV1 {
  readonly status: "complete";
  readonly kind: "rehydrate";
  readonly commandKind: "parse_module" | "link_page";
  readonly recoveryUsage: DeclarativeV2VerifierBudgetFrameV2;
}

export type DeclarativeV2AnalyzerCompleteV1 =
  | DeclarativeV2AnalyzerParseCompleteV1
  | DeclarativeV2AnalyzerSourceCompleteV1
  | DeclarativeV2AnalyzerLinkCompleteV1
  | DeclarativeV2AnalyzerRegistrationCompleteV1
  | DeclarativeV2AnalyzerRehydrateCompleteV1;

export interface DeclarativeV2AnalyzerPendingV1 {
  readonly status: "pending";
  readonly transitionCount: number;
}

export type DeclarativeV2AnalyzerStepV1 =
  | DeclarativeV2AnalyzerPendingV1
  | DeclarativeV2AnalyzerCompleteV1;

export interface DeclarativeV2AnalyzerRehydrateInputV1 {
  readonly claim: DeclarativeV2VerifierRestartClaimV1;
  readonly source: DeclarativeV2VerifierRestartPageSourceV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly linkBindings?: DeclarativeV2VerifierAuthenticatedLinkBindingsV1;
}

export type DeclarativeV2AnalyzerRestartEvidenceClaimV1 = Omit<
  DeclarativeV2VerifierRestartClaimV1,
  "resultAuthority" | "parseModuleResults"
>;

export type DeclarativeV2AnalyzerPortV1ErrorCause =
  | DeclarativeV2VerifierExecutableV1Error
  | DeclarativeV2VerifierRegistrationV1Error
  | DeclarativeV2VerifierRestartRuntimeV1Error
  | DeclarativeV2VerifierSizingV1Error
  | DeclarativeV2VerifierSourcePageV1Error;

export class DeclarativeV2AnalyzerPortV1Error extends Data.TaggedError(
  "DeclarativeV2AnalyzerPortV1Error",
)<{
  readonly operation:
    | "createSession"
    | "start"
    | "rehydrate"
    | "openRestartEvidence"
    | "stepRestartEvidence"
    | "step"
    | "close";
  readonly reason:
    | "invalidInput"
    | "identityMismatch"
    | "invalidTransition"
    | "missingAuthority"
    | "staleAuthority"
    | "closed";
  readonly path?: string;
  readonly cause?: DeclarativeV2AnalyzerPortV1ErrorCause;
}> {}

export interface DeclarativeV2AnalyzerPortFactoryV1 {
  readonly createSession: (
    bindings: unknown,
  ) => Result.Result<DeclarativeV2AnalyzerSessionV1, DeclarativeV2AnalyzerPortV1Error>;
  readonly start: (
    session: unknown,
    command: DeclarativeV2AnalyzerCommandV1,
  ) => Result.Result<DeclarativeV2AnalyzerDriverV1, DeclarativeV2AnalyzerPortV1Error>;
  readonly rehydrate: (
    session: unknown,
    input: DeclarativeV2AnalyzerRehydrateInputV1,
  ) => Result.Result<DeclarativeV2AnalyzerDriverV1, DeclarativeV2AnalyzerPortV1Error>;
  readonly openRestartEvidence: (input: Readonly<{
    readonly session: DeclarativeV2AnalyzerSessionV1;
    readonly result: DeclarativeV2AnalyzerCompleteV1;
    readonly claim: DeclarativeV2AnalyzerRestartEvidenceClaimV1;
    readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  }>) => Result.Result<
    DeclarativeV2AnalyzerRestartEvidenceProducerV1,
    DeclarativeV2AnalyzerPortV1Error
  >;
  readonly stepRestartEvidence: (
    producer: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartProducerStepV1,
    DeclarativeV2AnalyzerPortV1Error
  >;
  readonly step: (
    driver: unknown,
    allowance: unknown,
  ) => Result.Result<DeclarativeV2AnalyzerStepV1, DeclarativeV2AnalyzerPortV1Error>;
  readonly close: (
    handle: unknown,
  ) => Result.Result<void, DeclarativeV2AnalyzerPortV1Error>;
}

type CapturedSessionBindings = Readonly<{
  attemptSha256: Uint8Array;
  candidateSha256: Uint8Array;
  authenticatedInputSha256: Uint8Array;
  analyzerReleaseSha256: Uint8Array;
  analyzerIdentitySha256: Uint8Array;
  verifierIdentitySha256: Uint8Array;
}>;

type OwnedModule = Readonly<{
  result: DeclarativeV2VerifierModuleResultV1;
}>;

interface SessionState {
  readonly bindings: CapturedSessionBindings;
  readonly modules: Map<bigint, OwnedModule>;
  readonly restartClaims: WeakMap<object, DeclarativeV2VerifierRestartClaimV1>;
  readonly restartRuntime: DeclarativeV2VerifierRestartRuntimeFactoryV1;
  readonly restartEvidenceProducerHandles: Set<
    DeclarativeV2AnalyzerRestartEvidenceProducerV1
  >;
  activeDriver: DeclarativeV2AnalyzerDriverV1 | undefined;
  expectedProgress: DeclarativeV2VerifierProgressCursorFrameV2 | undefined;
  lastLinkFactory: DeclarativeV2VerifierAuthenticatedLinkFactoryV1 | undefined;
  lastLinkResult: DeclarativeV2VerifierLinkResultV1 | undefined;
  lastLinkBindings: DeclarativeV2VerifierAuthenticatedLinkBindingsV1 | undefined;
  closed: boolean;
}

interface ParseDriverState {
  readonly kind: "parse_module";
  readonly session: SessionState;
  readonly capacity: DeclarativeV2VerifierParseCapacityPlanV1["capacity"];
  readonly engine: DeclarativeV2VerifierEngineV1;
  readonly command: DeclarativeV2AnalyzerParseCommandV1;
  sourceOffset: number;
  phase: "input" | "finish";
  closed: boolean;
}

interface SourceDriverState {
  readonly kind: "source_page";
  readonly session: SessionState;
  readonly factory: DeclarativeV2VerifierSourcePageFactoryV1;
  readonly driver: DeclarativeV2VerifierSourcePageDriverV1;
  phase: "accumulating" | "finishing";
  closed: boolean;
}

interface LinkDriverState {
  readonly kind: "link_page";
  readonly session: SessionState;
  readonly factory: DeclarativeV2VerifierAuthenticatedLinkFactoryV1;
  readonly accumulator: DeclarativeV2VerifierAuthenticatedLinkAccumulatorV1;
  readonly command: DeclarativeV2AnalyzerLinkCommandV1;
  readonly modules: readonly DeclarativeV2VerifierModuleResultV1[];
  moduleIndex: number;
  driver: DeclarativeV2VerifierAuthenticatedLinkDriverV1 | undefined;
  capacity: DeclarativeV2VerifierLinkCapacityV1 | undefined;
  phase: "admit" | "seal" | "drive";
  closed: boolean;
}

interface RegistrationDriverState {
  readonly kind: "registration_page";
  readonly session: SessionState;
  readonly factory: DeclarativeV2VerifierRegistrationFactoryV1;
  readonly driver: DeclarativeV2VerifierRegistrationDriverV1;
  closed: boolean;
}

interface RehydrateDriverState {
  readonly kind: "rehydrate";
  readonly session: SessionState;
  readonly runtime: DeclarativeV2VerifierRestartRuntimeFactoryV1;
  readonly rehydrator: DeclarativeV2VerifierRestartRehydratorV1;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly expectedProgress:
    | DeclarativeV2VerifierProgressCursorFrameV2
    | undefined;
  readonly linkFactory: DeclarativeV2VerifierAuthenticatedLinkFactoryV1 | undefined;
  readonly linkBindings:
    | DeclarativeV2VerifierAuthenticatedLinkBindingsV1
    | undefined;
  closed: boolean;
}

type DriverState =
  | ParseDriverState
  | SourceDriverState
  | LinkDriverState
  | RegistrationDriverState
  | RehydrateDriverState;

interface RestartEvidenceResultState {
  readonly session: SessionState;
  readonly commandKind: "parse_module" | "link_page";
  readonly resultAuthority:
    | DeclarativeV2VerifierModuleResultV1
    | DeclarativeV2VerifierLinkResultV1;
  claimed: boolean;
}

interface RestartEvidenceProducerState {
  readonly session: SessionState;
  readonly runtime: DeclarativeV2VerifierRestartRuntimeFactoryV1;
  readonly producer: DeclarativeV2VerifierRestartProducerV1;
  readonly correlation: RestartEvidenceResultState;
  closed: boolean;
}

const issue = (
  operation: DeclarativeV2AnalyzerPortV1Error["operation"],
  reason: DeclarativeV2AnalyzerPortV1Error["reason"],
  path?: string,
  cause?: DeclarativeV2AnalyzerPortV1ErrorCause,
): DeclarativeV2AnalyzerPortV1Error =>
  new DeclarativeV2AnalyzerPortV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });

export function makeDeclarativeV2AnalyzerPortFactoryV1():
  DeclarativeV2AnalyzerPortFactoryV1 {
  const sessions = new WeakMap<object, SessionState>();
  const drivers = new WeakMap<object, DriverState>();
  const restartEvidenceResults =
    new WeakMap<object, RestartEvidenceResultState>();
  const restartEvidenceProducers =
    new WeakMap<object, RestartEvidenceProducerState>();

  const sessionHandle = (): DeclarativeV2AnalyzerSessionV1 =>
    Object.freeze({ _tag: "DeclarativeV2AnalyzerSessionV1" });
  const driverHandle = (): DeclarativeV2AnalyzerDriverV1 =>
    Object.freeze({ _tag: "DeclarativeV2AnalyzerDriverV1" });
  const restartEvidenceProducerHandle =
    (): DeclarativeV2AnalyzerRestartEvidenceProducerV1 =>
      Object.freeze({ _tag: "DeclarativeV2AnalyzerRestartEvidenceProducerV1" });

  const createSession: DeclarativeV2AnalyzerPortFactoryV1["createSession"] =
    rawBindings => {
      const bindings = captureSessionBindings(rawBindings);
      if (bindings === undefined) {
        return Result.fail(issue("createSession", "invalidInput", "bindings"));
      }
      const restartClaims =
        new WeakMap<object, DeclarativeV2VerifierRestartClaimV1>();
      const restartRuntime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
        claim(authority, operation) {
          const claim = authority !== null && typeof authority === "object"
            ? restartClaims.get(authority)
            : undefined;
          if (
            claim === undefined ||
            (operation !== "produce" && operation !== "rehydrate")
          ) {
            return Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
              operation: "createRehydrator",
              reason: "staleAuthority",
            }));
          }
          restartClaims.delete(authority as object);
          return Result.succeed(claim);
        },
      });
      const handle = sessionHandle();
      sessions.set(handle, {
        bindings,
        modules: new Map(),
        restartClaims,
        restartRuntime,
        restartEvidenceProducerHandles: new Set(),
        activeDriver: undefined,
        expectedProgress: undefined,
        lastLinkFactory: undefined,
        lastLinkResult: undefined,
        lastLinkBindings: undefined,
        closed: false,
      });
      return Result.succeed(handle);
    };

  const start: DeclarativeV2AnalyzerPortFactoryV1["start"] =
    (rawSession, command) => Result.gen(function* () {
      const session = yield* sessionState(sessions, rawSession, "start");
      if (session.activeDriver !== undefined) {
        return yield* Result.fail(
          issue("start", "invalidTransition", "session.activeDriver"),
        );
      }
      const currentProgress = commandCurrentProgress(command);
      if (
        session.expectedProgress !== undefined &&
        !progressEqual(session.expectedProgress, currentProgress)
      ) {
        return yield* Result.fail(
          issue("start", "invalidTransition", "command.currentProgress"),
        );
      }
      const prepared = yield* prepareDriver(session, command);
      const handle = driverHandle();
      drivers.set(handle, prepared);
      session.activeDriver = handle;
      return handle;
    });

  const rehydrate: DeclarativeV2AnalyzerPortFactoryV1["rehydrate"] =
    (rawSession, input) => Result.gen(function* () {
      const session = yield* sessionState(sessions, rawSession, "rehydrate");
      if (session.activeDriver !== undefined) {
        return yield* Result.fail(
          issue("rehydrate", "invalidTransition", "session.activeDriver"),
        );
      }
      if (
        !restartTransitionIsValid(
          input.claim,
          input.nextProgress,
          session.expectedProgress,
        )
      ) {
        return yield* Result.fail(
          issue("rehydrate", "invalidTransition", "claim.sequence"),
        );
      }
      if (
        !isUint8ArrayWithByteLength(
          input.claim.authenticatedInputSha256,
          SHA256_BYTES,
        ) ||
        !digestEqual(
          input.claim.authenticatedInputSha256,
          session.bindings.authenticatedInputSha256,
        )
      ) {
        return yield* Result.fail(
          issue("rehydrate", "identityMismatch", "authenticatedInputSha256"),
        );
      }
      if (
        input.claim.outputManifest === null ||
        !progressDigestMatches(
          input.nextProgress,
          input.claim.outputManifest.nextProgressSha256,
        )
      ) {
        return yield* Result.fail(
          issue("rehydrate", "identityMismatch", "nextProgressSha256"),
        );
      }
      const runtime = session.restartRuntime;
      let ownedClaim = input.claim;
      let linkFactory:
        | DeclarativeV2VerifierAuthenticatedLinkFactoryV1
        | undefined;
      let linkBindings:
        | DeclarativeV2VerifierAuthenticatedLinkBindingsV1
        | undefined;
      if (input.claim.commandKind === "link_page") {
        if (
          input.linkBindings === undefined ||
          session.modules.size === 0 ||
          input.nextProgress.phase !== "registration" ||
          !linkBindingsMatchSession(
            input.linkBindings,
            input.claim,
            input.nextProgress,
            session.bindings,
          )
        ) {
          return yield* Result.fail(
            issue("rehydrate", "identityMismatch", "linkBindings"),
          );
        }
        const moduleSet = yield* prepareRestartModuleSet(
          runtime,
          session.modules,
        );
        ownedClaim = Object.freeze({
          ...input.claim,
          parseModuleResults: moduleSet,
        });
        linkBindings = cloneLinkBindings(input.linkBindings);
        linkFactory = makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
          claim() {
            return Result.fail(new DeclarativeV2VerifierExecutableV1Error({
              operation: "link",
              reason: "invalidInput",
            }));
          },
        });
      }
      const authority = Object.freeze({});
      session.restartClaims.set(authority, ownedClaim);
      const created = yield* runtime.createRehydrator({
        authority,
        source: input.source,
        maximum: input.maximum,
      }).pipe(
        Result.mapError(cause =>
          issue("rehydrate", "invalidInput", "input", cause)
        ),
      );
      const handle = driverHandle();
      drivers.set(handle, {
        kind: "rehydrate",
        session,
        runtime,
        rehydrator: created,
        nextProgress: cloneProgress(input.nextProgress),
        expectedProgress: session.expectedProgress === undefined
          ? undefined
          : cloneProgress(session.expectedProgress),
        linkFactory,
        linkBindings,
        closed: false,
      });
      session.activeDriver = handle;
      return handle;
    });

  const step: DeclarativeV2AnalyzerPortFactoryV1["step"] =
    (rawDriver, rawAllowance) => Result.gen(function* () {
      const state = yield* driverState(drivers, rawDriver, "step");
      const allowance = captureAllowance(rawAllowance);
      if (allowance === undefined) {
        closeDriverState(state);
        drivers.delete(rawDriver as object);
        return yield* Result.fail(issue("step", "invalidInput", "allowance"));
      }
      if (allowance === 0) {
        return Object.freeze({
          status: "pending",
          transitionCount: 0,
        }) satisfies DeclarativeV2AnalyzerPendingV1;
      }
      const stepped = stepDriver(state, allowance);
      if (Result.isFailure(stepped)) {
        closeDriverState(state);
        drivers.delete(rawDriver as object);
        return yield* stepped;
      }
      if (stepped.success.status === "complete") {
        if (stepped.success.kind === "parse_module") {
          const resultAuthority =
            state.kind === "parse_module"
              ? state.session.modules.get(stepped.success.moduleOrdinal)?.result
              : undefined;
          if (resultAuthority === undefined) {
            throw new Error(
              "Accepted parse completion lost its restart result authority.",
            );
          }
          restartEvidenceResults.set(stepped.success, {
            session: state.session,
            commandKind: "parse_module",
            resultAuthority,
            claimed: false,
          });
        } else if (stepped.success.kind === "link_page") {
          const resultAuthority = state.session.lastLinkResult;
          if (state.kind !== "link_page" || resultAuthority === undefined) {
            throw new Error(
              "Accepted link completion lost its restart result authority.",
            );
          }
          restartEvidenceResults.set(stepped.success, {
            session: state.session,
            commandKind: "link_page",
            resultAuthority,
            claimed: false,
          });
        }
        state.closed = true;
        finishDriver(state);
        drivers.delete(rawDriver as object);
      }
      return stepped.success;
    });

  const openRestartEvidence:
    DeclarativeV2AnalyzerPortFactoryV1["openRestartEvidence"] = input => {
      const session = sessions.get(input.session);
      const correlation =
        input.result !== null && typeof input.result === "object"
          ? restartEvidenceResults.get(input.result)
          : undefined;
      if (
        session === undefined ||
        session.closed ||
        correlation === undefined ||
        correlation.session !== session ||
        correlation.claimed ||
        input.claim.commandKind !== correlation.commandKind
      ) {
        return Result.fail(
          issue("openRestartEvidence", "staleAuthority", "result"),
        );
      }
      const authority = Object.freeze({});
      session.restartClaims.set(authority, Object.freeze({
        ...input.claim,
        resultAuthority: correlation.resultAuthority,
        parseModuleResults: null,
      }));
      return session.restartRuntime.createProducer({
        authority,
        maximum: input.maximum,
      }).pipe(
        Result.mapError(cause => {
          session.restartClaims.delete(authority);
          return issue(
            "openRestartEvidence",
            "invalidInput",
            "claim",
            cause,
          );
        }),
        Result.map(producer => {
          correlation.claimed = true;
          const handle = restartEvidenceProducerHandle();
          restartEvidenceProducers.set(handle, {
            session,
            runtime: session.restartRuntime,
            producer,
            correlation,
            closed: false,
          });
          session.restartEvidenceProducerHandles.add(handle);
          return handle;
        }),
      );
    };

  const stepRestartEvidence:
    DeclarativeV2AnalyzerPortFactoryV1["stepRestartEvidence"] =
      (rawProducer, allowance) => {
        const state =
          rawProducer !== null && typeof rawProducer === "object"
            ? restartEvidenceProducers.get(rawProducer)
            : undefined;
        if (state === undefined || state.closed || state.session.closed) {
          return Result.fail(
            issue("stepRestartEvidence", "closed", "producer"),
          );
        }
        return state.runtime.stepProducer(state.producer, allowance).pipe(
          Result.mapError(cause => {
            state.closed = true;
            restartEvidenceProducers.delete(rawProducer as object);
            state.session.restartEvidenceProducerHandles.delete(
              rawProducer as DeclarativeV2AnalyzerRestartEvidenceProducerV1,
            );
            if (!state.session.closed) state.correlation.claimed = false;
            state.runtime.close(state.producer);
            return issue(
              "stepRestartEvidence",
              "invalidInput",
              "producer",
              cause,
            );
          }),
          Result.map(stepped => {
            if (stepped.status === "complete") {
              state.closed = true;
              restartEvidenceProducers.delete(rawProducer as object);
              state.session.restartEvidenceProducerHandles.delete(
                rawProducer as DeclarativeV2AnalyzerRestartEvidenceProducerV1,
              );
            }
            return stepped;
          }),
        );
      };

  const close: DeclarativeV2AnalyzerPortFactoryV1["close"] = rawHandle => {
    if (rawHandle === null || typeof rawHandle !== "object") {
      return Result.fail(issue("close", "invalidInput", "handle"));
    }
    const restartProducer = restartEvidenceProducers.get(rawHandle);
    if (restartProducer !== undefined) {
      if (restartProducer.closed) return Result.fail(issue("close", "closed"));
      restartProducer.closed = true;
      restartEvidenceProducers.delete(rawHandle);
      restartProducer.session.restartEvidenceProducerHandles.delete(
        rawHandle as DeclarativeV2AnalyzerRestartEvidenceProducerV1,
      );
      if (!restartProducer.session.closed) {
        restartProducer.correlation.claimed = false;
      }
      return restartProducer.runtime.close(restartProducer.producer).pipe(
        Result.mapError(cause =>
          issue("close", "invalidInput", "restartEvidenceProducer", cause)
        ),
      );
    }
    const driver = drivers.get(rawHandle);
    if (driver !== undefined) {
      if (driver.closed) return Result.fail(issue("close", "closed"));
      closeDriverState(driver);
      drivers.delete(rawHandle);
      return Result.succeed(undefined);
    }
    const session = sessions.get(rawHandle);
    if (session === undefined) {
      return Result.fail(issue("close", "invalidInput", "handle"));
    }
    if (session.closed) return Result.fail(issue("close", "closed"));
    if (session.activeDriver !== undefined) {
      const active = drivers.get(session.activeDriver);
      if (active !== undefined) {
        closeDriverState(active);
        drivers.delete(session.activeDriver);
      }
    }
    for (const producerHandle of session.restartEvidenceProducerHandles) {
      const producer = restartEvidenceProducers.get(producerHandle);
      if (producer !== undefined && !producer.closed) {
        producer.closed = true;
        producer.runtime.close(producer.producer);
        restartEvidenceProducers.delete(producerHandle);
      }
    }
    session.restartEvidenceProducerHandles.clear();
    session.closed = true;
    session.modules.clear();
    session.lastLinkFactory = undefined;
    session.lastLinkResult = undefined;
    session.lastLinkBindings = undefined;
    sessions.delete(rawHandle);
    return Result.succeed(undefined);
  };

  return Object.freeze({
    createSession,
    start,
    rehydrate,
    openRestartEvidence,
    stepRestartEvidence,
    step,
    close,
  });
}

function prepareDriver(
  session: SessionState,
  command: DeclarativeV2AnalyzerCommandV1,
): Result.Result<DriverState, DeclarativeV2AnalyzerPortV1Error> {
  switch (command.kind) {
    case "parse_module": {
      if (!parseTransitionIsValid(command)) {
        return Result.fail(issue("start", "invalidTransition", "currentProgress"));
      }
      return Result.gen(function* () {
        const capturedCommand = Object.freeze({
          ...command,
          source: new Uint8Array(command.source),
          sourceSha256: new Uint8Array(command.sourceSha256),
        }) satisfies DeclarativeV2AnalyzerParseCommandV1;
        const expectedBindings = parseBindings(
          session.bindings,
          capturedCommand.rangeAndPredecessorTailsSha256,
        );
        const planned = yield* planDeclarativeV2VerifierParseCapacityV1({
          bindings: expectedBindings,
          commandKind: "parse_module",
          sequence: capturedCommand.sequence,
          moduleOrdinal: capturedCommand.moduleOrdinal,
          modulePath: capturedCommand.modulePath,
          source: capturedCommand.source,
          sourceSha256: capturedCommand.sourceSha256,
          commandBudget: capturedCommand.commandBudget,
        }, expectedBindings).pipe(
          Result.mapError(cause =>
            issue("start", "invalidInput", "parse", cause)
          ),
        );
        const engineResult = createDeclarativeV2VerifierEngineV1({
          modulePath: capturedCommand.modulePath,
          moduleOrdinal: capturedCommand.moduleOrdinal,
          sourceSha256: capturedCommand.sourceSha256,
          maximums: capturedCommand.commandBudget,
          required: planned.capacity,
        });
        closeDeclarativeV2VerifierParseCapacityV1(planned.claim);
        const engine = yield* engineResult.pipe(
          Result.mapError(cause =>
            issue("start", "invalidInput", "parse", cause)
          ),
        );
        return {
          kind: "parse_module",
          session,
          capacity: planned.capacity,
          engine,
          command: capturedCommand,
          sourceOffset: 0,
          phase: capturedCommand.source.byteLength === 0 ? "finish" : "input",
          closed: false,
        };
      });
    }
    case "source_page": {
      const expectedBindings = Object.freeze({
        ...sourceBindings(
          session.bindings,
          command.input.bindings.rangeAndPredecessorTailsSha256,
        ),
        reservationSha256: command.input.bindings.reservationSha256,
      });
      const factory = makeDeclarativeV2VerifierSourcePageFactoryV1();
      return factory.create(command.input, expectedBindings).pipe(
        Result.mapError(cause =>
          issue("start", "invalidInput", "source", cause)
        ),
        Result.map(driver => ({
          kind: "source_page",
          session,
          factory,
          driver,
          phase: "accumulating",
          closed: false,
        })),
      );
    }
    case "link_page": {
      if (!linkTransitionIsValid(command)) {
        return Result.fail(issue("start", "invalidTransition", "currentProgress"));
      }
      if (session.modules.size === 0) {
        return Result.fail(issue("start", "missingAuthority", "modules"));
      }
      const modules = [...session.modules.entries()]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([, owned]) => owned.result);
      const claims = new Map<
        DeclarativeV2VerifierModuleResultV1,
        DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1
      >();
      for (const module of modules) {
        claims.set(module, Object.freeze({
          ...command.bindings,
          moduleOrdinal: module.moduleOrdinal,
          producingParseResultSha256: hexSha256(module.evidenceSha256),
        }));
      }
      const factory = makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
        claim(module) {
          const claim = claims.get(module);
          return claim === undefined
            ? Result.fail(new DeclarativeV2VerifierExecutableV1Error({
              operation: "link",
              reason: "invalidInput",
            }))
            : Result.succeed(claim);
        },
      });
      return factory.create(command.bindings, command.commandBudget).pipe(
        Result.mapError(cause =>
          issue("start", "invalidInput", "link", cause)
        ),
        Result.map(accumulator => ({
          kind: "link_page",
          session,
          factory,
          accumulator,
          command,
          modules,
          moduleIndex: 0,
          driver: undefined,
          capacity: undefined,
          phase: "admit",
          closed: false,
        })),
      );
    }
    case "registration_page": {
      if (
        session.lastLinkFactory === undefined ||
        session.lastLinkResult === undefined ||
        session.lastLinkBindings === undefined
      ) {
        return Result.fail(issue("start", "missingAuthority", "completedLink"));
      }
      if (
        !declarativeV2StableLinkContinuityMatchesRegistrationV1(
          session.lastLinkBindings,
          command.input.bindings,
        )
      ) {
        return Result.fail(
          issue("start", "identityMismatch", "completedLink.bindings"),
        );
      }
      const factory = makeDeclarativeV2VerifierRegistrationFactoryV1(
        session.lastLinkFactory,
      );
      const input = Object.freeze({
        ...command.input,
        completedLinkResult: session.lastLinkResult,
        completedLinkBindings: cloneLinkBindings(session.lastLinkBindings),
      }) satisfies DeclarativeV2VerifierRegistrationInputV1;
      return factory.create(input, input.bindings).pipe(
        Result.mapError(cause =>
          issue("start", "invalidInput", "registration", cause)
        ),
        Result.map(driver => ({
          kind: "registration_page",
          session,
          factory,
          driver,
          closed: false,
        })),
      );
    }
  }
}

function stepDriver(
  state: DriverState,
  allowance: number,
): Result.Result<DeclarativeV2AnalyzerStepV1, DeclarativeV2AnalyzerPortV1Error> {
  switch (state.kind) {
    case "parse_module": {
      return Result.gen(function* () {
        if (state.phase === "input") {
          const remaining = state.command.source.subarray(state.sourceOffset);
          const stepped = yield* state.engine.step(remaining, allowance).pipe(
            Result.mapError(cause =>
              issue("step", "invalidInput", "parse", cause)
            ),
          );
          if (
            stepped.consumedBytes === 0 &&
            stepped.transitionCount === 0
          ) {
            throw new Error(
              "Accepted verifier step made no analyzer-port progress.",
            );
          }
          state.sourceOffset += stepped.consumedBytes;
          if (state.sourceOffset === state.command.source.byteLength) {
            state.phase = "finish";
          }
          return Object.freeze({
            status: "pending",
            transitionCount: stepped.transitionCount,
          }) satisfies DeclarativeV2AnalyzerPendingV1;
        }
        const finished = yield* state.engine.finish(allowance).pipe(
          Result.mapError(cause =>
            issue("step", "invalidInput", "parse", cause)
          ),
        );
        if ("status" in finished) {
          return Object.freeze({
            status: "pending",
            transitionCount: finished.transitionCount,
          }) satisfies DeclarativeV2AnalyzerPendingV1;
        }
        const result = finished;
        state.session.modules.set(
          result.moduleOrdinal,
          Object.freeze({ result }),
        );
        const nextProgress = parseNextProgress(state.command);
        state.session.expectedProgress = cloneProgress(nextProgress);
        return Object.freeze({
          status: "complete",
          kind: "parse_module",
          sequence: state.command.sequence,
          moduleOrdinal: state.command.moduleOrdinal,
          capacity: state.capacity,
          actual: result.usage,
          nextProgress,
          evidenceSha256: result.evidenceSha256,
        }) satisfies DeclarativeV2AnalyzerParseCompleteV1;
      });
    }
    case "source_page": {
      return Result.gen(function* () {
        if (state.phase === "accumulating") {
          const stepped = yield* state.factory.step(
            state.driver,
            allowance,
          ).pipe(
            Result.mapError(cause =>
              issue("step", "invalidInput", "source", cause)
            ),
          );
          if (stepped.status !== "ready") {
            return Object.freeze({
              status: "pending",
              transitionCount: stepped.receipt.deltaTransitions,
            }) satisfies DeclarativeV2AnalyzerPendingV1;
          }
          state.phase = "finishing";
        }
        const finished = yield* state.factory.finish(
          state.driver,
          allowance,
        ).pipe(
          Result.mapError(cause =>
            issue("step", "invalidInput", "source", cause)
          ),
        );
        if (finished.status === "complete") {
          state.session.expectedProgress =
            cloneProgress(finished.nextProgress);
          return Object.freeze({
            status: "complete",
            kind: "source_page",
            result: finished,
          }) satisfies DeclarativeV2AnalyzerSourceCompleteV1;
        }
        return Object.freeze({
          status: "pending",
          transitionCount: finished.receipt.deltaTransitions,
        }) satisfies DeclarativeV2AnalyzerPendingV1;
      });
    }
    case "link_page":
      return stepLink(state, allowance);
    case "registration_page":
      return state.factory.step(state.driver, allowance).pipe(
        Result.mapError(cause =>
          issue("step", "invalidInput", "registration", cause)
        ),
        Result.map(stepped => {
          if (stepped.status === "complete") {
            state.session.expectedProgress =
              cloneProgress(stepped.nextProgress);
            return Object.freeze({
              status: "complete",
              kind: "registration_page",
              result: stepped,
            }) satisfies DeclarativeV2AnalyzerRegistrationCompleteV1;
          }
          return Object.freeze({
            status: "pending",
            transitionCount: stepped.receipt.transitionCount,
          }) satisfies DeclarativeV2AnalyzerPendingV1;
        }),
      );
    case "rehydrate":
      return Result.gen(function* () {
        const stepped = yield* state.runtime.stepRehydrator(
          state.rehydrator,
          allowance,
        ).pipe(
          Result.mapError(cause =>
            issue("step", "invalidInput", "rehydrate", cause)
          ),
        );
        if (stepped.status === "pending") {
          return Object.freeze({
            status: "pending",
            transitionCount: stepped.receipt.transitionCount,
          }) satisfies DeclarativeV2AnalyzerPendingV1;
        }
        if (stepped.moduleResult !== null) {
          if (
            !rehydratedParseResultMatchesNextProgress(
              stepped.moduleResult,
              state.nextProgress,
              state.expectedProgress,
            )
          ) {
            throw new Error(
              "Accepted cold parse result contradicted its authenticated progress lineage.",
            );
          }
          state.session.modules.set(
            stepped.moduleResult.moduleOrdinal,
            Object.freeze({ result: stepped.moduleResult }),
          );
        }
        if (stepped.linkResult !== null) {
          if (
            state.linkFactory === undefined ||
            state.linkBindings === undefined
          ) {
            throw new Error(
              "Accepted cold link result lost its authenticated registration authority.",
            );
          }
          const modules = [...state.session.modules.entries()]
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([, owned]) => owned.result);
          const adopted = state.linkFactory.adoptRestarted(
            stepped.linkResult,
            state.linkBindings,
            modules,
          );
          if (Result.isFailure(adopted)) {
            throw new Error(
              "Accepted cold link result contradicted its module lineage.",
            );
          }
          state.session.lastLinkFactory = state.linkFactory;
          state.session.lastLinkResult = stepped.linkResult;
          state.session.lastLinkBindings = cloneLinkBindings(state.linkBindings);
        }
        state.session.expectedProgress = cloneProgress(state.nextProgress);
        return Object.freeze({
          status: "complete",
          kind: "rehydrate",
          commandKind: stepped.commandKind,
          recoveryUsage: stepped.recoveryUsage,
        }) satisfies DeclarativeV2AnalyzerRehydrateCompleteV1;
      });
  }
}

function rehydratedParseResultMatchesNextProgress(
  result: DeclarativeV2VerifierModuleResultV1,
  next: DeclarativeV2VerifierProgressCursorFrameV2,
  expected: DeclarativeV2VerifierProgressCursorFrameV2 | undefined,
): boolean {
  if (
    expected !== undefined &&
    (
      expected.phase !== "parse" ||
      result.moduleOrdinal !== expected.moduleOrdinal
    )
  ) {
    return false;
  }
  return next.phase === "link"
    ? next.moduleOrdinal === 0n
    : next.phase === "parse" &&
      next.moduleOrdinal === result.moduleOrdinal + 1n;
}

function stepLink(
  state: LinkDriverState,
  allowance: number,
): Result.Result<DeclarativeV2AnalyzerStepV1, DeclarativeV2AnalyzerPortV1Error> {
  return Result.gen(function* () {
    if (state.phase === "admit") {
      const module = state.modules[state.moduleIndex];
      if (module === undefined) {
        state.phase = "seal";
      } else {
        const admitted = yield* state.factory.admit(
          state.accumulator,
          module,
          allowance,
        ).pipe(
          Result.mapError(cause =>
            issue("step", "invalidInput", "link", cause)
          ),
        );
        if (admitted.status === "ready") state.moduleIndex += 1;
        return Object.freeze({
          status: "pending",
          transitionCount: admitted.transitionCount,
        }) satisfies DeclarativeV2AnalyzerPendingV1;
      }
    }
    if (state.phase === "seal") {
      const sealed = yield* state.factory.seal(
        state.accumulator,
        allowance,
      ).pipe(
        Result.mapError(cause =>
          issue("step", "invalidInput", "link", cause)
        ),
      );
      if (sealed.status === "pending") {
        return Object.freeze({
          status: "pending",
          transitionCount: sealed.transitionCount,
        }) satisfies DeclarativeV2AnalyzerPendingV1;
      }
      state.driver = sealed.driver;
      state.capacity = sealed.capacity;
      state.phase = "drive";
      return Object.freeze({
        status: "pending",
        transitionCount: sealed.transitionCount,
      }) satisfies DeclarativeV2AnalyzerPendingV1;
    }
    if (state.driver === undefined || state.capacity === undefined) {
      throw new Error("Accepted link driver lost its sealed capacity.");
    }
    const driven = yield* state.factory.step(state.driver, allowance).pipe(
      Result.mapError(cause =>
        issue("step", "invalidInput", "link", cause)
      ),
    );
    if ("status" in driven) {
      return Object.freeze({
        status: "pending",
        transitionCount: driven.transitionCount,
      }) satisfies DeclarativeV2AnalyzerPendingV1;
    }
    state.session.lastLinkFactory = state.factory;
    state.session.lastLinkResult = driven;
    state.session.lastLinkBindings = cloneLinkBindings(state.command.bindings);
    state.session.expectedProgress = cloneProgress(state.command.nextProgress);
    return Object.freeze({
      status: "complete",
      kind: "link_page",
      sequence: state.command.bindings.linkSequence,
      capacity: state.capacity,
      actual: driven.usage,
      nextProgress: cloneProgress(state.command.nextProgress),
      moduleCount: driven.moduleCount,
      diagnosticCount: driven.diagnosticCount,
    }) satisfies DeclarativeV2AnalyzerLinkCompleteV1;
  });
}

function closeDriverState(state: DriverState): void {
  if (state.closed) return;
  state.closed = true;
  switch (state.kind) {
    case "parse_module":
      break;
    case "source_page":
      state.factory.close(state.driver);
      break;
    case "link_page":
      state.factory.close(state.driver ?? state.accumulator);
      break;
    case "registration_page":
      state.factory.close(state.driver);
      break;
    case "rehydrate":
      state.runtime.close(state.rehydrator);
      break;
  }
  finishDriver(state);
}

function finishDriver(state: DriverState): void {
  state.session.activeDriver = undefined;
}

function sessionState(
  sessions: WeakMap<object, SessionState>,
  rawSession: unknown,
  operation: "start" | "rehydrate",
): Result.Result<SessionState, DeclarativeV2AnalyzerPortV1Error> {
  const state = rawSession !== null && typeof rawSession === "object"
    ? sessions.get(rawSession)
    : undefined;
  if (state === undefined) {
    return Result.fail(issue(operation, "invalidInput", "session"));
  }
  return state.closed
    ? Result.fail(issue(operation, "closed", "session"))
    : Result.succeed(state);
}

function driverState(
  drivers: WeakMap<object, DriverState>,
  rawDriver: unknown,
  operation: "step",
): Result.Result<DriverState, DeclarativeV2AnalyzerPortV1Error> {
  const state = rawDriver !== null && typeof rawDriver === "object"
    ? drivers.get(rawDriver)
    : undefined;
  if (state === undefined) {
    return Result.fail(issue(operation, "invalidInput", "driver"));
  }
  return state.closed
    ? Result.fail(issue(operation, "closed", "driver"))
    : Result.succeed(state);
}

function captureSessionBindings(raw: unknown): CapturedSessionBindings | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const keys = [
    "attemptSha256",
    "candidateSha256",
    "authenticatedInputSha256",
    "analyzerReleaseSha256",
    "analyzerIdentitySha256",
    "verifierIdentitySha256",
  ] as const;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(raw);
  } catch {
    return undefined;
  }
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key))
  ) {
    return undefined;
  }
  const attemptSha256 = ownDataPropertyValue(descriptors.attemptSha256);
  const candidateSha256 = ownDataPropertyValue(descriptors.candidateSha256);
  const authenticatedInputSha256 =
    ownDataPropertyValue(descriptors.authenticatedInputSha256);
  const analyzerReleaseSha256 =
    ownDataPropertyValue(descriptors.analyzerReleaseSha256);
  const analyzerIdentitySha256 =
    ownDataPropertyValue(descriptors.analyzerIdentitySha256);
  const verifierIdentitySha256 =
    ownDataPropertyValue(descriptors.verifierIdentitySha256);
  if (
    !isUint8ArrayWithByteLength(attemptSha256, SHA256_BYTES) ||
    !isUint8ArrayWithByteLength(candidateSha256, SHA256_BYTES) ||
    !isUint8ArrayWithByteLength(authenticatedInputSha256, SHA256_BYTES) ||
    !isUint8ArrayWithByteLength(analyzerReleaseSha256, SHA256_BYTES) ||
    !isUint8ArrayWithByteLength(analyzerIdentitySha256, SHA256_BYTES) ||
    !isUint8ArrayWithByteLength(verifierIdentitySha256, SHA256_BYTES)
  ) {
    return undefined;
  }
  return Object.freeze({
    attemptSha256: new Uint8Array(attemptSha256),
    candidateSha256: new Uint8Array(candidateSha256),
    authenticatedInputSha256:
      new Uint8Array(authenticatedInputSha256),
    analyzerReleaseSha256:
      new Uint8Array(analyzerReleaseSha256),
    analyzerIdentitySha256:
      new Uint8Array(analyzerIdentitySha256),
    verifierIdentitySha256:
      new Uint8Array(verifierIdentitySha256),
  });
}

function ownDataPropertyValue(
  descriptor: PropertyDescriptor | undefined,
): unknown {
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function commandCurrentProgress(
  command: DeclarativeV2AnalyzerCommandV1,
): DeclarativeV2VerifierProgressCursorFrameV2 {
  switch (command.kind) {
    case "parse_module":
    case "link_page":
      return command.currentProgress;
    case "source_page":
    case "registration_page":
      return command.input.currentProgress;
  }
}

function progressEqual(
  left: DeclarativeV2VerifierProgressCursorFrameV2,
  right: DeclarativeV2VerifierProgressCursorFrameV2,
): boolean {
  const leftBytes = encodeDeclarativeV2VerifierProgressFrameV2(left, {
    maximumFrameBytes: 1_048_576,
    maximumCanonicalBytes: 1_048_576,
  });
  const rightBytes = encodeDeclarativeV2VerifierProgressFrameV2(right, {
    maximumFrameBytes: 1_048_576,
    maximumCanonicalBytes: 1_048_576,
  });
  return Result.isSuccess(leftBytes) &&
    Result.isSuccess(rightBytes) &&
    bytesEqualFullScan(
      leftBytes.success.canonicalBytes,
      rightBytes.success.canonicalBytes,
  );
}

function restartTransitionIsValid(
  claim: DeclarativeV2VerifierRestartClaimV1,
  next: DeclarativeV2VerifierProgressCursorFrameV2,
  expected: DeclarativeV2VerifierProgressCursorFrameV2 | undefined,
): boolean {
  if (
    next.settledSequence !== claim.sequence ||
    next.edgeOrdinal !== 0n ||
    next.pageOrdinal !== 0n
  ) {
    return false;
  }
  if (
    expected !== undefined &&
    (
      claim.sequence !== expected.settledSequence + 1n ||
      expected.edgeOrdinal !== 0n ||
      expected.pageOrdinal !== 0n ||
      (claim.commandKind === "parse_module" && expected.phase !== "parse") ||
      (claim.commandKind === "link_page" &&
        (
          expected.phase !== "link" ||
          expected.moduleOrdinal !== 0n
        ))
    )
  ) {
    return false;
  }
  if (claim.commandKind === "link_page") {
    return next.phase === "registration" && next.moduleOrdinal === 0n;
  }
  if (next.phase === "link") return next.moduleOrdinal === 0n;
  return next.phase === "parse" &&
    (
      expected === undefined ||
      next.moduleOrdinal === expected.moduleOrdinal + 1n
    );
}

function prepareRestartModuleSet(
  runtime: DeclarativeV2VerifierRestartRuntimeFactoryV1,
  ownedModules: ReadonlyMap<bigint, OwnedModule>,
): Result.Result<
  DeclarativeV2VerifierRestartModuleResultSetV1,
  DeclarativeV2AnalyzerPortV1Error
> {
  return Result.gen(function* () {
    const created = yield* runtime.createModuleResultSet().pipe(
      Result.mapError(cause =>
        issue("rehydrate", "staleAuthority", "parseModuleResults", cause)
      ),
    );
    const modules = [...ownedModules.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    for (let index = 0; index < modules.length; index += 1) {
      const [ordinal, owned] = modules[index]!;
      if (ordinal !== BigInt(index)) {
        return yield* Result.fail(
          issue("rehydrate", "invalidTransition", "parseModuleResults.ordinal"),
        );
      }
      yield* runtime.appendModuleResult(created, owned.result).pipe(
        Result.mapError(cause =>
          issue(
            "rehydrate",
            "staleAuthority",
            "parseModuleResults",
            cause,
          )
        ),
      );
    }
    yield* runtime.sealModuleResultSet(created).pipe(
      Result.mapError(cause =>
        issue("rehydrate", "staleAuthority", "parseModuleResults", cause)
      ),
    );
    return created;
  });
}

function captureAllowance(value: unknown): number | undefined {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= MAX_ALLOWANCE
    ? value
    : undefined;
}

function parseBindings(
  bindings: CapturedSessionBindings,
  rangeAndPredecessorTailsSha256: Uint8Array,
): DeclarativeV2VerifierParseCapacityBindingsV1 {
  return Object.freeze({
    candidateSha256: new Uint8Array(bindings.candidateSha256),
    authenticatedInputSha256:
      new Uint8Array(bindings.authenticatedInputSha256),
    rangeAndPredecessorTailsSha256:
      new Uint8Array(rangeAndPredecessorTailsSha256),
    analyzerIdentitySha256: new Uint8Array(bindings.analyzerIdentitySha256),
    verifierIdentitySha256: new Uint8Array(bindings.verifierIdentitySha256),
  });
}

function sourceBindings(
  bindings: CapturedSessionBindings,
  rangeAndPredecessorTailsSha256: Uint8Array,
) {
  return Object.freeze({
    attemptSha256: new Uint8Array(bindings.attemptSha256),
    candidateSha256: new Uint8Array(bindings.candidateSha256),
    authenticatedInputSha256:
      new Uint8Array(bindings.authenticatedInputSha256),
    rangeAndPredecessorTailsSha256:
      new Uint8Array(rangeAndPredecessorTailsSha256),
    analyzerIdentitySha256: new Uint8Array(bindings.analyzerIdentitySha256),
    verifierIdentitySha256: new Uint8Array(bindings.verifierIdentitySha256),
  });
}

function parseTransitionIsValid(command: DeclarativeV2AnalyzerParseCommandV1): boolean {
  const current = command.currentProgress;
  return current.phase === "parse" &&
    current.moduleOrdinal === command.moduleOrdinal &&
    command.sequence === current.settledSequence + 1n &&
    command.totalModuleCount > command.moduleOrdinal;
}

function linkTransitionIsValid(command: DeclarativeV2AnalyzerLinkCommandV1): boolean {
  const current = command.currentProgress;
  const next = command.nextProgress;
  return current.phase === "link" &&
    current.moduleOrdinal === 0n &&
    current.edgeOrdinal === 0n &&
    current.pageOrdinal === 0n &&
    command.bindings.linkSequence === current.settledSequence + 1n &&
    next.phase === "registration" &&
    next.settledSequence === command.bindings.linkSequence &&
    next.moduleOrdinal === 0n &&
    next.edgeOrdinal === 0n &&
    next.pageOrdinal === 0n &&
    nullableDigestEqual(
      next.previousReceiptSha256,
      command.predecessorReceiptSha256,
    ) &&
    progressDigestMatches(next, command.bindings.currentProgressSha256);
}

function parseNextProgress(
  command: DeclarativeV2AnalyzerParseCommandV1,
): DeclarativeV2VerifierProgressCursorFrameV2 {
  const nextOrdinal = command.moduleOrdinal + 1n;
  const phase = nextOrdinal === command.totalModuleCount ? "link" : "parse";
  return Object.freeze({
    kind: "progress_cursor",
    phase,
    settledSequence: command.sequence,
    moduleOrdinal: phase === "parse" ? nextOrdinal : 0n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256:
      command.predecessorReceiptSha256 === null
        ? null
        : new Uint8Array(command.predecessorReceiptSha256),
  });
}

function cloneProgress(
  progress: DeclarativeV2VerifierProgressCursorFrameV2,
): DeclarativeV2VerifierProgressCursorFrameV2 {
  return Object.freeze({
    ...progress,
    previousReceiptSha256:
      progress.previousReceiptSha256 === null
        ? null
        : new Uint8Array(progress.previousReceiptSha256),
  });
}

function hexSha256(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error("Accepted verifier result exposed a non-canonical SHA-256.");
  }
  const output = new Uint8Array(SHA256_BYTES);
  for (let index = 0; index < SHA256_BYTES; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

function progressDigestMatches(
  frame: DeclarativeV2VerifierProgressCursorFrameV2,
  expected: Uint8Array,
): boolean {
  const encoded = encodeDeclarativeV2VerifierProgressFrameV2(frame, {
    maximumFrameBytes: 1_048_576,
    maximumCanonicalBytes: 1_048_576,
  });
  if (Result.isFailure(encoded)) return false;
  const digest = deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(
    encoded.success.canonicalBytes,
  );
  return Result.isSuccess(digest) && digestEqual(digest.success, expected);
}

function nullableDigestEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  return left === null || right === null
    ? left === right
    : digestEqual(left, right);
}

function digestEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function cloneLinkBindings(
  bindings: DeclarativeV2VerifierAuthenticatedLinkBindingsV1,
): DeclarativeV2VerifierAuthenticatedLinkBindingsV1 {
  return Object.freeze({
    attemptSha256: new Uint8Array(bindings.attemptSha256),
    futureRegistrationIntentSha256:
      new Uint8Array(bindings.futureRegistrationIntentSha256),
    candidateSha256: new Uint8Array(bindings.candidateSha256),
    authenticatedInputSha256:
      new Uint8Array(bindings.authenticatedInputSha256),
    linkSequence: bindings.linkSequence,
    parsePagesRootSha256: new Uint8Array(bindings.parsePagesRootSha256),
    currentProgressSha256: new Uint8Array(bindings.currentProgressSha256),
    predecessorAndTailsSha256:
      new Uint8Array(bindings.predecessorAndTailsSha256),
    rangeSha256: new Uint8Array(bindings.rangeSha256),
    analyzerReleaseSha256: new Uint8Array(bindings.analyzerReleaseSha256),
    analyzerIdentitySha256: new Uint8Array(bindings.analyzerIdentitySha256),
    verifierIdentitySha256: new Uint8Array(bindings.verifierIdentitySha256),
  });
}

function linkBindingsMatchSession(
  bindings: DeclarativeV2VerifierAuthenticatedLinkBindingsV1,
  claim: DeclarativeV2VerifierRestartClaimV1,
  nextProgress: DeclarativeV2VerifierProgressCursorFrameV2,
  session: CapturedSessionBindings,
): boolean {
  return bindings.linkSequence === claim.sequence &&
    isUint8ArrayWithByteLength(
      bindings.futureRegistrationIntentSha256,
      SHA256_BYTES,
    ) &&
    isUint8ArrayWithByteLength(claim.reservationSha256, SHA256_BYTES) &&
    claim.parsePagesRootSha256 !== null &&
    digestEqual(bindings.parsePagesRootSha256, claim.parsePagesRootSha256) &&
    progressDigestMatches(nextProgress, bindings.currentProgressSha256) &&
    digestEqual(bindings.attemptSha256, session.attemptSha256) &&
    digestEqual(bindings.candidateSha256, session.candidateSha256) &&
    digestEqual(
      bindings.authenticatedInputSha256,
      session.authenticatedInputSha256,
    ) &&
    digestEqual(
      bindings.predecessorAndTailsSha256,
      bindings.rangeSha256,
    ) &&
    digestEqual(bindings.analyzerReleaseSha256, session.analyzerReleaseSha256) &&
    digestEqual(bindings.analyzerIdentitySha256, session.analyzerIdentitySha256) &&
    digestEqual(bindings.verifierIdentitySha256, session.verifierIdentitySha256);
}
