import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Schema, Tracer } from "effect";
import { expect, vi } from "vitest";
import type { JsonObject } from "flarex-protocol/json";
import {
  decodePointMutationExactRuntimeResultV1Effect,
} from "flarex-protocol/point-mutation-exact-runtime";
import type {
  CommerceTransactionError,
} from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import * as appRows from "../../persistence-postgres/src/storage/documents/appRows";
import {
  createMixedMutationPerformanceTrace,
  type MixedMutationPerformanceTrace,
  type TraceInvocationRecord,
} from "../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";
import {
  createMixedMutationProductFixture,
  type MixedMutationProductFixtureHooks,
} from "./support/mixedMutationWorkerdFixture";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sourcePaths = [
  "packages/persistence-postgres/src/execution/transactionSessionActivation.ts",
  "packages/persistence-postgres/src/execution/transactionSessionAttemptKernel.ts",
  "packages/persistence-postgres/src/execution/exactRunningAttemptTail.ts",
  "packages/persistence-postgres/drizzle/0121_exact_running_attempt_tail.sql",
  "packages/persistence-postgres/drizzle/meta/_journal.json",
  "packages/persistence-postgres/src/execution/sessionJournalStore.ts",
  "packages/persistence-postgres/src/database/locatedReadCommittedEffect.ts",
  "packages/persistence-postgres/src/database/postgresLocatedReadCommitted.ts",
  "packages/persistence-postgres/src/database/postgres.ts",
  "packages/persistence-postgres/src/database/pglite.ts",
  "packages/persistence-postgres/src/scope/scopeClock.ts",
  "packages/persistence-postgres/src/execution/claims/transactionExecutionClaimPersistence.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalAdmission.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalRows.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalQuery.ts",
  "packages/persistence-postgres/src/storage/documents/logicalDocuments/indexReads.ts",
  "packages/persistence-postgres/src/storage/documents/appRows.ts",
  "packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts",
  "packages/persistence-postgres/src/storage/catalog/logicalStorageDefinitions.ts",
  "packages/persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1.ts",
  "packages/persistence-postgres/src/storage/search/logicalSearchBuild.ts",
  "packages/persistence-postgres/src/storage/indexes/indexBuildStates.ts",
  "packages/persistence-postgres/src/storage/indexes/indexBuildReconciliation.ts",
  "packages/persistence-postgres/src/installation/physicalDefinitionLifecycle.ts",
  "packages/persistence-postgres/src/execution/preparation/preparedMetadataEpoch.ts",
  "packages/persistence-postgres/src/execution/preparation/preparedHostRuntime.ts",
  "packages/persistence-postgres/src/application/applicationBindingProjection.ts",
  "packages/persistence-postgres/src/installation/frameworkSchema/binding/repository.ts",
  "packages/persistence-postgres/src/installation/frameworkSchema/binding/logicalSchema.ts",
  "packages/persistence-postgres/src/application/activation/acceptedBinding.ts",
  "packages/persistence-postgres/src/application/activation/activationPersistence.ts",
  "packages/persistence-postgres/src/application/activation/activeRead.ts",
  "packages/persistence-postgres/src/application/activation/bindingAcceptance.ts",
  "packages/persistence-postgres/src/application/activation/bindingPreparation.ts",
  "packages/persistence-postgres/src/application/activation/capture.ts",
  "packages/persistence-postgres/src/application/activation/constructionContracts.ts",
  "packages/persistence-postgres/src/application/activation/contracts.ts",
  "packages/persistence-postgres/src/application/activation/currentBinding.ts",
  "packages/persistence-postgres/src/application/activation/currentEntryIdentity.ts",
  "packages/persistence-postgres/src/application/activation/databaseBoundary.ts",
  "packages/persistence-postgres/src/application/activation/errors.ts",
  "packages/persistence-postgres/src/application/activation/finiteIdentity.ts",
  "packages/persistence-postgres/src/application/activation/finitePreparation.ts",
  "packages/persistence-postgres/src/application/activation/headCapture.ts",
  "packages/persistence-postgres/src/application/activation/limits.ts",
  "packages/persistence-postgres/src/application/activation/metadataProjection.ts",
  "packages/persistence-postgres/src/application/activation/readBindingPublication.ts",
  "packages/persistence-postgres/src/application/activation/repository.ts",
  "packages/persistence-postgres/src/application/activation/repositoryIdentity.ts",
  "packages/persistence-postgres/src/application/activation/selectionIdentity.ts",
  "packages/persistence-postgres/src/application/activation/standaloneBinding.ts",
  "packages/persistence-postgres/src/application/applicationActivationApi.ts",
  "packages/persistence-postgres/src/application/activeHead/contracts.ts",
  "packages/persistence-postgres/src/application/activeHead/errors.ts",
  "packages/persistence-postgres/src/application/activeHead/identity.ts",
  "packages/persistence-postgres/src/application/readiness/acceptance.ts",
  "packages/persistence-postgres/src/application/readiness/activationTarget.ts",
  "packages/persistence-postgres/src/application/readiness/bundle.ts",
  "packages/persistence-postgres/src/application/readiness/coldEvidence.ts",
  "packages/persistence-postgres/src/application/readiness/constructionContracts.ts",
  "packages/persistence-postgres/src/application/readiness/contracts.ts",
  "packages/persistence-postgres/src/application/readiness/controlSchema.ts",
  "packages/persistence-postgres/src/application/readiness/databaseBoundary.ts",
  "packages/persistence-postgres/src/application/readiness/errors.ts",
  "packages/persistence-postgres/src/application/readiness/frames.ts",
  "packages/persistence-postgres/src/application/readiness/identity.ts",
  "packages/persistence-postgres/src/application/readiness/limits.ts",
  "packages/persistence-postgres/src/application/readiness/outcomes.ts",
  "packages/persistence-postgres/src/application/readiness/persistence.ts",
  "packages/persistence-postgres/src/application/readiness/physicalCoverage.ts",
  "packages/persistence-postgres/src/application/readiness/preparation.ts",
  "packages/persistence-postgres/src/application/readiness/repository.ts",
  "packages/persistence-postgres/src/application/readiness/storedAuthority.ts",
  "packages/persistence-postgres/src/frameworks/commerceTransaction/borrowedLogicalAttempt.ts",
  "packages/persistence-postgres/test/performance/mixedMutationPerformanceTrace.ts",
  "packages/executor/test/performance/support/mixedMutationProductFixture.ts",
  "packages/executor/test/performance/support/mixedMutationInProcessRuntime.ts",
  "packages/flarex-backend/test/support/mixedMutationWorkerdFixture.ts",
  "packages/flarex-backend/test/support/mixedMutationWorkerdAdapter.ts",
  "packages/flarex-backend/test/checkedReadPerformanceScenario.ts",
  "packages/flarex-backend/test/checkedReadPerformance.test.ts",
  "packages/flarex-backend/test/checkedReadPerformance.postgres.test.ts",
] as const;

type ReadCase = "product-id-hit" | "product-id-miss" | "handle-index-hit" |
  "handle-index-miss" | "pending-product-id-hit";
interface ReadSample {
  readonly case: ReadCase;
  readonly index: number;
  readonly demand: "first" | "successive";
  readonly wallMs: number;
  readonly returnedRows: number;
  /** Actual JSON encoding of the returned projection, not driver wire bytes. */
  readonly returnedJsonBytes: number;
  readonly trace: TraceInvocationRecord | null;
  readonly effectSpans: readonly Readonly<{ name: string; count: number; inclusiveMs: number }>[] | null;
  /** Forwarded owner calls, not observed SQL parameter or server work. */
  readonly issuedFrontierTableIds: readonly (readonly number[])[] | null;
}

const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")] as const)));

/** Component consumer only: all selection, authority, storage, decoding and
 * settlement remain in the real fixture and existing core owners. */
export async function runCheckedReadPerformanceScenario(driver: "pglite" | "postgres") {
  const stage = Schema.decodeUnknownSync(Schema.Literals(["baseline", "matched-baseline", "candidate"]))(
    process.env.FLAREX_CHECKED_READ_PERF_STAGE ?? "baseline");
  const iteration = Schema.decodeUnknownSync(Schema.Literals(["immutable-preparation", "dispatch-composition"]))(
    process.env.FLAREX_CHECKED_READ_PERF_ITERATION ?? "immutable-preparation");
  const hashesBefore = await sourceHashes();
  const lanes = [];
  for (const observation of ["untraced", "traced"] as const) {
    const samples: ReadSample[] = [];
    const sampleCount = observation === "untraced" ? 6 : 2;
    let trace: MixedMutationPerformanceTrace | undefined;
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>> | undefined;
    let admissionStartedAt = 0;
    const setupStartedAt = performance.now();
    let currentFrontierCalls: number[][] | undefined;
    const actualReadFrontiers = appRows.readAppTableWriteFrontiersInTransactionEffect;
    const frontierObserver = iteration === "dispatch-composition" && observation === "traced" && driver === "postgres"
      ? vi.spyOn(appRows, "readAppTableWriteFrontiersInTransactionEffect").mockImplementation((...args) => {
        currentFrontierCalls?.push([...args[2]]);
        return actualReadFrontiers(...args);
      }) : undefined;
    const measure = Effect.fn(function* (readCase: ReadCase, index: number,
      read: Effect.Effect<readonly JsonObject[], CommerceTransactionError>) {
      const id = `${readCase}/${index}`;
      const readTrace = trace;
      const spans: Tracer.Span[] = [];
      const delegate = yield* Effect.tracer;
      const spanObserver = Tracer.make({ span: options => {
        const span = delegate.span(options);
        spans.push(span);
        return span;
      } });
      const observedRead = readTrace === undefined ? read : Effect.withTracer(read, spanObserver);
      const issuedFrontierTableIds: number[][] | null = frontierObserver === undefined ? null : [];
      currentFrontierCalls = issuedFrontierTableIds ?? undefined;
      const startedAt = performance.now();
      // Forward interruption into the real read fiber and preserve its entire
      // Cause across the trace's Promise boundary.
      const exit = readTrace === undefined ? yield* Effect.exit(observedRead) : yield* Effect.promise(signal =>
        readTrace.withInvocation({ id, mode: "recon" }, () =>
          readTrace.withPhase(readCase, () => Effect.runPromiseExit(observedRead, { signal }))));
      const wallMs = performance.now() - startedAt;
      currentFrontierCalls = undefined;
      if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
      const rows = exit.value;
      expect(rows).toHaveLength(readCase.endsWith("miss") ? 0 : 1);
      const record = trace?.records().find(record => record.id === id) ?? null;
      if (record !== null) {
        expect(record.unknownStatementDispatches).toBe(0);
        expect(record.unobservedDispatches).toBe(0);
        expect(record.lostContextDispatches).toBe(0);
        expect(record.transactions.every(tx => tx.outcome === "commit")).toBe(true);
        if (readCase === "pending-product-id-hit") expect(record.dispatches).toHaveLength(0);
        else expect(record.transactions).toHaveLength(1);
        if (iteration === "dispatch-composition") {
          const pending = readCase === "pending-product-id-hit";
          const expected = pending ? 0 : (readCase === "product-id-hit" ? 21 : 20) - (stage === "candidate" ? 3 : 0);
          expect(record.dispatches).toHaveLength(expected);
          // Match the actual FROM call; installation attestation also names the function.
          expect(record.dispatches.filter(dispatch => dispatch.template !== null &&
            /\bfrom fx_lock_running_attempt_tail \( \$\? , \$\? , \$\? , \$\? \) as attempt_tail\b/.test(dispatch.template)))
            .toHaveLength(pending || stage !== "candidate" ? 0 : 1);
          expect(issuedFrontierTableIds).toHaveLength(pending ? 0 : stage === "candidate" ? 1 : 2);
        }
      }
      const spanGroups = new Map<string, { name: string; count: number; inclusiveMs: number }>();
      for (const span of spans) {
        const group = spanGroups.get(span.name) ?? { name: span.name, count: 0, inclusiveMs: 0 };
        group.count++;
        if (span.status._tag === "Ended")
          group.inclusiveMs += Number(span.status.endTime - span.status.startTime) / 1_000_000;
        spanGroups.set(span.name, group);
      }
      samples.push({ case: readCase, index, demand: index === 0 ? "first" : "successive",
        wallMs, returnedRows: rows.length, returnedJsonBytes: Buffer.byteLength(JSON.stringify(rows)),
        trace: record, effectSpans: readTrace === undefined ? null : [...spanGroups.values()], issuedFrontierTableIds });
    });
    try {
      fixture = await createMixedMutationProductFixture({ driver,
        suffix: `checked-read-${observation}-${driver}`,
        hooks: {
          onPreparedContext: async currency => {
            admissionStartedAt = performance.now();
            if (observation === "traced" && currency.resource.kind === "postgres") {
              trace = createMixedMutationPerformanceTrace({ controlPool: currency.resource.control.pool,
                targetPool: currency.resource.target.pool });
            }
            return trace;
          },
          afterProductBorrow: Effect.fn(function* (method: string,
            borrowed: Parameters<NonNullable<MixedMutationProductFixtureHooks["afterProductBorrow"]>>[1]) {
            const current = fixture;
            if (current === undefined) throw new Error("Read probe escaped fixture initialization");
            if (method !== "update" && method !== "retrieve") return;
            const store = yield* borrowed.context.table("product");
            const select = (column: string, value: string) => store.find(borrowed.context.manager, {
              predicate: { kind: "and", children: [{ kind: "in", column, values: [value] },
                { kind: "isNull", column: "deleted_at" }] },
              order: { column: "id", direction: "asc" },
            });
            if (method === "retrieve") {
              for (let index = 0; index < sampleCount; index++)
                yield* measure("pending-product-id-hit", index, select("id", current.seed.productId));
              return;
            }
            yield* measure("product-id-hit", 0, select("id", current.seed.productId));
            for (let index = 0; index < sampleCount; index++)
              yield* measure("product-id-miss", index, select("id", `prod_checked_missing_${index}`));
            const originalHandle = current.baseline.handle;
            if (typeof originalHandle !== "string") throw new Error("Seeded native Product has no handle");
            // The row is already observed by the first id selection. This probe
            // measures a new index demand with a retained row observation.
            yield* measure("handle-index-hit", 0, select("handle", originalHandle));
            for (let index = 0; index < sampleCount; index++)
              yield* measure("handle-index-miss", index, select("handle", `checked-missing-${index}`));
          }),
        } });
      const admissionFinishedAt = performance.now();
      const worker = await fixture.runExecution();
      expect(worker).toMatchObject({ kind: "result", result: { kind: "success" } });
      const transport = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(worker);
      const result = await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(transport.result.result));
      const publication = await fixture.publish(result.value);
      expect(publication.kind).toBe("published");
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      expect(fixture.nativeInvokeCount.get("retrieve")).toBe(1);
      expect(fixture.nativeInvokeCount.get("listByHandle")).toBe(1);
      expect(samples).toHaveLength(2 + sampleCount * 3);
      const environment = fixture.currency.resource.kind === "postgres"
        ? (await fixture.currency.resource.target.pool.query<{
          version: string; role: string; superuser: boolean; fsync: string;
          synchronous_commit: string; full_page_writes: string;
        }>(`select version() as version, current_user as role,
          (select rolsuper from pg_roles where rolname = current_user) as superuser,
          current_setting('fsync') as fsync, current_setting('synchronous_commit') as synchronous_commit,
          current_setting('full_page_writes') as full_page_writes`)).rows[0]
        : { driver: "pglite" };
      if (driver === "postgres") expect(environment).toMatchObject({ superuser: false,
        fsync: "on", synchronous_commit: "on", full_page_writes: "on" });
      lanes.push({ observation: driver === "pglite" ? "correctness" : observation,
        requestedObservation: observation, poolTraceObserved: trace !== undefined,
        planned: { firstDemand: 1, successiveDistinctDemands: sampleCount - 1,
          positiveSelections: 1, pendingFirstAndRepeatedDemands: sampleCount },
        constructionAndSeedingMs: admissionStartedAt - setupStartedAt,
        initialAdmissionMs: admissionFinishedAt - admissionStartedAt,
        initialAdmissionTrace: trace?.records().find(record => record.id === "initial admission") ?? null,
        environment, samples, ownerMappings: trace?.ownerMappings() ?? [],
        builtInSqlObserver: fixture.hasSqlObserver });
    } finally {
      try { await fixture?.close(); }
      finally { frontierObserver?.mockRestore(); trace?.close(); }
    }
  }
  expect(await sourceHashes()).toEqual(hashesBefore);
  const report = { format: "flarex.checked-read-component-performance", stage, iteration,
    sourceBase: iteration === "dispatch-composition" ? "7d5cf2d27" : "6a5391110",
    schemaDisposition: iteration === "dispatch-composition"
      ? "Additive0121 installed in both lanes; baseline runtime leaves the function unused; candidate invokes it."
      : "Existing schema profile",
    driver, sourceHashes: hashesBefore, lanes,
    interpretation: [
      "Construction, seeding and initial full authentication/renewal are outside the component operation samples.",
      "Each lane uses one genuine finite attempt and source admission through the original native Product borrow.",
      "Distinct missing id/handle predicates force uncached selection demands in the same attempt; no cache is cleared.",
      "One positive id selection precedes one new handle-index demand whose row is already observed.",
      "Pending control runs after the genuine native update through the next genuine retrieve borrow.",
      "Untraced means no additional pool trace; the fixture's existing target SQL observer remains where present.",
      "Small reconnaissance trace samples include stack/observer overhead and do not establish steady latency.",
      "First/successive labels denote selection demands in one already prepared attempt, not cold/warm host construction.",
      "Positive selections have one observation each and provide no hit latency distribution.",
      "Named Effect spans are directly observed inclusive durations, not isolated CPU or additive phase times.",
      "SQL awaited intervals and whole transactions are client observations, not pure server or lock-hold times.",
      "PGlite is a correctness lane and provides no pool trace or PostgreSQL performance proof.",
      "Issued frontier table memberships forward actual owner calls unchanged; observed only in the PostgreSQL traced composition lane, not SQL parameter capture or server work.",
    ],
    unavailable: ["server execution time", "pure lock hold time", "driver wire bytes", "SQL parameter bytes",
      "isolated validation/decode CPU", "initial admission Effect span counts", "construction/seeding SQL counts"],
  };
  const output = process.env.FLAREX_CHECKED_READ_PERF_REPORT_DIR;
  if (output !== undefined) {
    await mkdir(output, { recursive: true });
    const normalizedRoot = root.replaceAll("\\", "/");
    const json = JSON.stringify(report, (_key, value: unknown) => typeof value === "string"
      ? value.replaceAll("\\", "/").replaceAll(normalizedRoot, ".") : value, 2);
    await writeFile(join(output, `${driver}-${stage}.json`), `${json}\n`);
  }
  return report;
}
