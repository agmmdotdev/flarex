import { eq } from "drizzle-orm";
import { Effect, Result, Tracer } from "effect";
import { expect, it } from "vitest";
import { StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { prepareApplicationBindingSelection, claimApplicationExecutableActiveSelection, type ApplicationBindingPreparation } from "../src/applicationActivation";
import { readApplicationBindingPreparationInputs, readAcceptedApplicationBinding, withAcceptedApplicationBinding,
  type AcceptedApplicationBinding } from "../src/applicationActivation";
import { readAcceptedApplicationBindingProjection } from "../src/applicationBindingProjection";
import { readApplicationBindingProjectionInTransaction } from "../src/applicationBindingProjection";
import { fxSystemApplicationReadiness } from "../src/applicationRelationSchema";
import { fxSystemApplicationActiveHeads } from "../src/applicationActivationSchema";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { cmsHostFixture } from "./cmsHostFixture";
import { prepareAdditionalRelationRevision } from "./applicationRelationReadinessFixture";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture, postgresUrl } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";
import { prepareCmsApplication } from "../src/cmsTransaction/admission";

async function exercise(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence) {
  const schema = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schema === undefined) throw new Error("Missing fixture schema");
  const controlPersistence = "pool" in persistence ? persistence : await createMigratedPGlitePersistence();
  const base = await cmsHostFixture(persistence, { controlPersistence,
    physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName: schema } });
  const spans: string[] = [];
  const scopeId = base.fixture.authority.scopeId;
  const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
  const prepare = () => runEffect(prepareApplicationBindingSelection(base.fixture.relationActivation)
    .pipe(Effect.provideService(Tracer.Tracer, tracer)));
  const prepared = await prepare();
  expect(Result.isFailure(claimApplicationExecutableActiveSelection(prepared))).toBe(true);
  expect(spans).not.toContain("ApplicationRelationReadinessFold.validatePreparedInTransaction");
  const accept = (input = prepared) => persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    return yield* readApplicationBindingProjectionInTransaction(input, tx, clock);
  }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
  expect(await accept()).toEqual(base.reference);
  expect(spans.filter(name => name === "ApplicationRelationReadinessFold.validatePreparedInTransaction")).toHaveLength(1);
  const planning = await runEffect(readApplicationBindingPreparationInputs(prepared, base.fixture.control.drizzle));
  expect(planning.schema.schemaVersionId).toBe(base.reference.schemaVersionId);
  // A detached manifest cannot rewrite the prepared authority's input snapshot.
  const manifestVersion = planning.manifest.version;
  Object.assign(planning.manifest, { version: 0 });
  expect((await runEffect(readApplicationBindingPreparationInputs(prepared, base.fixture.control.drizzle))).manifest.version).toBe(manifestVersion);
  const cms = await runEffect(prepareCmsApplication(base.fixture.relationActivation, base.fixture.authorityPorts,
    base.fixture.control.drizzle, base.fixture.deploymentId));
  const assertFrozen = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    expect(Object.isFrozen(value)).toBe(true);
    for (const nested of Object.values(value)) assertFrozen(nested);
  };
  assertFrozen(cms.configuration);
  expect(() => Object.assign(cms.configuration, { profile: "changed" })).toThrow(TypeError);
  const otherPreparation = await prepare();
  let escaped: AcceptedApplicationBinding | undefined;
  await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    for (const ending of ["success", "failure", "interruption"] as const) {
      const before = spans.filter(name => name === "ApplicationRelationReadinessFold.validatePreparedInTransaction").length;
      const result = yield* Effect.exit(withAcceptedApplicationBinding(prepared, tx, clock, binding => Effect.gen(function* () {
        escaped = binding;
        expect(Result.isFailure(claimApplicationExecutableActiveSelection(binding))).toBe(true);
        expect(yield* readAcceptedApplicationBindingProjection(binding, tx, clock)).toEqual(base.reference);
        expect(yield* readAcceptedApplicationBindingProjection(binding, tx, clock)).toEqual(base.reference);
        expect(yield* withAcceptedApplicationBinding(prepared, tx, clock,
          borrowed => readAcceptedApplicationBindingProjection(borrowed, tx, clock), binding)).toEqual(base.reference);
        expect(yield* Effect.flip(withAcceptedApplicationBinding(otherPreparation, tx, clock,
          () => Effect.void, binding))).toMatchObject({ reason: "invalidComposition" });
        expect(Result.isSuccess(readAcceptedApplicationBinding(binding, tx, clock))).toBe(true);
        // SAFETY: a lookalike transaction must not satisfy exact accepting identity.
        expect(Result.isFailure(readAcceptedApplicationBinding(binding, { ...tx } as typeof tx, clock))).toBe(true);
        expect(Result.isFailure(readAcceptedApplicationBinding(binding, tx, { ...clock,
          storageGenerationFence: StorageGenerationFenceSchema.make(clock.storageGenerationFence + 1n) }))).toBe(true);
        if (ending === "failure") return yield* Effect.fail("expected refusal");
        if (ending === "interruption") return yield* Effect.interrupt;
      })));
      expect(result._tag).toBe(ending === "success" ? "Success" : "Failure");
      if (escaped === undefined) throw new Error("Missing accepted fixture");
      expect(Result.isFailure(readAcceptedApplicationBinding(escaped, tx, clock))).toBe(true);
      expect(spans.filter(name => name === "ApplicationRelationReadinessFold.validatePreparedInTransaction").length - before).toBe(1);
    }
  }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
  // SAFETY: intentionally forged nominal input tests the registry refusal boundary.
  await expect(accept({} as ApplicationBindingPreparation)).rejects.toMatchObject({ reason: "invalidComposition" });
  await expect(persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    return yield* readApplicationBindingProjectionInTransaction(prepared, tx, { ...clock, storageGenerationFence: StorageGenerationFenceSchema.make(clock.storageGenerationFence + 1n) });
  })))).rejects.toMatchObject({ reason: "scopeAuthority" });

  const readinessWhere = eq(fxSystemApplicationReadiness.scopeId, scopeId);
  const original = (await persistence.drizzle.select().from(fxSystemApplicationReadiness).where(readinessWhere))[0];
  if (original === undefined) throw new Error("Missing readiness fixture");
  const corrupt = Uint8Array.from(original.readinessBytes); corrupt[0] = 32;
  await persistence.drizzle.update(fxSystemApplicationReadiness).set({ readinessBytes: corrupt }).where(readinessWhere);
  await expect(accept()).rejects.toMatchObject({ _tag: "ApplicationRelationReadinessFoldError", reason: "storedState" });
  await persistence.drizzle.update(fxSystemApplicationReadiness).set({ readinessBytes: original.readinessBytes }).where(readinessWhere);
  expect(await accept()).toEqual(base.reference);

  const headWhere = eq(fxSystemApplicationActiveHeads.scopeId, scopeId);
  const heads = await persistence.drizzle.select().from(fxSystemApplicationActiveHeads).where(headWhere);
  await persistence.drizzle.delete(fxSystemApplicationActiveHeads).where(headWhere);
  try { await expect(accept()).rejects.toMatchObject({ reason: "concurrentHead" }); }
  finally { await persistence.drizzle.insert(fxSystemApplicationActiveHeads).values(heads); }
  expect(await accept(await prepare())).toEqual(base.reference);

  if ("pool" in persistence) {
    const client = await persistence.pool.connect();
    const update = "update fx_system_application_active_head set activation_sequence = activation_sequence where scope_id = $1";
    try {
      await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
        const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
        yield* readApplicationBindingProjectionInTransaction(prepared, tx, clock);
        yield* Effect.promise(async () => {
          await client.query("begin");
          try { await client.query("set local lock_timeout = '100ms'"); await expect(client.query(update, [base.reference.scopeId])).rejects.toMatchObject({ code: "55P03" }); }
          finally { await client.query("rollback"); }
        });
      })));
      expect((await client.query(update, [base.reference.scopeId])).rowCount).toBe(1);
    } finally { client.release(); }
  }
  const active = await runEffect(base.fixture.relationActivation.readActive());
  const next = await prepareAdditionalRelationRevision(base.fixture);
  await runEffect(base.fixture.relationActivation.activate({
    revisionId: next.readiness.revisionId, expectedActiveHead: active.expectedActiveHead,
  }));
  await expect(accept(prepared)).rejects.toMatchObject({ reason: "concurrentHead" });
  expect((await accept(await prepare())).revisionId).toBe(next.readiness.revisionId);
}

it("prepares inputs without readiness authority and validates once under accepting locks in PGlite", async () => {
  await exercise(await createMigratedPGlitePersistence());
}, 240_000);
it.skipIf(postgresUrl === null)("retains fresh readiness/head refusal and accepting lock lifetime on PostgreSQL", async () => {
  const fixture = await createFileScopedPostgresFixture();
  try { await exercise(fixture.persistence); } finally { await fixture.dispose(); }
}, 240_000);
