import { createHash } from "node:crypto";

import { Result } from "effect";
import {
  type SourceArtifactV2ModuleRolesV1,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  encodeDeclarativeV2SemanticRecordPayloadV1,
  encodeDeclarativeV2SemanticRecordV1,
  type DeclarativeV2SemanticRecordV1,
} from "flarex-protocol/internal/declarative-v2-semantic-record-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, test } from "vitest";

import {
  makeDeclarativeV2AnalyzerPortFactoryV1,
  type DeclarativeV2AnalyzerCompleteV1,
  type DeclarativeV2AnalyzerSessionBindingsV1,
} from "../src/declarativeV2AnalyzerPortV1";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "../src/declarativeV2ArtifactModulePathV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
  makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1,
  type DeclarativeV2VerifierModuleResultV1,
} from "../src/declarativeV2VerifierExecutableV1";
import {
  makeDeclarativeV2VerifierRestartRuntimeFactoryV1,
  type DeclarativeV2VerifierRestartClaimV1,
  type DeclarativeV2VerifierRestartPageV1,
  type DeclarativeV2VerifierRestartProducerV1,
  type DeclarativeV2VerifierRestartRuntimeFactoryV1,
} from "../src/declarativeV2VerifierRestartRuntimeV1";
import {
  makeDeclarativeV2SemanticStreamBudgetV1,
} from "../src/declarativeV2SemanticRecordsV1";
import {
  driveDeclarativeV2VerifierParseModuleTerminalV1,
  planDeclarativeV2VerifierParseCapacityV1,
} from "../src/declarativeV2VerifierSizingV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
} from "../src/declarativeV2VerifierV1";

const UTF8 = new TextEncoder();
const SOURCE = "export function getThing() { return \"ok\"; }";
const PARSE_DIAGNOSTIC_SOURCE =
  'import{databaseInsert}from"flarex:platform";' +
  'export function getThing(_,a){databaseInsert("recipes",a);' +
  'throw new Error("injected")}';
const LINK_DIAGNOSTIC_SOURCE =
  'import { absent } from "./missing.js"; ' +
  "export function getThing(){ return absent(); }";
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

describe("private Declarative V2 analyzer port", () => {
  test("rejects the former session-owned command range", () => {
    const port = makeDeclarativeV2AnalyzerPortFactoryV1();
    const formerBindings = Object.freeze({
      ...bindings(),
      rangeAndPredecessorTailsSha256: digest(90),
    });
    expect(port.createSession(formerBindings)).toMatchObject({
      failure: {
        reason: "invalidInput",
        path: "bindings",
      },
    });
  });

  test("rejects accessor and reflective-proxy session bindings without reading them", () => {
    const port = makeDeclarativeV2AnalyzerPortFactoryV1();
    let accessorReads = 0;
    const accessorBindings: DeclarativeV2AnalyzerSessionBindingsV1 = {
      ...bindings(),
    };
    Object.defineProperty(accessorBindings, "attemptSha256", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return digest(91);
      },
    });
    expect(port.createSession(accessorBindings)).toMatchObject({
      failure: {
        reason: "invalidInput",
        path: "bindings",
      },
    });
    expect(accessorReads).toBe(0);

    const reflectiveProxy = new Proxy(bindings(), {
      ownKeys() {
        throw new Error("reflective trap must stay recoverable");
      },
    });
    expect(port.createSession(reflectiveProxy)).toMatchObject({
      failure: {
        reason: "invalidInput",
        path: "bindings",
      },
    });
  });

  test.each([1, 1_024] as const)(
    "composes parse, link, and registration under allowance %i",
    allowance => {
      const port = makeDeclarativeV2AnalyzerPortFactoryV1();
      const sessionBindings = bindings();
      const session = Result.getOrThrow(port.createSession(sessionBindings));
      const source = UTF8.encode(SOURCE);
      const parsePredecessor = digest(18);
      const parseCommand = {
        kind: "parse_module",
        reservationSha256: digest(20),
        rangeAndPredecessorTailsSha256: digest(19),
        predecessorReceiptSha256: parsePredecessor,
        sequence: 1n,
        moduleOrdinal: 0n,
        totalModuleCount: 1n,
        modulePath: artifactModulePath(MODULE_PATH),
        source,
        sourceSha256: digest(21),
        commandBudget: budget("command_budget", source.byteLength),
        currentProgress: progress("parse", 0n),
      } as const;
      const parse = Result.getOrThrow(port.start(session, parseCommand));
      expect(Result.getOrThrow(port.step(parse, 0))).toEqual({
        status: "pending",
        transitionCount: 0,
      });
      const parsed = drive(port, parse, allowance);
      expect(parsed).toMatchObject({
        kind: "parse_module",
        actual: { kind: "attempt_usage", modules: 1n },
        nextProgress: {
          phase: "link",
          settledSequence: 1n,
          previousReceiptSha256: parsePredecessor,
        },
      });
      if (parsed.kind !== "parse_module") {
        throw new Error("parse command did not complete");
      }
      expect(port.start(session, parseCommand)).toMatchObject({
        failure: {
          reason: "invalidTransition",
          path: "command.currentProgress",
        },
      });

      const linkProgress = parsed.nextProgress;
      const linkPredecessor = digest(27);
      const registrationProgress = Object.freeze({
        ...progress("registration", 2n),
        previousReceiptSha256: linkPredecessor,
      });
      const linkBindings = Object.freeze({
        attemptSha256: sessionBindings.attemptSha256,
        futureRegistrationIntentSha256: digest(22),
        candidateSha256: sessionBindings.candidateSha256,
        authenticatedInputSha256: sessionBindings.authenticatedInputSha256,
        linkSequence: 2n,
        parsePagesRootSha256: digest(23),
        currentProgressSha256: frameSha256(registrationProgress),
        predecessorAndTailsSha256: digest(25),
        rangeSha256: digest(25),
        analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
        analyzerIdentitySha256: sessionBindings.analyzerIdentitySha256,
        verifierIdentitySha256: sessionBindings.verifierIdentitySha256,
      });
      const link = Result.getOrThrow(port.start(session, {
        kind: "link_page",
        bindings: linkBindings,
        commandBudget: budget("command_budget", 0),
        currentProgress: linkProgress,
        nextProgress: registrationProgress,
        predecessorReceiptSha256: linkPredecessor,
      }));
      const linked = drive(port, link, allowance);
      expect(linked).toMatchObject({
        kind: "link_page",
        actual: { kind: "attempt_usage", modules: 1n },
        nextProgress: { phase: "registration", settledSequence: 2n },
      });
      if (linked.kind !== "link_page") throw new Error("link did not complete");
      for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
        expect(linked.actual[dimension]).toBeLessThanOrEqual(
          linked.capacity[dimension],
        );
      }

      const semantic = semanticBytes();
      const registrationPredecessor = digest(28);
      const registration = Result.getOrThrow(port.start(session, {
        kind: "registration_page",
        input: {
          bindings: {
            ...linkBindings,
            predecessorAndTailsSha256: digest(26),
            rangeSha256: digest(26),
            registrationReservationSha256: digest(24),
            semanticSha256: sha256(semantic),
          },
          commandKind: "registration_page",
          sequence: 3n,
          currentProgress: registrationProgress,
          predecessorReceiptSha256: registrationPredecessor,
          commandBudget: budget("command_budget", semantic.byteLength),
          semanticBudget: semanticBudget(semantic),
          semanticBytes: semantic,
        },
      }));
      const registered = drive(port, registration, allowance);
      expect(registered).toMatchObject({
        kind: "registration_page",
        result: {
          actual: { kind: "attempt_usage" },
          nextProgress: { phase: "verdict", settledSequence: 3n },
        },
      });
      expect(Result.getOrThrow(port.close(session))).toBeUndefined();
    },
  );

  test.each([
    ["parse-owned", PARSE_DIAGNOSTIC_SOURCE, "parse"],
    ["link-owned", LINK_DIAGNOSTIC_SOURCE, "link"],
  ] as const)(
    "rejects %s diagnostics before registration authority",
    (_owner, source, expectedDiagnosticOwner) => {
      const attempted = driveOneModuleToRegistration(source);
      expect(attempted.parsed.kind).toBe("parse_module");
      expect(attempted.linked.kind).toBe("link_page");
      if (
        attempted.parsed.kind !== "parse_module" ||
        attempted.linked.kind !== "link_page"
      ) {
        throw new Error("diagnostic registration fixture did not terminate");
      }
      if (expectedDiagnosticOwner === "parse") {
        expect(runModule(UTF8.encode(source))).toMatchObject({
          verified: false,
        });
      } else {
        expect(runModule(UTF8.encode(source))).toMatchObject({
          verified: true,
          diagnosticCount: 0n,
        });
        expect(attempted.linked.diagnosticCount).toBeGreaterThan(0n);
      }
      expect(attempted.registration).toMatchObject({
        failure: {
          operation: "start",
          reason: "diagnosticsPresent",
          path: expectedDiagnosticOwner === "parse"
            ? "analysis.modules[0]"
            : "analysis.link",
        },
      });
      Result.getOrThrow(attempted.port.close(attempted.session));
    },
  );

  test("rejects cold-rehydrated parse diagnostics before registration authority", () => {
    const attempted = driveRehydratedModuleToRegistration(
      PARSE_DIAGNOSTIC_SOURCE,
    );
    expect(attempted.registration).toMatchObject({
      failure: {
        operation: "start",
        reason: "diagnosticsPresent",
        path: "analysis.modules[0]",
      },
    });
    Result.getOrThrow(attempted.port.close(attempted.session));
  });

  test("runs source metadata through the same accepted entry", () => {
    const port = makeDeclarativeV2AnalyzerPortFactoryV1();
    const sessionBindings = bindings();
    const session = Result.getOrThrow(port.createSession(sessionBindings));
    const sourceProgress = progress("source", 0n);
    const pathBytes = UTF8.encode(MODULE_PATH);
    const driver = Result.getOrThrow(port.start(session, {
      kind: "source_page",
      input: {
        bindings: {
          attemptSha256: sessionBindings.attemptSha256,
          candidateSha256: sessionBindings.candidateSha256,
          reservationSha256: digest(31),
          authenticatedInputSha256: sessionBindings.authenticatedInputSha256,
          rangeAndPredecessorTailsSha256: digest(34),
          analyzerIdentitySha256: sessionBindings.analyzerIdentitySha256,
          verifierIdentitySha256: sessionBindings.verifierIdentitySha256,
        },
        commandKind: "source_page",
        sequence: 1n,
        currentProgress: sourceProgress,
        predecessorReceiptSha256: null,
        commandBudget: budget("command_budget", 0),
        range: {
          kind: "source_page",
          firstModuleOrdinal: 0n,
          moduleCount: 1n,
          totalModuleCount: 1n,
          sourceByteLength: BigInt(UTF8.encode(SOURCE).byteLength),
          semanticByteLength: 0n,
        },
        modules: [{
          moduleOrdinal: 0n,
          roles: 1 as SourceArtifactV2ModuleRolesV1,
          modulePathBytes: pathBytes,
          frameSha256: digest(32),
          sourceSha256: digest(33),
          sourceByteLength: BigInt(UTF8.encode(SOURCE).byteLength),
        }],
      },
    }));
    const completed = drive(port, driver, 1_024);
    expect(completed).toMatchObject({
      kind: "source_page",
      result: {
        nextProgress: { phase: "parse", settledSequence: 1n },
      },
    });
    Result.getOrThrow(port.close(session));
  });

  test("produces restart evidence only from the exact completed result", () => {
    const port = makeDeclarativeV2AnalyzerPortFactoryV1();
    const session = Result.getOrThrow(port.createSession(bindings()));
    const source = UTF8.encode(SOURCE);
    const completed = drive(
      port,
      Result.getOrThrow(port.start(session, {
        kind: "parse_module",
        reservationSha256: digest(50),
        rangeAndPredecessorTailsSha256: digest(49),
        predecessorReceiptSha256: null,
        sequence: 1n,
        moduleOrdinal: 0n,
        totalModuleCount: 1n,
        modulePath: artifactModulePath(MODULE_PATH),
        source,
        sourceSha256: digest(21),
        commandBudget: budget("command_budget", source.byteLength),
        currentProgress: progress("parse", 0n),
      })),
      1_024,
    );
    if (completed.kind !== "parse_module") {
      throw new Error("parse command did not complete");
    }
    const claim = Object.freeze({
      commandKind: "parse_module" as const,
      sequence: completed.sequence,
      reservationSha256: digest(50),
      authenticatedInputSha256: digest(3),
      sourceCommitmentSha256: digest(51),
      semanticCommitmentSha256: digest(52),
      settledCommandUsage: completed.actual,
      parsePagesRootSha256: null,
      maximumPagePayloadBytes: 65_536n,
      outputManifest: null,
      outputManifestSha256: null,
      receiptSha256: null,
    });
    expect(port.openRestartEvidence({
      session,
      result: Object.freeze({ ...completed }),
      claim,
      maximum: restartBudget(completed.actual),
    })).toMatchObject({
      failure: { reason: "staleAuthority", path: "result" },
    });
    const producer = Result.getOrThrow(port.openRestartEvidence({
      session,
      result: completed,
      claim,
      maximum: restartBudget(completed.actual),
    }));
    let pageCount = 0;
    for (;;) {
      const stepped = Result.getOrThrow(
        port.stepRestartEvidence(producer, 1_024),
      );
      if (stepped.status === "page") pageCount += 1;
      if (stepped.status === "complete") break;
    }
    expect(pageCount).toBeGreaterThan(0);
    expect(port.openRestartEvidence({
      session,
      result: completed,
      claim,
      maximum: restartBudget(completed.actual),
    })).toMatchObject({
      failure: { reason: "staleAuthority", path: "result" },
    });
    Result.getOrThrow(port.close(session));
  });

  test("rehydrates settled parse and link evidence into registration", () => {
    const source = UTF8.encode(SOURCE);
    const warm = runModule(source);
    const restartClaim = restartClaimFor(warm);
    const producerAuthority = Object.freeze({});
    const producer = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim(authority, operation) {
        return authority === producerAuthority && operation === "produce"
          ? Result.succeed(restartClaim)
          : Result.fail(new Error("unexpected claim") as never);
      },
    });
    const created = Result.getOrThrow(producer.createProducer({
      authority: producerAuthority,
      maximum: restartBudget(warm.usage),
    }));
    const pages: DeclarativeV2VerifierRestartPageV1[] = [];
    let produced:
      | Extract<
        ReturnType<typeof producer.stepProducer> extends Result.Result<
          infer A,
          unknown
        > ? A : never,
        { readonly status: "complete" }
      >
      | undefined;
    for (;;) {
      const step = Result.getOrThrow(producer.stepProducer(created, 1_024));
      if (step.status === "page") pages.push(step.page);
      if (step.status === "complete") {
        produced = step;
        break;
      }
    }
    if (produced === undefined) throw new Error("restart producer did not finish");
    const coldNextProgress = progress("link", 1n);
    const outputManifest = Object.freeze({
      kind: "command_output_manifest",
      reservationSha256: restartClaim.reservationSha256,
      commandKind: "parse_module",
      sequence: restartClaim.sequence,
      evidenceRootSha256: produced.finalPageSha256,
      evidenceCount: produced.recordCount,
      diagnosticsRootSha256: produced.diagnosticsRootSha256,
      diagnosticCount: produced.diagnosticCount,
      nextProgressSha256: frameSha256(coldNextProgress),
    } satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2);
    const outputManifestSha256 = encodedFrameSha256(outputManifest);

    const port = makeDeclarativeV2AnalyzerPortFactoryV1();
    const session = Result.getOrThrow(port.createSession(bindings()));
    const settledParseClaim = Object.freeze({
      ...restartClaim,
      settledCommandUsage: produced.actualUsage,
      outputManifest,
      outputManifestSha256,
      receiptSha256: digest(9),
      resultAuthority: null,
    } satisfies DeclarativeV2VerifierRestartClaimV1);
    const ordinalPort = makeDeclarativeV2AnalyzerPortFactoryV1();
    const ordinalSession = Result.getOrThrow(
      ordinalPort.createSession(bindings()),
    );
    const ordinalWarmParse = Result.getOrThrow(ordinalPort.start(
      ordinalSession,
      {
        kind: "parse_module",
        reservationSha256: digest(70),
        rangeAndPredecessorTailsSha256: digest(69),
        predecessorReceiptSha256: null,
        sequence: 1n,
        moduleOrdinal: 0n,
        totalModuleCount: 2n,
        modulePath: artifactModulePath(MODULE_PATH),
        source,
        sourceSha256: digest(21),
        commandBudget: budget("command_budget", source.byteLength),
        currentProgress: progress("parse", 0n),
      },
    ));
    expect(drive(ordinalPort, ordinalWarmParse, 1_024)).toMatchObject({
      kind: "parse_module",
      nextProgress: {
        phase: "parse",
        settledSequence: 1n,
        moduleOrdinal: 1n,
      },
    });
    const ordinalNextProgress = Object.freeze({
      ...progress("link", 2n),
    });
    const ordinalProducerClaim = Object.freeze({
      ...restartClaim,
      sequence: 2n,
      reservationSha256: digest(71),
      resultAuthority: warm,
    } satisfies DeclarativeV2VerifierRestartClaimV1);
    const ordinalProducerAuthority = Object.freeze({});
    const ordinalRuntime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim(authority, operation) {
        return authority === ordinalProducerAuthority && operation === "produce"
          ? Result.succeed(ordinalProducerClaim)
          : Result.fail(new Error("unexpected ordinal claim") as never);
      },
    });
    const ordinalProducer = Result.getOrThrow(ordinalRuntime.createProducer({
      authority: ordinalProducerAuthority,
      maximum: restartBudget(warm.usage),
    }));
    const ordinalProduced = produceRestartPages(
      ordinalRuntime,
      ordinalProducer,
    );
    const ordinalManifest = Object.freeze({
      ...outputManifest,
      reservationSha256: ordinalProducerClaim.reservationSha256,
      sequence: 2n,
      evidenceRootSha256: ordinalProduced.complete.finalPageSha256,
      evidenceCount: ordinalProduced.complete.recordCount,
      diagnosticsRootSha256: ordinalProduced.complete.diagnosticsRootSha256,
      diagnosticCount: ordinalProduced.complete.diagnosticCount,
      nextProgressSha256: frameSha256(ordinalNextProgress),
    } satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2);
    const ordinalClaim = Object.freeze({
      ...ordinalProducerClaim,
      settledCommandUsage: ordinalProduced.complete.actualUsage,
      outputManifest: ordinalManifest,
      outputManifestSha256: encodedFrameSha256(ordinalManifest),
      receiptSha256: digest(72),
      resultAuthority: null,
    } satisfies DeclarativeV2VerifierRestartClaimV1);
    const ordinalDriver = Result.getOrThrow(ordinalPort.rehydrate(
      ordinalSession,
      {
        claim: ordinalClaim,
        source: restartPageSource(ordinalProduced.pages),
        maximum: restartBudget(ordinalProduced.complete.actualUsage),
        nextProgress: ordinalNextProgress,
      },
    ));
    expect(() => drive(ordinalPort, ordinalDriver, 1_024)).toThrow(
      "Accepted cold parse result contradicted its authenticated progress lineage.",
    );
    Result.getOrThrow(ordinalPort.close(ordinalSession));

    const parsePageSource = restartPageSource(pages);
    const driver = Result.getOrThrow(port.rehydrate(session, {
      claim: settledParseClaim,
      source: parsePageSource,
      maximum: restartBudget(produced.actualUsage),
      nextProgress: coldNextProgress,
    }));
    expect(drive(port, driver, 1_024)).toMatchObject({
      kind: "rehydrate",
      commandKind: "parse_module",
    });
    expect(port.rehydrate(session, {
      claim: settledParseClaim,
      source: restartPageSource(pages),
      maximum: restartBudget(produced.actualUsage),
      nextProgress: coldNextProgress,
    })).toMatchObject({
      failure: {
        reason: "invalidTransition",
        path: "claim.sequence",
      },
    });

    const coldClaims = new WeakMap<
      object,
      Readonly<{
        readonly operation: "produce" | "rehydrate";
        readonly claim: DeclarativeV2VerifierRestartClaimV1;
      }>
    >();
    const coldRuntime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim(authority, operation) {
        const entry = authority !== null && typeof authority === "object"
          ? coldClaims.get(authority)
          : undefined;
        return entry?.operation === operation
          ? Result.succeed(entry.claim)
          : Result.fail(new Error("unexpected cold claim") as never);
      },
    });
    const coldParseAuthority = Object.freeze({});
    coldClaims.set(coldParseAuthority, {
      operation: "rehydrate",
      claim: settledParseClaim,
    });
    const coldParse = Result.getOrThrow(coldRuntime.createRehydrator({
      authority: coldParseAuthority,
      source: restartPageSource(pages),
      maximum: restartBudget(produced.actualUsage),
    }));
    let coldModule: DeclarativeV2VerifierModuleResultV1 | undefined;
    for (;;) {
      const step = Result.getOrThrow(
        coldRuntime.stepRehydrator(coldParse, 1_024),
      );
      if (step.status === "complete") {
        coldModule = step.moduleResult ?? undefined;
        break;
      }
    }
    if (coldModule === undefined) throw new Error("cold parse result missing");

    const registrationProgress = progress("registration", 2n);
    const linkBindings = Object.freeze({
      attemptSha256: digest(1),
      futureRegistrationIntentSha256: digest(40),
      candidateSha256: digest(2),
      authenticatedInputSha256: digest(3),
      linkSequence: 2n,
      parsePagesRootSha256: digest(41),
      currentProgressSha256: frameSha256(registrationProgress),
      predecessorAndTailsSha256: digest(4),
      rangeSha256: digest(4),
      analyzerReleaseSha256: digest(5),
      analyzerIdentitySha256: digest(6),
      verifierIdentitySha256: digest(7),
    });
    const linkFactory = makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
      claim(module) {
        return module === coldModule
          ? Result.succeed(Object.freeze({
            ...linkBindings,
            moduleOrdinal: 0n,
            producingParseResultSha256: hexDigest(coldModule.evidenceSha256),
          }))
          : Result.fail(new Error("unexpected link module") as never);
      },
    });
    const linkAccumulator = Result.getOrThrow(
      linkFactory.create(linkBindings, budget("command_budget", 0)),
    );
    while (Result.getOrThrow(
      linkFactory.admit(linkAccumulator, coldModule, 1_024),
    ).status !== "ready") {
      // bounded owner progress
    }
    let linkDriver:
      | Extract<
        Result.Result.Success<ReturnType<typeof linkFactory.seal>>,
        { readonly status: "complete" }
      >["driver"]
      | undefined;
    for (;;) {
      const sealed = Result.getOrThrow(linkFactory.seal(linkAccumulator, 1_024));
      if (sealed.status === "complete") {
        linkDriver = sealed.driver;
        break;
      }
    }
    let coldLinkResult:
      | Exclude<
        Result.Result.Success<ReturnType<typeof linkFactory.step>>,
        { readonly status: "pending" }
      >
      | undefined;
    for (;;) {
      const step = Result.getOrThrow(linkFactory.step(linkDriver!, 1_024));
      if (!("status" in step)) {
        coldLinkResult = step;
        break;
      }
    }
    const linkClaim = Object.freeze({
      commandKind: "link_page",
      sequence: 2n,
      reservationSha256: digest(42),
      authenticatedInputSha256: linkBindings.authenticatedInputSha256,
      sourceCommitmentSha256: digest(62),
      semanticCommitmentSha256: digest(63),
      settledCommandUsage: coldLinkResult!.usage,
      parsePagesRootSha256: linkBindings.parsePagesRootSha256,
      maximumPagePayloadBytes: 65_536n,
      outputManifest: null,
      outputManifestSha256: null,
      receiptSha256: null,
      resultAuthority: coldLinkResult!,
      parseModuleResults: null,
    } satisfies DeclarativeV2VerifierRestartClaimV1);
    expect(linkClaim.reservationSha256).not.toEqual(
      linkBindings.futureRegistrationIntentSha256,
    );
    const linkProducerAuthority = Object.freeze({});
    coldClaims.set(linkProducerAuthority, {
      operation: "produce",
      claim: linkClaim,
    });
    const linkProducer = Result.getOrThrow(coldRuntime.createProducer({
      authority: linkProducerAuthority,
      maximum: restartBudget(coldLinkResult!.usage),
    }));
    const linkProduced = produceRestartPages(
      coldRuntime,
      linkProducer,
    );
    const settledLinkManifest = Object.freeze({
      kind: "command_output_manifest",
      reservationSha256: linkClaim.reservationSha256,
      commandKind: "link_page",
      sequence: linkClaim.sequence,
      evidenceRootSha256: linkProduced.complete.finalPageSha256,
      evidenceCount: linkProduced.complete.recordCount,
      diagnosticsRootSha256: linkProduced.complete.diagnosticsRootSha256,
      diagnosticCount: linkProduced.complete.diagnosticCount,
      nextProgressSha256: frameSha256(registrationProgress),
    } satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2);
    const settledLinkClaim = Object.freeze({
      ...linkClaim,
      settledCommandUsage: linkProduced.complete.actualUsage,
      outputManifest: settledLinkManifest,
      outputManifestSha256: encodedFrameSha256(settledLinkManifest),
      receiptSha256: digest(64),
      resultAuthority: null,
    } satisfies DeclarativeV2VerifierRestartClaimV1);
    expect(port.rehydrate(session, {
      claim: Object.freeze({
        ...settledLinkClaim,
        sequence: 3n,
      }),
      source: restartPageSource(linkProduced.pages),
      maximum: restartBudget(linkProduced.complete.actualUsage),
      nextProgress: registrationProgress,
      linkBindings,
    })).toMatchObject({
      failure: {
        reason: "invalidTransition",
        path: "claim.sequence",
      },
    });
    expect(port.rehydrate(session, {
      claim: settledLinkClaim,
      source: restartPageSource(linkProduced.pages),
      maximum: restartBudget(linkProduced.complete.actualUsage),
      nextProgress: registrationProgress,
      linkBindings: Object.freeze({
        ...linkBindings,
        rangeSha256: digest(65),
      }),
    })).toMatchObject({
      failure: {
        reason: "identityMismatch",
        path: "linkBindings",
      },
    });
    const coldLink = Result.getOrThrow(port.rehydrate(session, {
      claim: settledLinkClaim,
      source: restartPageSource(linkProduced.pages),
      maximum: restartBudget(linkProduced.complete.actualUsage),
      nextProgress: registrationProgress,
      linkBindings,
    }));
    expect(drive(port, coldLink, 1_024)).toMatchObject({
      kind: "rehydrate",
      commandKind: "link_page",
    });

    const semantic = semanticBytes();
    const registration = Result.getOrThrow(port.start(session, {
      kind: "registration_page",
      input: {
        bindings: {
          ...linkBindings,
          predecessorAndTailsSha256: digest(66),
          rangeSha256: digest(66),
          registrationReservationSha256: digest(65),
          semanticSha256: sha256(semantic),
        },
        commandKind: "registration_page",
        sequence: 3n,
        currentProgress: registrationProgress,
        predecessorReceiptSha256: null,
        commandBudget: budget("command_budget", semantic.byteLength),
        semanticBudget: semanticBudget(semantic),
        semanticBytes: semantic,
      },
    }));
    expect(drive(port, registration, 1_024)).toMatchObject({
      kind: "registration_page",
      result: { nextProgress: { phase: "verdict" } },
    });
    Result.getOrThrow(port.close(session));
  });

  test("fails closed on invalid allowances and stale handles", () => {
    const port = makeDeclarativeV2AnalyzerPortFactoryV1();
    const session = Result.getOrThrow(port.createSession(bindings()));
    const source = UTF8.encode(SOURCE);
    const driver = Result.getOrThrow(port.start(session, {
      kind: "parse_module",
      reservationSha256: digest(20),
      rangeAndPredecessorTailsSha256: digest(19),
      predecessorReceiptSha256: null,
      sequence: 1n,
      moduleOrdinal: 0n,
      totalModuleCount: 1n,
      modulePath: artifactModulePath(MODULE_PATH),
      source,
      sourceSha256: digest(21),
      commandBudget: budget("command_budget", source.byteLength),
      currentProgress: progress("parse", 0n),
    }));
    expect(port.step(driver, 1_025)).toMatchObject({
      failure: { reason: "invalidInput", path: "allowance" },
    });
    expect(port.step(driver, 1)).toMatchObject({
      failure: { reason: "invalidInput", path: "driver" },
    });
    Result.getOrThrow(port.close(session));
  });
});

function driveOneModuleToRegistration(sourceText: string) {
  const port = makeDeclarativeV2AnalyzerPortFactoryV1();
  const sessionBindings = bindings();
  const session = Result.getOrThrow(port.createSession(sessionBindings));
  const source = UTF8.encode(sourceText);
  const parsed = drive(
    port,
    Result.getOrThrow(port.start(session, {
      kind: "parse_module",
      reservationSha256: digest(80),
      rangeAndPredecessorTailsSha256: digest(81),
      predecessorReceiptSha256: null,
      sequence: 1n,
      moduleOrdinal: 0n,
      totalModuleCount: 1n,
      modulePath: artifactModulePath(MODULE_PATH),
      source,
      sourceSha256: digest(82),
      commandBudget: budget("command_budget", source.byteLength, {
        calls: 100_000_000n,
      }),
      currentProgress: progress("parse", 0n),
    })),
    1_024,
  );
  if (parsed.kind !== "parse_module") {
    throw new Error("diagnostic parse command did not complete");
  }
  const registrationProgress = progress("registration", 2n);
  const linkBindings = Object.freeze({
    attemptSha256: sessionBindings.attemptSha256,
    futureRegistrationIntentSha256: digest(83),
    candidateSha256: sessionBindings.candidateSha256,
    authenticatedInputSha256: sessionBindings.authenticatedInputSha256,
    linkSequence: 2n,
    parsePagesRootSha256: digest(84),
    currentProgressSha256: frameSha256(registrationProgress),
    predecessorAndTailsSha256: digest(85),
    rangeSha256: digest(85),
    analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
    analyzerIdentitySha256: sessionBindings.analyzerIdentitySha256,
    verifierIdentitySha256: sessionBindings.verifierIdentitySha256,
  });
  const linked = drive(
    port,
    Result.getOrThrow(port.start(session, {
      kind: "link_page",
      bindings: linkBindings,
      commandBudget: budget("command_budget", 0),
      currentProgress: parsed.nextProgress,
      nextProgress: registrationProgress,
      predecessorReceiptSha256: null,
    })),
    1_024,
  );
  const semantic = semanticBytes();
  const registration = port.start(session, {
    kind: "registration_page",
    input: {
      bindings: {
        ...linkBindings,
        predecessorAndTailsSha256: digest(86),
        rangeSha256: digest(86),
        registrationReservationSha256: digest(87),
        semanticSha256: sha256(semantic),
      },
      commandKind: "registration_page",
      sequence: 3n,
      currentProgress: registrationProgress,
      predecessorReceiptSha256: null,
      commandBudget: budget("command_budget", semantic.byteLength),
      semanticBudget: semanticBudget(semantic),
      semanticBytes: semantic,
    },
  });
  return Object.freeze({ port, session, parsed, linked, registration });
}

function driveRehydratedModuleToRegistration(sourceText: string) {
  const warm = runModule(UTF8.encode(sourceText));
  if (warm.verified || warm.diagnosticCount === 0n) {
    throw new Error("cold diagnostic fixture unexpectedly verified");
  }
  const restartClaim = restartClaimFor(warm);
  const producerAuthority = Object.freeze({});
  const recoveryMaximum = Object.freeze({
    ...restartBudget(warm.usage),
    canonicalBytes: 300_000_000n,
    frameBytes: 10_000_000n,
    hashBytes: 300_000_000n,
  });
  const runtime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
    claim(authority, operation) {
      return authority === producerAuthority && operation === "produce"
        ? Result.succeed(restartClaim)
        : Result.fail(new Error("unexpected cold diagnostic claim") as never);
    },
  });
  const produced = produceRestartPages(
    runtime,
    Result.getOrThrow(runtime.createProducer({
      authority: producerAuthority,
      maximum: recoveryMaximum,
    })),
  );
  const linkProgress = progress("link", 1n);
  const outputManifest = Object.freeze({
    kind: "command_output_manifest",
    reservationSha256: restartClaim.reservationSha256,
    commandKind: "parse_module",
    sequence: restartClaim.sequence,
    evidenceRootSha256: produced.complete.finalPageSha256,
    evidenceCount: produced.complete.recordCount,
    diagnosticsRootSha256: produced.complete.diagnosticsRootSha256,
    diagnosticCount: produced.complete.diagnosticCount,
    nextProgressSha256: frameSha256(linkProgress),
  } satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2);
  const settledClaim = Object.freeze({
    ...restartClaim,
    settledCommandUsage: produced.complete.actualUsage,
    outputManifest,
    outputManifestSha256: encodedFrameSha256(outputManifest),
    receiptSha256: digest(88),
    resultAuthority: null,
  } satisfies DeclarativeV2VerifierRestartClaimV1);

  const port = makeDeclarativeV2AnalyzerPortFactoryV1();
  const sessionBindings = bindings();
  const session = Result.getOrThrow(port.createSession(sessionBindings));
  const rehydrated = Result.getOrThrow(port.rehydrate(session, {
    claim: settledClaim,
    source: restartPageSource(produced.pages),
    maximum: recoveryMaximum,
    nextProgress: linkProgress,
  }));
  expect(drive(port, rehydrated, 1_024)).toMatchObject({
    kind: "rehydrate",
    commandKind: "parse_module",
  });

  const registrationProgress = progress("registration", 2n);
  const linkBindings = Object.freeze({
    attemptSha256: sessionBindings.attemptSha256,
    futureRegistrationIntentSha256: digest(89),
    candidateSha256: sessionBindings.candidateSha256,
    authenticatedInputSha256: sessionBindings.authenticatedInputSha256,
    linkSequence: 2n,
    parsePagesRootSha256: produced.complete.finalPageSha256,
    currentProgressSha256: frameSha256(registrationProgress),
    predecessorAndTailsSha256: digest(90),
    rangeSha256: digest(90),
    analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
    analyzerIdentitySha256: sessionBindings.analyzerIdentitySha256,
    verifierIdentitySha256: sessionBindings.verifierIdentitySha256,
  });
  const linked = drive(
    port,
    Result.getOrThrow(port.start(session, {
      kind: "link_page",
      bindings: linkBindings,
      commandBudget: budget("command_budget", 0),
      currentProgress: linkProgress,
      nextProgress: registrationProgress,
      predecessorReceiptSha256: null,
    })),
    1_024,
  );
  if (linked.kind !== "link_page") {
    throw new Error("cold diagnostic link command did not complete");
  }
  const semantic = semanticBytes();
  const registration = port.start(session, {
    kind: "registration_page",
    input: {
      bindings: {
        ...linkBindings,
        predecessorAndTailsSha256: digest(91),
        rangeSha256: digest(91),
        registrationReservationSha256: digest(92),
        semanticSha256: sha256(semantic),
      },
      commandKind: "registration_page",
      sequence: 3n,
      currentProgress: registrationProgress,
      predecessorReceiptSha256: null,
      commandBudget: budget("command_budget", semantic.byteLength),
      semanticBudget: semanticBudget(semantic),
      semanticBytes: semantic,
    },
  });
  return Object.freeze({ port, session, registration });
}

function drive(
  port: ReturnType<typeof makeDeclarativeV2AnalyzerPortFactoryV1>,
  driver: unknown,
  allowance: 1 | 1_024,
): DeclarativeV2AnalyzerCompleteV1 {
  for (let guard = 0; guard < 5_000_000; guard += 1) {
    const stepped = Result.getOrThrow(port.step(driver, allowance));
    if (stepped.status === "complete") return stepped;
  }
  throw new Error("analyzer port did not terminate");
}

function bindings(seed = 1): DeclarativeV2AnalyzerSessionBindingsV1 {
  return Object.freeze({
    attemptSha256: digest(seed),
    candidateSha256: digest(seed + 1),
    authenticatedInputSha256: digest(seed + 2),
    analyzerReleaseSha256: digest(seed + 4),
    analyzerIdentitySha256: digest(seed + 5),
    verifierIdentitySha256: digest(seed + 6),
  });
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

function budget(
  kind: "attempt_usage" | "command_budget",
  sourceBytes: number,
  mutate?: Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>>,
): DeclarativeV2VerifierBudgetFrameV2 {
  const tableBytes = BigInt(
    GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength +
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetByteLength,
  );
  return Object.freeze({
    kind,
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        mutate?.[dimension] ??
          (dimension === "sourceBytes" ||
              dimension === "objectBodyBytes" ||
              dimension === "semanticBytes"
            ? BigInt(sourceBytes)
            : dimension === "sourceMapBytes"
            ? 0n
            : dimension === "modules"
            ? 10n
            : dimension === "tableBytes"
            ? tableBytes
            : dimension === "calls"
            ? 20_000_000n
            : dimension.endsWith("Bytes")
            ? 300_000_000n
            : 20_000_000n),
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function semanticBytes(): Uint8Array {
  const lines = SEMANTIC_RECORDS.map(encodeDeclarativeV2SemanticRecordV1);
  const output = new Uint8Array(
    lines.reduce((total, line) => total + line.byteLength, 0),
  );
  let offset = 0;
  for (const line of lines) {
    output.set(line, offset);
    offset += line.byteLength;
  }
  return output;
}

function restartBudget(
  settled: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierBudgetFrameV2 {
  const tableBytes = BigInt(
    GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength +
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetByteLength,
  );
  return Object.freeze({
    kind: "command_budget",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        dimension === "sourceMapBytes" || dimension === "semanticBytes"
          ? 0n
          : dimension === "tableBytes"
          ? tableBytes
          : dimension === "frameBytes"
          ? 2_000_000n
          : settled[dimension] > 1_000_000n
          ? settled[dimension] + 1_000_000n
          : 1_000_000n,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function semanticBudget(bytes: Uint8Array) {
  return Result.getOrThrow(makeDeclarativeV2SemanticStreamBudgetV1(
    bytes.byteLength,
    Math.max(
      ...SEMANTIC_RECORDS.map(record =>
        encodeDeclarativeV2SemanticRecordPayloadV1(record).byteLength
      ),
    ),
    SEMANTIC_RECORDS.length,
    SEMANTIC_RECORDS.reduce(
      (total, record) =>
        total + encodeDeclarativeV2SemanticRecordPayloadV1(record).byteLength,
      0,
    ),
  ));
}

function runModule(source: Uint8Array): DeclarativeV2VerifierModuleResultV1 {
  const session = bindings();
  const expectedBindings = Object.freeze({
    candidateSha256: session.candidateSha256,
    authenticatedInputSha256: session.authenticatedInputSha256,
    rangeAndPredecessorTailsSha256: digest(4),
    analyzerIdentitySha256: session.analyzerIdentitySha256,
    verifierIdentitySha256: session.verifierIdentitySha256,
  });
  const plan = Result.getOrThrow(planDeclarativeV2VerifierParseCapacityV1({
    bindings: expectedBindings,
    commandKind: "parse_module",
    sequence: 1n,
    modulePath: artifactModulePath(MODULE_PATH),
    moduleOrdinal: 0n,
    source,
    sourceSha256: digest(21),
    commandBudget: budget("command_budget", source.byteLength, {
      calls: 100_000_000n,
    }),
  }, expectedBindings));
  return Result.getOrThrow(
    driveDeclarativeV2VerifierParseModuleTerminalV1(plan.claim, 1_024),
  ).result;
}

function restartClaimFor(
  result: DeclarativeV2VerifierModuleResultV1,
): DeclarativeV2VerifierRestartClaimV1 {
  return Object.freeze({
    commandKind: "parse_module",
    sequence: 1n,
    reservationSha256: digest(50),
    authenticatedInputSha256: digest(3),
    sourceCommitmentSha256: digest(51),
    semanticCommitmentSha256: digest(52),
    settledCommandUsage: result.usage,
    parsePagesRootSha256: null,
    maximumPagePayloadBytes: 65_536n,
    outputManifest: null,
    outputManifestSha256: null,
    receiptSha256: null,
    resultAuthority: result,
    parseModuleResults: null,
  });
}

function produceRestartPages(
  runtime: DeclarativeV2VerifierRestartRuntimeFactoryV1,
  producer: DeclarativeV2VerifierRestartProducerV1,
) {
  const pages: DeclarativeV2VerifierRestartPageV1[] = [];
  for (;;) {
    const step = Result.getOrThrow(runtime.stepProducer(producer, 1_024));
    if (step.status === "page") pages.push(step.page);
    if (step.status === "complete") {
      return Object.freeze({ pages: Object.freeze(pages), complete: step });
    }
  }
}

function restartPageSource(
  pages: readonly DeclarativeV2VerifierRestartPageV1[],
) {
  return Object.freeze({
    metadata(pageOrdinal: bigint) {
      const page = pages[Number(pageOrdinal)];
      return Result.succeed(page === undefined
        ? null
        : {
          manifestBytes: page.manifestBytes,
          manifestSha256: page.manifestSha256,
        });
    },
    body(pageOrdinal: bigint) {
      const page = pages[Number(pageOrdinal)];
      return page === undefined
        ? Result.fail(new Error("missing page") as never)
        : Result.succeed(page.payloadBytes);
    },
  });
}

function hexDigest(value: string): Uint8Array {
  return Uint8Array.from(
    value.match(/.{2}/gu)?.map(byte => Number.parseInt(byte, 16)) ?? [],
  );
}

function frameSha256(
  frame: DeclarativeV2VerifierProgressCursorFrameV2,
): Uint8Array {
  return encodedFrameSha256(frame);
}

function encodedFrameSha256(
  frame:
    | DeclarativeV2VerifierProgressCursorFrameV2
    | DeclarativeV2VerifierCommandOutputManifestFrameV2,
): Uint8Array {
  const encoded = Result.getOrThrow(encodeDeclarativeV2VerifierProgressFrameV2(
    frame,
    {
      maximumFrameBytes: 1_048_576,
      maximumCanonicalBytes: 1_048_576,
    },
  ));
  return sha256(encoded.canonicalBytes);
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}
