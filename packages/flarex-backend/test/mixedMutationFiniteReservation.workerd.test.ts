import { eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { MetadataSequenceSchema } from "flarex-protocol/commit-protocol";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { isNonArrayRecord } from "@flarex/utils/records";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { FiniteMetadataReservationSchema, MAX_FINITE_METADATA_RESERVATION_BYTES,
  readStoredFiniteMetadataReservation } from "../../persistence-postgres/src/finiteMetadataReservation";
import { fxAppRowRevisions, fxSystemCommits, fxSystemSnapshotLeases,
  fxSystemTransactionJournalReceipts } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
const dataRead = /\bfx_app_(?:row_(?:rev|current)|index_entry_(?:rev|current)|unique_key)\b/;

describe.each(drivers)("finite entry reservation integrity on %s", driver => {
  it("refuses a coherently rehashed lease watermark before the next uncached read and poisons seal", async () => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let checkingRead = false;
    let dataStatements = 0;
    let checked = false;
    let restoreObserver = () => {};
    const observe = (statement: string) => {
      if (checkingRead && dataRead.test(statement)) dataStatements++;
    };
    fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-reservation-tamper-${driver}`,
      hooks: {
        observeSql: (_phase, statement) => observe(statement),
        afterProductBorrow: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
          const store = yield* borrowed.context.table("product");
          const select = (id: string) => store.find(borrowed.context.manager, {
            predicate: { kind: "in" as const, column: "id", values: [id] },
            order: { column: "id", direction: "asc" as const },
          });
          checkingRead = true;
          expect(yield* select(fixture.seed.productId)).toHaveLength(1);
          checkingRead = false;
          expect(dataStatements).toBeGreaterThan(0);
          yield* Effect.tryPromise({ try: async () => {
            const database = fixture.currency.persistence.drizzle;
            const sessionId = fixture.activation.anchor.sessionId;
            const [lease] = await database.select().from(fxSystemSnapshotLeases)
              .where(eq(fxSystemSnapshotLeases.sessionId, sessionId));
            if (lease === undefined) throw new Error("Missing genuine finite entry lease");
            const reservation = await Effect.runPromise(readStoredFiniteMetadataReservation(lease));
            const metadataWatermark = MetadataSequenceSchema.make(reservation.metadataWatermark + 1n);
            // Negative forensic fixture only: the frame, digest and dedicated
            // column agree with each other, but differ from confirmed entry.
            const corrupt = await Effect.runPromise(capturePrivateCanonicalValue(
              Schema.encodeSync(FiniteMetadataReservationSchema)({ ...reservation, metadataWatermark }),
              MAX_FINITE_METADATA_RESERVATION_BYTES, {
                invalidInput: () => commerceError("resourceFailure"),
                hashFailure: cause => commerceError("resourceFailure", cause),
              }));
            try {
              await database.update(fxSystemSnapshotLeases).set({ metadataWatermark,
                finiteMetadataReservationBytes: corrupt.copyCanonicalBytes(),
                finiteMetadataReservationSha256: corrupt.copySha256Bytes() })
                .where(eq(fxSystemSnapshotLeases.sessionId, sessionId));
              dataStatements = 0;
              checkingRead = true;
              // This valid identity has not been observed by the working set.
              const refused = await Effect.runPromise(Effect.result(select("prod_00000000000000000000000000")));
              checkingRead = false;
              expect(Result.isFailure(refused)).toBe(true);
              if (Result.isFailure(refused)) expect(refused.failure).toMatchObject({
                _tag: "CommerceTransactionError", reason: "invalidAuthority",
              });
              expect(dataStatements).toBe(0);
              checked = true;
            } finally {
              checkingRead = false;
              await database.update(fxSystemSnapshotLeases).set({ metadataWatermark: lease.metadataWatermark,
                finiteMetadataReservationBytes: lease.finiteMetadataReservationBytes,
                finiteMetadataReservationSha256: lease.finiteMetadataReservationSha256 })
                .where(eq(fxSystemSnapshotLeases.sessionId, sessionId));
            }
          }, catch: cause => commerceError("resourceFailure", cause) });
        }),
      },
    });
    try {
      if (fixture.currency.resource.kind === "postgres") {
        // Observe the real driver's issued statements without changing results,
        // pool selection, transaction lifetime, or the checked read path.
        const pool = fixture.currency.resource.target.pool;
        const originals = new Map<PoolClient, PoolClient["query"]>();
        const onAcquire = (client: PoolClient) => {
          const original = client.query;
          client.query = new Proxy(original, { apply(query, receiver, args: unknown[]) {
            const first = args[0];
            observe(typeof first === "string" ? first
              : isNonArrayRecord(first) && typeof first.text === "string" ? first.text : "");
            return Reflect.apply(query, receiver, args);
          } });
          originals.set(client, original);
        };
        const onRelease = (_error: Error | undefined, client: PoolClient) => {
          const original = originals.get(client);
          if (original !== undefined) client.query = original;
          originals.delete(client);
        };
        pool.on("acquire", onAcquire); pool.on("release", onRelease);
        restoreObserver = () => {
          pool.off("acquire", onAcquire); pool.off("release", onRelease);
          for (const [client, original] of originals) client.query = original;
        };
      } else expect(fixture.hasSqlObserver).toBe(true);
      const database = fixture.currency.persistence.drizzle;
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const headersBefore = await database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid));
      const eventsBefore = await database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      const rowsBefore = await database.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid));
      await expect(fixture.runExecution()).rejects.toBeDefined();
      expect(checked, fixture.bridgeFailures.join("\n")).toBe(true);
      await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(fixture.attempt, null)))
        .rejects.toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
      expect(await database.select().from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId))).toHaveLength(0);
      expect(await database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid))).toEqual(headersBefore);
      expect(await database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid))).toEqual(eventsBefore);
      expect(await database.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))).toEqual(rowsBefore);
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } finally { restoreObserver(); await fixture.close(); }
  }, 180_000);
});
