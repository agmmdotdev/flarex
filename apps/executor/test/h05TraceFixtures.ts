import {
  compileH05ControlPlaneEvidence,
  h05CloudflareAccountIdSha256,
  h05ControlPlaneEvidenceFormat,
  h05ZoneTypes,
  type H05BindingEvidence,
  type H05ControlPlaneEvidence,
  type H05ExecutorPrivacySnapshotEvidence,
  type H05ExecutorWorkerVersionEvidence,
  type H05HyperdriveSnapshotEvidence,
  type H05ProbeWorkerVersionEvidence,
  type H05TraceSettingsEvidence,
} from "../h05/controlPlaneEvidence";
import { decodeH05ProofRunId, h05ProofIdentity } from "../h05/proofIdentity";
import {
  compileH05DataPlaneEvidence,
  compileH05InvocationReceipt,
  h05DataPlaneEvidenceFormat,
  type H05DataPlaneEvidence,
} from "../h05/receipt";
import {
  compileH05ProbeTeardownEvidence,
  h05ProbeTeardownMaximumAttempts,
  h05ProbeTeardownPollIntervalMs,
  h05ProbeTeardownStableObservationCount,
  type H05ProbeTeardownEvidence,
} from "../h05/probeTeardownEvidence";
import {
  compileH05TraceEvidence,
  decodeH05TraceCloudflareResourceId,
  h05NormalizedTraceEvidenceSha256,
  h05TelemetryEventIdsSha256,
  h05TraceIdSha256,
  type H05TraceEvidence,
} from "../h05/traceEvidence";

export const h05TraceFixtureAccountId = "a".repeat(32);
export const h05TraceFixtureCommit = "b".repeat(40);
export const h05TraceFixtureExecutorVersionId = "executor-version-1";
export const h05TraceFixtureProbeVersionId = "probe-version-1";
export const h05TraceFixtureProbePath = "/__flarex_h05/invoke/run_a";

export function validH05TraceControlPlaneEvidence(
  phase: "after" | "before",
): H05ControlPlaneEvidence {
  const baseMinute = phase === "before" ? "00" : "03";
  const timestamp = (seconds: string): string =>
    `2026-07-11T10:${baseMinute}:${seconds}Z`;
  const hyperdriveId = "c".repeat(32);
  const executorBindings: readonly H05BindingEvidence[] = [
    { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
    {
      type: "hyperdrive",
      name: "HYPERDRIVE_CACHE_DISABLED",
      id: hyperdriveId,
    },
  ];
  const probeBindings: readonly H05BindingEvidence[] = [
    {
      type: "service",
      name: "FLAREX_EXECUTOR",
      service: "flarex-executor",
    },
    { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
    { type: "secret_text", name: "FLAREX_H05_PROBE_TOKEN" },
    { type: "secret_text", name: "FLAREX_H05_RUN_ID" },
  ];
  const runId = decodeH05ProofRunId("run_a");
  if (!runId.ok) throw new Error(runId.message);
  const identity = h05ProofIdentity(runId.value);
  const compiled = compileH05ControlPlaneEvidence({
    format: h05ControlPlaneEvidenceFormat,
    accountIdSha256: h05CloudflareAccountIdSha256(h05TraceFixtureAccountId),
    source: {
      commit: h05TraceFixtureCommit,
      worktreeClean: true,
      wranglerVersion: "4.100.0",
    },
    window: {
      startedAt: timestamp("00.000"),
      finishedAt: timestamp("07.000"),
    },
    run: {
      runId: identity.runId,
      deploymentId: identity.deploymentId,
      projectId: identity.projectId,
    },
    accountWorkersSubdomain: { opening: "example", closing: "example" },
    hyperdrive: {
      opening: hyperdriveSnapshot(timestamp("01.000"), hyperdriveId),
      closing: hyperdriveSnapshot(timestamp("06.500"), hyperdriveId),
    },
    executor: {
      deploymentBefore: {
        deploymentId: "executor-deployment-1",
        versionId: h05TraceFixtureExecutorVersionId,
        trafficPercentage: 100,
        observedAt: timestamp("02.000"),
      },
      opening: {
        version: workerVersion(
          h05TraceFixtureExecutorVersionId,
          "smart",
          executorBindings,
        ),
        secrets: [{ type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" }],
        subdomain: { enabled: false, previewsEnabled: false },
      },
      privacy: {
        tokenScopeAttestation: "operator-attested-all-account-zones",
        opening: privacySnapshot(timestamp("03.500")),
        closing: privacySnapshot(timestamp("04.000")),
      },
      closing: {
        version: workerVersion(
          h05TraceFixtureExecutorVersionId,
          "smart",
          executorBindings,
        ),
        secrets: [{ type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" }],
        subdomain: { enabled: false, previewsEnabled: false },
      },
      deploymentAfter: {
        deploymentId: "executor-deployment-1",
        versionId: h05TraceFixtureExecutorVersionId,
        trafficPercentage: 100,
        observedAt: timestamp("05.000"),
      },
    },
    probe: {
      deploymentBefore: {
        deploymentId: "probe-deployment-1",
        versionId: h05TraceFixtureProbeVersionId,
        trafficPercentage: 100,
        observedAt: timestamp("03.000"),
      },
      opening: {
        version: workerVersion(
          h05TraceFixtureProbeVersionId,
          "none",
          probeBindings,
        ),
        secrets: probeSecrets(),
        subdomain: { enabled: true, previewsEnabled: false },
      },
      publicOrigin: "https://flarex-executor-h05-probe.example.workers.dev",
      closing: {
        version: workerVersion(
          h05TraceFixtureProbeVersionId,
          "none",
          probeBindings,
        ),
        secrets: probeSecrets(),
        subdomain: { enabled: true, previewsEnabled: false },
      },
      deploymentAfter: {
        deploymentId: "probe-deployment-1",
        versionId: h05TraceFixtureProbeVersionId,
        trafficPercentage: 100,
        observedAt: timestamp("06.000"),
      },
    },
  });
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}

export function validH05TraceDataPlaneEvidence(): H05DataPlaneEvidence {
  const runId = decodeH05ProofRunId("run_a");
  if (!runId.ok) throw new Error(runId.message);
  const identity = h05ProofIdentity(runId.value);
  const invocation = compileH05InvocationReceipt({
    source: "hosted-occ-proof-harness",
    unauthorizedStatus: 401,
    unauthorizedHopAbsent: true,
    authorizedResponses: 14,
    hopMarkedResponses: 14,
    noStoreResponses: 15,
    hop: { header: "x-flarex-h05-hop", value: "probe-to-executor" },
    winner: { committedTs: 11, observedTs: 10, state: "finished" },
    stale: {
      conflictStatus: 409,
      observedTs: 10,
      currentTs: 11,
      abortStatus: 200,
      afterAbortStatus: 409,
      state: "aborted",
    },
    fresh: {
      committedTs: 12,
      observedTs: 11,
      previousTs: 11,
      state: "finished",
    },
    sql: {
      sessions: 3,
      activeSessions: 0,
      documentRevisions: 3,
      commits: 2,
      outboxEvents: 2,
      finalTs: 12,
      finalPrevTs: 11,
    },
  });
  if (!invocation.ok) throw new Error(invocation.message);
  const compiled = compileH05DataPlaneEvidence({
    format: h05DataPlaneEvidenceFormat,
    source: { commit: h05TraceFixtureCommit, worktreeClean: true },
    window: {
      startedAt: "2026-07-11T10:01:00.000Z",
      finishedAt: "2026-07-11T10:02:30.000Z",
    },
    run: {
      runId: identity.runId,
      deploymentId: identity.deploymentId,
      projectId: identity.projectId,
    },
    invocation: invocation.value,
    postgresCleanup: { proofRowsRemaining: 0 },
  });
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}

export function validH05TraceCollection(): Readonly<Record<string, unknown>> {
  const traces = validH05NormalizedTraces();
  const normalizedEvidenceSha256 = h05NormalizedTraceEvidenceSha256(traces);
  return {
    observations: [
      {
        abrLevel: 1,
        capturedAt: "2026-07-11T10:04:05.000Z",
        discoveryEventPageCount: 1,
        normalizedEvidenceSha256,
        terminalPagesObserved: true,
        traceEventPageCount: 15,
        traceSummaryQueryCount: 15,
      },
      {
        abrLevel: 1,
        capturedAt: "2026-07-11T10:04:10.000Z",
        discoveryEventPageCount: 1,
        normalizedEvidenceSha256,
        terminalPagesObserved: true,
        traceEventPageCount: 15,
        traceSummaryQueryCount: 15,
      },
    ],
    traces,
    window: {
      startedAt: "2026-07-11T10:04:00.000Z",
      finishedAt: "2026-07-11T10:04:15.000Z",
    },
  };
}

export function validH05TraceEvidence(): H05TraceEvidence {
  const compiled = compileH05TraceEvidence(
    validH05TraceControlPlaneEvidence("before"),
    validH05TraceDataPlaneEvidence(),
    validH05TraceControlPlaneEvidence("after"),
    validH05TraceCollection(),
  );
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}

export function validH05ProbeTeardownEvidence(
  outcome: "already-absent" | "deleted" = "deleted",
): H05ProbeTeardownEvidence {
  const compiled = compileH05ProbeTeardownEvidence(
    validH05TraceDataPlaneEvidence(),
    validH05TraceControlPlaneEvidence("after"),
    {
      accountAccess: {
        checkedAt: "2026-07-11T10:03:08.500Z",
        method: "GET",
        selection: "fixed-tag-filter",
        source: "cloudflare-workers-scripts-api",
        status: 200,
      },
      deletion: {
        completedAt: "2026-07-11T10:03:09.000Z",
        forceParameter: "omitted",
        method: "DELETE",
        outcome,
        source: "cloudflare-workers-scripts-api",
        status: outcome === "deleted" ? 200 : 404,
      },
      verification: {
        attemptsUsed: 2,
        maximumAttempts: h05ProbeTeardownMaximumAttempts,
        observations: [
          teardownObservation(1, "2026-07-11T10:03:10.000Z"),
          teardownObservation(2, "2026-07-11T10:03:12.000Z"),
        ],
        pollIntervalMs: h05ProbeTeardownPollIntervalMs,
        requiredConsecutiveObservations:
          h05ProbeTeardownStableObservationCount,
      },
      window: {
        finishedAt: "2026-07-11T10:03:13.000Z",
        startedAt: "2026-07-11T10:03:08.000Z",
      },
    },
  );
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}

export function validH05NormalizedTraces(): readonly Readonly<Record<string, unknown>>[] {
  const traces = Array.from({ length: 15 }, (_value, index) => {
    const rawTraceId = `trace-${index.toString().padStart(8, "0")}`;
    const traceStartMs = Date.parse("2026-07-11T10:01:05.000Z") + index * 1_000;
    const traceFinishMs = traceStartMs + 500;
    const statusCode = index === 0 ? 401 : index >= 13 ? 409 : 200;
    const probe = {
      eventType: "fetch",
      finishedAt: new Date(traceFinishMs).toISOString(),
      outcome: "ok",
      startedAt: new Date(traceStartMs).toISOString(),
      statusCode,
      truncated: false,
      versionId: decodeH05TraceCloudflareResourceId(
        h05TraceFixtureProbeVersionId,
      ),
      workerName: "flarex-executor-h05-probe",
    };
    if (index === 0) {
      return {
        eventCount: 1,
        eventIdsSha256: h05TelemetryEventIdsSha256(["event-probe-00000000"]),
        finishedAt: new Date(traceFinishMs).toISOString(),
        kind: "unauthorized",
        probe,
        services: ["flarex-executor-h05-probe"],
        spanCount: 1,
        startedAt: new Date(traceStartMs).toISOString(),
        traceIdSha256: h05TraceIdSha256(rawTraceId),
      };
    }
    return {
      eventCount: 3,
      eventIdsSha256: h05TelemetryEventIdsSha256([
        `event-probe-${index.toString().padStart(8, "0")}`,
        `event-binding-${index.toString().padStart(8, "0")}`,
        `event-executor-${index.toString().padStart(8, "0")}`,
      ]),
      executor: {
        eventType: "fetch",
        finishedAt: new Date(traceFinishMs - 50).toISOString(),
        outcome: "ok",
        startedAt: new Date(traceStartMs + 100).toISOString(),
        statusCode,
        truncated: false,
        versionId: decodeH05TraceCloudflareResourceId(
          h05TraceFixtureExecutorVersionId,
        ),
        workerName: "flarex-executor",
      },
      executorParentLinked: true,
      finishedAt: new Date(traceFinishMs).toISOString(),
      kind: "authorized",
      probe,
      services: ["flarex-executor", "flarex-executor-h05-probe"],
      spanCount: 3,
      startedAt: new Date(traceStartMs).toISOString(),
      traceIdSha256: h05TraceIdSha256(rawTraceId),
    };
  });
  return [...traces].sort((left, right) =>
    String(left.traceIdSha256).localeCompare(String(right.traceIdSha256)),
  );
}

function privacySnapshot(checkedAt: string): H05ExecutorPrivacySnapshotEvidence {
  return {
    customDomains: {
      filteredCount: 0,
      page: 1,
      totalPages: 1,
      unfilteredTotalCount: 5,
    },
    zones: {
      requestedTypes: h05ZoneTypes,
      pageCount: 1,
      unfilteredTotalCount: 2,
      zoneIds: ["1".repeat(32), "2".repeat(32)],
    },
    routes: {
      checkedZoneIds: ["1".repeat(32), "2".repeat(32)],
      inspectedRouteCount: 3,
      targetRouteCount: 0,
    },
    directRequest: { status: 404 },
    checkedAt,
  };
}

function hyperdriveSnapshot(
  capturedAt: string,
  id: string,
): H05HyperdriveSnapshotEvidence {
  return {
    id,
    name: "flarex_executor_h05",
    originScheme: "postgresql",
    originPort: 5432,
    cachingDisabled: true,
    tlsMode: "require",
    originHostSha256: "d".repeat(64),
    originDatabaseSha256: "e".repeat(64),
    capturedAt,
  };
}

function workerVersion(
  versionId: string,
  placementMode: "smart",
  bindings: readonly H05BindingEvidence[],
): H05ExecutorWorkerVersionEvidence;
function workerVersion(
  versionId: string,
  placementMode: "none",
  bindings: readonly H05BindingEvidence[],
): H05ProbeWorkerVersionEvidence;
function workerVersion(
  versionId: string,
  placementMode: "none" | "smart",
  bindings: readonly H05BindingEvidence[],
): H05ExecutorWorkerVersionEvidence | H05ProbeWorkerVersionEvidence {
  const traceSettings: H05TraceSettingsEvidence = {
    enabled: true,
    persisted: true,
    samplingRate: 1,
  };
  const common = {
    versionId,
    compatibilityDate: "2026-06-14",
    versionBindings: bindings,
    settingsBindings: bindings,
    settingsTraceSettings: traceSettings,
    scriptTraceSettings: traceSettings,
  };
  return placementMode === "smart"
    ? {
        ...common,
        compatibilityFlags: ["nodejs_compat"],
        placementMode,
      }
    : { ...common, compatibilityFlags: [], placementMode };
}

function probeSecrets(): readonly {
  readonly name: string;
  readonly type: "secret_text";
}[] {
  return [
    { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
    { type: "secret_text", name: "FLAREX_H05_PROBE_TOKEN" },
    { type: "secret_text", name: "FLAREX_H05_RUN_ID" },
  ];
}

function teardownObservation(
  attempt: number,
  checkedAt: string,
): Readonly<Record<string, unknown>> {
  return {
    authenticatedScriptLookup: { method: "GET", status: 404 },
    attempt,
    checkedAt,
    publicProbeLookup: {
      authorization: "omitted",
      method: "POST",
      status: 404,
    },
  };
}
