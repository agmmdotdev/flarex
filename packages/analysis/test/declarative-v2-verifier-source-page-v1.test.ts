import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { isUint8Array } from "@flarex/utils/bytes";
import { Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  decodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  isSourceArtifactV2ModuleRolesV1,
  type SourceArtifactV2ModuleRolesV1,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { describe, expect, test } from "vitest";

import {
  DECLARATIVE_V2_VERIFIER_SOURCE_PAGE_TRANSITION_QUANTUM_V1,
  DeclarativeV2VerifierSourcePageV1Error,
  makeDeclarativeV2VerifierSourcePageFactoryV1,
  type DeclarativeV2VerifierSourcePageBindingsV1,
  type DeclarativeV2VerifierSourcePageCompleteV1,
  type DeclarativeV2VerifierSourcePageInputV1,
  type DeclarativeV2VerifierSourcePageModuleMetadataV1,
} from "../src/declarativeV2VerifierSourcePageV1";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 65_536,
  maximumCanonicalBytes: 65_536,
});

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function bindings(seed = 1): DeclarativeV2VerifierSourcePageBindingsV1 {
  return Object.freeze({
    attemptSha256: digest(seed),
    candidateSha256: digest(seed + 1),
    reservationSha256: digest(seed + 2),
    authenticatedInputSha256: digest(seed + 3),
    rangeAndPredecessorTailsSha256: digest(seed + 4),
    analyzerIdentitySha256: digest(seed + 5),
    verifierIdentitySha256: digest(seed + 6),
  });
}

function budget(
  mutate?: Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>>,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind: "command_budget",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        mutate?.[dimension] ?? MAX_SIGNED_INT64,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function moduleMetadata(
  ordinal: bigint,
  path: string,
  sourceByteLength: bigint,
  rawRoles = 1,
): DeclarativeV2VerifierSourcePageModuleMetadataV1 {
  if (!isSourceArtifactV2ModuleRolesV1(rawRoles)) {
    throw new Error("Test module roles must satisfy the protocol contract.");
  }
  const roles: SourceArtifactV2ModuleRolesV1 = rawRoles;
  return Object.freeze({
    moduleOrdinal: ordinal,
    roles,
    modulePathBytes: new TextEncoder().encode(path),
    frameSha256: digest(Number(ordinal) + 20),
    sourceSha256: digest(Number(ordinal) + 30),
    sourceByteLength,
  });
}

function crossRealmSharedBytes(byteLength: number): Uint8Array {
  const value = runInNewContext(
    `new Uint8Array(new SharedArrayBuffer(${byteLength}))`,
  );
  if (!isUint8Array(value)) {
    throw new Error("Cross-realm fixture did not produce a Uint8Array.");
  }
  return value;
}

function fixture(
  mutate?: Partial<DeclarativeV2VerifierSourcePageInputV1>,
): DeclarativeV2VerifierSourcePageInputV1 {
  return Object.freeze({
    bindings: bindings(),
    commandKind: "source_page",
    sequence: 1n,
    currentProgress: Object.freeze({
      kind: "progress_cursor",
      phase: "source",
      settledSequence: 0n,
      moduleOrdinal: 0n,
      edgeOrdinal: 0n,
      pageOrdinal: 0n,
      previousReceiptSha256: null,
    }),
    predecessorReceiptSha256: null,
    commandBudget: budget(),
    range: Object.freeze({
      kind: "source_page",
      firstModuleOrdinal: 0n,
      moduleCount: 2n,
      totalModuleCount: 2n,
      sourceByteLength: 8n,
      semanticByteLength: 0n,
    }),
    modules: Object.freeze([
      moduleMetadata(0n, "a.ts", 3n, 1),
      moduleMetadata(1n, "lib/b.ts", 5n, 3),
    ]),
    ...mutate,
  });
}

function expectFailureReason(
  result: Result.Result<unknown, DeclarativeV2VerifierSourcePageV1Error>,
  reason: DeclarativeV2VerifierSourcePageV1Error["reason"],
  path?: string,
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isSuccess(result)) return;
  expect(result.failure.reason).toBe(reason);
  if (path !== undefined) expect(result.failure.path).toBe(path);
}

function run(
  input: DeclarativeV2VerifierSourcePageInputV1 = fixture(),
  stepAllowance = 1,
  finishAllowance = 1_024,
): Result.Result<
  DeclarativeV2VerifierSourcePageCompleteV1,
  DeclarativeV2VerifierSourcePageV1Error
> {
  const factory = makeDeclarativeV2VerifierSourcePageFactoryV1();
  const created = factory.create(input, bindings());
  if (Result.isFailure(created)) return Result.fail(created.failure);
  for (let count = 0; count < 200_000; count += 1) {
    const stepped = factory.step(created.success, stepAllowance);
    if (Result.isFailure(stepped)) return Result.fail(stepped.failure);
    if (stepped.success.status === "ready") break;
    if (count === 199_999) throw new Error("source step did not become ready");
  }
  for (let count = 0; count < 200_000; count += 1) {
    const finished = factory.finish(created.success, finishAllowance);
    if (Result.isFailure(finished)) return Result.fail(finished.failure);
    if (finished.success.status === "complete") {
      return Result.succeed(finished.success);
    }
    if (count === 199_999) throw new Error("source finish did not complete");
  }
  throw new Error("unreachable");
}

function finishDriver(
  factory: ReturnType<typeof makeDeclarativeV2VerifierSourcePageFactoryV1>,
  driver: unknown,
  allowance: number,
): Result.Result<
  DeclarativeV2VerifierSourcePageCompleteV1,
  DeclarativeV2VerifierSourcePageV1Error
> {
  for (let count = 0; count < 200_000; count += 1) {
    const finished = factory.finish(driver, allowance);
    if (Result.isFailure(finished)) return Result.fail(finished.failure);
    if (finished.success.status === "complete") {
      return Result.succeed(finished.success);
    }
  }
  throw new Error("source finish did not complete");
}

function success(
  result: Result.Result<
    DeclarativeV2VerifierSourcePageCompleteV1,
    DeclarativeV2VerifierSourcePageV1Error
  >,
): DeclarativeV2VerifierSourcePageCompleteV1 {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

describe("Declarative V2 source-page accumulator and terminal driver", () => {
  test("owns deterministic source-page output without charging foreign ledgers", () => {
    const completed = success(run());
    expect(completed.actual).toEqual(completed.required);
    expect(completed.receipt.aggregateTransitions).toBe(
      completed.actual.calls,
    );
    expect(completed.actual.modules).toBe(2n);
    expect(completed.actual.graphNodes).toBe(2n);
    expect(completed.actual.frontierEntries).toBe(1n);
    expect(completed.actual.stringBytes).toBe(12n);
    for (const dimension of [
      "objectCalls",
      "objectBodyBytes",
      "sourceBytes",
      "sourceMapBytes",
      "semanticBytes",
      "importEdges",
      "exports",
      "functions",
      "tokens",
      "tokenBytes",
      "parserStates",
      "nestingDepth",
      "schemaNodes",
      "validatorNodes",
      "diagnosticBytes",
      "elapsedMilliseconds",
    ] satisfies readonly DeclarativeV2VerifierBudgetDimensionV2[]) {
      expect(completed.actual[dimension], dimension).toBe(0n);
    }
    expect(completed.nextProgress).toMatchObject({
      phase: "parse",
      settledSequence: 1n,
      moduleOrdinal: 0n,
      edgeOrdinal: 0n,
      pageOrdinal: 0n,
      previousReceiptSha256: null,
    });
    expect(completed.outputManifest).toMatchObject({
      commandKind: "source_page",
      sequence: 1n,
      evidenceCount: 2n,
      diagnosticCount: 0n,
    });
    const next = decodeDeclarativeV2VerifierProgressFrameV2(
      completed.nextProgressBytes,
      FRAME_BUDGET,
    );
    const output = decodeDeclarativeV2VerifierProgressFrameV2(
      completed.outputManifestBytes,
      FRAME_BUDGET,
    );
    expect(Result.isSuccess(next) && next.success.frame.kind).toBe(
      "progress_cursor",
    );
    expect(Result.isSuccess(output) && output.success.frame.kind).toBe(
      "command_output_manifest",
    );
  });

  test("is equal across one-transition accumulation, large quanta, and cold factories", () => {
    const one = success(run(fixture(), 1, 1));
    const large = success(run(fixture(), 1_024, 1_024));
    const cold = success(run(fixture(), 17, 1_024));
    for (const other of [large, cold]) {
      expect(other.required).toEqual(one.required);
      expect(other.actual).toEqual(one.actual);
      expect(other.evidenceBytes).toEqual(one.evidenceBytes);
      expect(other.nextProgressBytes).toEqual(one.nextProgressBytes);
      expect(other.outputManifestBytes).toEqual(one.outputManifestBytes);
      expect(other.evidenceRootSha256).toEqual(one.evidenceRootSha256);
      expect(other.diagnosticsRootSha256).toEqual(
        one.diagnosticsRootSha256,
      );
    }
  });

  test("accepts zero work, rejects allowance 1025, and terminalizes misuse", () => {
    const factory = makeDeclarativeV2VerifierSourcePageFactoryV1();
    const created = factory.create(fixture(), bindings());
    if (Result.isFailure(created)) throw created.failure;
    const zero = factory.step(created.success, 0);
    expect(Result.isSuccess(zero) && zero.success.status).toBe("pending");
    if (Result.isSuccess(zero)) {
      expect(zero.success.receipt.deltaTransitions).toBe(0);
      expect(zero.success.receipt.aggregateTransitions).toBe(0n);
    }
    expectFailureReason(
      factory.step(created.success, 1_025),
      "invalidInput",
      "allowance",
    );
    expectFailureReason(factory.step(created.success, 1), "closed");

    const finishing = factory.create(fixture(), bindings());
    if (Result.isFailure(finishing)) throw finishing.failure;
    while (true) {
      const stepped = factory.step(finishing.success, 1_024);
      if (Result.isFailure(stepped)) throw stepped.failure;
      if (stepped.success.status === "ready") break;
    }
    const finishZero = factory.finish(finishing.success, 0);
    expect(Result.isSuccess(finishZero) && finishZero.success.status).toBe(
      "pending",
    );
    if (Result.isSuccess(finishZero)) {
      expect(finishZero.success.receipt.deltaTransitions).toBe(0);
    }
    expect(success(finishDriver(factory, finishing.success, 1))).toEqual(
      success(run(fixture(), 1_024, 1)),
    );
  });

  test("requires exact identities, source transition, predecessor, and contiguous range", () => {
    const factory = makeDeclarativeV2VerifierSourcePageFactoryV1();
    expectFailureReason(
      factory.create(fixture(), bindings(2)),
      "identityMismatch",
      "bindings",
    );
    expectFailureReason(
      factory.create(fixture({
        sequence: 2n,
      }), bindings()),
      "invalidTransition",
      "currentProgress",
    );
    const predecessor = digest(90);
    expectFailureReason(
      factory.create(fixture({
        predecessorReceiptSha256: predecessor,
      }), bindings()),
      "invalidTransition",
      "currentProgress",
    );
    const wrongOrdinal = fixture({
      modules: Object.freeze([
        moduleMetadata(1n, "a.ts", 3n),
        moduleMetadata(2n, "b.ts", 5n),
      ]),
    });
    const created = factory.create(wrongOrdinal, bindings());
    if (Result.isFailure(created)) throw created.failure;
    expectFailureReason(
      factory.step(created.success, 1),
      "rangeMismatch",
      "modules.0.moduleOrdinal",
    );
  });

  test("moves to the next source page before the terminal source page", () => {
    const input = fixture({
      range: Object.freeze({
        kind: "source_page",
        firstModuleOrdinal: 0n,
        moduleCount: 2n,
        totalModuleCount: 4n,
        sourceByteLength: 8n,
        semanticByteLength: 0n,
      }),
    });
    const completed = success(run(input));
    expect(completed.nextProgress).toMatchObject({
      phase: "source",
      moduleOrdinal: 2n,
      edgeOrdinal: 0n,
      pageOrdinal: 0n,
    });
  });

  test("checks every nonzero dimension at exact and one-less ceilings", () => {
    const baseline = success(run());
    expect(success(run(fixture({
      commandBudget: Object.freeze({
        ...baseline.required,
        kind: "command_budget",
      }),
    }))).actual).toEqual(baseline.required);
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const exact = baseline.required[dimension];
      if (exact === 0n) continue;
      const constrained = fixture({
        commandBudget: budget({ [dimension]: exact - 1n }),
      });
      const failed = run(constrained);
      expectFailureReason(failed, "budgetExceeded", dimension);
    }
  });

  test("rejects declared source totals, addressability, and checked transition overflow", () => {
    expectFailureReason(
      run(fixture({
        range: Object.freeze({
          ...fixture().range,
          sourceByteLength: 9n,
        }),
      })),
      "rangeMismatch",
      "range.sourceByteLength",
    );
    const factory = makeDeclarativeV2VerifierSourcePageFactoryV1();
    expectFailureReason(
      factory.create(fixture({
        range: Object.freeze({
          ...fixture().range,
          firstModuleOrdinal: MAX_SIGNED_INT64,
          totalModuleCount: MAX_SIGNED_INT64,
        }),
        currentProgress: Object.freeze({
          ...fixture().currentProgress,
          moduleOrdinal: MAX_SIGNED_INT64,
        }),
      }), bindings()),
      "overflow",
      "range.moduleOrdinal",
    );
    expectFailureReason(
      factory.create(fixture({
        range: Object.freeze({
          ...fixture().range,
          moduleCount: 1_025n,
          totalModuleCount: 1_025n,
        }),
      }), bindings()),
      "addressabilityExceeded",
      "modules.length",
    );
    const tooMany = Object.freeze(
      Array.from({ length: 1_025 }, () => moduleMetadata(0n, "a.ts", 1n)),
    );
    const overAddressable = factory.create(fixture({
      range: Object.freeze({
        ...fixture().range,
        moduleCount: 1_025n,
        totalModuleCount: 1_025n,
      }),
      modules: tooMany,
    }), bindings());
    expectFailureReason(
      overAddressable,
      "addressabilityExceeded",
      "modules.length",
    );
    if (Result.isFailure(overAddressable)) {
      expect(overAddressable.failure.observed).toBe(1_025n);
      expect(overAddressable.failure.maximum).toBe(1_024n);
    }
  });

  test("captures hostile descriptors without invoking getters and owns module bytes", () => {
    let reads = 0;
    const hostile = Object.defineProperty({}, "bindings", {
      enumerable: true,
      get() {
        reads += 1;
        return bindings();
      },
    });
    const factory = makeDeclarativeV2VerifierSourcePageFactoryV1();
    expectFailureReason(factory.create(hostile, bindings()), "invalidInput");
    expect(reads).toBe(0);

    const revokedObject = Proxy.revocable({}, {});
    revokedObject.revoke();
    expectFailureReason(
      factory.create(revokedObject.proxy, bindings()),
      "invalidInput",
    );
    const revokedArray = Proxy.revocable([], {});
    revokedArray.revoke();
    expectFailureReason(
      factory.create(fixture({
        modules: revokedArray.proxy,
      }), bindings()),
      "invalidInput",
      "modules",
    );

    const input = fixture();
    const first = input.modules[0]!;
    const path = first.modulePathBytes;
    const frame = first.frameSha256;
    const created = factory.create(input, bindings());
    if (Result.isFailure(created)) throw created.failure;
    while (true) {
      const stepped = factory.step(created.success, 1_024);
      if (Result.isFailure(stepped)) throw stepped.failure;
      if (stepped.success.status === "ready") break;
    }
    path.fill(0xff);
    frame.fill(0xee);
    let completed: DeclarativeV2VerifierSourcePageCompleteV1 | undefined;
    while (completed === undefined) {
      const finished = factory.finish(created.success, 1_024);
      if (Result.isFailure(finished)) throw finished.failure;
      if (finished.success.status === "complete") completed = finished.success;
    }
    expect(completed.evidenceBytes).not.toContain(0xff);
  });

  test("captures hostile module arrays once and releases them before finishing", () => {
    const first = Proxy.revocable(moduleMetadata(0n, "a.ts", 3n), {});
    const second = Proxy.revocable(moduleMetadata(1n, "b.ts", 5n), {});
    const rawModules = [first.proxy, second.proxy];
    let lengthGets = 0;
    let lengthDescriptors = 0;
    const indexDescriptors = new Map<PropertyKey, number>();
    const modules = Proxy.revocable(rawModules, {
      get(target, property, receiver) {
        if (property === "length") lengthGets += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        if (property === "length") {
          lengthDescriptors += 1;
        } else {
          indexDescriptors.set(
            property,
            (indexDescriptors.get(property) ?? 0) + 1,
          );
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const factory = makeDeclarativeV2VerifierSourcePageFactoryV1();
    const created = factory.create(fixture({
      modules: modules.proxy,
    }), bindings());
    if (Result.isFailure(created)) throw created.failure;
    while (true) {
      const stepped = factory.step(created.success, 1);
      if (Result.isFailure(stepped)) throw stepped.failure;
      if (stepped.success.status === "ready") break;
    }
    expect(lengthGets).toBe(0);
    expect(lengthDescriptors).toBe(1);
    expect(indexDescriptors.get("0")).toBe(1);
    expect(indexDescriptors.get("1")).toBe(1);
    modules.revoke();
    first.revoke();
    second.revoke();
    expect(Result.isSuccess(finishDriver(factory, created.success, 1))).toBe(
      true,
    );
  });

  test("fails closed when borrowed module bytes detach before ownership", () => {
    const input = fixture();
    const path = input.modules[0]!.modulePathBytes;
    structuredClone(path.buffer, { transfer: [path.buffer] });
    expectFailureReason(
      run(input, 1),
      "invalidInput",
      "modules.0.modulePathBytes",
    );
  });

  test("rejects shared-backed module paths and digests before retention", () => {
    for (const sharedPath of [
      new Uint8Array(new SharedArrayBuffer(4)),
      crossRealmSharedBytes(4),
    ]) {
      sharedPath.set(new TextEncoder().encode("a.ts"));
      expectFailureReason(
        run(fixture({
          modules: Object.freeze([
            Object.freeze({
              ...moduleMetadata(0n, "a.ts", 3n),
              modulePathBytes: sharedPath,
            }),
            moduleMetadata(1n, "b.ts", 5n),
          ]),
        })),
        "invalidInput",
        "modules.0.modulePathBytes",
      );
    }
    for (const sharedDigest of [
      new Uint8Array(new SharedArrayBuffer(32)),
      crossRealmSharedBytes(32),
    ]) {
      sharedDigest.fill(20);
      expectFailureReason(
        run(fixture({
          modules: Object.freeze([
            Object.freeze({
              ...moduleMetadata(0n, "a.ts", 3n),
              frameSha256: sharedDigest,
            }),
            moduleMetadata(1n, "b.ts", 5n),
          ]),
        })),
        "invalidInput",
        "modules.0.frameSha256",
      );
    }
  });

  test("admits exact role, canonical path, digest, and positive source metadata", () => {
    for (const roles of [0, 16]) {
      expectFailureReason(
        run(fixture({
          modules: Object.freeze([
            Object.freeze({
              ...moduleMetadata(0n, "a.ts", 3n),
              roles,
            }) as unknown as DeclarativeV2VerifierSourcePageModuleMetadataV1,
            moduleMetadata(1n, "b.ts", 5n),
          ]),
        })),
        "invalidInput",
        "modules.0.roles",
      );
    }
    for (const pathBytes of [
      new TextEncoder().encode("a//b.ts"),
      new Uint8Array([0xff]),
    ]) {
      const module = Object.freeze({
        ...moduleMetadata(0n, "a.ts", 3n),
        modulePathBytes: pathBytes,
      });
      expectFailureReason(
        run(fixture({
          modules: Object.freeze([
            module,
            moduleMetadata(1n, "b.ts", 5n),
          ]),
        })),
        "invalidInput",
        "modules.0.modulePathBytes",
      );
    }
    expectFailureReason(
      run(fixture({
        range: Object.freeze({
          ...fixture().range,
          sourceByteLength: 5n,
        }),
        modules: Object.freeze([
          moduleMetadata(0n, "a.ts", 0n),
          moduleMetadata(1n, "b.ts", 5n),
        ]),
      })),
      "invalidInput",
      "modules.0.sourceByteLength",
    );
  });

  test("preserves canonical validation before command-budget admission", () => {
    const invalidPath = new TextEncoder().encode("a//b.ts");
    const invalid = fixture({
      commandBudget: budget({ calls: 0n }),
      range: Object.freeze({
        kind: "source_page",
        firstModuleOrdinal: 0n,
        moduleCount: 1n,
        totalModuleCount: 1n,
        sourceByteLength: 1n,
        semanticByteLength: 0n,
      }),
      modules: Object.freeze([
        Object.freeze({
          ...moduleMetadata(0n, "a.ts", 1n),
          modulePathBytes: invalidPath,
        }),
      ]),
    });
    expectFailureReason(
      run(invalid, 1_024),
      "invalidInput",
      "modules.0.modulePathBytes",
    );
    expectFailureReason(
      run(fixture({ commandBudget: budget({ calls: 0n }) }), 1_024),
      "budgetExceeded",
      "calls",
    );
  });

  test("fails closed for forged, cross-factory, closed, reused, and premature handles", () => {
    const left = makeDeclarativeV2VerifierSourcePageFactoryV1();
    const right = makeDeclarativeV2VerifierSourcePageFactoryV1();
    const created = left.create(fixture(), bindings());
    if (Result.isFailure(created)) throw created.failure;
    expectFailureReason(right.step(created.success, 1), "staleHandle");
    expectFailureReason(left.step({ ...created.success }, 1), "staleHandle");
    expectFailureReason(
      left.finish(created.success, 1),
      "invalidTransition",
      "driver.notReady",
    );
    expectFailureReason(left.step(created.success, 1), "closed");

    const closable = left.create(fixture(), bindings());
    if (Result.isFailure(closable)) throw closable.failure;
    expect(Result.isSuccess(left.close(closable.success))).toBe(true);
    expectFailureReason(left.close(closable.success), "closed");

    const active = left.create(fixture(), bindings());
    if (Result.isFailure(active)) throw active.failure;
    while (true) {
      const stepped = left.step(active.success, 1_024);
      if (Result.isFailure(stepped)) throw stepped.failure;
      if (stepped.success.status === "ready") break;
    }
    for (let count = 0; count < 360; count += 1) {
      const finished = left.finish(active.success, 1);
      if (Result.isFailure(finished)) throw finished.failure;
      expect(finished.success.status).toBe("pending");
    }
    expect(Result.isSuccess(left.close(active.success))).toBe(true);
    expectFailureReason(left.finish(active.success, 1), "closed");
  });

  test("keeps the package root closed and has no production caller", async () => {
    const root = await import("../src/index");
    expect(
      "makeDeclarativeV2VerifierSourcePageFactoryV1" in root,
    ).toBe(false);
    const source = await import("../src/declarativeV2VerifierSourcePageV1");
    expect(typeof source.makeDeclarativeV2VerifierSourcePageFactoryV1).toBe(
      "function",
    );
  });

  test("retains fixed source-page authority and Result-only ownership", () => {
    expect(DECLARATIVE_V2_VERIFIER_SOURCE_PAGE_TRANSITION_QUANTUM_V1).toBe(
      1_024,
    );
    expect(
      new DeclarativeV2VerifierSourcePageV1Error({
        operation: "create",
        reason: "invalidInput",
      })._tag,
    ).toBe("DeclarativeV2VerifierSourcePageV1Error");
    const implementation = readFileSync(
      new URL("../src/declarativeV2VerifierSourcePageV1.ts", import.meta.url),
      "utf8",
    );
    expect(implementation).toContain(
      "makeDeclarativeV2VerifierProgressFrameEncoderFactoryV2",
    );
    expect(implementation).not.toContain(
      "encodeDeclarativeV2VerifierProgressFrameIntoV2",
    );
    expect(implementation).not.toContain("protocolCredit");
    expect(implementation).not.toContain("admitAtomicProtocolWork");
    expect(implementation).not.toContain("sealPlan");
  });
});
