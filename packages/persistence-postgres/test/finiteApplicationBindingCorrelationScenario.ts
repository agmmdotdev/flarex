import type { SessionJournalAttempt } from "../src/sessionJournalStore";
import { eq } from "drizzle-orm";
import { Cause, Effect, Exit, Result, Tracer } from "effect";
import { expect } from "vitest";
import { captureFiniteApplicationBindingCorrelation, prepareApplicationBindingSelection,
  withFiniteApplicationBindingCorrelationInTransaction, type AcceptedApplicationBinding,
  type FiniteApplicationBindingCorrelation } from "../src/applicationActivation";
import { withApplicationBindingEvidenceInTransaction, withFiniteApplicationBindingEvidenceInTransaction } from "../src/applicationBindingProjection";
import { readCheckedApplicationActiveHead, type CheckedApplicationActiveHead } from "../src/applicationActiveHeadRead";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { fxSystemApplicationRevisionSchemas } from "../src/applicationRelationSchema";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { cmsHostFixture } from "./cmsHostFixture";
import { runEffect } from "./effectTestRuntime";

export async function finiteApplicationBindingCorrelationScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing actual schema");
  const controlPersistence = "pool" in persistence ? persistence : await createMigratedPGlitePersistence();
  const base = await cmsHostFixture(persistence, { controlPersistence,
    physicalLocator: { kind: "database_per_scope", databaseKey: "finite_binding_correlation_target", schemaName } });
  const selection = await runEffect(prepareApplicationBindingSelection(base.fixture.relationActivation));
  const otherSelection = await runEffect(prepareApplicationBindingSelection(base.fixture.relationActivation));
  // SAFETY: identity-only unit carrier; real root authentication stays with the source owner.
  const root = Object.freeze({}) as SessionJournalAttempt;
  let captured: FiniteApplicationBindingCorrelation | undefined;
  let accepted: AcceptedApplicationBinding | undefined;
  await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, base.fixture.authority.scopeId);
    yield* withApplicationBindingEvidenceInTransaction(selection, tx, clock, (evidence, binding) => Effect.gen(function* () {
      expect(evidence.projection).toEqual(base.reference);
      accepted = binding;
      captured = yield* Effect.fromResult(captureFiniteApplicationBindingCorrelation(binding, selection, tx, clock, root));
    }));
    if (accepted === undefined) throw new Error("Missing full-entry binding");
    expect(Result.isFailure(captureFiniteApplicationBindingCorrelation(accepted, selection, tx, clock, root))).toBe(true);
  })));
  if (captured === undefined) throw new Error("Missing installed finite token");
  const token = captured;
  const spans: string[] = [];
  const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
  await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, base.fixture.authority.scopeId);
    for (const input of [{ token, selection, root: Object.freeze({}) as SessionJournalAttempt }, { token, selection: otherSelection, root },
      // SAFETY: deliberately forged inert carrier; registry membership is the witness.
      { token: Object.freeze({}) as FiniteApplicationBindingCorrelation, selection, root }]) {
      let called = false;
      const exit = yield* Effect.exit(withFiniteApplicationBindingEvidenceInTransaction(input.token, input.selection, input.root,
        tx, clock, () => Effect.sync(() => { called = true; })));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const reason = exit.cause.reasons[0];
        expect(reason !== undefined && Cause.isFailReason(reason)).toBe(true);
      }
      expect(called).toBe(false);
    }
    for (const ending of ["success", "failure", "interruption"] as const) {
      let checked: CheckedApplicationActiveHead | undefined;
      const exit = yield* Effect.exit(withFiniteApplicationBindingCorrelationInTransaction(token, selection, root, tx, clock,
        (validated, observed) => Effect.gen(function* () {
          checked = observed;
          expect(Result.isSuccess(readCheckedApplicationActiveHead(observed, tx, clock))).toBe(true);
          // A callback cannot mutate the retained token's byte ownership.
          validated.basis.headSha256.fill(0);
          if (ending === "failure") return yield* Effect.fail("finite callback failure");
          if (ending === "interruption") return yield* Effect.interrupt;
        })));
      expect(exit._tag).toBe(ending === "success" ? "Success" : "Failure");
      if (checked === undefined) throw new Error("Expected live checked head");
      expect(Result.isFailure(readCheckedApplicationActiveHead(checked, tx, clock))).toBe(true);
      expect(yield* withFiniteApplicationBindingEvidenceInTransaction(token, selection, root, tx, clock,
        evidence => Effect.succeed(evidence.projection))).toEqual(base.reference);
    }
  }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
  expect(spans).not.toContain("ApplicationRelationReadinessFold.validatePreparedInTransaction");
  expect(spans).toContain("ApplicationActivation.withFiniteBindingCorrelation");
  const row = (await persistence.drizzle.select().from(fxSystemApplicationRevisionSchemas)
    .where(eq(fxSystemApplicationRevisionSchemas.scopeId, base.fixture.authority.scopeId)))[0];
  if (row === undefined) throw new Error("Missing original Application schema binding");
  // This field is deliberately outside the readiness FK. A legal stored-row
  // change must still be rejected by fresh Application/schema correlation.
  await persistence.drizzle.update(fxSystemApplicationRevisionSchemas).set({ deploymentId: `${row.deploymentId}-changed` })
    .where(eq(fxSystemApplicationRevisionSchemas.scopeId, base.fixture.authority.scopeId));
  try {
    await expect(persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, base.fixture.authority.scopeId);
      return yield* withFiniteApplicationBindingEvidenceInTransaction(token, selection, root, tx, clock,
        () => Effect.die("Changed schema reached read body"));
    })))).rejects.toMatchObject({ reason: "concurrentHead" });
  } finally {
    await persistence.drizzle.update(fxSystemApplicationRevisionSchemas).set({ deploymentId: row.deploymentId })
      .where(eq(fxSystemApplicationRevisionSchemas.scopeId, base.fixture.authority.scopeId));
  }
}
