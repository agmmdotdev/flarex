import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  type DeclarativeV2VerifierEngineV1,
  type DeclarativeV2VerifierExecutableV1Error,
  type DeclarativeV2VerifierModuleResultV1,
  GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1,
} from "./declarativeV2VerifierExecutableV1";
import {
  planDeclarativeV2VerifierArenaV1,
} from "./declarativeV2VerifierV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
} from "./declarativeV2VerifierV1.generated";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_U32 = 0xffff_ffffn;
const SHA256_BLOCK_BYTES = 64n;
const SHA256_LENGTH_BYTES = 8n;
const SHA256_BLOCK_TRANSITIONS = 129n;
const DIAGNOSTIC_RECORD_BYTES = 32n;
const EVIDENCE_INDEX_BYTES = 4n;
const UINT8_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  "byteLength",
)?.get;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;

export const DECLARATIVE_V2_VERIFIER_PARSE_TRANSITION_QUANTUM_V1 = 1_024;
export const DECLARATIVE_V2_VERIFIER_PARSE_TABLE_BYTES_V1 = BigInt(
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength +
    GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetByteLength,
);

export interface DeclarativeV2VerifierParseSizingBindingsV1 {
  readonly candidateSha256: Uint8Array;
  readonly authenticatedInputSha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

export interface DeclarativeV2VerifierParseFactsV1 {
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

export interface DeclarativeV2VerifierParseSizingInputV1 {
  readonly bindings: DeclarativeV2VerifierParseSizingBindingsV1;
  readonly commandKind: "parse_module";
  readonly sequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly sourceByteLength: bigint;
  readonly facts: DeclarativeV2VerifierParseFactsV1;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierParseSizingPlanV1 {
  readonly bindings: DeclarativeV2VerifierParseSizingBindingsV1;
  readonly sequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly sourceByteLength: bigint;
  readonly facts: DeclarativeV2VerifierParseFactsV1;
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
  readonly arenaByteLength: number;
}

export interface DeclarativeV2VerifierSha256WorkV1 {
  readonly calls: bigint;
  readonly hashBytes: bigint;
  readonly transitions: bigint;
}

export interface DeclarativeV2VerifierParseTerminalDriverCompleteV1 {
  readonly driverCalls: bigint;
  readonly result: DeclarativeV2VerifierModuleResultV1;
}

export class DeclarativeV2VerifierSizingV1Error extends Data.TaggedError(
  "DeclarativeV2VerifierSizingV1Error",
)<{
  readonly operation: "size" | "drive";
  readonly reason:
    | "invalidInput"
    | "identityMismatch"
    | "budgetExceeded"
    | "addressabilityExceeded"
    | "overflow"
    | "scheduleExceeded"
    | "scheduleMismatch";
  readonly path?: string;
  readonly observed?: bigint;
  readonly maximum?: bigint;
}> {}

type CapturedSizingInput = Readonly<{
  readonly bindings: DeclarativeV2VerifierParseSizingBindingsV1;
  readonly sequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly sourceByteLength: bigint;
  readonly facts: DeclarativeV2VerifierParseFactsV1;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
}>;

const sizingIssue = (
  operation: DeclarativeV2VerifierSizingV1Error["operation"],
  reason: DeclarativeV2VerifierSizingV1Error["reason"],
  path?: string,
  observed?: bigint,
  maximum?: bigint,
): DeclarativeV2VerifierSizingV1Error =>
  new DeclarativeV2VerifierSizingV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });

export function planDeclarativeV2VerifierParseModuleV1(
  input: unknown,
  expectedBindings: unknown,
): Result.Result<
  DeclarativeV2VerifierParseSizingPlanV1,
  DeclarativeV2VerifierSizingV1Error
> {
  return Result.gen(function*() {
    const captured = yield* captureSizingInput(input, expectedBindings);
    const required = yield* deriveParseRequirements(captured);
    const arena = planDeclarativeV2VerifierArenaV1({
      maximums: captured.commandBudget,
      required,
    });
    if (Result.isFailure(arena)) {
      if (
        arena.failure.reason === "invalidInput" ||
        arena.failure.reason === "invalidBudget" ||
        arena.failure.reason === "malformed" ||
        arena.failure.reason === "nonCanonical" ||
        arena.failure.reason === "unsupportedVersion"
      ) {
        throw new Error(
          `Trusted parse sizing contradicted the verifier arena at ${
            arena.failure.path ?? "input"
          }.`,
        );
      }
      return yield* Result.fail(sizingIssue(
        "size",
        arena.failure.reason,
        arena.failure.path,
        arena.failure.observed,
        arena.failure.maximum,
      ));
    }
    return Object.freeze({
      bindings: captured.bindings,
      sequence: captured.sequence,
      moduleOrdinal: captured.moduleOrdinal,
      sourceByteLength: captured.sourceByteLength,
      facts: captured.facts,
      required: arena.success.usage,
      arenaByteLength: arena.success.requiredBytes,
    });
  });
}

export function planDeclarativeV2VerifierSha256WorkV1(
  rawByteLength: unknown,
): Result.Result<
  DeclarativeV2VerifierSha256WorkV1,
  DeclarativeV2VerifierSizingV1Error
> {
  return Result.gen(function*() {
    const byteLength = yield* signedInt64(
      rawByteLength,
      "evidenceCanonicalByteLength",
    );
    const remainder = byteLength % SHA256_BLOCK_BYTES;
    const paddingBlocks =
      remainder + 1n + SHA256_LENGTH_BYTES <= SHA256_BLOCK_BYTES ? 1n : 2n;
    const paddingBytes = yield* checkedSubtract(
      yield* checkedMultiply(
        paddingBlocks,
        SHA256_BLOCK_BYTES,
        "sha256.paddingBytes",
      ),
      remainder,
      "sha256.paddingBytes",
    );
    const inputBlocks = byteLength / SHA256_BLOCK_BYTES;
    const totalBlocks = yield* checkedAdd(
      inputBlocks,
      paddingBlocks,
      "sha256.blockCount",
    );
    const blockTransitions = yield* checkedMultiply(
      totalBlocks,
      SHA256_BLOCK_TRANSITIONS,
      "sha256.blockTransitions",
    );
    const transitions = yield* checkedAdd(
      yield* checkedAdd(
        byteLength,
        paddingBytes,
        "sha256.transitions",
      ),
      blockTransitions,
      "sha256.transitions",
    );
    return Object.freeze({
      calls: transitions,
      hashBytes: byteLength,
      transitions,
    });
  });
}

export function driveDeclarativeV2VerifierParseModuleTerminalV1(
  createEngine: () => Result.Result<
    DeclarativeV2VerifierEngineV1,
    DeclarativeV2VerifierExecutableV1Error
  >,
  rawSource: unknown,
  rawExpectedDriverCalls: unknown,
  rawAllowance: unknown,
): Result.Result<
  DeclarativeV2VerifierParseTerminalDriverCompleteV1,
  DeclarativeV2VerifierSizingV1Error | DeclarativeV2VerifierExecutableV1Error
> {
  const source = captureSourceView(rawSource);
  if (source === undefined) {
    return Result.fail(sizingIssue("drive", "invalidInput", "source"));
  }
  if (
    typeof rawAllowance !== "number" ||
    !Number.isSafeInteger(rawAllowance) ||
    rawAllowance < 1 ||
    rawAllowance > DECLARATIVE_V2_VERIFIER_PARSE_TRANSITION_QUANTUM_V1
  ) {
    return Result.fail(sizingIssue("drive", "invalidInput", "allowance"));
  }
  return Result.gen(function*() {
    const expectedCalls = yield* signedInt64(
      rawExpectedDriverCalls,
      "expectedDriverCalls",
      true,
      "drive",
    );
    const engine = yield* createEngine();
    let driverCalls = 1n;
    let sourceOffset = 0;
    while (sourceOffset < source.byteLength) {
      if (driverCalls >= expectedCalls) {
        return yield* Result.fail(sizingIssue(
          "drive",
          "scheduleExceeded",
          "driverCalls",
          driverCalls + 1n,
          expectedCalls,
        ));
      }
      const suffix = Reflect.apply(
        UINT8_ARRAY_SUBARRAY,
        source,
        [sourceOffset, source.byteLength],
      ) as Uint8Array;
      const stepped = yield* engine.step(suffix, rawAllowance);
      driverCalls += 1n;
      const consumed = stepped.consumedBytes;
      if (
        !Number.isSafeInteger(consumed) ||
        consumed < 0 ||
        consumed > source.byteLength - sourceOffset
      ) {
        throw new Error(
          "Accepted verifier step returned an invalid source range.",
        );
      }
      if (consumed === 0 && stepped.transitionCount === 0) {
        throw new Error(
          "Accepted verifier step made no terminal-driver progress.",
        );
      }
      sourceOffset += consumed;
    }
    while (true) {
      if (driverCalls >= expectedCalls) {
        return yield* Result.fail(sizingIssue(
          "drive",
          "scheduleExceeded",
          "driverCalls",
          driverCalls + 1n,
          expectedCalls,
        ));
      }
      const finished = yield* engine.finish(rawAllowance);
      driverCalls += 1n;
      if ("status" in finished) continue;
      if (driverCalls !== expectedCalls) {
        return yield* Result.fail(sizingIssue(
          "drive",
          "scheduleMismatch",
          "driverCalls",
          driverCalls,
          expectedCalls,
        ));
      }
      return Object.freeze({
        driverCalls,
        result: finished,
      });
    }
  });
}

function captureSizingInput(
  input: unknown,
  expectedBindingsInput: unknown,
): Result.Result<CapturedSizingInput, DeclarativeV2VerifierSizingV1Error> {
  return Result.gen(function*() {
    const record = yield* exactRecord(input, [
      "bindings",
      "commandKind",
      "sequence",
      "moduleOrdinal",
      "sourceByteLength",
      "facts",
      "commandBudget",
    ]);
    const bindings = yield* captureBindings(record.bindings, "bindings");
    const expectedBindings = yield* captureBindings(
      expectedBindingsInput,
      "expectedBindings",
    );
    if (!sameBindings(bindings, expectedBindings)) {
      return yield* Result.fail(sizingIssue(
        "size",
        "identityMismatch",
        "bindings",
      ));
    }
    if (record.commandKind !== "parse_module") {
      return yield* Result.fail(sizingIssue(
        "size",
        "invalidInput",
        "commandKind",
      ));
    }
    const sequence = yield* signedInt64(record.sequence, "sequence", true);
    const moduleOrdinal = yield* u32(record.moduleOrdinal, "moduleOrdinal");
    const sourceByteLength = yield* u32(
      record.sourceByteLength,
      "sourceByteLength",
    );
    const facts = yield* captureFacts(record.facts, sourceByteLength);
    const commandBudget = yield* captureBudget(record.commandBudget);
    return Object.freeze({
      bindings,
      sequence,
      moduleOrdinal,
      sourceByteLength,
      facts,
      commandBudget,
    });
  });
}

function deriveParseRequirements(
  input: CapturedSizingInput,
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierSizingV1Error
> {
  return Result.gen(function*() {
    const facts = input.facts;
    const sha256 = yield* planDeclarativeV2VerifierSha256WorkV1(
      facts.evidenceCanonicalByteLength,
    );
    const calls = yield* checkedAdd(
      facts.driverCalls,
      sha256.calls,
      "calls",
    );
    const importEdges = yield* checkedAdd(
      facts.importDeclarationCount,
      facts.callCount,
      "importEdges",
    );
    const chargedGraphNodes = yield* checkedAdd(
      facts.importDeclarationCount,
      facts.functionCount,
      "graphNodes",
    );
    const graphNodes = [
      chargedGraphNodes,
      facts.exportCount,
      facts.diagnosticCount,
    ].reduce((maximum, value) => value > maximum ? value : maximum, 0n);
    const diagnosticRecordBytes = yield* checkedMultiply(
      facts.diagnosticCount,
      DIAGNOSTIC_RECORD_BYTES,
      "diagnosticBytes",
    );
    const diagnosticBytes = diagnosticRecordBytes >
        facts.diagnosticTextByteLength
      ? diagnosticRecordBytes
      : facts.diagnosticTextByteLength;
    const evidenceIndexCount = yield* checkedAdd(
      facts.valueFlowCount,
      facts.diagnosticCount,
      "frameBytes",
    );
    const evidenceIndexByteLength = yield* checkedMultiply(
      evidenceIndexCount,
      EVIDENCE_INDEX_BYTES,
      "frameBytes",
    );
    const indexedFrameCapacity = yield* checkedAdd(
      facts.maximumEvidenceFrameByteLength,
      evidenceIndexByteLength,
      "frameBytes",
    );
    const frameBytes = indexedFrameCapacity >
        facts.evidenceCanonicalByteLength
      ? indexedFrameCapacity
      : facts.evidenceCanonicalByteLength;
    const outputBytes = yield* checkedAdd(
      facts.modulePathByteLength,
      facts.semanticOutputByteLength,
      "outputBytes",
    );
    const required = Object.freeze({
      kind: "attempt_usage",
      calls,
      objectCalls: 0n,
      objectBodyBytes: input.sourceByteLength,
      sourceBytes: input.sourceByteLength,
      sourceMapBytes: 0n,
      semanticBytes: 0n,
      modules: 1n,
      importEdges,
      exports: facts.exportCount,
      functions: facts.functionCount,
      tokens: facts.tokenCount,
      tokenBytes: facts.tokenByteLength,
      parserStates: facts.peakParserStates,
      nestingDepth: facts.peakNestingDepth,
      schemaNodes: 0n,
      validatorNodes: 0n,
      graphNodes,
      frontierEntries: facts.importDeclarationCount,
      stringBytes: facts.retainedStringByteLength,
      tableBytes: DECLARATIVE_V2_VERIFIER_PARSE_TABLE_BYTES_V1,
      canonicalBytes: facts.evidenceCanonicalByteLength,
      frameBytes,
      hashBytes: sha256.hashBytes,
      diagnosticBytes,
      outputBytes,
      elapsedMilliseconds: 0n,
    } satisfies DeclarativeV2VerifierBudgetFrameV2);
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      if (required[dimension] > input.commandBudget[dimension]) {
        return yield* Result.fail(sizingIssue(
          "size",
          "budgetExceeded",
          dimension,
          required[dimension],
          input.commandBudget[dimension],
        ));
      }
    }
    return required;
  });
}

function captureFacts(
  value: unknown,
  sourceByteLength: bigint,
): Result.Result<
  DeclarativeV2VerifierParseFactsV1,
  DeclarativeV2VerifierSizingV1Error
> {
  return Result.gen(function*() {
    const keys = [
      "driverCalls",
      "modulePathByteLength",
      "tokenCount",
      "tokenByteLength",
      "peakParserStates",
      "peakNestingDepth",
      "retainedStringByteLength",
      "importDeclarationCount",
      "callCount",
      "exportCount",
      "functionCount",
      "valueFlowCount",
      "diagnosticCount",
      "diagnosticTextByteLength",
      "semanticOutputByteLength",
      "evidenceCanonicalByteLength",
      "maximumEvidenceFrameByteLength",
    ] as const;
    const record = yield* exactRecord(value, keys, "facts");
    const captured = Object.freeze({
      driverCalls: yield* signedInt64(
        record.driverCalls,
        "facts.driverCalls",
        true,
      ),
      modulePathByteLength: yield* u32(
        record.modulePathByteLength,
        "facts.modulePathByteLength",
        true,
      ),
      tokenCount: yield* u32(record.tokenCount, "facts.tokenCount", true),
      tokenByteLength: yield* signedInt64(
        record.tokenByteLength,
        "facts.tokenByteLength",
      ),
      peakParserStates: yield* u32(
        record.peakParserStates,
        "facts.peakParserStates",
        true,
      ),
      peakNestingDepth: yield* u32(
        record.peakNestingDepth,
        "facts.peakNestingDepth",
      ),
      retainedStringByteLength: yield* signedInt64(
        record.retainedStringByteLength,
        "facts.retainedStringByteLength",
      ),
      importDeclarationCount: yield* u32(
        record.importDeclarationCount,
        "facts.importDeclarationCount",
      ),
      callCount: yield* u32(record.callCount, "facts.callCount"),
      exportCount: yield* u32(record.exportCount, "facts.exportCount"),
      functionCount: yield* u32(record.functionCount, "facts.functionCount"),
      valueFlowCount: yield* u32(
        record.valueFlowCount,
        "facts.valueFlowCount",
      ),
      diagnosticCount: yield* u32(
        record.diagnosticCount,
        "facts.diagnosticCount",
      ),
      diagnosticTextByteLength: yield* signedInt64(
        record.diagnosticTextByteLength,
        "facts.diagnosticTextByteLength",
      ),
      semanticOutputByteLength: yield* signedInt64(
        record.semanticOutputByteLength,
        "facts.semanticOutputByteLength",
      ),
      evidenceCanonicalByteLength: yield* u32(
        record.evidenceCanonicalByteLength,
        "facts.evidenceCanonicalByteLength",
        true,
      ),
      maximumEvidenceFrameByteLength: yield* u32(
        record.maximumEvidenceFrameByteLength,
        "facts.maximumEvidenceFrameByteLength",
        true,
      ),
    } satisfies DeclarativeV2VerifierParseFactsV1);
    if (
      captured.tokenByteLength > sourceByteLength ||
      captured.retainedStringByteLength > sourceByteLength
    ) {
      return yield* Result.fail(sizingIssue(
        "size",
        "invalidInput",
        captured.tokenByteLength > sourceByteLength
          ? "facts.tokenByteLength"
          : "facts.retainedStringByteLength",
      ));
    }
    if (captured.valueFlowCount > captured.callCount) {
      return yield* Result.fail(sizingIssue(
        "size",
        "invalidInput",
        "facts.valueFlowCount",
        captured.valueFlowCount,
        captured.callCount,
      ));
    }
    if (
      captured.maximumEvidenceFrameByteLength >
        captured.evidenceCanonicalByteLength
    ) {
      return yield* Result.fail(sizingIssue(
        "size",
        "invalidInput",
        "facts.maximumEvidenceFrameByteLength",
        captured.maximumEvidenceFrameByteLength,
        captured.evidenceCanonicalByteLength,
      ));
    }
    return captured;
  });
}

function captureBindings(
  value: unknown,
  path: string,
): Result.Result<
  DeclarativeV2VerifierParseSizingBindingsV1,
  DeclarativeV2VerifierSizingV1Error
> {
  return Result.gen(function*() {
    const record = yield* exactRecord(value, [
      "candidateSha256",
      "authenticatedInputSha256",
      "rangeAndPredecessorTailsSha256",
      "analyzerIdentitySha256",
      "verifierIdentitySha256",
    ], path);
    return Object.freeze({
      candidateSha256: yield* digest(
        record.candidateSha256,
        `${path}.candidateSha256`,
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

function captureBudget(
  value: unknown,
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierSizingV1Error
> {
  return Result.gen(function*() {
    const record = yield* exactRecord(
      value,
      ["kind", ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2],
      "commandBudget",
    );
    if (record.kind !== "command_budget") {
      return yield* Result.fail(sizingIssue(
        "size",
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
      );
    }
    return Object.freeze(captured) as DeclarativeV2VerifierBudgetFrameV2;
  });
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  path = "input",
): Result.Result<
  Readonly<Record<Keys[number], unknown>>,
  DeclarativeV2VerifierSizingV1Error
> {
  if (value === null || typeof value !== "object") {
    return Result.fail(sizingIssue("size", "invalidInput", path));
  }
  const captured = Object.create(null) as Record<string, unknown>;
  try {
    if (Array.isArray(value)) {
      return Result.fail(sizingIssue("size", "invalidInput", path));
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) =>
        typeof key !== "string" || !keys.includes(key)
      )
    ) {
      return Result.fail(sizingIssue("size", "invalidInput", path));
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return Result.fail(sizingIssue(
          "size",
          "invalidInput",
          `${path}.${key}`,
        ));
      }
      captured[key] = descriptor.value;
    }
  } catch {
    return Result.fail(sizingIssue("size", "invalidInput", path));
  }
  return Result.succeed(
    Object.freeze(captured) as Readonly<Record<Keys[number], unknown>>,
  );
}

function signedInt64(
  value: unknown,
  path: string,
  positive = false,
  operation: DeclarativeV2VerifierSizingV1Error["operation"] = "size",
): Result.Result<bigint, DeclarativeV2VerifierSizingV1Error> {
  if (
    typeof value !== "bigint" ||
    value < (positive ? 1n : 0n) ||
    value > MAX_SIGNED_INT64
  ) {
    return Result.fail(sizingIssue(operation, "invalidInput", path));
  }
  return Result.succeed(value);
}

function u32(
  value: unknown,
  path: string,
  positive = false,
): Result.Result<bigint, DeclarativeV2VerifierSizingV1Error> {
  return Result.gen(function*() {
    const captured = yield* signedInt64(value, path, positive);
    if (captured > MAX_U32) {
      return yield* Result.fail(sizingIssue(
        "size",
        "addressabilityExceeded",
        path,
        captured,
        MAX_U32,
      ));
    }
    return captured;
  });
}

function digest(
  value: unknown,
  path: string,
): Result.Result<Uint8Array, DeclarativeV2VerifierSizingV1Error> {
  if (!isUint8ArrayWithByteLength(value, 32)) {
    return Result.fail(sizingIssue("size", "invalidInput", path));
  }
  try {
    return Result.succeed(new Uint8Array(value));
  } catch {
    return Result.fail(sizingIssue("size", "invalidInput", path));
  }
}

const sameBindings = (
  left: DeclarativeV2VerifierParseSizingBindingsV1,
  right: DeclarativeV2VerifierParseSizingBindingsV1,
): boolean =>
  bytesEqualFullScan(left.candidateSha256, right.candidateSha256) &&
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

function checkedAdd(
  left: bigint,
  right: bigint,
  path: string,
): Result.Result<bigint, DeclarativeV2VerifierSizingV1Error> {
  const result = left + right;
  return result <= MAX_SIGNED_INT64
    ? Result.succeed(result)
    : Result.fail(sizingIssue("size", "overflow", path));
}

function checkedSubtract(
  left: bigint,
  right: bigint,
  path: string,
): Result.Result<bigint, DeclarativeV2VerifierSizingV1Error> {
  return left >= right
    ? Result.succeed(left - right)
    : Result.fail(sizingIssue("size", "overflow", path));
}

function checkedMultiply(
  left: bigint,
  right: bigint,
  path: string,
): Result.Result<bigint, DeclarativeV2VerifierSizingV1Error> {
  const result = left * right;
  return result <= MAX_SIGNED_INT64
    ? Result.succeed(result)
    : Result.fail(sizingIssue("size", "overflow", path));
}

function captureSourceView(value: unknown): Uint8Array | undefined {
  if (!isUint8Array(value) || UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined) {
    return undefined;
  }
  try {
    const byteLength = Reflect.apply(
      UINT8_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    ) as number;
    return Reflect.apply(
      UINT8_ARRAY_SUBARRAY,
      value,
      [0, byteLength],
    ) as Uint8Array;
  } catch {
    return undefined;
  }
}
