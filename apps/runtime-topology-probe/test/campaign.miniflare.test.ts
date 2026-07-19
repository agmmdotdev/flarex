import { describe, expect, it } from "vitest";

import { ProbeCampaignManifestV1Schema } from "../src/campaignProtocol";
import {
  PROBE_CAMPAIGN_RECONCILE_ROUTE,
  PROBE_CAMPAIGN_ROUTE,
  PROBE_CAMPAIGN_STATUS_ROUTE,
  PROBE_EVIDENCE_PAGE_ROUTE,
  PROBE_EXTERNAL_COMPLETION_ROUTE,
  PROBE_RUN_ROUTE,
  PROBE_SAMPLE_ROUTE,
} from "../src/gateway";
import {
  ProbeCampaignIdSchema,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
} from "../src/identity";
import {
  PROBE_ACTIVE_CAMPAIGN_MATRIX_V1,
  PROBE_LOCAL_REHEARSAL_MATRIX_V1,
} from "../src/matrix";
import {
  ProbeDurationMsSchema,
  PROBE_PROTOCOL_VERSION_V1,
} from "../src/protocol";
import {
  ProbeExternalCompletionRequestV1Schema,
  ProbePublicSampleRequestV1Schema,
  ProbeRunEvidencePageRequestV1Schema,
} from "../src/runProtocol";
import {
  createRuntimeProbeHarness,
  PROBE_TEST_AUTHORIZATION,
  removeRuntimeProbePersistPath,
  type RuntimeProbeHarness,
} from "./runtimeHarness";

describe.sequential("P07B campaign coordinator", () => {
  it("freezes one deployment manifest across races, conflicts, and restart", async () => {
    const first = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const persistPath = first.persistPath;
    let firstDisposed = false;
    try {
      const manifest = singleRunManifest();
      const registrations = await Promise.all([
        post(first, PROBE_CAMPAIGN_ROUTE, manifest),
        post(first, PROBE_CAMPAIGN_ROUTE, manifest),
      ]);
      expect(registrations.map(result => result.status).sort()).toEqual([
        200,
        201,
      ]);
      expect(
        registrations.map(result => result.body.created).sort(),
      ).toEqual([false, true]);

      const registeredRun = manifest.runs[0];
      if (registeredRun === undefined) throw new Error("campaign run is missing");
      const changed = ProbeCampaignManifestV1Schema.make({
        ...manifest,
        runs: [{
          ...registeredRun,
          dimensions: {
            ...registeredRun.dimensions,
            payloadBytes: 1,
          },
        }],
      });
      const conflict = await post(first, PROBE_CAMPAIGN_ROUTE, changed);
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({
        kind: "rejected",
        error: { code: "manifest-conflict", retryable: false },
      });
      const arbitraryRun = await post(
        first,
        PROBE_RUN_ROUTE,
        PROBE_LOCAL_REHEARSAL_MATRIX_V1.runs[1],
      );
      expect(arbitraryRun.status).toBe(409);
      expect(arbitraryRun.body).toMatchObject({
        kind: "rejected",
        error: { code: "manifest-conflict", retryable: false },
      });

      await first.dispose();
      firstDisposed = true;
      const restarted = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: false,
      });
      try {
        const status = await post(restarted, PROBE_CAMPAIGN_STATUS_ROUTE, {
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          campaignId: manifest.campaignId,
        });
        expect(status.status).toBe(200);
        expect(status.body).toMatchObject({
          kind: "found",
          status: {
            state: "running",
            manifest: { campaignId: manifest.campaignId },
            progress: { completedRegistrationTasks: 1 },
          },
        });
        const replay = await post(restarted, PROBE_CAMPAIGN_ROUTE, manifest);
        expect(replay.status).toBe(200);
        expect(replay.body).toMatchObject({ created: false });
      } finally {
        await restarted.dispose();
      }
    } finally {
      if (!firstDisposed) await first.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  }, 90_000);

  it("does not strand registrations when reconciliation races creation", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = PROBE_LOCAL_REHEARSAL_MATRIX_V1;
      await Promise.all([
        post(harness, PROBE_CAMPAIGN_ROUTE, manifest),
        post(harness, PROBE_CAMPAIGN_RECONCILE_ROUTE, {
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          campaignId: manifest.campaignId,
        }),
      ]);

      const registration = await post(harness, PROBE_CAMPAIGN_ROUTE, manifest);
      expect(registration.status).toBe(200);
      expect(registration.body).toMatchObject({
        kind: "registered",
        status: {
          progress: {
            completedRegistrationTasks: manifest.runs.length,
            totalRegistrationTasks: manifest.runs.length,
          },
        },
      });
      const reconciled = await post(
        harness,
        PROBE_CAMPAIGN_RECONCILE_ROUTE,
        {
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          campaignId: manifest.campaignId,
        },
      );
      expect(reconciled.status).toBe(200);
      expect(reconciled.body).toMatchObject({
        kind: "accepted",
        status: {
          state: "reconciled",
          progress: {
            completedRegistrationTasks: manifest.runs.length,
            completedReconciliationTasks: manifest.runs.length,
          },
        },
      });
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("admits only the build-frozen production manifest and run IDs", async () => {
    const harness = await createRuntimeProbeHarness({
      unfrozenAdmission: false,
    });
    try {
      const frozenRun = PROBE_ACTIVE_CAMPAIGN_MATRIX_V1.runs[0];
      if (frozenRun === undefined) throw new Error("frozen run is missing");
      const changed = ProbeCampaignManifestV1Schema.make({
        ...PROBE_ACTIVE_CAMPAIGN_MATRIX_V1,
        runs: [{
          ...frozenRun,
          dimensions: { ...frozenRun.dimensions, payloadBytes: 1 },
        }, ...PROBE_ACTIVE_CAMPAIGN_MATRIX_V1.runs.slice(1)],
      });
      expect((await post(harness, PROBE_CAMPAIGN_ROUTE, changed)).status).toBe(
        404,
      );
      expect((await post(harness, PROBE_RUN_ROUTE, frozenRun)).status).toBe(404);

      const arbitraryRunId = ProbeRunIdSchema.make("unfrozen_probe_run");
      const arbitraryRequests = await Promise.all([
        get(harness, `${PROBE_RUN_ROUTE}/${arbitraryRunId}`),
        post(
          harness,
          PROBE_SAMPLE_ROUTE,
          ProbePublicSampleRequestV1Schema.make({
            protocolVersion: PROBE_PROTOCOL_VERSION_V1,
            runId: arbitraryRunId,
            sampleOrdinal: ProbeOrdinalSchema.make(0),
          }),
        ),
        post(
          harness,
          PROBE_EXTERNAL_COMPLETION_ROUTE,
          ProbeExternalCompletionRequestV1Schema.make({
            protocolVersion: PROBE_PROTOCOL_VERSION_V1,
            runId: arbitraryRunId,
            sampleOrdinal: ProbeOrdinalSchema.make(0),
            externalDurationMs: ProbeDurationMsSchema.make(1),
          }),
        ),
        post(
          harness,
          PROBE_EVIDENCE_PAGE_ROUTE,
          ProbeRunEvidencePageRequestV1Schema.make({
            protocolVersion: PROBE_PROTOCOL_VERSION_V1,
            runId: arbitraryRunId,
            cursor: ProbeOrdinalSchema.make(0),
            limit: 1,
          }),
        ),
      ]);
      expect(arbitraryRequests.map(result => result.status)).toEqual([
        404,
        404,
        404,
        404,
      ]);

      const exact = await post(
        harness,
        PROBE_CAMPAIGN_ROUTE,
        PROBE_ACTIVE_CAMPAIGN_MATRIX_V1,
      );
      expect(exact.status).toBe(201);
      expect(exact.body).toMatchObject({
        kind: "registered",
        status: {
          budgets: {
            planned: {
              runCells: 8,
              sampleExecutions: 88,
              payloadBytes: 5_632,
              journalEntries: 176,
              uniqueCodeIds: 8,
            },
          },
          progress: { totalPurgeTasks: 24 },
        },
      });
      expect((await get(
        harness,
        `${PROBE_RUN_ROUTE}/${frozenRun.runId}`,
      )).status).toBe(200);
    } finally {
      await harness.dispose();
    }
  }, 90_000);
});

function singleRunManifest() {
  const run = PROBE_LOCAL_REHEARSAL_MATRIX_V1.runs[0];
  if (run === undefined) throw new Error("local matrix is empty");
  return ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make("p07b_campaign_freeze"),
    collectorConcurrency: 1,
    runs: [run],
  });
}

async function post(
  harness: RuntimeProbeHarness,
  path: string,
  body: unknown,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await harness.mf.dispatchFetch(`https://probe.test${path}`, {
    method: "POST",
    headers: {
      authorization: PROBE_TEST_AUTHORIZATION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const value: unknown = JSON.parse(await response.text());
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("campaign response is not an object");
  }
  return { status: response.status, body: Object.fromEntries(Object.entries(value)) };
}

async function get(
  harness: RuntimeProbeHarness,
  path: string,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await harness.mf.dispatchFetch(`https://probe.test${path}`, {
    headers: { authorization: PROBE_TEST_AUTHORIZATION },
  });
  const value: unknown = JSON.parse(await response.text());
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("campaign response is not an object");
  }
  return { status: response.status, body: Object.fromEntries(Object.entries(value)) };
}
