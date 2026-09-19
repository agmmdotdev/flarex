import { writeFile } from "node:fs/promises";
import { eq, getTableName } from "drizzle-orm";
import { Effect, Schema, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { createApplicationNativeMutationPostgresFixture } from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { fxAppRowRevisions, fxAppRowCurrent, fxAppIndexEntryRevisions, fxAppIndexEntryCurrent,
  fxAppUniqueKeys, fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds, fxSystemAppSchemaCandidateValidations,
  fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes, fxSystemCommitAppRowChanges, fxSystemScopeClocks,
  fxSystemTransactionSessions, fxSystemSnapshotLeases, fxSystemTransactionJournals,
  fxSystemTransactionExecutionClaims, fxSystemTransactionJournalLatestReceipts, fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalIndexRanges, fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalWriteEvents } from "@flarex/persistence-postgres/internal/system-test/schema";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/postgres";
import { readCe0Environment } from "@flarex/persistence-postgres/internal/system-test/ce0-environment";
import { withPostgresExecutionObservation, type PostgresExecutionPhase } from
  "@flarex/persistence-postgres/internal/system-test/postgres-execution-observation";
import { invokeApplicationMutation, makeApplicationMutationSystemLayer } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from "flarex-backend/artifact-runtime";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { decodeCanonicalAppDocumentEvidenceV1 } from "flarex-protocol/app-document";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { ApplicationNativeWorkerLoader, durableCounts, makeApplicationMutationTestLive } from
  "../../support/applicationNativeMutationHarness";
import { runSystemTestEffectV1 } from "../../support/systemTestEffectBoundaryV1";
import { expectOrdinaryPostgres18, postgresUrl, withTemporarySplitPostgresPersistence } from "../support/databaseFixturesV1";

type Observation = Awaited<ReturnType<typeof withPostgresExecutionObservation>>["observation"];
interface Sample {
  readonly pair: number;
  readonly mode: "normal" | "instrumented";
  readonly elapsedMilliseconds: number;
  readonly control: Observation | null;
  readonly target: Observation | null;
  readonly replay: { readonly control: Observation; readonly target: Observation };
}

describe.skipIf(postgresUrl === null)("CE0 native invocation attribution", () => {
  it("measures real invocation owners with a scripted Worker transport and exact replay", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expectOrdinaryPostgres18(persistence.control);
      await expectOrdinaryPostgres18(persistence.target);
      const sourcePaths = [
        "../../system-test/test/integration/applicationNativeMutationMeasurement.postgres.test.ts",
        "../../system-test/support/applicationNativeMutationHarness.ts",
        "./fixtures/applicationNativeMutationTestFixture.ts",
      ];
      const environment = {
        control: await readCe0Environment(persistence.control, sourcePaths),
        target: await readCe0Environment(persistence.target, sourcePaths),
      };
      const fixture = await createApplicationNativeMutationPostgresFixture({
        runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY, compatibilityDate: "2026-06-14",
      }, persistence);
      // The active-head decoder identifies stored readiness contract 1 as legacy.
      expect((await persistence.target.query("select readiness_contract_version from fx_system_application_active_head")).rows)
        .toEqual([{ readiness_contract_version: 1 }]);
      const loader = new ApplicationNativeWorkerLoader();
      const layer = makeApplicationMutationSystemLayer(await makeApplicationMutationTestLive(fixture, loader));
      const functionPath = TransactionFunctionPathV1Schema.make("users:create");
      const samples: Sample[] = [];
      for (let pair = -1; pair < 5; pair++) {
        const order = pair % 2 === 0 ? ["normal", "instrumented"] as const : ["instrumented", "normal"] as const;
        for (const mode of order) {
          const key = TransactionRequestKeyV1Schema.make(`ce0-native/${crypto.randomUUID()}`);
          const name = `native-${pair}`;
          const args = { name };
          const before = await durableCounts(persistence.target);
          const beforeClock = await persistence.target.getScopeClock(fixture.authority.scopeId);
          if (beforeClock === null) throw new Error("Missing native fixture clock");
          const loadsBefore = loader.loads;
          const invocationsBefore = loader.requestReceipts.length;
          const invoke = (tracer?: Tracer.Tracer) => {
            const request = Effect.scoped(invokeApplicationMutation(functionPath, args, key).pipe(Effect.provide(layer)));
            return runSystemTestEffectV1(tracer === undefined ? request : request.pipe(Effect.provideService(Tracer.Tracer, tracer)));
          };
          const observe = () => withPostgresExecutionObservation(persistence.control.pool, markControl =>
            withPostgresExecutionObservation(persistence.target.pool, async markTarget => {
              const mark = (phase: PostgresExecutionPhase) => { markControl(phase); markTarget(phase); };
              mark("nativeAdmission");
              const tracer = Tracer.make({ span(options) {
                const span = new Tracer.NativeSpan(options);
                if (options.name === "ApplicationExecutionHost.runTransaction") {
                  mark("nativeExecution");
                  const end = span.end.bind(span);
                  span.end = (...args) => { end(...args); mark("nativeFinalization"); };
                }
                return span;
              } });
              return invoke(tracer);
            }));
          const started = performance.now();
          const measured = mode === "instrumented" ? await observe() : null;
          const published = measured === null ? await invoke() : measured.value.value;
          const elapsedMilliseconds = performance.now() - started;
          expect(published.disposition).toBe("published");
          expect(published.commitSeq).toBe(beforeClock.lastCommitSeq + 1n);
          expect(loader.loads).toBe(loadsBefore + 1);
          expect(loader.requestReceipts.length).toBe(invocationsBefore + 1);
          const identity = decodeAppDocumentIdentityV1(published.value);
          // This fixture owns its target schema; exactly one row may use this sequence.
          const rows = await persistence.target.drizzle.select().from(fxAppRowRevisions)
            .where(eq(fxAppRowRevisions.commitSeq, CommitSeqSchema.make(published.commitSeq)));
          expect(rows).toHaveLength(1);
          const row = rows[0];
          if (row === undefined || row.valueBytes === null || row.valueSha256 === null) throw new Error("Missing native row body");
          expect(row.isTombstone).toBe(false);
          expect(row.tableId).toBe(identity.tableId);
          expect(encodeBytesToLowercaseHex(row.rowId)).toBe(identity.rowId);
          const document = await decodeCanonicalAppDocumentEvidenceV1({
            codecVersion: row.valueCodecVersion, canonicalBytes: row.valueBytes, sha256: row.valueSha256,
            tableId: row.tableId, rowId: identity.rowId, creationTime: row.creationTime,
          });
          expect(document.value).toEqual({ _id: identity.id, _creationTime: row.creationTime, name });
          const after = await durableCounts(persistence.target);
          expect(after).toEqual({ commits: before.commits + 1, outcomes: before.outcomes + 1,
            feed: before.feed + 1, outbox: before.outbox + 1 });
          if (measured !== null) {
            const phases = measured.value.observation.phases;
            for (const phase of ["nativeAdmission", "nativeExecution", "nativeFinalization"]) {
              expect(phases[phase]?.queryCalls).toBeGreaterThan(0);
            }
          }
          const stateBeforeReplay = await nativeDurableSnapshot(persistence.target);
          const replay = await observe();
          expect(replay.value.value).toEqual({ ...published, disposition: "replayed" });
          expect(loader.loads).toBe(loadsBefore + 1);
          expect(loader.requestReceipts.length).toBe(invocationsBefore + 1);
          expect(await durableCounts(persistence.target)).toEqual(after);
          expect(await nativeDurableSnapshot(persistence.target)).toEqual(stateBeforeReplay);
          expect((await persistence.target.getScopeClock(fixture.authority.scopeId))?.lastCommitSeq).toBe(published.commitSeq);
          expect(replay.value.observation.phases.nativeExecution).toBeUndefined();
          for (const observation of [replay.observation, replay.value.observation]) {
            // This replay profile emits no CTEs; do not silently admit an opaque WITH write.
            expect(Object.keys(observation.commands).every(verb => ["select", "begin", "set", "commit"].includes(verb))).toBe(true);
          }
          if (pair >= 0) samples.push({ pair, mode, elapsedMilliseconds,
            control: measured?.observation ?? null, target: measured?.value.observation ?? null,
            replay: { control: replay.observation, target: replay.value.observation } });
        }
      }
      const ratios = Array.from({ length: 5 }, (_, pair) => {
        const normal = samples.find(sample => sample.pair === pair && sample.mode === "normal");
        const observed = samples.find(sample => sample.pair === pair && sample.mode === "instrumented");
        if (normal === undefined || observed === undefined) throw new Error("Missing paired native sample");
        return observed.elapsedMilliseconds / normal.elapsedMilliseconds;
      });
      const medianPairedRatio = median(ratios);
      const report = { workload: "one-row public native invocation through real admission, crypto, host, journal and publication",
        readinessProfile: "legacy Application readiness through the existing native acceptance fixture",
        boundary: "setup, key/input creation and correctness readback excluded; duplicate replay measured separately",
        limitations: "scripted Worker RPC body; no source evaluation, Workerd, network or full independent reference; pool elapsed intervals overlap",
        environment, warmupPairs: 1, measuredPairs: 5, samples, summary: { medianPairedRatio,
          observerMedianTolerance: 0.05, observerWithinTolerance: Math.abs(medianPairedRatio - 1) <= 0.05,
          normalMedianMilliseconds: median(samples.filter(sample => sample.mode === "normal").map(sample => sample.elapsedMilliseconds)),
          instrumentedMedianMilliseconds: median(samples.filter(sample => sample.mode === "instrumented").map(sample => sample.elapsedMilliseconds)) } };
      if (process.env.FLAREX_CE0_NATIVE_INVOCATION_REPORT_PATH !== undefined) {
        await writeFile(process.env.FLAREX_CE0_NATIVE_INVOCATION_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
      }
      console.info("CE0 native invocation", JSON.stringify(report));
    });
  }, 240_000);
});

const nativeDurableTables = [fxAppRowRevisions, fxAppRowCurrent, fxAppIndexEntryRevisions, fxAppIndexEntryCurrent,
  fxAppUniqueKeys, fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds, fxSystemAppSchemaCandidateValidations,
  fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes, fxSystemCommitAppRowChanges, fxSystemScopeClocks,
  fxSystemTransactionSessions, fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalLatestReceipts, fxSystemTransactionJournalPoints, fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies, fxSystemTransactionJournalWriteEvents];
const decodeSnapshot = Schema.decodeUnknownSync(Schema.Struct({ snapshot: Schema.String }));

/** Exact logical state, outside timing, in a small exclusively owned schema.
 * Names come only from the checked-in schema; JSON text preserves bigint values. */
async function nativeDurableSnapshot(persistence: PostgresFlarexPersistence) {
  const entries = await Promise.all(nativeDurableTables.map(async table => {
    const name = getTableName(table);
    const result = await persistence.query(`select coalesce(jsonb_agg(to_jsonb(stored)
      order by to_jsonb(stored)::text), '[]'::jsonb)::text as snapshot from "${name}" as stored`);
    return [name, decodeSnapshot(result.rows[0]).snapshot] as const;
  }));
  return Object.fromEntries(entries);
}

function median(values: readonly number[]): number {
  const value = values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  if (value === undefined) throw new Error("Missing native timing samples");
  return value;
}
