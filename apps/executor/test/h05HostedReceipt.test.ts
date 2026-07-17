import { describe, expect, it } from "vitest";

import { compileH05HostedProofBundle } from "../h05/hostedProofBundle";
import {
  compileH05DataPlaneEvidence,
  decodeH05DataPlaneEvidence,
  decodeH05HostedReceipt,
  decodeH05HostedReceiptJson,
  decodeH05InvocationEvidence,
  decodeH05InvocationEvidenceJson,
  h05HostedReceiptFormat,
  serializeH05DataPlaneEvidence,
  serializeH05HostedReceipt,
  serializeH05InvocationEvidence,
} from "../h05/receipt";
import { decodeVerifiedH05DataPlaneEvidenceJson } from "../scripts/h05DataPlaneEvidence";
import {
  validH05ProbeTeardownEvidence,
  validH05TraceControlPlaneEvidence,
  validH05TraceDataPlaneEvidence,
  validH05TraceEvidence,
} from "./h05TraceFixtures";

describe("H05 hosted receipt-v2 summary", () => {
  it("accepts the compiler-derived compact receipt", () => {
    expect(decodeH05HostedReceipt(validReceipt())).toMatchObject({
      ok: true,
      value: {
        format: h05HostedReceiptFormat,
        run: {
          runId: "run_a",
          deploymentId: "deployment_h05_run_a",
          projectId: "project_h05_run_a",
        },
        hyperdrive: { source: "cloudflare-hyperdrive-api" },
        cleanup: {
          postgres: { source: "data-plane-evidence" },
          probe: { source: "probe-teardown-evidence", absent: true },
        },
      },
    });
  });

  it("retains the receipt canonical timestamp diagnostic", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "window").startedAt =
      "2026-07-11T10:00:00.000+00:00";

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "window.startedAt must be a canonical UTC ISO timestamp.",
      ),
    });
  });

  it("retains the receipt Wrangler version diagnostic", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "source").wranglerVersion = "5.0.0";

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "source.wranglerVersion has an invalid format.",
      ),
    });
  });

  it("retains the receipt Cloudflare resource ID diagnostic", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "executor").deploymentId = "short";

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "executor.deploymentId must be a bounded opaque Cloudflare identifier.",
      ),
    });
  });

  it("retains receipt-owned rejection of all-zero SHA-256 placeholders", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "inputs").dataPlaneEvidenceSha256 = "0".repeat(64);

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "inputs.dataPlaneEvidenceSha256 must not use an all-zero placeholder.",
      ),
    });
  });

  it("retains receipt-owned rejection of all-zero Git commit placeholders", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "source").commit = "0".repeat(40);

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "source.commit must not use an all-zero placeholder.",
      ),
    });
  });

  it("retains canonical invocation and data-plane evidence contracts", () => {
    const dataPlane = validH05TraceDataPlaneEvidence();
    const invocation = recordClone(dataPlane.invocation);
    delete invocation.evidenceSha256;
    const decodedInvocation = decodeH05InvocationEvidence(invocation);
    if (!decodedInvocation.ok) throw new Error(decodedInvocation.message);
    const invocationJson = serializeH05InvocationEvidence(
      decodedInvocation.value,
    );
    expect(decodeH05InvocationEvidenceJson(invocationJson)).toEqual(
      decodedInvocation,
    );

    const dataPlaneJson = serializeH05DataPlaneEvidence(dataPlane);
    expect(decodeVerifiedH05DataPlaneEvidenceJson(dataPlaneJson)).toEqual({
      ok: true,
      value: dataPlane,
    });
    expect(
      decodeH05DataPlaneEvidence({
        ...dataPlane,
        invocation: {
          ...dataPlane.invocation,
          evidenceSha256: "d".repeat(64),
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects a separately valid cross-run data-plane substitution", () => {
    const dataPlane = validH05TraceDataPlaneEvidence();
    const payload = recordClone(dataPlane);
    delete payload.evidenceSha256;
    payload.run = {
      runId: "run_b",
      deploymentId: "deployment_h05_run_b",
      projectId: "project_h05_run_b",
    };
    const compiled = compileH05DataPlaneEvidence(payload);

    expect(compiled).toMatchObject({ ok: true });
    if (!compiled.ok) throw new Error(compiled.message);
    const receipt = validReceipt();
    nestedRecord(receipt, "inputs").dataPlaneEvidenceSha256 =
      compiled.value.evidenceSha256;
    nestedRecord(nestedRecord(receipt, "cleanup"), "postgres").evidenceSha256 =
      compiled.value.evidenceSha256;
    expect(decodeH05HostedReceipt(receipt).ok).toBe(true);
    // Receipt-v2 is only a strict summary. The self-contained bundle performs
    // the authoritative cross-run join and never accepts this supplied summary.
  });

  it("rejects old provenance labels and unknown fields", () => {
    const oldHyperdrive = validReceipt();
    nestedRecord(oldHyperdrive, "hyperdrive").source =
      "wrangler-hyperdrive-get";
    expect(decodeH05HostedReceipt(oldHyperdrive)).toMatchObject({
      ok: false,
      message: expect.stringContaining("cloudflare-hyperdrive-api"),
    });

    const unknown = validReceipt();
    unknown.executorToken = "must-never-be-recorded";
    expect(decodeH05HostedReceipt(unknown)).toMatchObject({
      ok: false,
      message: expect.stringContaining("unknown: executorToken"),
    });
  });

  it("requires distinct sidecar hashes and exact cleanup provenance", () => {
    const duplicate = validReceipt();
    const inputs = nestedRecord(duplicate, "inputs");
    inputs.traceEvidenceSha256 = inputs.probeTeardownEvidenceSha256;
    nestedRecord(duplicate, "trace").evidenceSha256 =
      inputs.probeTeardownEvidenceSha256;
    expect(decodeH05HostedReceipt(duplicate)).toMatchObject({
      ok: false,
      message: expect.stringContaining("must all be distinct"),
    });

    const wrongPostgres = validReceipt();
    nestedRecord(
      nestedRecord(wrongPostgres, "cleanup"),
      "postgres",
    ).evidenceSha256 = "f".repeat(64);
    expect(decodeH05HostedReceipt(wrongPostgres)).toMatchObject({
      ok: false,
      message: expect.stringContaining("cleanup.postgres.evidenceSha256"),
    });
  });

  it("keeps retry-safe deletion outcome and status discriminated", () => {
    const receipt = validReceipt();
    const probeCleanup = nestedRecord(
      nestedRecord(receipt, "cleanup"),
      "probe",
    );
    probeCleanup.deletionOutcome = "already-absent";

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message: expect.stringContaining("outcome and status must agree"),
    });
  });

  it("binds versions, run path, and time summaries", () => {
    const wrongVersion = validReceipt();
    nestedRecord(wrongVersion, "trace").executorVersionId =
      "different-executor-version";
    expect(decodeH05HostedReceipt(wrongVersion)).toMatchObject({
      ok: false,
      message: expect.stringContaining("trace.executorVersionId"),
    });

    const wrongPath = validReceipt();
    nestedRecord(wrongPath, "trace").probePath = "/__flarex_h05/invoke";
    expect(decodeH05HostedReceipt(wrongPath)).toMatchObject({
      ok: false,
      message: expect.stringContaining("trace.probePath"),
    });

    const wrongOrder = validReceipt();
    nestedRecord(
      nestedRecord(wrongOrder, "executor"),
      "privacy",
    ).afterCheckedAt = "2026-07-11T10:03:12.500Z";
    expect(decodeH05HostedReceipt(wrongOrder)).toMatchObject({
      ok: false,
      message: expect.stringContaining("privacy-after-to-probe-cleanup"),
    });
  });

  it("requires canonical standalone receipt serialization", () => {
    const decoded = decodeH05HostedReceipt(validReceipt());
    if (!decoded.ok) throw new Error(decoded.message);
    const canonical = serializeH05HostedReceipt(decoded.value);
    const duplicateFormat = canonical.replace(
      /^\{/,
      `{\n  "format": "${h05HostedReceiptFormat}",`,
    );

    expect(decodeH05HostedReceiptJson(canonical)).toEqual(decoded);
    expect(decodeH05HostedReceiptJson(duplicateFormat)).toMatchObject({
      ok: false,
      message: expect.stringContaining("canonical JSON serialization"),
    });
    expect(decodeH05HostedReceiptJson(canonical.trimEnd())).toMatchObject({
      ok: false,
    });
  });
});

function validReceipt(): Record<string, unknown> {
  const bundle = compileH05HostedProofBundle(
    validH05TraceControlPlaneEvidence("before"),
    validH05TraceDataPlaneEvidence(),
    validH05TraceControlPlaneEvidence("after"),
    validH05ProbeTeardownEvidence(),
    validH05TraceEvidence(),
  );
  if (!bundle.ok) throw new Error(bundle.message);
  return recordClone(bundle.value.receipt);
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
