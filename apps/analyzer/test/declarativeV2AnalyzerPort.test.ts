import { createHash } from "node:crypto";

import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  driveDeclarativeV2VerifierParseModuleTerminalV1,
  type DeclarativeV2AnalyzerPortFactoryV1,
  type DeclarativeV2AnalyzerSessionBindingsV1,
  type DeclarativeV2ArtifactModulePathHandleV1,
  type DeclarativeV2VerifierModuleResultV1,
  type DeclarativeV2VerifierRestartClaimV1,
  type DeclarativeV2VerifierRestartPageV1,
  makeDeclarativeV2AnalyzerPortFactoryV1,
  makeDeclarativeV2SemanticStreamBudgetV1,
  makeDeclarativeV2VerifierRestartRuntimeFactoryV1,
  planDeclarativeV2VerifierParseCapacityV1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  type CanonicalDeclarativeProgramInputV1,
} from "@flarex/declarative-program/v1";
import type {
  DeclarativeV2PrebuiltModuleGraphInputV1,
} from "@flarex/declarative-materializer/v1";
import {
  encodeDeclarativeV2AuthenticatedCommandRequestV1,
  makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
  type DeclarativeV2AuthenticatedCommandFrameV1,
  type DeclarativeV2AuthenticatedCommandIncrementalBudgetV1,
  type DeclarativeV2AuthenticatedCommandRequestV1,
} from "@flarex/executor-http/internal-declarative-v2-authenticated-command-v1";
import {
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_FRAMES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_PAGES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1,
  makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error,
  type DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
  type DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
  type DeclarativeV2AuthenticatedCommandRestartInputClaimV1,
  type DeclarativeV2AuthenticatedCommandRestartInputFrameV1,
  type DeclarativeV2AuthenticatedCommandRestartInputSourceV1,
} from "@flarex/executor-http/internal-declarative-v2-authenticated-command-restart-input-v1";
import {
  analyzeStandardApplicationV1,
} from "@flarex/standard-application-analysis/v1";
import {
  prepareStandardApplicationDefinitionV1,
  type PreparedStandardApplicationDefinitionV1,
  type StandardApplicationDefinitionInputV1,
} from "@flarex/standard-application-definition/v1";
import {
  DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error,
  type DeclarativeV2VerifierProgressEvidencePageSnapshotV2,
  type DeclarativeV2VerifierProgressSettlementSnapshotV2,
} from "@flarex/persistence-postgres/internal/authenticated-declarative-v2-command-bridge-v1";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import {
  encodeDeclarativeV2SemanticRecordPayloadV1,
  encodeDeclarativeV2SemanticRecordV1,
  type DeclarativeV2SemanticRecordV1,
} from "flarex-protocol/internal/declarative-v2-semantic-record-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierCommandReceiptFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  decodeDeclarativeV2TerminalAuthorityProofV1,
} from "flarex-protocol/internal/declarative-v2-terminal-authority-proof-v1";
import { describe, expect, it } from "vitest";

import {
  makePrivateDeclarativeV2AnalyzerHostV1,
  PrivateDeclarativeV2AnalyzerHostV1Error,
  type PrivateDeclarativeV2AnalyzerAdmissionV1,
  type PrivateDeclarativeV2AnalyzerRestartAdmissionV1,
} from "../src/DeclarativeV2AnalyzerPort";
import {
  makePrivateStandardApplicationAnalysisContextV1,
} from "../src/StandardApplicationAnalysis";
import {
  loadPrivateDeclarativeV2SettledRestartEvidenceV1,
  persistPrivateDeclarativeV2RestartEvidenceV1,
  PrivateDeclarativeV2AnalyzerRestartPlanV1Error,
} from "../src/PrivateDeclarativeV2AnalyzerRestartPlan";

const UTF8 = new TextEncoder();
const SOURCE = "export function getThing() { return \"ok\"; }";
const MODULE_PATH = "functions/example.js";
const SEMANTIC_RECORDS = Object.freeze([
  { kind: "header", version: 1 },
  { kind: "module", modulePath: MODULE_PATH },
  {
    kind: "function",
    path: "example:getThing",
    modulePath: MODULE_PATH,
    exportName: "getThing",
    functionKind: "query",
    visibility: "public",
    argsValidatorId: "validator:args",
    returnsValidatorId: "validator:returns",
    partition: null,
  },
  { kind: "schema", schemaVersion: "1" },
  {
    kind: "validator",
    id: "validator:args",
    value: { fields: {}, type: "object" },
  },
  {
    kind: "validator",
    id: "validator:returns",
    value: { type: "string" },
  },
  {
    kind: "handler",
    functionPath: "example:getThing",
    modulePath: MODULE_PATH,
    exportName: "getThing",
  },
] satisfies ReadonlyArray<DeclarativeV2SemanticRecordV1>);

describe("private Declarative V2 analyzer Effect port", () => {
  it("runs admitted parse, link, and registration through the real private owners", async () => {
    const sessionBindings = bindings();
    const trusted = trustedHost(sessionBindings);
    const host = trusted.host;
    const prepared = preparedDefinition();
    const context = makePrivateStandardApplicationAnalysisContextV1({
      host,
      plan: Effect.fn("TestPrivateStandardApplicationAnalysis.plan")(
        function* (input: PreparedStandardApplicationDefinitionV1) {
          expect(input).toBe(prepared);
          const parseProgress = progress("parse", 0n);
          const sourceModule = prepared.artifactIngressPlan.source.modules.find(
            module => module.path === MODULE_PATH,
          );
          if (sourceModule === undefined) {
            throw new Error("Prepared definition lost the analyzed module.");
          }
          const parse = admitted(parseRequest(
            reservation("parse_module", 1n, parseProgress, sessionBindings),
            MODULE_PATH,
            sourceModule.sourceBytes,
          ));
          trusted.admitCommand(parse.capability, {
            currentProgress: parseProgress,
            totalModuleCount: 1n,
            parsePagesRootSha256: digest(20),
            analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
          });

          const linkProgress = progress("link", 1n);
          const registrationProgress = progress("registration", 2n);
          const registrationReservation = reservation(
            "registration_page",
            3n,
            registrationProgress,
            sessionBindings,
          );
          const linkReservation = reservation(
            "link_page",
            2n,
            linkProgress,
            sessionBindings,
          );
          expect(frameSha256(linkReservation)).not.toEqual(
            frameSha256(registrationReservation),
          );
          const link = admitted(linkRequest(linkReservation));
          const futureRegistrationIntentSha256 = digest(99);
          trusted.admitCommand(link.capability, {
            currentProgress: linkProgress,
            nextProgress: registrationProgress,
            futureRegistrationIntentSha256,
            totalModuleCount: 1n,
            parsePagesRootSha256: digest(20),
            analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
          });

          const semantic = prepared.artifactIngressPlan.semantic;
          const registration = admitted(registrationRequest(
            registrationReservation,
            semantic.bytes,
          ));
          trusted.admitCommand(registration.capability, {
            currentProgress: registrationProgress,
            futureRegistrationIntentSha256,
            totalModuleCount: 1n,
            parsePagesRootSha256: digest(20),
            analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
            semanticBudget: Result.getOrThrow(
              makeDeclarativeV2SemanticStreamBudgetV1(
                semantic.bytes.byteLength,
                semantic.maximumRecordBytes,
                semantic.recordCount,
                semantic.bytes.byteLength,
              ),
            ),
          });

          return Object.freeze({
            sessionAuthority: trusted.sessionAuthority,
            steps: Object.freeze([
              Object.freeze({
                kind: "execute" as const,
                commandFactory: parse.factory,
                capability: parse.capability,
                transportBudget: parse.budget,
                allowance: 1_024,
              }),
              Object.freeze({
                kind: "execute" as const,
                commandFactory: link.factory,
                capability: link.capability,
                transportBudget: link.budget,
                allowance: 1,
              }),
              Object.freeze({
                kind: "execute" as const,
                commandFactory: registration.factory,
                capability: registration.capability,
                transportBudget: registration.budget,
                allowance: 1_024,
              }),
            ]),
          });
        },
      ),
    });
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      return yield* analyzeStandardApplicationV1(prepared, context);
    })));
    expect(result).toMatchObject({
      kind: "registration_page",
      result: {
        nextProgress: { phase: "verdict", settledSequence: 3n },
      },
    });
  });

  it("rejects an empty Standard analysis plan before opening a host session", async () => {
    const context = makePrivateStandardApplicationAnalysisContextV1({
      host: makePrivateDeclarativeV2AnalyzerHostV1(),
      plan() {
        return Effect.succeed(Object.freeze({
          sessionAuthority: Object.freeze({}),
          steps: Object.freeze([]),
        }));
      },
    });

    const exit = await Effect.runPromiseExit(Effect.scoped(
      analyzeStandardApplicationV1(preparedDefinition(), context),
    ));

    if (!Exit.isFailure(exit)) {
      throw new Error("Expected the empty Standard analysis plan to fail.");
    }
    expect(Cause.findErrorOption(exit.cause)).toMatchObject({
      _tag: "Some",
      value: {
        _tag: "PrivateStandardApplicationAnalysisV1Error",
        reason: "emptyPlan",
        path: "steps",
      },
    });
  });

  it("closes current and unconsumed plan capabilities on early failure", async () => {
    const sessionBindings = bindings();
    const trusted = trustedHost(sessionBindings);
    const currentProgress = progress("parse", 0n);
    const first = admitted(parseRequest(
      reservation("parse_module", 1n, currentProgress, sessionBindings),
    ));
    const second = admitted(parseRequest(
      reservation("parse_module", 2n, currentProgress, sessionBindings),
    ));
    const context = makePrivateStandardApplicationAnalysisContextV1({
      host: trusted.host,
      plan() {
        return Effect.succeed(Object.freeze({
          sessionAuthority: trusted.sessionAuthority,
          steps: Object.freeze([
            Object.freeze({
              kind: "execute" as const,
              commandFactory: first.factory,
              capability: first.capability,
              transportBudget: first.budget,
              allowance: 0,
            }),
            Object.freeze({
              kind: "execute" as const,
              commandFactory: second.factory,
              capability: second.capability,
              transportBudget: second.budget,
              allowance: 1_024,
            }),
          ]),
        }));
      },
    });

    const exit = await Effect.runPromiseExit(Effect.scoped(
      analyzeStandardApplicationV1(preparedDefinition(), context),
    ));

    if (!Exit.isFailure(exit)) {
      throw new Error("Expected the invalid allowance to fail.");
    }
    expect(Cause.findErrorOption(exit.cause)).toMatchObject({
      _tag: "Some",
      value: {
        _tag: "PrivateDeclarativeV2AnalyzerHostV1Error",
        operation: "execute",
        reason: "invalidInput",
        path: "allowance",
      },
    });
    expect(Result.isFailure(first.factory.openView({
      capability: first.capability,
      budget: first.budget,
    }))).toBe(true);
    expect(Result.isFailure(second.factory.openView({
      capability: second.capability,
      budget: second.budget,
    }))).toBe(true);
  });

  it("continues plan cleanup after an unexpected close failure", async () => {
    const sessionBindings = bindings();
    const trusted = trustedHost(sessionBindings);
    const currentProgress = progress("parse", 0n);
    const first = admitted(parseRequest(
      reservation("parse_module", 1n, currentProgress, sessionBindings),
    ));
    const foreign = admitted(parseRequest(
      reservation("parse_module", 2n, currentProgress, sessionBindings),
    ));
    const later = admitted(parseRequest(
      reservation("parse_module", 3n, currentProgress, sessionBindings),
    ));
    trusted.admitCommand(first.capability, {
      currentProgress,
      totalModuleCount: 1n,
      parsePagesRootSha256: digest(20),
      analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
    });
    const context = makePrivateStandardApplicationAnalysisContextV1({
      host: trusted.host,
      plan() {
        return Effect.succeed(Object.freeze({
          sessionAuthority: trusted.sessionAuthority,
          steps: Object.freeze([
            Object.freeze({
              kind: "execute" as const,
              commandFactory: foreign.factory,
              capability: first.capability,
              transportBudget: first.budget,
              allowance: 1_024,
            }),
            Object.freeze({
              kind: "execute" as const,
              commandFactory: later.factory,
              capability: later.capability,
              transportBudget: later.budget,
              allowance: 1_024,
            }),
          ]),
        }));
      },
    });

    const exit = await Effect.runPromiseExit(Effect.scoped(
      analyzeStandardApplicationV1(preparedDefinition(), context),
    ));

    if (!Exit.isFailure(exit)) {
      throw new Error("Expected the mismatched factory to fail.");
    }
    const cleanupDefect = Result.getOrThrow(Cause.findDefect(exit.cause));
    expect(cleanupDefect).toBeInstanceOf(AggregateError);
    expect((cleanupDefect as AggregateError).errors).toEqual([
      expect.objectContaining({ reason: "staleAuthority" }),
    ]);
    expect(Result.isFailure(later.factory.openView({
      capability: later.capability,
      budget: later.budget,
    }))).toBe(true);
    foreign.factory.close(foreign.capability);
  });

  it("rejects a non-registration terminal result from a hostile plan", async () => {
    const sessionBindings = bindings();
    const trusted = trustedHost(sessionBindings);
    const currentProgress = progress("parse", 0n);
    const parse = admitted(parseRequest(
      reservation("parse_module", 1n, currentProgress, sessionBindings),
    ));
    trusted.admitCommand(parse.capability, {
      currentProgress,
      totalModuleCount: 1n,
      parsePagesRootSha256: digest(20),
      analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
    });
    const context = makePrivateStandardApplicationAnalysisContextV1({
      host: trusted.host,
      plan() {
        return Effect.succeed(Object.freeze({
          sessionAuthority: trusted.sessionAuthority,
          steps: Object.freeze([Object.freeze({
            kind: "execute" as const,
            commandFactory: parse.factory,
            capability: parse.capability,
            transportBudget: parse.budget,
            allowance: 1_024,
          })]),
        }));
      },
    });

    const exit = await Effect.runPromiseExit(Effect.scoped(
      analyzeStandardApplicationV1(preparedDefinition(), context),
    ));

    if (!Exit.isFailure(exit)) {
      throw new Error("Expected a non-registration terminal result to fail.");
    }
    expect(Cause.findErrorOption(exit.cause)).toMatchObject({
      _tag: "Some",
      value: {
        _tag: "PrivateStandardApplicationAnalysisV1Error",
        reason: "unexpectedTerminalResult",
        path: "terminal.kind",
        observedKind: "parse_module",
      },
    });
  });

  it("rehydrates a reconstructed-cold parse through a real claimed restart source", async () => {
    const sessionBindings = bindings();
    const cold = coldRestartFixture(sessionBindings);
    const trusted = trustedHost(sessionBindings);
    trusted.admitRestart(cold.source, {
      claim: cold.analysisClaim,
      maximum: cold.maximum,
      nextProgress: cold.nextProgress,
    });
    const host = trusted.host;
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const session = yield* host.open(trusted.sessionAuthority);
      const rehydrated = yield* host.rehydrate({
        session,
        restartFactory: cold.factory,
        source: cold.source,
        allowance: 1_024,
      });
      const linkProgress = progress("link", 1n);
      const registrationProgress = progress("registration", 2n);
      const registrationReservation = reservation(
        "registration_page",
        3n,
        registrationProgress,
        sessionBindings,
      );
      const link = admitted(linkRequest(
        reservation("link_page", 2n, linkProgress, sessionBindings),
      ));
      trusted.admitCommand(link.capability, {
        currentProgress: linkProgress,
        nextProgress: registrationProgress,
        futureRegistrationIntentSha256:
          frameSha256(registrationReservation),
        totalModuleCount: 1n,
        parsePagesRootSha256: digest(20),
        analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
      });
      const linked = yield* host.execute({
        session,
        commandFactory: link.factory,
        capability: link.capability,
        transportBudget: link.budget,
        allowance: 1,
      });
      return { rehydrated, linked };
    })));
    expect(result).toMatchObject({
      rehydrated: {
        kind: "rehydrate",
        commandKind: "parse_module",
      },
      linked: {
        kind: "link_page",
        nextProgress: { phase: "registration", settledSequence: 2n },
      },
    });
  });

  it("preserves restart transport failures in the typed host channel", async () => {
    const sessionBindings = bindings();
    const cold = coldRestartFixture(sessionBindings);
    const trusted = trustedHost(sessionBindings);
    trusted.admitRestart(cold.source, {
      claim: cold.analysisClaim,
      maximum: cold.maximum,
      nextProgress: cold.nextProgress,
    });
    const transportFailure =
      new DeclarativeV2AuthenticatedCommandRestartInputV1Error({
        operation: "metadata",
        reason: "allocationBytesExceeded",
      });
    let closeCount = 0;
    const factory: typeof cold.factory = {
      ...cold.factory,
      metadata() {
        return Result.fail(transportFailure);
      },
      close(handle: unknown) {
        closeCount += 1;
        return cold.factory.close(handle);
      },
    };
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(
      function* () {
        const session = yield* trusted.host.open(trusted.sessionAuthority);
        return yield* trusted.host.rehydrate({
          session,
          restartFactory: factory,
          source: cold.source,
          allowance: 1_024,
        });
      },
    )));
    if (!Exit.isFailure(exit)) throw new Error("expected restart failure");
    expect(Cause.findErrorOption(exit.cause)).toMatchObject({
      _tag: "Some",
      value: {
        reason: "transportFailure",
        path: "metadata",
        cause: transportFailure,
      },
    });
    expect(closeCount).toBe(1);
  });

  it("interrupts pending cold transport and releases source/session authority", async () => {
    const sessionBindings = bindings();
    const cold = coldRestartFixture(sessionBindings);
    const trusted = trustedHost(sessionBindings);
    trusted.admitRestart(cold.source, {
      claim: cold.analysisClaim,
      maximum: cold.maximum,
      nextProgress: cold.nextProgress,
    });
    let closeCount = 0;
    let metadataCalls = 0;
    const zeroUsage = Object.freeze({
      bodyBytes: 0,
      canonicalBytes: 0,
      frameBytes: 0,
      payloadBytes: 0,
      frames: 0,
      pages: 0,
      allocationBytes: 0,
      copyBytes: 0,
      scanBytes: 0,
      hashBytes: 0,
      transitions: 0,
    });
    const factory: typeof cold.factory = {
      ...cold.factory,
      metadata() {
        metadataCalls += 1;
        return Result.succeed(Object.freeze({
          status: "pending" as const,
          receipt: Object.freeze({
            delta: zeroUsage,
            aggregate: zeroUsage,
            transitionCount: 0,
          }),
        }));
      },
      close(handle: unknown) {
        closeCount += 1;
        return cold.factory.close(handle);
      },
    };
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const session = yield* trusted.host.open(trusted.sessionAuthority);
      const fiber = yield* trusted.host.rehydrate({
        session,
        restartFactory: factory,
        source: cold.source,
        allowance: 1,
      }).pipe(Effect.forkChild);
      while (metadataCalls === 0) yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
    })));
    expect(metadataCalls).toBeGreaterThan(0);
    expect(closeCount).toBe(1);
  });

  it("runs admitted source metadata through the real source owner", async () => {
    const sessionBindings = bindings();
    const trusted = trustedHost(sessionBindings);
    const current = progress("source", 0n);
    const decoded = admitted(sourceRequest(
      reservation("source_page", 1n, current, sessionBindings),
    ));
    trusted.admitCommand(decoded.capability, {
      currentProgress: current,
      totalModuleCount: 1n,
      parsePagesRootSha256: digest(20),
      analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
    });
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(
      function* () {
        const session = yield* trusted.host.open(trusted.sessionAuthority);
        return yield* trusted.host.execute({
          session,
          commandFactory: decoded.factory,
          capability: decoded.capability,
          transportBudget: decoded.budget,
          allowance: 1,
        });
      },
    )));
    expect(result).toMatchObject({
      kind: "source_page",
      result: {
        nextProgress: { phase: "parse", settledSequence: 1n },
      },
    });
  });

  it("scopes restart evidence to the exact admitted analyzer result", async () => {
    const sessionBindings = bindings();
    const trusted = trustedHost(sessionBindings);
    const current = progress("parse", 0n);
    const reserved = reservation(
      "parse_module",
      1n,
      current,
      sessionBindings,
    );
    const decoded = admitted(parseRequest(reserved));
    trusted.admitCommand(decoded.capability, {
      currentProgress: current,
      totalModuleCount: 1n,
      parsePagesRootSha256: digest(20),
      analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
    });
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(
      function* () {
        const session = yield* trusted.host.open(trusted.sessionAuthority);
        const complete = yield* trusted.host.execute({
          session,
          commandFactory: decoded.factory,
          capability: decoded.capability,
          transportBudget: decoded.budget,
          allowance: 1_024,
        });
        if (complete.kind !== "parse_module") {
          return yield* Effect.die("expected parse terminal result");
        }
        const claim = Object.freeze({
          commandKind: "parse_module" as const,
          sequence: complete.sequence,
          reservationSha256: frameSha256(reserved),
          authenticatedInputSha256:
            sessionBindings.authenticatedInputSha256,
          sourceCommitmentSha256: digest(51),
          semanticCommitmentSha256: digest(52),
          settledCommandUsage: complete.actual,
          parsePagesRootSha256: null,
          maximumPagePayloadBytes: 65_536n,
          outputManifest: null,
          outputManifestSha256: null,
          receiptSha256: null,
        });
        const forged = yield* Effect.exit(
          trusted.host.openRestartEvidence({
            session,
            result: Object.freeze({ ...complete }),
            claim,
            maximum: commandBudget(),
          }),
        );
        const mismatchedUsage = yield* Effect.exit(
          trusted.host.openRestartEvidence({
            session,
            result: complete,
            claim: Object.freeze({
              ...claim,
              settledCommandUsage: Object.freeze({
                ...claim.settledCommandUsage,
                calls: claim.settledCommandUsage.calls + 1n,
              }),
            }),
            maximum: commandBudget(),
          }),
        );
        const mismatchedMaximum = yield* Effect.exit(
          trusted.host.openRestartEvidence({
            session,
            result: complete,
            claim,
            maximum: restartBudget(complete.actual),
          }),
        );
        const wrongUsageKind = yield* Effect.exit(
          trusted.host.openRestartEvidence({
            session,
            result: complete,
            claim: Object.freeze({
              ...claim,
              settledCommandUsage: Object.freeze({
                ...claim.settledCommandUsage,
                kind: "command_budget" as const,
              }),
            }),
            maximum: commandBudget(),
          }),
        );
        const wrongMaximumKind = yield* Effect.exit(
          trusted.host.openRestartEvidence({
            session,
            result: complete,
            claim,
            maximum: Object.freeze({
              ...commandBudget(),
              kind: "attempt_usage" as const,
            }),
          }),
        );
        const persistedPages: Uint8Array[] = [];
        let appendAttempts = 0;
        const persisted =
          yield* persistPrivateDeclarativeV2RestartEvidenceV1({
            host: trusted.host,
            session,
            result: complete,
            claim,
            maximum: commandBudget(),
            allowance: 1_024,
            bridge: {
              appendEvidencePage(_work, page) {
                appendAttempts += 1;
                if (appendAttempts === 1) {
                  return Effect.fail(
                    new DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error(
                      {
                        operation: "appendEvidencePage",
                        cause: new Error("injected confirmed rollback"),
                        retryable: true,
                      },
                    ),
                  );
                }
                persistedPages.push(new Uint8Array(page.payloadBytes));
                return Effect.succeed(Object.freeze({
                  pageSha256: digest(persistedPages.length),
                  operationUsage: Object.freeze({
                    calls: 1,
                    rows: 1,
                    frameBytes: page.manifestBytes.byteLength,
                    canonicalBytes: page.manifestBytes.byteLength,
                    hashBytes: page.manifestBytes.byteLength,
                    elapsedMilliseconds: 0,
                    pages: 1,
                    payloadBytes: page.payloadBytes.byteLength,
                  }),
                }));
              },
            },
            work: Object.freeze({
              _tag: "AuthenticatedDeclarativeV2CommandWorkV1",
            }),
            pageBudget: Object.freeze({
              maximumCalls: 10_000,
              maximumRows: 10_000,
              maximumFrameBytes: 10_000_000,
              maximumCanonicalBytes: 10_000_000,
              maximumHashBytes: 10_000_000,
              maximumElapsedMilliseconds: 60_000,
              maximumPages: 1_024,
              maximumPayloadBytes: 10_000_000,
            }),
          });
        const commandUsage = Object.freeze({
          ...complete.actual,
          kind: "command_budget" as const,
        });
        const resultingUsage = Object.freeze({
          ...complete.actual,
          kind: "attempt_usage" as const,
        });
        const outputManifest = Object.freeze({
          kind: "command_output_manifest" as const,
          reservationSha256: frameSha256(reserved),
          commandKind: "parse_module" as const,
          sequence: complete.sequence,
          evidenceRootSha256: persisted.terminal.finalPageSha256,
          evidenceCount: persisted.terminal.recordCount,
          diagnosticsRootSha256:
            persisted.terminal.diagnosticsRootSha256,
          diagnosticCount: persisted.terminal.diagnosticCount,
          nextProgressSha256: frameSha256(complete.nextProgress),
        }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
        const receipt = Object.freeze({
          kind: "command_receipt" as const,
          reservationSha256: frameSha256(reserved),
          commandUsageSha256: frameSha256(commandUsage),
          resultingAttemptUsageSha256: frameSha256(resultingUsage),
          outputManifestSha256: frameSha256(outputManifest),
          nextProgressSha256: frameSha256(complete.nextProgress),
        }) satisfies DeclarativeV2VerifierCommandReceiptFrameV2;
        const mismatchedOutputManifest = Object.freeze({
          ...outputManifest,
          evidenceRootSha256: digest(0xeb),
        });
        const mismatchedReceipt = Object.freeze({
          ...receipt,
          outputManifestSha256: frameSha256(mismatchedOutputManifest),
        });
        const mismatchedTerminal = yield* Effect.exit(
          trusted.host.claimTerminal({
            result: complete,
            requestSha256: decoded.requestSha256,
            outputManifest: mismatchedOutputManifest,
            commandUsage,
            resultingUsage,
            nextProgress: complete.nextProgress,
            receipt: mismatchedReceipt,
          }),
        );
        const proof = yield* trusted.host.claimTerminal({
          result: complete,
          requestSha256: decoded.requestSha256,
          outputManifest,
          commandUsage,
          resultingUsage,
          nextProgress: complete.nextProgress,
          receipt,
        });
        return {
          appendAttempts,
          forged,
          mismatchedMaximum,
          mismatchedOutputManifest,
          mismatchedTerminal,
          mismatchedUsage,
          persisted,
          persistedPages,
          proof,
          wrongMaximumKind,
          wrongUsageKind,
        };
      },
    )));
    expect(Exit.isFailure(result.forged)).toBe(true);
    expect(Exit.isFailure(result.mismatchedUsage)).toBe(true);
    expect(Exit.isFailure(result.mismatchedMaximum)).toBe(true);
    expect(Exit.isFailure(result.mismatchedTerminal)).toBe(true);
    expect(Exit.isFailure(result.wrongUsageKind)).toBe(true);
    expect(Exit.isFailure(result.wrongMaximumKind)).toBe(true);
    expect(result.persisted.pageCount).toBeGreaterThan(0n);
    expect(result.persisted.terminal.recordCount).toBeGreaterThan(0n);
    expect(result.persistedPages).toHaveLength(
      Number(result.persisted.pageCount),
    );
    expect(result.appendAttempts).toBe(
      Number(result.persisted.pageCount) + 1,
    );
    expect(Result.getOrThrow(
      decodeDeclarativeV2TerminalAuthorityProofV1(
        result.proof.canonicalBytes,
      ),
    ).proof).toMatchObject({
      commandKind: "parse_module",
      outputManifestSha256: frameSha256({
        ...result.mismatchedOutputManifest,
        evidenceRootSha256: result.persisted.terminal.finalPageSha256,
      }),
    });
  });

  it("claims one exact analyzer terminal result once and rejects replay", async () => {
    const sessionBindings = bindings();
    const trusted = trustedHost(sessionBindings);
    const current = progress("source", 0n);
    const reserved = reservation(
      "source_page",
      1n,
      current,
      sessionBindings,
    );
    const decoded = admitted(sourceRequest(reserved));
    trusted.admitCommand(decoded.capability, {
      currentProgress: current,
      totalModuleCount: 1n,
      parsePagesRootSha256: digest(20),
      analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
    });
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(
      function* () {
        const session = yield* trusted.host.open(trusted.sessionAuthority);
        const complete = yield* trusted.host.execute({
          session,
          commandFactory: decoded.factory,
          capability: decoded.capability,
          transportBudget: decoded.budget,
          allowance: 1,
        });
        if (complete.kind !== "source_page") {
          return yield* Effect.die("expected source terminal result");
        }
        const commandUsage = Object.freeze({
          ...complete.result.actual,
          kind: "command_budget" as const,
        });
        const resultingUsage = Object.freeze({
          ...complete.result.actual,
          kind: "attempt_usage" as const,
        });
        const receipt = Object.freeze({
          kind: "command_receipt" as const,
          reservationSha256: frameSha256(reserved),
          commandUsageSha256: frameSha256(commandUsage),
          resultingAttemptUsageSha256: frameSha256(resultingUsage),
          outputManifestSha256:
            frameSha256(complete.result.outputManifest),
          nextProgressSha256: frameSha256(complete.result.nextProgress),
        }) satisfies DeclarativeV2VerifierCommandReceiptFrameV2;
        const input = Object.freeze({
          result: complete,
          requestSha256: decoded.requestSha256,
          outputManifest: complete.result.outputManifest,
          commandUsage,
          resultingUsage,
          nextProgress: complete.result.nextProgress,
          receipt,
        });
        const changedNextProgress = Object.freeze({
          ...complete.result.nextProgress,
          settledSequence: complete.result.nextProgress.settledSequence + 1n,
        });
        const changedNextProgressSha256 = frameSha256(changedNextProgress);
        const changedNextManifest = Object.freeze({
          ...complete.result.outputManifest,
          nextProgressSha256: changedNextProgressSha256,
        });
        const changedNextReceipt = Object.freeze({
          ...receipt,
          nextProgressSha256: changedNextProgressSha256,
          outputManifestSha256: frameSha256(changedNextManifest),
        });
        const changedOutputManifest = Object.freeze({
          ...complete.result.outputManifest,
          evidenceRootSha256: digest(0xee),
        });
        const changedOutputReceipt = Object.freeze({
          ...receipt,
          outputManifestSha256: frameSha256(changedOutputManifest),
        });
        const invalidClaims = yield* Effect.all([
          trusted.host.claimTerminal({
            ...input,
            requestSha256: digest(0xef),
          }).pipe(Effect.exit),
          trusted.host.claimTerminal({
            ...input,
            nextProgress: changedNextProgress,
            outputManifest: changedNextManifest,
            receipt: changedNextReceipt,
          }).pipe(Effect.exit),
          trusted.host.claimTerminal({
            ...input,
            outputManifest: changedOutputManifest,
            receipt: changedOutputReceipt,
          }).pipe(Effect.exit),
          trusted.host.claimTerminal({
            ...input,
            receipt: Object.freeze({
              ...receipt,
              resultingAttemptUsageSha256: digest(0xed),
            }),
          }).pipe(Effect.exit),
        ]);
        const proof = yield* trusted.host.claimTerminal(input);
        const replay = yield* Effect.exit(trusted.host.claimTerminal(input));
        return { invalidClaims, proof, replay };
      },
    )));
    expect(Result.getOrThrow(
      decodeDeclarativeV2TerminalAuthorityProofV1(
        result.proof.canonicalBytes,
      ),
    ).proof).toMatchObject({
      authorityKind: "exact_requirement",
      commandKind: "source_page",
      sequence: 1n,
      requestSha256: decoded.requestSha256,
    });
    expect(result.invalidClaims).toHaveLength(4);
    for (const invalid of result.invalidClaims) {
      expect(Exit.isFailure(invalid)).toBe(true);
    }
    if (!Exit.isFailure(result.replay)) {
      throw new Error("expected terminal-claim replay failure");
    }
    expect(Cause.findErrorOption(result.replay.cause)).toMatchObject({
      _tag: "Some",
      value: {
        operation: "claimTerminal",
        reason: "invalidInput",
        path: "result",
      },
    });
  });

  it("bounds settled restart evidence across all database batches", async () => {
    const sessionBindings = bindings();
    const current = progress("parse", 0n);
    const reserved = reservation(
      "parse_module",
      1n,
      current,
      sessionBindings,
    );
    const settlement = settlementSnapshot(reserved);
    let batchCalls = 0;
    const exit = await Effect.runPromiseExit(
      loadPrivateDeclarativeV2SettledRestartEvidenceV1({
        bridge: {
          readSettledEvidencePageBatch() {
            const ordinal = BigInt(batchCalls);
            batchCalls += 1;
            return Effect.succeed(Object.freeze({
              settlement,
              pages: Object.freeze([
                evidencePageSnapshot(reserved, ordinal),
              ]),
              next: batchCalls === 1
                ? Object.freeze({
                  startPageOrdinal: 1n,
                  expectedPredecessorPageSha256: digest(0xaa),
                })
                : null,
              operationUsage: Object.freeze({
                calls: 1,
                rows: 1,
                frameBytes: 1,
                canonicalBytes: 1,
                hashBytes: 1,
                elapsedMilliseconds: 0,
                pages: 1,
                payloadBytes: 1,
              }),
            }));
          },
        },
        session: Object.freeze({
          _tag: "AuthenticatedDeclarativeV2CommandSessionV1",
        }),
        commandKind: "parse_module",
        sequence: 1n,
        reservationSha256: frameSha256(reserved),
        outputManifestSha256:
          frameSha256(settlement.outputManifest),
        receiptSha256: settlement.receiptSha256,
        pageBudget: Object.freeze({
          maximumCalls: 2,
          maximumRows: 2,
          maximumFrameBytes: 1_048_576,
          maximumCanonicalBytes: 1_048_576,
          maximumHashBytes: 1_048_576,
          maximumElapsedMilliseconds: 1_000,
          maximumPages: 2,
          maximumPayloadBytes: 1,
        }),
      }),
    );
    expect(batchCalls).toBe(1);
    if (!Exit.isFailure(exit)) {
      throw new Error("expected cumulative evidence budget failure");
    }
    expect(Cause.findErrorOption(exit.cause)).toMatchObject({
      _tag: "Some",
      value: expect.objectContaining({
        _tag: "PrivateDeclarativeV2AnalyzerRestartPlanV1Error",
        operation: "loadSettledEvidence",
        reason: "budgetExceeded",
        dimension: "payloadBytes",
        observed: 2n,
        maximum: 1n,
      }) satisfies Partial<PrivateDeclarativeV2AnalyzerRestartPlanV1Error>,
    });
  });

  it("consumes complete long paths before enforcing the V1 domain limit", async () => {
    const sharedPrefix = "a/".repeat(512);
    const first = `${sharedPrefix}b.js`;
    const second = `${sharedPrefix}c.js`;
    expect(UTF8.encode(first).byteLength).toBe(1_028);
    const run = async (modulePath: string) => {
      const sessionBindings = bindings();
      const trusted = trustedHost(sessionBindings);
      const current = progress("parse", 0n);
      const decoded = admitted(parseRequest(
        reservation("parse_module", 1n, current, sessionBindings),
        modulePath,
      ));
      trusted.admitCommand(decoded.capability, {
        currentProgress: current,
        totalModuleCount: 1n,
        parsePagesRootSha256: digest(20),
        analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
      });
      return Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
        const session = yield* trusted.host.open(trusted.sessionAuthority);
        return yield* trusted.host.execute({
          session,
          commandFactory: decoded.factory,
          capability: decoded.capability,
          transportBudget: decoded.budget,
          allowance: 1_024,
        });
      })));
    };
    const [left, right] = await Promise.all([run(first), run(second)]);
    for (const exit of [left, right]) {
      if (!Exit.isFailure(exit)) throw new Error("expected domain-limit failure");
      expect(Cause.findErrorOption(exit.cause)).toMatchObject({
        _tag: "Some",
        value: {
          reason: "analysisFailure",
          cause: {
            cause: {
              reason: "domainLimitExceeded",
              path: "domainByteLength",
              observed: BigInt(UTF8.encode(first).byteLength) +
                BigInt(UTF8.encode(SOURCE).byteLength),
              maximum: 128n,
            },
          },
        },
      });
    }

    const maximumPath = `${"a/".repeat(32_766)}b.js`;
    expect(UTF8.encode(maximumPath).byteLength).toBe(65_536);
    const maximumExit = await run(maximumPath);
    if (!Exit.isFailure(maximumExit)) {
      throw new Error("expected maximum path domain-limit failure");
    }
    expect(Cause.findErrorOption(maximumExit.cause)).toMatchObject({
      _tag: "Some",
      value: {
        cause: {
          cause: {
            reason: "domainLimitExceeded",
            observed: 65_536n + BigInt(UTF8.encode(SOURCE).byteLength),
          },
        },
      },
    });
  });

  it("fails session-lineage mismatch in the typed channel and finalizes scope", async () => {
    let closeCount = 0;
    const inner = makeDeclarativeV2AnalyzerPortFactoryV1();
    const analysis = {
      ...inner,
      close(handle: unknown) {
        closeCount += 1;
        return inner.close(handle);
      },
    };
    const sessionBindings = bindings();
    const trusted = trustedHost(sessionBindings, analysis);
    const host = trusted.host;
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
      const session = yield* host.open(trusted.sessionAuthority);
      const current = progress("parse", 0n);
      const decoded = admitted(parseRequest(
        reservation("parse_module", 1n, current, {
          ...sessionBindings,
          candidateSha256: digest(99),
        }),
      ));
      trusted.admitCommand(decoded.capability, {
        currentProgress: current,
        totalModuleCount: 1n,
        parsePagesRootSha256: digest(20),
        analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
      });
      return yield* host.execute({
        session,
        commandFactory: decoded.factory,
        capability: decoded.capability,
        transportBudget: decoded.budget,
        allowance: 1_024,
      });
    })));
    if (!Exit.isFailure(exit)) throw new Error("expected typed host failure");
    const failure = Cause.findErrorOption(exit.cause);
    expect(failure).toMatchObject({
      _tag: "Some",
      value: { reason: "invalidAdmission", path: "sessionBindings" },
    });
    expect(closeCount).toBe(1);
  });

  it("preserves a trusted-claim defect as full Cause and revokes command authority", async () => {
    const sessionBindings = bindings();
    const sessionAuthority = Object.freeze({});
    const defect = new Error("trusted claim defect");
    let commandClaims = 0;
    const host = makePrivateDeclarativeV2AnalyzerHostV1({
      claims: {
        session(authority) {
          return authority === sessionAuthority
            ? Effect.succeed(sessionBindings)
            : Effect.die("unexpected session authority");
        },
        command() {
          commandClaims += 1;
          return Effect.die(defect);
        },
        restart() {
          return Effect.die("unexpected restart claim");
        },
      },
    });
    const current = progress("parse", 0n);
    const decoded = admitted(parseRequest(
      reservation("parse_module", 1n, current, sessionBindings),
    ));
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(
      function* () {
        const session = yield* host.open(sessionAuthority);
        return yield* host.execute({
          session,
          commandFactory: decoded.factory,
          capability: decoded.capability,
          transportBudget: decoded.budget,
          allowance: 1_024,
        });
      },
    )));
    if (!Exit.isFailure(exit)) throw new Error("expected trusted claim defect");
    expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(defect);
    expect(commandClaims).toBe(1);
    const reopened = decoded.factory.openView({
      capability: decoded.capability,
      budget: decoded.budget,
    });
    expect(Result.isFailure(reopened)).toBe(true);
  });

  it("interrupts bounded driving and releases both driver and scoped session", async () => {
    const inner = makeDeclarativeV2AnalyzerPortFactoryV1();
    const driver = Object.freeze({ _tag: "DeclarativeV2AnalyzerDriverV1" });
    let driverCloseCount = 0;
    let sessionCloseCount = 0;
    let started = false;
    const analysis = {
      ...inner,
      start() {
        started = true;
        return Result.succeed(driver);
      },
      step() {
        return Result.succeed(Object.freeze({
          status: "pending" as const,
          transitionCount: 1,
        }));
      },
      close(handle: unknown) {
        if (handle === driver) {
          driverCloseCount += 1;
          return Result.succeed(undefined);
        }
        sessionCloseCount += 1;
        return inner.close(handle);
      },
    };
    const sessionBindings = bindings();
    const trusted = trustedHost(sessionBindings, analysis);
    const prepared = preparedDefinition();
    const context = makePrivateStandardApplicationAnalysisContextV1({
      host: trusted.host,
      plan: Effect.fn("TestPrivateStandardApplicationAnalysis.interruptPlan")(
        function* (_input: PreparedStandardApplicationDefinitionV1) {
          const current = progress("parse", 0n);
          const decoded = admitted(parseRequest(
            reservation("parse_module", 1n, current, sessionBindings),
          ));
          trusted.admitCommand(decoded.capability, {
            currentProgress: current,
            totalModuleCount: 1n,
            parsePagesRootSha256: digest(20),
            analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
          });
          return Object.freeze({
            sessionAuthority: trusted.sessionAuthority,
            steps: Object.freeze([Object.freeze({
              kind: "execute" as const,
              commandFactory: decoded.factory,
              capability: decoded.capability,
              transportBudget: decoded.budget,
              allowance: 1,
            })]),
          });
        },
      ),
    });
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        analyzeStandardApplicationV1(prepared, context),
      );
      for (let guard = 0; guard < 10_000 && !started; guard += 1) {
        yield* Effect.yieldNow;
      }
      if (!started) return yield* Effect.die("analysis driver did not start");
      yield* Fiber.interrupt(fiber);
    })));
    expect(driverCloseCount).toBe(1);
    expect(sessionCloseCount).toBe(1);
  });
});

function trustedHost(
  sessionBindings: DeclarativeV2AnalyzerSessionBindingsV1,
  analysis?: DeclarativeV2AnalyzerPortFactoryV1,
) {
  const sessionAuthority = Object.freeze({});
  const commandAdmissions = new WeakMap<
    object,
    PrivateDeclarativeV2AnalyzerAdmissionV1
  >();
  const restartAdmissions = new WeakMap<
    object,
    PrivateDeclarativeV2AnalyzerRestartAdmissionV1
  >();
  const host = makePrivateDeclarativeV2AnalyzerHostV1({
    ...(analysis === undefined ? {} : { analysis }),
    claims: {
      session(authority) {
        return authority === sessionAuthority
          ? Effect.succeed(sessionBindings)
          : Effect.fail(new PrivateDeclarativeV2AnalyzerHostV1Error({
            operation: "open",
            reason: "invalidAdmission",
            path: "sessionAuthority",
          }));
      },
      command(_session, capability) {
        const admission = commandAdmissions.get(capability);
        return admission === undefined
          ? Effect.fail(new PrivateDeclarativeV2AnalyzerHostV1Error({
            operation: "execute",
            reason: "invalidAdmission",
            path: "commandAuthority",
          }))
          : Effect.succeed(admission);
      },
      restart(_session, source) {
        const admission = restartAdmissions.get(source);
        return admission === undefined
          ? Effect.fail(new PrivateDeclarativeV2AnalyzerHostV1Error({
            operation: "rehydrate",
            reason: "invalidAdmission",
            path: "restartAuthority",
          }))
          : Effect.succeed(admission);
      },
    },
  });
  return Object.freeze({
    host,
    sessionAuthority,
    admitCommand(
      capability: object,
      admission: PrivateDeclarativeV2AnalyzerAdmissionV1,
    ) {
      commandAdmissions.set(capability, admission);
    },
    admitRestart(
      source: object,
      admission: PrivateDeclarativeV2AnalyzerRestartAdmissionV1,
    ) {
      restartAdmissions.set(source, admission);
    },
  });
}

function preparedDefinition(): PreparedStandardApplicationDefinitionV1 {
  const input = {
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 256,
      maximumValidatorNodes: 64,
      maximumValidatorDepth: 16,
      maximumValidatorStringUtf8Bytes: 256,
    },
    programInput: {
      format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
      version: CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
      schema: { tables: [], indexes: [] },
      modules: [{
        modulePath: "example",
        functions: [{
          exportName: "getThing",
          kind: "query",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {},
          },
          returnsValidator: { type: "string" },
        }],
      }],
    } satisfies CanonicalDeclarativeProgramInputV1,
    materializationBudgetInput: {
      maximumModules: 2,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 1_024,
      maximumBytesMaterialized: 32_768,
      maximumSemanticRecords: 32,
      maximumSemanticRecordBytes: 8_192,
      maximumSemanticStreamBytes: 32_768,
    },
    graphInput: {
      modules: [
        {
          path: MODULE_PATH,
          roles: ["function", "execution"],
          sourceBytes: UTF8.encode(SOURCE),
          sourceMapBytes: null,
        },
      ],
      functionEntries: [{
        logicalModulePath: "example",
        artifactModulePath: MODULE_PATH,
      }],
      executionPath: MODULE_PATH,
      schemaPath: null,
      authPath: null,
    } satisfies DeclarativeV2PrebuiltModuleGraphInputV1,
  } satisfies StandardApplicationDefinitionInputV1;

  return Result.getOrThrow(prepareStandardApplicationDefinitionV1(input));
}

function admitted(request: DeclarativeV2AuthenticatedCommandRequestV1) {
  const transport = Object.freeze({
    maximumBodyBytes: 2_000_000,
    maximumCanonicalBytes: 2_000_000,
    maximumFrameBytes: 2_000_000,
    maximumPayloadBytes: 2_000_000,
    maximumFrames: 1_024,
    maximumTransitions: 4_000_000,
  });
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2AuthenticatedCommandRequestV1(request, transport),
  );
  const budget = Object.freeze({
    ...transport,
    maximumAllocationBytes: 8_000_000,
    maximumCopyBytes: 8_000_000,
  }) satisfies DeclarativeV2AuthenticatedCommandIncrementalBudgetV1;
  const factory =
    makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1();
  const created = Result.getOrThrow(factory.create({
    bodyByteLength: encoded.canonicalBytes.byteLength,
    budget,
  }));
  let offset = 0;
  while (offset < encoded.canonicalBytes.byteLength) {
    const stepped = Result.getOrThrow(factory.step(
      created.decoder,
      encoded.canonicalBytes.subarray(offset),
      1_024,
    ));
    if (stepped.consumedBytes === 0) {
      throw new Error("authenticated command decoder made no progress");
    }
    offset += stepped.consumedBytes;
  }
  for (;;) {
    const finished = Result.getOrThrow(factory.finish(created.decoder, 1_024));
    if (finished.status === "complete") {
      return Object.freeze({
        factory,
        capability: finished.capability,
        budget,
        requestSha256: sha256(encoded.canonicalBytes),
      });
    }
  }
}

function coldRestartFixture(
  sessionBindings: DeclarativeV2AnalyzerSessionBindingsV1,
) {
  const module = runModule(sessionBindings);
  const producerAuthority = Object.freeze({});
  const baseClaim = Object.freeze({
    commandKind: "parse_module",
    sequence: 1n,
    reservationSha256: digest(50),
    authenticatedInputSha256: sessionBindings.authenticatedInputSha256,
    sourceCommitmentSha256: digest(51),
    semanticCommitmentSha256: digest(52),
    settledCommandUsage: module.usage,
    parsePagesRootSha256: null,
    maximumPagePayloadBytes: 65_536n,
    outputManifest: null,
    outputManifestSha256: null,
    receiptSha256: null,
    resultAuthority: module,
    parseModuleResults: null,
  } satisfies DeclarativeV2VerifierRestartClaimV1);
  const runtime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
    claim(authority, operation) {
      return authority === producerAuthority && operation === "produce"
        ? Result.succeed(baseClaim)
        : Result.fail(new Error("unexpected restart claim") as never);
    },
  });
  const maximum = restartBudget(module.usage);
  const producer = Result.getOrThrow(runtime.createProducer({
    authority: producerAuthority,
    maximum,
  }));
  const pages: DeclarativeV2VerifierRestartPageV1[] = [];
  let complete:
    | Extract<
      ReturnType<typeof runtime.stepProducer> extends Result.Result<
        infer A,
        unknown
      > ? A : never,
      { readonly status: "complete" }
    >
    | undefined;
  for (let guard = 0; ; guard += 1) {
    if (guard >= 100_000) throw new Error("restart producer stalled");
    const stepped = Result.getOrThrow(runtime.stepProducer(producer, 1_024));
    if (stepped.status === "page") pages.push(stepped.page);
    if (stepped.status === "complete") {
      complete = stepped;
      break;
    }
  }
  if (complete === undefined) throw new Error("restart producer did not finish");
  const nextProgress = progress("link", 1n);
  const outputManifest = Object.freeze({
    kind: "command_output_manifest",
    reservationSha256: baseClaim.reservationSha256,
    commandKind: "parse_module",
    sequence: 1n,
    evidenceRootSha256: complete.finalPageSha256,
    evidenceCount: complete.recordCount,
    diagnosticsRootSha256: complete.diagnosticsRootSha256,
    diagnosticCount: complete.diagnosticCount,
    nextProgressSha256: frameSha256(nextProgress),
  } satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2);
  const outputManifestSha256 = frameSha256(outputManifest);
  const receiptSha256 = digest(54);
  const analysisClaim = Object.freeze({
    ...baseClaim,
    settledCommandUsage: complete.actualUsage,
    outputManifest,
    outputManifestSha256,
    receiptSha256,
    resultAuthority: null,
  } satisfies DeclarativeV2VerifierRestartClaimV1);
  const payloads = pages.map(page => page.payloadBytes);
  const manifestBytes = pages.map(page => page.manifestBytes);
  const payloadBytes = concat(payloads);
  const restartFrames: DeclarativeV2AuthenticatedCommandRestartInputFrameV1[] = [
    Object.freeze({
      kind: "restart_header",
      targetRequestSha256: digest(60),
      targetReservationSha256: digest(61),
      targetCommandKind: "link_page",
      targetSequence: 2n,
      analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
      analyzerIdentitySha256: sessionBindings.analyzerIdentitySha256,
      verifierIdentitySha256: sessionBindings.verifierIdentitySha256,
      rangeAndPredecessorTailsSha256:
        sessionBindings.rangeAndPredecessorTailsSha256,
      sourceReservationSha256: baseClaim.reservationSha256,
      sourceCommandKind: "parse_module",
      sourceSequence: 1n,
      sourceAuthenticatedInputSha256:
        sessionBindings.authenticatedInputSha256,
      sourceOutputManifestSha256: outputManifestSha256,
      sourceSettledReceiptSha256: receiptSha256,
    }),
    Object.freeze({ kind: "source_output_manifest", frame: outputManifest }),
    ...pages.map(page => Object.freeze({
      kind: "page_manifest" as const,
      frame: page.manifest,
    })),
    Object.freeze({
      kind: "restart_terminal",
      pageCount: BigInt(pages.length),
      payloadByteLength: BigInt(payloadBytes.byteLength),
      finalPageSha256: complete.finalPageSha256,
      manifestSequenceSha256: sha256(concat(manifestBytes)),
      payloadSha256: sha256(payloadBytes),
    }),
  ];
  for (let pageOrdinal = 0; pageOrdinal < payloads.length; pageOrdinal += 1) {
    const payload = payloads[pageOrdinal]!;
    for (
      let offset = 0;
      offset < payload.byteLength;
      offset +=
        DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1
    ) {
      restartFrames.push(Object.freeze({
        kind: "payload",
        pageOrdinal: BigInt(pageOrdinal),
        offset: BigInt(offset),
        bytes: payload.subarray(
          offset,
          Math.min(
            offset +
              DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1,
            payload.byteLength,
          ),
        ),
      }));
    }
  }
  const restartBudgetValue = restartTransportBudget();
  const encoderFactory =
    makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
  const encoder = Result.getOrThrow(encoderFactory.createEncoder({
    budget: restartBudgetValue,
  })).encoder;
  for (const frame of restartFrames) {
    for (let guard = 0; ; guard += 1) {
      if (guard >= 100_000) throw new Error("restart append stalled");
      const appended = Result.getOrThrow(
        encoderFactory.append(encoder, frame, 1_024),
      );
      if (appended.status === "accepted") break;
    }
  }
  let wireSource:
    | DeclarativeV2AuthenticatedCommandRestartInputSourceV1
    | undefined;
  for (let guard = 0; ; guard += 1) {
    if (guard >= 100_000) throw new Error("restart encoder finish stalled");
    const finished = Result.getOrThrow(
      encoderFactory.finishEncoder(encoder, 1_024),
    );
    if (finished.status === "complete") {
      wireSource = finished.source;
      break;
    }
  }
  if (wireSource === undefined) {
    throw new Error("restart encoder did not finish");
  }
  const chunks: Uint8Array[] = [];
  for (let guard = 0; ; guard += 1) {
    if (guard >= 100_000) throw new Error("restart wire source stalled");
    const stepped = Result.getOrThrow(
      encoderFactory.stepWire(wireSource, 1_024),
    );
    if (stepped.status === "chunk") chunks.push(stepped.bytes);
    if (stepped.status === "complete") break;
  }
  const wireBytes = concat(chunks);
  const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
  const decoder = Result.getOrThrow(factory.createDecoder({
    bodyByteLength: wireBytes.byteLength,
    budget: restartBudgetValue,
  })).decoder;
  let offset = 0;
  let decodeGuard = 0;
  while (offset < wireBytes.byteLength) {
    if (decodeGuard >= 100_000) throw new Error("restart decoder stalled");
    decodeGuard += 1;
    const stepped = Result.getOrThrow(
      factory.stepDecoder(decoder, wireBytes.subarray(offset), 1_024),
    );
    if (stepped.consumedBytes === 0) {
      Result.getOrThrow(factory.finishDecoder(decoder, 1_024));
    }
    offset += stepped.consumedBytes;
  }
  let rawSource:
    | DeclarativeV2AuthenticatedCommandRestartInputSourceV1
    | undefined;
  for (let guard = 0; ; guard += 1) {
    if (guard >= 100_000) throw new Error("restart decoder finish stalled");
    const finished = Result.getOrThrow(factory.finishDecoder(decoder, 1_024));
    if (finished.status === "complete") {
      rawSource = finished.source;
      break;
    }
  }
  if (rawSource === undefined) {
    throw new Error("restart decoder did not finish");
  }
  const sourceClaim = restartSourceClaim(restartFrames);
  let source:
    | DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1
    | undefined;
  for (let guard = 0; ; guard += 1) {
    if (guard >= 100_000) throw new Error("restart claim stalled");
    const claimed = Result.getOrThrow(
      factory.claimSource(rawSource, sourceClaim, 1_024),
    );
    if (claimed.status === "complete") {
      source = claimed.source;
      break;
    }
  }
  if (source === undefined) {
    throw new Error("restart source claim did not finish");
  }
  return Object.freeze({
    factory,
    source,
    analysisClaim,
    maximum,
    nextProgress,
  });
}

function runModule(
  sessionBindings: DeclarativeV2AnalyzerSessionBindingsV1,
): DeclarativeV2VerifierModuleResultV1 {
  const source = UTF8.encode(SOURCE);
  const expectedBindings = Object.freeze({
    candidateSha256: sessionBindings.candidateSha256,
    authenticatedInputSha256: sessionBindings.authenticatedInputSha256,
    rangeAndPredecessorTailsSha256:
      sessionBindings.rangeAndPredecessorTailsSha256,
    analyzerIdentitySha256: sessionBindings.analyzerIdentitySha256,
    verifierIdentitySha256: sessionBindings.verifierIdentitySha256,
  });
  const plan = Result.getOrThrow(planDeclarativeV2VerifierParseCapacityV1({
    bindings: expectedBindings,
    commandKind: "parse_module",
    sequence: 1n,
    moduleOrdinal: 0n,
    modulePath: artifactModulePath(MODULE_PATH),
    source,
    sourceSha256: sha256(source),
    commandBudget: commandBudget(),
  }, expectedBindings));
  return Result.getOrThrow(
    driveDeclarativeV2VerifierParseModuleTerminalV1(plan.claim, 1_024),
  ).result;
}

function artifactModulePath(
  spelling: string,
): DeclarativeV2ArtifactModulePathHandleV1 {
  const bytes = UTF8.encode(spelling);
  const created = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      3,
      bytes.byteLength,
      bytes.byteLength,
    ),
  );
  Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(created, bytes, 1_024),
  );
  const finished = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(created, 1_024),
  );
  if ("status" in finished) throw new Error("module path did not finish");
  return finished;
}

function parseRequest(
  reservationFrame: DeclarativeV2VerifierCommandReservationFrameV2,
  modulePath = MODULE_PATH,
  source: Uint8Array = UTF8.encode(SOURCE),
): DeclarativeV2AuthenticatedCommandRequestV1 {
  const split = Math.min(17, source.byteLength);
  return {
    frames: [
      header(reservationFrame),
      {
        kind: "module_metadata",
        moduleOrdinal: 0n,
        roles: 3,
        modulePathBytes: UTF8.encode(modulePath),
        frameSha256: digest(30),
        sourceSha256: sha256(source),
        sourceByteLength: BigInt(source.byteLength),
      },
      {
        kind: "source_bytes",
        moduleOrdinal: 0n,
        offset: 0n,
        bytes: source.subarray(0, split),
      },
      {
        kind: "source_bytes",
        moduleOrdinal: 0n,
        offset: BigInt(split),
        bytes: source.subarray(split),
      },
      terminal({
        firstModuleOrdinal: 0n,
        moduleCount: 1n,
        sourceByteLength: BigInt(source.byteLength),
        payloadFrameCount: 3n,
      }),
    ],
  };
}

function sourceRequest(
  reservationFrame: DeclarativeV2VerifierCommandReservationFrameV2,
): DeclarativeV2AuthenticatedCommandRequestV1 {
  const source = UTF8.encode(SOURCE);
  return {
    frames: [
      header(reservationFrame),
      {
        kind: "module_metadata",
        moduleOrdinal: 0n,
        roles: 3,
        modulePathBytes: UTF8.encode(MODULE_PATH),
        frameSha256: digest(30),
        sourceSha256: sha256(source),
        sourceByteLength: BigInt(source.byteLength),
      },
      terminal({
        firstModuleOrdinal: 0n,
        moduleCount: 1n,
        sourceByteLength: 0n,
        payloadFrameCount: 1n,
      }),
    ],
  };
}

function linkRequest(
  reservationFrame: DeclarativeV2VerifierCommandReservationFrameV2,
): DeclarativeV2AuthenticatedCommandRequestV1 {
  return { frames: [header(reservationFrame), terminal()] };
}

function registrationRequest(
  reservationFrame: DeclarativeV2VerifierCommandReservationFrameV2,
  semantic: Uint8Array,
): DeclarativeV2AuthenticatedCommandRequestV1 {
  const split = Math.min(31, semantic.byteLength);
  return {
    frames: [
      header(reservationFrame),
      { kind: "semantic_bytes", offset: 0n, bytes: semantic.subarray(0, split) },
      {
        kind: "semantic_bytes",
        offset: BigInt(split),
        bytes: semantic.subarray(split),
      },
      terminal({
        semanticByteLength: BigInt(semantic.byteLength),
        payloadFrameCount: 2n,
      }),
    ],
  };
}

function header(
  reservationFrame: DeclarativeV2VerifierCommandReservationFrameV2,
): DeclarativeV2AuthenticatedCommandFrameV1 {
  return {
    kind: "command_header",
    reservation: reservationFrame,
    commandBudget: commandBudget(),
  };
}

function terminal(
  overrides: Partial<{
    firstModuleOrdinal: bigint;
    moduleCount: bigint;
    sourceByteLength: bigint;
    semanticByteLength: bigint;
    payloadFrameCount: bigint;
  }> = {},
): DeclarativeV2AuthenticatedCommandFrameV1 {
  return {
    kind: "command_terminal",
    firstModuleOrdinal: overrides.firstModuleOrdinal ?? 0n,
    moduleCount: overrides.moduleCount ?? 0n,
    sourceByteLength: overrides.sourceByteLength ?? 0n,
    semanticByteLength: overrides.semanticByteLength ?? 0n,
    payloadFrameCount: overrides.payloadFrameCount ?? 0n,
  };
}

function reservation(
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
  sequence: bigint,
  currentProgress: DeclarativeV2VerifierProgressCursorFrameV2,
  session: DeclarativeV2AnalyzerSessionBindingsV1,
): DeclarativeV2VerifierCommandReservationFrameV2 {
  return {
    kind: "command_reservation",
    attemptSha256: session.attemptSha256,
    candidateSha256: session.candidateSha256,
    commandKind,
    sequence,
    currentProgressSha256: frameSha256(currentProgress),
    predecessorReceiptSha256: null,
    commandBudgetSha256: frameSha256(commandBudget()),
    commandInputSha256: digest(13),
    freshAuthenticatedInputSha256: session.authenticatedInputSha256,
    analyzerIdentitySha256: session.analyzerIdentitySha256,
    verifierIdentitySha256: session.verifierIdentitySha256,
    rangeAndPredecessorTailsSha256:
      session.rangeAndPredecessorTailsSha256,
  };
}

function commandBudget(): DeclarativeV2VerifierBudgetFrameV2 & {
  readonly kind: "command_budget";
} {
  return Object.freeze({
    kind: "command_budget",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        dimension === "sourceMapBytes"
          ? 0n
          : dimension === "calls"
          ? 20_000_000n
          : dimension.endsWith("Bytes")
          ? 300_000_000n
          : 20_000_000n,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
}

function progress(
  phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
  settledSequence: bigint,
): DeclarativeV2VerifierProgressCursorFrameV2 {
  return Object.freeze({
    kind: "progress_cursor",
    phase,
    settledSequence,
    moduleOrdinal: 0n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: null,
  });
}

function semanticBytes(): Uint8Array {
  const records = SEMANTIC_RECORDS.map(encodeDeclarativeV2SemanticRecordV1);
  const output = new Uint8Array(
    records.reduce((total, record) => total + record.byteLength, 0),
  );
  let offset = 0;
  for (const record of records) {
    output.set(record, offset);
    offset += record.byteLength;
  }
  return output;
}

function bindings(): DeclarativeV2AnalyzerSessionBindingsV1 {
  return Object.freeze({
    attemptSha256: digest(1),
    candidateSha256: digest(2),
    authenticatedInputSha256: digest(3),
    rangeAndPredecessorTailsSha256: digest(4),
    analyzerReleaseSha256: digest(5),
    analyzerIdentitySha256: digest(6),
    verifierIdentitySha256: digest(7),
  });
}

function frameSha256(
  frame: DeclarativeV2VerifierProgressFrameV2,
): Uint8Array {
  return sha256(frameBytes(frame));
}

function frameBytes(
  frame: DeclarativeV2VerifierProgressFrameV2,
): Uint8Array {
  return Result.getOrThrow(encodeDeclarativeV2VerifierProgressFrameV2(
    frame,
    {
      maximumFrameBytes: 1_048_576,
      maximumCanonicalBytes: 1_048_576,
    },
  )).canonicalBytes;
}

function settlementSnapshot(
  reserved: DeclarativeV2VerifierCommandReservationFrameV2,
): DeclarativeV2VerifierProgressSettlementSnapshotV2 {
  const commandUsage = commandBudget();
  const resultingUsage = Object.freeze({
    ...commandUsage,
    kind: "attempt_usage" as const,
  });
  const nextProgress = progress("parse", 1n);
  const outputManifest = Object.freeze({
    kind: "command_output_manifest" as const,
    reservationSha256: frameSha256(reserved),
    commandKind: "parse_module" as const,
    sequence: 1n,
    evidenceRootSha256: digest(0xa0),
    evidenceCount: 2n,
    diagnosticsRootSha256: digest(0xa1),
    diagnosticCount: 0n,
    nextProgressSha256: frameSha256(nextProgress),
  }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
  const receipt = Object.freeze({
    kind: "command_receipt" as const,
    reservationSha256: frameSha256(reserved),
    commandUsageSha256: frameSha256(commandUsage),
    resultingAttemptUsageSha256: frameSha256(resultingUsage),
    outputManifestSha256: frameSha256(outputManifest),
    nextProgressSha256: frameSha256(nextProgress),
  }) satisfies DeclarativeV2VerifierCommandReceiptFrameV2;
  return Object.freeze({
    commandKind: "parse_module",
    sequence: 1n,
    reservationSha256: frameSha256(reserved),
    reservation: reserved,
    reservationBytes: frameBytes(reserved),
    outputManifest,
    outputManifestBytes: frameBytes(outputManifest),
    commandUsage,
    commandUsageBytes: frameBytes(commandUsage),
    resultingUsage,
    resultingUsageBytes: frameBytes(resultingUsage),
    nextProgress,
    nextProgressBytes: frameBytes(nextProgress),
    receipt,
    receiptBytes: frameBytes(receipt),
    receiptSha256: frameSha256(receipt),
    settledAt: new Date("2026-07-31T00:00:00.000Z"),
  });
}

function evidencePageSnapshot(
  reserved: DeclarativeV2VerifierCommandReservationFrameV2,
  pageOrdinal: bigint,
): DeclarativeV2VerifierProgressEvidencePageSnapshotV2 {
  const payloadBytes = new Uint8Array([Number(pageOrdinal)]);
  const manifest = Object.freeze({
    kind: "evidence_page_manifest" as const,
    reservationSha256: frameSha256(reserved),
    commandKind: "parse_module" as const,
    sequence: 1n,
    pageOrdinal,
    firstEvidenceOrdinal: pageOrdinal,
    evidenceCount: 1n,
    firstDiagnosticOrdinal: 0n,
    diagnosticCount: 0n,
    predecessorPageSha256: pageOrdinal === 0n ? null : digest(0xaa),
    payloadByteLength: 1n,
    payloadSha256: sha256(payloadBytes),
    cumulativeDiagnosticsRootSha256: digest(0xa1),
  }) satisfies DeclarativeV2VerifierEvidencePageManifestFrameV2;
  return Object.freeze({
    manifest,
    manifestBytes: frameBytes(manifest),
    pageSha256: digest(Number(pageOrdinal) + 0xaa),
    payloadBytes,
    payloadSha256: sha256(payloadBytes),
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
  });
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function restartSourceClaim(
  frames: readonly DeclarativeV2AuthenticatedCommandRestartInputFrameV1[],
): DeclarativeV2AuthenticatedCommandRestartInputClaimV1 {
  const header = frames[0];
  const terminal = frames.find(frame => frame.kind === "restart_terminal");
  if (
    header?.kind !== "restart_header" ||
    terminal?.kind !== "restart_terminal"
  ) {
    throw new Error("restart claim requires header and terminal frames");
  }
  return Object.freeze({
    targetRequestSha256: header.targetRequestSha256,
    targetReservationSha256: header.targetReservationSha256,
    targetCommandKind: header.targetCommandKind,
    targetSequence: header.targetSequence,
    analyzerReleaseSha256: header.analyzerReleaseSha256,
    analyzerIdentitySha256: header.analyzerIdentitySha256,
    verifierIdentitySha256: header.verifierIdentitySha256,
    rangeAndPredecessorTailsSha256:
      header.rangeAndPredecessorTailsSha256,
    sourceReservationSha256: header.sourceReservationSha256,
    sourceCommandKind: header.sourceCommandKind,
    sourceSequence: header.sourceSequence,
    sourceAuthenticatedInputSha256: header.sourceAuthenticatedInputSha256,
    sourceOutputManifestSha256: header.sourceOutputManifestSha256,
    sourceSettledReceiptSha256: header.sourceSettledReceiptSha256,
    pageCount: terminal.pageCount,
    payloadByteLength: terminal.payloadByteLength,
    finalPageSha256: terminal.finalPageSha256,
    manifestSequenceSha256: terminal.manifestSequenceSha256,
    payloadSha256: terminal.payloadSha256,
  });
}

function restartTransportBudget():
  DeclarativeV2AuthenticatedCommandRestartInputBudgetV1 {
  const maximum = 20_000_000;
  return Object.freeze({
    maximumBodyBytes: maximum,
    maximumCanonicalBytes: maximum,
    maximumFrameBytes: maximum,
    maximumPayloadBytes: maximum,
    maximumFrames:
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_FRAMES_V1,
    maximumPages:
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_PAGES_V1,
    maximumAllocationBytes: maximum,
    maximumCopyBytes: maximum,
    maximumScanBytes: maximum,
    maximumHashBytes: maximum,
    maximumTransitions: maximum,
  });
}

function restartBudget(
  settled: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind: "command_budget",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        dimension === "sourceMapBytes" || dimension === "semanticBytes"
          ? 0n
          : dimension === "frameBytes"
          ? 2_000_000n
          : settled[dimension] > 1_000_000n
          ? settled[dimension] + 1_000_000n
          : 1_000_000n,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
