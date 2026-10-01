import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import type { PostgresFlarexPersistence } from "../../persistence-postgres/src/postgres";
import { createMixedMutationPerformanceTrace, type MixedMutationPerformanceTrace,
  type TraceFingerprintOwner, type TraceInvocationRecord } from "../../persistence-postgres/test/mixedMutationPerformanceTrace";
import { prepareStandaloneProductLaunchPerformanceSeries } from
  "../../medusa-adapter/test/support/product-launch-performance-fixture";
import { prepareMixedMutationPerformanceSeries } from "./support/mixedMutationProductFixture";
import { captureMixedMutationCpuProfile, MixedMutationCpuDiagnosticFailure } from
  "./support/mixedMutationCpuProfile";
import { renderMixedMutationPerformanceReport, summarizeMixedMutationTrace,
  type PerformanceInventory, type PerformanceRawReport, type PerformanceSample, type PerformanceSettlementLedger,
  type PerformanceTemperature, type PerformanceWorkload } from "./support/mixedMutationPerformanceReport";

const enabled = process.env.FLAREX_MIXED_PERF === "1" &&
  process.env.FLAREX_POSTGRES_DATABASE_URL !== undefined;
const smoke = process.env.FLAREX_MIXED_PERF_SMOKE === "1";
const observationMode = process.env.FLAREX_MIXED_PERF_OBSERVATION ?? "traced";
const cpuDiagnostic = process.env.FLAREX_MIXED_PERF_CPU === "1";
const planned = smoke ? { warmups: 1, warm: 2, cold: 1 } : { warmups: 3, warm: 20, cold: 3 };
const allWorkloads: readonly PerformanceWorkload[] = ["product", "productPayload",
  "mixedWorkflow", "standaloneWorkflow"];
const workloadSeedSlug: Readonly<Record<PerformanceWorkload, string>> = {
  product: "product", productPayload: "product-payload",
  mixedWorkflow: "mixed-workflow", standaloneWorkflow: "standalone-workflow",
};
const root = fileURLToPath(new URL("../../../", import.meta.url));
const outputDirectory = process.env.FLAREX_MIXED_PERF_REPORT_DIR ??
  join(root, "work", "validation", "mixed-mutation-performance");
const normalizedRoot = root.replaceAll("\\", "/");
const sanitizeFrame = (frame: string) => frame.replaceAll("\\", "/").replaceAll(normalizedRoot, ".");
const sanitizeOwnerMapping = (mapping: TraceFingerprintOwner): TraceFingerprintOwner => ({
  ...mapping, owner: mapping.owner === null ? null : sanitizeFrame(mapping.owner),
  sourceSites: mapping.sourceSites.map(site => ({ ...site,
    owner: site.owner === null ? null : sanitizeFrame(site.owner),
    sourceFrames: site.sourceFrames.map(sanitizeFrame) })),
});

const workflowResult = Schema.decodeUnknownSync(Schema.Struct({ workflow: Schema.Struct({
  pricing: Schema.Struct({
    variants: Schema.Array(Schema.Struct({ id: Schema.String, product_id: Schema.String })),
    priceSets: Schema.Array(Schema.Struct({ id: Schema.String, prices: Schema.Array(Schema.Struct({
      id: Schema.String, currency_code: Schema.String, amount: Schema.Number,
      price_rules: Schema.Array(Schema.Unknown),
    })) })),
    links: Schema.Array(Schema.Struct({ id: Schema.String, variant_id: Schema.String,
      price_set_id: Schema.String })),
  }),
  tags: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })),
  product: Schema.Struct({ id: Schema.String, title: Schema.String }),
}) }));
const mixedBusinessResult = Schema.decodeUnknownSync(Schema.Struct({
  updated: Schema.Struct({ id: Schema.String, title: Schema.String,
    handle: Schema.String, status: Schema.String }),
  pending: Schema.Struct({ id: Schema.String, title: Schema.String }),
}));
const mixedListedResult = Schema.decodeUnknownSync(Schema.Struct({
  listed: Schema.Array(Schema.Struct({ id: Schema.String })),
}));
const mixedPayloadResult = Schema.decodeUnknownSync(Schema.Struct({
  created: Schema.Struct({ id: Schema.String, title: Schema.String,
    score: Schema.Number, enabled: Schema.Boolean }),
  afterHook: Schema.Struct({ id: Schema.String, title: Schema.String,
    score: Schema.Number, enabled: Schema.Boolean }),
  final: Schema.Struct({ id: Schema.String, title: Schema.String,
    score: Schema.Number, enabled: Schema.Boolean }),
}));

function now(): number { return performance.now(); }

function safeFailureName(cause: unknown): string {
  if (cause instanceof MixedMutationCpuDiagnosticFailure && cause.hasPrimaryFailure)
    return safeFailureName(cause.primaryFailure);
  const candidate = typeof cause === "object" && cause !== null && "_tag" in cause
    ? cause._tag : cause instanceof Error ? cause.name : null;
  return typeof candidate === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(candidate)
    ? candidate : "UnclassifiedFailure";
}

function safeFailureCode(cause: unknown): string | null {
  if (cause instanceof MixedMutationCpuDiagnosticFailure && cause.hasPrimaryFailure)
    return safeFailureCode(cause.primaryFailure);
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const code = cause.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

function safeFailureReason(cause: unknown): string | null {
  if (cause instanceof MixedMutationCpuDiagnosticFailure && cause.hasPrimaryFailure)
    return safeFailureReason(cause.primaryFailure);
  if (typeof cause !== "object" || cause === null || !("reason" in cause)) return null;
  const reason = cause.reason;
  return typeof reason === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(reason)
    ? reason : null;
}

function safeDiagnosticTokens(cause: unknown): readonly string[] {
  if (cause instanceof MixedMutationCpuDiagnosticFailure && cause.hasPrimaryFailure)
    return safeDiagnosticTokens(cause.primaryFailure);
  if (!(cause instanceof Error)) return [];
  const known = ["Native Worker failed", "PointMutationExactRuntimeUserCodeV1Error",
    "PointMutationExactRuntimeV1Error", "LogicalParticipantInvocationError",
    "LogicalParticipantAdmissionError", "CommerceTransactionError", "PayloadTransactionError",
    "rollbackOnly", "invalidAuthority", "deadlineExceeded", "limitExceeded",
    "resourceFailure", "statementFailure", "unsupportedProfile", "invalidInput",
    "bindingChanged", "storedCorruption", "sessionExpired", "decisionUncertain"];
  return known.filter(token => cause.message.includes(token));
}

async function inventory(target: PostgresFlarexPersistence, journalBytes: boolean): Promise<PerformanceInventory> {
  const row = (await target.query<{
    rowCurrent: number; indexCurrent: number; commits: number; events: number;
    journals: number; liveJournalBytes: number;
  }>(`select
    (select count(*)::int from fx_app_row_current) as "rowCurrent",
    (select count(*)::int from fx_app_index_entry_current) as "indexCurrent",
    (select count(*)::int from fx_system_commit) as "commits",
    (select count(*)::int from fx_system_commit_event) as "events",
    (select count(*)::int from fx_system_tx_journal) as "journals",
    (select coalesce(sum(octet_length(sealed_journal_bytes)), 0)::int
       from fx_system_tx_journal) as "liveJournalBytes"`)).rows[0];
  if (row === undefined) throw new Error("Missing performance inventory");
  return { rowCurrent: row.rowCurrent, indexCurrent: row.indexCurrent,
    commits: row.commits, events: row.events, journals: row.journals,
    liveJournalBytes: journalBytes ? row.liveJournalBytes : null };
}

function verifyMixedBusinessResult(value: unknown,
  workload: Exclude<PerformanceWorkload, "standaloneWorkflow">,
  seed: Readonly<{ productId: string; newTitle: string; newHandle: string }>): void {
  const result = mixedBusinessResult(value);
  expect(result.updated).toMatchObject({ id: seed.productId, title: seed.newTitle,
    handle: seed.newHandle, status: "published" });
  expect(result.pending).toMatchObject({ id: seed.productId, title: seed.newTitle });
  if (workload !== "mixedWorkflow") {
    expect(mixedListedResult(value).listed).toEqual([
      expect.objectContaining({ id: seed.productId }),
    ]);
  }
  if (workload !== "product") {
    const payload = mixedPayloadResult(value);
    expect(payload.created).toMatchObject({ title: seed.newTitle, score: 0, enabled: false });
    expect(payload.afterHook).toMatchObject({ id: payload.created.id,
      title: seed.newTitle, score: 1, enabled: false });
    expect(payload.final).toMatchObject({ id: payload.created.id,
      title: seed.newTitle, score: 1, enabled: true });
  }
}

function verifyWorkflowGraph(value: unknown, productId: string, tagId: string,
  productTitle?: string): void {
  const result = workflowResult(value).workflow;
  expect(result.pricing.variants).toHaveLength(1);
  expect(result.pricing.variants[0]?.product_id).toBe(productId);
  expect(result.pricing.priceSets).toHaveLength(1);
  expect(result.pricing.priceSets[0]?.prices).toHaveLength(1);
  expect(result.pricing.priceSets[0]?.prices[0]).toMatchObject({
    currency_code: "USD", amount: 50, price_rules: [],
  });
  expect(result.pricing.links).toEqual([expect.objectContaining({
    variant_id: result.pricing.variants[0]?.id,
    price_set_id: result.pricing.priceSets[0]?.id,
  })]);
  expect(result.tags).toEqual([expect.objectContaining({ id: tagId, value: "launched" })]);
  expect(result.product).toMatchObject({ id: productId,
    ...(productTitle === undefined ? {} : { title: productTitle }) });
}

const measuredSourcePaths = [
  "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts",
  "packages/flarex-backend/test/support/mixedMutationProductFixture.ts",
  "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts",
  "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts",
  "packages/medusa-adapter/src/product-attempt.ts",
  "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts",
  "packages/executor/src/pointMutationJournal.ts",
  "packages/executor/src/storedAttemptAuthentication.ts",
  "packages/executor/src/storedAttemptAuthentication/authenticationOperations.ts",
  "packages/executor/src/storedAttemptAuthentication/commitAuthorityModel.ts",
  "packages/executor/src/storedAttemptAuthentication/planningOperations.ts",
  "packages/executor/src/storedAttemptAuthentication/pointCommitRuntimeModel.ts",
  "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts",
  "packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql",
  "packages/persistence-postgres/drizzle/0120_immutable_target_metadata_protection.sql",
  "packages/persistence-postgres/src/appRows.ts",
  "packages/persistence-postgres/src/appIndexEntries.ts",
  "packages/persistence-postgres/src/appDeveloperIndexCommitV1.ts",
  "packages/persistence-postgres/src/appUniqueKeys.ts",
  "packages/persistence-postgres/src/appSchemaCandidateValidation.ts",
  "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts",
  "packages/persistence-postgres/src/applicationActiveHeadRead.ts",
  "packages/persistence-postgres/src/applicationActivation.ts",
  "packages/persistence-postgres/src/applicationBindingProjection.ts",
  "packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts",
  "packages/persistence-postgres/src/applicationDocumentMaterialization/model.ts",
  "packages/persistence-postgres/src/applicationReadiness.ts",
  "packages/persistence-postgres/src/applicationRelationReadinessFold.ts",
  "packages/persistence-postgres/src/boundedRequestLifetime.ts",
  "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts",
  "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts",
  "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts",
  "packages/persistence-postgres/src/commitPublication/publication.ts",
  "packages/persistence-postgres/src/commitPublication/strongReferenceAdmission.ts",
  "packages/persistence-postgres/src/commitPublication/strongReferenceValidation.ts",
  "packages/persistence-postgres/src/drizzleSchema.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts",
  "packages/persistence-postgres/src/indexBuildStates.ts",
  "packages/persistence-postgres/src/intrinsicCreationTimeIndexBuildV1.ts",
  "packages/persistence-postgres/src/locatedReadCommittedEffect.ts",
  "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts",
  "packages/persistence-postgres/src/logicalDocuments/commitEvidence.ts",
  "packages/persistence-postgres/src/logicalDocuments/journalEvidence.ts",
  "packages/persistence-postgres/src/logicalDocuments/indexReads.ts",
  "packages/persistence-postgres/src/logicalDocuments/materialization.ts",
  "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/model.ts",
  "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts",
  "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/searchEntries.ts",
  "packages/persistence-postgres/src/logicalDocuments/searchReads.ts",
  "packages/persistence-postgres/src/logicalDocuments/workingSet.ts",
  "packages/persistence-postgres/src/logicalSearchBuild.ts",
  "packages/persistence-postgres/src/logicalStorageReadiness.ts",
  "packages/persistence-postgres/src/pointCommitTransaction.ts",
  "packages/persistence-postgres/src/postgres.ts",
  "packages/persistence-postgres/src/preparedMetadataEpoch.ts",
  "packages/persistence-postgres/src/preparedHostRuntime.ts",
  "packages/persistence-postgres/src/retainedHistoryFloorObservation.ts",
  "packages/persistence-postgres/src/scopeClock.ts",
  "packages/persistence-postgres/src/schema.ts",
  "packages/persistence-postgres/src/sessionJournalStore.ts",
  "packages/persistence-postgres/src/storedAttemptEvidence.ts",
  "packages/persistence-postgres/src/storedCommitAuthority/model.ts",
  "packages/persistence-postgres/src/storedCommitAuthority/materialization.ts",
  "packages/persistence-postgres/src/storedCommitAuthority/postgresLoader.ts",
  "packages/persistence-postgres/src/transactionSessionActivation.ts",
  "packages/persistence-postgres/src/transactionSessionAttemptFacet.ts",
  "packages/persistence-postgres/src/transactionSessionAttemptKernel.ts",
  "packages/persistence-postgres/test/mixedMutationPerformanceTrace.ts",
  "packages/executor/src/pointMutationSessionActivation.ts",
  "packages/executor/src/pointMutationExecutionClaim.ts",
  "packages/executor/src/pointMutationExecutionClaimLiveness.ts",
  "packages/executor/src/storedAttemptAuthentication/occRerunExecutionOperations.ts",
  "packages/executor/src/storedAttemptAuthentication/commitAuthorityVerification.ts",
  "packages/executor/src/pointMutationSessionActivationState.ts",
  "packages/executor/src/pointMutationSessionAttemptState.ts",
  "packages/executor/src/storedAttemptAuthentication/initialPointMutationExecutionOperations.ts",
  "packages/persistence-postgres/src/applicationMutationAdmission.ts",
  "packages/persistence-postgres/src/applicationTaskBindings.ts",
  "packages/persistence-postgres/src/applicationTaskBindingEvidence.ts",
  "packages/persistence-postgres/src/applicationSchemaAuthority.ts",
  "packages/persistence-postgres/src/sessionJournalFiniteEntry.ts",
  "packages/persistence-postgres/src/transactionExecutionClaimLiveness.ts",
  "packages/persistence-postgres/src/storedOccExecution.ts",
  "packages/persistence-postgres/src/storedOccExecution/model.ts",
  "packages/persistence-postgres/src/storedOccExecution/postgresLoader.ts",
  "packages/persistence-postgres/src/atomicCommerce/participants.ts",
  "packages/persistence-postgres/src/atomicCommerce/configuration.ts",
  "packages/persistence-postgres/src/commerceTransaction/host.ts",
  "packages/persistence-postgres/src/commerceTransaction/logicalParticipant.ts",
  "packages/persistence-postgres/src/cmsTransaction/host.ts",
  "packages/persistence-postgres/src/logicalDocuments/relationalQuery.ts",
  "packages/persistence-postgres/src/logicalDocuments/relationalRows.ts",
  "packages/persistence-postgres/src/logicalDocuments/relationalValues.ts",
  "packages/persistence-postgres/src/logicalStrongReferenceProjection.ts",
  "packages/persistence-postgres/src/indexBuildReconciliation.ts",
  "packages/persistence-postgres/src/logicalSchemaAdmission.ts",
  "packages/persistence-postgres/src/logicalStorageDefinitions.ts",
  "packages/persistence-postgres/src/logicalDocuments/referencePages.ts",
  "packages/analysis/src/applicationPublicationFramesV1.ts",
  "packages/medusa-adapter/src/product-launch-workflow.ts",
  "packages/flarex-protocol/src/decoded-protocol-snapshot.ts",
  "packages/flarex-protocol/package.json",
] as const;

async function environment(target: PostgresFlarexPersistence): Promise<Readonly<Record<string, unknown> & {
  sourceHashes: Readonly<Record<string, string>>;
}>> {
  const settings = (await target.query<{ serverVersion: string; fsync: string; synchronousCommit: string;
    fullPageWrites: string; sharedBuffers: string; role: string; superuser: boolean }>(
    `select current_setting('server_version') as "serverVersion",
      current_setting('fsync') as fsync,
      current_setting('synchronous_commit') as "synchronousCommit",
      current_setting('full_page_writes') as "fullPageWrites",
      current_setting('shared_buffers') as "sharedBuffers",
      current_user as role,
      (select rolsuper from pg_roles where rolname = current_user) as superuser`)).rows[0];
  if (settings === undefined || settings.superuser || settings.fsync !== "on" ||
    settings.synchronousCommit !== "on") throw new Error("Non-comparable PostgreSQL performance host");
  const sourceHashes = Object.fromEntries(await Promise.all(measuredSourcePaths.map(async path =>
    [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
  const driver = createRequire(import.meta.url)("pg/package.json") as Readonly<{ version: string }>;
  return { postgres: settings, node: process.version, pgDriver: driver.version,
    platform: process.platform, architecture: process.arch,
    cpu: cpus()[0]?.model ?? "unknown", logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(), targetPoolMax: target.pool.options.max,
    transport: "pg TCP socket; private Worker bridge is in-process test harness",
    sourceHashes };
}

function traceRecord(trace: MixedMutationPerformanceTrace, id: string): TraceInvocationRecord | null {
  const records = trace.drainRecords();
  if (records.length === 0) return null;
  if (records.length !== 1 || records[0]?.id !== id)
    throw new Error("Performance trace invocation reconciliation failed");
  return records[0];
}

function construction(input: Partial<PerformanceSample["construction"]>): PerformanceSample["construction"] {
  return { setupTotalMs: input.setupTotalMs ?? null,
    provisioningMs: input.provisioningMs ?? null,
    preparedModuleMs: input.preparedModuleMs ?? null,
    initialSeedingMs: input.initialSeedingMs ?? null,
    additionalSetupSeedingMs: input.additionalSetupSeedingMs ?? null,
    standaloneRuntimeConstructionMs: input.standaloneRuntimeConstructionMs ?? null,
    seedingMs: input.seedingMs ?? null };
}

function traceCoverageIssue(summary: NonNullable<PerformanceSample["trace"]>,
  workload: PerformanceWorkload): string | null {
  const hasPhase = (name: string) => summary.phases.some(phase => phase.path.split(" / ").includes(name));
  const count = (name: string, pool: "control" | "target") => summary.sqlGroups
    .filter(group => group.pool === pool && group.phase.split(" / ").includes(name))
    .reduce((sum, group) => sum + group.dispatches, 0);
  if (workload === "standaloneWorkflow") {
    if (!hasPhase("standalone native workflow")) return "missingStandalonePhase";
    if (count("standalone native workflow", "control") === 0) return "missingStandaloneControlDispatch";
    if (count("standalone native workflow", "target") === 0) return "missingStandaloneTargetDispatch";
    return null;
  }
  for (const name of ["request admission", "Worker execution", "journal seal and OCC verification",
    "authoritative publication"]) if (!hasPhase(name)) return `missing${name.replaceAll(/[^A-Za-z]/g, "")}Phase`;
  if (count("request admission", "control") === 0) return "missingAdmissionControlDispatch";
  if (count("Worker execution", "control") === 0) return "missingWorkerControlDispatch";
  if (count("Worker execution", "target") === 0) return "missingWorkerTargetDispatch";
  if (count("authoritative publication", "target") === 0) return "missingPublicationTargetDispatch";
  return null;
}

describe.skipIf(!enabled)("private mixed mutation PostgreSQL performance baseline", () => {
  it("records four comparable workload series and a sanitized owner report", async () => {
    if (observationMode !== "traced" && observationMode !== "untraced")
      throw new Error("Invalid performance observation mode");
    const requestedWorkload = process.env.FLAREX_MIXED_PERF_WORKLOAD;
    const selectedWorkload = allWorkloads.find(workload => workload === requestedWorkload);
    if (requestedWorkload !== undefined && selectedWorkload === undefined)
      throw new Error("Invalid selected performance workload");
    if (cpuDiagnostic && (!smoke || observationMode !== "untraced" ||
      (selectedWorkload !== "mixedWorkflow" && selectedWorkload !== "standaloneWorkflow")))
      throw new Error("CPU diagnostic requires untraced smoke and one mixed or standalone workload");
    const plannedWorkloads = selectedWorkload === undefined ? allWorkloads : [selectedWorkload];
    await mkdir(outputDirectory, { recursive: true });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root,
      encoding: "utf8", windowsHide: true }).trim();
    const diff = execFileSync("git", ["diff", "--binary", "HEAD", "--"], { cwd: root,
      windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    const workingFingerprint = createHash("sha256").update(diff);
    for (const path of measuredSourcePaths) {
      workingFingerprint.update(path).update(await readFile(join(root, path)));
    }
    let measuredEnvironment: Readonly<Record<string, unknown>> = {};
    let measuredSourceHashes: Readonly<Record<string, string>> = {};
    const profileSelections: Record<string, unknown> = {};
    const raw: PerformanceRawReport = {
      format: "flarex.mixed-mutation-performance", revision,
      workingDiffSha256: workingFingerprint.digest("hex"),
      mode: smoke ? "smoke" : "full", observationMode, planned, plannedWorkloads,
      ...(cpuDiagnostic ? { diagnostic: { kind: "node-inspector-cpu" as const,
        latencyAcceptance: false as const } } : {}),
      environment: {},
      interpretation: [
        "Standalone workflow includes the same selected Product/Pricing/Link/Tag graph but has no Application, Payload, journal or OCC obligations.",
        observationMode === "traced"
          ? "The first warmup is reconnaissance for owner attribution and is excluded from warm distributions."
          : "The first warmup is excluded from warm distributions.",
        "Per-request test grant issuer/signing and private bridge overhead are included in mixed request admission and Worker intervals.",
        "Warm mixed samples reuse prepared modules, scope, and pools; every request creates, readies, invokes once, and disposes a fresh Worker under the exact runtime one-invocation guard.",
        "Signed business arguments are parsed by the fixed benchmark Worker source inside the measured request; that private test-harness cost is included.",
        ...(cpuDiagnostic ? [
          "Node Inspector CPU profiling is enabled only for this diagnostic smoke. Its observer overhead is included; the run cannot judge latency acceptance or separate Workerd CPU, allocations or async waits.",
        ] : []),
        "Workflow tags are unique: each graph is seeded immediately before its invocation and its launched tag is renamed outside measurement before the next seed. Product/Payload graphs are preseeded.",
        ...(observationMode === "traced" ? [
          "The trace's DB wait union is a union of observed awaited intervals, not a server critical-path or network round-trip count.",
          "Request duration is the inner trace span; outer wall also includes trace aggregation. Their difference is reported separately.",
        ] : [
          "No SQL or phase observer is installed. Outer invocation wall time uses the same workload boundaries and business checks as the traced series.",
        ]),
        "Sealed attempt bytes come from the canonical journal at successful seal through a delegating test store port; the capture adds no database query.",
      ],
      unavailable: [
        "PostgreSQL server execution time (driver await includes transport and scheduling).",
        "Exact native workflow child inclusive/exclusive spans; native steps are not instrumented, so SQL owner mapping is used instead.",
        "Exact inner OCC/materialization phase duration where the existing owner has no test observation hook.",
        "Exact scope-clock lock acquisition wait and lock-hold interval; transaction duration is only a BEGIN-to-settlement envelope.",
        "Sealed attempt bytes for failed attempts and standalone workflow; settled journal rows are removed, so inventory separately records only remaining live journal bytes.",
        ...(observationMode === "traced" ? [
          "Client SQL that loses trace context during an active invocation is detected and invalidates that sample, but SQL through uninstrumented pools or outside the invocation cannot be counted; named phase checks do not prove universal SQL coverage.",
        ] : ["SQL dispatches, awaited time, phase spans, transaction intervals and trace coverage in untraced mode."]),
        "Hosted Cloudflare transport, native ORM parity, and production capacity.",
      ],
      sqlTemplates: [], ownerMappings: [], setupFailures: [], samples: [],
    };
    const samples: PerformanceSample[] = [];
    const setupFailures: Array<PerformanceRawReport["setupFailures"][number]> = [];
    const templates = new Map<string, string>();
    const mappings = new Map<string, PerformanceRawReport["ownerMappings"][number]>();
    const persist = async () => {
      const current = { ...raw, environment: { ...measuredEnvironment, profileSelections },
        samples: [...samples], setupFailures: [...setupFailures], sqlTemplates: [...templates].map(
        ([fingerprint, template]) => ({ fingerprint, template })), ownerMappings: [...mappings.values()] };
      await writeFile(join(outputDirectory, "raw.json"), JSON.stringify(current, null, 2) + "\n");
      await writeFile(join(outputDirectory, "report.md"), renderMixedMutationPerformanceReport(current));
    };
    const collect = (trace: MixedMutationPerformanceTrace, record: TraceInvocationRecord | null,
      seriesId: string) => {
      for (const mapping of trace.ownerMappings().map(sanitizeOwnerMapping)) {
        const phase = mapping.phasePath.join(" / ");
        const key = `${seriesId}:${mapping.pool}:${mapping.fingerprint}:${phase}`;
        mappings.set(key, { seriesId, pool: mapping.pool, fingerprint: mapping.fingerprint,
          phase, status: mapping.status,
          owner: mapping.owner,
          observedDispatches: mapping.observedDispatches,
          sourceSites: mapping.sourceSites.map(site => ({ siteId: site.siteId,
            owner: site.owner,
            dispatchCount: site.dispatchCount,
            sourceFrames: site.sourceFrames })) });
      }
      for (const group of record?.dispatchGroups ?? []) {
        if (group.fingerprint !== null && group.template !== null)
          templates.set(group.fingerprint, group.template);
      }
    };

    async function runMixed(workload: Exclude<PerformanceWorkload, "standaloneWorkflow">,
      temperature: "warm" | "cold", seriesOrdinal: number, count: number) {
      const seriesStarted = now();
      const seriesId = `${workload}-${temperature}-${seriesOrdinal}`;
      const series = await prepareMixedMutationPerformanceSeries({ driver: "postgres",
        suffix: `perf-${workloadSeedSlug[workload]}-${temperature}-${seriesOrdinal}`,
        profile: workload === "mixedWorkflow" ? "workflow" : workload,
        sampleCount: count }).catch(async (cause: unknown) => {
          const failure = { id: seriesId, stage: "prepareSeries", name: safeFailureName(cause),
            code: safeFailureCode(cause), reason: safeFailureReason(cause) };
          setupFailures.push(failure);
          console.error("Mixed performance series preparation failed", failure);
          await persist();
          throw new Error(`Performance series ${seriesId} failed during preparation: ${failure.name}`);
        });
      const setupTotalMs = now() - seriesStarted;
      if (series.currency.resource.kind !== "postgres") {
        await series.close();
        throw new Error("Expected ordinary PostgreSQL series");
      }
      const target = series.currency.resource.target;
      const trace = observationMode === "traced" ? createMixedMutationPerformanceTrace({
        controlPool: series.currency.resource.control.pool, targetPool: target.pool }) : undefined;
      if (trace !== undefined) series.setTrace(trace);
      try {
        if (Object.keys(measuredEnvironment).length === 0) {
          const recordedEnvironment = await environment(target);
          measuredEnvironment = recordedEnvironment;
          measuredSourceHashes = recordedEnvironment.sourceHashes;
        }
        profileSelections[workload] = { revisions: series.profileRevisions,
          workerLifecycle: "fresh single-use Worker per request" };
        for (let index = 0; index < count; index++) {
          const kind: PerformanceTemperature = temperature === "cold" ? "cold"
            : index < planned.warmups ? "warmup" : "warm";
          const id = `${workload}-${temperature}-${seriesOrdinal}-${index}`;
          let seedMs: number | null = null;
          let before: PerformanceInventory | null = null;
          let after: PerformanceInventory | null = null;
          let wallMs: number | null = null;
          let requestWorkerConstructionMs: number | null = null;
          let sealedJournalBytes: number | null = null;
          let settlementLedger: PerformanceSettlementLedger | null = null;
          let recorded: TraceInvocationRecord | null = null;
          let failureName: string | null = null;
          let failureStage: string | null = null;
          let failureCode: string | null = null;
          let failureReason: string | null = null;
          let failureDiagnosticTokens: readonly string[] = [];
          let cpuDiagnosticSecondaryFailures: readonly Readonly<{ stage: string; name: string }>[] = [];
          let stage = "prepareAttempt";
          try {
            const seedStarted = now();
            await series.prepareAttempt(index);
            seedMs = now() - seedStarted;
            stage = "inventoryBefore";
            before = await inventory(target, true);
            const started = now();
            try {
              stage = "invoke";
              const invoke = () => trace === undefined ? series.runAttempt(index) : trace.withInvocation({ id,
                mode: kind === "warmup" && index === 0 ? "recon" : "measured" },
              () => series.runAttempt(index));
              const outcome = cpuDiagnostic && workload === "mixedWorkflow"
                ? await captureMixedMutationCpuProfile({ id, workload,
                temperature: kind, root, outputDirectory, revision,
                workingDiffSha256: raw.workingDiffSha256, sourceHashes: measuredSourceHashes },
              invoke, elapsed => { wallMs = elapsed; }) : await invoke();
              if (!cpuDiagnostic) wallMs = now() - started;
              // Inspect detached confirmed owner evidence after the request
              // timer, so demand accounting adds no timed SQL or copy work.
              settlementLedger = await outcome.fixture.readSettlementLedger();
              requestWorkerConstructionMs = outcome.workerConstructionMilliseconds;
              sealedJournalBytes = outcome.sealedJournalBytes;
              stage = "verifyPublication";
              if (outcome.publication.kind !== "published") throw new Error("ExpectedPublishedResult");
              expect(outcome.publication.successfulResult.valueJson).toEqual(outcome.returnedValue);
              expect(outcome.fixture.nativeInvokeCount.get("listByHandle") ?? 0)
                .toBe(workload === "mixedWorkflow" ? 0 : 1);
              stage = "verifyBusinessResult";
              verifyMixedBusinessResult(outcome.returnedValue, workload, outcome.seed);
              stage = "verifyWorkflowGraph";
              if (workload === "mixedWorkflow") verifyWorkflowGraph(outcome.returnedValue,
                outcome.seed.productId, outcome.seed.tagId, outcome.seed.newTitle);
            } catch (cause) { if (!cpuDiagnostic) wallMs = now() - started; throw cause; }
            if (trace !== undefined) {
              stage = "traceReconciliation";
              recorded = traceRecord(trace, id);
              if (recorded === null || recorded.outcome !== "ok") throw new Error("MissingSuccessfulTraceRecord");
            }
            stage = "inventoryAfter";
            after = await inventory(target, true);
          } catch (cause) {
            if (cause instanceof MixedMutationCpuDiagnosticFailure && !cause.hasPrimaryFailure &&
              wallMs === null && cause.secondaryFailures.some(item => item.stage === "setup"))
              stage = "cpuDiagnosticSetup";
            failureName = safeFailureName(cause);
            failureStage = stage;
            failureCode = safeFailureCode(cause);
            failureReason = safeFailureReason(cause);
            failureDiagnosticTokens = safeDiagnosticTokens(cause);
            if (cause instanceof MixedMutationCpuDiagnosticFailure)
              cpuDiagnosticSecondaryFailures = cause.secondaryFailures;
            console.error("Mixed performance sample failed", { id, stage, failureName, failureCode,
              failureReason, failureDiagnosticTokens });
            if (trace !== undefined) {
              try { recorded ??= traceRecord(trace, id); }
              catch { failureName = "TraceReconciliationFailure"; failureStage = "traceReconciliation"; }
            }
            if (before !== null && after === null) after = await inventory(target, true).catch(() => null);
          }
          if (trace !== undefined) collect(trace, recorded, `${workload}-${temperature}-${seriesOrdinal}`);
          let summary: PerformanceSample["trace"] = null;
          if (recorded !== null && trace !== undefined) {
            try {
              summary = summarizeMixedMutationTrace(recorded, trace.ownerMappings().map(sanitizeOwnerMapping));
              const issue = failureName === null ? traceCoverageIssue(summary, workload) : null;
              if (issue !== null) { failureName = "TracePhaseCoverageFailure"; failureReason = issue;
                failureStage = "traceCoverage"; }
              if (failureName === null && summary.transactionGroups.some(group => group.outcome === "open-at-end")) {
                failureName = "OpenTransactionAtRequestEnd";
                failureStage = "traceCoverage";
              }
            }
            catch { failureName ??= "TraceCoverageFailure"; failureStage ??= "traceCoverage"; }
          }
          if (failureStage === "traceCoverage") console.error("Mixed performance trace failed", { id,
            failureName, unobserved: recorded?.unobservedDispatches,
            lostContextDispatches: recorded?.lostContextDispatches,
            incompleteSpans: recorded?.incompleteSpans,
            poolQueryCalls: recorded?.poolQueryCalls,
            delegatedPoolQueryDispatches: recorded?.delegatedPoolQueryDispatches });
          samples.push({ id, workload, temperature: kind, index,
            status: failureName === null ? "ok" : "error", failureName, failureStage,
            failureCode, failureReason, failureDiagnosticTokens, wallMs,
            ...(cpuDiagnostic ? { cpuDiagnosticSecondaryFailures } : {}),
            requestWorkerConstructionMs, sealedJournalBytes, settlementLedger,
            instrumentationFinalizationMs: wallMs === null || recorded === null ? null :
              Math.max(0, wallMs - recorded.durationMs),
            construction: construction({ setupTotalMs: index === 0 ? setupTotalMs : null,
              provisioningMs: index === 0 ? series.provisioningMilliseconds : null,
              preparedModuleMs: index === 0 ? series.preparedModuleMilliseconds : null,
              initialSeedingMs: index === 0 ? series.initialSeedingMilliseconds : null,
              additionalSetupSeedingMs: index === 0 ? series.additionalSetupSeedingMilliseconds : null,
              seedingMs: seedMs }), inventoryBefore: before, inventoryAfter: after, trace: summary });
          await persist();
          if (failureName !== null) throw new Error(`Performance sample ${id} failed at ${failureStage}: ${failureName}`);
        }
      } finally {
        try { trace?.close(); } finally { await series.close(); }
      }
    }

    async function runStandalone(temperature: "warm" | "cold", seriesOrdinal: number, count: number) {
      const started = now();
      const series = await prepareStandaloneProductLaunchPerformanceSeries().catch(async (cause: unknown) => {
        const failure = { id: `standaloneWorkflow-${temperature}-${seriesOrdinal}`,
          stage: "prepareSeries", name: safeFailureName(cause), code: safeFailureCode(cause),
          reason: safeFailureReason(cause) };
        setupFailures.push(failure);
        console.error("Standalone performance series preparation failed", failure);
        await persist();
        throw new Error(`Performance series ${failure.id} failed during preparation: ${failure.name}`);
      });
      const setupTotalMs = now() - started;
      if (series.currency.resource.kind !== "postgres") {
        await series.close();
        throw new Error("Expected ordinary PostgreSQL standalone series");
      }
      const target = series.currency.resource.target;
      const trace = observationMode === "traced" ? createMixedMutationPerformanceTrace({
        controlPool: series.currency.resource.control.pool, targetPool: target.pool }) : undefined;
      try {
        if (Object.keys(measuredEnvironment).length === 0) {
          const recordedEnvironment = await environment(target);
          measuredEnvironment = recordedEnvironment;
          measuredSourceHashes = recordedEnvironment.sourceHashes;
        }
        profileSelections.standaloneWorkflow = { revision: series.profileRevision,
          resourceCalls: series.resourceCalls };
        for (let index = 0; index < count; index++) {
          const kind: PerformanceTemperature = temperature === "cold" ? "cold"
            : index < planned.warmups ? "warmup" : "warm";
          const id = `standaloneWorkflow-${temperature}-${seriesOrdinal}-${index}`;
          let seedMs: number | null = null;
          let before: PerformanceInventory | null = null;
          let after: PerformanceInventory | null = null;
          let wallMs: number | null = null;
          let recorded: TraceInvocationRecord | null = null;
          let failureName: string | null = null;
          let failureStage: string | null = null;
          let failureCode: string | null = null;
          let failureReason: string | null = null;
          let failureDiagnosticTokens: readonly string[] = [];
          let cpuDiagnosticSecondaryFailures: readonly Readonly<{ stage: string; name: string }>[] = [];
          let stage = "prepareSeed";
          const suffix = `standalone-${temperature}-${seriesOrdinal}-${index}`;
          try {
            const seedStarted = now();
            const { seed } = await series.prepareSeed(suffix);
            seedMs = now() - seedStarted;
            stage = "inventoryBefore";
            before = await inventory(target, false);
            const invocationStarted = now();
            try {
              stage = "invoke";
              const invoke = () => trace === undefined ? series.run(seed) : trace.withInvocation({ id,
                mode: kind === "warmup" && index === 0 ? "recon" : "measured" },
              () => trace.withPhase("standalone native workflow", () => series.run(seed)));
              const result = cpuDiagnostic ? await captureMixedMutationCpuProfile({ id,
                workload: "standaloneWorkflow", temperature: kind, root, outputDirectory,
                revision, workingDiffSha256: raw.workingDiffSha256,
                sourceHashes: measuredSourceHashes }, invoke,
              elapsed => { wallMs = elapsed; }) : await invoke();
              if (!cpuDiagnostic) wallMs = now() - invocationStarted;
              stage = "verifyWorkflowGraph";
              verifyWorkflowGraph({ workflow: result }, seed.productId, seed.tagId);
            } catch (cause) { if (!cpuDiagnostic) wallMs = now() - invocationStarted; throw cause; }
            if (trace !== undefined) {
              stage = "traceReconciliation";
              recorded = traceRecord(trace, id);
              if (recorded === null || recorded.outcome !== "ok") throw new Error("MissingSuccessfulTraceRecord");
            }
            stage = "inventoryAfter";
            after = await inventory(target, false);
            stage = "retireLaunchedTag";
            if (index + 1 < count) await series.retireLaunchedTag(seed, suffix);
          } catch (cause) {
            if (cause instanceof MixedMutationCpuDiagnosticFailure && !cause.hasPrimaryFailure &&
              wallMs === null && cause.secondaryFailures.some(item => item.stage === "setup"))
              stage = "cpuDiagnosticSetup";
            failureName = safeFailureName(cause);
            failureStage = stage;
            failureCode = safeFailureCode(cause);
            failureReason = safeFailureReason(cause);
            failureDiagnosticTokens = safeDiagnosticTokens(cause);
            if (cause instanceof MixedMutationCpuDiagnosticFailure)
              cpuDiagnosticSecondaryFailures = cause.secondaryFailures;
            console.error("Standalone performance sample failed", { id, stage, failureName, failureCode,
              failureReason, failureDiagnosticTokens });
            if (trace !== undefined) {
              try { recorded ??= traceRecord(trace, id); }
              catch { failureName = "TraceReconciliationFailure"; failureStage = "traceReconciliation"; }
            }
            if (before !== null && after === null) after = await inventory(target, false).catch(() => null);
          }
          if (trace !== undefined) collect(trace, recorded, `standaloneWorkflow-${temperature}-${seriesOrdinal}`);
          let summary: PerformanceSample["trace"] = null;
          if (recorded !== null && trace !== undefined) {
            try {
              summary = summarizeMixedMutationTrace(recorded, trace.ownerMappings().map(sanitizeOwnerMapping));
              const issue = failureName === null ? traceCoverageIssue(summary, "standaloneWorkflow") : null;
              if (issue !== null) { failureName = "TracePhaseCoverageFailure"; failureReason = issue;
                failureStage = "traceCoverage"; }
              if (failureName === null && summary.transactionGroups.some(group => group.outcome === "open-at-end")) {
                failureName = "OpenTransactionAtRequestEnd";
                failureStage = "traceCoverage";
              }
            }
            catch { failureName ??= "TraceCoverageFailure"; failureStage ??= "traceCoverage"; }
          }
          if (failureStage === "traceCoverage") console.error("Standalone performance trace failed", { id,
            failureName, unobserved: recorded?.unobservedDispatches,
            lostContextDispatches: recorded?.lostContextDispatches,
            incompleteSpans: recorded?.incompleteSpans,
            poolQueryCalls: recorded?.poolQueryCalls,
            delegatedPoolQueryDispatches: recorded?.delegatedPoolQueryDispatches });
          samples.push({ id, workload: "standaloneWorkflow", temperature: kind, index,
            status: failureName === null ? "ok" : "error", failureName, failureStage,
            failureCode, failureReason, failureDiagnosticTokens, wallMs,
            ...(cpuDiagnostic ? { cpuDiagnosticSecondaryFailures } : {}),
            requestWorkerConstructionMs: null, sealedJournalBytes: null,
            instrumentationFinalizationMs: wallMs === null || recorded === null ? null :
              Math.max(0, wallMs - recorded.durationMs),
            construction: construction({ setupTotalMs: index === 0 ? setupTotalMs : null,
              provisioningMs: index === 0 ? series.provisioningAndInstallationMs : null,
              standaloneRuntimeConstructionMs: index === 0 ? series.runtimeConstructionMs : null,
              seedingMs: seedMs }), inventoryBefore: before, inventoryAfter: after, trace: summary });
          await persist();
          if (failureName !== null) throw new Error(`Performance sample ${id} failed at ${failureStage}: ${failureName}`);
        }
      } finally {
        try { trace?.close(); } finally { await series.close(); }
      }
    }

    try {
      for (const workload of ["product", "productPayload", "mixedWorkflow"] as const) {
        if (!plannedWorkloads.includes(workload)) continue;
        await runMixed(workload, "warm", 0, planned.warmups + planned.warm);
        for (let index = 0; index < planned.cold; index++) await runMixed(workload, "cold", index, 1);
      }
      if (plannedWorkloads.includes("standaloneWorkflow")) {
        await runStandalone("warm", 0, planned.warmups + planned.warm);
        for (let index = 0; index < planned.cold; index++) await runStandalone("cold", index, 1);
      }
    } finally { await persist(); }
    const expected = planned.warmups + planned.warm + planned.cold;
    for (const workload of plannedWorkloads) {
      const observed = samples.filter(sample => sample.workload === workload);
      expect(observed).toHaveLength(expected);
      expect(observed.every(sample => sample.status === "ok")).toBe(true);
    }
  }, 7_200_000);
});
