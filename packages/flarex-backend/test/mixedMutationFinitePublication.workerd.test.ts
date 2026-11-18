import { eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  createPointCommitPublisherPortV1,
} from "../../persistence-postgres/src/commit/point/construction";
import {
  type PointFiniteCommitCommand,
} from "../../persistence-postgres/src/commit/point/contracts";
import {
  readFrozenFiniteAttempt,
} from "../../persistence-postgres/src/testing/sessionJournalInspection";
import {
  projectOriginalFinitePublicationSession,
} from "../../persistence-postgres/src/execution/journal/finiteEntryPublication";
import {
  readConfirmedFiniteRootEntryCapture,
} from "../../persistence-postgres/src/execution/journal/finiteEntry";
import {
  fxSystemApplicationActiveHeads,
} from "../../persistence-postgres/src/application/applicationActivationSchema";
import { fxControlSchemaVersions, fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes,
  fxSystemTransactionSessions, fxSystemScopeClocks } from "../../persistence-postgres/src/database/schema";
import {
  fxSystemCommitEvents,
  fxSystemCommitEventDeliveries,
} from "../../persistence-postgres/src/commit/events/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;

/** Each foreign fixture/query Promise settles before the scoped fixture closes. */
const query = <A>(work: () => PromiseLike<A>) => Effect.tryPromise({
  try: () => Promise.resolve(work()), catch: cause => new Error("Finite publication witness failed", { cause }),
}).pipe(Effect.uninterruptible, Effect.orDie);
const fixtureScope = (driver: "pglite" | "postgres", suffix: string) => Effect.acquireRelease(
  query(() => createMixedMutationProductFixture({ driver, suffix })),
  fixture => query(() => fixture.close()).pipe(Effect.orDie),
);
const state = async (fixture: Fixture) => ({
  commits: await fixture.currency.persistence.drizzle.select().from(fxSystemCommits),
  outcomes: await fixture.currency.persistence.drizzle.select().from(fxSystemIdempotency),
  wakes: await fixture.currency.persistence.drizzle.select().from(fxSystemCommitWakes),
  events: await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents),
  deliveries: await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEventDeliveries),
  clocks: await fixture.currency.persistence.drizzle.select().from(fxSystemScopeClocks),
});
const session = async (fixture: Fixture) => {
  const [stored] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
  if (stored === undefined) throw new Error("Missing genuine confirmed finite session");
  return stored;
};

describe.each(drivers)("complete original finite publication observation on %s", driver => {
  it("uses the original issuer and refuses changed bytes and JSON with retained digests", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const fixture = yield* fixtureScope(driver, `finite-publication-immutable-${driver}`);
    const actual = fixture.makePublisher();
    const before = yield* query(() => state(fixture));
    const nativeBefore = [...fixture.nativeInvokeCount.entries()];
    let refusals = 0;
    const publisher = { ...actual, publishFinite: (command: PointFiniteCommitCommand) => Effect.gen(function* () {
      const frozen = readFrozenFiniteAttempt(command.frozenAttempt);
      if (frozen === undefined) throw new Error("Missing authentic frozen finite entry");
      const original = frozen.originalEntry;
      const expected = projectOriginalFinitePublicationSession(original, fixture.pointCommitPorts);
      expect(Result.isSuccess(expected)).toBe(true);
      expect(Result.isFailure(projectOriginalFinitePublicationSession({ ...original,
        capture: { ...original.capture } }, fixture.pointCommitPorts))).toBe(true);
      expect(Result.isFailure(projectOriginalFinitePublicationSession({ ...original,
        preparation: { ...original.preparation } }, fixture.pointCommitPorts))).toBe(true);
      expect(Result.isFailure(projectOriginalFinitePublicationSession(original, { ...fixture.pointCommitPorts }))).toBe(true);
      const detached = readConfirmedFiniteRootEntryCapture(original.capture, fixture.pointCommitPorts);
      if (detached === undefined) throw new Error("Missing confirmed finite entry reader");
      detached.context.session.validatedArgsCanonicalBytes?.fill(0);
      Reflect.set(detached.context.session, "validatedArgsJson", { substituted: null });
      expect(projectOriginalFinitePublicationSession(original, fixture.pointCommitPorts)).toEqual(expected);
      const stored = yield* query(() => session(fixture));
      if (stored.validatedArgsCanonicalBytes === null || stored.validatedArgsJson === null)
        throw new Error("Missing genuine immutable argument evidence");
      for (const damage of ["bytes", "json", "jsonNull"] as const) {
        yield* query(async () => { await fixture.currency.persistence.drizzle.update(fxSystemTransactionSessions).set(damage === "bytes"
          ? { validatedArgsCanonicalBytes: sql`set_byte(${fxSystemTransactionSessions.validatedArgsCanonicalBytes}, 0,
              get_byte(${fxSystemTransactionSessions.validatedArgsCanonicalBytes}, 0) # 1)` }
          : { validatedArgsJson: { ...stored.validatedArgsJson, substituted: damage === "jsonNull" ? null : "changed" } })
          .where(eq(fxSystemTransactionSessions.sessionId, stored.sessionId)); });
        const damaged = yield* query(() => session(fixture));
        expect(damaged.validatedArgsSha256).toEqual(stored.validatedArgsSha256);
        expect(yield* actual.publishFinite(command).pipe(Effect.result)).toMatchObject({ _tag: "Failure",
          failure: { _tag: "PointCommitCorruptionV1Error", reason: "sessionInvalid" } });
        expect(yield* query(() => state(fixture))).toEqual(before);
        expect(yield* query(() => session(fixture))).toEqual(damaged);
        yield* query(async () => { await fixture.currency.persistence.drizzle.update(fxSystemTransactionSessions)
          .set({ validatedArgsCanonicalBytes: stored.validatedArgsCanonicalBytes, validatedArgsJson: stored.validatedArgsJson })
          .where(eq(fxSystemTransactionSessions.sessionId, stored.sessionId)); });
        refusals++;
      }
      return yield* actual.publishFinite(command);
    }) };
    const publication = yield* query(() => fixture.preparePublication(null, publisher));
    expect(yield* publication).toMatchObject({ kind: "published" });
    expect(refusals).toBe(3);
    expect([...fixture.nativeInvokeCount.entries()]).toEqual(nativeBefore);
  }))), 180_000);

  it.skipIf(driver !== "postgres").each(["target", "control"] as const)(
    "refuses %s metadata ABA with an empty business graph", namespace => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* fixtureScope(driver, `finite-publication-empty-${namespace}`);
      const before = yield* query(() => state(fixture));
      let changed = false, observedRollback = false;
      const actual = createPointCommitPublisherPortV1(fixture.pointCommitPorts, { ...fixture.publisherOptions,
        afterTransactionStep: async event => {
          if (event.step !== "beforeCommit") return;
          if (namespace === "target") {
            const identity = eq(fxSystemApplicationActiveHeads.scopeId, fixture.application.authority.scopeId);
            const [head] = await fixture.currency.persistence.drizzle.select().from(fxSystemApplicationActiveHeads).where(identity);
            if (head === undefined) throw new Error("Missing actual target active head");
            await fixture.currency.persistence.drizzle.update(fxSystemApplicationActiveHeads)
              .set({ updatedAt: new Date(head.updatedAt.getTime() + 1000) }).where(identity);
            await fixture.currency.persistence.drizzle.update(fxSystemApplicationActiveHeads).set({ updatedAt: head.updatedAt }).where(identity);
          } else {
            const identity = eq(fxControlSchemaVersions.schemaVersionId, fixture.currency.application.active.basis.schemaVersionId);
            const [artifact] = await fixture.currency.control.drizzle.select().from(fxControlSchemaVersions).where(identity);
            if (artifact === undefined) throw new Error("Missing actual control schema artifact");
            await fixture.currency.control.drizzle.update(fxControlSchemaVersions)
              .set({ createdAt: new Date(artifact.createdAt.getTime() + 1000) }).where(identity);
            await fixture.currency.control.drizzle.update(fxControlSchemaVersions).set({ createdAt: artifact.createdAt }).where(identity);
          }
          changed = true;
        },
      });
      const publisher = { ...actual, publishFinite: (command: PointFiniteCommitCommand) => Effect.gen(function* () {
        const frozen = readFrozenFiniteAttempt(command.frozenAttempt);
        if (frozen === undefined) throw new Error("Missing authentic empty frozen graph");
        expect(frozen.rowIntents).toHaveLength(0);
        expect(frozen.operations).toHaveLength(0);
        // Entry retains authentic function/binding metadata even when the
        // business body performs no reads or writes. Keep that evidence intact.
        expect(frozen.dependencies.filter(dependency => dependency.kind !== "metadata")).toHaveLength(0);
        expect(frozen.dependencies).toHaveLength(2);
        expect(frozen.graph.metadataDependencies).toEqual(frozen.dependencies);
        const originalSession = yield* query(() => session(fixture));
        return yield* actual.publishFinite(command).pipe(Effect.tapError(() => query(async () => {
          expect(await state(fixture)).toEqual(before);
          expect(await session(fixture)).toEqual(originalSession);
          observedRollback = true;
        })));
      }) };
      const publication = yield* query(() => fixture.preparePublication(null, publisher));
      expect(yield* publication.pipe(Effect.result)).toMatchObject({ _tag: "Failure",
        failure: { _tag: "PointCommitStaleAuthorityV1Error", reason: "activeSchemaChanged" } });
      expect(changed).toBe(true);
      expect(observedRollback).toBe(true);
      expect(yield* query(() => state(fixture))).toEqual(before);
    }))), 180_000,
  );
});
