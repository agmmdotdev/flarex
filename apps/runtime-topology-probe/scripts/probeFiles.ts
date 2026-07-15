import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { Data } from "effect";

import {
  buildProbeSummaryArtifactV1,
  decodeProbeRawEvidenceArtifactV1OrNull,
  decodeProbeSummaryArtifactV1OrNull,
  probeEvidencePersistenceReceiptV1,
  type ProbeEvidencePersistenceReceiptV1,
  type ProbeRawEvidenceArtifactV1,
  type ProbeSummaryArtifactV1,
} from "../src/evidenceProtocol";
import { strictSchemaValueOrNullDecoder } from "../src/effectBoundary";
import type { ProbeCampaignId } from "../src/identity";
import {
  mergeProbeRunnerCheckpointCompletionV1,
  ProbeRunnerCheckpointV1Schema,
  type ProbeRunnerCheckpointStore,
  type ProbeRunnerCheckpointV1,
} from "../src/runner";
import {
  canonicalProbeCampaignManifestV1,
  sha256Hex,
} from "../src/campaignProtocol";

const decodeCheckpoint = strictSchemaValueOrNullDecoder(
  ProbeRunnerCheckpointV1Schema,
);

export class ProbeFileError extends Data.TaggedError("ProbeFileError")<{
  readonly operation: "decode" | "read" | "verify" | "write";
  readonly path: string;
  readonly cause: unknown;
}> {}

export interface ProbeEvidenceArtifactPaths {
  readonly raw: string;
  readonly summary: string;
}

export interface ProbeEvidenceArtifacts {
  readonly raw: ProbeRawEvidenceArtifactV1;
  readonly summary: ProbeSummaryArtifactV1;
}

export function createFileProbeCheckpointStore(
  checkpointPath: string,
): ProbeRunnerCheckpointStore {
  const path = resolve(checkpointPath);
  let tail: Promise<void> = Promise.resolve();
  const loadCurrent = async (
    campaignId: ProbeCampaignId,
  ): Promise<ProbeRunnerCheckpointV1> => {
    const value = await readJsonIfPresent(path);
    if (value === null) {
      return ProbeRunnerCheckpointV1Schema.make({
        version: 1,
        campaignId,
        externalCompletions: [],
      });
    }
    const checkpoint = decodeCheckpoint(value);
    if (checkpoint === null || checkpoint.campaignId !== campaignId) {
      throw new ProbeFileError({
        operation: "decode",
        path,
        cause: "checkpoint is invalid or belongs to another campaign",
      });
    }
    return checkpoint;
  };
  return {
    async load(campaignId) {
      await tail;
      return await loadCurrent(campaignId);
    },
    record(campaignId, completion) {
      const update = tail.then(async () => {
        const current = await loadCurrent(campaignId);
        const next = mergeProbeRunnerCheckpointCompletionV1(
          current,
          completion,
        );
        await writeAtomicJson(path, next);
      });
      tail = update.catch(() => undefined);
      return update;
    },
  };
}

export function probeEvidenceArtifactPaths(
  outputDirectory: string,
  campaignId: ProbeCampaignId,
): ProbeEvidenceArtifactPaths {
  const directory = resolve(outputDirectory);
  return {
    raw: join(directory, `${campaignId}.raw.json`),
    summary: join(directory, `${campaignId}.summary.json`),
  };
}

export async function writeProbeEvidenceArtifacts(
  outputDirectory: string,
  campaignId: ProbeCampaignId,
  raw: ProbeRawEvidenceArtifactV1,
  summary: ProbeSummaryArtifactV1,
): Promise<ProbeEvidencePersistenceReceiptV1> {
  const paths = probeEvidenceArtifactPaths(outputDirectory, campaignId);
  await writeAtomicJson(paths.raw, raw);
  await writeAtomicJson(paths.summary, summary);
  const persisted = await readProbeEvidenceArtifacts(outputDirectory, campaignId);
  return probeEvidencePersistenceReceiptV1(
    persisted.raw,
    persisted.summary,
  );
}

export async function readProbeEvidenceArtifacts(
  outputDirectory: string,
  campaignId: ProbeCampaignId,
): Promise<ProbeEvidenceArtifacts> {
  const paths = probeEvidenceArtifactPaths(outputDirectory, campaignId);
  const [rawValue, summaryValue] = await Promise.all([
    readRequiredJson(paths.raw),
    readRequiredJson(paths.summary),
  ]);
  const raw = decodeProbeRawEvidenceArtifactV1OrNull(rawValue);
  const summary = decodeProbeSummaryArtifactV1OrNull(summaryValue);
  if (raw === null) {
    throw new ProbeFileError({
      operation: "decode",
      path: paths.raw,
      cause: "raw evidence artifact is invalid",
    });
  }
  if (summary === null) {
    throw new ProbeFileError({
      operation: "decode",
      path: paths.summary,
      cause: "summary evidence artifact is invalid",
    });
  }
  if (
    raw.campaign.manifest.campaignId !== campaignId ||
    raw.campaign.manifestSha256 !== await sha256Hex(
      canonicalProbeCampaignManifestV1(raw.campaign.manifest),
    )
  ) {
    throw new ProbeFileError({
      operation: "verify",
      path: paths.raw,
      cause: "raw evidence does not match its canonical campaign manifest",
    });
  }
  if (
    summary.manifestSha256 !== raw.campaign.manifestSha256 ||
    summary.rawSha256 !== await sha256Hex(JSON.stringify(raw))
  ) {
    throw new ProbeFileError({
      operation: "verify",
      path: paths.summary,
      cause: "raw and summary evidence artifacts do not agree",
    });
  }
  const durableEvidenceSha = raw.campaign.evidence?.sha256;
  if (
    durableEvidenceSha === undefined ||
    durableEvidenceSha !== await sha256Hex(JSON.stringify(raw.evidence))
  ) {
    throw new ProbeFileError({
      operation: "verify",
      path: paths.raw,
      cause: "raw evidence does not match the durable campaign evidence seal",
    });
  }
  const derivedSummary = await buildProbeSummaryArtifactV1(raw);
  if (JSON.stringify(summary) !== JSON.stringify(derivedSummary)) {
    throw new ProbeFileError({
      operation: "verify",
      path: paths.summary,
      cause: "summary evidence does not match the derived raw evidence",
    });
  }
  return { raw, summary };
}

async function readJsonIfPresent(path: string): Promise<unknown | null> {
  try {
    return parseJson(await readFile(path, "utf8"), path);
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "ENOENT") return null;
    if (cause instanceof ProbeFileError) throw cause;
    throw new ProbeFileError({ operation: "read", path, cause });
  }
}

async function readRequiredJson(path: string): Promise<unknown> {
  const value = await readJsonIfPresent(path);
  if (value === null) {
    throw new ProbeFileError({
      operation: "read",
      path,
      cause: "required file does not exist",
    });
  }
  return value;
}

function parseJson(value: string, path: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch (cause) {
    throw new ProbeFileError({ operation: "decode", path, cause });
  }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true });
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch (cause) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new ProbeFileError({ operation: "write", path, cause });
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
