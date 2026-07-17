import { createHash } from "node:crypto";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";

import { decodeExactH05Scalar } from "./exactScalar";
import { decodeExactH05StringTuple } from "./exactStringTuple";
import { formatH05JsonDocument } from "./jsonDocument";
import {
  decodeH05ProofRunId,
  h05ProofIdentity,
  type H05ProofIdentity,
} from "./proofIdentity";
import { isH05LowercaseSha256Digest } from "./sha256";
import { requireOrderedH05Timestamps } from "./timestampOrder";
import {
  h05ExecutorCompatibilityDate,
  h05ExecutorTokenName,
  h05ExecutorWorkerName,
  h05HyperdriveBindingName,
  h05ProbeRunIdName,
  h05ProbeTokenName,
  h05ProbeWorkerName,
  h05ServiceBindingName,
} from "./receipt";

export const h05ControlPlaneEvidenceFormat =
  "flarex-h05-control-plane-evidence-v1";

export const h05ZoneTypes = [
  "full",
  "partial",
  "secondary",
  "internal",
] as const;

export const h05MaximumZonePages = 200;

export interface H05ControlPlaneSourceEvidence {
  readonly commit: string;
  readonly worktreeClean: true;
  readonly wranglerVersion: string;
}

export type H05ControlPlaneRunEvidence = Pick<
  H05ProofIdentity,
  "deploymentId" | "projectId" | "runId"
>;

export interface H05ControlPlaneWindowEvidence {
  readonly finishedAt: string;
  readonly startedAt: string;
}

export interface H05AccountWorkersSubdomainEvidence {
  readonly closing: string;
  readonly opening: string;
}

export interface H05DeploymentEvidence {
  readonly deploymentId: string;
  readonly observedAt: string;
  readonly trafficPercentage: 100;
  readonly versionId: string;
}

export type H05BindingEvidence =
  | {
      readonly id: string;
      readonly name: string;
      readonly type: "hyperdrive";
    }
  | {
      readonly name: string;
      readonly type: "secret_text";
    }
  | {
      readonly name: string;
      readonly service: string;
      readonly type: "service";
    };

export interface H05TraceSettingsEvidence {
  readonly enabled: true;
  readonly persisted: true;
  readonly samplingRate: 1;
}

interface H05WorkerVersionEvidenceBase {
  readonly compatibilityDate: string;
  readonly scriptTraceSettings: H05TraceSettingsEvidence;
  readonly settingsBindings: readonly H05BindingEvidence[];
  readonly settingsTraceSettings: H05TraceSettingsEvidence;
  readonly versionBindings: readonly H05BindingEvidence[];
  readonly versionId: string;
}

export interface H05ExecutorWorkerVersionEvidence
  extends H05WorkerVersionEvidenceBase {
  readonly compatibilityFlags: readonly ["nodejs_compat"];
  readonly placementMode: "smart";
}

export interface H05ProbeWorkerVersionEvidence
  extends H05WorkerVersionEvidenceBase {
  readonly compatibilityFlags: readonly [];
  readonly placementMode: "none";
}

export type H05WorkerVersionEvidence =
  | H05ExecutorWorkerVersionEvidence
  | H05ProbeWorkerVersionEvidence;

export interface H05SecretEvidence {
  readonly name: string;
  readonly type: "secret_text";
}

export interface H05SubdomainEvidence {
  readonly enabled: boolean;
  readonly previewsEnabled: boolean;
}

export interface H05ExecutorPrivacySnapshotEvidence {
  readonly checkedAt: string;
  readonly customDomains: {
    readonly filteredCount: 0;
    readonly page: 1;
    readonly totalPages: 0 | 1;
    readonly unfilteredTotalCount: number;
  };
  readonly directRequest: { readonly status: 404 };
  readonly routes: {
    readonly checkedZoneIds: readonly string[];
    readonly inspectedRouteCount: number;
    readonly targetRouteCount: 0;
  };
  readonly zones: {
    readonly pageCount: number;
    readonly requestedTypes: typeof h05ZoneTypes;
    readonly unfilteredTotalCount: number;
    readonly zoneIds: readonly string[];
  };
}

export interface H05ExecutorPrivacyEvidence {
  readonly closing: H05ExecutorPrivacySnapshotEvidence;
  readonly opening: H05ExecutorPrivacySnapshotEvidence;
  readonly tokenScopeAttestation: "operator-attested-all-account-zones";
}

export interface H05WorkerControlPlaneSnapshotEvidence<
  Version extends H05WorkerVersionEvidence,
> {
  readonly secrets: readonly H05SecretEvidence[];
  readonly subdomain: H05SubdomainEvidence;
  readonly version: Version;
}

export type H05ExecutorWorkerControlPlaneSnapshotEvidence =
  H05WorkerControlPlaneSnapshotEvidence<H05ExecutorWorkerVersionEvidence>;

export type H05ProbeWorkerControlPlaneSnapshotEvidence =
  H05WorkerControlPlaneSnapshotEvidence<H05ProbeWorkerVersionEvidence>;

export interface H05ExecutorControlPlaneEvidence {
  readonly closing: H05ExecutorWorkerControlPlaneSnapshotEvidence;
  readonly deploymentAfter: H05DeploymentEvidence;
  readonly deploymentBefore: H05DeploymentEvidence;
  readonly opening: H05ExecutorWorkerControlPlaneSnapshotEvidence;
  readonly privacy: H05ExecutorPrivacyEvidence;
}

export interface H05ProbeControlPlaneEvidence {
  readonly closing: H05ProbeWorkerControlPlaneSnapshotEvidence;
  readonly deploymentAfter: H05DeploymentEvidence;
  readonly deploymentBefore: H05DeploymentEvidence;
  readonly opening: H05ProbeWorkerControlPlaneSnapshotEvidence;
  readonly publicOrigin: string;
}

export interface H05HyperdriveSnapshotEvidence {
  readonly cachingDisabled: true;
  readonly capturedAt: string;
  readonly id: string;
  readonly name: string;
  readonly originDatabaseSha256: string;
  readonly originHostSha256: string;
  readonly originPort: number;
  readonly originScheme: "postgres" | "postgresql";
  readonly tlsMode: "require" | "verify-ca" | "verify-full";
}

export interface H05HyperdriveControlPlaneEvidence {
  readonly closing: H05HyperdriveSnapshotEvidence;
  readonly opening: H05HyperdriveSnapshotEvidence;
}

export interface H05ControlPlaneEvidencePayload {
  readonly accountIdSha256: string;
  readonly accountWorkersSubdomain: H05AccountWorkersSubdomainEvidence;
  readonly executor: H05ExecutorControlPlaneEvidence;
  readonly format: typeof h05ControlPlaneEvidenceFormat;
  readonly hyperdrive: H05HyperdriveControlPlaneEvidence;
  readonly probe: H05ProbeControlPlaneEvidence;
  readonly run: H05ControlPlaneRunEvidence;
  readonly source: H05ControlPlaneSourceEvidence;
  readonly window: H05ControlPlaneWindowEvidence;
}

export interface H05ControlPlaneEvidence
  extends H05ControlPlaneEvidencePayload {
  readonly evidenceSha256: string;
}

export type H05ControlPlaneEvidenceDecode =
  | { readonly ok: true; readonly value: H05ControlPlaneEvidence }
  | { readonly ok: false; readonly message: string };

type H05ControlPlanePayloadDecode =
  | { readonly ok: true; readonly value: H05ControlPlaneEvidencePayload }
  | { readonly ok: false; readonly message: string };

export function compileH05ControlPlaneEvidence(
  value: unknown,
): H05ControlPlaneEvidenceDecode {
  const payload = decodeH05ControlPlaneEvidencePayload(value);
  if (!payload.ok) return payload;
  return decodeH05ControlPlaneEvidence({
    ...payload.value,
    evidenceSha256: sha256(serializeH05ControlPlanePayload(payload.value)),
  });
}

export function h05CloudflareAccountIdSha256(accountId: string): string {
  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters.",
    );
  }
  return sha256(`flarex-h05-cloudflare-account-id-v1\0${accountId}`);
}

export function h05SourceEvidenceSha256(
  source: H05ControlPlaneSourceEvidence,
): string {
  const decoded = decodeSource(source, "source");
  return sha256(
    `flarex-h05-source-evidence-v1\0${formatH05JsonDocument(decoded)}`,
  );
}

export function decodeH05ControlPlaneEvidence(
  value: unknown,
): H05ControlPlaneEvidenceDecode {
  try {
    const record = exactRecord(value, "$", [
      "accountIdSha256",
      "accountWorkersSubdomain",
      "evidenceSha256",
      "executor",
      "format",
      "hyperdrive",
      "probe",
      "run",
      "source",
      "window",
    ]);
    const payload = decodePayloadRecord(record);
    const evidenceSha256 = sha256String(
      record.evidenceSha256,
      "evidenceSha256",
    );
    const expected = sha256(serializeH05ControlPlanePayload(payload));
    if (evidenceSha256 !== expected) {
      fail("evidenceSha256 does not match the canonical payload.");
    }
    return { ok: true, value: { ...payload, evidenceSha256 } };
  } catch (error) {
    return decodeFailure(error);
  }
}

export function decodeH05ControlPlaneEvidenceJson(
  raw: string,
): H05ControlPlaneEvidenceDecode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message: "Invalid H05 control-plane evidence: artifact must contain valid JSON.",
    };
  }
  const decoded = decodeH05ControlPlaneEvidence(parsed);
  if (!decoded.ok) return decoded;
  if (raw !== serializeH05ControlPlaneEvidence(decoded.value)) {
    return {
      ok: false,
      message:
        "Invalid H05 control-plane evidence: artifact must use canonical JSON serialization.",
    };
  }
  return decoded;
}

export function serializeH05ControlPlaneEvidence(
  evidence: H05ControlPlaneEvidence,
): string {
  const decoded = decodeH05ControlPlaneEvidence(evidence);
  if (!decoded.ok) throw new Error(decoded.message);
  return formatH05JsonDocument(decoded.value);
}

export function serializeH05ControlPlanePayload(
  payload: H05ControlPlaneEvidencePayload,
): string {
  const decoded = decodeH05ControlPlaneEvidencePayload(payload);
  if (!decoded.ok) throw new Error(decoded.message);
  return formatH05JsonDocument(decoded.value);
}

function decodeH05ControlPlaneEvidencePayload(
  value: unknown,
): H05ControlPlanePayloadDecode {
  try {
    const record = exactRecord(value, "$", [
      "accountIdSha256",
      "accountWorkersSubdomain",
      "executor",
      "format",
      "hyperdrive",
      "probe",
      "run",
      "source",
      "window",
    ]);
    return { ok: true, value: decodePayloadRecord(record) };
  } catch (error) {
    return decodeFailure(error);
  }
}

function decodePayloadRecord(
  record: Readonly<Record<string, unknown>>,
): H05ControlPlaneEvidencePayload {
  literal(record.format, h05ControlPlaneEvidenceFormat, "format");
  const accountIdSha256 = sha256String(
    record.accountIdSha256,
    "accountIdSha256",
  );
  const source = decodeSource(record.source, "source");
  const run = decodeRun(record.run, "run");
  const window = decodeWindow(record.window, "window");
  const accountWorkersSubdomain = decodeAccountWorkersSubdomain(
    record.accountWorkersSubdomain,
    "accountWorkersSubdomain",
  );
  const hyperdrive = decodeHyperdrive(record.hyperdrive, "hyperdrive");
  const executor = decodeExecutor(
    record.executor,
    "executor",
    hyperdrive.opening.id,
  );
  const probe = decodeProbe(
    record.probe,
    "probe",
    accountWorkersSubdomain.opening,
  );

  assertTimestampOrder(window.startedAt, window.finishedAt, "window");
  for (const [path, timestamp] of [
    ["hyperdrive.opening.capturedAt", hyperdrive.opening.capturedAt],
    ["hyperdrive.closing.capturedAt", hyperdrive.closing.capturedAt],
    ["executor.deploymentBefore.observedAt", executor.deploymentBefore.observedAt],
    ["executor.deploymentAfter.observedAt", executor.deploymentAfter.observedAt],
    ["executor.privacy.opening.checkedAt", executor.privacy.opening.checkedAt],
    ["executor.privacy.closing.checkedAt", executor.privacy.closing.checkedAt],
    ["probe.deploymentBefore.observedAt", probe.deploymentBefore.observedAt],
    ["probe.deploymentAfter.observedAt", probe.deploymentAfter.observedAt],
  ] as const) {
    assertTimestampInWindow(timestamp, window, path);
  }
  assertTimestampOrder(
    executor.deploymentBefore.observedAt,
    executor.deploymentAfter.observedAt,
    "executor deployment fence",
  );
  assertTimestampOrder(
    probe.deploymentBefore.observedAt,
    probe.deploymentAfter.observedAt,
    "probe deployment fence",
  );
  for (const [first, second, path] of [
    [
      window.startedAt,
      hyperdrive.opening.capturedAt,
      "window start to opening Hyperdrive capture",
    ],
    [
      hyperdrive.opening.capturedAt,
      executor.deploymentBefore.observedAt,
      "Hyperdrive capture to executor deployment fence",
    ],
    [
      executor.deploymentBefore.observedAt,
      probe.deploymentBefore.observedAt,
      "executor to probe deployment fence",
    ],
    [
      probe.deploymentBefore.observedAt,
      executor.privacy.opening.checkedAt,
      "probe deployment fence to executor privacy check",
    ],
    [
      executor.privacy.opening.checkedAt,
      executor.privacy.closing.checkedAt,
      "executor privacy opening to closing sweep",
    ],
    [
      executor.privacy.closing.checkedAt,
      executor.deploymentAfter.observedAt,
      "executor privacy check to deployment fence",
    ],
    [
      executor.deploymentAfter.observedAt,
      probe.deploymentAfter.observedAt,
      "executor to probe closing deployment fence",
    ],
    [
      probe.deploymentAfter.observedAt,
      hyperdrive.closing.capturedAt,
      "closing deployment fence to Hyperdrive capture",
    ],
    [
      hyperdrive.closing.capturedAt,
      window.finishedAt,
      "closing Hyperdrive capture to window end",
    ],
  ] as const) {
    assertTimestampOrder(first, second, path);
  }
  return {
    format: h05ControlPlaneEvidenceFormat,
    accountIdSha256,
    source,
    window,
    run,
    accountWorkersSubdomain,
    hyperdrive,
    executor,
    probe,
  };
}

function decodeAccountWorkersSubdomain(
  value: unknown,
  path: string,
): H05AccountWorkersSubdomainEvidence {
  const record = exactRecord(value, path, ["closing", "opening"]);
  const opening = patternString(
    record.opening,
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    `${path}.opening`,
  );
  const closing = patternString(
    record.closing,
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    `${path}.closing`,
  );
  if (opening !== closing) {
    fail(`${path} changed during collection.`);
  }
  return { opening, closing };
}

function decodeSource(value: unknown, path: string): H05ControlPlaneSourceEvidence {
  const record = exactRecord(value, path, [
    "commit",
    "worktreeClean",
    "wranglerVersion",
  ]);
  literal(record.worktreeClean, true, `${path}.worktreeClean`);
  return {
    commit: patternString(record.commit, /^[a-f0-9]{40}$/, `${path}.commit`),
    worktreeClean: true,
    wranglerVersion: patternString(
      record.wranglerVersion,
      /^4\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `${path}.wranglerVersion`,
    ),
  };
}

function decodeRun(value: unknown, path: string): H05ControlPlaneRunEvidence {
  const record = exactRecord(value, path, [
    "deploymentId",
    "projectId",
    "runId",
  ]);
  const runId = decodeH05ProofRunId(nonEmptyString(record.runId, `${path}.runId`));
  if (!runId.ok) fail(`${path}.runId: ${runId.message}`);
  const identity = h05ProofIdentity(runId.value);
  const deploymentId = nonEmptyString(record.deploymentId, `${path}.deploymentId`);
  const projectId = nonEmptyString(record.projectId, `${path}.projectId`);
  if (deploymentId !== identity.deploymentId || projectId !== identity.projectId) {
    fail(`${path} does not match its derived H05 proof identity.`);
  }
  return { runId: runId.value, deploymentId, projectId };
}

function decodeWindow(
  value: unknown,
  path: string,
): H05ControlPlaneWindowEvidence {
  const record = exactRecord(value, path, ["finishedAt", "startedAt"]);
  return {
    startedAt: isoTimestamp(record.startedAt, `${path}.startedAt`),
    finishedAt: isoTimestamp(record.finishedAt, `${path}.finishedAt`),
  };
}

function decodeHyperdrive(
  value: unknown,
  path: string,
): H05HyperdriveControlPlaneEvidence {
  const record = exactRecord(value, path, ["closing", "opening"]);
  const opening = decodeHyperdriveSnapshot(record.opening, `${path}.opening`);
  const closing = decodeHyperdriveSnapshot(record.closing, `${path}.closing`);
  assertTimestampOrder(
    opening.capturedAt,
    closing.capturedAt,
    `${path} opening and closing captures`,
  );
  if (
    hyperdriveSnapshotFingerprint(opening) !==
    hyperdriveSnapshotFingerprint(closing)
  ) {
    fail(`${path} changed between its opening and closing captures.`);
  }
  return { opening, closing };
}

function decodeHyperdriveSnapshot(
  value: unknown,
  path: string,
): H05HyperdriveSnapshotEvidence {
  const record = exactRecord(value, path, [
    "cachingDisabled",
    "capturedAt",
    "id",
    "name",
    "originDatabaseSha256",
    "originHostSha256",
    "originPort",
    "originScheme",
    "tlsMode",
  ]);
  literal(record.cachingDisabled, true, `${path}.cachingDisabled`);
  const originScheme = oneOf(
    record.originScheme,
    ["postgres", "postgresql"] as const,
    `${path}.originScheme`,
  );
  const tlsMode = oneOf(
    record.tlsMode,
    ["require", "verify-ca", "verify-full"] as const,
    `${path}.tlsMode`,
  );
  return {
    id: patternString(record.id, /^[a-f0-9]{32}$/, `${path}.id`),
    name: patternString(
      record.name,
      /^[a-z0-9][a-z0-9_-]{0,62}$/,
      `${path}.name`,
    ),
    originScheme,
    originPort: positiveSafeIntegerInRange(
      record.originPort,
      1,
      65_535,
      `${path}.originPort`,
    ),
    cachingDisabled: true,
    tlsMode,
    originHostSha256: sha256String(
      record.originHostSha256,
      `${path}.originHostSha256`,
    ),
    originDatabaseSha256: sha256String(
      record.originDatabaseSha256,
      `${path}.originDatabaseSha256`,
    ),
    capturedAt: isoTimestamp(record.capturedAt, `${path}.capturedAt`),
  };
}

function hyperdriveSnapshotFingerprint(
  value: H05HyperdriveSnapshotEvidence,
): string {
  return JSON.stringify({
    id: value.id,
    name: value.name,
    originScheme: value.originScheme,
    originPort: value.originPort,
    cachingDisabled: value.cachingDisabled,
    tlsMode: value.tlsMode,
    originHostSha256: value.originHostSha256,
    originDatabaseSha256: value.originDatabaseSha256,
  });
}

function decodeExecutor(
  value: unknown,
  path: string,
  hyperdriveId: string,
): H05ExecutorControlPlaneEvidence {
  const record = exactRecord(value, path, [
    "closing",
    "deploymentAfter",
    "deploymentBefore",
    "opening",
    "privacy",
  ]);
  const deploymentBefore = decodeDeployment(
    record.deploymentBefore,
    `${path}.deploymentBefore`,
  );
  const deploymentAfter = decodeDeployment(
    record.deploymentAfter,
    `${path}.deploymentAfter`,
  );
  assertStableDeployment(deploymentBefore, deploymentAfter, path);
  const opening = decodeExecutorWorkerSnapshot(
    record.opening,
    `${path}.opening`,
    hyperdriveId,
  );
  const closing = decodeExecutorWorkerSnapshot(
    record.closing,
    `${path}.closing`,
    hyperdriveId,
  );
  assertStableWorkerSnapshot(opening, closing, path);
  if (
    opening.version.versionId !== deploymentBefore.versionId ||
    closing.version.versionId !== deploymentBefore.versionId
  ) {
    fail(`${path} Worker snapshots do not match the active deployment.`);
  }
  return {
    deploymentBefore,
    opening,
    privacy: decodePrivacy(record.privacy, `${path}.privacy`),
    closing,
    deploymentAfter,
  };
}

function decodeProbe(
  value: unknown,
  path: string,
  accountWorkersSubdomain: string,
): H05ProbeControlPlaneEvidence {
  const record = exactRecord(value, path, [
    "closing",
    "deploymentAfter",
    "deploymentBefore",
    "opening",
    "publicOrigin",
  ]);
  const deploymentBefore = decodeDeployment(
    record.deploymentBefore,
    `${path}.deploymentBefore`,
  );
  const deploymentAfter = decodeDeployment(
    record.deploymentAfter,
    `${path}.deploymentAfter`,
  );
  assertStableDeployment(deploymentBefore, deploymentAfter, path);
  const opening = decodeProbeWorkerSnapshot(record.opening, `${path}.opening`);
  const closing = decodeProbeWorkerSnapshot(record.closing, `${path}.closing`);
  assertStableWorkerSnapshot(opening, closing, path);
  if (
    opening.version.versionId !== deploymentBefore.versionId ||
    closing.version.versionId !== deploymentBefore.versionId
  ) {
    fail(`${path} Worker snapshots do not match the active deployment.`);
  }
  const publicOrigin = httpsOrigin(record.publicOrigin, `${path}.publicOrigin`);
  const expectedOrigin =
    `https://${h05ProbeWorkerName}.${accountWorkersSubdomain}.workers.dev`;
  if (publicOrigin !== expectedOrigin) {
    fail(`${path}.publicOrigin does not match the account Workers subdomain.`);
  }
  return {
    deploymentBefore,
    opening,
    publicOrigin,
    closing,
    deploymentAfter,
  };
}

function decodeExecutorWorkerSnapshot(
  value: unknown,
  path: string,
  hyperdriveId: string,
): H05ExecutorWorkerControlPlaneSnapshotEvidence {
  const record = exactRecord(value, path, ["secrets", "subdomain", "version"]);
  const version = decodeVersion(record.version, `${path}.version`, "executor");
  assertBindings(
    version,
    [
      { type: "hyperdrive", name: h05HyperdriveBindingName, id: hyperdriveId },
      { type: "secret_text", name: h05ExecutorTokenName },
    ],
    `${path}.version`,
  );
  const subdomain = decodeSubdomain(record.subdomain, `${path}.subdomain`);
  if (subdomain.enabled || subdomain.previewsEnabled) {
    fail(`${path} must disable workers.dev and preview URLs.`);
  }
  return {
    version,
    secrets: decodeSecrets(record.secrets, `${path}.secrets`, [
      h05ExecutorTokenName,
    ]),
    subdomain,
  };
}

function decodeProbeWorkerSnapshot(
  value: unknown,
  path: string,
): H05ProbeWorkerControlPlaneSnapshotEvidence {
  const record = exactRecord(value, path, ["secrets", "subdomain", "version"]);
  const version = decodeVersion(record.version, `${path}.version`, "probe");
  assertBindings(
    version,
    [
      {
        type: "service",
        name: h05ServiceBindingName,
        service: h05ExecutorWorkerName,
      },
      { type: "secret_text", name: h05ExecutorTokenName },
      { type: "secret_text", name: h05ProbeRunIdName },
      { type: "secret_text", name: h05ProbeTokenName },
    ],
    `${path}.version`,
  );
  const subdomain = decodeSubdomain(record.subdomain, `${path}.subdomain`);
  if (!subdomain.enabled || subdomain.previewsEnabled) {
    fail(`${path} must enable workers.dev and disable preview URLs.`);
  }
  return {
    version,
    secrets: decodeSecrets(record.secrets, `${path}.secrets`, [
      h05ExecutorTokenName,
      h05ProbeRunIdName,
      h05ProbeTokenName,
    ]),
    subdomain,
  };
}

function assertStableWorkerSnapshot(
  opening:
    | H05ExecutorWorkerControlPlaneSnapshotEvidence
    | H05ProbeWorkerControlPlaneSnapshotEvidence,
  closing:
    | H05ExecutorWorkerControlPlaneSnapshotEvidence
    | H05ProbeWorkerControlPlaneSnapshotEvidence,
  path: string,
): void {
  const fingerprint = (
    snapshot:
      | H05ExecutorWorkerControlPlaneSnapshotEvidence
      | H05ProbeWorkerControlPlaneSnapshotEvidence,
  ) =>
    JSON.stringify({
      version: snapshot.version,
      secrets: snapshot.secrets,
      subdomain: snapshot.subdomain,
    });
  if (fingerprint(opening) !== fingerprint(closing)) {
    fail(`${path} changed between its opening and closing Worker snapshots.`);
  }
}

function decodeDeployment(value: unknown, path: string): H05DeploymentEvidence {
  const record = exactRecord(value, path, [
    "deploymentId",
    "observedAt",
    "trafficPercentage",
    "versionId",
  ]);
  literal(record.trafficPercentage, 100, `${path}.trafficPercentage`);
  return {
    deploymentId: cloudflareId(record.deploymentId, `${path}.deploymentId`),
    versionId: cloudflareId(record.versionId, `${path}.versionId`),
    trafficPercentage: 100,
    observedAt: isoTimestamp(record.observedAt, `${path}.observedAt`),
  };
}

function decodeVersion(
  value: unknown,
  path: string,
  role: "executor",
): H05ExecutorWorkerVersionEvidence;
function decodeVersion(
  value: unknown,
  path: string,
  role: "probe",
): H05ProbeWorkerVersionEvidence;
function decodeVersion(
  value: unknown,
  path: string,
  role: "executor" | "probe",
): H05WorkerVersionEvidence {
  const record = exactRecord(value, path, [
    "compatibilityDate",
    "compatibilityFlags",
    "placementMode",
    "scriptTraceSettings",
    "settingsBindings",
    "settingsTraceSettings",
    "versionBindings",
    "versionId",
  ]);
  const common: H05WorkerVersionEvidenceBase = {
    versionId: cloudflareId(record.versionId, `${path}.versionId`),
    compatibilityDate: literal(
      record.compatibilityDate,
      h05ExecutorCompatibilityDate,
      `${path}.compatibilityDate`,
    ),
    versionBindings: decodeBindings(
      record.versionBindings,
      `${path}.versionBindings`,
    ),
    settingsBindings: decodeBindings(
      record.settingsBindings,
      `${path}.settingsBindings`,
    ),
    settingsTraceSettings: decodeTraceSettings(
      record.settingsTraceSettings,
      `${path}.settingsTraceSettings`,
    ),
    scriptTraceSettings: decodeTraceSettings(
      record.scriptTraceSettings,
      `${path}.scriptTraceSettings`,
    ),
  };
  if (role === "executor") {
    return {
      versionId: common.versionId,
      compatibilityDate: common.compatibilityDate,
      compatibilityFlags: decodeExactH05StringTuple(
        record.compatibilityFlags,
        ["nodejs_compat"] as const,
        `${path}.compatibilityFlags`,
        fail,
      ),
      placementMode: literal(
        record.placementMode,
        "smart",
        `${path}.placementMode`,
      ),
      versionBindings: common.versionBindings,
      settingsBindings: common.settingsBindings,
      settingsTraceSettings: common.settingsTraceSettings,
      scriptTraceSettings: common.scriptTraceSettings,
    };
  }
  return {
    versionId: common.versionId,
    compatibilityDate: common.compatibilityDate,
    compatibilityFlags: decodeExactH05StringTuple(
      record.compatibilityFlags,
      [] as const,
      `${path}.compatibilityFlags`,
      fail,
    ),
    placementMode: literal(
      record.placementMode,
      "none",
      `${path}.placementMode`,
    ),
    versionBindings: common.versionBindings,
    settingsBindings: common.settingsBindings,
    settingsTraceSettings: common.settingsTraceSettings,
    scriptTraceSettings: common.scriptTraceSettings,
  };
}

function decodeTraceSettings(
  value: unknown,
  path: string,
): H05TraceSettingsEvidence {
  const record = exactRecord(value, path, [
    "enabled",
    "persisted",
    "samplingRate",
  ]);
  literal(record.enabled, true, `${path}.enabled`);
  literal(record.persisted, true, `${path}.persisted`);
  literal(record.samplingRate, 1, `${path}.samplingRate`);
  return { enabled: true, persisted: true, samplingRate: 1 };
}

function decodeBindings(value: unknown, path: string): readonly H05BindingEvidence[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  const bindings = value.map((binding, index) =>
    decodeBinding(binding, `${path}[${index}]`),
  );
  assertSortedUnique(bindings.map(bindingKey), path);
  return bindings;
}

function decodeBinding(value: unknown, path: string): H05BindingEvidence {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const type = nonEmptyString(value.type, `${path}.type`);
  if (type === "hyperdrive") {
    const record = exactRecord(value, path, ["id", "name", "type"]);
    return {
      type,
      name: nonEmptyString(record.name, `${path}.name`),
      id: patternString(record.id, /^[a-f0-9]{32}$/, `${path}.id`),
    };
  }
  if (type === "secret_text") {
    const record = exactRecord(value, path, ["name", "type"]);
    return { type, name: nonEmptyString(record.name, `${path}.name`) };
  }
  if (type === "service") {
    const record = exactRecord(value, path, ["name", "service", "type"]);
    return {
      type,
      name: nonEmptyString(record.name, `${path}.name`),
      service: nonEmptyString(record.service, `${path}.service`),
    };
  }
  fail(`${path}.type is not an allowed H05 binding type.`);
}

function decodeSecrets(
  value: unknown,
  path: string,
  expectedNames: readonly string[],
): readonly H05SecretEvidence[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  const secrets: H05SecretEvidence[] = value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = exactRecord(item, itemPath, ["name", "type"]);
    literal(record.type, "secret_text", `${itemPath}.type`);
    return {
      name: nonEmptyString(record.name, `${itemPath}.name`),
      type: "secret_text",
    };
  });
  assertExactStrings(
    secrets.map((secret) => secret.name),
    [...expectedNames].sort(),
    path,
  );
  return secrets;
}

function decodeSubdomain(value: unknown, path: string): H05SubdomainEvidence {
  const record = exactRecord(value, path, ["enabled", "previewsEnabled"]);
  return {
    enabled: booleanValue(record.enabled, `${path}.enabled`),
    previewsEnabled: booleanValue(
      record.previewsEnabled,
      `${path}.previewsEnabled`,
    ),
  };
}

function decodePrivacy(value: unknown, path: string): H05ExecutorPrivacyEvidence {
  const record = exactRecord(value, path, [
    "closing",
    "opening",
    "tokenScopeAttestation",
  ]);
  const opening = decodePrivacySnapshot(record.opening, `${path}.opening`);
  const closing = decodePrivacySnapshot(record.closing, `${path}.closing`);
  assertTimestampOrder(
    opening.checkedAt,
    closing.checkedAt,
    `${path} opening and closing sweeps`,
  );
  if (privacySnapshotFingerprint(opening) !== privacySnapshotFingerprint(closing)) {
    fail(`${path} changed between its opening and closing sweeps.`);
  }
  return {
    tokenScopeAttestation: literal(
      record.tokenScopeAttestation,
      "operator-attested-all-account-zones",
      `${path}.tokenScopeAttestation`,
    ),
    opening,
    closing,
  };
}

function decodePrivacySnapshot(
  value: unknown,
  path: string,
): H05ExecutorPrivacySnapshotEvidence {
  const record = exactRecord(value, path, [
    "checkedAt",
    "customDomains",
    "directRequest",
    "routes",
    "zones",
  ]);
  const customDomainsRecord = exactRecord(
    record.customDomains,
    `${path}.customDomains`,
    ["filteredCount", "page", "totalPages", "unfilteredTotalCount"],
  );
  literal(
    customDomainsRecord.filteredCount,
    0,
    `${path}.customDomains.filteredCount`,
  );
  literal(customDomainsRecord.page, 1, `${path}.customDomains.page`);
  const totalPages = oneOf(
    customDomainsRecord.totalPages,
    [0, 1] as const,
    `${path}.customDomains.totalPages`,
  );
  const customDomainUnfilteredTotalCount = nonNegativeSafeInteger(
    customDomainsRecord.unfilteredTotalCount,
    `${path}.customDomains.unfilteredTotalCount`,
  );
  const directRequestRecord = exactRecord(
    record.directRequest,
    `${path}.directRequest`,
    ["status"],
  );
  literal(directRequestRecord.status, 404, `${path}.directRequest.status`);
  const zonesRecord = exactRecord(record.zones, `${path}.zones`, [
    "pageCount",
    "requestedTypes",
    "unfilteredTotalCount",
    "zoneIds",
  ]);
  const zoneIds = zoneIdArray(zonesRecord.zoneIds, `${path}.zones.zoneIds`);
  assertSortedUnique(zoneIds, `${path}.zones.zoneIds`);
  const pageCount = positiveSafeIntegerInRange(
    zonesRecord.pageCount,
    1,
    h05MaximumZonePages,
    `${path}.zones.pageCount`,
  );
  if (zoneIds.length === 0 && pageCount > 1) {
    fail(`${path}.zones.pageCount is inconsistent with the zone inventory.`);
  }
  const zoneUnfilteredTotalCount = nonNegativeSafeInteger(
    zonesRecord.unfilteredTotalCount,
    `${path}.zones.unfilteredTotalCount`,
  );
  if (zoneUnfilteredTotalCount < zoneIds.length) {
    fail(`${path}.zones.unfilteredTotalCount is smaller than the collected inventory.`);
  }
  const routesRecord = exactRecord(record.routes, `${path}.routes`, [
    "checkedZoneIds",
    "inspectedRouteCount",
    "targetRouteCount",
  ]);
  const checkedZoneIds = zoneIdArray(
    routesRecord.checkedZoneIds,
    `${path}.routes.checkedZoneIds`,
  );
  assertExactStrings(checkedZoneIds, zoneIds, `${path}.routes.checkedZoneIds`);
  literal(routesRecord.targetRouteCount, 0, `${path}.routes.targetRouteCount`);
  const inspectedRouteCount = nonNegativeSafeInteger(
    routesRecord.inspectedRouteCount,
    `${path}.routes.inspectedRouteCount`,
  );
  return {
    customDomains: {
      filteredCount: 0,
      page: 1,
      totalPages,
      unfilteredTotalCount: customDomainUnfilteredTotalCount,
    },
    zones: {
      requestedTypes: decodeExactH05StringTuple(
        zonesRecord.requestedTypes,
        h05ZoneTypes,
        `${path}.zones.requestedTypes`,
        fail,
      ),
      pageCount,
      unfilteredTotalCount: zoneUnfilteredTotalCount,
      zoneIds,
    },
    routes: {
      checkedZoneIds,
      inspectedRouteCount,
      targetRouteCount: 0,
    },
    directRequest: { status: 404 },
    checkedAt: isoTimestamp(record.checkedAt, `${path}.checkedAt`),
  };
}

function privacySnapshotFingerprint(
  value: H05ExecutorPrivacySnapshotEvidence,
): string {
  return JSON.stringify({
    customDomains: value.customDomains,
    zones: value.zones,
    routes: value.routes,
    directRequest: value.directRequest,
  });
}

function assertStableDeployment(
  before: H05DeploymentEvidence,
  after: H05DeploymentEvidence,
  path: string,
): void {
  if (
    before.deploymentId !== after.deploymentId ||
    before.versionId !== after.versionId ||
    before.trafficPercentage !== after.trafficPercentage
  ) {
    fail(`${path} active deployment changed during collection.`);
  }
}

function assertBindings(
  version: H05WorkerVersionEvidence,
  expected: readonly H05BindingEvidence[],
  path: string,
): void {
  const expectedKeys = expected.map(bindingKey).sort();
  assertExactStrings(
    version.versionBindings.map(bindingKey),
    expectedKeys,
    `${path}.versionBindings`,
  );
  assertExactStrings(
    version.settingsBindings.map(bindingKey),
    expectedKeys,
    `${path}.settingsBindings`,
  );
}

function bindingKey(binding: H05BindingEvidence): string {
  if (binding.type === "hyperdrive") {
    return `${binding.name}:${binding.type}:${binding.id}`;
  }
  if (binding.type === "service") {
    return `${binding.name}:${binding.type}:${binding.service}`;
  }
  return `${binding.name}:${binding.type}`;
}

function assertExactStrings(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail(`${path} does not match the exact expected inventory.`);
  }
}

function assertSortedUnique(values: readonly string[], path: string): void {
  for (let index = 0; index < values.length; index += 1) {
    const previous = index === 0 ? undefined : values[index - 1];
    const value = values[index];
    if (value === undefined || (previous !== undefined && previous >= value)) {
      fail(`${path} must be sorted and contain unique values.`);
    }
  }
}

function exactRecord(
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key, index) => key !== expected[index])
  ) {
    const missing = expected.filter((key) => !actualKeys.includes(key));
    const unknown = actualKeys.filter((key) => !expected.includes(key));
    fail(
      `${path} has invalid keys (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}).`,
    );
  }
  return value;
}

function zoneIdArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return value.map((item, index) =>
    patternString(item, /^[a-f0-9]{32}$/, `${path}[${index}]`),
  );
}

function literal<const Value extends string | number | boolean>(
  value: unknown,
  expected: Value,
  path: string,
): Value {
  return decodeExactH05Scalar(value, expected, path, fail);
}

function oneOf<const Values extends readonly (string | number)[]>(
  value: unknown,
  expected: Values,
  path: string,
): Values[number] {
  if (!expected.some((candidate) => candidate === value)) {
    fail(`${path} must be one of ${expected.join(", ")}.`);
  }
  return value as Values[number];
}

function patternString(value: unknown, pattern: RegExp, path: string): string {
  const decoded = nonEmptyString(value, path);
  if (!pattern.test(decoded)) fail(`${path} has an invalid format.`);
  return decoded;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${path} must be a non-empty string.`);
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path} must be a boolean.`);
  return value;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!isNonNegativeSafeInteger(value)) {
    fail(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (
    !isPositiveSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${path} must be a safe integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function isoTimestamp(value: unknown, path: string): string {
  const decoded = nonEmptyString(value, path);
  const parsed = Date.parse(decoded);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== decoded) {
    fail(`${path} must be a canonical UTC ISO timestamp.`);
  }
  return decoded;
}

function sha256String(value: unknown, path: string): string {
  const decoded = nonEmptyString(value, path);
  if (!isH05LowercaseSha256Digest(decoded)) {
    fail(`${path} has an invalid format.`);
  }
  return decoded;
}

function cloudflareId(value: unknown, path: string): string {
  const decoded = nonEmptyString(value, path);
  if (
    decoded.length < 8 ||
    decoded.length > 128 ||
    /[\u0000-\u0020\u007f]/.test(decoded)
  ) {
    fail(`${path} must be a bounded opaque Cloudflare identifier.`);
  }
  return decoded;
}

function httpsOrigin(value: unknown, path: string): string {
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
  return parsed.origin;
}

function assertTimestampOrder(first: string, second: string, path: string): void {
  requireOrderedH05Timestamps(first, second, path, fail);
}

function assertTimestampInWindow(
  timestamp: string,
  window: H05ControlPlaneWindowEvidence,
  path: string,
): void {
  const value = Date.parse(timestamp);
  if (value < Date.parse(window.startedAt) || value > Date.parse(window.finishedAt)) {
    fail(`${path} must fall inside the collection window.`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeFailure(error: unknown): { readonly ok: false; readonly message: string } {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  };
}

function fail(message: string): never {
  throw new Error(`Invalid H05 control-plane evidence: ${message}`);
}
