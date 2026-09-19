import { Effect } from "effect";
import { expect, vi } from "vitest";
import { payloadScalarFields } from "../../payload-adapter/src/conformanceProfile";
import { makeApplicationActivationRepository } from "../src/applicationActivation";
import { fxSystemApplicationActivations, fxSystemApplicationActiveHeads } from "../src/applicationActivationSchema";
import { makeApplicationRelationReadinessFoldRepository, readApplicationActivationRelatedPhysicalRequirements, withApplicationActivationCatalogLock, type ApplicationActivationCatalogLease } from "../src/applicationRelationReadinessFold";
import { loadRelatedPublishedPhysicalRequirementSnapshotV1 } from "../src/indexBuildReconciliation";
import { fxSystemIndexBuildStates } from "../src/schema";
import { isLocatedReadCommittedAttemptTargetV1 } from "../src/transactionSessionAttemptKernel";
import { prepareReadinessEvidence, relationReadinessFixture } from "./applicationRelationReadinessFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { preparePayloadRelationSuccessor } from "./payloadRelationFixture";

export async function applicationActivationCatalogScenario(
  options: Pick<NonNullable<Parameters<typeof relationReadinessFixture>[0]>, "persistence" | "controlPersistence"> = {},
) {
  const fixture = await relationReadinessFixture({ ...options, writePolicy: true, cmsIndexes: true,
    cmsFields: payloadScalarFields });
  const target = fixture.pointTarget;
  if (!isLocatedReadCommittedAttemptTargetV1(target)) throw new Error("Expected read-committed target");
  expect(fixture.control.drizzle).not.toBe(fixture.persistence.drizzle);
  await prepareReadinessEvidence(fixture);
  const firstInput = { revisionId: fixture.input.revisionId, expectedActiveHead: null };
  const first = await runEffect(fixture.relationActivation.activate(firstInput));
  const active = await runEffect(fixture.relationActivation.readActive());
  const successor = await preparePayloadRelationSuccessor(fixture);
  const input = { revisionId: successor.input.revisionId, expectedActiveHead: active.expectedActiveHead };
  const snapshot = async () => ({
    builds: await fixture.persistence.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId),
    heads: await fixture.persistence.drizzle.select().from(fxSystemApplicationActiveHeads),
    activations: await fixture.persistence.drizzle.select().from(fxSystemApplicationActivations).orderBy(fxSystemApplicationActivations.activationSequence),
  });
  // Start the refusal at the activation write: the catalog lease and target
  // transaction are now both held, and outgoing requirements have not been read.
  let armed = false;
  let refuseReads = 0;
  let reachedMaintenance = 0;
  let injectRollback = true;
  const originalSelect = fixture.control.drizzle.select.bind(fixture.control.drizzle);
  const select = vi.spyOn(fixture.control.drizzle, "select").mockImplementation((...args: Parameters<typeof originalSelect>) => {
    if (armed) { refuseReads++; throw new Error("Original catalog handle read under activation lease"); }
    return originalSelect(...args);
  });
  const activation = makeApplicationActivationRepository({ deploymentId: fixture.deploymentId,
    readiness: fixture.legacyReadiness, relationReadiness: fixture.fold, authority: fixture.authorityPorts,
    faultAfter: point => {
      if (point === "activationInserted") armed = true;
      if (point === "maintenanceOpened") {
        reachedMaintenance++;
        if (injectRollback) throw new Error("Rollback successor maintenance");
      }
    },
  });
  try {
    const before = await snapshot();
    const failure = await runEffectFailure(activation.activate(input));
    armed = false;
    expect(failure).toMatchObject({ reason: "resourceFailure" });
    expect(reachedMaintenance).toBe(1);
    expect(await snapshot()).toEqual(before);
    injectRollback = false;
    const result = await runEffect(activation.activate(input));
    armed = false;
    expect(result).toMatchObject({ status: "activated", activationSequence: 2n });
    const after = await snapshot();
    expect(after.builds.some(build => build.maintenanceActivationSequence === 2n)).toBe(true);
    expect(after.builds.every(build => build.maintenanceActivationSequence !== 1n)).toBe(true);
    expect(await runEffect(activation.activate(input))).toMatchObject({ disposition: "replayed", activationSequence: 2n });
    expect(await runEffect(activation.activate(firstInput))).toMatchObject({ disposition: "replayed", activationSequence: first.activationSequence });
    expect(await snapshot()).toEqual(after);
    expect(refuseReads).toBe(0);
  } finally { armed = false; select.mockRestore(); }

  const issued = await runEffect(fixture.fold.settle(successor.input));
  const otherIssued = await runEffect(fixture.fold.settle(successor.input));
  const foreignRepository = makeApplicationRelationReadinessFoldRepository(fixture.foldContext);
  let retainedLease: ApplicationActivationCatalogLease | undefined;
  await runEffect(withApplicationActivationCatalogLock(fixture.fold, issued, lease => Effect.promise(async () => {
    if (lease === undefined) throw new Error("Expected policy catalog lease");
    retainedLease = lease;
    await fixture.persistence.drizzle.transaction(async tx => {
      const read = (repository = fixture.fold, ready = issued, selectedLease: ApplicationActivationCatalogLease | undefined = lease) =>
        readApplicationActivationRelatedPhysicalRequirements(repository, ready, fixture.relation.binding.schemaVersionId, target, tx, selectedLease);
      const requirements = await runEffect(read());
      expect(requirements?.schemaVersionId).toBe(fixture.relation.binding.schemaVersionId);
      for (const rejected of [read(foreignRepository), read(fixture.fold, otherIssued), read(fixture.fold, issued, { ...lease }),
        readApplicationActivationRelatedPhysicalRequirements(fixture.fold, issued, fixture.relation.binding.schemaVersionId, target, tx, undefined)]) {
        expect(await runEffectFailure(rejected)).toMatchObject({ reason: "invalidInputShape" });
      }
      if (requirements === null) throw new Error("Expected outgoing requirements");
      // Even the same-schema fast path must reject a foreign catalog issuer.
      expect(await runEffectFailure(loadRelatedPublishedPhysicalRequirementSnapshotV1(requirements, requirements.schemaVersionId,
        target, tx, { database: fixture.persistence.drizzle, transaction: tx }))).toMatchObject({ reason: "invalidInputShape" });
    });
  })));
  await fixture.persistence.drizzle.transaction(async tx => {
    expect(await runEffectFailure(readApplicationActivationRelatedPhysicalRequirements(fixture.fold, issued,
      fixture.relation.binding.schemaVersionId, target, tx, retainedLease))).toMatchObject({ reason: "invalidInputShape" });
  });
}
