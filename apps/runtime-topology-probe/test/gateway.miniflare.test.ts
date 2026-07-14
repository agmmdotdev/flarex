import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeSampleId,
  probeSessionId,
  type ProbeSessionId,
} from "../src/identity";
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

  it("rejects scenarios that are valid in P01 but outside P02", async () => {
    const response = await dispatch(
      harness,
      validSampleRequest("dynamic_direct_echo", "p02_future"),
    );
    expect(response.status).toBe(422);
  });
});

type SupportedScenario =
  | "dynamic_direct_echo"
  | "edge_echo"
  | "session_echo";

interface SampleOverrides {
  readonly payloadBytes?: number;
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
        codeMode: "stable",
        concurrency: 1,
        journalEntries: 0,
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
