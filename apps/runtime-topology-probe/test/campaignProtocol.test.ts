import { describe, expect, it } from "vitest";

import {
  decodeProbeCampaignManifestV1OrNull,
  probeCampaignBudgetPlanV1,
  PROBE_CAMPAIGN_BUDGET_LIMIT_VALUES_V1,
  ProbeCampaignManifestV1Schema,
  ProbeCampaignStatusV1Schema,
} from "../src/campaignProtocol";
import { ProbeCampaignIdSchema, ProbeRunIdSchema } from "../src/identity";
import { PROBE_LOCAL_REHEARSAL_MATRIX_V1 } from "../src/matrix";
import {
  PROBE_PROTOCOL_VERSION_V1,
  ProbeRunRequestV1Schema,
  type ProbeRunRequestV1,
  type ProbeScenario,
} from "../src/protocol";

describe("campaign protocol", () => {
  it("derives the checked-in matrix budget by exact code-ID union", () => {
    expect(probeCampaignBudgetPlanV1(PROBE_LOCAL_REHEARSAL_MATRIX_V1)).toEqual({
      runCells: 12,
      sampleExecutions: 32,
      payloadBytes: 960,
      journalEntries: 20,
      uniqueCodeIds: 12,
    });
  });

  it("deduplicates stable source IDs and counts each new-code ordinal", () => {
    const stable = manifest("stable_union", [
      run("stable_01_echo", "facet_echo"),
      run("stable_02_journal", "facet_journal", { journalEntries: 1 }),
    ]);
    const newCode = manifest("new_code_union", [
      run("new_01_direct", "dynamic_direct_echo", {
        codeMode: "new-code",
        repetitions: 3,
      }),
    ]);

    expect(probeCampaignBudgetPlanV1(stable).uniqueCodeIds).toBe(1);
    expect(probeCampaignBudgetPlanV1(newCode).uniqueCodeIds).toBe(3);
  });

  it("rejects duplicate IDs, duplicate cells, unsorted runs, and extra fields", () => {
    const first = run("cell_01", "edge_echo");
    const secondId = ProbeRunIdSchema.make("cell_02");
    const duplicateCell = { ...first, runId: secondId };

    expect(decodeProbeCampaignManifestV1OrNull(rawManifest([first, first])))
      .toBeNull();
    expect(
      decodeProbeCampaignManifestV1OrNull(
        rawManifest([first, duplicateCell]),
      ),
    ).toBeNull();
    expect(
      decodeProbeCampaignManifestV1OrNull(
        rawManifest([duplicateCell, first]),
      ),
    ).toBeNull();
    expect(
      decodeProbeCampaignManifestV1OrNull({
        ...rawManifest([first]),
        token: "must-not-be-accepted",
      }),
    ).toBeNull();
  });

  it("rejects a valid per-run set whose aggregate sample budget is too large", () => {
    const runs = Array.from({ length: 4 }, (_, index) =>
      run(`overflow_0${index + 1}`, "edge_echo", {
        repetitions: 500,
        warmupRepetitions: 100,
        payloadBytes: index,
      })
    );

    expect(decodeProbeCampaignManifestV1OrNull(rawManifest(runs))).toBeNull();
  });

  it("rejects campaign statuses that contradict their immutable manifest", () => {
    const campaign = manifest("campaign_status_relations", [
      run("status_01_edge", "edge_echo"),
    ]);
    const planned = probeCampaignBudgetPlanV1(campaign);
    const status = ProbeCampaignStatusV1Schema.make({
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      manifest: campaign,
      manifestSha256: "0".repeat(64),
      state: "running",
      budgets: {
        limits: PROBE_CAMPAIGN_BUDGET_LIMIT_VALUES_V1,
        planned,
      },
      progress: {
        totalRegistrationTasks: 1,
        completedRegistrationTasks: 1,
        totalReconciliationTasks: 1,
        completedReconciliationTasks: 0,
        totalPurgeTasks: 1,
        completedPurgeTasks: 0,
      },
      evidence: null,
    });

    expect(status.state).toBe("running");
    expect(() => ProbeCampaignStatusV1Schema.make({
      ...status,
      budgets: {
        ...status.budgets,
        planned: {
          ...status.budgets.planned,
          sampleExecutions: status.budgets.planned.sampleExecutions + 1,
        },
      },
    })).toThrow();
    expect(() => ProbeCampaignStatusV1Schema.make({
      ...status,
      progress: {
        ...status.progress,
        completedReconciliationTasks: 1,
      },
    })).toThrow();
    expect(() => ProbeCampaignStatusV1Schema.make({
      ...status,
      evidence: {
        recordCount: planned.sampleExecutions,
        sha256: "1".repeat(64),
      },
    })).toThrow();
  });
});

interface RunOptions {
  readonly codeMode?: "new-code" | "stable";
  readonly journalEntries?: number;
  readonly payloadBytes?: number;
  readonly repetitions?: number;
  readonly warmupRepetitions?: number;
}

function run(
  runId: string,
  scenario: ProbeScenario,
  options: RunOptions = {},
): ProbeRunRequestV1 {
  return ProbeRunRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId: ProbeRunIdSchema.make(runId),
    scenario,
    repetitions: options.repetitions ?? 1,
    warmupRepetitions: options.warmupRepetitions ?? 0,
    dimensions: {
      codeMode: options.codeMode ?? "stable",
      concurrency: 1,
      journalEntries: options.journalEntries ?? 0,
      payloadBytes: options.payloadBytes ?? 0,
      sessionMode: "new-session",
    },
  });
}

function manifest(campaignId: string, runs: readonly ProbeRunRequestV1[]) {
  return ProbeCampaignManifestV1Schema.make(rawManifest(runs, campaignId));
}

function rawManifest(
  runs: readonly ProbeRunRequestV1[],
  campaignId = "campaign_protocol",
) {
  return {
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make(campaignId),
    collectorConcurrency: 1,
    runs,
  };
}
