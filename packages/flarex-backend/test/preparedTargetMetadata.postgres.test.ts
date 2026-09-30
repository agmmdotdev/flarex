import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";
import { logicalCurrencyFixture } from "../../medusa-adapter/test/support/logical-currency-fixture";
import { readApplicationBindingTargetProtection } from "../../persistence-postgres/src/applicationActivation";
import { prepareApplicationActiveHeadStructure, readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect,
  readCheckedApplicationSchemaForHeadForShareInTransactionEffect, releaseCheckedApplicationActiveHead } from
  "../../persistence-postgres/src/applicationActiveHeadRead";
import { applicationActivationFrame, applicationActiveHeadFrame } from "../../persistence-postgres/src/applicationActivationFrames";
import { fxSystemApplicationActivations, fxSystemApplicationActiveHeads } from "../../persistence-postgres/src/applicationActivationSchema";
import { fxSystemApplicationRevisionSchemasV1 } from "../../persistence-postgres/src/schema";
import { lockScopeClockForShareInTransactionEffect, type ScopeClockRecord } from "../../persistence-postgres/src/scopeClock";
import { openProtectedMetadataFinalGuardScope, flushProtectedMetadataFinalGuards,
  closeProtectedMetadataFinalGuardScope } from "../../persistence-postgres/src/preparedMetadataEpoch";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { prepareBindingSelectedStructure, readBindingSelectedEvidence, readBindingActivation } from
  "../../persistence-postgres/src/frameworkSchema/binding/repository";
import { captureBindingValue, isDataBindingActivationFrame, isDataBindingHeadFrame } from
  "../../persistence-postgres/src/frameworkSchema/binding/canonical";
import { fxSystemDataBindingActivations, fxSystemDataBindingHeads } from
  "../../persistence-postgres/src/frameworkSchema/binding/schema";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/frameworkSchema/binding/host";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL ? describe : describe.skip;
const bytes = (frame: unknown) => {
  if (!isJson(frame)) throw new Error("Expected a canonical fixture frame");
  return new TextEncoder().encode(encodeCanonicalJson(frame, () => { throw new Error("Invalid fixture frame"); }));
};
const digest = (value: Uint8Array) => Uint8Array.from(createHash("sha256").update(value).digest());

native("protected target first-fill rollback integrity", () => {
  it("refuses uncommitted activation, schema and binding bodies before retention", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close), { protectedRuntime: true });
      const target = fixture.persistence.drizzle;
      const selected = await Effect.runPromise(fixture.application.activation.readActive());
      const protection = readApplicationBindingTargetProtection(selected.selection);
      if (protection === undefined) throw new Error("Expected an actual protected readiness issuer");
      const scopeId = fixture.application.authority.scopeId;
      const guarded = <Value>(work: (tx: FlarexMetadataTransaction, clock: ScopeClockRecord) => Promise<Value>) =>
        target.transaction(async tx => {
          const clock = await Effect.runPromise(lockScopeClockForShareInTransactionEffect(tx, scopeId));
          openProtectedMetadataFinalGuardScope(tx);
          try {
            const value = await work(tx, clock);
            await Effect.runPromise(flushProtectedMetadataFinalGuards(tx));
            return value;
          } finally { closeProtectedMetadataFinalGuardScope(tx); }
        });
      const unchangedEpoch = protection.epoch.generation.toString();
      const assertRolledBack = async () => {
        const result = await fixture.persistence.query<{ generation: string }>(
          "select generation::text from fx_system_prepared_metadata_epoch");
        expect(result.rows[0]?.generation).toBe(unchangedEpoch);
      };

      const activationPreparation = prepareApplicationActiveHeadStructure(protection, undefined, selected.basis);
      let originalActivatedAt: Date | undefined;
      await expect(guarded(async (tx, clock) => {
        const activation = (await tx.select().from(fxSystemApplicationActivations)
          .where(eq(fxSystemApplicationActivations.scopeId, scopeId)).limit(1))[0];
        const head = (await tx.select().from(fxSystemApplicationActiveHeads)
          .where(eq(fxSystemApplicationActiveHeads.scopeId, scopeId)).limit(1))[0];
        if (activation === undefined || head === undefined || activation.readinessContractVersion !== 1)
          throw new Error("Expected the retained legacy Application graph");
        originalActivatedAt = activation.activatedAt;
        const activatedAt = new Date(activation.activatedAt.getTime() + 1000);
        const readiness = { kind: "legacy" as const, contractVersion: 1 as const,
          readinessSha256: encodeBytesToLowercaseHex(activation.readinessSha256) };
        const activationBytes = bytes(applicationActivationFrame({ scopeId,
          activationSequence: activation.activationSequence.toString(),
          previousActivationSequence: activation.previousActivationSequence?.toString() ?? null,
          revisionId: activation.revisionId, readiness,
          activationRequestSha256: encodeBytesToLowercaseHex(activation.activationRequestSha256),
          activatedAt: activatedAt.toISOString() }));
        const activationSha256 = digest(activationBytes);
        const headBytes = bytes(applicationActiveHeadFrame({ scopeId,
          activationSequence: activation.activationSequence.toString(), revisionId: activation.revisionId,
          readiness, activationSha256: encodeBytesToLowercaseHex(activationSha256) }));
        await tx.delete(fxSystemApplicationActiveHeads).where(eq(fxSystemApplicationActiveHeads.scopeId, scopeId));
        await tx.update(fxSystemApplicationActivations).set({ activatedAt, activationBytes, activationSha256 })
          .where(eq(fxSystemApplicationActivations.scopeId, scopeId));
        await tx.insert(fxSystemApplicationActiveHeads).values({ ...head, headBytes,
          headSha256: digest(headBytes), activationSha256 });
        return Effect.runPromise(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock,
          checked => releaseCheckedApplicationActiveHead(checked), activationPreparation));
      // The changed live head cannot fill this issuer's pinned preparation;
      // the full path still registers and reaches the final epoch refusal.
      })).rejects.toMatchObject({ reason: "changed" });
      await assertRolledBack();
      const restoredActivation = await guarded(async (tx, clock) => {
        let issued: Parameters<typeof releaseCheckedApplicationActiveHead>[0];
        try { return await Effect.runPromise(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(
          tx, clock, checked => { issued = checked; }, activationPreparation)); }
        finally { releaseCheckedApplicationActiveHead(issued); }
      });
      expect(restoredActivation?.active.activation.activatedAt).toEqual(originalActivatedAt);

      const schemaPreparation = prepareApplicationActiveHeadStructure(protection, undefined, selected.basis);
      await expect(guarded(async (tx, clock) => {
        let issued: Parameters<typeof releaseCheckedApplicationActiveHead>[0];
        try {
          const observed = await Effect.runPromise(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(
            tx, clock, checked => { issued = checked; }, schemaPreparation));
          if (observed === null) throw new Error("Missing Application head");
          await tx.update(fxSystemApplicationRevisionSchemasV1).set({ deploymentId: "rolled_back_schema_poison" })
            .where(eq(fxSystemApplicationRevisionSchemasV1.scopeId, scopeId));
          return await Effect.runPromise(readCheckedApplicationSchemaForHeadForShareInTransactionEffect(observed.checked, tx, clock));
        } finally { releaseCheckedApplicationActiveHead(issued); }
      })).rejects.toMatchObject({ reason: "resourceFailure", cause: { reason: "changed" } });
      await assertRolledBack();
      const restoredSchema = await guarded(async (tx, clock) => {
        let issued: Parameters<typeof releaseCheckedApplicationActiveHead>[0];
        try {
          const observed = await Effect.runPromise(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(
            tx, clock, checked => { issued = checked; }, schemaPreparation));
          if (observed === null) throw new Error("Missing Application head");
          return await Effect.runPromise(readCheckedApplicationSchemaForHeadForShareInTransactionEffect(observed.checked, tx, clock));
        } finally { releaseCheckedApplicationActiveHead(issued); }
      });
      expect(restoredSchema).toMatchObject({ deploymentId: fixture.deploymentId });

      const location = { scopeId, storageGeneration: "flarexdb_v1" };
      const bindingPreparation = prepareBindingSelectedStructure(location, protection, undefined);
      const original = await target.transaction(tx => Effect.runPromise(readBindingSelectedEvidence(tx, location)));
      if (Option.isNone(original)) throw new Error("Missing selected logical binding");
      await expect(guarded(async tx => {
        const activation = await Effect.runPromise(readBindingActivation(tx, scopeId, "logical-currency-activate"));
        const headRow = (await tx.select().from(fxSystemDataBindingHeads)
          .where(eq(fxSystemDataBindingHeads.scopeId, scopeId)).limit(1))[0];
        if (Option.isNone(activation) || headRow === undefined) throw new Error("Missing binding activation");
        const changed = await Effect.runPromise(captureBindingValue({ ...activation.value.frame,
          request: { ...activation.value.frame.request, requestId: "rolled_back_binding_poison" } }, isDataBindingActivationFrame));
        const changedHead = await Effect.runPromise(captureBindingValue({ ...original.value.head.frame,
          activationSha256: changed.sha256Hex }, isDataBindingHeadFrame));
        await tx.delete(fxSystemDataBindingHeads).where(eq(fxSystemDataBindingHeads.scopeId, scopeId));
        await tx.update(fxSystemDataBindingActivations).set({ requestId: "rolled_back_binding_poison",
          sha256: changed.sha256Hex, canonicalBytes: changed.copyCanonicalBytes(), canonicalByteLength: changed.canonicalByteLength })
          .where(and(eq(fxSystemDataBindingActivations.scopeId, scopeId),
            eq(fxSystemDataBindingActivations.sequence, headRow.sequence)));
        await tx.insert(fxSystemDataBindingHeads).values({ ...headRow, activationSha256: changed.sha256Hex,
          sha256: changedHead.sha256Hex, canonicalBytes: changedHead.copyCanonicalBytes(), canonicalByteLength: changedHead.canonicalByteLength });
        return Effect.runPromise(readBindingSelectedEvidence(tx, location, bindingPreparation));
      })).rejects.toMatchObject({ reason: "resourceFailure", cause: { reason: "changed" } });
      await assertRolledBack();
      const restoredBinding = await guarded(tx => Effect.runPromise(readBindingSelectedEvidence(tx, location, bindingPreparation)));
      expect(restoredBinding).toEqual(original);

      // Both activations exist before this readiness anchor. Only a live head
      // moves inside the refusing transaction, so the immutable epoch stays fixed.
      const originalHeadRow = (await target.select().from(fxSystemDataBindingHeads)
        .where(eq(fxSystemDataBindingHeads.scopeId, scopeId)).limit(1))[0];
      if (originalHeadRow === undefined) throw new Error("Missing original binding head");
      const bindings = await Effect.runPromise(makeDataBindingHost({ database: target,
        selection: { deploymentId: fixture.deploymentId, scopeId }, target: fixture.bindingTarget,
        authority: fixture.application.authorityPorts, application: fixture.application.activation,
        logicalStorage: { controlDb: fixture.control.drizzle, schemaVersionId: fixture.schemaVersionId,
          unique: fixture.application.uniqueConstraintEligibility } }));
      await Effect.runPromise(bindings.activate(dataBindingActivationRequest(scopeId, location.storageGeneration,
        "existing-second-binding-activation", original.value.candidate.sha256,
        { sequence: original.value.head.frame.sequence, sha256: original.value.head.sha256 })));
      const secondHeadRow = (await target.select().from(fxSystemDataBindingHeads)
        .where(eq(fxSystemDataBindingHeads.scopeId, scopeId)).limit(1))[0];
      if (secondHeadRow === undefined) throw new Error("Missing second binding head");
      await target.update(fxSystemDataBindingHeads).set(originalHeadRow)
        .where(eq(fxSystemDataBindingHeads.scopeId, scopeId));
      const reselection = await Effect.runPromise(fixture.application.activation.readActive());
      const currentProtection = readApplicationBindingTargetProtection(reselection.selection);
      if (currentProtection === undefined) throw new Error("Missing renewed readiness anchor");
      let charges = 0;
      const headOnlyPreparation = prepareBindingSelectedStructure(location, currentProtection,
        () => { charges++; return Result.succeed(undefined); });
      await expect(guarded(async tx => {
        await tx.update(fxSystemDataBindingHeads).set(secondHeadRow)
          .where(eq(fxSystemDataBindingHeads.scopeId, scopeId));
        const temporary = await Effect.runPromise(readBindingSelectedEvidence(tx, location, headOnlyPreparation));
        expect(Option.isSome(temporary) ? temporary.value.head.frame.sequence : undefined).toBe(secondHeadRow.sequence.toString());
        throw new Error("Rollback only the temporary live binding head");
      })).rejects.toThrow("Rollback only the temporary live binding head");
      const afterHeadRollback = await guarded(tx => Effect.runPromise(readBindingSelectedEvidence(tx, location, headOnlyPreparation)));
      expect(afterHeadRollback).toEqual(original);
      expect(charges).toBe(1);
    } finally {
      for (const close of cleanup.reverse()) await close();
    }
  }, 180_000);
});
