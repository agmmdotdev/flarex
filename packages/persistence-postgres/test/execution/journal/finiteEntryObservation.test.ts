import { isNonArrayRecord } from "@flarex/utils/records";
import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { describe, expect, it, vi } from "vitest";

import type { AppRowTransaction } from "../../../src/storage/documents/appRows";
import {
  captureFiniteEntryObservationInTransactionEffect, closeFiniteEntryObservation,
  readFiniteEntryApplicationObservation, readFiniteEntryBindingObservation, readFiniteEntryPlanningObservation,
  type FiniteEntryObservation,
} from "../../../src/execution/finiteEntryObservation";
import {
  lockScopeClockRowsForOrdinaryWriteInTransactionEffect, readExactScopeWriteClockObservation,
  closeExactAttemptScopeClockObservation, type ScopeClockRecord,
} from "../../../src/scope/scopeClock";
import {
  readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect, releaseCheckedApplicationActiveHead,
  type CheckedApplicationActiveHead,
} from "../../../src/application/applicationActiveHeadRead";
import { fxSystemApplicationActiveHeads } from "../../../src/application/applicationActivationSchema";
import { selectApplicationMutationAdmission } from "../../../src/application/applicationMutationAdmission";
import {
  createApplicationMutationSessionActivationPersistenceV1,
} from "../../../src/execution/transactionSessionActivation";
import {
  captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect,
} from "../../../src/storage/catalog/appSchemaCandidateValidation";
import {
  makeDataBindingHost,
  dataBindingActivationRequest,
} from "../../../src/installation/frameworkSchema/binding/host";
import { readBindingSelectedEvidence } from "../../../src/installation/frameworkSchema/binding/repository";
import type { DataBindingSetFrame } from "../../../src/installation/frameworkSchema/binding/model";
import {
  makeFrameworkSchemaTarget,
  type FrameworkSchemaTarget,
} from "../../../src/installation/frameworkSchema/target";
import { fxSystemTransactionSessions } from "../../../src/database/schema";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import {
  makePGliteFrameworkMigrationTargetEffect,
} from "../../installation/frameworkSchema/frameworkMigrationPGliteTarget";
import {
  createApplicationNativeMutationPGliteFixtureWithPersistence, createApplicationNativeMutationPostgresFixture,
  type ApplicationNativeMutationFixture, type ApplicationNativeMutationPersistence,
} from "../../application/applicationNativeMutationTestFixture";
import {
  applicationMutationActivationFixture,
} from "../../application/applicationMutationActivationFixture";
import { bindingInput } from "../../installation/frameworkSchema/frameworkDataBindingTestSupport";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../support/postgresHelpers";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

const refusal = { _tag: "Failure", failure: { _tag: "FiniteEntryObservationError", reason: "invalidObservation" } };

/** Both lanes use genuine Application/binding publishers and the existing
 * scope-clock issuer. No detached clock or test-authored positive capability
 * is installed into a registry. */
async function exerciseFiniteEntryObservation<Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, target: FrameworkSchemaTarget,
) {
  const scopeId = fixture.authority.scopeId;
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  const schemaName = fixture.active.basis.authority.physicalLocator.schemaName;
  const host = await runEffect(makeDataBindingHost(bindingInput(fixture, target)));
  const reference = await runEffect(host.readApplicationReference());
  const frame: DataBindingSetFrame = {
    format: "flarex.data-binding-set", application: reference, logicalSchema: null,
    payloadContent: null, payloadLifecycle: null, commerce: [], crossDomainReferences: [],
  };
  const candidate = await runEffect(host.prepare(frame));
  await runEffect(host.activate(dataBindingActivationRequest(scopeId, reference.storageGeneration,
    "observation-binding", candidate.sha256, null)));

  const holdClock = async (tx: AppRowTransaction): Promise<ScopeClockRecord> => {
    await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
    const clock = readExactScopeWriteClockObservation(tx, scopeId);
    if (clock === undefined) throw new Error("Real scope-clock owner did not issue its observation");
    return clock;
  };
  const capture = (tx: AppRowTransaction, clock: ScopeClockRecord, requestKey: string) =>
    runEffect(captureFiniteEntryObservationInTransactionEffect(tx, schemaName, clock, scopeUuid,
      clock.storageGeneration, requestKey));

  let escaped: Readonly<{ observation: FiniteEntryObservation; clock: ScopeClockRecord }> | undefined;
  let originalHeadBytes: Uint8Array | undefined;
  await fixture.target.drizzle.transaction(async tx => {
    const clock = await holdClock(tx);
    const entry = await capture(tx, clock, "observation-new");
    const observation = entry.observation;
    if (observation === null) throw new Error("New request unexpectedly found a historical anchor");
    escaped = { observation, clock };
    try {
      expect(entry.sessions).toEqual([]);
      expect(entry.databaseNow).toBeInstanceOf(Date);
      const cloning = vi.spyOn(globalThis, "structuredClone");
      try {
        const application = Result.getOrThrow(readFiniteEntryApplicationObservation(observation, tx, clock));
        const head = application.applicationHead;
        const activation = application.applicationActivation;
        if (head === null || activation === null) throw new Error("Published Application observation is missing");
        expect(head.activationSequence).toBe(1n);
        expect(activation.activatedAt).toBeInstanceOf(Date);
        expect(head.headBytes).toBeInstanceOf(Uint8Array);
        expect(activation.activationBytes).toBeInstanceOf(Uint8Array);
        expect(cloning.mock.calls.every(([value]) => !isNonArrayRecord(value) ||
          !Object.hasOwn(value, "canonicalBytes"))).toBe(true);
        originalHeadBytes = head.headBytes.slice();
        head.headBytes.fill(0);
        activation.activatedAt.setTime(0);
        const again = Result.getOrThrow(readFiniteEntryApplicationObservation(observation, tx, clock));
        expect(again.applicationHead?.headBytes).toEqual(originalHeadBytes);
        expect(again.applicationActivation?.activatedAt.getTime()).toBeGreaterThan(0);

        cloning.mockClear();
        const binding = Result.getOrThrow(readFiniteEntryBindingObservation(observation, tx, scopeId, clock.storageGeneration));
        const storedCandidate = binding.bindingCandidate;
        if (storedCandidate?.canonicalBytes === undefined || storedCandidate.canonicalBytes === null)
          throw new Error("Published binding candidate bytes are missing");
        expect(storedCandidate.sha256).toBe(candidate.sha256);
        expect(binding.bindingActivation?.sequence).toBe(1n);
        expect(cloning.mock.calls.every(([value]) => !isNonArrayRecord(value) ||
          (!Object.hasOwn(value, "headBytes") && !Object.hasOwn(value, "frameBytes")))).toBe(true);
        const candidateBytes = storedCandidate.canonicalBytes.slice();
        storedCandidate.canonicalBytes.fill(0);
        expect(Result.getOrThrow(readFiniteEntryBindingObservation(observation, tx, scopeId,
          clock.storageGeneration)).bindingCandidate?.canonicalBytes).toEqual(candidateBytes);

        cloning.mockClear();
        const planning = Result.getOrThrow(readFiniteEntryPlanningObservation(observation, tx, scopeId, clock.storageGeneration));
        if (planning === null) throw new Error("Published schema planning head is missing");
        expect(planning.frameBytes).toBeInstanceOf(Uint8Array);
        expect(typeof planning.attemptFence).toBe("bigint");
        expect(planning.updatedAt).toBeInstanceOf(Date);
        expect(cloning.mock.calls.every(([value]) => !isNonArrayRecord(value) ||
          (!Object.hasOwn(value, "canonicalBytes") && !Object.hasOwn(value, "headBytes")))).toBe(true);
      } finally { cloning.mockRestore(); }

      // Consumer owners authenticate the original bytes despite borrower mutation.
      let checked: CheckedApplicationActiveHead | undefined;
      try {
        const active = await runEffect(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock,
          issued => { checked = issued; }, undefined, observation));
        expect(active?.active.head.headSha256).toEqual(fixture.active.basis.headSha256);
        const binding = await runEffect(readBindingSelectedEvidence(tx,
          { scopeId, storageGeneration: clock.storageGeneration }, undefined, observation));
        expect(Option.isSome(binding)).toBe(true);
        if (Option.isSome(binding)) expect(binding.value.candidate.sha256).toBe(candidate.sha256);
        await runEffect(captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect(tx,
          { ...fixture.active.basis.authority, ...clock }, fixture.sessionAuthority, observation));
      } finally { releaseCheckedApplicationActiveHead(checked); }

      // SAFETY: these deliberately counterfeit the opaque carrier for refusal witnesses.
      const prototypeForgery = Object.create(Object.getPrototypeOf(observation)) as FiniteEntryObservation;
      expect(readFiniteEntryApplicationObservation(prototypeForgery, tx, clock)).toMatchObject(refusal);
      const reflectedForgery = Reflect.construct(Object.getPrototypeOf(observation).constructor,
        [Symbol("ForeignFiniteEntryIssuer"), tx, clock, [], Symbol("ForeignClockIdentity")]) as FiniteEntryObservation;
      expect(readFiniteEntryApplicationObservation(reflectedForgery, tx, clock)).toMatchObject(refusal);
      expect(readFiniteEntryApplicationObservation(structuredClone(observation), tx, clock)).toMatchObject(refusal);
      expect(readFiniteEntryApplicationObservation(observation, tx,
        { ...clock, updatedAt: new Date(clock.updatedAt.getTime() + 1) })).toMatchObject(refusal);
      closeExactAttemptScopeClockObservation(tx);
      expect(readFiniteEntryApplicationObservation(observation, tx, clock)).toMatchObject(refusal);
      const reopened = await holdClock(tx);
      expect(readFiniteEntryApplicationObservation(observation, tx, reopened)).toMatchObject(refusal);
    } finally { closeExactAttemptScopeClockObservation(tx); }
  });

  const previous = escaped;
  if (previous === undefined) throw new Error("No genuine observation was captured");
  try {
    await fixture.target.drizzle.transaction(async tx => {
      const clock = await holdClock(tx);
      try {
        expect(readFiniteEntryApplicationObservation(previous.observation, tx, clock)).toMatchObject(refusal);
        const fresh = await capture(tx, clock, "observation-close");
        if (fresh.observation === null) throw new Error("Close witness unexpectedly replayed");
        closeFiniteEntryObservation(fresh.observation);
        expect(readFiniteEntryApplicationObservation(fresh.observation, tx, clock)).toMatchObject(refusal);
      } finally { closeExactAttemptScopeClockObservation(tx); }
    });
  } finally { closeFiniteEntryObservation(previous.observation); }

  // The retained ordinary activation owner supplies a real full session row
  // for codec/replay proof; this does not construct a finite executable handle.
  const admission = await runEffect(selectApplicationMutationAdmission(fixture.active.selection, "users:create", {
    deploymentId: fixture.deploymentId, controlDb: fixture.control.drizzle,
    authority: fixture.authorityPorts, schema: fixture.schema,
  }));
  const prepared = await applicationMutationActivationFixture({
    deploymentId: fixture.deploymentId, selection: fixture.active.selection,
    executionAuthority: admission.executionAuthority, requestKey: "observation-replay", grantId: "observation-grant",
    validatedArgsJson: { body: "codec π" },
  });
  const activation = createApplicationMutationSessionActivationPersistenceV1(fixture.sessionAuthority,
    { leaseDurationMilliseconds: 60_000 });
  await runEffect(activation.activateEffect(prepared));
  const [storedSession] = await fixture.target.drizzle.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.requestKey, prepared.evidence.requestKey));
  if (storedSession === undefined || originalHeadBytes === undefined) throw new Error("Replay witness setup is missing");
  const preservedHeadBytes = originalHeadBytes;
  const damagedHead = preservedHeadBytes.slice();
  damagedHead[0] = (damagedHead[0] ?? 0) ^ 255;
  await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({ headBytes: damagedHead })
    .where(eq(fxSystemApplicationActiveHeads.scopeId, scopeId));
  try {
    await fixture.target.drizzle.transaction(async tx => {
      const clock = await holdClock(tx);
      try {
        const replay = await capture(tx, clock, prepared.evidence.requestKey);
        expect(replay.observation).toBeNull();
        expect(replay.sessions).toEqual([storedSession]);
        expect(replay.sessions[0]?.validatedArgsJson).toEqual({ body: "codec π" });
        expect(replay.sessions[0]?.validatedArgsCanonicalBytes).toBeInstanceOf(Uint8Array);
        expect(replay.sessions[0]?.applicationExecutionAuthorityCanonicalBytes).toBeInstanceOf(Uint8Array);
        expect(replay.sessions[0]?.createdAt).toBeInstanceOf(Date);
        expect(typeof replay.sessions[0]?.authorizationRevocationEpoch).toBe("bigint");
        const fresh = await capture(tx, clock, "observation-corrupt-new");
        if (fresh.observation === null) throw new Error("Corruption witness unexpectedly replayed");
        try {
          expect(await runEffectFailure(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock,
            issued => releaseCheckedApplicationActiveHead(issued), undefined, fresh.observation)))
            .toMatchObject({ _tag: "ApplicationActiveHeadStateError", reason: "storedState" });
        } finally { closeFiniteEntryObservation(fresh.observation); }
      } finally { closeExactAttemptScopeClockObservation(tx); }
    });
  } finally {
    await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({ headBytes: preservedHeadBytes })
      .where(eq(fxSystemApplicationActiveHeads.scopeId, scopeId));
  }
}

describe("finite entry observation boundaries", { timeout: 180_000 }, () => {
  it("uses genuine PGlite codecs and transaction-confined owner lending", async () => {
    const control = await createMigratedPGlitePersistence();
    const target = await createMigratedPGlitePersistence();
    const fixture = await createApplicationNativeMutationPGliteFixtureWithPersistence({
      runtimeHostIdentity: "flarex.test/finite-observation", compatibilityDate: "2026-10-05",
    }, { control, target });
    const migration = await runEffect(makePGliteFrameworkMigrationTargetEffect({
      persistence: target, deploymentId: fixture.deploymentId,
      canonicalPhysicalDatabaseIdentity: "finite-observation-pglite", physicalLocator: fixture.active.basis.authority.physicalLocator,
    }));
    await exerciseFiniteEntryObservation(fixture, migration.schema);
  });

  it.skipIf(postgresUrl === null)("uses the same owners and real codecs under an ordinary PostgreSQL role", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const role = await target.query<{ superuser: boolean; schemaName: string }>(
        `select r.rolsuper as superuser, current_schema() as "schemaName"
         from pg_roles r where r.rolname = current_user`);
      const identity = role.rows[0];
      if (identity === undefined) throw new Error("PostgreSQL role identity is missing");
      expect(identity.superuser).toBe(false);
      const fixture = await createApplicationNativeMutationPostgresFixture({
        runtimeHostIdentity: "flarex.test/finite-observation", compatibilityDate: "2026-10-05",
        physicalLocator: { kind: "database_per_scope", databaseKey: "application_native_mutation_target", schemaName: identity.schemaName },
      }, { control, target });
      const schema = await runEffect(makeFrameworkSchemaTarget({ database: target.drizzle, deploymentId: fixture.deploymentId,
        canonicalPhysicalDatabaseIdentity: "finite-observation-postgres", physicalLocator: fixture.active.basis.authority.physicalLocator }));
      await exerciseFiniteEntryObservation(fixture, schema);
    });
  });
});
