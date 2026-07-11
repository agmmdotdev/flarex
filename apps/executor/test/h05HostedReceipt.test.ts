import { describe, expect, it } from "vitest";

import {
  compileH05DataPlaneEvidence,
  compileH05InvocationReceipt,
  decodeH05HostedReceipt,
  decodeH05HostedReceiptJson,
  decodeH05DataPlaneEvidence,
  decodeH05InvocationEvidence,
  decodeH05InvocationEvidenceJson,
  h05AuthorizedInvocationCount,
  h05DataPlaneEvidenceFormat,
  h05HostedReceiptFormat,
  serializeH05HostedReceipt,
  serializeH05DataPlaneEvidence,
  serializeH05InvocationEvidence,
  type H05DataPlaneEvidence,
} from "../h05/receipt";
import { decodeVerifiedH05DataPlaneEvidenceJson } from "../scripts/h05DataPlaneEvidence";

describe("H05 hosted activation receipt preflight", () => {
  it("accepts one complete, redacted, internally consistent receipt", () => {
    const decoded = decodeH05HostedReceipt(validReceipt());

    expect(decoded).toMatchObject({
      ok: true,
      value: {
        format: h05HostedReceiptFormat,
        run: {
          runId: "run_a",
          deploymentId: "deployment_h05_run_a",
          projectId: "project_h05_run_a",
        },
        dataPlane: {
          invocation: {
            authorizedResponses: h05AuthorizedInvocationCount,
          },
        },
      },
    });
  });

  it("emits one canonical standalone invocation evidence sidecar", () => {
    const invocation = { ...invocationRecord(validReceipt()) };
    delete invocation.evidenceSha256;
    const decoded = decodeH05InvocationEvidence(invocation);
    if (!decoded.ok) throw new Error(decoded.message);
    const json = serializeH05InvocationEvidence(decoded.value);

    expect(decodeH05InvocationEvidenceJson(json)).toEqual(decoded);
    expect(decodeH05InvocationEvidenceJson(json.trimEnd())).toMatchObject({
      ok: false,
      message:
        "Invalid H05 invocation evidence: evidence must use canonical JSON serialization.",
    });
  });

  it("binds invocation evidence and PostgreSQL cleanup to one run", () => {
    const decoded = decodeH05DataPlaneEvidence(dataPlaneRecord(validReceipt()));
    if (!decoded.ok) throw new Error(decoded.message);
    const json = serializeH05DataPlaneEvidence(decoded.value);

    expect(JSON.parse(json)).toEqual(decoded.value);
    expect(decodeVerifiedH05DataPlaneEvidenceJson(json)).toEqual(decoded);

    expect(
      decodeH05DataPlaneEvidence({
      ...decoded.value,
      invocation: {
        ...decoded.value.invocation,
        evidenceSha256: "d".repeat(64),
      },
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "Invalid H05 hosted receipt: invocation.evidenceSha256 must equal",
      ),
    });
  });

  it("rejects cross-run substitution even when the nested invocation hash is valid", () => {
    const dataPlane = dataPlaneRecord(validReceipt());
    dataPlane.run = {
      runId: "run_b",
      deploymentId: "deployment_h05_run_b",
      projectId: "project_h05_run_b",
    };

    expect(decodeH05DataPlaneEvidence(dataPlane)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "Invalid H05 hosted receipt: dataPlane.evidenceSha256 must equal",
      ),
    });
  });

  it("rejects an altered invocation hash at the final hosted-receipt gate", () => {
    const receipt = validReceipt();
    invocationRecord(receipt).evidenceSha256 = "d".repeat(64);

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "Invalid H05 hosted receipt: invocation.evidenceSha256 must equal",
      ),
    });
  });

  it("rejects unknown fields instead of preserving possible secret material", () => {
    const receipt = validReceipt();
    receipt.executorToken = "must-never-be-recorded";

    expect(decodeH05HostedReceipt(receipt)).toEqual({
      ok: false,
      message:
        "Invalid H05 hosted receipt: $ has invalid keys (missing: none; unknown: executorToken).",
    });
  });

  it("requires the deployed executor to bind the same cache-disabled Hyperdrive", () => {
    const receipt = validReceipt();
    nestedRecord(nestedRecord(receipt, "executor"), "hyperdriveBinding").id =
      "f".repeat(32);

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: executor.hyperdriveBinding.id must equal \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\".",
    });
  });

  it("rejects the checked-in placeholder as hosted Hyperdrive evidence", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "hyperdrive").id = "0".repeat(32);

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: hyperdrive.id must not use an all-zero placeholder.",
    });
  });

  it("requires a complete empty public-ingress inventory", () => {
    const receipt = validReceipt();
    nestedRecord(nestedRecord(receipt, "executor"), "privacy").routeTargets = [
      "example.com/*",
    ];

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: executor.privacy.routeTargets must contain exactly 0 item(s).",
    });
  });

  it("rejects an OCC receipt whose stale conflict is not against the winner", () => {
    const receipt = validReceipt();
    nestedRecord(invocationRecord(receipt), "stale").currentTs = 12;

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: invocation.stale.currentTs must equal 11.",
    });
  });

  it("requires all authorized calls to appear as cross-Worker traces", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "trace").serviceBindingTraceCount = 13;

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: trace.serviceBindingTraceCount must equal 14.",
    });
  });

  it("binds trace collection to the exact run-scoped probe path", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "trace").probePath = "/__flarex_h05/invoke";

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: trace.probePath must equal \"/__flarex_h05/invoke/run_a\".",
    });
  });

  it("treats Cloudflare control-plane IDs as opaque bounded strings", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "executor").versionId = "worker-version_2026-opaque";
    nestedRecord(receipt, "trace").executorVersionId =
      "worker-version_2026-opaque";

    expect(decodeH05HostedReceipt(receipt).ok).toBe(true);
  });

  it("binds timestamps and cleanup evidence to the bounded proof window", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "cleanup").checkedAt = "2026-07-11T10:06:00.000Z";

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: cleanup.checkedAt must fall inside the receipt window.",
    });
  });

  it("binds the data-plane source commit to the final receipt source", () => {
    const receipt = validReceipt();
    const dataPlane = dataPlaneRecord(receipt);
    dataPlane.source = {
      ...nestedRecord(dataPlane, "source"),
      commit: "b".repeat(40),
    };
    receipt.dataPlane = recompileDataPlane(dataPlane);

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "Invalid H05 hosted receipt: dataPlane.source.commit must equal",
      ),
    });
  });

  it("places the data-plane collection interval inside the final receipt window", () => {
    const receipt = validReceipt();
    const dataPlane = dataPlaneRecord(receipt);
    dataPlane.window = {
      startedAt: "2026-07-11T09:59:59.000Z",
      finishedAt: "2026-07-11T10:02:30.000Z",
    };
    receipt.dataPlane = recompileDataPlane(dataPlane);

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: dataPlane.window.startedAt must fall inside the receipt window.",
    });
  });

  it("rejects a trace interval disjoint from the hashed data-plane execution", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "trace").firstObservedAt =
      "2026-07-11T10:03:00.000Z";
    nestedRecord(receipt, "trace").lastObservedAt =
      "2026-07-11T10:03:30.000Z";

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: trace.firstObservedAt must fall inside the receipt window.",
    });
  });

  it("requires final teardown after data-plane cleanup completes", () => {
    const receipt = validReceipt();
    nestedRecord(receipt, "cleanup").checkedAt =
      "2026-07-11T10:02:15.000Z";

    expect(decodeH05HostedReceipt(receipt)).toMatchObject({
      ok: false,
      message:
        "Invalid H05 hosted receipt: dataPlane-to-cleanup timestamps are out of order.",
    });
  });

  it("rejects duplicate keys and non-canonical receipt serialization", () => {
    const decoded = decodeH05HostedReceipt(validReceipt());
    if (!decoded.ok) throw new Error(decoded.message);
    const canonical = serializeH05HostedReceipt(decoded.value);
    const duplicateFormat = canonical.replace(
      /^\{/,
      `{\n  "format": "${h05HostedReceiptFormat}",`,
    );

    expect(decodeH05HostedReceiptJson(canonical).ok).toBe(true);
    expect(decodeH05HostedReceiptJson(duplicateFormat)).toEqual({
      ok: false,
      message:
        "Invalid H05 hosted receipt: receipt must use canonical JSON serialization.",
    });
    expect(decodeH05HostedReceiptJson(canonical.trimEnd())).toMatchObject({
      ok: false,
    });
  });
});

function validReceipt(): Record<string, unknown> {
  const executorDeploymentId = "11111111-1111-4111-8111-111111111111";
  const executorVersionId = "22222222-2222-4222-8222-222222222222";
  const probeDeploymentId = "33333333-3333-4333-8333-333333333333";
  const probeVersionId = "44444444-4444-4444-8444-444444444444";
  const evidenceHash = "c".repeat(64);
  const sourceCommit = "a".repeat(40);
  const run = {
    runId: "run_a",
    deploymentId: "deployment_h05_run_a",
    projectId: "project_h05_run_a",
  };
  const invocation = compileH05InvocationReceipt({
    source: "hosted-occ-proof-harness",
    unauthorizedStatus: 401,
    unauthorizedHopAbsent: true,
    authorizedResponses: 14,
    hopMarkedResponses: 14,
    noStoreResponses: 15,
    hop: {
      header: "x-flarex-h05-hop",
      value: "probe-to-executor",
    },
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
  const dataPlane = compileH05DataPlaneEvidence({
    format: h05DataPlaneEvidenceFormat,
    source: { commit: sourceCommit, worktreeClean: true },
    window: {
      startedAt: "2026-07-11T10:00:40.000Z",
      finishedAt: "2026-07-11T10:02:30.000Z",
    },
    run,
    invocation: invocation.value,
    postgresCleanup: { proofRowsRemaining: 0 },
  });
  if (!dataPlane.ok) throw new Error(dataPlane.message);
  return {
    format: h05HostedReceiptFormat,
    redaction: {
      bearerCapabilityValues: "omitted",
      databaseOrigin: "sha256-only",
      runIdentity: "included-non-sensitive",
    },
    source: {
      commit: sourceCommit,
      worktreeClean: true,
      wranglerVersion: "4.100.0",
      evidenceSha256: evidenceHash,
    },
    window: {
      startedAt: "2026-07-11T10:00:00.000Z",
      finishedAt: "2026-07-11T10:05:00.000Z",
    },
    run,
    hyperdrive: {
      source: "wrangler-hyperdrive-get",
      id: "b".repeat(32),
      name: "flarex_executor_h05",
      cachingDisabled: true,
      originHostSha256: evidenceHash,
      originDatabaseSha256: evidenceHash,
      tls: "require-or-stronger",
      capturedAt: "2026-07-11T10:00:10.000Z",
      evidenceSha256: evidenceHash,
    },
    executor: {
      workerName: "flarex-executor",
      deploymentId: executorDeploymentId,
      versionId: executorVersionId,
      trafficPercentage: 100,
      compatibilityDate: "2026-06-14",
      compatibilityFlags: ["nodejs_compat"],
      placementMode: "smart",
      hyperdriveBinding: {
        name: "HYPERDRIVE_CACHE_DISABLED",
        id: "b".repeat(32),
      },
      secretNames: ["FLAREX_EXECUTOR_TOKEN"],
      bindingInventoryComplete: true,
      privacy: {
        source: "cloudflare-workers-api",
        inventoryComplete: true,
        workersDevEnabled: false,
        previewUrlsEnabled: false,
        routeTargets: [],
        customDomainTargets: [],
        directPublicRequest: "unreachable",
        checkedAt: "2026-07-11T10:00:30.000Z",
        evidenceSha256: evidenceHash,
      },
      deploymentEvidenceSha256: evidenceHash,
      versionEvidenceSha256: evidenceHash,
      secretsEvidenceSha256: evidenceHash,
    },
    probe: {
      workerName: "flarex-executor-h05-probe",
      deploymentId: probeDeploymentId,
      versionId: probeVersionId,
      trafficPercentage: 100,
      publicOrigin: "https://flarex-executor-h05-probe.example.workers.dev",
      workersDevEnabled: true,
      previewUrlsEnabled: false,
      serviceBinding: {
        name: "FLAREX_EXECUTOR",
        service: "flarex-executor",
      },
      secretNames: [
        "FLAREX_EXECUTOR_TOKEN",
        "FLAREX_H05_PROBE_TOKEN",
        "FLAREX_H05_RUN_ID",
      ],
      bindingInventoryComplete: true,
      deploymentEvidenceSha256: evidenceHash,
      versionEvidenceSha256: evidenceHash,
      secretsEvidenceSha256: evidenceHash,
    },
    dataPlane: dataPlane.value,
    trace: {
      source: "cloudflare-observability-api",
      probePath: "/__flarex_h05/invoke/run_a",
      samplingRate: 1,
      queryComplete: true,
      truncatedTraceCount: 0,
      authorizedTraceCount: 14,
      unauthorizedTraceCount: 1,
      serviceBindingTraceCount: 14,
      outcomeOkTraceCount: 15,
      services: ["flarex-executor", "flarex-executor-h05-probe"],
      executorVersionId,
      probeVersionId,
      firstObservedAt: "2026-07-11T10:01:00.000Z",
      lastObservedAt: "2026-07-11T10:02:00.000Z",
      traceIdsSha256: evidenceHash,
      evidenceSha256: evidenceHash,
    },
    cleanup: {
      source: "cloudflare-api-and-postgres",
      proofRowsRemaining: 0,
      probeDeleted: true,
      probeLookupStatus: 404,
      probePublicRequest: "unreachable",
      checkedAt: "2026-07-11T10:04:00.000Z",
      evidenceSha256: evidenceHash,
    },
  };
}

function dataPlaneRecord(
  receipt: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return nestedRecord(receipt, "dataPlane");
}

function invocationRecord(
  receipt: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return nestedRecord(dataPlaneRecord(receipt), "invocation");
}

function recompileDataPlane(
  evidence: Readonly<Record<string, unknown>>,
): H05DataPlaneEvidence {
  const { evidenceSha256: _evidenceSha256, ...payload } = evidence;
  const compiled = compileH05DataPlaneEvidence(payload);
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}

function nestedRecord(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  if (isRecord(value)) {
    return value;
  }
  throw new Error(`Test fixture field ${key} is not an object.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
