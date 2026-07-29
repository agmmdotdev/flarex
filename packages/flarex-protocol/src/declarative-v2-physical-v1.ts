import {
  bytesEqualFullScan,
  isUint8Array,
} from "@flarex/utils/bytes";
import { hasOnlyPairedSurrogates, utf8ByteLength } from "./canonical-utf8";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";

export const DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1 = 1 as const;
export const DECLARATIVE_V2_SHA256_BYTES_V1 = 32 as const;
export const DECLARATIVE_V2_MAX_SIGNED_INT64_V1 = 9_223_372_036_854_775_807n;

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DOMAIN_PREFIX = "flarex.declarative-v2/";
const DOMAIN_SUFFIX = "/v1\0";
const U32_MAX = 0xffff_ffff;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const UINT8_ARRAY_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    "byteLength",
  )?.get;
const UINT8_ARRAY_BYTE_OFFSET_GETTER =
  Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    "byteOffset",
  )?.get;
const UINT8_ARRAY_BUFFER_GETTER =
  Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    "buffer",
  )?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      "byteLength",
    )?.get;
const ACTIVE_PHYSICAL_FRAME_ADMISSION_INPUTS = new WeakSet<object>();

export type DeclarativeV2AttemptLifecycleV1 =
  | "open"
  | "parsing"
  | "parse_complete"
  | "linking"
  | "link_complete"
  | "registering"
  | "ready"
  | "rejected"
  | "abandoned";

export type DeclarativeV2VerifierPhaseV1 =
  | "source"
  | "parse"
  | "link"
  | "registration"
  | "verdict";

export type DeclarativeV2CommandKindV1 =
  | "source_page"
  | "parse_module"
  | "link_page"
  | "registration_page"
  | "finalize";

export type DeclarativeV2BudgetDimensionV1 =
  | "calls"
  | "sourceBytes"
  | "modules"
  | "importEdges"
  | "tokens"
  | "tokenBytes"
  | "nestingDepth"
  | "functions"
  | "schemaNodes"
  | "validatorNodes"
  | "graphNodes"
  | "frontierEntries"
  | "canonicalBytes"
  | "frameBytes"
  | "hashBytes"
  | "diagnosticBytes"
  | "outputBytes"
  | "elapsedMilliseconds";

export interface DeclarativeV2FrameBudgetV1 {
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
}

export interface DeclarativeV2FrameUsageV1 {
  readonly frameBytes: number;
  readonly canonicalBytes: number;
}

export interface DeclarativeV2CandidateFrameV1 {
  readonly kind: "candidate";
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly scopeId: string;
  readonly storageGeneration: "flarexdb_v1";
  readonly storageGenerationFence: bigint;
  readonly scopeEpoch: string;
  readonly sourceRootSha256: Uint8Array;
  readonly sourceSelectorSha256: Uint8Array;
  readonly sourceCodecIdentity: string;
  readonly semanticRootSha256: Uint8Array;
  readonly semanticSelectorSha256: Uint8Array;
  readonly semanticModelIdentity: string;
  readonly semanticCodecIdentity: string;
  readonly semanticPolicyIdentity: string;
  readonly packageSha256: Uint8Array;
  readonly artifactSha256: Uint8Array;
  readonly artifactRuntimeIdentity: string;
  readonly schemaArtifactSha256: Uint8Array;
  readonly schemaBindingSha256: Uint8Array;
  readonly validatorRootSha256: Uint8Array;
  readonly coreLanguageIdentity: string;
  readonly abiIdentity: string;
  readonly grammarIdentity: string;
  readonly unicodeIdentity: string;
  readonly parserTableIdentity: string;
  readonly analyzerIdentity: string;
  readonly verifierIdentity: string;
  readonly declaredHandlerSetSha256: Uint8Array;
  readonly deploymentAnalysisCodecIdentity: string;
  readonly deploymentAnalysisByteLength: bigint;
  readonly deploymentAnalysisSha256: Uint8Array;
  readonly deploymentCodegenAnalysisCodecIdentity: string;
  readonly deploymentCodegenAnalysisByteLength: bigint;
  readonly deploymentCodegenAnalysisSha256: Uint8Array;
  readonly readinessPolicyIdentity: string;
}

export interface DeclarativeV2ProjectionFrameV1 {
  readonly kind:
    | "deployment_analysis_projection"
    | "deployment_codegen_analysis_projection";
  readonly candidateSha256: Uint8Array;
  readonly codecIdentity: string;
  readonly canonicalBytes: Uint8Array;
}

export interface DeclarativeV2AttemptIdentityFrameV1 {
  readonly kind: "attempt_identity";
  readonly candidateSha256: Uint8Array;
  readonly verifierProgressProtocolIdentity: string;
  readonly ceilingsSha256: Uint8Array;
}

export type DeclarativeV2BudgetFrameV1 = Readonly<{
  readonly kind: "attempt_ceilings" | "attempt_usage" | "command_budget";
}> & Readonly<Record<DeclarativeV2BudgetDimensionV1, bigint>>;

export interface DeclarativeV2ProgressCursorFrameV1 {
  readonly kind: "progress_cursor";
  readonly phase: DeclarativeV2VerifierPhaseV1;
  readonly settledSequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly edgeOrdinal: bigint;
  readonly pageOrdinal: bigint;
  readonly previousReceiptSha256: Uint8Array | null;
}

export interface DeclarativeV2CommandReservationFrameV1 {
  readonly kind: "command_reservation";
  readonly commandKind: DeclarativeV2CommandKindV1;
  readonly sequence: bigint;
  readonly previousReceiptSha256: Uint8Array | null;
  readonly budgetSha256: Uint8Array;
  readonly inputSha256: Uint8Array;
}

export interface DeclarativeV2CommandReceiptFrameV1 {
  readonly kind: "command_receipt";
  readonly commandKind: DeclarativeV2CommandKindV1;
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  readonly usageSha256: Uint8Array;
  readonly outputSha256: Uint8Array;
  readonly progressCursorSha256: Uint8Array;
}

export interface DeclarativeV2ModuleSummaryFrameV1 {
  readonly kind: "module_summary";
  readonly attemptSha256: Uint8Array;
  readonly moduleOrdinal: bigint;
  readonly modulePath: string;
  readonly moduleSha256: Uint8Array;
  readonly sourceMapSha256: Uint8Array | null;
  readonly importCount: bigint;
  readonly declaredFunctionCount: bigint;
}

export interface DeclarativeV2ImportEdgeFrameV1 {
  readonly kind: "import_edge";
  readonly attemptSha256: Uint8Array;
  readonly moduleOrdinal: bigint;
  readonly edgeOrdinal: bigint;
  readonly specifier: string;
  readonly importKind: "default" | "named" | "namespace";
  readonly importedName: string | null;
  readonly localName: string;
  readonly targetModulePath: string;
}

export interface DeclarativeV2PageManifestFrameV1 {
  readonly kind: "phase_page_manifest";
  readonly attemptSha256: Uint8Array;
  readonly phase: DeclarativeV2VerifierPhaseV1;
  readonly pageOrdinal: bigint;
  readonly firstItemOrdinal: bigint;
  readonly itemCount: bigint;
  readonly previousPageSha256: Uint8Array | null;
  readonly pageRootSha256: Uint8Array;
}

export interface DeclarativeV2LinkNodeFrameV1 {
  readonly kind: "link_node";
  readonly attemptSha256: Uint8Array;
  readonly moduleOrdinal: bigint;
  readonly remainingIndegree: bigint;
  readonly nextEdgeOrdinal: bigint;
  readonly state: "pending" | "linked" | "rejected";
  readonly rowVersion: bigint;
  readonly previousRowSha256: Uint8Array | null;
}

export interface DeclarativeV2FrontierEntryFrameV1 {
  readonly kind: "frontier_entry";
  readonly attemptSha256: Uint8Array;
  readonly frontierSequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly state: "queued" | "consumed";
  readonly rowVersion: bigint;
  readonly previousRowSha256: Uint8Array | null;
}

export interface DeclarativeV2RegistrationFrameV1 {
  readonly kind: "registration";
  readonly attemptSha256: Uint8Array;
  readonly registrationOrdinal: bigint;
  readonly handlerIdentitySha256: Uint8Array;
  readonly moduleOrdinal: bigint;
  readonly exportName: string;
  readonly functionPath: string;
  readonly handlerKind: "query" | "mutation" | "workflowMutation" | "action";
  readonly visibility: "public" | "internal";
}

export interface DeclarativeV2DiagnosticFrameV1 {
  readonly kind: "diagnostic";
  readonly attemptSha256: Uint8Array;
  readonly diagnosticOrdinal: bigint;
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string | null;
  readonly message: string;
}

export interface DeclarativeV2VerdictFrameV1 {
  readonly kind: "verdict";
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly verdict: "ready" | "rejected";
  readonly diagnosticRootSha256: Uint8Array;
  readonly failureCode: string | null;
  readonly handlerSetSha256: Uint8Array | null;
  readonly registrationRootSha256: Uint8Array | null;
  readonly indexReadinessRootSha256: Uint8Array | null;
}

export interface DeclarativeV2ActivationRevisionFrameV1 {
  readonly kind: "activation_revision";
  readonly scopeId: string;
  readonly revision: bigint;
  readonly previousRevision: bigint | null;
  readonly action: "activate" | "rollback";
  readonly candidateSha256: Uint8Array;
  readonly verdictSha256: Uint8Array;
  readonly activationRequestSha256: Uint8Array;
}

export interface DeclarativeV2ActivationHeadFrameV1 {
  readonly kind: "activation_head";
  readonly scopeId: string;
  readonly revisionCounter: bigint;
  readonly currentRevision: bigint | null;
  readonly candidateSha256: Uint8Array | null;
  readonly verdictSha256: Uint8Array | null;
}

export type DeclarativeV2PhysicalFrameV1 =
  | DeclarativeV2CandidateFrameV1
  | DeclarativeV2ProjectionFrameV1
  | DeclarativeV2AttemptIdentityFrameV1
  | DeclarativeV2BudgetFrameV1
  | DeclarativeV2ProgressCursorFrameV1
  | DeclarativeV2CommandReservationFrameV1
  | DeclarativeV2CommandReceiptFrameV1
  | DeclarativeV2ModuleSummaryFrameV1
  | DeclarativeV2ImportEdgeFrameV1
  | DeclarativeV2PageManifestFrameV1
  | DeclarativeV2LinkNodeFrameV1
  | DeclarativeV2FrontierEntryFrameV1
  | DeclarativeV2RegistrationFrameV1
  | DeclarativeV2DiagnosticFrameV1
  | DeclarativeV2VerdictFrameV1
  | DeclarativeV2ActivationRevisionFrameV1
  | DeclarativeV2ActivationHeadFrameV1;

export class DeclarativeV2PhysicalFrameV1Error extends Data.TaggedError(
  "DeclarativeV2PhysicalFrameV1Error",
)<{
  readonly operation: "encode" | "decode";
  readonly reason:
    | "invalidBudget"
    | "invalidInput"
    | "frameBytesExceeded"
    | "canonicalBytesExceeded"
    | "malformed"
    | "nonCanonical";
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class DeclarativeV2PhysicalFrameV1InvariantDefect
  extends Data.TaggedError("DeclarativeV2PhysicalFrameV1InvariantDefect")<{
    readonly reason: "invalidPlatformIntrinsic" | "reencodeFailed";
  }> {}

export interface DeclarativeV2EncodedFrameV1 {
  readonly frame: DeclarativeV2PhysicalFrameV1;
  readonly canonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2FrameUsageV1;
}

export interface DeclarativeV2PhysicalFrameWorkV1 {
  readonly byteStorageAllocationBytes: number;
  readonly byteCopyBytes: number;
  readonly byteWriteBytes: number;
  readonly byteScanBytes: number;
  readonly primitiveTransitions: number;
}

export interface DeclarativeV2PhysicalFrameEncodingPlanV1 {
  readonly frameByteLength: number;
  readonly canonicalByteLength: number;
  readonly successfulWork: DeclarativeV2PhysicalFrameWorkV1;
}

export interface DeclarativeV2PhysicalFrameByteRangeV1 {
  readonly bytes: Uint8Array;
  /** Offset relative to the visible `bytes` view. */
  readonly byteOffset: number;
  readonly byteLength: number;
}

export interface DeclarativeV2PhysicalFrameWrittenV1 {
  readonly frame: DeclarativeV2PhysicalFrameV1;
  readonly range: DeclarativeV2PhysicalFrameByteRangeV1;
  readonly usage: DeclarativeV2FrameUsageV1;
  readonly work: DeclarativeV2PhysicalFrameWorkV1;
}

export type DeclarativeV2PhysicalFrameEncodeAdmissionV1<E> = (
  plan: DeclarativeV2PhysicalFrameEncodingPlanV1,
) => Result.Result<DeclarativeV2PhysicalFrameByteRangeV1, E>;

declare const DECLARATIVE_V2_PHYSICAL_FRAME_ENCODER_CURSOR_V1: unique symbol;

export interface DeclarativeV2PhysicalFrameEncoderCursorV1 {
  readonly _tag: "DeclarativeV2PhysicalFrameEncoderCursorV1";
  readonly [DECLARATIVE_V2_PHYSICAL_FRAME_ENCODER_CURSOR_V1]: true;
}

export interface DeclarativeV2PhysicalFrameEncoderReceiptV1 {
  readonly consumedAllowance: number;
  readonly deltaWork: DeclarativeV2PhysicalFrameWorkV1;
  readonly aggregateWork: DeclarativeV2PhysicalFrameWorkV1;
}

export type DeclarativeV2PhysicalFrameEncoderStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2PhysicalFrameEncoderReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly written: DeclarativeV2PhysicalFrameWrittenV1;
    readonly receipt: DeclarativeV2PhysicalFrameEncoderReceiptV1;
  }>;

export interface DeclarativeV2PhysicalFrameEncoderFactoryV1 {
  readonly create: (
    input: unknown,
    budget: unknown,
  ) => Result.Result<
    Readonly<{
      readonly cursor: DeclarativeV2PhysicalFrameEncoderCursorV1;
      readonly plan: DeclarativeV2PhysicalFrameEncodingPlanV1;
      readonly receipt: DeclarativeV2PhysicalFrameEncoderReceiptV1;
    }>,
    DeclarativeV2PhysicalFrameV1Error
  >;
  readonly admit: <E>(
    cursor: unknown,
    admission: DeclarativeV2PhysicalFrameEncodeAdmissionV1<E>,
  ) => Result.Result<
    DeclarativeV2PhysicalFrameEncoderReceiptV1,
    DeclarativeV2PhysicalFrameV1Error | E
  >;
  readonly step: (
    cursor: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2PhysicalFrameEncoderStepV1,
    DeclarativeV2PhysicalFrameV1Error
  >;
  readonly close: (
    cursor: unknown,
  ) => Result.Result<
    DeclarativeV2PhysicalFrameEncoderReceiptV1,
    DeclarativeV2PhysicalFrameV1Error
  >;
}

type ScalarKind =
  | Readonly<{ readonly type: "string" }>
  | Readonly<{ readonly type: "nullableString" }>
  | Readonly<{ readonly type: "u64"; readonly positive?: true }>
  | Readonly<{ readonly type: "nullableU64" }>
  | Readonly<{ readonly type: "digest" }>
  | Readonly<{ readonly type: "nullableDigest" }>
  | Readonly<{ readonly type: "bytes"; readonly canonical?: true }>
  | Readonly<{
      readonly type: "enum";
      readonly values: ReadonlySet<string>;
    }>;

type FieldSchema = readonly [name: string, kind: ScalarKind];

const stringField = (name: string): FieldSchema => [name, { type: "string" }];
const nullableStringField = (name: string): FieldSchema => [
  name,
  { type: "nullableString" },
];
const u64Field = (name: string, positive = false): FieldSchema => [
  name,
  positive ? { type: "u64", positive: true } : { type: "u64" },
];
const nullableU64Field = (name: string): FieldSchema => [
  name,
  { type: "nullableU64" },
];
const digestField = (name: string): FieldSchema => [name, { type: "digest" }];
const nullableDigestField = (name: string): FieldSchema => [
  name,
  { type: "nullableDigest" },
];
const bytesField = (name: string, canonical = false): FieldSchema => [
  name,
  canonical ? { type: "bytes", canonical: true } : { type: "bytes" },
];
const enumField = (
  name: string,
  values: readonly string[],
): FieldSchema => [name, { type: "enum", values: new Set(values) }];

const BUDGET_FIELDS: readonly FieldSchema[] = [
  u64Field("calls"),
  u64Field("sourceBytes"),
  u64Field("modules"),
  u64Field("importEdges"),
  u64Field("tokens"),
  u64Field("tokenBytes"),
  u64Field("nestingDepth"),
  u64Field("functions"),
  u64Field("schemaNodes"),
  u64Field("validatorNodes"),
  u64Field("graphNodes"),
  u64Field("frontierEntries"),
  u64Field("canonicalBytes"),
  u64Field("frameBytes"),
  u64Field("hashBytes"),
  u64Field("diagnosticBytes"),
  u64Field("outputBytes"),
  u64Field("elapsedMilliseconds"),
];

const FRAME_SCHEMAS = {
  candidate: [
    stringField("projectId"),
    stringField("deploymentId"),
    stringField("deploymentCreatedAt"),
    stringField("scopeId"),
    enumField("storageGeneration", ["flarexdb_v1"]),
    u64Field("storageGenerationFence", true),
    stringField("scopeEpoch"),
    digestField("sourceRootSha256"),
    digestField("sourceSelectorSha256"),
    stringField("sourceCodecIdentity"),
    digestField("semanticRootSha256"),
    digestField("semanticSelectorSha256"),
    stringField("semanticModelIdentity"),
    stringField("semanticCodecIdentity"),
    stringField("semanticPolicyIdentity"),
    digestField("packageSha256"),
    digestField("artifactSha256"),
    stringField("artifactRuntimeIdentity"),
    digestField("schemaArtifactSha256"),
    digestField("schemaBindingSha256"),
    digestField("validatorRootSha256"),
    stringField("coreLanguageIdentity"),
    stringField("abiIdentity"),
    stringField("grammarIdentity"),
    stringField("unicodeIdentity"),
    stringField("parserTableIdentity"),
    stringField("analyzerIdentity"),
    stringField("verifierIdentity"),
    digestField("declaredHandlerSetSha256"),
    stringField("deploymentAnalysisCodecIdentity"),
    u64Field("deploymentAnalysisByteLength"),
    digestField("deploymentAnalysisSha256"),
    stringField("deploymentCodegenAnalysisCodecIdentity"),
    u64Field("deploymentCodegenAnalysisByteLength"),
    digestField("deploymentCodegenAnalysisSha256"),
    stringField("readinessPolicyIdentity"),
  ],
  deployment_analysis_projection: [
    digestField("candidateSha256"),
    stringField("codecIdentity"),
    bytesField("canonicalBytes", true),
  ],
  deployment_codegen_analysis_projection: [
    digestField("candidateSha256"),
    stringField("codecIdentity"),
    bytesField("canonicalBytes", true),
  ],
  attempt_identity: [
    digestField("candidateSha256"),
    stringField("verifierProgressProtocolIdentity"),
    digestField("ceilingsSha256"),
  ],
  attempt_ceilings: BUDGET_FIELDS,
  attempt_usage: BUDGET_FIELDS,
  command_budget: BUDGET_FIELDS,
  progress_cursor: [
    enumField("phase", ["source", "parse", "link", "registration", "verdict"]),
    u64Field("settledSequence"),
    u64Field("moduleOrdinal"),
    u64Field("edgeOrdinal"),
    u64Field("pageOrdinal"),
    nullableDigestField("previousReceiptSha256"),
  ],
  command_reservation: [
    enumField("commandKind", [
      "source_page",
      "parse_module",
      "link_page",
      "registration_page",
      "finalize",
    ]),
    u64Field("sequence", true),
    nullableDigestField("previousReceiptSha256"),
    digestField("budgetSha256"),
    digestField("inputSha256"),
  ],
  command_receipt: [
    enumField("commandKind", [
      "source_page",
      "parse_module",
      "link_page",
      "registration_page",
      "finalize",
    ]),
    u64Field("sequence", true),
    digestField("reservationSha256"),
    digestField("usageSha256"),
    digestField("outputSha256"),
    digestField("progressCursorSha256"),
  ],
  module_summary: [
    digestField("attemptSha256"),
    u64Field("moduleOrdinal"),
    stringField("modulePath"),
    digestField("moduleSha256"),
    nullableDigestField("sourceMapSha256"),
    u64Field("importCount"),
    u64Field("declaredFunctionCount"),
  ],
  import_edge: [
    digestField("attemptSha256"),
    u64Field("moduleOrdinal"),
    u64Field("edgeOrdinal"),
    stringField("specifier"),
    enumField("importKind", ["default", "named", "namespace"]),
    nullableStringField("importedName"),
    stringField("localName"),
    stringField("targetModulePath"),
  ],
  phase_page_manifest: [
    digestField("attemptSha256"),
    enumField("phase", ["source", "parse", "link", "registration", "verdict"]),
    u64Field("pageOrdinal"),
    u64Field("firstItemOrdinal"),
    u64Field("itemCount", true),
    nullableDigestField("previousPageSha256"),
    digestField("pageRootSha256"),
  ],
  link_node: [
    digestField("attemptSha256"),
    u64Field("moduleOrdinal"),
    u64Field("remainingIndegree"),
    u64Field("nextEdgeOrdinal"),
    enumField("state", ["pending", "linked", "rejected"]),
    u64Field("rowVersion"),
    nullableDigestField("previousRowSha256"),
  ],
  frontier_entry: [
    digestField("attemptSha256"),
    u64Field("frontierSequence"),
    u64Field("moduleOrdinal"),
    enumField("state", ["queued", "consumed"]),
    u64Field("rowVersion"),
    nullableDigestField("previousRowSha256"),
  ],
  registration: [
    digestField("attemptSha256"),
    u64Field("registrationOrdinal"),
    digestField("handlerIdentitySha256"),
    u64Field("moduleOrdinal"),
    stringField("exportName"),
    stringField("functionPath"),
    enumField("handlerKind", [
      "query",
      "mutation",
      "workflowMutation",
      "action",
    ]),
    enumField("visibility", ["public", "internal"]),
  ],
  diagnostic: [
    digestField("attemptSha256"),
    u64Field("diagnosticOrdinal"),
    enumField("severity", ["error", "warning"]),
    stringField("code"),
    nullableStringField("path"),
    stringField("message"),
  ],
  verdict: [
    digestField("attemptSha256"),
    digestField("candidateSha256"),
    enumField("verdict", ["ready", "rejected"]),
    digestField("diagnosticRootSha256"),
    nullableStringField("failureCode"),
    nullableDigestField("handlerSetSha256"),
    nullableDigestField("registrationRootSha256"),
    nullableDigestField("indexReadinessRootSha256"),
  ],
  activation_revision: [
    stringField("scopeId"),
    u64Field("revision", true),
    nullableU64Field("previousRevision"),
    enumField("action", ["activate", "rollback"]),
    digestField("candidateSha256"),
    digestField("verdictSha256"),
    digestField("activationRequestSha256"),
  ],
  activation_head: [
    stringField("scopeId"),
    u64Field("revisionCounter"),
    nullableU64Field("currentRevision"),
    nullableDigestField("candidateSha256"),
    nullableDigestField("verdictSha256"),
  ],
} as const satisfies Readonly<Record<string, readonly FieldSchema[]>>;

type FrameKind = keyof typeof FRAME_SCHEMAS;
type CapturedScalar = string | bigint | Uint8Array | null;
type CapturedFrame = Readonly<Record<string, CapturedScalar>> & {
  readonly kind: FrameKind;
};

type PhysicalFrameEncodingSegment =
  | Readonly<{
    readonly kind: "bytes";
    readonly bytes: Uint8Array;
    readonly byteLength: number;
  }>
  | Readonly<{
    readonly kind: "string";
    readonly value: string;
    readonly byteLength: number;
  }>
  | Readonly<{
    readonly kind: "byte";
    readonly value: number;
  }>
  | Readonly<{
    readonly kind: "u32";
    readonly value: number;
  }>
  | Readonly<{
    readonly kind: "u64";
    readonly value: bigint;
  }>;

type MutablePhysicalFrameWork = {
  byteStorageAllocationBytes: number;
  byteCopyBytes: number;
  byteWriteBytes: number;
  byteScanBytes: number;
  primitiveTransitions: number;
};

interface CapturedPhysicalFrameEncodingInput {
  readonly frame: CapturedFrame;
  readonly borrowedFrame: CapturedFrame;
  readonly usage: DeclarativeV2FrameUsageV1;
  readonly capturedByteStorageLength: number;
  readonly stringByteLengths: Readonly<Record<string, number>>;
}

interface PhysicalFrameEncoderCursorState {
  readonly frame: CapturedFrame;
  readonly plan: DeclarativeV2PhysicalFrameEncodingPlanV1;
  readonly usage: DeclarativeV2FrameUsageV1;
  readonly segments: readonly PhysicalFrameEncodingSegment[];
  readonly aggregateWork: MutablePhysicalFrameWork;
  inputIdentity: object | null;
  borrowedFrame: CapturedFrame | null;
  range: DeclarativeV2PhysicalFrameByteRangeV1 | undefined;
  phase: "created" | "admitting" | "admitted";
  segmentIndex: number;
  segmentOffset: number;
  outputOffset: number;
  stringCodePoint: number;
  stringCodeUnitWidth: number;
  stringByteIndex: number;
  stringByteLength: number;
}

const PHYSICAL_DOMAIN_BYTES = Object.freeze(
  Object.fromEntries(
    (Object.keys(FRAME_SCHEMAS) as readonly FrameKind[]).map(kind => [
      kind,
      UTF8_ENCODER.encode(`${DOMAIN_PREFIX}${kind}${DOMAIN_SUFFIX}`),
    ]),
  ),
) as Readonly<Record<FrameKind, Uint8Array>>;

const ACTIVE_PHYSICAL_FRAME_DESTINATIONS =
  new Set<DeclarativeV2PhysicalFrameByteRangeV1>();

export function encodeDeclarativeV2PhysicalFrameV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2EncodedFrameV1,
  DeclarativeV2PhysicalFrameV1Error
> {
  const factory = makeDeclarativeV2PhysicalFrameEncoderFactoryV1();
  return Result.gen(function* () {
    const created = yield* factory.create(input, budget);
    let destination: Uint8Array | undefined;
    yield* factory.admit(created.cursor, plan => {
      destination = new Uint8Array(plan.frameByteLength);
      return Result.succeed(Object.freeze({
        bytes: destination,
        byteOffset: 0,
        byteLength: plan.frameByteLength,
      }));
    });
    while (true) {
      const stepped = yield* factory.step(created.cursor, 1024);
      if (stepped.status === "complete") {
        if (destination === undefined) {
          throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
            reason: "reencodeFailed",
          });
        }
        return Object.freeze({
          frame: stepped.written.frame,
          canonicalBytes: destination,
          usage: stepped.written.usage,
        });
      }
    }
  });
}

/**
 * Creates factory-local resumable physical-frame encode-into cursors. Input
 * byte fields are captured into owned storage once before destination
 * admission; the original byte ranges are retained only long enough to reject
 * overlapping destinations. Cursor identity is process-local WeakMap state.
 */
export function makeDeclarativeV2PhysicalFrameEncoderFactoryV1():
  DeclarativeV2PhysicalFrameEncoderFactoryV1 {
  const cursors = new WeakMap<object, PhysicalFrameEncoderCursorState>();

  const create:
    DeclarativeV2PhysicalFrameEncoderFactoryV1["create"] =
      (input, rawBudget) => Result.gen(function* () {
        const limits = yield* decodeBudget(rawBudget, "encode");
        if (
          typeof input === "object" &&
          input !== null &&
          ACTIVE_PHYSICAL_FRAME_ADMISSION_INPUTS.has(input)
        ) {
          return yield* Result.fail(
            frameError("encode", "invalidInput", "admission.reentrantInput"),
          );
        }
        const captured = yield* captureFrameEncodingInput(
          input,
          limits,
          "encode",
        );
        const segments = physicalFrameEncodingSegments(
          captured.frame,
          captured.stringByteLengths,
        );
        assertExactPhysicalFrameEncodingSegments(
          captured.usage.frameBytes,
          physicalFrameByteCopyLength(captured.frame),
          segments,
        );
        const captureWork = Object.freeze({
          byteStorageAllocationBytes: captured.capturedByteStorageLength,
          byteCopyBytes: captured.capturedByteStorageLength,
          byteWriteBytes: 0,
          byteScanBytes: 0,
          primitiveTransitions: 0,
        });
        const plan = Object.freeze({
          frameByteLength: captured.usage.frameBytes,
          canonicalByteLength: captured.usage.canonicalBytes,
          successfulWork: physicalFrameEncodingWork(
            captured.frame,
            captured.usage.frameBytes,
            captured.capturedByteStorageLength,
          ),
        });
        const cursor = Object.freeze({
          _tag: "DeclarativeV2PhysicalFrameEncoderCursorV1",
        }) as DeclarativeV2PhysicalFrameEncoderCursorV1;
        const aggregateWork = mutableZeroPhysicalFrameWork();
        addPhysicalFrameWork(aggregateWork, captureWork);
        cursors.set(cursor, {
          frame: captured.frame,
          plan,
          usage: captured.usage,
          segments,
          aggregateWork,
          inputIdentity: typeof input === "object" && input !== null
            ? input
            : null,
          borrowedFrame: captured.borrowedFrame,
          range: undefined,
          phase: "created",
          segmentIndex: 0,
          segmentOffset: 0,
          outputOffset: 0,
          stringCodePoint: 0,
          stringCodeUnitWidth: 0,
          stringByteIndex: 0,
          stringByteLength: 0,
        });
        return Object.freeze({
          cursor,
          plan,
          receipt: physicalFrameEncoderReceipt(
            captureWork,
            aggregateWork,
            0,
          ),
        });
      });

  const admit:
    DeclarativeV2PhysicalFrameEncoderFactoryV1["admit"] =
      (rawCursor, admission) => Result.gen(function* () {
        const state = yield* physicalFrameEncoderCursorState(
          cursors,
          rawCursor,
          "admit",
        );
        if (state.phase !== "created" || typeof admission !== "function") {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            frameError("encode", "invalidInput", "cursor.reused"),
          );
        }
        const identity = state.inputIdentity;
        if (
          identity !== null &&
          ACTIVE_PHYSICAL_FRAME_ADMISSION_INPUTS.has(identity)
        ) {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            frameError("encode", "invalidInput", "admission.reentrantInput"),
          );
        }
        state.phase = "admitting";
        if (identity !== null) {
          ACTIVE_PHYSICAL_FRAME_ADMISSION_INPUTS.add(identity);
        }
        let admitted: ReturnType<typeof admission>;
        try {
          admitted = admission(state.plan);
        } catch (defect) {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          throw defect;
        } finally {
          if (identity !== null) {
            ACTIVE_PHYSICAL_FRAME_ADMISSION_INPUTS.delete(identity);
          }
        }
        if (
          cursors.get(rawCursor as object) !== state ||
          state.phase !== "admitting"
        ) {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            frameError("encode", "invalidInput", "cursor.reentrant"),
          );
        }
        const admittedRange = yield* Result.mapError(
          admitted,
          failure => {
            revokePhysicalFrameEncoderCursor(cursors, rawCursor);
            return failure;
          },
        );
        const range = yield* Result.mapError(
          capturePhysicalFrameByteRange(admittedRange),
          failure => {
            revokePhysicalFrameEncoderCursor(cursors, rawCursor);
            return failure;
          },
        );
        if (range.byteLength !== state.plan.frameByteLength) {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            frameError("encode", "invalidInput", "destination.byteLength"),
          );
        }
        if (
          state.borrowedFrame === null ||
          overlapsPhysicalFrameStorage(state.borrowedFrame, range) ||
          overlapsActivePhysicalFrameDestination(range)
        ) {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            frameError("encode", "invalidInput", "destination.overlap"),
          );
        }
        state.inputIdentity = null;
        state.borrowedFrame = null;
        state.range = range;
        state.phase = "admitted";
        ACTIVE_PHYSICAL_FRAME_DESTINATIONS.add(range);
        const delta = Object.freeze({
          byteStorageAllocationBytes: range.byteLength,
          byteCopyBytes: 0,
          byteWriteBytes: 0,
          byteScanBytes: 0,
          primitiveTransitions: 0,
        });
        addPhysicalFrameWork(state.aggregateWork, delta);
        return physicalFrameEncoderReceipt(
          delta,
          state.aggregateWork,
          0,
        );
      });

  const step:
    DeclarativeV2PhysicalFrameEncoderFactoryV1["step"] =
      (rawCursor, rawAllowance) => Result.gen(function* () {
        const state = yield* physicalFrameEncoderCursorState(
          cursors,
          rawCursor,
          "step",
        );
        if (state.phase !== "admitted") {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            frameError("encode", "invalidInput", "cursor.notAdmitted"),
          );
        }
        if (
          !isNonNegativeSafeInteger(rawAllowance) ||
          rawAllowance > 1024
        ) {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            frameError("encode", "invalidBudget", "cursor.allowance"),
          );
        }
        if (rawAllowance === 0) {
          return Object.freeze({
            status: "pending",
            receipt: physicalFrameEncoderReceipt(
              zeroPhysicalFrameWork(),
              state.aggregateWork,
              0,
            ),
          });
        }
        const range = state.range;
        if (
          range === undefined ||
          !ACTIVE_PHYSICAL_FRAME_DESTINATIONS.has(range) ||
          !isCurrentPhysicalFrameDestination(range)
        ) {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            frameError("encode", "invalidInput", "cursor.destination"),
          );
        }
        const before = snapshotPhysicalFrameWork(state.aggregateWork);
        let consumedAllowance = 0;
        let copied = 0;
        while (
          consumedAllowance < rawAllowance &&
          state.outputOffset < state.plan.frameByteLength
        ) {
          const segment = state.segments[state.segmentIndex];
          if (segment === undefined) {
            revokePhysicalFrameEncoderCursor(cursors, rawCursor);
            throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
              reason: "reencodeFailed",
            });
          }
          const next = consumePhysicalFrameEncodingByte(state, segment);
          if (next === undefined) {
            revokePhysicalFrameEncoderCursor(cursors, rawCursor);
            throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
              reason: "reencodeFailed",
            });
          }
          range.bytes[range.byteOffset + state.outputOffset] = next;
          if (segment.kind === "bytes") copied += 1;
          state.outputOffset += 1;
          consumedAllowance += 1;
          if (isPhysicalFrameEncodingSegmentComplete(state, segment)) {
            state.segmentIndex += 1;
            resetPhysicalFrameSegmentState(state);
          }
        }
        const delta = Object.freeze({
          byteStorageAllocationBytes: 0,
          byteCopyBytes: copied,
          byteWriteBytes: consumedAllowance,
          byteScanBytes: 0,
          primitiveTransitions: consumedAllowance,
        });
        addPhysicalFrameWork(state.aggregateWork, delta);
        const receipt = physicalFrameEncoderReceipt(
          subtractPhysicalFrameWork(
            snapshotPhysicalFrameWork(state.aggregateWork),
            before,
          ),
          state.aggregateWork,
          consumedAllowance,
        );
        if (state.outputOffset < state.plan.frameByteLength) {
          return Object.freeze({
            status: "pending",
            receipt,
          });
        }
        if (
          state.segmentIndex !== state.segments.length ||
          state.segmentOffset !== 0 ||
          state.stringByteLength !== 0
        ) {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
            reason: "reencodeFailed",
          });
        }
        const aggregate = snapshotPhysicalFrameWork(state.aggregateWork);
        try {
          assertExactPhysicalFrameSuccessfulWork(
            state.plan.successfulWork,
            aggregate,
          );
        } catch (defect) {
          revokePhysicalFrameEncoderCursor(cursors, rawCursor);
          throw defect;
        }
        const written = Object.freeze({
          frame: state.frame as DeclarativeV2PhysicalFrameV1,
          range,
          usage: state.usage,
          work: aggregate,
        });
        revokePhysicalFrameEncoderCursor(cursors, rawCursor);
        return Object.freeze({
          status: "complete",
          written,
          receipt,
        });
      });

  const close:
    DeclarativeV2PhysicalFrameEncoderFactoryV1["close"] =
      rawCursor =>
        Result.map(
          physicalFrameEncoderCursorState(cursors, rawCursor, "close"),
          state => {
            const aggregate = snapshotPhysicalFrameWork(state.aggregateWork);
            revokePhysicalFrameEncoderCursor(cursors, rawCursor);
            return physicalFrameEncoderReceipt(
              zeroPhysicalFrameWork(),
              aggregate,
              0,
            );
          },
        );

  return Object.freeze({ create, admit, step, close });
}

export function decodeDeclarativeV2PhysicalFrameV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2EncodedFrameV1,
  DeclarativeV2PhysicalFrameV1Error
> {
  return Result.gen(function* () {
    const limits = yield* decodeBudget(budget, "decode");
    if (!isUint8Array(input)) {
      return yield* Result.fail(frameError("decode", "invalidInput"));
    }
    const inputLength = intrinsicUint8ArrayByteLength(input);
    if (inputLength === undefined || inputLength === 0) {
      return yield* Result.fail(frameError("decode", "invalidInput"));
    }
    if (inputLength > limits.maximumFrameBytes) {
      return yield* Result.fail(new DeclarativeV2PhysicalFrameV1Error({
        operation: "decode",
        reason: "frameBytesExceeded",
        observed: inputLength,
        maximum: limits.maximumFrameBytes,
      }));
    }
    let owned: Uint8Array;
    try {
      owned = new Uint8Array(input);
    } catch {
      return yield* Result.fail(frameError("decode", "invalidInput"));
    }
    const parsed = yield* parseOwnedFrame(owned, limits);
    const reencoded = encodeDeclarativeV2PhysicalFrameV1(parsed, limits);
    if (Result.isFailure(reencoded)) {
      throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
        reason: "reencodeFailed",
      });
    }
    if (!bytesEqualFullScan(owned, reencoded.success.canonicalBytes)) {
      return yield* Result.fail(frameError("decode", "nonCanonical"));
    }
    return Object.freeze({
      frame: parsed as DeclarativeV2PhysicalFrameV1,
      canonicalBytes: owned,
      usage: Object.freeze({
        frameBytes: owned.byteLength,
        canonicalBytes: canonicalByteLength(parsed),
      }),
    });
  });
}

function decodeBudget(
  input: unknown,
  operation: "encode" | "decode",
): Result.Result<
  Readonly<DeclarativeV2FrameBudgetV1>,
  DeclarativeV2PhysicalFrameV1Error
> {
  if (!isNonArrayRecordSafe(input)) {
    return Result.fail(frameError(operation, "invalidBudget"));
  }
  const keys = ownEnumerableStringKeys(input);
  if (
    keys === undefined ||
    keys.length !== 2 ||
    !keys.includes("maximumFrameBytes") ||
    !keys.includes("maximumCanonicalBytes")
  ) {
    return Result.fail(frameError(operation, "invalidBudget"));
  }
  const maximumFrameBytes = ownDataValue(input, "maximumFrameBytes");
  const maximumCanonicalBytes = ownDataValue(input, "maximumCanonicalBytes");
  if (
    !isNonNegativeSafeInteger(maximumFrameBytes) ||
    !isNonNegativeSafeInteger(maximumCanonicalBytes)
  ) {
    return Result.fail(frameError(operation, "invalidBudget"));
  }
  return Result.succeed(Object.freeze({
    maximumFrameBytes,
    maximumCanonicalBytes,
  }));
}

function captureFrameEncodingInput(
  input: unknown,
  budget: DeclarativeV2FrameBudgetV1,
  operation: "encode" | "decode",
): Result.Result<
  CapturedPhysicalFrameEncodingInput,
  DeclarativeV2PhysicalFrameV1Error
> {
  return Result.gen(function* () {
    if (!isNonArrayRecordSafe(input)) {
      return yield* Result.fail(frameError(operation, "invalidInput"));
    }
    const kindValue = ownDataValue(input, "kind");
    if (
      typeof kindValue !== "string" ||
      !Object.hasOwn(FRAME_SCHEMAS, kindValue)
    ) {
      return yield* Result.fail(frameError(operation, "invalidInput", "kind"));
    }
    const kind = kindValue as FrameKind;
    const schema = FRAME_SCHEMAS[kind];
    const keys = ownEnumerableStringKeys(input);
    if (
      keys === undefined ||
      keys.length !== schema.length + 1 ||
      keys.some((key) =>
        key !== "kind" && !schema.some(([field]) => field === key)
      )
    ) {
      return yield* Result.fail(frameError(operation, "invalidInput", kind));
    }
    const borrowed: Record<string, CapturedScalar> = { kind };
    const stringByteLengths: Record<string, number> = {};
    let frameBytes = domainByteLength(kind) + 4;
    let canonicalBytes = 0;
    for (const [field, scalar] of schema) {
      const value = ownDataValue(input, field);
      const capturedValue = yield* captureScalar(
        value,
        scalar,
        operation,
        `${kind}.${field}`,
      );
      const measured = measureScalar(capturedValue, scalar);
      frameBytes = yield* checkedAdd(
        frameBytes,
        measured.frameBytes,
        operation,
        `${kind}.${field}`,
      );
      canonicalBytes = yield* checkedAdd(
        canonicalBytes,
        measured.canonicalBytes,
        operation,
        `${kind}.${field}`,
      );
      if (
        scalar.type === "string" ||
        scalar.type === "enum"
      ) {
        stringByteLengths[field] = measured.frameBytes - 4;
      } else if (
        scalar.type === "nullableString" &&
        capturedValue !== null
      ) {
        stringByteLengths[field] = measured.frameBytes - 5;
      }
      borrowed[field] = capturedValue;
    }
    if (frameBytes > budget.maximumFrameBytes) {
      return yield* Result.fail(new DeclarativeV2PhysicalFrameV1Error({
        operation,
        reason: "frameBytesExceeded",
        observed: frameBytes,
        maximum: budget.maximumFrameBytes,
      }));
    }
    if (canonicalBytes > budget.maximumCanonicalBytes) {
      return yield* Result.fail(new DeclarativeV2PhysicalFrameV1Error({
        operation,
        reason: "canonicalBytesExceeded",
        observed: canonicalBytes,
        maximum: budget.maximumCanonicalBytes,
      }));
    }
    const borrowedFrame = Object.freeze(borrowed) as CapturedFrame;
    yield* validateCrossFieldRules(borrowedFrame, operation);
    const owned: Record<string, CapturedScalar> = { kind };
    for (const [field] of schema) {
      owned[field] = captureOwnedScalar(borrowedFrame[field] ?? null);
    }
    return Object.freeze({
      frame: Object.freeze(owned) as CapturedFrame,
      borrowedFrame,
      usage: Object.freeze({
        frameBytes,
        canonicalBytes,
      }),
      capturedByteStorageLength:
        physicalFrameCapturedByteStorageLength(borrowedFrame),
      stringByteLengths: Object.freeze(stringByteLengths),
    });
  });
}

function captureScalar(
  value: unknown,
  schema: ScalarKind,
  operation: "encode" | "decode",
  path: string,
): Result.Result<CapturedScalar, DeclarativeV2PhysicalFrameV1Error> {
  switch (schema.type) {
    case "string":
      return typeof value === "string" && value.length > 0 &&
          !value.includes("\0") && hasOnlyPairedSurrogates(value)
        ? Result.succeed(value)
        : Result.fail(frameError(operation, "invalidInput", path));
    case "nullableString":
      return value === null ||
          (typeof value === "string" && value.length > 0 &&
            !value.includes("\0") && hasOnlyPairedSurrogates(value))
        ? Result.succeed(value)
        : Result.fail(frameError(operation, "invalidInput", path));
    case "u64":
      return typeof value === "bigint" &&
          value >= (schema.positive === true ? 1n : 0n) &&
          value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1
        ? Result.succeed(value)
        : Result.fail(frameError(operation, "invalidInput", path));
    case "nullableU64":
      return value === null ||
          (typeof value === "bigint" && value >= 0n &&
            value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1)
        ? Result.succeed(value)
        : Result.fail(frameError(operation, "invalidInput", path));
    case "digest":
      return isUint8Array(value) &&
          intrinsicUint8ArrayByteLength(value) ===
            DECLARATIVE_V2_SHA256_BYTES_V1
        ? Result.succeed(value)
        : Result.fail(frameError(operation, "invalidInput", path));
    case "nullableDigest":
      return value === null ||
          (isUint8Array(value) &&
            intrinsicUint8ArrayByteLength(value) ===
              DECLARATIVE_V2_SHA256_BYTES_V1)
        ? Result.succeed(value)
        : Result.fail(frameError(operation, "invalidInput", path));
    case "bytes": {
      if (!isUint8Array(value)) {
        return Result.fail(frameError(operation, "invalidInput", path));
      }
      const length = intrinsicUint8ArrayByteLength(value);
      return length !== undefined && length > 0 && length <= U32_MAX
        ? Result.succeed(value)
        : Result.fail(frameError(operation, "invalidInput", path));
    }
    case "enum":
      return typeof value === "string" && schema.values.has(value)
        ? Result.succeed(value)
        : Result.fail(frameError(operation, "invalidInput", path));
  }
}

function validateCrossFieldRules(
  frame: CapturedFrame,
  operation: "encode" | "decode",
): Result.Result<void, DeclarativeV2PhysicalFrameV1Error> {
  if (frame.kind === "import_edge") {
    const importKind = frame["importKind"];
    const importedName = frame["importedName"];
    if (
      (importKind === "named" && typeof importedName !== "string") ||
      (importKind !== "named" && importedName !== null)
    ) {
      return Result.fail(frameError(
        operation,
        "invalidInput",
        "import_edge.importedName",
      ));
    }
  }
  if (frame.kind === "verdict") {
    const ready = frame["verdict"] === "ready";
    const rootsPresent =
      isUint8Array(frame["handlerSetSha256"]) &&
      isUint8Array(frame["registrationRootSha256"]) &&
      isUint8Array(frame["indexReadinessRootSha256"]);
    if (
      (ready && (frame["failureCode"] !== null || !rootsPresent)) ||
      (!ready && (
        typeof frame["failureCode"] !== "string" ||
        frame["handlerSetSha256"] !== null ||
        frame["registrationRootSha256"] !== null ||
        frame["indexReadinessRootSha256"] !== null
      ))
    ) {
      return Result.fail(frameError(operation, "invalidInput", "verdict"));
    }
  }
  if (frame.kind === "phase_page_manifest") {
    const pageOrdinal = frame["pageOrdinal"];
    const previousPageSha256 = frame["previousPageSha256"];
    if (
      typeof pageOrdinal !== "bigint" ||
      ((pageOrdinal === 0n) !== (previousPageSha256 === null))
    ) {
      return Result.fail(frameError(
        operation,
        "invalidInput",
        "phase_page_manifest.previousPageSha256",
      ));
    }
  }
  if (frame.kind === "activation_revision") {
    const revision = frame["revision"];
    const previous = frame["previousRevision"];
    if (
      typeof revision !== "bigint" ||
      !(
        (revision === 1n && previous === null) ||
        (revision > 1n && previous === revision - 1n)
      )
    ) {
      return Result.fail(frameError(
        operation,
        "invalidInput",
        "activation_revision.previousRevision",
      ));
    }
  }
  if (frame.kind === "activation_head") {
    const values = [
      frame["currentRevision"],
      frame["candidateSha256"],
      frame["verdictSha256"],
    ];
    const allNull = values.every((value) => value === null);
    const allPresent = values.every((value) => value !== null);
    if (
      (!allNull && !allPresent) ||
      (allPresent && (
        typeof frame["currentRevision"] !== "bigint" ||
        typeof frame["revisionCounter"] !== "bigint" ||
        frame["currentRevision"] < 1n ||
        frame["revisionCounter"] < frame["currentRevision"]
      ))
    ) {
      return Result.fail(frameError(operation, "invalidInput", "activation_head"));
    }
  }
  return Result.succeed(undefined);
}

function checkedAdd(
  left: number,
  right: number,
  operation: "encode" | "decode",
  path: string,
): Result.Result<number, DeclarativeV2PhysicalFrameV1Error> {
  const result = left + right;
  return Number.isSafeInteger(result) && result <= U32_MAX
    ? Result.succeed(result)
    : Result.fail(frameError(operation, "invalidInput", path));
}

function measureScalar(
  value: CapturedScalar,
  schema: ScalarKind,
): DeclarativeV2FrameUsageV1 {
  switch (schema.type) {
    case "string":
    case "enum": {
      const length = utf8ByteLength(value as string);
      return { frameBytes: 4 + length, canonicalBytes: 0 };
    }
    case "nullableString": {
      if (value === null) return { frameBytes: 1, canonicalBytes: 0 };
      const length = utf8ByteLength(value as string);
      return { frameBytes: 5 + length, canonicalBytes: 0 };
    }
    case "u64":
      return { frameBytes: 8, canonicalBytes: 0 };
    case "nullableU64":
      return { frameBytes: value === null ? 1 : 9, canonicalBytes: 0 };
    case "digest":
      return {
        frameBytes: DECLARATIVE_V2_SHA256_BYTES_V1,
        canonicalBytes: 0,
      };
    case "nullableDigest":
      return {
        frameBytes: value === null
          ? 1
          : 1 + DECLARATIVE_V2_SHA256_BYTES_V1,
        canonicalBytes: 0,
      };
    case "bytes": {
      const length = intrinsicUint8ArrayByteLength(value);
      if (length === undefined) {
        throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
          reason: "invalidPlatformIntrinsic",
        });
      }
      return {
        frameBytes: 4 + length,
        canonicalBytes: schema.canonical === true ? length : 0,
      };
    }
  }
}

function physicalFrameEncodingSegments(
  frame: CapturedFrame,
  stringByteLengths: Readonly<Record<string, number>>,
): readonly PhysicalFrameEncodingSegment[] {
  const schema = FRAME_SCHEMAS[frame.kind];
  const segments: PhysicalFrameEncodingSegment[] = [];
  const bytes = (value: Uint8Array): void => {
    const byteLength = intrinsicUint8ArrayByteLength(value);
    if (byteLength === undefined) {
      throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
        reason: "invalidPlatformIntrinsic",
      });
    }
    segments.push(Object.freeze({ kind: "bytes", bytes: value, byteLength }));
  };
  const string = (field: string, value: string): void => {
    const byteLength = stringByteLengths[field];
    if (!isNonNegativeSafeInteger(byteLength)) {
      throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
        reason: "reencodeFailed",
      });
    }
    segments.push(Object.freeze({
      kind: "u32",
      value: byteLength,
    }));
    segments.push(Object.freeze({
      kind: "string",
      value,
      byteLength,
    }));
  };
  const byte = (value: number): void => {
    segments.push(Object.freeze({ kind: "byte", value }));
  };
  const u64 = (value: bigint): void => {
    segments.push(Object.freeze({ kind: "u64", value }));
  };
  bytes(PHYSICAL_DOMAIN_BYTES[frame.kind]);
  segments.push(Object.freeze({ kind: "u32", value: schema.length }));
  for (const [field, scalar] of schema) {
    const value = frame[field] ?? null;
    switch (scalar.type) {
      case "string":
      case "enum":
        string(field, value as string);
        break;
      case "nullableString":
        byte(value === null ? 0 : 1);
        if (typeof value === "string") string(field, value);
        break;
      case "u64":
        u64(value as bigint);
        break;
      case "nullableU64":
        byte(value === null ? 0 : 1);
        if (typeof value === "bigint") u64(value);
        break;
      case "digest":
        bytes(value as Uint8Array);
        break;
      case "nullableDigest":
        byte(value === null ? 0 : 1);
        if (isUint8Array(value)) bytes(value);
        break;
      case "bytes": {
        const valueBytes = value as Uint8Array;
        const length = intrinsicUint8ArrayByteLength(valueBytes);
        if (length === undefined) {
          throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
            reason: "invalidPlatformIntrinsic",
          });
        }
        segments.push(Object.freeze({ kind: "u32", value: length }));
        bytes(valueBytes);
        break;
      }
    }
  }
  return Object.freeze(segments);
}

function consumePhysicalFrameEncodingByte(
  state: PhysicalFrameEncoderCursorState,
  segment: PhysicalFrameEncodingSegment,
): number | undefined {
  if (segment.kind === "string") {
    if (state.stringByteLength === 0) {
      if (state.segmentOffset >= segment.value.length) return undefined;
      const codePoint = segment.value.codePointAt(state.segmentOffset);
      if (codePoint === undefined) return undefined;
      state.stringCodePoint = codePoint;
      state.stringCodeUnitWidth = codePoint > 0xffff ? 2 : 1;
      state.stringByteIndex = 0;
      state.stringByteLength = utf8CodePointByteLength(codePoint);
    }
    const value = utf8CodePointByte(
      state.stringCodePoint,
      state.stringByteLength,
      state.stringByteIndex,
    );
    if (value === undefined) return undefined;
    state.stringByteIndex += 1;
    if (state.stringByteIndex === state.stringByteLength) {
      state.segmentOffset += state.stringCodeUnitWidth;
      state.stringCodePoint = 0;
      state.stringCodeUnitWidth = 0;
      state.stringByteIndex = 0;
      state.stringByteLength = 0;
    }
    return value;
  }

  const length = physicalFrameEncodingSegmentLength(segment);
  if (state.segmentOffset >= length) return undefined;
  let value: number | undefined;
  switch (segment.kind) {
    case "bytes":
      value = segment.bytes[state.segmentOffset];
      break;
    case "byte":
      value = state.segmentOffset === 0 ? segment.value : undefined;
      break;
    case "u32":
      value = Math.floor(
        segment.value / (2 ** ((3 - state.segmentOffset) * 8)),
      ) & 0xff;
      break;
    case "u64":
      value = Number(
        (segment.value >> BigInt((7 - state.segmentOffset) * 8)) & 0xffn,
      );
      break;
  }
  if (value === undefined) return undefined;
  state.segmentOffset += 1;
  return value;
}

function isPhysicalFrameEncodingSegmentComplete(
  state: PhysicalFrameEncoderCursorState,
  segment: PhysicalFrameEncodingSegment,
): boolean {
  return segment.kind === "string"
    ? state.segmentOffset === segment.value.length &&
      state.stringByteLength === 0
    : state.segmentOffset === physicalFrameEncodingSegmentLength(segment);
}

function resetPhysicalFrameSegmentState(
  state: PhysicalFrameEncoderCursorState,
): void {
  state.segmentOffset = 0;
  state.stringCodePoint = 0;
  state.stringCodeUnitWidth = 0;
  state.stringByteIndex = 0;
  state.stringByteLength = 0;
}

function utf8CodePointByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function utf8CodePointByte(
  codePoint: number,
  byteLength: number,
  byteIndex: number,
): number | undefined {
  if (
    !isNonNegativeSafeInteger(codePoint) ||
    !isNonNegativeSafeInteger(byteIndex) ||
    byteIndex >= byteLength
  ) return undefined;
  if (byteLength === 1) return byteIndex === 0 ? codePoint : undefined;
  if (byteIndex === 0) {
    return byteLength === 2
      ? 0xc0 | (codePoint >> 6)
      : byteLength === 3
      ? 0xe0 | (codePoint >> 12)
      : 0xf0 | (codePoint >> 18);
  }
  const shift = (byteLength - 1 - byteIndex) * 6;
  return 0x80 | ((codePoint >> shift) & 0x3f);
}

function parseOwnedFrame(
  input: Uint8Array,
  budget: DeclarativeV2FrameBudgetV1,
): Result.Result<CapturedFrame, DeclarativeV2PhysicalFrameV1Error> {
  return Result.gen(function* () {
    const nul = input.indexOf(0);
    if (nul < 0 || nul > 128) {
      return yield* Result.fail(frameError("decode", "malformed", "domain"));
    }
    let domain: string;
    try {
      domain = FATAL_UTF8_DECODER.decode(input.subarray(0, nul + 1));
    } catch {
      return yield* Result.fail(frameError("decode", "malformed", "domain"));
    }
    const kind = frameKindFromDomain(domain);
    if (kind === null) {
      return yield* Result.fail(frameError("decode", "malformed", "domain"));
    }
    const schema = FRAME_SCHEMAS[kind];
    let offset = nul + 1;
    if (offset + 4 > input.byteLength) {
      return yield* Result.fail(frameError("decode", "malformed", "fieldCount"));
    }
    const fieldCount = readU32(input, offset);
    offset += 4;
    if (fieldCount !== schema.length) {
      return yield* Result.fail(frameError("decode", "malformed", "fieldCount"));
    }
    const captured: Record<string, CapturedScalar> = { kind };
    let canonicalBytes = 0;
    for (const [field, scalar] of schema) {
      const parsed = yield* readScalar(
        input,
        offset,
        scalar,
        `${kind}.${field}`,
        canonicalBytes,
        budget.maximumCanonicalBytes,
      );
      captured[field] = parsed.value;
      offset = parsed.offset;
      canonicalBytes = parsed.canonicalBytes;
    }
    if (offset !== input.byteLength) {
      return yield* Result.fail(frameError("decode", "malformed", "trailing"));
    }
    const frozen = Object.freeze(captured) as CapturedFrame;
    yield* validateCrossFieldRules(frozen, "decode");
    return frozen;
  });
}

function readScalar(
  input: Uint8Array,
  offset: number,
  schema: ScalarKind,
  path: string,
  canonicalBytes: number,
  maximumCanonicalBytes: number,
): Result.Result<
  Readonly<{
    readonly value: CapturedScalar;
    readonly offset: number;
    readonly canonicalBytes: number;
  }>,
  DeclarativeV2PhysicalFrameV1Error
> {
  const malformed = () =>
    Result.fail(frameError("decode", "malformed", path));
  switch (schema.type) {
    case "string":
    case "enum": {
      const decoded = decodeString(input, offset);
      if (decoded === null) return malformed();
      if (schema.type === "enum" && !schema.values.has(decoded.value)) {
        return malformed();
      }
      return Result.succeed({
        value: decoded.value,
        offset: decoded.offset,
        canonicalBytes,
      });
    }
    case "nullableString": {
      const tag = input[offset];
      if (tag === undefined || (tag !== 0 && tag !== 1)) return malformed();
      if (tag === 0) {
        return Result.succeed({
          value: null,
          offset: offset + 1,
          canonicalBytes,
        });
      }
      const decoded = decodeString(input, offset + 1);
      return decoded === null
        ? malformed()
        : Result.succeed({
          value: decoded.value,
          offset: decoded.offset,
          canonicalBytes,
        });
    }
    case "u64": {
      const value = readU64(input, offset);
      if (
        value === null ||
        (schema.positive === true && value === 0n)
      ) return malformed();
      return Result.succeed({
        value,
        offset: offset + 8,
        canonicalBytes,
      });
    }
    case "nullableU64": {
      const tag = input[offset];
      if (tag === undefined || (tag !== 0 && tag !== 1)) return malformed();
      if (tag === 0) {
        return Result.succeed({
          value: null,
          offset: offset + 1,
          canonicalBytes,
        });
      }
      const value = readU64(input, offset + 1);
      return value === null
        ? malformed()
        : Result.succeed({
          value,
          offset: offset + 9,
          canonicalBytes,
        });
    }
    case "digest": {
      if (offset + DECLARATIVE_V2_SHA256_BYTES_V1 > input.byteLength) {
        return malformed();
      }
      return Result.succeed({
        value: input.slice(
          offset,
          offset + DECLARATIVE_V2_SHA256_BYTES_V1,
        ),
        offset: offset + DECLARATIVE_V2_SHA256_BYTES_V1,
        canonicalBytes,
      });
    }
    case "nullableDigest": {
      const tag = input[offset];
      if (tag === undefined || (tag !== 0 && tag !== 1)) return malformed();
      if (tag === 0) {
        return Result.succeed({
          value: null,
          offset: offset + 1,
          canonicalBytes,
        });
      }
      const end = offset + 1 + DECLARATIVE_V2_SHA256_BYTES_V1;
      if (end > input.byteLength) return malformed();
      return Result.succeed({
        value: input.slice(offset + 1, end),
        offset: end,
        canonicalBytes,
      });
    }
    case "bytes": {
      if (offset + 4 > input.byteLength) return malformed();
      const length = readU32(input, offset);
      const end = offset + 4 + length;
      if (length === 0 || end > input.byteLength) return malformed();
      const nextCanonical = schema.canonical === true
        ? canonicalBytes + length
        : canonicalBytes;
      if (!Number.isSafeInteger(nextCanonical)) return malformed();
      if (nextCanonical > maximumCanonicalBytes) {
        return Result.fail(new DeclarativeV2PhysicalFrameV1Error({
          operation: "decode",
          reason: "canonicalBytesExceeded",
          observed: nextCanonical,
          maximum: maximumCanonicalBytes,
          path,
        }));
      }
      return Result.succeed({
        value: input.slice(offset + 4, end),
        offset: end,
        canonicalBytes: nextCanonical,
      });
    }
  }
}

function decodeString(
  input: Uint8Array,
  offset: number,
): Readonly<{ readonly value: string; readonly offset: number }> | null {
  if (offset + 4 > input.byteLength) return null;
  const length = readU32(input, offset);
  const end = offset + 4 + length;
  if (length === 0 || end > input.byteLength) return null;
  try {
    const value = FATAL_UTF8_DECODER.decode(input.subarray(offset + 4, end));
    if (
      value.length === 0 ||
      value.includes("\0") ||
      !hasOnlyPairedSurrogates(value)
    ) return null;
    const canonical = UTF8_ENCODER.encode(value);
    if (!bytesEqualFullScan(canonical, input.subarray(offset + 4, end))) {
      return null;
    }
    return { value, offset: end };
  } catch {
    return null;
  }
}

function captureOwnedScalar(value: CapturedScalar): CapturedScalar {
  return isUint8Array(value) ? new Uint8Array(value) : value;
}

function ownDataValue(
  input: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor !== undefined &&
        descriptor.enumerable &&
        "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function physicalFrameCapturedByteStorageLength(
  frame: CapturedFrame,
): number {
  let result = 0;
  for (const [field] of FRAME_SCHEMAS[frame.kind]) {
    const value = frame[field];
    if (!isUint8Array(value)) continue;
    const length = intrinsicUint8ArrayByteLength(value);
    if (length === undefined) {
      throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
        reason: "invalidPlatformIntrinsic",
      });
    }
    result = checkedPhysicalFrameWorkCount(result, length);
  }
  return result;
}

function physicalFrameByteCopyLength(frame: CapturedFrame): number {
  return checkedPhysicalFrameWorkCount(
    PHYSICAL_DOMAIN_BYTES[frame.kind].byteLength,
    physicalFrameCapturedByteStorageLength(frame),
  );
}

function physicalFrameEncodingSegmentLength(
  segment: PhysicalFrameEncodingSegment,
): number {
  switch (segment.kind) {
    case "bytes":
      return segment.byteLength;
    case "string":
      return segment.byteLength;
    case "byte":
      return 1;
    case "u32":
      return 4;
    case "u64":
      return 8;
  }
}

function assertExactPhysicalFrameEncodingSegments(
  frameByteLength: number,
  byteCopyLength: number,
  segments: readonly PhysicalFrameEncodingSegment[],
): void {
  let measuredLength = 0;
  let measuredCopies = 0;
  for (const segment of segments) {
    const length = physicalFrameEncodingSegmentLength(segment);
    measuredLength = checkedPhysicalFrameWorkCount(measuredLength, length);
    if (segment.kind === "bytes") {
      measuredCopies = checkedPhysicalFrameWorkCount(measuredCopies, length);
    }
  }
  if (
    measuredLength !== frameByteLength ||
    measuredCopies !== byteCopyLength
  ) {
    throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
      reason: "reencodeFailed",
    });
  }
}

function physicalFrameEncodingWork(
  frame: CapturedFrame,
  frameByteLength: number,
  capturedByteStorageLength: number,
): DeclarativeV2PhysicalFrameWorkV1 {
  return Object.freeze({
    byteStorageAllocationBytes: checkedPhysicalFrameWorkCount(
      capturedByteStorageLength,
      frameByteLength,
    ),
    byteCopyBytes: checkedPhysicalFrameWorkCount(
      capturedByteStorageLength,
      physicalFrameByteCopyLength(frame),
    ),
    byteWriteBytes: frameByteLength,
    byteScanBytes: 0,
    primitiveTransitions: frameByteLength,
  });
}

function mutableZeroPhysicalFrameWork(): MutablePhysicalFrameWork {
  return {
    byteStorageAllocationBytes: 0,
    byteCopyBytes: 0,
    byteWriteBytes: 0,
    byteScanBytes: 0,
    primitiveTransitions: 0,
  };
}

function zeroPhysicalFrameWork(): DeclarativeV2PhysicalFrameWorkV1 {
  return Object.freeze({
    byteStorageAllocationBytes: 0,
    byteCopyBytes: 0,
    byteWriteBytes: 0,
    byteScanBytes: 0,
    primitiveTransitions: 0,
  });
}

function snapshotPhysicalFrameWork(
  work: DeclarativeV2PhysicalFrameWorkV1,
): DeclarativeV2PhysicalFrameWorkV1 {
  return Object.freeze({
    byteStorageAllocationBytes: work.byteStorageAllocationBytes,
    byteCopyBytes: work.byteCopyBytes,
    byteWriteBytes: work.byteWriteBytes,
    byteScanBytes: work.byteScanBytes,
    primitiveTransitions: work.primitiveTransitions,
  });
}

function addPhysicalFrameWork(
  target: MutablePhysicalFrameWork,
  delta: DeclarativeV2PhysicalFrameWorkV1,
): void {
  target.byteStorageAllocationBytes = checkedPhysicalFrameWorkCount(
    target.byteStorageAllocationBytes,
    delta.byteStorageAllocationBytes,
  );
  target.byteCopyBytes = checkedPhysicalFrameWorkCount(
    target.byteCopyBytes,
    delta.byteCopyBytes,
  );
  target.byteWriteBytes = checkedPhysicalFrameWorkCount(
    target.byteWriteBytes,
    delta.byteWriteBytes,
  );
  target.byteScanBytes = checkedPhysicalFrameWorkCount(
    target.byteScanBytes,
    delta.byteScanBytes,
  );
  target.primitiveTransitions = checkedPhysicalFrameWorkCount(
    target.primitiveTransitions,
    delta.primitiveTransitions,
  );
}

function subtractPhysicalFrameWork(
  after: DeclarativeV2PhysicalFrameWorkV1,
  before: DeclarativeV2PhysicalFrameWorkV1,
): DeclarativeV2PhysicalFrameWorkV1 {
  if (
    after.byteStorageAllocationBytes < before.byteStorageAllocationBytes ||
    after.byteCopyBytes < before.byteCopyBytes ||
    after.byteWriteBytes < before.byteWriteBytes ||
    after.byteScanBytes < before.byteScanBytes ||
    after.primitiveTransitions < before.primitiveTransitions
  ) {
    throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
      reason: "reencodeFailed",
    });
  }
  return Object.freeze({
    byteStorageAllocationBytes:
      after.byteStorageAllocationBytes - before.byteStorageAllocationBytes,
    byteCopyBytes: after.byteCopyBytes - before.byteCopyBytes,
    byteWriteBytes: after.byteWriteBytes - before.byteWriteBytes,
    byteScanBytes: after.byteScanBytes - before.byteScanBytes,
    primitiveTransitions:
      after.primitiveTransitions - before.primitiveTransitions,
  });
}

function assertExactPhysicalFrameSuccessfulWork(
  expected: DeclarativeV2PhysicalFrameWorkV1,
  actual: DeclarativeV2PhysicalFrameWorkV1,
): void {
  if (
    actual.byteStorageAllocationBytes !== expected.byteStorageAllocationBytes ||
    actual.byteCopyBytes !== expected.byteCopyBytes ||
    actual.byteWriteBytes !== expected.byteWriteBytes ||
    actual.byteScanBytes !== expected.byteScanBytes ||
    actual.primitiveTransitions !== expected.primitiveTransitions
  ) {
    throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
      reason: "reencodeFailed",
    });
  }
}

function physicalFrameEncoderReceipt(
  deltaWork: DeclarativeV2PhysicalFrameWorkV1,
  aggregateWork: DeclarativeV2PhysicalFrameWorkV1,
  consumedAllowance: number,
): DeclarativeV2PhysicalFrameEncoderReceiptV1 {
  return Object.freeze({
    consumedAllowance,
    deltaWork: snapshotPhysicalFrameWork(deltaWork),
    aggregateWork: snapshotPhysicalFrameWork(aggregateWork),
  });
}

function physicalFrameEncoderCursorState(
  cursors: WeakMap<object, PhysicalFrameEncoderCursorState>,
  cursor: unknown,
  operation: "admit" | "step" | "close",
): Result.Result<
  PhysicalFrameEncoderCursorState,
  DeclarativeV2PhysicalFrameV1Error
> {
  if (typeof cursor !== "object" || cursor === null) {
    return Result.fail(
      frameError("encode", "invalidInput", `cursor.${operation}`),
    );
  }
  const state = cursors.get(cursor);
  return state === undefined
    ? Result.fail(
      frameError("encode", "invalidInput", `cursor.${operation}`),
    )
    : Result.succeed(state);
}

function revokePhysicalFrameEncoderCursor(
  cursors: WeakMap<object, PhysicalFrameEncoderCursorState>,
  cursor: unknown,
): void {
  if (typeof cursor !== "object" || cursor === null) return;
  const state = cursors.get(cursor);
  if (state?.range !== undefined) {
    ACTIVE_PHYSICAL_FRAME_DESTINATIONS.delete(state.range);
  }
  cursors.delete(cursor);
}

function capturePhysicalFrameByteRange(
  input: unknown,
): Result.Result<
  DeclarativeV2PhysicalFrameByteRangeV1,
  DeclarativeV2PhysicalFrameV1Error
> {
  if (!isNonArrayRecordSafe(input)) {
    return Result.fail(
      frameError("encode", "invalidInput", "byteRange"),
    );
  }
  const keys = ownEnumerableStringKeys(input);
  if (
    keys === undefined ||
    keys.length !== 3 ||
    !keys.includes("bytes") ||
    !keys.includes("byteOffset") ||
    !keys.includes("byteLength")
  ) {
    return Result.fail(
      frameError("encode", "invalidInput", "byteRange"),
    );
  }
  const bytes = ownDataValue(input, "bytes");
  const byteOffset = ownDataValue(input, "byteOffset");
  const byteLength = ownDataValue(input, "byteLength");
  if (
    !isUint8Array(bytes) ||
    !isNonNegativeSafeInteger(byteOffset) ||
    !isNonNegativeSafeInteger(byteLength)
  ) {
    return Result.fail(
      frameError("encode", "invalidInput", "byteRange"),
    );
  }
  const visibleLength = intrinsicUint8ArrayByteLength(bytes);
  if (
    visibleLength === undefined ||
    isSharedArrayBufferStorage(bytes) ||
    byteOffset > visibleLength ||
    byteLength > visibleLength - byteOffset
  ) {
    return Result.fail(
      frameError("encode", "invalidInput", "byteRange"),
    );
  }
  return Result.succeed(Object.freeze({ bytes, byteOffset, byteLength }));
}

function isCurrentPhysicalFrameDestination(
  range: DeclarativeV2PhysicalFrameByteRangeV1,
): boolean {
  const visibleLength = intrinsicUint8ArrayByteLength(range.bytes);
  return visibleLength !== undefined &&
    !isSharedArrayBufferStorage(range.bytes) &&
    range.byteOffset <= visibleLength &&
    range.byteLength <= visibleLength - range.byteOffset;
}

function overlapsPhysicalFrameStorage(
  frame: CapturedFrame,
  destination: DeclarativeV2PhysicalFrameByteRangeV1,
): boolean {
  for (const [field] of FRAME_SCHEMAS[frame.kind]) {
    const source = frame[field];
    if (isUint8Array(source) && physicalFrameRangesOverlap(
      source,
      0,
      intrinsicUint8ArrayByteLength(source) ?? 0,
      destination.bytes,
      destination.byteOffset,
      destination.byteLength,
    )) return true;
  }
  return false;
}

function overlapsActivePhysicalFrameDestination(
  destination: DeclarativeV2PhysicalFrameByteRangeV1,
): boolean {
  for (const active of ACTIVE_PHYSICAL_FRAME_DESTINATIONS) {
    if (physicalFrameRangesOverlap(
      active.bytes,
      active.byteOffset,
      active.byteLength,
      destination.bytes,
      destination.byteOffset,
      destination.byteLength,
    )) return true;
  }
  return false;
}

function physicalFrameRangesOverlap(
  left: Uint8Array,
  leftOffset: number,
  leftLength: number,
  right: Uint8Array,
  rightOffset: number,
  rightLength: number,
): boolean {
  const leftBuffer = intrinsicUint8ArrayBuffer(left);
  const rightBuffer = intrinsicUint8ArrayBuffer(right);
  const leftViewOffset = intrinsicUint8ArrayByteOffset(left);
  const rightViewOffset = intrinsicUint8ArrayByteOffset(right);
  if (
    leftBuffer === undefined ||
    rightBuffer === undefined ||
    leftViewOffset === undefined ||
    rightViewOffset === undefined
  ) return true;
  if (leftBuffer !== rightBuffer) return false;
  const leftStart = checkedPhysicalFrameRangeEnd(leftViewOffset, leftOffset);
  const rightStart = checkedPhysicalFrameRangeEnd(rightViewOffset, rightOffset);
  const leftEnd = checkedPhysicalFrameRangeEnd(leftStart, leftLength);
  const rightEnd = checkedPhysicalFrameRangeEnd(rightStart, rightLength);
  return leftStart < rightEnd && rightStart < leftEnd;
}

function checkedPhysicalFrameRangeEnd(left: number, right: number): number {
  if (
    !isNonNegativeSafeInteger(left) ||
    !isNonNegativeSafeInteger(right) ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
      reason: "reencodeFailed",
    });
  }
  return left + right;
}

function intrinsicUint8ArrayByteOffset(
  value: Uint8Array,
): number | undefined {
  if (UINT8_ARRAY_BYTE_OFFSET_GETTER === undefined) return undefined;
  try {
    const result = Reflect.apply(UINT8_ARRAY_BYTE_OFFSET_GETTER, value, []);
    return isNonNegativeSafeInteger(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function intrinsicUint8ArrayBuffer(
  value: Uint8Array,
): ArrayBufferLike | undefined {
  if (UINT8_ARRAY_BUFFER_GETTER === undefined) return undefined;
  try {
    const result = Reflect.apply(UINT8_ARRAY_BUFFER_GETTER, value, []);
    return intrinsicBufferKind(result) === undefined ? undefined : result;
  } catch {
    return undefined;
  }
}

function isSharedArrayBufferStorage(value: Uint8Array): boolean {
  const buffer = intrinsicUint8ArrayBuffer(value);
  return buffer !== undefined && intrinsicBufferKind(buffer) === "shared";
}

function intrinsicBufferKind(
  value: unknown,
): "array" | "shared" | undefined {
  if (ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
    try {
      Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []);
      return "array";
    } catch {
      // Continue to the distinct SharedArrayBuffer intrinsic check.
    }
  }
  if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
    try {
      Reflect.apply(SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []);
      return "shared";
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function checkedPhysicalFrameWorkCount(
  ...values: readonly number[]
): number {
  let result = 0;
  for (const value of values) {
    if (
      !isNonNegativeSafeInteger(value) ||
      result > Number.MAX_SAFE_INTEGER - value
    ) {
      throw new DeclarativeV2PhysicalFrameV1InvariantDefect({
        reason: "reencodeFailed",
      });
    }
    result += value;
  }
  return result;
}

function isNonArrayRecordSafe(
  input: unknown,
): input is Readonly<Record<string, unknown>> {
  try {
    return isNonArrayRecord(input);
  } catch {
    return false;
  }
}

function ownEnumerableStringKeys(
  input: Readonly<Record<string, unknown>>,
): readonly string[] | undefined {
  try {
    const keys = Object.keys(input);
    return Object.getOwnPropertySymbols(input).length === 0
      ? keys
      : undefined;
  } catch {
    return undefined;
  }
}

function domainByteLength(kind: FrameKind): number {
  return PHYSICAL_DOMAIN_BYTES[kind].byteLength;
}

function frameKindFromDomain(domain: string): FrameKind | null {
  if (!domain.startsWith(DOMAIN_PREFIX) || !domain.endsWith(DOMAIN_SUFFIX)) {
    return null;
  }
  const kind = domain.slice(DOMAIN_PREFIX.length, -DOMAIN_SUFFIX.length);
  return Object.hasOwn(FRAME_SCHEMAS, kind) ? kind as FrameKind : null;
}

function readU32(input: Uint8Array, offset: number): number {
  return (
    ((input[offset] ?? 0) * 0x1000000) +
    ((input[offset + 1] ?? 0) << 16) +
    ((input[offset + 2] ?? 0) << 8) +
    (input[offset + 3] ?? 0)
  );
}

function readU64(input: Uint8Array, offset: number): bigint | null {
  if (offset + 8 > input.byteLength) return null;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(input[offset + index] ?? 0);
  }
  return value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1 ? value : null;
}

function intrinsicUint8ArrayByteLength(
  value: unknown,
): number | undefined {
  if (UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    if (!isUint8Array(value)) return undefined;
    const result = Reflect.apply(UINT8_ARRAY_BYTE_LENGTH_GETTER, value, []);
    return isNonNegativeSafeInteger(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function canonicalByteLength(frame: CapturedFrame): number {
  const schema = FRAME_SCHEMAS[frame.kind];
  return schema.reduce(
    (sum, [field, scalar]) =>
      sum + measureScalar(frame[field] ?? null, scalar).canonicalBytes,
    0,
  );
}

function frameError(
  operation: "encode" | "decode",
  reason: DeclarativeV2PhysicalFrameV1Error["reason"],
  path?: string,
): DeclarativeV2PhysicalFrameV1Error {
  return new DeclarativeV2PhysicalFrameV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });
}
