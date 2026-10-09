import { afterAll, expect, it } from "vitest";
import { Effect, Tracer } from "effect";
import { and, eq } from "drizzle-orm";
import { fxSystemApplicationFunctions, fxSystemApplicationPublications } from "../../../src/application/relations/applicationRelationSchema";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { fxSystemDataBindingHeads } from "../../../src/installation/frameworkSchema/binding/schema";
import { makePostgresRelationalSession, runRelationalSession } from "../../../src/database/relationalTransaction/session";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { prepareAdditionalRelationRevision } from "../../application/relations/applicationRelationReadinessFixture";
import { prepareCmsApplicationFromBinding, requirePreparedCmsApplication, requireCmsAdmission, withCmsAdmission, type CmsAdmission } from "../../../src/frameworks/cmsTransaction/admission";
import { readAcceptedApplicationBindingProjection } from "../../../src/application/applicationBindingProjection";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../../../src/scope/scopeClock";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../../src/scope/scopeAuthorityResolution";

import { prepareApplicationBindingSelection, lendApplicationBindingPreparationInputs } from "../../../src/application/applicationActivation";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";

const cleanup: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const close of cleanup.reverse()) await close();
});

for (const driver of ["pglite", "postgres"] as const) {
  it.skipIf(driver === "postgres" && postgresUrl === null)(
    `executes the fullProof prepared relation issuer before CMS writes and reuse (${driver})`, async () => {
      const resource = driver === "pglite"
        ? await createRelationalPGliteFixture({ registerCleanup: close => { cleanup.push(close); } })
        : await (async () => {
          const fixture = await createFileScopedPostgresFixture({}, {}, "ordinary");
          cleanup.push(fixture.dispose);
          expect((await fixture.persistence.query<{ superuser: boolean }>(
            "select rolsuper as superuser from pg_roles where rolname=current_user",
          )).rows[0]?.superuser).toBe(false);
          return { persistence: fixture.persistence, session: makePostgresRelationalSession(fixture.persistence) };
        })();
      const tested = await cmsExecutionMeasurementFixture(resource.persistence, resource.session);
      const lease = await runEffect(retainPreparedHost(tested.input.hostRuntime, Effect.gen(function* () {
        const binding = yield* prepareApplicationBindingSelection(tested.input.application);
        const prepared = yield* prepareCmsApplicationFromBinding(binding, tested.input.controlDatabase, tested.input.deploymentId, tested.input.scopeId);
        return { binding, prepared };
      })));
      cleanup.push(() => runEffect(lease.close));
      const { binding, prepared } = await runEffect(lease.use(value => Effect.succeed(value)));
      const preparation = await runEffect(requirePreparedCmsApplication(prepared));
      const inputs = await runEffect(lendApplicationBindingPreparationInputs(binding, tested.input.controlDatabase));
      const sameInputs = await runEffect(lendApplicationBindingPreparationInputs(binding, tested.input.controlDatabase));
      expect(sameInputs.indexes).toBe(inputs.indexes);
      expect(sameInputs.unique).toBe(inputs.unique);
      for (const definition of [...preparation.intrinsicDefinitions, ...preparation.indexDefinitions])
        expect(inputs.indexes).toContain(definition);
      for (const definition of preparation.uniqueDefinitions) expect(inputs.unique).toContain(definition);
      const located = await runEffect(resolveLocatedTrustedScopeAuthorityByIdEffect({
        deploymentId: tested.input.deploymentId, scopeId: tested.input.scopeId,
      }, tested.input.authority));
      let escaped: CmsAdmission | undefined;
      await runEffect(runRelationalSession(resource.session, "snapshotRead", tx => Effect.gen(function* () {
        const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, tested.input.scopeId);
        yield* withCmsAdmission(prepared, tx, located.authority, clock, admission => Effect.gen(function* () {
          escaped = admission;
          const state = yield* requireCmsAdmission(admission, tx);
          expect(state.schema).toBe(preparation.schema);
          const projection = yield* readAcceptedApplicationBindingProjection(state.binding, tx, clock);
          expect(projection.schemaVersionId).toBe(preparation.schema.schemaVersionId);
          expect(yield* readAcceptedApplicationBindingProjection(state.binding, tx, clock)).toEqual(projection);
        }));
      })));
      if (escaped === undefined) throw new Error("Prepared CMS admission did not execute");
      expect(await runEffectFailure(requireCmsAdmission(escaped))).toMatchObject({ reason: "invalidAuthority" });

      let before = await tested.inventory();
      for (const prefix of ["issuer-first", "issuer-next"]) {
        const executions = tested.executionCount();
        const requestKey = tested.host.newRequestKey();
        const args = { count: 1, prefix };
        const value = await runEffect(tested.host.run(requestKey, tested.insert, args));
        const after = await tested.verifyInsert(before, value, 1, prefix);
        expect(tested.executionCount()).toBe(executions + 1);
        expect(await runEffect(tested.host.run(requestKey, tested.insert, args))).toEqual(value);
        expect(tested.prefixExecutionCount(prefix)).toBe(1);
        expect(tested.executionCount()).toBe(executions + 1);
        // verifyInsert also reads the committed IDs through the same genuine host.
        expect(await tested.inventory()).toEqual(after);
        before = after;
      }
      const reads = tested.readExecutionCount();
      expect(await runEffect(tested.host.read(tested.read, []))).toEqual([]);
      expect(tested.readExecutionCount()).toBe(reads + 1);
      expect(await tested.inventory()).toEqual(before);
      await runEffect(tested.host.close);
      await runEffect(lease.close);
      expect(await runEffectFailure(requirePreparedCmsApplication(prepared))).toMatchObject({ reason: "invalidAuthority" });
      expect(await runEffectFailure(lendApplicationBindingPreparationInputs(binding, tested.input.controlDatabase)))
        .toMatchObject({ reason: "invalidComposition" });
    }, 180_000,
  );
}

it("constructs fresh fullProof generations while revalidating warm reads, writes and replay", async () => {
  const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres")
    throw new Error("Invalid driver");
  const resource =
    driver === "pglite"
      ? await createRelationalPGliteFixture({
          registerCleanup: (close) => {
            cleanup.push(close);
          },
        })
      : await (async () => {
          const fixture = await createFileScopedPostgresFixture();
          cleanup.push(fixture.dispose);
          return {
            persistence: fixture.persistence,
            session: makePostgresRelationalSession(fixture.persistence),
          };
        })();
  const tested = await cmsExecutionMeasurementFixture(
    resource.persistence,
    resource.session,
  );
  const spans: string[] = [];
  const tracer = Tracer.make({
    span(options) {
      spans.push(options.name);
      return new Tracer.NativeSpan(options);
    },
  });
  const observe = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.provideService(Tracer.Tracer, tracer));
  const host = await runEffect(observe(makeCmsHost(tested.input)));
  expect(spans.filter((name) => name === "CmsAdmission.prepare")).toHaveLength(0);
  spans.length = 0;
  const before = await tested.inventory();
  const key = host.newRequestKey();
  const args = { count: 1, prefix: "prepared-host" };
  const value = await runEffect(observe(host.run(key, tested.insert, args)));
  const after = await tested.verifyInsert(before, value, 1, args.prefix);
  expect(await runEffect(observe(host.run(key, tested.insert, args)))).toEqual(
    value,
  );
  expect(await runEffect(observe(host.read(tested.read, [])))).toEqual([]);
  expect(tested.executionCount()).toBe(1);
  expect(spans.filter(name => name === "CmsAdmission.prepare")).toHaveLength(3);
  expect(await tested.inventory()).toEqual(after);

  const db = resource.persistence.drizzle;
  // The retained bundle now contains commitments rather than these byte frames.
  // A warm host must nevertheless verify the actual frames, including for replay.
  const publicationSlot = and(eq(fxSystemApplicationPublications.scopeId, tested.fixture.authority.scopeId),
    eq(fxSystemApplicationPublications.revisionId, tested.fixture.input.revisionId));
  const publication = (await db.select().from(fxSystemApplicationPublications).where(publicationSlot))[0];
  const functionSlot = and(eq(fxSystemApplicationFunctions.scopeId, tested.fixture.authority.scopeId),
    eq(fxSystemApplicationFunctions.revisionId, tested.fixture.input.revisionId));
  const functions = await db.select().from(fxSystemApplicationFunctions).where(functionSlot);
  if (publication === undefined || functions.length === 0) throw new Error("Missing publication fixture");
  const damage = (bytes: Uint8Array) => {
    const damaged = new Uint8Array(bytes);
    damaged[0] = (damaged[0] ?? 0) ^ 1;
    return damaged;
  };
  for (const field of ["schemaBytes", "functionCatalogBytes", "entryBytes"] as const) {
    const priorCounts = [tested.executionCount(), tested.readExecutionCount()];
    if (field === "entryBytes") {
      await db.update(fxSystemApplicationFunctions).set({ entryBytes: new Uint8Array([0]) }).where(functionSlot);
    } else {
      await db.update(fxSystemApplicationPublications).set({ [field]: damage(publication[field]) }).where(publicationSlot);
    }
    try {
      for (const request of [host.read(tested.read, []), host.run(key, tested.insert, args),
        host.run(host.newRequestKey(), tested.insert, { count: 1, prefix: "corrupt-publication" })]) {
        expect(await runEffectFailure(observe(request))).toMatchObject({ reason: "invalidAuthority" });
      }
      expect([tested.executionCount(), tested.readExecutionCount()]).toEqual(priorCounts);
      expect(await tested.inventory()).toEqual(after);
    } finally {
      if (field === "entryBytes") {
        for (const row of functions) await db.update(fxSystemApplicationFunctions).set({ entryBytes: row.entryBytes })
          .where(and(functionSlot, eq(fxSystemApplicationFunctions.functionPath, row.functionPath)));
      } else {
        await db.update(fxSystemApplicationPublications).set({ [field]: publication[field] }).where(publicationSlot);
      }
    }
    expect(await runEffect(observe(host.run(key, tested.insert, args)))).toEqual(value);
    expect(await runEffect(observe(host.read(tested.read, [])))).toEqual([]);

  }
  const slot = eq(
    fxSystemDataBindingHeads.scopeId,
    tested.fixture.authority.scopeId,
  );
  const head = (
    await db.select().from(fxSystemDataBindingHeads).where(slot)
  )[0];
  if (head === undefined) throw new Error("Missing binding head");
  const damaged = new Uint8Array(head.canonicalBytes);
  damaged[0] = (damaged[0] ?? 0) ^ 1;
  const executions = [tested.executionCount(), tested.readExecutionCount()];
  await db
    .update(fxSystemDataBindingHeads)
    .set({ canonicalBytes: damaged })
    .where(slot);
  try {
    for (const effect of [
      host.read(tested.read, []),
      host.run(key, tested.insert, args),
      host.run(host.newRequestKey(), tested.insert, {
        count: 1,
        prefix: "refused",
      }),
    ]) {
      expect(await runEffectFailure(observe(effect))).toMatchObject({
        reason: "invalidAuthority",
      });
    }
    expect([tested.executionCount(), tested.readExecutionCount()]).toEqual(
      executions,
    );
    expect(await tested.inventory()).toEqual(after);

  } finally {
    await db
      .update(fxSystemDataBindingHeads)
      .set({ canonicalBytes: head.canonicalBytes })
      .where(slot);
  }
  expect(await runEffect(observe(host.run(key, tested.insert, args)))).toEqual(
    value,
  );
  expect(await runEffect(observe(host.read(tested.read, [])))).toEqual([]);
  expect(await tested.inventory()).toEqual(after);

  const active = await runEffect(tested.fixture.relationActivation.readActive());
  const next = await prepareAdditionalRelationRevision(tested.fixture);
  await runEffect(tested.fixture.relationActivation.activate({
    revisionId: next.readiness.revisionId, expectedActiveHead: active.expectedActiveHead,
  }));
  const activated = await tested.inventory();
  const callbackCounts = [tested.executionCount(), tested.readExecutionCount()];
  for (const effect of [host.read(tested.read, []), host.run(key, tested.insert, args)]) {
    expect(await runEffectFailure(observe(effect))).toMatchObject({ reason: "bindingChanged" });
  }
  expect([tested.executionCount(), tested.readExecutionCount()]).toEqual(callbackCounts);
  expect(await tested.inventory()).toEqual(activated);

  const preparationsBeforeRebuild = spans.filter(name => name === "CmsAdmission.prepare").length;
  const rebuilt = await runEffect(observe(makeCmsHost(tested.input)));
  expect(spans.filter(name => name === "CmsAdmission.prepare")).toHaveLength(preparationsBeforeRebuild);
  // The new Application revision also needs an explicit data-binding cutover.
  // Reconstructing the host must not silently repair that independent authority.
  expect(await runEffectFailure(rebuilt.read(tested.read, []))).toMatchObject({ reason: "bindingChanged" });
  expect(await tested.inventory()).toEqual(activated);
}, 180_000);
