import { describe, expect, it } from "vitest";

import { compileH05ControlPlaneEvidence } from "../h05/controlPlaneEvidence";
import {
  compileH05TraceEvidence,
  decodeH05TraceEvidence,
  decodeH05TraceEvidenceJson,
  h05NormalizedTraceEvidenceSha256,
  h05TraceIdHashSetSha256,
  serializeH05TraceEvidence,
  verifyH05TraceEvidenceDependencies,
} from "../h05/traceEvidence";
import {
  validH05NormalizedTraces,
  validH05TraceCollection,
  validH05TraceControlPlaneEvidence,
  validH05TraceDataPlaneEvidence,
} from "./h05TraceFixtures";
import {
  cloneFixtureRecord as recordClone,
  mutableFixtureRecord,
  mutableNestedFixtureRecord as nestedRecord,
} from "./mutableRecordFixture";

describe("H05 trace evidence contract", () => {
  it("joins both control fences and the data plane into one canonical artifact", () => {
    const before = validH05TraceControlPlaneEvidence("before");
    const dataPlane = validH05TraceDataPlaneEvidence();
    const after = validH05TraceControlPlaneEvidence("after");
    const compiled = compileH05TraceEvidence(
      before,
      dataPlane,
      after,
      validH05TraceCollection(),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.message);

    const serialized = serializeH05TraceEvidence(compiled.value);
    expect(decodeH05TraceEvidenceJson(serialized)).toEqual(compiled);
    expect(
      verifyH05TraceEvidenceDependencies(
        compiled.value,
        before,
        dataPlane,
        after,
      ),
    ).toEqual({ ok: true });
    expect(Object.keys(compiled.value.window.collection)).toEqual([
      "finishedAt",
      "startedAt",
    ]);
    expect(Object.keys(compiled.value.window.dataPlane)).toEqual([
      "finishedAt",
      "startedAt",
    ]);
    expect(compiled.value.traces).toHaveLength(15);
    expect(compiled.value.traces.filter((trace) => trace.kind === "authorized")).toHaveLength(14);
    expect(compiled.value.window.observed).toEqual({
      firstAt: "2026-07-11T10:01:05.000Z",
      lastAt: "2026-07-11T10:01:19.500Z",
    });
  });

  it("retains the trace canonical timestamp diagnostic", () => {
    const evidence = recordClone(validCompiledEvidence());
    const window = nestedRecord(evidence, "window");
    nestedRecord(window, "collection").startedAt =
      "2026-07-11T10:01:04.000+00:00";

    expect(decodeH05TraceEvidence(evidence)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "window.collection.startedAt must be a canonical ISO timestamp.",
      ),
    });
  });

  it("retains the trace Wrangler version diagnostic", () => {
    const evidence = validCompiledEvidence();

    expect(decodeH05TraceEvidence({
      ...evidence,
      source: { ...evidence.source, wranglerVersion: "5.0.0" },
    })).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "source.wranglerVersion must be a supported Wrangler 4 version.",
      ),
    });
  });

  it("persists hashes rather than raw telemetry identifiers", () => {
    const compiled = validCompiledEvidence();
    const serialized = serializeH05TraceEvidence(compiled);

    expect(serialized).not.toContain("trace-00000000");
    expect(serialized).not.toContain("event-probe-00000000");
    expect(serialized).not.toContain("requestId");
    expect(serialized).not.toContain("spanId");
    expect(serialized).toContain('"rawTelemetrySource": "omitted"');
  });

  it("derives a distinct domain-separated aggregate of trace ID hashes", () => {
    const traces = validH05NormalizedTraces();
    expect(h05TraceIdHashSetSha256(traces)).toBe(
      "bc1c4adb68b6287f7273c91f716e01f0c93a26368c6095888cd9daeb6d3a8b5c",
    );
    expect(h05TraceIdHashSetSha256(traces)).not.toBe(
      h05NormalizedTraceEvidenceSha256(traces),
    );

    const duplicateIds = traces.map((trace) => recordClone(trace));
    const first = duplicateIds[0];
    const second = duplicateIds[1];
    if (first === undefined || second === undefined) {
      throw new Error("trace fixture is incomplete");
    }
    second.traceIdSha256 = first.traceIdSha256;
    expect(() => h05TraceIdHashSetSha256(duplicateIds)).toThrow(
      "sorted by unique traceIdSha256",
    );
  });

  it("rejects tampered hashes, extra fields, and non-canonical JSON", () => {
    const compiled = validCompiledEvidence();
    expect(
      decodeH05TraceEvidence({
        ...compiled,
        evidenceSha256: "f".repeat(64),
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("joined evidence") });
    expect(
      decodeH05TraceEvidence({ ...compiled, unexpected: true }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("exactly") });
    expect(
      decodeH05TraceEvidenceJson(JSON.stringify(compiled)),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("canonical JSON serialization"),
    });
  });

  it("requires the post-run control fence to follow the data plane", () => {
    const before = validH05TraceControlPlaneEvidence("before");
    const compiled = compileH05TraceEvidence(
      before,
      validH05TraceDataPlaneEvidence(),
      before,
      validH05TraceCollection(),
    );

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining("data-plane-to-control-plane-after"),
    });
  });

  it("rejects control-plane configuration drift across the run fence", () => {
    const after = validH05TraceControlPlaneEvidence("after");
    const payload = recordClone(after);
    delete payload.evidenceSha256;
    const hyperdrive = nestedRecord(payload, "hyperdrive");
    nestedRecord(hyperdrive, "opening").name = "different_hyperdrive";
    nestedRecord(hyperdrive, "closing").name = "different_hyperdrive";
    const drifted = compileH05ControlPlaneEvidence(payload);
    if (!drifted.ok) throw new Error(drifted.message);

    expect(
      compileH05TraceEvidence(
        validH05TraceControlPlaneEvidence("before"),
        validH05TraceDataPlaneEvidence(),
        drifted.value,
        validH05TraceCollection(),
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("configuration fence"),
    });
  });

  it("requires exact status distribution and parent-link proof", () => {
    const statuses = validH05NormalizedTraces().map((trace) => recordClone(trace));
    const authorized = statuses.find((trace) => trace.kind === "authorized");
    if (authorized === undefined) throw new Error("authorized fixture trace missing");
    nestedRecord(authorized, "probe").statusCode = 409;
    nestedRecord(authorized, "executor").statusCode = 409;
    const statusCollection = collectionWithTraces(statuses);

    expect(
      compileH05TraceEvidence(
        validH05TraceControlPlaneEvidence("before"),
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        statusCollection,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("HTTP 200 trace count"),
    });

    const links = validH05NormalizedTraces().map((trace) => recordClone(trace));
    const linked = links.find((trace) => trace.kind === "authorized");
    if (linked === undefined) throw new Error("authorized fixture trace missing");
    linked.executorParentLinked = false;
    expect(
      compileH05TraceEvidence(
        validH05TraceControlPlaneEvidence("before"),
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        collectionWithTraces(links),
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("executorParentLinked"),
    });
  });

  it("requires every trace and invocation timestamp inside the data-plane window", () => {
    const traces = validH05NormalizedTraces().map((trace) => recordClone(trace));
    const firstTrace = traces[0];
    if (firstTrace === undefined) throw new Error("trace fixture is empty");
    firstTrace.startedAt = "2026-07-11T10:00:59.999Z";

    expect(
      compileH05TraceEvidence(
        validH05TraceControlPlaneEvidence("before"),
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        collectionWithTraces(traces, true),
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("required window"),
    });
  });

  it("requires the executor interval to be contained by its probe parent", () => {
    const traces = validH05NormalizedTraces().map((trace) => recordClone(trace));
    const authorized = traces.find((trace) => trace.kind === "authorized");
    if (authorized === undefined) throw new Error("authorized fixture trace missing");
    const probe = nestedRecord(authorized, "probe");
    const executor = nestedRecord(authorized, "executor");
    if (typeof executor.startedAt !== "string") {
      throw new Error("executor fixture timestamp missing");
    }
    probe.finishedAt = executor.startedAt;

    expect(
      compileH05TraceEvidence(
        validH05TraceControlPlaneEvidence("before"),
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        collectionWithTraces(traces),
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("executor.finishedAt"),
    });
  });

  it("rejects a dependency substitution after artifact compilation", () => {
    const compiled = validCompiledEvidence();
    const wrongDataPlane = recordClone(validH05TraceDataPlaneEvidence());
    nestedRecord(wrongDataPlane, "source").commit = "c".repeat(40);

    expect(
      verifyH05TraceEvidenceDependencies(
        compiled,
        validH05TraceControlPlaneEvidence("before"),
        wrongDataPlane,
        validH05TraceControlPlaneEvidence("after"),
      ),
    ).toMatchObject({ ok: false });
  });
});

function validCompiledEvidence() {
  const compiled = compileH05TraceEvidence(
    validH05TraceControlPlaneEvidence("before"),
    validH05TraceDataPlaneEvidence(),
    validH05TraceControlPlaneEvidence("after"),
    validH05TraceCollection(),
  );
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}

function collectionWithTraces(
  traces: readonly Readonly<Record<string, unknown>>[],
  recomputeHash = false,
): Readonly<Record<string, unknown>> {
  const collection = recordClone(validH05TraceCollection());
  collection.traces = traces;
  if (recomputeHash) {
    const hash = h05NormalizedTraceEvidenceSha256(traces);
    const observations = collection.observations;
    if (!Array.isArray(observations)) {
      throw new Error("fixture observations missing");
    }
    collection.observations = observations.map(observation => {
      const mutableObservation = mutableFixtureRecord(
        observation,
        "fixture observation invalid",
      );
      mutableObservation.normalizedEvidenceSha256 = hash;
      return mutableObservation;
    });
  }
  return collection;
}
