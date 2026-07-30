import {
  type SourceArtifactV2ModuleRolesV1,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  DeclarativeV2AnalyzerPortV1Error,
  DeclarativeV2VerifierRestartRuntimeV1Error,
  deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1,
  makeDeclarativeV2AnalyzerPortFactoryV1,
  type DeclarativeV2AnalyzerCompleteV1,
  type DeclarativeV2AnalyzerCommandV1,
  type DeclarativeV2AnalyzerPortFactoryV1,
  type DeclarativeV2AnalyzerRestartEvidenceClaimV1,
  type DeclarativeV2AnalyzerRestartEvidenceProducerV1,
  type DeclarativeV2AnalyzerSessionBindingsV1,
  type DeclarativeV2AnalyzerSessionV1,
  type DeclarativeV2ArtifactModulePathHandleV1,
  type DeclarativeV2SemanticStreamBudgetV1,
  type DeclarativeV2VerifierAuthenticatedLinkBindingsV1,
  type DeclarativeV2VerifierRestartClaimV1,
  type DeclarativeV2VerifierRestartPageSourceV1,
  type DeclarativeV2VerifierRestartProducerStepV1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import {
  encodeDeclarativeV2AuthenticatedCommandRequestV1,
  type DeclarativeV2AuthenticatedCommandAdmittedFrameMetadataV1,
  type DeclarativeV2AuthenticatedCommandDecodedCapabilityV1,
  type DeclarativeV2AuthenticatedCommandFrameV1,
  type DeclarativeV2AuthenticatedCommandIncrementalBudgetV1,
  type DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
  type DeclarativeV2AuthenticatedCommandIncrementalV1Error,
  type DeclarativeV2AuthenticatedCommandTransportBudgetV1,
} from "@flarex/executor-http/internal-declarative-v2-authenticated-command-v1";
import {
  type DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
  type DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  type DeclarativeV2AuthenticatedCommandRestartInputV1Error,
} from "@flarex/executor-http/internal-declarative-v2-authenticated-command-restart-input-v1";
import {
  bytesEqualFullScan,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Effect, Result, Scope } from "effect";
import {
  encodeDeclarativeV2TerminalAuthorityProofV1,
  type DeclarativeV2TerminalAuthorityProofEncodedV1,
} from "flarex-protocol/internal/declarative-v2-terminal-authority-proof-v1";
import {
  decodeDeclarativeV2VerifierProgressFrameV2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierCommandReceiptFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

const MAX_ALLOWANCE = 1_024;
const MAX_I64 = 9_223_372_036_854_775_807n;
const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 1_048_576,
  maximumCanonicalBytes: 1_048_576,
});

export interface PrivateDeclarativeV2AnalyzerAdmissionV1 {
  readonly currentProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly nextProgress?: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly futureRegistrationIntentSha256?: Uint8Array;
  readonly totalModuleCount: bigint;
  readonly parsePagesRootSha256: Uint8Array;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly semanticBudget?: DeclarativeV2SemanticStreamBudgetV1;
}

export interface PrivateDeclarativeV2AnalyzerRestartAdmissionV1 {
  readonly claim: DeclarativeV2VerifierRestartClaimV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly linkBindings?: DeclarativeV2VerifierAuthenticatedLinkBindingsV1;
}

export interface PrivateDeclarativeV2AnalyzerTrustedClaimsV1 {
  readonly session: (
    authority: unknown,
  ) => Effect.Effect<
    DeclarativeV2AnalyzerSessionBindingsV1,
    PrivateDeclarativeV2AnalyzerHostV1Error
  >;
  readonly command: (
    session: DeclarativeV2AnalyzerSessionBindingsV1,
    capability: DeclarativeV2AuthenticatedCommandDecodedCapabilityV1,
  ) => Effect.Effect<
    PrivateDeclarativeV2AnalyzerAdmissionV1,
    PrivateDeclarativeV2AnalyzerHostV1Error
  >;
  readonly restart: (
    session: DeclarativeV2AnalyzerSessionBindingsV1,
    source: DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
  ) => Effect.Effect<
    PrivateDeclarativeV2AnalyzerRestartAdmissionV1,
    PrivateDeclarativeV2AnalyzerHostV1Error
  >;
}

export interface PrivateDeclarativeV2AnalyzerSessionV1 {
  readonly _tag: "PrivateDeclarativeV2AnalyzerSessionV1";
}

export interface PrivateDeclarativeV2AnalyzerRestartEvidenceProducerV1 {
  readonly _tag: "PrivateDeclarativeV2AnalyzerRestartEvidenceProducerV1";
}

export class PrivateDeclarativeV2AnalyzerHostV1Error extends Data.TaggedError(
  "PrivateDeclarativeV2AnalyzerHostV1Error",
)<{
  readonly operation:
    | "open"
    | "execute"
    | "rehydrate"
    | "openRestartEvidence"
    | "stepRestartEvidence"
    | "claimTerminal"
    | "close";
  readonly reason:
    | "invalidInput"
    | "invalidAdmission"
    | "transportFailure"
    | "analysisFailure"
    | "closed";
  readonly path?: string;
  readonly cause?:
    | DeclarativeV2AnalyzerPortV1Error
    | DeclarativeV2AuthenticatedCommandIncrementalV1Error
    | DeclarativeV2AuthenticatedCommandRestartInputV1Error;
}> {}

export interface PrivateDeclarativeV2AnalyzerHostV1 {
  readonly open: (
    authority: unknown,
  ) => Effect.Effect<
    PrivateDeclarativeV2AnalyzerSessionV1,
    PrivateDeclarativeV2AnalyzerHostV1Error,
    Scope.Scope
  >;
  readonly execute: (input: Readonly<{
    readonly session: PrivateDeclarativeV2AnalyzerSessionV1;
    readonly commandFactory:
      DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1;
    readonly capability: DeclarativeV2AuthenticatedCommandDecodedCapabilityV1;
    readonly transportBudget: DeclarativeV2AuthenticatedCommandIncrementalBudgetV1;
    readonly allowance: number;
  }>) => Effect.Effect<
    DeclarativeV2AnalyzerCompleteV1,
    PrivateDeclarativeV2AnalyzerHostV1Error,
    never
  >;
  readonly rehydrate: (input: Readonly<{
    readonly session: PrivateDeclarativeV2AnalyzerSessionV1;
    readonly restartFactory:
      DeclarativeV2AuthenticatedCommandRestartInputFactoryV1;
    readonly source:
      DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1;
    readonly allowance: number;
  }>) => Effect.Effect<
    DeclarativeV2AnalyzerCompleteV1,
    PrivateDeclarativeV2AnalyzerHostV1Error,
    never
  >;
  readonly openRestartEvidence: (input: Readonly<{
    readonly session: PrivateDeclarativeV2AnalyzerSessionV1;
    readonly result: DeclarativeV2AnalyzerCompleteV1;
    readonly claim: DeclarativeV2AnalyzerRestartEvidenceClaimV1;
    readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  }>) => Effect.Effect<
    PrivateDeclarativeV2AnalyzerRestartEvidenceProducerV1,
    PrivateDeclarativeV2AnalyzerHostV1Error,
    Scope.Scope
  >;
  readonly stepRestartEvidence: (
    producer: PrivateDeclarativeV2AnalyzerRestartEvidenceProducerV1,
    allowance: number,
  ) => Effect.Effect<
    DeclarativeV2VerifierRestartProducerStepV1,
    PrivateDeclarativeV2AnalyzerHostV1Error,
    never
  >;
  readonly claimTerminal: (input: Readonly<{
    readonly result: DeclarativeV2AnalyzerCompleteV1;
    readonly requestSha256: Uint8Array;
    readonly outputManifest:
      DeclarativeV2VerifierCommandOutputManifestFrameV2;
    readonly commandUsage: DeclarativeV2VerifierBudgetFrameV2 & {
      readonly kind: "command_budget";
    };
    readonly resultingUsage: DeclarativeV2VerifierBudgetFrameV2 & {
      readonly kind: "attempt_usage";
    };
    readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
    readonly receipt: DeclarativeV2VerifierCommandReceiptFrameV2;
  }>) => Effect.Effect<
    DeclarativeV2TerminalAuthorityProofEncodedV1,
    PrivateDeclarativeV2AnalyzerHostV1Error,
    never
  >;
  readonly close: (
    session: unknown,
  ) => Result.Result<void, PrivateDeclarativeV2AnalyzerHostV1Error>;
}

interface HostSessionState {
  readonly analysisSession: DeclarativeV2AnalyzerSessionV1;
  readonly bindings: DeclarativeV2AnalyzerSessionBindingsV1;
  closed: boolean;
}

interface TerminalCorrelationState {
  readonly session: HostSessionState;
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
  readonly requestSha256: Uint8Array;
  readonly complete: DeclarativeV2AnalyzerCompleteV1;
  readonly futureRegistrationIntentSha256: Uint8Array | null;
  restartTerminal:
    | Extract<
      DeclarativeV2VerifierRestartProducerStepV1,
      { readonly status: "complete" }
    >
    | undefined;
  terminalClaimed: boolean;
  restartClaimed: boolean;
}

interface RestartEvidenceProducerState {
  readonly session: HostSessionState;
  readonly analysisProducer: DeclarativeV2AnalyzerRestartEvidenceProducerV1;
  readonly correlation: TerminalCorrelationState;
  closed: boolean;
}

interface CollectedCommand {
  readonly command: DeclarativeV2AnalyzerCommandV1;
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
  readonly requestSha256: Uint8Array;
  readonly futureRegistrationIntentSha256: Uint8Array | null;
}

interface CapturedRole {
  readonly chunks: Uint8Array[];
  byteLength: number;
}

interface CapturedFrame {
  readonly metadata: DeclarativeV2AuthenticatedCommandAdmittedFrameMetadataV1;
  readonly byteRoles: Map<string, CapturedRole>;
}

interface MaterializedFrame {
  readonly metadata: DeclarativeV2AuthenticatedCommandAdmittedFrameMetadataV1;
  readonly byteRoles: Map<string, Uint8Array>;
}

const hostIssue = (
  operation: PrivateDeclarativeV2AnalyzerHostV1Error["operation"],
  reason: PrivateDeclarativeV2AnalyzerHostV1Error["reason"],
  path?: string,
  cause?: PrivateDeclarativeV2AnalyzerHostV1Error["cause"],
): PrivateDeclarativeV2AnalyzerHostV1Error =>
  new PrivateDeclarativeV2AnalyzerHostV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });

const failClosedClaims: PrivateDeclarativeV2AnalyzerTrustedClaimsV1 =
  Object.freeze({
    session() {
      return Effect.fail(
        hostIssue("open", "invalidAdmission", "sessionAuthority"),
      );
    },
    command() {
      return Effect.fail(
        hostIssue("execute", "invalidAdmission", "commandAuthority"),
      );
    },
    restart() {
      return Effect.fail(
        hostIssue("rehydrate", "invalidAdmission", "restartAuthority"),
      );
    },
  });

export function makePrivateDeclarativeV2AnalyzerHostV1(options: {
  readonly analysis?: DeclarativeV2AnalyzerPortFactoryV1;
  readonly claims?: PrivateDeclarativeV2AnalyzerTrustedClaimsV1;
} = {}): PrivateDeclarativeV2AnalyzerHostV1 {
  const analysis = options.analysis ?? makeDeclarativeV2AnalyzerPortFactoryV1();
  const claims = options.claims ?? failClosedClaims;
  const sessions = new WeakMap<object, HostSessionState>();
  const terminalCorrelations =
    new WeakMap<object, TerminalCorrelationState>();
  const restartEvidenceProducers =
    new WeakMap<object, RestartEvidenceProducerState>();
  const claimedSessionAuthorities = new WeakSet<object>();

  const close: PrivateDeclarativeV2AnalyzerHostV1["close"] = rawSession => {
    const state = rawSession !== null && typeof rawSession === "object"
      ? sessions.get(rawSession)
      : undefined;
    if (state === undefined) {
      return Result.fail(hostIssue("close", "invalidInput", "session"));
    }
    if (state.closed) return Result.fail(hostIssue("close", "closed"));
    state.closed = true;
    sessions.delete(rawSession as object);
    return analysis.close(state.analysisSession).pipe(
      Result.mapError(cause =>
        hostIssue("close", "analysisFailure", "session", cause)
      ),
    );
  };

  const open: PrivateDeclarativeV2AnalyzerHostV1["open"] =
    Effect.fn("PrivateDeclarativeV2AnalyzerHostV1.open")(function* (authority) {
      if (
        authority === null ||
        typeof authority !== "object" ||
        claimedSessionAuthorities.has(authority)
      ) {
        return yield* Effect.fail(
          hostIssue("open", "invalidAdmission", "sessionAuthority"),
        );
      }
      claimedSessionAuthorities.add(authority);
      const bindings = yield* claims.session(authority);
      return yield* Effect.acquireRelease(
        Effect.fromResult(analysis.createSession(bindings)).pipe(
          Effect.mapError(cause =>
            hostIssue("open", "analysisFailure", "bindings", cause)
          ),
          Effect.map(analysisSession => {
            const handle = Object.freeze({
              _tag: "PrivateDeclarativeV2AnalyzerSessionV1",
            }) satisfies PrivateDeclarativeV2AnalyzerSessionV1;
            sessions.set(handle, {
              analysisSession,
              bindings: cloneSessionBindings(bindings),
              closed: false,
            });
            return handle;
          }),
        ),
        handle => Effect.sync(() => {
          const state = sessions.get(handle);
          if (state !== undefined && !state.closed) close(handle);
        }),
      );
    });

  const execute: PrivateDeclarativeV2AnalyzerHostV1["execute"] =
    Effect.fn("PrivateDeclarativeV2AnalyzerHostV1.execute")(function* (input) {
      const state = yield* Effect.fromResult(
        requireSession(sessions, input.session, "execute"),
      );
      const allowance = yield* Effect.fromResult(
        requireAllowance(input.allowance, "execute"),
      );
      const collected = yield* Effect.acquireUseRelease(
        Effect.succeed(input.capability),
        capability =>
          Effect.gen(function* () {
            const admission = yield* claims.command(
              state.bindings,
              capability,
            );
            return yield* Effect.acquireUseRelease(
              Effect.fromResult(input.commandFactory.openView({
                capability,
                budget: input.transportBudget,
              })).pipe(
                Effect.mapError(cause =>
                  hostIssue(
                    "execute",
                    "transportFailure",
                    "capability",
                    cause,
                  )
                ),
              ),
              opened => collectCommand(
                input.commandFactory,
                opened.view,
                opened.cursor,
                admission,
                state.bindings,
                input.transportBudget,
                allowance,
              ),
              opened => Effect.sync(() => {
                input.commandFactory.close(opened.view);
              }),
            );
          }),
        capability => Effect.sync(() => {
          input.commandFactory.close(capability);
        }),
      );
      const complete = yield* Effect.acquireUseRelease(
        Effect.fromResult(
          analysis.start(state.analysisSession, collected.command),
        ).pipe(
          Effect.mapError(cause =>
            hostIssue("execute", "analysisFailure", "command", cause)
          ),
        ),
        driver => driveAnalysis(analysis, driver, allowance, "execute"),
        driver => Effect.sync(() => {
          analysis.close(driver);
        }),
      );
      terminalCorrelations.set(complete, {
        session: state,
        reservation: collected.reservation,
        commandBudget: collected.commandBudget,
        requestSha256: new Uint8Array(collected.requestSha256),
        complete,
        futureRegistrationIntentSha256:
          collected.futureRegistrationIntentSha256,
        restartTerminal: undefined,
        terminalClaimed: false,
        restartClaimed: false,
      });
      return complete;
    });

  const claimTerminal: PrivateDeclarativeV2AnalyzerHostV1["claimTerminal"] =
    Effect.fn("PrivateDeclarativeV2AnalyzerHostV1.claimTerminal")(
      function* (input) {
        const correlation =
          input.result !== null && typeof input.result === "object"
            ? terminalCorrelations.get(input.result)
            : undefined;
        if (
          correlation === undefined ||
          correlation.complete !== input.result ||
          correlation.terminalClaimed ||
          correlation.session.closed
        ) {
          return yield* hostIssue(
            "claimTerminal",
            "invalidInput",
            "result",
          );
        }
        const encoded = yield* Effect.fromResult(
          buildTerminalAuthorityProof(correlation, input),
        );
        correlation.terminalClaimed = true;
        return encoded;
      },
    );

  const openRestartEvidence:
    PrivateDeclarativeV2AnalyzerHostV1["openRestartEvidence"] =
      Effect.fn("PrivateDeclarativeV2AnalyzerHostV1.openRestartEvidence")(
        function* (input) {
          const state = yield* Effect.fromResult(
            requireSession(sessions, input.session, "openRestartEvidence"),
          );
          const correlation =
            input.result !== null && typeof input.result === "object"
              ? terminalCorrelations.get(input.result)
              : undefined;
          const reservationSha256 = correlation === undefined
            ? undefined
            : yield* Effect.fromResult(
              frameDigest(
                correlation.reservation,
                "restartEvidence.reservation",
                "openRestartEvidence",
              ),
            );
          if (
            correlation === undefined ||
            correlation.session !== state ||
            correlation.complete !== input.result ||
            correlation.restartClaimed ||
            input.claim.sequence !== correlation.reservation.sequence ||
            input.claim.commandKind !== correlation.reservation.commandKind ||
            reservationSha256 === undefined ||
            !isDigest(input.claim.reservationSha256) ||
            !isDigest(input.claim.authenticatedInputSha256) ||
            !bytesEqualFullScan(
              input.claim.reservationSha256,
              reservationSha256,
            ) ||
            !bytesEqualFullScan(
              input.claim.authenticatedInputSha256,
              state.bindings.authenticatedInputSha256,
            ) ||
            !restartEvidenceClaimMatchesResult(
              correlation.complete,
              input.claim,
            ) ||
            input.maximum.kind !== "command_budget" ||
            !budgetFramesEqual(input.maximum, correlation.commandBudget)
          ) {
            return yield* Effect.fail(
              hostIssue(
                "openRestartEvidence",
                "invalidAdmission",
                "result",
              ),
            );
          }
          const analysisProducer = yield* Effect.fromResult(
            analysis.openRestartEvidence({
              session: state.analysisSession,
              result: input.result,
              claim: input.claim,
              maximum: input.maximum,
            }),
          ).pipe(
            Effect.mapError(cause =>
              hostIssue(
                "openRestartEvidence",
                "analysisFailure",
                "claim",
                cause,
              )
            ),
          );
          correlation.restartClaimed = true;
          return yield* Effect.acquireRelease(
            Effect.sync(() => {
              const handle = Object.freeze({
                _tag: "PrivateDeclarativeV2AnalyzerRestartEvidenceProducerV1",
              }) satisfies PrivateDeclarativeV2AnalyzerRestartEvidenceProducerV1;
              restartEvidenceProducers.set(handle, {
                session: state,
                analysisProducer,
                correlation,
                closed: false,
              });
              return handle;
            }),
            handle => Effect.sync(() => {
              const producer = restartEvidenceProducers.get(handle);
              if (producer !== undefined && !producer.closed) {
                producer.closed = true;
                restartEvidenceProducers.delete(handle);
                if (!producer.session.closed) {
                  producer.correlation.restartClaimed = false;
                }
                analysis.close(producer.analysisProducer);
              }
            }),
          );
        },
      );

  const stepRestartEvidence:
    PrivateDeclarativeV2AnalyzerHostV1["stepRestartEvidence"] =
      Effect.fn("PrivateDeclarativeV2AnalyzerHostV1.stepRestartEvidence")(
        function* (producer, rawAllowance) {
          const allowance = yield* Effect.fromResult(
            requireAllowance(rawAllowance, "stepRestartEvidence"),
          );
          const state = restartEvidenceProducers.get(producer);
          if (
            state === undefined ||
            state.closed ||
            state.session.closed
          ) {
            return yield* Effect.fail(
              hostIssue(
                "stepRestartEvidence",
                "closed",
                "producer",
              ),
            );
          }
          const stepped = yield* Effect.fromResult(
            analysis.stepRestartEvidence(
              state.analysisProducer,
              allowance,
            ),
          ).pipe(
            Effect.mapError(cause => {
              state.closed = true;
              restartEvidenceProducers.delete(producer);
              if (!state.session.closed) {
                state.correlation.restartClaimed = false;
              }
              return hostIssue(
                "stepRestartEvidence",
                "analysisFailure",
                "producer",
                cause,
              );
            }),
          );
          if (stepped.status === "complete") {
            state.closed = true;
            restartEvidenceProducers.delete(producer);
            state.correlation.restartTerminal = stepped;
            if (state.correlation.terminalClaimed) {
              terminalCorrelations.delete(state.correlation.complete);
            }
          }
          return stepped;
        },
      );

  const rehydrate: PrivateDeclarativeV2AnalyzerHostV1["rehydrate"] =
    Effect.fn("PrivateDeclarativeV2AnalyzerHostV1.rehydrate")(function* (input) {
      const state = yield* Effect.fromResult(
        requireSession(sessions, input.session, "rehydrate"),
      );
      const allowance = yield* Effect.fromResult(
        requireAllowance(input.allowance, "rehydrate"),
      );
      return yield* Effect.acquireUseRelease(
        Effect.succeed(input.source),
        source => {
          const admission = claims.restart(state.bindings, source);
          return Effect.acquireUseRelease(
            admission,
            trusted => {
              return Effect.gen(function* () {
                const pageSource = yield* materializeRestartPageSource(
                  input.restartFactory,
                  source,
                  allowance,
                );
                return yield* Effect.acquireUseRelease(
                  Effect.fromResult(analysis.rehydrate(
                    state.analysisSession,
                    {
                      claim: trusted.claim,
                      source: pageSource,
                      maximum: trusted.maximum,
                      nextProgress: trusted.nextProgress,
                      ...(trusted.linkBindings === undefined
                        ? {}
                        : { linkBindings: trusted.linkBindings }),
                    },
                  )).pipe(
                    Effect.mapError(cause =>
                      hostIssue(
                        "rehydrate",
                        "analysisFailure",
                        "source",
                        cause,
                      )
                    ),
                  ),
                  driver =>
                    driveAnalysis(analysis, driver, allowance, "rehydrate"),
                  driver => Effect.sync(() => {
                    analysis.close(driver);
                  }),
                );
              });
            },
            () => Effect.void,
          );
        },
        source => Effect.sync(() => {
          input.restartFactory.close(source);
        }),
      );
    });

  return Object.freeze({
    open,
    execute,
    rehydrate,
    openRestartEvidence,
    stepRestartEvidence,
    claimTerminal,
    close,
  });
}

const collectCommand = Effect.fn(
  "PrivateDeclarativeV2AnalyzerHostV1.collectCommand",
)(function* (
  factory: DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
  view: unknown,
  cursor: unknown,
  admission: PrivateDeclarativeV2AnalyzerAdmissionV1,
  expectedSessionBindings: DeclarativeV2AnalyzerSessionBindingsV1,
  transportBudget: DeclarativeV2AuthenticatedCommandTransportBudgetV1,
  allowance: number,
): Effect.fn.Return<
  CollectedCommand,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
    const frames = new Map<number, CapturedFrame>();
    while (true) {
      const stepped = yield* Effect.fromResult(
        factory.stepView(view, cursor, allowance),
      ).pipe(
        Effect.mapError(cause =>
          hostIssue("execute", "transportFailure", "view", cause)
        ),
      );
      if (stepped.status === "complete") break;
      if (stepped.status === "event") {
        if (stepped.event.kind === "frame") {
          frames.set(stepped.event.metadata.frameOrdinal, {
            metadata: stepped.event.metadata,
            byteRoles: new Map(),
          });
        } else {
          const frame = frames.get(stepped.event.frameOrdinal);
          if (frame === undefined) {
            return yield* hostIssue(
              "execute",
              "invalidAdmission",
              "frameOrder",
            );
          }
          const previous = frame.byteRoles.get(stepped.event.role);
          const appended = yield* Effect.fromResult(
            appendContiguous(
              previous,
              stepped.event.offset,
              stepped.event.bytes,
              stepped.event.role,
            ),
          );
          frame.byteRoles.set(stepped.event.role, appended);
        }
      }
      yield* Effect.yieldNow;
    }
    const materialized = yield* Effect.fromResult(materializeFrames(frames));
    const requestFrames = yield* Effect.fromResult(
      materializeAuthenticatedRequest(materialized),
    );
    const encodedRequest = yield* Effect.fromResult(
      encodeDeclarativeV2AuthenticatedCommandRequestV1(
        Object.freeze({ frames: Object.freeze(requestFrames) }),
        Object.freeze({
          maximumBodyBytes: transportBudget.maximumBodyBytes,
          maximumCanonicalBytes: transportBudget.maximumCanonicalBytes,
          maximumFrameBytes: transportBudget.maximumFrameBytes,
          maximumPayloadBytes: transportBudget.maximumPayloadBytes,
          maximumFrames: transportBudget.maximumFrames,
          maximumTransitions: transportBudget.maximumTransitions,
        }),
      ).pipe(
        Result.mapError(() =>
          hostIssue("execute", "transportFailure", "request")
        ),
      ),
    );
    const requestSha256 = yield* Effect.fromResult(
      mapDigest(encodedRequest.canonicalBytes, "request"),
    );
    const command = yield* Effect.fromResult(
      materializeCommand(materialized, admission, expectedSessionBindings),
    );
    const header = materialized.get(0)!;
    const reservation = yield* Effect.fromResult(
      decodeReservation(header.byteRoles.get("reservation")),
    );
    const commandBudget = yield* Effect.fromResult(
      decodeBudget(header.byteRoles.get("command_budget")),
    );
    const commandBudgetSha256 = yield* Effect.fromResult(
      frameDigest(commandBudget, "commandBudget", "execute"),
    );
    if (
      !equalDigest(
        commandBudgetSha256,
        reservation.commandBudgetSha256,
      )
    ) {
      return yield* hostIssue(
        "execute",
        "invalidAdmission",
        "commandBudgetSha256",
      );
    }
    return Object.freeze({
      command,
      reservation,
      commandBudget,
      requestSha256,
      futureRegistrationIntentSha256:
        admission.futureRegistrationIntentSha256 === undefined
          ? null
          : new Uint8Array(admission.futureRegistrationIntentSha256),
    });
});

function buildTerminalAuthorityProof(
  correlation: TerminalCorrelationState,
  input: Parameters<
    PrivateDeclarativeV2AnalyzerHostV1["claimTerminal"]
  >[0],
): Result.Result<
  DeclarativeV2TerminalAuthorityProofEncodedV1,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  return Result.gen(function* () {
    const reservation = correlation.reservation;
    if (
      !isDigest(input.requestSha256) ||
      !equalDigest(input.requestSha256, correlation.requestSha256) ||
      input.outputManifest.commandKind !== reservation.commandKind ||
      input.outputManifest.sequence !== reservation.sequence ||
      !equalDigest(
        input.outputManifest.reservationSha256,
        yield* frameDigest(reservation, "reservation"),
      ) ||
      input.receipt.reservationSha256.byteLength !== 32 ||
      !equalDigest(
        input.receipt.reservationSha256,
        input.outputManifest.reservationSha256,
      )
    ) {
      return yield* Result.fail(
        hostIssue("claimTerminal", "invalidAdmission", "settlement"),
      );
    }
    const nextProgressSha256 = yield*
      frameDigest(input.nextProgress, "nextProgress");
    const outputManifestSha256 = yield*
      frameDigest(input.outputManifest, "outputManifest");
    const receiptSha256 = yield* frameDigest(input.receipt, "receipt");
    const commandBudgetSha256 = yield*
      frameDigest(input.commandUsage, "commandUsage");
    const resultingUsageSha256 = yield*
      frameDigest(input.resultingUsage, "resultingUsage");
    if (
      !equalDigest(
        input.outputManifest.nextProgressSha256,
        nextProgressSha256,
      ) ||
      !equalDigest(input.receipt.commandUsageSha256, commandBudgetSha256) ||
      !equalDigest(
        input.receipt.resultingAttemptUsageSha256,
        resultingUsageSha256,
      ) ||
      !equalDigest(
        input.receipt.outputManifestSha256,
        outputManifestSha256,
      ) ||
      !equalDigest(input.receipt.nextProgressSha256, nextProgressSha256)
    ) {
      return yield* Result.fail(
        hostIssue("claimTerminal", "invalidAdmission", "settlement"),
      );
    }
    const terminal = terminalVectors(correlation.complete);
    const restartTerminal = correlation.restartTerminal;
    const expectedNextProgressSha256 = terminal === undefined
      ? undefined
      : yield* frameDigest(terminal.nextProgress, "result.nextProgress");
    const expectedOutputManifestSha256 =
      terminal?.outputManifest === undefined
        ? undefined
        : yield* frameDigest(
          terminal.outputManifest,
          "result.outputManifest",
        );
    if (
      terminal === undefined ||
      terminal.commandKind !== reservation.commandKind ||
      !budgetEqual(terminal.actual, input.commandUsage) ||
      (
        (
          reservation.commandKind === "parse_module" ||
          reservation.commandKind === "link_page"
        ) &&
        (
          restartTerminal === undefined ||
          !equalDigest(
            restartTerminal.finalPageSha256,
            input.outputManifest.evidenceRootSha256,
          ) ||
          restartTerminal.recordCount !== input.outputManifest.evidenceCount ||
          !equalDigest(
            restartTerminal.diagnosticsRootSha256,
            input.outputManifest.diagnosticsRootSha256,
          ) ||
          restartTerminal.diagnosticCount !==
            input.outputManifest.diagnosticCount
        )
      ) ||
      expectedNextProgressSha256 === undefined ||
      !equalDigest(expectedNextProgressSha256, nextProgressSha256) ||
      (
        expectedOutputManifestSha256 !== undefined &&
        !equalDigest(expectedOutputManifestSha256, outputManifestSha256)
      )
    ) {
      return yield* Result.fail(
        hostIssue("claimTerminal", "invalidAdmission", "result"),
      );
    }
    const proof = encodeDeclarativeV2TerminalAuthorityProofV1({
      authorityKind: terminal.authorityKind,
      commandKind: reservation.commandKind,
      sequence: reservation.sequence,
      attemptSha256: reservation.attemptSha256,
      candidateSha256: reservation.candidateSha256,
      reservationSha256: input.outputManifest.reservationSha256,
      requestSha256: input.requestSha256,
      futureRegistrationIntentSha256:
        correlation.futureRegistrationIntentSha256,
      commandBudgetSha256: reservation.commandBudgetSha256,
      commandInputSha256: reservation.commandInputSha256,
      freshAuthenticatedInputSha256:
        reservation.freshAuthenticatedInputSha256,
      rangeAndPredecessorTailsSha256:
        reservation.rangeAndPredecessorTailsSha256,
      analyzerReleaseSha256:
        correlation.session.bindings.analyzerReleaseSha256,
      analyzerIdentitySha256: reservation.analyzerIdentitySha256,
      verifierIdentitySha256: reservation.verifierIdentitySha256,
      currentProgressSha256: reservation.currentProgressSha256,
      nextProgressSha256,
      outputManifestSha256,
      receiptSha256,
      predecessorReceiptSha256: reservation.predecessorReceiptSha256,
      authority: terminal.authority,
      actual: terminal.actual,
    });
    return yield* proof.pipe(
      Result.mapError(() =>
        hostIssue("claimTerminal", "analysisFailure", "proof")
      ),
    );
  });
}

function terminalVectors(
  complete: DeclarativeV2AnalyzerCompleteV1,
): Readonly<{
  readonly commandKind:
    | "source_page"
    | "parse_module"
    | "link_page"
    | "registration_page";
  readonly authorityKind: "exact_requirement" | "capacity";
  readonly authority: Readonly<Record<
    keyof Omit<DeclarativeV2VerifierBudgetFrameV2, "kind">,
    bigint
  >>;
  readonly actual: Readonly<Record<
    keyof Omit<DeclarativeV2VerifierBudgetFrameV2, "kind">,
    bigint
  >>;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly outputManifest?:
    DeclarativeV2VerifierCommandOutputManifestFrameV2;
}> | undefined {
  switch (complete.kind) {
    case "source_page":
      return {
        commandKind: "source_page",
        authorityKind: "exact_requirement",
        authority: usageVector(complete.result.required),
        actual: usageVector(complete.result.actual),
        nextProgress: complete.result.nextProgress,
        outputManifest: complete.result.outputManifest,
      };
    case "parse_module":
      return {
        commandKind: "parse_module",
        authorityKind: "capacity",
        authority: usageVector(complete.capacity),
        actual: usageVector(complete.actual),
        nextProgress: complete.nextProgress,
      };
    case "link_page":
      return {
        commandKind: "link_page",
        authorityKind: "capacity",
        authority: usageVector(complete.capacity),
        actual: usageVector(complete.actual),
        nextProgress: complete.nextProgress,
      };
    case "registration_page":
      return {
        commandKind: "registration_page",
        authorityKind: "capacity",
        authority: usageVector(complete.result.capacity),
        actual: usageVector(complete.result.actual),
        nextProgress: complete.result.nextProgress,
        outputManifest: complete.result.outputManifest,
      };
    case "rehydrate":
      return undefined;
  }
}

function usageVector(
  frame: Readonly<Record<string, bigint | string>>,
): Readonly<Record<string, bigint>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(frame).filter(
      (entry): entry is [string, bigint] => typeof entry[1] === "bigint",
    ),
  ));
}

function budgetEqual(
  left: Readonly<Record<string, bigint>>,
  right: DeclarativeV2VerifierBudgetFrameV2,
): boolean {
  return Object.entries(left).every(([dimension, amount]) =>
    right[dimension as keyof DeclarativeV2VerifierBudgetFrameV2] === amount
  );
}

function budgetFramesEqual(
  left: DeclarativeV2VerifierBudgetFrameV2,
  right: DeclarativeV2VerifierBudgetFrameV2,
): boolean {
  return left.kind === right.kind &&
    budgetEqual(usageVector(left), right);
}

function restartEvidenceClaimMatchesResult(
  complete: DeclarativeV2AnalyzerCompleteV1,
  claim: DeclarativeV2AnalyzerRestartEvidenceClaimV1,
): boolean {
  const terminal = terminalVectors(complete);
  return (
    terminal !== undefined &&
    (
      terminal.commandKind === "parse_module" ||
      terminal.commandKind === "link_page"
    ) &&
    claim.commandKind === terminal.commandKind &&
    claim.settledCommandUsage.kind === "attempt_usage" &&
    budgetEqual(terminal.actual, claim.settledCommandUsage)
  );
}

function frameDigest(
  frame:
    | DeclarativeV2VerifierCommandReservationFrameV2
    | DeclarativeV2VerifierCommandOutputManifestFrameV2
    | DeclarativeV2VerifierCommandReceiptFrameV2
    | DeclarativeV2VerifierBudgetFrameV2
    | DeclarativeV2VerifierProgressCursorFrameV2,
  path: string,
  operation:
    | "claimTerminal"
    | "openRestartEvidence"
    | "execute" = "claimTerminal",
): Result.Result<Uint8Array, PrivateDeclarativeV2AnalyzerHostV1Error> {
  return encodeDeclarativeV2VerifierProgressFrameV2(frame, FRAME_BUDGET).pipe(
    Result.map(result => result.canonicalBytes),
    Result.mapError(() =>
      hostIssue(operation, "invalidAdmission", path)
    ),
    Result.flatMap(bytes =>
      deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(bytes).pipe(
        Result.mapError(() =>
          hostIssue(operation, "invalidAdmission", path)
        ),
      )
    ),
  );
}

function isDigest(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(value, 32);
}

function materializeAuthenticatedRequest(
  frames: Map<number, MaterializedFrame>,
): Result.Result<
  readonly DeclarativeV2AuthenticatedCommandFrameV1[],
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  return Result.gen(function* () {
    const requestFrames: DeclarativeV2AuthenticatedCommandFrameV1[] = [];
    const ordered = [...frames.values()].sort(
      (left, right) =>
        left.metadata.frameOrdinal - right.metadata.frameOrdinal,
    );
    for (const frame of ordered) {
      switch (frame.metadata.kind) {
        case "command_header": {
          const reservation = yield* decodeReservation(
            frame.byteRoles.get("reservation"),
          );
          const commandBudget = yield* decodeBudget(
            frame.byteRoles.get("command_budget"),
          );
          if (commandBudget.kind !== "command_budget") {
            return yield* Result.fail(
              hostIssue(
                "execute",
                "invalidAdmission",
                "command_budget.kind",
              ),
            );
          }
          const authenticatedCommandBudget = Object.freeze({
            ...commandBudget,
            kind: "command_budget" as const,
          });
          requestFrames.push(Object.freeze({
            kind: "command_header",
            reservation,
            commandBudget: authenticatedCommandBudget,
          }));
          break;
        }
        case "module_metadata":
          requestFrames.push(Object.freeze({
            kind: "module_metadata",
            moduleOrdinal: frame.metadata.moduleOrdinal,
            roles: frame.metadata.roles,
            modulePathBytes: yield* requireBytes(frame, "module_path"),
            frameSha256: yield* requireBytes(frame, "frame_sha256"),
            sourceSha256: yield* requireBytes(frame, "source_sha256"),
            sourceByteLength: frame.metadata.sourceByteLength,
          }));
          break;
        case "source_bytes":
          requestFrames.push(Object.freeze({
            kind: "source_bytes",
            moduleOrdinal: frame.metadata.moduleOrdinal,
            offset: frame.metadata.offset,
            bytes: yield* requireBytes(frame, "source_payload"),
          }));
          break;
        case "semantic_bytes":
          requestFrames.push(Object.freeze({
            kind: "semantic_bytes",
            offset: frame.metadata.offset,
            bytes: yield* requireBytes(frame, "semantic_payload"),
          }));
          break;
        case "command_terminal":
          requestFrames.push(Object.freeze({
            kind: "command_terminal",
            firstModuleOrdinal: frame.metadata.firstModuleOrdinal,
            moduleCount: frame.metadata.moduleCount,
            sourceByteLength: frame.metadata.sourceByteLength,
            semanticByteLength: frame.metadata.semanticByteLength,
            payloadFrameCount: frame.metadata.payloadFrameCount,
          }));
          break;
      }
    }
    return Object.freeze(requestFrames);
  });
}

function materializeCommand(
  frames: Map<number, MaterializedFrame>,
  admission: PrivateDeclarativeV2AnalyzerAdmissionV1,
  expectedSessionBindings: DeclarativeV2AnalyzerSessionBindingsV1,
): Result.Result<
  DeclarativeV2AnalyzerCommandV1,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  return Result.gen(function* () {
    const header = frames.get(0);
    if (header?.metadata.kind !== "command_header") {
      return yield* Result.fail(
        hostIssue("execute", "invalidAdmission", "command_header"),
      );
    }
    const reservation = yield* decodeReservation(
      header.byteRoles.get("reservation"),
    );
    const commandBudget = yield* decodeBudget(
      header.byteRoles.get("command_budget"),
    );
    const reservationBytes = header.byteRoles.get("reservation")!;
    const reservationSha256 = yield* mapDigest(reservationBytes, "reservation");
    const currentProgressBytes = yield* encodeProgress(admission.currentProgress);
    const currentProgressSha256 = yield*
      mapDigest(currentProgressBytes, "currentProgress");
    if (
      !equalDigest(
        currentProgressSha256,
        reservation.currentProgressSha256,
      )
    ) {
      return yield* Result.fail(
        hostIssue("execute", "invalidAdmission", "currentProgressSha256"),
      );
    }
    const terminal = [...frames.values()].find(
      frame => frame.metadata.kind === "command_terminal",
    );
    if (terminal?.metadata.kind !== "command_terminal") {
      return yield* Result.fail(
        hostIssue("execute", "invalidAdmission", "command_terminal"),
      );
    }
    const sessionBindings = Object.freeze({
      attemptSha256: reservation.attemptSha256,
      candidateSha256: reservation.candidateSha256,
      authenticatedInputSha256: reservation.freshAuthenticatedInputSha256,
      rangeAndPredecessorTailsSha256:
        reservation.rangeAndPredecessorTailsSha256,
      analyzerReleaseSha256: admission.analyzerReleaseSha256,
      analyzerIdentitySha256: reservation.analyzerIdentitySha256,
      verifierIdentitySha256: reservation.verifierIdentitySha256,
    });
    if (!sessionBindingsEqual(sessionBindings, expectedSessionBindings)) {
      return yield* Result.fail(
        hostIssue("execute", "invalidAdmission", "sessionBindings"),
      );
    }
    const moduleFrames = [...frames.values()]
      .filter(frame => frame.metadata.kind === "module_metadata")
      .sort((left, right) =>
        left.metadata.frameOrdinal - right.metadata.frameOrdinal
      );
    switch (reservation.commandKind) {
      case "source_page": {
        const modules = yield* materializeModuleMetadataList(moduleFrames);
        let sourceByteLength = 0n;
        for (const module of modules) {
          sourceByteLength += module.sourceByteLength;
          if (sourceByteLength > MAX_I64) {
            return yield* Result.fail(
              hostIssue(
                "execute",
                "invalidAdmission",
                "sourceByteLength",
              ),
            );
          }
        }
        return Object.freeze({
          kind: "source_page",
          input: Object.freeze({
            bindings: sourceBindings(sessionBindings, reservationSha256),
            commandKind: "source_page",
            sequence: reservation.sequence,
            currentProgress: admission.currentProgress,
            predecessorReceiptSha256: reservation.predecessorReceiptSha256,
            commandBudget,
            range: Object.freeze({
              kind: "source_page",
              firstModuleOrdinal: terminal.metadata.firstModuleOrdinal,
              moduleCount: terminal.metadata.moduleCount,
              totalModuleCount: admission.totalModuleCount,
              sourceByteLength,
              semanticByteLength: 0n,
            }),
            modules,
          }),
        });
      }
      case "parse_module": {
        const module = moduleFrames[0];
        if (
          module?.metadata.kind !== "module_metadata" ||
          moduleFrames.length !== 1
        ) {
          return yield* Result.fail(
            hostIssue("execute", "invalidAdmission", "module_metadata"),
          );
        }
        const pathBytes = module.byteRoles.get("module_path");
        const sourceBytes = yield* collectPayload(frames, "source_payload");
        const modulePath = yield* modulePathHandle(pathBytes);
        return Object.freeze({
          kind: "parse_module",
          reservationSha256,
          sequence: reservation.sequence,
          moduleOrdinal: module.metadata.moduleOrdinal,
          totalModuleCount: admission.totalModuleCount,
          modulePath,
          source: sourceBytes,
          sourceSha256: yield* requireBytes(module, "source_sha256"),
          commandBudget,
          currentProgress: admission.currentProgress,
        });
      }
      case "link_page": {
        if (
          admission.nextProgress === undefined ||
          admission.futureRegistrationIntentSha256 === undefined
        ) {
          return yield* Result.fail(
            hostIssue(
              "execute",
              "invalidAdmission",
              admission.nextProgress === undefined
                ? "nextProgress"
                : "futureRegistrationIntentSha256",
            ),
          );
        }
        const nextProgressBytes = yield* encodeProgress(admission.nextProgress);
        const nextProgressSha256 = yield*
          mapDigest(nextProgressBytes, "nextProgress");
        return Object.freeze({
          kind: "link_page",
          bindings: Object.freeze({
            attemptSha256: reservation.attemptSha256,
            futureRegistrationIntentSha256:
              new Uint8Array(admission.futureRegistrationIntentSha256),
            candidateSha256: reservation.candidateSha256,
            authenticatedInputSha256: reservation.freshAuthenticatedInputSha256,
            linkSequence: reservation.sequence,
            parsePagesRootSha256: admission.parsePagesRootSha256,
            currentProgressSha256: nextProgressSha256,
            predecessorAndTailsSha256:
              reservation.rangeAndPredecessorTailsSha256,
            rangeSha256: reservation.rangeAndPredecessorTailsSha256,
            analyzerReleaseSha256: admission.analyzerReleaseSha256,
            analyzerIdentitySha256: reservation.analyzerIdentitySha256,
            verifierIdentitySha256: reservation.verifierIdentitySha256,
          }),
          commandBudget,
          currentProgress: admission.currentProgress,
          nextProgress: admission.nextProgress,
          predecessorReceiptSha256: reservation.predecessorReceiptSha256,
        });
      }
      case "registration_page": {
        if (
          admission.semanticBudget === undefined ||
          admission.futureRegistrationIntentSha256 === undefined
        ) {
          return yield* Result.fail(
            hostIssue(
              "execute",
              "invalidAdmission",
              admission.semanticBudget === undefined
                ? "semanticBudget"
                : "futureRegistrationIntentSha256",
            ),
          );
        }
        const semanticBytes = yield*
          collectPayload(frames, "semantic_payload");
        const semanticSha256 = yield* mapDigest(semanticBytes, "semanticBytes");
        return Object.freeze({
          kind: "registration_page",
          input: Object.freeze({
            bindings: Object.freeze({
              attemptSha256: reservation.attemptSha256,
              futureRegistrationIntentSha256:
                new Uint8Array(admission.futureRegistrationIntentSha256),
              candidateSha256: reservation.candidateSha256,
              authenticatedInputSha256:
                reservation.freshAuthenticatedInputSha256,
              linkSequence: reservation.sequence - 1n,
              parsePagesRootSha256: admission.parsePagesRootSha256,
              currentProgressSha256,
              predecessorAndTailsSha256:
                reservation.rangeAndPredecessorTailsSha256,
              rangeSha256: reservation.rangeAndPredecessorTailsSha256,
              analyzerReleaseSha256: admission.analyzerReleaseSha256,
              analyzerIdentitySha256: reservation.analyzerIdentitySha256,
              verifierIdentitySha256: reservation.verifierIdentitySha256,
              registrationReservationSha256: reservationSha256,
              semanticSha256,
            }),
            commandKind: "registration_page",
            sequence: reservation.sequence,
            currentProgress: admission.currentProgress,
            predecessorReceiptSha256: reservation.predecessorReceiptSha256,
            commandBudget,
            semanticBudget: admission.semanticBudget,
            semanticBytes,
          }),
        });
    }
    }
  });
}

const driveAnalysis = Effect.fn(
  "PrivateDeclarativeV2AnalyzerHostV1.driveAnalysis",
)(function* (
  analysis: DeclarativeV2AnalyzerPortFactoryV1,
  driver: unknown,
  allowance: number,
  operation: "execute" | "rehydrate",
): Effect.fn.Return<
  DeclarativeV2AnalyzerCompleteV1,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
    while (true) {
      const stepped = yield* Effect.fromResult(analysis.step(driver, allowance))
        .pipe(Effect.mapError(cause =>
          hostIssue(operation, "analysisFailure", "driver", cause)
        ));
      if (stepped.status === "complete") return stepped;
      yield* Effect.yieldNow;
    }
});

const materializeRestartPageSource = Effect.fn(
  "PrivateDeclarativeV2AnalyzerHostV1.materializeRestartPageSource",
)(function* (
  factory: DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  source: DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
  allowance: number,
): Effect.fn.Return<
  DeclarativeV2VerifierRestartPageSourceV1,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  const pages = new Map<bigint, {
    readonly metadata: Readonly<{
      readonly manifestBytes: Uint8Array;
      readonly manifestSha256: Uint8Array;
    }>;
    readonly body: Uint8Array;
  }>();
  let pageOrdinal = 0n;
  while (true) {
    const metadata = yield* Effect.gen(function* () {
      while (true) {
        const step = yield* Effect.fromResult(
          factory.metadata(source, pageOrdinal, allowance),
        ).pipe(
          Effect.mapError(cause =>
            hostIssue(
              "rehydrate",
              "transportFailure",
              "metadata",
              cause,
            )
          ),
        );
        if (step.status === "pending") {
          yield* Effect.yieldNow;
          continue;
        }
        return step.status === "complete"
          ? null
          : Object.freeze({
            manifestBytes: step.manifestBytes,
            manifestSha256: step.manifestSha256,
          });
      }
    });
    if (metadata === null) break;
    const manifest = yield* decodeRestartManifest(metadata.manifestBytes);
    const body = yield* Effect.gen(function* () {
      while (true) {
        const step = yield* Effect.fromResult(
          factory.body(
            source,
            pageOrdinal,
            manifest.payloadByteLength,
            allowance,
          ),
        ).pipe(
          Effect.mapError(cause =>
            hostIssue(
              "rehydrate",
              "transportFailure",
              "body",
              cause,
            )
          ),
        );
        if (step.status === "pending") {
          yield* Effect.yieldNow;
          continue;
        }
        return step.bytes;
      }
    });
    pages.set(pageOrdinal, { metadata, body });
    pageOrdinal += 1n;
  }
  const terminalOrdinal = pageOrdinal;
  return Object.freeze({
    metadata(ordinal: bigint) {
      if (ordinal === terminalOrdinal) return Result.succeed(null);
      const page = pages.get(ordinal);
      return page === undefined
        ? Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
          operation: "rehydrate",
          reason: "corruption",
          path: "metadata",
        }))
        : Result.succeed(page.metadata);
    },
    body(ordinal: bigint, admittedByteLength: bigint) {
      const page = pages.get(ordinal);
      if (
        page === undefined ||
        BigInt(page.body.byteLength) !== admittedByteLength
      ) {
        return Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
          operation: "rehydrate",
          reason: "corruption",
          path: "body",
        }));
      }
      pages.delete(ordinal);
      return Result.succeed(page.body);
    },
  });
});

const decodeRestartManifest = Effect.fn(
  "PrivateDeclarativeV2AnalyzerHostV1.decodeRestartManifest",
)(function* (
  bytes: Uint8Array,
): Effect.fn.Return<
  DeclarativeV2VerifierEvidencePageManifestFrameV2,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  const decoded = yield* Effect.fromResult(
    decodeDeclarativeV2VerifierProgressFrameV2(bytes, FRAME_BUDGET),
  ).pipe(
    Effect.mapError(() =>
      hostIssue(
        "rehydrate",
        "transportFailure",
        "manifest",
      )
    ),
  );
  if (decoded.frame.kind !== "evidence_page_manifest") {
    return yield* hostIssue(
      "rehydrate",
      "transportFailure",
      "manifest",
    );
  }
  return decoded.frame;
});

function requireSession(
  sessions: WeakMap<object, HostSessionState>,
  session: unknown,
  operation: "execute" | "rehydrate" | "openRestartEvidence",
): Result.Result<HostSessionState, PrivateDeclarativeV2AnalyzerHostV1Error> {
  const state = session !== null && typeof session === "object"
    ? sessions.get(session)
    : undefined;
  if (state === undefined) {
    return Result.fail(hostIssue(operation, "invalidInput", "session"));
  }
  return state.closed
    ? Result.fail(hostIssue(operation, "closed", "session"))
    : Result.succeed(state);
}

function requireAllowance(
  allowance: unknown,
  operation: "execute" | "rehydrate" | "stepRestartEvidence",
): Result.Result<number, PrivateDeclarativeV2AnalyzerHostV1Error> {
  if (
    typeof allowance !== "number" ||
    !Number.isSafeInteger(allowance) ||
    allowance < 1 ||
    allowance > MAX_ALLOWANCE
  ) {
    return Result.fail(hostIssue(operation, "invalidInput", "allowance"));
  }
  return Result.succeed(allowance);
}

function appendContiguous(
  previous: CapturedRole | undefined,
  offset: number,
  bytes: Uint8Array,
  role: string,
): Result.Result<CapturedRole, PrivateDeclarativeV2AnalyzerHostV1Error> {
  const expected = previous?.byteLength ?? 0;
  if (offset !== expected) {
    return Result.fail(hostIssue("execute", "invalidAdmission", role));
  }
  const nextLength = expected + bytes.byteLength;
  if (!Number.isSafeInteger(nextLength)) {
    return Result.fail(hostIssue("execute", "invalidAdmission", role));
  }
  const output = previous ?? { chunks: [], byteLength: 0 };
  output.chunks.push(bytes);
  output.byteLength = nextLength;
  return Result.succeed(output);
}

function materializeFrames(
  frames: Map<number, CapturedFrame>,
): Result.Result<
  Map<number, MaterializedFrame>,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  const output = new Map<number, MaterializedFrame>();
  for (const [ordinal, frame] of frames) {
    const roles = new Map<string, Uint8Array>();
    for (const [role, captured] of frame.byteRoles) {
      const bytes = new Uint8Array(captured.byteLength);
      let offset = 0;
      for (const chunk of captured.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (offset !== captured.byteLength) {
        return Result.fail(hostIssue("execute", "invalidAdmission", role));
      }
      roles.set(role, bytes);
      captured.chunks.splice(0);
      captured.byteLength = 0;
    }
    output.set(ordinal, { metadata: frame.metadata, byteRoles: roles });
  }
  return Result.succeed(output);
}

function decodeReservation(
  bytes: Uint8Array | undefined,
): Result.Result<
  DeclarativeV2VerifierCommandReservationFrameV2,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  return Result.gen(function* () {
    const decoded = yield* decodeProgress(bytes, "reservation");
    return decoded.kind === "command_reservation"
      ? decoded
      : yield* Result.fail(
        hostIssue("execute", "invalidAdmission", "reservation"),
      );
  });
}

function decodeBudget(
  bytes: Uint8Array | undefined,
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  return Result.gen(function* () {
    const decoded = yield* decodeProgress(bytes, "commandBudget");
    return decoded.kind === "command_budget"
      ? decoded
      : yield* Result.fail(
        hostIssue("execute", "invalidAdmission", "commandBudget"),
      );
  });
}

function decodeProgress(bytes: Uint8Array | undefined, path: string) {
  if (bytes === undefined) {
    return Result.fail(hostIssue("execute", "invalidAdmission", path));
  }
  return decodeDeclarativeV2VerifierProgressFrameV2(bytes, {
    maximumFrameBytes: bytes.byteLength,
    maximumCanonicalBytes: bytes.byteLength,
  }).pipe(
    Result.map(result => result.frame),
    Result.mapError(() => hostIssue("execute", "invalidAdmission", path)),
  );
}

function mapDigest(
  bytes: Uint8Array,
  path: string,
): Result.Result<Uint8Array, PrivateDeclarativeV2AnalyzerHostV1Error> {
  return deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(bytes).pipe(
    Result.mapError(() => hostIssue("execute", "invalidAdmission", path)),
  );
}

function encodeProgress(
  frame: DeclarativeV2VerifierProgressCursorFrameV2,
): Result.Result<Uint8Array, PrivateDeclarativeV2AnalyzerHostV1Error> {
  return encodeDeclarativeV2VerifierProgressFrameV2(
    frame,
    FRAME_BUDGET,
  ).pipe(
    Result.map(result => result.canonicalBytes),
    Result.mapError(() =>
      hostIssue("execute", "invalidAdmission", "currentProgress")
    ),
  );
}

function materializeModuleMetadataList(
  frames: readonly MaterializedFrame[],
): Result.Result<
  ReadonlyArray<{
    readonly moduleOrdinal: bigint;
    readonly roles: SourceArtifactV2ModuleRolesV1;
    readonly modulePathBytes: Uint8Array;
    readonly frameSha256: Uint8Array;
    readonly sourceSha256: Uint8Array;
    readonly sourceByteLength: bigint;
  }>,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  return Result.gen(function* () {
    const output = [];
    for (const frame of frames) {
      if (frame.metadata.kind !== "module_metadata") {
        return yield* Result.fail(
          hostIssue("execute", "invalidAdmission", "module_metadata"),
        );
      }
      output.push(Object.freeze({
        moduleOrdinal: frame.metadata.moduleOrdinal,
        roles: frame.metadata.roles as SourceArtifactV2ModuleRolesV1,
        modulePathBytes: yield* requireBytes(frame, "module_path"),
        frameSha256: yield* requireBytes(frame, "frame_sha256"),
        sourceSha256: yield* requireBytes(frame, "source_sha256"),
        sourceByteLength: frame.metadata.sourceByteLength,
      }));
    }
    return Object.freeze(output);
  });
}

function requireBytes(
  frame: MaterializedFrame,
  role: string,
): Result.Result<Uint8Array, PrivateDeclarativeV2AnalyzerHostV1Error> {
  const bytes = frame.byteRoles.get(role);
  if (bytes === undefined) {
    return Result.fail(hostIssue("execute", "invalidAdmission", role));
  }
  return Result.succeed(bytes);
}

function collectPayload(
  frames: Map<number, MaterializedFrame>,
  role: "source_payload" | "semantic_payload",
): Result.Result<Uint8Array, PrivateDeclarativeV2AnalyzerHostV1Error> {
  const chunks = [...frames.values()]
    .filter(frame => frame.byteRoles.has(role))
    .sort((left, right) =>
      left.metadata.frameOrdinal - right.metadata.frameOrdinal
    )
    .map(frame => frame.byteRoles.get(role)!);
  let byteLength = 0;
  for (const chunk of chunks) {
    byteLength += chunk.byteLength;
    if (!Number.isSafeInteger(byteLength)) {
      return Result.fail(hostIssue("execute", "invalidAdmission", role));
    }
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Result.succeed(output);
}

function modulePathHandle(
  bytes: Uint8Array | undefined,
): Result.Result<
  DeclarativeV2ArtifactModulePathHandleV1,
  PrivateDeclarativeV2AnalyzerHostV1Error
> {
  if (bytes === undefined) {
    return Result.fail(hostIssue("execute", "invalidAdmission", "module_path"));
  }
  const maximumCalls = Math.ceil(bytes.byteLength / MAX_ALLOWANCE) + 2;
  if (!Number.isSafeInteger(maximumCalls)) {
    return Result.fail(hostIssue("execute", "invalidAdmission", "module_path"));
  }
  const created = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
    maximumCalls,
    bytes.byteLength,
    bytes.byteLength,
  );
  if (Result.isFailure(created)) {
    return Result.fail(hostIssue("execute", "invalidAdmission", "module_path"));
  }
  let offset = 0;
  while (offset < bytes.byteLength) {
    const stepped = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      created.success,
      bytes.subarray(offset),
      MAX_ALLOWANCE,
    );
    if (
      Result.isFailure(stepped) ||
      (stepped.success.consumedBytes === 0 &&
        stepped.success.transitionCount === 0)
    ) {
      return Result.fail(
        hostIssue("execute", "invalidAdmission", "module_path"),
      );
    }
    offset += stepped.success.consumedBytes;
  }
  while (true) {
    const finished = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(
      created.success,
      MAX_ALLOWANCE,
    );
    if (Result.isFailure(finished)) {
      return Result.fail(
        hostIssue("execute", "invalidAdmission", "module_path"),
      );
    }
    if (!("status" in finished.success)) {
      return Result.succeed(finished.success);
    }
    if (finished.success.transitionCount === 0) {
      return Result.fail(
        hostIssue("execute", "invalidAdmission", "module_path"),
      );
    }
  }
}

function sourceBindings(
  session: DeclarativeV2AnalyzerSessionBindingsV1,
  reservationSha256: Uint8Array,
) {
  return Object.freeze({
    attemptSha256: session.attemptSha256,
    candidateSha256: session.candidateSha256,
    reservationSha256,
    authenticatedInputSha256: session.authenticatedInputSha256,
    rangeAndPredecessorTailsSha256:
      session.rangeAndPredecessorTailsSha256,
    analyzerIdentitySha256: session.analyzerIdentitySha256,
    verifierIdentitySha256: session.verifierIdentitySha256,
  });
}

function equalDigest(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function cloneSessionBindings(
  bindings: DeclarativeV2AnalyzerSessionBindingsV1,
): DeclarativeV2AnalyzerSessionBindingsV1 {
  return Object.freeze({
    attemptSha256: new Uint8Array(bindings.attemptSha256),
    candidateSha256: new Uint8Array(bindings.candidateSha256),
    authenticatedInputSha256:
      new Uint8Array(bindings.authenticatedInputSha256),
    rangeAndPredecessorTailsSha256:
      new Uint8Array(bindings.rangeAndPredecessorTailsSha256),
    analyzerReleaseSha256: new Uint8Array(bindings.analyzerReleaseSha256),
    analyzerIdentitySha256: new Uint8Array(bindings.analyzerIdentitySha256),
    verifierIdentitySha256: new Uint8Array(bindings.verifierIdentitySha256),
  });
}

function sessionBindingsEqual(
  left: DeclarativeV2AnalyzerSessionBindingsV1,
  right: DeclarativeV2AnalyzerSessionBindingsV1,
): boolean {
  return equalDigest(left.attemptSha256, right.attemptSha256) &&
    equalDigest(left.candidateSha256, right.candidateSha256) &&
    equalDigest(
      left.authenticatedInputSha256,
      right.authenticatedInputSha256,
    ) &&
    equalDigest(
      left.rangeAndPredecessorTailsSha256,
      right.rangeAndPredecessorTailsSha256,
    ) &&
    equalDigest(left.analyzerReleaseSha256, right.analyzerReleaseSha256) &&
    equalDigest(left.analyzerIdentitySha256, right.analyzerIdentitySha256) &&
    equalDigest(left.verifierIdentitySha256, right.verifierIdentitySha256);
}
