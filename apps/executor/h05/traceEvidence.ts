import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";

import { decodeExactH05Scalar } from "./exactScalar";
import { decodeExactH05StringTuple } from "./exactStringTuple";
import { requireExactH05Record } from "./exactRecord";
import { decodeH05EvidenceWindow } from "./evidenceWindow";
import { formatH05JsonDocument } from "./jsonDocument";
import { isH05FullLowercaseGitCommit } from "./gitCommit";
import { isH05CanonicalIsoTimestamp } from "./isoTimestamp";
import {
  decodeH05ControlPlaneEvidence,
  type H05ControlPlaneEvidence,
} from "./controlPlaneEvidence";
import {
  decodeH05ProofRunId,
  h05ProofIdentity,
  type H05ProofRunId,
} from "./proofIdentity";
import { h05ProbeEndpoint } from "./probeProtocol";
import { isH05LowercaseSha256Digest } from "./sha256";
import { h05Sha256Utf8 } from "./sha256Utf8";
import { requireOrderedH05Timestamps } from "./timestampOrder";
import { isH05SupportedWranglerVersion } from "./wranglerVersion";
import {
  decodeH05DataPlaneEvidence,
  h05AuthorizedInvocationCount,
  h05ExecutorWorkerName,
  h05ProbeWorkerName,
  h05UnauthorizedInvocationCount,
  type H05DataPlaneEvidence,
} from "./receipt";

declare const sha256Brand: unique symbol;
declare const gitCommitBrand: unique symbol;
declare const cloudflareResourceIdBrand: unique symbol;
declare const isoTimestampBrand: unique symbol;

export type H05TraceSha256 = string & {
  readonly [sha256Brand]: "H05TraceSha256";
};
export type H05TraceGitCommit = string & {
  readonly [gitCommitBrand]: "H05TraceGitCommit";
};
export type H05CloudflareResourceId = string & {
  readonly [cloudflareResourceIdBrand]: "H05CloudflareResourceId";
};
export type H05IsoTimestamp = string & {
  readonly [isoTimestampBrand]: "H05IsoTimestamp";
};
export const h05TraceEvidenceFormat = "flarex-h05-trace-evidence-v1";
export const h05TelemetryTraceLimit = 2;
export const h05TelemetryEventPageLimit = 100;
export const h05MaximumTelemetryEventPages = 8;
export const h05StableTraceObservationCount = 2;
export const h05AuthorizedSuccessStatusCount = 12;
export const h05AuthorizedConflictStatusCount = 2;

export interface H05TraceInvocationEvidence {
  readonly eventType: "fetch";
  readonly finishedAt: H05IsoTimestamp;
  readonly outcome: "ok";
  readonly startedAt: H05IsoTimestamp;
  readonly statusCode: 200 | 401 | 409;
  readonly truncated: false;
  readonly versionId: H05CloudflareResourceId;
  readonly workerName:
    | typeof h05ExecutorWorkerName
    | typeof h05ProbeWorkerName;
}

interface H05TraceEvidenceBase {
  readonly eventCount: number;
  readonly eventIdsSha256: H05TraceSha256;
  readonly finishedAt: H05IsoTimestamp;
  readonly spanCount: number;
  readonly startedAt: H05IsoTimestamp;
  readonly traceIdSha256: H05TraceSha256;
}

export interface H05AuthorizedTraceEvidence extends H05TraceEvidenceBase {
  readonly executor: H05TraceInvocationEvidence;
  readonly executorParentLinked: true;
  readonly kind: "authorized";
  readonly probe: H05TraceInvocationEvidence;
  readonly services: readonly [
    typeof h05ExecutorWorkerName,
    typeof h05ProbeWorkerName,
  ];
}

export interface H05UnauthorizedTraceEvidence extends H05TraceEvidenceBase {
  readonly kind: "unauthorized";
  readonly probe: H05TraceInvocationEvidence;
  readonly services: readonly [typeof h05ProbeWorkerName];
}

export type H05NormalizedTraceEvidence =
  | H05AuthorizedTraceEvidence
  | H05UnauthorizedTraceEvidence;

export interface H05TraceQueryObservationEvidence {
  readonly abrLevel: 1;
  readonly capturedAt: H05IsoTimestamp;
  readonly discoveryEventPageCount: number;
  readonly normalizedEvidenceSha256: H05TraceSha256;
  readonly terminalPagesObserved: true;
  readonly traceEventPageCount: number;
  readonly traceSummaryQueryCount: 15;
}

export interface H05TraceCollectionEvidence {
  readonly observations: readonly H05TraceQueryObservationEvidence[];
  readonly traces: readonly H05NormalizedTraceEvidence[];
  readonly window: {
    readonly finishedAt: H05IsoTimestamp;
    readonly startedAt: H05IsoTimestamp;
  };
}

export interface H05TraceEvidencePayload {
  readonly format: typeof h05TraceEvidenceFormat;
  readonly redaction: {
    readonly headersAndBodies: "omitted";
    readonly messagesAndErrors: "omitted";
    readonly rawTelemetrySource: "omitted";
    readonly requestUrls: "omitted";
  };
  readonly source: {
    readonly commit: H05TraceGitCommit;
    readonly worktreeClean: true;
    readonly wranglerVersion: string;
  };
  readonly accountIdSha256: H05TraceSha256;
  readonly run: {
    readonly deploymentId: string;
    readonly projectId: string;
    readonly runId: H05ProofRunId;
  };
  readonly inputs: {
    readonly controlPlaneAfterEvidenceSha256: H05TraceSha256;
    readonly controlPlaneBeforeEvidenceSha256: H05TraceSha256;
    readonly dataPlaneEvidenceSha256: H05TraceSha256;
    readonly executorVersionId: H05CloudflareResourceId;
    readonly probePath: string;
    readonly probeVersionId: H05CloudflareResourceId;
  };
  readonly window: {
    readonly collection: {
      readonly finishedAt: H05IsoTimestamp;
      readonly startedAt: H05IsoTimestamp;
    };
    readonly dataPlane: {
      readonly finishedAt: H05IsoTimestamp;
      readonly startedAt: H05IsoTimestamp;
    };
    readonly observed: {
      readonly firstAt: H05IsoTimestamp;
      readonly lastAt: H05IsoTimestamp;
    };
  };
  readonly query: {
    readonly detailSelection: "all-events-by-exact-trace-id";
    readonly discoverySelection:
      "probe-root-events-by-service-path-type-and-fetch";
    readonly eventPageLimit: typeof h05TelemetryEventPageLimit;
    readonly eventPagination: "metadata-id-next";
    readonly observations: readonly H05TraceQueryObservationEvidence[];
    readonly queryComplete: true;
    readonly samplingRate: 1;
    readonly source: "cloudflare-observability-api";
    readonly stableObservationCount: typeof h05StableTraceObservationCount;
    readonly traceSummaryCompleteness:
      "one-query-per-discovered-trace";
    readonly traceLimit: typeof h05TelemetryTraceLimit;
  };
  readonly traces: readonly H05NormalizedTraceEvidence[];
}

export interface H05TraceEvidence extends H05TraceEvidencePayload {
  readonly evidenceSha256: H05TraceSha256;
}

export type H05TraceEvidenceDecode =
  | { readonly ok: true; readonly value: H05TraceEvidence }
  | { readonly ok: false; readonly message: string };

export type H05TraceEvidenceDependencyCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

interface H05TraceEvidenceDependencies {
  readonly controlPlaneAfter: H05ControlPlaneEvidence;
  readonly controlPlaneBefore: H05ControlPlaneEvidence;
  readonly dataPlane: H05DataPlaneEvidence;
}

export function compileH05TraceEvidence(
  controlPlaneBeforeValue: unknown,
  dataPlaneValue: unknown,
  controlPlaneAfterValue: unknown,
  collectionValue: unknown,
): H05TraceEvidenceDecode {
  try {
    const dependencies = decodeDependencies(
      controlPlaneBeforeValue,
      dataPlaneValue,
      controlPlaneAfterValue,
    );
    validateDependencyRelationship(dependencies);
    const collection = decodeTraceCollection(collectionValue, "$collection");
    const normalizedEvidenceSha256 = sha256(
      serializeH05NormalizedTraceEvidence(collection.traces),
    );
    for (const observation of collection.observations) {
      exactValue(
        observation.normalizedEvidenceSha256,
        normalizedEvidenceSha256,
        "collection.observations.normalizedEvidenceSha256",
      );
    }

    const firstTrace = collection.traces[0];
    const lastTrace = collection.traces[collection.traces.length - 1];
    if (firstTrace === undefined || lastTrace === undefined) {
      fail("collection.traces must not be empty.");
    }
    const firstAt = collection.traces.reduce(
      (minimum, trace) =>
        timestampMs(trace.startedAt) < timestampMs(minimum)
          ? trace.startedAt
          : minimum,
      firstTrace.startedAt,
    );
    const lastAt = collection.traces.reduce(
      (maximum, trace) =>
        timestampMs(trace.finishedAt) > timestampMs(maximum)
          ? trace.finishedAt
          : maximum,
      lastTrace.finishedAt,
    );
    const executorVersionId = cloudflareResourceId(
      dependencies.controlPlaneBefore.executor.opening.version.versionId,
      "controlPlaneBefore.executor.opening.version.versionId",
    );
    const probeVersionId = cloudflareResourceId(
      dependencies.controlPlaneBefore.probe.opening.version.versionId,
      "controlPlaneBefore.probe.opening.version.versionId",
    );
    const payload = decodeTracePayload(
      {
        format: h05TraceEvidenceFormat,
        redaction: {
          headersAndBodies: "omitted",
          messagesAndErrors: "omitted",
          rawTelemetrySource: "omitted",
          requestUrls: "omitted",
        },
        source: {
          commit: dependencies.dataPlane.source.commit,
          worktreeClean: true,
          wranglerVersion:
            dependencies.controlPlaneBefore.source.wranglerVersion,
        },
        accountIdSha256: dependencies.controlPlaneBefore.accountIdSha256,
        run: dependencies.dataPlane.run,
        inputs: {
          controlPlaneAfterEvidenceSha256:
            dependencies.controlPlaneAfter.evidenceSha256,
          controlPlaneBeforeEvidenceSha256:
            dependencies.controlPlaneBefore.evidenceSha256,
          dataPlaneEvidenceSha256: dependencies.dataPlane.evidenceSha256,
          executorVersionId,
          probePath: h05ProbeEndpoint(dependencies.dataPlane.run.runId),
          probeVersionId,
        },
        window: {
          collection: collection.window,
          dataPlane: dependencies.dataPlane.window,
          observed: { firstAt, lastAt },
        },
        query: {
          detailSelection: "all-events-by-exact-trace-id",
          discoverySelection:
            "probe-root-events-by-service-path-type-and-fetch",
          eventPageLimit: h05TelemetryEventPageLimit,
          eventPagination: "metadata-id-next",
          observations: collection.observations,
          queryComplete: true,
          samplingRate: 1,
          source: "cloudflare-observability-api",
          stableObservationCount: h05StableTraceObservationCount,
          traceSummaryCompleteness:
            "one-query-per-discovered-trace",
          traceLimit: h05TelemetryTraceLimit,
        },
        traces: collection.traces,
      },
      "$",
    );
    validateTracePayload(payload);
    validateTraceDependencies(payload, dependencies);
    return decodeH05TraceEvidence({
      ...payload,
      evidenceSha256: sha256(serializeH05TraceEvidencePayload(payload)),
    });
  } catch (error) {
    return decodeFailure(error);
  }
}

export function decodeH05TraceEvidence(
  value: unknown,
): H05TraceEvidenceDecode {
  try {
    const record = exactRecord(value, "$", [
      "accountIdSha256",
      "evidenceSha256",
      "format",
      "inputs",
      "query",
      "redaction",
      "run",
      "source",
      "traces",
      "window",
    ]);
    const payload = decodeTracePayload(record, "$", false);
    validateTracePayload(payload);
    const evidenceSha256 = sha256String(
      record.evidenceSha256,
      "$.evidenceSha256",
    );
    exactValue(
      evidenceSha256,
      sha256(serializeH05TraceEvidencePayload(payload)),
      "evidenceSha256",
    );
    return { ok: true, value: { ...payload, evidenceSha256 } };
  } catch (error) {
    return decodeFailure(error);
  }
}

export function decodeH05TraceEvidenceJson(
  raw: string,
): H05TraceEvidenceDecode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure("artifact must contain valid JSON.");
  }
  const decoded = decodeH05TraceEvidence(parsed);
  if (!decoded.ok) return decoded;
  if (raw !== serializeH05TraceEvidence(decoded.value)) {
    return failure("artifact must use canonical JSON serialization.");
  }
  return decoded;
}

export function verifyH05TraceEvidenceDependencies(
  traceValue: unknown,
  controlPlaneBeforeValue: unknown,
  dataPlaneValue: unknown,
  controlPlaneAfterValue: unknown,
): H05TraceEvidenceDependencyCheck {
  try {
    const trace = decodeH05TraceEvidence(traceValue);
    if (!trace.ok) throw new Error(trace.message);
    const dependencies = decodeDependencies(
      controlPlaneBeforeValue,
      dataPlaneValue,
      controlPlaneAfterValue,
    );
    validateDependencyRelationship(dependencies);
    validateTraceDependencies(trace.value, dependencies);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function validateH05TraceEvidenceDependencies(
  controlPlaneBeforeValue: unknown,
  dataPlaneValue: unknown,
  controlPlaneAfterValue: unknown,
): H05TraceEvidenceDependencyCheck {
  try {
    validateDependencyRelationship(
      decodeDependencies(
        controlPlaneBeforeValue,
        dataPlaneValue,
        controlPlaneAfterValue,
      ),
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function serializeH05TraceEvidence(
  evidence: H05TraceEvidence,
): string {
  const decoded = decodeH05TraceEvidence(evidence);
  if (!decoded.ok) throw new Error(decoded.message);
  return formatH05JsonDocument(decoded.value);
}

export function serializeH05TraceEvidencePayload(
  payload: H05TraceEvidencePayload,
): string {
  const decoded = decodeTracePayload(payload, "$payload");
  validateTracePayload(decoded);
  return formatH05JsonDocument(decoded);
}

export function serializeH05NormalizedTraceEvidence(
  traces: unknown,
): string {
  const decoded = decodeTraces(traces, "$traces");
  validateTraceFacts(decoded);
  return formatH05JsonDocument(decoded);
}

export function h05NormalizedTraceEvidenceSha256(
  traces: unknown,
): H05TraceSha256 {
  return sha256(serializeH05NormalizedTraceEvidence(traces));
}

export function h05TraceIdHashSetSha256(
  traces: unknown,
): H05TraceSha256 {
  const decoded = decodeTraces(traces, "$traces");
  validateTraceFacts(decoded);
  const traceIdHashes = decoded
    .map((trace) => trace.traceIdSha256)
    .sort(compareUtf16Strings);
  if (new Set(traceIdHashes).size !== traceIdHashes.length) {
    throw new Error("H05 trace ID hashes must be unique.");
  }
  return sha256(
    `flarex-h05-trace-id-hash-set-v1\0${JSON.stringify(traceIdHashes)}`,
  );
}

export function h05TraceIdSha256(rawTraceId: string): H05TraceSha256 {
  const validated = opaqueIdentifier(rawTraceId, "rawTraceId");
  return sha256(`flarex-h05-trace-id-v1\0${validated}`);
}

export function decodeH05TraceCloudflareResourceId(
  value: string,
): H05CloudflareResourceId {
  return cloudflareResourceId(value, "Cloudflare resource ID");
}

export function h05TelemetryEventIdsSha256(
  rawEventIds: readonly string[],
): H05TraceSha256 {
  if (rawEventIds.length === 0) {
    throw new Error("H05 telemetry event ID set must not be empty.");
  }
  const unique = new Set<string>();
  const hashes = rawEventIds.map((rawEventId, index) => {
    const validated = opaqueIdentifier(rawEventId, `rawEventIds[${index}]`);
    if (unique.has(validated)) {
      throw new Error("H05 telemetry event IDs must be unique.");
    }
    unique.add(validated);
    return sha256(`flarex-h05-telemetry-event-id-v1\0${validated}`);
  });
  hashes.sort();
  return sha256(
    `flarex-h05-telemetry-event-id-set-v1\0${JSON.stringify(hashes)}`,
  );
}

function decodeDependencies(
  controlPlaneBeforeValue: unknown,
  dataPlaneValue: unknown,
  controlPlaneAfterValue: unknown,
): H05TraceEvidenceDependencies {
  const controlPlaneBefore = decodeH05ControlPlaneEvidence(
    controlPlaneBeforeValue,
  );
  if (!controlPlaneBefore.ok) throw new Error(controlPlaneBefore.message);
  const dataPlane = decodeH05DataPlaneEvidence(dataPlaneValue);
  if (!dataPlane.ok) throw new Error(dataPlane.message);
  const controlPlaneAfter = decodeH05ControlPlaneEvidence(controlPlaneAfterValue);
  if (!controlPlaneAfter.ok) throw new Error(controlPlaneAfter.message);
  return {
    controlPlaneAfter: controlPlaneAfter.value,
    controlPlaneBefore: controlPlaneBefore.value,
    dataPlane: dataPlane.value,
  };
}

function validateDependencyRelationship(
  dependencies: H05TraceEvidenceDependencies,
): void {
  const { controlPlaneAfter, controlPlaneBefore, dataPlane } = dependencies;
  exactValue(
    controlPlaneBefore.source.commit,
    dataPlane.source.commit,
    "controlPlaneBefore.source.commit",
  );
  exactValue(
    controlPlaneAfter.source.commit,
    dataPlane.source.commit,
    "controlPlaneAfter.source.commit",
  );
  exactValue(
    controlPlaneBefore.run.runId,
    dataPlane.run.runId,
    "controlPlaneBefore.run.runId",
  );
  exactValue(
    controlPlaneAfter.run.runId,
    dataPlane.run.runId,
    "controlPlaneAfter.run.runId",
  );
  exactValue(
    controlPlaneBefore.run.deploymentId,
    dataPlane.run.deploymentId,
    "controlPlaneBefore.run.deploymentId",
  );
  exactValue(
    controlPlaneAfter.run.deploymentId,
    dataPlane.run.deploymentId,
    "controlPlaneAfter.run.deploymentId",
  );
  exactValue(
    controlPlaneBefore.run.projectId,
    dataPlane.run.projectId,
    "controlPlaneBefore.run.projectId",
  );
  exactValue(
    controlPlaneAfter.run.projectId,
    dataPlane.run.projectId,
    "controlPlaneAfter.run.projectId",
  );
  orderedTimestamps(
    isoTimestamp(
      controlPlaneBefore.window.finishedAt,
      "controlPlaneBefore.window.finishedAt",
    ),
    isoTimestamp(dataPlane.window.startedAt, "dataPlane.window.startedAt"),
    "control-plane-before-to-data-plane",
  );
  orderedTimestamps(
    isoTimestamp(dataPlane.window.finishedAt, "dataPlane.window.finishedAt"),
    isoTimestamp(
      controlPlaneAfter.window.startedAt,
      "controlPlaneAfter.window.startedAt",
    ),
    "data-plane-to-control-plane-after",
  );
  exactValue(
    canonicalControlPlaneConfiguration(controlPlaneBefore),
    canonicalControlPlaneConfiguration(controlPlaneAfter),
    "control-plane configuration fence",
  );
}

function canonicalControlPlaneConfiguration(
  evidence: H05ControlPlaneEvidence,
): string {
  const hyperdrive = evidence.hyperdrive.opening;
  const executorDeployment = evidence.executor.deploymentBefore;
  const probeDeployment = evidence.probe.deploymentBefore;
  const privacy = evidence.executor.privacy.opening;
  return JSON.stringify({
    accountIdSha256: evidence.accountIdSha256,
    accountWorkersSubdomain: evidence.accountWorkersSubdomain.opening,
    source: evidence.source,
    run: evidence.run,
    hyperdrive: {
      cachingDisabled: hyperdrive.cachingDisabled,
      id: hyperdrive.id,
      name: hyperdrive.name,
      originDatabaseSha256: hyperdrive.originDatabaseSha256,
      originHostSha256: hyperdrive.originHostSha256,
      originPort: hyperdrive.originPort,
      originScheme: hyperdrive.originScheme,
      tlsMode: hyperdrive.tlsMode,
    },
    executor: {
      deployment: {
        deploymentId: executorDeployment.deploymentId,
        trafficPercentage: executorDeployment.trafficPercentage,
        versionId: executorDeployment.versionId,
      },
      secrets: evidence.executor.opening.secrets,
      subdomain: evidence.executor.opening.subdomain,
      version: evidence.executor.opening.version,
      privacy: {
        customDomains: privacy.customDomains,
        directRequest: privacy.directRequest,
        routes: privacy.routes,
        tokenScopeAttestation:
          evidence.executor.privacy.tokenScopeAttestation,
        zones: privacy.zones,
      },
    },
    probe: {
      deployment: {
        deploymentId: probeDeployment.deploymentId,
        trafficPercentage: probeDeployment.trafficPercentage,
        versionId: probeDeployment.versionId,
      },
      publicOrigin: evidence.probe.publicOrigin,
      secrets: evidence.probe.opening.secrets,
      subdomain: evidence.probe.opening.subdomain,
      version: evidence.probe.opening.version,
    },
  });
}

function validateTraceDependencies(
  evidence: H05TraceEvidencePayload,
  dependencies: H05TraceEvidenceDependencies,
): void {
  const { controlPlaneAfter, controlPlaneBefore, dataPlane } = dependencies;
  exactValue(evidence.source.commit, dataPlane.source.commit, "source.commit");
  exactValue(
    evidence.source.wranglerVersion,
    controlPlaneBefore.source.wranglerVersion,
    "source.wranglerVersion",
  );
  exactValue(
    evidence.accountIdSha256,
    controlPlaneBefore.accountIdSha256,
    "accountIdSha256",
  );
  exactValue(evidence.run.runId, dataPlane.run.runId, "run.runId");
  exactValue(
    evidence.run.deploymentId,
    dataPlane.run.deploymentId,
    "run.deploymentId",
  );
  exactValue(evidence.run.projectId, dataPlane.run.projectId, "run.projectId");
  exactValue(
    evidence.inputs.controlPlaneBeforeEvidenceSha256,
    controlPlaneBefore.evidenceSha256,
    "inputs.controlPlaneBeforeEvidenceSha256",
  );
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
    evidence.inputs.executorVersionId,
    controlPlaneBefore.executor.opening.version.versionId,
    "inputs.executorVersionId",
  );
  exactValue(
    evidence.inputs.probeVersionId,
    controlPlaneBefore.probe.opening.version.versionId,
    "inputs.probeVersionId",
  );
  exactValue(
    evidence.inputs.probePath,
    h05ProbeEndpoint(dataPlane.run.runId),
    "inputs.probePath",
  );
  exactValue(
    evidence.window.dataPlane.startedAt,
    dataPlane.window.startedAt,
    "window.dataPlane.startedAt",
  );
  exactValue(
    evidence.window.dataPlane.finishedAt,
    dataPlane.window.finishedAt,
    "window.dataPlane.finishedAt",
  );
  orderedTimestamps(
    isoTimestamp(
      controlPlaneAfter.window.finishedAt,
      "controlPlaneAfter.window.finishedAt",
    ),
    evidence.window.collection.startedAt,
    "control-plane-after-to-trace-collection",
  );
}

function decodeTracePayload(
  value: unknown,
  path: string,
  exact = true,
): H05TraceEvidencePayload {
  const expectedKeys = [
    "accountIdSha256",
    "format",
    "inputs",
    "query",
    "redaction",
    "run",
    "source",
    "traces",
    "window",
  ] as const;
  const record = exact
    ? exactRecord(value, path, expectedKeys)
    : recordWithRequiredKeys(value, path, expectedKeys);
  const redaction = exactRecord(record.redaction, `${path}.redaction`, [
    "headersAndBodies",
    "messagesAndErrors",
    "rawTelemetrySource",
    "requestUrls",
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
    "controlPlaneBeforeEvidenceSha256",
    "dataPlaneEvidenceSha256",
    "executorVersionId",
    "probePath",
    "probeVersionId",
  ]);
  const window = exactRecord(record.window, `${path}.window`, [
    "collection",
    "dataPlane",
    "observed",
  ]);
  const query = exactRecord(record.query, `${path}.query`, [
    "detailSelection",
    "discoverySelection",
    "eventPageLimit",
    "eventPagination",
    "observations",
    "queryComplete",
    "samplingRate",
    "source",
    "stableObservationCount",
    "traceLimit",
    "traceSummaryCompleteness",
  ]);
  return {
    format: literal(record.format, h05TraceEvidenceFormat, `${path}.format`),
    redaction: {
      headersAndBodies: literal(
        redaction.headersAndBodies,
        "omitted",
        `${path}.redaction.headersAndBodies`,
      ),
      messagesAndErrors: literal(
        redaction.messagesAndErrors,
        "omitted",
        `${path}.redaction.messagesAndErrors`,
      ),
      rawTelemetrySource: literal(
        redaction.rawTelemetrySource,
        "omitted",
        `${path}.redaction.rawTelemetrySource`,
      ),
      requestUrls: literal(
        redaction.requestUrls,
        "omitted",
        `${path}.redaction.requestUrls`,
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
      deploymentId: boundedIdentifier(
        run.deploymentId,
        `${path}.run.deploymentId`,
      ),
      projectId: boundedIdentifier(run.projectId, `${path}.run.projectId`),
      runId: decodedRunId.value,
    },
    inputs: {
      controlPlaneAfterEvidenceSha256: sha256String(
        inputs.controlPlaneAfterEvidenceSha256,
        `${path}.inputs.controlPlaneAfterEvidenceSha256`,
      ),
      controlPlaneBeforeEvidenceSha256: sha256String(
        inputs.controlPlaneBeforeEvidenceSha256,
        `${path}.inputs.controlPlaneBeforeEvidenceSha256`,
      ),
      dataPlaneEvidenceSha256: sha256String(
        inputs.dataPlaneEvidenceSha256,
        `${path}.inputs.dataPlaneEvidenceSha256`,
      ),
      executorVersionId: cloudflareResourceId(
        inputs.executorVersionId,
        `${path}.inputs.executorVersionId`,
      ),
      probePath: boundedPath(inputs.probePath, `${path}.inputs.probePath`),
      probeVersionId: cloudflareResourceId(
        inputs.probeVersionId,
        `${path}.inputs.probeVersionId`,
      ),
    },
    window: {
      collection: decodeWindow(window.collection, `${path}.window.collection`),
      dataPlane: decodeWindow(window.dataPlane, `${path}.window.dataPlane`),
      observed: decodeObservedWindow(
        window.observed,
        `${path}.window.observed`,
      ),
    },
    query: {
      detailSelection: literal(
        query.detailSelection,
        "all-events-by-exact-trace-id",
        `${path}.query.detailSelection`,
      ),
      discoverySelection: literal(
        query.discoverySelection,
        "probe-root-events-by-service-path-type-and-fetch",
        `${path}.query.discoverySelection`,
      ),
      eventPageLimit: literal(
        query.eventPageLimit,
        h05TelemetryEventPageLimit,
        `${path}.query.eventPageLimit`,
      ),
      eventPagination: literal(
        query.eventPagination,
        "metadata-id-next",
        `${path}.query.eventPagination`,
      ),
      observations: decodeObservations(
        query.observations,
        `${path}.query.observations`,
      ),
      queryComplete: literal(
        query.queryComplete,
        true,
        `${path}.query.queryComplete`,
      ),
      samplingRate: literal(
        query.samplingRate,
        1,
        `${path}.query.samplingRate`,
      ),
      source: literal(
        query.source,
        "cloudflare-observability-api",
        `${path}.query.source`,
      ),
      stableObservationCount: literal(
        query.stableObservationCount,
        h05StableTraceObservationCount,
        `${path}.query.stableObservationCount`,
      ),
      traceSummaryCompleteness: literal(
        query.traceSummaryCompleteness,
        "one-query-per-discovered-trace",
        `${path}.query.traceSummaryCompleteness`,
      ),
      traceLimit: literal(
        query.traceLimit,
        h05TelemetryTraceLimit,
        `${path}.query.traceLimit`,
      ),
    },
    traces: decodeTraces(record.traces, `${path}.traces`),
  };
}

function decodeTraceCollection(
  value: unknown,
  path: string,
): H05TraceCollectionEvidence {
  const record = exactRecord(value, path, ["observations", "traces", "window"]);
  return {
    observations: decodeObservations(record.observations, `${path}.observations`),
    traces: decodeTraces(record.traces, `${path}.traces`),
    window: decodeWindow(record.window, `${path}.window`),
  };
}

function decodeObservations(
  value: unknown,
  path: string,
): readonly H05TraceQueryObservationEvidence[] {
  if (!Array.isArray(value) || value.length !== h05StableTraceObservationCount) {
    failAt(path, `must contain exactly ${h05StableTraceObservationCount} observations.`);
  }
  return value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const record = exactRecord(entry, entryPath, [
      "abrLevel",
      "capturedAt",
      "discoveryEventPageCount",
      "normalizedEvidenceSha256",
      "terminalPagesObserved",
      "traceEventPageCount",
      "traceSummaryQueryCount",
    ]);
    return {
      abrLevel: literal(record.abrLevel, 1, `${entryPath}.abrLevel`),
      capturedAt: isoTimestamp(record.capturedAt, `${entryPath}.capturedAt`),
      discoveryEventPageCount: boundedPositiveInteger(
        record.discoveryEventPageCount,
        h05MaximumTelemetryEventPages,
        `${entryPath}.discoveryEventPageCount`,
      ),
      normalizedEvidenceSha256: sha256String(
        record.normalizedEvidenceSha256,
        `${entryPath}.normalizedEvidenceSha256`,
      ),
      terminalPagesObserved: literal(
        record.terminalPagesObserved,
        true,
        `${entryPath}.terminalPagesObserved`,
      ),
      traceEventPageCount: boundedPositiveInteger(
        record.traceEventPageCount,
        expectedTraceEventMaximumPageCount(),
        `${entryPath}.traceEventPageCount`,
      ),
      traceSummaryQueryCount: literal(
        record.traceSummaryQueryCount,
        15,
        `${entryPath}.traceSummaryQueryCount`,
      ),
    };
  });
}

function decodeTraces(
  value: unknown,
  path: string,
): readonly H05NormalizedTraceEvidence[] {
  const expectedTraceCount =
    h05AuthorizedInvocationCount + h05UnauthorizedInvocationCount;
  if (!Array.isArray(value) || value.length !== expectedTraceCount) {
    failAt(path, `must contain exactly ${expectedTraceCount} traces.`);
  }
  return value.map((entry, index) => decodeTrace(entry, `${path}[${index}]`));
}

function decodeTrace(value: unknown, path: string): H05NormalizedTraceEvidence {
  if (!isRecord(value)) failAt(path, "must be an object.");
  if (value.kind === "authorized") {
    const record = exactRecord(value, path, [
      "eventCount",
      "eventIdsSha256",
      "executor",
      "executorParentLinked",
      "finishedAt",
      "kind",
      "probe",
      "services",
      "spanCount",
      "startedAt",
      "traceIdSha256",
    ]);
    return {
      kind: literal(record.kind, "authorized", `${path}.kind`),
      traceIdSha256: sha256String(
        record.traceIdSha256,
        `${path}.traceIdSha256`,
      ),
      eventCount: positiveSafeInteger(record.eventCount, `${path}.eventCount`),
      eventIdsSha256: sha256String(
        record.eventIdsSha256,
        `${path}.eventIdsSha256`,
      ),
      startedAt: isoTimestamp(record.startedAt, `${path}.startedAt`),
      finishedAt: isoTimestamp(record.finishedAt, `${path}.finishedAt`),
      spanCount: positiveSafeInteger(record.spanCount, `${path}.spanCount`),
      services: decodeExactH05StringTuple(
        record.services,
        [h05ExecutorWorkerName, h05ProbeWorkerName],
        `${path}.services`,
        fail,
      ),
      probe: decodeInvocation(record.probe, `${path}.probe`, "probe"),
      executor: decodeInvocation(
        record.executor,
        `${path}.executor`,
        "executor",
      ),
      executorParentLinked: literal(
        record.executorParentLinked,
        true,
        `${path}.executorParentLinked`,
      ),
    };
  }
  if (value.kind === "unauthorized") {
    const record = exactRecord(value, path, [
      "eventCount",
      "eventIdsSha256",
      "finishedAt",
      "kind",
      "probe",
      "services",
      "spanCount",
      "startedAt",
      "traceIdSha256",
    ]);
    return {
      kind: literal(record.kind, "unauthorized", `${path}.kind`),
      traceIdSha256: sha256String(
        record.traceIdSha256,
        `${path}.traceIdSha256`,
      ),
      eventCount: positiveSafeInteger(record.eventCount, `${path}.eventCount`),
      eventIdsSha256: sha256String(
        record.eventIdsSha256,
        `${path}.eventIdsSha256`,
      ),
      startedAt: isoTimestamp(record.startedAt, `${path}.startedAt`),
      finishedAt: isoTimestamp(record.finishedAt, `${path}.finishedAt`),
      spanCount: positiveSafeInteger(record.spanCount, `${path}.spanCount`),
      services: decodeExactH05StringTuple(
        record.services,
        [h05ProbeWorkerName],
        `${path}.services`,
        fail,
      ),
      probe: decodeInvocation(record.probe, `${path}.probe`, "probe"),
    };
  }
  failAt(`${path}.kind`, "must be authorized or unauthorized.");
}

function decodeInvocation(
  value: unknown,
  path: string,
  role: "executor" | "probe",
): H05TraceInvocationEvidence {
  const record = exactRecord(value, path, [
    "eventType",
    "finishedAt",
    "outcome",
    "startedAt",
    "statusCode",
    "truncated",
    "versionId",
    "workerName",
  ]);
  const statusCode = oneOfNumbers(
    record.statusCode,
    [200, 401, 409],
    `${path}.statusCode`,
  );
  return {
    eventType: literal(record.eventType, "fetch", `${path}.eventType`),
    finishedAt: isoTimestamp(record.finishedAt, `${path}.finishedAt`),
    outcome: literal(record.outcome, "ok", `${path}.outcome`),
    startedAt: isoTimestamp(record.startedAt, `${path}.startedAt`),
    statusCode,
    truncated: literal(record.truncated, false, `${path}.truncated`),
    versionId: cloudflareResourceId(record.versionId, `${path}.versionId`),
    workerName: literal(
      record.workerName,
      role === "executor" ? h05ExecutorWorkerName : h05ProbeWorkerName,
      `${path}.workerName`,
    ),
  };
}

function validateTracePayload(payload: H05TraceEvidencePayload): void {
  const identity = h05ProofIdentity(payload.run.runId);
  exactValue(payload.run.deploymentId, identity.deploymentId, "run.deploymentId");
  exactValue(payload.run.projectId, identity.projectId, "run.projectId");
  exactValue(
    payload.inputs.probePath,
    h05ProbeEndpoint(payload.run.runId),
    "inputs.probePath",
  );
  orderedWindow(payload.window.dataPlane, "window.dataPlane");
  orderedWindow(payload.window.collection, "window.collection");
  orderedTimestamps(
    payload.window.dataPlane.finishedAt,
    payload.window.collection.startedAt,
    "data-plane-to-trace-collection",
  );
  orderedTimestamps(
    payload.window.observed.firstAt,
    payload.window.observed.lastAt,
    "window.observed",
  );
  timestampInWindow(
    payload.window.observed.firstAt,
    "window.observed.firstAt",
    payload.window.dataPlane,
  );
  timestampInWindow(
    payload.window.observed.lastAt,
    "window.observed.lastAt",
    payload.window.dataPlane,
  );
  validateTraceFacts(payload.traces, payload);
  validateObservations(payload.query.observations, payload);
}

function validateTraceFacts(
  traces: readonly H05NormalizedTraceEvidence[],
  payload?: H05TraceEvidencePayload,
): void {
  const traceIdHashes = new Set<string>();
  const eventIdHashes = new Set<string>();
  let unauthorizedCount = 0;
  let authorizedCount = 0;
  let authorizedSuccessCount = 0;
  let authorizedConflictCount = 0;
  let previousTraceId: string | undefined;

  for (const trace of traces) {
    if (
      previousTraceId !== undefined &&
      trace.traceIdSha256 <= previousTraceId
    ) {
      fail("traces must be sorted by unique traceIdSha256.");
    }
    previousTraceId = trace.traceIdSha256;
    addUnique(traceIdHashes, trace.traceIdSha256, "trace ID hash");
    addUnique(eventIdHashes, trace.eventIdsSha256, "event ID aggregate hash");
    if (trace.eventCount < trace.spanCount) {
      fail("trace eventCount must be at least its spanCount.");
    }
    orderedTimestamps(
      trace.startedAt,
      trace.finishedAt,
      `trace ${trace.traceIdSha256}`,
    );
    if (payload !== undefined) {
      timestampInWindow(
        trace.startedAt,
        `trace ${trace.traceIdSha256}.startedAt`,
        payload.window.dataPlane,
      );
      timestampInWindow(
        trace.finishedAt,
        `trace ${trace.traceIdSha256}.finishedAt`,
        payload.window.dataPlane,
      );
    }
    validateInvocationWithinTrace(trace.probe, trace);
    if (payload !== undefined) {
      exactValue(
        trace.probe.versionId,
        payload.inputs.probeVersionId,
        `trace ${trace.traceIdSha256}.probe.versionId`,
      );
    }

    if (trace.kind === "unauthorized") {
      unauthorizedCount += 1;
      if (trace.eventCount < 1) fail("unauthorized traces must contain events.");
      exactValue(trace.probe.statusCode, 401, "unauthorized probe statusCode");
      continue;
    }

    authorizedCount += 1;
    if (trace.eventCount < 2) {
      fail("authorized traces must contain both Worker invocation events.");
    }
    validateInvocationWithinTrace(trace.executor, trace);
    timestampInWindow(
      trace.executor.startedAt,
      `trace ${trace.traceIdSha256}.executor.startedAt`,
      {
        startedAt: trace.probe.startedAt,
        finishedAt: trace.probe.finishedAt,
      },
    );
    timestampInWindow(
      trace.executor.finishedAt,
      `trace ${trace.traceIdSha256}.executor.finishedAt`,
      {
        startedAt: trace.probe.startedAt,
        finishedAt: trace.probe.finishedAt,
      },
    );
    if (payload !== undefined) {
      exactValue(
        trace.executor.versionId,
        payload.inputs.executorVersionId,
        `trace ${trace.traceIdSha256}.executor.versionId`,
      );
    }
    exactValue(
      trace.probe.statusCode,
      trace.executor.statusCode,
      `trace ${trace.traceIdSha256} propagated statusCode`,
    );
    if (trace.probe.statusCode === 200) authorizedSuccessCount += 1;
    if (trace.probe.statusCode === 409) authorizedConflictCount += 1;
    if (trace.probe.statusCode === 401) {
      fail("authorized traces must not return HTTP 401.");
    }
  }

  exactValue(authorizedCount, h05AuthorizedInvocationCount, "authorized trace count");
  exactValue(
    unauthorizedCount,
    h05UnauthorizedInvocationCount,
    "unauthorized trace count",
  );
  exactValue(
    authorizedSuccessCount,
    h05AuthorizedSuccessStatusCount,
    "authorized HTTP 200 trace count",
  );
  exactValue(
    authorizedConflictCount,
    h05AuthorizedConflictStatusCount,
    "authorized HTTP 409 trace count",
  );
}

function validateInvocationWithinTrace(
  invocation: H05TraceInvocationEvidence,
  trace: H05NormalizedTraceEvidence,
): void {
  orderedTimestamps(
    invocation.startedAt,
    invocation.finishedAt,
    `trace ${trace.traceIdSha256} ${invocation.workerName} invocation`,
  );
  timestampInWindow(
    invocation.startedAt,
    `${invocation.workerName}.startedAt`,
    { startedAt: trace.startedAt, finishedAt: trace.finishedAt },
  );
  timestampInWindow(
    invocation.finishedAt,
    `${invocation.workerName}.finishedAt`,
    { startedAt: trace.startedAt, finishedAt: trace.finishedAt },
  );
}

function validateObservations(
  observations: readonly H05TraceQueryObservationEvidence[],
  payload: H05TraceEvidencePayload,
): void {
  const normalizedEvidenceSha256 = sha256(
    serializeH05NormalizedTraceEvidence(payload.traces),
  );
  let previousCapturedAt: H05IsoTimestamp | undefined;
  for (const observation of observations) {
    exactValue(
      observation.normalizedEvidenceSha256,
      normalizedEvidenceSha256,
      "query.observations.normalizedEvidenceSha256",
    );
    timestampInWindow(
      observation.capturedAt,
      "query.observations.capturedAt",
      payload.window.collection,
    );
    if (previousCapturedAt !== undefined) {
      orderedTimestamps(
        previousCapturedAt,
        observation.capturedAt,
        "query observation",
      );
    }
    previousCapturedAt = observation.capturedAt;
    const expectedTraceCount =
      h05AuthorizedInvocationCount + h05UnauthorizedInvocationCount;
    if (observation.traceEventPageCount < expectedTraceCount) {
      fail("each stable observation must query at least one event page per trace.");
    }
  }
}

function expectedTraceEventMaximumPageCount(): number {
  return (
    (h05AuthorizedInvocationCount + h05UnauthorizedInvocationCount) *
    h05MaximumTelemetryEventPages
  );
}

function decodeWindow(
  value: unknown,
  path: string,
): { readonly finishedAt: H05IsoTimestamp; readonly startedAt: H05IsoTimestamp } {
  return decodeH05EvidenceWindow(
    value,
    path,
    exactRecord,
    isoTimestamp,
    "finishedAtFirst",
  );
}

function decodeObservedWindow(
  value: unknown,
  path: string,
): { readonly firstAt: H05IsoTimestamp; readonly lastAt: H05IsoTimestamp } {
  const record = exactRecord(value, path, ["firstAt", "lastAt"]);
  return {
    firstAt: isoTimestamp(record.firstAt, `${path}.firstAt`),
    lastAt: isoTimestamp(record.lastAt, `${path}.lastAt`),
  };
}

function orderedWindow(
  window: { readonly finishedAt: H05IsoTimestamp; readonly startedAt: H05IsoTimestamp },
  path: string,
): void {
  orderedTimestamps(window.startedAt, window.finishedAt, path);
}

function orderedTimestamps(
  earlier: H05IsoTimestamp,
  later: H05IsoTimestamp,
  path: string,
): void {
  requireOrderedH05Timestamps(earlier, later, path, fail);
}

function timestampInWindow(
  value: H05IsoTimestamp,
  path: string,
  window: { readonly finishedAt: H05IsoTimestamp; readonly startedAt: H05IsoTimestamp },
): void {
  const timestamp = timestampMs(value);
  if (
    timestamp < timestampMs(window.startedAt) ||
    timestamp > timestampMs(window.finishedAt)
  ) {
    fail(`${path} must fall inside its required window.`);
  }
}

function timestampMs(value: H05IsoTimestamp): number {
  return Date.parse(value);
}

function exactRecord(
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  return requireExactH05Record(value, path, expectedKeys, failAt);
}

function recordWithRequiredKeys(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) failAt(path, "must be an object.");
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) failAt(path, `must contain ${key}.`);
  }
  return value;
}

function sha256String(value: unknown, path: string): H05TraceSha256 {
  if (!isH05LowercaseSha256Digest(value)) {
    failAt(path, "must be a lowercase SHA-256 digest.");
  }
  return value as H05TraceSha256;
}

function gitCommit(value: unknown, path: string): H05TraceGitCommit {
  if (!isH05FullLowercaseGitCommit(value)) {
    failAt(path, "must be a full lowercase Git commit ID.");
  }
  return value as H05TraceGitCommit;
}

function wranglerVersion(value: unknown, path: string): string {
  if (typeof value !== "string") {
    failAt(path, "must be a supported Wrangler 4 version.");
  }
  if (!isH05SupportedWranglerVersion(value)) {
    failAt(path, "must be a supported Wrangler 4 version.");
  }
  return value;
}

function isoTimestamp(value: unknown, path: string): H05IsoTimestamp {
  if (typeof value !== "string") failAt(path, "must be an ISO timestamp.");
  if (!isH05CanonicalIsoTimestamp(value)) {
    failAt(path, "must be a canonical ISO timestamp.");
  }
  return value as H05IsoTimestamp;
}

function cloudflareResourceId(
  value: unknown,
  path: string,
): H05CloudflareResourceId {
  return opaqueIdentifier(value, path) as H05CloudflareResourceId;
}

function opaqueIdentifier(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    failAt(path, "must be a bounded opaque identifier.");
  }
  return value;
}

function boundedIdentifier(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    failAt(path, "must be a bounded non-whitespace identifier.");
  }
  return value;
}

function boundedPath(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > 256 ||
    !value.startsWith("/") ||
    value.includes("?") ||
    value.includes("#") ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    failAt(path, "must be a bounded absolute request path.");
  }
  return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!isPositiveSafeInteger(value)) {
    failAt(path, "must be a positive safe integer.");
  }
  return value;
}

function boundedPositiveInteger(
  value: unknown,
  maximum: number,
  path: string,
): number {
  const decoded = positiveSafeInteger(value, path);
  if (decoded > maximum) {
    failAt(path, `must not exceed ${maximum}.`);
  }
  return decoded;
}

function oneOfNumbers<const Values extends readonly number[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value !== "number" || !values.some((candidate) => candidate === value)) {
    failAt(path, `must be one of ${values.join(", ")}.`);
  }
  return value as Values[number];
}

function literal<const Value extends string | number | boolean>(
  value: unknown,
  expected: Value,
  path: string,
): Value {
  return decodeExactH05Scalar(value, expected, path, fail);
}

function addUnique(values: Set<string>, value: string, name: string): void {
  if (values.has(value)) fail(`${name} values must be unique.`);
  values.add(value);
}

function exactValue(
  actual: string | number,
  expected: string | number,
  path: string,
): void {
  if (actual !== expected) fail(`${path} does not match its joined evidence.`);
}

function sha256(value: string): H05TraceSha256 {
  return h05Sha256Utf8(value) as H05TraceSha256;
}

function decodeFailure(error: unknown): H05TraceEvidenceDecode {
  const detail = error instanceof Error ? error.message : String(error);
  return failure(detail);
}

function failure(message: string): H05TraceEvidenceDecode {
  return {
    ok: false,
    message: message.startsWith("Invalid H05 trace evidence:")
      ? message
      : `Invalid H05 trace evidence: ${message}`,
  };
}

function failAt(path: string, message: string): never {
  fail(`${path} ${message}`);
}

function fail(message: string): never {
  throw new Error(`Invalid H05 trace evidence: ${message}`);
}
