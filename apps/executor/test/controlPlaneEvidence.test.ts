import { describe, expect, it } from "vitest";

import {
  compileH05ControlPlaneEvidence,
  decodeH05ControlPlaneEvidence,
  decodeH05ControlPlaneEvidenceJson,
  h05BindingEvidenceKey,
  h05CloudflareAccountIdSha256,
  h05ControlPlaneEvidenceFormat,
  h05ZoneTypes,
  serializeH05ControlPlaneEvidence,
  type H05BindingEvidence,
  type H05ControlPlaneEvidencePayload,
  type H05ExecutorPrivacySnapshotEvidence,
  type H05ExecutorWorkerVersionEvidence,
  type H05HyperdriveSnapshotEvidence,
  type H05ProbeWorkerVersionEvidence,
  type H05TraceSettingsEvidence,
} from "../h05/controlPlaneEvidence";
import { decodeH05ProofRunId, h05ProofIdentity } from "../h05/proofIdentity";

describe("H05 control-plane evidence contract", () => {
  it.each([
    [
      { type: "hyperdrive", name: "HYPERDRIVE", id: "hyperdrive-id" },
      "HYPERDRIVE:hyperdrive:hyperdrive-id",
    ],
    [
      { type: "secret_text", name: "EXECUTOR_TOKEN" },
      "EXECUTOR_TOKEN:secret_text",
    ],
    [
      { type: "service", name: "EXECUTOR", service: "flarex-executor" },
      "EXECUTOR:service:flarex-executor",
    ],
  ] satisfies ReadonlyArray<readonly [H05BindingEvidence, string]>)(
    "derives the exact identity key for $0 bindings",
    (binding, expected) => {
      expect(h05BindingEvidenceKey(binding)).toBe(expected);
    },
  );

  it("retains the Cloudflare account ID diagnostic", () => {
    expect(() => h05CloudflareAccountIdSha256("A".repeat(32))).toThrow(
      "CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters.",
    );
  });

  it("compiles, hashes, serializes, and verifies one canonical artifact", () => {
    const compiled = compileH05ControlPlaneEvidence(validPayload());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.message);

    const serialized = serializeH05ControlPlaneEvidence(compiled.value);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(decodeH05ControlPlaneEvidenceJson(serialized)).toEqual(compiled);
    expect(compiled.value.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("retains the control-plane canonical timestamp diagnostic", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      window: {
        ...payload.window,
        startedAt: "2026-07-11T10:00:00.000+00:00",
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "window.startedAt must be a canonical UTC ISO timestamp.",
      ),
    });
  });

  it("retains the control-plane Wrangler version diagnostic", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      source: { ...payload.source, wranglerVersion: "5.0.0" },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "source.wranglerVersion has an invalid format.",
      ),
    });
  });

  it("retains the control-plane Cloudflare resource ID diagnostic", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      executor: {
        ...payload.executor,
        deploymentBefore: {
          ...payload.executor.deploymentBefore,
          deploymentId: "short",
        },
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "executor.deploymentBefore.deploymentId must be a bounded opaque Cloudflare identifier.",
      ),
    });
  });

  it("retains the control-plane Hyperdrive ID diagnostic", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      hyperdrive: {
        ...payload.hyperdrive,
        opening: { ...payload.hyperdrive.opening, id: "A".repeat(32) },
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "hyperdrive.opening.id has an invalid format.",
      ),
    });
  });

  it("rejects a tampered outer hash and non-canonical JSON", () => {
    const compiled = compileH05ControlPlaneEvidence(validPayload());
    if (!compiled.ok) throw new Error(compiled.message);

    expect(
      decodeH05ControlPlaneEvidence({
        ...compiled.value,
        evidenceSha256: "c".repeat(64),
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("canonical payload") });
    expect(
      decodeH05ControlPlaneEvidenceJson(JSON.stringify(compiled.value)),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("canonical JSON serialization"),
    });
  });

  it("rejects deployment drift across the active-version fence", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      executor: {
        ...payload.executor,
        deploymentAfter: {
          ...payload.executor.deploymentAfter,
          versionId: "executor-version-2",
        },
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining("active deployment changed"),
    });
  });

  it("rejects extra capabilities in either binding inventory", () => {
    const payload = validPayload();
    const extraBinding: H05BindingEvidence = {
      type: "secret_text",
      name: "UNEXPECTED_SECRET",
    };
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      executor: {
        ...payload.executor,
        opening: {
          ...payload.executor.opening,
          version: {
            ...payload.executor.opening.version,
            versionBindings: [
              ...payload.executor.opening.version.versionBindings,
              extraBinding,
            ],
          },
        },
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining("exact expected inventory"),
    });
  });

  it("requires every visible zone to have a corresponding route read", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      executor: {
        ...payload.executor,
        privacy: {
          ...payload.executor.privacy,
          opening: {
            ...payload.executor.privacy.opening,
            routes: {
              ...payload.executor.privacy.opening.routes,
              checkedZoneIds: ["1".repeat(32)],
            },
          },
        },
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining("exact expected inventory"),
    });
  });

  it("derives the only accepted probe origin from the account subdomain", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      probe: {
        ...payload.probe,
        publicOrigin:
          "https://flarex-executor-h05-probe.other-account.workers.dev",
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining("account Workers subdomain"),
    });
  });

  it("retains the control-plane HTTPS origin diagnostic", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      probe: {
        ...payload.probe,
        publicOrigin: `${payload.probe.publicOrigin}/path`,
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "probe.publicOrigin must be an HTTPS origin without credentials, path, query, or fragment.",
      ),
    });
  });

  it("keeps the privacy observation inside the active deployment fence", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      executor: {
        ...payload.executor,
        privacy: {
          ...payload.executor.privacy,
          closing: {
            ...payload.executor.privacy.closing,
            checkedAt: "2026-07-11T10:00:05.001Z",
          },
        },
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining("timestamps are out of order"),
    });
  });

  it("accepts only Cloudflare-shaped zone IDs", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      executor: {
        ...payload.executor,
        privacy: {
          ...payload.executor.privacy,
          opening: {
            ...payload.executor.privacy.opening,
            zones: {
              ...payload.executor.privacy.opening.zones,
              zoneIds: ["bad\nzone"],
            },
            routes: {
              ...payload.executor.privacy.opening.routes,
              checkedZoneIds: ["bad\nzone"],
            },
          },
        },
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining("invalid format"),
    });
  });

  it("rejects privacy and subdomain drift between opening and closing reads", () => {
    const payload = validPayload();
    const privacyDrift = compileH05ControlPlaneEvidence({
      ...payload,
      executor: {
        ...payload.executor,
        privacy: {
          ...payload.executor.privacy,
          closing: {
            ...payload.executor.privacy.closing,
            routes: {
              ...payload.executor.privacy.closing.routes,
              inspectedRouteCount: 4,
            },
          },
        },
      },
    });
    const subdomainDrift = compileH05ControlPlaneEvidence({
      ...payload,
      executor: {
        ...payload.executor,
        closing: {
          ...payload.executor.closing,
          subdomain: { enabled: true, previewsEnabled: false },
        },
      },
    });

    expect(privacyDrift).toMatchObject({
      ok: false,
      message: expect.stringContaining("opening and closing sweeps"),
    });
    expect(subdomainDrift).toMatchObject({
      ok: false,
      message: expect.stringContaining("must disable workers.dev"),
    });
  });

  it("rejects an account Workers subdomain change", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      accountWorkersSubdomain: {
        ...payload.accountWorkersSubdomain,
        closing: "other-account",
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining("accountWorkersSubdomain changed"),
    });
  });

  it("enforces the collector's bounded zone-page transcript", () => {
    const payload = validPayload();
    const compiled = compileH05ControlPlaneEvidence({
      ...payload,
      executor: {
        ...payload.executor,
        privacy: {
          ...payload.executor.privacy,
          opening: {
            ...payload.executor.privacy.opening,
            zones: {
              ...payload.executor.privacy.opening.zones,
              pageCount: 201,
            },
          },
        },
      },
    });

    expect(compiled).toMatchObject({
      ok: false,
      message: expect.stringContaining("safe integer from 1 through 200"),
    });
  });

  it("rejects Hyperdrive drift and role-inappropriate compatibility flags", () => {
    const payload = validPayload();
    const hyperdriveDrift = compileH05ControlPlaneEvidence({
      ...payload,
      hyperdrive: {
        ...payload.hyperdrive,
        closing: {
          ...payload.hyperdrive.closing,
          originPort: 5433,
        },
      },
    });
    const probeFlags = compileH05ControlPlaneEvidence({
      ...payload,
      probe: {
        ...payload.probe,
        opening: {
          ...payload.probe.opening,
          version: {
            ...payload.probe.opening.version,
            compatibilityFlags: ["nodejs_compat"],
          },
        },
      },
    });

    expect(hyperdriveDrift).toMatchObject({
      ok: false,
      message: expect.stringContaining("opening and closing captures"),
    });
    expect(probeFlags).toMatchObject({
      ok: false,
      message: expect.stringContaining("must equal []"),
    });
  });
});

function validPayload(): H05ControlPlaneEvidencePayload {
  const hyperdriveId = "b".repeat(32);
  const executorBindings: readonly H05BindingEvidence[] = [
    { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
    {
      type: "hyperdrive",
      name: "HYPERDRIVE_CACHE_DISABLED",
      id: hyperdriveId,
    },
  ];
  const probeBindings: readonly H05BindingEvidence[] = [
    {
      type: "service",
      name: "FLAREX_EXECUTOR",
      service: "flarex-executor",
    },
    { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
    { type: "secret_text", name: "FLAREX_H05_PROBE_TOKEN" },
    { type: "secret_text", name: "FLAREX_H05_RUN_ID" },
  ];
  const privacyOpening = privacySnapshot("2026-07-11T10:00:03.500Z");
  const privacyClosing = privacySnapshot("2026-07-11T10:00:04.000Z");
  const runId = decodeH05ProofRunId("run_a");
  if (!runId.ok) throw new Error(runId.message);
  const identity = h05ProofIdentity(runId.value);
  return {
    format: h05ControlPlaneEvidenceFormat,
    accountIdSha256: "f".repeat(64),
    source: {
      commit: "a".repeat(40),
      worktreeClean: true,
      wranglerVersion: "4.100.0",
    },
    window: {
      startedAt: "2026-07-11T10:00:00.000Z",
      finishedAt: "2026-07-11T10:00:07.000Z",
    },
    run: {
      runId: identity.runId,
      deploymentId: identity.deploymentId,
      projectId: identity.projectId,
    },
    accountWorkersSubdomain: { opening: "example", closing: "example" },
    hyperdrive: {
      opening: hyperdriveSnapshot("2026-07-11T10:00:01.000Z", hyperdriveId),
      closing: hyperdriveSnapshot("2026-07-11T10:00:06.500Z", hyperdriveId),
    },
    executor: {
      deploymentBefore: {
        deploymentId: "executor-deployment-1",
        versionId: "executor-version-1",
        trafficPercentage: 100,
        observedAt: "2026-07-11T10:00:02.000Z",
      },
      opening: {
        version: workerVersion("executor-version-1", "smart", executorBindings),
        secrets: [
          { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
        ],
        subdomain: { enabled: false, previewsEnabled: false },
      },
      privacy: {
        tokenScopeAttestation: "operator-attested-all-account-zones",
        opening: privacyOpening,
        closing: privacyClosing,
      },
      closing: {
        version: workerVersion("executor-version-1", "smart", executorBindings),
        secrets: [
          { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
        ],
        subdomain: { enabled: false, previewsEnabled: false },
      },
      deploymentAfter: {
        deploymentId: "executor-deployment-1",
        versionId: "executor-version-1",
        trafficPercentage: 100,
        observedAt: "2026-07-11T10:00:05.000Z",
      },
    },
    probe: {
      deploymentBefore: {
        deploymentId: "probe-deployment-1",
        versionId: "probe-version-1",
        trafficPercentage: 100,
        observedAt: "2026-07-11T10:00:03.000Z",
      },
      opening: {
        version: workerVersion("probe-version-1", "none", probeBindings),
        secrets: [
          { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
          { type: "secret_text", name: "FLAREX_H05_PROBE_TOKEN" },
          { type: "secret_text", name: "FLAREX_H05_RUN_ID" },
        ],
        subdomain: { enabled: true, previewsEnabled: false },
      },
      publicOrigin: "https://flarex-executor-h05-probe.example.workers.dev",
      closing: {
        version: workerVersion("probe-version-1", "none", probeBindings),
        secrets: [
          { type: "secret_text", name: "FLAREX_EXECUTOR_TOKEN" },
          { type: "secret_text", name: "FLAREX_H05_PROBE_TOKEN" },
          { type: "secret_text", name: "FLAREX_H05_RUN_ID" },
        ],
        subdomain: { enabled: true, previewsEnabled: false },
      },
      deploymentAfter: {
        deploymentId: "probe-deployment-1",
        versionId: "probe-version-1",
        trafficPercentage: 100,
        observedAt: "2026-07-11T10:00:06.000Z",
      },
    },
  };
}

function privacySnapshot(checkedAt: string): H05ExecutorPrivacySnapshotEvidence {
  return {
    customDomains: {
      filteredCount: 0,
      page: 1,
      totalPages: 1,
      unfilteredTotalCount: 5,
    },
    zones: {
      requestedTypes: h05ZoneTypes,
      pageCount: 1,
      unfilteredTotalCount: 2,
      zoneIds: ["1".repeat(32), "2".repeat(32)],
    },
    routes: {
      checkedZoneIds: ["1".repeat(32), "2".repeat(32)],
      inspectedRouteCount: 3,
      targetRouteCount: 0,
    },
    directRequest: { status: 404 },
    checkedAt,
  };
}

function hyperdriveSnapshot(
  capturedAt: string,
  id: string,
): H05HyperdriveSnapshotEvidence {
  return {
    id,
    name: "flarex_executor_h05",
    originScheme: "postgresql",
    originPort: 5432,
    cachingDisabled: true,
    tlsMode: "require",
    originHostSha256: "c".repeat(64),
    originDatabaseSha256: "d".repeat(64),
    capturedAt,
  };
}

function workerVersion(
  versionId: string,
  placementMode: "smart",
  bindings: readonly H05BindingEvidence[],
): H05ExecutorWorkerVersionEvidence;
function workerVersion(
  versionId: string,
  placementMode: "none",
  bindings: readonly H05BindingEvidence[],
): H05ProbeWorkerVersionEvidence;
function workerVersion(
  versionId: string,
  placementMode: "smart" | "none",
  bindings: readonly H05BindingEvidence[],
): H05ExecutorWorkerVersionEvidence | H05ProbeWorkerVersionEvidence {
  const traceSettings: H05TraceSettingsEvidence = {
    enabled: true,
    persisted: true,
    samplingRate: 1,
  };
  const common = {
    versionId,
    compatibilityDate: "2026-06-14",
    versionBindings: bindings,
    settingsBindings: bindings,
    settingsTraceSettings: traceSettings,
    scriptTraceSettings: traceSettings,
  };
  return placementMode === "smart"
    ? {
        ...common,
        compatibilityFlags: ["nodejs_compat"],
        placementMode,
      }
    : { ...common, compatibilityFlags: [], placementMode };
}
