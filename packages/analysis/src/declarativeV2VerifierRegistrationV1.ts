import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Result } from "effect";
import {
  makeDeclarativeV2PhysicalFrameEncoderFactoryV1,
  type DeclarativeV2PhysicalFrameEncoderCursorV1,
  type DeclarativeV2PhysicalFrameEncoderFactoryV1,
  type DeclarativeV2PhysicalFrameEncodingPlanV1,
  type DeclarativeV2RegistrationFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  makeDeclarativeV2VerifierProgressFrameEncoderFactoryV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierFrameBudgetV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
  type DeclarativeV2VerifierProgressFrameEncoderCursorV2,
  type DeclarativeV2VerifierProgressFrameEncoderFactoryV2,
  type DeclarativeV2VerifierProgressFrameEncodingPlanV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import type {
  DeclarativeV2SemanticFunctionRecordV1,
  DeclarativeV2SemanticHandlerRecordV1,
  DeclarativeV2SemanticRecordV1,
} from "flarex-protocol/internal/declarative-v2-semantic-record-v1";

import {
  createDeclarativeV2SemanticStreamDecoderV1,
  type DeclarativeV2SemanticStreamBudgetV1,
  type DeclarativeV2SemanticStreamDetailedUsageV1,
  type DeclarativeV2SemanticStreamUsageV1,
} from "./declarativeV2SemanticRecordsV1";
import {
  declarativeV2VerifierCompletedLinkClaimPortV1,
  type DeclarativeV2VerifierAuthenticatedLinkBindingsV1,
  type DeclarativeV2VerifierAuthenticatedLinkFactoryV1,
  type DeclarativeV2VerifierCompletedLinkCapabilitiesV1,
  type DeclarativeV2VerifierCompletedLinkClaimPortV1,
  type DeclarativeV2VerifierCompletedLinkClaimV1,
  type DeclarativeV2VerifierCompletedLinkLookupUsageV1,
  type DeclarativeV2VerifierCompletedLinkLookupV1,
  type DeclarativeV2VerifierLinkResultV1,
} from "./declarativeV2VerifierExecutableV1";
import {
  DECLARATIVE_V2_CORE_CAPABILITY_MATRIX_V1,
} from "./declarativeV2VerifierV1.contract";
import {
  createDeclarativeV2VerifierRuntimeArenaV1,
  createDeclarativeV2VerifierRuntimeSha256V1,
  finishDeclarativeV2VerifierRuntimeSha256V1,
  revokeDeclarativeV2VerifierRuntimeArenaV1,
  stepDeclarativeV2VerifierRuntimeSha256V1,
  type DeclarativeV2VerifierRuntimeArenaHandleV1,
  type DeclarativeV2VerifierRuntimeSha256V1,
} from "./declarativeV2VerifierRuntimeArenaV1";
import {
  planDeclarativeV2VerifierSha256WorkV1,
} from "./declarativeV2VerifierSizingV1";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_U32 = 0xffff_ffffn;
const TRANSITION_QUANTUM = 1_024;
const SEMANTIC_CHUNK_BYTES = 1_024;
const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 1_048_576,
  maximumCanonicalBytes: 1_048_576,
});
const PROGRESS_FRAME_BUDGET: DeclarativeV2VerifierFrameBudgetV2 =
  Object.freeze({
    maximumFrameBytes: 1_048_576,
    maximumCanonicalBytes: 1_048_576,
  });
const EMPTY_SHA256 = Uint8Array.from([
  0xe3, 0xb0, 0xc4, 0x42, 0x98, 0xfc, 0x1c, 0x14,
  0x9a, 0xfb, 0xf4, 0xc8, 0x99, 0x6f, 0xb9, 0x24,
  0x27, 0xae, 0x41, 0xe4, 0x64, 0x9b, 0x93, 0x4c,
  0xa4, 0x95, 0x99, 0x1b, 0x78, 0x52, 0xb8, 0x55,
]);
const HANDLER_IDENTITY_DOMAIN = new TextEncoder().encode(
  "flarex.analysis/declarative-v2/registration-handler/v1\0",
);
const ZERO_BYTE = Uint8Array.of(0);
const FUNCTION_KIND_BYTES = Object.freeze({
  action: new TextEncoder().encode("action"),
  mutation: new TextEncoder().encode("mutation"),
  query: new TextEncoder().encode("query"),
  workflowMutation: new TextEncoder().encode("workflowMutation"),
});
const VISIBILITY_BYTES = Object.freeze({
  internal: new TextEncoder().encode("internal"),
  public: new TextEncoder().encode("public"),
});
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "buffer",
)?.get;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
        SharedArrayBuffer.prototype,
        "byteLength",
      )?.get;

function handlerCapabilitiesAdmittedV1(
  functionKind: keyof typeof FUNCTION_KIND_BYTES,
  capabilities: DeclarativeV2VerifierCompletedLinkCapabilitiesV1,
): boolean {
  const admitted = DECLARATIVE_V2_CORE_CAPABILITY_MATRIX_V1.find(
    candidate => candidate.functionKind === functionKind,
  );
  if (admitted === undefined) {
    throw new Error("Declared function kind lost its capability matrix row.");
  }
  return (!capabilities.auth || admitted.auth) &&
    (!capabilities.databaseRead || admitted.databaseRead) &&
    (!capabilities.databaseWrite || admitted.databaseWrite) &&
    (!capabilities.runQuery || admitted.runQuery) &&
    (!capabilities.runMutation || admitted.runMutation);
}

export type DeclarativeV2VerifierRegistrationV1ErrorReason =
  | "invalidInput"
  | "identityMismatch"
  | "invalidTransition"
  | "semanticFailure"
  | "moduleMismatch"
  | "budgetExceeded"
  | "addressabilityExceeded"
  | "staleHandle"
  | "closed";

export class DeclarativeV2VerifierRegistrationV1Error extends Data.TaggedError(
  "DeclarativeV2VerifierRegistrationV1Error",
)<{
  readonly operation: "create" | "step" | "finish" | "close";
  readonly reason: DeclarativeV2VerifierRegistrationV1ErrorReason;
  readonly path?: string;
  readonly dimension?: typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number];
  readonly observed?: bigint;
  readonly maximum?: bigint;
}> {}

export interface DeclarativeV2VerifierRegistrationBindingsV1 {
  readonly attemptSha256: Uint8Array;
  readonly futureRegistrationIntentSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly authenticatedInputSha256: Uint8Array;
  readonly linkSequence: bigint;
  readonly parsePagesRootSha256: Uint8Array;
  readonly currentProgressSha256: Uint8Array;
  readonly predecessorAndTailsSha256: Uint8Array;
  readonly rangeSha256: Uint8Array;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly registrationReservationSha256: Uint8Array;
  readonly semanticSha256: Uint8Array;
}

export interface DeclarativeV2VerifierRegistrationInputV1 {
  readonly bindings: DeclarativeV2VerifierRegistrationBindingsV1;
  readonly commandKind: "registration_page";
  readonly sequence: bigint;
  readonly currentProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly predecessorReceiptSha256: Uint8Array | null;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2;
  readonly semanticBudget: DeclarativeV2SemanticStreamBudgetV1;
  readonly semanticBytes: Uint8Array;
  readonly completedLinkResult: DeclarativeV2VerifierLinkResultV1;
  readonly completedLinkBindings:
    DeclarativeV2VerifierAuthenticatedLinkBindingsV1;
}

export type DeclarativeV2VerifierRegistrationCapacityV1 = Readonly<{
  readonly _tag: "DeclarativeV2VerifierRegistrationCapacityV1";
}> & Readonly<Record<
  typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
  bigint
>>;

export interface DeclarativeV2VerifierRegistrationDriverV1 {
  readonly _tag: "DeclarativeV2VerifierRegistrationDriverV1";
}

export interface DeclarativeV2VerifierRegistrationReceiptV1 {
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2VerifierRegistrationPendingV1 {
  readonly status: "pending";
  readonly receipt: DeclarativeV2VerifierRegistrationReceiptV1;
}

export interface DeclarativeV2VerifierRegistrationCompleteV1 {
  readonly status: "complete";
  readonly capacity: DeclarativeV2VerifierRegistrationCapacityV1;
  readonly actual: DeclarativeV2VerifierBudgetFrameV2;
  readonly registrationFrames: ReadonlyArray<Uint8Array>;
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly nextProgressBytes: Uint8Array;
  readonly outputManifest: DeclarativeV2VerifierCommandOutputManifestFrameV2;
  readonly outputManifestBytes: Uint8Array;
  readonly registrationRootSha256: Uint8Array;
  readonly receipt: DeclarativeV2VerifierRegistrationReceiptV1;
}

export type DeclarativeV2VerifierRegistrationStepV1 =
  | DeclarativeV2VerifierRegistrationPendingV1
  | DeclarativeV2VerifierRegistrationCompleteV1;

export interface DeclarativeV2VerifierRegistrationFactoryV1 {
  readonly create: (
    input: unknown,
    expectedBindings: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRegistrationDriverV1,
    DeclarativeV2VerifierRegistrationV1Error
  >;
  readonly step: (
    driver: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRegistrationStepV1,
    DeclarativeV2VerifierRegistrationV1Error
  >;
  readonly finish: (
    driver: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierRegistrationStepV1,
    DeclarativeV2VerifierRegistrationV1Error
  >;
  readonly close: (
    driver: unknown,
  ) => Result.Result<void, DeclarativeV2VerifierRegistrationV1Error>;
}

type CapturedBindings = Readonly<{
  attemptSha256: Uint8Array;
  futureRegistrationIntentSha256: Uint8Array;
  candidateSha256: Uint8Array;
  authenticatedInputSha256: Uint8Array;
  linkSequence: bigint;
  parsePagesRootSha256: Uint8Array;
  currentProgressSha256: Uint8Array;
  predecessorAndTailsSha256: Uint8Array;
  rangeSha256: Uint8Array;
  analyzerReleaseSha256: Uint8Array;
  analyzerIdentitySha256: Uint8Array;
  verifierIdentitySha256: Uint8Array;
  registrationReservationSha256: Uint8Array;
  semanticSha256: Uint8Array;
}>;

type CapturedInput = Readonly<{
  bindings: CapturedBindings;
  completedLinkBindings: DeclarativeV2VerifierAuthenticatedLinkBindingsV1;
  sequence: bigint;
  currentProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  predecessorReceiptSha256: Uint8Array | null;
  commandBudget: DeclarativeV2VerifierBudgetFrameV2;
  semanticBudget: DeclarativeV2SemanticStreamBudgetV1;
  semanticBytes: Uint8Array;
  completedLinkResult: DeclarativeV2VerifierLinkResultV1;
}>;

type MutableUsage = Record<
  typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
  bigint
>;

type PhysicalPlan = {
  readonly frame: DeclarativeV2RegistrationFrameV1;
  readonly cursor: DeclarativeV2PhysicalFrameEncoderCursorV1;
  readonly plan: DeclarativeV2PhysicalFrameEncodingPlanV1;
  destination?: Uint8Array;
};

type ProgressPlan = {
  readonly cursor: DeclarativeV2VerifierProgressFrameEncoderCursorV2;
  readonly plan: DeclarativeV2VerifierProgressFrameEncodingPlanV2;
  destination?: Uint8Array;
};

type HandlerWork = Readonly<{
  handler: DeclarativeV2SemanticHandlerRecordV1;
  fn: DeclarativeV2SemanticFunctionRecordV1;
  moduleOrdinal: bigint;
  producingParseResultSha256: Uint8Array;
  identitySha256: Uint8Array;
  identityPreimageByteLength: bigint;
}>;

type Utf8Capture = {
  readonly source: string;
  readonly maximumByteLength: number;
  storageAdmitted: boolean;
  phase: "allocate" | "read" | "write" | "complete";
  destination: Uint8Array | undefined;
  sourceIndex: number;
  outputIndex: number;
  scalarBytes: readonly number[];
  scalarIndex: number;
};

type ActiveHash = {
  readonly hash: DeclarativeV2VerifierRuntimeSha256V1;
  readonly parts: ReadonlyArray<Uint8Array>;
  partIndex: number;
  partOffset: number;
  finishing: boolean;
  onComplete: (digest: Uint8Array) => void;
};

type Phase =
  | "emitCurrentProgress"
  | "hashCurrentProgress"
  | "verifyCurrentProgress"
  | "captureSemantic"
  | "decodeSemantic"
  | "hashSemantic"
  | "finishSemantic"
  | "finishSemanticHash"
  | "prepareHandler"
  | "captureHandlerModule"
  | "captureHandlerExport"
  | "captureHandlerFunction"
  | "beginLookup"
  | "stepLookup"
  | "hashHandler"
  | "planPhysical"
  | "planTerminal"
  | "admitPhysical"
  | "emitPhysical"
  | "hashRegistrationRoot"
  | "emitNextProgress"
  | "hashNextProgress"
  | "emitManifest"
  | "hashManifest"
  | "publish";

interface DriverState {
  input: CapturedInput | undefined;
  linkPort: DeclarativeV2VerifierCompletedLinkClaimPortV1 | undefined;
  linkClaim: DeclarativeV2VerifierCompletedLinkClaimV1 | undefined;
  linkLookup: DeclarativeV2VerifierCompletedLinkLookupV1 | undefined;
  semanticDecoder: (ReturnType<
    typeof createDeclarativeV2SemanticStreamDecoderV1
  > extends Result.Result<infer A, unknown> ? A : never) | undefined;
  semanticBorrowed: Uint8Array | undefined;
  semanticOffset: number;
  scratch: Uint8Array | undefined;
  scratchLength: number;
  scratchDecodeOffset: number;
  scratchHashOffset: number;
  semanticHash: DeclarativeV2VerifierRuntimeSha256V1 | undefined;
  semanticUsage: DeclarativeV2SemanticStreamUsageV1;
  semanticDetailed: DeclarativeV2SemanticStreamDetailedUsageV1;
  semanticMechanical: Readonly<{
    inputBytes: number;
    canonicalBytes: number;
    stringBytes: number;
    members: number;
    depth: number;
    transitions: number;
  }>;
  readonly functions: Map<string, DeclarativeV2SemanticFunctionRecordV1>;
  readonly handlers: Array<DeclarativeV2SemanticHandlerRecordV1>;
  readonly handlerWork: Array<HandlerWork>;
  resolveIndex: number;
  lookupUsage: DeclarativeV2VerifierCompletedLinkLookupUsageV1;
  lookupInputStringBytes: bigint;
  retainedHandlerStorageBytes: bigint;
  peakHandlerStorageBytes: bigint;
  pendingHandler:
    | {
        handler: DeclarativeV2SemanticHandlerRecordV1;
        fn: DeclarativeV2SemanticFunctionRecordV1;
        moduleOrdinal: bigint;
        producingParseResultSha256: Uint8Array;
        modulePathUtf8: Uint8Array | undefined;
        exportNameUtf8: Uint8Array | undefined;
        functionPathUtf8: Uint8Array | undefined;
        retainedStorageBytes: bigint;
      }
    | undefined;
  textCapture: Utf8Capture | undefined;
  hashArena: DeclarativeV2VerifierRuntimeArenaHandleV1 | undefined;
  activeHash: ActiveHash | undefined;
  readonly physicalPlans: Array<PhysicalPlan>;
  registrationFrames: Array<Uint8Array>;
  physicalCanonicalByteLength: bigint;
  maximumPhysicalFrameByteLength: bigint;
  physicalEmitterTransitions: bigint;
  handlerIdentityHashBytes: bigint;
  physicalIndex: number;
  physicalFactory: DeclarativeV2PhysicalFrameEncoderFactoryV1 | undefined;
  progressFactory: DeclarativeV2VerifierProgressFrameEncoderFactoryV2 | undefined;
  currentProgressPlan: ProgressPlan | undefined;
  readonly currentProgressCanonicalByteLength: bigint;
  currentProgressSha256: Uint8Array | undefined;
  currentProgressCompareIndex: number;
  currentProgressMatches: boolean;
  nextProgress: DeclarativeV2VerifierProgressCursorFrameV2 | undefined;
  nextProgressPlan: ProgressPlan | undefined;
  outputManifestPlanningCursor:
    | DeclarativeV2VerifierProgressFrameEncoderCursorV2
    | undefined;
  outputManifestPlan: DeclarativeV2VerifierProgressFrameEncodingPlanV2 | undefined;
  outputManifest: DeclarativeV2VerifierCommandOutputManifestFrameV2 | undefined;
  outputManifestCursor:
    | DeclarativeV2VerifierProgressFrameEncoderCursorV2
    | undefined;
  outputManifestDestination: Uint8Array | undefined;
  registrationRootSha256: Uint8Array | undefined;
  nextProgressSha256: Uint8Array | undefined;
  capacity: DeclarativeV2VerifierRegistrationCapacityV1 | undefined;
  readonly actual: MutableUsage;
  phase: Phase;
  coreTransitions: bigint;
  terminal: "open" | "complete" | "closed";
}

function registrationError(
  operation: DeclarativeV2VerifierRegistrationV1Error["operation"],
  reason: DeclarativeV2VerifierRegistrationV1ErrorReason,
  path?: string,
  dimension?: typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
  observed?: bigint,
  maximum?: bigint,
): DeclarativeV2VerifierRegistrationV1Error {
  return new DeclarativeV2VerifierRegistrationV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(dimension === undefined ? {} : { dimension }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

function zeroUsage(): MutableUsage {
  return Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      0n,
    ]),
  ) as MutableUsage;
}

function freezeUsage(
  kind: "attempt_usage" | "command_budget",
  usage: Readonly<MutableUsage>,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind,
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        usage[dimension],
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function usageDelta(
  usage: Readonly<MutableUsage>,
  before: Readonly<MutableUsage>,
): DeclarativeV2VerifierBudgetFrameV2 {
  const delta = zeroUsage();
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    delta[dimension] = usage[dimension] - before[dimension];
  }
  return freezeUsage("attempt_usage", delta);
}

function receipt(
  state: DriverState,
  before: Readonly<MutableUsage>,
  transitions: number,
): DeclarativeV2VerifierRegistrationReceiptV1 {
  return Object.freeze({
    transitionCount: transitions,
    deltaUsage: usageDelta(state.actual, before),
    usage: freezeUsage("attempt_usage", state.actual),
  });
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some(key => typeof key !== "string" || !keys.includes(key))
    ) return undefined;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

function ownedDigest(value: unknown): Uint8Array | undefined {
  if (
    !isUint8ArrayWithByteLength(value, 32) ||
    TYPED_ARRAY_BUFFER_GETTER === undefined
  ) return undefined;
  try {
    const buffer = Reflect.apply(
      TYPED_ARRAY_BUFFER_GETTER,
      value,
      [],
    ) as ArrayBufferLike;
    if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
      try {
        Reflect.apply(SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
        return undefined;
      } catch {
        // Ordinary ArrayBuffer-backed digests are captured below.
      }
    }
    return new Uint8Array(value);
  } catch {
    return undefined;
  }
}

function borrowedBytes(value: unknown): Uint8Array | undefined {
  if (
    !isUint8Array(value) ||
    TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined ||
    TYPED_ARRAY_BUFFER_GETTER === undefined
  ) return undefined;
  try {
    const length = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    ) as number;
    if (!Number.isSafeInteger(length) || length < 1 || BigInt(length) > MAX_U32) {
      return undefined;
    }
    const buffer = Reflect.apply(
      TYPED_ARRAY_BUFFER_GETTER,
      value,
      [],
    ) as ArrayBufferLike;
    if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
      try {
        Reflect.apply(SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
        return undefined;
      } catch {
        // Ordinary ArrayBuffer-backed bytes are retained as a visible view.
      }
    }
    return Reflect.apply(UINT8_ARRAY_SUBARRAY, value, [0, length]) as Uint8Array;
  } catch {
    return undefined;
  }
}

function signedInt64(value: unknown, positive: boolean): bigint | undefined {
  return typeof value === "bigint" &&
      value >= (positive ? 1n : 0n) &&
      value <= MAX_SIGNED_INT64
    ? value
    : undefined;
}

function captureProgress(
  value: unknown,
): DeclarativeV2VerifierProgressCursorFrameV2 | undefined {
  const record = exactRecord(value, [
    "kind",
    "phase",
    "settledSequence",
    "moduleOrdinal",
    "edgeOrdinal",
    "pageOrdinal",
    "previousReceiptSha256",
  ]);
  if (
    record === undefined ||
    record.kind !== "progress_cursor" ||
    ![
      "source",
      "parse",
      "link",
      "registration",
      "verdict",
    ].includes(record.phase as string)
  ) return undefined;
  const settledSequence = signedInt64(record.settledSequence, false);
  const moduleOrdinal = signedInt64(record.moduleOrdinal, false);
  const edgeOrdinal = signedInt64(record.edgeOrdinal, false);
  const pageOrdinal = signedInt64(record.pageOrdinal, false);
  const previous = record.previousReceiptSha256 === null
    ? null
    : ownedDigest(record.previousReceiptSha256);
  if (
    settledSequence === undefined ||
    moduleOrdinal === undefined ||
    edgeOrdinal === undefined ||
    pageOrdinal === undefined ||
    (record.previousReceiptSha256 !== null && previous === undefined)
  ) return undefined;
  return Object.freeze({
    kind: "progress_cursor",
    phase: record.phase as DeclarativeV2VerifierProgressCursorFrameV2["phase"],
    settledSequence,
    moduleOrdinal,
    edgeOrdinal,
    pageOrdinal,
    previousReceiptSha256: previous!,
  });
}

function captureBudget(
  value: unknown,
): DeclarativeV2VerifierBudgetFrameV2 | undefined {
  const keys = [
    "kind",
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  ];
  const record = exactRecord(value, keys);
  if (record === undefined || record.kind !== "command_budget") return undefined;
  const usage = zeroUsage();
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    const amount = signedInt64(record[dimension], false);
    if (amount === undefined) return undefined;
    usage[dimension] = amount;
  }
  return freezeUsage("command_budget", usage);
}

const BINDING_KEYS = [
  "attemptSha256",
  "futureRegistrationIntentSha256",
  "candidateSha256",
  "authenticatedInputSha256",
  "linkSequence",
  "parsePagesRootSha256",
  "currentProgressSha256",
  "predecessorAndTailsSha256",
  "rangeSha256",
  "analyzerReleaseSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
  "registrationReservationSha256",
  "semanticSha256",
] as const;

const LINK_BINDING_KEYS = [
  "attemptSha256",
  "futureRegistrationIntentSha256",
  "candidateSha256",
  "authenticatedInputSha256",
  "linkSequence",
  "parsePagesRootSha256",
  "currentProgressSha256",
  "predecessorAndTailsSha256",
  "rangeSha256",
  "analyzerReleaseSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
] as const;

function captureBindings(value: unknown): CapturedBindings | undefined {
  const record = exactRecord(value, BINDING_KEYS);
  if (record === undefined) return undefined;
  const linkSequence = signedInt64(record.linkSequence, true);
  const digests = Object.fromEntries(
    BINDING_KEYS.filter(key => key !== "linkSequence").map(key => [
      key,
      ownedDigest(record[key]),
    ]),
  ) as Record<Exclude<typeof BINDING_KEYS[number], "linkSequence">, Uint8Array | undefined>;
  if (
    linkSequence === undefined ||
    Object.values(digests).some(value => value === undefined)
  ) return undefined;
  return Object.freeze({
    ...digests,
    linkSequence,
  }) as CapturedBindings;
}

function sameBindings(left: CapturedBindings, right: CapturedBindings): boolean {
  if (left.linkSequence !== right.linkSequence) return false;
  return BINDING_KEYS.every(key =>
    key === "linkSequence" ||
    bytesEqualFullScan(left[key], right[key])
  );
}

export function declarativeV2StableLinkContinuityMatchesRegistrationV1(
  link: DeclarativeV2VerifierAuthenticatedLinkBindingsV1,
  registration: DeclarativeV2VerifierRegistrationBindingsV1,
): boolean {
  return link.linkSequence === registration.linkSequence &&
    bytesEqualFullScan(link.attemptSha256, registration.attemptSha256) &&
    bytesEqualFullScan(
      link.futureRegistrationIntentSha256,
      registration.futureRegistrationIntentSha256,
    ) &&
    bytesEqualFullScan(link.candidateSha256, registration.candidateSha256) &&
    bytesEqualFullScan(
      link.authenticatedInputSha256,
      registration.authenticatedInputSha256,
    ) &&
    bytesEqualFullScan(
      link.parsePagesRootSha256,
      registration.parsePagesRootSha256,
    ) &&
    bytesEqualFullScan(
      link.currentProgressSha256,
      registration.currentProgressSha256,
    ) &&
    bytesEqualFullScan(
      link.analyzerReleaseSha256,
      registration.analyzerReleaseSha256,
    ) &&
    bytesEqualFullScan(
      link.analyzerIdentitySha256,
      registration.analyzerIdentitySha256,
    ) &&
    bytesEqualFullScan(
      link.verifierIdentitySha256,
      registration.verifierIdentitySha256,
    );
}

function captureLinkBindings(
  value: unknown,
): DeclarativeV2VerifierAuthenticatedLinkBindingsV1 | undefined {
  const record = exactRecord(value, LINK_BINDING_KEYS);
  if (record === undefined) return undefined;
  const linkSequence = signedInt64(record.linkSequence, true);
  const attemptSha256 = ownedDigest(record.attemptSha256);
  const futureRegistrationIntentSha256 =
    ownedDigest(record.futureRegistrationIntentSha256);
  const candidateSha256 = ownedDigest(record.candidateSha256);
  const authenticatedInputSha256 =
    ownedDigest(record.authenticatedInputSha256);
  const parsePagesRootSha256 = ownedDigest(record.parsePagesRootSha256);
  const currentProgressSha256 = ownedDigest(record.currentProgressSha256);
  const predecessorAndTailsSha256 =
    ownedDigest(record.predecessorAndTailsSha256);
  const rangeSha256 = ownedDigest(record.rangeSha256);
  const analyzerReleaseSha256 = ownedDigest(record.analyzerReleaseSha256);
  const analyzerIdentitySha256 = ownedDigest(record.analyzerIdentitySha256);
  const verifierIdentitySha256 = ownedDigest(record.verifierIdentitySha256);
  if (
    linkSequence === undefined ||
    attemptSha256 === undefined ||
    futureRegistrationIntentSha256 === undefined ||
    candidateSha256 === undefined ||
    authenticatedInputSha256 === undefined ||
    parsePagesRootSha256 === undefined ||
    currentProgressSha256 === undefined ||
    predecessorAndTailsSha256 === undefined ||
    rangeSha256 === undefined ||
    analyzerReleaseSha256 === undefined ||
    analyzerIdentitySha256 === undefined ||
    verifierIdentitySha256 === undefined
  ) return undefined;
  return Object.freeze({
    attemptSha256,
    futureRegistrationIntentSha256,
    candidateSha256,
    authenticatedInputSha256,
    linkSequence,
    parsePagesRootSha256,
    currentProgressSha256,
    predecessorAndTailsSha256,
    rangeSha256,
    analyzerReleaseSha256,
    analyzerIdentitySha256,
    verifierIdentitySha256,
  });
}

function captureInput(
  rawInput: unknown,
  rawExpectedBindings: unknown,
): Result.Result<CapturedInput, DeclarativeV2VerifierRegistrationV1Error> {
  const record = exactRecord(rawInput, [
    "bindings",
    "commandKind",
    "sequence",
    "currentProgress",
    "predecessorReceiptSha256",
    "commandBudget",
    "semanticBudget",
    "semanticBytes",
    "completedLinkResult",
    "completedLinkBindings",
  ]);
  const bindings = record === undefined
    ? undefined
    : captureBindings(record.bindings);
  const expected = captureBindings(rawExpectedBindings);
  const completedLinkBindings = record === undefined
    ? undefined
    : captureLinkBindings(record.completedLinkBindings);
  if (
    record === undefined ||
    bindings === undefined ||
    expected === undefined ||
    completedLinkBindings === undefined
  ) {
    return Result.fail(registrationError("create", "invalidInput", "input"));
  }
  if (!sameBindings(bindings, expected)) {
    return Result.fail(
      registrationError("create", "identityMismatch", "bindings"),
    );
  }
  if (
    !declarativeV2StableLinkContinuityMatchesRegistrationV1(
      completedLinkBindings,
      bindings,
    )
  ) {
    return Result.fail(
      registrationError(
        "create",
        "identityMismatch",
        "completedLinkBindings",
      ),
    );
  }
  const sequence = signedInt64(record.sequence, true);
  const currentProgress = captureProgress(record.currentProgress);
  const predecessor = record.predecessorReceiptSha256 === null
    ? null
    : ownedDigest(record.predecessorReceiptSha256);
  const commandBudget = captureBudget(record.commandBudget);
  const semanticBytes = borrowedBytes(record.semanticBytes);
  if (
    record.commandKind !== "registration_page" ||
    sequence === undefined ||
    currentProgress === undefined ||
    (record.predecessorReceiptSha256 !== null && predecessor === undefined) ||
    commandBudget === undefined ||
    semanticBytes === undefined ||
    record.completedLinkResult === null ||
    typeof record.completedLinkResult !== "object"
  ) {
    return Result.fail(registrationError("create", "invalidInput", "input"));
  }
  const capturedPredecessor = predecessor as Uint8Array | null;
  const expectedSequence = currentProgress.settledSequence + 1n;
  if (
    expectedSequence > MAX_SIGNED_INT64 ||
    sequence !== expectedSequence ||
    currentProgress.phase !== "registration" ||
    currentProgress.moduleOrdinal !== 0n ||
    currentProgress.edgeOrdinal !== 0n ||
    currentProgress.pageOrdinal !== 0n
  ) {
    return Result.fail(
      registrationError("create", "invalidTransition", "currentProgress"),
    );
  }
  return Result.succeed(Object.freeze({
    bindings,
    completedLinkBindings,
    sequence,
    currentProgress,
    predecessorReceiptSha256: capturedPredecessor,
    commandBudget,
    semanticBudget: record.semanticBudget as DeclarativeV2SemanticStreamBudgetV1,
    semanticBytes,
    completedLinkResult:
      record.completedLinkResult as DeclarativeV2VerifierLinkResultV1,
  }));
}

function maxBudget(): DeclarativeV2VerifierBudgetFrameV2 {
  const values = zeroUsage();
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    values[dimension] = MAX_SIGNED_INT64;
  }
  return freezeUsage("attempt_usage", values);
}

function checkedAdd(
  left: bigint,
  right: bigint,
): bigint | undefined {
  const value = left + right;
  return value <= MAX_SIGNED_INT64 ? value : undefined;
}

function checkedUsageAdd(
  usage: MutableUsage,
  dimension: keyof MutableUsage,
  amount: bigint,
): boolean {
  const value = checkedAdd(usage[dimension], amount);
  if (value === undefined) return false;
  usage[dimension] = value;
  return true;
}

function physicalPlanBytes(plan: DeclarativeV2PhysicalFrameEncodingPlanV1): bigint {
  return BigInt(plan.frameByteLength);
}

function beginUtf8Capture(source: string): Utf8Capture {
  return {
    source,
    maximumByteLength: source.length * 3,
    storageAdmitted: false,
    phase: "allocate",
    destination: undefined,
    sourceIndex: 0,
    outputIndex: 0,
    scalarBytes: [],
    scalarIndex: 0,
  };
}

function scalarUtf8Bytes(source: string, index: number): readonly [number[], number] {
  const first = source.charCodeAt(index);
  let scalar = first;
  let width = 1;
  if (first >= 0xd800 && first <= 0xdbff && index + 1 < source.length) {
    const second = source.charCodeAt(index + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      scalar = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
      width = 2;
    } else {
      scalar = 0xfffd;
    }
  } else if (first >= 0xd800 && first <= 0xdfff) {
    scalar = 0xfffd;
  }
  if (scalar <= 0x7f) return [[scalar], width];
  if (scalar <= 0x7ff) {
    return [[0xc0 | (scalar >>> 6), 0x80 | (scalar & 0x3f)], width];
  }
  if (scalar <= 0xffff) {
    return [[
      0xe0 | (scalar >>> 12),
      0x80 | ((scalar >>> 6) & 0x3f),
      0x80 | (scalar & 0x3f),
    ], width];
  }
  return [[
    0xf0 | (scalar >>> 18),
    0x80 | ((scalar >>> 12) & 0x3f),
    0x80 | ((scalar >>> 6) & 0x3f),
    0x80 | (scalar & 0x3f),
  ], width];
}

function advanceUtf8Capture(capture: Utf8Capture, allowance: number): number {
  let used = 0;
  while (used < allowance && capture.phase !== "complete") {
    if (capture.phase === "allocate") {
      const maximum = capture.maximumByteLength;
      if (
        !capture.storageAdmitted ||
        !Number.isSafeInteger(maximum) ||
        maximum > Number(MAX_U32)
      ) {
        throw new RangeError("registration UTF-8 capture exceeds addressability");
      }
      capture.destination = new Uint8Array(maximum);
      capture.phase = capture.source.length === 0 ? "complete" : "read";
      used += 1;
      continue;
    }
    if (capture.phase === "read") {
      if (capture.sourceIndex >= capture.source.length) {
        capture.phase = "complete";
        continue;
      }
      const [bytes, width] = scalarUtf8Bytes(
        capture.source,
        capture.sourceIndex,
      );
      capture.sourceIndex += width;
      capture.scalarBytes = bytes;
      capture.scalarIndex = 0;
      capture.phase = "write";
      used += 1;
      continue;
    }
    capture.destination![capture.outputIndex] =
      capture.scalarBytes[capture.scalarIndex]!;
    capture.outputIndex += 1;
    capture.scalarIndex += 1;
    if (capture.scalarIndex >= capture.scalarBytes.length) {
      capture.phase = capture.sourceIndex >= capture.source.length
        ? "complete"
        : "read";
    }
    used += 1;
  }
  return used;
}

function finishUtf8Capture(capture: Utf8Capture): Uint8Array {
  if (capture.phase !== "complete" || capture.destination === undefined) {
    throw new Error("UTF-8 capture was not complete.");
  }
  return capture.destination.subarray(0, capture.outputIndex);
}

function handlerIdentityParts(
  pending: NonNullable<DriverState["pendingHandler"]>,
): ReadonlyArray<Uint8Array> {
  return Object.freeze([
    HANDLER_IDENTITY_DOMAIN,
    pending.producingParseResultSha256,
    pending.modulePathUtf8!,
    ZERO_BYTE,
    pending.exportNameUtf8!,
    ZERO_BYTE,
    pending.functionPathUtf8!,
    ZERO_BYTE,
    FUNCTION_KIND_BYTES[pending.fn.functionKind],
    ZERO_BYTE,
    VISIBILITY_BYTES[pending.fn.visibility],
  ]);
}

function totalByteLength(parts: ReadonlyArray<Uint8Array>): bigint {
  let total = 0n;
  for (const part of parts) total += BigInt(part.byteLength);
  return total;
}

function progressPlanBytes(
  plan: DeclarativeV2VerifierProgressFrameEncodingPlanV2,
): bigint {
  return BigInt(plan.canonicalByteLength);
}

function createProgressPlan(
  factory: DeclarativeV2VerifierProgressFrameEncoderFactoryV2,
  frame: unknown,
): ProgressPlan {
  const created = factory.create(frame, PROGRESS_FRAME_BUDGET);
  if (Result.isFailure(created)) {
    throw new Error("Accepted registration progress frame contradicted protocol.");
  }
  return {
    cursor: created.success.cursor,
    plan: created.success.plan,
  };
}

function deriveCapacity(
  state: DriverState,
): Result.Result<
  DeclarativeV2VerifierRegistrationCapacityV1,
  DeclarativeV2VerifierRegistrationV1Error
> {
  const input = state.input!;
  const capacity = zeroUsage();
  capacity.objectCalls = 0n;
  capacity.objectBodyBytes = 0n;
  capacity.sourceBytes = 0n;
  capacity.sourceMapBytes = 0n;
  capacity.semanticBytes = BigInt(state.semanticUsage.inputBytes);
  capacity.modules = state.semanticDetailed.modules;
  capacity.importEdges = 0n;
  capacity.exports = state.lookupUsage.exports;
  capacity.functions = state.semanticDetailed.functions;
  capacity.tokens = state.semanticDetailed.tokens;
  capacity.tokenBytes = BigInt(state.semanticUsage.inputBytes);
  capacity.parserStates = BigInt(state.semanticMechanical.transitions);
  capacity.nestingDepth = BigInt(state.semanticMechanical.depth);
  capacity.schemaNodes = state.semanticDetailed.jsonNodes;
  capacity.validatorNodes = state.semanticDetailed.validatorNodes;
  capacity.graphNodes =
    state.semanticDetailed.modules +
      state.semanticDetailed.functions +
      state.semanticDetailed.handlers;
  capacity.frontierEntries =
    state.semanticDetailed.frontierEntries +
    state.lookupUsage.frontierEntries;
  capacity.stringBytes =
    state.lookupInputStringBytes +
    BigInt(state.semanticMechanical.stringBytes) +
    state.semanticDetailed.comparisonStringBytes +
    state.lookupUsage.stringBytes;
  capacity.diagnosticBytes = 0n;
  capacity.elapsedMilliseconds = 0n;
  const physicalBytes = state.physicalCanonicalByteLength;
  const nextBytes = progressPlanBytes(state.nextProgressPlan!.plan);
  const manifestBytes = progressPlanBytes(state.outputManifestPlan!);
  const outputBytes = physicalBytes + nextBytes + manifestBytes;
  const frameBytes = [state.maximumPhysicalFrameByteLength, nextBytes, manifestBytes]
    .reduce((maximum, value) => value > maximum ? value : maximum, 0n);
  capacity.tableBytes = outputBytes > state.peakHandlerStorageBytes
    ? outputBytes
    : state.peakHandlerStorageBytes;
  capacity.canonicalBytes = BigInt(state.semanticUsage.canonicalBytes) +
    outputBytes;
  capacity.frameBytes = frameBytes;
  capacity.outputBytes = outputBytes;
  const registrationHash = planDeclarativeV2VerifierSha256WorkV1(physicalBytes);
  const progressHash = planDeclarativeV2VerifierSha256WorkV1(nextBytes);
  const manifestHash = planDeclarativeV2VerifierSha256WorkV1(manifestBytes);
  const currentProgressBytes = state.currentProgressCanonicalByteLength;
  if (
    Result.isFailure(registrationHash) ||
    Result.isFailure(progressHash) ||
    Result.isFailure(manifestHash)
  ) {
    return Result.fail(
      registrationError("step", "addressabilityExceeded", "hashPlan"),
    );
  }
  const hashBytes = currentProgressBytes +
    BigInt(state.semanticUsage.inputBytes) + state.handlerIdentityHashBytes +
    registrationHash.success.hashBytes +
    progressHash.success.hashBytes + manifestHash.success.hashBytes;
  capacity.hashBytes = hashBytes;
  const futureTransitions =
    1n + // seal terminal plans and capacity
    BigInt(state.physicalPlans.length) + // destination admission
    state.physicalEmitterTransitions +
    registrationHash.success.transitions +
    1n + // next-progress destination admission
    BigInt(state.nextProgressPlan!.plan.successfulWork.primitiveTransitions) +
    progressHash.success.transitions +
    1n + // manifest construction and destination admission
    BigInt(state.outputManifestPlan!.successfulWork.primitiveTransitions) +
    manifestHash.success.transitions +
    1n; // terminal proof and publication
  capacity.calls = state.coreTransitions + futureTransitions;
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (capacity[dimension] > input.commandBudget[dimension]) {
      return Result.fail(registrationError(
        "step",
        "budgetExceeded",
        dimension,
        dimension,
        capacity[dimension],
        input.commandBudget[dimension],
      ));
    }
  }
  if (
    capacity.tableBytes > MAX_U32 ||
    capacity.frameBytes > MAX_U32 ||
    capacity.outputBytes > MAX_U32
  ) {
    return Result.fail(
      registrationError("step", "addressabilityExceeded", "capacity"),
    );
  }
  return Result.succeed(Object.freeze({
    _tag: "DeclarativeV2VerifierRegistrationCapacityV1",
    ...capacity,
  }));
}

function accumulateRecord(state: DriverState, record: DeclarativeV2SemanticRecordV1): void {
  if (record.kind === "function") state.functions.set(record.path, record);
  if (record.kind === "handler") state.handlers.push(record);
}

function mergeSemanticReceipt(
  state: DriverState,
  result: {
    readonly records: ReadonlyArray<DeclarativeV2SemanticRecordV1>;
    readonly usage: DeclarativeV2SemanticStreamUsageV1;
    readonly detailed: {
      readonly aggregate: DeclarativeV2SemanticStreamDetailedUsageV1;
    };
    readonly mechanical: {
      readonly aggregate: DriverState["semanticMechanical"];
    };
  },
): void {
  for (const record of result.records) accumulateRecord(state, record);
  state.semanticUsage = result.usage;
  state.semanticDetailed = result.detailed.aggregate;
  state.semanticMechanical = result.mechanical.aggregate;
}

function beginHash(
  state: DriverState,
  parts: ReadonlyArray<Uint8Array>,
  onComplete: (digest: Uint8Array) => void,
): void {
  const created = createDeclarativeV2VerifierRuntimeSha256V1(state.hashArena);
  if (Result.isFailure(created)) {
    throw new Error("Accepted registration hash arena rejected a new hash.");
  }
  state.activeHash = {
    hash: created.success,
    parts,
    partIndex: 0,
    partOffset: 0,
    finishing: false,
    onComplete,
  };
}

function advanceHash(state: DriverState, allowance: number): number {
  const active = state.activeHash;
  if (active === undefined || allowance === 0) return 0;
  let used = 0;
  while (used < allowance) {
    const part = active.parts[active.partIndex];
    if (part !== undefined && active.partOffset < part.byteLength) {
      const stepped = stepDeclarativeV2VerifierRuntimeSha256V1(
        active.hash,
        part.subarray(active.partOffset),
        allowance - used,
      );
      if (Result.isFailure(stepped)) {
        throw new Error("Accepted registration hash input contradicted its plan.");
      }
      const transitions = Number(stepped.success.receipt.delta.transitions);
      const consumed = Number(stepped.success.receipt.delta.consumedBytes);
      active.partOffset += consumed;
      used += transitions;
      if (active.partOffset >= part.byteLength) {
        active.partIndex += 1;
        active.partOffset = 0;
      }
      if (transitions === 0) break;
      continue;
    }
    active.finishing = true;
    const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
      active.hash,
      allowance - used,
    );
    if (Result.isFailure(finished)) {
      throw new Error("Accepted registration hash terminal contradicted its plan.");
    }
    const transitions = Number(finished.success.receipt.delta.transitions);
    used += transitions;
    if (finished.success.status === "complete") {
      state.activeHash = undefined;
      active.onComplete(finished.success.digest);
      break;
    }
    if (transitions === 0) break;
  }
  return used;
}

function release(state: DriverState): void {
  if (state.linkLookup !== undefined && state.linkPort !== undefined) {
    state.linkPort.close(state.linkLookup);
  }
  if (state.linkClaim !== undefined && state.linkPort !== undefined) {
    state.linkPort.close(state.linkClaim);
  }
  if (state.physicalFactory !== undefined) {
    for (const plan of state.physicalPlans) {
      state.physicalFactory.close(plan.cursor);
    }
  }
  if (state.progressFactory !== undefined) {
    for (const cursor of [
      state.currentProgressPlan?.cursor,
      state.nextProgressPlan?.cursor,
      state.outputManifestPlanningCursor,
      state.outputManifestCursor,
    ]) {
      if (cursor !== undefined) state.progressFactory.close(cursor);
    }
  }
  if (state.hashArena !== undefined) {
    const revoked = revokeDeclarativeV2VerifierRuntimeArenaV1(state.hashArena);
    if (Result.isFailure(revoked) && revoked.failure.reason !== "closed") {
      throw new Error("Accepted registration hash arena could not be revoked.");
    }
  }
  state.input = undefined;
  state.linkPort = undefined;
  state.linkClaim = undefined;
  state.linkLookup = undefined;
  state.semanticDecoder = undefined;
  state.semanticBorrowed = undefined;
  state.scratch = undefined;
  state.semanticHash = undefined;
  state.functions.clear();
  state.handlers.splice(0);
  state.handlerWork.splice(0);
  state.pendingHandler = undefined;
  state.textCapture = undefined;
  state.retainedHandlerStorageBytes = 0n;
  state.hashArena = undefined;
  state.activeHash = undefined;
  state.physicalPlans.splice(0);
  state.registrationFrames.splice(0);
  state.physicalFactory = undefined;
  state.progressFactory = undefined;
  state.currentProgressPlan = undefined;
  state.currentProgressSha256 = undefined;
  state.nextProgress = undefined;
  state.nextProgressPlan = undefined;
  state.outputManifestPlanningCursor = undefined;
  state.outputManifestPlan = undefined;
  state.outputManifest = undefined;
  state.outputManifestCursor = undefined;
  state.outputManifestDestination = undefined;
  state.registrationRootSha256 = undefined;
  state.nextProgressSha256 = undefined;
  state.capacity = undefined;
}

function failTerminal<T>(
  state: DriverState,
  error: DeclarativeV2VerifierRegistrationV1Error,
): Result.Result<T, DeclarativeV2VerifierRegistrationV1Error> {
  state.terminal = "closed";
  release(state);
  return Result.fail(error);
}

function prepareTerminalPlans(state: DriverState): void {
  const input = state.input!;
  const nextProgress = Object.freeze({
    kind: "progress_cursor",
    phase: "verdict",
    settledSequence: input.sequence,
    moduleOrdinal: 0n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: input.predecessorReceiptSha256 === null
      ? null
      : new Uint8Array(input.predecessorReceiptSha256),
  }) satisfies DeclarativeV2VerifierProgressCursorFrameV2;
  state.nextProgress = nextProgress;
  state.nextProgressPlan = createProgressPlan(state.progressFactory!, nextProgress);
  const dummyManifest = Object.freeze({
    kind: "command_output_manifest",
    reservationSha256: input.bindings.registrationReservationSha256,
    commandKind: "registration_page",
    sequence: input.sequence,
    evidenceRootSha256: new Uint8Array(32),
    evidenceCount: BigInt(state.physicalPlans.length),
    diagnosticsRootSha256: new Uint8Array(EMPTY_SHA256),
    diagnosticCount: 0n,
    nextProgressSha256: new Uint8Array(32),
  }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
  const planned = createProgressPlan(state.progressFactory!, dummyManifest);
  state.outputManifestPlanningCursor = planned.cursor;
  state.outputManifestPlan = planned.plan;
}

function exactSameProgressPlan(
  left: DeclarativeV2VerifierProgressFrameEncodingPlanV2,
  right: DeclarativeV2VerifierProgressFrameEncodingPlanV2,
): boolean {
  return left.canonicalByteLength === right.canonicalByteLength &&
    Object.keys(left.successfulWork).every(key =>
      left.successfulWork[key as keyof typeof left.successfulWork] ===
        right.successfulWork[key as keyof typeof right.successfulWork]
    );
}

export function makeDeclarativeV2VerifierRegistrationFactoryV1(
  authenticatedLinkFactory: DeclarativeV2VerifierAuthenticatedLinkFactoryV1,
): DeclarativeV2VerifierRegistrationFactoryV1 {
  const linkPort = declarativeV2VerifierCompletedLinkClaimPortV1(
    authenticatedLinkFactory,
  );
  const owned = new WeakMap<object, DriverState>();
  const handle = (): DeclarativeV2VerifierRegistrationDriverV1 =>
    Object.freeze({
      _tag: "DeclarativeV2VerifierRegistrationDriverV1",
    });

  const create: DeclarativeV2VerifierRegistrationFactoryV1["create"] =
    (rawInput, rawExpectedBindings) => Result.gen(function* () {
      if (linkPort === undefined) {
        return yield* Result.fail(
          registrationError("create", "invalidInput", "linkFactory"),
        );
      }
      const input = yield* captureInput(rawInput, rawExpectedBindings);
      const semanticDecoder = yield*
        createDeclarativeV2SemanticStreamDecoderV1(input.semanticBudget).pipe(
          Result.mapError(() =>
            registrationError("create", "invalidInput", "semanticBudget")
          ),
        );
      const arena = yield* createDeclarativeV2VerifierRuntimeArenaV1({
        requiredBytes: 0,
        regions: Object.freeze([]),
        usage: maxBudget(),
      }).pipe(
        Result.mapError(() =>
          registrationError("create", "addressabilityExceeded", "hashArena")
        ),
      );
      const semanticHash = createDeclarativeV2VerifierRuntimeSha256V1(
        arena,
      );
      if (Result.isFailure(semanticHash)) {
        revokeDeclarativeV2VerifierRuntimeArenaV1(arena);
        throw new Error("Accepted registration hash arena rejected semantic hash.");
      }
      const progressFactory =
        makeDeclarativeV2VerifierProgressFrameEncoderFactoryV2();
      const currentProgressPlan = createProgressPlan(
        progressFactory,
        input.currentProgress,
      );
      const state: DriverState = {
        input,
        linkPort,
        linkClaim: undefined,
        linkLookup: undefined,
        semanticDecoder,
        semanticBorrowed: input.semanticBytes,
        semanticOffset: 0,
        scratch: new Uint8Array(SEMANTIC_CHUNK_BYTES),
        scratchLength: 0,
        scratchDecodeOffset: 0,
        scratchHashOffset: 0,
        semanticHash: semanticHash.success,
        semanticUsage: Object.freeze({
          inputBytes: 0,
          records: 0,
          canonicalBytes: 0,
        }),
        semanticDetailed: Object.freeze({
          tokens: 0n,
          jsonNodes: 0n,
          validatorNodes: 0n,
          modules: 0n,
          functions: 0n,
          handlers: 0n,
          frontierEntries: 0n,
          comparisonStringBytes: 0n,
        }),
        semanticMechanical: Object.freeze({
          inputBytes: 0,
          canonicalBytes: 0,
          stringBytes: 0,
          members: 0,
          depth: 0,
          transitions: 0,
        }),
        functions: new Map(),
        handlers: [],
        handlerWork: [],
        resolveIndex: 0,
        lookupUsage: Object.freeze({
          calls: 0n,
          exports: 0n,
          frontierEntries: 0n,
          stringBytes: 0n,
        }),
        lookupInputStringBytes: 0n,
        retainedHandlerStorageBytes: 0n,
        peakHandlerStorageBytes: 0n,
        pendingHandler: undefined,
        textCapture: undefined,
        hashArena: arena,
        activeHash: undefined,
        physicalPlans: [],
        registrationFrames: [],
        physicalCanonicalByteLength: 0n,
        maximumPhysicalFrameByteLength: 0n,
        physicalEmitterTransitions: 0n,
        handlerIdentityHashBytes: 0n,
        physicalIndex: 0,
        physicalFactory: makeDeclarativeV2PhysicalFrameEncoderFactoryV1(),
        progressFactory,
        currentProgressPlan,
        currentProgressCanonicalByteLength: progressPlanBytes(
          currentProgressPlan.plan,
        ),
        currentProgressSha256: undefined,
        currentProgressCompareIndex: 0,
        currentProgressMatches: true,
        nextProgress: undefined,
        nextProgressPlan: undefined,
        outputManifestPlanningCursor: undefined,
        outputManifestPlan: undefined,
        outputManifest: undefined,
        outputManifestCursor: undefined,
        outputManifestDestination: undefined,
        registrationRootSha256: undefined,
        nextProgressSha256: undefined,
        capacity: undefined,
        actual: zeroUsage(),
        phase: "emitCurrentProgress",
        coreTransitions: 0n,
        terminal: "open",
      };
      const driver = handle();
      owned.set(driver, state);
      return driver;
    });

  const stepInternal = (
    rawDriver: unknown,
    rawAllowance: unknown,
    operation: "step" | "finish",
  ): Result.Result<
    DeclarativeV2VerifierRegistrationStepV1,
    DeclarativeV2VerifierRegistrationV1Error
  > => {
    const state = rawDriver !== null && typeof rawDriver === "object"
      ? owned.get(rawDriver)
      : undefined;
    if (state === undefined) {
      return Result.fail(registrationError(operation, "staleHandle"));
    }
    if (state.terminal !== "open") {
      return Result.fail(registrationError(operation, "closed"));
    }
    if (
      typeof rawAllowance !== "number" ||
      !Number.isSafeInteger(rawAllowance) ||
      rawAllowance < 0 ||
      rawAllowance > TRANSITION_QUANTUM
    ) {
      return failTerminal(
        state,
        registrationError(operation, "invalidInput", "allowance"),
      );
    }
    const before = { ...state.actual };
    if (rawAllowance === 0) {
      return Result.succeed(Object.freeze({
        status: "pending",
        receipt: receipt(state, before, 0),
      }));
    }
    let transitions = 0;
    const consume = (count: number): void => {
      transitions += count;
      state.coreTransitions += BigInt(count);
    };
    while (transitions < rawAllowance && state.terminal === "open") {
      const remaining = rawAllowance - transitions;
      if (state.phase === "emitCurrentProgress") {
        const plan = state.currentProgressPlan!;
        if (plan.destination === undefined) {
          let destination: Uint8Array | undefined;
          const admitted = state.progressFactory!.admit(
            plan.cursor,
            observed => {
              destination = new Uint8Array(observed.canonicalByteLength);
              return Result.succeed(Object.freeze({
                bytes: destination,
                byteOffset: 0,
                byteLength: destination.byteLength,
              }));
            },
          );
          if (Result.isFailure(admitted) || destination === undefined) {
            return failTerminal(
              state,
              registrationError(
                operation,
                "addressabilityExceeded",
                "currentProgress",
              ),
            );
          }
          plan.destination = destination;
          consume(1);
          continue;
        }
        const emitted = state.progressFactory!.step(plan.cursor, remaining);
        if (Result.isFailure(emitted)) {
          throw new Error("Accepted current-progress emitter contradicted plan.");
        }
        const used = emitted.success.receipt.consumedAllowance;
        consume(used);
        if (emitted.success.status === "complete") {
          beginHash(state, [plan.destination], digest => {
            state.currentProgressSha256 = digest;
            state.phase = "verifyCurrentProgress";
          });
          state.phase = "hashCurrentProgress";
        }
        if (used === 0) break;
        continue;
      }
      if (state.phase === "hashCurrentProgress") {
        const used = advanceHash(state, remaining);
        consume(used);
        if (used === 0) break;
        continue;
      }
      if (state.phase === "verifyCurrentProgress") {
        if (state.currentProgressCompareIndex < 32) {
          const index = state.currentProgressCompareIndex;
          state.currentProgressMatches =
            state.currentProgressMatches &&
            state.currentProgressSha256![index] ===
              state.input!.bindings.currentProgressSha256[index];
          state.currentProgressCompareIndex += 1;
          consume(1);
          continue;
        }
        if (!state.currentProgressMatches) {
          return failTerminal(
            state,
            registrationError(
              operation,
              "identityMismatch",
              "currentProgressSha256",
            ),
          );
        }
        const claimed = state.linkPort!.claim(
          state.input!.completedLinkResult,
          state.input!.completedLinkBindings,
        );
        if (Result.isFailure(claimed)) {
          return failTerminal(
            state,
            registrationError(
              operation,
              "identityMismatch",
              "completedLinkResult",
            ),
          );
        }
        state.linkClaim = claimed.success;
        state.progressFactory!.close(state.currentProgressPlan!.cursor);
        state.currentProgressSha256 = undefined;
        state.currentProgressPlan = undefined;
        state.phase = "captureSemantic";
        consume(1);
        continue;
      }
      if (state.phase === "captureSemantic") {
        const source = state.semanticBorrowed!;
        const scratch = state.scratch!;
        if (
          state.semanticOffset >= source.byteLength ||
          state.scratchLength >= scratch.byteLength
        ) {
          state.phase = state.scratchLength === 0
            ? "finishSemantic"
            : "decodeSemantic";
          continue;
        }
        scratch[state.scratchLength++] = source[state.semanticOffset++]!;
        consume(1);
        continue;
      }
      if (state.phase === "decodeSemantic") {
        const chunk = state.scratch!.subarray(
          state.scratchDecodeOffset,
          state.scratchLength,
        );
        const decoded = state.semanticDecoder!.push(chunk, remaining);
        if (Result.isFailure(decoded)) {
          return failTerminal(
            state,
            registrationError(operation, "semanticFailure", decoded.failure.reason),
          );
        }
        mergeSemanticReceipt(state, decoded.success);
        state.scratchDecodeOffset += decoded.success.consumedInputBytes;
        const used = decoded.success.mechanical.delta.transitions;
        consume(used);
        if (state.scratchDecodeOffset >= state.scratchLength) {
          state.phase = "hashSemantic";
        }
        if (used === 0) break;
        continue;
      }
      if (state.phase === "hashSemantic") {
        const stepped = stepDeclarativeV2VerifierRuntimeSha256V1(
          state.semanticHash,
          state.scratch!.subarray(state.scratchHashOffset, state.scratchLength),
          remaining,
        );
        if (Result.isFailure(stepped)) {
          throw new Error("Accepted semantic bytes contradicted hash state.");
        }
        const used = Number(stepped.success.receipt.delta.transitions);
        state.scratchHashOffset += Number(
          stepped.success.receipt.delta.consumedBytes,
        );
        consume(used);
        if (state.scratchHashOffset >= state.scratchLength) {
          state.scratchLength = 0;
          state.scratchDecodeOffset = 0;
          state.scratchHashOffset = 0;
          state.phase = state.semanticOffset >= state.semanticBorrowed!.byteLength
            ? "finishSemantic"
            : "captureSemantic";
        }
        if (used === 0) break;
        continue;
      }
      if (state.phase === "finishSemantic") {
        const finished = state.semanticDecoder!.finish(remaining);
        if (Result.isFailure(finished)) {
          return failTerminal(
            state,
            registrationError(operation, "semanticFailure", finished.failure.reason),
          );
        }
        mergeSemanticReceipt(state, finished.success);
        const used = finished.success.mechanical.delta.transitions;
        consume(used);
        if (finished.success.status === "complete") {
          state.phase = "finishSemanticHash";
        }
        if (used === 0) break;
        continue;
      }
      if (state.phase === "finishSemanticHash") {
        const finished = finishDeclarativeV2VerifierRuntimeSha256V1(
          state.semanticHash,
          remaining,
        );
        if (Result.isFailure(finished)) {
          throw new Error("Accepted semantic hash terminal contradicted state.");
        }
        const used = Number(finished.success.receipt.delta.transitions);
        consume(used);
        if (finished.success.status === "complete") {
          if (
            !bytesEqualFullScan(
              finished.success.digest,
              state.input!.bindings.semanticSha256,
            )
          ) {
            return failTerminal(
              state,
              registrationError(
                operation,
                "identityMismatch",
                "semanticSha256",
              ),
            );
          }
          if (
            state.semanticDetailed.modules !==
              state.input!.completedLinkResult.moduleCount
          ) {
            return failTerminal(
              state,
              registrationError(operation, "moduleMismatch", "moduleCount"),
            );
          }
          state.semanticHash = undefined;
          state.semanticBorrowed = undefined;
          state.scratch = undefined;
          state.semanticDecoder = undefined;
          state.phase = "prepareHandler";
        }
        if (used === 0) break;
        continue;
      }
      if (state.phase === "prepareHandler") {
        if (state.resolveIndex >= state.handlers.length) {
          state.phase = "planPhysical";
          continue;
        }
        const handler = state.handlers[state.resolveIndex]!;
        const fn = state.functions.get(handler.functionPath);
        if (fn === undefined) {
          throw new Error("Accepted semantic completeness lost handler function.");
        }
        state.pendingHandler = {
          handler,
          fn,
          moduleOrdinal: 0n,
          producingParseResultSha256: new Uint8Array(32),
          modulePathUtf8: undefined,
          exportNameUtf8: undefined,
          functionPathUtf8: undefined,
          retainedStorageBytes: 0n,
        };
        state.phase = "beginLookup";
        consume(1);
        continue;
      }
      if (
        state.phase === "captureHandlerModule" ||
        state.phase === "captureHandlerExport" ||
        state.phase === "captureHandlerFunction"
      ) {
        const capture = state.textCapture!;
        if (capture.phase === "allocate" && !capture.storageAdmitted) {
          const maximum = capture.maximumByteLength;
          if (
            !Number.isSafeInteger(maximum) ||
            maximum < 0 ||
            BigInt(maximum) > MAX_U32
          ) {
            return failTerminal(
              state,
              registrationError(
                operation,
                "addressabilityExceeded",
                "handlerText",
              ),
            );
          }
          const admittedStorage = checkedAdd(
            state.retainedHandlerStorageBytes,
            BigInt(maximum),
          );
          if (admittedStorage === undefined) {
            return failTerminal(
              state,
              registrationError(
                operation,
                "addressabilityExceeded",
                "handlerStorage",
              ),
            );
          }
          if (admittedStorage > state.input!.commandBudget.tableBytes) {
            return failTerminal(
              state,
              registrationError(
                operation,
                "budgetExceeded",
                "tableBytes",
                "tableBytes",
                admittedStorage,
                state.input!.commandBudget.tableBytes,
              ),
            );
          }
          capture.storageAdmitted = true;
          state.retainedHandlerStorageBytes = admittedStorage;
          state.pendingHandler!.retainedStorageBytes += BigInt(maximum);
          if (admittedStorage > state.peakHandlerStorageBytes) {
            state.peakHandlerStorageBytes = admittedStorage;
          }
          consume(1);
          continue;
        }
        const used = advanceUtf8Capture(capture, remaining);
        consume(used);
        if (state.textCapture!.phase === "complete") {
          const bytes = finishUtf8Capture(state.textCapture!);
          state.lookupInputStringBytes += BigInt(bytes.byteLength);
          if (state.phase === "captureHandlerModule") {
            state.pendingHandler!.modulePathUtf8 = bytes;
            state.textCapture = beginUtf8Capture(
              state.pendingHandler!.handler.exportName,
            );
            state.phase = "captureHandlerExport";
          } else if (state.phase === "captureHandlerExport") {
            state.pendingHandler!.exportNameUtf8 = bytes;
            state.textCapture = beginUtf8Capture(
              state.pendingHandler!.handler.functionPath,
            );
            state.phase = "captureHandlerFunction";
          } else {
            state.pendingHandler!.functionPathUtf8 = bytes;
            state.textCapture = undefined;
            const parts = handlerIdentityParts(state.pendingHandler!);
            const byteLength = totalByteLength(parts);
            const hashPlan = planDeclarativeV2VerifierSha256WorkV1(byteLength);
            if (Result.isFailure(hashPlan)) {
              return failTerminal(
                state,
                registrationError(
                  operation,
                  "addressabilityExceeded",
                  "handlerIdentity",
                ),
              );
            }
            state.handlerIdentityHashBytes += byteLength;
            beginHash(state, parts, digest => {
              const current = state.pendingHandler!;
              state.handlerWork.push(Object.freeze({
                handler: current.handler,
                fn: current.fn,
                moduleOrdinal: current.moduleOrdinal,
                producingParseResultSha256:
                  current.producingParseResultSha256,
                identitySha256: digest,
                identityPreimageByteLength: byteLength,
              }));
              state.retainedHandlerStorageBytes -= current.retainedStorageBytes;
              state.pendingHandler = undefined;
              state.resolveIndex += 1;
              state.phase = "prepareHandler";
            });
            state.phase = "hashHandler";
          }
        }
        if (used === 0) break;
        continue;
      }
      if (state.phase === "beginLookup") {
        const pending = state.pendingHandler!;
        const begun = state.linkPort!.beginHandlerLookup(
          state.linkClaim,
          pending.handler.modulePath,
          pending.handler.exportName,
        );
        if (Result.isFailure(begun)) {
          return failTerminal(
            state,
            registrationError(operation, "moduleMismatch", "handler"),
          );
        }
        state.linkLookup = begun.success;
        state.phase = "stepLookup";
        consume(1);
        continue;
      }
      if (state.phase === "stepLookup") {
        const found = state.linkPort!.stepHandlerLookup(
          state.linkLookup,
          remaining,
        );
        if (Result.isFailure(found)) {
          return failTerminal(
            state,
            registrationError(operation, "moduleMismatch", "handler"),
          );
        }
        const used = found.success.transitionCount;
        consume(used);
        if (found.success.status === "complete") {
          state.lookupUsage = Object.freeze({
            calls: state.lookupUsage.calls + found.success.usage.calls,
            exports: state.lookupUsage.exports + found.success.usage.exports,
            frontierEntries:
              state.lookupUsage.frontierEntries +
              found.success.usage.frontierEntries,
            stringBytes:
              state.lookupUsage.stringBytes + found.success.usage.stringBytes,
          });
          state.linkLookup = undefined;
          if (
            !found.success.found ||
            found.success.moduleOrdinal === null ||
            found.success.producingParseResultSha256 === null ||
            found.success.capabilities === null ||
            found.success.contextBindingsValid === null
          ) {
            return failTerminal(
              state,
              registrationError(operation, "moduleMismatch", "handler"),
            );
          }
          const pending = state.pendingHandler!;
          if (
            !found.success.contextBindingsValid ||
            !handlerCapabilitiesAdmittedV1(
              pending.fn.functionKind,
              found.success.capabilities,
            )
          ) {
            return failTerminal(
              state,
              registrationError(
                operation,
                "moduleMismatch",
                "handlerCapability",
              ),
            );
          }
          pending.moduleOrdinal = found.success.moduleOrdinal;
          pending.producingParseResultSha256 =
            found.success.producingParseResultSha256;
          state.textCapture = beginUtf8Capture(pending.handler.modulePath);
          state.phase = "captureHandlerModule";
        }
        if (used === 0) break;
        continue;
      }
      if (state.phase === "hashHandler") {
        const used = advanceHash(state, remaining);
        consume(used);
        if (used === 0) break;
        continue;
      }
      if (state.phase === "planPhysical") {
        if (state.physicalIndex < state.handlerWork.length) {
          const work = state.handlerWork[state.physicalIndex]!;
          const frame = Object.freeze({
            kind: "registration",
            attemptSha256: state.input!.bindings.attemptSha256,
            registrationOrdinal: BigInt(state.physicalIndex),
            handlerIdentitySha256: work.identitySha256,
            moduleOrdinal: work.moduleOrdinal,
            exportName: work.handler.exportName,
            functionPath: work.handler.functionPath,
            handlerKind: work.fn.functionKind,
            visibility: work.fn.visibility,
          }) satisfies DeclarativeV2RegistrationFrameV1;
          const created = state.physicalFactory!.create(frame, FRAME_BUDGET);
          if (Result.isFailure(created)) {
            throw new Error("Accepted registration frame contradicted protocol.");
          }
          state.physicalPlans.push({
            frame,
            cursor: created.success.cursor,
            plan: created.success.plan,
          });
          const frameByteLength = physicalPlanBytes(created.success.plan);
          const nextPhysicalByteLength = checkedAdd(
            state.physicalCanonicalByteLength,
            frameByteLength,
          );
          const nextEmitterTransitions = checkedAdd(
            state.physicalEmitterTransitions,
            BigInt(created.success.plan.successfulWork.primitiveTransitions),
          );
          if (
            nextPhysicalByteLength === undefined ||
            nextEmitterTransitions === undefined
          ) {
            return failTerminal(
              state,
              registrationError(
                operation,
                "addressabilityExceeded",
                "physicalPlan",
              ),
            );
          }
          state.physicalCanonicalByteLength = nextPhysicalByteLength;
          state.physicalEmitterTransitions = nextEmitterTransitions;
          if (frameByteLength > state.maximumPhysicalFrameByteLength) {
            state.maximumPhysicalFrameByteLength = frameByteLength;
          }
          state.physicalIndex += 1;
          consume(1);
          continue;
        }
        state.physicalIndex = 0;
        state.phase = "planTerminal";
        continue;
      }
      if (state.phase === "planTerminal") {
        prepareTerminalPlans(state);
        const capacity = deriveCapacity(state);
        if (Result.isFailure(capacity)) {
          return failTerminal(state, capacity.failure);
        }
        state.capacity = capacity.success;
        state.phase = "admitPhysical";
        consume(1);
        continue;
      }
      if (state.phase === "admitPhysical") {
        const plan = state.physicalPlans[state.physicalIndex];
        if (plan === undefined) {
          state.physicalIndex = 0;
          state.phase = "emitPhysical";
          continue;
        }
        let destination: Uint8Array | undefined;
        const admitted = state.physicalFactory!.admit(plan.cursor, observed => {
          destination = new Uint8Array(observed.frameByteLength);
          return Result.succeed(Object.freeze({
            bytes: destination,
            byteOffset: 0,
            byteLength: destination.byteLength,
          }));
        });
        if (Result.isFailure(admitted) || destination === undefined) {
          return failTerminal(
            state,
            registrationError(operation, "addressabilityExceeded", "destination"),
          );
        }
        plan.destination = destination;
        state.registrationFrames.push(destination);
        state.physicalIndex += 1;
        consume(1);
        continue;
      }
      if (state.phase === "emitPhysical") {
        const plan = state.physicalPlans[state.physicalIndex];
        if (plan === undefined) {
          state.physicalIndex = 0;
          beginHash(
            state,
            state.registrationFrames,
            digest => {
              state.registrationRootSha256 = digest;
              state.phase = "emitNextProgress";
            },
          );
          state.phase = "hashRegistrationRoot";
          continue;
        }
        const emitted = state.physicalFactory!.step(plan.cursor, remaining);
        if (Result.isFailure(emitted)) {
          throw new Error("Accepted registration emitter contradicted its plan.");
        }
        const used = emitted.success.receipt.consumedAllowance;
        consume(used);
        if (emitted.success.status === "complete") state.physicalIndex += 1;
        if (used === 0) break;
        continue;
      }
      if (state.phase === "hashRegistrationRoot") {
        const used = advanceHash(state, remaining);
        consume(used);
        if (used === 0) break;
        continue;
      }
      if (state.phase === "emitNextProgress") {
        const plan = state.nextProgressPlan!;
        if (plan.destination === undefined) {
          let destination: Uint8Array | undefined;
          const admitted = state.progressFactory!.admit(
            plan.cursor,
            observed => {
              destination = new Uint8Array(observed.canonicalByteLength);
              return Result.succeed(Object.freeze({
                bytes: destination,
                byteOffset: 0,
                byteLength: destination.byteLength,
              }));
            },
          );
          if (Result.isFailure(admitted) || destination === undefined) {
            return failTerminal(
              state,
              registrationError(operation, "addressabilityExceeded", "nextProgress"),
            );
          }
          plan.destination = destination;
          consume(1);
          continue;
        }
        const emitted = state.progressFactory!.step(plan.cursor, remaining);
        if (Result.isFailure(emitted)) {
          throw new Error("Accepted next-progress emitter contradicted plan.");
        }
        const used = emitted.success.receipt.consumedAllowance;
        consume(used);
        if (emitted.success.status === "complete") {
          beginHash(state, [plan.destination], digest => {
            state.nextProgressSha256 = digest;
            state.phase = "emitManifest";
          });
          state.phase = "hashNextProgress";
        }
        if (used === 0) break;
        continue;
      }
      if (state.phase === "hashNextProgress") {
        const used = advanceHash(state, remaining);
        consume(used);
        if (used === 0) break;
        continue;
      }
      if (state.phase === "emitManifest") {
        if (state.outputManifestCursor === undefined) {
          const manifest = Object.freeze({
            kind: "command_output_manifest",
            reservationSha256:
              state.input!.bindings.registrationReservationSha256,
            commandKind: "registration_page",
            sequence: state.input!.sequence,
            evidenceRootSha256: state.registrationRootSha256!,
            evidenceCount: BigInt(state.physicalPlans.length),
            diagnosticsRootSha256: new Uint8Array(EMPTY_SHA256),
            diagnosticCount: 0n,
            nextProgressSha256: state.nextProgressSha256!,
          }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
          const created = state.progressFactory!.create(
            manifest,
            PROGRESS_FRAME_BUDGET,
          );
          if (
            Result.isFailure(created) ||
            !exactSameProgressPlan(
              created.success.plan,
              state.outputManifestPlan!,
            )
          ) {
            throw new Error("Accepted output manifest contradicted planning frame.");
          }
          state.outputManifest = manifest;
          state.outputManifestCursor = created.success.cursor;
          let destination: Uint8Array | undefined;
          const admitted = state.progressFactory!.admit(
            created.success.cursor,
            observed => {
              destination = new Uint8Array(observed.canonicalByteLength);
              return Result.succeed(Object.freeze({
                bytes: destination,
                byteOffset: 0,
                byteLength: destination.byteLength,
              }));
            },
          );
          if (Result.isFailure(admitted) || destination === undefined) {
            return failTerminal(
              state,
              registrationError(operation, "addressabilityExceeded", "manifest"),
            );
          }
          state.outputManifestDestination = destination;
          consume(1);
          continue;
        }
        const emitted = state.progressFactory!.step(
          state.outputManifestCursor,
          remaining,
        );
        if (Result.isFailure(emitted)) {
          throw new Error("Accepted output manifest emitter contradicted plan.");
        }
        const used = emitted.success.receipt.consumedAllowance;
        consume(used);
        if (emitted.success.status === "complete") {
          beginHash(state, [state.outputManifestDestination!], () => {
            state.phase = "publish";
          });
          state.phase = "hashManifest";
        }
        if (used === 0) break;
        continue;
      }
      if (state.phase === "hashManifest") {
        const used = advanceHash(state, remaining);
        consume(used);
        if (used === 0) break;
        continue;
      }
      consume(1);
      const capacity = state.capacity!;
      const actual = state.actual;
      actual.objectCalls = 0n;
      actual.objectBodyBytes = 0n;
      actual.sourceBytes = 0n;
      actual.sourceMapBytes = 0n;
      actual.semanticBytes = BigInt(state.semanticUsage.inputBytes);
      actual.modules = state.semanticDetailed.modules;
      actual.importEdges = 0n;
      actual.exports = state.lookupUsage.exports;
      actual.functions = state.semanticDetailed.functions;
      actual.tokens = state.semanticDetailed.tokens;
      actual.tokenBytes = BigInt(state.semanticUsage.inputBytes);
      actual.parserStates = BigInt(state.semanticMechanical.transitions);
      actual.nestingDepth = BigInt(state.semanticMechanical.depth);
      actual.schemaNodes = state.semanticDetailed.jsonNodes;
      actual.validatorNodes = state.semanticDetailed.validatorNodes;
      actual.graphNodes =
        state.semanticDetailed.modules +
          state.semanticDetailed.functions +
          state.semanticDetailed.handlers;
      actual.frontierEntries =
        state.semanticDetailed.frontierEntries +
        state.lookupUsage.frontierEntries;
      actual.stringBytes =
        state.lookupInputStringBytes +
        BigInt(state.semanticMechanical.stringBytes) +
        state.semanticDetailed.comparisonStringBytes +
        state.lookupUsage.stringBytes;
      actual.tableBytes = 0n;
      const nextBytes = progressPlanBytes(state.nextProgressPlan!.plan);
      const manifestBytes = progressPlanBytes(state.outputManifestPlan!);
      actual.canonicalBytes =
        BigInt(state.semanticUsage.canonicalBytes) +
        state.physicalCanonicalByteLength + nextBytes + manifestBytes;
      actual.frameBytes = [
        state.maximumPhysicalFrameByteLength,
        nextBytes,
        manifestBytes,
      ].reduce((maximum, value) => value > maximum ? value : maximum, 0n);
      actual.hashBytes =
        state.currentProgressCanonicalByteLength +
        BigInt(state.semanticUsage.inputBytes) +
        state.handlerIdentityHashBytes +
        state.physicalCanonicalByteLength +
        nextBytes +
        manifestBytes;
      actual.diagnosticBytes = 0n;
      actual.outputBytes =
        state.physicalCanonicalByteLength + nextBytes + manifestBytes;
      actual.elapsedMilliseconds = 0n;
      actual.calls = state.coreTransitions;
      for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
        if (
          actual[dimension] > capacity[dimension] ||
          capacity[dimension] > state.input!.commandBudget[dimension]
        ) {
          throw new Error(
            `Accepted registration terminal contradicted ${dimension}: ` +
              `actual=${actual[dimension]} capacity=${capacity[dimension]} ` +
              `budget=${state.input!.commandBudget[dimension]}.`,
          );
        }
        if (
          dimension !== "tableBytes" &&
          actual[dimension] !== capacity[dimension]
        ) {
          throw new Error(
            `Registration plan/actual mismatch at ${dimension}.`,
          );
        }
      }
      const frames = Object.freeze(state.registrationFrames);
      state.registrationFrames = [];
      const result = Object.freeze({
        status: "complete",
        capacity,
        actual: freezeUsage("attempt_usage", actual),
        registrationFrames: frames,
        nextProgress: state.nextProgress!,
        nextProgressBytes: state.nextProgressPlan!.destination!,
        outputManifest: state.outputManifest!,
        outputManifestBytes: state.outputManifestDestination!,
        registrationRootSha256: state.registrationRootSha256!,
        receipt: receipt(state, before, transitions),
      }) satisfies DeclarativeV2VerifierRegistrationCompleteV1;
      state.terminal = "complete";
      release(state);
      return Result.succeed(result);
    }
    return Result.succeed(Object.freeze({
      status: "pending",
      receipt: receipt(state, before, transitions),
    }));
  };

  const step: DeclarativeV2VerifierRegistrationFactoryV1["step"] =
    (driver, allowance) => stepInternal(driver, allowance, "step");
  const finish: DeclarativeV2VerifierRegistrationFactoryV1["finish"] =
    (driver, allowance) => stepInternal(driver, allowance, "finish");
  const close: DeclarativeV2VerifierRegistrationFactoryV1["close"] =
    rawDriver => {
      const state = rawDriver !== null && typeof rawDriver === "object"
        ? owned.get(rawDriver)
        : undefined;
      if (state === undefined) {
        return Result.fail(registrationError("close", "staleHandle"));
      }
      if (state.terminal !== "open") {
        return Result.fail(registrationError("close", "closed"));
      }
      state.terminal = "closed";
      release(state);
      return Result.succeed(undefined);
    };
  return Object.freeze({ create, step, finish, close });
}
