import {
  decodeH05ProofRunId,
  h05ProofIdentity,
  type H05ProofRunId,
} from "./h05ProofIdentity";

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

export const h05HostedReceiptFormat = "flarex-h05-hosted-receipt-v1";
export const h05ExecutorWorkerName = "flarex-executor";
export const h05ProbeWorkerName = "flarex-executor-h05-probe";
export const h05ExecutorCompatibilityDate = "2026-06-14";
export const h05AuthorizedInvocationCount = 14;
export const h05UnauthorizedInvocationCount = 1;

const h05ExecutorTokenName = "FLAREX_EXECUTOR_TOKEN";
const h05HyperdriveBindingName = "HYPERDRIVE_CACHE_DISABLED";
const h05ProbeRunIdName = "FLAREX_H05_RUN_ID";
const h05ProbeTokenName = "FLAREX_H05_PROBE_TOKEN";
const h05ServiceBindingName = "FLAREX_EXECUTOR";
const h05HopHeader = "x-flarex-h05-hop";
const h05HopValue = "probe-to-executor";
const h05SeedTimestamp = 10;

const sha256Decoder = nonPlaceholderBrandedPattern<Sha256>(/^[a-f0-9]{64}$/);
const gitCommitDecoder = nonPlaceholderBrandedPattern<GitCommit>(
  /^[a-f0-9]{40}$/,
);
const cloudflareResourceIdDecoder: Decoder<CloudflareResourceId> = (
  value,
  path,
) => {
  const decoded = nonEmptyString(value, path);
  if (
    decoded.length < 8 ||
    decoded.length > 128 ||
    /[\u0000-\u0020\u007f]/.test(decoded)
  ) {
    fail(`${path} must be a bounded opaque Cloudflare identifier.`);
  }
  return decoded as CloudflareResourceId;
};
const hyperdriveIdDecoder = nonPlaceholderPattern(/^[a-f0-9]{32}$/);
const hyperdriveNameDecoder = patternString(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const wranglerVersionDecoder = patternString(
  /^4\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
);

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
  window: object({
    startedAt: isoTimestampDecoder,
    finishedAt: isoTimestampDecoder,
  }),
  run: object({
    runId: h05ProofRunIdDecoder,
    deploymentId: nonEmptyString,
    projectId: nonEmptyString,
  }),
  hyperdrive: object({
    source: literal("wrangler-hyperdrive-get"),
    id: hyperdriveIdDecoder,
    name: hyperdriveNameDecoder,
    cachingDisabled: literal(true),
    originHostSha256: sha256Decoder,
    originDatabaseSha256: sha256Decoder,
    tls: literal("require-or-stronger"),
    capturedAt: isoTimestampDecoder,
    evidenceSha256: sha256Decoder,
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
      routeTargets: tuple([]),
      customDomainTargets: tuple([]),
      directPublicRequest: literal("unreachable"),
      checkedAt: isoTimestampDecoder,
      evidenceSha256: sha256Decoder,
    }),
    deploymentEvidenceSha256: sha256Decoder,
    versionEvidenceSha256: sha256Decoder,
    secretsEvidenceSha256: sha256Decoder,
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
    deploymentEvidenceSha256: sha256Decoder,
    versionEvidenceSha256: sha256Decoder,
    secretsEvidenceSha256: sha256Decoder,
  }),
  invocation: object({
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
    evidenceSha256: sha256Decoder,
  }),
  trace: object({
    source: literal("cloudflare-observability-api"),
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
    source: literal("cloudflare-api-and-postgres"),
    proofRowsRemaining: literal(0),
    probeDeleted: literal(true),
    probeLookupStatus: literal(404),
    probePublicRequest: literal("unreachable"),
    checkedAt: isoTimestampDecoder,
    evidenceSha256: sha256Decoder,
  }),
});

export type H05HostedReceipt = DecoderOutput<typeof receiptDecoder>;

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
  return `${JSON.stringify(receipt, null, 2)}\n`;
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
    receipt.hyperdrive.capturedAt,
    "hyperdrive.capturedAt",
    receipt.window,
  );
  timestampInWindow(
    receipt.executor.privacy.checkedAt,
    "executor.privacy.checkedAt",
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
  orderedTimestamps(
    receipt.trace.firstObservedAt,
    receipt.trace.lastObservedAt,
    "trace",
  );
  timestampInWindow(
    receipt.cleanup.checkedAt,
    "cleanup.checkedAt",
    receipt.window,
  );
  orderedTimestamps(
    receipt.hyperdrive.capturedAt,
    receipt.trace.firstObservedAt,
    "hyperdrive-to-trace",
  );
  orderedTimestamps(
    receipt.executor.privacy.checkedAt,
    receipt.trace.firstObservedAt,
    "privacy-to-trace",
  );
  orderedTimestamps(
    receipt.trace.lastObservedAt,
    receipt.cleanup.checkedAt,
    "trace-to-cleanup",
  );

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
  const controlPlaneIds = new Set([
    receipt.executor.deploymentId,
    receipt.executor.versionId,
    receipt.probe.deploymentId,
    receipt.probe.versionId,
  ]);
  if (controlPlaneIds.size !== 4) {
    fail("executor and probe deployment/version IDs must all be distinct.");
  }

  const winnerTs = receipt.invocation.winner.committedTs;
  if (winnerTs <= h05SeedTimestamp) {
    fail("invocation.winner.committedTs must be greater than the seed timestamp.");
  }
  exactValue(
    receipt.invocation.stale.currentTs,
    winnerTs,
    "invocation.stale.currentTs",
  );
  const freshTs = receipt.invocation.fresh.committedTs;
  if (freshTs <= winnerTs) {
    fail("invocation.fresh.committedTs must be greater than the winner timestamp.");
  }
  exactValue(
    receipt.invocation.fresh.observedTs,
    winnerTs,
    "invocation.fresh.observedTs",
  );
  exactValue(
    receipt.invocation.fresh.previousTs,
    winnerTs,
    "invocation.fresh.previousTs",
  );
  exactValue(
    receipt.invocation.sql.finalTs,
    freshTs,
    "invocation.sql.finalTs",
  );
  exactValue(
    receipt.invocation.sql.finalPrevTs,
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

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${path} must be a non-empty string.`);
  }
  return value;
}

function patternString(pattern: RegExp): Decoder<string> {
  return (value, path) => {
    const decoded = nonEmptyString(value, path);
    if (!pattern.test(decoded)) fail(`${path} has an invalid format.`);
    return decoded;
  };
}

function nonPlaceholderPattern(pattern: RegExp): Decoder<string> {
  const decode = patternString(pattern);
  return (value, path) => {
    const decoded = decode(value, path);
    if (/^0+$/.test(decoded)) {
      fail(`${path} must not use an all-zero placeholder.`);
    }
    return decoded;
  };
}

function nonPlaceholderBrandedPattern<Brand extends string>(
  pattern: RegExp,
): Decoder<Brand> {
  const decode = nonPlaceholderPattern(pattern);
  return (value, path) => decode(value, path) as Brand;
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
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail(`${path} must be a positive safe integer.`);
  }
  return value;
}

function isoTimestampDecoder(value: unknown, path: string): IsoTimestamp {
  const decoded = nonEmptyString(value, path);
  const parsed = Date.parse(decoded);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== decoded) {
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
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
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
  if (value !== expected) {
    fail(`${path} must equal ${JSON.stringify(expected)}.`);
  }
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
  if (Date.parse(first) > Date.parse(second)) {
    fail(`${path} timestamps are out of order.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`Invalid H05 hosted receipt: ${message}`);
}
