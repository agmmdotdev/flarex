import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect, Schema } from "effect";

import { strictSchemaValueOrNullDecoder } from "./effectBoundary";
import {
  ProbeCampaignIdSchema,
  ProbeOrdinalSchema,
} from "./identity";
import {
  canonicalProbeRunRequestV1,
  probeRunBudgetPlanV1,
} from "./runProtocol";
import {
  boundedProbeIntegerSchema,
  PROBE_LIMITS_V1,
  ProbeProtocolVersionV1Schema,
  ProbeRunRequestV1Schema,
  probeSampleIdentityV1,
  probeWorkerLoaderIdentityV1,
  type ProbeRunRequestV1,
} from "./protocol";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strictSchemaOptions";

export const PROBE_CAMPAIGN_LIMITS_V1 = {
  runCells: 32,
  sampleExecutions: 2_048,
  payloadBytes: 16_777_216,
  journalEntries: 131_072,
  uniqueCodeIds: 128,
  collectorConcurrency: 8,
  purgeTasksPerStep: 16,
} as const;

const RunCountSchema = boundedProbeIntegerSchema(
  0,
  PROBE_CAMPAIGN_LIMITS_V1.runCells,
  "campaign run count",
);
const SampleExecutionCountSchema = boundedProbeIntegerSchema(
  0,
  PROBE_CAMPAIGN_LIMITS_V1.sampleExecutions,
  "campaign sample execution count",
);
const PayloadBudgetSchema = boundedProbeIntegerSchema(
  0,
  PROBE_CAMPAIGN_LIMITS_V1.payloadBytes,
  "campaign payload byte budget",
);
const JournalBudgetSchema = boundedProbeIntegerSchema(
  0,
  PROBE_CAMPAIGN_LIMITS_V1.journalEntries,
  "campaign journal entry budget",
);
const CodeBudgetSchema = boundedProbeIntegerSchema(
  0,
  PROBE_CAMPAIGN_LIMITS_V1.uniqueCodeIds,
  "campaign unique code ID budget",
);
const CollectorConcurrencySchema = boundedProbeIntegerSchema(
  1,
  PROBE_CAMPAIGN_LIMITS_V1.collectorConcurrency,
  "collector concurrency",
);
const PurgeStepSizeSchema = boundedProbeIntegerSchema(
  1,
  PROBE_CAMPAIGN_LIMITS_V1.purgeTasksPerStep,
  "purge step size",
);

export const ProbeCampaignBudgetValuesV1Schema = Schema.Struct({
  runCells: RunCountSchema,
  sampleExecutions: SampleExecutionCountSchema,
  payloadBytes: PayloadBudgetSchema,
  journalEntries: JournalBudgetSchema,
  uniqueCodeIds: CodeBudgetSchema,
}).annotate(StrictStructOptions);
export type ProbeCampaignBudgetValuesV1 =
  typeof ProbeCampaignBudgetValuesV1Schema.Type;

export const ProbeCampaignBudgetsV1Schema = Schema.Struct({
  limits: ProbeCampaignBudgetValuesV1Schema,
  planned: ProbeCampaignBudgetValuesV1Schema,
}).annotate(StrictStructOptions);
export type ProbeCampaignBudgetsV1 =
  typeof ProbeCampaignBudgetsV1Schema.Type;

const ProbeCampaignManifestV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  campaignId: ProbeCampaignIdSchema,
  collectorConcurrency: CollectorConcurrencySchema,
  runs: Schema.Array(ProbeRunRequestV1Schema),
}).annotate(StrictStructOptions);

export const ProbeCampaignManifestV1Schema = ProbeCampaignManifestV1Shape.check(
  Schema.makeFilter(manifest => campaignManifestIssueV1(manifest)),
);
export type ProbeCampaignManifestV1 =
  typeof ProbeCampaignManifestV1Schema.Type;

export const ProbeCampaignStateV1Schema = Schema.Literals([
  "registering",
  "running",
  "sealing",
  "reconciling",
  "reconciled",
  "evidence-sealed",
  "purging",
  "purged",
]);
export type ProbeCampaignStateV1 = typeof ProbeCampaignStateV1Schema.Type;

const CampaignTaskCountSchema = boundedProbeIntegerSchema(
  0,
  PROBE_CAMPAIGN_LIMITS_V1.sampleExecutions * 3,
  "campaign task count",
);
const Sha256HexSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

export const ProbeCampaignProgressV1Schema = Schema.Struct({
  totalRegistrationTasks: RunCountSchema,
  completedRegistrationTasks: RunCountSchema,
  totalReconciliationTasks: RunCountSchema,
  completedReconciliationTasks: RunCountSchema,
  totalPurgeTasks: CampaignTaskCountSchema,
  completedPurgeTasks: CampaignTaskCountSchema,
}).annotate(StrictStructOptions);
export type ProbeCampaignProgressV1 =
  typeof ProbeCampaignProgressV1Schema.Type;

export const ProbeCampaignEvidenceSealV1Schema = Schema.Struct({
  recordCount: SampleExecutionCountSchema,
  sha256: Sha256HexSchema,
}).annotate(StrictStructOptions);
export type ProbeCampaignEvidenceSealV1 =
  typeof ProbeCampaignEvidenceSealV1Schema.Type;

const ProbeCampaignStatusV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  manifest: ProbeCampaignManifestV1Schema,
  manifestSha256: Sha256HexSchema,
  state: ProbeCampaignStateV1Schema,
  budgets: ProbeCampaignBudgetsV1Schema,
  progress: ProbeCampaignProgressV1Schema,
  evidence: Schema.Union([ProbeCampaignEvidenceSealV1Schema, Schema.Null]),
}).annotate(StrictStructOptions);

export const ProbeCampaignStatusV1Schema = ProbeCampaignStatusV1Shape.check(
  Schema.makeFilter(status => campaignStatusIssueV1(status)),
);
export type ProbeCampaignStatusV1 = typeof ProbeCampaignStatusV1Schema.Type;

export const ProbeCampaignErrorCodeV1Schema = Schema.Literals([
  "invalid-request",
  "identity-mismatch",
  "manifest-conflict",
  "campaign-not-registered",
  "campaign-not-running",
  "campaign-not-reconciled",
  "evidence-not-sealed",
  "registration-incomplete",
  "reconciliation-incomplete",
  "purge-incomplete",
  "target-rejected",
]);
export type ProbeCampaignErrorCodeV1 =
  typeof ProbeCampaignErrorCodeV1Schema.Type;

export const ProbeCampaignErrorV1Schema = Schema.Struct({
  code: ProbeCampaignErrorCodeV1Schema,
  retryable: Schema.Boolean,
}).annotate(StrictStructOptions);
export type ProbeCampaignErrorV1 = typeof ProbeCampaignErrorV1Schema.Type;

const CampaignRejectedReceiptSchema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  kind: Schema.Literal("rejected"),
  error: ProbeCampaignErrorV1Schema,
}).annotate(StrictStructOptions);

export const ProbeCampaignRegistrationReceiptV1Schema = Schema.Union([
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("registered"),
    created: Schema.Boolean,
    status: ProbeCampaignStatusV1Schema,
  }).annotate(StrictStructOptions),
  CampaignRejectedReceiptSchema,
]);
export type ProbeCampaignRegistrationReceiptV1 =
  typeof ProbeCampaignRegistrationReceiptV1Schema.Type;

export const ProbeCampaignControlRequestV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  campaignId: ProbeCampaignIdSchema,
}).annotate(StrictStructOptions);
export type ProbeCampaignControlRequestV1 =
  typeof ProbeCampaignControlRequestV1Schema.Type;

export const ProbeCampaignPurgeRequestV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  campaignId: ProbeCampaignIdSchema,
  maxTasks: PurgeStepSizeSchema,
}).annotate(StrictStructOptions);
export type ProbeCampaignPurgeRequestV1 =
  typeof ProbeCampaignPurgeRequestV1Schema.Type;

export const ProbeCampaignControlReceiptV1Schema = Schema.Union([
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("accepted"),
    status: ProbeCampaignStatusV1Schema,
  }).annotate(StrictStructOptions),
  CampaignRejectedReceiptSchema,
]);
export type ProbeCampaignControlReceiptV1 =
  typeof ProbeCampaignControlReceiptV1Schema.Type;

export const ProbeCampaignStatusReceiptV1Schema = Schema.Union([
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("found"),
    status: ProbeCampaignStatusV1Schema,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("not-found"),
  }).annotate(StrictStructOptions),
]);
export type ProbeCampaignStatusReceiptV1 =
  typeof ProbeCampaignStatusReceiptV1Schema.Type;

export class ProbeCampaignProtocolValidationError extends Data.TaggedError(
  "ProbeCampaignProtocolValidationError",
)<{
  readonly boundary: "campaign-manifest-v1" | "campaign-control-v1";
  readonly cause: unknown;
}> {}

const decodeUnknownManifest = Schema.decodeUnknownEffect(
  ProbeCampaignManifestV1Schema,
  StrictParseOptions,
);
const decodeUnknownControl = Schema.decodeUnknownEffect(
  ProbeCampaignControlRequestV1Schema,
  StrictParseOptions,
);

export const decodeProbeCampaignManifestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeCampaignManifestV1",
)((value: unknown) =>
  decodeUnknownManifest(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeCampaignProtocolValidationError({
          boundary: "campaign-manifest-v1",
          cause,
        }),
    ),
  ));

export const decodeProbeCampaignControlRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeCampaignControlRequestV1",
)((value: unknown) =>
  decodeUnknownControl(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeCampaignProtocolValidationError({
          boundary: "campaign-control-v1",
          cause,
        }),
    ),
  ));

export const decodeProbeCampaignManifestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeCampaignManifestV1Schema);
export const decodeProbeCampaignControlRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeCampaignControlRequestV1Schema);
export const decodeProbeCampaignPurgeRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeCampaignPurgeRequestV1Schema);
export const decodeProbeCampaignRegistrationReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeCampaignRegistrationReceiptV1Schema);
export const decodeProbeCampaignControlReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeCampaignControlReceiptV1Schema);
export const decodeProbeCampaignStatusReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeCampaignStatusReceiptV1Schema);

export function probeCampaignBudgetPlanV1(
  manifest: ProbeCampaignManifestV1,
): ProbeCampaignBudgetValuesV1 {
  let sampleExecutions = 0;
  let payloadBytes = 0;
  let journalEntries = 0;
  const codeIds = new Set<string>();
  for (const run of manifest.runs) {
    const plan = probeRunBudgetPlanV1(run);
    sampleExecutions += plan.sampleClaims;
    payloadBytes += plan.payloadBytes;
    journalEntries += plan.journalEntries;
    for (let ordinal = 0; ordinal < plan.sampleClaims; ordinal += 1) {
      const identity = probeSampleIdentityV1(
        run.runId,
        run.scenario,
        run.dimensions,
        ProbeOrdinalSchema.make(ordinal),
      );
      const codeIdentity = probeWorkerLoaderIdentityV1(
        run.scenario,
        identity,
      );
      if (codeIdentity !== null) codeIds.add(codeIdentity);
    }
  }
  return ProbeCampaignBudgetValuesV1Schema.make({
    runCells: manifest.runs.length,
    sampleExecutions,
    payloadBytes,
    journalEntries,
    uniqueCodeIds: codeIds.size,
  });
}

function campaignStatusIssueV1(
  status: typeof ProbeCampaignStatusV1Shape.Type,
): string | undefined {
  const planned = probeCampaignBudgetPlanV1(status.manifest);
  if (!sameCampaignBudgetValues(status.budgets.limits, PROBE_CAMPAIGN_BUDGET_LIMIT_VALUES_V1)) {
    return "campaign budget limits must match the protocol limits";
  }
  if (!sameCampaignBudgetValues(status.budgets.planned, planned)) {
    return "planned campaign budgets must match the immutable manifest";
  }
  const runCount = status.manifest.runs.length;
  if (
    status.progress.totalRegistrationTasks !== runCount ||
    status.progress.totalReconciliationTasks !== runCount
  ) {
    return "campaign registration and reconciliation totals must match the manifest";
  }
  if (
    status.progress.completedRegistrationTasks > runCount ||
    status.progress.completedReconciliationTasks > runCount ||
    status.progress.completedPurgeTasks > status.progress.totalPurgeTasks
  ) {
    return "campaign completed task counts cannot exceed their totals";
  }
  if (
    status.progress.totalPurgeTasks !==
      campaignPurgeTaskCountV1(status.manifest)
  ) {
    return "campaign purge task total must match the immutable manifest";
  }
  if (
    status.state !== "registering" &&
    status.progress.completedRegistrationTasks !== runCount
  ) {
    return "a registered campaign state requires every run registration";
  }
  const beforeReconciliation = status.state === "registering" ||
    status.state === "running" || status.state === "sealing";
  if (
    beforeReconciliation &&
    status.progress.completedReconciliationTasks !== 0
  ) {
    return "pre-reconciliation states cannot report reconciled runs";
  }
  const afterReconciliation = status.state === "reconciled" ||
    status.state === "evidence-sealed" || status.state === "purging" ||
    status.state === "purged";
  if (
    afterReconciliation &&
    status.progress.completedReconciliationTasks !== runCount
  ) {
    return "post-reconciliation states require every reconciled run";
  }
  const evidenceRequired = status.state === "evidence-sealed" ||
    status.state === "purging" || status.state === "purged";
  if (evidenceRequired !== (status.evidence !== null)) {
    return "campaign evidence presence must match its lifecycle state";
  }
  if (
    status.evidence !== null &&
    status.evidence.recordCount !== planned.sampleExecutions
  ) {
    return "campaign evidence count must match the immutable sample plan";
  }
  if (
    status.state !== "purging" &&
    status.state !== "purged" &&
    status.progress.completedPurgeTasks !== 0
  ) {
    return "pre-purge campaign states cannot report completed purge tasks";
  }
  if (
    status.state === "purged" &&
    status.progress.completedPurgeTasks !== status.progress.totalPurgeTasks
  ) {
    return "a purged campaign requires every purge task to be complete";
  }
  return undefined;
}

function campaignPurgeTaskCountV1(
  manifest: ProbeCampaignManifestV1,
): number {
  const sessions = new Set<string>();
  const syncScopes = new Set<string>();
  for (const run of manifest.runs) {
    const total = run.warmupRepetitions + run.repetitions;
    for (let value = 0; value < total; value += 1) {
      const identity = probeSampleIdentityV1(
        run.runId,
        run.scenario,
        run.dimensions,
        ProbeOrdinalSchema.make(value),
      );
      if (identity.sessionId !== null) sessions.add(identity.sessionId);
      if (
        run.scenario === "commit_wake" ||
        run.scenario === "full_invoke" ||
        run.scenario === "executor_worker_invoke" ||
        run.scenario === "session_executor_invoke" ||
        run.scenario === "sync_rerun"
      ) {
        syncScopes.add(identity.scopeId);
      }
    }
  }
  return sessions.size + syncScopes.size + manifest.runs.length;
}

function sameCampaignBudgetValues(
  left: ProbeCampaignBudgetValuesV1,
  right: ProbeCampaignBudgetValuesV1,
): boolean {
  return left.runCells === right.runCells &&
    left.sampleExecutions === right.sampleExecutions &&
    left.payloadBytes === right.payloadBytes &&
    left.journalEntries === right.journalEntries &&
    left.uniqueCodeIds === right.uniqueCodeIds;
}

export function canonicalProbeCampaignManifestV1(
  manifest: ProbeCampaignManifestV1,
): string {
  return JSON.stringify({
    protocolVersion: manifest.protocolVersion,
    campaignId: manifest.campaignId,
    collectorConcurrency: manifest.collectorConcurrency,
    runs: manifest.runs.map(run => JSON.parse(canonicalProbeRunRequestV1(run))),
  });
}

function campaignManifestIssueV1(
  manifest: typeof ProbeCampaignManifestV1Shape.Type,
): string | undefined {
  if (
    manifest.runs.length === 0 ||
    manifest.runs.length > PROBE_CAMPAIGN_LIMITS_V1.runCells
  ) {
    return `campaign runs must contain 1 through ${PROBE_CAMPAIGN_LIMITS_V1.runCells} cells`;
  }
  const runIds = new Set<string>();
  const cells = new Set<string>();
  let previousRunId: string | undefined;
  for (const run of manifest.runs) {
    if (runIds.has(run.runId)) return "campaign run IDs must be unique";
    runIds.add(run.runId);
    const cell = canonicalCampaignCell(run);
    if (cells.has(cell)) {
      return "campaign scenario/dimension cells must be unique";
    }
    cells.add(cell);
    if (
      previousRunId !== undefined &&
      compareUtf16Strings(previousRunId, run.runId) >= 0
    ) {
      return "campaign runs must use ascending run ID order";
    }
    previousRunId = run.runId;
  }
  const budget = uncheckedCampaignBudgetPlan(manifest.runs);
  if (manifest.collectorConcurrency > budget.sampleExecutions) {
    return "collector concurrency cannot exceed planned sample executions";
  }
  if (budget.sampleExecutions > PROBE_CAMPAIGN_LIMITS_V1.sampleExecutions) {
    return "campaign sample execution budget exceeded";
  }
  if (budget.payloadBytes > PROBE_CAMPAIGN_LIMITS_V1.payloadBytes) {
    return "campaign payload byte budget exceeded";
  }
  if (budget.journalEntries > PROBE_CAMPAIGN_LIMITS_V1.journalEntries) {
    return "campaign journal entry budget exceeded";
  }
  return budget.uniqueCodeIds > PROBE_CAMPAIGN_LIMITS_V1.uniqueCodeIds
    ? "campaign unique code ID budget exceeded"
    : undefined;
}

function uncheckedCampaignBudgetPlan(
  runs: readonly ProbeRunRequestV1[],
): {
  readonly runCells: number;
  readonly sampleExecutions: number;
  readonly payloadBytes: number;
  readonly journalEntries: number;
  readonly uniqueCodeIds: number;
} {
  let sampleExecutions = 0;
  let payloadBytes = 0;
  let journalEntries = 0;
  const codeIds = new Set<string>();
  for (const run of runs) {
    const plan = probeRunBudgetPlanV1(run);
    sampleExecutions += plan.sampleClaims;
    payloadBytes += plan.payloadBytes;
    journalEntries += plan.journalEntries;
    for (let ordinal = 0; ordinal < plan.sampleClaims; ordinal += 1) {
      const identity = probeSampleIdentityV1(
        run.runId,
        run.scenario,
        run.dimensions,
        ProbeOrdinalSchema.make(ordinal),
      );
      const codeIdentity = probeWorkerLoaderIdentityV1(
        run.scenario,
        identity,
      );
      if (codeIdentity !== null) codeIds.add(codeIdentity);
    }
  }
  return {
    runCells: runs.length,
    sampleExecutions,
    payloadBytes,
    journalEntries,
    uniqueCodeIds: codeIds.size,
  };
}

function canonicalCampaignCell(run: ProbeRunRequestV1): string {
  return JSON.stringify([
    run.scenario,
    run.replicate ?? null,
    run.repetitions,
    run.warmupRepetitions,
    run.dimensions.codeMode,
    run.dimensions.concurrency,
    run.dimensions.journalEntries,
    run.dimensions.payloadBytes,
    run.dimensions.sessionMode,
  ]);
}

export const PROBE_CAMPAIGN_BUDGET_LIMIT_VALUES_V1 =
  ProbeCampaignBudgetValuesV1Schema.make({
    runCells: PROBE_CAMPAIGN_LIMITS_V1.runCells,
    sampleExecutions: PROBE_CAMPAIGN_LIMITS_V1.sampleExecutions,
    payloadBytes: PROBE_CAMPAIGN_LIMITS_V1.payloadBytes,
    journalEntries: PROBE_CAMPAIGN_LIMITS_V1.journalEntries,
    uniqueCodeIds: PROBE_CAMPAIGN_LIMITS_V1.uniqueCodeIds,
  });

export const PROBE_MAX_RUN_SAMPLES =
  PROBE_LIMITS_V1.maxRepetitions + PROBE_LIMITS_V1.maxWarmupRepetitions;
