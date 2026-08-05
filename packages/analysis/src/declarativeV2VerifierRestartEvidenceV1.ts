import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Encoding, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierRestartCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  createIncrementalCanonicalJsonByteSinkEncoderV1,
  createIncrementalCanonicalJsonDecoderV1,
  makeIncrementalCanonicalJsonByteSinkV1,
  makeIncrementalCanonicalJsonEventSinkV1,
  makeIncrementalCanonicalJsonEventSourceV1,
  makeIncrementalCanonicalJsonLimitsV1,
  type IncrementalCanonicalJsonByteSinkEncodeStepV1,
  type IncrementalCanonicalJsonDecoderV1,
  type IncrementalCanonicalJsonEventV1,
  type IncrementalCanonicalJsonIssueV1,
  type IncrementalCanonicalJsonLimitsV1,
  type IncrementalCanonicalJsonReceiptV1,
  type IncrementalCanonicalJsonSinkEventV1,
  type IncrementalCanonicalJsonUsageV1,
} from "./declarativeV2IncrementalCanonicalJsonV1";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_LENGTH_FRAMED_RECORD_BYTES = 0xffff_ffffn;
const MAX_ALLOWANCE = 1_024;
const DIGEST_BYTES = 32;
const LENGTH_PREFIX_BYTES = 4;
const EMPTY_ROOT_DOMAIN =
  "flarex.declarative-v2/verifier-restart-root/empty/v1\0";
const RECORD_ROOT_DOMAIN =
  "flarex.declarative-v2/verifier-restart-root/step/v1\0";
const MODULE_ORDER_ROOT_DOMAIN =
  "flarex.declarative-v2/verifier-module-order-root/step/v1\0";
const DIAGNOSTIC_ROOT_DOMAIN =
  "flarex.declarative-v2/verifier-restart-diagnostic-root/step/v1\0";
const FUNCTION_BODY_DOMAIN =
  "flarex.declarative-v2/verifier-restart-function-body/v1\0";
const UTF8_ENCODER = new TextEncoder();
const SHA256_INITIAL = Object.freeze([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
] as const);
const SHA256_ROUND_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const);
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;

export const DECLARATIVE_V2_VERIFIER_RESTART_EVIDENCE_IDENTITY_V1 =
  "flarex.declarative-v2/verifier-restart-evidence/v1" as const;

interface RestartRecordBaseV1 {
  readonly recordOrdinal: bigint;
}

export interface DeclarativeV2RestartModuleIdentityRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "module_identity_v1";
  readonly moduleOrdinal: bigint;
  readonly modulePath: string;
  readonly sourceSha256: Uint8Array;
  readonly sourceByteLength: bigint;
  readonly authenticatedInputSha256: Uint8Array;
}

export interface DeclarativeV2RestartStaticImportRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "static_import_v1";
  readonly moduleOrdinal: bigint;
  readonly importOrdinal: bigint;
  readonly sourceModulePath: string;
  readonly importedName: string;
  readonly localName: string;
}

export interface DeclarativeV2RestartExportBindingRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "export_binding_v1";
  readonly moduleOrdinal: bigint;
  readonly exportOrdinal: bigint;
  readonly exportName: string;
  readonly localFunctionName: string;
}

export interface DeclarativeV2RestartFunctionRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "function_v1";
  readonly moduleOrdinal: bigint;
  readonly functionOrdinal: bigint;
  readonly functionName: string;
  readonly async: boolean;
  readonly parameterCount: bigint;
  readonly bodySha256: Uint8Array;
}

export interface DeclarativeV2RestartDirectCallRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "direct_call_v1";
  readonly moduleOrdinal: bigint;
  readonly callOrdinal: bigint;
  readonly callerFunctionOrdinal: bigint;
  readonly targetKind: "local" | "artifactImport" | "platformImport" | "abi";
  readonly targetModulePath: string | null;
  readonly targetName: string;
}

export interface DeclarativeV2RestartValueFlowRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "value_flow_v1";
  readonly moduleOrdinal: bigint;
  readonly flowOrdinal: bigint;
  readonly functionOrdinal: bigint;
  readonly operationName: string;
  readonly capability: string;
  readonly catchability: "application" | "mixed" | "host";
}

export interface DeclarativeV2RestartDiagnosticRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "diagnostic_v1";
  readonly phase: "parse" | "valueFlow" | "link";
  readonly moduleOrdinal: bigint;
  readonly diagnosticOrdinal: bigint;
  readonly byteOffset: bigint;
  readonly diagnosticId: bigint;
  readonly code: string;
  readonly message: string;
}

export interface DeclarativeV2RestartResolvedEdgeRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "resolved_edge_v1";
  readonly edgeOrdinal: bigint;
  readonly sourceModuleOrdinal: bigint;
  readonly importOrdinal: bigint;
  readonly targetKind: "module" | "platform" | "abi";
  readonly targetModuleOrdinal: bigint | null;
  readonly targetFunctionOrdinal: bigint | null;
  readonly targetName: string;
}

export interface DeclarativeV2RestartModuleOrderRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "module_order_v1";
  readonly orderOrdinal: bigint;
  readonly moduleOrdinal: bigint;
}

export interface DeclarativeV2RestartCycleResultRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "cycle_result_v1";
  readonly cycleOrdinal: bigint;
  /**
   * The single graph-wide cycle result commits the complete deterministic
   * module-order sequence: moduleCount equals the number of module_order_v1
   * records and membersRootSha256 is their domain-separated rolling root.
   */
  readonly moduleCount: bigint;
  readonly membersRootSha256: Uint8Array;
  readonly accepted: boolean;
}

export interface DeclarativeV2RestartParseTerminalRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "parse_terminal_v1";
  readonly moduleOrdinal: bigint;
  readonly importCount: bigint;
  readonly exportCount: bigint;
  readonly functionCount: bigint;
  readonly callCount: bigint;
  readonly valueFlowCount: bigint;
  readonly diagnosticCount: bigint;
  readonly sourceSha256: Uint8Array;
  readonly authenticatedInputSha256: Uint8Array;
  readonly precedingRecordsRootSha256: Uint8Array;
}

export interface DeclarativeV2RestartLinkTerminalRecordV1
  extends RestartRecordBaseV1 {
  readonly kind: "link_terminal_v1";
  readonly moduleCount: bigint;
  readonly edgeCount: bigint;
  readonly orderCount: bigint;
  readonly cycleCount: bigint;
  readonly diagnosticCount: bigint;
  readonly parsePagesRootSha256: Uint8Array;
  readonly precedingRecordsRootSha256: Uint8Array;
}

export type DeclarativeV2VerifierRestartRecordV1 =
  | DeclarativeV2RestartModuleIdentityRecordV1
  | DeclarativeV2RestartStaticImportRecordV1
  | DeclarativeV2RestartExportBindingRecordV1
  | DeclarativeV2RestartFunctionRecordV1
  | DeclarativeV2RestartDirectCallRecordV1
  | DeclarativeV2RestartValueFlowRecordV1
  | DeclarativeV2RestartDiagnosticRecordV1
  | DeclarativeV2RestartResolvedEdgeRecordV1
  | DeclarativeV2RestartModuleOrderRecordV1
  | DeclarativeV2RestartCycleResultRecordV1
  | DeclarativeV2RestartParseTerminalRecordV1
  | DeclarativeV2RestartLinkTerminalRecordV1;

export type DeclarativeV2VerifierRestartEvidenceV1ErrorReason =
  | "invalidInput"
  | "invalidBudget"
  | "budgetExceeded"
  | "invalidUtf8"
  | "malformed"
  | "nonCanonical"
  | "unsupportedVersion"
  | "recordOrder"
  | "terminalMismatch"
  | "closed";

export class DeclarativeV2VerifierRestartEvidenceV1Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierRestartEvidenceV1Error",
  )<{
    readonly operation:
      | "createEncoder"
      | "step"
      | "finish"
      | "createDecoder"
      | "push"
      | "validateSequence";
    readonly reason: DeclarativeV2VerifierRestartEvidenceV1ErrorReason;
    readonly path?: string;
    readonly observed?: bigint;
    readonly maximum?: bigint;
  }> {}

export interface DeclarativeV2VerifierRestartReceiptV1 {
  readonly delta: DeclarativeV2VerifierBudgetFrameV2;
  readonly aggregate: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierRestartPendingV1 {
  readonly status: "pending";
  readonly receipt: DeclarativeV2VerifierRestartReceiptV1;
}

export interface DeclarativeV2VerifierRestartEncodedV1 {
  readonly status: "complete";
  readonly canonicalBytes: Uint8Array;
  readonly record: DeclarativeV2VerifierRestartRecordV1;
  readonly receipt: DeclarativeV2VerifierRestartReceiptV1;
}

export type DeclarativeV2VerifierRestartEncodeStepV1 =
  | DeclarativeV2VerifierRestartPendingV1
  | DeclarativeV2VerifierRestartEncodedV1;

export interface DeclarativeV2VerifierRestartEncoderV1 {
  readonly step: (
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartEncodeStepV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  >;
  readonly finish: (
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartEncodeStepV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  >;
}

export interface DeclarativeV2VerifierRestartDecodePendingV1 {
  readonly status: "pending";
  readonly consumedInputBytes: number;
  readonly receipt: DeclarativeV2VerifierRestartReceiptV1;
}

export interface DeclarativeV2VerifierRestartDecodedV1 {
  readonly status: "complete";
  readonly consumedInputBytes: number;
  readonly record: DeclarativeV2VerifierRestartRecordV1;
  readonly receipt: DeclarativeV2VerifierRestartReceiptV1;
}

export type DeclarativeV2VerifierRestartDecodeStepV1 =
  | DeclarativeV2VerifierRestartDecodePendingV1
  | DeclarativeV2VerifierRestartDecodedV1;

export interface DeclarativeV2VerifierRestartDecoderV1 {
  readonly push: (
    input: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartDecodeStepV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  >;
  readonly finish: (
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartDecodeStepV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  >;
}

export interface DeclarativeV2VerifierRestartSequenceStateV1 {
  readonly commandKind: DeclarativeV2VerifierRestartCommandKindV2;
  readonly nextRecordOrdinal: bigint;
  readonly moduleOrdinal: bigint | null;
  readonly sourceSha256: Uint8Array | null;
  readonly authenticatedInputSha256: Uint8Array | null;
  readonly precedingRecordsRootSha256: Uint8Array;
  readonly moduleOrderRootSha256: Uint8Array;
  readonly parsePagesRootSha256: Uint8Array | null;
  readonly moduleCount: bigint;
  readonly importCount: bigint;
  readonly exportCount: bigint;
  readonly functionCount: bigint;
  readonly callCount: bigint;
  readonly valueFlowCount: bigint;
  readonly diagnosticCount: bigint;
  readonly edgeCount: bigint;
  readonly orderCount: bigint;
  readonly cycleCount: bigint;
  readonly terminal: boolean;
}

type WireScalar = string | number | boolean | null;
type WireEntry = readonly [string, WireScalar];

const WIRE_KEYS = Object.freeze({
  module_identity_v1: Object.freeze([
    "authenticatedInputSha256",
    "domain",
    "kind",
    "moduleOrdinal",
    "modulePath",
    "recordOrdinal",
    "sourceByteLength",
    "sourceSha256",
    "version",
  ]),
  static_import_v1: Object.freeze([
    "domain",
    "importOrdinal",
    "importedName",
    "kind",
    "localName",
    "moduleOrdinal",
    "recordOrdinal",
    "sourceModulePath",
    "version",
  ]),
  export_binding_v1: Object.freeze([
    "domain",
    "exportName",
    "exportOrdinal",
    "kind",
    "localFunctionName",
    "moduleOrdinal",
    "recordOrdinal",
    "version",
  ]),
  function_v1: Object.freeze([
    "async",
    "bodySha256",
    "domain",
    "functionName",
    "functionOrdinal",
    "kind",
    "moduleOrdinal",
    "parameterCount",
    "recordOrdinal",
    "version",
  ]),
  direct_call_v1: Object.freeze([
    "callOrdinal",
    "callerFunctionOrdinal",
    "domain",
    "kind",
    "moduleOrdinal",
    "recordOrdinal",
    "targetKind",
    "targetModulePath",
    "targetName",
    "version",
  ]),
  value_flow_v1: Object.freeze([
    "capability",
    "catchability",
    "domain",
    "flowOrdinal",
    "functionOrdinal",
    "kind",
    "moduleOrdinal",
    "operationName",
    "recordOrdinal",
    "version",
  ]),
  diagnostic_v1: Object.freeze([
    "byteOffset",
    "code",
    "diagnosticId",
    "diagnosticOrdinal",
    "domain",
    "kind",
    "message",
    "moduleOrdinal",
    "phase",
    "recordOrdinal",
    "version",
  ]),
  resolved_edge_v1: Object.freeze([
    "domain",
    "edgeOrdinal",
    "importOrdinal",
    "kind",
    "recordOrdinal",
    "sourceModuleOrdinal",
    "targetFunctionOrdinal",
    "targetKind",
    "targetModuleOrdinal",
    "targetName",
    "version",
  ]),
  module_order_v1: Object.freeze([
    "domain",
    "kind",
    "moduleOrdinal",
    "orderOrdinal",
    "recordOrdinal",
    "version",
  ]),
  cycle_result_v1: Object.freeze([
    "accepted",
    "cycleOrdinal",
    "domain",
    "kind",
    "membersRootSha256",
    "moduleCount",
    "recordOrdinal",
    "version",
  ]),
  parse_terminal_v1: Object.freeze([
    "authenticatedInputSha256",
    "callCount",
    "diagnosticCount",
    "domain",
    "exportCount",
    "functionCount",
    "importCount",
    "kind",
    "moduleOrdinal",
    "precedingRecordsRootSha256",
    "recordOrdinal",
    "sourceSha256",
    "valueFlowCount",
    "version",
  ]),
  link_terminal_v1: Object.freeze([
    "cycleCount",
    "diagnosticCount",
    "domain",
    "edgeCount",
    "kind",
    "moduleCount",
    "orderCount",
    "parsePagesRootSha256",
    "precedingRecordsRootSha256",
    "recordOrdinal",
    "version",
  ]),
} as const);

type RecordKind = keyof typeof WIRE_KEYS;

function restartError(
  operation: DeclarativeV2VerifierRestartEvidenceV1Error["operation"],
  reason: DeclarativeV2VerifierRestartEvidenceV1ErrorReason,
  evidence?: Readonly<{
    readonly path?: string;
    readonly observed?: bigint;
    readonly maximum?: bigint;
  }>,
): DeclarativeV2VerifierRestartEvidenceV1Error {
  return new DeclarativeV2VerifierRestartEvidenceV1Error({
    operation,
    reason,
    ...(evidence?.path === undefined ? {} : { path: evidence.path }),
    ...(evidence?.observed === undefined
      ? {}
      : { observed: evidence.observed }),
    ...(evidence?.maximum === undefined
      ? {}
      : { maximum: evidence.maximum }),
  });
}

function captureOwnDataRecord(
  input: unknown,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length > 32) return undefined;
    const captured: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of keys) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      captured[key] = descriptor.value;
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function hasExactKeys(
  input: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(input);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key));
}

function isU64(value: unknown): value is bigint {
  return typeof value === "bigint" &&
    value >= 0n &&
    value <= MAX_SIGNED_INT64;
}

function isDigest(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(value, DIGEST_BYTES);
}

function copyDigest(value: unknown): Uint8Array | undefined {
  if (!isDigest(value)) return undefined;
  try {
    return new Uint8Array(value);
  } catch {
    return undefined;
  }
}

function isWellFormedNonemptyText(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function ownRecord(
  input: unknown,
): DeclarativeV2VerifierRestartRecordV1 | undefined {
  const captured = captureOwnDataRecord(input);
  if (captured === undefined || typeof captured.kind !== "string") {
    return undefined;
  }
  const kind = captured.kind as RecordKind;
  const keys = WIRE_KEYS[kind];
  if (keys === undefined) return undefined;
  const domainKeys = keys.filter((key) =>
    key !== "domain" && key !== "version"
  );
  if (!hasExactKeys(captured, ["kind", ...domainKeys.filter((key) => key !== "kind")])) {
    return undefined;
  }
  const recordOrdinal = captured.recordOrdinal;
  if (!isU64(recordOrdinal)) return undefined;
  const copy = (field: string): Uint8Array | undefined =>
    copyDigest(captured[field]);
  const text = (field: string): string | undefined =>
    isWellFormedNonemptyText(captured[field])
      ? captured[field] as string
      : undefined;
  const u64 = (field: string): bigint | undefined =>
    isU64(captured[field]) ? captured[field] as bigint : undefined;
  const base = { recordOrdinal };
  switch (kind) {
    case "module_identity_v1": {
      const modulePath = text("modulePath");
      const sourceSha256 = copy("sourceSha256");
      const authenticatedInputSha256 = copy("authenticatedInputSha256");
      const moduleOrdinal = u64("moduleOrdinal");
      const sourceByteLength = u64("sourceByteLength");
      return modulePath !== undefined &&
          sourceSha256 !== undefined &&
          authenticatedInputSha256 !== undefined &&
          moduleOrdinal !== undefined &&
          sourceByteLength !== undefined
        ? Object.freeze({
          ...base,
          kind,
          moduleOrdinal,
          modulePath,
          sourceSha256,
          sourceByteLength,
          authenticatedInputSha256,
        })
        : undefined;
    }
    case "static_import_v1": {
      const moduleOrdinal = u64("moduleOrdinal");
      const importOrdinal = u64("importOrdinal");
      const sourceModulePath = text("sourceModulePath");
      const importedName = text("importedName");
      const localName = text("localName");
      return moduleOrdinal !== undefined &&
          importOrdinal !== undefined &&
          sourceModulePath !== undefined &&
          importedName !== undefined &&
          localName !== undefined
        ? Object.freeze({
          ...base,
          kind,
          moduleOrdinal,
          importOrdinal,
          sourceModulePath,
          importedName,
          localName,
        })
        : undefined;
    }
    case "export_binding_v1": {
      const moduleOrdinal = u64("moduleOrdinal");
      const exportOrdinal = u64("exportOrdinal");
      const exportName = text("exportName");
      const localFunctionName = text("localFunctionName");
      return moduleOrdinal !== undefined &&
          exportOrdinal !== undefined &&
          exportName !== undefined &&
          localFunctionName !== undefined
        ? Object.freeze({
          ...base,
          kind,
          moduleOrdinal,
          exportOrdinal,
          exportName,
          localFunctionName,
        })
        : undefined;
    }
    case "function_v1": {
      const moduleOrdinal = u64("moduleOrdinal");
      const functionOrdinal = u64("functionOrdinal");
      const functionName = text("functionName");
      const parameterCount = u64("parameterCount");
      const bodySha256 = copy("bodySha256");
      return moduleOrdinal !== undefined &&
          functionOrdinal !== undefined &&
          functionName !== undefined &&
          parameterCount !== undefined &&
          bodySha256 !== undefined &&
          typeof captured.async === "boolean"
        ? Object.freeze({
          ...base,
          kind,
          moduleOrdinal,
          functionOrdinal,
          functionName,
          async: captured.async,
          parameterCount,
          bodySha256,
        })
        : undefined;
    }
    case "direct_call_v1": {
      const moduleOrdinal = u64("moduleOrdinal");
      const callOrdinal = u64("callOrdinal");
      const callerFunctionOrdinal = u64("callerFunctionOrdinal");
      const targetName = text("targetName");
      const targetModulePath = captured.targetModulePath === null
        ? null
        : text("targetModulePath");
      const targetKind = captured.targetKind;
      return moduleOrdinal !== undefined &&
          callOrdinal !== undefined &&
          callerFunctionOrdinal !== undefined &&
          targetName !== undefined &&
          targetModulePath !== undefined &&
          (
            targetKind === "local" ||
            targetKind === "artifactImport" ||
            targetKind === "platformImport" ||
            targetKind === "abi"
          ) &&
          (
            (targetKind === "artifactImport" &&
              targetModulePath !== null) ||
            (targetKind !== "artifactImport" &&
              targetModulePath === null)
          )
        ? Object.freeze({
          ...base,
          kind,
          moduleOrdinal,
          callOrdinal,
          callerFunctionOrdinal,
          targetKind,
          targetModulePath,
          targetName,
        })
        : undefined;
    }
    case "value_flow_v1": {
      const moduleOrdinal = u64("moduleOrdinal");
      const flowOrdinal = u64("flowOrdinal");
      const functionOrdinal = u64("functionOrdinal");
      const operationName = text("operationName");
      const capability = text("capability");
      const catchability = captured.catchability;
      return moduleOrdinal !== undefined &&
          flowOrdinal !== undefined &&
          functionOrdinal !== undefined &&
          operationName !== undefined &&
          capability !== undefined &&
          (
            catchability === "application" ||
            catchability === "mixed" ||
            catchability === "host"
          )
        ? Object.freeze({
          ...base,
          kind,
          moduleOrdinal,
          flowOrdinal,
          functionOrdinal,
          operationName,
          capability,
          catchability,
        })
        : undefined;
    }
    case "diagnostic_v1": {
      const moduleOrdinal = u64("moduleOrdinal");
      const diagnosticOrdinal = u64("diagnosticOrdinal");
      const byteOffset = u64("byteOffset");
      const diagnosticId = u64("diagnosticId");
      const code = text("code");
      const message = text("message");
      const phase = captured.phase;
      return moduleOrdinal !== undefined &&
          diagnosticOrdinal !== undefined &&
          byteOffset !== undefined &&
          diagnosticId !== undefined &&
          code !== undefined &&
          message !== undefined &&
          (phase === "parse" || phase === "valueFlow" || phase === "link")
        ? Object.freeze({
          ...base,
          kind,
          phase,
          moduleOrdinal,
          diagnosticOrdinal,
          byteOffset,
          diagnosticId,
          code,
          message,
        })
        : undefined;
    }
    case "resolved_edge_v1": {
      const edgeOrdinal = u64("edgeOrdinal");
      const sourceModuleOrdinal = u64("sourceModuleOrdinal");
      const importOrdinal = u64("importOrdinal");
      const targetModuleOrdinal = captured.targetModuleOrdinal === null
        ? null
        : u64("targetModuleOrdinal");
      const targetFunctionOrdinal = captured.targetFunctionOrdinal === null
        ? null
        : u64("targetFunctionOrdinal");
      const targetName = text("targetName");
      const targetKind = captured.targetKind;
      return edgeOrdinal !== undefined &&
          sourceModuleOrdinal !== undefined &&
          importOrdinal !== undefined &&
          targetModuleOrdinal !== undefined &&
          targetFunctionOrdinal !== undefined &&
          targetName !== undefined &&
          (
            targetKind === "module" ||
            targetKind === "platform" ||
            targetKind === "abi"
          ) &&
          (
            (targetKind === "module" &&
              targetModuleOrdinal !== null &&
              targetFunctionOrdinal !== null) ||
            (targetKind !== "module" &&
              targetModuleOrdinal === null &&
              targetFunctionOrdinal === null)
          )
        ? Object.freeze({
          ...base,
          kind,
          edgeOrdinal,
          sourceModuleOrdinal,
          importOrdinal,
          targetKind,
          targetModuleOrdinal,
          targetFunctionOrdinal,
          targetName,
        })
        : undefined;
    }
    case "module_order_v1": {
      const orderOrdinal = u64("orderOrdinal");
      const moduleOrdinal = u64("moduleOrdinal");
      return orderOrdinal !== undefined && moduleOrdinal !== undefined
        ? Object.freeze({ ...base, kind, orderOrdinal, moduleOrdinal })
        : undefined;
    }
    case "cycle_result_v1": {
      const cycleOrdinal = u64("cycleOrdinal");
      const moduleCount = u64("moduleCount");
      const membersRootSha256 = copy("membersRootSha256");
      return cycleOrdinal !== undefined &&
          moduleCount !== undefined &&
          membersRootSha256 !== undefined &&
          typeof captured.accepted === "boolean"
        ? Object.freeze({
          ...base,
          kind,
          cycleOrdinal,
          moduleCount,
          membersRootSha256,
          accepted: captured.accepted,
        })
        : undefined;
    }
    case "parse_terminal_v1": {
      const fields = [
        "moduleOrdinal",
        "importCount",
        "exportCount",
        "functionCount",
        "callCount",
        "valueFlowCount",
        "diagnosticCount",
      ] as const;
      const values = Object.fromEntries(fields.map((field) => [field, u64(field)]));
      const sourceSha256 = copy("sourceSha256");
      const authenticatedInputSha256 = copy("authenticatedInputSha256");
      const precedingRecordsRootSha256 = copy("precedingRecordsRootSha256");
      return fields.every((field) => values[field] !== undefined) &&
          sourceSha256 !== undefined &&
          authenticatedInputSha256 !== undefined &&
          precedingRecordsRootSha256 !== undefined
        ? Object.freeze({
          ...base,
          kind,
          moduleOrdinal: values.moduleOrdinal!,
          importCount: values.importCount!,
          exportCount: values.exportCount!,
          functionCount: values.functionCount!,
          callCount: values.callCount!,
          valueFlowCount: values.valueFlowCount!,
          diagnosticCount: values.diagnosticCount!,
          sourceSha256,
          authenticatedInputSha256,
          precedingRecordsRootSha256,
        })
        : undefined;
    }
    case "link_terminal_v1": {
      const fields = [
        "moduleCount",
        "edgeCount",
        "orderCount",
        "cycleCount",
        "diagnosticCount",
      ] as const;
      const values = Object.fromEntries(fields.map((field) => [field, u64(field)]));
      const parsePagesRootSha256 = copy("parsePagesRootSha256");
      const precedingRecordsRootSha256 = copy("precedingRecordsRootSha256");
      return fields.every((field) => values[field] !== undefined) &&
          parsePagesRootSha256 !== undefined &&
          precedingRecordsRootSha256 !== undefined
        ? Object.freeze({
          ...base,
          kind,
          moduleCount: values.moduleCount!,
          edgeCount: values.edgeCount!,
          orderCount: values.orderCount!,
          cycleCount: values.cycleCount!,
          diagnosticCount: values.diagnosticCount!,
          parsePagesRootSha256,
          precedingRecordsRootSha256,
        })
        : undefined;
    }
  }
}

function decimal(value: bigint): string {
  return value.toString(10);
}

function hex(value: Uint8Array): string {
  return Encoding.encodeHex(value);
}

function entriesForRecord(
  record: DeclarativeV2VerifierRestartRecordV1,
): readonly WireEntry[] {
  const common = {
    domain: DECLARATIVE_V2_VERIFIER_RESTART_EVIDENCE_IDENTITY_V1,
    kind: record.kind,
    recordOrdinal: decimal(record.recordOrdinal),
    version: 1,
  };
  const values: Readonly<Record<string, WireScalar>> = (() => {
    switch (record.kind) {
      case "module_identity_v1":
        return {
          ...common,
          authenticatedInputSha256: hex(record.authenticatedInputSha256),
          moduleOrdinal: decimal(record.moduleOrdinal),
          modulePath: record.modulePath,
          sourceByteLength: decimal(record.sourceByteLength),
          sourceSha256: hex(record.sourceSha256),
        };
      case "static_import_v1":
        return {
          ...common,
          importOrdinal: decimal(record.importOrdinal),
          importedName: record.importedName,
          localName: record.localName,
          moduleOrdinal: decimal(record.moduleOrdinal),
          sourceModulePath: record.sourceModulePath,
        };
      case "export_binding_v1":
        return {
          ...common,
          exportName: record.exportName,
          exportOrdinal: decimal(record.exportOrdinal),
          localFunctionName: record.localFunctionName,
          moduleOrdinal: decimal(record.moduleOrdinal),
        };
      case "function_v1":
        return {
          ...common,
          async: record.async,
          bodySha256: hex(record.bodySha256),
          functionName: record.functionName,
          functionOrdinal: decimal(record.functionOrdinal),
          moduleOrdinal: decimal(record.moduleOrdinal),
          parameterCount: decimal(record.parameterCount),
        };
      case "direct_call_v1":
        return {
          ...common,
          callOrdinal: decimal(record.callOrdinal),
          callerFunctionOrdinal: decimal(record.callerFunctionOrdinal),
          moduleOrdinal: decimal(record.moduleOrdinal),
          targetKind: record.targetKind,
          targetModulePath: record.targetModulePath,
          targetName: record.targetName,
        };
      case "value_flow_v1":
        return {
          ...common,
          capability: record.capability,
          catchability: record.catchability,
          flowOrdinal: decimal(record.flowOrdinal),
          functionOrdinal: decimal(record.functionOrdinal),
          moduleOrdinal: decimal(record.moduleOrdinal),
          operationName: record.operationName,
        };
      case "diagnostic_v1":
        return {
          ...common,
          byteOffset: decimal(record.byteOffset),
          code: record.code,
          diagnosticId: decimal(record.diagnosticId),
          diagnosticOrdinal: decimal(record.diagnosticOrdinal),
          message: record.message,
          moduleOrdinal: decimal(record.moduleOrdinal),
          phase: record.phase,
        };
      case "resolved_edge_v1":
        return {
          ...common,
          edgeOrdinal: decimal(record.edgeOrdinal),
          importOrdinal: decimal(record.importOrdinal),
          sourceModuleOrdinal: decimal(record.sourceModuleOrdinal),
          targetFunctionOrdinal: record.targetFunctionOrdinal === null
            ? null
            : decimal(record.targetFunctionOrdinal),
          targetKind: record.targetKind,
          targetModuleOrdinal: record.targetModuleOrdinal === null
            ? null
            : decimal(record.targetModuleOrdinal),
          targetName: record.targetName,
        };
      case "module_order_v1":
        return {
          ...common,
          moduleOrdinal: decimal(record.moduleOrdinal),
          orderOrdinal: decimal(record.orderOrdinal),
        };
      case "cycle_result_v1":
        return {
          ...common,
          accepted: record.accepted,
          cycleOrdinal: decimal(record.cycleOrdinal),
          membersRootSha256: hex(record.membersRootSha256),
          moduleCount: decimal(record.moduleCount),
        };
      case "parse_terminal_v1":
        return {
          ...common,
          authenticatedInputSha256: hex(record.authenticatedInputSha256),
          callCount: decimal(record.callCount),
          diagnosticCount: decimal(record.diagnosticCount),
          exportCount: decimal(record.exportCount),
          functionCount: decimal(record.functionCount),
          importCount: decimal(record.importCount),
          moduleOrdinal: decimal(record.moduleOrdinal),
          precedingRecordsRootSha256: hex(record.precedingRecordsRootSha256),
          sourceSha256: hex(record.sourceSha256),
          valueFlowCount: decimal(record.valueFlowCount),
        };
      case "link_terminal_v1":
        return {
          ...common,
          cycleCount: decimal(record.cycleCount),
          diagnosticCount: decimal(record.diagnosticCount),
          edgeCount: decimal(record.edgeCount),
          moduleCount: decimal(record.moduleCount),
          orderCount: decimal(record.orderCount),
          parsePagesRootSha256: hex(record.parsePagesRootSha256),
          precedingRecordsRootSha256: hex(record.precedingRecordsRootSha256),
        };
    }
  })();
  return Object.freeze(
    WIRE_KEYS[record.kind].map((key) =>
      Object.freeze([key, values[key]!] as const)
    ),
  );
}

function createEventSource(
  entries: readonly WireEntry[],
) {
  let phase:
    | "objectStart"
    | "keyStart"
    | "keyScalar"
    | "value"
    | "valueScalar"
    | "objectEnd"
    | "end"
    | "closed" = "objectStart";
  let entryIndex = 0;
  let text = "";
  let textIndex = 0;
  let role: "key" | "value" = "key";
  return makeIncrementalCanonicalJsonEventSourceV1((): IncrementalCanonicalJsonEventV1 => {
    switch (phase) {
      case "objectStart":
        phase = "keyStart";
        return { kind: "objectStart" };
      case "keyStart":
        text = entries[entryIndex]![0];
        textIndex = 0;
        role = "key";
        phase = "keyScalar";
        return { kind: "stringStart", role };
      case "keyScalar":
      case "valueScalar": {
        if (textIndex >= text.length) {
          const closingRole = role;
          phase = closingRole === "key" ? "value" : (
            entryIndex + 1 < entries.length ? "keyStart" : "objectEnd"
          );
          if (closingRole === "value") entryIndex += 1;
          return { kind: "stringEnd", role: closingRole };
        }
        const codePoint = text.codePointAt(textIndex)!;
        const value = String.fromCodePoint(codePoint);
        textIndex += value.length;
        return { kind: "stringScalar", role, value, codePoint };
      }
      case "value": {
        const value = entries[entryIndex]![1];
        if (typeof value === "string") {
          text = value;
          textIndex = 0;
          role = "value";
          phase = "valueScalar";
          return { kind: "stringStart", role };
        }
        phase = entryIndex + 1 < entries.length ? "keyStart" : "objectEnd";
        entryIndex += 1;
        return value === null
          ? { kind: "null" }
          : typeof value === "boolean"
          ? { kind: "boolean", value }
          : { kind: "number", value };
      }
      case "objectEnd":
        phase = "end";
        return { kind: "objectEnd" };
      case "end":
        phase = "closed";
        return { kind: "end" };
      case "closed":
        throw new Error("restart evidence source was pulled after end");
    }
  });
}

function createFlatObjectSink(): Readonly<{
  readonly sink: ReturnType<typeof makeIncrementalCanonicalJsonEventSinkV1>;
  readonly value: () => Readonly<Record<string, unknown>> | undefined;
  readonly kind: () => string | undefined;
  readonly invalid: () => boolean;
}> {
  const value: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  let started = false;
  let complete = false;
  let currentKey: string | undefined;
  let role: "key" | "value" | undefined;
  let text = "";
  let invalidShape = false;
  let observedKind: string | undefined;
  const sink = makeIncrementalCanonicalJsonEventSinkV1(
    (event: IncrementalCanonicalJsonSinkEventV1): void => {
      switch (event.kind) {
        case "objectStart":
          if (started || complete || role !== undefined) {
            invalidShape = true;
          }
          started = true;
          return;
        case "objectEnd":
          if (!started || currentKey !== undefined || role !== undefined) {
            invalidShape = true;
          }
          complete = true;
          return;
        case "arrayStart":
        case "arrayEnd":
        case "arrayLengthFinalize":
          invalidShape = true;
          return;
        case "stringStart":
          if (!started || complete || role !== undefined) {
            invalidShape = true;
          }
          role = event.role;
          text = "";
          return;
        case "stringScalar":
          if (role !== event.role) {
            invalidShape = true;
            return;
          }
          text += event.value;
          return;
        case "stringEnd": {
          if (role !== event.role) {
            invalidShape = true;
            role = undefined;
            text = "";
            return;
          }
          const captured = text;
          role = undefined;
          text = "";
          if (event.role === "key") {
            if (currentKey !== undefined) invalidShape = true;
            currentKey = captured;
          } else {
            if (currentKey === undefined) {
              invalidShape = true;
              return;
            }
            value[currentKey] = captured;
            if (currentKey === "kind") observedKind = captured;
            currentKey = undefined;
          }
          return;
        }
        case "null":
        case "boolean":
        case "number":
          if (currentKey === undefined || !started || complete) {
            invalidShape = true;
            return;
          }
          value[currentKey] = event.kind === "null" ? null : event.value;
          currentKey = undefined;
          return;
        case "memberFinalize":
          return;
        case "containerSeal":
          if (event.container !== "object") {
            invalidShape = true;
            return;
          }
          Object.freeze(value);
          return;
      }
    },
  );
  return Object.freeze({
    sink,
    value: () => complete && !invalidShape ? value : undefined,
    kind: () => observedKind,
    invalid: () => invalidShape,
  });
}

function parseDecimal(value: unknown): bigint | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 19 ||
    !/^(?:0|[1-9][0-9]*)$/u.test(value)
  ) {
    return undefined;
  }
  const parsed = BigInt(value);
  return parsed <= MAX_SIGNED_INT64 ? parsed : undefined;
}

function parseDigest(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    return undefined;
  }
  const decoded = Encoding.decodeHex(value);
  return Result.isSuccess(decoded) && isDigest(decoded.success)
    ? new Uint8Array(decoded.success)
    : undefined;
}

function parsedRecord(
  input: Readonly<Record<string, unknown>>,
): DeclarativeV2VerifierRestartRecordV1 | undefined {
  if (
    input.domain !== DECLARATIVE_V2_VERIFIER_RESTART_EVIDENCE_IDENTITY_V1 ||
    input.version !== 1 ||
    typeof input.kind !== "string"
  ) {
    return undefined;
  }
  const kind = input.kind as RecordKind;
  const keys = WIRE_KEYS[kind];
  if (keys === undefined || !hasExactKeys(input, keys)) return undefined;
  const converted: Record<string, unknown> = { kind };
  for (const [key, value] of Object.entries(input)) {
    if (key === "domain" || key === "version" || key === "kind") continue;
    if (
      key.endsWith("Sha256")
    ) {
      converted[key] = parseDigest(value);
    } else if (
      key.endsWith("Ordinal") ||
      key.endsWith("Count") ||
      key === "sourceByteLength" ||
      key === "byteOffset" ||
      key === "diagnosticId"
    ) {
      converted[key] = value === null ? null : parseDecimal(value);
    } else {
      converted[key] = value;
    }
  }
  return ownRecord(converted);
}

function captureBudget(
  input: unknown,
): DeclarativeV2VerifierBudgetFrameV2 | undefined {
  const captured = captureOwnDataRecord(input);
  if (
    captured === undefined ||
    captured.kind !== "command_budget" ||
    !hasExactKeys(captured, [
      "kind",
      ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
    ])
  ) {
    return undefined;
  }
  const result: Record<string, bigint | string> = {
    kind: "command_budget",
  };
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    const value = captured[dimension];
    if (!isU64(value)) return undefined;
    result[dimension] = value;
  }
  return Object.freeze(result) as DeclarativeV2VerifierBudgetFrameV2;
}

function safeNumber(value: bigint): number | undefined {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function perRecordCodecLimit(value: bigint): number {
  return Number(
    value > MAX_LENGTH_FRAMED_RECORD_BYTES
      ? MAX_LENGTH_FRAMED_RECORD_BYTES
      : value,
  );
}

function makeJsonLimits(
  budget: DeclarativeV2VerifierBudgetFrameV2,
  operation: "createEncoder" | "createDecoder",
): Result.Result<
  IncrementalCanonicalJsonLimitsV1,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  // Command budgets are aggregate bigint ceilings. The restart record framing
  // and incremental JSON codec are individually u32-addressed, so constrain
  // only their per-record mechanics while cumulative charging continues to use
  // the original budget values.
  const maximumFrameBytes = perRecordCodecLimit(budget.frameBytes);
  const maximumCanonicalBytes = perRecordCodecLimit(budget.canonicalBytes);
  const maximumStringBytes = perRecordCodecLimit(budget.stringBytes);
  const maximumMembers = perRecordCodecLimit(budget.graphNodes);
  const maximumDepth = perRecordCodecLimit(budget.nestingDepth);
  const maximumTokenBytes = perRecordCodecLimit(budget.tokenBytes);
  const maximumOutputBytes = perRecordCodecLimit(budget.outputBytes);
  if (
    maximumFrameBytes < LENGTH_PREFIX_BYTES ||
    maximumCanonicalBytes < LENGTH_PREFIX_BYTES ||
    (
      operation === "createEncoder" &&
      maximumOutputBytes < LENGTH_PREFIX_BYTES
    )
  ) {
    return Result.fail(restartError(operation, "invalidBudget"));
  }
  const maximumPayloadBytes = operation === "createEncoder"
    ? Math.min(
      maximumFrameBytes,
      maximumCanonicalBytes,
      maximumOutputBytes,
    ) - LENGTH_PREFIX_BYTES
    : Math.min(
      maximumFrameBytes,
      maximumCanonicalBytes,
      maximumTokenBytes + LENGTH_PREFIX_BYTES,
    ) - LENGTH_PREFIX_BYTES;
  const result = makeIncrementalCanonicalJsonLimitsV1(
    maximumPayloadBytes,
    maximumPayloadBytes,
    maximumStringBytes,
    maximumMembers,
    maximumDepth,
  );
  return Result.mapError(result, issue => mapJsonIssue(operation, issue));
}

function zeroUsage(
  kind: "attempt_usage" | "command_budget",
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind,
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
        dimension,
        0n,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function recordSemanticUsageForKind(
  kind: DeclarativeV2VerifierRestartRecordV1["kind"] | undefined,
  frameBytes = 0,
): Readonly<Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>>> {
  switch (kind) {
    case "module_identity_v1":
      return { modules: 1n };
    case "static_import_v1":
    case "resolved_edge_v1":
      return { importEdges: 1n };
    case "export_binding_v1":
      return { exports: 1n };
    case "function_v1":
      return { functions: 1n };
    case "diagnostic_v1":
      return { diagnosticBytes: BigInt(frameBytes) };
    default:
      return {};
  }
}

function recordSemanticUsage(
  record: DeclarativeV2VerifierRestartRecordV1 | undefined,
  frameBytes: number,
): Readonly<Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>>> {
  return recordSemanticUsageForKind(record?.kind, frameBytes);
}

function capturedRecordKind(
  value: string | undefined,
): DeclarativeV2VerifierRestartRecordV1["kind"] | undefined {
  return value !== undefined &&
      Object.prototype.hasOwnProperty.call(WIRE_KEYS, value)
    ? value as DeclarativeV2VerifierRestartRecordV1["kind"]
    : undefined;
}

function mappedUsage(
  operation: "encode" | "decode",
  mechanical: IncrementalCanonicalJsonUsageV1,
  frameBytes: number,
  record: DeclarativeV2VerifierRestartRecordV1 | undefined,
  materializedOutputBytes = operation === "encode" ? frameBytes : 0,
): DeclarativeV2VerifierBudgetFrameV2 {
  const frame = BigInt(frameBytes);
  const mapped: Partial<
    Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>
  > = {
    calls: BigInt(mechanical.transitions),
    frameBytes: frame,
    canonicalBytes: frame,
    stringBytes: BigInt(mechanical.stringBytes),
    graphNodes: BigInt(mechanical.members),
    nestingDepth: BigInt(mechanical.depth),
    outputBytes: BigInt(materializedOutputBytes),
    tokenBytes: operation === "decode"
      ? BigInt(mechanical.inputBytes)
      : 0n,
    ...recordSemanticUsage(record, frameBytes),
  };
  return Object.freeze({
    ...zeroUsage("attempt_usage"),
    ...mapped,
  });
}

function usageReceipt(
  previous: DeclarativeV2VerifierBudgetFrameV2,
  aggregate: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierRestartReceiptV1 {
  const delta = Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
      dimension,
      aggregate[dimension] >= previous[dimension]
        ? aggregate[dimension] - previous[dimension]
        : 0n,
    ]),
  );
  return Object.freeze({
    delta: Object.freeze({
      kind: "attempt_usage",
      ...delta,
    }) as DeclarativeV2VerifierBudgetFrameV2,
    aggregate,
  });
}

function checkUsage(
  operation: DeclarativeV2VerifierRestartEvidenceV1Error["operation"],
  usage: DeclarativeV2VerifierBudgetFrameV2,
  maximum: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierRestartEvidenceV1Error | undefined {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (usage[dimension] > maximum[dimension]) {
      return restartError(operation, "budgetExceeded", {
        path: dimension,
        observed: usage[dimension],
        maximum: maximum[dimension],
      });
    }
  }
  return undefined;
}

function mapJsonIssue(
  operation: DeclarativeV2VerifierRestartEvidenceV1Error["operation"],
  issue: IncrementalCanonicalJsonIssueV1,
): DeclarativeV2VerifierRestartEvidenceV1Error {
  switch (issue.reason) {
    case "invalidUtf8":
      return restartError(operation, "invalidUtf8");
    case "budgetExceeded":
      return restartError(operation, "budgetExceeded", {
        ...(issue.dimension === undefined ? {} : { path: issue.dimension }),
        ...(issue.observed === undefined
          ? {}
          : { observed: BigInt(issue.observed) }),
        ...(issue.maximum === undefined
          ? {}
          : { maximum: BigInt(issue.maximum) }),
      });
    case "closed":
      return restartError(operation, "closed");
    case "malformed":
      return restartError(operation, "malformed");
    case "invalidBudget":
      return restartError(operation, "invalidBudget");
    case "invalidInput":
      return restartError(operation, "invalidInput");
  }
}

function allowanceValue(value: unknown): number | undefined {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= MAX_ALLOWANCE
    ? value
    : undefined;
}

export function createDeclarativeV2VerifierRestartRecordEncoderV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierRestartEncoderV1,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  const record = ownRecord(input);
  const budget = captureBudget(rawBudget);
  if (record === undefined) {
    return Result.fail(restartError("createEncoder", "invalidInput"));
  }
  if (budget === undefined) {
    return Result.fail(restartError("createEncoder", "invalidBudget"));
  }
  const limits = makeJsonLimits(budget, "createEncoder");
  if (Result.isFailure(limits)) return Result.fail(limits.failure);
  const semanticAdmission = Object.freeze({
    ...zeroUsage("attempt_usage"),
    ...recordSemanticUsage(record, 0),
  }) as DeclarativeV2VerifierBudgetFrameV2;
  const semanticExceeded = checkUsage(
    "createEncoder",
    semanticAdmission,
    budget,
  );
  if (semanticExceeded !== undefined) {
    return Result.fail(semanticExceeded);
  }
  const maximumFrameBytes = Math.min(
    perRecordCodecLimit(budget.frameBytes),
    perRecordCodecLimit(budget.canonicalBytes),
    perRecordCodecLimit(budget.outputBytes),
  );
  const sizingSink = makeIncrementalCanonicalJsonByteSinkV1(() => undefined);
  const created = createIncrementalCanonicalJsonByteSinkEncoderV1(
    createEventSource(entriesForRecord(record)),
    sizingSink,
    limits.success,
  );
  if (Result.isFailure(created)) {
    return Result.fail(mapJsonIssue("createEncoder", created.failure));
  }
  let terminal:
    | DeclarativeV2VerifierRestartEvidenceV1Error
    | DeclarativeV2VerifierRestartEncodedV1
    | undefined;
  let payloadLength: number | undefined;
  let exactOutput: Uint8Array | undefined;
  let writing:
    | typeof created.success
    | undefined;
  let writingComplete = false;
  let prefixWritten = 0;
  let allocationTransitions = 0;
  let previousUsage = zeroUsage("attempt_usage");
  let sizingMechanical: IncrementalCanonicalJsonReceiptV1 | undefined;
  let writingMechanical: IncrementalCanonicalJsonReceiptV1 | undefined;

  const combinedMechanical = (): IncrementalCanonicalJsonUsageV1 => {
    const sizing = sizingMechanical?.aggregate;
    const output = writingMechanical?.aggregate;
    return {
      inputBytes: (sizing?.inputBytes ?? 0) + (output?.inputBytes ?? 0),
      canonicalBytes:
        (sizing?.canonicalBytes ?? 0) + (output?.canonicalBytes ?? 0),
      stringBytes: (sizing?.stringBytes ?? 0) + (output?.stringBytes ?? 0),
      members: (sizing?.members ?? 0) + (output?.members ?? 0),
      depth: Math.max(sizing?.depth ?? 0, output?.depth ?? 0),
      transitions:
        (sizing?.transitions ?? 0) +
        (output?.transitions ?? 0) +
        allocationTransitions +
        prefixWritten,
    };
  };

  const advance = (
    operation: "step" | "finish",
    allowance: unknown,
  ): Result.Result<
    DeclarativeV2VerifierRestartEncodeStepV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  > => {
    if (terminal !== undefined) {
      return Result.fail(
        terminal instanceof DeclarativeV2VerifierRestartEvidenceV1Error
          ? terminal
          : restartError(operation, "closed"),
      );
    }
    const maximumTransitions = allowanceValue(allowance);
    if (maximumTransitions === undefined) {
      terminal = restartError(operation, "invalidBudget", {
        path: "allowance",
      });
      return Result.fail(terminal);
    }
    const usedCalls = combinedMechanical().transitions;
    const remainingCalls = budget.calls - BigInt(usedCalls);
    if (remainingCalls <= 0n && maximumTransitions > 0) {
      terminal = restartError(operation, "budgetExceeded", {
        path: "calls",
        observed: BigInt(usedCalls + 1),
        maximum: budget.calls,
      });
      return Result.fail(terminal);
    }
    const admittedTransitions = Math.min(
      maximumTransitions,
      Number(remainingCalls),
    );
    let remaining = admittedTransitions;
    if (payloadLength === undefined && remaining > 0) {
      const progressed = operation === "step"
        ? created.success.step(remaining)
        : created.success.finish(remaining);
      if (Result.isFailure(progressed)) {
        terminal = mapJsonIssue(operation, progressed.failure);
        return Result.fail(terminal);
      }
      sizingMechanical = progressed.success.receipt;
      remaining -= progressed.success.receipt.delta.transitions;
      if (progressed.success.status === "complete") {
        payloadLength = progressed.success.canonicalByteLength;
        if (
          record.kind === "diagnostic_v1" &&
          BigInt(LENGTH_PREFIX_BYTES + payloadLength) >
            budget.diagnosticBytes
        ) {
          terminal = restartError(operation, "budgetExceeded", {
            path: "diagnosticBytes",
            observed: BigInt(LENGTH_PREFIX_BYTES + payloadLength),
            maximum: budget.diagnosticBytes,
          });
          return Result.fail(terminal);
        }
      }
    }
    const frameBytes = payloadLength === undefined
      ? (sizingMechanical?.aggregate.canonicalBytes ?? 0)
      : LENGTH_PREFIX_BYTES + payloadLength;
    if (
      payloadLength !== undefined &&
      exactOutput === undefined &&
      remaining > 0
    ) {
      try {
        exactOutput = new Uint8Array(frameBytes);
      } catch {
        terminal = restartError(operation, "budgetExceeded", {
          path: "outputBytes",
          observed: BigInt(frameBytes),
          maximum: budget.outputBytes,
        });
        return Result.fail(terminal);
      }
      const outputSink = makeIncrementalCanonicalJsonByteSinkV1(
        (byte, offset) => {
          exactOutput![LENGTH_PREFIX_BYTES + offset] = byte;
        },
      );
      const outputEncoder = createIncrementalCanonicalJsonByteSinkEncoderV1(
        createEventSource(entriesForRecord(record)),
        outputSink,
        limits.success,
      );
      if (Result.isFailure(outputEncoder)) {
        terminal = mapJsonIssue(operation, outputEncoder.failure);
        return Result.fail(terminal);
      }
      writing = outputEncoder.success;
      allocationTransitions += 1;
      remaining -= 1;
    }
    if (
      remaining > 0 &&
      writing !== undefined &&
      !writingComplete
    ) {
      const progressed = operation === "step"
        ? writing.step(remaining)
        : writing.finish(remaining);
      if (Result.isFailure(progressed)) {
        terminal = mapJsonIssue(operation, progressed.failure);
        return Result.fail(terminal);
      }
      writingMechanical = progressed.success.receipt;
      remaining -= progressed.success.receipt.delta.transitions;
      if (progressed.success.status === "complete") {
        if (progressed.success.canonicalByteLength !== payloadLength) {
          terminal = restartError(operation, "nonCanonical");
          return Result.fail(terminal);
        }
        writingComplete = true;
      }
    }
    while (
      remaining > 0 &&
      writingComplete &&
      prefixWritten < LENGTH_PREFIX_BYTES
    ) {
      exactOutput![prefixWritten] =
        (payloadLength! >>> (24 - prefixWritten * 8)) & 0xff;
      prefixWritten += 1;
      remaining -= 1;
    }
    const complete = payloadLength !== undefined &&
      exactOutput !== undefined &&
      writingComplete &&
      prefixWritten === LENGTH_PREFIX_BYTES;
    const mechanical = combinedMechanical();
    const aggregate = mappedUsage(
      "encode",
      mechanical,
      frameBytes,
      payloadLength === undefined ? undefined : record,
      exactOutput === undefined ? 0 : frameBytes,
    );
    const exceeded = checkUsage(operation, aggregate, budget);
    if (exceeded !== undefined) {
      terminal = exceeded;
      return Result.fail(exceeded);
    }
    const receipt = usageReceipt(previousUsage, aggregate);
    previousUsage = aggregate;
    if (!complete) {
      return Result.succeed(Object.freeze({ status: "pending", receipt }));
    }
    const value = Object.freeze({
      status: "complete",
      canonicalBytes: exactOutput!,
      record,
      receipt,
    } as const);
    terminal = value;
    return Result.succeed(value);
  };
  return Result.succeed(Object.freeze({
    step: (allowance: unknown) => advance("step", allowance),
    finish: (allowance: unknown) => advance("finish", allowance),
  }));
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  try {
    const length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER!, value, []);
    return typeof length === "number" ? length : undefined;
  } catch {
    return undefined;
  }
}

export function createDeclarativeV2VerifierRestartRecordDecoderV1(
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierRestartDecoderV1,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  const budget = captureBudget(rawBudget);
  if (budget === undefined || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
    return Result.fail(restartError("createDecoder", "invalidBudget"));
  }
  const limits = makeJsonLimits(budget, "createDecoder");
  if (Result.isFailure(limits)) return Result.fail(limits.failure);
  const parsed = createFlatObjectSink();
  const created = createIncrementalCanonicalJsonDecoderV1(
    limits.success,
    parsed.sink,
  );
  if (Result.isFailure(created)) {
    return Result.fail(mapJsonIssue("createDecoder", created.failure));
  }
  let prefix = 0;
  let prefixBytes = 0;
  let payloadBytes = 0;
  let terminal:
    | DeclarativeV2VerifierRestartEvidenceV1Error
    | DeclarativeV2VerifierRestartRecordV1
    | undefined;
  let previousUsage = zeroUsage("attempt_usage");
  let latestMechanical: IncrementalCanonicalJsonReceiptV1 | undefined;
  let semanticAdmitted = false;
  const admitSemantic = (
    operation: "push" | "finish",
  ): DeclarativeV2VerifierRestartEvidenceV1Error | undefined => {
    if (semanticAdmitted) return undefined;
    const kind = capturedRecordKind(parsed.kind());
    if (kind === undefined) return undefined;
    const usage = Object.freeze({
      ...zeroUsage("attempt_usage"),
      ...recordSemanticUsageForKind(
        kind,
        prefixBytes === LENGTH_PREFIX_BYTES
          ? LENGTH_PREFIX_BYTES + prefix
          : 0,
      ),
    }) as DeclarativeV2VerifierBudgetFrameV2;
    const exceeded = checkUsage(operation, usage, budget);
    if (exceeded !== undefined) return exceeded;
    semanticAdmitted = true;
    return undefined;
  };
  const completeResult = (
    consumedInputBytes: number,
  ): Result.Result<
    DeclarativeV2VerifierRestartDecodeStepV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  > => {
    const value = parsed.value();
    if (
      value !== undefined &&
      (
        value.domain !== DECLARATIVE_V2_VERIFIER_RESTART_EVIDENCE_IDENTITY_V1 ||
        value.version !== 1
      )
    ) {
      terminal = restartError("finish", "unsupportedVersion");
      return Result.fail(terminal);
    }
    const record = value === undefined ? undefined : parsedRecord(value);
    if (record === undefined) {
      terminal = restartError("finish", "malformed");
      return Result.fail(terminal);
    }
    terminal = record;
    const mechanical = latestMechanical!.aggregate;
    const aggregate = mappedUsage(
      "decode",
      {
        ...mechanical,
        transitions: mechanical.transitions + prefixBytes,
      },
      LENGTH_PREFIX_BYTES + payloadBytes,
      record,
    );
    const exceeded = checkUsage("finish", aggregate, budget);
    if (exceeded !== undefined) {
      terminal = exceeded;
      return Result.fail(exceeded);
    }
    const receipt = usageReceipt(previousUsage, aggregate);
    previousUsage = aggregate;
    return Result.succeed(Object.freeze({
      status: "complete",
      consumedInputBytes,
      record,
      receipt,
    }));
  };
  const pendingResult = (
    operation: "push" | "finish",
    consumedInputBytes: number,
  ): Result.Result<
    DeclarativeV2VerifierRestartDecodeStepV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  > => {
    const mechanical = latestMechanical?.aggregate ?? {
      inputBytes: 0,
      canonicalBytes: 0,
      stringBytes: 0,
      members: 0,
      depth: 0,
      transitions: 0,
    };
    const aggregate = mappedUsage(
      "decode",
      {
        ...mechanical,
        transitions: mechanical.transitions + prefixBytes,
      },
      prefixBytes + payloadBytes,
      undefined,
    );
    const exceeded = checkUsage(operation, aggregate, budget);
    if (exceeded !== undefined) {
      terminal = exceeded;
      return Result.fail(exceeded);
    }
    const receipt = usageReceipt(previousUsage, aggregate);
    previousUsage = aggregate;
    return Result.succeed(Object.freeze({
      status: "pending",
      consumedInputBytes,
      receipt,
    }));
  };
  const push = (
    rawInput: unknown,
    rawAllowance: unknown,
  ): Result.Result<
    DeclarativeV2VerifierRestartDecodeStepV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  > => {
    if (terminal !== undefined) {
      return Result.fail(restartError("push", "closed"));
    }
    const allowance = allowanceValue(rawAllowance);
    if (allowance === undefined || !isUint8Array(rawInput)) {
      terminal = restartError("push", "invalidInput");
      return Result.fail(terminal);
    }
    const length = intrinsicByteLength(rawInput);
    if (length === undefined) {
      terminal = restartError("push", "invalidInput");
      return Result.fail(terminal);
    }
    let consumed = 0;
    let remaining = allowance;
    while (remaining > 0 && consumed < length) {
      const usedCalls =
        (latestMechanical?.aggregate.transitions ?? 0) + prefixBytes;
      if (BigInt(usedCalls) >= budget.calls) {
        terminal = restartError("push", "budgetExceeded", {
          path: "calls",
          observed: BigInt(usedCalls + 1),
          maximum: budget.calls,
        });
        return Result.fail(terminal);
      }
      const byte = rawInput[consumed]!;
      if (prefixBytes < LENGTH_PREFIX_BYTES) {
        prefix = prefix * 256 + byte;
        prefixBytes += 1;
        consumed += 1;
        remaining -= 1;
        if (prefixBytes === LENGTH_PREFIX_BYTES) {
          const maximumFrameBytes = perRecordCodecLimit(budget.frameBytes);
          const observedFrameBytes = BigInt(LENGTH_PREFIX_BYTES + prefix);
          if (prefix === 0) {
            terminal = restartError("push", "malformed", {
              path: "lengthPrefix",
            });
            return Result.fail(terminal);
          }
          if (prefix > maximumFrameBytes - LENGTH_PREFIX_BYTES) {
            terminal = restartError("push", "budgetExceeded", {
              path: "frameBytes",
              observed: observedFrameBytes,
              maximum: BigInt(maximumFrameBytes),
            });
            return Result.fail(terminal);
          }
          if (
            BigInt(prefix) > budget.canonicalBytes -
              BigInt(LENGTH_PREFIX_BYTES)
          ) {
            terminal = restartError("push", "budgetExceeded", {
              path: "canonicalBytes",
              observed: observedFrameBytes,
              maximum: budget.canonicalBytes,
            });
            return Result.fail(terminal);
          }
          if (BigInt(prefix) > budget.tokenBytes) {
            terminal = restartError("push", "budgetExceeded", {
              path: "tokenBytes",
              observed: BigInt(prefix),
              maximum: budget.tokenBytes,
            });
            return Result.fail(terminal);
          }
        }
        continue;
      }
      if (payloadBytes >= prefix) {
        terminal = restartError("push", "malformed", { path: "trailing" });
        return Result.fail(terminal);
      }
      const one = UINT8_ARRAY_SUBARRAY.call(
        rawInput,
        consumed,
        consumed + 1,
      ) as Uint8Array;
      const stepped = created.success.step(one, 1);
      if (Result.isFailure(stepped)) {
        terminal = mapJsonIssue("push", stepped.failure);
        return Result.fail(terminal);
      }
      latestMechanical = stepped.success.receipt;
      const semanticExceeded = admitSemantic("push");
      if (semanticExceeded !== undefined) {
        terminal = semanticExceeded;
        return Result.fail(semanticExceeded);
      }
      const consumedByte = stepped.success.consumedInputBytes;
      if (consumedByte !== 0 && consumedByte !== 1) {
        terminal = restartError("push", "malformed");
        return Result.fail(terminal);
      }
      payloadBytes += consumedByte;
      consumed += consumedByte;
      remaining -= 1;
      if (stepped.success.status === "complete" && payloadBytes !== prefix) {
        terminal = restartError("push", "malformed", { path: "trailing" });
        return Result.fail(terminal);
      }
    }
    return pendingResult("push", consumed);
  };
  const finish = (
    rawAllowance: unknown,
  ): Result.Result<
    DeclarativeV2VerifierRestartDecodeStepV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  > => {
    if (terminal !== undefined) {
      return Result.fail(restartError("finish", "closed"));
    }
    const allowance = allowanceValue(rawAllowance);
    if (allowance === undefined) {
      terminal = restartError("finish", "invalidInput");
      return Result.fail(terminal);
    }
    if (prefixBytes !== LENGTH_PREFIX_BYTES || payloadBytes !== prefix) {
      terminal = restartError("finish", "malformed");
      return Result.fail(terminal);
    }
    const usedCalls =
      (latestMechanical?.aggregate.transitions ?? 0) + prefixBytes;
    const remainingCalls = budget.calls - BigInt(usedCalls);
    if (remainingCalls <= 0n && allowance > 0) {
      terminal = restartError("finish", "budgetExceeded", {
        path: "calls",
        observed: BigInt(usedCalls + 1),
        maximum: budget.calls,
      });
      return Result.fail(terminal);
    }
    const finished = created.success.finish(
      Math.min(allowance, Number(remainingCalls)),
    );
    if (Result.isFailure(finished)) {
      terminal = mapJsonIssue("finish", finished.failure);
      return Result.fail(terminal);
    }
    latestMechanical = finished.success.receipt;
    const semanticExceeded = admitSemantic("finish");
    if (semanticExceeded !== undefined) {
      terminal = semanticExceeded;
      return Result.fail(semanticExceeded);
    }
    if (finished.success.status === "pending") {
      return pendingResult("finish", 0);
    }
    if (!finished.success.canonical) {
      terminal = restartError("finish", "nonCanonical");
      return Result.fail(terminal);
    }
    if (
      !finished.success.jsonMembership ||
      !finished.success.wellFormedUnicode
    ) {
      terminal = restartError("finish", "malformed");
      return Result.fail(terminal);
    }
    return completeResult(0);
  };
  return Result.succeed(Object.freeze({ push, finish }));
}

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function sha256FixedInput(input: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.byteLength] = 0x80;
  const bitLength = BigInt(input.byteLength) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = Number(
      (bitLength >> BigInt(index * 8)) & 0xffn,
    );
  }
  const hash = new Uint32Array(SHA256_INITIAL);
  const schedule = new Uint32Array(64);
  for (let blockOffset = 0; blockOffset < paddedLength; blockOffset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = blockOffset + index * 4;
      schedule[index] = (
        (padded[offset]! << 24) |
        (padded[offset + 1]! << 16) |
        (padded[offset + 2]! << 8) |
        padded[offset + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const w15 = schedule[index - 15]!;
      const w2 = schedule[index - 2]!;
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      schedule[index] = (
        schedule[index - 16]! +
        s0 +
        schedule[index - 7]! +
        s1
      ) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^
        rotateRight(e!, 11) ^
        rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (
        h! +
        sum1 +
        choice +
        SHA256_ROUND_CONSTANTS[index]! +
        schedule[index]!
      ) >>> 0;
      const sum0 = rotateRight(a!, 2) ^
        rotateRight(a!, 13) ^
        rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  const digest = new Uint8Array(DIGEST_BYTES);
  for (let index = 0; index < hash.length; index += 1) {
    const value = hash[index]!;
    digest[index * 4] = value >>> 24;
    digest[index * 4 + 1] = value >>> 16;
    digest[index * 4 + 2] = value >>> 8;
    digest[index * 4 + 3] = value;
  }
  return digest;
}

function writeU64(output: Uint8Array, offset: number, value: bigint): void {
  for (let index = 7; index >= 0; index -= 1) {
    output[offset + index] = Number(value & 0xffn);
    value >>= 8n;
  }
}

function writeU32(output: Uint8Array, offset: number, value: number): void {
  output[offset] = value >>> 24;
  output[offset + 1] = value >>> 16;
  output[offset + 2] = value >>> 8;
  output[offset + 3] = value;
}

export interface DeclarativeV2VerifierRestartBodyTokenV1 {
  readonly terminalId: number;
  readonly canonicalBytes: Uint8Array;
}

export function makeDeclarativeV2VerifierRestartFunctionBodyPrefixV1(
  moduleOrdinalInput: unknown,
  functionOrdinalInput: unknown,
  bodyTokenCountInput: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  if (
    !isU64(moduleOrdinalInput) ||
    !isU64(functionOrdinalInput) ||
    !isU64(bodyTokenCountInput)
  ) {
    return Result.fail(restartError("validateSequence", "invalidInput"));
  }
  const domain = UTF8_ENCODER.encode(FUNCTION_BODY_DOMAIN);
  const prefix = new Uint8Array(domain.byteLength + 24);
  prefix.set(domain, 0);
  writeU64(prefix, domain.byteLength, moduleOrdinalInput);
  writeU64(prefix, domain.byteLength + 8, functionOrdinalInput);
  writeU64(prefix, domain.byteLength + 16, bodyTokenCountInput);
  return Result.succeed(prefix);
}

export function makeDeclarativeV2VerifierRestartFunctionBodyTokenPrefixV1(
  terminalIdInput: unknown,
  canonicalByteLengthInput: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  if (
    typeof terminalIdInput !== "number" ||
    !Number.isSafeInteger(terminalIdInput) ||
    terminalIdInput < 0 ||
    terminalIdInput > 0xffff_ffff ||
    !isU64(canonicalByteLengthInput) ||
    canonicalByteLengthInput > 0xffff_ffffn
  ) {
    return Result.fail(restartError("validateSequence", "invalidInput"));
  }
  const prefix = new Uint8Array(12);
  writeU32(prefix, 0, terminalIdInput);
  writeU64(prefix, 4, canonicalByteLengthInput);
  return Result.succeed(prefix);
}

/**
 * The function body identity is deliberately independent of source chunking.
 * Its token sequence excludes both enclosing braces and binds the generated
 * terminal identity plus the verifier-owned canonical spelling of every body
 * token. The iterable is consumed exactly once and is never retained.
 */
export function deriveDeclarativeV2VerifierRestartFunctionBodySha256V1(
  moduleOrdinalInput: unknown,
  functionOrdinalInput: unknown,
  bodyTokenCountInput: unknown,
  tokensInput: Iterable<DeclarativeV2VerifierRestartBodyTokenV1>,
): Result.Result<
  Uint8Array,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  if (
    !isU64(moduleOrdinalInput) ||
    !isU64(functionOrdinalInput) ||
    !isU64(bodyTokenCountInput)
  ) {
    return Result.fail(restartError("validateSequence", "invalidInput"));
  }
  const prefix = makeDeclarativeV2VerifierRestartFunctionBodyPrefixV1(
    moduleOrdinalInput,
    functionOrdinalInput,
    bodyTokenCountInput,
  );
  if (Result.isFailure(prefix)) return Result.fail(prefix.failure);
  const chunks: Uint8Array[] = [];
  let byteLength = prefix.success.byteLength;
  let observedCount = 0n;
  for (const token of tokensInput) {
      if (
        token === null ||
        typeof token !== "object" ||
        !Number.isSafeInteger(token.terminalId) ||
        token.terminalId < 0 ||
        token.terminalId > 0xffff_ffff ||
        !isUint8Array(token.canonicalBytes)
      ) {
        return Result.fail(
          restartError("validateSequence", "invalidInput", {
            path: "bodyToken",
          }),
        );
      }
      const visible = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(
        token.canonicalBytes,
      ) as unknown;
      if (
        typeof visible !== "number" ||
        !Number.isSafeInteger(visible) ||
        visible < 0 ||
        visible > 0xffff_ffff
      ) {
        return Result.fail(
          restartError("validateSequence", "invalidInput", {
            path: "bodyToken.canonicalBytes",
          }),
        );
      }
      const owned = new Uint8Array(visible);
      owned.set(UINT8_ARRAY_SUBARRAY.call(
        token.canonicalBytes,
        0,
        visible,
      ) as Uint8Array);
      const header = makeDeclarativeV2VerifierRestartFunctionBodyTokenPrefixV1(
        token.terminalId,
        BigInt(visible),
      );
      if (Result.isFailure(header)) return Result.fail(header.failure);
      chunks.push(header.success, owned);
      byteLength += header.success.byteLength + owned.byteLength;
      observedCount += 1n;
      if (
        byteLength > 0xffff_ffff ||
        observedCount > MAX_SIGNED_INT64
      ) {
        return Result.fail(
          restartError("validateSequence", "invalidBudget", {
            path: "bodyTokenBytes",
          }),
        );
      }
  }
  if (observedCount !== bodyTokenCountInput) {
    return Result.fail(
      restartError("validateSequence", "terminalMismatch", {
        path: "bodyTokenCount",
      }),
    );
  }
  const preimage = new Uint8Array(byteLength);
  let offset = 0;
  preimage.set(prefix.success, offset);
  offset += prefix.success.byteLength;
  for (const chunk of chunks) {
    preimage.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Result.succeed(sha256FixedInput(preimage));
}

export function deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(
  canonicalBytesInput: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  if (!isUint8Array(canonicalBytesInput)) {
    return Result.fail(restartError("validateSequence", "invalidInput"));
  }
  const byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(
    canonicalBytesInput,
  ) as unknown;
  if (
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    return Result.fail(restartError("validateSequence", "invalidInput"));
  }
  const owned = new Uint8Array(byteLength);
  owned.set(UINT8_ARRAY_SUBARRAY.call(
    canonicalBytesInput,
    0,
    byteLength,
  ) as Uint8Array);
  return Result.succeed(sha256FixedInput(owned));
}

export function deriveDeclarativeV2VerifierRestartDiagnosticRootV1(
  diagnosticOrdinalInput: unknown,
  previousRootSha256Input: unknown,
  canonicalRecordSha256Input: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  if (
    !isU64(diagnosticOrdinalInput) ||
    !isDigest(previousRootSha256Input) ||
    !isDigest(canonicalRecordSha256Input)
  ) {
    return Result.fail(restartError("validateSequence", "invalidInput"));
  }
  const domain = UTF8_ENCODER.encode(DIAGNOSTIC_ROOT_DOMAIN);
  const preimage = new Uint8Array(domain.byteLength + 8 + 64);
  let offset = 0;
  preimage.set(domain, offset);
  offset += domain.byteLength;
  writeU64(preimage, offset, diagnosticOrdinalInput);
  offset += 8;
  preimage.set(previousRootSha256Input, offset);
  offset += DIGEST_BYTES;
  preimage.set(canonicalRecordSha256Input, offset);
  return Result.succeed(sha256FixedInput(preimage));
}

function commandKindTag(
  commandKind: DeclarativeV2VerifierRestartCommandKindV2,
): number {
  return commandKind === "parse_module" ? 1 : 2;
}

function deriveEmptyRoot(
  commandKind: DeclarativeV2VerifierRestartCommandKindV2,
): Uint8Array {
  const domain = UTF8_ENCODER.encode(EMPTY_ROOT_DOMAIN);
  const preimage = new Uint8Array(domain.byteLength + 1);
  preimage.set(domain);
  preimage[domain.byteLength] = commandKindTag(commandKind);
  return sha256FixedInput(preimage);
}

export function deriveDeclarativeV2VerifierRestartRecordRootV1(
  commandKindInput: unknown,
  recordOrdinalInput: unknown,
  previousRootSha256Input: unknown,
  canonicalRecordSha256Input: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  if (
    (commandKindInput !== "parse_module" &&
      commandKindInput !== "link_page") ||
    !isU64(recordOrdinalInput) ||
    !isDigest(previousRootSha256Input) ||
    !isDigest(canonicalRecordSha256Input)
  ) {
    return Result.fail(restartError("validateSequence", "invalidInput"));
  }
  const domain = UTF8_ENCODER.encode(RECORD_ROOT_DOMAIN);
  const preimage = new Uint8Array(domain.byteLength + 1 + 8 + 64);
  let offset = 0;
  preimage.set(domain, offset);
  offset += domain.byteLength;
  preimage[offset] = commandKindTag(commandKindInput);
  offset += 1;
  writeU64(preimage, offset, recordOrdinalInput);
  offset += 8;
  preimage.set(previousRootSha256Input, offset);
  offset += DIGEST_BYTES;
  preimage.set(canonicalRecordSha256Input, offset);
  return Result.succeed(sha256FixedInput(preimage));
}

export function deriveDeclarativeV2VerifierRestartModuleOrderRootV1(
  orderOrdinalInput: unknown,
  previousRootSha256Input: unknown,
  canonicalRecordSha256Input: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  if (
    !isU64(orderOrdinalInput) ||
    !isDigest(previousRootSha256Input) ||
    !isDigest(canonicalRecordSha256Input)
  ) {
    return Result.fail(restartError("validateSequence", "invalidInput"));
  }
  const domain = UTF8_ENCODER.encode(MODULE_ORDER_ROOT_DOMAIN);
  const preimage = new Uint8Array(domain.byteLength + 8 + 64);
  let offset = 0;
  preimage.set(domain, offset);
  offset += domain.byteLength;
  writeU64(preimage, offset, orderOrdinalInput);
  offset += 8;
  preimage.set(previousRootSha256Input, offset);
  offset += DIGEST_BYTES;
  preimage.set(canonicalRecordSha256Input, offset);
  return Result.succeed(sha256FixedInput(preimage));
}

export function initialDeclarativeV2VerifierRestartSequenceStateV1(
  commandKindInput: unknown,
  parsePagesRootSha256Input?: unknown,
): Result.Result<
  DeclarativeV2VerifierRestartSequenceStateV1,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  if (
    commandKindInput !== "parse_module" &&
    commandKindInput !== "link_page"
  ) {
    return Result.fail(restartError("validateSequence", "invalidInput"));
  }
  if (
    (commandKindInput === "parse_module" &&
      parsePagesRootSha256Input !== undefined) ||
    (commandKindInput === "link_page" &&
      !isDigest(parsePagesRootSha256Input))
  ) {
    return Result.fail(restartError("validateSequence", "invalidInput", {
      path: "parsePagesRootSha256",
    }));
  }
  const commandKind = commandKindInput;
  const parsePagesRootSha256 = commandKind === "link_page"
    ? new Uint8Array(parsePagesRootSha256Input as Uint8Array)
    : null;
  return Result.succeed(Object.freeze({
    commandKind,
    nextRecordOrdinal: 0n,
    moduleOrdinal: null,
    sourceSha256: null,
    authenticatedInputSha256: null,
    precedingRecordsRootSha256: deriveEmptyRoot(commandKind),
    moduleOrderRootSha256: deriveEmptyRoot("link_page"),
    parsePagesRootSha256,
    moduleCount: 0n,
    importCount: 0n,
    exportCount: 0n,
    functionCount: 0n,
    callCount: 0n,
    valueFlowCount: 0n,
    diagnosticCount: 0n,
    edgeCount: 0n,
    orderCount: 0n,
    cycleCount: 0n,
    terminal: false,
  }));
}

export function validateDeclarativeV2VerifierRestartRecordSequenceV1(
  stateInput: unknown,
  recordInput: unknown,
  canonicalRecordSha256Input: unknown,
): Result.Result<
  DeclarativeV2VerifierRestartSequenceStateV1,
  DeclarativeV2VerifierRestartEvidenceV1Error
> {
  return Result.gen(function* () {
  // The digest is inert comparison evidence. The later producer/rehydrator
  // must independently derive it from the exact canonical length-framed record
  // bytes before calling this transition; neither the digest nor this state
  // grants source, semantic, lease, cursor, or verifier authority.
  const state = captureSequenceState(stateInput);
  const record = ownRecord(recordInput);
  if (
    state === undefined ||
    record === undefined ||
    !isDigest(canonicalRecordSha256Input) ||
    state.terminal
  ) {
    return yield* Result.fail(
      restartError("validateSequence", "invalidInput"),
    );
  }
  if (record.recordOrdinal !== state.nextRecordOrdinal) {
    return yield* Result.fail(
      restartError("validateSequence", "recordOrder", {
        path: "recordOrdinal",
      }),
    );
  }
  if (record.recordOrdinal === MAX_SIGNED_INT64) {
    return yield* Result.fail(
      restartError("validateSequence", "recordOrder", {
        path: "recordOrdinal",
      }),
    );
  }
  if (
    (state.commandKind === "parse_module" && !isParseRecord(record)) ||
    (state.commandKind === "link_page" && !isLinkRecord(record)) ||
    (
      record.kind === "diagnostic_v1" &&
      state.commandKind === "link_page" &&
      record.phase !== "link"
    )
  ) {
    return yield* Result.fail(
      restartError("validateSequence", "recordOrder", {
        path: "commandKind",
      }),
    );
  }
  const next = {
    ...state,
    nextRecordOrdinal: state.nextRecordOrdinal + 1n,
  };
  const increment = (
    value: bigint,
  ): bigint | undefined =>
    value < MAX_SIGNED_INT64 ? value + 1n : undefined;
  const failOverflow = (
    path: string,
  ): Result.Result<
    DeclarativeV2VerifierRestartSequenceStateV1,
    DeclarativeV2VerifierRestartEvidenceV1Error
  > => Result.fail(restartError("validateSequence", "recordOrder", { path }));
  let nextRecordRoot: Uint8Array | undefined;
  if (
    record.kind !== "parse_terminal_v1" &&
    record.kind !== "link_terminal_v1"
  ) {
    nextRecordRoot = yield* deriveDeclarativeV2VerifierRestartRecordRootV1(
        state.commandKind,
        record.recordOrdinal,
        state.precedingRecordsRootSha256,
        canonicalRecordSha256Input,
      );
  }
  switch (record.kind) {
    case "module_identity_v1":
      if (state.nextRecordOrdinal !== 0n || state.moduleCount !== 0n) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      next.moduleOrdinal = record.moduleOrdinal;
      next.sourceSha256 = new Uint8Array(record.sourceSha256);
      next.authenticatedInputSha256 = new Uint8Array(
        record.authenticatedInputSha256,
      );
      {
        const value = increment(state.moduleCount);
        if (value === undefined) return yield* failOverflow("moduleCount");
        next.moduleCount = value;
      }
      break;
    case "static_import_v1":
      if (
        record.importOrdinal !== state.importCount ||
        state.moduleCount !== 1n ||
        state.exportCount !== 0n ||
        state.functionCount !== 0n ||
        state.callCount !== 0n ||
        state.valueFlowCount !== 0n ||
        state.diagnosticCount !== 0n ||
        record.moduleOrdinal !== state.moduleOrdinal
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      {
        const value = increment(state.importCount);
        if (value === undefined) return yield* failOverflow("importCount");
        next.importCount = value;
      }
      break;
    case "export_binding_v1":
      if (
        record.exportOrdinal !== state.exportCount ||
        state.moduleCount !== 1n ||
        state.functionCount !== 0n ||
        state.callCount !== 0n ||
        state.valueFlowCount !== 0n ||
        state.diagnosticCount !== 0n ||
        record.moduleOrdinal !== state.moduleOrdinal
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      {
        const value = increment(state.exportCount);
        if (value === undefined) return yield* failOverflow("exportCount");
        next.exportCount = value;
      }
      break;
    case "function_v1":
      if (
        record.functionOrdinal !== state.functionCount ||
        state.moduleCount !== 1n ||
        state.callCount !== 0n ||
        state.valueFlowCount !== 0n ||
        state.diagnosticCount !== 0n ||
        record.moduleOrdinal !== state.moduleOrdinal
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      {
        const value = increment(state.functionCount);
        if (value === undefined) return yield* failOverflow("functionCount");
        next.functionCount = value;
      }
      break;
    case "direct_call_v1":
      if (
        record.callOrdinal !== state.callCount ||
        state.moduleCount !== 1n ||
        state.valueFlowCount !== 0n ||
        state.diagnosticCount !== 0n ||
        record.moduleOrdinal !== state.moduleOrdinal
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      {
        const value = increment(state.callCount);
        if (value === undefined) return yield* failOverflow("callCount");
        next.callCount = value;
      }
      break;
    case "value_flow_v1":
      if (
        record.flowOrdinal !== state.valueFlowCount ||
        state.moduleCount !== 1n ||
        state.diagnosticCount !== 0n ||
        record.moduleOrdinal !== state.moduleOrdinal
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      {
        const value = increment(state.valueFlowCount);
        if (value === undefined) {
          return yield* failOverflow("valueFlowCount");
        }
        next.valueFlowCount = value;
      }
      break;
    case "diagnostic_v1":
      if (
        record.diagnosticOrdinal !== state.diagnosticCount ||
        (
          state.commandKind === "parse_module" &&
          record.moduleOrdinal !== state.moduleOrdinal
        )
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      {
        const value = increment(state.diagnosticCount);
        if (value === undefined) {
          return yield* failOverflow("diagnosticCount");
        }
        next.diagnosticCount = value;
      }
      break;
    case "resolved_edge_v1":
      if (
        record.edgeOrdinal !== state.edgeCount ||
        state.orderCount !== 0n ||
        state.cycleCount !== 0n ||
        state.diagnosticCount !== 0n
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      {
        const value = increment(state.edgeCount);
        if (value === undefined) return yield* failOverflow("edgeCount");
        next.edgeCount = value;
      }
      break;
    case "module_order_v1":
      if (
        record.orderOrdinal !== state.orderCount ||
        state.cycleCount !== 0n ||
        state.diagnosticCount !== 0n
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      {
        const orderCount = increment(state.orderCount);
        const moduleCount = increment(state.moduleCount);
        if (orderCount === undefined) {
          return yield* failOverflow("orderCount");
        }
        if (moduleCount === undefined) {
          return yield* failOverflow("moduleCount");
        }
        next.moduleOrderRootSha256 = yield*
          deriveDeclarativeV2VerifierRestartModuleOrderRootV1(
          record.orderOrdinal,
          state.moduleOrderRootSha256,
          canonicalRecordSha256Input,
        );
        next.orderCount = orderCount;
        next.moduleCount = moduleCount;
      }
      break;
    case "cycle_result_v1":
      if (
        record.cycleOrdinal !== state.cycleCount ||
        state.diagnosticCount !== 0n ||
        state.cycleCount !== 0n ||
        record.moduleCount !== state.orderCount ||
        !bytesEqualFullScan(
          record.membersRootSha256,
          state.moduleOrderRootSha256,
        )
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "recordOrder"),
        );
      }
      {
        const value = increment(state.cycleCount);
        if (value === undefined) return yield* failOverflow("cycleCount");
        next.cycleCount = value;
      }
      break;
    case "parse_terminal_v1":
      if (
        record.importCount !== state.importCount ||
        record.exportCount !== state.exportCount ||
        record.functionCount !== state.functionCount ||
        record.callCount !== state.callCount ||
        record.valueFlowCount !== state.valueFlowCount ||
        record.diagnosticCount !== state.diagnosticCount ||
        state.moduleCount !== 1n ||
        record.moduleOrdinal !== state.moduleOrdinal ||
        state.sourceSha256 === null ||
        state.authenticatedInputSha256 === null ||
        !bytesEqualFullScan(record.sourceSha256, state.sourceSha256) ||
        !bytesEqualFullScan(
          record.authenticatedInputSha256,
          state.authenticatedInputSha256,
        ) ||
        !bytesEqualFullScan(
          record.precedingRecordsRootSha256,
          state.precedingRecordsRootSha256,
        )
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "terminalMismatch"),
        );
      }
      next.terminal = true;
      break;
    case "link_terminal_v1":
      if (
        record.moduleCount !== state.moduleCount ||
        record.edgeCount !== state.edgeCount ||
        record.orderCount !== state.orderCount ||
        record.cycleCount !== state.cycleCount ||
        record.diagnosticCount !== state.diagnosticCount ||
        state.cycleCount !== 1n ||
        state.orderCount !== state.moduleCount ||
        state.parsePagesRootSha256 === null ||
        !bytesEqualFullScan(
          record.parsePagesRootSha256,
          state.parsePagesRootSha256,
        ) ||
        !bytesEqualFullScan(
          record.precedingRecordsRootSha256,
          state.precedingRecordsRootSha256,
        )
      ) {
        return yield* Result.fail(
          restartError("validateSequence", "terminalMismatch"),
        );
      }
      next.terminal = true;
      break;
  }
  if (nextRecordRoot !== undefined) {
    next.precedingRecordsRootSha256 = nextRecordRoot;
  }
  return Object.freeze(next);
  });
}

function isParseRecord(record: DeclarativeV2VerifierRestartRecordV1): boolean {
  return record.kind !== "resolved_edge_v1" &&
    record.kind !== "module_order_v1" &&
    record.kind !== "cycle_result_v1" &&
    record.kind !== "link_terminal_v1";
}

function isLinkRecord(record: DeclarativeV2VerifierRestartRecordV1): boolean {
  return record.kind === "resolved_edge_v1" ||
    record.kind === "module_order_v1" ||
    record.kind === "cycle_result_v1" ||
    record.kind === "diagnostic_v1" ||
    record.kind === "link_terminal_v1";
}

function captureSequenceState(
  input: unknown,
): DeclarativeV2VerifierRestartSequenceStateV1 | undefined {
  const captured = captureOwnDataRecord(input);
  const keys = [
    "commandKind",
    "nextRecordOrdinal",
    "moduleOrdinal",
    "sourceSha256",
    "authenticatedInputSha256",
    "precedingRecordsRootSha256",
    "moduleOrderRootSha256",
    "parsePagesRootSha256",
    "moduleCount",
    "importCount",
    "exportCount",
    "functionCount",
    "callCount",
    "valueFlowCount",
    "diagnosticCount",
    "edgeCount",
    "orderCount",
    "cycleCount",
    "terminal",
  ];
  if (
    captured === undefined ||
    !hasExactKeys(captured, keys) ||
    (
      captured.commandKind !== "parse_module" &&
      captured.commandKind !== "link_page"
    ) ||
    typeof captured.terminal !== "boolean"
  ) {
    return undefined;
  }
  if (!isU64(captured.nextRecordOrdinal)) return undefined;
  for (
    const key of [
      "moduleCount",
      "importCount",
      "exportCount",
      "functionCount",
      "callCount",
      "valueFlowCount",
      "diagnosticCount",
      "edgeCount",
      "orderCount",
      "cycleCount",
    ] as const
  ) {
    if (!isU64(captured[key])) return undefined;
  }
  if (
    !(
      captured.moduleOrdinal === null ||
      isU64(captured.moduleOrdinal)
    ) ||
    !(
      captured.sourceSha256 === null ||
      isDigest(captured.sourceSha256)
    ) ||
    !(
      captured.authenticatedInputSha256 === null ||
      isDigest(captured.authenticatedInputSha256)
    ) ||
    (
      (captured.moduleOrdinal === null) !==
        (captured.sourceSha256 === null) ||
      (captured.moduleOrdinal === null) !==
        (captured.authenticatedInputSha256 === null)
    ) ||
    !isDigest(captured.precedingRecordsRootSha256) ||
    !isDigest(captured.moduleOrderRootSha256) ||
    !(
      captured.parsePagesRootSha256 === null ||
      isDigest(captured.parsePagesRootSha256)
    ) ||
    (
      captured.commandKind === "parse_module" &&
      captured.parsePagesRootSha256 !== null
    ) ||
    (
      captured.commandKind === "link_page" &&
      captured.parsePagesRootSha256 === null
    )
  ) {
    return undefined;
  }
  return Object.freeze({
    commandKind: captured.commandKind,
    nextRecordOrdinal: captured.nextRecordOrdinal as bigint,
    moduleOrdinal: captured.moduleOrdinal as bigint | null,
    sourceSha256: captured.sourceSha256 === null
      ? null
      : new Uint8Array(captured.sourceSha256 as Uint8Array),
    authenticatedInputSha256: captured.authenticatedInputSha256 === null
      ? null
      : new Uint8Array(captured.authenticatedInputSha256 as Uint8Array),
    precedingRecordsRootSha256: new Uint8Array(
      captured.precedingRecordsRootSha256 as Uint8Array,
    ),
    moduleOrderRootSha256: new Uint8Array(
      captured.moduleOrderRootSha256 as Uint8Array,
    ),
    parsePagesRootSha256: captured.parsePagesRootSha256 === null
      ? null
      : new Uint8Array(captured.parsePagesRootSha256 as Uint8Array),
    moduleCount: captured.moduleCount as bigint,
    importCount: captured.importCount as bigint,
    exportCount: captured.exportCount as bigint,
    functionCount: captured.functionCount as bigint,
    callCount: captured.callCount as bigint,
    valueFlowCount: captured.valueFlowCount as bigint,
    diagnosticCount: captured.diagnosticCount as bigint,
    edgeCount: captured.edgeCount as bigint,
    orderCount: captured.orderCount as bigint,
    cycleCount: captured.cycleCount as bigint,
    terminal: captured.terminal,
  });
}
