import { createHash } from "node:crypto";

import { Result } from "effect";
import {
  decodeDeclarativeV2PhysicalFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
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
  type DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, test } from "vitest";

import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "../src/declarativeV2ArtifactModulePathV1";
import {
  createDeclarativeV2VerifierEngineV1,
  DeclarativeV2VerifierExecutableV1Error,
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
  makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1,
  makeDeclarativeV2VerifierExecutableRestartBridgeV1,
  type DeclarativeV2VerifierAuthenticatedLinkBindingsV1,
  type DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
  type DeclarativeV2VerifierAuthenticatedLinkFactoryV1,
  type DeclarativeV2VerifierLinkResultV1,
  type DeclarativeV2VerifierModuleResultV1,
} from "../src/declarativeV2VerifierExecutableV1";
import {
  makeDeclarativeV2VerifierRegistrationFactoryV1,
  type DeclarativeV2VerifierRegistrationBindingsV1,
  type DeclarativeV2VerifierRegistrationCompleteV1,
  type DeclarativeV2VerifierRegistrationDriverV1,
  type DeclarativeV2VerifierRegistrationInputV1,
  type DeclarativeV2VerifierRegistrationV1Error,
} from "../src/declarativeV2VerifierRegistrationV1";
import {
  makeDeclarativeV2SemanticStreamBudgetV1,
} from "../src/declarativeV2SemanticRecordsV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
} from "../src/declarativeV2VerifierV1";

const UTF8 = new TextEncoder();
const SOURCE = "export function getThing() { return \"ok\"; }";
const SEMANTIC_RECORDS = Object.freeze([
  { kind: "header", version: 1 },
  { kind: "module", modulePath: "functions/example.js" },
  {
    kind: "function",
    path: "example:getThing",
    modulePath: "functions/example.js",
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
    modulePath: "functions/example.js",
    exportName: "getThing",
  },
] satisfies ReadonlyArray<DeclarativeV2SemanticRecordV1>);

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
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      created,
      bytes,
      1_024,
    ),
  );
  return Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(created, 1),
  ) as DeclarativeV2ArtifactModulePathHandleV1;
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
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => {
        const value = dimension === "objectBodyBytes" ||
            dimension === "sourceBytes"
          ? BigInt(sourceBytes)
          : dimension === "sourceMapBytes" || dimension === "semanticBytes"
          ? 0n
          : dimension === "modules"
          ? 1n
          : dimension === "tableBytes"
          ? tableBytes
          : dimension === "calls"
          ? 1_000_000n
          : dimension.endsWith("Bytes")
          ? 100_000n
          : 1_024n;
        return [dimension, mutate?.[dimension] ?? value];
      }),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function registrationBudget(
  mutate?: Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>>,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind: "command_budget",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        mutate?.[dimension] ?? 100_000n,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function runModule(
  modulePath = "functions/example.js",
  source = SOURCE,
  moduleOrdinal = 0n,
): DeclarativeV2VerifierModuleResultV1 {
  const bytes = UTF8.encode(source);
  const created = Result.getOrThrow(createDeclarativeV2VerifierEngineV1({
    modulePath: artifactModulePath(modulePath),
    moduleOrdinal,
    sourceSha256: new Uint8Array(32).fill(17),
    maximums: budget("command_budget", bytes.byteLength),
    required: budget("attempt_usage", bytes.byteLength),
  }));
  let offset = 0;
  while (offset < bytes.byteLength) {
    const stepped = Result.getOrThrow(created.step(bytes.subarray(offset), 1_024));
    offset += stepped.consumedBytes;
  }
  for (let guard = 0; guard < 1_000_000; guard += 1) {
    const finished = Result.getOrThrow(created.finish(1_024));
    if (!("status" in finished)) return finished;
  }
  throw new Error("module fixture did not terminate");
}

function linkBindings(
  seed = 41,
  currentProgressSha256 = new Uint8Array(32).fill(seed + 5),
): DeclarativeV2VerifierAuthenticatedLinkBindingsV1 {
  return Object.freeze({
    attemptSha256: new Uint8Array(32).fill(seed),
    futureRegistrationIntentSha256:
      new Uint8Array(32).fill(seed + 1),
    candidateSha256: new Uint8Array(32).fill(seed + 2),
    authenticatedInputSha256: new Uint8Array(32).fill(seed + 3),
    linkSequence: 7n,
    parsePagesRootSha256: new Uint8Array(32).fill(seed + 4),
    currentProgressSha256,
    predecessorAndTailsSha256: new Uint8Array(32).fill(seed + 6),
    rangeSha256: new Uint8Array(32).fill(seed + 7),
    analyzerReleaseSha256: new Uint8Array(32).fill(seed + 8),
    analyzerIdentitySha256: new Uint8Array(32).fill(seed + 9),
    verifierIdentitySha256: new Uint8Array(32).fill(seed + 10),
  });
}

interface LinkFixture {
  readonly factory: DeclarativeV2VerifierAuthenticatedLinkFactoryV1;
  readonly bindings: DeclarativeV2VerifierAuthenticatedLinkBindingsV1;
  readonly result: DeclarativeV2VerifierLinkResultV1;
}

interface LinkedModuleFixture {
  readonly modulePath: string;
  readonly source: string;
}

function reconstructColdModule(
  warm: DeclarativeV2VerifierModuleResultV1,
): DeclarativeV2VerifierModuleResultV1 {
  const sourceByteLength = Number(warm.usage.sourceBytes);
  const bridge = makeDeclarativeV2VerifierExecutableRestartBridgeV1();
  const maximum = budget("command_budget", sourceByteLength);
  const opened = Result.getOrThrow(bridge.openModuleRecords(
    warm,
    new Uint8Array(32).fill(149),
    maximum,
  ));
  const records: Array<Parameters<typeof bridge.appendModuleRecord>[1]> = [];
  for (let guard = 0; guard < 1_000_000; guard += 1) {
    const read = Result.getOrThrow(bridge.readModuleRecord(opened, 1_024));
    if (read.status === "complete") break;
    if (read.status === "item") records.push(read.record);
  }
  const builder = Result.getOrThrow(bridge.createModuleBuilder(
    maximum,
    budget("attempt_usage", sourceByteLength),
  ));
  for (const record of records) {
    Result.getOrThrow(bridge.appendModuleRecord(builder, record));
  }
  for (let guard = 0; guard < 1_000_000; guard += 1) {
    const finished = Result.getOrThrow(bridge.finishModuleBuilder(
      builder,
      1_024,
    ));
    if (finished.status === "complete") return finished.result;
  }
  throw new Error("cold registration module reconstruction did not terminate");
}

function runLink(
  coldModule = false,
  bindings = linkBindings(),
  modulePath = "functions/example.js",
  source = SOURCE,
  additionalModules: ReadonlyArray<LinkedModuleFixture> = [],
): LinkFixture {
  const warmModules = [
    { modulePath, source },
    ...additionalModules,
  ].map((entry, index) =>
    runModule(entry.modulePath, entry.source, BigInt(index))
  );
  const modules = warmModules.map(module =>
    coldModule ? reconstructColdModule(module) : module
  );
  const claims = modules.map((module, index) =>
    Object.freeze({
      ...bindings,
      moduleOrdinal: BigInt(index),
      producingParseResultSha256: new Uint8Array(
        Buffer.from(module.evidenceSha256, "hex"),
      ),
    }) satisfies DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1
  );
  const factory = makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
    claim: candidate => {
      const index = modules.findIndex(module => candidate === module);
      return index >= 0
        ? Result.succeed(claims[index]!)
        : Result.fail(new DeclarativeV2VerifierExecutableV1Error({
          operation: "link",
          reason: "invalidInput",
        }));
    },
  });
  const commandBudget = budget("command_budget", 0, {
    objectBodyBytes: 0n,
    sourceBytes: 0n,
    modules: BigInt(modules.length),
  });
  const accumulator = Result.getOrThrow(factory.create(bindings, commandBudget));
  for (const module of modules) {
    for (let guard = 0; guard < 1_000_000; guard += 1) {
      const admitted = Result.getOrThrow(
        factory.admit(accumulator, module, 1_024),
      );
      if (admitted.status === "ready") break;
    }
  }
  const sealed = Result.getOrThrow(factory.seal(accumulator, 1_024));
  if (sealed.status !== "complete") throw new Error("link fixture did not seal");
  for (let guard = 0; guard < 1_000_000; guard += 1) {
    const stepped = Result.getOrThrow(factory.step(sealed.driver, 1_024));
    if (!("status" in stepped)) {
      return Object.freeze({ factory, bindings, result: stepped });
    }
  }
  throw new Error("link fixture did not terminate");
}

function semanticBytes(
  records: ReadonlyArray<DeclarativeV2SemanticRecordV1> = SEMANTIC_RECORDS,
): Uint8Array {
  const lines = records.map(encodeDeclarativeV2SemanticRecordV1);
  const bytes = new Uint8Array(
    lines.reduce((total, line) => total + line.byteLength, 0),
  );
  let offset = 0;
  for (const line of lines) {
    bytes.set(line, offset);
    offset += line.byteLength;
  }
  return bytes;
}

function semanticBudgetFor(
  records: ReadonlyArray<DeclarativeV2SemanticRecordV1>,
  bytes: Uint8Array,
) {
  return Result.getOrThrow(
    makeDeclarativeV2SemanticStreamBudgetV1(
      bytes.byteLength,
      Math.max(
        ...records.map(record =>
          encodeDeclarativeV2SemanticRecordPayloadV1(record).byteLength
        ),
      ),
      records.length,
      records.reduce(
        (total, record) =>
          total + encodeDeclarativeV2SemanticRecordPayloadV1(record).byteLength,
        0,
      ),
    ),
  );
}

function currentProgressBytes(
  frame: DeclarativeV2VerifierProgressCursorFrameV2,
): Uint8Array {
  return Result.getOrThrow(encodeDeclarativeV2VerifierProgressFrameV2(frame, {
    maximumFrameBytes: 1_048_576,
    maximumCanonicalBytes: 1_048_576,
  })).canonicalBytes;
}

function registrationFixture(
  allowance: 1 | 1024,
  mutateInput?: (
    input: DeclarativeV2VerifierRegistrationInputV1,
  ) => DeclarativeV2VerifierRegistrationInputV1,
  expectMutatedBindings = false,
  coldModule = false,
  records: ReadonlyArray<DeclarativeV2SemanticRecordV1> = SEMANTIC_RECORDS,
  modulePath = "functions/example.js",
  currentProgressPredecessor?: Uint8Array,
  source = SOURCE,
  additionalModules: ReadonlyArray<LinkedModuleFixture> = [],
): {
  readonly factory: ReturnType<
    typeof makeDeclarativeV2VerifierRegistrationFactoryV1
  >;
  readonly input: DeclarativeV2VerifierRegistrationInputV1;
  readonly bindings: DeclarativeV2VerifierRegistrationBindingsV1;
  readonly driver: DeclarativeV2VerifierRegistrationDriverV1 | undefined;
  readonly result: Result.Result<
    DeclarativeV2VerifierRegistrationCompleteV1,
    DeclarativeV2VerifierRegistrationV1Error
  >;
} {
  const predecessor = new Uint8Array(32).fill(97);
  const currentProgress = Object.freeze({
    kind: "progress_cursor",
    phase: "registration",
    settledSequence: 7n,
    moduleOrdinal: 0n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: currentProgressPredecessor ?? predecessor,
  }) satisfies DeclarativeV2VerifierProgressCursorFrameV2;
  const progressSha256 = new Uint8Array(
    createHash("sha256").update(currentProgressBytes(currentProgress)).digest(),
  );
  const link = runLink(
    coldModule,
    linkBindings(41, progressSha256),
    modulePath,
    source,
    additionalModules,
  );
  const semantic = semanticBytes(records);
  const semanticBudget = semanticBudgetFor(records, semantic);
  const bindings = Object.freeze({
    ...link.bindings,
    predecessorAndTailsSha256: new Uint8Array(32).fill(96),
    rangeSha256: new Uint8Array(32).fill(96),
    registrationReservationSha256: new Uint8Array(32).fill(98),
    semanticSha256: new Uint8Array(
      createHash("sha256").update(semantic).digest(),
    ),
  });
  const input = mutateInput?.(Object.freeze({
    bindings,
    commandKind: "registration_page",
    sequence: 8n,
    currentProgress,
    predecessorReceiptSha256: predecessor,
    commandBudget: registrationBudget(),
    semanticBudget,
    semanticBytes: semantic,
    completedLinkResult: link.result,
    completedLinkBindings: link.bindings,
  })) ?? Object.freeze({
    bindings,
    commandKind: "registration_page",
    sequence: 8n,
    currentProgress,
    predecessorReceiptSha256: predecessor,
    commandBudget: registrationBudget(),
    semanticBudget,
    semanticBytes: semantic,
    completedLinkResult: link.result,
    completedLinkBindings: link.bindings,
  });
  const factory = makeDeclarativeV2VerifierRegistrationFactoryV1(link.factory);
  const created = factory.create(
    input,
    expectMutatedBindings ? input.bindings : bindings,
  );
  if (Result.isFailure(created)) {
    return {
      factory,
      input,
      bindings,
      driver: undefined,
      result: Result.fail(created.failure),
    };
  }
  expect(factory.step(created.success, 0)).toMatchObject({
    success: {
      status: "pending",
      receipt: { transitionCount: 0 },
    },
  });
  for (let guard = 0; guard < 5_000_000; guard += 1) {
    const stepped = factory.step(created.success, allowance);
    if (Result.isFailure(stepped)) {
      return {
        factory,
        input,
        bindings,
        driver: created.success,
        result: Result.fail(stepped.failure),
      };
    }
    if (stepped.success.status === "complete") {
      return {
        factory,
        input,
        bindings,
        driver: created.success,
        result: Result.succeed(stepped.success),
      };
    }
    for (
      const dimension of allowance === 1024
        ? DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2
        : []
    ) {
      expect(
        stepped.success.receipt.deltaUsage[dimension],
        `pending delta ${dimension}`,
      ).toBe(0n);
      expect(
        stepped.success.receipt.usage[dimension],
        `pending aggregate ${dimension}`,
      ).toBe(0n);
    }
  }
  throw new Error("registration fixture did not terminate");
}

describe("private Declarative V2 registration verifier", () => {
  test("accepts direct database reads on a query root context", () => {
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      true,
      SEMANTIC_RECORDS,
      "functions/example.js",
      undefined,
      "export async function getThing(ctx){" +
        'return await ctx.db.get("recipes:1")}',
    );
    expect(Result.isSuccess(fixture.result)).toBe(true);
  });

  test("rejects direct database writes from a declared query context", () => {
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      true,
      SEMANTIC_RECORDS,
      "functions/example.js",
      undefined,
      "export async function getThing(ctx){" +
        'return await ctx.db.insert("recipes",{})}',
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handlerCapability",
      },
    });
  });

  test("accepts direct database writes on a mutation root context", () => {
    const records = SEMANTIC_RECORDS.map(record =>
      record.kind === "function"
        ? { ...record, functionKind: "mutation" as const }
        : record
    );
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      true,
      records,
      "functions/example.js",
      undefined,
      "export async function getThing(runtime){" +
        'return await runtime.db.insert("recipes",{})}',
    );
    expect(Result.isSuccess(fixture.result)).toBe(true);
  });

  test("rejects database access from a declared action context", () => {
    const records = SEMANTIC_RECORDS.map(record =>
      record.kind === "function"
        ? { ...record, functionKind: "action" as const }
        : record
    );
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      true,
      records,
      "functions/example.js",
      undefined,
      "export async function getThing(ctx){" +
        'return await ctx.db.get("recipes:1")}',
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handlerCapability",
      },
    });
  });

  test("rejects context-shaped authority inside a reachable helper", () => {
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      true,
      SEMANTIC_RECORDS,
      "functions/example.js",
      undefined,
      "async function helper(ctx,id){return await ctx.db.get(id)}" +
        'export async function getThing(ctx){return await helper(ctx,"recipes:1")}',
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handlerCapability",
      },
    });
  });

  test("applies the complete capability matrix to legacy private ABI imports", () => {
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      false,
      SEMANTIC_RECORDS,
      "functions/example.js",
      undefined,
      'import {databaseInsert} from "flarex:platform";' +
        'export async function getThing(){return await databaseInsert("recipes",{})}',
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handlerCapability",
      },
    });
  });

  test("rejects runMutation from a declared query handler", () => {
    const fixture = registrationFixture(
      1024,
      undefined,
      false,
      false,
      SEMANTIC_RECORDS,
      "functions/example.js",
      undefined,
      'import {runMutation} from "flarex:platform";' +
        'export async function getThing(){return await runMutation(' +
        '{_path:"internal:mutate"})}',
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handlerCapability",
      },
    });
  });

  test("rejects runMutation reachable through a local query helper", () => {
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      true,
      SEMANTIC_RECORDS,
      "functions/example.js",
      undefined,
      'import {runMutation} from "flarex:platform";' +
        "async function helper(){return await runMutation(" +
        '{_path:"internal:mutate"})}' +
        "export async function getThing(){return await helper()}",
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handlerCapability",
      },
    });
  });

  test("rejects a dropped local helper that can reach runMutation", () => {
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      false,
      SEMANTIC_RECORDS,
      "functions/example.js",
      undefined,
      'import {runMutation} from "flarex:platform";' +
        "async function helper(){return await runMutation(" +
        '{_path:"internal:mutate"})}' +
        'export async function getThing(){helper();return "ok"}',
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handlerCapability",
      },
    });
  });

  test("rejects runMutation reachable through an imported query helper", () => {
    const records = Object.freeze([
      ...SEMANTIC_RECORDS.slice(0, 2),
      { kind: "module", modulePath: "functions/helper.js" },
      ...SEMANTIC_RECORDS.slice(2),
    ]) satisfies ReadonlyArray<DeclarativeV2SemanticRecordV1>;
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      true,
      records,
      "functions/example.js",
      undefined,
      'import {helper} from "./helper.js";' +
        "export async function getThing(){return await helper()}",
      [{
        modulePath: "functions/helper.js",
        source: 'import {runMutation} from "flarex:platform";' +
          'function decoy(){return "ok"}' +
          "export async function helper(){return await runMutation(" +
          '{_path:"internal:mutate"})}',
      }],
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handlerCapability",
      },
    });
  });

  test("rejects a dropped imported helper that can reach runMutation", () => {
    const records = Object.freeze([
      ...SEMANTIC_RECORDS.slice(0, 2),
      { kind: "module", modulePath: "functions/helper.js" },
      ...SEMANTIC_RECORDS.slice(2),
    ]) satisfies ReadonlyArray<DeclarativeV2SemanticRecordV1>;
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      false,
      records,
      "functions/example.js",
      undefined,
      'import {helper} from "./helper.js";' +
        'export async function getThing(){helper();return "ok"}',
      [{
        modulePath: "functions/helper.js",
        source: 'import {runMutation} from "flarex:platform";' +
          'function decoy(){return "ok"}' +
          "export async function helper(){return await runMutation(" +
          '{_path:"internal:mutate"})}',
      }],
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handlerCapability",
      },
    });
  });

  test("terminates cycle-safe handler reachability without runMutation", () => {
    const fixture = registrationFixture(
      1,
      undefined,
      false,
      false,
      SEMANTIC_RECORDS,
      "functions/example.js",
      undefined,
      "async function helper(){return await helper()}" +
        "export async function getThing(){return await helper()}",
    );
    expect(Result.isSuccess(fixture.result)).toBe(true);
  });

  test("keeps multi-module reachability receipts identical across allowances and restart", () => {
    const modulePaths = ["a", "b", "c"].map(
      name => `functions/${name}.js`,
    );
    const records = Object.freeze([
      ...SEMANTIC_RECORDS.slice(0, 1),
      ...modulePaths.map(modulePath => ({ kind: "module", modulePath } as const)),
      ...SEMANTIC_RECORDS.slice(1),
    ]) satisfies ReadonlyArray<DeclarativeV2SemanticRecordV1>;
    const modules = [{
      modulePath: modulePaths[0]!,
      source: 'import {b} from "./b.js";' +
        "export async function a(){return await b()}",
    }, {
      modulePath: modulePaths[1]!,
      source: 'import {c} from "./c.js";' +
        "export async function b(){return await c()}",
    }, {
      modulePath: modulePaths[2]!,
      source: 'export async function c(){return "ok"}',
    }];
    const run = (allowance: 1 | 1024, coldModule: boolean) =>
      Result.getOrThrow(registrationFixture(
        allowance,
        undefined,
        false,
        coldModule,
        records,
        "functions/example.js",
        undefined,
        'import {a} from "./a.js";' +
          "export async function getThing(){return await a()}",
        modules,
      ).result);
    const singleStep = run(1, false);
    const quantum = run(1024, false);
    const cold = run(1, true);
    expect(singleStep.actual).toEqual(quantum.actual);
    expect(singleStep.actual).toEqual(cold.actual);
    expect(singleStep.capacity).toEqual(quantum.capacity);
    expect(singleStep.capacity).toEqual(cold.capacity);
    expect(singleStep.registrationFrames).toEqual(quantum.registrationFrames);
    expect(singleStep.registrationFrames).toEqual(cold.registrationFrames);
    expect(singleStep.registrationRootSha256).toEqual(
      cold.registrationRootSha256,
    );
  });

  test("publishes deterministic registration frames only after exact proof", () => {
    const warm = registrationFixture(1);
    const coldOne = registrationFixture(1, undefined, false, true);
    const coldQuantum = registrationFixture(1024, undefined, false, true);
    const first = Result.getOrThrow(warm.result);
    const second = Result.getOrThrow(coldOne.result);
    const third = Result.getOrThrow(coldQuantum.result);

    expect(first.registrationFrames).toHaveLength(1);
    expect(first.registrationFrames).toEqual(second.registrationFrames);
    expect(first.nextProgressBytes).toEqual(second.nextProgressBytes);
    expect(first.outputManifestBytes).toEqual(second.outputManifestBytes);
    expect(first.registrationRootSha256).toEqual(
      second.registrationRootSha256,
    );
    expect(first.actual).toEqual(second.actual);
    expect(first.capacity).toEqual(second.capacity);
    expect(second.registrationFrames).toEqual(third.registrationFrames);
    expect(second.nextProgressBytes).toEqual(third.nextProgressBytes);
    expect(second.outputManifestBytes).toEqual(third.outputManifestBytes);
    expect(second.actual).toEqual(third.actual);
    expect(second.capacity).toEqual(third.capacity);
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      expect(first.actual[dimension]).toBeLessThanOrEqual(
        first.capacity[dimension],
      );
    }
    expect(first.actual.objectCalls).toBe(0n);
    expect(first.actual.objectBodyBytes).toBe(0n);
    expect(first.actual.sourceBytes).toBe(0n);
    expect(first.actual.sourceMapBytes).toBe(0n);
    expect(first.actual.importEdges).toBe(0n);
    expect(first.actual.tableBytes).toBe(0n);
    expect(first.actual.elapsedMilliseconds).toBe(0n);
    expect(first.nextProgress).toMatchObject({
      phase: "verdict",
      settledSequence: 8n,
    });
    expect(first.outputManifest).toMatchObject({
      commandKind: "registration_page",
      sequence: 8n,
      evidenceCount: 1n,
    });
    expect(
      Result.getOrThrow(
        decodeDeclarativeV2PhysicalFrameV1(
          first.registrationFrames[0],
          {
            maximumFrameBytes: first.registrationFrames[0]!.byteLength,
            maximumCanonicalBytes: first.registrationFrames[0]!.byteLength,
          },
        ),
      ).frame,
    ).toMatchObject({
      kind: "registration",
      registrationOrdinal: 0n,
      exportName: "getThing",
      functionPath: "example:getThing",
    });
    expect(warm.factory.step(warm.driver, 1)).toMatchObject({
      failure: { reason: "closed" },
    });
    expect(warm.factory.close(warm.driver)).toMatchObject({
      failure: { reason: "closed" },
    });
    const reused = Result.getOrThrow(warm.factory.create(
      warm.input,
      warm.bindings,
    ));
    expect(warm.factory.step(reused, 1_024)).toMatchObject({
      failure: {
        reason: "identityMismatch",
        path: "completedLinkResult",
      },
    });
    expect(warm.factory.step(
      Object.freeze({ _tag: "DeclarativeV2VerifierRegistrationDriverV1" }),
      1,
    )).toMatchObject({
      failure: { reason: "staleHandle" },
    });
  });

  test("rejects out-of-range allowance and terminalizes the driver", () => {
    const link = runLink();
    const semantic = semanticBytes();
    const semanticBudget = Result.getOrThrow(
      makeDeclarativeV2SemanticStreamBudgetV1(
        semantic.byteLength,
        semantic.byteLength,
        SEMANTIC_RECORDS.length,
        semantic.byteLength,
      ),
    );
    const bindings = Object.freeze({
      ...link.bindings,
      registrationReservationSha256: new Uint8Array(32).fill(98),
      semanticSha256: new Uint8Array(
        createHash("sha256").update(semantic).digest(),
      ),
    });
    const predecessor = new Uint8Array(32).fill(97);
    const factory = makeDeclarativeV2VerifierRegistrationFactoryV1(link.factory);
    const driver = Result.getOrThrow(factory.create({
      bindings,
      commandKind: "registration_page",
      sequence: 8n,
      currentProgress: {
        kind: "progress_cursor",
        phase: "registration",
        settledSequence: 7n,
        moduleOrdinal: 0n,
        edgeOrdinal: 0n,
        pageOrdinal: 0n,
        previousReceiptSha256: predecessor,
      },
      predecessorReceiptSha256: predecessor,
      commandBudget: registrationBudget(),
      semanticBudget,
      semanticBytes: semantic,
      completedLinkResult: link.result,
      completedLinkBindings: link.bindings,
    }, bindings));
    expect(factory.step(driver, 1025)).toMatchObject({
      failure: { reason: "invalidInput" },
    });
    expect(factory.step(driver, 1)).toMatchObject({
      failure: { reason: "closed" },
    });
  });

  test("fails closed for one-field identity mismatch without publishing", () => {
    const fixture = registrationFixture(1024, input => Object.freeze({
      ...input,
      bindings: Object.freeze({
        ...input.bindings,
        rangeSha256: new Uint8Array(32).fill(222),
      }),
    }));
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "create",
        reason: "identityMismatch",
        path: "bindings",
      },
    });
  });

  test.each([
    "attemptSha256",
    "futureRegistrationIntentSha256",
    "candidateSha256",
    "authenticatedInputSha256",
    "parsePagesRootSha256",
    "currentProgressSha256",
    "analyzerReleaseSha256",
    "analyzerIdentitySha256",
    "verifierIdentitySha256",
  ] as const)("rejects cross-context completed-link mismatch at %s", field => {
    const fixture = registrationFixture(
      1024,
      input => Object.freeze({
        ...input,
        completedLinkBindings: Object.freeze({
          ...input.completedLinkBindings,
          [field]: new Uint8Array(32).fill(231),
        }),
      }),
      true,
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "create",
        reason: "identityMismatch",
        path: "completedLinkBindings",
      },
    });
  });

  test.each([
    "predecessorAndTailsSha256",
    "rangeSha256",
  ] as const)(
    "rejects changed historical link reservation fact at %s",
    field => {
      const fixture = registrationFixture(
        1024,
        input => Object.freeze({
          ...input,
          completedLinkBindings: Object.freeze({
            ...input.completedLinkBindings,
            [field]: new Uint8Array(32).fill(231),
          }),
        }),
        true,
      );
      expect(fixture.result).toMatchObject({
        failure: {
          operation: "step",
          reason: "identityMismatch",
          path: "completedLinkResult",
        },
      });
    },
  );

  test("rejects completed-link sequence mismatch and semantic digest mismatch", () => {
    const sequence = registrationFixture(
      1024,
      input => Object.freeze({
        ...input,
        completedLinkBindings: Object.freeze({
          ...input.completedLinkBindings,
          linkSequence: input.completedLinkBindings.linkSequence + 1n,
        }),
      }),
      true,
    );
    expect(sequence.result).toMatchObject({
      failure: {
        operation: "create",
        reason: "identityMismatch",
        path: "completedLinkBindings",
      },
    });

    const semantic = registrationFixture(
      1024,
      input => Object.freeze({
        ...input,
        bindings: Object.freeze({
          ...input.bindings,
          semanticSha256: new Uint8Array(32).fill(232),
        }),
      }),
      true,
    );
    expect(semantic.result).toMatchObject({
      failure: {
        reason: "identityMismatch",
        path: "semanticSha256",
      },
    });
  });

  test("authenticates the complete canonical current-progress frame before claiming", () => {
    const replacementPredecessor = new Uint8Array(32).fill(233);
    const fixture = registrationFixture(1024, input => Object.freeze({
      ...input,
      currentProgress: Object.freeze({
        ...input.currentProgress,
        previousReceiptSha256: replacementPredecessor,
      }),
      predecessorReceiptSha256: replacementPredecessor,
    }));
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "identityMismatch",
        path: "currentProgressSha256",
      },
    });
  });

  test("keeps settled link progress distinct from the registration predecessor", () => {
    const settledLinkPredecessor = new Uint8Array(32).fill(234);
    const fixture = registrationFixture(
      1024,
      undefined,
      false,
      false,
      SEMANTIC_RECORDS,
      "functions/example.js",
      settledLinkPredecessor,
    );
    expect(Result.getOrThrow(fixture.result)).toMatchObject({
      nextProgress: {
        phase: "verdict",
        settledSequence: 8n,
      },
    });
    expect(fixture.input.currentProgress.previousReceiptSha256).toEqual(
      settledLinkPredecessor,
    );
    expect(fixture.input.predecessorReceiptSha256).not.toEqual(
      settledLinkPredecessor,
    );
  });

  test.each([
    ["long ASCII", "a".repeat(4_096)],
    ["long Unicode", "界".repeat(4_096)],
  ] as const)(
    "pre-admits retained handler storage and preserves %s split equality",
    (_label, longText) => {
      const functionPath = "example:" + longText.slice(0, 2_048);
      const records = SEMANTIC_RECORDS.map(record =>
        record.kind === "function"
          ? Object.freeze({ ...record, path: functionPath })
          : record.kind === "handler"
          ? Object.freeze({ ...record, functionPath })
          : record
      ) as ReadonlyArray<DeclarativeV2SemanticRecordV1>;
      for (const allowance of [1, 1024] as const) {
        const fixture = registrationFixture(
          allowance,
          input => Object.freeze({
            ...input,
            commandBudget: Object.freeze({
              ...input.commandBudget,
              tableBytes: 1_024n,
            }),
          }),
          false,
          false,
          records,
        );
        expect(fixture.result, `allowance ${allowance}`).toMatchObject({
          failure: {
            reason: "budgetExceeded",
            dimension: "tableBytes",
            observed: BigInt(
              ("functions/example.js".length +
                "getThing".length +
                functionPath.length) * 3,
            ),
            maximum: 1_024n,
          },
        });
      }
      const one = Result.getOrThrow(
        registrationFixture(
          1,
          input => Object.freeze({
            ...input,
            commandBudget: Object.freeze({
              ...input.commandBudget,
              calls: 1_000_000n,
            }),
          }),
          false,
          false,
          records,
        ).result,
      );
      const quantum = Result.getOrThrow(
        registrationFixture(
          1024,
          input => Object.freeze({
            ...input,
            commandBudget: Object.freeze({
              ...input.commandBudget,
              calls: 1_000_000n,
            }),
          }),
          false,
          false,
          records,
        ).result,
      );
      expect(one.registrationFrames).toEqual(quantum.registrationFrames);
      expect(one.nextProgressBytes).toEqual(quantum.nextProgressBytes);
      expect(one.outputManifestBytes).toEqual(quantum.outputManifestBytes);
      expect(one.registrationRootSha256).toEqual(
        quantum.registrationRootSha256,
      );
      expect(one.actual).toEqual(quantum.actual);
      expect(one.capacity).toEqual(quantum.capacity);
    },
  );

  test("resolves completed-link lineage before handler storage admission", () => {
    const missingModulePath = "missing/" + "x".repeat(4_096) + ".js";
    const records = SEMANTIC_RECORDS.map(record =>
      record.kind === "module" ||
        record.kind === "function" ||
        record.kind === "handler"
        ? Object.freeze({ ...record, modulePath: missingModulePath })
        : record
    ) as ReadonlyArray<DeclarativeV2SemanticRecordV1>;
    const fixture = registrationFixture(
      1024,
      input => Object.freeze({
        ...input,
        commandBudget: Object.freeze({
          ...input.commandBudget,
          tableBytes: 1n,
        }),
      }),
      false,
      false,
      records,
    );
    expect(fixture.result).toMatchObject({
      failure: {
        operation: "step",
        reason: "moduleMismatch",
        path: "handler",
      },
    });
  });

  test("captures hostile inputs without invoking accessors and rejects unsafe storage", () => {
    let sequenceReads = 0;
    const accessor = registrationFixture(1024, input =>
      Object.defineProperty(
        { ...input },
        "sequence",
        {
          enumerable: true,
          get() {
            sequenceReads += 1;
            return 8n;
          },
        },
      ) as DeclarativeV2VerifierRegistrationInputV1
    );
    expect(accessor.result).toMatchObject({
      failure: { reason: "invalidInput", path: "input" },
    });
    expect(sequenceReads).toBe(0);

    const shared = registrationFixture(1024, input => Object.freeze({
      ...input,
      semanticBytes: new Uint8Array(
        new SharedArrayBuffer(input.semanticBytes.byteLength),
      ),
    }));
    expect(shared.result).toMatchObject({
      failure: { reason: "invalidInput", path: "input" },
    });

    const detached = registrationFixture(1024, input => {
      const bytes = input.semanticBytes.slice();
      structuredClone(bytes, { transfer: [bytes.buffer] });
      return Object.freeze({ ...input, semanticBytes: bytes });
    });
    expect(detached.result).toMatchObject({
      failure: { reason: "invalidInput", path: "input" },
    });
  });

  test("rejects noncanonical transitions and checked-int64 overflow first", () => {
    const invalidTransition = registrationFixture(1024, input => Object.freeze({
      ...input,
      sequence: 9n,
    }));
    expect(invalidTransition.result).toMatchObject({
      failure: {
        reason: "invalidTransition",
        path: "currentProgress",
      },
    });

    const overflow = registrationFixture(1024, input => Object.freeze({
      ...input,
      commandBudget: Object.freeze({
        ...input.commandBudget,
        calls: 9_223_372_036_854_775_808n,
      }),
    }));
    expect(overflow.result).toMatchObject({
      failure: { reason: "invalidInput", path: "input" },
    });
  });

  test("rejects every one-less nonzero capacity dimension", () => {
    const baseline = Result.getOrThrow(registrationFixture(1024).result);
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const required = baseline.capacity[dimension];
      if (required === 0n) {
        expect(baseline.actual[dimension], dimension).toBe(0n);
        continue;
      }
      const fixture = registrationFixture(1024, input => Object.freeze({
        ...input,
        commandBudget: Object.freeze({
          ...input.commandBudget,
          [dimension]: required - 1n,
        }),
      }));
      expect(fixture.result, dimension).toMatchObject({
        failure: {
          reason: "budgetExceeded",
          dimension,
          observed: required,
          maximum: required - 1n,
        },
      });
    }
  }, 30_000);

  test("remains available only through the existing private verifier facade", async () => {
    const root = await import("@flarex/analysis");
    const internal = await import(
      "@flarex/analysis/internal/declarative-v2-verifier-v1"
    );
    expect(
      "makeDeclarativeV2VerifierRegistrationFactoryV1" in root,
    ).toBe(false);
    expect(
      internal.makeDeclarativeV2VerifierRegistrationFactoryV1,
    ).toBe(makeDeclarativeV2VerifierRegistrationFactoryV1);
  });
});
