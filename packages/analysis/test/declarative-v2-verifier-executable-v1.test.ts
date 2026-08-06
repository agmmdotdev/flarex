import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { isUint8Array } from "@flarex/utils/bytes";
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
  DECLARATIVE_V2_CONTEXT_MEMBER_ABI_LOWERINGS_V1,
  DECLARATIVE_V2_NUMBER_TRANSITIONS_V1,
  DECLARATIVE_V2_PARSER_PRODUCTIONS_V1,
  DECLARATIVE_V2_TEMPLATE_TRANSITIONS_V1,
  DECLARATIVE_V2_UTF8_TRANSITIONS_V1,
} from "../src/declarativeV2VerifierExecutableV1.contract";
import {
  appendDeclarativeV2VerifierLinkerModuleV1,
  createDeclarativeV2VerifierLinkerV1,
  createDeclarativeV2VerifierEngineV1,
  declarativeV2VerifierCompletedLinkClaimPortV1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_V1_TEST_ONLY,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_CONTRACT_V1,
  DeclarativeV2VerifierExecutableV1Error,
  finishDeclarativeV2VerifierLinkerV1,
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
  loadDeclarativeV2VerifierExecutableAssetV1,
  loadGeneratedDeclarativeV2VerifierExecutableAssetV1,
  makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1,
  makeDeclarativeV2VerifierExecutableRestartBridgeV1,
  makeDeclarativeV2VerifierResultAccessFactoryV1,
  stepDeclarativeV2VerifierLinkerV1,
  type DeclarativeV2VerifierAuthenticatedLinkBindingsV1,
  type DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
  type DeclarativeV2VerifierLinkCapacityV1,
  type DeclarativeV2VerifierEngineV1,
  type DeclarativeV2VerifierLinkResultV1,
  type DeclarativeV2VerifierModuleResultV1,
  type DeclarativeV2VerifierModulePresentationV1,
} from "../src/declarativeV2VerifierExecutableV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_ASSET_BASE64_V1,
} from "../src/declarativeV2VerifierExecutableV1.generated";
import {
  initialDeclarativeV2VerifierRestartSequenceStateV1,
  type DeclarativeV2VerifierRestartRecordV1,
  validateDeclarativeV2VerifierRestartRecordSequenceV1,
} from "../src/declarativeV2VerifierRestartEvidenceV1";
import {
  closeDeclarativeV2VerifierParseCapacityV1,
  driveDeclarativeV2VerifierParseModuleTerminalV1,
  planDeclarativeV2VerifierParseCapacityV1,
  planDeclarativeV2VerifierSha256WorkV1,
  type DeclarativeV2VerifierParseCapacityBindingsV1,
} from "../src/declarativeV2VerifierSizingV1";
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
  test.each([
    [
      "concise arrow",
      "export function f(){return x=>x;}",
      "CORE_SYNTAX",
      "619ef22ab56fce1149f83b2678fb868744adfe0adf7c544c9aa7885d1fa0b62e",
    ],
    [
      "block arrow",
      "export function f(){return x=>{return x;};}",
      "CORE_SYNTAX",
      "ad608fa20a37457f0c9d24ef6d713c9f4ddbdf326c3e1d8dad3f9dc0fe63e066",
    ],
    [
      "new expression",
      "export function f(){return new Error();}",
      "CORE_CONSTRUCTION",
      "c9f6be2ea35dee2f252c5a156d5741942ec1675d5770b2166119a8d193b8b6cc",
    ],
  ])(
    "retains parser-owned rejection terminals for %s bodies",
    (_label, source, diagnostic, expectedBodySha256) => {
      const sourceBytes = UTF8_ENCODER.encode(source);
      const presented = Result.getOrThrow(runSource(sourceBytes, [sourceBytes]));
      expect(presented.verified).toBe(false);
      expect(presented.diagnostics.map(item => item.code)).toContain(diagnostic);
      const module = runModuleResult(
        source,
        "functions/restart-terminal.js",
        6n,
      );
      const bridge = makeDeclarativeV2VerifierExecutableRestartBridgeV1();
      const opened = Result.getOrThrow(bridge.openModuleRecords(
        module,
        new Uint8Array(32).fill(8),
        budget("command_budget", sourceBytes.byteLength),
      ));
      const records = [];
      for (let iteration = 0; iteration < 10_000; iteration += 1) {
        const read = Result.getOrThrow(bridge.readModuleRecord(opened, 1));
        if (read.status === "complete") break;
        if (read.status === "item") records.push(read.record);
      }
      const functionRecord = records.find(record => record.kind === "function_v1");
      expect(functionRecord).toMatchObject({
        kind: "function_v1",
        moduleOrdinal: 6n,
        functionName: "f",
      });
      if (functionRecord?.kind !== "function_v1") {
        throw new Error("missing rejected restart function record");
      }
      expect(Buffer.from(functionRecord.bodySha256).toString("hex"))
        .toBe(expectedBodySha256);

      const builder = Result.getOrThrow(bridge.createModuleBuilder(
        budget("command_budget", sourceBytes.byteLength),
        budget("attempt_usage", sourceBytes.byteLength),
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
      if (cold === undefined) {
        throw new Error("rejected cold module builder did not finish");
      }
      expect(cold.evidenceSha256).toBe(module.evidenceSha256);
    },
  );

  test("preserves construction diagnostics after direct-call records", () => {
    const source =
      "export async function patch(ctx, { id }) { " +
      'await ctx.db.patch(id, { title: "staged" }); ' +
      'throw new Error("injected"); }';
    const sourceBytes = UTF8_ENCODER.encode(source);
    const presented = Result.getOrThrow(runSource(sourceBytes, [sourceBytes]));
    expect(presented.verified).toBe(false);
    expect(presented.diagnostics.map(item => item.code)).toContain(
      "CORE_CONSTRUCTION",
    );
    const module = runModuleResult(
      source,
      "functions/direct-call-then-construction.js",
      9n,
    );
    const bridge = makeDeclarativeV2VerifierExecutableRestartBridgeV1();
    const opened = Result.getOrThrow(bridge.openModuleRecords(
      module,
      new Uint8Array(32).fill(7),
      budget("command_budget", sourceBytes.byteLength),
    ));
    const records: DeclarativeV2VerifierRestartRecordV1[] = [];
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      const read = Result.getOrThrow(bridge.readModuleRecord(opened, 1));
      if (read.status === "complete") break;
      if (read.status === "item") records.push(read.record);
    }
    expect(records.map(record => record.kind)).toEqual([
      "module_identity_v1",
      "export_binding_v1",
      "function_v1",
      "direct_call_v1",
      "value_flow_v1",
      "diagnostic_v1",
      "diagnostic_v1",
      "diagnostic_v1",
      "parse_terminal_v1",
    ]);
    expect(records.filter(record => record.kind === "diagnostic_v1").map(
      record => ({ phase: record.phase, code: record.code }),
    )).toEqual([
      { phase: "parse", code: "CORE_SYNTAX" },
      { phase: "parse", code: "CORE_CONSTRUCTION" },
      { phase: "link", code: "CORE_CALL_TARGET" },
    ]);
    let sequence = Result.getOrThrow(
      initialDeclarativeV2VerifierRestartSequenceStateV1("parse_module"),
    );
    for (const record of records) {
      const sequencedRecord = record.kind === "parse_terminal_v1"
        ? Object.freeze({
          ...record,
          precedingRecordsRootSha256: new Uint8Array(
            sequence.precedingRecordsRootSha256,
          ),
        })
        : record;
      sequence = Result.getOrThrow(
        validateDeclarativeV2VerifierRestartRecordSequenceV1(
          sequence,
          sequencedRecord,
          new Uint8Array(32).fill(Number(record.recordOrdinal & 0xffn)),
        ),
      );
    }
    expect(sequence).toMatchObject({
      terminal: true,
      callCount: 1n,
      valueFlowCount: 1n,
      diagnosticCount: 3n,
    });
    const builder = Result.getOrThrow(bridge.createModuleBuilder(
      budget("command_budget", sourceBytes.byteLength),
      budget("attempt_usage", sourceBytes.byteLength),
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
    if (cold === undefined) {
      throw new Error("diagnostic-bearing cold module builder did not finish");
    }
    expect(cold.evidenceSha256).toBe(module.evidenceSha256);
  });

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

  test("records call and value-flow owners by stable function ordinal", () => {
    const source =
      "async function helper(ctx,id){return await ctx.db.get(id)}" +
      'export async function getThing(ctx){return await helper(ctx,"recipes:1")}';
    const sourceBytes = UTF8_ENCODER.encode(source);
    const module = runModuleResult(
      source,
      "functions/restart-context-owners.js",
      10n,
    );
    const bridge = makeDeclarativeV2VerifierExecutableRestartBridgeV1();
    const opened = Result.getOrThrow(bridge.openModuleRecords(
      module,
      new Uint8Array(32).fill(10),
      budget("command_budget", sourceBytes.byteLength),
    ));
    const records: DeclarativeV2VerifierRestartRecordV1[] = [];
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      const read = Result.getOrThrow(bridge.readModuleRecord(opened, 1_024));
      if (read.status === "complete") break;
      if (read.status === "item") records.push(read.record);
    }
    expect(records.filter(record => record.kind === "function_v1")).toEqual([
      expect.objectContaining({ functionName: "getThing", functionOrdinal: 0n }),
      expect.objectContaining({ functionName: "helper", functionOrdinal: 1n }),
    ]);
    expect(records.filter(record => record.kind === "direct_call_v1")).toEqual([
      expect.objectContaining({
        callerFunctionOrdinal: 1n,
        targetKind: "abi",
        targetName: "get",
      }),
      expect.objectContaining({
        callerFunctionOrdinal: 0n,
        targetKind: "local",
        targetName: "helper",
      }),
    ]);
    expect(records.filter(record => record.kind === "value_flow_v1")).toEqual([
      expect.objectContaining({
        flowOrdinal: 0n,
        functionOrdinal: 1n,
        operationName: "databaseGet",
      }),
    ]);
  });

  test("restarts exact point-writer context members as their existing ABI operations", () => {
    const source =
      "export async function mutate(ctx,id,value){" +
      "await ctx.db.patch(id,value);" +
      "await ctx.db.replace(id,value);" +
      "return await ctx.db.delete(id)}";
    const sourceBytes = UTF8_ENCODER.encode(source);
    const module = runModuleResult(
      source,
      "functions/restart-context-writers.js",
      11n,
    );
    const bridge = makeDeclarativeV2VerifierExecutableRestartBridgeV1();
    const opened = Result.getOrThrow(bridge.openModuleRecords(
      module,
      new Uint8Array(32).fill(11),
      budget("command_budget", sourceBytes.byteLength),
    ));
    const records: DeclarativeV2VerifierRestartRecordV1[] = [];
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      const read = Result.getOrThrow(bridge.readModuleRecord(opened, 1_024));
      if (read.status === "complete") break;
      if (read.status === "item") records.push(read.record);
    }
    expect(records.filter(record => record.kind === "direct_call_v1")).toEqual([
      expect.objectContaining({ targetKind: "abi", targetName: "patch" }),
      expect.objectContaining({ targetKind: "abi", targetName: "replace" }),
      expect.objectContaining({ targetKind: "abi", targetName: "delete" }),
    ]);
    expect(records.filter(record => record.kind === "value_flow_v1")).toEqual([
      expect.objectContaining({
        flowOrdinal: 0n,
        operationName: "databasePatch",
      }),
      expect.objectContaining({
        flowOrdinal: 1n,
        operationName: "databaseReplace",
      }),
      expect.objectContaining({
        flowOrdinal: 2n,
        operationName: "databaseDelete",
      }),
    ]);
  });

  test("restarts exact nested-context members as their existing ABI operations", () => {
    const source =
      "export async function invoke(ctx,args){" +
      'const value=await ctx.runQuery({_path:"orders:readInternal"},args);' +
      'return await ctx.runMutation({_path:"orders:mutateInternal"},{value})}';
    const sourceBytes = UTF8_ENCODER.encode(source);
    const module = runModuleResult(
      source,
      "functions/restart-context-internal-calls.js",
      12n,
    );
    const bridge = makeDeclarativeV2VerifierExecutableRestartBridgeV1();
    const opened = Result.getOrThrow(bridge.openModuleRecords(
      module,
      new Uint8Array(32).fill(12),
      budget("command_budget", sourceBytes.byteLength),
    ));
    const records: DeclarativeV2VerifierRestartRecordV1[] = [];
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      const read = Result.getOrThrow(bridge.readModuleRecord(opened, 1_024));
      if (read.status === "complete") break;
      if (read.status === "item") records.push(read.record);
    }
    expect(records.filter(record => record.kind === "direct_call_v1")).toEqual([
      expect.objectContaining({ targetKind: "abi", targetName: "runQuery" }),
      expect.objectContaining({ targetKind: "abi", targetName: "runMutation" }),
    ]);
    expect(records.filter(record => record.kind === "value_flow_v1")).toEqual([
      expect.objectContaining({
        flowOrdinal: 0n,
        operationName: "runQuery",
      }),
      expect.objectContaining({
        flowOrdinal: 1n,
        operationName: "runMutation",
      }),
    ]);
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

function reconstructColdModuleResult(
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
  throw new Error("cold link module reconstruction exceeded test guard");
}

interface ParseOracleFacts {
  readonly driverCalls: bigint;
  readonly modulePathByteLength: bigint;
  readonly tokenCount: bigint;
  readonly tokenByteLength: bigint;
  readonly peakParserStates: bigint;
  readonly peakNestingDepth: bigint;
  readonly retainedStringByteLength: bigint;
  readonly importDeclarationCount: bigint;
  readonly callCount: bigint;
  readonly exportCount: bigint;
  readonly functionCount: bigint;
  readonly valueFlowCount: bigint;
  readonly diagnosticCount: bigint;
  readonly diagnosticTextByteLength: bigint;
  readonly semanticOutputByteLength: bigint;
  readonly evidenceCanonicalByteLength: bigint;
  readonly maximumEvidenceFrameByteLength: bigint;
}

interface ParseExecutionTrace {
  readonly driverCalls: bigint;
  readonly result: DeclarativeV2VerifierModuleResultV1;
  readonly presentation: DeclarativeV2VerifierModulePresentationV1;
}

function parseSizingBindings(
  seed = 31,
): DeclarativeV2VerifierParseCapacityBindingsV1 {
  return Object.freeze({
    candidateSha256: new Uint8Array(32).fill(seed),
    authenticatedInputSha256: new Uint8Array(32).fill(seed + 1),
    rangeAndPredecessorTailsSha256: new Uint8Array(32).fill(seed + 2),
    analyzerIdentitySha256: new Uint8Array(32).fill(seed + 3),
    verifierIdentitySha256: new Uint8Array(32).fill(seed + 4),
  });
}

function parseCommandBudget(): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind: "command_budget",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
        dimension,
        dimension === "sourceMapBytes" ||
            dimension === "semanticBytes" ||
            dimension === "schemaNodes" ||
            dimension === "validatorNodes" ||
            dimension === "elapsedMilliseconds"
          ? 0n
          : 9_223_372_036_854_775_807n,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function runParseExecutionTrace(
  source: Uint8Array,
  modulePath: string,
  allowance: number,
  required = budget("attempt_usage", source.byteLength),
): ParseExecutionTrace {
  const created = createDeclarativeV2VerifierEngineV1({
    modulePath: artifactModulePath(modulePath),
    moduleOrdinal: 0n,
    sourceSha256: new Uint8Array(32).fill(23),
    maximums: budget("command_budget", source.byteLength),
    required,
  });
  if (Result.isFailure(created)) throw created.failure;
  let driverCalls = 1n;
  let offset = 0;
  for (let guard = 0; offset < source.byteLength; guard += 1) {
    if (guard > 1_000_000) {
      throw new Error("parse sizing oracle exceeded its source-call bound");
    }
    const stepped = created.success.step(source.subarray(offset), allowance);
    driverCalls += 1n;
    if (Result.isFailure(stepped)) throw stepped.failure;
    offset += stepped.success.consumedBytes;
  }
  let result: DeclarativeV2VerifierModuleResultV1 | undefined;
  for (let guard = 0; result === undefined; guard += 1) {
    if (guard > 1_000_000) {
      throw new Error("parse sizing oracle exceeded its finish-call bound");
    }
    const finished = created.success.finish(allowance);
    driverCalls += 1n;
    if (Result.isFailure(finished)) throw finished.failure;
    if (!("status" in finished.success)) result = finished.success;
  }
  const presentation = materializeModuleResult(result);
  return Object.freeze({ driverCalls, result, presentation });
}

function parseFactsFromTrace(
  trace: ParseExecutionTrace,
  modulePath: string,
): ParseOracleFacts {
  const evidence = [
    trace.presentation.moduleSummary,
    ...trace.presentation.importCalls,
    ...trace.presentation.valueFlows,
    ...trace.presentation.diagnostics,
  ].map(encodeEvidenceOracle);
  const evidenceCanonicalByteLength = evidence.reduce(
    (total, bytes) => total + BigInt(bytes.byteLength),
    0n,
  );
  const maximumEvidenceFrameByteLength = evidence.reduce(
    (maximum, bytes) =>
      BigInt(bytes.byteLength) > maximum
        ? BigInt(bytes.byteLength)
        : maximum,
    0n,
  );
  const pathBytes = BigInt(UTF8_ENCODER.encode(modulePath).byteLength);
  const usage = trace.result.usage;
  const sha256 = planDeclarativeV2VerifierSha256WorkV1(
    evidenceCanonicalByteLength,
  );
  if (Result.isFailure(sha256)) throw sha256.failure;
  expect(usage.calls).toBe(trace.driverCalls + sha256.success.calls);
  expect(usage.canonicalBytes).toBe(evidenceCanonicalByteLength);
  expect(usage.frameBytes).toBe(evidenceCanonicalByteLength);
  expect(usage.hashBytes).toBe(evidenceCanonicalByteLength);
  return Object.freeze({
    driverCalls: trace.driverCalls,
    modulePathByteLength: pathBytes,
    tokenCount: usage.tokens,
    tokenByteLength: usage.tokenBytes,
    peakParserStates: usage.parserStates,
    peakNestingDepth: usage.nestingDepth,
    retainedStringByteLength: usage.stringBytes,
    importDeclarationCount: trace.result.importCount,
    callCount: trace.result.callCount,
    exportCount: trace.result.exportCount,
    functionCount: trace.result.functionCount,
    valueFlowCount: trace.result.valueFlowCount,
    diagnosticCount: trace.result.diagnosticCount,
    diagnosticTextByteLength: usage.diagnosticBytes,
    semanticOutputByteLength: usage.outputBytes - pathBytes,
    evidenceCanonicalByteLength,
    maximumEvidenceFrameByteLength,
  });
}

function runExactlySizedParse(
  source: Uint8Array,
  modulePath: string,
  allowance: number,
): Readonly<{
  readonly oracle: ParseExecutionTrace;
  readonly exact: DeclarativeV2VerifierModuleResultV1;
  readonly capacity: DeclarativeV2VerifierBudgetFrameV2;
}> {
  const oracle = runParseExecutionTrace(source, modulePath, allowance);
  parseFactsFromTrace(oracle, modulePath);
  const bound = parseSizingBindings();
  const modulePathHandle = artifactModulePath(modulePath);
  const sourceSha256 = new Uint8Array(32).fill(23);
  const planned = planDeclarativeV2VerifierParseCapacityV1({
    bindings: bound,
    commandKind: "parse_module",
    sequence: 1n,
    moduleOrdinal: 0n,
    modulePath: modulePathHandle,
    source,
    sourceSha256,
    commandBudget: parseCommandBudget(),
  }, bound);
  if (Result.isFailure(planned)) throw planned.failure;
  const driven = driveDeclarativeV2VerifierParseModuleTerminalV1(
    planned.success.claim,
    allowance,
  );
  if (Result.isFailure(driven)) throw driven.failure;
  expect(driven.success.driverCalls).toBe(oracle.driverCalls);
  expect(driven.success.result.usage).toEqual(oracle.result.usage);
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    expect(driven.success.result.usage[dimension]).toBeLessThanOrEqual(
      planned.success.capacity[dimension],
    );
  }
  return Object.freeze({
    oracle,
    exact: driven.success.result,
    capacity: planned.success.capacity,
  });
}

describe("private parse capacity and V1 terminal driver", () => {
  test("admits exact owner facts across lexical, parser, semantic, and diagnostic vectors", () => {
    const vectors = [
      UTF8_ENCODER.encode(""),
      Uint8Array.of(0x00),
      Uint8Array.of(0x01),
      UTF8_ENCODER.encode("\t\r\nexport function whitespace() {}"),
      UTF8_ENCODER.encode("export const decimal = 1.25e+2;"),
      UTF8_ENCODER.encode("export const integer = 1n;"),
      UTF8_ENCODER.encode(
        "export function identifier_$() { return \"value\\u0021\"; }",
      ),
      UTF8_ENCODER.encode(
        "export function punctuators(a, b) { " +
          "return (a + b) * (a - b) / 2 % 1 >= 0 && a !== b ? a : b; }",
      ),
      UTF8_ENCODER.encode("export function regexp() { return /x+/gi; }"),
      UTF8_ENCODER.encode(
        "export function unicode(café) { return café; }",
      ),
      UTF8_ENCODER.encode(
        'import { read as get } from "./dep.js"; ' +
          "export async function ready(value) { const local = value; " +
          "get(); return local; }",
      ),
      UTF8_ENCODER.encode(
        "/* comment */ export default function demo() { " +
          "return `value:${1}` / 2; }",
      ),
      UTF8_ENCODER.encode(
        "export function deep() { return ((([[[1]]]))); }",
      ),
      UTF8_ENCODER.encode("export const broken = 'unterminated"),
      Uint8Array.of(0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20, 0xff),
    ] as const;
    for (let index = 0; index < vectors.length; index += 1) {
      const run = runExactlySizedParse(
        vectors[index]!,
        `a${index}.js`,
        1_024,
      );
      expect(run.exact).toMatchObject({
        evidenceSha256: run.oracle.result.evidenceSha256,
        verified: run.oracle.result.verified,
        importCount: run.oracle.result.importCount,
        exportCount: run.oracle.result.exportCount,
        functionCount: run.oracle.result.functionCount,
        callCount: run.oracle.result.callCount,
        valueFlowCount: run.oracle.result.valueFlowCount,
        diagnosticCount: run.oracle.result.diagnosticCount,
      });
    }
  });

  test("produces equal terminal semantics for allowance one and 1,024", () => {
    const source = UTF8_ENCODER.encode(
      'import { read } from "./dep.js"; ' +
        "export function ready() { return read(); }",
    );
    const one = runExactlySizedParse(source, "functions/quantum.js", 1);
    const maximum = runExactlySizedParse(
      source,
      "functions/quantum.js",
      1_024,
    );
    expect(one.exact).toMatchObject({
      verified: maximum.exact.verified,
      importCount: maximum.exact.importCount,
      exportCount: maximum.exact.exportCount,
      functionCount: maximum.exact.functionCount,
      callCount: maximum.exact.callCount,
      valueFlowCount: maximum.exact.valueFlowCount,
      diagnosticCount: maximum.exact.diagnosticCount,
      evidenceSha256: maximum.exact.evidenceSha256,
    });
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      if (dimension === "calls") continue;
      expect(one.exact.usage[dimension]).toBe(
        maximum.exact.usage[dimension],
      );
      expect(one.capacity[dimension]).toBe(maximum.capacity[dimension]);
    }
    expect(one.capacity.calls).toBe(maximum.capacity.calls);
    expect(one.exact.usage.calls).not.toBe(maximum.exact.usage.calls);
  });

  test("executes the selected domain boundary within every derived capacity", () => {
    const modulePath = "a.js";
    const sourceByteLength = 128 - UTF8_ENCODER.encode(modulePath).byteLength;
    const prefix = "export const value=1;/*";
    const suffix = "*/";
    const source = UTF8_ENCODER.encode(
      `${prefix}${
        "x".repeat(sourceByteLength - prefix.length - suffix.length)
      }${suffix}`,
    );
    expect(source.byteLength).toBe(sourceByteLength);
    const boundary = runExactlySizedParse(source, modulePath, 1_024);
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      expect(boundary.exact.usage[dimension], dimension).toBeLessThanOrEqual(
        boundary.capacity[dimension],
      );
    }
  });

  test("rejects terminal-driver allowances outside the V1 quantum", () => {
    const source = UTF8_ENCODER.encode("export const value = 1;");
    const bound = parseSizingBindings();
    const planned = planDeclarativeV2VerifierParseCapacityV1({
      bindings: bound,
      commandKind: "parse_module",
      sequence: 1n,
      moduleOrdinal: 0n,
      modulePath: artifactModulePath("functions/schedule.js"),
      source,
      sourceSha256: new Uint8Array(32).fill(23),
      commandBudget: parseCommandBudget(),
    }, bound);
    if (Result.isFailure(planned)) throw planned.failure;
    const invalid = driveDeclarativeV2VerifierParseModuleTerminalV1(
      planned.success.claim,
      1_025,
    );
    expect(invalid).toMatchObject({
      failure: {
        operation: "drive",
        reason: "invalidInput",
        path: "allowance",
      },
    });
    expect(driveDeclarativeV2VerifierParseModuleTerminalV1(
      planned.success.claim,
      1,
    )).toMatchObject({
      failure: {
        operation: "drive",
        reason: "invalidInput",
        path: "claim",
      },
    });
    expect(closeDeclarativeV2VerifierParseCapacityV1(
      planned.success.claim,
    )).toMatchObject({
      failure: {
        operation: "drive",
        reason: "invalidInput",
        path: "claim",
      },
    });
  });

  test("binds one parse claim to owned source bytes and lifecycle", () => {
    const source = UTF8_ENCODER.encode("export const value = 1;");
    const expectedEvidenceSha256 = runParseExecutionTrace(
      source,
      "a.js",
      1,
    ).result.evidenceSha256;
    const bound = parseSizingBindings();
    const planned = planDeclarativeV2VerifierParseCapacityV1({
      bindings: bound,
      commandKind: "parse_module",
      sequence: 1n,
      moduleOrdinal: 0n,
      modulePath: artifactModulePath("a.js"),
      source,
      sourceSha256: new Uint8Array(32).fill(23),
      commandBudget: parseCommandBudget(),
    }, bound);
    if (Result.isFailure(planned)) throw planned.failure;
    source.fill(0);
    expect(driveDeclarativeV2VerifierParseModuleTerminalV1(
      planned.success.claim,
      1,
    )).toMatchObject({
      success: { result: { evidenceSha256: expectedEvidenceSha256 } },
    });
    expect(closeDeclarativeV2VerifierParseCapacityV1(
      planned.success.claim,
    )).toMatchObject({
      failure: {
        operation: "drive",
        reason: "invalidInput",
        path: "claim",
      },
    });

    const closable = planDeclarativeV2VerifierParseCapacityV1({
      bindings: bound,
      commandKind: "parse_module",
      sequence: 2n,
      moduleOrdinal: 0n,
      modulePath: artifactModulePath("b.js"),
      source: UTF8_ENCODER.encode("export const value = 1;"),
      sourceSha256: new Uint8Array(32).fill(32),
      commandBudget: parseCommandBudget(),
    }, bound);
    if (Result.isFailure(closable)) throw closable.failure;
    expect(closeDeclarativeV2VerifierParseCapacityV1(
      closable.success.claim,
    )).toEqual(Result.succeed(undefined));
    expect(closeDeclarativeV2VerifierParseCapacityV1(
      closable.success.claim,
    )).toMatchObject({
      failure: {
        operation: "drive",
        reason: "invalidInput",
        path: "claim",
      },
    });
    expect(closeDeclarativeV2VerifierParseCapacityV1(Object.freeze({
      _tag: "DeclarativeV2VerifierParseCapacityClaimV1",
    }))).toMatchObject({
      failure: {
        operation: "drive",
        reason: "invalidInput",
        path: "claim",
      },
    });
  });
});

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

function authenticatedLinkBindings(
  seed = 61,
): DeclarativeV2VerifierAuthenticatedLinkBindingsV1 {
  return Object.freeze({
    attemptSha256: new Uint8Array(32).fill(seed),
    futureRegistrationIntentSha256:
      new Uint8Array(32).fill(seed + 1),
    candidateSha256: new Uint8Array(32).fill(seed + 2),
    authenticatedInputSha256: new Uint8Array(32).fill(seed + 3),
    linkSequence: 7n,
    parsePagesRootSha256: new Uint8Array(32).fill(seed + 4),
    currentProgressSha256: new Uint8Array(32).fill(seed + 5),
    predecessorAndTailsSha256: new Uint8Array(32).fill(seed + 6),
    rangeSha256: new Uint8Array(32).fill(seed + 7),
    analyzerReleaseSha256: new Uint8Array(32).fill(seed + 8),
    analyzerIdentitySha256: new Uint8Array(32).fill(seed + 9),
    verifierIdentitySha256: new Uint8Array(32).fill(seed + 10),
  });
}

function crossRealmSharedDigest(): Uint8Array {
  const value = runInNewContext(
    "new Uint8Array(new SharedArrayBuffer(32))",
  );
  if (!isUint8Array(value)) {
    throw new Error("Cross-realm fixture did not produce a Uint8Array.");
  }
  return value;
}

function authenticatedLinkClaim(
  module: DeclarativeV2VerifierModuleResultV1,
  bindings: DeclarativeV2VerifierAuthenticatedLinkBindingsV1,
): DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1 {
  return Object.freeze({
    ...bindings,
    moduleOrdinal: module.moduleOrdinal,
    producingParseResultSha256: new Uint8Array(
      Buffer.from(module.evidenceSha256, "hex"),
    ),
  });
}

interface AuthenticatedLinkTraceV1 {
  readonly factory: ReturnType<
    typeof makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1
  >;
  readonly bindings: DeclarativeV2VerifierAuthenticatedLinkBindingsV1;
  readonly capacity: DeclarativeV2VerifierLinkCapacityV1;
  readonly result: DeclarativeV2VerifierLinkResultV1;
  readonly zeroReceipts: ReadonlyArray<unknown>;
}

function runAuthenticatedLink(
  modules: ReadonlyArray<DeclarativeV2VerifierModuleResultV1>,
  allowance: 1 | 1024,
  commandBudget = budget("command_budget", 0, {
    modules: BigInt(modules.length),
    sourceBytes: 0n,
    objectBodyBytes: 0n,
  }),
  mutateClaim?: (
    claim: DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
    index: number,
  ) => DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
): Result.Result<
  AuthenticatedLinkTraceV1,
  DeclarativeV2VerifierExecutableV1Error
> {
  const bindings = authenticatedLinkBindings();
  const claims = new Map<
    DeclarativeV2VerifierModuleResultV1,
    DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1
  >();
  modules.forEach((module, index) => {
    const claim = authenticatedLinkClaim(module, bindings);
    claims.set(module, mutateClaim?.(claim, index) ?? claim);
  });
  const factory = makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
    claim: module => {
      const claim = claims.get(module);
      return claim === undefined
        ? Result.fail(new DeclarativeV2VerifierExecutableV1Error({
          operation: "link",
          reason: "invalidInput",
        }))
        : Result.succeed(claim);
    },
  });
  const created = factory.create(bindings, commandBudget);
  if (Result.isFailure(created)) return Result.fail(created.failure);
  const zeroReceipts: unknown[] = [
    Result.getOrThrow(factory.admit(created.success, modules[0], 0)),
    Result.getOrThrow(factory.seal(created.success, 0)),
  ];
  for (const module of modules) {
    for (let guard = 0; guard < 1_000_000; guard += 1) {
      const admitted = factory.admit(created.success, module, allowance);
      if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
      if (admitted.success.status === "ready") break;
      if (guard === 999_999) {
        throw new Error("authenticated link admission exceeded test guard");
      }
    }
  }
  const sealed = factory.seal(created.success, allowance);
  if (Result.isFailure(sealed)) return Result.fail(sealed.failure);
  if (sealed.success.status !== "complete") {
    throw new Error("positive authenticated link seal did not complete");
  }
  zeroReceipts.push(Result.getOrThrow(factory.step(sealed.success.driver, 0)));
  for (let guard = 0; guard < 1_000_000; guard += 1) {
    const driven = factory.step(sealed.success.driver, allowance);
    if (Result.isFailure(driven)) return Result.fail(driven.failure);
    if (!("status" in driven.success)) {
      return Result.succeed(Object.freeze({
        factory,
        bindings,
        capacity: sealed.success.capacity,
        result: driven.success,
        zeroReceipts: Object.freeze(zeroReceipts),
      }));
    }
  }
  throw new Error("authenticated link driver exceeded test guard");
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
        "f47121d2875efb784275e3c09088ff5e66bc2e5b3c472698584c078e1720b943",
      assetByteLength: 4_859_064,
      contractSha256:
        "89fff36b6aa0a391b51b861861a0bc608905a5ae37ac14c9f9d14a433d992a77",
      manifestIdentity:
        "ee51afba0ec384365e7e6021c9be0e1d992929f4e25def533a45e71ac35457d5",
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
      productions: 226,
      rhsSymbols: 493,
      items: 156_138,
      states: 4_950,
      actions: 93_662,
      shifts: 32_087,
      reductions: 61_574,
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
    "function helper(value) { return value; }",
    "export async function getThing(ctx, { id }) {",
    "  return await ctx.db.get(helper(id));",
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
        `export async function manyReads(ctx) { ${calls.replaceAll("databaseGet", "ctx.db.get")} return null; }`,
      ].join("\n"));
      const result = runSource(source, [source]);
      if (Result.isFailure(result)) throw result.failure;
      expect(result.success.valueFlows).toHaveLength(count);
      return result.success.usage.calls;
    };
    const thirtyTwo = callsFor(32);
    const sixtyFour = callsFor(64);
    expect(sixtyFour * 100n).toBeLessThan(thirtyTwo * 201n);
  });

  test("reports undersized evidence-index storage as typed frame exhaustion", () => {
    const source = UTF8_ENCODER.encode([
      "export async function read(ctx) { return ctx.db.get(\"id\"); }",
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
      "auth lookup",
      "runtime.auth.getUserIdentity()",
      "getUserIdentity",
      "authGetUserIdentity",
      "auth",
      "host",
    ],
    [
      "database read",
      "runtime.db.get(id)",
      "get",
      "databaseGet",
      "databaseRead",
      "mixed",
    ],
    [
      "database write",
      'runtime.db.insert("recipes", value)',
      "insert",
      "databaseInsert",
      "databaseWrite",
      "mixed",
    ],
    [
      "database patch",
      "runtime.db.patch(value, { nested: [value, { ready: true }] },)",
      "patch",
      "databasePatch",
      "databaseWrite",
      "mixed",
    ],
    [
      "database replacement",
      "runtime.db.replace(value, { nested: { value } })",
      "replace",
      "databaseReplace",
      "databaseWrite",
      "mixed",
    ],
    [
      "database deletion",
      "runtime.db.delete(value)",
      "delete",
      "databaseDelete",
      "databaseWrite",
      "mixed",
    ],
  ])(
    "lowers direct root-context %s to the existing ABI evidence",
    (_label, expression, targetName, operationName, capability, catchability) => {
      const source = UTF8_ENCODER.encode(
        `export async function run(runtime, value) { return await ${expression}; }`,
      );
      const result = runSource(source, [source]);
      if (Result.isFailure(result)) throw result.failure;
      expect(
        result.success.verified,
        result.success.diagnostics.map(({ code }) => code).join(","),
      ).toBe(true);
      expect(result.success.diagnostics).toEqual([]);
      expect(result.success.importCalls).toEqual([
        expect.objectContaining({ targetKind: "abi", targetName }),
      ]);
      expect(result.success.valueFlows).toEqual([
        expect.objectContaining({
          operationName,
          capability,
          catchability,
        }),
      ]);
    },
  );

  test("pins one ordered context-path catalog to existing ABI operations", () => {
    expect(DECLARATIVE_V2_CONTEXT_MEMBER_ABI_LOWERINGS_V1).toEqual([
      {
        id: 8,
        memberPath: ["auth", "getUserIdentity"],
        operation: "authGetUserIdentity",
        argumentCounts: [0],
      },
      {
        id: 1,
        memberPath: ["db", "get"],
        operation: "databaseGet",
        argumentCounts: [1],
      },
      {
        id: 2,
        memberPath: ["db", "insert"],
        operation: "databaseInsert",
        argumentCounts: [2],
      },
      {
        id: 3,
        memberPath: ["db", "patch"],
        operation: "databasePatch",
        argumentCounts: [2],
      },
      {
        id: 4,
        memberPath: ["db", "replace"],
        operation: "databaseReplace",
        argumentCounts: [2],
      },
      {
        id: 5,
        memberPath: ["db", "delete"],
        operation: "databaseDelete",
        argumentCounts: [1],
      },
      {
        id: 6,
        memberPath: ["runQuery"],
        operation: "runQuery",
        argumentCounts: [1, 2],
      },
      {
        id: 7,
        memberPath: ["runMutation"],
        operation: "runMutation",
        argumentCounts: [1, 2],
      },
    ]);
  });

  test.each([
    [
      "query with default arguments",
      'ctx.runQuery({_path:"recipeAssessment:assess"})',
      "runQuery",
    ],
    [
      "query with explicit arguments",
      'ctx.runQuery({_path:"recipeAssessment:assess"}, args)',
      "runQuery",
    ],
    [
      "mutation with default arguments",
      'ctx.runMutation({_path:"recipeMaintenance:markPublished"})',
      "runMutation",
    ],
    [
      "mutation with explicit arguments",
      'ctx.runMutation({_path:"recipeMaintenance:markPublished"}, args)',
      "runMutation",
    ],
  ])(
    "lowers an immediately awaited direct context %s to existing ABI evidence",
    (_label, expression, operationName) => {
      const source = UTF8_ENCODER.encode(
        `export async function run(ctx, args) { return await ${expression}; }`,
      );
      const result = runSource(source, [source]);
      if (Result.isFailure(result)) throw result.failure;
      expect(
        result.success.verified,
        result.success.diagnostics.map(({ code }) => code).join(","),
      ).toBe(true);
      expect(result.success.diagnostics).toEqual([]);
      expect(result.success.importCalls).toEqual([
        expect.objectContaining({
          targetKind: "abi",
          targetName: operationName,
        }),
      ]);
      expect(result.success.valueFlows).toEqual([
        expect.objectContaining({
          operationName,
          capability: "nestedCall",
          catchability: "mixed",
        }),
      ]);
    },
  );

  test("keeps direct nested-context calls byte-stable at every chunk boundary", () => {
    const source = UTF8_ENCODER.encode(
      "export async function run(ctx, args) {" +
        'const assessed=await ctx.runQuery({_path:"recipeAssessment:assess"},args);' +
        'return await ctx.runMutation({_path:"recipeMaintenance:markPublished"},{assessed});}',
    );
    const baselineResult = runSource(source, [source]);
    if (Result.isFailure(baselineResult)) throw baselineResult.failure;
    expect(
      baselineResult.success.verified,
      baselineResult.success.diagnostics.map(({ code }) => code).join(","),
    ).toBe(true);
    const baseline = semanticProjection(baselineResult);
    for (let split = 0; split <= source.byteLength; split += 1) {
      expect(semanticProjection(runSource(source, [
        source.slice(0, split),
        source.slice(split),
      ])), `split ${split}`).toEqual(baseline);
    }
  }, 30_000);

  test.each([
    ["missing query reference", "await ctx.runQuery()"],
    ["dynamic query reference", "await ctx.runQuery(reference)"],
    ["string query reference", 'await ctx.runQuery("internal:helper")'],
    [
      "generated-proxy query reference",
      "await ctx.runQuery(internal.module.helper, args)",
    ],
    [
      "forged query reference",
      "await ctx.runQuery({_path:reference}, args)",
    ],
    [
      "derived query reference",
      'await ctx.runQuery({_path:"internal:helper"}[reference], args)',
    ],
    [
      "query options",
      'await ctx.runQuery({_path:"internal:helper"}, args, {})',
    ],
    ["spread query", "await ctx.runQuery(...args)"],
    [
      "dropped query",
      'ctx.runQuery({_path:"internal:helper"}, args)',
    ],
    [
      "returned query promise",
      'return ctx.runQuery({_path:"internal:helper"}, args)',
    ],
    [
      "overlapping query",
      'await Promise.all([ctx.runQuery({_path:"internal:helper"}, args)])',
    ],
    ["missing mutation reference", "await ctx.runMutation()"],
    ["dynamic mutation reference", "await ctx.runMutation(reference)"],
    [
      "mutation options",
      'await ctx.runMutation({_path:"internal:helper"}, args, {})',
    ],
    ["spread mutation", "await ctx.runMutation(...args)"],
    [
      "dropped mutation",
      'ctx.runMutation({_path:"internal:helper"}, args)',
    ],
  ])("rejects unsupported direct nested-context authority: %s", (
    _label,
    expression,
  ) => {
    const source = UTF8_ENCODER.encode(
      "export async function run(ctx, reference, args, internal) {" +
        `${expression}; return null; }`,
    );
    const result = runSource(source, [source]);
    if (Result.isFailure(result)) throw result.failure;
    expect(result.success.verified).toBe(false);
    expect(result.success.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: expect.stringMatching(/^CORE_(COMPUTED_DISPATCH|CALL_TARGET)$/),
      }),
    ]));
  });

  test.each([
    [
      "optional nested-call context",
      'await ctx?.runQuery({_path:"internal:helper"}, args)',
    ],
    [
      "computed nested-call member",
      'await ctx["runQuery"]({_path:"internal:helper"}, args)',
    ],
    [
      "longer nested-call receiver",
      'await wrapper.ctx.runQuery({_path:"internal:helper"}, args)',
    ],
    [
      "parenthesized nested-call target",
      'await (ctx.runQuery)({_path:"internal:helper"}, args)',
    ],
    [
      "detached nested-call method",
      'await runQuery({_path:"internal:helper"}, args)',
      "const runQuery=ctx.runQuery;",
    ],
    [
      "forwarded nested-call context",
      "await helper(ctx, args)",
      'async function helper(value,input){return await value.runQuery({_path:"internal:helper"},input)}',
    ],
  ])("rejects indirect nested-context authority: %s", (
    _label,
    expression,
    prefix = "",
  ) => {
    const source = UTF8_ENCODER.encode(
      `export async function run(ctx,args,wrapper){${prefix}return ${expression};}`,
    );
    const result = runSource(source, [source]);
    if (Result.isFailure(result)) throw result.failure;
    expect(result.success.verified).toBe(false);
    expect(result.success.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: expect.stringMatching(/^CORE_(COMPUTED_DISPATCH|CALL_TARGET|HIGHER_ORDER)$/),
      }),
    ]));
  });

  test("keeps direct context lowering byte-stable at every chunk boundary", () => {
    const source = UTF8_ENCODER.encode(
      'export async function run(applicationContext, value) {' +
        'const created = await applicationContext.db.insert("recipes", value);' +
        "return await applicationContext.db.get(created);}",
    );
    const baseline = semanticProjection(runSource(source, [source]));
    for (let split = 0; split <= source.byteLength; split += 1) {
      expect(semanticProjection(runSource(source, [
        source.slice(0, split),
        source.slice(split),
      ])), `split ${split}`).toEqual(baseline);
    }
  }, 30_000);

  test("keeps template-substitution commas inside direct call arguments", () => {
    const source = UTF8_ENCODER.encode(
      "export async function run(ctx, id, prefix, value) {" +
        "const found = await ctx.db.get(`${prefix,id}`);" +
        "await ctx.db.patch(id, `${prefix,value}`);" +
        "return found;}",
    );
    const baselineResult = runSource(source, [source]);
    if (Result.isFailure(baselineResult)) throw baselineResult.failure;
    expect(
      baselineResult.success.verified,
      baselineResult.success.diagnostics.map(({ code }) => code).join(","),
    ).toBe(true);
    expect(baselineResult.success.importCalls).toEqual([
      expect.objectContaining({ targetKind: "abi", targetName: "get" }),
      expect.objectContaining({ targetKind: "abi", targetName: "patch" }),
    ]);
    const baseline = semanticProjection(baselineResult);
    for (let split = 0; split <= source.byteLength; split += 1) {
      expect(semanticProjection(runSource(source, [
        source.slice(0, split),
        source.slice(split),
      ])), `split ${split}`).toEqual(baseline);
    }
  }, 30_000);

  test.each([
    ["get", "databaseGet", "ctx.db.get(id)"],
    [
      "insert",
      "databaseInsert",
      'ctx.db.insert("recipes", value)',
    ],
    [
      "patch",
      "databasePatch",
      "ctx.db.patch(id, value)",
    ],
    [
      "replace",
      "databaseReplace",
      "ctx.db.replace(id, value)",
    ],
    ["delete", "databaseDelete", "ctx.db.delete(id)"],
  ])(
    "emits direct context %s value-flow authority without a private call shim",
    (_member, operation, contextCall) => {
      const contextSource = UTF8_ENCODER.encode(
        `export function run(ctx, id, value) { return ${contextCall}; }`,
      );
      const context = runSource(contextSource, [contextSource]);
      if (Result.isFailure(context)) throw context.failure;
      expect(context.success.valueFlows).toEqual([
        expect.objectContaining({ operationName: operation }),
      ]);
    },
  );

  test.each([
    "authGetUserIdentity",
    "databaseGet",
    "databaseInsert",
    "databasePatch",
    "databaseReplace",
    "databaseDelete",
    "runQuery",
    "runMutation",
    "errorCreate",
    "errorCode",
    "errorMessage",
    "errorData",
  ])("rejects private platform operation %s", (operation) => {
    const source = UTF8_ENCODER.encode(
      `import { ${operation} } from "flarex:platform"; ` +
        `export function run() { return ${operation}(); }`,
    );
    const result = runSource(source, [source]);
    if (Result.isFailure(result)) throw result.failure;
    expect(result.success.verified).toBe(false);
    expect(result.success.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CORE_IMPORT_TARGET" }),
    ]));
  });

  test.each([
    ["missing get id", "ctx.db.get()"],
    ["surplus get argument", "ctx.db.get(id, value)"],
    ["surplus insert argument", 'ctx.db.insert("recipes", value, id)'],
    [
      "Convex table-plus-id patch overload",
      'ctx.db.patch("recipes", id, value)',
    ],
    [
      "Convex table-plus-id replace overload",
      'ctx.db.replace("recipes", id, value)',
    ],
    ["Convex table-plus-id delete overload", 'ctx.db.delete("recipes", id)'],
    ["spread delete", "ctx.db.delete(...args)"],
    ["spread patch value", "ctx.db.patch(id, ...args)"],
    ["spread replace id", "ctx.db.replace(...args, value)"],
  ])("rejects unsupported direct context arity: %s", (_label, expression) => {
    const source = UTF8_ENCODER.encode(
      `export function run(ctx, id, value, args) { return ${expression}; }`,
    );
    const result = runSource(source, [source]);
    if (Result.isFailure(result)) throw result.failure;
    expect(result.success.verified).toBe(false);
    expect(result.success.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: expect.stringMatching(/^CORE_(COMPUTED_DISPATCH|CALL_TARGET)$/),
      }),
    ]));
  });

  test.each([
    ["optional context", "ctx?.db.get(id)"],
    ["optional database", "ctx.db?.get(id)"],
    ["computed receiver", 'ctx["db"].get(id)'],
    ["computed method", 'ctx.db["get"](id)'],
    ["unowned delete member", "value.delete(id)"],
    ["longer receiver", "wrapper.ctx.db.get(id)"],
    ["parenthesized target", "(ctx.db.get)(id)"],
    ["detached method", "get(id)", "const get = ctx;"],
    ["destructured context", "ctx.db.get(id)", "", "{db}"],
    ["reassigned context", "ctx.db.get(id)", "ctx = id;"],
    ["shadowed context", "ctx.db.get(id)", "const ctx = id;"],
  ])(
    "rejects indirect or ambiguous context authority: %s",
    (_label, expression, prefix = "", parameter = "ctx") => {
      const source = UTF8_ENCODER.encode(
        `export function run(${parameter}, id) { ${prefix} return ${expression}; }`,
      );
      const result = runSource(source, [source]);
      if (Result.isFailure(result)) throw result.failure;
      expect(result.success.verified).toBe(false);
      expect(result.success.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/^CORE_(COMPUTED_DISPATCH|CALL_TARGET)$/),
        }),
      ]));
    },
  );

  test("rejects a catch binding that shadows the root context", () => {
    const source = UTF8_ENCODER.encode(
      "export function run(ctx, id) {" +
        "try { return null; } catch (ctx) { return ctx.db.get(id); }}",
    );
    const result = runSource(source, [source]);
    if (Result.isFailure(result)) throw result.failure;
    expect(result.success.verified).toBe(false);
    expect(result.success.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: expect.stringMatching(/^CORE_(COMPUTED_DISPATCH|CALL_TARGET)$/),
      }),
    ]));
  });

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

  test("admits the exact awaited internal-call cycle fixture for runtime rejection", () => {
    const source = UTF8_ENCODER.encode(
      'export async function i(ctx, { id }) { ' +
        'if (id === "cycle") ' +
        'return await ctx.runQuery({_path:"internal:i"}, { id }); ' +
        'return await ctx.db.get(id); }',
    );
    Result.match(runSource(source, [source]), {
      onFailure: failure => { throw failure; },
      onSuccess: success => {
        expect(success.verified).toBe(true);
        expect(success.diagnostics).toEqual([]);
      },
    });
  });

  test("admits the exact mutation-to-internal-query fixture", () => {
    const source = UTF8_ENCODER.encode(
      'export async function u(ctx,{i}){ await ctx.db.delete(i); ' +
        'return await ctx.runQuery({_path:"q:r"},{i})}',
    );
    Result.match(runSource(source, [source]), {
      onFailure: failure => { throw failure; },
      onSuccess: success => {
        expect(
          success.verified,
          success.diagnostics.map(({ code }) => code).join(","),
        ).toBe(true);
        expect(success.diagnostics).toEqual([]);
      },
    });
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
    ["databaseGet", "ctx.db.get(id)"],
    ["databaseInsert", 'ctx.db.insert("items", {})'],
    ["databasePatch", "ctx.db.patch(id, {})"],
    ["databaseReplace", "ctx.db.replace(id, {})"],
    ["databaseDelete", "ctx.db.delete(id)"],
    ["runQuery", 'ctx.runQuery({_path:"internal:helper"})'],
    ["runMutation", 'ctx.runMutation({_path:"internal:helper"})'],
  ])("permits direct context mixed catchability for %s", (operation, call) => {
    const source = UTF8_ENCODER.encode(
      `export async function f(ctx, id) { ` +
        `try { return await ${call}; } catch { return null; } }`,
    );
    Result.match(runSource(source, [source]), {
      onFailure: (failure) => {
        throw failure;
      },
      onSuccess: (success) => {
        expect(success.verified).toBe(true);
        expect(success.diagnostics).toEqual([]);
        expect(success.valueFlows).toEqual([
          expect.objectContaining({
            operationName: operation,
            catchability: "mixed",
          }),
        ]);
      },
    });
  });

  test.each([
    ["missing reference", "await runQuery()"],
    ["dynamic reference", "await runQuery(reference)"],
    ["forged reference", 'await runQuery({_path: reference})'],
    [
      "unsupported options",
      'await runQuery({_path:"internal:helper"}, {}, {})',
    ],
    [
      "derived reference",
      'await runQuery({_path:"internal:helper"}[reference], {})',
    ],
    ["spread arguments", "await runQuery(...args)"],
    ["dropped call", 'runQuery({_path:"internal:helper"})'],
    ["direct return", 'return runQuery({_path:"internal:helper"})'],
    ["comma return", 'return runQuery({_path:"internal:helper"}), null'],
    ["logical return", 'return runQuery({_path:"internal:helper"}) && null'],
    ["conditional return", 'return runQuery({_path:"internal:helper"}) ? null : null'],
    ["overlapping call", 'Promise.all([runQuery({_path:"internal:helper"})])'],
  ])("rejects non-static internal-call authority: %s", (_label, expression) => {
    const source = UTF8_ENCODER.encode(
      `export async function f(ctx, reference, args) { ${
        expression.replaceAll("runQuery", "ctx.runQuery")
      }; return null; }`,
    );
    Result.match(runSource(source, [source]), {
      onFailure: (failure) => {
        throw failure;
      },
      onSuccess: (success) => {
        expect(success.verified).toBe(false);
        expect(success.diagnostics).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "CORE_CALL_TARGET" }),
        ]));
      },
    });
  });

  test.each([
    ["missing reference", "await runMutation()"],
    ["dynamic reference", "await runMutation(reference)"],
    ["forged reference", "await runMutation({_path: reference})"],
    [
      "unsupported options",
      'await runMutation({_path:"internal:helper"}, {}, {})',
    ],
    [
      "derived reference",
      'await runMutation({_path:"internal:helper"}[reference], {})',
    ],
    ["spread arguments", "await runMutation(...args)"],
    ["dropped call", 'runMutation({_path:"internal:helper"})'],
    ["direct return", 'return runMutation({_path:"internal:helper"})'],
    ["overlapping call", 'Promise.all([runMutation({_path:"internal:helper"})])'],
  ])("rejects non-static internal-mutation authority: %s", (_label, expression) => {
    const source = UTF8_ENCODER.encode(
      `export async function f(ctx, reference, args) { ${
        expression.replaceAll("runMutation", "ctx.runMutation")
      }; return null; }`,
    );
    Result.match(runSource(source, [source]), {
      onFailure: (failure) => {
        throw failure;
      },
      onSuccess: (success) => {
        expect(success.verified).toBe(false);
        expect(success.diagnostics).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "CORE_CALL_TARGET" }),
        ]));
      },
    });
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
      "export async function f(ctx) { try { return await ctx.auth.getUserIdentity(); } catch { return null; } }",
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
      "removed private database call",
      "import { databaseGet } from \"flarex:platform\"; export function f(databaseGet) { return databaseGet(); }",
      "CORE_IMPORT_TARGET",
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
      'export function run(ctx) { return ctx.db.get("id"); }\n',
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

  test("derives authenticated capacity and exact split-invariant terminal usage", () => {
    const makeModules = () => [
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
    ];
    const one = runAuthenticatedLink(makeModules(), 1);
    const maximum = runAuthenticatedLink(makeModules(), 1_024);
    if (Result.isFailure(one)) throw one.failure;
    if (Result.isFailure(maximum)) throw maximum.failure;
    expect(materializeLinkResult(one.success.result)).toEqual(
      materializeLinkResult(maximum.success.result),
    );
    expect(one.success.result.usage).toEqual(maximum.success.result.usage);
    expect(one.success.capacity).toEqual(maximum.success.capacity);
    expect(one.success.zeroReceipts).toMatchObject([
      { status: "ready", transitionCount: 0, admittedModuleCount: 0n },
      { status: "pending", transitionCount: 0 },
      { status: "pending", transitionCount: 0 },
    ]);
    const maximumBudget = budget("command_budget", 0, {
      modules: 2n,
      sourceBytes: 0n,
      objectBodyBytes: 0n,
    });
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      expect(
        one.success.result.usage[dimension],
        `${dimension} actual <= capacity`,
      ).toBeLessThanOrEqual(one.success.capacity[dimension]);
      expect(
        one.success.capacity[dimension],
        `${dimension} capacity <= command budget`,
      ).toBeLessThanOrEqual(maximumBudget[dimension]);
    }
    expect(one.success.capacity.tableBytes).toBeGreaterThan(0n);
    expect(one.success.result.usage.tableBytes).toBe(0n);
    expect(one.success.result.usage.frontierEntries).toBe(2n);
    expect(one.success.result.usage.objectCalls).toBe(0n);
    expect(one.success.result.usage.elapsedMilliseconds).toBe(0n);
    expect(one.success.result.usage.canonicalBytes).toBe(0n);
    expect(one.success.result.usage.frameBytes).toBe(0n);
    expect(one.success.result.usage.hashBytes).toBe(0n);
  });

  test("keeps completed-link claims factory-local, result-bound, and single-use", () => {
    const linked = runAuthenticatedLink([
      runModuleResult(
        "export function ready(){ return 1; }",
        "functions/ready.js",
        0n,
      ),
    ], 1);
    if (Result.isFailure(linked)) throw linked.failure;
    const port = declarativeV2VerifierCompletedLinkClaimPortV1(
      linked.success.factory,
    );
    if (port === undefined) throw new Error("missing completed-link claim port");
    const claimed = Result.getOrThrow(
      port.claim(linked.success.result, linked.success.bindings),
    );
    const lookup = Result.getOrThrow(port.beginHandlerLookup(
      claimed,
      "functions/ready.js",
      "ready",
    ));
    expect(port.stepHandlerLookup(lookup, 0)).toMatchObject({
      success: {
        status: "pending",
        transitionCount: 0,
      },
    });
    let complete:
      | Readonly<{
          found: boolean;
          moduleOrdinal: bigint | null;
          producingParseResultSha256: Uint8Array | null;
          usage: Readonly<{
            calls: bigint;
            exports: bigint;
            frontierEntries: bigint;
            stringBytes: bigint;
          }>;
        }>
      | undefined;
    for (let guard = 0; guard < 1_000_000; guard += 1) {
      const stepped = Result.getOrThrow(port.stepHandlerLookup(lookup, 1));
      if (stepped.status === "complete") {
        complete = stepped;
        break;
      }
    }
    expect(complete).toMatchObject({
      found: true,
      moduleOrdinal: 0n,
    });
    expect(complete?.producingParseResultSha256).toHaveLength(32);
    expect(complete?.usage).toMatchObject({
      exports: 1n,
      frontierEntries: 3n,
    });
    expect(port.stepHandlerLookup(lookup, 1)).toMatchObject({
      failure: { reason: "closed" },
    });
    expect(port.claim(
      linked.success.result,
      linked.success.bindings,
    )).toMatchObject({
      failure: { reason: "invalidInput" },
    });
    expect(port.close(claimed)).toEqual(Result.succeed(undefined));
    expect(port.close(claimed)).toMatchObject({
      failure: { reason: "closed" },
    });

    const foreign = makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
      claim: () =>
        Result.fail(new DeclarativeV2VerifierExecutableV1Error({
          operation: "link",
          reason: "invalidInput",
        })),
    });
    const foreignPort = declarativeV2VerifierCompletedLinkClaimPortV1(foreign);
    expect(foreignPort?.close(claimed)).toMatchObject({
      failure: { reason: "invalidInput" },
    });
    expect(
      declarativeV2VerifierCompletedLinkClaimPortV1(Object.freeze({})),
    ).toBeUndefined();
  });

  test("charges every failed completed-link lookup state transition", () => {
    const linked = runAuthenticatedLink([
      runModuleResult(
        "export function ready(){ return 1; }",
        "functions/ready.js",
        0n,
      ),
      runModuleResult(
        "export const value = 1;",
        "functions/value.js",
        1n,
      ),
    ], 1_024);
    if (Result.isFailure(linked)) throw linked.failure;
    const port = declarativeV2VerifierCompletedLinkClaimPortV1(
      linked.success.factory,
    );
    if (port === undefined) throw new Error("missing completed-link claim port");
    const claim = Result.getOrThrow(
      port.claim(linked.success.result, linked.success.bindings),
    );
    const driveMissing = (modulePath: string, exportName: string): void => {
      const lookup = Result.getOrThrow(port.beginHandlerLookup(
        claim,
        modulePath,
        exportName,
      ));
      for (let guard = 0; guard < 1_000_000; guard += 1) {
        const stepped = Result.getOrThrow(port.stepHandlerLookup(lookup, 1));
        expect(stepped.transitionCount).toBe(1);
        if (stepped.status === "complete") {
          expect(stepped.found).toBe(false);
          return;
        }
      }
      throw new Error("missing completed-link lookup did not terminate");
    };
    driveMissing("functions/missing.js", "missing");
    driveMissing("functions/ready.js", "missing");
    driveMissing("functions/value.js", "value");
    expect(port.close(claim)).toEqual(Result.succeed(undefined));
  });

  test.each([
    ["long ASCII", "handler" + "a".repeat(256)],
    ["long Unicode", "handler" + "é".repeat(256)],
  ] as const)(
    "keeps %s completed-link lookup split-invariant without byte capture",
    (_label, exportName) => {
      const run = (allowance: 1 | 1024) => {
        const linked = runAuthenticatedLink([
          runModuleResult(
            `export function ${exportName}(){ return 1; }`,
            "functions/long-lookup.js",
            0n,
          ),
        ], 1_024);
        if (Result.isFailure(linked)) throw linked.failure;
        const port = declarativeV2VerifierCompletedLinkClaimPortV1(
          linked.success.factory,
        );
        if (port === undefined) {
          throw new Error("missing completed-link claim port");
        }
        const claim = Result.getOrThrow(
          port.claim(linked.success.result, linked.success.bindings),
        );
        const drive = (candidate: string) => {
          const lookup = Result.getOrThrow(port.beginHandlerLookup(
            claim,
            "functions/long-lookup.js",
            candidate,
          ));
          for (let guard = 0; guard < 1_000_000; guard += 1) {
            const stepped = Result.getOrThrow(
              port.stepHandlerLookup(lookup, allowance),
            );
            if (stepped.status === "complete") {
              expect(port.stepHandlerLookup(lookup, allowance)).toMatchObject({
                failure: { reason: "closed" },
              });
              return stepped;
            }
          }
          throw new Error("long completed-link lookup did not terminate");
        };
        expect(drive(exportName.slice(0, -1))).toMatchObject({
          found: false,
        });
        const exact = drive(exportName);
        expect(port.close(claim)).toEqual(Result.succeed(undefined));
        return exact;
      };
      const one = run(1);
      const quantum = run(1024);
      expect(one).toMatchObject({
        found: true,
        moduleOrdinal: 0n,
      });
      expect(one.found).toBe(quantum.found);
      expect(one.moduleOrdinal).toBe(quantum.moduleOrdinal);
      expect(one.producingParseResultSha256).toEqual(
        quantum.producingParseResultSha256,
      );
      expect(one.usage).toEqual(quantum.usage);
    },
  );

  test("produces equal warm and reconstructed-cold link evidence for cycles and missing targets", () => {
    const warm = [
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
    const cold = warm.map(reconstructColdModuleResult);
    const warmLinked = runAuthenticatedLink(warm, 1);
    const coldLinked = runAuthenticatedLink(cold, 1_024);
    if (Result.isFailure(warmLinked)) throw warmLinked.failure;
    if (Result.isFailure(coldLinked)) throw coldLinked.failure;
    expect(materializeLinkResult(warmLinked.success.result)).toEqual(
      materializeLinkResult(coldLinked.success.result),
    );
    expect(
      materializeLinkResult(warmLinked.success.result).diagnostics.map(
        ({ code }) => code,
      ),
    ).toContain("CORE_MODULE_CYCLE");
    expect(warmLinked.success.result.usage).toEqual(
      coldLinked.success.result.usage,
    );
    expect(warmLinked.success.capacity).toEqual(coldLinked.success.capacity);

    const missing = runAuthenticatedLink([
      runModuleResult(
        "export function present(){ return 1; }",
        "functions/present.js",
        0n,
      ),
      runModuleResult(
        'import { absent } from "./present.js"; ' +
          "export function caller(){ return absent(); }",
        "functions/caller.js",
        1n,
      ),
    ], 1_024);
    if (Result.isFailure(missing)) throw missing.failure;
    expect(
      materializeLinkResult(missing.success.result).diagnostics.map(
        ({ code, moduleOrdinal }) => ({ code, moduleOrdinal }),
      ),
    ).toContainEqual({
      code: "CORE_IMPORT_TARGET",
      moduleOrdinal: 1n,
    });
  });

  test("fails closed for every authenticated lineage mismatch and capability misuse", () => {
    const mismatchFactories: ReadonlyArray<Readonly<{
      readonly name: string;
      readonly mutate: (
        claim: DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
      ) => DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1;
    }>> = [
      ...([
        "attemptSha256",
        "reservationSha256",
        "candidateSha256",
        "authenticatedInputSha256",
        "parsePagesRootSha256",
        "currentProgressSha256",
        "predecessorAndTailsSha256",
        "rangeSha256",
        "analyzerReleaseSha256",
        "analyzerIdentitySha256",
        "verifierIdentitySha256",
        "producingParseResultSha256",
      ] as const).map(field => Object.freeze({
        name: field,
        mutate: (
          claim: DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
        ) => Object.freeze({
          ...claim,
          [field]: new Uint8Array(32).fill(255),
        }),
      })),
      Object.freeze({
        name: "linkSequence",
        mutate: (
          claim: DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
        ) => Object.freeze({ ...claim, linkSequence: claim.linkSequence + 1n }),
      }),
      Object.freeze({
        name: "moduleOrdinal",
        mutate: (
          claim: DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
        ) => Object.freeze({ ...claim, moduleOrdinal: claim.moduleOrdinal + 1n }),
      }),
    ];
    for (const mismatch of mismatchFactories) {
      const module = runModuleResult(
        "export function value(){ return 1; }",
        "functions/value.js",
        0n,
      );
      const result = runAuthenticatedLink(
        [module],
        1_024,
        budget("command_budget", 0, {
          modules: 1n,
          sourceBytes: 0n,
          objectBodyBytes: 0n,
        }),
        claim => mismatch.mutate(claim),
      );
      expect(
        result,
        `mismatch ${mismatch.name}`,
      ).toMatchObject({
        failure: { operation: "link", reason: "invalidInput" },
      });
    }

    for (const shared of [
      new Uint8Array(new SharedArrayBuffer(32)),
      crossRealmSharedDigest(),
    ]) {
      shared.fill(61);
      const sharedBindings = Object.freeze({
        ...authenticatedLinkBindings(),
        attemptSha256: shared,
      });
      const factory = makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
        claim: () =>
          Result.fail(new DeclarativeV2VerifierExecutableV1Error({
            operation: "link",
            reason: "invalidInput",
          })),
      });
      expect(factory.create(
        sharedBindings,
        budget("command_budget", 0, {
          modules: 1n,
          sourceBytes: 0n,
          objectBodyBytes: 0n,
        }),
      )).toMatchObject({
        failure: { operation: "link", reason: "invalidInput" },
      });

      const module = runModuleResult(
        "export function shared(){ return 1; }",
        "functions/shared.js",
        0n,
      );
      const sharedClaim = runAuthenticatedLink(
        [module],
        1_024,
        budget("command_budget", 0, {
          modules: 1n,
          sourceBytes: 0n,
          objectBodyBytes: 0n,
        }),
        claim => Object.freeze({
          ...claim,
          producingParseResultSha256: shared,
        }),
      );
      expect(sharedClaim).toMatchObject({
        failure: { operation: "link", reason: "invalidInput" },
      });
    }

    const bindings = authenticatedLinkBindings();
    const module = runModuleResult(
      "export function owned(){ return 1; }",
      "functions/owned.js",
      0n,
    );
    let accessorReads = 0;
    const hostileClaim = Object.defineProperty(
      { ...authenticatedLinkClaim(module, bindings) },
      "attemptSha256",
      {
        enumerable: true,
        get() {
          accessorReads += 1;
          return new Uint8Array(32);
        },
      },
    );
    const first = makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
      claim: () =>
        Result.succeed(
          hostileClaim as DeclarativeV2VerifierAuthenticatedLinkModuleClaimV1,
        ),
    });
    const second = makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
      claim: () => Result.succeed(authenticatedLinkClaim(module, bindings)),
    });
    const created = Result.getOrThrow(first.create(
      bindings,
      budget("command_budget", 0, {
        modules: 1n,
        sourceBytes: 0n,
        objectBodyBytes: 0n,
      }),
    ));
    expect(first.admit(created, module, 1)).toMatchObject({
      failure: { operation: "link", reason: "invalidInput" },
    });
    expect(accessorReads).toBe(0);
    expect(first.admit(created, module, 1)).toMatchObject({
      failure: { operation: "link", reason: "closed" },
    });
    expect(second.close(created)).toMatchObject({
      failure: { operation: "link", reason: "invalidInput" },
    });
    expect(first.close(Object.freeze({
      _tag: "DeclarativeV2VerifierAuthenticatedLinkAccumulatorV1",
    }))).toMatchObject({
      failure: { operation: "link", reason: "invalidInput" },
    });
  });

  test("irreversibly revokes accumulators, drivers, and previously claimed results", () => {
    const bindings = authenticatedLinkBindings();
    const makeFactory = (
      module: DeclarativeV2VerifierModuleResultV1,
    ) => makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1({
      claim: candidate =>
        candidate === module
          ? Result.succeed(authenticatedLinkClaim(module, bindings))
          : Result.fail(new DeclarativeV2VerifierExecutableV1Error({
            operation: "link",
            reason: "invalidInput",
          })),
    });
    const module = runModuleResult(
      "export function lifecycle(){ return 1; }",
      "functions/lifecycle.js",
      0n,
    );
    const maximum = budget("command_budget", 0, {
      modules: 1n,
      sourceBytes: 0n,
      objectBodyBytes: 0n,
    });
    const first = makeFactory(module);
    const accumulator = Result.getOrThrow(first.create(bindings, maximum));
    expect(first.close(accumulator)).toEqual(Result.succeed(undefined));
    expect(first.close(accumulator)).toMatchObject({
      failure: { operation: "link", reason: "closed" },
    });
    expect(first.admit(accumulator, module, 1)).toMatchObject({
      failure: { operation: "link", reason: "closed" },
    });

    const excessive = Result.getOrThrow(first.create(bindings, maximum));
    expect(first.admit(excessive, module, 1_025)).toMatchObject({
      failure: {
        operation: "link",
        reason: "invalidInput",
        dimension: "transitionQuantum",
        observed: 1_025n,
        maximum: 1_024n,
      },
    });
    expect(first.admit(excessive, module, 1)).toMatchObject({
      failure: { operation: "link", reason: "closed" },
    });

    const active = Result.getOrThrow(first.create(bindings, maximum));
    while (
      Result.getOrThrow(first.admit(active, module, 1)).status !== "ready"
    ) {
      // one owned transition per call
    }
    const sealed = Result.getOrThrow(first.seal(active, 1));
    if (sealed.status !== "complete") {
      throw new Error("positive lifecycle seal did not complete");
    }
    expect(first.close(sealed.driver)).toEqual(Result.succeed(undefined));
    expect(first.step(sealed.driver, 1)).toMatchObject({
      failure: { operation: "link", reason: "closed" },
    });
    expect(first.close(sealed.driver)).toMatchObject({
      failure: { operation: "link", reason: "closed" },
    });

    const second = makeFactory(module);
    const reused = Result.getOrThrow(second.create(bindings, maximum));
    expect(second.admit(reused, module, 1)).toMatchObject({
      failure: { operation: "link", reason: "invalidInput" },
    });
  });

  test("rejects every one-less nonzero link capacity dimension before publication", () => {
    const makeModules = () => [
      runModuleResult(
        "export function a(){ return 1; }",
        "functions/a.js",
        0n,
      ),
      runModuleResult(
        'import { missing } from "./a.js"; export function b(){ return missing(); }',
        "functions/b.js",
        1n,
      ),
    ];
    const oracle = runAuthenticatedLink(makeModules(), 1_024);
    if (Result.isFailure(oracle)) throw oracle.failure;
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const required = oracle.success.capacity[dimension];
      if (required === 0n) continue;
      const result = runAuthenticatedLink(
        makeModules(),
        1_024,
        budget("command_budget", 0, {
          modules: 2n,
          sourceBytes: 0n,
          objectBodyBytes: 0n,
          [dimension]: required - 1n,
        }),
      );
      expect(result, `${dimension} one less`).toMatchObject({
        failure: {
          operation: "link",
          reason: "budgetExceeded",
          dimension,
          observed: required,
          maximum: required - 1n,
        },
      });
    }
  });

  test("keeps the executable owner on the existing internal subpath", async () => {
    const root = await import("@flarex/analysis");
    expect("createDeclarativeV2VerifierEngineV1" in root).toBe(false);
    expect("makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1" in root)
      .toBe(false);
    const internal = await import(
      "@flarex/analysis/internal/declarative-v2-verifier-v1"
    );
    expect(internal.createDeclarativeV2VerifierEngineV1).toBeTypeOf("function");
    expect(internal.makeDeclarativeV2VerifierAuthenticatedLinkFactoryV1)
      .toBeTypeOf("function");
    expect(
      "makeDeclarativeV2VerifierExecutableRestartBridgeV1" in internal,
    ).toBe(false);
    const loaded = loadGeneratedDeclarativeV2VerifierExecutableAssetV1(
      GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetByteLength,
    );
    expect(Result.isSuccess(loaded)).toBe(true);
  }, 30_000);
});
