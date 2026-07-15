import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  probeCampaignBudgetPlanV1,
  PROBE_CAMPAIGN_LIMITS_V1,
} from "../src/campaignProtocol";
import { PROBE_LOCAL_REHEARSAL_MATRIX_V1 } from "../src/matrix";
import { PROBE_CAMPAIGN_PURGE_ROUTE } from "../src/gateway";
import {
  buildProbeSummaryArtifactV1,
  decodeProbeRawEvidenceArtifactV1OrNull,
  decodeProbeSummaryArtifactV1OrNull,
  ProbeRawEvidenceArtifactV1Schema,
} from "../src/evidenceProtocol";
import { runProbeCampaignV1 } from "../src/runner";
import {
  createFileProbeCheckpointStore,
  probeEvidenceArtifactPaths,
  readProbeEvidenceArtifacts,
  writeProbeEvidenceArtifacts,
} from "../scripts/probeFiles";
import {
  createRuntimeProbeHarness,
  PROBE_TEST_AUTHORIZATION,
  type RuntimeProbeHarness,
} from "./runtimeHarness";

describe.sequential("P07B bounded matrix runner", () => {
  let harness: RuntimeProbeHarness;

  beforeAll(async () => {
    harness = await createRuntimeProbeHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it("runs, exports, seals, and purges the full local matrix", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flarex-probe-evidence-"));
    try {
      const checkpointPath = join(directory, "checkpoint.json");
      const checkpoint = createFileProbeCheckpointStore(checkpointPath);
      let evidencePersisted = false;
      const result = await runProbeCampaignV1({
          manifest: PROBE_LOCAL_REHEARSAL_MATRIX_V1,
          target: {
            kind: "local-miniflare",
            compatibilityDate: "2026-06-14",
          },
          transport: {
            origin: "https://probe.test",
            authorization: PROBE_TEST_AUTHORIZATION,
            fetch: async request => {
              if (
                new URL(request.url).pathname === PROBE_CAMPAIGN_PURGE_ROUTE &&
                !evidencePersisted
              ) {
                throw new Error("purge started before durable evidence export");
              }
              return await dispatchRequest(harness, request);
            },
            now: () => performance.now(),
          },
          checkpoint,
          persistEvidence: async (raw, summary) => {
            const receipt = await writeProbeEvidenceArtifacts(
              directory,
              PROBE_LOCAL_REHEARSAL_MATRIX_V1.campaignId,
              raw,
              summary,
            );
            evidencePersisted = true;
            return receipt;
          },
          purgeBatchSize: 3,
          maxPurgeControlSteps: 256,
        });

      expect(probeCampaignBudgetPlanV1(PROBE_LOCAL_REHEARSAL_MATRIX_V1))
        .toEqual({
          runCells: 12,
          sampleExecutions: 32,
          payloadBytes: 960,
          journalEntries: 20,
          uniqueCodeIds: 12,
        });
      expect(PROBE_LOCAL_REHEARSAL_MATRIX_V1.runs).toHaveLength(12);
      expect(new Set(
        PROBE_LOCAL_REHEARSAL_MATRIX_V1.runs.map(run => run.scenario),
      ).size).toBe(8);
      expect(result.summary.integrity).toMatchObject({
        publishable: true,
        plannedSamples: 32,
        observedSamples: 32,
        externalDurationMissingSamples: 0,
        abandonedSamples: 0,
        notStartedSamples: 0,
      });
      expect(result.raw.evidence).toHaveLength(32);
      expect(result.purgedCampaign.state).toBe("purged");
      expect(result.purgedCampaign.progress.completedPurgeTasks).toBe(
        result.purgedCampaign.progress.totalPurgeTasks,
      );
      const persisted = await readProbeEvidenceArtifacts(
        directory,
        PROBE_LOCAL_REHEARSAL_MATRIX_V1.campaignId,
      );
      expect(persisted).toEqual({ raw: result.raw, summary: result.summary });
      expect(
        (await checkpoint.load(PROBE_LOCAL_REHEARSAL_MATRIX_V1.campaignId))
          .externalCompletions,
      ).toHaveLength(32);
      const paths = probeEvidenceArtifactPaths(
        directory,
        PROBE_LOCAL_REHEARSAL_MATRIX_V1.campaignId,
      );
      const serialized = (
        await Promise.all([
          readFile(checkpointPath, "utf8"),
          readFile(paths.raw, "utf8"),
          readFile(paths.summary, "utf8"),
        ])
      ).join("\n");
      expect(serialized).not.toContain(PROBE_TEST_AUTHORIZATION);
      expect(serialized).not.toContain("rtp-claim-");
      expect(serialized).not.toContain('"payload"');
      expect(decodeProbeRawEvidenceArtifactV1OrNull({
        ...result.raw,
        authorization: PROBE_TEST_AUTHORIZATION,
      })).toBeNull();
      expect(decodeProbeSummaryArtifactV1OrNull({
        ...result.summary,
        claimToken: "rtp-claim-forbidden",
      })).toBeNull();
      const contradictoryIntegrity = {
        ...result.summary,
        integrity: {
          ...result.summary.integrity,
          publishable: false,
        },
      };
      expect(decodeProbeSummaryArtifactV1OrNull(contradictoryIntegrity))
        .toBeNull();
      expect(
        result.raw.campaign.budgets.planned.sampleExecutions,
      ).toBeLessThanOrEqual(PROBE_CAMPAIGN_LIMITS_V1.sampleExecutions);

      const firstObservedIndex = result.raw.evidence.findIndex(
        record => record.kind === "observed",
      );
      const firstObserved = result.raw.evidence[firstObservedIndex];
      const secondObservedIndex = result.raw.evidence.findIndex(record =>
        record.kind === "observed" &&
        firstObserved?.kind === "observed" &&
        record.result.sample.runId !== firstObserved.result.sample.runId
      );
      const secondObserved = result.raw.evidence[secondObservedIndex];
      if (
        firstObservedIndex < 0 ||
        secondObservedIndex < 0 ||
        firstObserved?.kind !== "observed" ||
        secondObserved?.kind !== "observed"
      ) {
        throw new Error("matrix evidence did not contain two observed runs");
      }
      const swappedInnerEvidence = result.raw.evidence.map((record, index) => {
        if (index === firstObservedIndex && record.kind === "observed") {
          return { ...record, result: secondObserved.result };
        }
        if (index === secondObservedIndex && record.kind === "observed") {
          return { ...record, result: firstObserved.result };
        }
        return record;
      });
      expect(decodeProbeRawEvidenceArtifactV1OrNull({
        ...result.raw,
        evidence: swappedInnerEvidence,
      })).toBeNull();

      await writeFile(paths.summary, JSON.stringify(contradictoryIntegrity), "utf8");
      await expect(readProbeEvidenceArtifacts(
        directory,
        PROBE_LOCAL_REHEARSAL_MATRIX_V1.campaignId,
      )).rejects.toMatchObject({
        _tag: "ProbeFileError",
        operation: "decode",
      });

      await writeFile(paths.summary, JSON.stringify({
        ...result.summary,
        integrity: {
          ...result.summary.integrity,
          failedScenarioSamples:
            result.summary.integrity.failedScenarioSamples + 1,
        },
      }), "utf8");
      await expect(readProbeEvidenceArtifacts(
        directory,
        PROBE_LOCAL_REHEARSAL_MATRIX_V1.campaignId,
      )).rejects.toMatchObject({
        _tag: "ProbeFileError",
        operation: "verify",
      });

      const tamperedRaw = ProbeRawEvidenceArtifactV1Schema.make({
        ...result.raw,
        evidence: [...result.raw.evidence].reverse(),
      });
      const tamperedSummary = await buildProbeSummaryArtifactV1(tamperedRaw);
      await writeFile(paths.raw, JSON.stringify(tamperedRaw), "utf8");
      await writeFile(paths.summary, JSON.stringify(tamperedSummary), "utf8");
      await expect(readProbeEvidenceArtifacts(
        directory,
        PROBE_LOCAL_REHEARSAL_MATRIX_V1.campaignId,
      )).rejects.toMatchObject({
        _tag: "ProbeFileError",
        operation: "verify",
        path: paths.raw,
      });

      const manifestDigestTamperedRaw = ProbeRawEvidenceArtifactV1Schema.make({
        ...result.raw,
        campaign: {
          ...result.raw.campaign,
          manifestSha256: "0".repeat(64),
        },
      });
      const manifestDigestTamperedSummary = await buildProbeSummaryArtifactV1(
        manifestDigestTamperedRaw,
      );
      await writeFile(
        paths.raw,
        JSON.stringify(manifestDigestTamperedRaw),
        "utf8",
      );
      await writeFile(
        paths.summary,
        JSON.stringify(manifestDigestTamperedSummary),
        "utf8",
      );
      await expect(readProbeEvidenceArtifacts(
        directory,
        PROBE_LOCAL_REHEARSAL_MATRIX_V1.campaignId,
      )).rejects.toMatchObject({
        _tag: "ProbeFileError",
        operation: "verify",
        path: paths.raw,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
});

async function dispatchRequest(
  harness: RuntimeProbeHarness,
  request: Request,
): Promise<Response> {
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
}
