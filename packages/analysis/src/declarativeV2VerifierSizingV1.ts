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
  GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_V1,
} from "./declarativeV2VerifierBoundsV1.generated";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "./declarativeV2ArtifactModulePathV1";
import {
  createDeclarativeV2VerifierEngineV1,
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
const UINT8_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  "byteLength",
)?.get;
const UINT8_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  "buffer",
)?.get;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      "byteLength",
    )?.get;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;

export const DECLARATIVE_V2_VERIFIER_PARSE_TRANSITION_QUANTUM_V1 = 1_024;
export const DECLARATIVE_V2_VERIFIER_PARSE_TABLE_BYTES_V1 = BigInt(
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetByteLength +
    GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1.assetByteLength,
);
export const DECLARATIVE_V2_VERIFIER_PARSE_DOMAIN_BYTE_LIMIT_V1 =
  GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_V1
    .selectedSourceAndModulePathByteLimit;
export const DECLARATIVE_V2_VERIFIER_PARSE_ARENA_OPERATIONAL_BYTE_LIMIT_V1 =
  GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_V1
    .arenaOperationalByteLimit;

export interface DeclarativeV2VerifierParseCapacityBindingsV1 {
  readonly candidateSha256: Uint8Array;
  readonly authenticatedInputSha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

export interface DeclarativeV2VerifierParseCapacityInputV1 {
  readonly bindings: DeclarativeV2VerifierParseCapacityBindingsV1;
  readonly commandKind: "parse_module";
  readonly sequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly modulePath: DeclarativeV2ArtifactModulePathHandleV1;
  readonly source: Uint8Array;
  readonly sourceSha256: Uint8Array;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierParseCapacityClaimV1 {
  readonly _tag: "DeclarativeV2VerifierParseCapacityClaimV1";
}

export interface DeclarativeV2VerifierParseCapacityPlanV1 {
  readonly bindings: DeclarativeV2VerifierParseCapacityBindingsV1;
  readonly sequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly modulePathByteLength: bigint;
  readonly sourceByteLength: bigint;
  readonly domainByteLength: bigint;
  readonly capacity: DeclarativeV2VerifierBudgetFrameV2;
  readonly arenaByteLength: number;
  readonly claim: DeclarativeV2VerifierParseCapacityClaimV1;
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
  readonly operation: "capacity" | "drive";
  readonly reason:
    | "invalidInput"
    | "identityMismatch"
    | "budgetExceeded"
    | "domainLimitExceeded"
    | "addressabilityExceeded"
    | "overflow";
  readonly path?: string;
  readonly observed?: bigint;
  readonly maximum?: bigint;
}> {}

type CapturedCapacityInput = Readonly<{
  readonly bindings: DeclarativeV2VerifierParseCapacityBindingsV1;
  readonly sequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly modulePath: DeclarativeV2ArtifactModulePathHandleV1;
  readonly modulePathByteLength: bigint;
  readonly source: Uint8Array;
  readonly sourceSha256: Uint8Array;
  readonly sourceByteLength: bigint;
  readonly domainByteLength: bigint;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
}>;

type OwnedCapacityClaim = Readonly<{
  readonly captured: CapturedCapacityInput;
  readonly capacity: DeclarativeV2VerifierBudgetFrameV2;
}>;

const OWNED_CAPACITY_CLAIMS = new WeakMap<object, OwnedCapacityClaim>();

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

/**
 * Derives the immutable pre-allocation capacity for one parse command from
 * authenticated lengths and generated grammar/diagnostic multiplicity bounds.
 *
 * This is deliberately not an exact-usage oracle. The executable verifier
 * remains the sole owner of terminal actual usage and enforces actual <=
 * capacity through its existing V1 `required` input.
 */
export function planDeclarativeV2VerifierParseCapacityV1(
  input: unknown,
  expectedBindings: unknown,
): Result.Result<
  DeclarativeV2VerifierParseCapacityPlanV1,
  DeclarativeV2VerifierSizingV1Error
> {
  return Result.gen(function*() {
    const captured = yield* captureCapacityInput(input, expectedBindings);
    const capacity = yield* deriveParseCapacity(captured);
    const arena = yield* planDeclarativeV2VerifierArenaV1({
      maximums: captured.commandBudget,
      required: capacity,
    }).pipe(Result.mapError((failure) => {
      if (
        failure.reason === "invalidInput" ||
        failure.reason === "invalidBudget" ||
        failure.reason === "malformed" ||
        failure.reason === "nonCanonical" ||
        failure.reason === "unsupportedVersion"
      ) {
        throw new Error(
          `Trusted parse capacity contradicted the verifier arena at ${
            failure.path ?? "input"
          }.`,
        );
      }
      return sizingIssue(
        "capacity",
        failure.reason,
        failure.path,
        failure.observed,
        failure.maximum,
      );
    }));
    if (
      arena.requiredBytes >
        DECLARATIVE_V2_VERIFIER_PARSE_ARENA_OPERATIONAL_BYTE_LIMIT_V1
    ) {
      throw new Error(
        "Generated parse capacity exceeded its accepted operational arena proof.",
      );
    }
    const claim = Object.freeze({
      _tag: "DeclarativeV2VerifierParseCapacityClaimV1",
    }) satisfies DeclarativeV2VerifierParseCapacityClaimV1;
    OWNED_CAPACITY_CLAIMS.set(claim, Object.freeze({
      captured,
      capacity: arena.usage,
    }));
    return Object.freeze({
      bindings: copyBindings(captured.bindings),
      sequence: captured.sequence,
      moduleOrdinal: captured.moduleOrdinal,
      modulePathByteLength: captured.modulePathByteLength,
      sourceByteLength: captured.sourceByteLength,
      domainByteLength: captured.domainByteLength,
      capacity: arena.usage,
      arenaByteLength: arena.requiredBytes,
      claim,
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

/**
 * Drives the existing V1 engine without normalizing its observable call
 * accounting. Each public step and finish invocation remains charged by the
 * engine exactly as before, including allowance partition effects.
 */
export function driveDeclarativeV2VerifierParseModuleTerminalV1(
  rawClaim: unknown,
  rawAllowance: unknown,
): Result.Result<
  DeclarativeV2VerifierParseTerminalDriverCompleteV1,
  DeclarativeV2VerifierSizingV1Error | DeclarativeV2VerifierExecutableV1Error
> {
  const owned = rawClaim !== null &&
      typeof rawClaim === "object"
    ? OWNED_CAPACITY_CLAIMS.get(rawClaim)
    : undefined;
  if (owned === undefined) {
    return Result.fail(sizingIssue("drive", "invalidInput", "claim"));
  }
  OWNED_CAPACITY_CLAIMS.delete(rawClaim as object);
  if (
    typeof rawAllowance !== "number" ||
    !Number.isSafeInteger(rawAllowance) ||
    rawAllowance < 1 ||
    rawAllowance > DECLARATIVE_V2_VERIFIER_PARSE_TRANSITION_QUANTUM_V1
  ) {
    return Result.fail(sizingIssue("drive", "invalidInput", "allowance"));
  }
  return Result.gen(function*() {
    const engine = yield* createDeclarativeV2VerifierEngineV1({
      modulePath: owned.captured.modulePath,
      moduleOrdinal: owned.captured.moduleOrdinal,
      sourceSha256: owned.captured.sourceSha256,
      maximums: owned.captured.commandBudget,
      required: owned.capacity,
    });
    let driverCalls = 1n;
    let sourceOffset = 0;
    const source = owned.captured.source;
    while (sourceOffset < source.byteLength) {
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
      const finished = yield* engine.finish(rawAllowance);
      driverCalls += 1n;
      if ("status" in finished) continue;
      return Object.freeze({
        driverCalls,
        result: finished,
      });
    }
  });
}

export function closeDeclarativeV2VerifierParseCapacityV1(
  rawClaim: unknown,
): Result.Result<void, DeclarativeV2VerifierSizingV1Error> {
  if (
    rawClaim === null ||
    typeof rawClaim !== "object" ||
    !OWNED_CAPACITY_CLAIMS.delete(rawClaim)
  ) {
    return Result.fail(sizingIssue("drive", "invalidInput", "claim"));
  }
  return Result.succeed(undefined);
}

function captureCapacityInput(
  input: unknown,
  expectedBindingsInput: unknown,
): Result.Result<CapturedCapacityInput, DeclarativeV2VerifierSizingV1Error> {
  return Result.gen(function*() {
    const record = yield* exactRecord(input, [
      "bindings",
      "commandKind",
      "sequence",
      "moduleOrdinal",
      "modulePath",
      "source",
      "sourceSha256",
      "commandBudget",
    ]);
    const bindings = yield* captureBindings(record.bindings, "bindings");
    const expectedBindings = yield* captureBindings(
      expectedBindingsInput,
      "expectedBindings",
    );
    if (!sameBindings(bindings, expectedBindings)) {
      return yield* Result.fail(sizingIssue(
        "capacity",
        "identityMismatch",
        "bindings",
      ));
    }
    if (record.commandKind !== "parse_module") {
      return yield* Result.fail(sizingIssue(
        "capacity",
        "invalidInput",
        "commandKind",
      ));
    }
    const sequence = yield* signedInt64(record.sequence, "sequence", true);
    const moduleOrdinal = yield* u32(record.moduleOrdinal, "moduleOrdinal");
    const modulePath = yield* DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1
      .capture(record.modulePath)
      .pipe(Result.mapError(() =>
        sizingIssue("capacity", "invalidInput", "modulePath")
      ));
    const modulePathByteLength = BigInt(
      yield* DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1
        .byteLength(modulePath)
        .pipe(Result.mapError(() =>
          sizingIssue("capacity", "invalidInput", "modulePath")
        )),
    );
    const sourceSha256 = yield* digest(record.sourceSha256, "sourceSha256");
    const source = yield* captureBoundedSource(
      record.source,
      modulePathByteLength,
    );
    const sourceByteLength = BigInt(source.byteLength);
    const domainByteLength = yield* checkedAdd(
      modulePathByteLength,
      sourceByteLength,
      "domainByteLength",
    );
    if (
      domainByteLength >
        BigInt(DECLARATIVE_V2_VERIFIER_PARSE_DOMAIN_BYTE_LIMIT_V1)
    ) {
      return yield* Result.fail(sizingIssue(
        "capacity",
        "domainLimitExceeded",
        "domainByteLength",
        domainByteLength,
        BigInt(DECLARATIVE_V2_VERIFIER_PARSE_DOMAIN_BYTE_LIMIT_V1),
      ));
    }
    return Object.freeze({
      bindings,
      sequence,
      moduleOrdinal,
      modulePath,
      modulePathByteLength,
      source,
      sourceSha256,
      sourceByteLength,
      domainByteLength,
      commandBudget: yield* captureBudget(record.commandBudget),
    });
  });
}

function deriveParseCapacity(
  input: CapturedCapacityInput,
): Result.Result<
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierSizingV1Error
> {
  return Result.gen(function*() {
    const bounds = GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_V1;
    const units = yield* checkedAdd(
      input.domainByteLength,
      1n,
      "domainUnits",
    );
    const parserStates = yield* checkedMultiply(
      units,
      BigInt(bounds.parserStackEntriesPerDomainUnit),
      "parserStates",
    );
    const diagnosticCount = yield* checkedMultiply(
      units,
      BigInt(bounds.parseDiagnosticDefinitionsPerDomainUnit),
      "diagnosticCount",
    );
    const evidenceFrameCount = yield* checkedAdd(
      1n,
      yield* checkedMultiply(
        units,
        BigInt(bounds.evidenceFramesPerDomainUnit),
        "evidenceFrameCount",
      ),
      "evidenceFrameCount",
    );
    const maximumEvidenceFrameBytes = yield* checkedAdd(
      BigInt(bounds.maximumEvidenceFixedBytes),
      yield* checkedMultiply(
        input.domainByteLength,
        BigInt(
          bounds.maximumEvidenceTextFields *
            bounds.maximumJsonEscapeBytesPerInputByte,
        ),
        "maximumEvidenceFrameBytes",
      ),
      "maximumEvidenceFrameBytes",
    );
    const canonicalBytes = yield* checkedMultiply(
      evidenceFrameCount,
      maximumEvidenceFrameBytes,
      "canonicalBytes",
    );
    const maximumDiagnosticBytes = yield* checkedAdd(
      BigInt(bounds.maximumEvidenceFixedBytes),
      yield* checkedMultiply(
        input.domainByteLength,
        BigInt(bounds.maximumJsonEscapeBytesPerInputByte),
        "diagnosticBytes",
      ),
      "diagnosticBytes",
    );
    const diagnosticBytes = yield* checkedMultiply(
      diagnosticCount,
      maximumDiagnosticBytes,
      "diagnosticBytes",
    );
    const maximumSemanticRecordBytes = yield* checkedAdd(
      BigInt(bounds.maximumEvidenceFixedBytes),
      yield* checkedMultiply(
        input.domainByteLength,
        BigInt(bounds.maximumSemanticOutputBytesPerDomainByte),
        "outputBytes",
      ),
      "outputBytes",
    );
    const outputBytes = yield* checkedMultiply(
      yield* checkedMultiply(
        units,
        BigInt(bounds.semanticOutputRecordsPerDomainUnit),
        "outputBytes",
      ),
      maximumSemanticRecordBytes,
      "outputBytes",
    );
    const sha256 = yield* planDeclarativeV2VerifierSha256WorkV1(
      canonicalBytes,
    );
    const semanticTransitions = yield* checkedMultiply(
      yield* checkedMultiply(units, units, "calls"),
      BigInt(bounds.maximumSemanticTransitionsPerDomainUnitSquared),
      "calls",
    );
    const calls = yield* checkedAdd(
      yield* checkedAdd(semanticTransitions, units, "calls"),
      sha256.calls,
      "calls",
    );
    const importEdges = yield* checkedMultiply(units, 2n, "importEdges");
    const graphNodes = diagnosticCount;

    const capacity = Object.freeze({
      kind: "attempt_usage",
      calls,
      objectCalls: 0n,
      objectBodyBytes: input.sourceByteLength,
      sourceBytes: input.sourceByteLength,
      sourceMapBytes: 0n,
      semanticBytes: 0n,
      modules: 1n,
      importEdges,
      exports: units,
      functions: units,
      tokens: units,
      tokenBytes: input.sourceByteLength,
      parserStates,
      nestingDepth: units,
      schemaNodes: 0n,
      validatorNodes: 0n,
      graphNodes,
      frontierEntries: units,
      stringBytes: input.domainByteLength,
      tableBytes: DECLARATIVE_V2_VERIFIER_PARSE_TABLE_BYTES_V1,
      canonicalBytes,
      frameBytes: canonicalBytes,
      hashBytes: canonicalBytes,
      diagnosticBytes,
      outputBytes,
      elapsedMilliseconds: 0n,
    } satisfies DeclarativeV2VerifierBudgetFrameV2);
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      if (capacity[dimension] > input.commandBudget[dimension]) {
        return yield* Result.fail(sizingIssue(
          "capacity",
          "budgetExceeded",
          dimension,
          capacity[dimension],
          input.commandBudget[dimension],
        ));
      }
    }
    return capacity;
  });
}

function captureBindings(
  value: unknown,
  path: string,
): Result.Result<
  DeclarativeV2VerifierParseCapacityBindingsV1,
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
        "capacity",
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
    return Result.fail(sizingIssue("capacity", "invalidInput", path));
  }
  const captured = Object.create(null) as Record<string, unknown>;
  try {
    if (Array.isArray(value)) {
      return Result.fail(sizingIssue("capacity", "invalidInput", path));
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) =>
        typeof key !== "string" || !keys.includes(key)
      )
    ) {
      return Result.fail(sizingIssue("capacity", "invalidInput", path));
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return Result.fail(sizingIssue(
          "capacity",
          "invalidInput",
          `${path}.${key}`,
        ));
      }
      captured[key] = descriptor.value;
    }
  } catch {
    return Result.fail(sizingIssue("capacity", "invalidInput", path));
  }
  return Result.succeed(
    Object.freeze(captured) as Readonly<Record<Keys[number], unknown>>,
  );
}

function signedInt64(
  value: unknown,
  path: string,
  positive = false,
): Result.Result<bigint, DeclarativeV2VerifierSizingV1Error> {
  if (
    typeof value !== "bigint" ||
    value < (positive ? 1n : 0n) ||
    value > MAX_SIGNED_INT64
  ) {
    return Result.fail(sizingIssue("capacity", "invalidInput", path));
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
        "capacity",
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
  const captured = captureOwnedBytes(value, 32);
  if (captured === undefined) {
    return Result.fail(sizingIssue("capacity", "invalidInput", path));
  }
  return Result.succeed(captured);
}

const copyBindings = (
  bindings: DeclarativeV2VerifierParseCapacityBindingsV1,
): DeclarativeV2VerifierParseCapacityBindingsV1 =>
  Object.freeze({
    candidateSha256: new Uint8Array(bindings.candidateSha256),
    authenticatedInputSha256: new Uint8Array(
      bindings.authenticatedInputSha256,
    ),
    rangeAndPredecessorTailsSha256: new Uint8Array(
      bindings.rangeAndPredecessorTailsSha256,
    ),
    analyzerIdentitySha256: new Uint8Array(bindings.analyzerIdentitySha256),
    verifierIdentitySha256: new Uint8Array(bindings.verifierIdentitySha256),
  });

const sameBindings = (
  left: DeclarativeV2VerifierParseCapacityBindingsV1,
  right: DeclarativeV2VerifierParseCapacityBindingsV1,
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
    : Result.fail(sizingIssue("capacity", "overflow", path));
}

function checkedSubtract(
  left: bigint,
  right: bigint,
  path: string,
): Result.Result<bigint, DeclarativeV2VerifierSizingV1Error> {
  return left >= right
    ? Result.succeed(left - right)
    : Result.fail(sizingIssue("capacity", "overflow", path));
}

function checkedMultiply(
  left: bigint,
  right: bigint,
  path: string,
): Result.Result<bigint, DeclarativeV2VerifierSizingV1Error> {
  const result = left * right;
  return result <= MAX_SIGNED_INT64
    ? Result.succeed(result)
    : Result.fail(sizingIssue("capacity", "overflow", path));
}

function captureOwnedBytes(
  value: unknown,
  expectedByteLength?: number,
): Uint8Array | undefined {
  const view = captureByteView(value, expectedByteLength);
  return view === undefined ? undefined : new Uint8Array(view);
}

function captureByteView(
  value: unknown,
  expectedByteLength?: number,
): Uint8Array | undefined {
  if (
    !isUint8Array(value) ||
    UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined ||
    UINT8_ARRAY_BUFFER_GETTER === undefined
  ) return undefined;
  try {
    const byteLength = Reflect.apply(
      UINT8_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    ) as number;
    if (
      expectedByteLength !== undefined &&
      byteLength !== expectedByteLength
    ) return undefined;
    const buffer = Reflect.apply(
      UINT8_ARRAY_BUFFER_GETTER,
      value,
      [],
    ) as ArrayBufferLike;
    if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
      try {
        Reflect.apply(
          SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER,
          buffer,
          [],
        );
        return undefined;
      } catch {
        // An intrinsic SharedArrayBuffer brand failure proves ordinary backing.
      }
    }
    const view = Reflect.apply(
      UINT8_ARRAY_SUBARRAY,
      value,
      [0, byteLength],
    ) as Uint8Array;
    return view;
  } catch {
    return undefined;
  }
}

function captureBoundedSource(
  value: unknown,
  modulePathByteLength: bigint,
): Result.Result<Uint8Array, DeclarativeV2VerifierSizingV1Error> {
  const view = captureByteView(value);
  if (view === undefined) {
    return Result.fail(sizingIssue(
      "capacity",
      "invalidInput",
      "source",
    ));
  }
  const domainByteLength = modulePathByteLength + BigInt(view.byteLength);
  if (
    domainByteLength >
      BigInt(DECLARATIVE_V2_VERIFIER_PARSE_DOMAIN_BYTE_LIMIT_V1)
  ) {
    return Result.fail(sizingIssue(
      "capacity",
      "domainLimitExceeded",
      "domainByteLength",
      domainByteLength,
      BigInt(DECLARATIVE_V2_VERIFIER_PARSE_DOMAIN_BYTE_LIMIT_V1),
    ));
  }
  return Result.succeed(new Uint8Array(view));
}
