import { describe, expect, it } from "vitest";

import { compileH05DataPlaneEvidence } from "../h05/receipt";
import {
  compileH05HostedProofBundle,
  decodeH05HostedProofBundle,
  decodeH05HostedProofBundleJson,
  h05HostedProofBundleFormat,
  serializeH05HostedProofBundle,
} from "../h05/hostedProofBundle";
import { compileH05TraceEvidence } from "../h05/traceEvidence";
import {
  validH05ProbeTeardownEvidence,
  validH05TraceCollection,
  validH05TraceControlPlaneEvidence,
  validH05TraceDataPlaneEvidence,
  validH05TraceEvidence,
} from "./h05TraceFixtures";

describe("H05 hosted proof bundle", () => {
  it("embeds every canonical sidecar and derives receipt-v2", () => {
    const compiled = validBundle();
    const serialized = serializeH05HostedProofBundle(compiled);

    expect(decodeH05HostedProofBundleJson(serialized)).toEqual({
      ok: true,
      value: compiled,
    });
    expect(compiled).toMatchObject({
      format: h05HostedProofBundleFormat,
      receipt: {
        format: "flarex-h05-hosted-receipt-v2",
        hyperdrive: {
          source: "cloudflare-hyperdrive-api",
          cachingDisabled: true,
          originScheme: "postgresql",
          tlsMode: "require",
        },
        cleanup: {
          postgres: {
            source: "data-plane-evidence",
            proofRowsRemaining: 0,
          },
          probe: {
            source: "probe-teardown-evidence",
            absent: true,
            deletionOutcome: "deleted",
            deletionStatus: 200,
            authenticatedLookupStatus: 404,
            publicLookupStatus: 404,
          },
        },
        trace: {
          authorizedTraceCount: 14,
          unauthorizedTraceCount: 1,
          serviceBindingTraceCount: 14,
          outcomeOkTraceCount: 15,
        },
      },
    });
    expect(compiled.receipt.inputs).toEqual({
      controlPlaneAfterEvidenceSha256:
        compiled.inputs.controlPlaneAfter.evidenceSha256,
      controlPlaneBeforeEvidenceSha256:
        compiled.inputs.controlPlaneBefore.evidenceSha256,
      dataPlaneEvidenceSha256: compiled.inputs.dataPlane.evidenceSha256,
      probeTeardownEvidenceSha256:
        compiled.inputs.probeTeardown.evidenceSha256,
      traceEvidenceSha256: compiled.inputs.trace.evidenceSha256,
    });
    expect(new Set(Object.values(compiled.receipt.inputs)).size).toBe(5);
  });

  it("preserves retry-safe absence without claiming this run deleted the probe", () => {
    const compiled = compileH05HostedProofBundle(
      validH05TraceControlPlaneEvidence("before"),
      validH05TraceDataPlaneEvidence(),
      validH05TraceControlPlaneEvidence("after"),
      validH05ProbeTeardownEvidence("already-absent"),
      validH05TraceEvidence(),
    );
    expect(compiled).toMatchObject({
      ok: true,
      value: {
        receipt: {
          cleanup: {
            probe: {
              absent: true,
              deletionOutcome: "already-absent",
              deletionStatus: 404,
            },
          },
        },
      },
    });
  });

  it("rejects a supplied receipt summary even when it remains shape-valid", () => {
    const bundle = recordClone(validBundle());
    const receipt = nestedRecord(bundle, "receipt");
    nestedRecord(receipt, "executor").deploymentId =
      "different-executor-deployment";

    expect(decodeH05HostedProofBundle(bundle)).toMatchObject({
      ok: false,
      message: expect.stringContaining("compiler-derived receipt"),
    });
  });

  it("rejects an inner artifact whose own canonical hash was altered", () => {
    const bundle = recordClone(validBundle());
    const inputs = nestedRecord(bundle, "inputs");
    nestedRecord(inputs, "controlPlaneBefore").evidenceSha256 = "f".repeat(64);

    expect(decodeH05HostedProofBundle(bundle)).toMatchObject({
      ok: false,
      message: expect.stringContaining("canonical payload"),
    });
  });

  it("rejects a separately valid cross-run sidecar substitution", () => {
    const dataPlanePayload = recordClone(validH05TraceDataPlaneEvidence());
    delete dataPlanePayload.evidenceSha256;
    dataPlanePayload.run = {
      runId: "run_b",
      deploymentId: "deployment_h05_run_b",
      projectId: "project_h05_run_b",
    };
    const otherRun = compileH05DataPlaneEvidence(dataPlanePayload);
    if (!otherRun.ok) throw new Error(otherRun.message);

    expect(
      compileH05HostedProofBundle(
        validH05TraceControlPlaneEvidence("before"),
        otherRun.value,
        validH05TraceControlPlaneEvidence("after"),
        validH05ProbeTeardownEvidence(),
        validH05TraceEvidence(),
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("run.runId"),
    });
  });

  it("closes the missing teardown-to-trace collection edge", () => {
    const collection = recordClone(validH05TraceCollection());
    nestedRecord(collection, "window").startedAt =
      "2026-07-11T10:03:12.999Z";
    const trace = compileH05TraceEvidence(
      validH05TraceControlPlaneEvidence("before"),
      validH05TraceDataPlaneEvidence(),
      validH05TraceControlPlaneEvidence("after"),
      collection,
    );
    if (!trace.ok) throw new Error(trace.message);

    expect(
      compileH05HostedProofBundle(
        validH05TraceControlPlaneEvidence("before"),
        validH05TraceDataPlaneEvidence(),
        validH05TraceControlPlaneEvidence("after"),
        validH05ProbeTeardownEvidence(),
        trace.value,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "probe-teardown-to-trace-collection",
      ),
    });
  });

  it("rejects outer hash tampering and non-canonical JSON", () => {
    const compiled = validBundle();
    expect(
      decodeH05HostedProofBundle({
        ...compiled,
        bundleSha256: "f".repeat(64),
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("canonical bundle payload"),
    });
    expect(
      decodeH05HostedProofBundleJson(JSON.stringify(compiled)),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("canonical JSON serialization"),
    });
  });
});

function validBundle() {
  const compiled = compileH05HostedProofBundle(
    validH05TraceControlPlaneEvidence("before"),
    validH05TraceDataPlaneEvidence(),
    validH05TraceControlPlaneEvidence("after"),
    validH05ProbeTeardownEvidence(),
    validH05TraceEvidence(),
  );
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
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
