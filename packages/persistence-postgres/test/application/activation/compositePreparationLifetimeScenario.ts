import { Effect, Result } from "effect";
import { expect } from "vitest";

import type { ApplicationBindingInput } from "../../../src/application/activation/contracts";
import {
  readAcceptedApplicationBinding,
  withAcceptedApplicationBinding,
} from "../../../src/application/activation/bindingAcceptance";
import {
  prepareApplicationBindingSelection,
  prepareRetainedApplicationBindingSelection,
} from "../../../src/application/activation/repositoryIdentity";
import {
  claimApplicationExecutableActiveSelection,
  isApplicationBindingPreparation,
  readApplicationBindingTargetProtection,
} from "../../../src/application/activation/selectionIdentity";
import { makeApplicationRelationReadinessFoldRepository } from
  "../../../src/application/relations/applicationRelationReadinessFold";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import {
  captureHostPreparationLifetime,
  retainPreparedHost,
} from "../../../src/execution/preparation/preparedHostRuntime";
import { lockScopeClockForUpdateInTransactionEffect } from
  "../../../src/scope/scopeClock";
import { preparedHostTestRuntime } from
  "../../execution/preparation/preparedHostRuntimeTestSupport";
import {
  prepareReadinessEvidence,
  relationReadinessFixture,
} from "../relations/applicationRelationReadinessFixture";
import { runEffect } from "../../support/effectTestRuntime";

/** Both drivers exercise the same actual composite Application construction,
 * retained allocation, and fresh accepting transaction. */
export async function compositePreparationLifetimeScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  writePolicy: boolean,
): Promise<void> {
  const fixture = await relationReadinessFixture({ persistence, writePolicy });
  await prepareReadinessEvidence(fixture);
  const readiness = await runEffect(fixture.fold.settle(fixture.input));
  expect(readiness.status).toBe("ready");
  await runEffect(fixture.relationActivation.activate({
    revisionId: fixture.input.revisionId,
    expectedActiveHead: null,
  }));
  const active = await runEffect(fixture.relationActivation.readActive());
  expect(fixture.manifest.version).toBe(writePolicy ? 3 : 2);
  expect("relationCount" in active.basis).toBe(true);

  const foreignFold = makeApplicationRelationReadinessFoldRepository(fixture.foldContext);
  const accept = (input: ApplicationBindingInput) => persistence.drizzle.transaction(tx =>
    runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId);
      const accepted = yield* withAcceptedApplicationBinding(input, tx, clock,
        binding => Effect.gen(function* () {
          const basis = yield* Effect.fromResult(readAcceptedApplicationBinding(binding, tx, clock, fixture.fold));
          expect(basis.revisionId).toBe(fixture.input.revisionId);
          expect(basis.schemaVersionId).toBe(fixture.relation.binding.schemaVersionId);
          expect(Result.isFailure(readAcceptedApplicationBinding(binding, tx, clock, foreignFold))).toBe(true);
          return Object.freeze({ basis, binding });
        }));
      // The source callback closes its authentic borrow before this operation
      // returns; even the same transaction cannot keep the borrowed token alive.
      expect(Result.isFailure(readAcceptedApplicationBinding(accepted.binding, tx, clock))).toBe(true);
      return accepted.basis;
    })),
  );

  let disposals = 0;
  const host = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle),
    Effect.succeed(Object.freeze({ fixture: "composite-lifetime" }))));
  try {
    const generation = await runEffect(host.reconstruct(() => Effect.gen(function* () {
      const lifetime = yield* captureHostPreparationLifetime();
      if (lifetime === undefined) throw new Error("Expected the actual ambient retained construction lease");
      yield* Effect.fromResult(lifetime.onDispose(() => { disposals += 1; }));
      const before = Result.getOrThrow(host.readUsage()).chargedBytes;
      const request = yield* prepareApplicationBindingSelection(fixture.relationActivation);
      const afterRequest = Result.getOrThrow(host.readUsage()).chargedBytes;
      const retained = yield* prepareRetainedApplicationBindingSelection(fixture.relationActivation);
      const afterRetained = Result.getOrThrow(host.readUsage()).chargedBytes;
      const requestProtection = yield* Effect.fromResult(readApplicationBindingTargetProtection(request));
      const retainedProtection = yield* Effect.fromResult(readApplicationBindingTargetProtection(retained));
      expect(requestProtection.lifetime).toBeUndefined();
      expect(retainedProtection.lifetime?.checkOpen).toBe(lifetime.checkOpen);
      return Object.freeze({ request, retained, lifetime, before, afterRequest, afterRetained });
    })));
    const prepared = await runEffect(generation.use(value => Effect.succeed(value)));
    expect(prepared.before).toBe(0);
    expect(prepared.afterRequest).toBe(prepared.before);
    expect(prepared.afterRetained).toBeGreaterThan(prepared.afterRequest);
    expect(Result.getOrThrow(host.readUsage()).chargedBytes).toBe(prepared.afterRetained);
    expect(disposals).toBe(0);
    expect(isApplicationBindingPreparation(prepared.request)).toBe(true);
    expect(isApplicationBindingPreparation(prepared.retained)).toBe(true);
    expect(isApplicationBindingPreparation({ ...prepared.request })).toBe(false);
    expect(Result.isFailure(claimApplicationExecutableActiveSelection(prepared.request))).toBe(true);
    expect(Result.isFailure(claimApplicationExecutableActiveSelection(prepared.retained))).toBe(true);
    const foreignRepository = await runEffect(Effect.result(
      prepareApplicationBindingSelection({ ...fixture.relationActivation }),
    ));
    expect(Result.isFailure(foreignRepository)).toBe(true);
    if (Result.isFailure(foreignRepository)) expect(foreignRepository.failure).toMatchObject({ reason: "invalidComposition" });
    await expect(accept(prepared.request)).resolves.toMatchObject({ revisionId: fixture.input.revisionId });
    await expect(accept(prepared.retained)).resolves.toMatchObject({ revisionId: fixture.input.revisionId });

    await runEffect(host.close);
    expect(disposals).toBe(1);
    expect(Result.isFailure(prepared.lifetime.checkOpen())).toBe(true);
    expect(Result.isFailure(host.readUsage())).toBe(true);
    expect(isApplicationBindingPreparation(prepared.request)).toBe(true);
    expect(isApplicationBindingPreparation(prepared.retained)).toBe(false);
    expect(Result.getOrThrow(readApplicationBindingTargetProtection(prepared.request)).lifetime).toBeUndefined();
    await expect(accept(prepared.request)).resolves.toMatchObject({ revisionId: fixture.input.revisionId });
    await expect(accept(prepared.retained)).rejects.toMatchObject({ reason: "invalidComposition" });
    await runEffect(host.close);
    expect(disposals).toBe(1);
  } finally {
    await runEffect(host.close);
  }
}
