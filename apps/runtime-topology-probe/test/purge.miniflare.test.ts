import { describe, expect, it } from "vitest";

import {
  ProbeCampaignControlRequestV1Schema,
  ProbeCampaignManifestV1Schema,
  ProbeCampaignPurgeRequestV1Schema,
  type ProbeCampaignManifestV1,
} from "../src/campaignProtocol";
import {
  ProbeCampaignIdSchema,
  PROBE_CAMPAIGN_ACTOR_NAME,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
  probeRunActorId,
  probeSampleId,
  probeScopeId,
} from "../src/identity";
import {
  probeSyntheticCommitSeq,
  ProbeMockFinishRequestV1Schema,
  ProbeSyncControlRequestV1Schema,
} from "../src/commitProtocol";
import { PROBE_SAMPLE_ROUTE } from "../src/gateway";
import { PROBE_LOCAL_REHEARSAL_MATRIX_V1 } from "../src/matrix";
import {
  PROBE_PROTOCOL_VERSION_V1,
  probeSampleIdentityV1,
} from "../src/protocol";
import {
  ProbePublicSampleRequestV1Schema,
  ProbeRunStatusRequestV1Schema,
} from "../src/runProtocol";
import {
  ProbeRunPurgeRequestV1Schema,
  ProbeSessionPurgeRequestV1Schema,
  ProbeSyncPurgeRequestV1Schema,
} from "../src/purgeProtocol";
import {
  createInMemoryProbeCheckpointStore,
  ProbeRunnerError,
  resumeProbeCampaignPurgeV1,
  runProbeCampaignV1,
} from "../src/runner";
import {
  probeEvidencePersistenceReceiptV1,
  type ProbeRawEvidenceArtifactV1,
} from "../src/evidenceProtocol";
import {
  createRuntimeProbeHarness,
  PROBE_TEST_AUTHORIZATION,
  removeRuntimeProbePersistPath,
  type RuntimeProbeHarness,
} from "./runtimeHarness";

describe.sequential("P07B resumable facet purge", () => {
  it("prepares, aborts, and deletes retained facets one at a time", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = focusedFacetManifest("p07b_purge_rehearsal");
      const result = await runProbeCampaignV1({
          manifest,
          target: {
            kind: "local-miniflare",
            compatibilityDate: "2026-06-14",
          },
          transport: harnessTransport(harness),
          checkpoint: createInMemoryProbeCheckpointStore(),
          persistEvidence: persistEvidenceInMemory,
          purgeBatchSize: 1,
          maxPurgeControlSteps: 32,
        });

      expect(result.raw.evidence).toHaveLength(3);
      expect(result.purgedCampaign.state).toBe("purged");
      expect(result.purgedCampaign.progress.completedPurgeTasks).toBe(
        result.purgedCampaign.progress.totalPurgeTasks,
      );
    } finally {
      await harness.dispose();
    }
  }, 60_000);

  it("resumes an interrupted purge from durable progress after restart", async () => {
    const first = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const persistPath = first.persistPath;
    const manifest = focusedFacetManifest("p07b_purge_restart");
    let firstDisposed = false;
    let evidencePersisted = false;
    let persistedRaw: ProbeRawEvidenceArtifactV1 | undefined;
    try {
      const interrupted = await rejectedRunner(
        runProbeCampaignV1({
            manifest,
            target: {
              kind: "local-miniflare",
              compatibilityDate: "2026-06-14",
            },
            transport: harnessTransport(first),
            checkpoint: createInMemoryProbeCheckpointStore(),
            persistEvidence: async (raw, summary) => {
              evidencePersisted = true;
              persistedRaw = raw;
              return probeEvidencePersistenceReceiptV1(raw, summary);
            },
            purgeBatchSize: 1,
            maxPurgeControlSteps: 1,
          }),
      );
      expect(interrupted).toMatchObject({
        stage: "purge",
        retryable: true,
      });
      expect(evidencePersisted).toBe(true);
      await first.dispose();
      firstDisposed = true;

      const restarted = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: false,
      });
      try {
        const run = manifest.runs[0];
        if (run === undefined) throw new Error("purge run is missing");
        const identity = probeSampleIdentityV1(
          run.runId,
          run.scenario,
          run.dimensions,
          ProbeOrdinalSchema.make(0),
        );
        if (identity.sessionId === null) {
          throw new Error("facet run did not derive a session");
        }
        const bindings = await restarted.bindings();
        const fenced = await bindings.PROBE_SESSIONS.getByName(
          identity.sessionId,
        ).fetch("https://probe-session.internal/v1/control/read");
        expect(fenced.status).toBe(409);
        expect(await fenced.text()).toContain("session_purge_started");

        const expectedSeal = evidenceSeal(persistedRaw);
        const staleArtifact = await rejectedRunner(
          resumeProbeCampaignPurgeV1({
            campaignId: manifest.campaignId,
            expectedSeal: {
              ...expectedSeal,
              evidence: {
                ...expectedSeal.evidence,
                sha256: "0".repeat(64),
              },
            },
            transport: harnessTransport(restarted),
            purgeBatchSize: 1,
            maxPurgeControlSteps: 64,
          }),
        );
        expect(staleArtifact).toMatchObject({
          stage: "purge",
          retryable: false,
        });

        const status = await resumeProbeCampaignPurgeV1({
            campaignId: manifest.campaignId,
            expectedSeal,
            transport: harnessTransport(restarted),
            purgeBatchSize: 1,
            maxPurgeControlSteps: 64,
          });
        expect(status.state).toBe("purged");
        expect(status.progress.completedPurgeTasks).toBe(
          status.progress.totalPurgeTasks,
        );
      } finally {
        await restarted.dispose();
      }
    } finally {
      if (!firstDisposed) await first.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  }, 90_000);

  it("replays the child-success crash window in Session-to-Sync-to-Run order", async () => {
    const first = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const persistPath = first.persistPath;
    const manifest = focusedFullInvokeManifest("p07b_purge_child_success_gap");
    const run = manifest.runs[0];
    if (run === undefined) throw new Error("full invoke purge run is missing");
    const control = ProbeCampaignControlRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      campaignId: manifest.campaignId,
    });
    const purgeRequest = ProbeCampaignPurgeRequestV1Schema.make({
      ...control,
      maxTasks: 1,
    });
    let firstDisposed = false;
    try {
      const bindings = await first.bindings();
      const campaign = bindings.PROBE_CAMPAIGN.getByName(
        PROBE_CAMPAIGN_ACTOR_NAME,
      );
      expect(await campaign.register(manifest)).toMatchObject({
        kind: "registered",
      });
      const sampleResponse = await first.mf.dispatchFetch(
        `https://probe.test${PROBE_SAMPLE_ROUTE}`,
        {
          method: "POST",
          headers: {
            authorization: PROBE_TEST_AUTHORIZATION,
            "content-type": "application/json",
          },
          body: JSON.stringify(ProbePublicSampleRequestV1Schema.make({
            protocolVersion: PROBE_PROTOCOL_VERSION_V1,
            runId: run.runId,
            sampleOrdinal: ProbeOrdinalSchema.make(0),
          })),
        },
      );
      expect(sampleResponse.status).toBe(200);
      await sampleResponse.arrayBuffer();
      expect(await campaign.reconcile(control)).toMatchObject({
        kind: "accepted",
        status: { state: "reconciled" },
      });
      expect(await campaign.sealEvidence(control)).toMatchObject({
        kind: "accepted",
        status: { state: "evidence-sealed" },
      });

      const started = await campaign.purge(purgeRequest);
      expect(started).toMatchObject({
        kind: "accepted",
        status: {
          state: "purging",
          progress: { completedPurgeTasks: 0, totalPurgeTasks: 3 },
        },
      });
      const replay = sessionPurgeReplayForManifest(manifest);
      const session = bindings.PROBE_SESSIONS.getByName(replay.sessionId);
      let sessionCleared = false;
      for (let step = 0; step < 64; step += 1) {
        const receipt = await session.purge(replay.request);
        if (receipt.kind === "probe-data-cleared") {
          sessionCleared = true;
          break;
        }
      }
      expect(sessionCleared).toBe(true);
      expect(await campaign.status(control)).toMatchObject({
        kind: "found",
        status: {
          state: "purging",
          progress: { completedPurgeTasks: 0, totalPurgeTasks: 3 },
        },
      });

      await first.dispose();
      firstDisposed = true;
      const sessionReplay = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: false,
      });
      try {
        const replayBindings = await sessionReplay.bindings();
        const replayCampaign = replayBindings.PROBE_CAMPAIGN.getByName(
          PROBE_CAMPAIGN_ACTOR_NAME,
        );
        const scopeId = probeScopeId(run.runId);
        const sync = (await sessionReplay.mockBindings()).PROBE_SYNC.getByName(
          scopeId,
        );
        const syncRead = ProbeSyncControlRequestV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          runId: run.runId,
          scopeId,
          operation: "read",
        });
        const runStatus = ProbeRunStatusRequestV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          runId: run.runId,
        });
        const runStub = replayBindings.PROBE_RUNS.getByName(
          probeRunActorId(run.runId),
        );

        const sessionDone = await replayCampaign.purge(purgeRequest);
        expect(sessionDone).toMatchObject({
          kind: "accepted",
          status: {
            state: "purging",
            progress: { completedPurgeTasks: 1, totalPurgeTasks: 3 },
          },
        });
        expect(await replayBindings.PROBE_SESSIONS.getByName(
          replay.sessionId,
        ).fetch("https://probe-session.internal/v1/control/read")).toMatchObject({
          status: 409,
        });
        expect(await sync.control(syncRead)).toMatchObject({ operation: "read" });
        expect(await runStub.status(runStatus)).toMatchObject({ kind: "found" });
        expect(await sync.purge(ProbeSyncPurgeRequestV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          scopeId,
        }))).toMatchObject({
          kind: "probe-data-cleared",
          scopeId,
        });
        await expect(sync.control(syncRead)).rejects.toBeDefined();
        expect(await replayCampaign.status(control)).toMatchObject({
          kind: "found",
          status: {
            state: "purging",
            progress: { completedPurgeTasks: 1, totalPurgeTasks: 3 },
          },
        });
        expect(await runStub.status(runStatus)).toMatchObject({ kind: "found" });
      } finally {
        await sessionReplay.dispose();
      }

      const syncReplay = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: false,
      });
      try {
        const replayBindings = await syncReplay.bindings();
        const replayCampaign = replayBindings.PROBE_CAMPAIGN.getByName(
          PROBE_CAMPAIGN_ACTOR_NAME,
        );
        const runStub = replayBindings.PROBE_RUNS.getByName(
          probeRunActorId(run.runId),
        );
        const runStatus = ProbeRunStatusRequestV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          runId: run.runId,
        });
        expect(await replayCampaign.purge(purgeRequest)).toMatchObject({
          kind: "accepted",
          status: {
            state: "purging",
            progress: { completedPurgeTasks: 2, totalPurgeTasks: 3 },
          },
        });
        expect(await runStub.status(runStatus)).toMatchObject({ kind: "found" });
        expect(await runStub.purge(ProbeRunPurgeRequestV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          runId: run.runId,
        }))).toMatchObject({
          kind: "storage-cleared",
          runId: run.runId,
        });
        expect(await replayCampaign.status(control)).toMatchObject({
          kind: "found",
          status: {
            state: "purging",
            progress: { completedPurgeTasks: 2, totalPurgeTasks: 3 },
          },
        });
        expect(await runStub.status(runStatus)).toMatchObject({
          kind: "not-found",
        });
      } finally {
        await syncReplay.dispose();
      }

      const runReplay = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: false,
      });
      try {
        const replayBindings = await runReplay.bindings();
        const replayCampaign = replayBindings.PROBE_CAMPAIGN.getByName(
          PROBE_CAMPAIGN_ACTOR_NAME,
        );
        const runStatus = ProbeRunStatusRequestV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          runId: run.runId,
        });
        const runDone = await replayCampaign.purge(purgeRequest);
        expect(runDone).toMatchObject({
          kind: "accepted",
          status: {
            state: "purged",
            progress: { completedPurgeTasks: 3, totalPurgeTasks: 3 },
          },
        });
        expect(await replayBindings.PROBE_RUNS.getByName(
          probeRunActorId(run.runId),
        ).status(runStatus)).toMatchObject({
          kind: "not-found",
        });
      } finally {
        await runReplay.dispose();
      }
    } finally {
      if (!firstDisposed) await first.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  }, 120_000);

  it("retains only an idempotent session tombstone across restart", async () => {
    const first = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const persistPath = first.persistPath;
    const manifest = focusedFacetManifest("p07b_purge_exact_tombstone");
    let firstDisposed = false;
    try {
      const result = await runProbeCampaignV1({
          manifest,
          target: {
            kind: "local-miniflare",
            compatibilityDate: "2026-06-14",
          },
          transport: harnessTransport(first),
          checkpoint: createInMemoryProbeCheckpointStore(),
          persistEvidence: persistEvidenceInMemory,
          purgeBatchSize: 1,
          maxPurgeControlSteps: 64,
        });
      expect(result.purgedCampaign.state).toBe("purged");
      await first.dispose();
      firstDisposed = true;

      const restarted = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: false,
      });
      try {
        const replay = sessionPurgeReplayForManifest(manifest);
        const bindings = await restarted.bindings();
        const receipt = await bindings.PROBE_SESSIONS.getByName(
          replay.sessionId,
        ).purge(replay.request);
        expect(receipt).toMatchObject({
          kind: "probe-data-cleared",
          sessionId: replay.sessionId,
          probeDataCleared: true,
          completionTombstoneRetained: true,
        });
      } finally {
        await restarted.dispose();
      }
    } finally {
      if (!firstDisposed) await first.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  }, 90_000);

  it("freezes the first session purge plan across conflicting retries", async () => {
    const first = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const persistPath = first.persistPath;
    const replay = sessionPurgeReplayForManifest(
      focusedFacetManifest("p07b_purge_plan_identity"),
    );
    let firstDisposed = false;
    try {
      const firstBindings = await first.bindings();
      const firstReceipt = await firstBindings.PROBE_SESSIONS.getByName(
        replay.sessionId,
      ).purge(replay.request);
      expect(firstReceipt.kind).toBe("in-progress");
      const conflicting = ProbeSessionPurgeRequestV1Schema.make({
        ...replay.request,
        facets: replay.request.facets.slice(0, -1),
      });
      await expect(firstBindings.PROBE_SESSIONS.getByName(
        replay.sessionId,
      ).purge(conflicting)).rejects.toBeDefined();
      await first.dispose();
      firstDisposed = true;

      const restarted = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: false,
      });
      try {
        const stub = (await restarted.bindings()).PROBE_SESSIONS.getByName(
          replay.sessionId,
        );
        await expect(stub.purge(conflicting)).rejects.toBeDefined();
        let completed = false;
        for (let step = 0; step < 32; step += 1) {
          const receipt = await stub.purge(replay.request);
          if (receipt.kind === "probe-data-cleared") {
            completed = true;
            break;
          }
        }
        expect(completed).toBe(true);
      } finally {
        await restarted.dispose();
      }
    } finally {
      if (!firstDisposed) await first.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  }, 90_000);

  it("serializes concurrent identical session purge retries", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const replay = sessionPurgeReplayForManifest(
        focusedFacetManifest("p07b_purge_same_plan_race"),
      );
      const session = (await harness.bindings()).PROBE_SESSIONS.getByName(
        replay.sessionId,
      );
      let completed = false;
      for (let step = 0; step < 32; step += 1) {
        const receipts = await Promise.all([
          session.purge(replay.request),
          session.purge(replay.request),
        ]);
        expect(receipts.every(receipt =>
          receipt.kind === "in-progress" ||
          receipt.kind === "probe-data-cleared"
        )).toBe(true);
        if (receipts.some(receipt => receipt.kind === "probe-data-cleared")) {
          completed = true;
          break;
        }
      }
      expect(completed).toBe(true);
      expect(await session.purge(replay.request)).toMatchObject({
        kind: "probe-data-cleared",
        sessionId: replay.sessionId,
      });
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("keeps a sync purge fence against a late mock wake after restart", async () => {
    const first = await createRuntimeProbeHarness({
      removePersistPathOnDispose: false,
    });
    const persistPath = first.persistPath;
    let firstDisposed = false;
    try {
      const runId = ProbeRunIdSchema.make("p07b_sync_purge_fence");
      const sampleOrdinal = ProbeOrdinalSchema.make(0);
      const scopeId = probeScopeId(runId);
      const finishRequest = ProbeMockFinishRequestV1Schema.make({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        runId,
        sampleId: probeSampleId(runId, sampleOrdinal),
        sampleOrdinal,
        scopeId,
        scenario: "commit_wake",
        commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
      });
      const bindings = await first.bindings();
      const mockFinish = bindings.MOCK_FINISH;
      const mockPurge = bindings.MOCK_PURGE;
      if (mockFinish === undefined || mockPurge === undefined) {
        throw new Error("mock purge bindings are missing");
      }
      await mockFinish.finish(finishRequest);
      const purgeRequest = ProbeSyncPurgeRequestV1Schema.make({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        scopeId,
      });
      expect(await mockPurge.purge(purgeRequest)).toMatchObject({
        kind: "probe-data-cleared",
        scopeId,
        probeDataCleared: true,
        completionTombstoneRetained: true,
      });
      await first.dispose();
      firstDisposed = true;

      const restarted = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: false,
      });
      try {
        const restartedBindings = await restarted.bindings();
        const restartedFinish = restartedBindings.MOCK_FINISH;
        const restartedPurge = restartedBindings.MOCK_PURGE;
        if (restartedFinish === undefined || restartedPurge === undefined) {
          throw new Error("restarted mock purge bindings are missing");
        }
        let lateWakeRejected = false;
        try {
          await restartedFinish.finish(finishRequest);
        } catch {
          lateWakeRejected = true;
        }
        expect(lateWakeRejected).toBe(true);
        expect(await restartedPurge.purge(purgeRequest)).toMatchObject({
          kind: "probe-data-cleared",
          scopeId,
          probeDataCleared: true,
          completionTombstoneRetained: true,
        });
      } finally {
        await restarted.dispose();
      }
    } finally {
      if (!firstDisposed) await first.dispose();
      await removeRuntimeProbePersistPath(persistPath);
    }
  }, 90_000);
});

function focusedFacetManifest(campaignId: string) {
  const run = PROBE_LOCAL_REHEARSAL_MATRIX_V1.runs.find(candidate =>
    candidate.runId === "local_04_facet_stable"
  );
  if (run === undefined) throw new Error("facet rehearsal run is missing");
  return ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make(campaignId),
    collectorConcurrency: 1,
    runs: [run],
  });
}

function focusedFullInvokeManifest(campaignId: string) {
  const run = PROBE_LOCAL_REHEARSAL_MATRIX_V1.runs.find(candidate =>
    candidate.runId === "local_07_invoke_stable"
  );
  if (run === undefined) throw new Error("full invoke rehearsal run is missing");
  return ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make(campaignId),
    collectorConcurrency: 1,
    runs: [run],
  });
}

async function persistEvidenceInMemory(
  raw: Parameters<typeof probeEvidencePersistenceReceiptV1>[0],
  summary: Parameters<typeof probeEvidencePersistenceReceiptV1>[1],
) {
  return probeEvidencePersistenceReceiptV1(raw, summary);
}

function evidenceSeal(raw: ProbeRawEvidenceArtifactV1 | undefined) {
  if (raw?.campaign.evidence === null || raw === undefined) {
    throw new Error("persisted evidence seal is missing");
  }
  return {
    manifestSha256: raw.campaign.manifestSha256,
    evidence: raw.campaign.evidence,
  };
}

function sessionPurgeReplayForManifest(
  manifest: ProbeCampaignManifestV1,
) {
  const run = manifest.runs[0];
  if (run === undefined) throw new Error("purge replay run is missing");
  const total = run.warmupRepetitions + run.repetitions;
  const identities = Array.from({ length: total }, (_, ordinal) =>
    probeSampleIdentityV1(
      run.runId,
      run.scenario,
      run.dimensions,
      ProbeOrdinalSchema.make(ordinal),
    )
  );
  const sessionId = identities[0]?.sessionId;
  if (sessionId === null || sessionId === undefined) {
    throw new Error("purge replay session is missing");
  }
  const facets = identities.map(identity => {
    if (
      identity.sessionId !== sessionId ||
      identity.attemptId === null ||
      identity.codeId === null
    ) {
      throw new Error("purge replay facet identity is invalid");
    }
    return { attemptId: identity.attemptId, codeId: identity.codeId };
  });
  return {
    sessionId,
    request: ProbeSessionPurgeRequestV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      sessionId,
      facets,
    }),
  };
}

function harnessTransport(harness: RuntimeProbeHarness) {
  return {
    origin: "https://probe.test",
    authorization: PROBE_TEST_AUTHORIZATION,
    fetch: async (request: Request) => {
      const body = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.text();
      const response = await harness.mf.dispatchFetch(request.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        ...(body === undefined ? {} : { body }),
      });
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
      });
    },
    now: () => performance.now(),
  };
}

async function rejectedRunner(
  operation: Promise<unknown>,
): Promise<ProbeRunnerError> {
  try {
    await operation;
  } catch (cause) {
    if (cause instanceof ProbeRunnerError) return cause;
    throw cause;
  }
  throw new Error("expected the probe runner operation to fail");
}
