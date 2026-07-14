import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeSessionId,
  type ProbeSessionId,
} from "../src/identity";
import {
  decodeProbeFacetLifecycleSessionResponseV1Effect,
  ProbeFacetLifecycleRequestV1Schema,
  type ProbeFacetLifecycleOperation,
} from "../src/facetProtocol";
import { PROBE_PUBLIC_BODY_MAX_BYTES, PROBE_SAMPLE_ROUTE } from "../src/gateway";
import {
  completeProbeGatewaySampleV1,
  decodeProbeGatewaySampleV1Effect,
  type ProbeGatewaySampleV1,
} from "../src/runtimeProtocol";
import {
  decodeProbeSessionControlResponseV1Effect,
  ProbeSessionEchoRequestV1Schema,
} from "../src/sessionProtocol";
import { validateProbeTraceV1 } from "../src/trace";
import { PROBE_PROTOCOL_VERSION_V1 } from "../src/protocol";
import {
  createRuntimeProbeHarness,
  PROBE_TEST_AUTHORIZATION,
  PROBE_TEST_TOKEN,
  removeRuntimeProbePersistPath,
  type RuntimeProbeHarness,
} from "./runtimeHarness";

describe.sequential("P02 gateway and ProbeSessionDO in Miniflare", () => {
  let harness: RuntimeProbeHarness;

  beforeAll(async () => {
    harness = await createRuntimeProbeHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it("fails closed for absent, wrong, and missing configured tokens", async () => {
    const request = validSampleRequest("edge_echo", "p02_auth");
    const absent = await dispatch(harness, request, { authorized: false });
    const wrong = await dispatch(harness, request, {
      authorization: "Bearer wrong-token",
    });
    const unconfiguredHarness = await createRuntimeProbeHarness({ token: false });
    try {
      const unconfigured = await dispatch(unconfiguredHarness, request, {
        authorized: false,
      });
      expect(unconfigured.status).toBe(500);
    } finally {
      await unconfiguredHarness.dispose();
    }

    expect(absent.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(absent.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects wrong routes, methods, media types, excess fields, and limits", async () => {
    const wrongRoute = await harness.mf.dispatchFetch(
      "https://probe.test/v1/not-a-route",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(validSampleRequest("edge_echo", "p02_route")),
      },
    );
    const wrongMethod = await harness.mf.dispatchFetch(
      `https://probe.test${PROBE_SAMPLE_ROUTE}`,
      { method: "GET", headers: { authorization: PROBE_TEST_AUTHORIZATION } },
    );
    const wrongType = await harness.mf.dispatchFetch(
      `https://probe.test${PROBE_SAMPLE_ROUTE}`,
      {
        method: "POST",
        headers: {
          authorization: PROBE_TEST_AUTHORIZATION,
          "content-type": "text/plain",
        },
        body: "{}",
      },
    );
    const excess = await dispatch(harness, {
      ...validSampleRequest("edge_echo", "p02_excess"),
      unexpected: true,
    });
    const overLimit = await dispatch(
      harness,
      {
        ...validSampleRequest("edge_echo", "p02_limit"),
        run: {
          ...validSampleRequest("edge_echo", "p02_limit").run,
          repetitions: 501,
        },
      },
    );
    const oversizedBody = await harness.mf.dispatchFetch(
      `https://probe.test${PROBE_SAMPLE_ROUTE}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: "x".repeat(PROBE_PUBLIC_BODY_MAX_BYTES + 1),
      },
    );

    expect(wrongRoute.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(wrongType.status).toBe(415);
    expect(excess.status).toBe(400);
    expect(overLimit.status).toBe(400);
    expect(oversizedBody.status).toBe(413);
  });

  it("returns an edge fragment that only the caller completes", async () => {
    const measured = await measuredDispatch(
      harness,
      validSampleRequest("edge_echo", "p02_edge", {
        payloadBytes: 8,
      }),
    );
    const sample = completeProbeGatewaySampleV1(
      measured.fragment,
      measured.durationMs,
    );

    expect(measured.fragment.spans).toEqual([]);
    expect(sample.spans.map(span => span.name)).toEqual(["external_request"]);
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });
    expect(measured.raw).not.toContain(PROBE_TEST_TOKEN);
    expect("payload" in measured.fragment).toBe(false);
    expect(measured.raw).not.toContain("xxxxxxxx");
  });

  it("returns complete repeated session traces without mutating control state", async () => {
    const runId = "p02_repeat";
    const firstRequest = validSampleRequest("session_echo", runId, {
      repetitions: 2,
      sessionMode: "reuse-session",
      payloadBytes: 16,
    });
    const secondRequest = {
      ...firstRequest,
      sampleOrdinal: 1,
    };
    const sessionId = derivedSessionId(runId, 0);
    expect(await controlValue(harness, sessionId, "read")).toBe(0);

    const first = await measuredDispatch(harness, firstRequest);
    const second = await measuredDispatch(harness, secondRequest);
    const firstSample = completeProbeGatewaySampleV1(
      first.fragment,
      first.durationMs,
    );
    const secondSample = completeProbeGatewaySampleV1(
      second.fragment,
      second.durationMs,
    );

    expect(first.fragment.identity.sessionId).toBe(sessionId);
    expect(second.fragment.identity.sessionId).toBe(sessionId);
    expect(firstSample.spans.map(span => span.name)).toEqual([
      "external_request",
      "gateway_session_rtt",
    ]);
    expect(validateProbeTraceV1(firstSample)).toEqual({ ok: true });
    expect(validateProbeTraceV1(secondSample)).toEqual({ ok: true });
    expect(await controlValue(harness, sessionId, "read")).toBe(0);
  });

  it("measures stable direct Dynamic Worker calls as a distinct callback cohort", async () => {
    const request = validSampleRequest("dynamic_direct_echo", "p03_stable", {
      payloadBytes: 8,
      repetitions: 2,
    });
    const first = await measuredDispatch(harness, request);
    const second = await measuredDispatch(harness, {
      ...request,
      sampleOrdinal: 1,
    });
    const firstSample = completeProbeGatewaySampleV1(
      first.fragment,
      first.durationMs,
    );
    const secondSample = completeProbeGatewaySampleV1(
      second.fragment,
      second.durationMs,
    );

    expect(first.fragment.identity.codeId).toBe("rtp-code-direct-v1-stable");
    expect(second.fragment.identity.codeId).toBe("rtp-code-direct-v1-stable");
    expect(first.fragment.startup.workerLoader).toBe("callback-ran");
    expect(second.fragment.startup.workerLoader).toBe("callback-not-run");
    expect(firstSample.spans.map(span => span.name)).toEqual([
      "external_request",
      "gateway_dynamic_rtt",
    ]);
    expect(validateProbeTraceV1(firstSample)).toEqual({ ok: true });
    expect(validateProbeTraceV1(secondSample)).toEqual({ ok: true });
    expect(first.raw).not.toContain("xxxxxxxx");
  });

  it("uses bounded distinct Worker Loader IDs for new-code samples", async () => {
    const request = validSampleRequest("dynamic_direct_echo", "p03_new_code", {
      codeMode: "new-code",
      repetitions: 2,
    });
    const first = await measuredDispatch(harness, request);
    const second = await measuredDispatch(harness, {
      ...request,
      sampleOrdinal: 1,
    });
    const overBudget = await dispatch(
      harness,
      validSampleRequest("dynamic_direct_echo", "p03_over_budget", {
        codeMode: "new-code",
        repetitions: 17,
      }),
    );

    expect(first.fragment.identity.codeId).toBe(
      "rtp-code-direct-v1-p03_new_code-0",
    );
    expect(second.fragment.identity.codeId).toBe(
      "rtp-code-direct-v1-p03_new_code-1",
    );
    expect(first.fragment.identity.codeId).not.toBe(
      second.fragment.identity.codeId,
    );
    expect(first.fragment.startup.workerLoader).toBe("callback-ran");
    expect(second.fragment.startup.workerLoader).toBe("callback-ran");
    expect(overBudget.status).toBe(400);
  });

  it("measures distinct attempt facets and stable-code callback cohorts", async () => {
    const request = validSampleRequest("facet_echo", "p04_facet", {
      payloadBytes: 8,
      repetitions: 2,
      sessionMode: "reuse-session",
    });
    const first = await measuredDispatch(harness, request);
    const second = await measuredDispatch(harness, {
      ...request,
      sampleOrdinal: 1,
    });
    const firstSample = completeProbeGatewaySampleV1(
      first.fragment,
      first.durationMs,
    );
    const secondSample = completeProbeGatewaySampleV1(
      second.fragment,
      second.durationMs,
    );

    expect(first.fragment.identity.sessionId).toBe(
      second.fragment.identity.sessionId,
    );
    expect(first.fragment.identity.attemptId).not.toBe(
      second.fragment.identity.attemptId,
    );
    expect(first.fragment.startup).toEqual({
      workerLoader: "callback-ran",
      facet: "callback-ran",
    });
    expect(second.fragment.startup).toEqual({
      workerLoader: "callback-not-run",
      facet: "callback-ran",
    });
    expect(firstSample.spans.map(span => span.name)).toEqual([
      "external_request",
      "gateway_session_rtt",
      "session_facet_rtt",
    ]);
    expect(validateProbeTraceV1(firstSample)).toEqual({ ok: true });
    expect(validateProbeTraceV1(secondSample)).toEqual({ ok: true });
  });

  it("writes, synchronizes, seals, and read-verifies bounded facet journals", async () => {
    const ordinary = await measuredDispatch(
      harness,
      validSampleRequest("facet_journal", "p04_journal", {
        journalEntries: 3,
        payloadBytes: 32,
      }),
    );
    const maxEntries = await measuredDispatch(
      harness,
      validSampleRequest("facet_journal", "p04_max_entries", {
        journalEntries: 256,
        payloadBytes: 1,
      }),
    );
    const maxPayload = await measuredDispatch(
      harness,
      validSampleRequest("facet_journal", "p04_max_payload", {
        journalEntries: 1,
        payloadBytes: 65_536,
      }),
    );
    const sample = completeProbeGatewaySampleV1(
      ordinary.fragment,
      ordinary.durationMs,
    );

    expect(sample.spans.map(span => span.name)).toEqual([
      "external_request",
      "gateway_session_rtt",
      "session_facet_rtt",
      "facet_journal_io",
    ]);
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });
    expect(ordinary.raw).not.toContain("x".repeat(32));
    expect(maxEntries.fragment.outcome).toEqual({ kind: "ok" });
    expect(maxPayload.fragment.outcome).toEqual({ kind: "ok" });
  });

  it("rejects journal limits before starting the attempt facet", async () => {
    const runId = "p04_prestart_limit";
    const invalid = validSampleRequest("facet_journal", runId, {
      codeMode: "new-code",
      journalEntries: 257,
    });
    const rejected = await dispatch(harness, invalid);
    const accepted = await measuredDispatch(harness, {
      ...invalid,
      run: {
        ...invalid.run,
        dimensions: { ...invalid.run.dimensions, journalEntries: 1 },
      },
    });

    expect(rejected.status).toBe(400);
    expect(accepted.fragment.startup).toEqual({
      workerLoader: "callback-ran",
      facet: "callback-ran",
    });
  });

  it("deletes ordinary measurement facets before the response returns", async () => {
    const runId = "p04_measure_delete";
    const measured = await measuredDispatch(
      harness,
      validSampleRequest("facet_echo", runId),
    );
    const read = await facetLifecycle(
      harness,
      runId,
      0,
      "read",
      "new-session",
    );
    expect(measured.fragment.identity.attemptId).toBe(read.attemptId);
    expect(read.value).toBe(0);
    expect(read.facetStartupCallbackRan).toBe(true);
    await facetLifecycle(harness, runId, 0, "delete", "new-session");
  });

  it("preserves facet storage across abort and removes it on delete", async () => {
    const runId = "p04_lifecycle";
    const appended = await facetLifecycle(harness, runId, 0, "append");
    const warmRead = await facetLifecycle(harness, runId, 0, "read");
    const aborted = await facetLifecycle(harness, runId, 0, "abort");
    const resumedRead = await facetLifecycle(harness, runId, 0, "read");
    const deleted = await facetLifecycle(harness, runId, 0, "delete");
    const resetRead = await facetLifecycle(harness, runId, 0, "read");
    const freshAttempt = await facetLifecycle(harness, runId, 1, "read");

    expect(appended.value).toBe(1);
    expect(warmRead.value).toBe(1);
    expect(warmRead.facetStartupCallbackRan).toBe(false);
    expect(aborted.value).toBeNull();
    expect(aborted.facetStartupCallbackRan).toBe(false);
    expect(resumedRead.value).toBe(1);
    expect(resumedRead.facetStartupCallbackRan).toBe(true);
    expect(deleted.value).toBeNull();
    expect(resetRead.value).toBe(0);
    expect(resetRead.facetStartupCallbackRan).toBe(true);
    expect(freshAttempt.sessionId).toBe(resetRead.sessionId);
    expect(freshAttempt.attemptId).not.toBe(resetRead.attemptId);
    expect(freshAttempt.value).toBe(0);

    await facetLifecycle(harness, runId, 0, "delete");
    await facetLifecycle(harness, runId, 1, "delete");
  });

  it("rejects code identity changes for live and destructive facet controls", async () => {
    const runId = "p04_code_swap";
    expect((await facetLifecycle(harness, runId, 0, "append")).value).toBe(1);
    const conflict = await dispatchFacetLifecycle(
      harness,
      runId,
      0,
      "read",
      "reuse-session",
      "new-code",
    );
    const abortConflict = await dispatchFacetLifecycle(
      harness,
      runId,
      0,
      "abort",
      "reuse-session",
      "new-code",
    );
    const deleteConflict = await dispatchFacetLifecycle(
      harness,
      runId,
      0,
      "delete",
      "reuse-session",
      "new-code",
    );
    expect(conflict.status).toBe(409);
    expect(abortConflict.status).toBe(409);
    expect(deleteConflict.status).toBe(409);
    expect((await facetLifecycle(harness, runId, 0, "read")).value).toBe(1);
    await facetLifecycle(harness, runId, 0, "delete");
  });

  it("rehydrates a retained facet after a Miniflare restart", async () => {
    const firstHarness = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const persistPath = firstHarness.persistPath;
    let firstDisposed = false;
    try {
      expect(
        (await facetLifecycle(firstHarness, "p04_restart", 0, "append")).value,
      ).toBe(1);
      await firstHarness.dispose();
      firstDisposed = true;

      const restarted = await createRuntimeProbeHarness({ persistPath });
      try {
        const read = await facetLifecycle(
          restarted,
          "p04_restart",
          0,
          "read",
        );
        expect(read.value).toBe(1);
        expect(read.facetStartupCallbackRan).toBe(true);
        await facetLifecycle(restarted, "p04_restart", 0, "delete");
      } finally {
        await restarted.dispose();
      }
    } finally {
      if (!firstDisposed) await firstHarness.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  });

  it("fails closed for Dynamic Worker scenarios without a Loader binding", async () => {
    const noLoaderHarness = await createRuntimeProbeHarness({
      workerLoader: false,
    });
    try {
      const dynamic = await dispatch(
        noLoaderHarness,
        validSampleRequest("dynamic_direct_echo", "p03_no_loader"),
      );
      const edge = await dispatch(
        noLoaderHarness,
        validSampleRequest("edge_echo", "p03_no_loader_edge"),
      );
      expect(dynamic.status).toBe(500);
      expect(edge.status).toBe(200);
    } finally {
      await noLoaderHarness.dispose();
    }
  });

  it("isolates SQLite control state by deterministic session identity and resets it", async () => {
    const firstSession = derivedSessionId("p02_isolation", 0);
    const secondSession = derivedSessionId("p02_isolation", 1);

    expect(await controlValue(harness, firstSession, "increment")).toBe(1);
    expect(await controlValue(harness, firstSession, "increment")).toBe(2);
    expect(await controlValue(harness, secondSession, "increment")).toBe(1);
    expect(await controlValue(harness, firstSession, "read")).toBe(2);
    expect(await controlValue(harness, secondSession, "read")).toBe(1);
    expect(await controlValue(harness, firstSession, "reset")).toBe(0);
    expect(await controlValue(harness, firstSession, "read")).toBe(0);
    expect(await controlValue(harness, firstSession, "increment")).toBe(1);
  });

  it("persists SQLite control state across a Miniflare restart", async () => {
    const firstHarness = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const sessionId = derivedSessionId("p02_restart", 0);
    const persistPath = firstHarness.persistPath;
    let firstDisposed = false;
    try {
      expect(await controlValue(firstHarness, sessionId, "increment")).toBe(1);
      await firstHarness.dispose();
      firstDisposed = true;

      const restartedHarness = await createRuntimeProbeHarness({ persistPath });
      try {
        expect(await controlValue(restartedHarness, sessionId, "read")).toBe(1);
      } finally {
        await restartedHarness.dispose();
      }
    } finally {
      if (!firstDisposed) await firstHarness.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  });

  it("rejects a wrong Durable Object name and a mismatched session body", async () => {
    const bindings = await harness.bindings();
    const runId = Effect.runSync(decodeProbeRunIdEffect("p02_mismatch"));
    const otherRunId = Effect.runSync(decodeProbeRunIdEffect("p02_other"));
    const ordinal = Effect.runSync(decodeProbeOrdinalEffect(0));
    const firstSession = probeSessionId(runId, ordinal);
    const secondSession = probeSessionId(otherRunId, ordinal);
    const body = ProbeSessionEchoRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: otherRunId,
      sampleId: probeSampleId(otherRunId, ordinal),
      sampleOrdinal: ordinal,
      sessionId: secondSession,
      sessionMode: "new-session",
      payload: "",
    });
    const crossRunBody = {
      ...body,
      runId,
      sampleId: probeSampleId(runId, ordinal),
    };
    const invalidName = await bindings.PROBE_SESSIONS.getByName(
      "not-a-probe-session",
    ).fetch("https://probe-session.internal/v1/echo", internalEchoInit(body));
    const mismatched = await bindings.PROBE_SESSIONS.getByName(
      firstSession,
    ).fetch("https://probe-session.internal/v1/echo", internalEchoInit(body));
    const crossRun = await bindings.PROBE_SESSIONS.getByName(
      secondSession,
    ).fetch(
      "https://probe-session.internal/v1/echo",
      internalEchoInit(crossRunBody),
    );

    expect(invalidName.status).toBe(409);
    expect(mismatched.status).toBe(409);
    expect(crossRun.status).toBe(400);
  });

  it("rejects scenarios that are valid in P01 but outside P04", async () => {
    const response = await dispatch(
      harness,
      validSampleRequest("full_invoke", "p04_future"),
    );
    expect(response.status).toBe(422);
  });
});

type SupportedScenario =
  | "dynamic_direct_echo"
  | "edge_echo"
  | "facet_echo"
  | "facet_journal"
  | "full_invoke"
  | "session_echo";

interface SampleOverrides {
  readonly codeMode?: "new-code" | "stable";
  readonly payloadBytes?: number;
  readonly journalEntries?: number;
  readonly repetitions?: number;
  readonly sessionMode?: "new-session" | "reuse-session";
}

function validSampleRequest(
  scenario: SupportedScenario,
  runId: string,
  overrides: SampleOverrides = {},
) {
  const payloadBytes = overrides.payloadBytes ?? 0;
  return {
    run: {
      protocolVersion: 1,
      runId,
      scenario,
      repetitions: overrides.repetitions ?? 1,
      warmupRepetitions: 0,
      dimensions: {
        codeMode: overrides.codeMode ?? "stable",
        concurrency: 1,
        journalEntries: overrides.journalEntries ?? 0,
        payloadBytes,
        sessionMode: overrides.sessionMode ?? "new-session",
      },
    },
    sampleOrdinal: 0,
    phase: "measurement",
    payload: "x".repeat(payloadBytes),
  };
}

interface DispatchOptions {
  readonly authorization?: string;
  readonly authorized?: boolean;
}

async function dispatch(
  harness: RuntimeProbeHarness,
  body: unknown,
  options: DispatchOptions = {},
) {
  const authorization = options.authorized === false
    ? undefined
    : options.authorization ?? PROBE_TEST_AUTHORIZATION;
  return await harness.mf.dispatchFetch(
    `https://probe.test${PROBE_SAMPLE_ROUTE}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === undefined ? {} : { authorization }),
      },
      body: JSON.stringify(body),
    },
  );
}

async function measuredDispatch(
  harness: RuntimeProbeHarness,
  body: unknown,
): Promise<{
  readonly durationMs: number;
  readonly fragment: ProbeGatewaySampleV1;
  readonly raw: string;
}> {
  const startedAt = performance.now();
  const response = await dispatch(harness, body);
  const raw = await response.text();
  const durationMs = Math.max(0, performance.now() - startedAt);
  expect(response.status).toBe(200);
  const value: unknown = JSON.parse(raw);
  const fragment = await Effect.runPromise(
    decodeProbeGatewaySampleV1Effect(value),
  );
  return { durationMs, fragment, raw };
}

async function controlValue(
  harness: RuntimeProbeHarness,
  sessionId: ProbeSessionId,
  operation: "increment" | "read" | "reset",
): Promise<number> {
  const bindings = await harness.bindings();
  const response = await bindings.PROBE_SESSIONS.getByName(sessionId).fetch(
    `https://probe-session.internal/v1/control/${operation}`,
    {
      method: operation === "read" ? "GET" : "POST",
    },
  );
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  const decoded = await Effect.runPromise(
    decodeProbeSessionControlResponseV1Effect(value),
  );
  expect(decoded.sessionId).toBe(sessionId);
  return decoded.value;
}

async function facetLifecycle(
  harness: RuntimeProbeHarness,
  runIdValue: string,
  sampleOrdinalValue: number,
  operation: ProbeFacetLifecycleOperation,
  sessionMode: "new-session" | "reuse-session" = "reuse-session",
) {
  const response = await dispatchFacetLifecycle(
    harness,
    runIdValue,
    sampleOrdinalValue,
    operation,
    sessionMode,
    "stable",
  );
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  return await Effect.runPromise(
    decodeProbeFacetLifecycleSessionResponseV1Effect(value),
  );
}

async function dispatchFacetLifecycle(
  harness: RuntimeProbeHarness,
  runIdValue: string,
  sampleOrdinalValue: number,
  operation: ProbeFacetLifecycleOperation,
  sessionMode: "new-session" | "reuse-session",
  codeMode: "new-code" | "stable",
): Promise<Response> {
  const bindings = await harness.bindings();
  const runId = Effect.runSync(decodeProbeRunIdEffect(runIdValue));
  const sampleOrdinal = Effect.runSync(
    decodeProbeOrdinalEffect(sampleOrdinalValue),
  );
  const sessionOrdinal = sessionMode === "reuse-session"
    ? Effect.runSync(decodeProbeOrdinalEffect(0))
    : sampleOrdinal;
  const sessionId = probeSessionId(runId, sessionOrdinal);
  const body = ProbeFacetLifecycleRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scenario: "facet_echo",
    sessionId,
    sessionMode,
    attemptId: probeAttemptId(runId, sessionOrdinal, sampleOrdinal),
    codeMode,
    codeId: codeMode === "stable"
      ? probeCodeId({ mode: "stable", profile: "facet" })
      : probeCodeId({
          mode: "new-code",
          profile: "facet",
          runId,
          version: sampleOrdinal,
        }),
    journalEntries: 0,
    operation,
  });
  return await bindings.PROBE_SESSIONS.getByName(sessionId).fetch(
    "https://probe-session.internal/v1/facet-lifecycle",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function derivedSessionId(runIdValue: string, ordinalValue: number) {
  const runId = Effect.runSync(decodeProbeRunIdEffect(runIdValue));
  const ordinal = Effect.runSync(decodeProbeOrdinalEffect(ordinalValue));
  return probeSessionId(runId, ordinal);
}

function internalEchoInit(
  body: unknown,
): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function jsonHeaders(): Record<string, string> {
  return {
    authorization: PROBE_TEST_AUTHORIZATION,
    "content-type": "application/json",
  };
}
