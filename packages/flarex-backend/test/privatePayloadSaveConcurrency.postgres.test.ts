import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { deferredSignal, withTimeout } from "../../persistence-postgres/test/commit/point/support/postgresFaults";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { bindPrivatePayloadSave, preparePrivateSavePolicy } from "./support/privatePayloadSaveCommands";
import { publishedScopeCounts } from "./support/payloadCommerceReferenceFixture";
import { installPoolCommitResponseFault } from "./support/postgresCommitResponseFault";

const document = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String, featuredProduct: Schema.NullOr(Schema.String) }));

describe.skipIf(postgresUrl === null)("private authorized saves under ordinary-role PostgreSQL publication locks", () => {
  it("orders revocation and saves on distinct connections, then recovers a committed save after revocation", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) });
      try {
        const db = database.persistence;
        const scopeId = fixture.fixture.application.authority.scopeId;
        const counts = () => publishedScopeCounts(db.drizzle, scopeId);
        const identity = (await db.query<{ pid: number; role: string; superuser: boolean; bypass: boolean }>(
          `select pg_backend_pid()::int as pid, current_user as role, rolsuper as superuser, rolbypassrls as bypass
           from pg_roles where rolname=current_user`)).rows[0];
        if (identity === undefined) throw new Error("Missing actual PostgreSQL identity");
        expect(identity).toMatchObject({ superuser: false, bypass: false });
        const product = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await Effect.runPromise(fixture.productHost.run(
          fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductCreate,
          { title: "Authorized race Product", handle: "authorized-race-product" })));
        const allow = { source: { create: true, update: true, delete: true }, assign: [product.id], retain: [product.id] };
        const revoke = { ...allow, assign: [], retain: [] };
        const initial = await preparePrivateSavePolicy(fixture, allow);
        expect(await initial.root.publish()).toMatchObject({ kind: "published" });
        const policyId = initial.documentId;

        for (const winner of ["save", "revocation"] as const) {
          const reset = await preparePrivateSavePolicy(fixture, allow, policyId);
          await reset.root.publish();
          const root = await fixture.open();
          const saving = await bindPrivatePayloadSave(fixture, root, policyId);
          const entered = deferredSignal(), release = deferredSignal();
          const running: Promise<PromiseSettledResult<unknown>[]>[] = [];
          try {
            const result = await Effect.runPromise(saving.invoke("create", { collection: "posts",
              data: { title: `${winner} wins`, featuredProduct: product.id } }));
            if (result.kind !== "completed") throw new Error("Native save did not execute");
            const saved = document(result.result);
            const revocation = await preparePrivateSavePolicy(fixture, revoke, policyId);
            const hold = { afterTransactionStep: async (event: { step: string }) => {
              if (event.step === "clockLocked") { entered.resolve(); await release.promise; }
            } };
            const savePublication = await root.preparePublication(saved, {
              logicalOperationProfiles: [root.payloadProfile(saving.selected.profileRevision)], ...(winner === "save" ? hold : {}),
            });
            const revokePublication = await revocation.root.preparePublication(null, winner === "revocation" ? hold : {});
            const before = await counts();
            const first = Effect.runPromise((winner === "save" ? savePublication : revokePublication).publish);
            const firstDone = Promise.allSettled([first]); running.push(firstDone);
            await withTimeout(entered.promise, 10_000, "first real publication lock");
            const holders = (await db.query<{ pid: number; role: string }>(
              `select pid::int as pid, usename as role from pg_stat_activity where application_name=$1
               and datname=current_database() and state='idle in transaction'`, [database.schemaName])).rows;
            expect(holders).toHaveLength(1);
            const holder = holders[0];
            if (holder === undefined) throw new Error("Missing locked publisher connection");
            expect(holder.role).toBe(identity.role);
            const second = Effect.runPromise((winner === "save" ? revokePublication : savePublication).publish);
            const secondDone = Promise.allSettled([second]); running.push(secondDone);
            // Observe actual PostgreSQL blocking; elapsed time alone is not a race witness.
            const deadline = Date.now() + 10_000;
            let waiter: { pid: number; role: string } | undefined;
            do {
              waiter = (await db.query<{ pid: number; role: string }>(`select pid::int as pid, usename as role
                from pg_stat_activity where $1::int=any(pg_blocking_pids(pid)) and application_name=$2
                and datname=current_database()`, [holder.pid, database.schemaName])).rows[0];
              if (waiter !== undefined) break;
              await new Promise<void>(resolve => setTimeout(resolve, 2));
            } while (Date.now() < deadline);
            expect(waiter).toBeDefined();
            expect(waiter?.pid).not.toBe(holder.pid);
            expect(waiter?.role).toBe(identity.role);
            release.resolve();
            expect((await firstDone)[0]).toMatchObject({ status: "fulfilled", value: { kind: "published" } });
            expect((await secondDone)[0]).toMatchObject(winner === "save"
              ? { status: "fulfilled", value: { kind: "published" } }
              : { status: "rejected", reason: { _tag: "PointCommitConflictV1Error" } });
            const after = await counts();
            expect(after).toMatchObject({ commits: before.commits + (winner === "save" ? 2 : 1),
              outcomes: before.outcomes + (winner === "save" ? 2 : 1),
              rows: before.rows + (winner === "save" ? 1 : 0),
              revisions: before.revisions + (winner === "save" ? 2 : 1),
              rowFacts: before.rowFacts + (winner === "save" ? 2 : 1), events: before.events });
            if (winner === "revocation") expect(await Effect.runPromise(savePublication.resolve)).toMatchObject({ kind: "noncommit" });
            const fresh = await fixture.open();
            const freshSave = await bindPrivatePayloadSave(fixture, fresh, policyId);
            try {
              await expect(Effect.runPromise(freshSave.invoke("create", { collection: "posts",
                data: { title: "Fresh denied assignment", featuredProduct: product.id } }))).rejects.toBeDefined();
              await expect(fresh.publish()).rejects.toBeDefined();
              expect(await counts()).toEqual(after);
            } finally { await freshSave.close(); }
          } finally { release.resolve(); await Promise.allSettled(running); await saving.close(); }
        }

        const reset = await preparePrivateSavePolicy(fixture, allow, policyId);
        await reset.root.publish();
        const root = await fixture.open();
        let hooks = 0;
        const saving = await bindPrivatePayloadSave(fixture, root, policyId,
          { instrumentation: { hooks: { beforeChange: [({ data }) => { hooks++; return data; }] } } });
        try {
          const result = await Effect.runPromise(saving.invoke("create", { collection: "posts",
            data: { title: "Durable before revocation", featuredProduct: product.id } }));
          if (result.kind !== "completed") throw new Error("Native save did not execute");
          const saved = document(result.result);
          const publication = await root.preparePublication(saved, { logicalOperationProfiles: [root.payloadProfile(saving.selected.profileRevision)] });
          const before = await counts();
          let fired = false;
          const fault = installPoolCommitResponseFault(db.pool, () => ({ commit: forward => Promise.resolve(forward()).then(async value => {
            if (fired) return value;
            const committed = await counts(); // Original COMMIT client is still checked out: this is an independent connection.
            if (committed.commits === before.commits) return value;
            expect(committed.commits).toBe(before.commits + 1);
            fired = true;
            const revocation = await preparePrivateSavePolicy(fixture, revoke, policyId);
            expect(await revocation.root.publish()).toMatchObject({ kind: "published" });
            throw new Error("Authorized save COMMIT acknowledgement lost after durable revocation");
          }) }), () => fired);
          expect(await Effect.runPromise(publication.publish).finally(fault.restore)).toMatchObject({ kind: "replayed" });
          expect(fired).toBe(true);
          const committed = await counts();
          expect(committed).toMatchObject({ commits: before.commits + 2, outcomes: before.outcomes + 2,
            rows: before.rows + 1, revisions: before.revisions + 2, rowFacts: before.rowFacts + 2, events: before.events });
          const recovered = await Effect.runPromise(publication.resolve);
          expect(recovered).toMatchObject({ kind: "committed", outcome: { kind: "available" } });
          expect(await Effect.runPromise(publication.publish)).toMatchObject({ kind: "replayed", successfulResult: { valueJson: saved } });
          expect(await counts()).toEqual(committed);
          expect(hooks).toBe(1);
        } finally { await saving.close(); }
      } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 240_000);
});
