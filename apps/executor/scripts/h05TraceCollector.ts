import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";

import {
  decodeH05ControlPlaneEvidence,
  h05CloudflareAccountIdSha256,
  type H05ControlPlaneEvidence,
} from "../h05/controlPlaneEvidence";
import { h05ProbeEndpoint } from "../h05/probeProtocol";
import {
  decodeH05DataPlaneEvidence,
  h05AuthorizedInvocationCount,
  h05ExecutorWorkerName,
  h05ProbeWorkerName,
  h05UnauthorizedInvocationCount,
  type H05DataPlaneEvidence,
} from "../h05/receipt";
import {
  compileH05TraceEvidence,
  decodeH05TraceCloudflareResourceId,
  h05MaximumTelemetryEventPages,
  h05NormalizedTraceEvidenceSha256,
  h05StableTraceObservationCount,
  h05TelemetryEventIdsSha256,
  h05TelemetryEventPageLimit,
  h05TelemetryTraceLimit,
  h05TraceIdSha256,
  type H05AuthorizedTraceEvidence,
  type H05IsoTimestamp,
  type H05NormalizedTraceEvidence,
  type H05TraceEvidence,
  type H05TraceInvocationEvidence,
  type H05TraceQueryObservationEvidence,
  type H05UnauthorizedTraceEvidence,
  validateH05TraceEvidenceDependencies,
} from "../h05/traceEvidence";
import type {
  H05CloudflareTelemetryApi,
  H05TelemetryFilter,
  H05TelemetryQueryRequest,
  H05TelemetryTimeframe,
} from "./cloudflareTelemetryApi";

export interface H05TraceCollectorOptions {
  readonly accountId: string;
  readonly api: H05CloudflareTelemetryApi;
  readonly controlPlaneAfter: unknown;
  readonly controlPlaneBefore: unknown;
  readonly dataPlane: unknown;
  readonly maximumAttempts?: number;
  readonly now?: () => string;
  readonly settleDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface H05TraceCollectorDependencies {
  readonly controlPlaneAfter: H05ControlPlaneEvidence;
  readonly controlPlaneBefore: H05ControlPlaneEvidence;
  readonly dataPlane: H05DataPlaneEvidence;
}

interface H05TelemetrySweep {
  readonly observation: H05TraceQueryObservationEvidence;
  readonly traces: readonly H05NormalizedTraceEvidence[];
}

interface H05TelemetryEventPage {
  readonly abrLevel: 1;
  readonly count: number;
  readonly events: readonly H05TelemetryEventProjection[];
}

interface H05TelemetryEventSweep {
  readonly events: readonly H05TelemetryEventProjection[];
  readonly pageCount: number;
}

interface H05TelemetryEventProjection {
  readonly eventId: string;
  readonly invocation: H05TelemetryInvocationProjection | undefined;
  readonly parentSpanId: string | undefined;
  readonly service: string;
  readonly spanFinishedAt: number | undefined;
  readonly spanId: string | undefined;
  readonly spanStartedAt: number | undefined;
  readonly statusCode: number | undefined;
  readonly traceId: string;
}

interface H05TelemetryInvocationProjection {
  readonly eventType: "fetch";
  readonly outcome: string;
  readonly path: string;
  readonly requestId: string;
  readonly scriptName: string;
  readonly spanId: string | undefined;
  readonly traceId: string;
  readonly truncated: boolean;
  readonly versionId: string;
}

interface H05TelemetryTraceSummary {
  readonly finishedAt: number;
  readonly services: readonly string[];
  readonly spanCount: number;
  readonly startedAt: number;
  readonly traceId: string;
}

interface H05SpanProjection {
  readonly finishedAt: number;
  readonly parentSpanId: string | undefined;
  readonly service: string;
  readonly spanId: string;
  readonly startedAt: number;
}

interface H05CompletedQueryRun {
  readonly abrLevel: 1;
}

const defaultMaximumAttempts = 12;
const defaultSettleDelayMs = 5_000;
const maximumCollectorAttempts = 100;
const maximumSettleDelayMs = 60_000;
const expectedTraceCount =
  h05AuthorizedInvocationCount + h05UnauthorizedInvocationCount;

export async function collectH05TraceEvidence(
  options: H05TraceCollectorOptions,
): Promise<H05TraceEvidence> {
  const dependencyCheck = validateH05TraceEvidenceDependencies(
    options.controlPlaneBefore,
    options.dataPlane,
    options.controlPlaneAfter,
  );
  if (!dependencyCheck.ok) throw new Error(dependencyCheck.message);
  const dependencies = decodeDependencies(options);
  const accountId = cloudflareAccountId(options.accountId);
  const accountIdSha256 = h05CloudflareAccountIdSha256(accountId);
  if (
    dependencies.controlPlaneBefore.accountIdSha256 !== accountIdSha256 ||
    dependencies.controlPlaneAfter.accountIdSha256 !== accountIdSha256
  ) {
    throw new Error(
      "H05 telemetry account does not match both control-plane evidence artifacts.",
    );
  }
  const maximumAttempts = boundedPositiveInteger(
    options.maximumAttempts ?? defaultMaximumAttempts,
    maximumCollectorAttempts,
    "maximumAttempts",
  );
  const settleDelayMs = boundedPositiveInteger(
    options.settleDelayMs ?? defaultSettleDelayMs,
    maximumSettleDelayMs,
    "settleDelayMs",
  );
  const now = options.now ?? (() => new Date().toISOString());
  const sleep = options.sleep ?? defaultSleep;
  const collectionStartedAt = canonicalIsoTimestamp(
    now(),
    "trace collection startedAt",
  );
  const timeframe = dataPlaneTimeframe(dependencies.dataPlane);
  const probePath = h05ProbeEndpoint(dependencies.dataPlane.run.runId);
  const expectedExecutorVersion =
    dependencies.controlPlaneBefore.executor.opening.version.versionId;
  const expectedProbeVersion =
    dependencies.controlPlaneBefore.probe.opening.version.versionId;

  let candidate: H05TelemetrySweep | undefined;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    let sweep: H05TelemetrySweep;
    try {
      sweep = await collectSweep({
        accountId,
        api: options.api,
        expectedExecutorVersion,
        expectedProbeVersion,
        now,
        probePath,
        timeframe,
      });
    } catch (error) {
      if (!(error instanceof H05TelemetryPendingError)) throw error;
      if (attempt < maximumAttempts) await sleep(settleDelayMs);
      continue;
    }

    if (
      candidate !== undefined &&
      candidate.observation.normalizedEvidenceSha256 ===
        sweep.observation.normalizedEvidenceSha256
    ) {
      const collectionFinishedAt = canonicalIsoTimestamp(
        now(),
        "trace collection finishedAt",
      );
      const compiled = compileH05TraceEvidence(
        dependencies.controlPlaneBefore,
        dependencies.dataPlane,
        dependencies.controlPlaneAfter,
        {
          observations: [candidate.observation, sweep.observation],
          traces: sweep.traces,
          window: {
            startedAt: collectionStartedAt,
            finishedAt: collectionFinishedAt,
          },
        },
      );
      if (!compiled.ok) throw new Error(compiled.message);
      return compiled.value;
    }

    candidate = sweep;
    if (attempt < maximumAttempts) await sleep(settleDelayMs);
  }
  throw new Error(
    `H05 telemetry did not produce ${h05StableTraceObservationCount} stable complete observations within the bounded attempt limit.`,
  );
}

async function collectSweep(options: {
  readonly accountId: string;
  readonly api: H05CloudflareTelemetryApi;
  readonly expectedExecutorVersion: string;
  readonly expectedProbeVersion: string;
  readonly now: () => string;
  readonly probePath: string;
  readonly timeframe: H05TelemetryTimeframe;
}): Promise<H05TelemetrySweep> {
  const discovery = await collectEventSweep({
    accountId: options.accountId,
    api: options.api,
    queryId: "flarex-h05-probe-discovery-v1",
    filters: [
      exactStringFilter("$metadata.service", h05ProbeWorkerName),
      exactStringFilter("$metadata.type", "cf-worker-event"),
      exactStringFilter("$workers.event.request.path", options.probePath),
      exactStringFilter("$workers.eventType", "fetch"),
    ],
    timeframe: options.timeframe,
  });
  if (discovery.events.length === 0) throw new H05TelemetryPendingError();
  const discoveredTraceIds = discovery.events.map((event) => {
    const invocation = requiredInvocation(event, "probe discovery");
    if (
      event.service !== h05ProbeWorkerName ||
      invocation.scriptName !== h05ProbeWorkerName ||
      invocation.path !== options.probePath ||
      invocation.eventType !== "fetch"
    ) {
      throw new Error("H05 telemetry probe discovery did not match its exact filter contract.");
    }
    return event.traceId;
  });
  const traceIds = [...new Set(discoveredTraceIds)];
  if (traceIds.length < expectedTraceCount) throw new H05TelemetryPendingError();
  if (traceIds.length > expectedTraceCount) {
    throw new Error(
      "H05 telemetry probe discovery returned more trace IDs than the data-plane oracle.",
    );
  }

  let traceEventPageCount = 0;
  const normalizedTraces: H05NormalizedTraceEvidence[] = [];
  for (const rawTraceId of traceIds) {
    const traceEvents = await collectEventSweep({
      accountId: options.accountId,
      api: options.api,
      queryId: `flarex-h05-trace-events-${h05TraceIdSha256(rawTraceId).slice(0, 16)}`,
      filters: [exactStringFilter("$metadata.traceId", rawTraceId)],
      timeframe: options.timeframe,
    });
    traceEventPageCount += traceEvents.pageCount;
    const summary = await collectTraceSummary({
      accountId: options.accountId,
      api: options.api,
      queryId: `flarex-h05-trace-summary-${h05TraceIdSha256(rawTraceId).slice(0, 16)}`,
      rawTraceId,
      timeframe: options.timeframe,
    });
    normalizedTraces.push(
      normalizeTrace({
        events: traceEvents.events,
        expectedExecutorVersion: options.expectedExecutorVersion,
        expectedProbeVersion: options.expectedProbeVersion,
        probePath: options.probePath,
        rawTraceId,
        summary,
      }),
    );
  }
  normalizedTraces.sort((left, right) =>
    left.traceIdSha256.localeCompare(right.traceIdSha256),
  );
  const traces: readonly H05NormalizedTraceEvidence[] = normalizedTraces;
  const normalizedEvidenceSha256 = h05NormalizedTraceEvidenceSha256(traces);
  const observation: H05TraceQueryObservationEvidence = {
    abrLevel: 1,
    capturedAt: canonicalIsoTimestamp(nowIso(options.now), "trace observation"),
    discoveryEventPageCount: discovery.pageCount,
    normalizedEvidenceSha256,
    terminalPagesObserved: true,
    traceEventPageCount,
    traceSummaryQueryCount: 15,
  };
  return { observation, traces };
}

async function collectEventSweep(options: {
  readonly accountId: string;
  readonly api: H05CloudflareTelemetryApi;
  readonly filters: readonly H05TelemetryFilter[];
  readonly queryId: string;
  readonly timeframe: H05TelemetryTimeframe;
}): Promise<H05TelemetryEventSweep> {
  const events: H05TelemetryEventProjection[] = [];
  const eventIds = new Set<string>();
  let expectedCount: number | undefined;
  let offset: string | undefined;

  for (let page = 1; page <= h05MaximumTelemetryEventPages; page += 1) {
    const request = eventQueryRequest({
      filters: options.filters,
      offset,
      queryId: options.queryId,
      timeframe: options.timeframe,
    });
    const result = await options.api.query(options.accountId, request);
    const decoded = decodeEventPage(
      result,
      options.accountId,
      options.timeframe,
    );
    if (expectedCount === undefined) expectedCount = decoded.count;
    if (decoded.count !== expectedCount) {
      throw new H05TelemetryPendingError();
    }
    for (const event of decoded.events) {
      if (eventIds.has(event.eventId)) {
        throw new H05TelemetryPendingError();
      }
      eventIds.add(event.eventId);
      events.push(event);
    }
    if (events.length > expectedCount) {
      throw new H05TelemetryPendingError();
    }
    if (events.length === expectedCount) {
      return { events, pageCount: page };
    }
    const lastEvent = decoded.events[decoded.events.length - 1];
    if (lastEvent === undefined || lastEvent.eventId === offset) {
      throw new H05TelemetryPendingError();
    }
    offset = lastEvent.eventId;
  }
  throw new H05TelemetryPendingError();
}

async function collectTraceSummary(options: {
  readonly accountId: string;
  readonly api: H05CloudflareTelemetryApi;
  readonly queryId: string;
  readonly rawTraceId: string;
  readonly timeframe: H05TelemetryTimeframe;
}): Promise<H05TelemetryTraceSummary> {
  const request = traceQueryRequest({
    filters: [exactStringFilter("$metadata.traceId", options.rawTraceId)],
    queryId: options.queryId,
    timeframe: options.timeframe,
  });
  const result = await options.api.query(options.accountId, request);
  const record = providerRecord(result, "trace query result");
  decodeCompletedResult(record, options.accountId, options.timeframe);
  if (!Array.isArray(record.traces)) {
    throw new Error("H05 telemetry trace query omitted its trace summaries.");
  }
  if (record.traces.length === 0) throw new H05TelemetryPendingError();
  if (record.traces.length !== 1) {
    throw new Error("H05 telemetry trace query did not return exactly one summary.");
  }
  const summary = projectTraceSummary(record.traces[0]);
  if (summary.traceId !== options.rawTraceId) {
    throw new Error("H05 telemetry trace summary did not match its exact trace filter.");
  }
  return summary;
}

function decodeEventPage(
  value: unknown,
  accountId: string,
  timeframe: H05TelemetryTimeframe,
): H05TelemetryEventPage {
  const record = providerRecord(value, "event query result");
  const completed = decodeCompletedResult(record, accountId, timeframe);
  const eventsRecord = providerRecord(record.events, "event query events");
  const count = nonNegativeSafeInteger(eventsRecord.count, "event query count");
  if (!Array.isArray(eventsRecord.events)) {
    throw new Error("H05 telemetry event query omitted its event rows.");
  }
  return {
    abrLevel: completed.abrLevel,
    count,
    events: eventsRecord.events.map(projectEvent),
  };
}

function decodeCompletedResult(
  result: Readonly<Record<string, unknown>>,
  accountId: string,
  timeframe: H05TelemetryTimeframe,
): H05CompletedQueryRun {
  const record = providerRecord(result.run, "query run");
  if (record.status === "STARTED") throw new H05TelemetryPendingError();
  if (record.status !== "COMPLETED") {
    throw new Error("H05 telemetry query returned an unknown run status.");
  }
  if (record.accountId !== accountId || record.dry !== true) {
    throw new Error("H05 telemetry query run did not match its account or dry-run contract.");
  }
  const returnedTimeframe = providerRecord(record.timeframe, "query run timeframe");
  if (
    returnedTimeframe.from !== timeframe.from ||
    returnedTimeframe.to !== timeframe.to
  ) {
    throw new Error("H05 telemetry query run changed its frozen timeframe.");
  }
  const resultAbrLevel = decodeAbrLevel(
    result.statistics,
    "query result statistics",
  );
  const runAbrLevel =
    record.statistics === undefined
      ? undefined
      : decodeAbrLevel(record.statistics, "query run statistics");
  if (runAbrLevel !== undefined && runAbrLevel !== resultAbrLevel) {
    throw new Error("H05 telemetry query ABR statistics disagree.");
  }
  if (resultAbrLevel !== 1) {
    throw new Error("H05 telemetry query used adaptive sampling.");
  }
  return { abrLevel: 1 };
}

function decodeAbrLevel(value: unknown, context: string): number {
  const record = providerRecord(value, context);
  return record.abr_level === undefined
    ? 1
    : finiteNumber(record.abr_level, `${context} ABR level`);
}

function projectEvent(value: unknown): H05TelemetryEventProjection {
  const record = providerRecord(value, "telemetry event");
  if (record.dataset !== "cloudflare-workers") {
    throw new Error("H05 telemetry event came from an unexpected dataset.");
  }
  nonNegativeSafeInteger(record.timestamp, "telemetry event timestamp");
  const metadata = providerRecord(record["$metadata"], "telemetry event metadata");
  const eventId = opaqueIdentifier(metadata.id, "telemetry event ID");
  const traceId = opaqueIdentifier(metadata.traceId, "telemetry trace ID");
  const service = boundedProviderString(metadata.service, "telemetry service");
  const spanId = optionalOpaqueIdentifier(metadata.spanId, "telemetry span ID");
  const parentSpanId = optionalOpaqueIdentifier(
    metadata.parentSpanId,
    "telemetry parent span ID",
  );
  const spanStartedAt = optionalNonNegativeSafeInteger(
    metadata.startTime,
    "telemetry span start time",
  );
  const spanFinishedAt = optionalNonNegativeSafeInteger(
    metadata.endTime,
    "telemetry span end time",
  );
  const statusCode = optionalHttpStatus(metadata.statusCode);
  const metadataType = optionalBoundedProviderString(
    metadata.type,
    "telemetry event type",
  );
  let invocation: H05TelemetryInvocationProjection | undefined;
  if (metadataType === "cf-worker-event") {
    const workers = providerRecord(
      record["$workers"],
      "telemetry Worker invocation",
    );
    invocation = projectInvocation(workers);
    const metadataRequestId = opaqueIdentifier(
      metadata.requestId,
      "telemetry metadata request ID",
    );
    if (
      invocation.traceId !== traceId ||
      invocation.scriptName !== service ||
      invocation.requestId !== metadataRequestId ||
      (invocation.spanId !== undefined && invocation.spanId !== spanId)
    ) {
      throw new Error("H05 telemetry invocation fields disagree with event metadata.");
    }
  }
  return {
    eventId,
    invocation,
    parentSpanId,
    service,
    spanFinishedAt,
    spanId,
    spanStartedAt,
    statusCode,
    traceId,
  };
}

function projectInvocation(
  workers: Readonly<Record<string, unknown>>,
): H05TelemetryInvocationProjection {
  const scriptVersion = providerRecord(
    workers.scriptVersion,
    "telemetry Worker script version",
  );
  const event = providerRecord(workers.event, "telemetry Worker event");
  const request = providerRecord(event.request, "telemetry Worker request");
  return {
    eventType: exactProviderLiteral(
      workers.eventType,
      "fetch",
      "telemetry Worker event type",
    ),
    outcome: boundedProviderString(workers.outcome, "telemetry Worker outcome"),
    path: boundedProviderPath(request.path, "telemetry Worker request path"),
    requestId: opaqueIdentifier(
      workers.requestId,
      "telemetry Worker request ID",
    ),
    scriptName: boundedProviderString(
      workers.scriptName,
      "telemetry Worker script name",
    ),
    spanId: optionalOpaqueIdentifier(
      workers.spanId,
      "telemetry Worker span ID",
    ),
    traceId: opaqueIdentifier(workers.traceId, "telemetry Worker trace ID"),
    truncated: providerBoolean(
      workers.truncated,
      "telemetry Worker truncated flag",
    ),
    versionId: opaqueIdentifier(
      scriptVersion.id,
      "telemetry Worker version ID",
    ),
  };
}

function projectTraceSummary(value: unknown): H05TelemetryTraceSummary {
  const record = providerRecord(value, "trace summary");
  if (!Array.isArray(record.service)) {
    throw new Error("H05 telemetry trace summary omitted its services.");
  }
  const services = record.service.map((service) =>
    boundedProviderString(service, "trace summary service"),
  );
  assertUnique(services, "trace summary services");
  services.sort();
  if (record.errors !== undefined) {
    if (!Array.isArray(record.errors)) {
      throw new Error("H05 telemetry trace summary returned invalid errors metadata.");
    }
    if (record.errors.length > 0) throw new H05TelemetryPendingError();
  }
  const startedAt = nonNegativeSafeInteger(
    record.traceStartMs,
    "trace summary start time",
  );
  const finishedAt = nonNegativeSafeInteger(
    record.traceEndMs,
    "trace summary end time",
  );
  if (finishedAt < startedAt) {
    throw new Error("H05 telemetry trace summary timestamps are out of order.");
  }
  finiteNonNegativeNumber(record.traceDurationMs, "trace summary duration");
  return {
    finishedAt,
    services,
    spanCount: positiveSafeInteger(record.spans, "trace summary span count"),
    startedAt,
    traceId: opaqueIdentifier(record.traceId, "trace summary trace ID"),
  };
}

function normalizeTrace(options: {
  readonly events: readonly H05TelemetryEventProjection[];
  readonly expectedExecutorVersion: string;
  readonly expectedProbeVersion: string;
  readonly probePath: string;
  readonly rawTraceId: string;
  readonly summary: H05TelemetryTraceSummary;
}): H05NormalizedTraceEvidence {
  if (options.events.length === 0) throw new H05TelemetryPendingError();
  for (const event of options.events) {
    if (event.traceId !== options.rawTraceId) {
      throw new Error("H05 telemetry trace event did not match its exact trace filter.");
    }
  }
  const spans = collectSpans(options.events);
  if (spans.size !== options.summary.spanCount) {
    throw new H05TelemetryPendingError();
  }
  for (const span of spans.values()) {
    if (
      span.startedAt < options.summary.startedAt ||
      span.finishedAt > options.summary.finishedAt
    ) {
      throw new Error("H05 telemetry span falls outside its trace summary interval.");
    }
  }
  const eventServices = [...new Set(options.events.map((event) => event.service))].sort();
  if (!sameStrings(eventServices, options.summary.services)) {
    if (
      isStringSubset(eventServices, options.summary.services) ||
      isStringSubset(options.summary.services, eventServices)
    ) {
      throw new H05TelemetryPendingError();
    }
    throw new Error("H05 telemetry trace services disagree with the trace summary.");
  }
  const probeRoot = findServiceRoot(spans, h05ProbeWorkerName, true);
  const probeInvocation = findRootInvocation(
    options.events,
    probeRoot,
    h05ProbeWorkerName,
  );
  validateInvocationProjection(
    probeInvocation,
    options.expectedProbeVersion,
    options.probePath,
    "probe",
  );
  const common = {
    eventCount: options.events.length,
    eventIdsSha256: h05TelemetryEventIdsSha256(
      options.events.map((event) => event.eventId),
    ),
    finishedAt: epochMsToIso(options.summary.finishedAt),
    spanCount: options.summary.spanCount,
    startedAt: epochMsToIso(options.summary.startedAt),
    traceIdSha256: h05TraceIdSha256(options.rawTraceId),
  } as const;
  const probe = normalizeInvocation(
    probeInvocation,
    probeRoot,
    h05ProbeWorkerName,
  );

  if (probe.statusCode === 401) {
    if (!sameStrings(eventServices, [h05ProbeWorkerName])) {
      throw new Error("H05 unauthorized trace reached an unexpected service.");
    }
    const trace: H05UnauthorizedTraceEvidence = {
      ...common,
      kind: "unauthorized",
      services: [h05ProbeWorkerName],
      probe,
    };
    return trace;
  }
  if (probe.statusCode !== 200 && probe.statusCode !== 409) {
    throw new Error("H05 authorized probe trace returned an unexpected status.");
  }
  if (!sameStrings(eventServices, [h05ExecutorWorkerName, h05ProbeWorkerName])) {
    if (sameStrings(eventServices, [h05ProbeWorkerName])) {
      throw new H05TelemetryPendingError();
    }
    throw new Error("H05 authorized trace did not contain exactly both proof services.");
  }
  const executorRoot = findServiceRoot(spans, h05ExecutorWorkerName, false);
  const executorInvocation = findRootInvocation(
    options.events,
    executorRoot,
    h05ExecutorWorkerName,
  );
  validateInvocationProjection(
    executorInvocation,
    options.expectedExecutorVersion,
    undefined,
    "executor",
  );
  if (!isAllowedExecutorPath(executorInvocation.invocation.path)) {
    throw new Error("H05 executor trace used a route outside the proof allowlist.");
  }
  const executor = normalizeInvocation(
    executorInvocation,
    executorRoot,
    h05ExecutorWorkerName,
  );
  if (
    executorRoot.startedAt < probeRoot.startedAt ||
    executorRoot.finishedAt > probeRoot.finishedAt
  ) {
    throw new Error(
      "H05 executor invocation interval is not contained by the probe invocation.",
    );
  }
  if (executor.statusCode !== probe.statusCode) {
    throw new Error("H05 probe and executor trace statuses do not match.");
  }
  if (!parentChainReaches(executorRoot, probeRoot.spanId, spans)) {
    throw new Error("H05 executor span is not descended from the probe span.");
  }
  const trace: H05AuthorizedTraceEvidence = {
    ...common,
    executor,
    executorParentLinked: true,
    kind: "authorized",
    probe,
    services: [h05ExecutorWorkerName, h05ProbeWorkerName],
  };
  return trace;
}

function collectSpans(
  events: readonly H05TelemetryEventProjection[],
): ReadonlyMap<string, H05SpanProjection> {
  const spans = new Map<string, H05SpanProjection>();
  for (const event of events) {
    if (
      event.spanId === undefined ||
      event.spanStartedAt === undefined ||
      event.spanFinishedAt === undefined
    ) {
      continue;
    }
    if (event.spanFinishedAt < event.spanStartedAt) {
      throw new Error("H05 telemetry span timestamps are out of order.");
    }
    const projected: H05SpanProjection = {
      finishedAt: event.spanFinishedAt,
      parentSpanId: event.parentSpanId,
      service: event.service,
      spanId: event.spanId,
      startedAt: event.spanStartedAt,
    };
    const existing = spans.get(event.spanId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(projected)) {
      throw new Error("H05 telemetry repeated a span with inconsistent metadata.");
    }
    spans.set(event.spanId, projected);
  }
  return spans;
}

function findServiceRoot(
  spans: ReadonlyMap<string, H05SpanProjection>,
  service: string,
  requireTraceRoot: boolean,
): H05SpanProjection {
  const serviceSpans = [...spans.values()].filter((span) => span.service === service);
  const roots = serviceSpans.filter((span) => {
    if (span.parentSpanId === undefined) return true;
    const parent = spans.get(span.parentSpanId);
    return parent === undefined || parent.service !== service;
  });
  if (roots.length !== 1) {
    throw new Error("H05 telemetry did not expose exactly one Worker root span.");
  }
  const root = roots[0];
  if (root === undefined) {
    throw new Error("H05 telemetry Worker root span is missing.");
  }
  if (requireTraceRoot && root.parentSpanId !== undefined) {
    throw new Error("H05 probe invocation is not the distributed trace root.");
  }
  return root;
}

function findRootInvocation(
  events: readonly H05TelemetryEventProjection[],
  root: H05SpanProjection,
  service: string,
): H05TelemetryEventProjection & {
  readonly invocation: H05TelemetryInvocationProjection;
  readonly statusCode: number;
} {
  const candidates = events.filter(
    (event) =>
      event.spanId === root.spanId &&
      event.service === service &&
      event.invocation !== undefined &&
      event.statusCode !== undefined,
  );
  if (candidates.length !== 1) {
    throw new Error("H05 telemetry did not expose exactly one root invocation event.");
  }
  const candidate = candidates[0];
  if (
    candidate === undefined ||
    candidate.invocation === undefined ||
    candidate.statusCode === undefined
  ) {
    throw new Error("H05 telemetry root invocation event is incomplete.");
  }
  return {
    ...candidate,
    invocation: candidate.invocation,
    statusCode: candidate.statusCode,
  };
}

function validateInvocationProjection(
  event: H05TelemetryEventProjection & {
    readonly invocation: H05TelemetryInvocationProjection;
    readonly statusCode: number;
  },
  expectedVersion: string,
  expectedPath: string | undefined,
  role: "executor" | "probe",
): void {
  if (event.invocation.outcome !== "ok") {
    throw new Error(`H05 ${role} invocation outcome was not ok.`);
  }
  if (event.invocation.truncated) {
    throw new Error(`H05 ${role} invocation telemetry was truncated.`);
  }
  if (event.invocation.versionId !== expectedVersion) {
    throw new Error(`H05 ${role} invocation used an unexpected Worker version.`);
  }
  if (expectedPath !== undefined && event.invocation.path !== expectedPath) {
    throw new Error(`H05 ${role} invocation used an unexpected request path.`);
  }
}

function normalizeInvocation(
  event: H05TelemetryEventProjection & {
    readonly invocation: H05TelemetryInvocationProjection;
    readonly statusCode: number;
  },
  span: H05SpanProjection,
  workerName: typeof h05ExecutorWorkerName | typeof h05ProbeWorkerName,
): H05TraceInvocationEvidence {
  if (
    event.statusCode !== 200 &&
    event.statusCode !== 401 &&
    event.statusCode !== 409
  ) {
    throw new Error("H05 root invocation returned an unexpected HTTP status.");
  }
  return {
    eventType: "fetch",
    finishedAt: epochMsToIso(span.finishedAt),
    outcome: "ok",
    startedAt: epochMsToIso(span.startedAt),
    statusCode: event.statusCode,
    truncated: false,
    versionId: decodeH05TraceCloudflareResourceId(event.invocation.versionId),
    workerName,
  };
}

function parentChainReaches(
  start: H05SpanProjection,
  expectedAncestorSpanId: string,
  spans: ReadonlyMap<string, H05SpanProjection>,
): boolean {
  const visited = new Set<string>();
  let current: H05SpanProjection | undefined = start;
  while (current.parentSpanId !== undefined) {
    if (current.parentSpanId === expectedAncestorSpanId) return true;
    if (visited.has(current.parentSpanId)) {
      throw new Error("H05 telemetry span parent graph contains a cycle.");
    }
    visited.add(current.parentSpanId);
    current = spans.get(current.parentSpanId);
    if (current === undefined) return false;
  }
  return false;
}

function requiredInvocation(
  event: H05TelemetryEventProjection,
  context: string,
): H05TelemetryInvocationProjection {
  if (event.invocation === undefined) {
    throw new Error(`H05 telemetry ${context} omitted its invocation fields.`);
  }
  return event.invocation;
}

function eventQueryRequest(options: {
  readonly filters: readonly H05TelemetryFilter[];
  readonly offset: string | undefined;
  readonly queryId: string;
  readonly timeframe: H05TelemetryTimeframe;
}): H05TelemetryQueryRequest {
  return {
    queryId: options.queryId,
    timeframe: options.timeframe,
    dry: true,
    ignoreSeries: true,
    limit: h05TelemetryEventPageLimit,
    ...(options.offset === undefined
      ? {}
      : { offset: options.offset, offsetDirection: "next" as const }),
    parameters: {
      datasets: ["cloudflare-workers"],
      filterCombination: "and",
      filters: options.filters,
    },
    view: "events",
  };
}

function traceQueryRequest(options: {
  readonly filters: readonly H05TelemetryFilter[];
  readonly queryId: string;
  readonly timeframe: H05TelemetryTimeframe;
}): H05TelemetryQueryRequest {
  return {
    queryId: options.queryId,
    timeframe: options.timeframe,
    dry: true,
    ignoreSeries: true,
    limit: h05TelemetryTraceLimit,
    parameters: {
      datasets: ["cloudflare-workers"],
      filterCombination: "and",
      filters: options.filters,
    },
    view: "traces",
  };
}

function exactStringFilter(key: string, value: string): H05TelemetryFilter {
  return { key, kind: "filter", operation: "eq", type: "string", value };
}

function decodeDependencies(
  options: H05TraceCollectorOptions,
): H05TraceCollectorDependencies {
  const controlPlaneBefore = decodeH05ControlPlaneEvidence(
    options.controlPlaneBefore,
  );
  if (!controlPlaneBefore.ok) throw new Error(controlPlaneBefore.message);
  const dataPlane = decodeH05DataPlaneEvidence(options.dataPlane);
  if (!dataPlane.ok) throw new Error(dataPlane.message);
  const controlPlaneAfter = decodeH05ControlPlaneEvidence(
    options.controlPlaneAfter,
  );
  if (!controlPlaneAfter.ok) throw new Error(controlPlaneAfter.message);
  return {
    controlPlaneAfter: controlPlaneAfter.value,
    controlPlaneBefore: controlPlaneBefore.value,
    dataPlane: dataPlane.value,
  };
}

function dataPlaneTimeframe(
  dataPlane: H05DataPlaneEvidence,
): H05TelemetryTimeframe {
  const from = Date.parse(dataPlane.window.startedAt);
  const to = Date.parse(dataPlane.window.finishedAt);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to) {
    throw new Error("H05 data-plane evidence has an invalid telemetry timeframe.");
  }
  return { from, to };
}

function providerRecord(
  value: unknown,
  context: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`H05 telemetry provider schema drifted at ${context}.`);
  }
  return value;
}

function canonicalIsoTimestamp(value: string, context: string): H05IsoTimestamp {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`H05 ${context} must be a canonical ISO timestamp.`);
  }
  return value as H05IsoTimestamp;
}

function epochMsToIso(value: number): H05IsoTimestamp {
  return new Date(value).toISOString() as H05IsoTimestamp;
}

function nowIso(now: () => string): string {
  return now();
}

function cloudflareAccountId(value: string): string {
  if (!/^[a-f0-9]{32}$/.test(value)) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters.",
    );
  }
  return value;
}

function opaqueIdentifier(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error(`H05 telemetry ${context} is not a bounded opaque identifier.`);
  }
  return value;
}

function optionalOpaqueIdentifier(
  value: unknown,
  context: string,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return opaqueIdentifier(value, context);
}

function boundedProviderString(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`H05 telemetry ${context} is invalid.`);
  }
  return value;
}

function optionalBoundedProviderString(
  value: unknown,
  context: string,
): string | undefined {
  return value === undefined ? undefined : boundedProviderString(value, context);
}

function boundedProviderPath(value: unknown, context: string): string {
  const decoded = boundedProviderString(value, context);
  if (!decoded.startsWith("/") || decoded.includes("?") || decoded.includes("#")) {
    throw new Error(`H05 telemetry ${context} is not an absolute request path.`);
  }
  return decoded;
}

function providerBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`H05 telemetry ${context} is not a boolean.`);
  }
  return value;
}

function exactProviderLiteral<const Value extends string>(
  value: unknown,
  expected: Value,
  context: string,
): Value {
  if (value !== expected) {
    throw new Error(`H05 ${context} did not match the required value.`);
  }
  return expected;
}

function optionalHttpStatus(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const decoded = positiveSafeInteger(value, "telemetry HTTP status");
  if (decoded < 100 || decoded > 599) {
    throw new Error("H05 telemetry HTTP status is outside the valid range.");
  }
  return decoded;
}

function nonNegativeSafeInteger(value: unknown, context: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`H05 ${context} is not a non-negative safe integer.`);
  }
  return value;
}

function optionalNonNegativeSafeInteger(
  value: unknown,
  context: string,
): number | undefined {
  return value === undefined ? undefined : nonNegativeSafeInteger(value, context);
}

function positiveSafeInteger(value: unknown, context: string): number {
  const decoded = nonNegativeSafeInteger(value, context);
  if (!isPositiveSafeInteger(decoded)) {
    throw new Error(`H05 ${context} must be positive.`);
  }
  return decoded;
}

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`H05 ${context} is not finite.`);
  }
  return value;
}

function finiteNonNegativeNumber(value: unknown, context: string): number {
  const decoded = finiteNumber(value, context);
  if (decoded < 0) throw new Error(`H05 ${context} must not be negative.`);
  return decoded;
}

function boundedPositiveInteger(
  value: number,
  maximum: number,
  context: string,
): number {
  if (!isPositiveSafeInteger(value) || value > maximum) {
    throw new Error(`H05 ${context} must be between 1 and ${maximum}.`);
  }
  return value;
}

function assertUnique(values: readonly string[], context: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`H05 ${context} must be unique.`);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isStringSubset(
  candidate: readonly string[],
  values: readonly string[],
): boolean {
  const allowed = new Set(values);
  return candidate.every((value) => allowed.has(value));
}

function isAllowedExecutorPath(value: string): boolean {
  return (
    value === "/invoke/start" ||
    value === "/invoke/syscall" ||
    value === "/invoke/finish" ||
    value === "/invoke/abort"
  );
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

class H05TelemetryPendingError extends Error {
  constructor() {
    super("H05 telemetry is not complete yet.");
    this.name = "H05TelemetryPendingError";
  }
}
