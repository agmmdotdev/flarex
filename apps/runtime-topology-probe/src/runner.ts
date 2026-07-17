import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Schema } from "effect";

import {
  canonicalProbeCampaignManifestV1,
  decodeProbeCampaignControlReceiptV1OrNull,
  decodeProbeCampaignRegistrationReceiptV1OrNull,
  decodeProbeCampaignStatusReceiptV1OrNull,
  PROBE_CAMPAIGN_LIMITS_V1,
  sha256Hex,
  type ProbeCampaignManifestV1,
  type ProbeCampaignStatusV1,
} from "./campaignProtocol";
import {
  buildProbeRawEvidenceArtifactV1,
  buildProbeSummaryArtifactV1,
  probeEvidencePersistenceReceiptMatchesV1,
  type ProbeEvidencePersistenceReceiptV1,
  type ProbeEvidenceTargetV1,
  type ProbeRawEvidenceArtifactV1,
  type ProbeSummaryArtifactV1,
} from "./evidenceProtocol";
import { strictSchemaValueOrNullDecoder } from "./effectBoundary";
import {
  ProbeCampaignIdSchema,
  ProbeOrdinalSchema,
  type ProbeCampaignId,
  type ProbeOrdinal,
} from "./identity";
import {
  PROBE_CAMPAIGN_PURGE_ROUTE,
  PROBE_CAMPAIGN_RECONCILE_ROUTE,
  PROBE_CAMPAIGN_ROUTE,
  PROBE_CAMPAIGN_SEAL_EVIDENCE_ROUTE,
  PROBE_CAMPAIGN_STATUS_ROUTE,
  PROBE_EVIDENCE_PAGE_ROUTE,
  PROBE_EXTERNAL_COMPLETION_ROUTE,
  PROBE_RUN_ROUTE,
  PROBE_SAMPLE_ROUTE,
} from "./gateway";
import {
  PROBE_PROTOCOL_VERSION_V1,
  ProbeDurationMsSchema,
  type ProbeRunRequestV1,
} from "./protocol";
import {
  decodeProbeExternalCompletionReceiptV1OrNull,
  decodeProbeRunEvidencePageReceiptV1OrNull,
  decodeProbeSampleClaimReceiptV1OrNull,
  decodeProbeRunStatusReceiptV1OrNull,
  ProbeExternalCompletionRequestV1Schema,
  ProbeRunEvidencePageRequestV1Schema,
  probeExternalCompletionReceiptMatchesRequestV1,
  probeRunEvidencePageReceiptMatchesRequestV1,
  type ProbeExternalCompletionRequestV1,
  type ProbeRunEvidenceRecordV1,
  type ProbeRunStatusV1,
} from "./runProtocol";
import { decodeProbeControlledGatewaySampleV1OrNull } from "./runtimeProtocol";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;

export const PROBE_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const PROBE_MAX_REQUEST_TIMEOUT_MS = 300_000;
export const PROBE_MAX_RUNNER_RESPONSE_BYTES = 4 * 1_024 * 1_024;

const ProbeRunnerCheckpointV1Shape = Schema.Struct({
  version: Schema.Literal(1),
  campaignId: ProbeCampaignIdSchema,
  externalCompletions: Schema.Array(ProbeExternalCompletionRequestV1Schema),
}).annotate(StrictStructOptions);
export const ProbeRunnerCheckpointV1Schema = ProbeRunnerCheckpointV1Shape.check(
  Schema.makeFilter(checkpoint => {
    if (
      checkpoint.externalCompletions.length >
        PROBE_CAMPAIGN_LIMITS_V1.sampleExecutions
    ) {
      return "checkpoint external completions exceed the campaign sample limit";
    }
    for (let index = 1; index < checkpoint.externalCompletions.length; index += 1) {
      const previous = checkpoint.externalCompletions[index - 1];
      const current = checkpoint.externalCompletions[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        compareExternalCompletions(previous, current) >= 0
      ) {
        return "checkpoint external completions must be unique and sorted";
      }
    }
    return undefined;
  }),
);
export type ProbeRunnerCheckpointV1 =
  typeof ProbeRunnerCheckpointV1Schema.Type;
const decodeProbeRunnerCheckpointV1OrNull = strictSchemaValueOrNullDecoder(
  ProbeRunnerCheckpointV1Schema,
);

export interface ProbeRunnerCheckpointStore {
  load(campaignId: ProbeCampaignId): Promise<ProbeRunnerCheckpointV1>;
  record(
    campaignId: ProbeCampaignId,
    completion: ProbeExternalCompletionRequestV1,
  ): Promise<void>;
}

export interface ProbeRunnerTransport {
  readonly origin: string;
  readonly authorization: string;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly now: () => number;
}

export interface ProbeRunnerOptionsV1 {
  readonly manifest: ProbeCampaignManifestV1;
  readonly target: ProbeEvidenceTargetV1;
  readonly transport: ProbeRunnerTransport;
  readonly checkpoint: ProbeRunnerCheckpointStore;
  readonly purgeBatchSize?: number;
  readonly maxPurgeControlSteps?: number;
  readonly requestTimeoutMs?: number;
  readonly persistEvidence: (
    raw: ProbeRawEvidenceArtifactV1,
    summary: ProbeSummaryArtifactV1,
  ) => Promise<ProbeEvidencePersistenceReceiptV1>;
}

export interface ProbeRunnerResultV1 {
  readonly raw: ProbeRawEvidenceArtifactV1;
  readonly summary: ProbeSummaryArtifactV1;
  readonly purgedCampaign: ProbeCampaignStatusV1;
}

export interface ProbeSmokeRunnerOptionsV1 {
  readonly manifest: ProbeCampaignManifestV1;
  readonly transport: ProbeRunnerTransport;
  readonly checkpoint: ProbeRunnerCheckpointStore;
  readonly requestTimeoutMs?: number;
}

export interface ProbeSmokeSampleV1 {
  readonly scenario: ProbeRunRequestV1["scenario"];
  readonly runId: ProbeRunRequestV1["runId"];
  readonly sampleOrdinal: ProbeOrdinal;
  readonly state: "completed" | "failed";
}

export interface ProbeSmokeRunnerResultV1 {
  readonly campaign: ProbeCampaignStatusV1;
  readonly samples: readonly ProbeSmokeSampleV1[];
}

export interface ProbeReconcileRunnerOptionsV1 {
  readonly manifest: ProbeCampaignManifestV1;
  readonly transport: ProbeRunnerTransport;
  readonly checkpoint: ProbeRunnerCheckpointStore;
  readonly requestTimeoutMs?: number;
}

export type ProbeAbortReadyCampaignStatusV1 = Omit<
  ProbeCampaignStatusV1,
  "state"
> & { readonly state: "evidence-sealed" | "reconciled" };

export interface ProbePurgeEvidenceSealV1 {
  readonly manifestSha256: ProbeCampaignStatusV1["manifestSha256"];
  readonly evidence: NonNullable<ProbeCampaignStatusV1["evidence"]>;
}

export interface ProbePurgeResumeOptionsV1 {
  readonly campaignId: ProbeCampaignId;
  readonly expectedSeal: ProbePurgeEvidenceSealV1;
  readonly transport: ProbeRunnerTransport;
  readonly purgeBatchSize?: number;
  readonly maxPurgeControlSteps?: number;
  readonly requestTimeoutMs?: number;
}

export class ProbeRunnerError extends Data.TaggedError("ProbeRunnerError")<{
  readonly stage:
    | "campaign-registration"
    | "campaign-status"
    | "checkpoint"
    | "external-completion"
    | "evidence"
    | "manifest"
    | "purge"
    | "reconciliation"
    | "run-status"
    | "sample";
  readonly retryable: boolean;
  readonly cause: unknown;
}> {}

export async function resumeProbeCampaignPurgeV1(
  options: ProbePurgeResumeOptionsV1,
): Promise<ProbeCampaignStatusV1> {
  const client = new ProbeRunnerClient(
    options.transport,
    options.requestTimeoutMs,
  );
  const status = await client.readCampaignStatus(options.campaignId);
  if (!campaignMatchesExpectedEvidenceSeal(status, options.expectedSeal)) {
    throw new ProbeRunnerError({
      stage: "purge",
      retryable: false,
      cause: "live campaign does not match the persisted evidence seal",
    });
  }
  if (status.state === "purged") return status;
  if (status.state !== "evidence-sealed" && status.state !== "purging") {
    throw new ProbeRunnerError({
      stage: "purge",
      retryable: false,
      cause: `campaign purge cannot resume from state ${status.state}`,
    });
  }
  return await purgeCampaign(
    client,
    options.campaignId,
    options.purgeBatchSize ?? 4,
    options.maxPurgeControlSteps ?? 4_096,
  );
}

export async function runProbeCampaignSmokeV1(
  options: ProbeSmokeRunnerOptionsV1,
): Promise<ProbeSmokeRunnerResultV1> {
  const client = new ProbeRunnerClient(
    options.transport,
    options.requestTimeoutMs,
  );
  let campaign = await client.registerCampaign(options.manifest);
  if (campaign.state !== "running") {
    throw new ProbeRunnerError({
      stage: "campaign-registration",
      retryable: false,
      cause: `smoke requires a running campaign, received ${campaign.state}`,
    });
  }
  const checkpoint = await loadCheckpoint(options.checkpoint, options.manifest);
  for (const completion of checkpoint.externalCompletions) {
    await client.completeExternal(completion);
  }
  const statuses = await readRunStatuses(client, options.manifest);
  const selectedRuns: ProbeRunRequestV1[] = [];
  const seenScenarios = new Set<ProbeRunRequestV1["scenario"]>();
  for (const run of options.manifest.runs) {
    if (seenScenarios.has(run.scenario)) continue;
    seenScenarios.add(run.scenario);
    selectedRuns.push(run);
  }
  for (const run of selectedRuns) {
    const status = statuses.get(run.runId);
    if (status === undefined) {
      throw new ProbeRunnerError({
        stage: "run-status",
        retryable: true,
        cause: `smoke run status is missing for ${run.runId}`,
      });
    }
    const sampleOrdinal = ProbeOrdinalSchema.make(0);
    const existing = status.samples.find(
      sample => sample.sampleOrdinal === sampleOrdinal,
    );
    if (existing?.state === "claimed") {
      throw new ProbeRunnerError({
        stage: "sample",
        retryable: true,
        cause: `smoke sample remains claimed for ${run.runId}`,
      });
    }
    if (
      existing !== undefined &&
      !checkpointHasCompletion(checkpoint, run.runId, sampleOrdinal)
    ) {
      throw new ProbeRunnerError({
        stage: "checkpoint",
        retryable: false,
        cause: `smoke sample lacks its durable external completion for ${run.runId}`,
      });
    }
    if (existing === undefined) {
      if (status.counters.outstanding >= run.dimensions.concurrency) {
        throw new ProbeRunnerError({
          stage: "sample",
          retryable: true,
          cause: `smoke run has no free claim capacity for ${run.runId}`,
        });
      }
      await executeOneSample(options, client, run, Number(sampleOrdinal));
    }
  }
  const refreshed = await readRunStatuses(client, options.manifest);
  const samples = selectedRuns.map(run => {
    const sampleOrdinal = ProbeOrdinalSchema.make(0);
    const sample = refreshed.get(run.runId)?.samples.find(
      candidate => candidate.sampleOrdinal === sampleOrdinal,
    );
    if (
      sample === undefined ||
      (sample.state !== "completed" && sample.state !== "failed")
    ) {
      throw new ProbeRunnerError({
        stage: "run-status",
        retryable: true,
        cause: `smoke sample is not terminal for ${run.runId}`,
      });
    }
    return {
      scenario: run.scenario,
      runId: run.runId,
      sampleOrdinal,
      state: sample.state,
    } satisfies ProbeSmokeSampleV1;
  });
  campaign = await client.readCampaignStatus(
    options.manifest.campaignId,
    options.manifest,
  );
  if (campaign.state !== "running") {
    throw new ProbeRunnerError({
      stage: "campaign-status",
      retryable: false,
      cause: `smoke changed campaign state to ${campaign.state}`,
    });
  }
  return { campaign, samples };
}

export async function reconcileProbeCampaignForAbortV1(
  options: ProbeReconcileRunnerOptionsV1,
): Promise<ProbeAbortReadyCampaignStatusV1> {
  const client = new ProbeRunnerClient(
    options.transport,
    options.requestTimeoutMs,
  );
  const campaign = await client.readCampaignStatus(
    options.manifest.campaignId,
    options.manifest,
  );
  if (campaign.state === "evidence-sealed") {
    return abortReadyCampaignStatus(campaign);
  }
  if (
    campaign.state !== "registering" &&
    campaign.state !== "running" &&
    campaign.state !== "sealing" &&
    campaign.state !== "reconciling" &&
    campaign.state !== "reconciled"
  ) {
    throw new ProbeRunnerError({
      stage: "reconciliation",
      retryable: false,
      cause: `abort reconciliation cannot start from ${campaign.state}`,
    });
  }
  const checkpoint = await loadCheckpoint(options.checkpoint, options.manifest);
  for (const completion of checkpoint.externalCompletions) {
    await client.completeExternal(completion);
  }
  const reconciled = campaign.state === "reconciled"
    ? campaign
    : await client.controlCampaign(
      PROBE_CAMPAIGN_RECONCILE_ROUTE,
      options.manifest.campaignId,
      "reconciliation",
    );
  return abortReadyCampaignStatus(reconciled);
}

function abortReadyCampaignStatus(
  campaign: ProbeCampaignStatusV1,
): ProbeAbortReadyCampaignStatusV1 {
  if (
    campaign.state === "reconciled" ||
    campaign.state === "evidence-sealed"
  ) {
    return { ...campaign, state: campaign.state };
  }
  throw new ProbeRunnerError({
    stage: "reconciliation",
    retryable: false,
    cause: `abort reconciliation did not reach a terminal pre-evidence state: ${campaign.state}`,
  });
}

export function createInMemoryProbeCheckpointStore(): ProbeRunnerCheckpointStore {
  const checkpoints = new Map<string, ProbeRunnerCheckpointV1>();
  let tail: Promise<void> = Promise.resolve();
  return {
    async load(campaignId) {
      await tail;
      return checkpoints.get(campaignId) ?? {
        version: 1,
        campaignId,
        externalCompletions: [],
      };
    },
    record(campaignId, completion) {
      const update = tail.then(() => {
        const current = checkpoints.get(campaignId) ?? {
          version: 1 as const,
          campaignId,
          externalCompletions: [],
        };
        const next = mergeProbeRunnerCheckpointCompletionV1(current, completion);
        checkpoints.set(campaignId, next);
      });
      tail = update.catch(() => undefined);
      return update;
    },
  };
}

export async function runProbeCampaignV1(
  options: ProbeRunnerOptionsV1,
): Promise<ProbeRunnerResultV1> {
  const client = new ProbeRunnerClient(
    options.transport,
    options.requestTimeoutMs,
  );
  let campaign = await client.registerCampaign(options.manifest);
  if (campaign.state === "running") {
    const checkpoint = await loadCheckpoint(options.checkpoint, options.manifest);
    for (const completion of checkpoint.externalCompletions) {
      await client.completeExternal(completion);
    }
    const statuses = await readRunStatuses(client, options.manifest);
    const global = new ProbeSemaphore(options.manifest.collectorConcurrency);
    await executePhase(
      "warmup",
      options,
      client,
      statuses,
      global,
    );
    const refreshed = await readRunStatuses(client, options.manifest);
    await executePhase(
      "measurement",
      options,
      client,
      refreshed,
      global,
    );
  }
  if (
    campaign.state === "running" ||
    campaign.state === "sealing" ||
    campaign.state === "reconciling" ||
    campaign.state === "reconciled"
  ) {
    campaign = await client.controlCampaign(
      PROBE_CAMPAIGN_RECONCILE_ROUTE,
      options.manifest.campaignId,
      "reconciliation",
    );
  }
  if (campaign.state === "reconciled") {
    campaign = await client.controlCampaign(
      PROBE_CAMPAIGN_SEAL_EVIDENCE_ROUTE,
      options.manifest.campaignId,
      "evidence",
    );
  }
  if (campaign.state === "evidence-sealed") {
    const evidence = await client.readAllEvidence(options.manifest);
    const durableDigest = campaign.evidence?.sha256;
    const observedDigest = await sha256Hex(JSON.stringify(evidence));
    if (durableDigest === undefined || durableDigest !== observedDigest) {
      throw new ProbeRunnerError({
        stage: "evidence",
        retryable: false,
        cause: "evidence digest mismatch",
      });
    }
    const raw = buildProbeRawEvidenceArtifactV1(
      options.target,
      campaign,
      evidence,
    );
    const summary = await buildProbeSummaryArtifactV1(raw);
    let persistenceReceipt: ProbeEvidencePersistenceReceiptV1;
    try {
      persistenceReceipt = await options.persistEvidence(raw, summary);
    } catch (cause) {
      throw new ProbeRunnerError({
        stage: "evidence",
        retryable: true,
        cause,
      });
    }
    if (
      !probeEvidencePersistenceReceiptMatchesV1(
        persistenceReceipt,
        raw,
        summary,
      )
    ) {
      throw new ProbeRunnerError({
        stage: "evidence",
        retryable: false,
        cause: "evidence persistence receipt mismatch",
      });
    }
    const purgedCampaign = await purgeCampaign(
      client,
      options.manifest.campaignId,
      options.purgeBatchSize ?? 4,
      options.maxPurgeControlSteps ?? 4_096,
    );
    return { raw, summary, purgedCampaign };
  }
  throw new ProbeRunnerError({
    stage: "campaign-registration",
    retryable: false,
    cause: `campaign cannot run from state ${campaign.state}`,
  });
}

type ProbePhase = "measurement" | "warmup";

async function executePhase(
  phase: ProbePhase,
  options: ProbeRunnerOptionsV1,
  client: ProbeRunnerClient,
  statuses: ReadonlyMap<string, ProbeRunStatusV1>,
  global: ProbeSemaphore,
): Promise<void> {
  const failures: Array<{
    readonly runIndex: number;
    readonly ordinal: number;
    readonly cause: unknown;
  }> = [];
  let stopScheduling = false;
  await Promise.all(
    options.manifest.runs.map(async (run, runIndex) => {
      const status = statuses.get(run.runId);
      if (status === undefined) {
        failures.push({
          runIndex,
          ordinal: -1,
          cause: new ProbeRunnerError({
            stage: "run-status",
            retryable: true,
            cause: "run status is missing",
          }),
        });
        stopScheduling = true;
        return;
      }
      const claimed = new Set(
        status.samples.map(sample => Number(sample.sampleOrdinal)),
      );
      const start = phase === "warmup" ? 0 : run.warmupRepetitions;
      const end = phase === "warmup"
        ? run.warmupRepetitions
        : run.warmupRepetitions + run.repetitions;
      const ordinals = Array.from(
        { length: Math.max(0, end - start) },
        (_, index) => start + index,
      ).filter(ordinal => !claimed.has(ordinal));
      const availableConcurrency = Math.max(
        0,
        run.dimensions.concurrency - status.counters.outstanding,
      );
      await mapWithConcurrency(
        ordinals,
        availableConcurrency,
        async ordinal => {
          if (stopScheduling) return;
          const release = await global.acquire();
          try {
            if (stopScheduling) return;
            await executeOneSample(options, client, run, ordinal);
          } catch (cause) {
            failures.push({ runIndex, ordinal, cause });
            stopScheduling = true;
          } finally {
            release();
          }
        },
      );
    }),
  );
  const first = failures.sort((left, right) =>
    left.runIndex - right.runIndex || left.ordinal - right.ordinal
  )[0];
  if (first !== undefined) throw first.cause;
}

function campaignMatchesExpectedEvidenceSeal(
  status: ProbeCampaignStatusV1,
  expected: ProbePurgeEvidenceSealV1,
): boolean {
  return status.manifestSha256 === expected.manifestSha256 &&
    status.evidence !== null &&
    status.evidence.sha256 === expected.evidence.sha256 &&
    status.evidence.recordCount === expected.evidence.recordCount;
}

type ProbeSampleExecutionOptionsV1 = Pick<
  ProbeRunnerOptionsV1,
  "checkpoint" | "manifest" | "transport"
>;

async function executeOneSample(
  options: ProbeSampleExecutionOptionsV1,
  client: ProbeRunnerClient,
  run: ProbeRunRequestV1,
  ordinalValue: number,
): Promise<void> {
  const sampleOrdinal = ProbeOrdinalSchema.make(ordinalValue);
  const startedAt = options.transport.now();
  const response = await client.post(
    PROBE_SAMPLE_ROUTE,
    {
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      runId: run.runId,
      sampleOrdinal,
    },
    "sample",
  );
  const text = await responseText(response, "sample");
  const externalDurationMs = Math.max(
    0,
    options.transport.now() - startedAt,
  );
  if (!response.ok) {
    const rejected = decodeProbeSampleClaimReceiptV1OrNull(
      parseJsonOrNull(text),
    );
    throw new ProbeRunnerError({
      stage: "sample",
      retryable: rejected?.kind === "rejected"
        ? rejected.error.retryable
        : response.status >= 500,
      cause: rejected?.kind === "rejected"
        ? rejected.error
        : response.status,
    });
  }
  const controlled = decodeProbeControlledGatewaySampleV1OrNull(
    parseJsonOrNull(text),
  );
  if (
    controlled === null ||
    controlled.fragment.runId !== run.runId ||
    controlled.fragment.identity.sampleOrdinal !== sampleOrdinal
  ) {
    throw new ProbeRunnerError({
      stage: "sample",
      retryable: false,
      cause: "invalid controlled sample",
    });
  }
  const completion = ProbeExternalCompletionRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId: run.runId,
    sampleOrdinal,
    externalDurationMs: ProbeDurationMsSchema.make(externalDurationMs),
  });
  await recordCheckpointCompletion(
    options.checkpoint,
    options.manifest.campaignId,
    completion,
  );
  await client.completeExternal(completion);
}

function checkpointHasCompletion(
  checkpoint: ProbeRunnerCheckpointV1,
  runId: ProbeRunRequestV1["runId"],
  sampleOrdinal: ProbeOrdinal,
): boolean {
  return checkpoint.externalCompletions.some(completion =>
    completion.runId === runId &&
    completion.sampleOrdinal === sampleOrdinal
  );
}

async function loadCheckpoint(
  checkpoint: ProbeRunnerCheckpointStore,
  manifest: ProbeCampaignManifestV1,
): Promise<ProbeRunnerCheckpointV1> {
  try {
    const loaded = decodeProbeRunnerCheckpointV1OrNull(
      await checkpoint.load(manifest.campaignId),
    );
    if (loaded === null) {
      throw new ProbeRunnerError({
        stage: "checkpoint",
        retryable: false,
        cause: "checkpoint does not satisfy the strict persisted schema",
      });
    }
    if (loaded.campaignId !== manifest.campaignId) {
      throw new ProbeRunnerError({
        stage: "checkpoint",
        retryable: false,
        cause: "checkpoint belongs to another campaign",
      });
    }
    const runById = new Map(
      manifest.runs.map(run => [run.runId, run] as const),
    );
    for (const completion of loaded.externalCompletions) {
      const run = runById.get(completion.runId);
      if (
        run === undefined ||
        completion.sampleOrdinal >=
          run.warmupRepetitions + run.repetitions
      ) {
        throw new ProbeRunnerError({
          stage: "checkpoint",
          retryable: false,
          cause: "checkpoint completion is outside the immutable manifest",
        });
      }
    }
    return loaded;
  } catch (cause) {
    if (cause instanceof ProbeRunnerError) throw cause;
    throw new ProbeRunnerError({
      stage: "checkpoint",
      retryable: checkpointFailureIsRetryable(cause),
      cause,
    });
  }
}

async function recordCheckpointCompletion(
  checkpoint: ProbeRunnerCheckpointStore,
  campaignId: ProbeCampaignId,
  completion: ProbeExternalCompletionRequestV1,
): Promise<void> {
  try {
    await checkpoint.record(campaignId, completion);
  } catch (cause) {
    if (cause instanceof ProbeRunnerError) throw cause;
    throw new ProbeRunnerError({
      stage: "checkpoint",
      retryable: checkpointFailureIsRetryable(cause),
      cause,
    });
  }
}

function checkpointFailureIsRetryable(cause: unknown): boolean {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "ProbeFileError" &&
    "operation" in cause
  ) {
    return cause.operation !== "decode" && cause.operation !== "verify";
  }
  return true;
}

async function readRunStatuses(
  client: ProbeRunnerClient,
  manifest: ProbeCampaignManifestV1,
): Promise<ReadonlyMap<string, ProbeRunStatusV1>> {
  const statuses = new Map<string, ProbeRunStatusV1>();
  for (const run of manifest.runs) {
    statuses.set(run.runId, await client.readRunStatus(run.runId));
  }
  return statuses;
}

async function purgeCampaign(
  client: ProbeRunnerClient,
  campaignId: ProbeCampaignId,
  maxTasks: number,
  maxControlSteps: number,
): Promise<ProbeCampaignStatusV1> {
  if (!Number.isInteger(maxControlSteps) || maxControlSteps < 1) {
    throw new ProbeRunnerError({
      stage: "purge",
      retryable: false,
      cause: "max purge control steps must be a positive integer",
    });
  }
  let controlSteps = 1;
  let status = await client.purgeCampaign(campaignId, maxTasks);
  while (status.state !== "purged") {
    if (controlSteps >= maxControlSteps) {
      throw new ProbeRunnerError({
        stage: "purge",
        retryable: true,
        cause: {
          code: "purge-control-step-budget-exhausted",
          controlSteps,
          completedPurgeTasks: status.progress.completedPurgeTasks,
          totalPurgeTasks: status.progress.totalPurgeTasks,
        },
      });
    }
    status = await client.purgeCampaign(campaignId, maxTasks);
    controlSteps += 1;
  }
  return status;
}

class ProbeRunnerClient {
  private readonly origin: string;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly transport: ProbeRunnerTransport,
    requestTimeoutMs = PROBE_DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    this.origin = normalizedProbeOrigin(transport.origin);
    this.requestTimeoutMs = normalizedRequestTimeoutMs(requestTimeoutMs);
    if (!/^Bearer [^\s]+$/.test(transport.authorization)) {
      throw new ProbeRunnerError({
        stage: "manifest",
        retryable: false,
        cause: "invalid authorization capability",
      });
    }
  }

  async registerCampaign(
    manifest: ProbeCampaignManifestV1,
  ): Promise<ProbeCampaignStatusV1> {
    const response = await this.post(
      PROBE_CAMPAIGN_ROUTE,
      manifest,
      "campaign-registration",
    );
    const receipt = decodeProbeCampaignRegistrationReceiptV1OrNull(
      await responseJson(response, "campaign-registration"),
    );
    if (receipt === null) {
      throw new ProbeRunnerError({
        stage: "campaign-registration",
        retryable: response.status >= 500,
        cause: response.status,
      });
    }
    if (receipt.kind === "rejected") {
      throw new ProbeRunnerError({
        stage: "campaign-registration",
        retryable: receipt.error.retryable,
        cause: receipt.error,
      });
    }
    return await this.verifyCampaignStatus(
      receipt.status,
      manifest.campaignId,
      "campaign-registration",
      manifest,
    );
  }

  async readRunStatus(runId: ProbeRunRequestV1["runId"]): Promise<ProbeRunStatusV1> {
    const response = await this.fetch(
      new Request(`${this.origin}${PROBE_RUN_ROUTE}/${runId}`, {
        headers: { authorization: this.transport.authorization },
      }),
      "run-status",
    );
    const receipt = decodeProbeRunStatusReceiptV1OrNull(
      await responseJson(response, "run-status"),
    );
    if (receipt === null) {
      throw new ProbeRunnerError({
        stage: "run-status",
        retryable: response.status >= 500,
        cause: response.status,
      });
    }
    if (receipt.kind === "not-found") {
      throw new ProbeRunnerError({
        stage: "run-status",
        retryable: false,
        cause: "run-not-found",
      });
    }
    if (receipt.status.run.runId !== runId) {
      throw new ProbeRunnerError({
        stage: "run-status",
        retryable: false,
        cause: "run status does not match its request",
      });
    }
    return receipt.status;
  }

  async completeExternal(
    completion: ProbeExternalCompletionRequestV1,
  ): Promise<void> {
    const response = await this.post(
      PROBE_EXTERNAL_COMPLETION_ROUTE,
      completion,
      "external-completion",
    );
    const receipt = decodeProbeExternalCompletionReceiptV1OrNull(
      await responseJson(response, "external-completion"),
    );
    if (receipt === null) {
      throw new ProbeRunnerError({
        stage: "external-completion",
        retryable: response.status >= 500,
        cause: response.status,
      });
    }
    if (receipt.kind === "rejected") {
      throw new ProbeRunnerError({
        stage: "external-completion",
        retryable: receipt.error.retryable,
        cause: receipt.error,
      });
    }
    if (!probeExternalCompletionReceiptMatchesRequestV1(receipt, completion)) {
      throw new ProbeRunnerError({
        stage: "external-completion",
        retryable: false,
        cause: "external completion receipt does not match its request",
      });
    }
  }

  async controlCampaign(
    route: string,
    campaignId: ProbeCampaignId,
    stage: "evidence" | "reconciliation",
  ): Promise<ProbeCampaignStatusV1> {
    const response = await this.post(
      route,
      {
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        campaignId,
      },
      stage,
    );
    const receipt = decodeProbeCampaignControlReceiptV1OrNull(
      await responseJson(response, stage),
    );
    if (receipt === null) {
      throw new ProbeRunnerError({
        stage,
        retryable: response.status >= 500,
        cause: response.status,
      });
    }
    if (receipt.kind === "rejected") {
      throw new ProbeRunnerError({
        stage,
        retryable: receipt.error.retryable,
        cause: receipt.error,
      });
    }
    return await this.verifyCampaignStatus(
      receipt.status,
      campaignId,
      stage,
    );
  }

  async readCampaignStatus(
    campaignId: ProbeCampaignId,
    expectedManifest?: ProbeCampaignManifestV1,
  ): Promise<ProbeCampaignStatusV1> {
    const response = await this.post(
      PROBE_CAMPAIGN_STATUS_ROUTE,
      {
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        campaignId,
      },
      "campaign-status",
    );
    const receipt = decodeProbeCampaignStatusReceiptV1OrNull(
      await responseJson(response, "campaign-status"),
    );
    if (receipt === null) {
      throw new ProbeRunnerError({
        stage: "campaign-status",
        retryable: response.status >= 500,
        cause: response.status,
      });
    }
    if (receipt.kind === "not-found") {
      throw new ProbeRunnerError({
        stage: "campaign-status",
        retryable: false,
        cause: "campaign-not-found",
      });
    }
    return await this.verifyCampaignStatus(
      receipt.status,
      campaignId,
      "campaign-status",
      expectedManifest,
    );
  }

  async readAllEvidence(
    manifest: ProbeCampaignManifestV1,
  ): Promise<readonly ProbeRunEvidenceRecordV1[]> {
    const evidence: ProbeRunEvidenceRecordV1[] = [];
    for (const run of manifest.runs) {
      let cursor = ProbeOrdinalSchema.make(0);
      while (true) {
        const request = ProbeRunEvidencePageRequestV1Schema.make({
          protocolVersion: PROBE_PROTOCOL_VERSION_V1,
          runId: run.runId,
          cursor,
          limit: 100,
        });
        const response = await this.post(
          PROBE_EVIDENCE_PAGE_ROUTE,
          request,
          "evidence",
        );
        const receipt = decodeProbeRunEvidencePageReceiptV1OrNull(
          await responseJson(response, "evidence"),
        );
        if (receipt === null) {
          throw new ProbeRunnerError({
            stage: "evidence",
            retryable: response.status >= 500,
            cause: response.status,
          });
        }
        if (receipt.kind === "rejected") {
          throw new ProbeRunnerError({
            stage: "evidence",
            retryable: receipt.error.retryable,
            cause: receipt.error,
          });
        }
        if (!probeRunEvidencePageReceiptMatchesRequestV1(receipt, request, run)) {
          throw new ProbeRunnerError({
            stage: "evidence",
            retryable: false,
            cause: "evidence page does not match its request and immutable run",
          });
        }
        evidence.push(...receipt.records);
        if (receipt.nextCursor === null) break;
        cursor = receipt.nextCursor;
      }
    }
    return evidence;
  }

  async purgeCampaign(
    campaignId: ProbeCampaignId,
    maxTasks: number,
  ): Promise<ProbeCampaignStatusV1> {
    const response = await this.post(
      PROBE_CAMPAIGN_PURGE_ROUTE,
      {
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        campaignId,
        maxTasks,
      },
      "purge",
    );
    const receipt = decodeProbeCampaignControlReceiptV1OrNull(
      await responseJson(response, "purge"),
    );
    if (receipt === null) {
      throw new ProbeRunnerError({
        stage: "purge",
        retryable: response.status >= 500,
        cause: response.status,
      });
    }
    if (receipt.kind === "rejected") {
      throw new ProbeRunnerError({
        stage: "purge",
        retryable: receipt.error.retryable,
        cause: receipt.error,
      });
    }
    return await this.verifyCampaignStatus(
      receipt.status,
      campaignId,
      "purge",
    );
  }

  async post(
    path: string,
    body: object,
    stage: ProbeRunnerError["stage"],
  ): Promise<Response> {
    return await this.fetch(
      new Request(`${this.origin}${path}`, {
        method: "POST",
        headers: {
          authorization: this.transport.authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      stage,
    );
  }

  private async fetch(
    request: Request,
    stage: ProbeRunnerError["stage"],
  ): Promise<Response> {
    const controller = new AbortController();
    const timedRequest = new Request(request, { signal: controller.signal });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        const failure = new ProbeRunnerError({
          stage,
          retryable: true,
          cause: {
            code: "request-timeout",
            timeoutMs: this.requestTimeoutMs,
          },
        });
        reject(failure);
        controller.abort(failure);
      }, this.requestTimeoutMs);
    });
    try {
      return await Promise.race([
        this.transport.fetch(timedRequest).then(async response => {
          const body = response.body === null
            ? null
            : await readBoundedResponseBody(response, stage, controller.signal);
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }),
        timeout,
      ]);
    } catch (cause) {
      if (cause instanceof ProbeRunnerError) throw cause;
      throw new ProbeRunnerError({
        stage,
        retryable: true,
        cause,
      });
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  private async verifyCampaignStatus(
    status: ProbeCampaignStatusV1,
    campaignId: ProbeCampaignId,
    stage: ProbeRunnerError["stage"],
    expectedManifest?: ProbeCampaignManifestV1,
  ): Promise<ProbeCampaignStatusV1> {
    const canonical = canonicalProbeCampaignManifestV1(status.manifest);
    const expectedCanonical = expectedManifest === undefined
      ? canonical
      : canonicalProbeCampaignManifestV1(expectedManifest);
    if (
      status.manifest.campaignId !== campaignId ||
      canonical !== expectedCanonical ||
      status.manifestSha256 !== await sha256Hex(canonical)
    ) {
      throw new ProbeRunnerError({
        stage,
        retryable: false,
        cause: "campaign status does not match its request and canonical manifest",
      });
    }
    return status;
  }
}

async function readBoundedResponseBody(
  response: Response,
  stage: ProbeRunnerError["stage"],
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const body = response.body;
  if (body === null) return new ArrayBuffer(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const cancelForAbort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", cancelForAbort, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > PROBE_MAX_RUNNER_RESPONSE_BYTES) {
        void reader.cancel("runtime topology probe response exceeded limit")
          .catch(() => undefined);
        throw new ProbeRunnerError({
          stage,
          retryable: false,
          cause: {
            code: "response-too-large",
            maxResponseBytes: PROBE_MAX_RUNNER_RESPONSE_BYTES,
          },
        });
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

class ProbeSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
    } else {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next === undefined) this.available += 1;
      else next();
    };
  }
}

async function mapWithConcurrency<A>(
  values: readonly A[],
  limit: number,
  operation: (value: A) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        const value = values[index];
        if (value === undefined) return;
        await operation(value);
      }
    },
  );
  await Promise.all(workers);
}

function normalizedProbeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ProbeRunnerError({
      stage: "manifest",
      retryable: false,
      cause,
    });
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new ProbeRunnerError({
      stage: "manifest",
      retryable: false,
      cause: "probe origin must not contain credentials, path, query, or fragment",
    });
  }
  return url.origin;
}

function normalizedRequestTimeoutMs(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > PROBE_MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new ProbeRunnerError({
      stage: "manifest",
      retryable: false,
      cause: `request timeout must be an integer from 1 through ${PROBE_MAX_REQUEST_TIMEOUT_MS} milliseconds`,
    });
  }
  return value;
}

async function responseJson(
  response: Response,
  stage: ProbeRunnerError["stage"],
): Promise<unknown> {
  return parseJsonOrNull(await responseText(response, stage));
}

async function responseText(
  response: Response,
  stage: ProbeRunnerError["stage"],
): Promise<string> {
  try {
    return await response.text();
  } catch (cause) {
    throw new ProbeRunnerError({
      stage,
      retryable: true,
      cause,
    });
  }
}

function parseJsonOrNull(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

export function mergeProbeRunnerCheckpointCompletionV1(
  current: ProbeRunnerCheckpointV1,
  completion: ProbeExternalCompletionRequestV1,
): ProbeRunnerCheckpointV1 {
  const existing = current.externalCompletions.find(
    candidate =>
      candidate.runId === completion.runId &&
      candidate.sampleOrdinal === completion.sampleOrdinal,
  );
  if (
    existing !== undefined &&
    existing.externalDurationMs !== completion.externalDurationMs
  ) {
    throw new ProbeRunnerError({
      stage: "external-completion",
      retryable: false,
      cause: "checkpoint completion conflict",
    });
  }
  if (existing !== undefined) return current;
  return ProbeRunnerCheckpointV1Schema.make({
    version: 1,
    campaignId: current.campaignId,
    externalCompletions: [
      ...current.externalCompletions,
      completion,
    ].sort(compareExternalCompletions),
  });
}

function compareExternalCompletions(
  left: ProbeExternalCompletionRequestV1,
  right: ProbeExternalCompletionRequestV1,
): number {
  return compareUtf16Strings(left.runId, right.runId) ||
    left.sampleOrdinal - right.sampleOrdinal;
}
