import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createPointCommitPublisherPortV1 } from "../../persistence-postgres/src/commit/point/construction";
import { deferredSignal, withTimeout } from "../../persistence-postgres/test/commit/point/support/postgresFaults";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { type Fixture, collections, extensions, decodeArticle, successfulValue, referenceSource,
  prepareProductTransition } from "./support/payloadCommerceReferenceFixture";

async function blockedBy(fixture: Fixture, waiter: number, blocker: number) {
  if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected PostgreSQL");
  const control = fixture.currency.resource.control;
  const deadline = Date.now() + 2_000;
  do {
    const row = (await control.query<{ blocked: boolean }>(
      "select $2::int = any(pg_blocking_pids($1::int)) as blocked", [waiter, blocker])).rows[0];
    if (row?.blocked === true) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  } while (Date.now() < deadline);
  throw new Error(`PostgreSQL backend ${waiter} did not block on ${blocker}`);
}

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)("private CMS/Product lock overlap", () => {
  it("refuses owner credentials before native work and releases both test connections", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "reference-owner-refused",
      payloadProfile: "ordinary", payloadCollections: collections, extensions,
      hooks: { standaloneOwnerCredentialFault: true } });
    try {
      if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected PostgreSQL");
      const resource = fixture.currency.resource;
      const leased = resource.target.pool.totalCount - resource.target.pool.idleCount;
      let invoked = false;
      await expect(fixture.withStandaloneProductSession(async () => { invoked = true; return null; }))
        .rejects.toThrow("Standalone Commerce credential identity mismatch");
      expect(invoked).toBe(false);
      expect(fixture.standaloneProductPgConnections).toEqual([]);
      expect(resource.target.pool.totalCount - resource.target.pool.idleCount).toBe(leased);
      expect((await resource.control.query<{ count: number }>(`select count(*)::int as count from pg_stat_activity
        where application_name = 'flarex_product_standalone' and datname = current_database()`)).rows[0]?.count).toBe(0);
      expect(await fixture.readCurrentProduct()).toMatchObject({ id: fixture.seed.productId });
    } finally { await fixture.close(); }
  }, 180_000);

  for (const [operation, action] of [["delete", "assign"], ["softDelete", "assign"], ["delete", "clear"]] as const) {
    for (const winner of ["reference", "product"] as const) {
      it(`serializes ${action} with ${operation}, ${winner} first`, async () => {
        const fixture = await createMixedMutationProductFixture({ driver: "postgres",
          suffix: `reference-lock-${operation}-${action}-${winner}`, payloadProfile: "ordinary", payloadCollections: collections, extensions });
        const ready = deferredSignal(), start = deferredSignal(), entered = deferredSignal(), release = deferredSignal();
        const running: Promise<unknown>[] = [];
        let attempt: Fixture | undefined;
        try {
          if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected PostgreSQL");
          const resource = fixture.currency.resource;
          const selected = await successfulValue(await fixture.runExecution(referenceSource(fixture.payload?.profile.participant, fixture.seed.productId)));
          const article = decodeArticle(selected);
          if (action === "clear") {
            expect(await fixture.publish(selected)).toMatchObject({ kind: "published" });
            attempt = await fixture.openCompetingFiniteFixture(`reference-clear-${winner}`);
          }
          const root = attempt ?? fixture;
          const value = action === "assign" ? selected : await successfulValue(await root.runExecution(
            `export default { users: { create: { isMutation: true, isPublic: true, _handler: async ctx =>
              ctx.privateMixed.call(${JSON.stringify(root.payload?.profile.participant)}, "payload-update",
                { collection: "articles", id: ${JSON.stringify(article.id)}, data: { featuredProduct: null } }) } } };`));
          const nativeRefuses = operation === "delete" && ((action === "assign" && winner === "reference") ||
            (action === "clear" && winner === "product"));
          const publicationRefuses = action === "assign" && winner === "product";
          const publisher = createPointCommitPublisherPortV1(root.pointCommitPorts, { ...root.publisherOptions,
            afterTransactionStep: async event => {
              if (event.step === "clockLocked" && winner === "reference") { entered.resolve(); await release.promise; }
            } });
          const publish = await root.preparePublication(value, publisher);
          const primary = (await resource.target.query<{ pid: number; role: string }>(
            "select pg_backend_pid()::int as pid, current_user as role")).rows[0];
          if (primary === undefined) throw new Error("Missing publisher backend");
          const primaryPid = primary.pid;
          const native = fixture.withStandaloneProductSession(async session => {
            const command = await prepareProductTransition(fixture, operation, { session,
              beforeCall: Effect.promise(async () => {
                if (winner === "product") { entered.resolve(); await release.promise; }
              }) });
            ready.resolve();
            await start.promise;
            return nativeRefuses
              ? Effect.runPromise(Effect.flip(command)).then(error => {
                expect(error).toMatchObject({ reason: "invalidInput", cause: { reason: "targetDeleteRestricted", reference: "article_product" } });
                return null;
              }) : Effect.runPromise(command);
          });
          const nativeDone = Promise.allSettled([native]); running.push(nativeDone);
          await withTimeout(ready.promise, 30_000, "prepared independent native host");
          const peers = (await resource.control.query<{ pid: number }>(
            `select pid::int as pid from pg_stat_activity where application_name = 'flarex_product_standalone'
              and datname = current_database() and usename = $1`, [primary.role])).rows;
          expect(peers).toHaveLength(1);
          const nativePid = peers[0]?.pid;
          if (nativePid === undefined) throw new Error("Missing native backend");
          expect(nativePid).not.toBe(primaryPid);
          const publishWork = publicationRefuses ? Effect.flip(publish) : publish;
          let published: Promise<unknown>;
          if (winner === "product") {
            start.resolve();
            await withTimeout(entered.promise, 5_000, "native scope lock");
            published = Effect.runPromise(publishWork);
          } else {
            published = Effect.runPromise(publishWork);
          }
          const publicationDone = Promise.allSettled([published]); running.push(publicationDone);
          if (winner === "reference") {
            await withTimeout(entered.promise, 5_000, "mixed publisher scope lock");
            start.resolve();
          }
          await blockedBy(fixture, winner === "reference" ? nativePid : primaryPid,
            winner === "reference" ? primaryPid : nativePid);
          release.resolve();
          expect((await nativeDone)[0]?.status).toBe("fulfilled");
          expect((await publicationDone)[0]?.status).toBe("fulfilled");
          expect(await published).toMatchObject(!publicationRefuses ? { kind: "published" }
            : { reason: "targetNotLive", reference: "article_product" });
          if (action === "clear") {
            expect(await fixture.readCurrentApplicationDocument(article.id)).toMatchObject({ featuredProduct: null });
            if (nativeRefuses) await Effect.runPromise(await prepareProductTransition(fixture, "delete"));
          } else if (winner === "reference") {
            expect(await fixture.readCurrentApplicationDocument(article.id)).toMatchObject({ featuredProduct: fixture.seed.productId });
            // The soft-deleted row still retains reverse membership.
            const hardDelete = await prepareProductTransition(fixture, "delete");
            expect(await Effect.runPromise(Effect.flip(hardDelete))).toMatchObject({
              cause: { reason: "targetDeleteRestricted", reference: "article_product" } });
          } else {
            await expect(fixture.readCurrentApplicationDocument(article.id)).rejects.toThrow("Missing committed Application document");
          }
          expect(fixture.standaloneProductPgConnections).toEqual([{ primaryTargetPid: primaryPid, standalonePid: nativePid }]);
        } finally {
          start.resolve(); release.resolve();
          await Promise.allSettled(running);
          try { await attempt?.close(); } finally { await fixture.close(); }
        }
      }, 180_000);
    }
  }
});
