import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeScopeId,
  probeSessionId,
  type ProbeSessionId,
} from "../src/identity";
import {
  decodeProbeFacetLifecycleSessionResponseV1Effect,
  ProbeFacetLifecycleRequestV1Schema,
  type ProbeFacetLifecycleOperation,
} from "../src/facetProtocol";
import {
  decodeProbeMockFinishResponseV1Effect,
  decodeProbeSyncControlResponseV1Effect,
  decodeProbeSyncWakeReceiptV1Effect,
  probeSyntheticCommitSeq,
  ProbeMockFinishRequestV1Schema,
  ProbeSyncControlRequestV1Schema,
  ProbeSyncWakeRequestV1Schema,
} from "../src/commitProtocol";
import { copyCloudflareRpcRecord } from "../src/effectBoundary";
import {
  decodeProbeFullInvokeSessionFailureV1Effect,
  decodeProbeFullInvokeSessionResponseV1Effect,
  probeFacetFinalizerWorkerCode,
  probeInvokeWorkerCode,
  ProbeInvokeFacetRequestV1Schema,
  PROBE_INVOKE_WORKER_MAIN_MODULE,
} from "../src/invokeProtocol";
import {
  probeRerunWorkerCode,
  PROBE_RERUN_WORKER_MAIN_MODULE,
} from "../src/rerunProtocol";
import {
  PROBE_PUBLIC_BODY_MAX_BYTES,
  PROBE_RUN_ROUTE,
  PROBE_SAMPLE_ROUTE,
} from "../src/gateway";
import { ProbeSessionPurgeRequestV1Schema } from "../src/purgeProtocol";
import {
  completeProbeGatewaySampleV1,
  decodeProbeControlledGatewaySampleV1Effect,
  type ProbeGatewaySampleV1,
  type ProbeSampleControlV1,
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
  type RuntimeProbeHarnessOptions,
} from "./runtimeHarness";
import { runEffectTest, runEffectTestSync } from "./effectTest";

describe.sequential("P02 gateway and ProbeSessionDO in Miniflare", () => {
  let harness: RuntimeProbeHarness;

  beforeEach(async () => {
    harness = await createRuntimeProbeHarness();
  });

  afterEach(async () => {
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

  it("authenticates immutable run registration and status without exposing claim tokens", async () => {
    const fixture = validSampleRequest("edge_echo", "p07a_public_run", {
      repetitions: 2,
    });
    const unauthorized = await dispatchRun(harness, fixture.run, undefined);
    const created = await dispatchRun(
      harness,
      fixture.run,
      PROBE_TEST_AUTHORIZATION,
    );
    const repeated = await dispatchRun(
      harness,
      fixture.run,
      PROBE_TEST_AUTHORIZATION,
    );
    const conflict = await dispatchRun(
      harness,
      {
        ...fixture.run,
        dimensions: { ...fixture.run.dimensions, payloadBytes: 1 },
      },
      PROBE_TEST_AUTHORIZATION,
    );
    const sample = await dispatchSampleBody(
      harness,
      {
        protocolVersion: 1,
        runId: fixture.run.runId,
        sampleOrdinal: 0,
      },
      PROBE_TEST_AUTHORIZATION,
    );
    const status = await harness.mf.dispatchFetch(
      `https://probe.test${PROBE_RUN_ROUTE}/${fixture.run.runId}`,
      { headers: { authorization: PROBE_TEST_AUTHORIZATION } },
    );
    const statusText = await status.text();

    expect(unauthorized.status).toBe(401);
    expect(created.status).toBe(201);
    expect(repeated.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(sample.status).toBe(200);
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("no-store");
    expect(statusText).not.toContain("rtp-claim-");
    expect(statusText).not.toContain("claimToken");
  });

  it("rejects caller-owned run, phase, and payload fields on the sample route", async () => {
    const legacy = validSampleRequest("edge_echo", "p07a_legacy_body");
    const response = await dispatchSampleBody(
      harness,
      legacy,
      PROBE_TEST_AUTHORIZATION,
    );
    expect(response.status).toBe(400);
  });

  it("derives warmup phase and payload from the registered run", async () => {
    const request = validSampleRequest("edge_echo", "p07a_derived", {
      payloadBytes: 8,
      repetitions: 2,
      warmupRepetitions: 1,
    });
    const measured = await measuredDispatch(harness, request);

    expect(measured.control).toMatchObject({
      phase: "warmup",
      terminalState: "completed",
      measurementDisposition: "excluded-warmup",
      configuredConcurrency: 1,
      observedOutstandingClaims: 1,
      externalRequestIncludesControlPlane: true,
    });
    expect(measured.fragment.dimensions.payloadBytes).toBe(8);
    expect(measured.raw).not.toContain("xxxxxxxx");
    expect(measured.raw).not.toContain("rtp-claim-");
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

    expect(first.fragment.identity.codeId).toBe("rtp-code-direct-v2-stable");
    expect(second.fragment.identity.codeId).toBe("rtp-code-direct-v2-stable");
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
      "rtp-code-direct-v2-p03_new_code-0",
    );
    expect(second.fragment.identity.codeId).toBe(
      "rtp-code-direct-v2-p03_new_code-1",
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
    const maxEntries = await measuredDispatchOnFreshHarness(
      validSampleRequest("facet_journal", "p04_max_entries", {
        journalEntries: 256,
        payloadBytes: 1,
      }),
    );
    const maxPayload = await measuredDispatchOnFreshHarness(
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
      const dynamic = await measuredDispatch(
        noLoaderHarness,
        validSampleRequest("dynamic_direct_echo", "p03_no_loader"),
      );
      const edgeStatus = await dispatchStatusOnFreshHarness(
        validSampleRequest("edge_echo", "p03_no_loader_edge"),
        { workerLoader: false },
      );
      const status = await noLoaderHarness.mf.dispatchFetch(
        `https://probe.test${PROBE_RUN_ROUTE}/p03_no_loader`,
        { headers: { authorization: PROBE_TEST_AUTHORIZATION } },
      );
      expect(dynamic.fragment.outcome.kind).toBe("error");
      expect(dynamic.control.terminalState).toBe("failed");
      expect(edgeStatus).toBe(200);
      expect(await status.json()).toMatchObject({
        kind: "found",
        status: {
          counters: { failed: 1, outstanding: 0 },
          samples: [{ state: "failed", sampleOrdinal: 0 }],
        },
      });
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

  it("forwards one-shot sync reruns into fresh facets without moving the cursor", async () => {
    const request = validSampleRequest("sync_rerun", "p06_rerun_stable", {
      payloadBytes: 16,
      repetitions: 2,
    });
    expect(await syncCursor(harness, "p06_rerun_stable", "read")).toBe(0);

    const first = await measuredDispatch(harness, request);
    const repeated = await measuredDispatch(harness, {
      ...request,
      sampleOrdinal: 1,
    });
    const sample = completeProbeGatewaySampleV1(
      first.fragment,
      first.durationMs,
    );

    expect(first.fragment.identity).toMatchObject({
      codeId: "rtp-code-rerun-v2-stable",
      sessionId: "rtp-session-p06_rerun_stable-0",
      attemptId: "rtp-attempt-p06_rerun_stable-0-0",
    });
    expect(first.fragment.startup).toEqual({
      workerLoader: "callback-ran",
      facet: "callback-ran",
    });
    expect(repeated.fragment.startup).toEqual({
      workerLoader: "callback-not-run",
      facet: "callback-ran",
    });
    expect(sample.spans.map(span => span.name)).toEqual([
      "external_request",
      "sync_runtime_rerun_rtt",
      "gateway_session_rtt",
      "session_facet_rtt",
    ]);
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });
    expect(first.raw).not.toContain("terminalAck");
    expect(first.raw).not.toContain("capabilityCallCount");
    expect(await syncCursor(harness, "p06_rerun_stable", "read")).toBe(0);
  });

  it("uses fresh sessions and distinct rerun-v1 identities for new code", async () => {
    const request = validSampleRequest("sync_rerun", "p06_rerun_new_code", {
      codeMode: "new-code",
      repetitions: 2,
    });
    const first = await measuredDispatch(harness, request);
    const second = await measuredDispatch(harness, {
      ...request,
      sampleOrdinal: 1,
    });

    expect(first.fragment.identity).toMatchObject({
      codeId: "rtp-code-rerun-v2-p06_rerun_new_code-0",
      sessionId: "rtp-session-p06_rerun_new_code-0",
      attemptId: "rtp-attempt-p06_rerun_new_code-0-0",
    });
    expect(second.fragment.identity).toMatchObject({
      codeId: "rtp-code-rerun-v2-p06_rerun_new_code-1",
      sessionId: "rtp-session-p06_rerun_new_code-1",
      attemptId: "rtp-attempt-p06_rerun_new_code-1-1",
    });
    expect(first.fragment.startup.workerLoader).toBe("callback-ran");
    expect(second.fragment.startup.workerLoader).toBe("callback-ran");
    expect(await syncCursor(harness, "p06_rerun_new_code", "read")).toBe(0);
  });

  it("measures the full session, facet, mock-read, journal, finish, and sync path", async () => {
    const request = validSampleRequest("full_invoke", "p05_full_invoke", {
      journalEntries: 2,
      payloadBytes: 16,
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

    expect(first.fragment.identity.codeId).toBe(
      "rtp-code-invoke-v2-stable",
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
      "facet_mock_read_rtt",
      "facet_journal_io",
      "session_mock_finish_rtt",
      "mock_sync_wake_rtt",
      "sync_cursor_io",
    ]);
    expect(validateProbeTraceV1(firstSample)).toEqual({ ok: true });
    expect(validateProbeTraceV1(secondSample)).toEqual({ ok: true });
    expect(await syncCursor(harness, "p05_full_invoke", "read")).toBe(2);

    const resetFacet = await facetLifecycle(
      harness,
      "p05_full_invoke",
      1,
      "read",
    );
    expect(resetFacet.value).toBe(0);
    await facetLifecycle(harness, "p05_full_invoke", 1, "delete");
  });

  it("compares the external Worker and SessionDO executor hosts with exact traces", async () => {
    const external = await measuredDispatchOnFreshHarness(
      validSampleRequest("executor_worker_invoke", "p12_test_external", {
        journalEntries: 2,
        payloadBytes: 64,
      }),
    );
    const session = await measuredDispatchOnFreshHarness(
      validSampleRequest("session_executor_invoke", "p12_test_session", {
        journalEntries: 2,
        payloadBytes: 64,
      }),
    );
    const externalSample = completeProbeGatewaySampleV1(
      external.fragment,
      external.durationMs,
    );
    const sessionSample = completeProbeGatewaySampleV1(
      session.fragment,
      session.durationMs,
    );

    expect(externalSample.spans.map(span => span.name)).toEqual([
      "external_request",
      "gateway_session_rtt",
      "session_facet_rtt",
      "facet_mock_read_rtt",
      "facet_journal_io",
      "session_mock_finish_rtt",
      "mock_sync_wake_rtt",
      "sync_cursor_io",
    ]);
    expect(sessionSample.spans.map(span => span.name)).toEqual([
      "external_request",
      "gateway_session_rtt",
      "session_facet_rtt",
      "facet_session_read_rtt",
      "facet_journal_io",
      "session_executor_finish",
      "session_sync_wake_rtt",
      "sync_cursor_io",
    ]);
    expect(validateProbeTraceV1(externalSample)).toEqual({ ok: true });
    expect(validateProbeTraceV1(sessionSample)).toEqual({ ok: true });
    expect(external.control.syncWake).toEqual({
      kind: "observed",
      disposition: "applied",
    });
    expect(session.control.syncWake).toEqual({
      kind: "observed",
      disposition: "applied",
    });
  });

  it("executes from a trusted snapshot inside the facet with no outbound read", async () => {
    const measured = await measuredDispatchOnFreshHarness(
      validSampleRequest("facet_executor_invoke", "p16_test_facet", {
        journalEntries: 2,
        payloadBytes: 64,
      }),
    );
    const sample = completeProbeGatewaySampleV1(
      measured.fragment,
      measured.durationMs,
    );
    expect(sample.spans.map(span => span.name)).toEqual([
      "external_request",
      "gateway_session_rtt",
      "session_snapshot_read_rtt",
      "session_facet_rtt",
      "facet_snapshot_read",
      "facet_journal_io",
      "session_mock_finish_rtt",
      "mock_sync_wake_rtt",
      "sync_cursor_io",
    ]);
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });
    expect(measured.control.syncWake).toEqual({
      kind: "observed",
      disposition: "applied",
    });

    const directRequest = facetExecutorInvokeRequest("p16_direct_receipt");
    const response = await directFullInvoke(harness, directRequest);
    expect(response.status).toBe(200);
    const receipt = await runEffectTest(
      decodeProbeFullInvokeSessionResponseV1Effect(await response.json()),
    );
    expect(receipt).toMatchObject({
      executorHost: "facet-do",
      readCapabilityCalls: 0,
      facet: {
        readMode: "prefetched-snapshot",
        outboundReadCalls: 0,
      },
    });
    expect(receipt.snapshotReadDurationMs).not.toBeNull();
    expect(receipt.facet.commitIntent).toMatchObject({
      protocolVersion: 1,
      snapshotRevision: 0,
      journalEntries: 2,
      journalSealDigest: receipt.facet.sealDigest,
      resultDigest: receipt.facet.resultDigest,
    });
    expect(receipt.facet.commitIntent.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lets the trusted facet finalize through one narrow atomic capability", async () => {
    const measured = await measuredDispatchOnFreshHarness(
      validSampleRequest("facet_finalizer_invoke", "p20_test_finalizer", {
        journalEntries: 2,
        payloadBytes: 64,
      }),
    );
    const sample = completeProbeGatewaySampleV1(
      measured.fragment,
      measured.durationMs,
    );
    expect(sample.spans.map(span => span.name)).toEqual([
      "external_request",
      "gateway_session_rtt",
      "session_snapshot_read_rtt",
      "session_facet_rtt",
      "facet_snapshot_read",
      "facet_journal_io",
      "facet_atomic_commit_rtt",
      "mock_sync_wake_rtt",
      "sync_cursor_io",
    ]);
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });
    expect(measured.control.syncWake).toEqual({
      kind: "observed",
      disposition: "applied",
    });

    const directRequest = facetFinalizerInvokeRequest("p20_direct_finalizer");
    const first = await directFullInvoke(harness, directRequest);
    const firstBody = await first.text();
    expect(first.status, firstBody).toBe(200);
    const receipt = await runEffectTest(
      decodeProbeFullInvokeSessionResponseV1Effect(JSON.parse(firstBody)),
    );
    expect(receipt).toMatchObject({
      executorHost: "facet-finalizer",
      readCapabilityCalls: 0,
      sessionMockFinishDurationMs: 0,
      facet: {
        readMode: "prefetched-snapshot",
        outboundReadCalls: 0,
        outboundFinishCalls: 1,
        attemptPhase: "committed",
      },
    });
    expect(receipt.snapshotReadDurationMs).not.toBeNull();
    expect(receipt.facet.facetFinalizationDurationMs).not.toBeNull();
    expect(receipt.facet.finish).toEqual(receipt.finish);
    expect(receipt.finish.sync).toMatchObject({
      disposition: "applied",
      previousCursor: 0,
      cursor: 1,
    });
    await expect(runEffectTest(
      decodeProbeFullInvokeSessionResponseV1Effect({
        ...receipt,
        finish: {
          ...receipt.finish,
          syncWakeDurationMs: receipt.finish.syncWakeDurationMs + 1,
        },
      }),
    )).rejects.toBeDefined();

    const repeated = await directFullInvoke(harness, directRequest);
    const changed = await directFullInvoke(harness, {
      ...directRequest,
      payload: `${directRequest.payload}x`,
    });
    expect(repeated.status).toBe(200);
    expect(await repeated.text()).toBe(firstBody);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({
      error: "facet_finalizer_attempt_conflict",
    });
    expect(await syncCursor(harness, "p20_direct_finalizer", "read")).toBe(1);
  });

  it("reuses one warm finalizer facet across requests without leaking attempt state", async () => {
    const publicRequest = validSampleRequest(
      "facet_finalizer_warm_invoke",
      "p24_warm_public",
      {
        repetitions: 2,
        journalEntries: 2,
        payloadBytes: 64,
        sessionMode: "reuse-session",
      },
    );
    const publicFirst = await measuredDispatch(harness, publicRequest);
    const publicWarm = await measuredDispatch(harness, {
      ...publicRequest,
      sampleOrdinal: 1,
    });
    expect(publicFirst.fragment.startup).toEqual({
      workerLoader: "callback-ran",
      facet: "callback-ran",
      sessionActivation: "activation-observed",
    });
    expect(publicWarm.fragment.startup).toEqual({
      workerLoader: "callback-not-run",
      facet: "callback-not-run",
      sessionActivation: "activation-not-observed",
    });

    const firstRequest = warmFacetFinalizerInvokeRequest(
      "p24_warm_finalizer",
      0,
    );
    const secondRequest = warmFacetFinalizerInvokeRequest(
      "p24_warm_finalizer",
      1,
    );
    const first = await directFullInvoke(harness, firstRequest);
    const firstBody = await first.text();
    const second = await directFullInvoke(harness, secondRequest);
    const secondBody = await second.text();

    expect(first.status, firstBody).toBe(200);
    expect(second.status, secondBody).toBe(200);
    const firstReceipt = await runEffectTest(
      decodeProbeFullInvokeSessionResponseV1Effect(JSON.parse(firstBody)),
    );
    const secondReceipt = await runEffectTest(
      decodeProbeFullInvokeSessionResponseV1Effect(JSON.parse(secondBody)),
    );
    expect(firstReceipt).toMatchObject({
      workerLoaderCallbackRan: true,
      facetStartupCallbackRan: true,
      sessionActivationObserved: true,
      executorHost: "facet-finalizer",
    });
    expect(secondReceipt).toMatchObject({
      workerLoaderCallbackRan: false,
      facetStartupCallbackRan: false,
      sessionActivationObserved: false,
      executorHost: "facet-finalizer",
    });
    expect(firstReceipt.facet.facetId).toBe(secondReceipt.facet.facetId);
    expect(firstReceipt.facet.attemptId).not.toBe(secondReceipt.facet.attemptId);
    expect(firstReceipt.facet.sealDigest).not.toBe(secondReceipt.facet.sealDigest);
    expect(firstReceipt.facet.resultDigest).not.toBe(secondReceipt.facet.resultDigest);
    expect(firstReceipt.finish.sync).toMatchObject({
      previousCursor: 0,
      cursor: 1,
      disposition: "applied",
    });
    expect(secondReceipt.finish.sync).toMatchObject({
      previousCursor: 1,
      cursor: 2,
      disposition: "applied",
    });

    const replayed = await directFullInvoke(harness, secondRequest);
    const changed = await directFullInvoke(harness, {
      ...secondRequest,
      payload: `${secondRequest.payload}x`,
    });
    expect(replayed.status).toBe(200);
    expect(await replayed.text()).toBe(secondBody);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({
      error: "facet_finalizer_attempt_conflict",
    });
    expect(await syncCursor(harness, "p24_warm_finalizer", "read")).toBe(2);
    expect(await purgeFacetFinalizerAttempt(harness, firstRequest)).toMatchObject({
      kind: "probe-data-cleared",
      deletedFacets: 1,
      probeDataCleared: true,
      completionTombstoneRetained: true,
    });
  }, 60_000);

  it("recovers a post-apply facet finalizer from its exact terminal outcome", async () => {
    const uncertainHarness = await createRuntimeProbeHarness({
      mockFinishMode: "apply-then-throw",
    });
    try {
      const publicFailure = await measuredDispatch(
        uncertainHarness,
        validSampleRequest(
          "facet_finalizer_invoke",
          "p20_uncertain_public",
          { journalEntries: 2, payloadBytes: 64 },
        ),
      );
      expect(publicFailure.fragment.outcome).toEqual({
        kind: "error",
        error: {
          code: "outcome_uncertain",
          retryable: false,
          stage: "gateway_session_rtt",
        },
      });
      expect(publicFailure.control.syncWake).toEqual({ kind: "unobserved" });

      const request = facetFinalizerInvokeRequest("p20_uncertain_finalizer");
      const first = await directFullInvoke(uncertainHarness, request);
      const repeated = await directFullInvoke(uncertainHarness, request);

      expect(first.status).toBe(502);
      expect(await first.json()).toEqual({
        protocolVersion: 1,
        sessionId: request.sessionId,
        attemptId: request.attemptId,
        error: "facet_finalizer_outcome_uncertain",
      });
      expect(repeated.status).toBe(200);
      const recovered = await repeated.json() as {
        readonly finish?: {
          readonly commitAuthority?: unknown;
          readonly sync?: { readonly disposition?: unknown };
        };
      };
      expect(recovered.finish?.commitAuthority).toBe("mock");
      expect(recovered.finish?.sync?.disposition).toBe("duplicate");
      const replayed = await directFullInvoke(uncertainHarness, request);
      expect(replayed.status).toBe(200);
      expect(await replayed.json()).toEqual(recovered);
      expect(
        await syncCursor(uncertainHarness, "p20_uncertain_finalizer", "read"),
      ).toBe(1);
      expect(await purgeFacetFinalizerAttempt(uncertainHarness, request))
        .toMatchObject({
          kind: "probe-data-cleared",
          deletedFacets: 1,
          probeDataCleared: true,
          completionTombstoneRetained: true,
        });
      expect(await purgeFacetFinalizerAttempt(
        uncertainHarness,
        facetFinalizerInvokeRequest("p20_uncertain_public"),
      )).toMatchObject({
        kind: "probe-data-cleared",
        deletedFacets: 1,
        probeDataCleared: true,
        completionTombstoneRetained: true,
      });
    } finally {
      await uncertainHarness.dispose();
    }
  });

  it("durably replays an exact known-stale facet finalizer receipt", async () => {
    const request = facetFinalizerInvokeRequest("p20_stale_finalizer");
    expect((await directSyncWake(harness, "p20_stale_finalizer", 0)).disposition)
      .toBe("applied");
    expect((await directSyncWake(harness, "p20_stale_finalizer", 1)).disposition)
      .toBe("applied");

    const first = await directFullInvoke(harness, request);
    const firstBody = await first.text();
    const repeated = await directFullInvoke(harness, request);
    expect(first.status).toBe(409);
    const failure = await runEffectTest(
      decodeProbeFullInvokeSessionFailureV1Effect(JSON.parse(firstBody)),
    );
    expect(failure.finish.sync).toMatchObject({
      disposition: "stale",
      previousCursor: 2,
      cursor: 2,
    });
    expect(repeated.status).toBe(409);
    expect(await repeated.text()).toBe(firstBody);
    expect(await syncCursor(harness, "p20_stale_finalizer", "read")).toBe(2);
  });

  it("replays one completed facet-executor attempt and rejects changed evidence", async () => {
    const request = facetExecutorInvokeRequest("p16_facet_replay");
    const first = await directFullInvoke(harness, request);
    const repeated = await directFullInvoke(harness, request);
    const changed = await directFullInvoke(harness, {
      ...request,
      payload: `${request.payload}x`,
    });
    const firstBody = await first.text();

    expect(first.status, firstBody).toBe(200);
    expect(repeated.status).toBe(200);
    expect(await repeated.text()).toBe(firstBody);
    await runEffectTest(
      decodeProbeFullInvokeSessionResponseV1Effect(JSON.parse(firstBody)),
    );
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({
      error: "facet_executor_attempt_conflict",
    });
    expect(await syncCursor(harness, "p16_facet_replay", "read")).toBe(1);
  });

  it("gives the external control the same durable replay and conflict fence", async () => {
    const request = externalExecutorInvokeRequest("p16_external_replay");
    const first = await directFullInvoke(harness, request);
    const repeated = await directFullInvoke(harness, request);
    const changed = await directFullInvoke(harness, {
      ...request,
      payload: `${request.payload}x`,
    });
    const firstBody = await first.text();

    expect(first.status, firstBody).toBe(200);
    expect(repeated.status).toBe(200);
    expect(await repeated.text()).toBe(firstBody);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({
      error: "executor_worker_attempt_conflict",
    });
    expect(await syncCursor(harness, "p16_external_replay", "read")).toBe(1);
  });

  it("fails an in-progress facet-executor duplicate closed, then replays it", async () => {
    const delayed = await createRuntimeProbeHarness({ mockReadDelayMs: 500 });
    try {
      const request = facetExecutorInvokeRequest("p16_facet_concurrent");
      const bindings = await delayed.bindings();
      const session = bindings.PROBE_SESSIONS.getByName(request.sessionId);
      const invoke = () => session.fetch(
        "https://probe-session.internal/v1/full-invoke",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const responses = await Promise.all([invoke(), invoke()]);
      const completed = responses.find(response => response.status === 200);
      const busy = responses.find(response => response.status === 409);
      if (completed === undefined || busy === undefined) {
        throw new Error("expected one facet completion and one busy duplicate");
      }
      const completedBody = await completed.text();
      const replay = await invoke();

      expect(await busy.json()).toEqual({
        error: "facet_executor_attempt_busy",
      });
      expect(replay.status).toBe(200);
      expect(await replay.text()).toBe(completedBody);
      expect(
        await syncCursor(delayed, "p16_facet_concurrent", "read"),
      ).toBe(1);
    } finally {
      await delayed.dispose();
    }
  });

  it("fails an in-progress external-control duplicate closed, then replays it", async () => {
    const delayed = await createRuntimeProbeHarness({ mockReadDelayMs: 500 });
    try {
      const request = externalExecutorInvokeRequest("p16_external_concurrent");
      const bindings = await delayed.bindings();
      const session = bindings.PROBE_SESSIONS.getByName(request.sessionId);
      const invoke = () => session.fetch(
        "https://probe-session.internal/v1/full-invoke",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const responses = await Promise.all([invoke(), invoke()]);
      const completed = responses.find(response => response.status === 200);
      const busy = responses.find(response => response.status === 409);
      if (completed === undefined || busy === undefined) {
        throw new Error("expected one control completion and one busy duplicate");
      }
      const completedBody = await completed.text();
      const replay = await invoke();

      expect(await busy.json()).toEqual({
        error: "executor_worker_attempt_busy",
      });
      expect(replay.status).toBe(200);
      expect(await replay.text()).toBe(completedBody);
      expect(
        await syncCursor(delayed, "p16_external_concurrent", "read"),
      ).toBe(1);
    } finally {
      await delayed.dispose();
    }
  });

  it("replays one completed SessionDO attempt and rejects changed evidence", async () => {
    const request = candidateInvokeRequest("p12_session_replay");
    const completed = await measuredDispatch(
      harness,
      validSampleRequest(
        "session_executor_invoke",
        "p12_session_replay",
        { journalEntries: 2, payloadBytes: 64 },
      ),
    );
    const first = await directFullInvoke(harness, request);
    const repeated = await directFullInvoke(harness, request);
    const changed = await directFullInvoke(harness, {
      ...request,
      payload: `${request.payload}x`,
    });
    const rawFirst = await first.text();
    const rawRepeated = await repeated.text();

    expect(completed.fragment.outcome).toEqual({ kind: "ok" });
    expect(first.status, rawFirst).toBe(200);
    expect(repeated.status).toBe(200);
    expect(rawRepeated).toBe(rawFirst);
    await runEffectTest(
      decodeProbeFullInvokeSessionResponseV1Effect(JSON.parse(rawFirst)),
    );
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({
      error: "session_executor_attempt_conflict",
    });
    expect(await syncCursor(harness, "p12_session_replay", "read")).toBe(1);
  });

  it("fails an in-progress duplicate closed, then replays the completion", async () => {
    const delayed = await createRuntimeProbeHarness({
      sessionReadDelayMs: 500,
    });
    try {
      const request = candidateInvokeRequest("p12_session_concurrent");
      const bindings = await delayed.bindings();
      const session = bindings.PROBE_SESSIONS.getByName(request.sessionId);
      const invoke = () => session.fetch(
        "https://probe-session.internal/v1/full-invoke",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const responses = await Promise.all([invoke(), invoke()]);
      const completed = responses.find(response => response.status === 200);
      const busy = responses.find(response => response.status === 409);
      if (completed === undefined || busy === undefined) {
        throw new Error("expected one completion and one busy duplicate");
      }
      const completedBody = await completed.text();
      const replay = await invoke();

      expect(await busy.json()).toEqual({
        error: "session_executor_attempt_busy",
      });
      expect(replay.status).toBe(200);
      expect(await replay.text()).toBe(completedBody);
      expect(
        await syncCursor(delayed, "p12_session_concurrent", "read"),
      ).toBe(1);
    } finally {
      await delayed.dispose();
    }
  });

  it("fails the SessionDO executor closed without its SyncDO capability", async () => {
    const outcome = await measuredDispatchOnFreshHarness(
      validSampleRequest("session_executor_invoke", "p12_no_session_sync", {
        journalEntries: 2,
        payloadBytes: 64,
      }),
      { sessionSync: false },
    );

    expect(outcome.fragment.outcome).toEqual({
      kind: "error",
      error: {
        code: "runtime_failure",
        retryable: false,
        stage: "request",
      },
    });
    expect(outcome.fragment.spans).toEqual([]);
    expect(outcome.fragment.startup).toEqual({
      workerLoader: "callback-not-run",
      facet: "callback-not-run",
    });
  });

  it("uses distinct invoke-v1 code identities for bounded new-code samples", async () => {
    const request = validSampleRequest("full_invoke", "p05_invoke_new_code", {
      codeMode: "new-code",
      repetitions: 2,
    });
    const first = await measuredDispatch(harness, request);
    const second = await measuredDispatch(harness, {
      ...request,
      sampleOrdinal: 1,
    });

    expect(first.fragment.identity.codeId).toBe(
      "rtp-code-invoke-v2-p05_invoke_new_code-0",
    );
    expect(second.fragment.identity.codeId).toBe(
      "rtp-code-invoke-v2-p05_invoke_new_code-1",
    );
    expect(first.fragment.startup.workerLoader).toBe("callback-ran");
    expect(second.fragment.startup.workerLoader).toBe("callback-ran");
    expect(await syncCursor(harness, "p05_invoke_new_code", "read")).toBe(2);
  });

  it("retains duplicate sync wakes as an excluded measurement disposition", async () => {
    const request = validSampleRequest("commit_wake", "p05_commit_wake");
    await directSyncWake(harness, "p05_commit_wake", 0);
    const duplicate = await measuredDispatch(harness, request);
    const firstSample = completeProbeGatewaySampleV1(
      duplicate.fragment,
      duplicate.durationMs,
    );

    expect(firstSample.spans.map(span => span.name)).toEqual([
      "external_request",
      "mock_sync_wake_rtt",
      "sync_cursor_io",
    ]);
    expect(validateProbeTraceV1(firstSample)).toEqual({ ok: true });
    expect(duplicate.fragment.outcome).toEqual({ kind: "ok" });
    expect(duplicate.control.syncWake).toEqual({
      kind: "observed",
      disposition: "duplicate",
    });
    expect(duplicate.control.measurementDisposition).toBe(
      "excluded-duplicate-wake",
    );
    expect(await syncCursor(harness, "p05_commit_wake", "read")).toBe(1);
  });

  it("rejects out-of-order commit wake claims before topology execution", async () => {
    const response = await dispatch(
      harness,
      {
        ...validSampleRequest("commit_wake", "p05_commit_gap", {
          repetitions: 3,
        }),
        sampleOrdinal: 2,
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "rejected",
      error: { code: "sample-order-blocked", retryable: false },
    });
    expect(await syncCursor(harness, "p05_commit_gap", "read")).toBe(0);
  });

  it("rejects out-of-order full-invoke claims before facet execution", async () => {
    const response = await dispatch(
      harness,
      {
        ...validSampleRequest("full_invoke", "p05_invoke_gap", {
          repetitions: 3,
        }),
        sampleOrdinal: 2,
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "rejected",
      error: { code: "sample-order-blocked", retryable: false },
    });
    expect(await syncCursor(harness, "p05_invoke_gap", "read")).toBe(0);
  });

  it("rejects out-of-order SessionDO Postgres claims before capability checks", async () => {
    const response = await dispatch(
      harness,
      {
        ...validSampleRequest(
          "session_postgres_warm_invoke",
          "p32_session_postgres_gap",
          {
            journalEntries: 2,
            repetitions: 3,
            sessionMode: "reuse-session",
          },
        ),
        sampleOrdinal: 2,
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "rejected",
      error: { code: "sample-order-blocked", retryable: false },
    });
    expect(await syncCursor(harness, "p32_session_postgres_gap", "read"))
      .toBe(0);
  });

  it("classifies applied, duplicate, gap, and stale synthetic wakes", async () => {
    const runId = "p05_cursor_order";
    expect((await directSyncWake(harness, runId, 0)).disposition).toBe(
      "applied",
    );
    expect((await directSyncWake(harness, runId, 0)).disposition).toBe(
      "duplicate",
    );
    const gap = await directSyncWake(harness, runId, 2);
    expect(gap.disposition).toBe("gap");
    expect(gap.cursor).toBe(1);
    expect((await directSyncWake(harness, runId, 1)).disposition).toBe(
      "applied",
    );
    const stale = await directSyncWake(harness, runId, 0);
    expect(stale.disposition).toBe("stale");
    expect(stale.cursor).toBe(2);
    expect(await syncCursor(harness, runId, "read")).toBe(2);
    expect(await syncCursor(harness, runId, "reset")).toBe(0);
    expect(await syncCursor(harness, runId, "read")).toBe(0);
    expect(await syncCursor(harness, "p05_cursor_isolated", "read")).toBe(0);
  });

  it("rejects a wake routed to a different deterministic scope object", async () => {
    const bindings = await harness.mockBindings();
    const request = syncWakeRequest("p05_scope_guard", 0);
    const wrongScope = runEffectTestSync(
      decodeProbeRunIdEffect("p05_scope_guard_other"),
    );

    await expect(
      bindings.PROBE_SYNC.getByName(probeScopeId(wrongScope)).wake(request),
    ).rejects.toBeDefined();
    expect(await syncCursor(harness, "p05_scope_guard", "read")).toBe(0);
  });

  it("rehydrates the per-scope sync cursor after a Miniflare restart", async () => {
    const firstHarness = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const persistPath = firstHarness.persistPath;
    let firstDisposed = false;
    try {
      expect(
        (await directSyncWake(firstHarness, "p05_sync_restart", 0))
          .disposition,
      ).toBe("applied");
      await firstHarness.dispose();
      firstDisposed = true;

      const restarted = await createRuntimeProbeHarness({ persistPath });
      try {
        expect(await syncCursor(restarted, "p05_sync_restart", "read"))
          .toBe(1);
        expect(
          (await directSyncWake(restarted, "p05_sync_restart", 0))
            .disposition,
        ).toBe("duplicate");
        expect(await syncCursor(restarted, "p05_sync_restart", "reset"))
          .toBe(0);
      } finally {
        await restarted.dispose();
      }
    } finally {
      if (!firstDisposed) await firstHarness.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  });

  it("routes mock finish through the external ProbeSyncDO binding", async () => {
    const bindings = await harness.bindings();
    const mockFinish = bindings.MOCK_FINISH;
    if (mockFinish === undefined) throw new Error("MOCK_FINISH is missing");
    const runId = runEffectTestSync(
      decodeProbeRunIdEffect("p05_finish_rpc"),
    );
    const sampleOrdinal = runEffectTestSync(decodeProbeOrdinalEffect(0));
    const request = ProbeMockFinishRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId,
      sampleId: probeSampleId(runId, sampleOrdinal),
      sampleOrdinal,
      scopeId: probeScopeId(runId),
      scenario: "commit_wake",
      commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
    });
    const rawReceipt = await mockFinish.finish(request);
    const receipt = await runEffectTest(
      decodeProbeMockFinishResponseV1Effect(
        copyCloudflareRpcRecord(rawReceipt),
      ),
    );

    expect(receipt.request).toEqual(request);
    expect(receipt.sync.disposition).toBe("applied");
    expect(receipt.sync.cursor).toBe(1);
  });

  it("keeps dependent workers session-free and facets capability-scoped", async () => {
    const gatewayBindings = await harness.bindings();
    const mockBindings = await harness.mockBindings();
    const syncBindings = await harness.syncBindings();
    const mockRead = gatewayBindings.MOCK_READ;
    if (mockRead === undefined) throw new Error("MOCK_READ is missing");
    const workerCode = probeInvokeWorkerCode(mockRead);
    const source = workerCode.modules[PROBE_INVOKE_WORKER_MAIN_MODULE];
    const mockFinish = gatewayBindings.MOCK_FINISH;
    if (mockFinish === undefined) throw new Error("MOCK_FINISH is missing");
    const finalizerCode = probeFacetFinalizerWorkerCode(mockFinish);
    const finalizerSource =
      finalizerCode.modules[PROBE_INVOKE_WORKER_MAIN_MODULE];
    const rerunCode = probeRerunWorkerCode();
    const rerunSource = rerunCode.modules[PROBE_RERUN_WORKER_MAIN_MODULE];

    expect(gatewayBindings.PROBE_SYNC).toBeDefined();
    expect(gatewayBindings.SESSION_EXECUTOR_READ).toBeDefined();
    expect(gatewayBindings.MOCK_RERUN).toBeDefined();
    expect(mockBindings.PROBE_SYNC).toBeDefined();
    expect(Object.keys(mockBindings).sort()).toEqual(["PROBE_SYNC"]);
    expect(Object.keys(syncBindings).sort()).toEqual(["PROBE_SYNC"]);
    expect("PROBE_SESSIONS" in mockBindings).toBe(false);
    expect("MOCK_RERUN" in mockBindings).toBe(false);
    expect("PROBE_SESSIONS" in syncBindings).toBe(false);
    expect("MOCK_RERUN" in syncBindings).toBe(false);
    expect(Object.keys(workerCode.env ?? {})).toEqual(["EXECUTOR_READ"]);
    expect(workerCode.globalOutbound).toBeNull();
    expect(typeof source).toBe("string");
    expect(source).not.toContain("MOCK_FINISH");
    expect(source).not.toContain("PROBE_SYNC");
    expect(Object.keys(finalizerCode.env ?? {})).toEqual(["EXECUTOR_FINISH"]);
    expect(finalizerCode.globalOutbound).toBeNull();
    expect(typeof finalizerSource).toBe("string");
    expect(finalizerSource).toContain("const warmFinalizer =");
    expect(finalizerSource).toContain(
      'value.scenario === "facet_finalizer_postgres_warm_invoke"',
    );
    expect(finalizerSource).toContain("EXECUTOR_FINISH.resolve");
    expect(finalizerSource).toContain(
      'existingAttempt.phase !== "running"',
    );
    expect(finalizerSource).toContain(
      'recoveringFinish = existingAttempt.phase === "finishing"',
    );
    expect(finalizerSource).toContain("EXECUTOR_FINISH");
    expect(finalizerSource).toContain("sync.previousCursor > 1000000");
    expect(finalizerSource).toContain("sync.cursor > 1000000");
    expect(finalizerSource).not.toContain("MOCK_FINISH");
    expect(finalizerSource).not.toContain("PROBE_SYNC");
    expect(rerunCode.env).toEqual({});
    expect(rerunCode.globalOutbound).toBeNull();
    expect(typeof rerunSource).toBe("string");
    expect(rerunSource).not.toContain("MOCK_RERUN");
    expect(rerunSource).not.toContain("PROBE_SYNC");
  });

  it("records missing private mock capabilities without dropping samples", async () => {
    const noMockHarness = await createRuntimeProbeHarness({
      mockFinish: false,
      mockRead: false,
      mockRerun: false,
    });
    try {
      const wake = await measuredDispatch(
        noMockHarness,
        validSampleRequest("commit_wake", "p05_no_mock_wake"),
      );
      const invoke = await measuredDispatchOnFreshHarness(
        validSampleRequest("full_invoke", "p05_no_mock_invoke"),
        { mockFinish: false, mockRead: false, mockRerun: false },
      );
      const rerun = await measuredDispatchOnFreshHarness(
        validSampleRequest("sync_rerun", "p06_no_mock_rerun"),
        { mockFinish: false, mockRead: false, mockRerun: false },
      );
      const edgeStatus = await dispatchStatusOnFreshHarness(
        validSampleRequest("edge_echo", "p05_no_mock_edge"),
        { mockFinish: false, mockRead: false, mockRerun: false },
      );

      expect(wake.fragment.outcome.kind).toBe("error");
      expect(wake.fragment.spans).toEqual([]);
      expect(invoke.fragment.outcome.kind).toBe("error");
      expect(invoke.fragment.spans).toEqual([]);
      expect(invoke.fragment.startup).toEqual({
        workerLoader: "callback-not-run",
        facet: "callback-not-run",
      });
      expect(rerun.fragment.outcome).toEqual({
        kind: "error",
        error: {
          code: "runtime_failure",
          retryable: false,
          stage: "request",
        },
      });
      expect(rerun.fragment.spans).toEqual([]);
      expect(rerun.fragment.startup).toEqual({
        workerLoader: "callback-not-run",
        facet: "callback-not-run",
      });
      expect(edgeStatus).toBe(200);
    } finally {
      await noMockHarness.dispose();
    }
  });
});

type SupportedScenario =
  | "dynamic_direct_echo"
  | "edge_echo"
  | "facet_echo"
  | "facet_journal"
  | "commit_wake"
  | "full_invoke"
  | "executor_worker_invoke"
  | "facet_executor_invoke"
  | "facet_finalizer_invoke"
  | "facet_finalizer_warm_invoke"
  | "session_postgres_warm_invoke"
  | "session_executor_invoke"
  | "session_echo"
  | "sync_rerun";

interface SampleOverrides {
  readonly codeMode?: "new-code" | "stable";
  readonly concurrency?: number;
  readonly payloadBytes?: number;
  readonly journalEntries?: number;
  readonly repetitions?: number;
  readonly warmupRepetitions?: number;
  readonly sessionMode?: "new-session" | "reuse-session";
}

function candidateInvokeRequest(runIdValue: string) {
  const runId = runEffectTestSync(decodeProbeRunIdEffect(runIdValue));
  const sampleOrdinal = runEffectTestSync(decodeProbeOrdinalEffect(0));
  return ProbeInvokeFacetRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scopeId: probeScopeId(runId),
    scenario: "session_executor_invoke",
    commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
    sessionId: probeSessionId(runId, sampleOrdinal),
    sessionMode: "new-session",
    attemptId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    facetId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    codeMode: "stable",
    codeId: probeCodeId({ mode: "stable", profile: "invoke" }),
    journalEntries: 2,
    payload: "x".repeat(64),
  });
}

function facetExecutorInvokeRequest(runIdValue: string) {
  const runId = runEffectTestSync(decodeProbeRunIdEffect(runIdValue));
  const sampleOrdinal = runEffectTestSync(decodeProbeOrdinalEffect(0));
  return ProbeInvokeFacetRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scopeId: probeScopeId(runId),
    scenario: "facet_executor_invoke",
    commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
    sessionId: probeSessionId(runId, sampleOrdinal),
    sessionMode: "new-session",
    attemptId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    facetId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    codeMode: "stable",
    codeId: probeCodeId({ mode: "stable", profile: "invoke" }),
    journalEntries: 2,
    payload: "x".repeat(64),
  });
}

function facetFinalizerInvokeRequest(runIdValue: string) {
  const runId = runEffectTestSync(decodeProbeRunIdEffect(runIdValue));
  const sampleOrdinal = runEffectTestSync(decodeProbeOrdinalEffect(0));
  return ProbeInvokeFacetRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scopeId: probeScopeId(runId),
    scenario: "facet_finalizer_invoke",
    commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
    sessionId: probeSessionId(runId, sampleOrdinal),
    sessionMode: "new-session",
    attemptId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    facetId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    codeMode: "stable",
    codeId: probeCodeId({ mode: "stable", profile: "invoke-finalizer" }),
    journalEntries: 2,
    payload: "x".repeat(64),
  });
}

function warmFacetFinalizerInvokeRequest(
  runIdValue: string,
  sampleOrdinalValue: number,
) {
  const runId = runEffectTestSync(decodeProbeRunIdEffect(runIdValue));
  const sessionOrdinal = runEffectTestSync(decodeProbeOrdinalEffect(0));
  const sampleOrdinal = runEffectTestSync(
    decodeProbeOrdinalEffect(sampleOrdinalValue),
  );
  return ProbeInvokeFacetRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scopeId: probeScopeId(runId),
    scenario: "facet_finalizer_warm_invoke",
    commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
    sessionId: probeSessionId(runId, sessionOrdinal),
    sessionMode: "reuse-session",
    attemptId: probeAttemptId(runId, sessionOrdinal, sampleOrdinal),
    facetId: probeAttemptId(runId, sessionOrdinal, sessionOrdinal),
    codeMode: "stable",
    codeId: probeCodeId({ mode: "stable", profile: "invoke-finalizer-warm" }),
    journalEntries: 2,
    payload: "x".repeat(64 + sampleOrdinalValue),
  });
}

function externalExecutorInvokeRequest(runIdValue: string) {
  const runId = runEffectTestSync(decodeProbeRunIdEffect(runIdValue));
  const sampleOrdinal = runEffectTestSync(decodeProbeOrdinalEffect(0));
  return ProbeInvokeFacetRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scopeId: probeScopeId(runId),
    scenario: "executor_worker_invoke",
    commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
    sessionId: probeSessionId(runId, sampleOrdinal),
    sessionMode: "new-session",
    attemptId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    facetId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    codeMode: "stable",
    codeId: probeCodeId({ mode: "stable", profile: "invoke" }),
    journalEntries: 2,
    payload: "x".repeat(64),
  });
}

async function directFullInvoke(
  runtime: RuntimeProbeHarness,
  request:
    | ReturnType<typeof candidateInvokeRequest>
    | ReturnType<typeof facetExecutorInvokeRequest>
    | ReturnType<typeof facetFinalizerInvokeRequest>
    | ReturnType<typeof warmFacetFinalizerInvokeRequest>
    | ReturnType<typeof externalExecutorInvokeRequest>,
) {
  const bindings = await runtime.bindings();
  return await bindings.PROBE_SESSIONS.getByName(request.sessionId).fetch(
    "https://probe-session.internal/v1/full-invoke",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );
}

async function purgeFacetFinalizerAttempt(
  runtime: RuntimeProbeHarness,
  request:
    | ReturnType<typeof facetFinalizerInvokeRequest>
    | ReturnType<typeof warmFacetFinalizerInvokeRequest>,
) {
  const bindings = await runtime.bindings();
  const session = bindings.PROBE_SESSIONS.getByName(request.sessionId);
  const purgeRequest = ProbeSessionPurgeRequestV1Schema.make({
    protocolVersion: request.protocolVersion,
    sessionId: request.sessionId,
    facets: [{
      attemptId: request.facetId,
      codeId: request.codeId,
      scenario: request.scenario,
    }],
  });
  for (let step = 0; step < 32; step += 1) {
    const receipt = await session.purge(purgeRequest);
    if (receipt.kind === "probe-data-cleared") {
      expect(await session.purge(purgeRequest)).toEqual(receipt);
      return receipt;
    }
  }
  throw new Error("facet finalizer purge did not complete");
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
      warmupRepetitions: overrides.warmupRepetitions ?? 0,
      dimensions: {
        codeMode: overrides.codeMode ?? "stable",
        concurrency: overrides.concurrency ?? 1,
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
  const prepared = await prepareSampleBody(harness, body, authorization);
  if (prepared.kind === "response") return prepared.response;
  return await dispatchSampleBody(harness, prepared.body, authorization);
}

async function dispatchSampleBody(
  harness: RuntimeProbeHarness,
  body: unknown,
  authorization: string | undefined,
) {
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

async function dispatchRun(
  harness: RuntimeProbeHarness,
  body: unknown,
  authorization: string | undefined,
) {
  return await harness.mf.dispatchFetch(
    `https://probe.test${PROBE_RUN_ROUTE}`,
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

type HarnessResponse = Awaited<
  ReturnType<RuntimeProbeHarness["mf"]["dispatchFetch"]>
>;

type PreparedSampleBody =
  | { readonly kind: "body"; readonly body: unknown }
  | { readonly kind: "response"; readonly response: HarnessResponse };

async function prepareSampleBody(
  harness: RuntimeProbeHarness,
  body: unknown,
  authorization: string | undefined,
): Promise<PreparedSampleBody> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "body", body };
  }
  const run: unknown = Reflect.get(body, "run");
  if (run === undefined) return { kind: "body", body };
  const registration = await harness.mf.dispatchFetch(
    `https://probe.test${PROBE_RUN_ROUTE}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === undefined ? {} : { authorization }),
      },
      body: JSON.stringify(run),
    },
  );
  if (registration.status !== 200 && registration.status !== 201) {
    return { kind: "response", response: registration };
  }
  const commandFields = Object.fromEntries(
    Object.entries(body).filter(([key]) =>
      key !== "run" && key !== "phase" && key !== "payload"
    ),
  );
  return {
    kind: "body",
    body: {
      protocolVersion: typeof run === "object" && run !== null
        ? Reflect.get(run, "protocolVersion")
        : undefined,
      runId: typeof run === "object" && run !== null
        ? Reflect.get(run, "runId")
        : undefined,
      ...commandFields,
    },
  };
}

async function measuredDispatch(
  harness: RuntimeProbeHarness,
  body: unknown,
): Promise<{
  readonly durationMs: number;
  readonly fragment: ProbeGatewaySampleV1;
  readonly control: ProbeSampleControlV1;
  readonly raw: string;
}> {
  const prepared = await prepareSampleBody(
    harness,
    body,
    PROBE_TEST_AUTHORIZATION,
  );
  if (prepared.kind === "response") {
    const registrationBody = await prepared.response.clone().text();
    expect(prepared.response.status, registrationBody).toBe(200);
    throw new Error("probe run registration did not succeed");
  }
  const startedAt = performance.now();
  const response = await dispatchSampleBody(
    harness,
    prepared.body,
    PROBE_TEST_AUTHORIZATION,
  );
  const raw = await response.text();
  const durationMs = Math.max(0, performance.now() - startedAt);
  expect(response.status).toBe(200);
  const value: unknown = JSON.parse(raw);
  const controlled = await runEffectTest(
    decodeProbeControlledGatewaySampleV1Effect(value),
  );
  return {
    durationMs,
    fragment: controlled.fragment,
    control: controlled.control,
    raw,
  };
}

async function measuredDispatchOnFreshHarness(
  body: unknown,
  options: RuntimeProbeHarnessOptions = {},
) {
  const isolated = await createRuntimeProbeHarness(options);
  try {
    return await measuredDispatch(isolated, body);
  } finally {
    await isolated.dispose();
  }
}

async function dispatchStatusOnFreshHarness(
  body: unknown,
  options: RuntimeProbeHarnessOptions = {},
): Promise<number> {
  const isolated = await createRuntimeProbeHarness(options);
  try {
    return (await dispatch(isolated, body)).status;
  } finally {
    await isolated.dispose();
  }
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

async function directSyncWake(
  harness: RuntimeProbeHarness,
  runIdValue: string,
  sampleOrdinalValue: number,
) {
  const bindings = await harness.mockBindings();
  const request = syncWakeRequest(runIdValue, sampleOrdinalValue);
  const scopeId = request.scopeId;
  const rawReceipt = await bindings.PROBE_SYNC.getByName(scopeId).wake(
    request,
  );
  return await runEffectTest(
    decodeProbeSyncWakeReceiptV1Effect(
      copyCloudflareRpcRecord(rawReceipt),
    ),
  );
}

function syncWakeRequest(
  runIdValue: string,
  sampleOrdinalValue: number,
) {
  const runId = runEffectTestSync(decodeProbeRunIdEffect(runIdValue));
  const sampleOrdinal = runEffectTestSync(
    decodeProbeOrdinalEffect(sampleOrdinalValue),
  );
  return ProbeSyncWakeRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scopeId: probeScopeId(runId),
    scenario: "commit_wake",
    commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
  });
}

async function syncCursor(
  harness: RuntimeProbeHarness,
  runIdValue: string,
  operation: "read" | "reset",
): Promise<number> {
  const bindings = await harness.mockBindings();
  const runId = runEffectTestSync(decodeProbeRunIdEffect(runIdValue));
  const scopeId = probeScopeId(runId);
  const request = ProbeSyncControlRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    scopeId,
    operation,
  });
  const rawResponse = await bindings.PROBE_SYNC.getByName(scopeId).control(
    request,
  );
  const response = await runEffectTest(
    decodeProbeSyncControlResponseV1Effect(
      copyCloudflareRpcRecord(rawResponse),
    ),
  );
  return response.cursor;
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
