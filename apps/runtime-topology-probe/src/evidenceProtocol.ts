import { Data, Effect, Schema } from "effect";

import {
  ProbeCampaignStatusV1Schema,
  type ProbeCampaignStatusV1,
} from "./campaignProtocol";
import { strictSchemaValueOrNullDecoder } from "./effectBoundary";
import {
  ProbeRunEvidenceRecordV1Schema,
  type ProbeRunEvidenceRecordV1,
} from "./runProtocol";
import {
  ProbeHopLatencySummaryV1Schema,
  summarizeProbeSamples,
} from "./statistics";
import { sameProbeDimensionsV1 } from "./protocol";
import { sha256Hex } from "./sha256";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const StrictParseOptions = { onExcessProperty: "error" } as const;

const Sha256HexSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const CompatibilityDateSchema = Schema.String.check(
  Schema.isPattern(/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/),
);
const ArtifactCountSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= 2_048
      ? undefined
      : "artifact count must be between 0 and 2048"
  ),
);

export const ProbeEvidenceTargetV1Schema = Schema.Struct({
  kind: Schema.Literals(["local-miniflare", "cloudflare-production"]),
  compatibilityDate: CompatibilityDateSchema,
}).annotate(StrictStructOptions);
export type ProbeEvidenceTargetV1 = typeof ProbeEvidenceTargetV1Schema.Type;

const ProbeRawEvidenceArtifactV1Shape = Schema.Struct({
  artifactVersion: Schema.Literal(1),
  kind: Schema.Literal("runtime-topology-probe-raw"),
  target: ProbeEvidenceTargetV1Schema,
  campaign: ProbeCampaignStatusV1Schema,
  evidence: Schema.Array(ProbeRunEvidenceRecordV1Schema),
}).annotate(StrictStructOptions);

export const ProbeRawEvidenceArtifactV1Schema =
  ProbeRawEvidenceArtifactV1Shape.check(
    Schema.makeFilter(artifact => rawEvidenceRelationshipIssue(artifact)),
  );
export type ProbeRawEvidenceArtifactV1 =
  typeof ProbeRawEvidenceArtifactV1Schema.Type;

const ProbeEvidenceIntegrityV1Shape = Schema.Struct({
  publishable: Schema.Boolean,
  plannedSamples: ArtifactCountSchema,
  observedSamples: ArtifactCountSchema,
  failedScenarioSamples: ArtifactCountSchema,
  externalDurationMissingSamples: ArtifactCountSchema,
  abandonedSamples: ArtifactCountSchema,
  notStartedSamples: ArtifactCountSchema,
  excludedWarmupSamples: ArtifactCountSchema,
  excludedDuplicateWakeSamples: ArtifactCountSchema,
}).annotate(StrictStructOptions);

export const ProbeEvidenceIntegrityV1Schema =
  ProbeEvidenceIntegrityV1Shape.check(
    Schema.makeFilter(integrity => evidenceIntegrityIssueV1(integrity)),
  );
export type ProbeEvidenceIntegrityV1 =
  typeof ProbeEvidenceIntegrityV1Schema.Type;

function evidenceIntegrityIssueV1(
  integrity: typeof ProbeEvidenceIntegrityV1Shape.Type,
): string | undefined {
  if (
    integrity.plannedSamples !== integrity.observedSamples +
      integrity.externalDurationMissingSamples + integrity.abandonedSamples +
      integrity.notStartedSamples
  ) {
    return "evidence classifications must equal the immutable sample plan";
  }
  if (
    integrity.failedScenarioSamples >
      integrity.observedSamples + integrity.externalDurationMissingSamples
  ) {
    return "failed scenario samples must have observed server evidence";
  }
  if (
    integrity.excludedWarmupSamples +
        integrity.excludedDuplicateWakeSamples > integrity.observedSamples
  ) {
    return "measurement exclusions cannot exceed observed samples";
  }
  const expectedPublishable = integrity.externalDurationMissingSamples === 0 &&
    integrity.abandonedSamples === 0 && integrity.notStartedSamples === 0;
  return integrity.publishable === expectedPublishable
    ? undefined
    : "publishability must match evidence completeness";
}

export const ProbeSummaryArtifactV1Schema = Schema.Struct({
  artifactVersion: Schema.Literal(1),
  kind: Schema.Literal("runtime-topology-probe-summary"),
  rawSha256: Sha256HexSchema,
  manifestSha256: Sha256HexSchema,
  integrity: ProbeEvidenceIntegrityV1Schema,
  cohorts: Schema.Array(ProbeHopLatencySummaryV1Schema),
}).annotate(StrictStructOptions);
export type ProbeSummaryArtifactV1 =
  typeof ProbeSummaryArtifactV1Schema.Type;

export const ProbeEvidencePersistenceReceiptV1Schema = Schema.Struct({
  rawSha256: Sha256HexSchema,
  manifestSha256: Sha256HexSchema,
  evidenceSha256: Sha256HexSchema,
  recordCount: ArtifactCountSchema,
}).annotate(StrictStructOptions);
export type ProbeEvidencePersistenceReceiptV1 =
  typeof ProbeEvidencePersistenceReceiptV1Schema.Type;

export class ProbeEvidenceProtocolValidationError extends Data.TaggedError(
  "ProbeEvidenceProtocolValidationError",
)<{
  readonly boundary: "raw-evidence-artifact-v1" | "summary-artifact-v1";
  readonly cause: unknown;
}> {}

const decodeUnknownRawArtifact = Schema.decodeUnknownEffect(
  ProbeRawEvidenceArtifactV1Schema,
  StrictParseOptions,
);
const decodeUnknownSummaryArtifact = Schema.decodeUnknownEffect(
  ProbeSummaryArtifactV1Schema,
  StrictParseOptions,
);

export const decodeProbeRawEvidenceArtifactV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeRawEvidenceArtifactV1",
)((value: unknown) =>
  decodeUnknownRawArtifact(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeEvidenceProtocolValidationError({
          boundary: "raw-evidence-artifact-v1",
          cause,
        }),
    ),
  ));

export const decodeProbeSummaryArtifactV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSummaryArtifactV1",
)((value: unknown) =>
  decodeUnknownSummaryArtifact(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeEvidenceProtocolValidationError({
          boundary: "summary-artifact-v1",
          cause,
        }),
    ),
  ));

export const decodeProbeRawEvidenceArtifactV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRawEvidenceArtifactV1Schema);
export const decodeProbeSummaryArtifactV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSummaryArtifactV1Schema);

export function buildProbeRawEvidenceArtifactV1(
  target: ProbeEvidenceTargetV1,
  campaign: ProbeCampaignStatusV1,
  evidence: readonly ProbeRunEvidenceRecordV1[],
): ProbeRawEvidenceArtifactV1 {
  return ProbeRawEvidenceArtifactV1Schema.make({
    artifactVersion: 1,
    kind: "runtime-topology-probe-raw",
    target,
    campaign,
    evidence,
  });
}

export async function buildProbeSummaryArtifactV1(
  raw: ProbeRawEvidenceArtifactV1,
): Promise<ProbeSummaryArtifactV1> {
  const observed = raw.evidence.flatMap(record =>
    record.kind === "observed" ? [record.result] : []
  );
  const externalMissing = countEvidenceKind(
    raw.evidence,
    "external-duration-missing",
  );
  const abandoned = countEvidenceKind(raw.evidence, "abandoned");
  const notStarted = countEvidenceKind(raw.evidence, "not-started");
  const integrity = ProbeEvidenceIntegrityV1Schema.make({
    publishable: externalMissing === 0 && abandoned === 0 && notStarted === 0,
    plannedSamples: raw.campaign.budgets.planned.sampleExecutions,
    observedSamples: observed.length,
    failedScenarioSamples: raw.evidence.filter(record =>
      record.kind === "observed"
        ? record.result.sample.outcome.kind === "error"
        : record.kind === "external-duration-missing" &&
          record.fragment.fragment.outcome.kind === "error"
    ).length,
    externalDurationMissingSamples: externalMissing,
    abandonedSamples: abandoned,
    notStartedSamples: notStarted,
    excludedWarmupSamples: observed.filter(
      sample => sample.control.measurementDisposition === "excluded-warmup",
    ).length,
    excludedDuplicateWakeSamples: observed.filter(
      sample =>
        sample.control.measurementDisposition === "excluded-duplicate-wake",
    ).length,
  });
  return ProbeSummaryArtifactV1Schema.make({
    artifactVersion: 1,
    kind: "runtime-topology-probe-summary",
    rawSha256: await sha256Hex(JSON.stringify(raw)),
    manifestSha256: raw.campaign.manifestSha256,
    integrity,
    cohorts: summarizeProbeSamples(observed),
  });
}

export function probeEvidencePersistenceReceiptV1(
  raw: ProbeRawEvidenceArtifactV1,
  summary: ProbeSummaryArtifactV1,
): ProbeEvidencePersistenceReceiptV1 {
  const evidence = raw.campaign.evidence;
  if (evidence === null) {
    throw new Error("persisted evidence requires a durable campaign seal");
  }
  return ProbeEvidencePersistenceReceiptV1Schema.make({
    rawSha256: summary.rawSha256,
    manifestSha256: summary.manifestSha256,
    evidenceSha256: evidence.sha256,
    recordCount: evidence.recordCount,
  });
}

export function probeEvidencePersistenceReceiptMatchesV1(
  receipt: ProbeEvidencePersistenceReceiptV1,
  raw: ProbeRawEvidenceArtifactV1,
  summary: ProbeSummaryArtifactV1,
): boolean {
  const expected = probeEvidencePersistenceReceiptV1(raw, summary);
  return receipt.rawSha256 === expected.rawSha256 &&
    receipt.manifestSha256 === expected.manifestSha256 &&
    receipt.evidenceSha256 === expected.evidenceSha256 &&
    receipt.recordCount === expected.recordCount;
}

function countEvidenceKind(
  evidence: readonly ProbeRunEvidenceRecordV1[],
  kind: ProbeRunEvidenceRecordV1["kind"],
): number {
  return evidence.filter(record => record.kind === kind).length;
}

function rawEvidenceRelationshipIssue(
  artifact: typeof ProbeRawEvidenceArtifactV1Shape.Type,
): string | undefined {
  if (artifact.campaign.state !== "evidence-sealed") {
    return "raw evidence requires an evidence-sealed campaign";
  }
  const planned = artifact.campaign.budgets.planned.sampleExecutions;
  if (artifact.evidence.length !== planned) {
    return "raw evidence count must match the immutable campaign plan";
  }
  if (
    artifact.campaign.evidence === null ||
    artifact.campaign.evidence.recordCount !== artifact.evidence.length
  ) {
    return "raw evidence count must match the durable evidence seal";
  }
  const seen = new Set<string>();
  const runById = new Map(
    artifact.campaign.manifest.runs.map(run => [run.runId, run] as const),
  );
  for (const record of artifact.evidence) {
    const run = runById.get(record.runId);
    if (run === undefined) return "raw evidence contains an unknown run";
    const total = run.warmupRepetitions + run.repetitions;
    if (record.sampleOrdinal >= total) {
      return "raw evidence contains an out-of-range ordinal";
    }
    const expectedPhase = record.sampleOrdinal < run.warmupRepetitions
      ? "warmup"
      : "measurement";
    if (record.phase !== expectedPhase) {
      return "raw evidence phase must match the immutable run";
    }
    if (record.kind === "observed") {
      const sample = record.result.sample;
      if (
        sample.runId !== record.runId ||
        sample.identity.sampleOrdinal !== record.sampleOrdinal ||
        sample.scenario !== run.scenario ||
        !sameProbeDimensionsV1(sample.dimensions, run.dimensions) ||
        record.result.control.phase !== record.phase
      ) {
        return "observed evidence must match its outer record and immutable run";
      }
    }
    if (record.kind === "external-duration-missing") {
      const fragment = record.fragment.fragment;
      if (
        fragment.runId !== record.runId ||
        fragment.identity.sampleOrdinal !== record.sampleOrdinal ||
        fragment.scenario !== run.scenario ||
        !sameProbeDimensionsV1(fragment.dimensions, run.dimensions) ||
        record.fragment.control.phase !== record.phase
      ) {
        return "incomplete evidence must match its outer record and immutable run";
      }
    }
    const key = `${record.runId}:${record.sampleOrdinal}`;
    if (seen.has(key)) return "raw evidence ordinals must be unique";
    seen.add(key);
  }
  return undefined;
}
