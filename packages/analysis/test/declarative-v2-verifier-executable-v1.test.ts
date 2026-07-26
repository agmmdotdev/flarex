import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { Encoding, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { afterEach, describe, expect, test } from "vitest";

import {
  compileDeclarativeV2CanonicalGrammarV1,
  generateDeclarativeV2VerifierExecutableV1,
  validateDeclarativeV2CanonicalUtf8V1,
  validateDeclarativeV2CompiledCanonicalGrammarV1,
  validateDeclarativeV2VerifierExecutableRowsV1,
} from "../scripts/declarativeV2VerifierExecutableV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
} from "../src/declarativeV2VerifierV1";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  makeDeclarativeV2ArtifactModulePathFactoryV1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "../src/declarativeV2ArtifactModulePathV1";
import {
  DECLARATIVE_V2_CANONICAL_NONTERMINALS_V1,
  DECLARATIVE_V2_CANONICAL_PRECEDENCE_V1,
  DECLARATIVE_V2_CANONICAL_PRODUCTIONS_V1,
  DECLARATIVE_V2_CANONICAL_TERMINALS_V1,
  DECLARATIVE_V2_CANONICAL_UTF8_BYTE_CLASSES_V1,
  DECLARATIVE_V2_CANONICAL_UTF8_STATES_V1,
  DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1,
  DECLARATIVE_V2_NUMBER_TRANSITIONS_V1,
  DECLARATIVE_V2_PARSER_PRODUCTIONS_V1,
  DECLARATIVE_V2_TEMPLATE_TRANSITIONS_V1,
  DECLARATIVE_V2_UTF8_TRANSITIONS_V1,
} from "../src/declarativeV2VerifierExecutableV1.contract";
import {
  appendDeclarativeV2VerifierLinkerModuleV1,
  createDeclarativeV2VerifierLinkerV1,
  createDeclarativeV2VerifierEngineV1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_V1_TEST_ONLY,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_CONTRACT_V1,
  finishDeclarativeV2VerifierLinkerV1,
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
  loadDeclarativeV2VerifierExecutableAssetV1,
  loadGeneratedDeclarativeV2VerifierExecutableAssetV1,
  makeDeclarativeV2VerifierExecutableRestartBridgeV1,
  makeDeclarativeV2VerifierResultAccessFactoryV1,
  stepDeclarativeV2VerifierLinkerV1,
  type DeclarativeV2VerifierExecutableV1Error,
  type DeclarativeV2VerifierEngineV1,
  type DeclarativeV2VerifierLinkResultV1,
  type DeclarativeV2VerifierModuleResultV1,
  type DeclarativeV2VerifierModulePresentationV1,
} from "../src/declarativeV2VerifierExecutableV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_ASSET_BASE64_V1,
} from "../src/declarativeV2VerifierExecutableV1.generated";
import {
  createDeclarativeV2VerificationEvidenceEncoderV2,
  makeDeclarativeV2VerificationEvidenceBudgetV2,
  makeDeclarativeV2VerificationEvidenceFrameV2,
  type DeclarativeV2VerificationEvidenceFrameV2,
} from "../src/declarativeV2VerificationEvidenceV2";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const UTF8_ENCODER = new TextEncoder();
const temporaryDirectories: string[] = [];

function artifactModulePath(
  spelling: string,
): DeclarativeV2ArtifactModulePathHandleV1 {
  const bytes = UTF8_ENCODER.encode(spelling);
  const created = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
    3,
    bytes.byteLength,
    bytes.byteLength,
  );
  if (Result.isFailure(created)) throw created.failure;
  const stepped = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
    created.success,
    bytes,
    1_024,
  );
  if (Result.isFailure(stepped)) throw stepped.failure;
  const finished = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(
    created.success,
    1,
  );
  if (Result.isFailure(finished) || "status" in finished.success) {
    throw new Error("test module-path helper did not complete");
  }
  return finished.success;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

describe("private verifier result access", () => {
  test("streams opaque module and link evidence and resolves exact handlers", () => {
    const source = "export function ready() {}";
    const module = runModuleResult(source, "functions/access.js", 0n);
    const maximum = budget("command_budget", UTF8_ENCODER.encode(source).byteLength);
    const required = budget("attempt_usage", UTF8_ENCODER.encode(source).byteLength);
    const linked = linkModuleResults([module], maximum, required);
    if (Result.isFailure(linked)) throw linked.failure;
    const access = makeDeclarativeV2VerifierResultAccessFactoryV1();

    const lookup = access.handlerLookup(
      module,
      artifactModulePath("functions/access.js"),
      UTF8_ENCODER.encode("ready"),
      maximum,
    );
    if (Result.isFailure(lookup)) throw lookup.failure;
    expect(access.stepHandlerLookup(lookup.success, 0)).toMatchObject({
      success: { status: "pending", transitionCount: 0 },
    });
    let matched: boolean | undefined;
    while (matched === undefined) {
      const step = access.stepHandlerLookup(lookup.success, 1);
      if (Result.isFailure(step)) throw step.failure;
      if (step.success.status === "complete") matched = step.success.matched;
    }
    expect(matched).toBe(true);
    expect(access.stepHandlerLookup(lookup.success, 1)).toMatchObject({
      failure: { operation: "access", reason: "closed" },
    });

    const moduleCursor = access.moduleEvidence(module, maximum);
    if (Result.isFailure(moduleCursor)) throw moduleCursor.failure;
    let moduleEvidence = 0;
    while (true) {
      const read = access.readModuleEvidence(moduleCursor.success, 1);
      if (Result.isFailure(read)) throw read.failure;
      if (read.success.status === "complete") break;
      if (read.success.status === "item") moduleEvidence += 1;
    }
    expect(moduleEvidence).toBeGreaterThan(0);

    const linkCursor = access.linkEvidence(linked.success, maximum);
    if (Result.isFailure(linkCursor)) throw linkCursor.failure;
    let linkEvidence = 0;
    while (true) {
      const read = access.readLinkEvidence(linkCursor.success, 1);
      if (Result.isFailure(read)) throw read.failure;
      if (read.success.status === "complete") break;
      if (read.success.status === "item") linkEvidence += 1;
    }
    expect(linkEvidence).toBeGreaterThanOrEqual(0);
  });

  test("rejects excessive allowances and cross-factory or forged handles", () => {
    const source = "export function ready() {}";
    const module = runModuleResult(
      source,
      "functions/access-boundary.js",
      0n,
    );
    const maximum = budget("command_budget", UTF8_ENCODER.encode(source).byteLength);
    const first = makeDeclarativeV2VerifierResultAccessFactoryV1();
    const second = makeDeclarativeV2VerifierResultAccessFactoryV1();
    const cursor = first.moduleEvidence(module, maximum);
    if (Result.isFailure(cursor)) throw cursor.failure;
    expect(first.readModuleEvidence(cursor.success, 1_025)).toMatchObject({
      failure: { operation: "access", reason: "invalidInput" },
    });
    expect(second.readModuleEvidence(cursor.success, 1)).toMatchObject({
      failure: { operation: "access", reason: "invalidInput" },
    });
    expect(first.readModuleEvidence(Object.freeze({
      _tag: "DeclarativeV2VerifierModuleEvidenceCursorV1",
    }), 1)).toMatchObject({
      failure: { operation: "access", reason: "invalidInput" },
    });
    let accessorCalls = 0;
    const accessorBudget = Object.defineProperty({}, "kind", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return "command_budget";
      },
    });
    expect(first.moduleEvidence(module, accessorBudget as never)).toMatchObject({
      failure: { operation: "access", reason: "invalidInput" },
    });
    expect(accessorCalls).toBe(0);
    const revokedBudget = Proxy.revocable(maximum, {});
    revokedBudget.revoke();
    expect(first.moduleEvidence(module, revokedBudget.proxy)).toMatchObject({
      failure: { operation: "access", reason: "invalidInput" },
    });
  });
});

describe("private verifier restart bridge", () => {
  test("derives exact parameter and token-body identities without presentation state", () => {
    const source =
      "export async function ready({ value } = {}, ...rest) { return value; } " +
      "export function trailing(value,) { return value; }";
    const module = runModuleResult(source, "functions/restart.js", 7n);
    const bridge = makeDeclarativeV2VerifierExecutableRestartBridgeV1();
    const restartBudget = budget(
      "command_budget",
      UTF8_ENCODER.encode(source).byteLength,
    );
    const opened = bridge.openModuleRecords(
      module,
      new Uint8Array(32).fill(9),
      restartBudget,
    );
    if (Result.isFailure(opened)) throw opened.failure;
    const records = [];
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      const read = bridge.readModuleRecord(opened.success, 1);
      if (Result.isFailure(read)) throw read.failure;
      if (read.success.status === "complete") break;
      if (read.success.status === "item") records.push(read.success.record);
    }
    const functionRecord = records.find(record => record.kind === "function_v1");
    expect(functionRecord).toMatchObject({
      kind: "function_v1",
      moduleOrdinal: 7n,
      parameterCount: 2n,
    });
    if (functionRecord?.kind !== "function_v1") {
      throw new Error("missing restart function record");
    }
    expect(functionRecord.bodySha256).toHaveLength(32);
    expect(Buffer.from(functionRecord.bodySha256).toString("hex")).toBe(
      "2470d90e8213df2a96132ad57ecdf319739bd5560033d0ae6bba4f5f3c0f8260",
    );
    const trailingFunction = records.find(record =>
      record.kind === "function_v1" && record.functionName === "trailing"
    );
    expect(trailingFunction).toMatchObject({
      kind: "function_v1",
      parameterCount: 1n,
    });
    if (trailingFunction?.kind !== "function_v1") {
      throw new Error("missing trailing restart function record");
    }
    expect(Buffer.from(trailingFunction.bodySha256).toString("hex")).toBe(
      "54a3c42d45ac338b1cfd8316bdb7f11735e6055bf4dc7b6d03c1be71c0053961",
    );
    expect(createHash("sha256").update(functionRecord.bodySha256).digest("hex"))
      .toMatch(/^[0-9a-f]{64}$/);
    expect(bridge.readModuleRecord(opened.success, 1)).toMatchObject({
      failure: { operation: "access", reason: "closed" },
    });
    expect(bridge.readModuleRecord(Object.freeze({
      _tag: "DeclarativeV2VerifierRestartRecordCursorV1",
    }), 1)).toMatchObject({
      failure: { operation: "access", reason: "invalidInput" },
    });
    const textOneLess = Result.getOrThrow(bridge.openModuleRecords(
      module,
      new Uint8Array(32).fill(9),
      budget(
        "command_budget",
        UTF8_ENCODER.encode(source).byteLength,
        { stringBytes: 0n },
      ),
    ));
    expect(bridge.readModuleRecord(textOneLess, 1)).toMatchObject({
      success: { status: "pending" },
    });
    expect(bridge.readModuleRecord(textOneLess, 1)).toMatchObject({
      failure: {
        operation: "access",
        reason: "budgetExceeded",
        dimension: "stringBytes",
      },
    });
    const builder = Result.getOrThrow(bridge.createModuleBuilder(
      budget("command_budget", UTF8_ENCODER.encode(source).byteLength),
      budget("attempt_usage", UTF8_ENCODER.encode(source).byteLength),
    ));
    for (const record of records) {
      Result.getOrThrow(bridge.appendModuleRecord(builder, record));
    }
    let cold: DeclarativeV2VerifierModuleResultV1 | undefined;
    for (let iteration = 0; iteration < 100_000; iteration += 1) {
      const built = Result.getOrThrow(bridge.finishModuleBuilder(builder, 1));
      if (built.status === "complete") {
        cold = built.result;
        break;
      }
    }
    if (cold === undefined) throw new Error("cold module builder did not finish");
    expect(cold.evidenceSha256).toBe(module.evidenceSha256);
    expect(
      makeDeclarativeV2VerifierExecutableRestartBridgeV1().openModuleRecords(
        cold,
        new Uint8Array(32).fill(9),
        restartBudget,
      ),
    ).toMatchObject({
      failure: { operation: "access", reason: "invalidInput" },
    });
    expect(
      bridge.openModuleRecords(
        cold,
        new Uint8Array(32).fill(9),
        restartBudget,
      ),
    ).toMatchObject({
      success: { _tag: "DeclarativeV2VerifierRestartRecordCursorV1" },
    });
    Result.getOrThrow(bridge.revoke(cold));
    expect(
      bridge.openModuleRecords(
        cold,
        new Uint8Array(32).fill(9),
        restartBudget,
      ),
    ).toMatchObject({
      failure: { operation: "access", reason: "closed" },
    });
  });
});

function generatedAsset(): Uint8Array {
  const decoded = Encoding.decodeBase64(
    GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_ASSET_BASE64_V1,
  );
  if (Result.isFailure(decoded)) throw decoded.failure;
  return new Uint8Array(decoded.success);
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
  const values = Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => {
      const value = dimension === "calls"
        ? 1_000_000n
        : dimension === "objectBodyBytes"
        ? BigInt(sourceBytes)
        : dimension === "sourceBytes"
        ? BigInt(sourceBytes)
        : dimension === "sourceMapBytes" || dimension === "semanticBytes"
        ? 0n
        : dimension === "modules"
        ? 1n
        : dimension === "tableBytes"
        ? tableBytes
        : dimension.endsWith("Bytes")
        ? 100_000n
        : 1_024n;
      return [dimension, mutate?.[dimension] ?? value];
    }),
  );
  return Object.freeze({ kind, ...values }) as DeclarativeV2VerifierBudgetFrameV2;
}

function runSource(
  source: Uint8Array,
  chunks: ReadonlyArray<Uint8Array>,
): Result.Result<
  DeclarativeV2VerifierModulePresentationV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  const required = budget("attempt_usage", source.byteLength);
  const created = createDeclarativeV2VerifierEngineV1({
    modulePath: artifactModulePath("functions/example.js"),
    moduleOrdinal: 0n,
    sourceSha256: new Uint8Array(32).fill(7),
    maximums: budget("command_budget", source.byteLength),
    required,
  });
  if (Result.isFailure(created)) throw created.failure;
  for (const chunk of chunks) {
    const stepped = stepAll(created.success, chunk);
    if (Result.isFailure(stepped)) return Result.fail(stepped.failure);
  }
  const finished = finishEngine(created.success);
  if (Result.isFailure(finished)) return Result.fail(finished.failure);
  return DECLARATIVE_V2_VERIFIER_EXECUTABLE_V1_TEST_ONLY
    .materializeModuleResult(finished.success, 1_000_000);
}

function stepAll(
  engine: DeclarativeV2VerifierEngineV1,
  bytes: Uint8Array,
  allowance = 1_024,
): Result.Result<void, DeclarativeV2VerifierExecutableV1Error> {
  let offset = 0;
  let noByteProgress = 0;
  while (offset < bytes.byteLength) {
    const stepped = engine.step(bytes.subarray(offset), allowance);
    if (Result.isFailure(stepped)) return Result.fail(stepped.failure);
    if (stepped.success.consumedBytes === 0) {
      noByteProgress += 1;
      if (noByteProgress > 1_000_000) {
        throw new Error("streaming verifier did not drain parser work");
      }
    } else {
      noByteProgress = 0;
      offset += stepped.success.consumedBytes;
    }
  }
  return Result.succeed(undefined);
}

function finishEngine(
  engine: DeclarativeV2VerifierEngineV1,
  allowance = 1_024,
): Result.Result<
  DeclarativeV2VerifierModuleResultV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  while (true) {
    const finished = engine.finish(allowance);
    if (Result.isFailure(finished)) return Result.fail(finished.failure);
    if ("status" in finished.success) continue;
    return Result.succeed(finished.success);
  }
}

function materializeModuleResult(
  result: DeclarativeV2VerifierModuleResultV1,
): DeclarativeV2VerifierModulePresentationV1 {
  const materialized = DECLARATIVE_V2_VERIFIER_EXECUTABLE_V1_TEST_ONLY
    .materializeModuleResult(result, 1_000_000);
  if (Result.isFailure(materialized)) throw materialized.failure;
  return materialized.success;
}

function encodeEvidenceOracle(
  frame: DeclarativeV2VerificationEvidenceFrameV2,
): Uint8Array {
  const owned = frame.kind === "module_summary_v2"
    ? makeDeclarativeV2VerificationEvidenceFrameV2(
      frame.kind,
      frame.moduleOrdinal,
      frame.modulePath,
      frame.sourceSha256,
      frame.sourceByteLength,
      frame.importCount,
      frame.exportCount,
      frame.functionCount,
      frame.callCount,
      frame.valueFlowCount,
    )
    : frame.kind === "import_call_v2"
    ? makeDeclarativeV2VerificationEvidenceFrameV2(
      frame.kind,
      frame.moduleOrdinal,
      frame.edgeOrdinal,
      frame.callerFunction,
      frame.targetKind,
      frame.targetModulePath,
      frame.targetName,
    )
    : frame.kind === "value_flow_v2"
    ? makeDeclarativeV2VerificationEvidenceFrameV2(
      frame.kind,
      frame.moduleOrdinal,
      frame.functionName,
      frame.operationOrdinal,
      frame.operationName,
      frame.capability,
      frame.catchability,
    )
    : makeDeclarativeV2VerificationEvidenceFrameV2(
      frame.kind,
      frame.phase,
      frame.moduleOrdinal,
      frame.byteOffset,
      frame.diagnosticId,
      frame.code,
      frame.message,
    );
  if (Result.isFailure(owned)) throw owned.failure;
  const budgetResult = makeDeclarativeV2VerificationEvidenceBudgetV2(
    100_000,
    100_000,
  );
  if (Result.isFailure(budgetResult)) throw budgetResult.failure;
  const encoder = createDeclarativeV2VerificationEvidenceEncoderV2(
    owned.success,
    budgetResult.success,
  );
  if (Result.isFailure(encoder)) throw encoder.failure;
  for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
    const stepped = encoder.success.step(1_024);
    if (Result.isFailure(stepped)) throw stepped.failure;
    if (stepped.success.status === "complete") return stepped.success.bytes;
  }
  throw new Error("test-only evidence oracle exceeded its iteration ceiling");
}

function runModuleResult(
  sourceText: string,
  modulePath: string,
  moduleOrdinal: bigint,
): DeclarativeV2VerifierModuleResultV1 {
  const source = UTF8_ENCODER.encode(sourceText);
  const created = createDeclarativeV2VerifierEngineV1({
    modulePath: artifactModulePath(modulePath),
    moduleOrdinal,
    sourceSha256: new Uint8Array(32).fill(Number(moduleOrdinal & 0xffn)),
    maximums: budget("command_budget", source.byteLength),
    required: budget("attempt_usage", source.byteLength),
  });
  if (Result.isFailure(created)) throw created.failure;
  const stepped = stepAll(created.success, source);
  if (Result.isFailure(stepped)) throw stepped.failure;
  const finished = finishEngine(created.success);
  if (Result.isFailure(finished)) throw finished.failure;
  return finished.success;
}

function linkModuleResults(
  modules: ReadonlyArray<DeclarativeV2VerifierModuleResultV1>,
  maximums: DeclarativeV2VerifierBudgetFrameV2,
  required: DeclarativeV2VerifierBudgetFrameV2,
  allowance = 1_024,
): Result.Result<
  DeclarativeV2VerifierLinkResultV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  const created = createDeclarativeV2VerifierLinkerV1(maximums, required);
  if (Result.isFailure(created)) return Result.fail(created.failure);
  for (const module of modules) {
    while (true) {
      const appended = appendDeclarativeV2VerifierLinkerModuleV1(
        created.success,
        module,
      );
      if (Result.isSuccess(appended)) break;
      if (appended.failure.reason !== "invalidState") {
        return Result.fail(appended.failure);
      }
      const copied = stepDeclarativeV2VerifierLinkerV1(
        created.success,
        allowance === 0 ? 1_024 : allowance,
      );
      if (Result.isFailure(copied)) return Result.fail(copied.failure);
    }
  }
  let iterations = 0;
  let currentAllowance = allowance;
  while (iterations < 1_000_000) {
    const finished = finishDeclarativeV2VerifierLinkerV1(
      created.success,
      currentAllowance,
    );
    if (Result.isFailure(finished)) return Result.fail(finished.failure);
    if (!("status" in finished.success)) {
      return Result.succeed(finished.success);
    }
    if (currentAllowance === 0) currentAllowance = 1_024;
    iterations += 1;
  }
  throw new Error("test-only linker drive exceeded its iteration ceiling");
}

function materializeLinkResult(
  result: DeclarativeV2VerifierLinkResultV1,
) {
  const materialized = DECLARATIVE_V2_VERIFIER_EXECUTABLE_V1_TEST_ONLY
    .materializeLinkResult(result, 1_000_000);
  if (Result.isFailure(materialized)) throw materialized.failure;
  return materialized.success;
}

function semanticProjection(
  result: ReturnType<typeof runSource>,
): unknown {
  if (Result.isFailure(result)) return result.failure;
  return {
    verified: result.success.verified,
    imports: result.success.imports,
    exports: result.success.exports,
    functions: result.success.functions,
    summary: {
      ...result.success.moduleSummary,
      sourceSha256: [...result.success.moduleSummary.sourceSha256],
    },
    importCalls: result.success.importCalls,
    valueFlows: result.success.valueFlows,
    diagnostics: result.success.diagnostics,
  };
}

let cachedCanonicalGrammar:
  ReturnType<typeof compileDeclarativeV2CanonicalGrammarV1> | undefined;

function canonicalGrammar():
  ReturnType<typeof compileDeclarativeV2CanonicalGrammarV1> {
  cachedCanonicalGrammar ??= compileDeclarativeV2CanonicalGrammarV1();
  return cachedCanonicalGrammar;
}

function acceptsCanonicalTerminalNames(
  names: ReadonlyArray<string>,
): boolean {
  const compiled = canonicalGrammar();
  const terminalByName = new Map<string, number>(
    DECLARATIVE_V2_CANONICAL_TERMINALS_V1.map(({ id, name }) =>
      [name, id] as const
    ),
  );
  const productionById = new Map<
    number,
    (typeof compiled.productionHeaders)[number]
  >(
    compiled.productionHeaders.map((production) =>
      [production.id, production] as const
    ),
  );
  const actionByKey = new Map<
    string,
    (typeof compiled.actions)[number]
  >(
    compiled.actions.map((action) =>
      [`${action.state}/${action.terminal}`, action] as const
    ),
  );
  const gotoByKey = new Map<string, number>(
    compiled.gotos.map((row) =>
      [`${row.state}/${row.nonterminal}`, row.nextState] as const
    ),
  );
  const eof = terminalByName.get("eof");
  if (eof === undefined) throw new Error("canonical EOF terminal is missing");
  const terminals: number[] = [];
  for (const name of names) {
    const terminal = terminalByName.get(name);
    if (terminal === undefined) return false;
    terminals.push(terminal);
  }
  terminals.push(eof);
  const stack = [1];
  let input = 0;
  for (let transition = 0; transition < 1_000_000; transition += 1) {
    const state = stack[stack.length - 1];
    const terminal = terminals[input];
    if (state === undefined || terminal === undefined) return false;
    const action = actionByKey.get(`${state}/${terminal}`);
    if (action === undefined) return false;
    if (action.action === 1) {
      stack.push(action.value);
      input += 1;
      continue;
    }
    if (action.action === 2) {
      const production = productionById.get(action.value);
      if (
        production === undefined ||
        production.rhsLength >= stack.length
      ) {
        return false;
      }
      stack.length -= production.rhsLength;
      const previous = stack[stack.length - 1];
      if (previous === undefined) return false;
      const next = gotoByKey.get(`${previous}/${production.lhs}`);
      if (next === undefined) return false;
      stack.push(next);
      continue;
    }
    return action.action === 3 && input === terminals.length - 1;
  }
  throw new Error("canonical parser did not terminate");
}

function canonicalUtf8Accepts(bytes: ReadonlyArray<number>): boolean {
  const specificClasses =
    DECLARATIVE_V2_CANONICAL_UTF8_BYTE_CLASSES_V1.filter(
      ({ name }) => name !== "invalid",
    );
  const invalid = DECLARATIVE_V2_CANONICAL_UTF8_BYTE_CLASSES_V1.find(
    ({ name }) => name === "invalid",
  );
  if (invalid === undefined) throw new Error("missing invalid UTF-8 class");
  const transitionByKey = new Map<string, number>(
    DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1.map((row) =>
      [`${row.state}/${row.byteClass}`, row.nextState] as const
    ),
  );
  let state = 1;
  for (const byte of bytes) {
    const byteClass = specificClasses.find(
      ({ first, last }) => byte >= first && byte <= last,
    )?.id ?? invalid.id;
    const next = transitionByKey.get(`${state}/${byteClass}`);
    if (next === undefined) return false;
    state = next;
  }
  return state === 1;
}

function encodeUnicodeScalar(codePoint: number): ReadonlyArray<number> {
  if (codePoint <= 0x7f) return [codePoint];
  if (codePoint <= 0x7ff) {
    return [
      0xc0 | (codePoint >>> 6),
      0x80 | (codePoint & 0x3f),
    ];
  }
  if (codePoint <= 0xffff) {
    return [
      0xe0 | (codePoint >>> 12),
      0x80 | ((codePoint >>> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    ];
  }
  return [
    0xf0 | (codePoint >>> 18),
    0x80 | ((codePoint >>> 12) & 0x3f),
    0x80 | ((codePoint >>> 6) & 0x3f),
    0x80 | (codePoint & 0x3f),
  ];
}

describe("Declarative V2 executable verifier asset", () => {
  test("pins the generated identity and two-clean equality", async () => {
    const first = await generateDeclarativeV2VerifierExecutableV1(PACKAGE_ROOT);
    const second = await generateDeclarativeV2VerifierExecutableV1(PACKAGE_ROOT);
    expect(first.manifest.assetSha256).toBe(
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetSha256,
    );
    expect(first.manifest.manifestIdentity).toBe(
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.manifestIdentity,
    );
    expect(first.source).toBe(second.source);
    expect(first.asset).toEqual(second.asset);
    expect(first.manifest.acceptedSpecificationManifestIdentity).toBe(
      GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.manifestIdentity,
    );
    expect(DECLARATIVE_V2_VERIFIER_EXECUTABLE_CONTRACT_V1.binds
      .acceptedSpecificationAssetSha256).toBe(
        GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetSha256,
      );
    expect(first.manifest).toMatchObject({
      assetSha256:
        "fea88d3ad2cec58bf17f3e40173c57febcc710bc56c7ad595c3893de0795a082",
      assetByteLength: 4_734_280,
      contractSha256:
        "8471dd709f9c91126af8e075ebdb1c0d909225c0afe0706d371bb40cd4101d90",
      manifestIdentity:
        "6a37199aba1b3f8517d133d8c50caa082f3f87e6e61df5924f6a4b33a93e4370",
    });
  }, 120_000);

  test("matches the checked-in generated source exactly", async () => {
    const generated = await generateDeclarativeV2VerifierExecutableV1(
      PACKAGE_ROOT,
    );
    expect(await readFile(
      resolve(PACKAGE_ROOT, "src/declarativeV2VerifierExecutableV1.generated.ts"),
      "utf8",
    )).toBe(generated.source);
  }, 60_000);

  test("changes identity when either executable identity source changes", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "flarex-a1b0-identity-"));
    temporaryDirectories.push(directory);
    await Promise.all([
      mkdir(resolve(directory, "src"), { recursive: true }),
      mkdir(resolve(directory, "scripts"), { recursive: true }),
    ]);
    const contractSource = await readFile(
      resolve(PACKAGE_ROOT, "src/declarativeV2VerifierExecutableV1.contract.ts"),
      "utf8",
    );
    const generatorSource = await readFile(
      resolve(PACKAGE_ROOT, "scripts/declarativeV2VerifierExecutableV1.ts"),
      "utf8",
    );
    await Promise.all([
      writeFile(
        resolve(directory, "src/declarativeV2VerifierExecutableV1.contract.ts"),
        contractSource,
        "utf8",
      ),
      writeFile(
        resolve(directory, "scripts/declarativeV2VerifierExecutableV1.ts"),
        generatorSource,
        "utf8",
      ),
    ]);
    const baseline = await generateDeclarativeV2VerifierExecutableV1(directory);
    await writeFile(
      resolve(directory, "src/declarativeV2VerifierExecutableV1.contract.ts"),
      `${contractSource}\n// mutation\n`,
      "utf8",
    );
    const contractMutation =
      await generateDeclarativeV2VerifierExecutableV1(directory);
    expect(contractMutation.manifest.manifestIdentity).not.toBe(
      baseline.manifest.manifestIdentity,
    );
    await writeFile(
      resolve(directory, "src/declarativeV2VerifierExecutableV1.contract.ts"),
      contractSource,
      "utf8",
    );
    await writeFile(
      resolve(directory, "scripts/declarativeV2VerifierExecutableV1.ts"),
      `${generatorSource}\n// mutation\n`,
      "utf8",
    );
    const generatorMutation =
      await generateDeclarativeV2VerifierExecutableV1(directory);
    expect(generatorMutation.manifest.manifestIdentity).not.toBe(
      baseline.manifest.manifestIdentity,
    );
  }, 120_000);

  test("fails generation on conflicts, missing references, and recovery loops", () => {
    expect(() => validateDeclarativeV2VerifierExecutableRowsV1({
      parserActions: [
        { id: 1, state: 1, terminal: 1, action: 1, value: 2 },
        { id: 2, state: 1, terminal: 1, action: 1, value: 3 },
      ],
    })).toThrow(/nondeterministic transition/u);
    expect(() => validateDeclarativeV2VerifierExecutableRowsV1({
      parserActions: [
        { id: 1, state: 1, terminal: 99, action: 1, value: 2 },
      ],
    })).toThrow(/missing reference/u);
    expect(() => validateDeclarativeV2VerifierExecutableRowsV1({
      parserActions: [
        { id: 1, state: 1, terminal: 1, action: 2, value: 99 },
      ],
    })).toThrow(/missing reference/u);
    expect(() => validateDeclarativeV2VerifierExecutableRowsV1({
      recovery: [
        { id: 1, state: 1, terminal: 4, action: 0, consumes: 0 },
      ],
    })).toThrow(/zero-consumption cycle/u);
    expect(() => validateDeclarativeV2VerifierExecutableRowsV1({
      parserProductions: DECLARATIVE_V2_PARSER_PRODUCTIONS_V1.map(
        (production) => production.id === 12
          ? {
            ...production,
            rhs: [0x8000_0007, 0, 0, 0],
          }
          : production,
      ),
    })).toThrow(/nonproductive/u);
    expect(() => validateDeclarativeV2VerifierExecutableRowsV1({
      parserProductions: DECLARATIVE_V2_PARSER_PRODUCTIONS_V1.filter(
        ({ id }) => id < 7,
      ),
    })).toThrow(/nonproductive|unreachable/u);
    expect(() => validateDeclarativeV2VerifierExecutableRowsV1({
      utf8Transitions: DECLARATIVE_V2_UTF8_TRANSITIONS_V1.map((row) =>
        row.id === 1 ? { ...row, action: 99 } : row
      ),
    })).toThrow(/UTF-8 transition/u);
    expect(() => validateDeclarativeV2VerifierExecutableRowsV1({
      numberTransitions: DECLARATIVE_V2_NUMBER_TRANSITIONS_V1.map((row) =>
        row.id === 1 ? { ...row, nextState: 99 } : row
      ),
    })).toThrow(/Number transition/u);
    expect(() => validateDeclarativeV2VerifierExecutableRowsV1({
      templateTransitions: DECLARATIVE_V2_TEMPLATE_TRANSITIONS_V1.map((row) =>
        row.id === 1 ? { ...row, action: 99 } : row
      ),
    })).toThrow(/Template transition/u);
  });

  test("constructs one deterministic canonical LR(1) grammar with real reductions", () => {
    const compiled = canonicalGrammar();
    expect(compiled).toMatchObject({
      unresolvedConflictCount: 0,
    });
    expect({
      productions: compiled.productionHeaders.length,
      rhsSymbols: compiled.productionRhs.length,
      items: compiled.items.length,
      states: compiled.states.length,
      actions: compiled.actions.length,
      shifts: compiled.actions.filter(({ action }) => action === 1).length,
      reductions: compiled.actions.filter(({ action }) => action === 2).length,
      accepts: compiled.actions.filter(({ action }) => action === 3).length,
      gotos: compiled.gotos.length,
      recovery: compiled.recovery.length,
    }).toEqual({
      productions: 225,
      rhsSymbols: 490,
      items: 150_405,
      states: 4_901,
      actions: 92_094,
      shifts: 32_038,
      reductions: 60_055,
      accepts: 1,
      gotos: 21_090,
      recovery: 1,
    });
    expect(
      compiled.actions.filter(({ action }) => action === 3),
    ).toEqual([
      expect.objectContaining({
        terminal: 1,
        action: 3,
        value: 0,
      }),
    ]);
    validateDeclarativeV2CompiledCanonicalGrammarV1(undefined, compiled);
  }, 30_000);

  test("accepts the frozen Core shell and body constructs at the canonical table", () => {
    const accepted = [
      [],
      [
        "string",
        ";",
        "import",
        "{",
        "identifier",
        ",",
        "identifier",
        "}",
        "from",
        "string",
        ";",
        "export",
        "default",
        "async",
        "function",
        "identifier",
        "(",
        "identifier",
        ",",
        "{",
        "identifier",
        ":",
        "identifier",
        "}",
        ")",
        "{",
        "let",
        "identifier",
        "=",
        "[",
        "number",
        ",",
        "string",
        "]",
        ";",
        "if",
        "(",
        "identifier",
        ")",
        "return",
        "identifier",
        ";",
        "else",
        "return",
        "null",
        ";",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        ")",
        "{",
        "while",
        "(",
        "identifier",
        ")",
        "{",
        "expressionStatementStart",
        "identifier",
        "(",
        "identifier",
        ")",
        ";",
        "}",
        "for",
        "(",
        "let",
        "identifier",
        "=",
        "number",
        ";",
        "identifier",
        "<",
        "number",
        ";",
        "identifier",
        "+=",
        "number",
        ")",
        "continue",
        ";",
        "return",
        "templateHead",
        "identifier",
        "templateTail",
        ";",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        ")",
        "{",
        "return",
        "(",
        "identifier",
        "||",
        "identifier",
        ")",
        "??",
        "identifier",
        ";",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        ")",
        "{",
        "return",
        "identifier",
        "??",
        "(",
        "identifier",
        "||",
        "identifier",
        ")",
        ";",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        ")",
        "{",
        "try",
        "{",
        "throw",
        "identifier",
        ";",
        "}",
        "catch",
        "(",
        "identifier",
        ")",
        "{",
        "return",
        "false",
        ";",
        "}",
        "finally",
        "{",
        "expressionStatementStart",
        "identifier",
        "=",
        "true",
        ";",
        "}",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        "identifier",
        ")",
        "{",
        "return",
        "identifier",
        "/",
        "(",
        "number",
        "+",
        "number",
        ")",
        ";",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        "identifier",
        ",",
        "identifier",
        ")",
        "{",
        "for",
        "(",
        "forBindingStart",
        "identifier",
        "of",
        "identifier",
        ")",
        "{",
        "}",
        "return",
        "identifier",
        ";",
        "}",
      ],
    ] satisfies ReadonlyArray<ReadonlyArray<string>>;
    for (const sequence of accepted) {
      expect(acceptsCanonicalTerminalNames(sequence), sequence.join(" "))
        .toBe(true);
    }
  }, 30_000);

  test("rejects forbidden and malformed Core constructs at the canonical table", () => {
    const rejected = [
      ["import", "string", ";"],
      ["export", "{", "identifier", "}", ";"],
      ["export", "default", "function", "(", ")", "{", "}"],
      ["class", "identifier", "{", "}"],
      [
        "function",
        "identifier",
        "(",
        ")",
        "{",
        "expressionStatementStart",
        "import",
        "(",
        "string",
        ")",
        ";",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        "identifier",
        ",",
        ",",
        "identifier",
        ")",
        "{",
        "}",
      ],
      ["function", "identifier", "(", ")", "{", "else", "{", "}", "}"],
      ["function", "identifier", "(", ")", "{", "if", "(", ")", "{", "}", "}"],
      ["function", "identifier", "(", ")", "{", "try", "{", "}", "}"],
      [
        "function",
        "identifier",
        "(",
        ")",
        "{",
        "return",
        "identifier",
        "??",
        "identifier",
        "||",
        "identifier",
        ";",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        ")",
        "{",
        "return",
        "identifier",
        "||",
        "identifier",
        "??",
        "identifier",
        ";",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        ")",
        "{",
        "expressionStatementStart",
        "new",
        "identifier",
        "(",
        ")",
        ";",
        "}",
      ],
      [
        "function",
        "identifier",
        "(",
        ")",
        "{",
        "for",
        "(",
        "let",
        "identifier",
        "in",
        "identifier",
        ")",
        "{",
        "}",
        "}",
      ],
    ] satisfies ReadonlyArray<ReadonlyArray<string>>;
    for (const sequence of rejected) {
      expect(acceptsCanonicalTerminalNames(sequence), sequence.join(" "))
        .toBe(false);
    }
  });

  test("fails closed on grammar-source and compiled-relation mutations", () => {
    expect(() => compileDeclarativeV2CanonicalGrammarV1({
      terminals: DECLARATIVE_V2_CANONICAL_TERMINALS_V1.map((row) =>
        row.id === 2 ? { ...row, name: "eof" } : row
      ),
    })).toThrow(/duplicate/u);
    expect(() => compileDeclarativeV2CanonicalGrammarV1({
      productions: DECLARATIVE_V2_CANONICAL_PRODUCTIONS_V1.map((row) =>
        row.id === 2
          ? { ...row, rhs: ["missingCanonicalSymbol"] }
          : row
      ),
    })).toThrow(/missing or ambiguous RHS/u);
    expect(() => compileDeclarativeV2CanonicalGrammarV1({
      productions: DECLARATIVE_V2_CANONICAL_PRODUCTIONS_V1.slice(0, -2),
    })).toThrow(/nonproductive/u);
    expect(() => compileDeclarativeV2CanonicalGrammarV1({
      precedence: DECLARATIVE_V2_CANONICAL_PRECEDENCE_V1.slice(0, 1),
    })).toThrow(/unresolved shift\/reduce conflict/u);
    expect(() => compileDeclarativeV2CanonicalGrammarV1({
      precedence: [
        ...DECLARATIVE_V2_CANONICAL_PRECEDENCE_V1,
        {
          id: DECLARATIVE_V2_CANONICAL_PRECEDENCE_V1.length + 1,
          terminal: "else",
          precedence: 3,
          associativity: 2,
        },
      ],
    })).toThrow(/inconsistent relation/u);

    const compiled = canonicalGrammar();
    expect(() => validateDeclarativeV2CompiledCanonicalGrammarV1({
      productionHeaders: compiled.productionHeaders.map((row) =>
        row.id === 1 ? { ...row, rhsLength: row.rhsLength + 1 } : row
      ),
    }, compiled)).toThrow(/incomplete RHS span/u);
    expect(() => validateDeclarativeV2CompiledCanonicalGrammarV1({
      states: compiled.states.map((row) =>
        row.id === 1 ? { ...row, itemOffset: 1 } : row
      ),
    }, compiled)).toThrow(/incomplete item span/u);
    expect(() => validateDeclarativeV2CompiledCanonicalGrammarV1({
      actions: compiled.actions.slice(1),
    }, compiled)).toThrow(/stable IDs/u);
    expect(() => validateDeclarativeV2CompiledCanonicalGrammarV1({
      gotos: compiled.gotos.map((row) =>
        row.id === 1 ? { ...row, nextState: 0 } : row
      ),
    }, compiled)).toThrow(/invalid/u);
    expect(() => validateDeclarativeV2CompiledCanonicalGrammarV1({
      recovery: compiled.recovery.slice(0, -1),
    }, compiled)).toThrow(/differs/u);
  }, 60_000);

  test("proves the complete canonical UTF-8 graph and rejects every edge drift", () => {
    validateDeclarativeV2CanonicalUtf8V1();
    expect(DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1).toHaveLength(
      DECLARATIVE_V2_CANONICAL_UTF8_STATES_V1.length *
        DECLARATIVE_V2_CANONICAL_UTF8_BYTE_CLASSES_V1.length,
    );
    for (let scalar = 0; scalar <= 0x10_ffff; scalar += 1) {
      if (scalar >= 0xd800 && scalar <= 0xdfff) continue;
      if (!canonicalUtf8Accepts(encodeUnicodeScalar(scalar))) {
        throw new Error(
          `canonical UTF-8 rejected scalar U+${scalar.toString(16)}`,
        );
      }
    }
    for (const bytes of [
      [0x80],
      [0xc0, 0x80],
      [0xc1, 0xbf],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf0, 0x80, 0x80, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xf5, 0x80, 0x80, 0x80],
      [0xff],
    ]) {
      expect(canonicalUtf8Accepts(bytes), bytes.join(",")).toBe(false);
    }
    for (const transition of DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1) {
      expect(() => validateDeclarativeV2CanonicalUtf8V1({
        transitions: DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1.map((row) =>
          row.id === transition.id
            ? {
              ...row,
              nextState: row.nextState === 9 ? 1 : 9,
            }
            : row
        ),
      }), `edge ${transition.id}`).toThrow(/graph|scalar|state/u);
    }
    expect(() => validateDeclarativeV2CanonicalUtf8V1({
      transitions: DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1.slice(1),
    })).toThrow(/stable IDs|incomplete/u);
    expect(() => validateDeclarativeV2CanonicalUtf8V1({
      transitions: [
        ...DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1,
        {
          id: DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1.length + 1,
          state: 1,
          byteClass: 1,
          nextState: 1,
        },
      ],
    })).toThrow(/nondeterministic|incomplete/u);
  }, 30_000);

  test("loads the exact asset with owned output and exact/one-less budget", () => {
    const asset = generatedAsset();
    const exact = loadDeclarativeV2VerifierExecutableAssetV1(
      asset,
      asset.byteLength,
    );
    expect(Result.isSuccess(exact)).toBe(true);
    if (Result.isFailure(exact)) return;
    const firstCopy = exact.success.copyBytes();
    firstCopy[0] = 0;
    expect(exact.success.copyBytes()[0]).not.toBe(0);
    expect(exact.success.lookupHashedString("keywords", "function"))
      .toBeTypeOf("number");
    expect(exact.success.lookupHashedString("keywords", "notAKeyword"))
      .toBeUndefined();
    const directiveTerminal = exact.success.lookupHashedString(
      "terminals",
      "directive",
    );
    expect(directiveTerminal).toBeTypeOf("number");
    if (directiveTerminal === undefined) throw new Error("missing terminal");
    expect(exact.success.parserAction(1, directiveTerminal)).toEqual({
      action: 1,
      value: 2,
    });
    expect(exact.success.parserGoto(1, 1)).toBe(5);
    expect(exact.success.parserProduction(1)).toEqual({
      lhs: 1,
      rhsLength: 2,
      semanticOpcode: 7,
      rhs: [0x8000_0002, 4],
    });
    expect(exact.success.operatorPrecedence("**")).toEqual({
      precedence: 13,
      associativity: "right",
    });
    expect(exact.success.asiAction(5)).toBe(2);
    expect(exact.success.templateTransition(1, 2)).toEqual({
      nextState: 2,
      action: 2,
    });
    expect(exact.success.parserRecovery(1, 4)).toEqual({
      action: 1,
      consumes: 0,
    });
    expect(exact.success.semanticOpcode(15)).toBe(15);
    const canonical = canonicalGrammar();
    const canonicalAction = canonical.actions[0]!;
    expect(exact.success.canonicalAction(
      canonicalAction.state,
      canonicalAction.terminal,
    )).toEqual({
      action: canonicalAction.action,
      value: canonicalAction.value,
    });
    const canonicalGoto = canonical.gotos[0]!;
    expect(exact.success.canonicalGoto(
      canonicalGoto.state,
      canonicalGoto.nonterminal,
    )).toBe(canonicalGoto.nextState);
    const canonicalProduction = canonical.productionHeaders[0]!;
    expect(exact.success.canonicalProduction(canonicalProduction.id)).toEqual({
      lhs: canonicalProduction.lhs,
      rhsLength: canonicalProduction.rhsLength,
      semanticOpcode: canonicalProduction.semanticOpcode,
    });
    const canonicalRecovery = canonical.recovery[0]!;
    expect(exact.success.canonicalRecovery()).toEqual({
      diagnostic: canonicalRecovery.diagnostic,
      consumes: canonicalRecovery.consumes,
    });
    asset.fill(0);
    expect(exact.success.lookupHashedString("keywords", "function"))
      .toBeTypeOf("number");
    const oneLess = loadDeclarativeV2VerifierExecutableAssetV1(
      asset,
      asset.byteLength - 1,
    );
    expect(Result.isFailure(oneLess)).toBe(true);
    if (Result.isFailure(oneLess)) {
      expect(oneLess.failure.reason).toBe("budgetExceeded");
    }
  }, 30_000);

  test("rejects hostile, truncated, trailing, misaligned, and wrong-version assets", () => {
    const asset = generatedAsset();
    expect(Result.isFailure(
      loadDeclarativeV2VerifierExecutableAssetV1(
        new Proxy(asset, {}),
        asset.byteLength,
      ),
    )).toBe(true);
    for (const truncated of [
      asset.slice(0, 1),
      asset.slice(0, 127),
      asset.slice(0, asset.byteLength - 1),
    ]) {
      expect(Result.isFailure(
        loadDeclarativeV2VerifierExecutableAssetV1(
          truncated,
          asset.byteLength,
        ),
      )).toBe(true);
    }
    const trailing = new Uint8Array(asset.byteLength + 1);
    trailing.set(asset);
    expect(Result.isFailure(
      loadDeclarativeV2VerifierExecutableAssetV1(
        trailing,
        trailing.byteLength,
      ),
    )).toBe(true);
    const wrongVersion = new Uint8Array(asset);
    new DataView(wrongVersion.buffer).setUint32(8, 2, false);
    const wrong = loadDeclarativeV2VerifierExecutableAssetV1(
      wrongVersion,
      wrongVersion.byteLength,
    );
    expect(Result.isFailure(wrong)).toBe(true);
    if (Result.isFailure(wrong)) {
      expect(wrong.failure.reason).toBe("unsupportedVersion");
    }
    const misaligned = new Uint8Array(asset);
    new DataView(misaligned.buffer).setUint32(128 + 8, 393, false);
    expect(Result.isFailure(
      loadDeclarativeV2VerifierExecutableAssetV1(
        misaligned,
        misaligned.byteLength,
      ),
    )).toBe(true);
  });
});

describe("Declarative V2 streaming engine", () => {
  const validSource = UTF8_ENCODER.encode([
    "\"use strict\";",
    "import { valueGet, databaseGet } from \"flarex:platform\";",
    "function helper(value) { return value; }",
    "export async function getThing(ctx, args) {",
    "  const id = valueGet(args, \"id\");",
    "  return await databaseGet(id);",
    "}",
  ].join("\n"));

  test("hashes the evidence-owner byte stream without verifier-owned framing", () => {
    const result = runSource(validSource, [validSource]);
    if (Result.isFailure(result)) throw result.failure;
    const hash = createHash("sha256");
    const frames: DeclarativeV2VerificationEvidenceFrameV2[] = [
      result.success.moduleSummary,
      ...result.success.importCalls,
      ...result.success.valueFlows,
      ...result.success.diagnostics,
    ];
    for (const frame of frames) hash.update(encodeEvidenceOracle(frame));
    expect(hash.digest("hex")).toBe(result.success.evidenceSha256);
  });

  test("keeps value-flow evidence traversal within a linear finish-call budget", () => {
    const callsFor = (count: number): bigint => {
      const calls = Array.from(
        { length: count },
        (_, index) => `databaseGet("id-${index}");`,
      ).join("\n");
      const source = UTF8_ENCODER.encode([
        "import { databaseGet } from \"flarex:platform\";",
        `export async function manyReads() { ${calls} return null; }`,
      ].join("\n"));
      const result = runSource(source, [source]);
      if (Result.isFailure(result)) throw result.failure;
      expect(result.success.valueFlows).toHaveLength(count);
      return result.success.usage.calls;
    };
    const sixtyFour = callsFor(64);
    const oneTwentyEight = callsFor(128);
    expect(oneTwentyEight * 100n).toBeLessThan(sixtyFour * 201n);
  });

  test("reports undersized evidence-index storage as typed frame exhaustion", () => {
    const source = UTF8_ENCODER.encode([
      "import { databaseGet } from \"flarex:platform\";",
      "export async function read() { return databaseGet(\"id\"); }",
    ].join("\n"));
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/undersized-evidence.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32).fill(9),
      maximums: budget("command_budget", source.byteLength, {
        frameBytes: 1n,
      }),
      required: budget("attempt_usage", source.byteLength, {
        frameBytes: 1n,
      }),
    });
    if (Result.isFailure(created)) throw created.failure;
    const stepped = stepAll(created.success, source);
    if (Result.isFailure(stepped)) throw stepped.failure;
    const finished = finishEngine(created.success);
    expect(Result.isFailure(finished)).toBe(true);
    if (Result.isFailure(finished)) {
      expect(finished.failure.operation).toBe("finish");
      expect(finished.failure.reason).toBe("budgetExceeded");
      expect(finished.failure.dimension).toBe("frameBytes");
      expect(finished.failure.observed).toBeUndefined();
      expect(finished.failure.maximum).toBeUndefined();
    }
  });

  test("contains no verifier-owned evidence keys or contiguous encoder use", async () => {
    const source = await readFile(
      resolve(
        PACKAGE_ROOT,
        "src/declarativeV2VerifierExecutableV1.ts",
      ),
      "utf8",
    );
    for (const forbidden of [
      "const MODULE_KEYS",
      "const CALL_KEYS",
      "const VALUE_FLOW_KEYS",
      "const DIAGNOSTIC_KEYS",
      "createIncrementalCanonicalJsonEncoderV1",
      "makeIncrementalCanonicalJsonEventSourceV1",
      "DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2",
      "findValueFlowRecord",
      "orderedDiagnosticRecord",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain(
      "createDeclarativeV2VerificationEvidenceSinkEncoderV2",
    );
    expect(source).toContain("DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1");
    expect(source).not.toContain("input.modulePath.length");
    expect(source).not.toContain("input.modulePath.charCodeAt");
  });

  test("is byte-stable at every chunk boundary", () => {
    const baselineResult = runSource(validSource, [validSource]);
    expect(Result.isSuccess(baselineResult)).toBe(true);
    if (Result.isFailure(baselineResult)) return;
    expect(
      baselineResult.success.verified,
      baselineResult.success.diagnostics.map(({ code }) => code).join(","),
    ).toBe(true);
    const baseline = semanticProjection(baselineResult);
    for (let split = 0; split <= validSource.byteLength; split += 1) {
      const result = runSource(validSource, [
        validSource.slice(0, split),
        validSource.slice(split),
      ]);
      expect(semanticProjection(result), `split ${split}`).toEqual(baseline);
    }
  }, 30_000);

  test.each([
    [
      "Unicode and identifier escapes",
      "function café(value) { return value; }\nexport function \\u0066oo(value) { return café(value); }",
    ],
    [
      "comments and string escapes",
      "/* header */ export function text() { // body\n return \"a\\u{1f600}\\x21\"; }",
    ],
    [
      "template substitutions",
      "export function label(value) { return `value:${value}`; }",
    ],
    [
      "division lexical goal",
      "export function half(value) { return value / 2; }",
    ],
    [
      "division assignment maximal munch",
      "export function half(value) { value /= 2; return value; }",
    ],
    [
      "leading-dot decimal",
      "export function half() { return .5; }",
    ],
    [
      "restricted ASI",
      "export function absent() { return\nundefined\n}",
    ],
  ])("keeps the admitted %s corpus equivalent at every split", (_name, text) => {
    const source = UTF8_ENCODER.encode(text);
    const baseline = runSource(source, [source]);
    if (Result.isFailure(baseline)) throw baseline.failure;
    expect(Result.isSuccess(baseline)).toBe(true);
    if (Result.isSuccess(baseline)) {
      expect(
        baseline.success.verified,
        baseline.success.diagnostics.map(({ code }) => code).join(","),
      ).toBe(true);
    }
    const expected = semanticProjection(baseline);
    for (let split = 0; split <= source.byteLength; split += 1) {
      expect(semanticProjection(runSource(source, [
        source.slice(0, split),
        source.slice(split),
      ])), `split ${split}`).toEqual(expected);
    }
  });

  test("derives regex versus division from canonical parser state across reductions", () => {
    for (const [sourceText, expectedCode] of [
      ["export function f(value) { return (value) / 2; }", undefined],
      ["export function f() { return (2 + 1); }", undefined],
      ["export function f(value) { return value / (2 + 1); }", undefined],
      ["export function f() { return /x/; }", "CORE_REGEXP_UNSUPPORTED"],
      ["export function f() { return /=/; }", "CORE_REGEXP_UNSUPPORTED"],
      ["export function f() { return /=x/; }", "CORE_REGEXP_UNSUPPORTED"],
      ["export function f() { return /==/; }", "CORE_REGEXP_UNSUPPORTED"],
    ] as const) {
      const source = UTF8_ENCODER.encode(sourceText);
      const baseline = runSource(source, [source]);
      expect(Result.isSuccess(baseline)).toBe(true);
      if (Result.isFailure(baseline)) continue;
      expect(
        baseline.success.diagnostics.map(({ code }) => code),
        sourceText,
      )
        .toEqual(expectedCode === undefined ? [] : [expectedCode]);
      const projection = semanticProjection(baseline);
      for (let split = 0; split <= source.byteLength; split += 1) {
        expect(semanticProjection(runSource(source, [
          source.slice(0, split),
          source.slice(split),
        ])), `${sourceText} split ${split}`).toEqual(projection);
      }
    }
  }, 30_000);

  test("keeps division in buffered classic for headers at every split", () => {
    for (const sourceText of [
      "export function f(x, y) { for (x / y; x < y; x += 1) {} return x; }",
      "export function f(x, y) { for ([x] / y; x < y; x += 1) {} return x; }",
      "export function f(x, y) { for ({ x: x } / y; x < y; x += 1) {} return x; }",
      "export function f() { for ([true / 2]; ; ) {} return null; }",
      "export function f() { for ({ x: true / 2 }; ; ) {} return null; }",
    ]) {
      const source = UTF8_ENCODER.encode(sourceText);
      const baseline = runSource(source, [source]);
      expect(Result.isSuccess(baseline), sourceText).toBe(true);
      if (Result.isFailure(baseline)) continue;
      expect(
        baseline.success.diagnostics.map(({ code }) => code),
        sourceText,
      ).not.toContain("CORE_TRUNCATED_TOKEN");
      expect(
        baseline.success.diagnostics.map(({ code }) => code),
        sourceText,
      ).not.toContain("CORE_SYNTAX");
      const projection = semanticProjection(baseline);
      for (let split = 0; split <= source.byteLength; split += 1) {
        expect(semanticProjection(runSource(source, [
          source.slice(0, split),
          source.slice(split),
        ])), `${sourceText} split ${split}`).toEqual(projection);
      }
    }
  }, 30_000);

  test("keeps regexp goals inside buffered structured for headers", () => {
    for (const sourceText of [
      "export function f() { for ([/x/]; ; ) {} return null; }",
      "export function f() { for ({ x: /=x/ }; ; ) {} return null; }",
      "export function f() { for ([`value:${/x/}`]; ; ) {} return null; }",
    ]) {
      const source = UTF8_ENCODER.encode(sourceText);
      const baseline = runSource(source, [source]);
      expect(Result.isSuccess(baseline), sourceText).toBe(true);
      if (Result.isFailure(baseline)) continue;
      expect(
        baseline.success.diagnostics.map(({ code }) => code),
        sourceText,
      ).toEqual(["CORE_REGEXP_UNSUPPORTED"]);
      const projection = semanticProjection(baseline);
      for (let split = 0; split <= source.byteLength; split += 1) {
        expect(semanticProjection(runSource(source, [
          source.slice(0, split),
          source.slice(split),
        ])), `${sourceText} split ${split}`).toEqual(projection);
      }
    }
  }, 30_000);

  test.each([
    ["NBSP", "\u00a0"],
    ["Ogham space", "\u1680"],
    ["Unicode space", "\u2007"],
    ["narrow NBSP", "\u202f"],
    ["medium mathematical space", "\u205f"],
    ["ideographic space", "\u3000"],
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
  ])("admits ECMAScript %s at every UTF-8 split", (_name, whitespace) => {
    const source = UTF8_ENCODER.encode(
      `export${whitespace}function f() { return null; }`,
    );
    const baseline = semanticProjection(runSource(source, [source]));
    for (let split = 0; split <= source.byteLength; split += 1) {
      expect(semanticProjection(runSource(source, [
        source.slice(0, split),
        source.slice(split),
      ]))).toEqual(baseline);
    }
    const result = runSource(source, [source]);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success.verified).toBe(true);
  });

  test("rejects a source-leading BOM while allowing FEFF after source start", () => {
    const leading = UTF8_ENCODER.encode("\ufeffexport function f() {}");
    const rejected = runSource(leading, [leading]);
    expect(Result.isSuccess(rejected)).toBe(true);
    if (Result.isSuccess(rejected)) {
      expect(rejected.success.verified).toBe(false);
      expect(rejected.success.diagnostics.map(({ code }) => code))
        .toContain("CORE_UNSUPPORTED_TOKEN");
    }
    const interior = UTF8_ENCODER.encode("export\ufefffunction f() {}");
    const accepted = runSource(interior, [interior]);
    expect(Result.isSuccess(accepted)).toBe(true);
    if (Result.isSuccess(accepted)) {
      expect(
        accepted.success.verified,
        accepted.success.diagnostics.map(({ code }) => code).join(","),
      ).toBe(true);
    }
  });

  test("has two-cold equality and admits direct same-module recursion", () => {
    const recursive = UTF8_ENCODER.encode(
      "export function recurse(value) { if (value) return recurse(value); return value; }",
    );
    const first = runSource(recursive, [recursive]);
    const second = runSource(recursive, [recursive]);
    expect(semanticProjection(first)).toEqual(semanticProjection(second));
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isSuccess(first)) expect(first.success.verified).toBe(true);
  });

  test("owns each visible input range without consulting caller iterators", () => {
    const source = UTF8_ENCODER.encode(
      "xxexport function owned() { return null; }yy",
    );
    const visible = source.subarray(2, source.byteLength - 2);
    Object.defineProperty(visible, Symbol.iterator, {
      value: () => {
        throw new Error("iterator must not be observed");
      },
    });
    const required = budget("attempt_usage", visible.byteLength);
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/owned.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: budget("command_budget", visible.byteLength),
      required,
    });
    if (Result.isFailure(created)) throw created.failure;
    const pushed = created.success.step(visible, 1_024);
    expect(Result.isSuccess(pushed)).toBe(true);
    visible.fill(0);
    const finished = finishEngine(created.success);
    expect(Result.isSuccess(finished)).toBe(true);
    if (Result.isSuccess(finished)) {
      expect(finished.success.verified).toBe(true);
      expect(
        materializeModuleResult(finished.success).functions[0]?.name,
      ).toBe("owned");
    }
  });

  test("captures create input through fixed-order data descriptors and fails closed on hostile reflection", () => {
    const sourceSha256 = new Uint8Array(32).fill(9);
    const target = {
      required: budget("attempt_usage", 0),
      sourceSha256,
      moduleOrdinal: 4n,
      maximums: budget("command_budget", 0),
      modulePath: artifactModulePath("functions/descriptors.js"),
    };
    const observations: string[] = [];
    const proxied = new Proxy(target, {
      ownKeys(value) {
        observations.push("ownKeys");
        return Reflect.ownKeys(value);
      },
      getOwnPropertyDescriptor(value, key) {
        observations.push(`descriptor:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(value, key);
      },
      get() {
        throw new Error("create must not dispatch caller property getters");
      },
    });
    const created = createDeclarativeV2VerifierEngineV1(proxied);
    expect(Result.isSuccess(created)).toBe(true);
    expect(observations).toEqual([
      "ownKeys",
      "descriptor:modulePath",
      "descriptor:moduleOrdinal",
      "descriptor:sourceSha256",
      "descriptor:maximums",
      "descriptor:required",
    ]);
    sourceSha256.fill(0);
    if (Result.isSuccess(created)) {
      const finished = finishEngine(created.success);
      expect(Result.isSuccess(finished)).toBe(true);
      if (Result.isSuccess(finished)) {
        expect([
          ...materializeModuleResult(finished.success).moduleSummary
            .sourceSha256,
        ])
          .toEqual([...new Uint8Array(32).fill(9)]);
      }
    }

    let accessorInvocations = 0;
    const accessorInput = {
      ...target,
      get modulePath() {
        accessorInvocations += 1;
        return "functions/accessor.js";
      },
    };
    expect(Result.isFailure(
      createDeclarativeV2VerifierEngineV1(accessorInput),
    )).toBe(true);
    expect(accessorInvocations).toBe(0);

    const revoked = Proxy.revocable(target, {});
    revoked.revoke();
    const revokedResult = createDeclarativeV2VerifierEngineV1(revoked.proxy);
    expect(Result.isFailure(revokedResult)).toBe(true);
    if (Result.isFailure(revokedResult)) {
      expect(revokedResult.failure.reason).toBe("invalidInput");
    }
  });

  test("requires an owned live default-factory module-path handle", () => {
    const source = UTF8_ENCODER.encode("export function ready() {}");
    const input = {
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: budget("command_budget", source.byteLength),
      required: budget("attempt_usage", source.byteLength),
    };
    expect(createDeclarativeV2VerifierEngineV1({
      ...input,
      modulePath: "functions/string.js",
    })).toMatchObject({
      failure: { operation: "create", reason: "invalidInput" },
    });
    expect(createDeclarativeV2VerifierEngineV1({
      ...input,
      modulePath: {
        _tag: "DeclarativeV2ArtifactModulePathHandleV1",
      },
    })).toMatchObject({
      failure: { operation: "create", reason: "invalidInput" },
    });

    const foreignFactory = makeDeclarativeV2ArtifactModulePathFactoryV1();
    const foreignBytes = UTF8_ENCODER.encode("functions/foreign.js");
    const foreignValidator = foreignFactory.create(
      3,
      foreignBytes.byteLength,
      foreignBytes.byteLength,
    );
    if (Result.isFailure(foreignValidator)) throw foreignValidator.failure;
    const foreignStep = foreignFactory.step(
      foreignValidator.success,
      foreignBytes,
      1_024,
    );
    if (Result.isFailure(foreignStep)) throw foreignStep.failure;
    const foreignPath = foreignFactory.finish(foreignValidator.success, 1);
    if (Result.isFailure(foreignPath) || "status" in foreignPath.success) {
      throw new Error("foreign module path did not finish");
    }
    expect(createDeclarativeV2VerifierEngineV1({
      ...input,
      modulePath: foreignPath.success,
    })).toMatchObject({
      failure: { operation: "create", reason: "invalidInput" },
    });

    const revokedPath = artifactModulePath("functions/revoked.js");
    const revoked = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.revoke(revokedPath);
    if (Result.isFailure(revoked)) throw revoked.failure;
    expect(createDeclarativeV2VerifierEngineV1({
      ...input,
      modulePath: revokedPath,
    })).toMatchObject({
      failure: { operation: "create", reason: "invalidInput" },
    });

    const valid = createDeclarativeV2VerifierEngineV1({
      ...input,
      modulePath: artifactModulePath("functions/valid.js"),
    });
    expect(Result.isSuccess(valid)).toBe(true);

    const livePath = artifactModulePath("functions/live-until-finish.js");
    const revokedAfterCreate = createDeclarativeV2VerifierEngineV1({
      ...input,
      modulePath: livePath,
    });
    if (Result.isFailure(revokedAfterCreate)) {
      throw revokedAfterCreate.failure;
    }
    const revokedLive = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.revoke(livePath);
    if (Result.isFailure(revokedLive)) throw revokedLive.failure;
    const stepped = stepAll(revokedAfterCreate.success, source);
    if (Result.isFailure(stepped)) throw stepped.failure;
    expect(finishEngine(revokedAfterCreate.success)).toMatchObject({
      failure: { operation: "finish", reason: "invalidInput" },
    });
  });

  test("pins admitted budgets against caller mutation after create", () => {
    const source = UTF8_ENCODER.encode(
      "export function ownedBudget() { return null; }",
    );
    const mutableRequired = {
      ...budget("attempt_usage", source.byteLength, { functions: 0n }),
    };
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/owned-budget.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: budget("command_budget", source.byteLength),
      required: mutableRequired,
    });
    if (Result.isFailure(created)) throw created.failure;
    mutableRequired.functions = 100n;
    const stepped = stepAll(created.success, source);
    expect(Result.isSuccess(stepped)).toBe(true);
    const result = finishEngine(created.success);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.operation).toBe("finish");
      expect(result.failure.reason).toBe("budgetExceeded");
      expect(result.failure.dimension).toBe("functions");
    }
  });

  test("pins runtime hash admission against caller budget mutation", () => {
    const source = UTF8_ENCODER.encode(
      "export function ownedHashBudget() { return null; }",
    );
    const mutableRequired = {
      ...budget("attempt_usage", source.byteLength, { hashBytes: 0n }),
    };
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/owned-hash-budget.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: budget("command_budget", source.byteLength),
      required: mutableRequired,
    });
    if (Result.isFailure(created)) throw created.failure;
    mutableRequired.hashBytes = 100_000n;
    const stepped = stepAll(created.success, source);
    expect(Result.isSuccess(stepped)).toBe(true);
    const result = finishEngine(created.success);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.operation).toBe("finish");
      expect(result.failure.reason).toBe("budgetExceeded");
      expect(result.failure.dimension).toBe("hashBytes");
    }
  });

  test.each([
    ["dynamic import", "export function f() { return import(\"./x.js\"); }", "CORE_DYNAMIC_IMPORT"],
    ["construction", "export function f() { return new Date(); }", "CORE_CONSTRUCTION"],
    ["computed dispatch", "export function f(x) { return x[\"y\"](); }", "CORE_COMPUTED_DISPATCH"],
    ["higher order", "function g() {} export function f() { return g; }", "CORE_HIGHER_ORDER"],
    ["nested function", "export function f() { function g() {} return null; }", "CORE_HIGHER_ORDER"],
    ["var binding", "export function f() { var x = 1; return x; }", "CORE_UNSAFE_COERCION"],
    ["this recovery", "export function f() { return this; }", "CORE_UNSAFE_COERCION"],
    ["dynamic code", "export function f(x) { return eval(x); }", "CORE_DYNAMIC_CODE"],
    ["regexp", "export function f() { return /x/; }", "CORE_REGEXP_UNSUPPORTED"],
    ["loose equality", "export function f(x) { return x == null; }", "CORE_LOOSE_EQUALITY"],
    [
      "host catch",
      "import { databaseGet } from \"flarex:platform\"; export async function f(x) { try { return await databaseGet(x); } catch (error) { return null; } }",
      "CORE_HOST_FAILURE_OBSERVATION",
    ],
    ["side-effect import", "import \"./x.js\"; export function f() {}", "CORE_SIDE_EFFECT_IMPORT"],
    ["re-export", "export { x } from \"./x.js\";", "CORE_REEXPORT"],
    ["top-level initialization", "const x = 1; export function f() { return x; }", "CORE_TOP_LEVEL_EXECUTION"],
    ["invalid artifact path", "import { x } from \"../x.js\"; export function f() { return x(); }", "CORE_IMPORT_TARGET"],
    ["dot-segment artifact path", "import { x } from \"./a/../x.js\"; export function f() { return x(); }", "CORE_IMPORT_TARGET"],
    ["backslash artifact path", "import { x } from \"./a\\\\x.js\"; export function f() { return x(); }", "CORE_IMPORT_TARGET"],
    ["malformed unary expression", "export function f() { return +; }", "CORE_SYNTAX"],
    [
      "parameter-shadowed platform call",
      "import { databaseGet } from \"flarex:platform\"; export function f(databaseGet) { return databaseGet(); }",
      "CORE_CALL_TARGET",
    ],
    [
      "unknown platform import",
      "import { notReal } from \"flarex:platform\"; export function f() { return notReal(); }",
      "CORE_IMPORT_TARGET",
    ],
  ])("rejects %s deterministically", (_name, source, code) => {
    const bytes = UTF8_ENCODER.encode(source);
    const result = runSource(bytes, [bytes]);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.verified).toBe(false);
      expect(result.success.diagnostics.map((item) => item.code)).toContain(code);
    }
  });

  test("distinguishes invalid UTF-8 and truncated lexical input", () => {
    const invalid = runSource(new Uint8Array([0xc0]), [new Uint8Array([0xc0])]);
    expect(Result.isSuccess(invalid)).toBe(true);
    if (Result.isSuccess(invalid)) {
      expect(invalid.success.diagnostics[0]?.code).toBe("CORE_INVALID_UTF8");
    }
    const truncated = UTF8_ENCODER.encode("export function f() { return \"x");
    const result = runSource(truncated, [truncated]);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.diagnostics.map(({ code }) => code))
        .toContain("CORE_TRUNCATED_TOKEN");
    }
    for (const sourceText of [
      "export function f() { return /\n; }",
      "export function f() { return /",
    ]) {
      const source = UTF8_ENCODER.encode(sourceText);
      const regexp = runSource(source, [source]);
      expect(Result.isSuccess(regexp), sourceText).toBe(true);
      if (Result.isSuccess(regexp)) {
        expect(regexp.success.diagnostics.map(({ code }) => code), sourceText)
          .toContain("CORE_TRUNCATED_TOKEN");
      }
    }
  });

  test("keeps malformed continuation sequences typed at every split", () => {
    const bytes = new Uint8Array([0xc2, 0xc2, 0x20]);
    for (let split = 0; split <= bytes.byteLength; split += 1) {
      const result = runSource(bytes, [
        bytes.slice(0, split),
        bytes.slice(split),
      ]);
      expect(Result.isSuccess(result), `split ${split}`).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.diagnostics.map(({ code }) => code))
          .toContain("CORE_INVALID_UTF8");
      }
    }
  });

  test("keeps incomplete punctuator prefixes inside the diagnostic channel", () => {
    for (const sourceText of [
      "export function f() { return ..5; }",
      "export function f() { return ..x; }",
    ]) {
      const source = UTF8_ENCODER.encode(sourceText);
      for (let split = 0; split <= source.byteLength; split += 1) {
        const result = runSource(source, [
          source.slice(0, split),
          source.slice(split),
        ]);
        expect(Result.isSuccess(result), `${sourceText} split ${split}`)
          .toBe(true);
        if (Result.isSuccess(result)) {
          expect(
            result.success.diagnostics.map(({ code }) => code),
            `${sourceText} split ${split}`,
          ).toContain("CORE_UNSUPPORTED_TOKEN");
        }
      }
    }
  });

  test.each([
    [
      "invalid parameter expression",
      "export function f(a + b) { return null; }",
    ],
    [
      "await in a non-async function",
      "export function f(value) { return await value; }",
    ],
    [
      "parenthesized dynamic call",
      "export function f(callback) { return (callback)(); }",
    ],
    [
      "unescaped line separator in a string",
      "export function f() { return \"a\u2028b\"; }",
    ],
    [
      "adjacent statements without a terminator",
      "export function f() { return null return null; }",
    ],
    [
      "control statement without required parentheses",
      "export function f() { if true return null; }",
    ],
  ])("rejects the R1a blocker: %s", (_name, source) => {
    const bytes = UTF8_ENCODER.encode(source);
    const result = runSource(bytes, [bytes]);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.verified).toBe(false);
    }
  });

  test.each([
    ["throw newline", "export function f(x) { throw\nx; }"],
    ["async newline", "async\nfunction f() { return null; }"],
  ])("rejects restricted-production line break: %s", (_name, source) => {
    const result = runSource(UTF8_ENCODER.encode(source), [
      UTF8_ENCODER.encode(source),
    ]);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.verified).toBe(false);
      expect(result.success.diagnostics.map(({ code }) => code))
        .toContain("CORE_SYNTAX");
    }
  });

  test.each([
    [
      "else association",
      "export function f(x) { if (x)\n{ return x; }\nelse { return null; } }",
    ],
    [
      "bare for-of binding",
      "export function f(x, xs) { for (x of xs) { } return x; }",
    ],
    [
      "object binding property",
      "export function f({x: y}) { return y; }",
    ],
    [
      "classic for expression",
      "export function f(x) { for (x = 0; x < 2; x += 1) { } return x; }",
    ],
    [
      "classic for contextual identifier",
      "export function f(of) { for (of = 0; of < 2; of += 1) { } return of; }",
    ],
    [
      "bare object for-of binding",
      "export function f(xs) { for ({x} of xs) { return x; } return null; }",
    ],
    [
      "bare array for-of binding",
      "export function f(xs) { for ([x] of xs) { return x; } return null; }",
    ],
    [
      "expression statement before else",
      "export function f(value) { if (value)\nvalue = null; else value = true; return value; }",
    ],
    [
      "contextual parameter identifiers",
      "export function f(async, of) { return async + of; }",
    ],
  ])("accepts canonical grammar form without extractor override: %s", (
    _name,
    source,
  ) => {
    const bytes = UTF8_ENCODER.encode(source);
    const result = runSource(bytes, [bytes]);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(
        result.success.verified,
        result.success.diagnostics.map(({ code }) => code).join(","),
      ).toBe(true);
    }
  });

  test("accepts signed decimal exponents and terminates LS/PS line comments", () => {
    for (const source of [
      "export function f() { return 1e+2; }",
      "export function f() { return 1e-2; }",
      "// comment\u2028export function f() { return null; }",
      "// comment\u2029export function f() { return null; }",
    ]) {
      const bytes = UTF8_ENCODER.encode(source);
      const result = runSource(bytes, [bytes]);
      expect(Result.isSuccess(result), source).toBe(true);
      if (Result.isSuccess(result)) {
        expect(
          result.success.verified,
          result.success.diagnostics.map(({ code }) => code).join(","),
        ).toBe(true);
      }
    }
  });

  test("resumes long identifier and numeric finalization at allowance one", () => {
    const identifier = `f${"o".repeat(4_096)}`;
    const numeric = `1${"0".repeat(4_096)}`;
    const source = UTF8_ENCODER.encode(
      `export function ${identifier}() { return ${numeric}; }`,
    );
    const run = (
      allowance: 1 | 1_024,
    ): DeclarativeV2VerifierModulePresentationV1 => {
      const created = createDeclarativeV2VerifierEngineV1({
        modulePath: artifactModulePath("functions/large-lexeme.js"),
        moduleOrdinal: 0n,
        sourceSha256: new Uint8Array(32).fill(4),
        maximums: budget("command_budget", source.byteLength, {
          calls: 1_000_000n,
        }),
        required: budget("attempt_usage", source.byteLength, {
          calls: 1_000_000n,
        }),
      });
      if (Result.isFailure(created)) throw created.failure;
      const stepped = stepAll(created.success, source, allowance);
      if (Result.isFailure(stepped)) throw stepped.failure;
      const finished = finishEngine(created.success, allowance);
      if (Result.isFailure(finished)) throw finished.failure;
      return materializeModuleResult(finished.success);
    };
    const one = run(1);
    const maximum = run(1_024);
    const { usage: _oneUsage, ...oneProjection } = one;
    const { usage: _maximumUsage, ...maximumProjection } = maximum;
    expect(oneProjection).toEqual(maximumProjection);
    expect(one.verified).toBe(true);
  }, 30_000);

  test("resumes long string, template, and regexp finalization at allowance one", () => {
    const body = "a".repeat(4_096);
    const source = UTF8_ENCODER.encode([
      `export function stringValue() { return "${body}"; }`,
      `export function templateValue() { return \`${body}\`; }`,
      `export function regexpValue() { return /${body}/; }`,
    ].join("\n"));
    const run = (
      allowance: 1 | 1_024,
    ): DeclarativeV2VerifierModulePresentationV1 => {
      const created = createDeclarativeV2VerifierEngineV1({
        modulePath: artifactModulePath("functions/large-raw-lexemes.js"),
        moduleOrdinal: 0n,
        sourceSha256: new Uint8Array(32).fill(5),
        maximums: budget("command_budget", source.byteLength, {
          calls: 1_000_000n,
        }),
        required: budget("attempt_usage", source.byteLength, {
          calls: 1_000_000n,
        }),
      });
      if (Result.isFailure(created)) throw created.failure;
      const stepped = stepAll(created.success, source, allowance);
      if (Result.isFailure(stepped)) throw stepped.failure;
      const finished = finishEngine(created.success, allowance);
      if (Result.isFailure(finished)) throw finished.failure;
      return materializeModuleResult(finished.success);
    };
    const one = run(1);
    const maximum = run(1_024);
    const { usage: _oneUsage, ...oneProjection } = one;
    const { usage: _maximumUsage, ...maximumProjection } = maximum;
    expect(oneProjection).toEqual(maximumProjection);
    expect(one.diagnostics.map(({ code }) => code)).toEqual([
      "CORE_REGEXP_UNSUPPORTED",
    ]);
  }, 30_000);

  test("terminalizes every failure and exposes stable finish boundaries", () => {
    const source = UTF8_ENCODER.encode(
      "export function f() { return null; }",
    );
    const required = budget("attempt_usage", source.byteLength);
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/f.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: budget("command_budget", source.byteLength),
      required,
    });
    if (Result.isFailure(created)) throw created.failure;
    const stepped = stepAll(created.success, source);
    expect(Result.isSuccess(stepped)).toBe(true);
    const states: string[] = [];
    while (true) {
      const result = created.success.finish(1_024);
      if (Result.isFailure(result)) throw result.failure;
      if ("status" in result.success) {
        states.push(result.success.state);
        continue;
      }
      break;
    }
    expect(states.slice(0, 2)).toEqual(["finishingLexer", "parsing"]);
    expect(states.at(-1)).toBe("orderingOutput");
    expect(states.slice(2, -1).length).toBeGreaterThan(0);
    expect(states.slice(2, -1).every((state) => state === "semanticFlow"))
      .toBe(true);
    const repeated = created.success.finish(1_024);
    expect(Result.isFailure(repeated)).toBe(true);
    if (Result.isFailure(repeated)) {
      expect(repeated.failure.reason).toBe("alreadyFinished");
    }

    const failed = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/failed.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: budget("command_budget", 0),
      required: budget("attempt_usage", 0),
    });
    if (Result.isFailure(failed)) throw failed.failure;
    expect(Result.isFailure(failed.success.step("not bytes", 1_024))).toBe(true);
    const afterFailure = failed.success.step(new Uint8Array(), 1_024);
    expect(Result.isFailure(afterFailure)).toBe(true);
    if (Result.isFailure(afterFailure)) {
      expect(afterFailure.failure.reason).toBe("closed");
    }
    const finishAfterFailure = failed.success.finish(1_024);
    expect(Result.isFailure(finishAfterFailure)).toBe(true);
    if (Result.isFailure(finishAfterFailure)) {
      expect(finishAfterFailure.failure.reason).toBe("closed");
    }
  });

  test("terminalizes token-start exhaustion through the step Result channel", () => {
    const source = UTF8_ENCODER.encode("x");
    const required = budget("attempt_usage", source.byteLength, {
      tokenBytes: 0n,
    });
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/token-budget.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: Object.freeze({
        ...required,
        kind: "command_budget",
      }) as DeclarativeV2VerifierBudgetFrameV2,
      required,
    });
    if (Result.isFailure(created)) throw created.failure;
    const stepped = created.success.step(source, 1_024);
    expect(Result.isFailure(stepped)).toBe(true);
    if (Result.isFailure(stepped)) {
      expect(stepped.failure.operation).toBe("step");
      expect(stepped.failure.reason).toBe("budgetExceeded");
      expect(stepped.failure.dimension).toBe("tokenBytes");
    }
    const finished = created.success.finish(1_024);
    expect(Result.isFailure(finished)).toBe(true);
    if (Result.isFailure(finished)) {
      expect(finished.failure.reason).toBe("closed");
    }
  });

  test("attributes EOF identifier diagnostic exhaustion to finish", () => {
    const source = UTF8_ENCODER.encode("\\u0030");
    const required = budget("attempt_usage", source.byteLength, {
      diagnosticBytes: 0n,
    });
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/finish-diagnostic.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: Object.freeze({
        ...required,
        kind: "command_budget",
      }) as DeclarativeV2VerifierBudgetFrameV2,
      required,
    });
    if (Result.isFailure(created)) throw created.failure;
    const stepped = stepAll(created.success, source);
    if (Result.isFailure(stepped)) throw stepped.failure;
    const finished = finishEngine(created.success);
    expect(Result.isFailure(finished)).toBe(true);
    if (Result.isFailure(finished)) {
      expect(finished.failure.operation).toBe("finish");
      expect(finished.failure.reason).toBe("budgetExceeded");
      expect(finished.failure.dimension).toBe("diagnosticBytes");
    }
  });

  test("attributes pending regexp diagnostic exhaustion to finish", () => {
    const source = UTF8_ENCODER.encode(" ".repeat(1_022) + "/\n");
    const required = budget("attempt_usage", source.byteLength, {
      diagnosticBytes: 0n,
    });
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/finish-regexp-diagnostic.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: Object.freeze({
        ...required,
        kind: "command_budget",
      }) as DeclarativeV2VerifierBudgetFrameV2,
      required,
    });
    if (Result.isFailure(created)) throw created.failure;
    const stepped = created.success.step(source, 1_024);
    expect(Result.isSuccess(stepped)).toBe(true);
    if (Result.isFailure(stepped)) return;
    expect(stepped.success.consumedBytes).toBe(source.byteLength);
    const finished = finishEngine(created.success);
    expect(Result.isFailure(finished)).toBe(true);
    if (Result.isFailure(finished)) {
      expect(finished.failure.operation).toBe("finish");
      expect(finished.failure.reason).toBe("budgetExceeded");
      expect(finished.failure.dimension).toBe("diagnosticBytes");
    }
  });

  test("attributes incomplete punctuator diagnostic exhaustion to finish", () => {
    const source = UTF8_ENCODER.encode("..");
    const required = budget("attempt_usage", source.byteLength, {
      diagnosticBytes: 0n,
    });
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/finish-punctuator-diagnostic.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: Object.freeze({
        ...required,
        kind: "command_budget",
      }) as DeclarativeV2VerifierBudgetFrameV2,
      required,
    });
    if (Result.isFailure(created)) throw created.failure;
    const stepped = stepAll(created.success, source);
    if (Result.isFailure(stepped)) throw stepped.failure;
    const finished = finishEngine(created.success);
    expect(Result.isFailure(finished)).toBe(true);
    if (Result.isFailure(finished)) {
      expect(finished.failure.operation).toBe("finish");
      expect(finished.failure.reason).toBe("budgetExceeded");
      expect(finished.failure.dimension).toBe("diagnosticBytes");
    }
  });

  test("charges incremental scans for long unfinished for bindings", () => {
    for (const [opening, entry] of [
      ["{", (index: number) => `x${index},`],
      ["[", (index: number) => `x${index},`],
    ] as const) {
      const entryCount = 2_500;
      const source = UTF8_ENCODER.encode(
        `export function f(xs) { for (${opening}${
          Array.from({ length: entryCount }, (_, index) => entry(index)).join("")
        }`,
      );
      const required = budget("attempt_usage", source.byteLength, {
        calls: 100_000n,
        tokens: 10_000n,
        tokenBytes: BigInt(source.byteLength),
        stringBytes: BigInt(source.byteLength),
        parserStates: 20_000n,
      });
      const created = createDeclarativeV2VerifierEngineV1({
        modulePath: artifactModulePath(
          `functions/unfinished-${opening === "{" ? "object" : "array"}.js`,
        ),
        moduleOrdinal: 0n,
        sourceSha256: new Uint8Array(32),
        maximums: Object.freeze({
          ...required,
          kind: "command_budget",
        }) as DeclarativeV2VerifierBudgetFrameV2,
        required,
      });
      if (Result.isFailure(created)) throw created.failure;
      let sourceOffset = 0;
      let transitions = 0;
      while (sourceOffset < source.byteLength) {
        const chunkEnd = Math.min(sourceOffset + 1_024, source.byteLength);
        while (sourceOffset < chunkEnd) {
          const stepped = created.success.step(
            source.subarray(sourceOffset, chunkEnd),
            1_024,
          );
          if (Result.isFailure(stepped)) throw stepped.failure;
          sourceOffset += stepped.success.consumedBytes;
          transitions += stepped.success.transitionCount;
        }
      }
      expect(transitions - source.byteLength).toBeGreaterThan(entryCount);
      const finished = finishEngine(created.success);
      expect(Result.isSuccess(finished)).toBe(true);
      if (Result.isSuccess(finished)) {
        expect(finished.success.verified).toBe(false);
        expect(
          materializeModuleResult(finished.success).diagnostics.map((
            { code },
          ) => code),
        )
          .toContain("CORE_SYNTAX");
      }
    }
  }, 30_000);

  test("admits 5,000 nested blocks without consuming the JavaScript stack", () => {
    const text = "export function deep(value) {" +
      "if (value) {".repeat(5_000) +
      "return value;" +
      "}".repeat(5_000) +
      "}";
    const source = UTF8_ENCODER.encode(text);
    const required = budget("attempt_usage", source.byteLength, {
      calls: 200_000n,
      tokens: 40_000n,
      parserStates: 100_000n,
      nestingDepth: 6_000n,
      tokenBytes: BigInt(source.byteLength),
      stringBytes: BigInt(source.byteLength),
      canonicalBytes: BigInt(source.byteLength),
      frameBytes: BigInt(source.byteLength),
      hashBytes: BigInt(source.byteLength),
      outputBytes: BigInt(source.byteLength),
      diagnosticBytes: BigInt(source.byteLength),
    });
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/deep.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: Object.freeze({
        ...required,
        kind: "command_budget",
      }) as DeclarativeV2VerifierBudgetFrameV2,
      required,
    });
    if (Result.isFailure(created)) throw created.failure;
    for (let offset = 0; offset < source.byteLength; offset += 1_024) {
      const step = stepAll(
        created.success,
        source.subarray(offset, offset + 1_024),
      );
      if (Result.isFailure(step)) throw step.failure;
    }
    const result = finishEngine(created.success);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const presentation = materializeModuleResult(result.success);
      expect(
        result.success.verified,
        presentation.diagnostics.map(({ code }) => code).join(","),
      ).toBe(true);
      expect(result.success.usage.nestingDepth).toBeGreaterThanOrEqual(5_000n);
    }
  }, 30_000);

  test("bounds every semantic finish call by the executable transition quantum", () => {
    const text = Array.from(
      { length: 1_200 },
      (_, index) => `export function f${index}() { return null; }`,
    ).join("\n");
    const source = UTF8_ENCODER.encode(text);
    const required = budget("attempt_usage", source.byteLength, {
      calls: 100_000n,
      tokens: 20_000n,
      parserStates: 20_000n,
      functions: 1_200n,
      exports: 1_200n,
      graphNodes: 1_200n,
      tokenBytes: BigInt(source.byteLength),
      stringBytes: BigInt(source.byteLength),
      canonicalBytes: BigInt(source.byteLength),
      frameBytes: BigInt(source.byteLength),
      hashBytes: BigInt(source.byteLength),
      outputBytes: BigInt(source.byteLength * 2),
      diagnosticBytes: BigInt(source.byteLength),
    });
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/many.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: Object.freeze({
        ...required,
        kind: "command_budget",
      }) as DeclarativeV2VerifierBudgetFrameV2,
      required,
    });
    if (Result.isFailure(created)) throw created.failure;
    for (let offset = 0; offset < source.byteLength; offset += 1_024) {
      const stepped = stepAll(
        created.success,
        source.subarray(offset, offset + 1_024),
      );
      if (Result.isFailure(stepped)) throw stepped.failure;
    }
    let semanticPending = 0;
    while (true) {
      const finished = created.success.finish(1_024);
      if (Result.isFailure(finished)) throw finished.failure;
      if (!("status" in finished.success)) {
        expect(
          materializeModuleResult(finished.success).functions,
        ).toHaveLength(1_200);
        break;
      }
      expect(finished.success.transitionCount).toBeLessThanOrEqual(1_024);
      if (finished.success.state === "semanticFlow") semanticPending += 1;
    }
    expect(semanticPending).toBeGreaterThan(1);
  }, 30_000);

  test("resumes long-name ordering and late duplicate lookup at allowance one", () => {
    const name = `late${"x".repeat(2_048)}`;
    const source = UTF8_ENCODER.encode(
      `export function ${name}() { return null; }\n` +
        `export function ${name}() { return null; }`,
    );
    const required = budget("attempt_usage", source.byteLength, {
      calls: 100_000n,
      tokens: 128n,
      parserStates: 256n,
      functions: 2n,
      exports: 2n,
      graphNodes: 8n,
      frontierEntries: 8n,
      tokenBytes: BigInt(source.byteLength),
      stringBytes: BigInt(source.byteLength),
      canonicalBytes: BigInt(source.byteLength * 2),
      frameBytes: BigInt(source.byteLength * 2),
      hashBytes: BigInt(source.byteLength * 2),
      outputBytes: BigInt(source.byteLength * 4),
      diagnosticBytes: BigInt(source.byteLength),
    });
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/late-duplicate.js"),
      moduleOrdinal: 37n,
      sourceSha256: new Uint8Array(32),
      maximums: Object.freeze({
        ...required,
        kind: "command_budget",
      }) as DeclarativeV2VerifierBudgetFrameV2,
      required,
    });
    if (Result.isFailure(created)) throw created.failure;
    const stepped = stepAll(created.success, source);
    if (Result.isFailure(stepped)) throw stepped.failure;
    let semanticPending = 0;
    while (true) {
      const finished = created.success.finish(1);
      if (Result.isFailure(finished)) throw finished.failure;
      if (!("status" in finished.success)) {
        const presentation = materializeModuleResult(finished.success);
        expect(presentation.diagnostics.map(({ code }) => code)).toContain(
          "CORE_EXPORT_AMBIGUITY",
        );
        break;
      }
      expect(finished.success.transitionCount).toBeLessThanOrEqual(1);
      if (finished.success.state === "semanticFlow") semanticPending += 1;
    }
    expect(semanticPending).toBeGreaterThan(name.length);
  }, 30_000);

  test("pins exact and one-less parser/nesting arena ceilings", () => {
    const text = "export function deep(value) {" +
      "if (value) {".repeat(100) +
      "return value;" +
      "}".repeat(100) +
      "}";
    const source = UTF8_ENCODER.encode(text);
    const execute = (
      parserStates: bigint,
      nestingDepth: bigint,
    ): Result.Result<
      DeclarativeV2VerifierModuleResultV1,
      DeclarativeV2VerifierExecutableV1Error
    > => {
      const required = budget("attempt_usage", source.byteLength, {
        calls: 10_000n,
        tokens: 1_000n,
        parserStates,
        nestingDepth,
        tokenBytes: BigInt(source.byteLength),
        stringBytes: BigInt(source.byteLength),
      });
      const created = createDeclarativeV2VerifierEngineV1({
        modulePath: artifactModulePath("functions/deep.js"),
        moduleOrdinal: 0n,
        sourceSha256: new Uint8Array(32),
        maximums: Object.freeze({
          ...required,
          kind: "command_budget",
        }) as DeclarativeV2VerifierBudgetFrameV2,
        required,
      });
      if (Result.isFailure(created)) return Result.fail(created.failure);
      for (let offset = 0; offset < source.byteLength; offset += 1_024) {
        const step = stepAll(
          created.success,
          source.subarray(offset, offset + 1_024),
        );
        if (Result.isFailure(step)) return Result.fail(step.failure);
      }
      return finishEngine(created.success);
    };
    const baseline = execute(10_000n, 10_000n);
    if (Result.isFailure(baseline)) throw baseline.failure;
    const exactParserStates = baseline.success.usage.parserStates;
    const exactNestingDepth = baseline.success.usage.nestingDepth;
    const exact = execute(exactParserStates, exactNestingDepth);
    if (Result.isFailure(exact)) throw exact.failure;
    for (const [parserStates, nestingDepth, dimension] of [
      [
        exactParserStates - 1n,
        exactNestingDepth,
        "parserStates",
      ],
      [
        exactParserStates,
        exactNestingDepth - 1n,
        "nestingDepth",
      ],
    ] as const) {
      const result = execute(parserStates, nestingDepth);
      expect(Result.isFailure(result), dimension).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("budgetExceeded");
        expect(result.failure.dimension).toBe(dimension);
      }
    }
  });

  test("balances repeated template substitutions at the exact nesting ceiling", () => {
    const source = UTF8_ENCODER.encode(
      "export function f(x, y) { return `a${x}b${y}c`; }",
    );
    const execute = (
      nestingDepth: bigint,
    ): Result.Result<
      DeclarativeV2VerifierModuleResultV1,
      DeclarativeV2VerifierExecutableV1Error
    > => {
      const required = budget("attempt_usage", source.byteLength, {
        nestingDepth,
      });
      const created = createDeclarativeV2VerifierEngineV1({
        modulePath: artifactModulePath("functions/template.js"),
        moduleOrdinal: 0n,
        sourceSha256: new Uint8Array(32),
        maximums: Object.freeze({
          ...required,
          kind: "command_budget",
        }) as DeclarativeV2VerifierBudgetFrameV2,
        required,
      });
      if (Result.isFailure(created)) return Result.fail(created.failure);
      const stepped = stepAll(created.success, source);
      if (Result.isFailure(stepped)) return Result.fail(stepped.failure);
      return finishEngine(created.success);
    };
    const baseline = execute(1_024n);
    if (Result.isFailure(baseline)) throw baseline.failure;
    const exactNestingDepth = baseline.success.usage.nestingDepth;
    const exact = execute(exactNestingDepth);
    expect(Result.isSuccess(exact)).toBe(true);
    const oneLess = execute(exactNestingDepth - 1n);
    expect(Result.isFailure(oneLess)).toBe(true);
    if (Result.isFailure(oneLess)) {
      expect(oneLess.failure.reason).toBe("budgetExceeded");
      expect(oneLess.failure.dimension).toBe("nestingDepth");
    }
  });

  test("preflights the transition allowance and consumes only admitted work", () => {
    const source = new Uint8Array(1_025);
    const required = budget("attempt_usage", source.byteLength);
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/large.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: budget("command_budget", source.byteLength),
      required,
    });
    expect(Result.isSuccess(created)).toBe(true);
    if (Result.isFailure(created)) return;
    const first = created.success.step(source, 1_024);
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isSuccess(first)) {
      expect(first.success.transitionCount).toBeLessThanOrEqual(1_024);
      expect(first.success.consumedBytes).toBeLessThanOrEqual(1_024);
    }

    const invalid = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/large.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: budget("command_budget", source.byteLength),
      required,
    });
    if (Result.isFailure(invalid)) throw invalid.failure;
    const failed = invalid.success.step(source, 1_025);
    expect(Result.isFailure(failed)).toBe(true);
    if (Result.isFailure(failed)) {
      expect(failed.failure.dimension).toBe("transitionQuantum");
    }
  });

  test("seals source input before returning from finish with zero allowance", () => {
    const source = UTF8_ENCODER.encode("export function f() {}");
    const created = createDeclarativeV2VerifierEngineV1({
      modulePath: artifactModulePath("functions/finish-zero.js"),
      moduleOrdinal: 0n,
      sourceSha256: new Uint8Array(32),
      maximums: budget("command_budget", source.byteLength),
      required: budget("attempt_usage", source.byteLength),
    });
    if (Result.isFailure(created)) throw created.failure;
    const pending = created.success.finish(0);
    expect(Result.isSuccess(pending)).toBe(true);
    if (Result.isSuccess(pending) && "status" in pending.success) {
      expect(pending.success.state).toBe("finishingLexer");
      expect(pending.success.transitionCount).toBe(0);
    }
    const lateSource = created.success.step(source, 1);
    expect(Result.isFailure(lateSource)).toBe(true);
    if (Result.isFailure(lateSource)) {
      expect(lateSource.failure.reason).toBe("closed");
    }
  });

  test("admits exact observed engine usage and rejects every used dimension one-less", () => {
    const source = UTF8_ENCODER.encode(
      'import { databaseGet } from "flarex:platform";\n' +
        "export function run() { return databaseGet(); }\n",
    );
    const baseline = runSource(source, [source]);
    expect(Result.isSuccess(baseline)).toBe(true);
    if (Result.isFailure(baseline)) return;

    const execute = (
      required: DeclarativeV2VerifierBudgetFrameV2,
    ): Result.Result<
      DeclarativeV2VerifierModuleResultV1,
      DeclarativeV2VerifierExecutableV1Error
    > => {
      const maximums = Object.freeze({
        ...baseline.success.usage,
        kind: "command_budget",
      }) as DeclarativeV2VerifierBudgetFrameV2;
      const created = createDeclarativeV2VerifierEngineV1({
        modulePath: artifactModulePath("functions/example.js"),
        moduleOrdinal: 0n,
        sourceSha256: new Uint8Array(32).fill(7),
        maximums,
        required,
      });
      if (Result.isFailure(created)) return Result.fail(created.failure);
      const stepped = stepAll(created.success, source);
      if (Result.isFailure(stepped)) return Result.fail(stepped.failure);
      return finishEngine(created.success);
    };

    const exact = execute(baseline.success.usage);
    if (Result.isFailure(exact)) throw exact.failure;
    expect(Result.isSuccess(exact)).toBe(true);
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const observed = baseline.success.usage[dimension];
      if (observed === 0n) continue;
      const oneLess = Object.freeze({
        ...baseline.success.usage,
        [dimension]: observed - 1n,
      }) as DeclarativeV2VerifierBudgetFrameV2;
      const result = execute(oneLess);
      expect(Result.isFailure(result), dimension).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason, dimension).toBe("budgetExceeded");
      }
    }
  });

  test("pins allowance zero, one, maximum, and terminal reuse receipts", () => {
    const source = UTF8_ENCODER.encode(
      "export function run(value) { return value; }\n",
    );
    const required = budget("attempt_usage", source.byteLength);
    const create = () =>
      createDeclarativeV2VerifierEngineV1({
        modulePath: artifactModulePath("functions/allowance.js"),
        moduleOrdinal: 0n,
        sourceSha256: new Uint8Array(32).fill(3),
        maximums: budget("command_budget", source.byteLength),
        required,
      });

    const zeroEngine = create();
    if (Result.isFailure(zeroEngine)) throw zeroEngine.failure;
    const zero = zeroEngine.success.step(source, 0);
    expect(Result.isSuccess(zero)).toBe(true);
    if (Result.isSuccess(zero)) {
      expect(zero.success.consumedBytes).toBe(0);
      expect(zero.success.transitionCount).toBe(0);
      expect(zero.success.deltaUsage.calls).toBe(1n);
      expect(zero.success.deltaUsage.sourceBytes).toBe(0n);
    }
    const one = zeroEngine.success.step(source, 1);
    expect(Result.isSuccess(one)).toBe(true);
    if (Result.isSuccess(one)) {
      expect(one.success.transitionCount).toBe(1);
      expect(one.success.consumedBytes).toBeLessThanOrEqual(1);
    }

    const oneEngine = create();
    if (Result.isFailure(oneEngine)) throw oneEngine.failure;
    let offset = 0;
    for (let iteration = 0; offset < source.byteLength; iteration += 1) {
      if (iteration > 1_000_000) {
        throw new Error("allowance-one step exceeded its test ceiling");
      }
      const stepped = oneEngine.success.step(source.subarray(offset), 1);
      if (Result.isFailure(stepped)) throw stepped.failure;
      expect(stepped.success.transitionCount).toBeLessThanOrEqual(1);
      offset += stepped.success.consumedBytes;
    }
    const zeroFinish = oneEngine.success.finish(0);
    expect(Result.isSuccess(zeroFinish)).toBe(true);
    if (Result.isSuccess(zeroFinish) && "status" in zeroFinish.success) {
      expect(zeroFinish.success.transitionCount).toBe(0);
      expect(zeroFinish.success.deltaUsage.calls).toBe(1n);
    }
    let oneResult: DeclarativeV2VerifierModuleResultV1 | undefined;
    for (let iteration = 0; iteration < 1_000_000; iteration += 1) {
      const finished = oneEngine.success.finish(1);
      if (Result.isFailure(finished)) throw finished.failure;
      if (!("status" in finished.success)) {
        oneResult = finished.success;
        break;
      }
      expect(finished.success.transitionCount).toBeLessThanOrEqual(1);
    }
    expect(oneResult).toBeDefined();

    const maximumEngine = create();
    if (Result.isFailure(maximumEngine)) throw maximumEngine.failure;
    const maximumStep = stepAll(maximumEngine.success, source);
    if (Result.isFailure(maximumStep)) throw maximumStep.failure;
    const maximum = finishEngine(maximumEngine.success);
    expect(Result.isSuccess(maximum)).toBe(true);
    if (Result.isSuccess(maximum) && oneResult !== undefined) {
      const { usage: _oneUsage, ...onePresentation } =
        materializeModuleResult(oneResult);
      const { usage: _maximumUsage, ...maximumPresentation } =
        materializeModuleResult(maximum.success);
      expect(onePresentation).toEqual(maximumPresentation);
    }

    const invalidEngine = create();
    if (Result.isFailure(invalidEngine)) throw invalidEngine.failure;
    const invalid = invalidEngine.success.step(source, 1_025);
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure.dimension).toBe("transitionQuantum");
    }
    expect(Result.isFailure(
      invalidEngine.success.step(source, 1),
    )).toBe(true);
  }, 30_000);

  test("keeps verifier execution independent from native whole-operation helpers", () => {
    const originalDecoder = globalThis.TextDecoder;
    const originalEncoder = globalThis.TextEncoder;
    const originalSort = Array.prototype.sort;
    const originalMap = globalThis.Map;
    const originalSet = globalThis.Set;
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "crypto",
    );
    try {
      Object.defineProperty(globalThis, "TextDecoder", {
        configurable: true,
        value: class {
          constructor() {
            throw new Error("TextDecoder authority trap");
          }
        },
      });
      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: class {
          constructor() {
            throw new Error("TextEncoder authority trap");
          }
        },
      });
      Object.defineProperty(Array.prototype, "sort", {
        configurable: true,
        value() {
          throw new Error("sort authority trap");
        },
      });
      Object.defineProperty(globalThis, "Map", {
        configurable: true,
        value: class {
          constructor() {
            throw new Error("Map authority trap");
          }
        },
      });
      Object.defineProperty(globalThis, "Set", {
        configurable: true,
        value: class {
          constructor() {
            throw new Error("Set authority trap");
          }
        },
      });
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        get() {
          throw new Error("crypto authority trap");
        },
      });
      const source = Uint8Array.of(
        ...Buffer.from(
          "export function run(value) { return value; }\n",
          "utf8",
        ),
      );
      const result = runSource(source, [source]);
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) expect(result.success.verified).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "TextDecoder", {
        configurable: true,
        value: originalDecoder,
      });
      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: originalEncoder,
      });
      Object.defineProperty(Array.prototype, "sort", {
        configurable: true,
        value: originalSort,
      });
      Object.defineProperty(globalThis, "Map", {
        configurable: true,
        value: originalMap,
      });
      Object.defineProperty(globalThis, "Set", {
        configurable: true,
        value: originalSet,
      });
      if (cryptoDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      }
    }
  });

  test("detects artifact import cycles but not acyclic order", () => {
    const cycleModules = [
      runModuleResult(
        'import { b } from "./b.js"; export function a(){ return b(); }',
        "functions/a.js",
        0n,
      ),
      runModuleResult(
        'import { a } from "./a.js"; export function b(){ return a(); }',
        "functions/b.js",
        1n,
      ),
    ];
    const linkRequired = budget("attempt_usage", 0, {
      modules: 2n,
      importEdges: 2n,
      graphNodes: 4n,
      frontierEntries: 2n,
      sourceBytes: 0n,
      objectBodyBytes: 0n,
    });
    const linkMaximums = budget("command_budget", 0, {
        modules: 2n,
        importEdges: 2n,
        graphNodes: 4n,
        frontierEntries: 2n,
        sourceBytes: 0n,
        objectBodyBytes: 0n,
    });
    const cycle = linkModuleResults(
      cycleModules,
      linkMaximums,
      linkRequired,
    );
    expect(Result.isSuccess(cycle)).toBe(true);
    if (Result.isSuccess(cycle)) {
      expect(materializeLinkResult(cycle.success).diagnostics.map(({ code }) =>
        code
      ))
        .toContain("CORE_MODULE_CYCLE");
    }
    const acyclic = linkModuleResults([
      runModuleResult(
        "export function a(){ return 1; }",
        "functions/a.js",
        0n,
      ),
      runModuleResult(
        'import { a } from "./a.js"; export function b(){ return a(); }',
        "functions/b.js",
        1n,
      ),
    ], linkMaximums, linkRequired);
    expect(Result.isSuccess(acyclic)).toBe(true);
    if (Result.isSuccess(acyclic)) {
      expect(materializeLinkResult(acyclic.success).diagnostics).toEqual([]);
      expect(acyclic.success.moduleCount).toBe(2n);
    }

    const missingExport = linkModuleResults([
      runModuleResult(
        "export function a(){ return 1; }",
        "functions/a.js",
        41n,
      ),
      runModuleResult(
        'import { missing } from "./a.js"; export function b(){ return missing(); }',
        "functions/b.js",
        9n,
      ),
    ], linkMaximums, linkRequired);
    expect(Result.isSuccess(missingExport)).toBe(true);
    if (Result.isSuccess(missingExport)) {
      expect(
        materializeLinkResult(missingExport.success).diagnostics.map(
          ({ code, moduleOrdinal }) => ({ code, moduleOrdinal }),
        ),
      )
        .toContainEqual({
          code: "CORE_IMPORT_TARGET",
          moduleOrdinal: 9n,
        });
    }

    const moduleNodeOneLess = linkModuleResults(
      cycleModules,
      budget("command_budget", 0, {
        modules: 2n,
        graphNodes: 1n,
        sourceBytes: 0n,
        objectBodyBytes: 0n,
      }),
      budget("attempt_usage", 0, {
        modules: 2n,
        graphNodes: 1n,
        sourceBytes: 0n,
        objectBodyBytes: 0n,
      }),
    );
    expect(Result.isFailure(moduleNodeOneLess)).toBe(true);
    if (Result.isFailure(moduleNodeOneLess)) {
      expect(moduleNodeOneLess.failure.reason).toBe("budgetExceeded");
      expect(moduleNodeOneLess.failure.dimension).toBe("graphNodes");
    }
  });

  test("links only opaque completed module handles and meters every quantum", () => {
    const required = budget("attempt_usage", 0, {
      modules: 1n,
      graphNodes: 1n,
      sourceBytes: 0n,
      objectBodyBytes: 0n,
    });
    const maximums = Object.freeze({
      ...required,
      kind: "command_budget",
    }) as DeclarativeV2VerifierBudgetFrameV2;
    const created = createDeclarativeV2VerifierLinkerV1(maximums, required);
    expect(Result.isSuccess(created)).toBe(true);
    if (Result.isFailure(created)) return;
    const forged = appendDeclarativeV2VerifierLinkerModuleV1(
      created.success,
      Object.freeze({
        _tag: "DeclarativeV2VerifierModuleResultV1",
        verified: true,
        moduleOrdinal: 0n,
        importCount: 0n,
        exportCount: 0n,
        functionCount: 0n,
        callCount: 0n,
        valueFlowCount: 0n,
        diagnosticCount: 0n,
        usage: required,
      }),
    );
    expect(Result.isFailure(forged)).toBe(true);
    if (Result.isFailure(forged)) {
      expect(forged.failure.operation).toBe("link");
      expect(forged.failure.reason).toBe("invalidInput");
    }

    const module = runModuleResult(
      "export function a(){ return 1; }",
      "functions/a.js",
      0n,
    );
    for (const allowance of [0, 1, 1_024] as const) {
      const linked = linkModuleResults(
        [module],
        maximums,
        required,
        allowance,
      );
      expect(Result.isSuccess(linked), `allowance ${allowance}`).toBe(true);
      if (Result.isSuccess(linked)) {
        expect(materializeLinkResult(linked.success).moduleOrder).toEqual([
          "functions/a.js",
        ]);
      }
    }
    const excessive = createDeclarativeV2VerifierLinkerV1(
      maximums,
      required,
    );
    expect(Result.isSuccess(excessive)).toBe(true);
    if (Result.isSuccess(excessive)) {
      expect(
        appendDeclarativeV2VerifierLinkerModuleV1(excessive.success, module),
      ).toEqual(Result.succeed(undefined));
      const invalidAllowance = finishDeclarativeV2VerifierLinkerV1(
        excessive.success,
        1_025,
      );
      expect(Result.isFailure(invalidAllowance)).toBe(true);
      if (Result.isFailure(invalidAllowance)) {
        expect(invalidAllowance.failure.reason).toBe("invalidInput");
      }
    }
  });

  test("keeps the executable owner on the existing internal subpath", async () => {
    const root = await import("@flarex/analysis");
    expect("createDeclarativeV2VerifierEngineV1" in root).toBe(false);
    const internal = await import(
      "@flarex/analysis/internal/declarative-v2-verifier-v1"
    );
    expect(internal.createDeclarativeV2VerifierEngineV1).toBeTypeOf("function");
    expect(
      "makeDeclarativeV2VerifierExecutableRestartBridgeV1" in internal,
    ).toBe(false);
    const loaded = loadGeneratedDeclarativeV2VerifierExecutableAssetV1(
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetByteLength,
    );
    expect(Result.isSuccess(loaded)).toBe(true);
  }, 30_000);
});
