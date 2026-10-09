import { Effect, Exit, Result, Scope } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { expect, it } from "vitest";
import { claimApplicationReadServing, claimApplicationServing, constructApplicationServingOwners,
  makeApplicationServing, retainApplicationServing, type ApplicationReadServing, type ApplicationServing } from "../../src/application/applicationServing";
import { createLocatedAppSchemaCandidateValidationTarget } from "../../src/storage/catalog/appSchemaCandidateValidation";
import { createRelationalPGliteFixture } from "../database/relationalPGliteWorkerTestSupport";
import { runEffect, runEffectFailure } from "../support/effectTestRuntime";

it("captures concrete topology, rejects foreign and copied owners, and revokes serving at scope closure", async () => {
  const queries: string[] = [];
  const first = await createRelationalPGliteFixture({ observeQuery: text => { queries.push(text); } });
  const second = await createRelationalPGliteFixture();
  const locator = { kind: "database_per_scope" as const, databaseKey: "application-serving", schemaName: "public" };
  const target = createLocatedAppSchemaCandidateValidationTarget(first.persistence.drizzle, locator);
  const foreignTarget = createLocatedAppSchemaCandidateValidationTarget(second.persistence.drizzle, locator);
  let coldCalls = 0;
  const input = { controlDatabase: first.persistence.drizzle, database: first.persistence.drizzle, target,
    session: first.session, deploymentId: "application-serving", scopeId: ScopeIdSchema.make("scope_application_serving"),
    activation: { kind: "fullProof" as const }, cold: { runtimeHostIdentity: "serving-test", compatibilityDate: "2026-10-10",
      materialize: () => { coldCalls += 1; return Effect.die(new Error("Construction must not materialize.")); } } };
  const scope = await runEffect(Scope.make());
  try {
    queries.length = 0;
    const serving = await runEffect(makeApplicationServing(input).pipe(Effect.provideService(Scope.Scope, scope)));
    const state = Result.getOrThrow(claimApplicationServing(serving));
    expect(claimApplicationServing(serving)).toEqual(Result.succeed(state));
    input.target = foreignTarget;
    expect(await state.authority.scopeClockTargets.resolve(locator)).toBe(target);
    expect(await state.pointCommitAuthority.scopeSessionTargets.resolve(locator)).toBe(target);
    await expect(state.authority.scopeClockTargets.resolve({ ...locator, databaseKey: "foreign-application-serving" }))
      .rejects.toMatchObject({ reason: "invalidComposition" });
    await expect(state.pointCommitAuthority.scopeSessionTargets.resolve({ ...locator, schemaName: "foreign_schema" }))
      .rejects.toMatchObject({ reason: "invalidComposition" });
    expect(queries).toEqual([]);
    expect(coldCalls).toBe(0);
    const owners = constructApplicationServingOwners({ ...input, target });
    expect(await runEffectFailure(retainApplicationServing({ ...owners }, first.session)
      .pipe(Effect.provideService(Scope.Scope, scope)))).toMatchObject({ reason: "invalidComposition" });
    expect(await runEffectFailure(makeApplicationServing({ ...input, target, scopeSessionTarget: foreignTarget })
      .pipe(Effect.provideService(Scope.Scope, scope)))).toMatchObject({ reason: "invalidComposition" });
    expect(await runEffectFailure(makeApplicationServing({ ...input, session: second.session })
      .pipe(Effect.provideService(Scope.Scope, scope)))).toMatchObject({ reason: "invalidComposition" });
    // SAFETY: deliberate forgery witnesses verify exact private issuer identity.
    expect(Result.isFailure(claimApplicationServing(Object.freeze({}) as ApplicationServing))).toBe(true);
    // SAFETY: a command token must never authenticate in the separate read registry.
    expect(Result.isFailure(claimApplicationReadServing(serving as unknown as ApplicationReadServing))).toBe(true);
    await runEffect(Scope.close(scope, Exit.succeed(undefined)));
    expect(Result.getFailure(claimApplicationServing(serving))).toMatchObject({ value: { reason: "closed" } });
  } finally {
    await runEffect(Scope.close(scope, Exit.succeed(undefined)));
  }
}, 60_000);
