import { describe, expect, it } from "vitest";

import {
  compileH05ProbeTeardownEvidence,
  decodeH05ProbeTeardownEvidence,
  decodeH05ProbeTeardownEvidenceJson,
  h05ProbeTeardownMaximumAttempts,
  h05ProbeTeardownPollIntervalMs,
  h05ProbeTeardownStableObservationCount,
  serializeH05ProbeTeardownEvidence,
  verifyH05ProbeTeardownEvidenceDependencies,
} from "../h05/probeTeardownEvidence";
import {
  validH05TraceControlPlaneEvidence,
  validH05TraceDataPlaneEvidence,
} from "./h05TraceFixtures";

describe("H05 probe teardown evidence contract", () => {
  it("compiles a canonical, dependency-bound absence artifact", () => {
    const dataPlane = validH05TraceDataPlaneEvidence();
    const controlPlaneAfter = validH05TraceControlPlaneEvidence("after");
    const compiled = compileH05ProbeTeardownEvidence(
      dataPlane,
      controlPlaneAfter,
      validCollection(),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.message);

    const serialized = serializeH05ProbeTeardownEvidence(compiled.value);
    expect(decodeH05ProbeTeardownEvidenceJson(serialized)).toEqual(compiled);
    expect(
      verifyH05ProbeTeardownEvidenceDependencies(
        compiled.value,
        dataPlane,
        controlPlaneAfter,
      ),
    ).toEqual({ ok: true });
    expect(compiled.value).toMatchObject({
      accountAccess: { selection: "fixed-tag-filter", status: 200 },
      deletion: {
        forceParameter: "omitted",
        outcome: "deleted",
        status: 200,
      },
      inputs: {
        probeDeploymentId: "probe-deployment-1",
        probePath: "/__flarex_h05/invoke/run_a",
        probeVersionId: "probe-version-1",
        probeWorkerName: "flarex-executor-h05-probe",
      },
      verification: {
        attemptsUsed: 2,
        requiredConsecutiveObservations: 2,
      },
    });
  });

  it("supports an idempotent already-absent retry", () => {
    const collection = validCollection();
    collection.deletion = {
      ...nestedRecord(collection, "deletion"),
      outcome: "already-absent",
      status: 404,
    };
    const compiled = compileH05ProbeTeardownEvidence(
      validH05TraceDataPlaneEvidence(),
      validH05TraceControlPlaneEvidence("after"),
      collection,
    );

    expect(compiled).toMatchObject({
      ok: true,
      value: { deletion: { outcome: "already-absent", status: 404 } },
    });
  });

  it("rejects tampering, extra fields, and non-canonical JSON", () => {
    const compiled = validCompiledEvidence();
    expect(
      decodeH05ProbeTeardownEvidence({
        ...compiled,
        evidenceSha256: "f".repeat(64),
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("evidenceSha256"),
    });
    expect(
      decodeH05ProbeTeardownEvidence({ ...compiled, unexpected: true }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("exactly"),
    });
    expect(
      decodeH05ProbeTeardownEvidenceJson(JSON.stringify(compiled)),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("canonical JSON serialization"),
    });
  });

  it("keeps deletion status and outcome as one discriminated fact", () => {
    const deletedAs404 = validCollection();
    nestedRecord(deletedAs404, "deletion").status = 404;
    expect(
      compileH05ProbeTeardownEvidence(
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        deletedAs404,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("status"),
    });

    const forced = validCollection();
    nestedRecord(forced, "deletion").forceParameter = "true";
    expect(
      compileH05ProbeTeardownEvidence(
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        forced,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("forceParameter"),
    });
  });

  it("requires two interval-separated authenticated and public 404 observations", () => {
    const wrongMethod = validCollection();
    const observations = nestedArray(wrongMethod, "verification", "observations");
    const firstObservation = observations[0];
    if (firstObservation === undefined) throw new Error("fixture observation missing");
    nestedRecord(firstObservation, "publicProbeLookup").method = "GET";
    expect(
      compileH05ProbeTeardownEvidence(
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        wrongMethod,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("publicProbeLookup.method"),
    });

    const shortInterval = validCollection();
    const shortIntervalObservations = nestedArray(
      shortInterval,
      "verification",
      "observations",
    );
    const secondShortIntervalObservation = shortIntervalObservations[1];
    if (secondShortIntervalObservation === undefined) {
      throw new Error("fixture observation missing");
    }
    secondShortIntervalObservation.checkedAt = "2026-07-11T10:03:11.999Z";
    expect(
      compileH05ProbeTeardownEvidence(
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        shortInterval,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("at least 2000 milliseconds apart"),
    });

    const nonConsecutive = validCollection();
    nestedRecord(nonConsecutive, "verification").attemptsUsed = 30;
    expect(
      compileH05ProbeTeardownEvidence(
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        nonConsecutive,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("final two consecutive"),
    });
  });

  it("rejects collection before the post-run control fence", () => {
    const collection = validCollection();
    nestedRecord(collection, "window").startedAt =
      "2026-07-11T10:03:06.999Z";

    expect(
      compileH05ProbeTeardownEvidence(
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        collection,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "control-plane-after-to-probe-teardown",
      ),
    });
  });

  it("rejects dependency substitution after compilation", () => {
    const compiled = validCompiledEvidence();
    const wrongControl = recordClone(
      validH05TraceControlPlaneEvidence("after"),
    );
    nestedRecord(wrongControl, "source").commit = "c".repeat(40);

    expect(
      verifyH05ProbeTeardownEvidenceDependencies(
        compiled,
        validH05TraceDataPlaneEvidence(),
        wrongControl,
      ),
    ).toMatchObject({ ok: false });
  });
});

function validCompiledEvidence() {
  const compiled = compileH05ProbeTeardownEvidence(
    validH05TraceDataPlaneEvidence(),
    validH05TraceControlPlaneEvidence("after"),
    validCollection(),
  );
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}

function validCollection(): Record<string, unknown> {
  return {
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
      outcome: "deleted",
      source: "cloudflare-workers-scripts-api",
      status: 200,
    },
    verification: {
      attemptsUsed: 2,
      maximumAttempts: h05ProbeTeardownMaximumAttempts,
      observations: [
        observation(1, "2026-07-11T10:03:10.000Z"),
        observation(2, "2026-07-11T10:03:12.000Z"),
      ],
      pollIntervalMs: h05ProbeTeardownPollIntervalMs,
      requiredConsecutiveObservations:
        h05ProbeTeardownStableObservationCount,
    },
    window: {
      finishedAt: "2026-07-11T10:03:13.000Z",
      startedAt: "2026-07-11T10:03:08.000Z",
    },
  };
}

function observation(attempt: number, checkedAt: string): Record<string, unknown> {
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

function nestedArray(
  record: Readonly<Record<string, unknown>>,
  objectKey: string,
  arrayKey: string,
): Record<string, unknown>[] {
  const value = nestedRecord(record, objectKey)[arrayKey];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`fixture ${arrayKey} must be an object array`);
  }
  return value;
}

function nestedRecord(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`fixture ${key} must be an object`);
  return value;
}

function recordClone(value: unknown): Record<string, unknown> {
  const cloned: unknown = structuredClone(value);
  if (!isRecord(cloned)) throw new Error("fixture clone must be an object");
  return cloned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
