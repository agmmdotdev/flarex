import { Effect } from "effect";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { sql } from "drizzle-orm";
import { expect, vi } from "vitest";
import { payloadScalarFields, payloadScalarConfiguration } from "../../payload-adapter/src/testing/profiles";
import { policyManifestFixture } from "./applicationWritePolicyFixture";
import { makeApplicationActivationRepository } from "../src/applicationActivation";
import { fxSystemApplicationActivations, fxSystemApplicationActiveHeads } from "../src/applicationActivationSchema";
import { makeApplicationRelationReadinessFoldRepository, readApplicationActivationRelatedPhysicalRequirements, readApplicationRelationActivationUniqueRequirements, withApplicationActivationCatalogLock, type ApplicationActivationCatalogLease } from "../src/applicationRelationReadinessFold";
import { loadRelatedPublishedPhysicalRequirementSnapshotV1 } from "../src/indexBuildReconciliation";
import { readUniqueMaintenanceRequirements } from "../src/appUniqueConstraintSetBuildV1";
import { fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds } from "../src/schema";
import { isLocatedReadCommittedAttemptTargetV1 } from "../src/transactionSessionAttemptKernel";
import { prepareReadinessEvidence, relationReadinessFixture } from "./applicationRelationReadinessFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { preparePayloadRelationSuccessor } from "./payloadRelationFixture";

export async function applicationActivationCatalogScenario(
  options: Pick<NonNullable<Parameters<typeof relationReadinessFixture>[0]>, "persistence" | "controlPersistence"> = {},
) {
  const fixture = await relationReadinessFixture({ ...options, writePolicy: true, cmsIndexes: true,
    cmsFields: payloadScalarFields,
    cmsManifest: await policyManifestFixture(undefined, true, payloadScalarFields, payloadScalarConfiguration) });
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
    uniqueBuilds: await fixture.persistence.drizzle.select().from(fxSystemUniqueConstraintBuilds).orderBy(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId),
    heads: await fixture.persistence.drizzle.select().from(fxSystemApplicationActiveHeads),
    activations: await fixture.persistence.drizzle.select().from(fxSystemApplicationActivations).orderBy(fxSystemApplicationActivations.activationSequence),
  });
  // Exercise both closure and member-query wrappers, including Drizzle's
  // provider envelope. Classification belongs here, before activation maps it.
  const beforeCatalogFailures = await snapshot();
  for (const failAt of [1, 2]) {
    for (const code of ["40001", "40P01", "55P03", "23505"]) {
      for (const wrapped of [false, true]) {
        let reads = 0;
        const original = fixture.control.drizzle.select.bind(fixture.control.drizzle);
        const providerCause = Object.assign(new Error("Injected catalog query failure"), { code });
        const failureCause = wrapped ? new DrizzleQueryError("catalog query", [], providerCause) : providerCause;
        const failureSelect = vi.spyOn(fixture.control.drizzle, "select").mockImplementation((...args: Parameters<typeof original>) => {
          if (++reads === failAt) throw failureCause;
          return original(...args);
        });
        try {
          const failure = await runEffectFailure(readUniqueMaintenanceRequirements(fixture.control.drizzle,
            fixture.deploymentId, fixture.relation.binding.schemaVersionId));
          expect(failure).toMatchObject({ reason: "resourceFailure", retryable: code !== "23505",
            cause: { _tag: failAt === 1 ? "AppUniqueConstraintSetClosurePersistenceV1Error" : "AppUniqueConstraintCatalogPersistenceError",
              cause: failureCause } });
        } finally { failureSelect.mockRestore(); }
      }
    }
  }
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  const digestFailure = vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) => {
    if (new TextDecoder().decode(data).startsWith('{"format":"flarexdb-app-unique-constraint-set",')) {
      return Promise.reject(Object.assign(new Error("Digest unavailable"), { code: "40001" }));
    }
    return originalDigest(algorithm, data);
  });
  try {
    expect(await runEffectFailure(readUniqueMaintenanceRequirements(fixture.control.drizzle,
      fixture.deploymentId, fixture.relation.binding.schemaVersionId))).toMatchObject({ reason: "resourceFailure", retryable: false });
  } finally { digestFailure.mockRestore(); }
  expect(await snapshot()).toEqual(beforeCatalogFailures);
  // Start the refusal at the activation write: the catalog lease and target
  // transaction are now both held, and outgoing requirements have not been read.
  let armed = false;
  let refuseReads = 0;
  let reachedMaintenance = 0;
  let injectedFailure: Error | undefined = Object.assign(new Error("Transient maintenance fault"), { code: "55P03" });
  const originalSelect = fixture.control.drizzle.select.bind(fixture.control.drizzle);
  const select = vi.spyOn(fixture.control.drizzle, "select").mockImplementation((...args: Parameters<typeof originalSelect>) => {
    if (armed) { refuseReads++; throw new Error("Original catalog handle read under activation lease"); }
    return originalSelect(...args);
  });
  const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    readiness: fixture.legacyReadiness, relationReadiness: fixture.fold, authority: fixture.authorityPorts,
    faultAfter: point => {
      if (point === "activationInserted") armed = true;
      if (point === "uniqueMaintenanceWritten") {
        reachedMaintenance++;
        if (injectedFailure !== undefined) throw injectedFailure;
      }
    },
  });
  try {
    const before = await snapshot();
    // Raise real provider errors from the unique-build UPDATE, after the other
    // activation writes. This exercises the shared SQL adapter and full rollback.
    await fixture.persistence.drizzle.execute(sql`create function test_reject_unique_maintenance() returns trigger language plpgsql as $$
      begin raise exception 'Injected unique-build statement failure' using errcode = TG_ARGV[0]; end $$`);
    try {
      for (const code of ["55P03", "23514"]) {
        await fixture.persistence.drizzle.execute(sql.raw(`create trigger test_reject_unique_maintenance before update
          on fx_system_unique_constraint_build for each row when (new.maintenance_activation_sequence = 2)
          execute function test_reject_unique_maintenance('${code}')`));
        try {
          expect(await runEffectFailure(activation.activate(input))).toMatchObject({ reason: "resourceFailure", retryable: code === "55P03",
            cause: { _tag: "AppUniqueConstraintSetBuildIntegrationV1Error" } });
          armed = false;
          expect(reachedMaintenance).toBe(0);
          expect(await snapshot()).toEqual(before);
        } finally {
          armed = false;
          await fixture.persistence.drizzle.execute(sql`drop trigger test_reject_unique_maintenance on fx_system_unique_constraint_build`);
        }
      }
    } finally { await fixture.persistence.drizzle.execute(sql`drop function test_reject_unique_maintenance()`); }
    const failure = await runEffectFailure(activation.activate(input));
    armed = false;
    expect(failure).toMatchObject({ reason: "resourceFailure", retryable: true });
    expect(reachedMaintenance).toBe(1);
    expect(await snapshot()).toEqual(before);
    injectedFailure = new Error("Terminal maintenance fault");
    expect(await runEffectFailure(activation.activate(input))).toMatchObject({ reason: "resourceFailure", retryable: false });
    armed = false;
    expect(reachedMaintenance).toBe(2);
    expect(await snapshot()).toEqual(before);
    injectedFailure = undefined;
    const result = await runEffect(activation.activate(input));
    armed = false;
    expect(result).toMatchObject({ status: "activated", activationSequence: 2n });
    const after = await snapshot();
    expect(after.builds.some(build => build.maintenanceActivationSequence === 2n)).toBe(true);
    expect(after.builds.every(build => build.maintenanceActivationSequence !== 1n)).toBe(true);
    expect(after.uniqueBuilds.some(build => build.maintenanceActivationSequence === 2n)).toBe(true);
    expect(after.uniqueBuilds.every(build => build.maintenanceActivationSequence !== 1n)).toBe(true);
    expect(await runEffect(activation.activate(input))).toMatchObject({ disposition: "replayed", activationSequence: 2n });
    expect(await runEffect(activation.activate(firstInput))).toMatchObject({ disposition: "replayed", activationSequence: first.activationSequence });
    expect(await snapshot()).toEqual(after);
    expect(refuseReads).toBe(0);
  } finally { armed = false; select.mockRestore(); }

  const issued = await runEffect(fixture.fold.settle({ ...successor.input, scopeId: fixture.authority.scopeId }));
  const otherIssued = await runEffect(fixture.fold.settle({ ...successor.input, scopeId: fixture.authority.scopeId }));
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
      const readUnique = (repository = fixture.fold, ready = issued, selectedLease: ApplicationActivationCatalogLease | undefined = lease) =>
        readApplicationRelationActivationUniqueRequirements(repository, ready, fixture.relation.binding.schemaVersionId, target, tx, selectedLease);
      expect((await runEffect(readUnique())).closure.schemaVersionId).toBe(fixture.relation.binding.schemaVersionId);
      for (const rejected of [readUnique(foreignRepository), readUnique(fixture.fold, otherIssued), readUnique(fixture.fold, issued, { ...lease }),
        readApplicationRelationActivationUniqueRequirements(fixture.fold, issued, fixture.relation.binding.schemaVersionId, target, tx, undefined)]) {
        expect(await runEffectFailure(rejected)).toMatchObject({ reason: "storedState" });
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
    expect(await runEffectFailure(readApplicationRelationActivationUniqueRequirements(fixture.fold, issued,
      fixture.relation.binding.schemaVersionId, target, tx, retainedLease))).toMatchObject({ reason: "storedState" });
  });
}
