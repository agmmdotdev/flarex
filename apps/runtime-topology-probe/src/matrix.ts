import {
  ProbeCampaignManifestV1Schema,
  type ProbeCampaignManifestV1,
} from "./campaignProtocol";
import { ProbeCampaignIdSchema, ProbeRunIdSchema } from "./identity";
import {
  PROBE_PROTOCOL_VERSION_V1,
  ProbeRunRequestV1Schema,
  type ProbeRunRequestV1,
  type ProbeScenario,
} from "./protocol";

interface RehearsalRunInput {
  readonly runId: string;
  readonly scenario: ProbeScenario;
  readonly replicate?: number;
  readonly codeMode?: "new-code" | "stable";
  readonly sessionMode?: "new-session" | "reuse-session";
  readonly repetitions?: number;
  readonly warmupRepetitions?: number;
  readonly concurrency?: number;
  readonly payloadBytes?: number;
  readonly journalEntries?: number;
}

function rehearsalRun(input: RehearsalRunInput): ProbeRunRequestV1 {
  return ProbeRunRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId: ProbeRunIdSchema.make(input.runId),
    scenario: input.scenario,
    replicate: input.replicate,
    repetitions: input.repetitions ?? 2,
    warmupRepetitions: input.warmupRepetitions ?? 1,
    dimensions: {
      codeMode: input.codeMode ?? "stable",
      concurrency: input.concurrency ?? 1,
      journalEntries: input.journalEntries ?? 0,
      payloadBytes: input.payloadBytes ?? 0,
      sessionMode: input.sessionMode ?? "new-session",
    },
  });
}

export const PROBE_LOCAL_REHEARSAL_MATRIX_V1: ProbeCampaignManifestV1 =
  ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make("p07b_local_v1"),
    collectorConcurrency: 4,
    runs: [
      rehearsalRun({ runId: "local_01_edge", scenario: "edge_echo" }),
      rehearsalRun({
        runId: "local_02_session",
        scenario: "session_echo",
        concurrency: 2,
        sessionMode: "reuse-session",
      }),
      rehearsalRun({
        runId: "local_03_direct_stable",
        scenario: "dynamic_direct_echo",
        concurrency: 2,
        payloadBytes: 64,
      }),
      rehearsalRun({
        runId: "local_04_facet_stable",
        scenario: "facet_echo",
        concurrency: 2,
        sessionMode: "reuse-session",
      }),
      rehearsalRun({
        runId: "local_05_journal_stable",
        scenario: "facet_journal",
        concurrency: 2,
        journalEntries: 2,
        payloadBytes: 64,
        sessionMode: "reuse-session",
      }),
      rehearsalRun({
        runId: "local_06_wake",
        scenario: "commit_wake",
      }),
      rehearsalRun({
        runId: "local_07_invoke_stable",
        scenario: "full_invoke",
        journalEntries: 2,
        payloadBytes: 64,
        sessionMode: "reuse-session",
      }),
      rehearsalRun({
        runId: "local_08_rerun_stable",
        scenario: "sync_rerun",
        concurrency: 2,
      }),
      rehearsalRun({
        runId: "local_09_direct_new",
        scenario: "dynamic_direct_echo",
        codeMode: "new-code",
        concurrency: 2,
        payloadBytes: 64,
        warmupRepetitions: 0,
      }),
      rehearsalRun({
        runId: "local_10_journal_new",
        scenario: "facet_journal",
        codeMode: "new-code",
        concurrency: 2,
        journalEntries: 2,
        payloadBytes: 64,
        warmupRepetitions: 0,
      }),
      rehearsalRun({
        runId: "local_11_invoke_new",
        scenario: "full_invoke",
        codeMode: "new-code",
        journalEntries: 2,
        payloadBytes: 64,
        warmupRepetitions: 0,
      }),
      rehearsalRun({
        runId: "local_12_rerun_new",
        scenario: "sync_rerun",
        codeMode: "new-code",
        concurrency: 2,
        warmupRepetitions: 0,
      }),
    ],
  });

type SessionExecutorComparisonScenario =
  | "executor_worker_invoke"
  | "session_executor_invoke";

function sessionExecutorComparisonRun(
  pair: number,
  scenario: SessionExecutorComparisonScenario,
): ProbeRunRequestV1 {
  const host = scenario === "executor_worker_invoke" ? "external" : "session";
  return rehearsalRun({
    runId: `p12_${pair.toString().padStart(2, "0")}_${host}`,
    scenario,
    replicate: pair,
    repetitions: 1,
    warmupRepetitions: pair === 1 ? 2 : 0,
    journalEntries: 2,
    payloadBytes: 64,
    sessionMode: "new-session",
  });
}

export const PROBE_SESSION_EXECUTOR_AB_MATRIX_V1: ProbeCampaignManifestV1 =
  ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make("p12_session_executor_ab_v1"),
    collectorConcurrency: 1,
    runs: Array.from({ length: 12 }, (_, index) => index + 1).flatMap(
      pair => [
        sessionExecutorComparisonRun(pair, "executor_worker_invoke"),
        sessionExecutorComparisonRun(pair, "session_executor_invoke"),
      ],
    ),
  });

type FacetExecutorComparisonScenario =
  | "executor_worker_invoke"
  | "facet_executor_invoke";

function facetExecutorComparisonRun(
  pair: number,
  scenario: FacetExecutorComparisonScenario,
): ProbeRunRequestV1 {
  const host = scenario === "executor_worker_invoke" ? "bound" : "facet";
  return rehearsalRun({
    runId: `p16_${pair.toString().padStart(2, "0")}_${host}`,
    scenario,
    replicate: pair,
    repetitions: 1,
    warmupRepetitions: pair === 1 ? 2 : 0,
    journalEntries: 2,
    payloadBytes: 64,
    sessionMode: "new-session",
  });
}

export const PROBE_FACET_EXECUTOR_AB_MATRIX_V1: ProbeCampaignManifestV1 =
  ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make("p16_facet_executor_ab_v1"),
    collectorConcurrency: 1,
    runs: Array.from({ length: 12 }, (_, index) => index + 1).flatMap(
      pair => [
        facetExecutorComparisonRun(pair, "executor_worker_invoke"),
        facetExecutorComparisonRun(pair, "facet_executor_invoke"),
      ],
    ),
  });

type FacetFinalizerComparisonScenario =
  | "facet_executor_invoke"
  | "facet_finalizer_invoke";

function facetFinalizerComparisonRun(
  pair: number,
  scenario: FacetFinalizerComparisonScenario,
  position: "a" | "b",
): ProbeRunRequestV1 {
  const host = scenario === "facet_executor_invoke"
    ? "supervisor"
    : "facet";
  return rehearsalRun({
    runId: `p20_${pair.toString().padStart(2, "0")}_${position}_${host}`,
    scenario,
    replicate: pair,
    repetitions: 1,
    warmupRepetitions: pair === 1 ? 2 : 0,
    journalEntries: 2,
    payloadBytes: 64,
    sessionMode: "new-session",
  });
}

export const PROBE_FACET_FINALIZER_AB_MATRIX_V1: ProbeCampaignManifestV1 =
  ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make("p20_facet_finalizer_ab_v1"),
    collectorConcurrency: 1,
    runs: Array.from({ length: 12 }, (_, index) => index + 1).flatMap(
      pair => pair % 2 === 1
        ? [
            facetFinalizerComparisonRun(
              pair,
              "facet_executor_invoke",
              "a",
            ),
            facetFinalizerComparisonRun(
              pair,
              "facet_finalizer_invoke",
              "b",
            ),
          ]
        : [
            facetFinalizerComparisonRun(
              pair,
              "facet_finalizer_invoke",
              "a",
            ),
            facetFinalizerComparisonRun(
              pair,
              "facet_executor_invoke",
              "b",
            ),
          ],
    ),
  });

function warmFacetFinalizerRun(replicate: number): ProbeRunRequestV1 {
  return rehearsalRun({
    runId: `p24_${replicate.toString().padStart(2, "0")}_warm`,
    scenario: "facet_finalizer_warm_invoke",
    replicate,
    repetitions: 11,
    warmupRepetitions: 0,
    journalEntries: 2,
    payloadBytes: 64,
    sessionMode: "reuse-session",
  });
}

export const PROBE_WARM_FACET_FINALIZER_MATRIX_V1: ProbeCampaignManifestV1 =
  ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make("p24_warm_facet_finalizer_v1"),
    collectorConcurrency: 1,
    runs: Array.from({ length: 8 }, (_, index) =>
      warmFacetFinalizerRun(index + 1)),
  });

function postgresComparisonRun(replicate: number): ProbeRunRequestV1 {
  return rehearsalRun({
    runId: `p28_${replicate.toString().padStart(2, "0")}_warm`,
    scenario: "facet_finalizer_warm_invoke",
    replicate,
    repetitions: 6,
    warmupRepetitions: 0,
    journalEntries: 2,
    payloadBytes: 64,
    sessionMode: "reuse-session",
  });
}

export const PROBE_POSTGRES_COMPARISON_MATRIX_V1: ProbeCampaignManifestV1 =
  ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make("p28_hyperdrive_comparison_v1"),
    collectorConcurrency: 1,
    runs: Array.from({ length: 8 }, (_, index) =>
      postgresComparisonRun(index + 1)),
  });

function postgresHyperdriveRun(replicate: number): ProbeRunRequestV1 {
  return rehearsalRun({
    runId: `p28pg_${replicate.toString().padStart(2, "0")}_warm`,
    scenario: "facet_finalizer_postgres_warm_invoke",
    replicate,
    repetitions: 6,
    warmupRepetitions: 0,
    journalEntries: 2,
    payloadBytes: 64,
    sessionMode: "reuse-session",
  });
}

export const PROBE_POSTGRES_HYPERDRIVE_MATRIX_V1: ProbeCampaignManifestV1 =
  ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make("p28_hyperdrive_postgres_v1"),
    collectorConcurrency: 1,
    runs: Array.from({ length: 8 }, (_, index) =>
      postgresHyperdriveRun(index + 1)),
  });

type SessionPostgresComparisonScenario =
  | "facet_finalizer_postgres_warm_invoke"
  | "session_postgres_warm_invoke";

function sessionPostgresComparisonRun(
  pair: number,
  scenario: SessionPostgresComparisonScenario,
  position: "a" | "b",
): ProbeRunRequestV1 {
  const host = scenario === "session_postgres_warm_invoke"
    ? "session"
    : "entrypoint";
  return rehearsalRun({
    runId: `p32d_${pair.toString().padStart(2, "0")}_${position}_${host}`,
    scenario,
    replicate: pair,
    repetitions: 2,
    warmupRepetitions: 0,
    journalEntries: 2,
    payloadBytes: 64,
    sessionMode: "reuse-session",
  });
}

export const PROBE_SESSION_POSTGRES_AB_MATRIX_V1: ProbeCampaignManifestV1 =
  ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make("p32_session_postgres_ab_v4"),
    collectorConcurrency: 1,
    runs: Array.from({ length: 8 }, (_, index) => index + 1).flatMap(
      pair => pair % 2 === 1
        ? [
            sessionPostgresComparisonRun(
              pair,
              "facet_finalizer_postgres_warm_invoke",
              "a",
            ),
            sessionPostgresComparisonRun(
              pair,
              "session_postgres_warm_invoke",
              "b",
            ),
          ]
        : [
            sessionPostgresComparisonRun(
              pair,
              "session_postgres_warm_invoke",
              "a",
            ),
            sessionPostgresComparisonRun(
              pair,
              "facet_finalizer_postgres_warm_invoke",
              "b",
            ),
          ],
    ),
  });

export const PROBE_ACTIVE_CAMPAIGN_MATRIX_V1 =
  PROBE_POSTGRES_COMPARISON_MATRIX_V1;
