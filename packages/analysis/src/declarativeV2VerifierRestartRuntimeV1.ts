import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  decodeDeclarativeV2VerifierProgressFrameV2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  validateDeclarativeV2VerifierEvidencePageTransitionV2,
  validateDeclarativeV2VerifierFinalEvidencePageV2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierRestartCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  appendDeclarativeV2VerifierLinkerModuleV1,
  createDeclarativeV2VerifierLinkerV1,
  finishDeclarativeV2VerifierLinkerV1,
  makeDeclarativeV2VerifierExecutableRestartBridgeV1,
  readDeclarativeV2VerifierLinkerUsageV1,
  stepDeclarativeV2VerifierLinkerV1,
  type DeclarativeV2VerifierExecutableRestartBridgeV1,
  type DeclarativeV2VerifierLinkResultV1,
  type DeclarativeV2VerifierLinkerV1,
  type DeclarativeV2VerifierModuleResultV1,
  type DeclarativeV2VerifierRestartModuleBuilderV1,
  type DeclarativeV2VerifierRestartRecordCursorV1,
} from "./declarativeV2VerifierExecutableV1";
import {
  createDeclarativeV2VerifierRestartRecordDecoderV1,
  createDeclarativeV2VerifierRestartRecordEncoderV1,
  deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1,
  deriveDeclarativeV2VerifierRestartDiagnosticRootV1,
  initialDeclarativeV2VerifierRestartSequenceStateV1,
  validateDeclarativeV2VerifierRestartRecordSequenceV1,
  type DeclarativeV2VerifierRestartDecoderV1,
  type DeclarativeV2VerifierRestartEncoderV1,
  type DeclarativeV2VerifierRestartRecordV1,
  type DeclarativeV2VerifierRestartSequenceStateV1,
} from "./declarativeV2VerifierRestartEvidenceV1";
import {
  createDeclarativeV2VerifierRuntimeArenaV1,
  createDeclarativeV2VerifierRuntimeSha256V1,
  finishDeclarativeV2VerifierRuntimeSha256V1,
  stepDeclarativeV2VerifierRuntimeSha256V1,
  type DeclarativeV2VerifierRuntimeArenaHandleV1,
  type DeclarativeV2VerifierRuntimeSha256V1,
} from "./declarativeV2VerifierRuntimeArenaV1";

const MAX_ALLOWANCE = 1_024;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const DIGEST_BYTES = 32;
const EMPTY_DIAGNOSTICS_ROOT = new Uint8Array(DIGEST_BYTES);
const UINT8_ARRAY_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;

const intrinsicUint8ArrayByteLength = (
  input: Uint8Array,
): number | undefined => {
  if (UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    return Reflect.apply(UINT8_ARRAY_BYTE_LENGTH_GETTER, input, []) as number;
  } catch {
    return undefined;
  }
};

export const DECLARATIVE_V2_VERIFIER_RESTART_RUNTIME_IDENTITY_V1 =
  "flarex.declarative-v2/verifier-restart-runtime/v1" as const;

export type DeclarativeV2VerifierRestartRuntimeV1Operation =
  | "createProducer"
  | "produce"
  | "createRehydrator"
  | "rehydrate"
  | "close";

export type DeclarativeV2VerifierRestartRuntimeV1ErrorReason =
  | "invalidInput"
  | "invalidBudget"
  | "budgetExceeded"
  | "corruption"
  | "staleAuthority"
  | "closed"
  | "collision";

export class DeclarativeV2VerifierRestartRuntimeV1Error
  extends Data.TaggedError(
    "DeclarativeV2VerifierRestartRuntimeV1Error",
  )<{
    readonly operation: DeclarativeV2VerifierRestartRuntimeV1Operation;
    readonly reason: DeclarativeV2VerifierRestartRuntimeV1ErrorReason;
    readonly path?: string;
    readonly dimension?: DeclarativeV2VerifierBudgetDimensionV2;
    readonly observed?: bigint;
    readonly maximum?: bigint;
  }> {}

export interface DeclarativeV2VerifierRestartClaimV1 {
  readonly commandKind: DeclarativeV2VerifierRestartCommandKindV2;
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  readonly authenticatedInputSha256: Uint8Array;
  readonly sourceCommitmentSha256: Uint8Array;
  readonly semanticCommitmentSha256: Uint8Array;
  readonly settledCommandUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly parsePagesRootSha256: Uint8Array | null;
  readonly maximumPagePayloadBytes: bigint;
  readonly outputManifest: DeclarativeV2VerifierCommandOutputManifestFrameV2 | null;
  readonly outputManifestSha256: Uint8Array | null;
  readonly receiptSha256: Uint8Array | null;
  readonly resultAuthority: unknown | null;
  readonly parseModuleResults:
    | DeclarativeV2VerifierRestartModuleResultSetV1
    | null;
}

export interface DeclarativeV2VerifierRestartClaimPortV1 {
  readonly claim: (
    authority: unknown,
    operation: "produce" | "rehydrate",
  ) => Result.Result<
    DeclarativeV2VerifierRestartClaimV1,
    DeclarativeV2VerifierRestartRuntimeV1Error
  >;
}

export interface DeclarativeV2VerifierRestartPageMetadataV1 {
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: Uint8Array;
}

export interface DeclarativeV2VerifierRestartPageSourceV1 {
  readonly metadata: (
    pageOrdinal: bigint,
  ) => Result.Result<
    DeclarativeV2VerifierRestartPageMetadataV1 | null,
    DeclarativeV2VerifierRestartRuntimeV1Error
  >;
  readonly body: (
    pageOrdinal: bigint,
    admittedByteLength: bigint,
  ) => Result.Result<
    Uint8Array,
    DeclarativeV2VerifierRestartRuntimeV1Error
  >;
}

export interface DeclarativeV2VerifierRestartPageV1 {
  readonly manifest: DeclarativeV2VerifierEvidencePageManifestFrameV2;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: Uint8Array;
  readonly payloadBytes: Uint8Array;
}

export interface DeclarativeV2VerifierRestartUsageReceiptV1 {
  readonly delta: DeclarativeV2VerifierBudgetFrameV2;
  readonly aggregate: DeclarativeV2VerifierBudgetFrameV2;
  readonly transitionCount: number;
}

export interface DeclarativeV2VerifierRestartProducerV1 {
  readonly _tag: "DeclarativeV2VerifierRestartProducerV1";
}

export interface DeclarativeV2VerifierRestartRehydratorV1 {
  readonly _tag: "DeclarativeV2VerifierRestartRehydratorV1";
}

export interface DeclarativeV2VerifierRestartModuleResultSetV1 {
  readonly _tag: "DeclarativeV2VerifierRestartModuleResultSetV1";
}

export type DeclarativeV2VerifierRestartProducerStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2VerifierRestartUsageReceiptV1;
  }>
  | Readonly<{
    readonly status: "page";
    readonly page: DeclarativeV2VerifierRestartPageV1;
    readonly receipt: DeclarativeV2VerifierRestartUsageReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly finalPageSha256: Uint8Array;
    readonly recordCount: bigint;
    readonly diagnosticCount: bigint;
    readonly diagnosticsRootSha256: Uint8Array;
    readonly actualUsage: DeclarativeV2VerifierBudgetFrameV2;
    readonly receipt: DeclarativeV2VerifierRestartUsageReceiptV1;
  }>;

export type DeclarativeV2VerifierRestartRehydrateStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2VerifierRestartUsageReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly commandKind: DeclarativeV2VerifierRestartCommandKindV2;
    readonly moduleResult: DeclarativeV2VerifierModuleResultV1 | null;
    readonly linkResult: DeclarativeV2VerifierLinkResultV1 | null;
    readonly recoveryUsage: DeclarativeV2VerifierBudgetFrameV2;
    readonly receipt: DeclarativeV2VerifierRestartUsageReceiptV1;
  }>;

export interface DeclarativeV2VerifierRestartRuntimeFactoryV1 {
  readonly createModuleResultSet: () => Result.Result<
    DeclarativeV2VerifierRestartModuleResultSetV1,
    DeclarativeV2VerifierRestartRuntimeV1Error
  >;
  readonly appendModuleResult: (
    resultSet: unknown,
    moduleResult: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierRestartRuntimeV1Error>;
  readonly sealModuleResultSet: (
    resultSet: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierRestartRuntimeV1Error>;
  readonly createProducer: (input: Readonly<{
    readonly authority: unknown;
    readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  }>) => Result.Result<
    DeclarativeV2VerifierRestartProducerV1,
    DeclarativeV2VerifierRestartRuntimeV1Error
  >;
  readonly stepProducer: (
    producer: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartProducerStepV1,
    DeclarativeV2VerifierRestartRuntimeV1Error
  >;
  readonly createRehydrator: (input: Readonly<{
    readonly authority: unknown;
    readonly source: DeclarativeV2VerifierRestartPageSourceV1;
    readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  }>) => Result.Result<
    DeclarativeV2VerifierRestartRehydratorV1,
    DeclarativeV2VerifierRestartRuntimeV1Error
  >;
  readonly stepRehydrator: (
    rehydrator: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRestartRehydrateStepV1,
    DeclarativeV2VerifierRestartRuntimeV1Error
  >;
  readonly close: (
    handle: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierRestartRuntimeV1Error>;
}

type MutableUsage = {
  -readonly [K in DeclarativeV2VerifierBudgetDimensionV2]: bigint;
};

interface ProducerStateV1 {
  readonly claim: DeclarativeV2VerifierRestartClaimV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: MutableUsage;
  readonly bridge: DeclarativeV2VerifierExecutableRestartBridgeV1;
  readonly cursor: DeclarativeV2VerifierRestartRecordCursorV1;
  sequence: DeclarativeV2VerifierRestartSequenceStateV1;
  encoder: DeclarativeV2VerifierRestartEncoderV1 | undefined;
  pendingRecord: DeclarativeV2VerifierRestartRecordV1 | undefined;
  pendingBytes: Uint8Array | undefined;
  pendingRecordHash: DeclarativeV2VerifierRuntimeSha256V1 | undefined;
  pendingRecordHashOffset: number;
  readonly pageRecords: Uint8Array[];
  payloadLength: number;
  pageOutput: Uint8Array | undefined;
  pageCopyRecordIndex: number;
  pageCopyByteIndex: number;
  pageOutputOffset: number;
  pageHash: DeclarativeV2VerifierRuntimeSha256V1 | undefined;
  pageHashOffset: number;
  pageFinalizing: boolean;
  readonly hashArena: DeclarativeV2VerifierRuntimeArenaHandleV1;
  pageOrdinal: bigint;
  firstRecordOrdinal: bigint;
  firstDiagnosticOrdinal: bigint;
  pageRecordCount: bigint;
  pageDiagnosticCount: bigint;
  totalRecordCount: bigint;
  totalDiagnosticCount: bigint;
  diagnosticRoot: Uint8Array;
  predecessorPageSha256: Uint8Array | null;
  terminalSeen: boolean;
  closed: boolean;
}

interface RehydratorStateV1 {
  readonly claim: DeclarativeV2VerifierRestartClaimV1;
  readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: MutableUsage;
  readonly source: DeclarativeV2VerifierRestartPageSourceV1;
  readonly bridge: DeclarativeV2VerifierExecutableRestartBridgeV1;
  moduleResultNode: RestartModuleResultNodeV1 | undefined;
  readonly records: DeclarativeV2VerifierRestartRecordV1[];
  sequence: DeclarativeV2VerifierRestartSequenceStateV1;
  builder: DeclarativeV2VerifierRestartModuleBuilderV1 | undefined;
  pageOrdinal: bigint;
  predecessorManifest: DeclarativeV2VerifierEvidencePageManifestFrameV2 | null;
  predecessorPageSha256: Uint8Array | null;
  currentManifest: DeclarativeV2VerifierEvidencePageManifestFrameV2 | undefined;
  currentManifestSha256: Uint8Array | undefined;
  bodyInput: Uint8Array | undefined;
  bodyBytes: Uint8Array | undefined;
  bodyCopyOffset: number;
  bodyHash: DeclarativeV2VerifierRuntimeSha256V1 | undefined;
  bodyHashOffset: number;
  readonly hashArena: DeclarativeV2VerifierRuntimeArenaHandleV1;
  bodyOffset: number;
  recordStart: number;
  recordEnd: number;
  decoder: DeclarativeV2VerifierRestartDecoderV1 | undefined;
  decodedRecord: DeclarativeV2VerifierRestartRecordV1 | undefined;
  recordHash: DeclarativeV2VerifierRuntimeSha256V1 | undefined;
  recordHashOffset: number;
  recordCount: bigint;
  diagnosticCount: bigint;
  phase:
    | "metadata"
    | "body"
    | "copyBody"
    | "hashBody"
    | "decode"
    | "hashRecord"
    | "finishPage"
    | "finalize"
    | "link"
    | "compareLink"
    | "complete"
    | "failed";
  closed: boolean;
  linker: DeclarativeV2VerifierLinkerV1 | undefined;
  linkerSettledUsage: MutableUsage;
  linkModuleIndex: number;
  linkResult: DeclarativeV2VerifierLinkResultV1 | undefined;
  linkRecordCursor: DeclarativeV2VerifierRestartRecordCursorV1 | undefined;
  linkCompareIndex: number;
  linkCompareSequence: DeclarativeV2VerifierRestartSequenceStateV1 | undefined;
  linkLiveEncoder: DeclarativeV2VerifierRestartEncoderV1 | undefined;
  linkStoredEncoder: DeclarativeV2VerifierRestartEncoderV1 | undefined;
  linkLiveRecord: DeclarativeV2VerifierRestartRecordV1 | undefined;
  linkLiveBytes: Uint8Array | undefined;
  linkStoredBytes: Uint8Array | undefined;
  linkCompareOffset: number;
  linkRecordHash: DeclarativeV2VerifierRuntimeSha256V1 | undefined;
  linkRecordHashOffset: number;
}

interface RestartModuleResultNodeV1 {
  readonly result: DeclarativeV2VerifierModuleResultV1;
  next: RestartModuleResultNodeV1 | undefined;
}

interface RestartModuleResultSetStateV1 {
  head: RestartModuleResultNodeV1 | undefined;
  tail: RestartModuleResultNodeV1 | undefined;
  count: number;
  sealed: boolean;
  closed: boolean;
}

const zeroUsage = (): MutableUsage => {
  const value = { kind: "attempt_usage" } as Record<string, string | bigint>;
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    value[dimension] = 0n;
  }
  return value as MutableUsage;
};

const freezeUsage = (
  usage: Readonly<MutableUsage>,
  kind: "attempt_usage" | "command_budget" = "attempt_usage",
): DeclarativeV2VerifierBudgetFrameV2 => {
  const value = { kind } as Record<string, string | bigint>;
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    value[dimension] = usage[dimension];
  }
  return Object.freeze(value) as DeclarativeV2VerifierBudgetFrameV2;
};

const usageDelta = (
  after: Readonly<MutableUsage>,
  before: Readonly<MutableUsage>,
): DeclarativeV2VerifierBudgetFrameV2 => {
  const value = zeroUsage();
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    value[dimension] = after[dimension] - before[dimension];
  }
  return freezeUsage(value);
};

const snapshotUsage = (usage: Readonly<MutableUsage>): MutableUsage => {
  const copy = zeroUsage();
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    copy[dimension] = usage[dimension];
  }
  return copy;
};

const runtimeError = (
  operation: DeclarativeV2VerifierRestartRuntimeV1Operation,
  reason: DeclarativeV2VerifierRestartRuntimeV1ErrorReason,
  details?: Omit<
    ConstructorParameters<typeof DeclarativeV2VerifierRestartRuntimeV1Error>[0],
    "operation" | "reason"
  >,
): DeclarativeV2VerifierRestartRuntimeV1Error =>
  new DeclarativeV2VerifierRestartRuntimeV1Error({
    operation,
    reason,
    ...details,
  });

const captureBudget = (
  input: unknown,
): DeclarativeV2VerifierBudgetFrameV2 | undefined => {
  if (input === null || typeof input !== "object") return undefined;
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    return undefined;
  }
  const expected = ["kind", ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2];
  if (
    keys.length !== expected.length ||
    keys.some(key => typeof key !== "string" || !expected.includes(key))
  ) return undefined;
  const captured = { kind: "" } as Record<string, string | bigint>;
  for (const key of expected) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      return undefined;
    }
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    if (key === "kind") {
      if (
        descriptor.value !== "command_budget" &&
        descriptor.value !== "attempt_usage"
      ) return undefined;
      captured.kind = descriptor.value;
      continue;
    }
    if (
      typeof descriptor.value !== "bigint" ||
      descriptor.value < 0n ||
      descriptor.value > MAX_SIGNED_INT64
    ) return undefined;
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured) as DeclarativeV2VerifierBudgetFrameV2;
};

const capturePageSource = (
  input: unknown,
): DeclarativeV2VerifierRestartPageSourceV1 | undefined => {
  if (input === null || typeof input !== "object") return undefined;
  let metadata: PropertyDescriptor | undefined;
  let body: PropertyDescriptor | undefined;
  try {
    metadata = Object.getOwnPropertyDescriptor(input, "metadata");
    body = Object.getOwnPropertyDescriptor(input, "body");
  } catch {
    return undefined;
  }
  if (
    metadata === undefined ||
    body === undefined ||
    !("value" in metadata) ||
    !("value" in body) ||
    typeof metadata.value !== "function" ||
    typeof body.value !== "function"
  ) {
    return undefined;
  }
  return Object.freeze({
    metadata: metadata.value as DeclarativeV2VerifierRestartPageSourceV1[
      "metadata"
    ],
    body: body.value as DeclarativeV2VerifierRestartPageSourceV1["body"],
  });
};

const ownClaim = (
  claim: DeclarativeV2VerifierRestartClaimV1,
  operation: "produce" | "rehydrate",
): DeclarativeV2VerifierRestartClaimV1 | undefined => {
  const usage = captureBudget(claim.settledCommandUsage);
  if (
    usage === undefined ||
    (claim.commandKind !== "parse_module" && claim.commandKind !== "link_page") ||
    typeof claim.sequence !== "bigint" ||
    claim.sequence < 1n ||
    claim.sequence > MAX_SIGNED_INT64 ||
    !isUint8ArrayWithByteLength(claim.reservationSha256, DIGEST_BYTES) ||
    !isUint8ArrayWithByteLength(claim.authenticatedInputSha256, DIGEST_BYTES) ||
    !isUint8ArrayWithByteLength(claim.sourceCommitmentSha256, DIGEST_BYTES) ||
    !isUint8ArrayWithByteLength(claim.semanticCommitmentSha256, DIGEST_BYTES) ||
    typeof claim.maximumPagePayloadBytes !== "bigint" ||
    claim.maximumPagePayloadBytes < 1n ||
    claim.maximumPagePayloadBytes > MAX_SIGNED_INT64 ||
    (claim.commandKind === "parse_module" && claim.parsePagesRootSha256 !== null) ||
    (claim.commandKind === "link_page" &&
      !isUint8ArrayWithByteLength(claim.parsePagesRootSha256, DIGEST_BYTES)) ||
    (operation === "produce" &&
      (claim.outputManifest !== null ||
        claim.outputManifestSha256 !== null ||
        claim.receiptSha256 !== null ||
        claim.resultAuthority === null ||
        claim.parseModuleResults !== null)) ||
    (operation === "rehydrate" &&
      (claim.outputManifest === null ||
        !isUint8ArrayWithByteLength(claim.outputManifestSha256, DIGEST_BYTES) ||
        !isUint8ArrayWithByteLength(claim.receiptSha256, DIGEST_BYTES) ||
        claim.resultAuthority !== null ||
        (claim.commandKind === "parse_module" &&
          claim.parseModuleResults !== null) ||
        (claim.commandKind === "link_page" &&
          (
            claim.parseModuleResults === null ||
            typeof claim.parseModuleResults !== "object"
          ))))
  ) return undefined;
  return Object.freeze({
    ...claim,
    reservationSha256: new Uint8Array(claim.reservationSha256),
    authenticatedInputSha256: new Uint8Array(claim.authenticatedInputSha256),
    sourceCommitmentSha256: new Uint8Array(claim.sourceCommitmentSha256),
    semanticCommitmentSha256: new Uint8Array(claim.semanticCommitmentSha256),
    settledCommandUsage: usage,
    parsePagesRootSha256: claim.parsePagesRootSha256 === null
      ? null
      : new Uint8Array(claim.parsePagesRootSha256),
    outputManifestSha256: claim.outputManifestSha256 === null
      ? null
      : new Uint8Array(claim.outputManifestSha256),
    receiptSha256: claim.receiptSha256 === null
      ? null
      : new Uint8Array(claim.receiptSha256),
    resultAuthority: claim.resultAuthority,
    parseModuleResults: claim.parseModuleResults,
  });
};

const allowance = (
  input: unknown,
  operation: DeclarativeV2VerifierRestartRuntimeV1Operation,
): Result.Result<number, DeclarativeV2VerifierRestartRuntimeV1Error> =>
  typeof input === "number" &&
    Number.isSafeInteger(input) &&
    input >= 0 &&
    input <= MAX_ALLOWANCE
    ? Result.succeed(input)
    : Result.fail(runtimeError(operation, "invalidInput", {
      path: "allowance",
    }));

const isBudgetDimension = (
  value: unknown,
): value is DeclarativeV2VerifierBudgetDimensionV2 =>
  typeof value === "string" &&
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.some(
    dimension => dimension === value,
  );

const charge = (
  state: { readonly usage: MutableUsage; readonly maximum: DeclarativeV2VerifierBudgetFrameV2 },
  operation: DeclarativeV2VerifierRestartRuntimeV1Operation,
  dimension: DeclarativeV2VerifierBudgetDimensionV2,
  amount: bigint,
): DeclarativeV2VerifierRestartRuntimeV1Error | undefined => {
  const observed = state.usage[dimension] + amount;
  if (observed > state.maximum[dimension] || observed > MAX_SIGNED_INT64) {
    return runtimeError(operation, "budgetExceeded", {
      dimension,
      observed,
      maximum: state.maximum[dimension],
    });
  }
  state.usage[dimension] = observed;
  return undefined;
};

const settle = (
  state: { readonly usage: MutableUsage; readonly maximum: DeclarativeV2VerifierBudgetFrameV2 },
  operation: DeclarativeV2VerifierRestartRuntimeV1Operation,
  input: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierRestartRuntimeV1Error | undefined => {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    const failure = charge(state, operation, dimension, input[dimension]);
    if (failure !== undefined) return failure;
  }
  return undefined;
};

const remainingBudget = (
  state: {
    readonly usage: MutableUsage;
    readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  },
): DeclarativeV2VerifierBudgetFrameV2 => {
  const remaining = zeroUsage();
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    remaining[dimension] = state.maximum[dimension] - state.usage[dimension];
  }
  return freezeUsage(remaining, "command_budget");
};

const linkerRequiredBudget = (
  remaining: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierBudgetFrameV2 => {
  const required = zeroUsage();
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    required[dimension] = remaining[dimension];
  }
  required.sourceBytes = 0n;
  required.sourceMapBytes = 0n;
  required.semanticBytes = 0n;
  required.objectBodyBytes = 0n;
  return freezeUsage(required);
};

const settleNestedLinkerUsage = (
  state: RehydratorStateV1,
  aggregate: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierRestartRuntimeV1Error | undefined => {
  const delta = zeroUsage();
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (aggregate[dimension] < state.linkerSettledUsage[dimension]) {
      return runtimeError("rehydrate", "corruption", {
        path: `linkerUsage.${dimension}`,
      });
    }
    delta[dimension] =
      aggregate[dimension] - state.linkerSettledUsage[dimension];
  }
  const failure = settle(state, "rehydrate", freezeUsage(delta));
  if (failure !== undefined) return failure;
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    state.linkerSettledUsage[dimension] = aggregate[dimension];
  }
  return undefined;
};

const receipt = (
  usage: MutableUsage,
  before: MutableUsage,
  transitionCount: number,
): DeclarativeV2VerifierRestartUsageReceiptV1 => Object.freeze({
  delta: usageDelta(usage, before),
  aggregate: freezeUsage(usage),
  transitionCount,
});

const createHashArena = (
  maximum: DeclarativeV2VerifierBudgetFrameV2,
  operation: DeclarativeV2VerifierRestartRuntimeV1Operation,
): Result.Result<
  DeclarativeV2VerifierRuntimeArenaHandleV1,
  DeclarativeV2VerifierRestartRuntimeV1Error
> => {
  const created = createDeclarativeV2VerifierRuntimeArenaV1({
    requiredBytes: 0,
    regions: Object.freeze([]),
    usage: Object.freeze({
      ...maximum,
      kind: "command_budget",
    }),
  });
  return Result.isFailure(created)
    ? Result.fail(runtimeError(operation, "invalidBudget"))
    : Result.succeed(created.success);
};

const settleHashReceipt = (
  state: {
    readonly usage: MutableUsage;
    readonly maximum: DeclarativeV2VerifierBudgetFrameV2;
  },
  operation: DeclarativeV2VerifierRestartRuntimeV1Operation,
  delta: Readonly<{ readonly calls: bigint; readonly hashBytes: bigint }>,
): DeclarativeV2VerifierRestartRuntimeV1Error | undefined =>
  charge(state, operation, "calls", delta.calls) ??
  charge(state, operation, "hashBytes", delta.hashBytes);

const mapFailure = (
  operation: DeclarativeV2VerifierRestartRuntimeV1Operation,
  reason: DeclarativeV2VerifierRestartRuntimeV1ErrorReason,
  path?: string,
): DeclarativeV2VerifierRestartRuntimeV1Error =>
  runtimeError(operation, reason, path === undefined ? undefined : { path });

const patchTerminalRecord = (
  record: DeclarativeV2VerifierRestartRecordV1,
  sequence: DeclarativeV2VerifierRestartSequenceStateV1,
): DeclarativeV2VerifierRestartRecordV1 => {
  if (record.kind === "parse_terminal_v1") {
    return Object.freeze({
      ...record,
      precedingRecordsRootSha256: new Uint8Array(
        sequence.precedingRecordsRootSha256,
      ),
    });
  }
  if (record.kind === "cycle_result_v1") {
    return Object.freeze({
      ...record,
      membersRootSha256: new Uint8Array(sequence.moduleOrderRootSha256),
    });
  }
  if (record.kind === "link_terminal_v1") {
    return Object.freeze({
      ...record,
      precedingRecordsRootSha256: new Uint8Array(
        sequence.precedingRecordsRootSha256,
      ),
    });
  }
  return record;
};

const beginPageFinalization = (
  state: ProducerStateV1,
): DeclarativeV2VerifierRestartRuntimeV1Error | undefined => {
  if (state.payloadLength < 1 || state.pageRecordCount < 1n) {
    return runtimeError("produce", "corruption", {
      path: "emptyPage",
    });
  }
  const outputCharge = charge(
    state,
    "produce",
    "outputBytes",
    BigInt(state.payloadLength),
  );
  if (outputCharge !== undefined) return outputCharge;
  let payload: Uint8Array;
  try {
    payload = new Uint8Array(state.payloadLength);
  } catch {
    return runtimeError("produce", "budgetExceeded", {
      dimension: "outputBytes",
      observed: BigInt(state.payloadLength),
      maximum: state.maximum.outputBytes,
    });
  }
  const hash = createDeclarativeV2VerifierRuntimeSha256V1(state.hashArena);
  if (Result.isFailure(hash)) {
    return mapFailure("produce", "corruption", "payloadSha256");
  }
  state.pageOutput = payload;
  state.pageCopyRecordIndex = 0;
  state.pageCopyByteIndex = 0;
  state.pageOutputOffset = 0;
  state.pageHash = hash.success;
  state.pageHashOffset = 0;
  state.pageFinalizing = true;
  return undefined;
};

const advancePageFinalization = (
  state: ProducerStateV1,
): Result.Result<
  DeclarativeV2VerifierRestartPageV1 | undefined,
  DeclarativeV2VerifierRestartRuntimeV1Error
> => {
  if (!state.pageFinalizing) {
    const started = beginPageFinalization(state);
    return started === undefined
      ? Result.succeed(undefined)
      : Result.fail(started);
  }
  const payloadBytes = state.pageOutput!;
  if (state.pageCopyRecordIndex < state.pageRecords.length) {
    const record = state.pageRecords[state.pageCopyRecordIndex]!;
    payloadBytes[state.pageOutputOffset] =
      record[state.pageCopyByteIndex]!;
    state.pageOutputOffset += 1;
    state.pageCopyByteIndex += 1;
    if (state.pageCopyByteIndex === record.byteLength) {
      state.pageCopyRecordIndex += 1;
      state.pageCopyByteIndex = 0;
    }
    return Result.succeed(undefined);
  }
  if (state.pageHashOffset < payloadBytes.byteLength) {
    const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
      state.pageHash,
      payloadBytes.subarray(state.pageHashOffset, state.pageHashOffset + 1),
      1,
    );
    if (Result.isFailure(hashed)) {
      return Result.fail(mapFailure("produce", "corruption", "payloadSha256"));
    }
    const settled = settleHashReceipt(
      state,
      "produce",
      hashed.success.receipt.delta,
    );
    if (settled !== undefined) return Result.fail(settled);
    state.pageHashOffset += Number(
      hashed.success.receipt.delta.consumedBytes,
    );
    return Result.succeed(undefined);
  }
  const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
    state.pageHash,
    1,
  );
  if (Result.isFailure(finished)) {
    return Result.fail(mapFailure("produce", "corruption", "payloadSha256"));
  }
  const settled = settleHashReceipt(
    state,
    "produce",
    finished.success.receipt.delta,
  );
  if (settled !== undefined) return Result.fail(settled);
  if (finished.success.status === "pending") return Result.succeed(undefined);
  const payloadSha256 = finished.success.digest;
  const manifest = Object.freeze({
    kind: "evidence_page_manifest",
    reservationSha256: new Uint8Array(state.claim.reservationSha256),
    commandKind: state.claim.commandKind,
    sequence: state.claim.sequence,
    pageOrdinal: state.pageOrdinal,
    firstEvidenceOrdinal: state.firstRecordOrdinal,
    evidenceCount: state.pageRecordCount,
    firstDiagnosticOrdinal: state.firstDiagnosticOrdinal,
    diagnosticCount: state.pageDiagnosticCount,
    predecessorPageSha256: state.predecessorPageSha256 === null
      ? null
      : new Uint8Array(state.predecessorPageSha256),
    payloadByteLength: BigInt(payloadBytes.byteLength),
    payloadSha256,
    cumulativeDiagnosticsRootSha256: new Uint8Array(state.diagnosticRoot),
  } satisfies DeclarativeV2VerifierEvidencePageManifestFrameV2);
  const encoded = encodeDeclarativeV2VerifierProgressFrameV2(manifest, {
    maximumFrameBytes: Number(
      state.maximum.frameBytes - state.usage.frameBytes > 0xffff_ffffn
        ? 0xffff_ffffn
        : state.maximum.frameBytes - state.usage.frameBytes,
    ),
    maximumCanonicalBytes: Number(
      state.maximum.canonicalBytes - state.usage.canonicalBytes > 0xffff_ffffn
        ? 0xffff_ffffn
        : state.maximum.canonicalBytes - state.usage.canonicalBytes,
    ),
  });
  if (Result.isFailure(encoded)) {
    return Result.fail(mapFailure(
      "produce",
      encoded.failure.reason === "canonicalBytesExceeded" ||
        encoded.failure.reason === "frameBytesExceeded" ||
        encoded.failure.reason === "invalidBudget"
        ? "budgetExceeded"
        : "corruption",
      "pageManifest",
    ));
  }
  const manifestBytes = encoded.success.canonicalBytes;
  const manifestCharges: ReadonlyArray<
    readonly [DeclarativeV2VerifierBudgetDimensionV2, bigint]
  > = [
    ["calls", 1n],
    ["frameBytes", BigInt(manifestBytes.byteLength)],
    ["canonicalBytes", BigInt(manifestBytes.byteLength)],
    ["outputBytes", BigInt(manifestBytes.byteLength)],
    ["hashBytes", BigInt(manifestBytes.byteLength)],
  ];
  for (const [dimension, amount] of manifestCharges) {
    const failure = charge(state, "produce", dimension, amount);
    if (failure !== undefined) return Result.fail(failure);
  }
  const manifestSha = deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(
    manifestBytes,
  );
  if (Result.isFailure(manifestSha)) {
    return Result.fail(mapFailure("produce", "corruption", "manifestSha256"));
  }
  const result = Object.freeze({
    manifest,
    manifestBytes: new Uint8Array(manifestBytes),
    manifestSha256: manifestSha.success,
    payloadBytes,
  });
  state.predecessorPageSha256 = new Uint8Array(manifestSha.success);
  state.pageOrdinal += 1n;
  state.firstRecordOrdinal += state.pageRecordCount;
  state.firstDiagnosticOrdinal += state.pageDiagnosticCount;
  state.pageRecordCount = 0n;
  state.pageDiagnosticCount = 0n;
  state.payloadLength = 0;
  state.pageRecords.length = 0;
  state.pageOutput = undefined;
  state.pageHash = undefined;
  state.pageFinalizing = false;
  return Result.succeed(result);
};

const advancePendingProducerRecord = (
  state: ProducerStateV1,
): Result.Result<boolean, DeclarativeV2VerifierRestartRuntimeV1Error> => {
  if (state.pendingBytes === undefined || state.pendingRecord === undefined) {
    return Result.fail(mapFailure("produce", "corruption", "pendingRecord"));
  }
  if (
    state.payloadLength + state.pendingBytes.byteLength >
      Number(state.claim.maximumPagePayloadBytes)
  ) {
    return Result.fail(runtimeError("produce", "budgetExceeded", {
      dimension: "frameBytes",
      observed: BigInt(state.payloadLength + state.pendingBytes.byteLength),
      maximum: state.claim.maximumPagePayloadBytes,
    }));
  }
  if (state.pendingRecordHash === undefined) {
    const created = createDeclarativeV2VerifierRuntimeSha256V1(state.hashArena);
    if (Result.isFailure(created)) {
      return Result.fail(mapFailure("produce", "corruption", "recordSha256"));
    }
    state.pendingRecordHash = created.success;
    state.pendingRecordHashOffset = 0;
    return Result.succeed(false);
  }
  if (state.pendingRecordHashOffset < state.pendingBytes.byteLength) {
    const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
      state.pendingRecordHash,
      state.pendingBytes.subarray(
        state.pendingRecordHashOffset,
        state.pendingRecordHashOffset + 1,
      ),
      1,
    );
    if (Result.isFailure(hashed)) {
      return Result.fail(mapFailure("produce", "corruption", "recordSha256"));
    }
    const settled = settleHashReceipt(
      state,
      "produce",
      hashed.success.receipt.delta,
    );
    if (settled !== undefined) return Result.fail(settled);
    state.pendingRecordHashOffset += Number(
      hashed.success.receipt.delta.consumedBytes,
    );
    return Result.succeed(false);
  }
  const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
    state.pendingRecordHash,
    1,
  );
  if (Result.isFailure(finished)) {
    return Result.fail(mapFailure("produce", "corruption", "recordSha256"));
  }
  const settled = settleHashReceipt(
    state,
    "produce",
    finished.success.receipt.delta,
  );
  if (settled !== undefined) return Result.fail(settled);
  if (finished.success.status === "pending") return Result.succeed(false);
  const nextSequence = validateDeclarativeV2VerifierRestartRecordSequenceV1(
    state.sequence,
    state.pendingRecord,
    finished.success.digest,
  );
  if (Result.isFailure(nextSequence)) {
    return Result.fail(mapFailure("produce", "corruption", "recordOrder"));
  }
  state.sequence = nextSequence.success;
  state.pageRecords.push(state.pendingBytes);
  state.payloadLength += state.pendingBytes.byteLength;
  state.pageRecordCount += 1n;
  state.totalRecordCount += 1n;
  if (state.pendingRecord.kind === "diagnostic_v1") {
    const nextRoot = deriveDeclarativeV2VerifierRestartDiagnosticRootV1(
      state.totalDiagnosticCount,
      state.diagnosticRoot,
      finished.success.digest,
    );
    if (Result.isFailure(nextRoot)) {
      return Result.fail(
        mapFailure("produce", "corruption", "diagnosticsRoot"),
      );
    }
    state.diagnosticRoot = nextRoot.success;
    state.pageDiagnosticCount += 1n;
    state.totalDiagnosticCount += 1n;
  }
  state.terminalSeen =
    state.pendingRecord.kind === "parse_terminal_v1" ||
    state.pendingRecord.kind === "link_terminal_v1";
  state.pendingBytes = undefined;
  state.pendingRecord = undefined;
  state.pendingRecordHash = undefined;
  state.pendingRecordHashOffset = 0;
  state.encoder = undefined;
  return Result.succeed(true);
};

export function makeDeclarativeV2VerifierRestartRuntimeFactoryV1(
  claimPort: DeclarativeV2VerifierRestartClaimPortV1,
): DeclarativeV2VerifierRestartRuntimeFactoryV1 {
  const bridge = makeDeclarativeV2VerifierExecutableRestartBridgeV1();
  const producers = new WeakMap<object, ProducerStateV1>();
  const rehydrators = new WeakMap<object, RehydratorStateV1>();
  const moduleResultSets = new WeakMap<
    object,
    RestartModuleResultSetStateV1
  >();
  const producerHandle = (): DeclarativeV2VerifierRestartProducerV1 =>
    Object.freeze({ _tag: "DeclarativeV2VerifierRestartProducerV1" });
  const rehydratorHandle = (): DeclarativeV2VerifierRestartRehydratorV1 =>
    Object.freeze({ _tag: "DeclarativeV2VerifierRestartRehydratorV1" });
  const moduleResultSetHandle =
    (): DeclarativeV2VerifierRestartModuleResultSetV1 =>
      Object.freeze({
        _tag: "DeclarativeV2VerifierRestartModuleResultSetV1",
      });

  const createModuleResultSet:
    DeclarativeV2VerifierRestartRuntimeFactoryV1["createModuleResultSet"] =
      () => {
        const handle = moduleResultSetHandle();
        moduleResultSets.set(handle, {
          head: undefined,
          tail: undefined,
          count: 0,
          sealed: false,
          closed: false,
        });
        return Result.succeed(handle);
      };

  const appendModuleResult:
    DeclarativeV2VerifierRestartRuntimeFactoryV1["appendModuleResult"] =
      (rawSet, rawResult) => {
        const state = rawSet !== null && typeof rawSet === "object"
          ? moduleResultSets.get(rawSet)
          : undefined;
        if (
          state === undefined ||
          rawResult === null ||
          typeof rawResult !== "object"
        ) {
          return Result.fail(runtimeError(
            "createRehydrator",
            "staleAuthority",
          ));
        }
        if (state.closed || state.sealed) {
          return Result.fail(runtimeError("createRehydrator", "closed"));
        }
        const admitted = bridge.admitModuleResult(rawResult);
        if (Result.isFailure(admitted)) {
          return Result.fail(runtimeError(
            "createRehydrator",
            "staleAuthority",
            { path: "moduleResult" },
          ));
        }
        if (state.count >= 0xffff_ffff) {
          state.closed = true;
          return Result.fail(runtimeError(
            "createRehydrator",
            "budgetExceeded",
            {
              dimension: "modules",
              observed: BigInt(state.count) + 1n,
              maximum: 0xffff_ffffn,
            },
          ));
        }
        const node: RestartModuleResultNodeV1 = {
          result: rawResult as DeclarativeV2VerifierModuleResultV1,
          next: undefined,
        };
        if (state.tail === undefined) state.head = node;
        else state.tail.next = node;
        state.tail = node;
        state.count += 1;
        return Result.succeed(undefined);
      };

  const sealModuleResultSet:
    DeclarativeV2VerifierRestartRuntimeFactoryV1["sealModuleResultSet"] =
      rawSet => {
        const state = rawSet !== null && typeof rawSet === "object"
          ? moduleResultSets.get(rawSet)
          : undefined;
        if (state === undefined) {
          return Result.fail(runtimeError(
            "createRehydrator",
            "staleAuthority",
          ));
        }
        if (state.closed || state.sealed) {
          return Result.fail(runtimeError("createRehydrator", "closed"));
        }
        state.sealed = true;
        return Result.succeed(undefined);
      };

  const createProducer:
    DeclarativeV2VerifierRestartRuntimeFactoryV1["createProducer"] = input => {
      // The claim is deliberately the first observable operation.
      const claimed = claimPort.claim(input.authority, "produce");
      if (Result.isFailure(claimed)) return Result.fail(claimed.failure);
      const claim = ownClaim(claimed.success, "produce");
      const maximum = captureBudget(input.maximum);
      if (claim === undefined || maximum === undefined) {
        return Result.fail(runtimeError("createProducer", "invalidInput"));
      }
      for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
        if (claim.settledCommandUsage[dimension] > maximum[dimension]) {
          return Result.fail(runtimeError("createProducer", "budgetExceeded", {
            dimension,
            observed: claim.settledCommandUsage[dimension],
            maximum: maximum[dimension],
          }));
        }
      }
      const opened = claim.commandKind === "parse_module"
        ? bridge.openModuleRecords(
          claim.resultAuthority,
          claim.authenticatedInputSha256,
          maximum,
        )
        : bridge.openLinkRecords(
          claim.resultAuthority,
          claim.parsePagesRootSha256,
          maximum,
        );
      if (Result.isFailure(opened)) {
        return Result.fail(runtimeError("createProducer", "staleAuthority"));
      }
      if (
        claim.maximumPagePayloadBytes > maximum.frameBytes ||
        claim.maximumPagePayloadBytes > 0xffff_ffffn
      ) {
        return Result.fail(runtimeError("createProducer", "invalidBudget"));
      }
      const sequence = initialDeclarativeV2VerifierRestartSequenceStateV1(
        claim.commandKind,
        claim.parsePagesRootSha256 ?? undefined,
      );
      if (Result.isFailure(sequence)) {
        return Result.fail(runtimeError("createProducer", "invalidInput"));
      }
      const hashArena = createHashArena(maximum, "createProducer");
      if (Result.isFailure(hashArena)) return Result.fail(hashArena.failure);
      const handle = producerHandle();
      producers.set(handle, {
        claim,
        maximum,
        usage: DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.reduce(
          (owned, dimension) => {
            owned[dimension] = claim.settledCommandUsage[dimension];
            return owned;
          },
          zeroUsage(),
        ),
        bridge,
        cursor: opened.success,
        sequence: sequence.success,
        encoder: undefined,
        pendingRecord: undefined,
        pendingBytes: undefined,
        pendingRecordHash: undefined,
        pendingRecordHashOffset: 0,
        pageRecords: [],
        payloadLength: 0,
        pageOutput: undefined,
        pageCopyRecordIndex: 0,
        pageCopyByteIndex: 0,
        pageOutputOffset: 0,
        pageHash: undefined,
        pageHashOffset: 0,
        pageFinalizing: false,
        hashArena: hashArena.success,
        pageOrdinal: 0n,
        firstRecordOrdinal: 0n,
        firstDiagnosticOrdinal: 0n,
        pageRecordCount: 0n,
        pageDiagnosticCount: 0n,
        totalRecordCount: 0n,
        totalDiagnosticCount: 0n,
        diagnosticRoot: new Uint8Array(EMPTY_DIAGNOSTICS_ROOT),
        predecessorPageSha256: null,
        terminalSeen: false,
        closed: false,
      });
      return Result.succeed(handle);
    };

  const stepProducer:
    DeclarativeV2VerifierRestartRuntimeFactoryV1["stepProducer"] =
      (rawProducer, rawAllowance) => {
        const state = rawProducer !== null && typeof rawProducer === "object"
          ? producers.get(rawProducer)
          : undefined;
        if (state === undefined) {
          return Result.fail(runtimeError("produce", "staleAuthority"));
        }
        if (state.closed) {
          return Result.fail(runtimeError("produce", "closed"));
        }
        const admitted = allowance(rawAllowance, "produce");
        if (Result.isFailure(admitted)) {
          state.closed = true;
          return Result.fail(admitted.failure);
        }
        const before = snapshotUsage(state.usage);
        if (admitted.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(state.usage, before, 0),
          }));
        }
        let transitions = 0;
        while (transitions < admitted.success) {
          if (state.pageFinalizing) {
            const advanced = advancePageFinalization(state);
            transitions += 1;
            if (Result.isFailure(advanced)) {
              state.closed = true;
              return Result.fail(advanced.failure);
            }
            if (advanced.success !== undefined) {
              return Result.succeed(Object.freeze({
                status: "page",
                page: advanced.success,
                receipt: receipt(state.usage, before, transitions),
              }));
            }
            continue;
          }
          if (state.terminalSeen && state.payloadLength > 0) {
            const started = beginPageFinalization(state);
            transitions += 1;
            if (started !== undefined) {
              state.closed = true;
              return Result.fail(started);
            }
            continue;
          }
          if (state.terminalSeen) {
            state.closed = true;
            return Result.succeed(Object.freeze({
              status: "complete",
              finalPageSha256: new Uint8Array(state.predecessorPageSha256!),
              recordCount: state.totalRecordCount,
              diagnosticCount: state.totalDiagnosticCount,
              diagnosticsRootSha256: new Uint8Array(state.diagnosticRoot),
              actualUsage: freezeUsage(state.usage),
              receipt: receipt(state.usage, before, transitions),
            }));
          }
          if (
            state.pendingBytes !== undefined &&
            state.pendingRecord !== undefined
          ) {
            if (
              state.pendingRecordHash === undefined &&
              state.payloadLength > 0 &&
              BigInt(state.payloadLength + state.pendingBytes.byteLength) >
                state.claim.maximumPagePayloadBytes
            ) {
              const started = beginPageFinalization(state);
              transitions += 1;
              if (started !== undefined) {
                state.closed = true;
                return Result.fail(started);
              }
              continue;
            }
            const committed = advancePendingProducerRecord(state);
            transitions += 1;
            if (Result.isFailure(committed)) {
              state.closed = true;
              return Result.fail(committed.failure);
            }
            continue;
          }
          if (state.encoder === undefined) {
            const read = state.claim.commandKind === "parse_module"
              ? state.bridge.readModuleRecord(state.cursor, 1)
              : state.bridge.readLinkRecord(state.cursor, 1);
            if (Result.isFailure(read)) {
              state.closed = true;
              return Result.fail(mapFailure("produce", "staleAuthority"));
            }
            transitions += read.success.transitionCount;
            const readCharge = settle(
              state,
              "produce",
              read.success.deltaUsage,
            );
            if (readCharge !== undefined) {
              state.closed = true;
              return Result.fail(readCharge);
            }
            if (read.success.status === "pending") continue;
            if (read.success.status === "complete") {
              state.closed = true;
              return Result.fail(mapFailure(
                "produce",
                "corruption",
                "missingTerminal",
              ));
            }
            state.pendingRecord = patchTerminalRecord(
              read.success.record,
              state.sequence,
            );
            const created = createDeclarativeV2VerifierRestartRecordEncoderV1(
              state.pendingRecord,
              state.maximum,
            );
            if (Result.isFailure(created)) {
              state.closed = true;
              return Result.fail(mapFailure("produce", "corruption", "record"));
            }
            state.encoder = created.success;
            continue;
          }
          const encoded = state.encoder.finish(1);
          transitions += 1;
          if (Result.isFailure(encoded)) {
            state.closed = true;
            return Result.fail(mapFailure(
              "produce",
              encoded.failure.reason === "budgetExceeded"
                ? "budgetExceeded"
                : "corruption",
              "record",
            ));
          }
          const settled = settle(
            state,
            "produce",
            encoded.success.receipt.delta,
          );
          if (settled !== undefined) {
            state.closed = true;
            return Result.fail(settled);
          }
          if (encoded.success.status === "pending") continue;
          const bytes = encoded.success.canonicalBytes;
          if (BigInt(bytes.byteLength) > state.claim.maximumPagePayloadBytes) {
            state.closed = true;
            return Result.fail(runtimeError("produce", "budgetExceeded", {
              dimension: "frameBytes",
              observed: BigInt(bytes.byteLength),
              maximum: state.claim.maximumPagePayloadBytes,
            }));
          }
          state.pendingBytes = bytes;
        }
        return Result.succeed(Object.freeze({
          status: "pending",
          receipt: receipt(state.usage, before, transitions),
        }));
      };

  const createRehydrator:
    DeclarativeV2VerifierRestartRuntimeFactoryV1["createRehydrator"] = input => {
      // The claim is deliberately before metadata, body access, or allocation.
      const claimed = claimPort.claim(input.authority, "rehydrate");
      if (Result.isFailure(claimed)) return Result.fail(claimed.failure);
      const claim = ownClaim(claimed.success, "rehydrate");
      const maximum = captureBudget(input.maximum);
      const source = capturePageSource(input.source);
      if (claim === undefined || maximum === undefined || source === undefined) {
        return Result.fail(runtimeError("createRehydrator", "invalidInput"));
      }
      const moduleResultSet = claim.commandKind === "link_page" &&
          claim.parseModuleResults !== null
        ? moduleResultSets.get(claim.parseModuleResults)
        : undefined;
      if (
        claim.commandKind === "link_page" &&
        (
          moduleResultSet === undefined ||
          moduleResultSet.closed ||
          !moduleResultSet.sealed
        )
      ) {
        return Result.fail(runtimeError(
          "createRehydrator",
          "staleAuthority",
          { path: "parseModuleResults" },
        ));
      }
      const sequence = initialDeclarativeV2VerifierRestartSequenceStateV1(
        claim.commandKind,
        claim.parsePagesRootSha256 ?? undefined,
      );
      if (Result.isFailure(sequence)) {
        return Result.fail(runtimeError("createRehydrator", "invalidInput"));
      }
      const builder = claim.commandKind === "parse_module"
        ? bridge.createModuleBuilder(maximum, claim.settledCommandUsage)
        : Result.succeed(undefined);
      if (Result.isFailure(builder)) {
        return Result.fail(runtimeError("createRehydrator", "invalidBudget"));
      }
      const hashArena = createHashArena(maximum, "createRehydrator");
      if (Result.isFailure(hashArena)) return Result.fail(hashArena.failure);
      const handle = rehydratorHandle();
      rehydrators.set(handle, {
        claim,
        maximum,
        usage: zeroUsage(),
        source,
        bridge,
        moduleResultNode: moduleResultSet?.head,
        records: [],
        sequence: sequence.success,
        builder: builder.success,
        pageOrdinal: 0n,
        predecessorManifest: null,
        predecessorPageSha256: null,
        currentManifest: undefined,
        currentManifestSha256: undefined,
        bodyInput: undefined,
        bodyBytes: undefined,
        bodyCopyOffset: 0,
        bodyHash: undefined,
        bodyHashOffset: 0,
        hashArena: hashArena.success,
        bodyOffset: 0,
        recordStart: 0,
        recordEnd: 0,
        decoder: undefined,
        decodedRecord: undefined,
        recordHash: undefined,
        recordHashOffset: 0,
        recordCount: 0n,
        diagnosticCount: 0n,
        phase: "metadata",
        closed: false,
        linker: undefined,
        linkerSettledUsage: zeroUsage(),
        linkModuleIndex: 0,
        linkResult: undefined,
        linkRecordCursor: undefined,
        linkCompareIndex: 0,
        linkCompareSequence: undefined,
        linkLiveEncoder: undefined,
        linkStoredEncoder: undefined,
        linkLiveRecord: undefined,
        linkLiveBytes: undefined,
        linkStoredBytes: undefined,
        linkCompareOffset: 0,
        linkRecordHash: undefined,
        linkRecordHashOffset: 0,
      });
      return Result.succeed(handle);
    };

  const failRehydrator = (
    state: RehydratorStateV1,
    failure: DeclarativeV2VerifierRestartRuntimeV1Error,
  ): Result.Result<never, DeclarativeV2VerifierRestartRuntimeV1Error> => {
    if (state.linkResult !== undefined) {
      state.bridge.revoke(state.linkResult);
      state.linkResult = undefined;
    }
    state.phase = "failed";
    state.closed = true;
    return Result.fail(failure);
  };

  const stepRehydrator:
    DeclarativeV2VerifierRestartRuntimeFactoryV1["stepRehydrator"] =
      (rawRehydrator, rawAllowance) => {
        const state = rawRehydrator !== null && typeof rawRehydrator === "object"
          ? rehydrators.get(rawRehydrator)
          : undefined;
        if (state === undefined) {
          return Result.fail(runtimeError("rehydrate", "staleAuthority"));
        }
        if (state.closed) {
          return Result.fail(runtimeError("rehydrate", "closed"));
        }
        const admitted = allowance(rawAllowance, "rehydrate");
        if (Result.isFailure(admitted)) {
          return failRehydrator(state, admitted.failure);
        }
        const before = snapshotUsage(state.usage);
        if (admitted.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(state.usage, before, 0),
          }));
        }
        let transitions = 0;
        while (transitions < admitted.success) {
          transitions += 1;
          if (state.phase === "metadata") {
            const sourceCall =
              charge(state, "rehydrate", "calls", 1n) ??
              charge(state, "rehydrate", "objectCalls", 1n);
            if (sourceCall !== undefined) {
              return failRehydrator(state, sourceCall);
            }
            let metadata: ReturnType<
              DeclarativeV2VerifierRestartPageSourceV1["metadata"]
            >;
            try {
              metadata = state.source.metadata(state.pageOrdinal);
            } catch (cause) {
              state.phase = "failed";
              state.closed = true;
              throw cause;
            }
            if (Result.isFailure(metadata)) {
              return failRehydrator(state, metadata.failure);
            }
            if (metadata.success === null) {
              state.phase = "finalize";
              continue;
            }
            let manifestSha256: unknown;
            let manifestBytes: unknown;
            try {
              manifestSha256 = metadata.success.manifestSha256;
              manifestBytes = metadata.success.manifestBytes;
            } catch (cause) {
              state.phase = "failed";
              state.closed = true;
              throw cause;
            }
            if (
              !isUint8ArrayWithByteLength(
                manifestSha256,
                DIGEST_BYTES,
              ) ||
              !isUint8Array(manifestBytes)
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "manifestMetadata"),
              );
            }
            const manifestVisibleLength =
              intrinsicUint8ArrayByteLength(manifestBytes);
            if (
              manifestVisibleLength === undefined ||
              manifestVisibleLength < 1
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "manifestMetadata"),
              );
            }
            const manifestByteLength = BigInt(manifestVisibleLength);
            const manifestAdmission =
              charge(
                state,
                "rehydrate",
                "frameBytes",
                manifestByteLength,
              ) ??
              charge(
                state,
                "rehydrate",
                "canonicalBytes",
                manifestByteLength,
              ) ??
              charge(
                state,
                "rehydrate",
                "hashBytes",
                manifestByteLength,
              );
            if (manifestAdmission !== undefined) {
              return failRehydrator(state, manifestAdmission);
            }
            const decoded = decodeDeclarativeV2VerifierProgressFrameV2(
              manifestBytes,
              {
                maximumFrameBytes: manifestVisibleLength,
                maximumCanonicalBytes: manifestVisibleLength,
              },
            );
            if (
              Result.isFailure(decoded) ||
              decoded.success.frame.kind !== "evidence_page_manifest"
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "manifest"),
              );
            }
            const derived =
              deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(
                decoded.success.canonicalBytes,
              );
            if (
              Result.isFailure(derived) ||
              !bytesEqualFullScan(
                derived.success,
                manifestSha256,
              )
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "collision", "manifestSha256"),
              );
            }
            const manifest = decoded.success.frame;
            if (
              !bytesEqualFullScan(
                manifest.reservationSha256,
                state.claim.reservationSha256,
              ) ||
              manifest.commandKind !== state.claim.commandKind ||
              manifest.sequence !== state.claim.sequence ||
              manifest.pageOrdinal !== state.pageOrdinal ||
              manifest.payloadByteLength < 1n ||
              manifest.payloadByteLength > state.claim.maximumPagePayloadBytes
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "manifestBinding"),
              );
            }
            if (state.predecessorManifest !== null) {
              const transition =
                validateDeclarativeV2VerifierEvidencePageTransitionV2(
                  state.predecessorManifest,
                  state.predecessorPageSha256,
                  manifest,
                );
              if (Result.isFailure(transition)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "pageTransition"),
                );
              }
            } else if (manifest.predecessorPageSha256 !== null) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "firstPage"),
              );
            }
            const bodyCharge = charge(
              state,
              "rehydrate",
              "objectBodyBytes",
              manifest.payloadByteLength,
            );
            if (bodyCharge !== undefined) {
              return failRehydrator(state, bodyCharge);
            }
            state.currentManifest = manifest;
            state.currentManifestSha256 = new Uint8Array(derived.success);
            state.phase = "body";
            continue;
          }
          if (state.phase === "body") {
            const manifest = state.currentManifest!;
            const sourceCall =
              charge(state, "rehydrate", "calls", 1n) ??
              charge(state, "rehydrate", "objectCalls", 1n);
            if (sourceCall !== undefined) {
              return failRehydrator(state, sourceCall);
            }
            let body: ReturnType<
              DeclarativeV2VerifierRestartPageSourceV1["body"]
            >;
            try {
              body = state.source.body(
                state.pageOrdinal,
                manifest.payloadByteLength,
              );
            } catch (cause) {
              state.phase = "failed";
              state.closed = true;
              throw cause;
            }
            if (Result.isFailure(body)) {
              return failRehydrator(state, body.failure);
            }
            if (
              manifest.payloadByteLength > BigInt(Number.MAX_SAFE_INTEGER) ||
              !isUint8ArrayWithByteLength(
                body.success,
                Number(manifest.payloadByteLength),
              )
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "payloadByteLength"),
              );
            }
            let ownedBody: Uint8Array;
            try {
              ownedBody = new Uint8Array(Number(manifest.payloadByteLength));
            } catch {
              return failRehydrator(
                state,
                runtimeError("rehydrate", "budgetExceeded", {
                  dimension: "frameBytes",
                  observed: manifest.payloadByteLength,
                  maximum: state.maximum.frameBytes,
                }),
              );
            }
            const bodyHash =
              createDeclarativeV2VerifierRuntimeSha256V1(state.hashArena);
            if (Result.isFailure(bodyHash)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "payloadSha256"),
              );
            }
            state.bodyInput = body.success;
            state.bodyBytes = ownedBody;
            state.bodyCopyOffset = 0;
            state.bodyHash = bodyHash.success;
            state.bodyHashOffset = 0;
            state.bodyOffset = 0;
            state.recordStart = 0;
            state.recordEnd = 0;
            state.decoder = undefined;
            state.phase = "copyBody";
            continue;
          }
          if (state.phase === "copyBody") {
            if (state.bodyCopyOffset < state.bodyBytes!.byteLength) {
              state.bodyBytes![state.bodyCopyOffset] =
                state.bodyInput![state.bodyCopyOffset]!;
              state.bodyCopyOffset += 1;
              continue;
            }
            state.bodyInput = undefined;
            state.phase = "hashBody";
            continue;
          }
          if (state.phase === "hashBody") {
            if (state.bodyHashOffset < state.bodyBytes!.byteLength) {
              const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
                state.bodyHash,
                state.bodyBytes!.subarray(
                  state.bodyHashOffset,
                  state.bodyHashOffset + 1,
                ),
                1,
              );
              if (Result.isFailure(hashed)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "payloadSha256"),
                );
              }
              const settled = settleHashReceipt(
                state,
                "rehydrate",
                hashed.success.receipt.delta,
              );
              if (settled !== undefined) {
                return failRehydrator(state, settled);
              }
              state.bodyHashOffset += Number(
                hashed.success.receipt.delta.consumedBytes,
              );
              continue;
            }
            const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
              state.bodyHash,
              1,
            );
            if (Result.isFailure(finished)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "payloadSha256"),
              );
            }
            const settled = settleHashReceipt(
              state,
              "rehydrate",
              finished.success.receipt.delta,
            );
            if (settled !== undefined) {
              return failRehydrator(state, settled);
            }
            if (finished.success.status === "pending") continue;
            if (
              !bytesEqualFullScan(
                finished.success.digest,
                state.currentManifest!.payloadSha256,
              )
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "collision", "payloadSha256"),
              );
            }
            state.bodyHash = undefined;
            state.phase = "decode";
            continue;
          }
          if (state.phase === "decode") {
            if (
              state.decoder === undefined &&
              state.bodyOffset >= state.bodyBytes!.byteLength
            ) {
              state.phase = "finishPage";
              continue;
            }
            if (state.decoder === undefined) {
              if (state.bodyOffset + 4 > state.bodyBytes!.byteLength) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "recordPrefix"),
                );
              }
              const payloadLength = new DataView(
                state.bodyBytes!.buffer,
                state.bodyBytes!.byteOffset + state.bodyOffset,
                4,
              ).getUint32(0, false);
              state.recordStart = state.bodyOffset;
              state.recordEnd = state.bodyOffset + 4 + payloadLength;
              if (
                payloadLength < 1 ||
                state.recordEnd > state.bodyBytes!.byteLength
              ) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "recordLength"),
                );
              }
              const created = createDeclarativeV2VerifierRestartRecordDecoderV1(
                state.maximum,
              );
              if (Result.isFailure(created)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "invalidBudget"),
                );
              }
              state.decoder = created.success;
            }
            const pushed = state.bodyOffset < state.recordEnd
              ? state.decoder.push(
                state.bodyBytes!.subarray(
                  state.bodyOffset,
                  state.recordEnd,
                ),
                1,
              )
              : state.decoder.finish(1);
            if (Result.isFailure(pushed)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "record"),
              );
            }
            state.bodyOffset += pushed.success.consumedInputBytes;
            const settled = settle(
              state,
              "rehydrate",
              pushed.success.receipt.delta,
            );
            if (settled !== undefined) return failRehydrator(state, settled);
            if (pushed.success.status === "complete") {
              if (
                pushed.success.record.kind === "module_identity_v1" &&
                !bytesEqualFullScan(
                  pushed.success.record.authenticatedInputSha256,
                  state.claim.authenticatedInputSha256,
                )
              ) {
                return failRehydrator(
                  state,
                  mapFailure(
                    "rehydrate",
                    "staleAuthority",
                    "authenticatedInputSha256",
                  ),
                );
              }
              const recordHash =
                createDeclarativeV2VerifierRuntimeSha256V1(state.hashArena);
              if (Result.isFailure(recordHash)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "recordSha256"),
                );
              }
              state.decodedRecord = pushed.success.record;
              state.recordHash = recordHash.success;
              state.recordHashOffset = state.recordStart;
              state.decoder = undefined;
              state.phase = "hashRecord";
            }
            continue;
          }
          if (state.phase === "hashRecord") {
            if (state.recordHashOffset < state.recordEnd) {
              const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
                state.recordHash,
                state.bodyBytes!.subarray(
                  state.recordHashOffset,
                  state.recordHashOffset + 1,
                ),
                1,
              );
              if (Result.isFailure(hashed)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "recordSha256"),
                );
              }
              const settled = settleHashReceipt(
                state,
                "rehydrate",
                hashed.success.receipt.delta,
              );
              if (settled !== undefined) {
                return failRehydrator(state, settled);
              }
              state.recordHashOffset += Number(
                hashed.success.receipt.delta.consumedBytes,
              );
              continue;
            }
            const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
              state.recordHash,
              1,
            );
            if (Result.isFailure(finished)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "recordSha256"),
              );
            }
            const settled = settleHashReceipt(
              state,
              "rehydrate",
              finished.success.receipt.delta,
            );
            if (settled !== undefined) {
              return failRehydrator(state, settled);
            }
            if (finished.success.status === "pending") continue;
            const record = state.decodedRecord!;
            const next = validateDeclarativeV2VerifierRestartRecordSequenceV1(
              state.sequence,
              record,
              finished.success.digest,
            );
            if (Result.isFailure(next)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "recordOrder"),
              );
            }
            const retainedRecord = charge(
              state,
              "rehydrate",
              "tableBytes",
              8n,
            );
            if (retainedRecord !== undefined) {
              return failRehydrator(state, retainedRecord);
            }
            state.sequence = next.success;
            state.records.push(record);
            if (state.builder !== undefined) {
              const appended = state.bridge.appendModuleRecord(
                state.builder,
                record,
              );
              if (Result.isFailure(appended)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "moduleRecord"),
                );
              }
              const appendSettlement = settle(
                state,
                "rehydrate",
                appended.success,
              );
              if (appendSettlement !== undefined) {
                return failRehydrator(state, appendSettlement);
              }
            }
            state.recordCount += 1n;
            if (record.kind === "diagnostic_v1") {
              state.diagnosticCount += 1n;
            }
            state.decodedRecord = undefined;
            state.recordHash = undefined;
            state.phase = "decode";
            continue;
          }
          if (state.phase === "finishPage") {
            const manifest = state.currentManifest!;
            if (
              manifest.firstEvidenceOrdinal + manifest.evidenceCount !==
                state.recordCount ||
              manifest.firstDiagnosticOrdinal + manifest.diagnosticCount !==
                state.diagnosticCount
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "pageCounts"),
              );
            }
            state.predecessorManifest = manifest;
            state.predecessorPageSha256 = state.currentManifestSha256!;
            state.pageOrdinal += 1n;
            state.currentManifest = undefined;
            state.currentManifestSha256 = undefined;
            state.bodyBytes = undefined;
            state.phase = "metadata";
            continue;
          }
          if (state.phase === "finalize") {
            if (
              state.predecessorManifest === null ||
              state.predecessorPageSha256 === null ||
              !state.sequence.terminal ||
              state.claim.outputManifest === null
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "terminal"),
              );
            }
            const final = validateDeclarativeV2VerifierFinalEvidencePageV2(
              state.predecessorManifest,
              state.predecessorPageSha256,
              state.claim.outputManifest,
            );
            if (Result.isFailure(final)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "outputManifest"),
              );
            }
            const encodedOutput = encodeDeclarativeV2VerifierProgressFrameV2(
              state.claim.outputManifest,
              {
                maximumFrameBytes: Number(
                  state.maximum.frameBytes - state.usage.frameBytes >
                      BigInt(Number.MAX_SAFE_INTEGER)
                    ? BigInt(Number.MAX_SAFE_INTEGER)
                    : state.maximum.frameBytes - state.usage.frameBytes,
                ),
                maximumCanonicalBytes: Number(
                  state.maximum.canonicalBytes - state.usage.canonicalBytes >
                      BigInt(Number.MAX_SAFE_INTEGER)
                    ? BigInt(Number.MAX_SAFE_INTEGER)
                    : state.maximum.canonicalBytes -
                      state.usage.canonicalBytes,
                ),
              },
            );
            if (Result.isFailure(encodedOutput)) {
              if (
                encodedOutput.failure.reason === "frameBytesExceeded" ||
                encodedOutput.failure.reason === "canonicalBytesExceeded"
              ) {
                return failRehydrator(
                  state,
                  runtimeError("rehydrate", "budgetExceeded", {
                    dimension:
                      encodedOutput.failure.reason === "frameBytesExceeded"
                        ? "frameBytes"
                        : "canonicalBytes",
                    ...(encodedOutput.failure.observed === undefined
                      ? {}
                      : { observed: BigInt(encodedOutput.failure.observed) }),
                    ...(encodedOutput.failure.maximum === undefined
                      ? {}
                      : { maximum: BigInt(encodedOutput.failure.maximum) }),
                  }),
                );
              }
              return failRehydrator(
                state,
                mapFailure("rehydrate", "collision", "outputManifestSha256"),
              );
            }
            const outputByteLength = BigInt(
              encodedOutput.success.canonicalBytes.byteLength,
            );
            const outputAdmission =
              charge(state, "rehydrate", "frameBytes", outputByteLength) ??
              charge(
                state,
                "rehydrate",
                "canonicalBytes",
                outputByteLength,
              ) ??
              charge(state, "rehydrate", "hashBytes", outputByteLength);
            if (outputAdmission !== undefined) {
              return failRehydrator(state, outputAdmission);
            }
            const outputDigest =
              deriveDeclarativeV2VerifierRestartCanonicalBytesSha256V1(
                encodedOutput.success.canonicalBytes,
              );
            if (
              Result.isFailure(outputDigest) ||
              state.claim.outputManifestSha256 === null ||
              !bytesEqualFullScan(
                outputDigest.success,
                state.claim.outputManifestSha256,
              )
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "collision", "outputManifestSha256"),
              );
            }
            if (state.claim.commandKind === "parse_module") {
              const finished = state.bridge.finishModuleBuilder(
                state.builder!,
                1,
              );
              if (Result.isFailure(finished)) {
                return failRehydrator(
                  state,
                  finished.failure.reason === "budgetExceeded"
                    ? runtimeError("rehydrate", "budgetExceeded", {
                      path: "moduleResult",
                      ...(isBudgetDimension(finished.failure.dimension)
                        ? { dimension: finished.failure.dimension }
                        : {}),
                      ...(finished.failure.observed === undefined
                        ? {}
                        : { observed: finished.failure.observed }),
                      ...(finished.failure.maximum === undefined
                        ? {}
                        : { maximum: finished.failure.maximum }),
                    })
                    : mapFailure(
                      "rehydrate",
                      "corruption",
                      "moduleResult",
                    ),
                );
              }
              const builderSettlement = settle(
                state,
                "rehydrate",
                finished.success.deltaUsage,
              );
              if (builderSettlement !== undefined) {
                return failRehydrator(state, builderSettlement);
              }
              if (finished.success.status === "pending") continue;
              state.phase = "complete";
              state.closed = true;
              return Result.succeed(Object.freeze({
                status: "complete",
                commandKind: state.claim.commandKind,
                moduleResult: finished.success.result,
                linkResult: null,
                recoveryUsage: freezeUsage(state.usage),
                receipt: receipt(state.usage, before, transitions),
              }));
            }
            state.phase = "link";
            continue;
          }
          if (state.phase === "link") {
            if (state.linker === undefined) {
              const remaining = remainingBudget(state);
              const linker = createDeclarativeV2VerifierLinkerV1(
                remaining,
                linkerRequiredBudget(remaining),
              );
              if (Result.isFailure(linker)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "budgetExceeded", "linker"),
                );
              }
              const createdUsage = readDeclarativeV2VerifierLinkerUsageV1(
                linker.success,
              );
              if (Result.isFailure(createdUsage)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "linkerUsage"),
                );
              }
              const createdSettlement = settleNestedLinkerUsage(
                state,
                createdUsage.success,
              );
              if (createdSettlement !== undefined) {
                return failRehydrator(state, createdSettlement);
              }
              state.linker = linker.success;
              continue;
            }
            if (state.moduleResultNode !== undefined) {
              const appended = appendDeclarativeV2VerifierLinkerModuleV1(
                state.linker,
                state.moduleResultNode.result,
              );
              if (Result.isSuccess(appended)) {
                const appendedUsage =
                  readDeclarativeV2VerifierLinkerUsageV1(state.linker);
                if (Result.isFailure(appendedUsage)) {
                  return failRehydrator(
                    state,
                    mapFailure("rehydrate", "corruption", "linkerUsage"),
                  );
                }
                const appendedSettlement = settleNestedLinkerUsage(
                  state,
                  appendedUsage.success,
                );
                if (appendedSettlement !== undefined) {
                  return failRehydrator(state, appendedSettlement);
                }
                state.moduleResultNode = state.moduleResultNode.next;
                state.linkModuleIndex += 1;
                continue;
              }
              if (appended.failure.reason !== "invalidState") {
                return failRehydrator(
                  state,
                  appended.failure.reason === "budgetExceeded"
                    ? runtimeError("rehydrate", "budgetExceeded", {
                      path: "linker.moduleResult",
                      ...(isBudgetDimension(appended.failure.dimension)
                        ? { dimension: appended.failure.dimension }
                        : {}),
                      ...(appended.failure.observed === undefined
                        ? {}
                        : { observed: appended.failure.observed }),
                      ...(appended.failure.maximum === undefined
                        ? {}
                        : { maximum: appended.failure.maximum }),
                    })
                    : mapFailure(
                      "rehydrate",
                      "staleAuthority",
                      "moduleResult",
                    ),
                );
              }
              const advanced = stepDeclarativeV2VerifierLinkerV1(
                state.linker,
                1,
              );
              if (Result.isFailure(advanced)) {
                return failRehydrator(
                  state,
                  advanced.failure.reason === "budgetExceeded"
                    ? runtimeError("rehydrate", "budgetExceeded", {
                      path: "linker.step",
                      ...(isBudgetDimension(advanced.failure.dimension)
                        ? { dimension: advanced.failure.dimension }
                        : {}),
                      ...(advanced.failure.observed === undefined
                        ? {}
                        : { observed: advanced.failure.observed }),
                      ...(advanced.failure.maximum === undefined
                        ? {}
                        : { maximum: advanced.failure.maximum }),
                    })
                    : mapFailure("rehydrate", "corruption", "linkReplay"),
                );
              }
              const advancedSettlement = settleNestedLinkerUsage(
                state,
                advanced.success.usage,
              );
              if (advancedSettlement !== undefined) {
                return failRehydrator(state, advancedSettlement);
              }
              continue;
            }
            const finished = finishDeclarativeV2VerifierLinkerV1(
              state.linker,
              1,
            );
            if (Result.isFailure(finished)) {
              return failRehydrator(
                state,
                finished.failure.reason === "budgetExceeded"
                  ? runtimeError("rehydrate", "budgetExceeded", {
                    path: "linker.finish",
                    ...(isBudgetDimension(finished.failure.dimension)
                      ? { dimension: finished.failure.dimension }
                      : {}),
                    ...(finished.failure.observed === undefined
                      ? {}
                      : { observed: finished.failure.observed }),
                    ...(finished.failure.maximum === undefined
                      ? {}
                      : { maximum: finished.failure.maximum }),
                  })
                  : mapFailure("rehydrate", "corruption", "linkReplay"),
              );
            }
            const finishSettlement = settleNestedLinkerUsage(
              state,
              finished.success.usage,
            );
            if (finishSettlement !== undefined) {
              return failRehydrator(state, finishSettlement);
            }
            if ("status" in finished.success) continue;
            const terminal = state.records[state.records.length - 1];
            if (
              terminal?.kind !== "link_terminal_v1" ||
              terminal.moduleCount !== finished.success.moduleCount ||
              terminal.diagnosticCount !== finished.success.diagnosticCount
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "linkReplayResult"),
              );
            }
            const adopted = state.bridge.adoptLinkResult(
              finished.success,
              state.claim.parsePagesRootSha256,
            );
            const sequence =
              initialDeclarativeV2VerifierRestartSequenceStateV1(
                "link_page",
                state.claim.parsePagesRootSha256,
              );
            if (Result.isFailure(adopted)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "linkReplayProvenance"),
              );
            }
            state.linkResult = finished.success;
            const ownedCursor = state.bridge.openLinkRecords(
              finished.success,
              state.claim.parsePagesRootSha256,
              state.maximum,
            );
            if (Result.isFailure(ownedCursor) || Result.isFailure(sequence)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "linkReplayCursor"),
              );
            }
            state.linkRecordCursor = ownedCursor.success;
            state.linkCompareSequence = sequence.success;
            state.phase = "compareLink";
            continue;
          }
          if (state.phase === "compareLink") {
            if (
              state.linkLiveEncoder === undefined &&
              state.linkStoredEncoder === undefined &&
              state.linkLiveBytes === undefined &&
              state.linkStoredBytes === undefined
            ) {
              const read = state.bridge.readLinkRecord(
                state.linkRecordCursor,
                1,
              );
              if (Result.isFailure(read)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "linkReplayRecord"),
                );
              }
              const readCharge = settle(
                state,
                "rehydrate",
                read.success.deltaUsage,
              );
              if (readCharge !== undefined) {
                return failRehydrator(state, readCharge);
              }
              if (read.success.status === "complete") {
                if (state.linkCompareIndex !== state.records.length) {
                  return failRehydrator(
                    state,
                    mapFailure("rehydrate", "corruption", "linkReplayCount"),
                  );
                }
                state.phase = "complete";
                state.closed = true;
                return Result.succeed(Object.freeze({
                  status: "complete",
                  commandKind: state.claim.commandKind,
                  moduleResult: null,
                  linkResult: state.linkResult!,
                  recoveryUsage: freezeUsage(state.usage),
                  receipt: receipt(state.usage, before, transitions),
                }));
              }
              if (read.success.status === "pending") continue;
              if (
                state.linkCompareIndex >= state.records.length
              ) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "linkReplayCount"),
                );
              }
              state.linkLiveRecord = patchTerminalRecord(
                read.success.record,
                state.linkCompareSequence!,
              );
              const live = createDeclarativeV2VerifierRestartRecordEncoderV1(
                state.linkLiveRecord,
                state.maximum,
              );
              const stored = createDeclarativeV2VerifierRestartRecordEncoderV1(
                state.records[state.linkCompareIndex],
                state.maximum,
              );
              if (Result.isFailure(live) || Result.isFailure(stored)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "linkReplayEncoding"),
                );
              }
              state.linkLiveEncoder = live.success;
              state.linkStoredEncoder = stored.success;
              continue;
            }
            if (state.linkLiveBytes === undefined) {
              const live = state.linkLiveEncoder!.finish(1);
              if (Result.isFailure(live)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "linkReplayEncoding"),
                );
              }
              const settled = settle(state, "rehydrate", live.success.receipt.delta);
              if (settled !== undefined) return failRehydrator(state, settled);
              if (live.success.status === "complete") {
                state.linkLiveBytes = live.success.canonicalBytes;
              }
              continue;
            }
            if (state.linkStoredBytes === undefined) {
              const stored = state.linkStoredEncoder!.finish(1);
              if (Result.isFailure(stored)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "linkReplayEncoding"),
                );
              }
              const settled = settle(
                state,
                "rehydrate",
                stored.success.receipt.delta,
              );
              if (settled !== undefined) return failRehydrator(state, settled);
              if (stored.success.status === "pending") continue;
              state.linkStoredBytes = stored.success.canonicalBytes;
              continue;
            }
            if (
              state.linkLiveBytes.byteLength !==
                state.linkStoredBytes.byteLength
            ) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "collision", "linkReplayBytes"),
              );
            }
            if (state.linkCompareOffset < state.linkLiveBytes.byteLength) {
              if (
                state.linkLiveBytes[state.linkCompareOffset] !==
                  state.linkStoredBytes[state.linkCompareOffset]
              ) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "collision", "linkReplayBytes"),
                );
              }
              state.linkCompareOffset += 1;
              continue;
            }
            if (state.linkRecordHash === undefined) {
              const created =
                createDeclarativeV2VerifierRuntimeSha256V1(state.hashArena);
              if (Result.isFailure(created)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "linkReplayDigest"),
                );
              }
              state.linkRecordHash = created.success;
              state.linkRecordHashOffset = 0;
              continue;
            }
            if (state.linkRecordHashOffset < state.linkLiveBytes.byteLength) {
              const hashed = stepDeclarativeV2VerifierRuntimeSha256V1(
                state.linkRecordHash,
                state.linkLiveBytes.subarray(
                  state.linkRecordHashOffset,
                  state.linkRecordHashOffset + 1,
                ),
                1,
              );
              if (Result.isFailure(hashed)) {
                return failRehydrator(
                  state,
                  mapFailure("rehydrate", "corruption", "linkReplayDigest"),
                );
              }
              const hashSettlement = settleHashReceipt(
                state,
                "rehydrate",
                hashed.success.receipt.delta,
              );
              if (hashSettlement !== undefined) {
                return failRehydrator(state, hashSettlement);
              }
              state.linkRecordHashOffset += Number(
                hashed.success.receipt.delta.consumedBytes,
              );
              continue;
            }
            const digest = finishDeclarativeV2VerifierRuntimeSha256V1(
              state.linkRecordHash,
              1,
            );
            if (Result.isFailure(digest)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "linkReplayDigest"),
              );
            }
            const hashSettlement = settleHashReceipt(
              state,
              "rehydrate",
              digest.success.receipt.delta,
            );
            if (hashSettlement !== undefined) {
              return failRehydrator(state, hashSettlement);
            }
            if (digest.success.status === "pending") continue;
            const next = validateDeclarativeV2VerifierRestartRecordSequenceV1(
              state.linkCompareSequence,
              state.linkLiveRecord,
              digest.success.digest,
            );
            if (Result.isFailure(next)) {
              return failRehydrator(
                state,
                mapFailure("rehydrate", "corruption", "linkReplaySequence"),
              );
            }
            state.linkCompareSequence = next.success;
            state.linkCompareIndex += 1;
            state.linkLiveEncoder = undefined;
            state.linkStoredEncoder = undefined;
            state.linkLiveRecord = undefined;
            state.linkLiveBytes = undefined;
            state.linkStoredBytes = undefined;
            state.linkCompareOffset = 0;
            state.linkRecordHash = undefined;
            state.linkRecordHashOffset = 0;
            continue;
          }
          return failRehydrator(
            state,
            mapFailure("rehydrate", "closed"),
          );
        }
        return Result.succeed(Object.freeze({
          status: "pending",
          receipt: receipt(state.usage, before, transitions),
        }));
      };

  const close: DeclarativeV2VerifierRestartRuntimeFactoryV1["close"] =
    rawHandle => {
      if (rawHandle === null || typeof rawHandle !== "object") {
        return Result.fail(runtimeError("close", "staleAuthority"));
      }
      const producer = producers.get(rawHandle);
      if (producer !== undefined) {
        if (producer.closed) {
          return Result.fail(runtimeError("close", "closed"));
        }
        producer.closed = true;
        return Result.succeed(undefined);
      }
      const rehydrator = rehydrators.get(rawHandle);
      if (rehydrator !== undefined) {
        if (rehydrator.closed) {
          return Result.fail(runtimeError("close", "closed"));
        }
        rehydrator.closed = true;
        rehydrator.phase = "failed";
        return Result.succeed(undefined);
      }
      const resultSet = moduleResultSets.get(rawHandle);
      if (resultSet !== undefined) {
        if (resultSet.closed) {
          return Result.fail(runtimeError("close", "closed"));
        }
        resultSet.closed = true;
        resultSet.head = undefined;
        resultSet.tail = undefined;
        return Result.succeed(undefined);
      }
      return Result.fail(runtimeError("close", "staleAuthority"));
    };

  return Object.freeze({
    createModuleResultSet,
    appendModuleResult,
    sealModuleResultSet,
    createProducer,
    stepProducer,
    createRehydrator,
    stepRehydrator,
    close,
  });
}
