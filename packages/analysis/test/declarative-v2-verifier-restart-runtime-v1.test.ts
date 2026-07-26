import { createHash } from "node:crypto";

import { Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "../src/declarativeV2ArtifactModulePathV1";
import {
  appendDeclarativeV2VerifierLinkerModuleV1,
  createDeclarativeV2VerifierEngineV1,
  createDeclarativeV2VerifierLinkerV1,
  finishDeclarativeV2VerifierLinkerV1,
  makeDeclarativeV2VerifierResultAccessFactoryV1,
  stepDeclarativeV2VerifierLinkerV1,
  type DeclarativeV2VerifierEngineV1,
  type DeclarativeV2VerifierLinkResultV1,
  type DeclarativeV2VerifierModuleResultV1,
} from "../src/declarativeV2VerifierExecutableV1";
import {
  deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1,
} from "../src/declarativeV2VerifierRestartEvidenceV1";
import {
  DECLARATIVE_V2_VERIFIER_RESTART_RUNTIME_IDENTITY_V1,
  DeclarativeV2VerifierRestartRuntimeV1Error,
  makeDeclarativeV2VerifierRestartRuntimeFactoryV1,
  type DeclarativeV2VerifierRestartClaimV1,
  type DeclarativeV2VerifierRestartPageV1,
} from "../src/declarativeV2VerifierRestartRuntimeV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
} from "../src/declarativeV2VerifierExecutableV1.generated";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
} from "../src/declarativeV2VerifierV1.generated";

const encoder = new TextEncoder();

describe("Declarative V2 verifier restart runtime V1", () => {
  it("produces claimed pages and rehydrates fresh opaque module authority", () => {
    const source =
      "export async function ready({ value } = {}, ...rest) { return value; }";
    const module = runModule(source, "functions/restart-runtime.js", 4n);
    const maximum = budget("command_budget");
    const reservationSha256 = bytes(1);
    const authenticatedInputSha256 = bytes(2);
    const producerAuthority = Object.freeze({});
    const coldProducerAuthority = Object.freeze({});
    const rehydrateAuthority = Object.freeze({});
    let rehydrateClaim: DeclarativeV2VerifierRestartClaimV1 | undefined;
    let coldProducerClaim: DeclarativeV2VerifierRestartClaimV1 | undefined;
    const producerClaim = claim({
      reservationSha256,
      authenticatedInputSha256,
      settledCommandUsage: budget("attempt_usage", 0n),
      resultAuthority: module,
    });
    const runtime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim(authority, operation) {
        if (operation === "produce" && authority === producerAuthority) {
          return Result.succeed(producerClaim);
        }
        if (
          operation === "produce" &&
          authority === coldProducerAuthority &&
          coldProducerClaim !== undefined
        ) {
          return Result.succeed(coldProducerClaim);
        }
        if (
          operation === "rehydrate" &&
          authority === rehydrateAuthority &&
          rehydrateClaim !== undefined
        ) {
          return Result.succeed(rehydrateClaim);
        }
        return Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
          operation: operation === "produce"
            ? "createProducer"
            : "createRehydrator",
          reason: "staleAuthority",
        }));
      },
    });
    const created = runtime.createProducer({
      authority: producerAuthority,
      maximum,
    });
    if (Result.isFailure(created)) throw created.failure;
    expect(runtime.stepProducer(created.success, 0)).toMatchObject({
      success: { status: "pending", receipt: { transitionCount: 0 } },
    });
    expect(runtime.stepProducer(created.success, 1_025)).toMatchObject({
      failure: { reason: "invalidInput" },
    });

    const restarted = runtime.createProducer({
      authority: producerAuthority,
      maximum,
    });
    if (Result.isFailure(restarted)) throw restarted.failure;
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
    for (let iteration = 0; iteration < 100_000; iteration += 1) {
      const stepped = runtime.stepProducer(restarted.success, 1_024);
      if (Result.isFailure(stepped)) throw stepped.failure;
      if (stepped.success.status === "page") pages.push(stepped.success.page);
      if (stepped.success.status === "complete") {
        complete = stepped.success;
        break;
      }
    }
    if (complete === undefined) throw new Error("producer did not complete");
    expect(pages.length).toBeGreaterThan(0);
    expect(complete.recordCount).toBeGreaterThan(1n);
    expect(complete.finalPageSha256).toEqual(
      pages[pages.length - 1]!.manifestSha256,
    );

    const outputManifest = Object.freeze({
      kind: "command_output_manifest",
      reservationSha256,
      commandKind: "parse_module",
      sequence: 1n,
      evidenceRootSha256: complete.finalPageSha256,
      evidenceCount: complete.recordCount,
      diagnosticsRootSha256: complete.diagnosticsRootSha256,
      diagnosticCount: complete.diagnosticCount,
      nextProgressSha256: bytes(8),
    } satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2);
    const encodedOutput = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(outputManifest, {
        maximumFrameBytes: 100_000,
        maximumCanonicalBytes: 100_000,
      }),
    );
    const outputManifestSha256 = Result.getOrThrow(
      deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(
        encodedOutput.canonicalBytes,
      ),
    );
    rehydrateClaim = claim({
      reservationSha256,
      authenticatedInputSha256,
      settledCommandUsage: complete.actualUsage,
      outputManifest,
      outputManifestSha256,
      receiptSha256: bytes(9),
    });
    const pageSource = {
      metadata(pageOrdinal: bigint) {
        const page = pages[Number(pageOrdinal)];
        return Result.succeed(page === undefined
          ? null
          : Object.freeze({
            manifestBytes: page.manifestBytes,
            manifestSha256: page.manifestSha256,
          }));
      },
      body(pageOrdinal: bigint, admittedByteLength: bigint) {
        const page = pages[Number(pageOrdinal)];
        if (
          page === undefined ||
          BigInt(page.payloadBytes.byteLength) !== admittedByteLength
        ) {
          return Result.fail(
            new DeclarativeV2VerifierRestartRuntimeV1Error({
              operation: "rehydrate",
              reason: "corruption",
            }),
          );
        }
        return Result.succeed(page.payloadBytes);
      },
    };
    const cold = runtime.createRehydrator({
      authority: rehydrateAuthority,
      source: pageSource,
      maximum,
    });
    if (Result.isFailure(cold)) throw cold.failure;
    let coldResult: DeclarativeV2VerifierModuleResultV1 | undefined;
    for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
      const stepped = runtime.stepRehydrator(cold.success, 1_024);
      if (Result.isFailure(stepped)) throw stepped.failure;
      if (stepped.success.status === "complete") {
        coldResult = stepped.success.moduleResult ?? undefined;
        break;
      }
    }
    if (coldResult === undefined) throw new Error("rehydrator did not complete");
    expect(coldResult.moduleOrdinal).toBe(module.moduleOrdinal);
    expect(coldResult.functionCount).toBe(module.functionCount);
    expect(coldResult.evidenceSha256).toBe(module.evidenceSha256);
    const access = makeDeclarativeV2VerifierResultAccessFactoryV1();
    expect(handler(access, coldResult, "functions/restart-runtime.js", "ready"))
      .toBe(true);
    expect(handler(access, coldResult, "functions/restart-runtime.js", "missing"))
      .toBe(false);
    coldProducerClaim = claim({
      reservationSha256,
      authenticatedInputSha256,
      settledCommandUsage: budget("attempt_usage", 0n),
      resultAuthority: coldResult,
    });
    const coldProducer = Result.getOrThrow(runtime.createProducer({
      authority: coldProducerAuthority,
      maximum,
    }));
    const coldPages: DeclarativeV2VerifierRestartPageV1[] = [];
    for (let iteration = 0; iteration < 100_000; iteration += 1) {
      const stepped = Result.getOrThrow(
        runtime.stepProducer(coldProducer, 1_024),
      );
      if (stepped.status === "page") coldPages.push(stepped.page);
      if (stepped.status === "complete") break;
    }
    expect(coldPages.map(page => page.manifestBytes)).toEqual(
      pages.map(page => page.manifestBytes),
    );
    expect(coldPages.map(page => page.payloadBytes)).toEqual(
      pages.map(page => page.payloadBytes),
    );
    expect(DECLARATIVE_V2_VERIFIER_RESTART_RUNTIME_IDENTITY_V1).toBe(
      "flarex.declarative-v2/verifier-restart-runtime/v1",
    );
  });

  it("claims before result inspection and page access and fails closed", () => {
    let claims = 0;
    let metadata = 0;
    const runtime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim() {
        claims += 1;
        return Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
          operation: "createRehydrator",
          reason: "staleAuthority",
        }));
      },
    });
    const failed = runtime.createRehydrator({
      authority: Object.freeze({}),
      maximum: budget("command_budget"),
      source: {
        metadata() {
          metadata += 1;
          throw new Error("must not run");
        },
        body() {
          throw new Error("must not run");
        },
      },
    });
    expect(Result.isFailure(failed)).toBe(true);
    expect(claims).toBe(1);
    expect(metadata).toBe(0);
    expect(runtime.stepProducer(Object.freeze({
      _tag: "DeclarativeV2VerifierRestartProducerV1",
    }), 1)).toMatchObject({
      failure: { reason: "staleAuthority" },
    });
  });

  it("terminalizes before rethrowing a page-source defect", () => {
    const defect = new Error("page source defect");
    const authority = Object.freeze({});
    const runtime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim(candidate, operation) {
        return candidate === authority && operation === "rehydrate"
          ? Result.succeed(settledClaim())
          : Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
            operation: "createRehydrator",
            reason: "staleAuthority",
          }));
      },
    });
    const created = Result.getOrThrow(runtime.createRehydrator({
      authority,
      maximum: budget("command_budget"),
      source: {
        metadata() {
          throw defect;
        },
        body() {
          throw new Error("body must not run");
        },
      },
    }));
    expect(() => runtime.stepRehydrator(created, 1)).toThrow(defect);
    expect(runtime.stepRehydrator(created, 1)).toMatchObject({
      failure: { reason: "closed" },
    });
  });

  it("rejects a one-less page budget before body access", () => {
    const authority = Object.freeze({});
    const fixedClaim = settledClaim();
    const manifest = Object.freeze({
      kind: "evidence_page_manifest",
      reservationSha256: fixedClaim.reservationSha256,
      commandKind: "parse_module",
      sequence: 1n,
      pageOrdinal: 0n,
      firstEvidenceOrdinal: 0n,
      evidenceCount: 1n,
      firstDiagnosticOrdinal: 0n,
      diagnosticCount: 0n,
      predecessorPageSha256: null,
      payloadByteLength: 1_000n,
      payloadSha256: bytes(18),
      cumulativeDiagnosticsRootSha256: new Uint8Array(32),
    } satisfies DeclarativeV2VerifierEvidencePageManifestFrameV2);
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(manifest, {
        maximumFrameBytes: 100_000,
        maximumCanonicalBytes: 100_000,
      }),
    ).canonicalBytes;
    const manifestSha256 = Result.getOrThrow(
      deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(encoded),
    );
    let bodyCalls = 0;
    const manifestRuntime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim() {
        return Result.succeed(fixedClaim);
      },
    });
    const manifestOneLess = Result.getOrThrow(
      manifestRuntime.createRehydrator({
        authority,
        maximum: budget("command_budget", 1_000_000n, {
          frameBytes: BigInt(encoded.byteLength - 1),
        }),
        source: {
          metadata(pageOrdinal) {
            return Result.succeed(pageOrdinal === 0n
              ? Object.freeze({ manifestBytes: encoded, manifestSha256 })
              : null);
          },
          body() {
            bodyCalls += 1;
            return Result.succeed(new Uint8Array(1_000));
          },
        },
      }),
    );
    expect(manifestRuntime.stepRehydrator(manifestOneLess, 1)).toMatchObject({
      failure: {
        reason: "budgetExceeded",
        dimension: "frameBytes",
        observed: BigInt(encoded.byteLength),
        maximum: BigInt(encoded.byteLength - 1),
      },
    });
    expect(bodyCalls).toBe(0);
    const hostileManifestBytes = new Uint8Array(encoded);
    let byteLengthGetterCalls = 0;
    Object.defineProperty(hostileManifestBytes, "byteLength", {
      get() {
        byteLengthGetterCalls += 1;
        throw new Error("caller byteLength getter must not run");
      },
    });
    const runtime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim() {
        return Result.succeed(fixedClaim);
      },
    });
    const maximum = budget("command_budget", 1_000_000n, {
      objectBodyBytes: 999n,
      sourceBytes: 0n,
      semanticBytes: 0n,
    });
    const created = Result.getOrThrow(runtime.createRehydrator({
      authority,
      maximum,
      source: {
        metadata(pageOrdinal) {
          return Result.succeed(pageOrdinal === 0n
            ? Object.freeze({
              manifestBytes: hostileManifestBytes,
              manifestSha256,
            })
            : null);
        },
        body() {
          bodyCalls += 1;
          return Result.succeed(new Uint8Array(1_000));
        },
      },
    }));
    expect(runtime.stepRehydrator(created, 1)).toMatchObject({
      failure: {
        reason: "budgetExceeded",
        dimension: "objectBodyBytes",
        observed: 1_000n,
        maximum: 999n,
      },
    });
    expect(bodyCalls).toBe(0);
    expect(byteLengthGetterCalls).toBe(0);
  });

  it("pins deterministic producer page identities across allowances", () => {
    const source = "export function ready() { return 1; }";
    const module = runModule(source, "functions/equality.js", 0n);
    const authority = Object.freeze({});
    const fixedClaim = claim({
      resultAuthority: module,
      settledCommandUsage: budget("attempt_usage", 0n, {
        calls: 7n,
        hashBytes: 11n,
      }),
    });
    const runtime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim(candidate) {
        return candidate === authority
          ? Result.succeed(fixedClaim)
          : Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
            operation: "createProducer",
            reason: "staleAuthority",
          }));
      },
    });
    const run = (allowance: number): Readonly<{
      readonly hashes: readonly string[];
      readonly usage: DeclarativeV2VerifierBudgetFrameV2;
    }> => {
      const created = Result.getOrThrow(runtime.createProducer({
        authority,
        maximum: budget("command_budget"),
      }));
      const hashes: string[] = [];
      for (let iteration = 0; iteration < 100_000; iteration += 1) {
        const stepped = Result.getOrThrow(
          runtime.stepProducer(created, allowance),
        );
        if (stepped.status === "page") {
          hashes.push(Buffer.from(stepped.page.manifestSha256).toString("hex"));
        }
        if (stepped.status === "complete") {
          return Object.freeze({
            hashes: Object.freeze(hashes),
            usage: stepped.actualUsage,
          });
        }
      }
      throw new Error("producer iteration ceiling");
    };
    const single = run(1);
    const maximum = run(1_024);
    expect(single).toEqual(maximum);
    expect(single.usage.calls).toBeGreaterThanOrEqual(7n);
    expect(single.usage.hashBytes).toBeGreaterThanOrEqual(11n);
  });

  it("replays linking from fresh module authority and compares exact restart bytes", () => {
    const modules = [
      runModule(
        'import { value } from "./b.js"; export function ready() { return value(); }',
        "functions/a.js",
        0n,
      ),
      runModule(
        "export function value() { return 1; }",
        "functions/b.js",
        1n,
      ),
    ];
    const maximum = budget("command_budget");
    const linked = runLink(modules, maximum);
    const producerAuthority = Object.freeze({});
    const rehydrateAuthority = Object.freeze({});
    const parsePagesRootSha256 = bytes(12);
    let coldClaim: DeclarativeV2VerifierRestartClaimV1 | undefined;
    const liveClaim = claim({
      commandKind: "link_page",
      sequence: 2n,
      parsePagesRootSha256,
      resultAuthority: linked,
    });
    const claims = new Map<
      unknown,
      Readonly<{
        readonly operation: "produce" | "rehydrate";
        readonly claim: DeclarativeV2VerifierRestartClaimV1;
      }>
    >();
    claims.set(producerAuthority, {
      operation: "produce",
      claim: liveClaim,
    });
    const runtime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim(authority, operation) {
        const owned = claims.get(authority);
        if (owned?.operation === operation) return Result.succeed(owned.claim);
        if (authority === rehydrateAuthority && coldClaim !== undefined) {
          return operation === "rehydrate"
            ? Result.succeed(coldClaim)
            : Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
              operation: "createProducer",
              reason: "staleAuthority",
            }));
        }
        return Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
          operation: operation === "produce"
            ? "createProducer"
            : "createRehydrator",
          reason: "staleAuthority",
        }));
      },
    });
    const coldModule = (
      module: DeclarativeV2VerifierModuleResultV1,
      seed: number,
    ): DeclarativeV2VerifierModuleResultV1 => {
      const produceAuthority = Object.freeze({});
      const coldAuthority = Object.freeze({});
      const parseClaim = claim({
        reservationSha256: bytes(seed),
        authenticatedInputSha256: bytes(seed + 1),
        resultAuthority: module,
      });
      claims.set(produceAuthority, {
        operation: "produce",
        claim: parseClaim,
      });
      const producer = Result.getOrThrow(runtime.createProducer({
        authority: produceAuthority,
        maximum,
      }));
      const parsePages: DeclarativeV2VerifierRestartPageV1[] = [];
      let parseComplete:
        | Extract<
          Result.Result.Success<ReturnType<typeof runtime.stepProducer>>,
          { readonly status: "complete" }
        >
        | undefined;
      for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
        const step = Result.getOrThrow(runtime.stepProducer(producer, 1_024));
        if (step.status === "page") parsePages.push(step.page);
        if (step.status === "complete") {
          parseComplete = step;
          break;
        }
      }
      if (parseComplete === undefined) {
        throw new Error("parse restart producer ceiling");
      }
      const parseOutput = Object.freeze({
        kind: "command_output_manifest",
        reservationSha256: parseClaim.reservationSha256,
        commandKind: "parse_module",
        sequence: parseClaim.sequence,
        evidenceRootSha256: parseComplete.finalPageSha256,
        evidenceCount: parseComplete.recordCount,
        diagnosticsRootSha256: parseComplete.diagnosticsRootSha256,
        diagnosticCount: parseComplete.diagnosticCount,
        nextProgressSha256: bytes(seed + 2),
      } satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2);
      const parseOutputBytes = Result.getOrThrow(
        encodeDeclarativeV2VerifierProgressFrameV2(parseOutput, {
          maximumFrameBytes: 100_000,
          maximumCanonicalBytes: 100_000,
        }),
      ).canonicalBytes;
      claims.set(coldAuthority, {
        operation: "rehydrate",
        claim: claim({
          ...parseClaim,
          settledCommandUsage: parseComplete.actualUsage,
          outputManifest: parseOutput,
          outputManifestSha256: Result.getOrThrow(
            deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(
              parseOutputBytes,
            ),
          ),
          receiptSha256: bytes(seed + 3),
          resultAuthority: null,
        }),
      });
      const rehydrator = Result.getOrThrow(runtime.createRehydrator({
        authority: coldAuthority,
        maximum,
        source: pageSource(parsePages),
      }));
      for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
        const step = Result.getOrThrow(
          runtime.stepRehydrator(rehydrator, 1_024),
        );
        if (step.status === "complete" && step.moduleResult !== null) {
          return step.moduleResult;
        }
      }
      throw new Error("parse restart rehydrator ceiling");
    };
    const produced = Result.getOrThrow(runtime.createProducer({
      authority: producerAuthority,
      maximum,
    }));
    const pages: DeclarativeV2VerifierRestartPageV1[] = [];
    let complete: Extract<
      Result.Result.Success<ReturnType<typeof runtime.stepProducer>>,
      { readonly status: "complete" }
    > | undefined;
    for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
      const step = Result.getOrThrow(runtime.stepProducer(produced, 1_024));
      if (step.status === "page") pages.push(step.page);
      if (step.status === "complete") {
        complete = step;
        break;
      }
    }
    if (complete === undefined) throw new Error("link producer ceiling");
    const outputManifest = Object.freeze({
      kind: "command_output_manifest",
      reservationSha256: liveClaim.reservationSha256,
      commandKind: "link_page",
      sequence: liveClaim.sequence,
      evidenceRootSha256: complete.finalPageSha256,
      evidenceCount: complete.recordCount,
      diagnosticsRootSha256: complete.diagnosticsRootSha256,
      diagnosticCount: complete.diagnosticCount,
      nextProgressSha256: bytes(13),
    } satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2);
    const outputBytes = Result.getOrThrow(
      encodeDeclarativeV2VerifierProgressFrameV2(outputManifest, {
        maximumFrameBytes: 100_000,
        maximumCanonicalBytes: 100_000,
      }),
    ).canonicalBytes;
    const coldModules = modules.map((module, index) =>
      coldModule(module, 30 + index * 4)
    );
    const foreignRuntime = makeDeclarativeV2VerifierRestartRuntimeFactoryV1({
      claim() {
        return Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
          operation: "createRehydrator",
          reason: "staleAuthority",
        }));
      },
    });
    const foreignSet = Result.getOrThrow(
      foreignRuntime.createModuleResultSet(),
    );
    expect(
      foreignRuntime.appendModuleResult(foreignSet, coldModules[0]),
    ).toMatchObject({
      failure: { reason: "staleAuthority", path: "moduleResult" },
    });
    const resultSet = Result.getOrThrow(runtime.createModuleResultSet());
    for (const module of coldModules) {
      Result.getOrThrow(runtime.appendModuleResult(resultSet, module));
    }
    Result.getOrThrow(runtime.sealModuleResultSet(resultSet));
    expect(runtime.appendModuleResult(resultSet, coldModules[0])).toMatchObject({
      failure: { reason: "closed" },
    });
    coldClaim = claim({
      ...liveClaim,
      settledCommandUsage: complete.actualUsage,
      outputManifest,
      outputManifestSha256: Result.getOrThrow(
        deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(outputBytes),
      ),
      receiptSha256: bytes(14),
      resultAuthority: null,
      parseModuleResults: resultSet,
    });
    const cold = Result.getOrThrow(runtime.createRehydrator({
      authority: rehydrateAuthority,
      maximum,
      source: pageSource(pages),
    }));
    let coldLink: DeclarativeV2VerifierLinkResultV1 | undefined;
    let recoveryUsage: DeclarativeV2VerifierBudgetFrameV2 | undefined;
    for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
      const step = Result.getOrThrow(runtime.stepRehydrator(cold, 1_024));
      if (step.status === "complete") {
        coldLink = step.linkResult ?? undefined;
        recoveryUsage = step.recoveryUsage;
        break;
      }
    }
    expect(coldLink).toMatchObject({
      moduleCount: 2n,
      diagnosticCount: linked.diagnosticCount,
    });
    expect(recoveryUsage?.modules).toBe(2n);
    const replay = Result.getOrThrow(runtime.createRehydrator({
      authority: rehydrateAuthority,
      maximum,
      source: pageSource(pages),
    }));
    let replayUsage: DeclarativeV2VerifierBudgetFrameV2 | undefined;
    for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
      const step = Result.getOrThrow(runtime.stepRehydrator(replay, 1));
      if (step.status === "complete") {
        replayUsage = step.recoveryUsage;
        break;
      }
    }
    expect(replayUsage).toEqual(recoveryUsage);
    const oneLess = Result.getOrThrow(runtime.createRehydrator({
      authority: rehydrateAuthority,
      maximum: budget("command_budget", 1_000_000n, { modules: 1n }),
      source: pageSource(pages),
    }));
    let oneLessFailure:
      | DeclarativeV2VerifierRestartRuntimeV1Error
      | undefined;
    for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
      const step = runtime.stepRehydrator(oneLess, 1_024);
      if (Result.isFailure(step)) {
        oneLessFailure = step.failure;
        break;
      }
    }
    expect(oneLessFailure).toMatchObject({
      reason: "budgetExceeded",
      dimension: "modules",
      observed: 2n,
      maximum: 1n,
    });
  });
});

function claim(
  overrides: Partial<DeclarativeV2VerifierRestartClaimV1> = {},
): DeclarativeV2VerifierRestartClaimV1 {
  return Object.freeze({
    commandKind: "parse_module",
    sequence: 1n,
    reservationSha256: bytes(1),
    authenticatedInputSha256: bytes(2),
    sourceCommitmentSha256: bytes(3),
    semanticCommitmentSha256: bytes(4),
    settledCommandUsage: budget("attempt_usage", 0n),
    parsePagesRootSha256: null,
    maximumPagePayloadBytes: 100_000n,
    outputManifest: null,
    outputManifestSha256: null,
    receiptSha256: null,
    resultAuthority: null,
    parseModuleResults: null,
    ...overrides,
  });
}

function settledClaim(): DeclarativeV2VerifierRestartClaimV1 {
  const outputManifest = Object.freeze({
    kind: "command_output_manifest",
    reservationSha256: bytes(1),
    commandKind: "parse_module",
    sequence: 1n,
    evidenceRootSha256: bytes(5),
    evidenceCount: 1n,
    diagnosticsRootSha256: new Uint8Array(32),
    diagnosticCount: 0n,
    nextProgressSha256: bytes(6),
  } satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2);
  return claim({
    outputManifest,
    outputManifestSha256: bytes(7),
    receiptSha256: bytes(8),
  });
}

function bytes(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function artifactPath(spelling: string): DeclarativeV2ArtifactModulePathHandleV1 {
  const value = encoder.encode(spelling);
  const created = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      3,
      value.byteLength,
      value.byteLength,
    ),
  );
  Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(created, value, 1_024),
  );
  const finished = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(created, 1),
  );
  if ("status" in finished) throw new Error("path did not complete");
  return finished;
}

function runModule(
  sourceText: string,
  path: string,
  ordinal: bigint,
): DeclarativeV2VerifierModuleResultV1 {
  const source = encoder.encode(sourceText);
  const maximum = budget("command_budget");
  const created = Result.getOrThrow(createDeclarativeV2VerifierEngineV1({
    modulePath: artifactPath(path),
    moduleOrdinal: ordinal,
    sourceSha256: new Uint8Array(
      createHash("sha256").update(source).digest(),
    ),
    maximums: maximum,
    required: budget("attempt_usage"),
  }));
  driveSource(created, source);
  for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
    const finished = Result.getOrThrow(created.finish(1_024));
    if (!("status" in finished)) return finished;
  }
  throw new Error("verifier finish ceiling");
}

function driveSource(engine: DeclarativeV2VerifierEngineV1, source: Uint8Array): void {
  let offset = 0;
  for (let iteration = 0; iteration < 1_000_000 && offset < source.byteLength; iteration += 1) {
    const stepped = Result.getOrThrow(engine.step(source.subarray(offset), 1_024));
    offset += stepped.consumedBytes;
  }
  if (offset !== source.byteLength) throw new Error("verifier source ceiling");
}

function handler(
  access: ReturnType<typeof makeDeclarativeV2VerifierResultAccessFactoryV1>,
  module: DeclarativeV2VerifierModuleResultV1,
  path: string,
  exportName: string,
): boolean {
  const lookup = Result.getOrThrow(access.handlerLookup(
    module,
    artifactPath(path),
    encoder.encode(exportName),
    budget("command_budget"),
  ));
  for (let iteration = 0; iteration < 100_000; iteration += 1) {
    const stepped = Result.getOrThrow(access.stepHandlerLookup(lookup, 1_024));
    if (stepped.status === "complete") return stepped.matched;
  }
  throw new Error("lookup ceiling");
}

function runLink(
  modules: ReadonlyArray<DeclarativeV2VerifierModuleResultV1>,
  maximum: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierLinkResultV1 {
  const linker = Result.getOrThrow(
    createDeclarativeV2VerifierLinkerV1(
      maximum,
      Object.freeze({
        ...maximum,
        kind: "attempt_usage",
      }),
    ),
  );
  for (const module of modules) {
    for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
      const appended = appendDeclarativeV2VerifierLinkerModuleV1(linker, module);
      if (Result.isSuccess(appended)) break;
      if (appended.failure.reason !== "invalidState") throw appended.failure;
      Result.getOrThrow(stepDeclarativeV2VerifierLinkerV1(linker, 1_024));
    }
  }
  for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
    const finished = Result.getOrThrow(
      finishDeclarativeV2VerifierLinkerV1(linker, 1_024),
    );
    if (!("status" in finished)) return finished;
  }
  throw new Error("linker ceiling");
}

function pageSource(pages: ReadonlyArray<DeclarativeV2VerifierRestartPageV1>) {
  return {
    metadata(pageOrdinal: bigint) {
      const page = pages[Number(pageOrdinal)];
      return Result.succeed(page === undefined
        ? null
        : Object.freeze({
          manifestBytes: page.manifestBytes,
          manifestSha256: page.manifestSha256,
        }));
    },
    body(pageOrdinal: bigint, admittedByteLength: bigint) {
      const page = pages[Number(pageOrdinal)];
      if (
        page === undefined ||
        BigInt(page.payloadBytes.byteLength) !== admittedByteLength
      ) {
        return Result.fail(new DeclarativeV2VerifierRestartRuntimeV1Error({
          operation: "rehydrate",
          reason: "corruption",
        }));
      }
      return Result.succeed(page.payloadBytes);
    },
  };
}

function budget(
  kind: "attempt_usage" | "command_budget",
  value = 1_000_000n,
  overrides: Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>> = {},
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
        dimension === "sourceMapBytes"
          ? 0n
          : dimension === "semanticBytes"
          ? 0n
          : dimension === "tableBytes"
          ? tableBytes
          : value,
      ]),
    ),
    ...overrides,
  }) as DeclarativeV2VerifierBudgetFrameV2;
}
