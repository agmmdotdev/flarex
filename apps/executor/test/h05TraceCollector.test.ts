import { describe, expect, it } from "vitest";

import {
  h05ExecutorWorkerName,
  h05ProbeWorkerName,
} from "../h05/receipt";
import { serializeH05TraceEvidence } from "../h05/traceEvidence";
import type {
  H05CloudflareTelemetryApi,
  H05TelemetryFilter,
  H05TelemetryQueryRequest,
} from "../scripts/cloudflareTelemetryApi";
import { collectH05TraceEvidence } from "../scripts/h05TraceCollector";
import {
  h05TraceFixtureAccountId,
  h05TraceFixtureExecutorVersionId,
  h05TraceFixtureProbePath,
  h05TraceFixtureProbeVersionId,
  validH05TraceControlPlaneEvidence,
  validH05TraceDataPlaneEvidence,
} from "./h05TraceFixtures";

interface FixtureOverrides {
  readonly brokenParent?: boolean;
  readonly discoveryExtraTrace?: boolean;
  readonly duplicateDiscoveryEvent?: boolean;
  readonly pageSize?: number;
  readonly overhangingExecutor?: boolean;
  readonly omitRunStatistics?: boolean;
  readonly omitResultStatistics?: boolean;
  readonly resultAbrLevel?: number;
  readonly runAbrLevel?: number;
  readonly startedFirst?: boolean;
  readonly thirdService?: boolean;
  readonly truncatedProbe?: boolean;
  readonly unstableEventIds?: boolean;
  readonly wrongExecutorVersion?: boolean;
}

interface FixtureApi {
  readonly api: H05CloudflareTelemetryApi;
  readonly calls: readonly H05TelemetryQueryRequest[];
}

describe("H05 trace collector", () => {
  it("retains the collector Cloudflare account ID diagnostic", async () => {
    const fixture = fixtureApi();

    await expect(
      collectH05TraceEvidence({
        accountId: "A".repeat(32),
        api: fixture.api,
        controlPlaneBefore: validH05TraceControlPlaneEvidence("before"),
        dataPlane: validH05TraceDataPlaneEvidence(),
        controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
        maximumAttempts: 2,
        now: fixtureClock(),
        settleDelayMs: 1,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(
      "CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters.",
    );
    expect(fixture.calls).toHaveLength(0);
  });

  it("retains the collector canonical timestamp diagnostic", async () => {
    const fixture = fixtureApi();

    await expect(collectH05TraceEvidence({
      accountId: h05TraceFixtureAccountId,
      api: fixture.api,
      controlPlaneBefore: validH05TraceControlPlaneEvidence("before"),
      dataPlane: validH05TraceDataPlaneEvidence(),
      controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
      maximumAttempts: 2,
      now: () => "2026-07-11T10:01:04.000+00:00",
      settleDelayMs: 1,
      sleep: async () => undefined,
    })).rejects.toThrow(
      "H05 trace collection startedAt must be a canonical ISO timestamp.",
    );
  });

  it("collects two stable redacted sweeps and compiles the pre/post join", async () => {
    const fixture = fixtureApi();
    const sleeps: number[] = [];
    const evidence = await collectH05TraceEvidence({
      accountId: h05TraceFixtureAccountId,
      api: fixture.api,
      controlPlaneBefore: validH05TraceControlPlaneEvidence("before"),
      dataPlane: validH05TraceDataPlaneEvidence(),
      controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
      maximumAttempts: 2,
      now: fixtureClock(),
      settleDelayMs: 7,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(evidence.traces).toHaveLength(15);
    expect(evidence.query.observations).toHaveLength(2);
    expect(evidence.query.observations[0]?.traceEventPageCount).toBe(15);
    expect(sleeps).toEqual([7]);
    expect(fixture.calls).toHaveLength(62);
    const discovery = fixture.calls[0];
    expect(discovery?.view).toBe("events");
    expect(discovery?.parameters.filters).toEqual([
      exactFilter("$metadata.service", h05ProbeWorkerName),
      exactFilter("$metadata.type", "cf-worker-event"),
      exactFilter("$workers.event.request.path", h05TraceFixtureProbePath),
      exactFilter("$workers.eventType", "fetch"),
    ]);
    expect(
      fixture.calls.some(
        (request) =>
          request.view === "events" &&
          request.parameters.filters.length === 1 &&
          request.parameters.filters[0]?.key === "$metadata.traceId",
      ),
    ).toBe(true);
    expect(
      fixture.calls.filter((request) => request.view === "traces"),
    ).toHaveLength(30);

    const serialized = serializeH05TraceEvidence(evidence);
    expect(serialized).not.toContain("provider-secret-value");
    expect(serialized).not.toContain("trace-00000000");
    expect(serialized).not.toContain("event-00000000-probe");
    expect(serialized).not.toContain("request-00000000-probe");
  });

  it("follows metadata-ID cursors until every event page is terminal", async () => {
    const fixture = fixtureApi({ duplicateDiscoveryEvent: true, pageSize: 2 });
    const evidence = await collectH05TraceEvidence({
      accountId: h05TraceFixtureAccountId,
      api: fixture.api,
      controlPlaneBefore: validH05TraceControlPlaneEvidence("before"),
      dataPlane: validH05TraceDataPlaneEvidence(),
      controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
      maximumAttempts: 2,
      now: fixtureClock(),
      settleDelayMs: 1,
      sleep: async () => undefined,
    });

    expect(evidence.query.observations[0]).toMatchObject({
      discoveryEventPageCount: 8,
      terminalPagesObserved: true,
      traceEventPageCount: 29,
    });
    const cursorRequests = fixture.calls.filter(
      (request) => request.offset !== undefined,
    );
    expect(cursorRequests.length).toBeGreaterThan(0);
    expect(
      cursorRequests.every((request) => request.offsetDirection === "next"),
    ).toBe(true);
  });

  it("re-executes a STARTED query and still requires two later stable sweeps", async () => {
    const fixture = fixtureApi({ startedFirst: true });
    const sleeps: number[] = [];
    const evidence = await collectH05TraceEvidence({
      accountId: h05TraceFixtureAccountId,
      api: fixture.api,
      controlPlaneBefore: validH05TraceControlPlaneEvidence("before"),
      dataPlane: validH05TraceDataPlaneEvidence(),
      controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
      maximumAttempts: 3,
      now: fixtureClock(),
      settleDelayMs: 3,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(evidence.query.queryComplete).toBe(true);
    expect(sleeps).toEqual([3, 3]);
  });

  it("rejects invalid evidence ordering before issuing a telemetry query", async () => {
    const fixture = fixtureApi();
    const before = validH05TraceControlPlaneEvidence("before");
    await expect(
      collectH05TraceEvidence({
        accountId: h05TraceFixtureAccountId,
        api: fixture.api,
        controlPlaneBefore: before,
        dataPlane: validH05TraceDataPlaneEvidence(),
        controlPlaneAfter: before,
        maximumAttempts: 2,
        now: fixtureClock(),
        settleDelayMs: 1,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("data-plane-to-control-plane-after");
    expect(fixture.calls).toHaveLength(0);
  });

  it("rejects adaptive sampling and probe-discovery contamination", async () => {
    await expect(
      collectFixture({ omitRunStatistics: true, resultAbrLevel: 2 }),
    ).rejects.toThrow("adaptive sampling");
    await expect(
      collectFixture({ resultAbrLevel: 1, runAbrLevel: 2 }),
    ).rejects.toThrow("ABR statistics disagree");
    await expect(
      collectFixture({ omitResultStatistics: true }),
    ).rejects.toThrow("query result statistics");
    await expect(
      collectFixture({ discoveryExtraTrace: true }),
    ).rejects.toThrow("more trace IDs than the data-plane oracle");
  });

  it.each([
    ["wrong executor version", { wrongExecutorVersion: true }, "unexpected Worker version"],
    ["truncated probe", { truncatedProbe: true }, "telemetry was truncated"],
    ["third service", { thirdService: true }, "exactly both proof services"],
    ["broken parent chain", { brokenParent: true }, "not descended"],
    [
      "overhanging executor interval",
      { overhangingExecutor: true },
      "not contained",
    ],
  ] as const)("rejects %s", async (_name, overrides, message) => {
    await expect(collectFixture(overrides)).rejects.toThrow(message);
  });

  it("times out without an artifact when consecutive complete sweeps differ", async () => {
    await expect(
      collectFixture({ unstableEventIds: true }, 3),
    ).rejects.toThrow("stable complete observations");
  });
});

async function collectFixture(
  overrides: FixtureOverrides,
  maximumAttempts = 2,
) {
  const fixture = fixtureApi(overrides);
  return collectH05TraceEvidence({
    accountId: h05TraceFixtureAccountId,
    api: fixture.api,
    controlPlaneBefore: validH05TraceControlPlaneEvidence("before"),
    dataPlane: validH05TraceDataPlaneEvidence(),
    controlPlaneAfter: validH05TraceControlPlaneEvidence("after"),
    maximumAttempts,
    now: fixtureClock(),
    settleDelayMs: 1,
    sleep: async () => undefined,
  });
}

function fixtureApi(overrides: FixtureOverrides = {}): FixtureApi {
  const calls: H05TelemetryQueryRequest[] = [];
  let sweep = 0;
  let firstRequest = true;
  const api: H05CloudflareTelemetryApi = {
    async query(accountId, request) {
      calls.push(request);
      if (accountId !== h05TraceFixtureAccountId) {
        throw new Error("fixture account mismatch");
      }
      if (firstRequest && overrides.startedFirst === true) {
        firstRequest = false;
        return { run: runRecord(request, overrides, "STARTED") };
      }
      firstRequest = false;
      const traceFilter = filterValue(request, "$metadata.traceId");
      const serviceFilter = filterValue(request, "$metadata.service");
      if (
        request.view === "events" &&
        serviceFilter === h05ProbeWorkerName &&
        traceFilter === undefined
      ) {
        if (request.offset === undefined) sweep += 1;
        const discovery = allTraceFixtures(overrides, sweep).map((trace) => {
          const event = trace.events[0];
          if (event === undefined) throw new Error("fixture trace has no probe event");
          return event;
        });
        if (overrides.discoveryExtraTrace === true) {
          discovery.push(extraDiscoveryEvent());
        }
        if (overrides.duplicateDiscoveryEvent === true) {
          const duplicate = structuredClone(discovery[1]);
          if (!isRecord(duplicate)) throw new Error("fixture duplicate is invalid");
          const metadata = duplicate["$metadata"];
          if (!isRecord(metadata)) throw new Error("fixture metadata is invalid");
          metadata.id = "event-duplicate-probe-span";
          discovery.push(duplicate);
        }
        return eventResult(request, overrides, discovery);
      }
      if (traceFilter === undefined) {
        throw new Error("fixture query omitted trace filter");
      }
      const trace = allTraceFixtures(overrides, sweep).find(
        (candidate) => candidate.rawTraceId === traceFilter,
      );
      if (trace === undefined) throw new Error("fixture trace not found");
      return request.view === "events"
        ? eventResult(request, overrides, trace.events)
        : {
            run: runRecord(request, overrides, "COMPLETED"),
            ...(overrides.omitResultStatistics === true
              ? {}
              : { statistics: { abr_level: overrides.resultAbrLevel ?? 1 } }),
            traces: [trace.summary],
          };
    },
  };
  return { api, calls };
}

interface RawTraceFixture {
  readonly events: Array<Readonly<Record<string, unknown>>>;
  readonly rawTraceId: string;
  readonly summary: Readonly<Record<string, unknown>>;
}

function allTraceFixtures(
  overrides: FixtureOverrides,
  sweep: number,
): RawTraceFixture[] {
  return Array.from({ length: 15 }, (_value, index) =>
    traceFixture(index, overrides, sweep),
  );
}

function traceFixture(
  index: number,
  overrides: FixtureOverrides,
  sweep: number,
): RawTraceFixture {
  const suffix = index.toString().padStart(8, "0");
  const rawTraceId = `trace-${suffix}`;
  const startedAt = Date.parse("2026-07-11T10:01:05.000Z") + index * 1_000;
  const finishedAt = startedAt + 500;
  const statusCode = index === 0 ? 401 : index >= 13 ? 409 : 200;
  const probeFinishedAt =
    overrides.overhangingExecutor === true && index === 1
      ? finishedAt - 100
      : finishedAt;
  const eventIdSuffix = overrides.unstableEventIds === true ? `-sweep-${sweep}` : "";
  const probeRootSpanId = `span-${suffix}-probe`;
  const probe = rawEvent({
    eventId: `event-${suffix}-probe${eventIdSuffix}`,
    finishedAt: probeFinishedAt,
    parentSpanId: undefined,
    path: h05TraceFixtureProbePath,
    rawTraceId,
    requestId: `request-${suffix}-probe`,
    scriptName: h05ProbeWorkerName,
    spanId: probeRootSpanId,
    startedAt,
    statusCode,
    truncated: overrides.truncatedProbe === true && index === 1,
    versionId: h05TraceFixtureProbeVersionId,
  });
  if (index === 0) {
    return {
      events: [probe],
      rawTraceId,
      summary: rawSummary({
        finishedAt,
        rawTraceId,
        services: [h05ProbeWorkerName],
        spanCount: 1,
        startedAt,
      }),
    };
  }
  const bindingSpanId = `span-${suffix}-binding`;
  const binding = rawSpanEvent({
    eventId: `event-${suffix}-binding${eventIdSuffix}`,
    finishedAt: finishedAt - 25,
    parentSpanId: probeRootSpanId,
    rawTraceId,
    scriptName: h05ProbeWorkerName,
    spanId: bindingSpanId,
    startedAt: startedAt + 50,
  });
  const executor = rawEvent({
    eventId: `event-${suffix}-executor${eventIdSuffix}`,
    finishedAt: finishedAt - 50,
    parentSpanId:
      overrides.brokenParent === true && index === 1
        ? "span-missing-parent"
        : bindingSpanId,
    path: "/invoke/syscall",
    rawTraceId,
    requestId: `request-${suffix}-executor`,
    scriptName: h05ExecutorWorkerName,
    spanId: `span-${suffix}-executor`,
    startedAt: startedAt + 100,
    statusCode,
    truncated: false,
    versionId:
      overrides.wrongExecutorVersion === true && index === 1
        ? "wrong-executor-version"
        : h05TraceFixtureExecutorVersionId,
  });
  const events = [probe, binding, executor];
  const services = [h05ExecutorWorkerName, h05ProbeWorkerName];
  if (overrides.thirdService === true && index === 1) {
    events.push(
      rawSpanEvent({
        eventId: `event-${suffix}-third${eventIdSuffix}`,
        finishedAt: finishedAt - 10,
        parentSpanId: probeRootSpanId,
        rawTraceId,
        scriptName: "unexpected-worker",
        spanId: `span-${suffix}-third`,
        startedAt: startedAt + 10,
      }),
    );
    services.push("unexpected-worker");
  }
  services.sort();
  return {
    events,
    rawTraceId,
    summary: rawSummary({
      finishedAt,
      rawTraceId,
      services,
      spanCount: events.length,
      startedAt,
    }),
  };
}

function rawEvent(options: {
  readonly eventId: string;
  readonly finishedAt: number;
  readonly parentSpanId: string | undefined;
  readonly path: string;
  readonly rawTraceId: string;
  readonly requestId: string;
  readonly scriptName: string;
  readonly spanId: string;
  readonly startedAt: number;
  readonly statusCode: number;
  readonly truncated: boolean;
  readonly versionId: string;
}): Readonly<Record<string, unknown>> {
  return {
    "$metadata": {
      id: options.eventId,
      requestId: options.requestId,
      service: options.scriptName,
      traceId: options.rawTraceId,
      spanId: options.spanId,
      ...(options.parentSpanId === undefined
        ? {}
        : { parentSpanId: options.parentSpanId }),
      startTime: options.startedAt,
      endTime: options.finishedAt,
      statusCode: options.statusCode,
      type: "cf-worker-event",
      message: "provider-secret-value",
    },
    "$workers": {
      eventType: "fetch",
      outcome: "ok",
      event: { request: { path: options.path } },
      requestId: options.requestId,
      scriptName: options.scriptName,
      scriptVersion: { id: options.versionId },
      spanId: options.spanId,
      traceId: options.rawTraceId,
      truncated: options.truncated,
    },
    dataset: "cloudflare-workers",
    source: { secret: "provider-secret-value" },
    timestamp: options.finishedAt,
  };
}

function rawSpanEvent(options: {
  readonly eventId: string;
  readonly finishedAt: number;
  readonly parentSpanId: string;
  readonly rawTraceId: string;
  readonly scriptName: string;
  readonly spanId: string;
  readonly startedAt: number;
}): Readonly<Record<string, unknown>> {
  return {
    "$metadata": {
      id: options.eventId,
      service: options.scriptName,
      traceId: options.rawTraceId,
      spanId: options.spanId,
      parentSpanId: options.parentSpanId,
      startTime: options.startedAt,
      endTime: options.finishedAt,
      message: "provider-secret-value",
      type: "cf-worker-span",
    },
    "$workers": {
      eventType: "fetch",
      requestId: `lightweight-${options.eventId}`,
      scriptName: options.scriptName,
      spanId: options.spanId,
    },
    dataset: "cloudflare-workers",
    source: { secret: "provider-secret-value" },
    timestamp: options.finishedAt,
  };
}

function rawSummary(options: {
  readonly finishedAt: number;
  readonly rawTraceId: string;
  readonly services: readonly string[];
  readonly spanCount: number;
  readonly startedAt: number;
}): Readonly<Record<string, unknown>> {
  return {
    errors: [],
    rootSpanName: "discarded",
    rootTransactionName: "discarded",
    service: options.services,
    spans: options.spanCount,
    traceDurationMs: options.finishedAt - options.startedAt,
    traceEndMs: options.finishedAt,
    traceId: options.rawTraceId,
    traceStartMs: options.startedAt,
  };
}

function eventResult(
  request: H05TelemetryQueryRequest,
  overrides: FixtureOverrides,
  events: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  const pageSize = overrides.pageSize ?? 100;
  const offsetIndex =
    request.offset === undefined
      ? -1
      : events.findIndex((event) => eventId(event) === request.offset);
  if (request.offset !== undefined && offsetIndex < 0) {
    throw new Error("fixture cursor not found");
  }
  const page = events.slice(offsetIndex + 1, offsetIndex + 1 + pageSize);
  return {
    run: runRecord(request, overrides, "COMPLETED"),
    ...(overrides.omitResultStatistics === true
      ? {}
      : { statistics: { abr_level: overrides.resultAbrLevel ?? 1 } }),
    events: { count: events.length, events: page },
  };
}

function runRecord(
  request: H05TelemetryQueryRequest,
  overrides: FixtureOverrides,
  status: "COMPLETED" | "STARTED",
): Readonly<Record<string, unknown>> {
  return {
    accountId: h05TraceFixtureAccountId,
    dry: true,
    status,
    timeframe: request.timeframe,
    ...(overrides.omitRunStatistics === true
      ? {}
      : { statistics: { abr_level: overrides.runAbrLevel ?? 1 } }),
  };
}

function eventId(event: Readonly<Record<string, unknown>>): string {
  const metadata = event["$metadata"];
  if (!isRecord(metadata) || typeof metadata.id !== "string") {
    throw new Error("fixture event ID missing");
  }
  return metadata.id;
}

function filterValue(
  request: H05TelemetryQueryRequest,
  key: string,
): string | undefined {
  return request.parameters.filters.find((filter) => filter.key === key)?.value;
}

function extraDiscoveryEvent(): Readonly<Record<string, unknown>> {
  return rawEvent({
    eventId: "event-extra-probe",
    finishedAt: Date.parse("2026-07-11T10:01:30.500Z"),
    parentSpanId: undefined,
    path: h05TraceFixtureProbePath,
    rawTraceId: "trace-extra-00000000",
    requestId: "request-extra-probe",
    scriptName: h05ProbeWorkerName,
    spanId: "span-extra-probe",
    startedAt: Date.parse("2026-07-11T10:01:30.000Z"),
    statusCode: 401,
    truncated: false,
    versionId: h05TraceFixtureProbeVersionId,
  });
}

function fixtureClock(): () => string {
  const values = [
    "2026-07-11T10:04:00.000Z",
    "2026-07-11T10:04:05.000Z",
    "2026-07-11T10:04:10.000Z",
    "2026-07-11T10:04:15.000Z",
  ];
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    if (value === undefined) throw new Error("fixture clock exhausted");
    return value;
  };
}

function exactFilter(key: string, value: string): H05TelemetryFilter {
  return { key, kind: "filter", operation: "eq", type: "string", value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
