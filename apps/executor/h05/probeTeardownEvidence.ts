import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";

import { decodeExactH05Scalar } from "./exactScalar";
import { requireExactH05Record } from "./exactRecord";
import { decodeH05EvidenceWindow } from "./evidenceWindow";
import { formatH05JsonDocument } from "./jsonDocument";
import { isH05FullLowercaseGitCommit } from "./gitCommit";
import { isH05HttpsOriginUrl } from "./httpsOrigin";
import { isH05CanonicalIsoTimestamp } from "./isoTimestamp";
import {
  decodeH05ControlPlaneEvidence,
  type H05ControlPlaneEvidence,
  type H05ControlPlaneRunEvidence,
} from "./controlPlaneEvidence";
import {
  decodeH05ProofRunId,
  h05ProofIdentity,
  type H05ProofRunId,
} from "./proofIdentity";
import { h05ProbeEndpoint } from "./probeProtocol";
import { isH05LowercaseSha256Digest } from "./sha256";
import { h05Sha256Utf8 } from "./sha256Utf8";
import {
  decodeH05DataPlaneEvidence,
  h05ProbeWorkerName,
  type H05DataPlaneEvidence,
} from "./receipt";
import { isH05SupportedWranglerVersion } from "./wranglerVersion";

declare const sha256Brand: unique symbol;
declare const gitCommitBrand: unique symbol;
declare const cloudflareResourceIdBrand: unique symbol;
declare const isoTimestampBrand: unique symbol;

export type H05ProbeTeardownSha256 = string & {
  readonly [sha256Brand]: "H05ProbeTeardownSha256";
};
export type H05ProbeTeardownGitCommit = string & {
  readonly [gitCommitBrand]: "H05ProbeTeardownGitCommit";
};
export type H05ProbeTeardownCloudflareResourceId = string & {
  readonly [cloudflareResourceIdBrand]: "H05ProbeTeardownCloudflareResourceId";
};
export type H05ProbeTeardownIsoTimestamp = string & {
  readonly [isoTimestampBrand]: "H05ProbeTeardownIsoTimestamp";
};

export const h05ProbeTeardownEvidenceFormat =
  "flarex-h05-probe-teardown-evidence-v1";
export const h05ProbeTeardownStableObservationCount = 2;
export const h05ProbeTeardownMaximumAttempts = 30;
export const h05ProbeTeardownPollIntervalMs = 2_000;

export type H05ProbeDeletionEvidence =
  | {
      readonly completedAt: H05ProbeTeardownIsoTimestamp;
      readonly forceParameter: "omitted";
      readonly method: "DELETE";
      readonly outcome: "deleted";
      readonly source: "cloudflare-workers-scripts-api";
      readonly status: 200;
    }
  | {
      readonly completedAt: H05ProbeTeardownIsoTimestamp;
      readonly forceParameter: "omitted";
      readonly method: "DELETE";
      readonly outcome: "already-absent";
      readonly source: "cloudflare-workers-scripts-api";
      readonly status: 404;
    };

export interface H05ProbeAbsenceObservationEvidence {
  readonly authenticatedScriptLookup: {
    readonly method: "GET";
    readonly status: 404;
  };
  readonly attempt: number;
  readonly checkedAt: H05ProbeTeardownIsoTimestamp;
  readonly publicProbeLookup: {
    readonly authorization: "omitted";
    readonly method: "POST";
    readonly status: 404;
  };
}

export interface H05ProbeTeardownCollectionEvidence {
  readonly accountAccess: {
    readonly checkedAt: H05ProbeTeardownIsoTimestamp;
    readonly method: "GET";
    readonly selection: "fixed-tag-filter";
    readonly source: "cloudflare-workers-scripts-api";
    readonly status: 200;
  };
  readonly deletion: H05ProbeDeletionEvidence;
  readonly verification: {
    readonly attemptsUsed: number;
    readonly maximumAttempts: typeof h05ProbeTeardownMaximumAttempts;
    readonly observations: readonly H05ProbeAbsenceObservationEvidence[];
    readonly pollIntervalMs: typeof h05ProbeTeardownPollIntervalMs;
    readonly requiredConsecutiveObservations: typeof h05ProbeTeardownStableObservationCount;
  };
  readonly window: {
    readonly finishedAt: H05ProbeTeardownIsoTimestamp;
    readonly startedAt: H05ProbeTeardownIsoTimestamp;
  };
}

export interface H05ProbeTeardownEvidencePayload {
  readonly format: typeof h05ProbeTeardownEvidenceFormat;
  readonly redaction: {
    readonly apiResponseBodies: "omitted";
    readonly bearerCapabilityValues: "omitted";
    readonly publicResponseBodies: "omitted";
  };
  readonly source: {
    readonly commit: H05ProbeTeardownGitCommit;
    readonly worktreeClean: true;
    readonly wranglerVersion: string;
  };
  readonly accountIdSha256: H05ProbeTeardownSha256;
  readonly run: {
    readonly deploymentId: string;
    readonly projectId: string;
    readonly runId: H05ProofRunId;
  };
  readonly inputs: {
    readonly controlPlaneAfterEvidenceSha256: H05ProbeTeardownSha256;
    readonly dataPlaneEvidenceSha256: H05ProbeTeardownSha256;
    readonly probeDeploymentId: H05ProbeTeardownCloudflareResourceId;
    readonly probePath: string;
    readonly probePublicOrigin: string;
    readonly probeVersionId: H05ProbeTeardownCloudflareResourceId;
    readonly probeWorkerName: typeof h05ProbeWorkerName;
  };
  readonly window: H05ProbeTeardownCollectionEvidence["window"];
  readonly accountAccess: H05ProbeTeardownCollectionEvidence["accountAccess"];
  readonly deletion: H05ProbeDeletionEvidence;
  readonly verification: H05ProbeTeardownCollectionEvidence["verification"];
}

export interface H05ProbeTeardownEvidence
  extends H05ProbeTeardownEvidencePayload {
  readonly evidenceSha256: H05ProbeTeardownSha256;
}

export type H05ProbeTeardownEvidenceDecode =
  | { readonly ok: true; readonly value: H05ProbeTeardownEvidence }
  | { readonly ok: false; readonly message: string };

export type H05ProbeTeardownDependencyCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

interface H05ProbeTeardownDependencies {
  readonly controlPlaneAfter: H05ControlPlaneEvidence;
  readonly dataPlane: H05DataPlaneEvidence;
}

const payloadKeys = [
  "format",
  "redaction",
  "source",
  "accountIdSha256",
  "run",
  "inputs",
  "window",
  "accountAccess",
  "deletion",
  "verification",
] as const;

export function compileH05ProbeTeardownEvidence(
  dataPlaneValue: unknown,
  controlPlaneAfterValue: unknown,
  collectionValue: unknown,
): H05ProbeTeardownEvidenceDecode {
  try {
    const dependencies = decodeDependencies(
      dataPlaneValue,
      controlPlaneAfterValue,
    );
    validateDependencyRelationship(dependencies);
    const collection = decodeCollection(collectionValue, "$collection");
    const payload = decodePayload(
      {
        format: h05ProbeTeardownEvidenceFormat,
        redaction: {
          apiResponseBodies: "omitted",
          bearerCapabilityValues: "omitted",
          publicResponseBodies: "omitted",
        },
        source: dependencies.controlPlaneAfter.source,
        accountIdSha256: dependencies.controlPlaneAfter.accountIdSha256,
        run: dependencies.dataPlane.run,
        inputs: {
          controlPlaneAfterEvidenceSha256:
            dependencies.controlPlaneAfter.evidenceSha256,
          dataPlaneEvidenceSha256: dependencies.dataPlane.evidenceSha256,
          probeDeploymentId:
            dependencies.controlPlaneAfter.probe.deploymentAfter.deploymentId,
          probePath: h05ProbeEndpoint(dependencies.dataPlane.run.runId),
          probePublicOrigin:
            dependencies.controlPlaneAfter.probe.publicOrigin,
          probeVersionId:
            dependencies.controlPlaneAfter.probe.deploymentAfter.versionId,
          probeWorkerName: h05ProbeWorkerName,
        },
        window: collection.window,
        accountAccess: collection.accountAccess,
        deletion: collection.deletion,
        verification: collection.verification,
      },
      "$payload",
    );
    validatePayload(payload);
    validateEvidenceDependencies(payload, dependencies);
    return decodeH05ProbeTeardownEvidence({
      ...payload,
      evidenceSha256: sha256(serializeH05ProbeTeardownPayload(payload)),
    });
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export function decodeH05ProbeTeardownEvidence(
  value: unknown,
): H05ProbeTeardownEvidenceDecode {
  try {
    const record = exactRecord(value, "$", [...payloadKeys, "evidenceSha256"]);
    const payload = decodePayload(
      {
        format: record.format,
        redaction: record.redaction,
        source: record.source,
        accountIdSha256: record.accountIdSha256,
        run: record.run,
        inputs: record.inputs,
        window: record.window,
        accountAccess: record.accountAccess,
        deletion: record.deletion,
        verification: record.verification,
      },
      "$",
    );
    validatePayload(payload);
    const evidenceSha256 = sha256String(
      record.evidenceSha256,
      "$.evidenceSha256",
    );
    exactValue(
      evidenceSha256,
      sha256(serializeH05ProbeTeardownPayload(payload)),
      "$.evidenceSha256",
    );
    return { ok: true, value: { ...payload, evidenceSha256 } };
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export function decodeH05ProbeTeardownEvidenceJson(
  raw: string,
): H05ProbeTeardownEvidenceDecode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure("artifact must contain valid JSON.");
  }
  const decoded = decodeH05ProbeTeardownEvidence(parsed);
  if (!decoded.ok) return decoded;
  if (raw !== serializeH05ProbeTeardownEvidence(decoded.value)) {
    return failure("artifact must use canonical JSON serialization.");
  }
  return decoded;
}

export function serializeH05ProbeTeardownEvidence(
  evidence: H05ProbeTeardownEvidence,
): string {
  const decoded = decodeH05ProbeTeardownEvidence(evidence);
  if (!decoded.ok) throw new Error(decoded.message);
  return formatH05JsonDocument(decoded.value);
}

export function serializeH05ProbeTeardownPayload(
  payload: H05ProbeTeardownEvidencePayload,
): string {
  const decoded = decodePayload(payload, "$payload");
  validatePayload(decoded);
  return formatH05JsonDocument(decoded);
}

export function validateH05ProbeTeardownDependencies(
  dataPlaneValue: unknown,
  controlPlaneAfterValue: unknown,
): H05ProbeTeardownDependencyCheck {
  try {
    validateDependencyRelationship(
      decodeDependencies(dataPlaneValue, controlPlaneAfterValue),
    );
    return { ok: true };
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export function verifyH05ProbeTeardownEvidenceDependencies(
  evidenceValue: unknown,
  dataPlaneValue: unknown,
  controlPlaneAfterValue: unknown,
): H05ProbeTeardownDependencyCheck {
  try {
    const evidence = decodeH05ProbeTeardownEvidence(evidenceValue);
    if (!evidence.ok) throw new Error(evidence.message);
    const dependencies = decodeDependencies(
      dataPlaneValue,
      controlPlaneAfterValue,
    );
    validateDependencyRelationship(dependencies);
    validateEvidenceDependencies(evidence.value, dependencies);
    return { ok: true };
  } catch (error) {
    return failure(errorMessage(error));
  }
}

function decodeDependencies(
  dataPlaneValue: unknown,
  controlPlaneAfterValue: unknown,
): H05ProbeTeardownDependencies {
  const dataPlane = decodeH05DataPlaneEvidence(dataPlaneValue);
  if (!dataPlane.ok) throw new Error(dataPlane.message);
  const controlPlaneAfter = decodeH05ControlPlaneEvidence(
    controlPlaneAfterValue,
  );
  if (!controlPlaneAfter.ok) throw new Error(controlPlaneAfter.message);
  return {
    controlPlaneAfter: controlPlaneAfter.value,
    dataPlane: dataPlane.value,
  };
}

function validateDependencyRelationship(
  dependencies: H05ProbeTeardownDependencies,
): void {
  const { controlPlaneAfter, dataPlane } = dependencies;
  exactValue(
    controlPlaneAfter.source.commit,
    dataPlane.source.commit,
    "controlPlaneAfter.source.commit",
  );
  exactRun(controlPlaneAfter.run, dataPlane.run, "controlPlaneAfter.run");
  orderedTimestamps(
    dataPlane.window.finishedAt,
    controlPlaneAfter.window.startedAt,
    "data-plane-to-control-plane-after",
  );
}

function validateEvidenceDependencies(
  evidence: H05ProbeTeardownEvidencePayload,
  dependencies: H05ProbeTeardownDependencies,
): void {
  const { controlPlaneAfter, dataPlane } = dependencies;
  exactValue(evidence.source.commit, dataPlane.source.commit, "source.commit");
  exactValue(
    evidence.source.wranglerVersion,
    controlPlaneAfter.source.wranglerVersion,
    "source.wranglerVersion",
  );
  exactValue(
    evidence.accountIdSha256,
    controlPlaneAfter.accountIdSha256,
    "accountIdSha256",
  );
  exactRun(evidence.run, dataPlane.run, "run");
  exactValue(
    evidence.inputs.controlPlaneAfterEvidenceSha256,
    controlPlaneAfter.evidenceSha256,
    "inputs.controlPlaneAfterEvidenceSha256",
  );
  exactValue(
    evidence.inputs.dataPlaneEvidenceSha256,
    dataPlane.evidenceSha256,
    "inputs.dataPlaneEvidenceSha256",
  );
  exactValue(
    evidence.inputs.probeDeploymentId,
    controlPlaneAfter.probe.deploymentAfter.deploymentId,
    "inputs.probeDeploymentId",
  );
  exactValue(
    evidence.inputs.probeVersionId,
    controlPlaneAfter.probe.deploymentAfter.versionId,
    "inputs.probeVersionId",
  );
  exactValue(
    evidence.inputs.probePublicOrigin,
    controlPlaneAfter.probe.publicOrigin,
    "inputs.probePublicOrigin",
  );
  orderedTimestamps(
    controlPlaneAfter.window.finishedAt,
    evidence.window.startedAt,
    "control-plane-after-to-probe-teardown",
  );
}

function decodePayload(
  value: unknown,
  path: string,
): H05ProbeTeardownEvidencePayload {
  const record = exactRecord(value, path, payloadKeys);
  const redaction = exactRecord(record.redaction, `${path}.redaction`, [
    "apiResponseBodies",
    "bearerCapabilityValues",
    "publicResponseBodies",
  ]);
  const source = exactRecord(record.source, `${path}.source`, [
    "commit",
    "worktreeClean",
    "wranglerVersion",
  ]);
  const run = exactRecord(record.run, `${path}.run`, [
    "deploymentId",
    "projectId",
    "runId",
  ]);
  const decodedRunId = decodeH05ProofRunId(
    typeof run.runId === "string" ? run.runId : undefined,
  );
  if (!decodedRunId.ok) failAt(`${path}.run.runId`, decodedRunId.message);
  const inputs = exactRecord(record.inputs, `${path}.inputs`, [
    "controlPlaneAfterEvidenceSha256",
    "dataPlaneEvidenceSha256",
    "probeDeploymentId",
    "probePath",
    "probePublicOrigin",
    "probeVersionId",
    "probeWorkerName",
  ]);
  return {
    format: literal(
      record.format,
      h05ProbeTeardownEvidenceFormat,
      `${path}.format`,
    ),
    redaction: {
      apiResponseBodies: literal(
        redaction.apiResponseBodies,
        "omitted",
        `${path}.redaction.apiResponseBodies`,
      ),
      bearerCapabilityValues: literal(
        redaction.bearerCapabilityValues,
        "omitted",
        `${path}.redaction.bearerCapabilityValues`,
      ),
      publicResponseBodies: literal(
        redaction.publicResponseBodies,
        "omitted",
        `${path}.redaction.publicResponseBodies`,
      ),
    },
    source: {
      commit: gitCommit(source.commit, `${path}.source.commit`),
      worktreeClean: literal(
        source.worktreeClean,
        true,
        `${path}.source.worktreeClean`,
      ),
      wranglerVersion: wranglerVersion(
        source.wranglerVersion,
        `${path}.source.wranglerVersion`,
      ),
    },
    accountIdSha256: sha256String(
      record.accountIdSha256,
      `${path}.accountIdSha256`,
    ),
    run: {
      runId: decodedRunId.value,
      deploymentId: boundedIdentifier(
        run.deploymentId,
        `${path}.run.deploymentId`,
      ),
      projectId: boundedIdentifier(run.projectId, `${path}.run.projectId`),
    },
    inputs: {
      controlPlaneAfterEvidenceSha256: sha256String(
        inputs.controlPlaneAfterEvidenceSha256,
        `${path}.inputs.controlPlaneAfterEvidenceSha256`,
      ),
      dataPlaneEvidenceSha256: sha256String(
        inputs.dataPlaneEvidenceSha256,
        `${path}.inputs.dataPlaneEvidenceSha256`,
      ),
      probeDeploymentId: cloudflareResourceId(
        inputs.probeDeploymentId,
        `${path}.inputs.probeDeploymentId`,
      ),
      probePath: boundedPath(inputs.probePath, `${path}.inputs.probePath`),
      probePublicOrigin: workersDevOrigin(
        inputs.probePublicOrigin,
        `${path}.inputs.probePublicOrigin`,
      ),
      probeVersionId: cloudflareResourceId(
        inputs.probeVersionId,
        `${path}.inputs.probeVersionId`,
      ),
      probeWorkerName: literal(
        inputs.probeWorkerName,
        h05ProbeWorkerName,
        `${path}.inputs.probeWorkerName`,
      ),
    },
    window: decodeWindow(record.window, `${path}.window`),
    accountAccess: decodeAccountAccess(
      record.accountAccess,
      `${path}.accountAccess`,
    ),
    deletion: decodeDeletion(record.deletion, `${path}.deletion`),
    verification: decodeVerification(
      record.verification,
      `${path}.verification`,
    ),
  };
}

function decodeCollection(
  value: unknown,
  path: string,
): H05ProbeTeardownCollectionEvidence {
  const record = exactRecord(value, path, [
    "accountAccess",
    "deletion",
    "verification",
    "window",
  ]);
  return {
    accountAccess: decodeAccountAccess(
      record.accountAccess,
      `${path}.accountAccess`,
    ),
    deletion: decodeDeletion(record.deletion, `${path}.deletion`),
    verification: decodeVerification(
      record.verification,
      `${path}.verification`,
    ),
    window: decodeWindow(record.window, `${path}.window`),
  };
}

function decodeAccountAccess(
  value: unknown,
  path: string,
): H05ProbeTeardownCollectionEvidence["accountAccess"] {
  const record = exactRecord(value, path, [
    "checkedAt",
    "method",
    "selection",
    "source",
    "status",
  ]);
  return {
    checkedAt: isoTimestamp(record.checkedAt, `${path}.checkedAt`),
    method: literal(record.method, "GET", `${path}.method`),
    selection: literal(
      record.selection,
      "fixed-tag-filter",
      `${path}.selection`,
    ),
    source: literal(
      record.source,
      "cloudflare-workers-scripts-api",
      `${path}.source`,
    ),
    status: literal(record.status, 200, `${path}.status`),
  };
}

function decodeDeletion(
  value: unknown,
  path: string,
): H05ProbeDeletionEvidence {
  const record = exactRecord(value, path, [
    "completedAt",
    "forceParameter",
    "method",
    "outcome",
    "source",
    "status",
  ]);
  const common = {
    completedAt: isoTimestamp(record.completedAt, `${path}.completedAt`),
    forceParameter: literal(
      record.forceParameter,
      "omitted",
      `${path}.forceParameter`,
    ),
    method: literal(record.method, "DELETE", `${path}.method`),
    source: literal(
      record.source,
      "cloudflare-workers-scripts-api",
      `${path}.source`,
    ),
  };
  if (record.outcome === "deleted") {
    return {
      ...common,
      outcome: literal(record.outcome, "deleted", `${path}.outcome`),
      status: literal(record.status, 200, `${path}.status`),
    };
  }
  if (record.outcome === "already-absent") {
    return {
      ...common,
      outcome: literal(
        record.outcome,
        "already-absent",
        `${path}.outcome`,
      ),
      status: literal(record.status, 404, `${path}.status`),
    };
  }
  failAt(path, "must contain a supported deletion outcome.");
}

function decodeVerification(
  value: unknown,
  path: string,
): H05ProbeTeardownCollectionEvidence["verification"] {
  const record = exactRecord(value, path, [
    "attemptsUsed",
    "maximumAttempts",
    "observations",
    "pollIntervalMs",
    "requiredConsecutiveObservations",
  ]);
  if (
    !Array.isArray(record.observations) ||
    record.observations.length !== h05ProbeTeardownStableObservationCount
  ) {
    failAt(
      `${path}.observations`,
      `must contain exactly ${h05ProbeTeardownStableObservationCount} observations.`,
    );
  }
  return {
    attemptsUsed: positiveSafeIntegerInRange(
      record.attemptsUsed,
      h05ProbeTeardownStableObservationCount,
      h05ProbeTeardownMaximumAttempts,
      `${path}.attemptsUsed`,
    ),
    maximumAttempts: literal(
      record.maximumAttempts,
      h05ProbeTeardownMaximumAttempts,
      `${path}.maximumAttempts`,
    ),
    observations: record.observations.map((observation, index) =>
      decodeObservation(observation, `${path}.observations[${index}]`),
    ),
    pollIntervalMs: literal(
      record.pollIntervalMs,
      h05ProbeTeardownPollIntervalMs,
      `${path}.pollIntervalMs`,
    ),
    requiredConsecutiveObservations: literal(
      record.requiredConsecutiveObservations,
      h05ProbeTeardownStableObservationCount,
      `${path}.requiredConsecutiveObservations`,
    ),
  };
}

function decodeObservation(
  value: unknown,
  path: string,
): H05ProbeAbsenceObservationEvidence {
  const record = exactRecord(value, path, [
    "authenticatedScriptLookup",
    "attempt",
    "checkedAt",
    "publicProbeLookup",
  ]);
  const authenticated = exactRecord(
    record.authenticatedScriptLookup,
    `${path}.authenticatedScriptLookup`,
    ["method", "status"],
  );
  const publicLookup = exactRecord(
    record.publicProbeLookup,
    `${path}.publicProbeLookup`,
    ["authorization", "method", "status"],
  );
  return {
    authenticatedScriptLookup: {
      method: literal(
        authenticated.method,
        "GET",
        `${path}.authenticatedScriptLookup.method`,
      ),
      status: literal(
        authenticated.status,
        404,
        `${path}.authenticatedScriptLookup.status`,
      ),
    },
    attempt: positiveSafeIntegerInRange(
      record.attempt,
      1,
      h05ProbeTeardownMaximumAttempts,
      `${path}.attempt`,
    ),
    checkedAt: isoTimestamp(record.checkedAt, `${path}.checkedAt`),
    publicProbeLookup: {
      authorization: literal(
        publicLookup.authorization,
        "omitted",
        `${path}.publicProbeLookup.authorization`,
      ),
      method: literal(
        publicLookup.method,
        "POST",
        `${path}.publicProbeLookup.method`,
      ),
      status: literal(
        publicLookup.status,
        404,
        `${path}.publicProbeLookup.status`,
      ),
    },
  };
}

function decodeWindow(
  value: unknown,
  path: string,
): H05ProbeTeardownCollectionEvidence["window"] {
  return decodeH05EvidenceWindow(
    value,
    path,
    exactRecord,
    isoTimestamp,
    "finishedAtFirst",
  );
}

function validatePayload(payload: H05ProbeTeardownEvidencePayload): void {
  const identity = h05ProofIdentity(payload.run.runId);
  exactValue(
    payload.run.deploymentId,
    identity.deploymentId,
    "run.deploymentId",
  );
  exactValue(payload.run.projectId, identity.projectId, "run.projectId");
  exactValue(
    payload.inputs.probePath,
    h05ProbeEndpoint(payload.run.runId),
    "inputs.probePath",
  );
  orderedTimestamps(
    payload.window.startedAt,
    payload.accountAccess.checkedAt,
    "window-start-to-account-access",
  );
  orderedTimestamps(
    payload.accountAccess.checkedAt,
    payload.deletion.completedAt,
    "account-access-to-deletion",
  );
  const [first, second] = payload.verification.observations;
  if (first === undefined || second === undefined) {
    fail("verification observations are incomplete.");
  }
  if (
    second.attempt !== first.attempt + 1 ||
    second.attempt !== payload.verification.attemptsUsed
  ) {
    fail(
      "verification observations must be the final two consecutive collection attempts.",
    );
  }
  orderedTimestamps(
    payload.deletion.completedAt,
    first.checkedAt,
    "deletion-to-first-absence-observation",
  );
  if (
    timestampMs(second.checkedAt) - timestampMs(first.checkedAt) <
    h05ProbeTeardownPollIntervalMs
  ) {
    fail(
      `verification observations must be at least ${h05ProbeTeardownPollIntervalMs} milliseconds apart.`,
    );
  }
  orderedTimestamps(
    second.checkedAt,
    payload.window.finishedAt,
    "last-absence-observation-to-window-finish",
  );
}

function exactRun(
  actual: H05ControlPlaneRunEvidence,
  expected: H05ControlPlaneRunEvidence,
  path: string,
): void {
  exactValue(actual.runId, expected.runId, `${path}.runId`);
  exactValue(
    actual.deploymentId,
    expected.deploymentId,
    `${path}.deploymentId`,
  );
  exactValue(actual.projectId, expected.projectId, `${path}.projectId`);
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  path: string,
  keys: Keys,
): Readonly<Record<string, unknown>> {
  return requireExactH05Record(value, path, keys, failAt);
}

function literal<const Value extends string | number | boolean>(
  value: unknown,
  expected: Value,
  path: string,
): Value {
  return decodeExactH05Scalar(value, expected, path, fail);
}

function gitCommit(
  value: unknown,
  path: string,
): H05ProbeTeardownGitCommit {
  if (!isH05FullLowercaseGitCommit(value)) {
    failAt(path, "must be a full lowercase Git commit ID.");
  }
  return value as H05ProbeTeardownGitCommit;
}

function sha256String(
  value: unknown,
  path: string,
): H05ProbeTeardownSha256 {
  if (!isH05LowercaseSha256Digest(value)) {
    failAt(path, "must be a lowercase SHA-256 digest.");
  }
  return value as H05ProbeTeardownSha256;
}

function cloudflareResourceId(
  value: unknown,
  path: string,
): H05ProbeTeardownCloudflareResourceId {
  const decoded = boundedIdentifier(value, path);
  if (decoded.length < 8) {
    failAt(path, "must be a bounded opaque Cloudflare identifier.");
  }
  return decoded as H05ProbeTeardownCloudflareResourceId;
}

function isoTimestamp(
  value: unknown,
  path: string,
): H05ProbeTeardownIsoTimestamp {
  if (typeof value !== "string") failAt(path, "must be a string.");
  if (!isH05CanonicalIsoTimestamp(value)) {
    failAt(path, "must be a canonical UTC ISO timestamp.");
  }
  return value as H05ProbeTeardownIsoTimestamp;
}

function wranglerVersion(value: unknown, path: string): string {
  if (typeof value !== "string") {
    failAt(path, "must be a supported Wrangler version.");
  }
  if (!isH05SupportedWranglerVersion(value)) {
    failAt(path, "must be a supported Wrangler version.");
  }
  return value;
}

function boundedIdentifier(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    failAt(path, "must be a bounded identifier.");
  }
  return value;
}

function boundedPath(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 512 ||
    value.includes("?") ||
    value.includes("#") ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    failAt(path, "must be a bounded absolute path.");
  }
  return value;
}

function workersDevOrigin(value: unknown, path: string): string {
  if (typeof value !== "string") failAt(path, "must be a string.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    failAt(path, "must be a valid URL.");
  }
  if (
    !isH05HttpsOriginUrl(url) ||
    !url.hostname.endsWith(".workers.dev")
  ) {
    failAt(path, "must be an HTTPS workers.dev origin.");
  }
  return url.origin;
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
    failAt(path, `must be a safe integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function exactValue(
  actual: string | number | boolean,
  expected: string | number | boolean,
  path: string,
): void {
  if (actual !== expected) failAt(path, "does not match its evidence dependency.");
}

function orderedTimestamps(
  earlier: string,
  later: string,
  path: string,
): void {
  if (timestampMs(earlier) > timestampMs(later)) {
    failAt(path, "timestamps are out of order.");
  }
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail("timestamp is invalid.");
  return parsed;
}

function sha256(value: string): H05ProbeTeardownSha256 {
  return h05Sha256Utf8(value) as H05ProbeTeardownSha256;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(message: string): { readonly ok: false; readonly message: string } {
  return { ok: false, message: `Invalid H05 probe teardown evidence: ${message}` };
}

function failAt(path: string, message: string): never {
  fail(`${path} ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}
