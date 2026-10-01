import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Schema, Tracer } from "effect";
import { expect } from "vitest";
import type { JsonObject } from "flarex-protocol/json";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import type { CommerceTransactionError } from "../../persistence-postgres/src/commerceTransaction/model";
import { createMixedMutationPerformanceTrace, type MixedMutationPerformanceTrace,
  type TraceInvocationRecord } from "../../persistence-postgres/test/mixedMutationPerformanceTrace";
import { createMixedMutationProductFixture, type MixedMutationProductFixtureHooks } from "./support/mixedMutationProductFixture";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sourcePaths = [
  "packages/persistence-postgres/src/transactionSessionActivation.ts",
  "packages/persistence-postgres/src/transactionSessionAttemptKernel.ts",
  "packages/persistence-postgres/src/sessionJournalStore.ts",
  "packages/persistence-postgres/src/locatedReadCommittedEffect.ts",
  "packages/persistence-postgres/src/postgresLocatedReadCommitted.ts",
  "packages/persistence-postgres/src/postgres.ts",
  "packages/persistence-postgres/src/scopeClock.ts",
  "packages/persistence-postgres/src/transactionExecutionClaimPersistence.ts",
  "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts",
  "packages/persistence-postgres/src/logicalDocuments/workingSet.ts",
  "packages/persistence-postgres/src/logicalDocuments/relationalRows.ts",
  "packages/persistence-postgres/src/logicalDocuments/relationalQuery.ts",
  "packages/persistence-postgres/src/logicalDocuments/indexReads.ts",
  "packages/persistence-postgres/src/appRows.ts",
  "packages/persistence-postgres/src/logicalStorageReadiness.ts",
  "packages/persistence-postgres/src/logicalStorageDefinitions.ts",
  "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts",
  "packages/persistence-postgres/src/logicalSearchBuild.ts",
  "packages/persistence-postgres/src/indexBuildStates.ts",
  "packages/persistence-postgres/src/indexBuildReconciliation.ts",
  "packages/persistence-postgres/src/physicalDefinitionLifecycle.ts",
  "packages/persistence-postgres/src/preparedMetadataEpoch.ts",
  "packages/persistence-postgres/src/preparedHostRuntime.ts",
  "packages/persistence-postgres/src/applicationBindingProjection.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts",
  "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts",
  "packages/persistence-postgres/src/applicationActivation.ts",
  "packages/persistence-postgres/src/applicationReadiness.ts",
  "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts",
  "packages/persistence-postgres/test/mixedMutationPerformanceTrace.ts",
  "packages/flarex-backend/test/support/mixedMutationProductFixture.ts",
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
}

const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")] as const)));

/** Component consumer only: all selection, authority, storage, decoding and
 * settlement remain in the real fixture and existing core owners. */
export async function runCheckedReadPerformanceScenario(driver: "pglite" | "postgres") {
  const stage = Schema.decodeUnknownSync(Schema.Literals(["baseline", "matched-baseline", "candidate"]))(
    process.env.FLAREX_CHECKED_READ_PERF_STAGE ?? "baseline");
  const hashesBefore = await sourceHashes();
  const lanes = [];
  for (const observation of ["untraced", "traced"] as const) {
    const samples: ReadSample[] = [];
    const sampleCount = observation === "untraced" ? 6 : 2;
    let trace: MixedMutationPerformanceTrace | undefined;
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>> | undefined;
    let admissionStartedAt = 0;
    const setupStartedAt = performance.now();
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
      const startedAt = performance.now();
      // Forward interruption into the real read fiber and preserve its entire
      // Cause across the trace's Promise boundary.
      const exit = readTrace === undefined ? yield* Effect.exit(observedRead) : yield* Effect.promise(signal =>
        readTrace.withInvocation({ id, mode: "recon" }, () =>
          readTrace.withPhase(readCase, () => Effect.runPromiseExit(observedRead, { signal }))));
      const wallMs = performance.now() - startedAt;
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
        trace: record, effectSpans: readTrace === undefined ? null : [...spanGroups.values()] });
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
      const worker = await fixture.runWorkerd();
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
      finally { trace?.close(); }
    }
  }
  expect(await sourceHashes()).toEqual(hashesBefore);
  const report = { format: "flarex.checked-read-component-performance", stage, sourceBase: "6a5391110",
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
