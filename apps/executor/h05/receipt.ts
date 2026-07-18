import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";

import { isH05CloudflareHexId } from "./cloudflareHexId";
import {
  isH05ControlPlaneCloudflareResourceId,
} from "./controlPlaneCloudflareResourceId";
import { decodeExactH05Scalar } from "./exactScalar";
import { formatH05JsonDocument } from "./jsonDocument";
import { isH05FullLowercaseGitCommit } from "./gitCommit";
import { isH05HttpsOriginUrl } from "./httpsOrigin";
import { isH05CanonicalIsoTimestamp } from "./isoTimestamp";
import { decodeNonEmptyH05String } from "./nonEmptyString";
import {
  decodeH05ProofRunId,
  h05ProofIdentity,
  type H05ProofRunId,
} from "./proofIdentity";
import { h05ProbeEndpoint, h05ProbeHop } from "./probeProtocol";
import { isH05LowercaseSha256Digest } from "./sha256";
import { h05Sha256Utf8 } from "./sha256Utf8";
import { requireOrderedH05Timestamps } from "./timestampOrder";
import { isH05SupportedWranglerVersion } from "./wranglerVersion";

declare const sha256Brand: unique symbol;
declare const gitCommitBrand: unique symbol;
declare const cloudflareResourceIdBrand: unique symbol;
declare const isoTimestampBrand: unique symbol;

type Sha256 = string & { readonly [sha256Brand]: "Sha256" };
type GitCommit = string & { readonly [gitCommitBrand]: "GitCommit" };
type CloudflareResourceId = string & {
  readonly [cloudflareResourceIdBrand]: "CloudflareResourceId";
};
type IsoTimestamp = string & {
  readonly [isoTimestampBrand]: "IsoTimestamp";
};

type Decoder<Output> = (value: unknown, path: string) => Output;
type DecoderOutput<Input> = Input extends Decoder<infer Output> ? Output : never;
type ObjectOutput<Shape extends Readonly<Record<string, Decoder<unknown>>>> = {
  readonly [Key in keyof Shape]: DecoderOutput<Shape[Key]>;
};
type TupleOutput<Shape extends readonly Decoder<unknown>[]> = {
  readonly [Index in keyof Shape]: DecoderOutput<Shape[Index]>;
};

export const h05HostedReceiptFormat = "flarex-h05-hosted-receipt-v2";
export const h05DataPlaneEvidenceFormat = "flarex-h05-data-plane-evidence-v1";
export const h05ExecutorWorkerName = "flarex-executor";
export const h05ProbeWorkerName = "flarex-executor-h05-probe";
export const h05ExecutorCompatibilityDate = "2026-06-14";
export const h05AuthorizedInvocationCount = 14;
export const h05UnauthorizedInvocationCount = 1;

export const h05ExecutorTokenName = "FLAREX_EXECUTOR_TOKEN";
export const h05HyperdriveBindingName = "HYPERDRIVE_CACHE_DISABLED";
export const h05ProbeRunIdName = "FLAREX_H05_RUN_ID";
export const h05ProbeTokenName = "FLAREX_H05_PROBE_TOKEN";
export const h05ServiceBindingName = "FLAREX_EXECUTOR";
const h05HopHeader = h05ProbeHop.header;
const h05HopValue = h05ProbeHop.value;
const h05SeedTimestamp = 10;

const sha256Decoder: Decoder<Sha256> = (value, path) => {
  const decoded = nonEmptyString(value, path);
  if (!isH05LowercaseSha256Digest(decoded)) {
    fail(`${path} has an invalid format.`);
  }
  if (/^0+$/.test(decoded)) {
    fail(`${path} must not use an all-zero placeholder.`);
  }
  return decoded as Sha256;
};
const gitCommitDecoder: Decoder<GitCommit> = (value, path) => {
  const decoded = nonEmptyString(value, path);
  if (!isH05FullLowercaseGitCommit(decoded)) {
    fail(`${path} has an invalid format.`);
  }
  if (/^0+$/.test(decoded)) {
    fail(`${path} must not use an all-zero placeholder.`);
  }
  return decoded as GitCommit;
};
const cloudflareResourceIdDecoder: Decoder<CloudflareResourceId> = (
  value,
  path,
) => {
  const decoded = nonEmptyString(value, path);
  if (!isH05ControlPlaneCloudflareResourceId(decoded)) {
    fail(`${path} must be a bounded opaque Cloudflare identifier.`);
  }
  return decoded as CloudflareResourceId;
};
const hyperdriveIdDecoder: Decoder<string> = (value, path) => {
  const decoded = nonEmptyString(value, path);
  if (!isH05CloudflareHexId(decoded)) fail(`${path} has an invalid format.`);
  if (/^0+$/.test(decoded)) {
    fail(`${path} must not use an all-zero placeholder.`);
  }
  return decoded;
};
const hyperdriveNameDecoder = patternString(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const wranglerVersionDecoder: Decoder<string> = (value, path) => {
  const decoded = nonEmptyString(value, path);
  if (!isH05SupportedWranglerVersion(decoded)) {
    fail(`${path} has an invalid format.`);
  }
  return decoded;
};

const h05InvocationEvidenceShape = {
  source: literal("hosted-occ-proof-harness"),
  unauthorizedStatus: literal(401),
  unauthorizedHopAbsent: literal(true),
  authorizedResponses: literal(h05AuthorizedInvocationCount),
  hopMarkedResponses: literal(h05AuthorizedInvocationCount),
  noStoreResponses: literal(15),
  hop: object({
    header: literal(h05HopHeader),
    value: literal(h05HopValue),
  }),
  winner: object({
    committedTs: positiveSafeInteger,
    observedTs: literal(h05SeedTimestamp),
    state: literal("finished"),
  }),
  stale: object({
    conflictStatus: literal(409),
    observedTs: literal(h05SeedTimestamp),
    currentTs: positiveSafeInteger,
    abortStatus: literal(200),
    afterAbortStatus: literal(409),
    state: literal("aborted"),
  }),
  fresh: object({
    committedTs: positiveSafeInteger,
    observedTs: positiveSafeInteger,
    previousTs: positiveSafeInteger,
    state: literal("finished"),
  }),
  sql: object({
    sessions: literal(3),
    activeSessions: literal(0),
    documentRevisions: literal(3),
    commits: literal(2),
    outboxEvents: literal(2),
    finalTs: positiveSafeInteger,
    finalPrevTs: positiveSafeInteger,
  }),
} satisfies Readonly<Record<string, Decoder<unknown>>>;

const h05InvocationEvidenceDecoder = object(h05InvocationEvidenceShape);
const h05InvocationReceiptDecoder = object({
  ...h05InvocationEvidenceShape,
  evidenceSha256: sha256Decoder,
});

const h05RunDecoder = object({
  runId: h05ProofRunIdDecoder,
  deploymentId: nonEmptyString,
  projectId: nonEmptyString,
});
const h05DataPlaneSourceDecoder = object({
  commit: gitCommitDecoder,
  worktreeClean: literal(true),
});
const h05WindowDecoder = object({
  startedAt: isoTimestampDecoder,
  finishedAt: isoTimestampDecoder,
});
const h05PostgresCleanupDecoder = object({ proofRowsRemaining: literal(0) });
const postgresSchemeDecoder = literalUnion(["postgres", "postgresql"]);
const postgresPortDecoder = positiveSafeIntegerInRangeDecoder(1, 65_535);
const postgresTlsModeDecoder = literalUnion([
  "require",
  "verify-ca",
  "verify-full",
]);
const probeDeletionOutcomeDecoder = literalUnion([
  "already-absent",
  "deleted",
]);
const h05DataPlaneEvidencePayloadShape = {
  format: literal(h05DataPlaneEvidenceFormat),
  source: h05DataPlaneSourceDecoder,
  window: h05WindowDecoder,
  run: h05RunDecoder,
  invocation: h05InvocationReceiptDecoder,
  postgresCleanup: h05PostgresCleanupDecoder,
} satisfies Readonly<Record<string, Decoder<unknown>>>;
const h05DataPlaneEvidencePayloadDecoder = object(
  h05DataPlaneEvidencePayloadShape,
);
const h05DataPlaneEvidenceDecoder = object({
  ...h05DataPlaneEvidencePayloadShape,
  evidenceSha256: sha256Decoder,
});

const receiptDecoder = object({
  format: literal(h05HostedReceiptFormat),
  redaction: object({
    bearerCapabilityValues: literal("omitted"),
    databaseOrigin: literal("sha256-only"),
    runIdentity: literal("included-non-sensitive"),
  }),
  source: object({
    commit: gitCommitDecoder,
    worktreeClean: literal(true),
    wranglerVersion: wranglerVersionDecoder,
    evidenceSha256: sha256Decoder,
  }),
  window: h05WindowDecoder,
  run: h05RunDecoder,
  inputs: object({
    controlPlaneBeforeEvidenceSha256: sha256Decoder,
    dataPlaneEvidenceSha256: sha256Decoder,
    controlPlaneAfterEvidenceSha256: sha256Decoder,
    probeTeardownEvidenceSha256: sha256Decoder,
    traceEvidenceSha256: sha256Decoder,
  }),
  hyperdrive: object({
    source: literal("cloudflare-hyperdrive-api"),
    id: hyperdriveIdDecoder,
    name: hyperdriveNameDecoder,
    cachingDisabled: literal(true),
    originHostSha256: sha256Decoder,
    originDatabaseSha256: sha256Decoder,
    originScheme: postgresSchemeDecoder,
    originPort: postgresPortDecoder,
    tlsMode: postgresTlsModeDecoder,
    capturedAt: isoTimestampDecoder,
  }),
  executor: object({
    workerName: literal(h05ExecutorWorkerName),
    deploymentId: cloudflareResourceIdDecoder,
    versionId: cloudflareResourceIdDecoder,
    trafficPercentage: literal(100),
    compatibilityDate: literal(h05ExecutorCompatibilityDate),
    compatibilityFlags: tuple([literal("nodejs_compat")]),
    placementMode: literal("smart"),
    hyperdriveBinding: object({
      name: literal(h05HyperdriveBindingName),
      id: hyperdriveIdDecoder,
    }),
    secretNames: tuple([literal(h05ExecutorTokenName)]),
    bindingInventoryComplete: literal(true),
    privacy: object({
      source: literal("cloudflare-workers-api"),
      inventoryComplete: literal(true),
      workersDevEnabled: literal(false),
      previewUrlsEnabled: literal(false),
      routeTargetCount: literal(0),
      customDomainTargetCount: literal(0),
      directPublicRequestStatus: literal(404),
      beforeCheckedAt: isoTimestampDecoder,
      afterCheckedAt: isoTimestampDecoder,
    }),
  }),
  probe: object({
    workerName: literal(h05ProbeWorkerName),
    deploymentId: cloudflareResourceIdDecoder,
    versionId: cloudflareResourceIdDecoder,
    trafficPercentage: literal(100),
    publicOrigin: h05ProbeOriginDecoder,
    workersDevEnabled: literal(true),
    previewUrlsEnabled: literal(false),
    serviceBinding: object({
      name: literal(h05ServiceBindingName),
      service: literal(h05ExecutorWorkerName),
    }),
    secretNames: tuple([
      literal(h05ExecutorTokenName),
      literal(h05ProbeTokenName),
      literal(h05ProbeRunIdName),
    ]),
    bindingInventoryComplete: literal(true),
  }),
  dataPlane: object({
    window: h05WindowDecoder,
    invocationEvidenceSha256: sha256Decoder,
    proofRowsRemaining: literal(0),
  }),
  trace: object({
    source: literal("cloudflare-observability-api"),
    probePath: nonEmptyString,
    samplingRate: literal(1),
    queryComplete: literal(true),
    truncatedTraceCount: literal(0),
    authorizedTraceCount: literal(h05AuthorizedInvocationCount),
    unauthorizedTraceCount: literal(h05UnauthorizedInvocationCount),
    serviceBindingTraceCount: literal(h05AuthorizedInvocationCount),
    outcomeOkTraceCount: literal(15),
    services: tuple([
      literal(h05ExecutorWorkerName),
      literal(h05ProbeWorkerName),
    ]),
    executorVersionId: cloudflareResourceIdDecoder,
    probeVersionId: cloudflareResourceIdDecoder,
    firstObservedAt: isoTimestampDecoder,
    lastObservedAt: isoTimestampDecoder,
    traceIdsSha256: sha256Decoder,
    evidenceSha256: sha256Decoder,
  }),
  cleanup: object({
    postgres: object({
      source: literal("data-plane-evidence"),
      proofRowsRemaining: literal(0),
      evidenceSha256: sha256Decoder,
    }),
    probe: object({
      source: literal("probe-teardown-evidence"),
      absent: literal(true),
      deletionOutcome: probeDeletionOutcomeDecoder,
      deletionStatus: literalUnion([200, 404]),
      authenticatedLookupStatus: literal(404),
      publicLookupStatus: literal(404),
      checkedAt: isoTimestampDecoder,
      evidenceSha256: sha256Decoder,
    }),
  }),
});

export type H05HostedReceipt = DecoderOutput<typeof receiptDecoder>;
export type H05InvocationEvidence = DecoderOutput<
  typeof h05InvocationEvidenceDecoder
>;
export type H05InvocationReceipt = DecoderOutput<
  typeof h05InvocationReceiptDecoder
>;
export type H05DataPlaneEvidence = DecoderOutput<
  typeof h05DataPlaneEvidenceDecoder
>;
export type H05DataPlaneEvidencePayload = DecoderOutput<
  typeof h05DataPlaneEvidencePayloadDecoder
>;

export type H05HostedReceiptDecode =
  | { readonly ok: true; readonly value: H05HostedReceipt }
  | { readonly ok: false; readonly message: string };

export function decodeH05HostedReceipt(value: unknown): H05HostedReceiptDecode {
  try {
    const receipt = receiptDecoder(value, "$");
    validateReceiptRelationships(receipt);
    return { ok: true, value: receipt };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export type H05InvocationEvidenceDecode =
  | { readonly ok: true; readonly value: H05InvocationEvidence }
  | { readonly ok: false; readonly message: string };

export function decodeH05InvocationEvidence(
  value: unknown,
): H05InvocationEvidenceDecode {
  try {
    const evidence = h05InvocationEvidenceDecoder(value, "$");
    validateInvocationRelationships(evidence);
    return { ok: true, value: evidence };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function decodeH05InvocationEvidenceJson(
  raw: string,
): H05InvocationEvidenceDecode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message: "Invalid H05 invocation evidence: evidence must contain valid JSON.",
    };
  }
  const decoded = decodeH05InvocationEvidence(parsed);
  if (!decoded.ok) return decoded;
  if (raw !== serializeH05InvocationEvidence(decoded.value)) {
    return {
      ok: false,
      message:
        "Invalid H05 invocation evidence: evidence must use canonical JSON serialization.",
    };
  }
  return decoded;
}

export type H05InvocationReceiptDecode =
  | { readonly ok: true; readonly value: H05InvocationReceipt }
  | { readonly ok: false; readonly message: string };

export function compileH05InvocationReceipt(
  value: unknown,
): H05InvocationReceiptDecode {
  const evidence = decodeH05InvocationEvidence(value);
  if (!evidence.ok) return evidence;
  return decodeH05InvocationReceipt({
    ...evidence.value,
    evidenceSha256: sha256(serializeH05InvocationEvidence(evidence.value)),
  });
}

export function decodeH05InvocationReceipt(
  value: unknown,
): H05InvocationReceiptDecode {
  try {
    const receipt = h05InvocationReceiptDecoder(value, "$");
    validateInvocationReceipt(receipt);
    return { ok: true, value: receipt };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export type H05DataPlaneEvidenceDecode =
  | { readonly ok: true; readonly value: H05DataPlaneEvidence }
  | { readonly ok: false; readonly message: string };

export function compileH05DataPlaneEvidence(
  value: unknown,
): H05DataPlaneEvidenceDecode {
  const payload = decodeH05DataPlaneEvidencePayload(value);
  if (!payload.ok) return payload;
  return decodeH05DataPlaneEvidence({
    ...payload.value,
    evidenceSha256: sha256(
      serializeH05DataPlaneEvidencePayload(payload.value),
    ),
  });
}

export function decodeH05DataPlaneEvidence(
  value: unknown,
): H05DataPlaneEvidenceDecode {
  try {
    const evidence = h05DataPlaneEvidenceDecoder(value, "$");
    validateDataPlaneEvidence(evidence);
    return { ok: true, value: evidence };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function decodeH05DataPlaneEvidenceJson(
  raw: string,
): H05DataPlaneEvidenceDecode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message: "Invalid H05 data-plane evidence: evidence must contain valid JSON.",
    };
  }
  const decoded = decodeH05DataPlaneEvidence(parsed);
  if (!decoded.ok) return decoded;
  if (raw !== serializeH05DataPlaneEvidence(decoded.value)) {
    return {
      ok: false,
      message:
        "Invalid H05 data-plane evidence: evidence must use canonical JSON serialization.",
    };
  }
  return decoded;
}

export function serializeH05DataPlaneEvidence(
  evidence: H05DataPlaneEvidence,
): string {
  const decoded = decodeH05DataPlaneEvidence(evidence);
  if (!decoded.ok) throw new Error(decoded.message);
  return formatH05JsonDocument(decoded.value);
}

export function serializeH05DataPlaneEvidencePayload(
  payload: H05DataPlaneEvidencePayload,
): string {
  const decoded = decodeH05DataPlaneEvidencePayload(payload);
  if (!decoded.ok) throw new Error(decoded.message);
  return formatH05JsonDocument(decoded.value);
}

export function serializeH05InvocationEvidence(
  evidence: H05InvocationEvidence,
): string {
  const decoded = decodeH05InvocationEvidence(evidence);
  if (!decoded.ok) throw new Error(decoded.message);
  return formatH05JsonDocument(decoded.value);
}

export function decodeH05HostedReceiptJson(
  raw: string,
): H05HostedReceiptDecode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message: "Invalid H05 hosted receipt: receipt must contain valid JSON.",
    };
  }
  const decoded = decodeH05HostedReceipt(parsed);
  if (!decoded.ok) return decoded;
  if (raw !== serializeH05HostedReceipt(decoded.value)) {
    return {
      ok: false,
      message:
        "Invalid H05 hosted receipt: receipt must use canonical JSON serialization.",
    };
  }
  return decoded;
}

export function serializeH05HostedReceipt(receipt: H05HostedReceipt): string {
  return formatH05JsonDocument(receipt);
}

function validateReceiptRelationships(receipt: H05HostedReceipt): void {
  const identity = h05ProofIdentity(receipt.run.runId);
  exactValue(
    receipt.run.deploymentId,
    identity.deploymentId,
    "run.deploymentId",
  );
  exactValue(receipt.run.projectId, identity.projectId, "run.projectId");

  orderedTimestamps(
    receipt.window.startedAt,
    receipt.window.finishedAt,
    "window",
  );
  timestampInWindow(
    receipt.dataPlane.window.startedAt,
    "dataPlane.window.startedAt",
    receipt.window,
  );
  timestampInWindow(
    receipt.dataPlane.window.finishedAt,
    "dataPlane.window.finishedAt",
    receipt.window,
  );
  timestampInWindow(
    receipt.hyperdrive.capturedAt,
    "hyperdrive.capturedAt",
    receipt.window,
  );
  timestampInWindow(
    receipt.executor.privacy.beforeCheckedAt,
    "executor.privacy.beforeCheckedAt",
    receipt.window,
  );
  timestampInWindow(
    receipt.executor.privacy.afterCheckedAt,
    "executor.privacy.afterCheckedAt",
    receipt.window,
  );
  timestampInWindow(
    receipt.trace.firstObservedAt,
    "trace.firstObservedAt",
    receipt.window,
  );
  timestampInWindow(
    receipt.trace.lastObservedAt,
    "trace.lastObservedAt",
    receipt.window,
  );
  timestampInWindow(
    receipt.trace.firstObservedAt,
    "trace.firstObservedAt",
    receipt.dataPlane.window,
  );
  timestampInWindow(
    receipt.trace.lastObservedAt,
    "trace.lastObservedAt",
    receipt.dataPlane.window,
  );
  orderedTimestamps(
    receipt.trace.firstObservedAt,
    receipt.trace.lastObservedAt,
    "trace",
  );
  timestampInWindow(
    receipt.cleanup.probe.checkedAt,
    "cleanup.probe.checkedAt",
    receipt.window,
  );
  orderedTimestamps(
    receipt.hyperdrive.capturedAt,
    receipt.trace.firstObservedAt,
    "hyperdrive-to-trace",
  );
  orderedTimestamps(
    receipt.executor.privacy.beforeCheckedAt,
    receipt.dataPlane.window.startedAt,
    "privacy-before-to-data-plane",
  );
  orderedTimestamps(
    receipt.dataPlane.window.finishedAt,
    receipt.executor.privacy.afterCheckedAt,
    "data-plane-to-privacy-after",
  );
  orderedTimestamps(
    receipt.executor.privacy.afterCheckedAt,
    receipt.cleanup.probe.checkedAt,
    "privacy-after-to-probe-cleanup",
  );
  orderedTimestamps(
    receipt.trace.lastObservedAt,
    receipt.cleanup.probe.checkedAt,
    "trace-to-probe-cleanup",
  );

  exactValue(
    receipt.cleanup.postgres.evidenceSha256,
    receipt.inputs.dataPlaneEvidenceSha256,
    "cleanup.postgres.evidenceSha256",
  );
  exactValue(
    receipt.cleanup.probe.evidenceSha256,
    receipt.inputs.probeTeardownEvidenceSha256,
    "cleanup.probe.evidenceSha256",
  );
  exactValue(
    receipt.trace.evidenceSha256,
    receipt.inputs.traceEvidenceSha256,
    "trace.evidenceSha256",
  );
  if (
    (receipt.cleanup.probe.deletionOutcome === "deleted" &&
      receipt.cleanup.probe.deletionStatus !== 200) ||
    (receipt.cleanup.probe.deletionOutcome === "already-absent" &&
      receipt.cleanup.probe.deletionStatus !== 404)
  ) {
    fail("cleanup.probe deletion outcome and status must agree.");
  }

  exactValue(
    receipt.executor.hyperdriveBinding.id,
    receipt.hyperdrive.id,
    "executor.hyperdriveBinding.id",
  );
  exactValue(
    receipt.trace.executorVersionId,
    receipt.executor.versionId,
    "trace.executorVersionId",
  );
  exactValue(
    receipt.trace.probeVersionId,
    receipt.probe.versionId,
    "trace.probeVersionId",
  );
  exactValue(
    receipt.trace.probePath,
    h05ProbeEndpoint(receipt.run.runId),
    "trace.probePath",
  );
  const controlPlaneIds = new Set([
    receipt.executor.deploymentId,
    receipt.executor.versionId,
    receipt.probe.deploymentId,
    receipt.probe.versionId,
  ]);
  if (controlPlaneIds.size !== 4) {
    fail("executor and probe deployment/version IDs must all be distinct.");
  }
  const inputHashes = new Set([
    receipt.inputs.controlPlaneBeforeEvidenceSha256,
    receipt.inputs.dataPlaneEvidenceSha256,
    receipt.inputs.controlPlaneAfterEvidenceSha256,
    receipt.inputs.probeTeardownEvidenceSha256,
    receipt.inputs.traceEvidenceSha256,
  ]);
  if (inputHashes.size !== 5) {
    fail("receipt input evidence hashes must all be distinct.");
  }
}

type H05DataPlaneEvidencePayloadDecode =
  | { readonly ok: true; readonly value: H05DataPlaneEvidencePayload }
  | { readonly ok: false; readonly message: string };

function decodeH05DataPlaneEvidencePayload(
  value: unknown,
): H05DataPlaneEvidencePayloadDecode {
  try {
    const payload = h05DataPlaneEvidencePayloadDecoder(value, "$");
    validateDataPlaneEvidencePayload(payload);
    return { ok: true, value: payload };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateDataPlaneEvidence(evidence: H05DataPlaneEvidence): void {
  const { evidenceSha256, ...payload } = evidence;
  validateDataPlaneEvidencePayload(payload);
  const actualSha256 = sha256(serializeH05DataPlaneEvidencePayload(payload));
  exactValue(evidenceSha256, actualSha256, "dataPlane.evidenceSha256");
}

function validateDataPlaneEvidencePayload(
  payload: H05DataPlaneEvidencePayload,
): void {
  const identity = h05ProofIdentity(payload.run.runId);
  exactValue(
    payload.run.deploymentId,
    identity.deploymentId,
    "dataPlane.run.deploymentId",
  );
  exactValue(
    payload.run.projectId,
    identity.projectId,
    "dataPlane.run.projectId",
  );
  orderedTimestamps(
    payload.window.startedAt,
    payload.window.finishedAt,
    "dataPlane.window",
  );
  validateInvocationReceipt(payload.invocation);
}

function validateInvocationReceipt(invocation: H05InvocationReceipt): void {
  validateInvocationRelationships(invocation);
  const { evidenceSha256, ...evidence } = invocation;
  const actualSha256 = sha256(serializeH05InvocationEvidence(evidence));
  exactValue(evidenceSha256, actualSha256, "invocation.evidenceSha256");
}

function sha256(value: string): string {
  return h05Sha256Utf8(value);
}

function validateInvocationRelationships(
  invocation: H05InvocationEvidence,
): void {
  const winnerTs = invocation.winner.committedTs;
  if (winnerTs <= h05SeedTimestamp) {
    fail("invocation.winner.committedTs must be greater than the seed timestamp.");
  }
  exactValue(
    invocation.stale.currentTs,
    winnerTs,
    "invocation.stale.currentTs",
  );
  const freshTs = invocation.fresh.committedTs;
  if (freshTs <= winnerTs) {
    fail("invocation.fresh.committedTs must be greater than the winner timestamp.");
  }
  exactValue(
    invocation.fresh.observedTs,
    winnerTs,
    "invocation.fresh.observedTs",
  );
  exactValue(
    invocation.fresh.previousTs,
    winnerTs,
    "invocation.fresh.previousTs",
  );
  exactValue(
    invocation.sql.finalTs,
    freshTs,
    "invocation.sql.finalTs",
  );
  exactValue(
    invocation.sql.finalPrevTs,
    winnerTs,
    "invocation.sql.finalPrevTs",
  );
}

function object<const Shape extends Readonly<Record<string, Decoder<unknown>>>>(
  shape: Shape,
): Decoder<ObjectOutput<Shape>> {
  return (value, path) => {
    if (!isRecord(value)) fail(`${path} must be an object.`);
    const actualKeys = Object.keys(value).sort();
    const expectedKeys = Object.keys(shape).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
      const unknown = actualKeys.filter((key) => !expectedKeys.includes(key));
      fail(
        `${path} has invalid keys (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}).`,
      );
    }

    const output: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const decoder = shape[key];
      if (decoder === undefined) fail(`${path}.${key} has no decoder.`);
      output[key] = decoder(value[key], path === "$" ? key : `${path}.${key}`);
    }
    return output as ObjectOutput<Shape>;
  };
}

function tuple<const Shape extends readonly Decoder<unknown>[]>(
  shape: Shape,
): Decoder<TupleOutput<Shape>> {
  return (value, path) => {
    if (!Array.isArray(value) || value.length !== shape.length) {
      fail(`${path} must contain exactly ${shape.length} item(s).`);
    }
    return shape.map((decoder, index) =>
      decoder(value[index], `${path}[${index}]`),
    ) as TupleOutput<Shape>;
  };
}

function literal<const Value extends string | number | boolean>(
  expected: Value,
): Decoder<Value> {
  return (value, path) => {
    exactValue(value, expected, path);
    return expected;
  };
}

function literalUnion<
  const Values extends readonly (string | number | boolean)[],
>(values: Values): Decoder<Values[number]> {
  return (value, path) => {
    if (!values.some((candidate) => candidate === value)) {
      fail(
        `${path} must equal one of: ${values.map((candidate) => JSON.stringify(candidate)).join(", ")}.`,
      );
    }
    return value as Values[number];
  };
}

function positiveSafeIntegerInRangeDecoder(
  minimum: number,
  maximum: number,
): Decoder<number> {
  return (value, path) => {
    if (
      !isPositiveSafeInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      fail(`${path} must be a safe integer from ${minimum} through ${maximum}.`);
    }
    return value;
  };
}

function nonEmptyString(value: unknown, path: string): string {
  return decodeNonEmptyH05String(value, path, fail);
}

function patternString(pattern: RegExp): Decoder<string> {
  return (value, path) => {
    const decoded = nonEmptyString(value, path);
    if (!pattern.test(decoded)) fail(`${path} has an invalid format.`);
    return decoded;
  };
}

function h05ProofRunIdDecoder(
  value: unknown,
  path: string,
): H05ProofRunId {
  const decoded = decodeH05ProofRunId(nonEmptyString(value, path));
  if (!decoded.ok) fail(`${path}: ${decoded.message}`);
  return decoded.value;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!isPositiveSafeInteger(value)) {
    fail(`${path} must be a positive safe integer.`);
  }
  return value;
}

function isoTimestampDecoder(value: unknown, path: string): IsoTimestamp {
  const decoded = nonEmptyString(value, path);
  if (!isH05CanonicalIsoTimestamp(decoded)) {
    fail(`${path} must be a canonical UTC ISO timestamp.`);
  }
  return decoded as IsoTimestamp;
}

function h05ProbeOriginDecoder(value: unknown, path: string): string {
  const decoded = nonEmptyString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(decoded);
  } catch {
    fail(`${path} must be a valid HTTPS origin.`);
  }
  if (!isH05HttpsOriginUrl(parsed)) {
    fail(`${path} must be an HTTPS origin without credentials, path, query, or fragment.`);
  }
  if (
    !parsed.hostname.startsWith(`${h05ProbeWorkerName}.`) ||
    !parsed.hostname.endsWith(".workers.dev")
  ) {
    fail(`${path} must be the H05 probe's workers.dev origin.`);
  }
  return parsed.origin;
}

function exactValue<Value extends string | number | boolean>(
  value: unknown,
  expected: Value,
  path: string,
): void {
  decodeExactH05Scalar(value, expected, path, fail);
}

function timestampInWindow(
  value: IsoTimestamp,
  path: string,
  window: H05HostedReceipt["window"],
): void {
  const timestamp = Date.parse(value);
  if (
    timestamp < Date.parse(window.startedAt) ||
    timestamp > Date.parse(window.finishedAt)
  ) {
    fail(`${path} must fall inside the receipt window.`);
  }
}

function orderedTimestamps(
  first: IsoTimestamp,
  second: IsoTimestamp,
  path: string,
): void {
  requireOrderedH05Timestamps(first, second, path, fail);
}

function fail(message: string): never {
  throw new Error(`Invalid H05 hosted receipt: ${message}`);
}
