import {
  bytesEqualFullScan,
  isUint8Array,
} from "@flarex/utils/bytes";
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

export function encodeDeclarativeV2PhysicalFrameV1(
  input: unknown,
  budget: unknown,
): Result.Result<
  DeclarativeV2EncodedFrameV1,
  DeclarativeV2PhysicalFrameV1Error
> {
  return Result.gen(function* () {
    const limits = yield* decodeBudget(budget, "encode");
    const captured = yield* captureFrame(input, limits, "encode");
    const bytes = encodeCapturedFrame(captured);
    return Object.freeze({
      frame: captured as DeclarativeV2PhysicalFrameV1,
      canonicalBytes: bytes,
      usage: Object.freeze({
        frameBytes: bytes.byteLength,
        canonicalBytes: canonicalByteLength(captured),
      }),
    });
  });
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
  if (!isNonArrayRecord(input)) {
    return Result.fail(frameError(operation, "invalidBudget"));
  }
  const keys = Object.keys(input);
  if (
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

function captureFrame(
  input: unknown,
  budget: DeclarativeV2FrameBudgetV1,
  operation: "encode" | "decode",
): Result.Result<CapturedFrame, DeclarativeV2PhysicalFrameV1Error> {
  return Result.gen(function* () {
    if (!isNonArrayRecord(input)) {
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
    const keys = Object.keys(input);
    if (
      keys.length !== schema.length + 1 ||
      keys.some((key) =>
        key !== "kind" && !schema.some(([field]) => field === key)
      ) ||
      Object.getOwnPropertySymbols(input).length !== 0
    ) {
      return yield* Result.fail(frameError(operation, "invalidInput", kind));
    }
    const borrowed: Record<string, CapturedScalar> = { kind };
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
    return Object.freeze(owned) as CapturedFrame;
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

function encodeCapturedFrame(frame: CapturedFrame): Uint8Array {
  const schema = FRAME_SCHEMAS[frame.kind];
  const total = domainByteLength(frame.kind) + 4 +
    schema.reduce(
      (sum, [field, kind]) =>
        sum + measureScalar(frame[field] ?? null, kind).frameBytes,
      0,
    );
  const output = new Uint8Array(total);
  let offset = 0;
  const domain = domainBytes(frame.kind);
  output.set(domain, offset);
  offset += domain.byteLength;
  writeU32(output, offset, schema.length);
  offset += 4;
  for (const [field, kind] of schema) {
    offset = writeScalar(output, offset, frame[field] ?? null, kind);
  }
  return output;
}

function writeScalar(
  output: Uint8Array,
  offset: number,
  value: CapturedScalar,
  schema: ScalarKind,
): number {
  switch (schema.type) {
    case "string":
    case "enum":
      return writeString(output, offset, value as string);
    case "nullableString":
      if (value === null) {
        output[offset] = 0;
        return offset + 1;
      }
      output[offset] = 1;
      return writeString(output, offset + 1, value as string);
    case "u64":
      writeU64(output, offset, value as bigint);
      return offset + 8;
    case "nullableU64":
      if (value === null) {
        output[offset] = 0;
        return offset + 1;
      }
      output[offset] = 1;
      writeU64(output, offset + 1, value as bigint);
      return offset + 9;
    case "digest":
      output.set(value as Uint8Array, offset);
      return offset + DECLARATIVE_V2_SHA256_BYTES_V1;
    case "nullableDigest":
      if (value === null) {
        output[offset] = 0;
        return offset + 1;
      }
      output[offset] = 1;
      output.set(value as Uint8Array, offset + 1);
      return offset + 1 + DECLARATIVE_V2_SHA256_BYTES_V1;
    case "bytes": {
      const bytes = value as Uint8Array;
      writeU32(output, offset, bytes.byteLength);
      output.set(bytes, offset + 4);
      return offset + 4 + bytes.byteLength;
    }
  }
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
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function domainBytes(kind: FrameKind): Uint8Array {
  return UTF8_ENCODER.encode(`${DOMAIN_PREFIX}${kind}${DOMAIN_SUFFIX}`);
}

function domainByteLength(kind: FrameKind): number {
  return utf8ByteLength(`${DOMAIN_PREFIX}${kind}${DOMAIN_SUFFIX}`);
}

function frameKindFromDomain(domain: string): FrameKind | null {
  if (!domain.startsWith(DOMAIN_PREFIX) || !domain.endsWith(DOMAIN_SUFFIX)) {
    return null;
  }
  const kind = domain.slice(DOMAIN_PREFIX.length, -DOMAIN_SUFFIX.length);
  return Object.hasOwn(FRAME_SCHEMAS, kind) ? kind as FrameKind : null;
}

function writeString(
  output: Uint8Array,
  offset: number,
  value: string,
): number {
  const bytes = UTF8_ENCODER.encode(value);
  writeU32(output, offset, bytes.byteLength);
  output.set(bytes, offset + 4);
  return offset + 4 + bytes.byteLength;
}

function writeU32(output: Uint8Array, offset: number, value: number): void {
  output[offset] = (value >>> 24) & 0xff;
  output[offset + 1] = (value >>> 16) & 0xff;
  output[offset + 2] = (value >>> 8) & 0xff;
  output[offset + 3] = value & 0xff;
}

function readU32(input: Uint8Array, offset: number): number {
  return (
    ((input[offset] ?? 0) * 0x1000000) +
    ((input[offset + 1] ?? 0) << 16) +
    ((input[offset + 2] ?? 0) << 8) +
    (input[offset + 3] ?? 0)
  );
}

function writeU64(output: Uint8Array, offset: number, value: bigint): void {
  for (let index = 7; index >= 0; index -= 1) {
    output[offset + index] = Number(value & 0xffn);
    value >>= 8n;
  }
}

function readU64(input: Uint8Array, offset: number): bigint | null {
  if (offset + 8 > input.byteLength) return null;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(input[offset + index] ?? 0);
  }
  return value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1 ? value : null;
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      length += 1;
    } else if (codeUnit <= 0x7ff) {
      length += 2;
    } else if (
      codeUnit >= 0xd800 && codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        index += 1;
      } else {
        length += 3;
      }
    } else {
      length += 3;
    }
  }
  return length;
}

function hasOnlyPairedSurrogates(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

function intrinsicUint8ArrayByteLength(
  value: unknown,
): number | undefined {
  try {
    if (!isUint8Array(value)) return undefined;
    return Reflect.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype),
      "byteLength",
    )?.get?.call(value) as number | undefined;
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
